// Import UNIFIÉ d'une base clients + segmentation proposée.
//
// Un seul fichier, une seule attestation : les emails alimentent les campagnes
// email, les numéros les campagnes SMS (le pro choisit les canaux), et chaque
// ligne garde ses attributs (ville, pays, dépenses, fréquence, dernier achat,
// âge, genre). Après l'import, Yuno analyse la base et PROPOSE des segments
// avec leur effectif réel joignable par canal et une raison chiffrée ; le pro
// coche ce qu'il garde. Les segments créés apparaissent à l'écran Audience du
// Studio email (kind contact_segment) et dans l'éditeur SMS.
//
// Deux entrées :
//   mode 'import'  → fichier → attestation → rapport → propositions
//   mode 'analyze' → propositions sur la base déjà importée + segments existants
//
// Toute la validation, l'import et l'analyse sont serveur (`import_contact_list`,
// `analyze_contact_lists`, `save_contact_segments`) : ici c'est de la lecture
// et du confort, jamais de la sécurité.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload, FileText, CheckCircle2, AlertTriangle, Loader2, ShieldCheck, X, Sparkles,
  MapPin, Euro, Repeat, Clock, Users, BadgeCheck, Smartphone, Trash2, RefreshCw, Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ActionOverlay, ActionResultCard, type ActionStep } from '@/components/action/ActionOverlay';
import { actionFmt } from '@/components/action/tokens';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { useLanguage } from '@/contexts/LanguageContext';
import { isPreviewActive } from '@/contexts/PreviewModeContext';
import type { ConsentSource } from '@/lib/emailImport';
import { IMPORT_COUNTRIES } from '@/lib/smsImport';
import { chunkRows, parseContactFile, type ContactField, type ContactParseResult } from '@/lib/contactImport';
import {
  BASKET_PRESET_BASE, SEGMENT_GROUPS, countryName, describeSuggestion, loadBasketSuggestion, loadYunoPresetSuggestions,
  suggestionBase,
  type BasketSuggestion, type ContactAnalysis, type ContactIntelligenceOverview, type ContactSegment, type SegmentGroup,
  type SegmentSuggestion,
} from '@/lib/contactSegments';
import BasketThresholdField from '@/components/contacts/BasketThresholdField';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, MailOpen, Database } from 'lucide-react';
import CampaignImpactCard from '@/components/contacts/CampaignImpactCard';
import { impactFromOverview, type CampaignImpact } from '@/lib/contactBase';

export type ImportScope =
  | { kind: 'venue'; venueId: string }
  | { kind: 'organizer'; organizerId: string }
  /** Base marketing de Yuno (super admin) : les deux colonnes de portee a NULL. */
  | { kind: 'platform' };

interface Props {
  open: boolean;
  onClose: () => void;
  scope: ImportScope;
  mode?: 'import' | 'analyze';
  /** Appelé après un import réussi ET après la création de segments. */
  onChanged?: () => void;
  /** Racine des campagnes de la portée : affiche « Voir toute la base » (→ `${basePath}/contacts`). */
  basePath?: string;
}

interface ImportTotals {
  submitted: number; rows: number; invalid: number; duplicates: number;
  emailsAdded: number; emailsUnchanged: number; emailsSuppressed: number;
  phonesAdded: number; phonesUnchanged: number; phonesSuppressed: number;
  /** Listes absorbées par cet import (fusion demandée ou doublon exact). */
  merged: number;
}

/** Une liste déjà présente qui contient une partie du fichier qu'on importe. */
interface ImportOverlap {
  import_id: string;
  channel: 'email' | 'sms';
  list_name: string | null;
  filename: string | null;
  created_at: string;
  size: number;
  shared: number;
}

/**
 * L'avis rendu par `check_contact_import` AVANT toute écriture : ce fichier
 * est-il déjà dans la base, et combien de ses contacts appartiennent déjà à
 * quelle liste. C'est ce qui évite le fichier réimporté qui fabrique une
 * deuxième liste au lieu de rafraîchir la première.
 */
interface ImportCheck {
  emails: number; phones: number;
  known_emails: number; known_phones: number;
  new_emails: number; new_phones: number;
  duplicate_of: Omit<ImportOverlap, 'shared'> | null;
  overlaps: ImportOverlap[];
}

/**
 * Quand faut-il s'arrêter et demander ? Deux cas, et deux seulement :
 *   - le fichier est déjà là à l'identique ;
 *   - il reprend au moins la moitié d'une liste existante (c'est la situation
 *     qui fabrique deux listes pour un seul public).
 * Quelques adresses déjà connues parce que ces gens sont clients ne méritent
 * pas une question : l'import continue tout seul.
 */
function needsDecision(c: ImportCheck): boolean {
  if (c.duplicate_of) return true;
  return (c.overlaps || []).some((o) => o.shared >= 10 && o.shared >= o.size * 0.5);
}

/** Nom affiché d'une liste : celui du pro, sinon son fichier sans extension. */
function overlapName(o: { list_name: string | null; filename: string | null }, fallback: string): string {
  return (o.list_name || '').trim() || (o.filename || '').replace(/\.[a-z0-9]+$/i, '').trim() || fallback;
}

const CONSENT_OPTIONS: Array<{ value: ConsentSource; labelKey: string }> = [
  { value: 'ticketing',    labelKey: 'em.import.src.ticketing' },
  { value: 'in_person',    labelKey: 'em.import.src.inPerson' },
  { value: 'website_form', labelKey: 'em.import.src.websiteForm' },
  { value: 'social',       labelKey: 'em.import.src.social' },
  { value: 'other_tool',   labelKey: 'em.import.src.otherTool' },
  { value: 'other',        labelKey: 'em.import.src.other' },
];

// Lignes riches (18 colonnes) : 500 par appel garde une barre qui bouge et
// reste très en dessous du plafond serveur (2 000).
const CHUNK = 500;

const FIELD_LABEL_KEYS: Record<ContactField, string> = {
  email: 'cimp.f.email', phone: 'cimp.f.phone', firstName: 'cimp.f.firstName', lastName: 'cimp.f.lastName',
  fullName: 'cimp.f.fullName', country: 'cimp.f.country', region: 'cimp.f.region', city: 'cimp.f.city',
  postalCode: 'cimp.f.postalCode', zone: 'cimp.f.zone', age: 'cimp.f.age', birthDate: 'cimp.f.birthDate',
  gender: 'cimp.f.gender', newsletter: 'cimp.f.newsletter', addedAt: 'cimp.f.addedAt',
  lastPurchaseAt: 'cimp.f.lastPurchaseAt', totalSpent: 'cimp.f.totalSpent', eventCount: 'cimp.f.eventCount',
};

function scopeArgs(scope: ImportScope) {
  // Portee plateforme : les deux a null, ce que la base lit comme « Yuno »
  // (voir marketing_scope_match). L'autorisation reste serveur : super admin.
  return {
    p_venue_id: scope.kind === 'venue' ? scope.venueId : null,
    p_organizer_user_id: scope.kind === 'organizer' ? scope.organizerId : null,
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message
    : (e && typeof e === 'object' && 'message' in e) ? String((e as { message: unknown }).message) : String(e);
}

export default function ContactImportDialog({ open, onClose, scope, mode = 'import', onChanged, basePath }: Props) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [raw, setRaw] = useState('');
  const [filename, setFilename] = useState<string | null>(null);
  const [listName, setListName] = useState('');
  const [countryCode, setCountryCode] = useState(language === 'es' ? 'ES' : 'FR');
  const [wantEmail, setWantEmail] = useState(true);
  const [wantSms, setWantSms] = useState(true);
  const [consentSource, setConsentSource] = useState<ConsentSource | ''>('');
  const [consentDetails, setConsentDetails] = useState('');
  const [collectedSince, setCollectedSince] = useState('');
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totals, setTotals] = useState<ImportTotals | null>(null);
  const [listImportId, setListImportId] = useState<string | null>(null);
  const [check, setCheck] = useState<ImportCheck | null>(null);
  const [phase, setPhase] = useState<'form' | 'verdict' | 'report' | 'segments'>('form');
  // Écran d'import : `runStage` compte les étapes RÉELLEMENT franchies
  // (fichier lu → doublons vérifiés → contacts envoyés → listes fusionnées) et
  // `runSent` suit le nombre de lignes réellement acceptées par le serveur.
  const [runOpen, setRunOpen] = useState(false);
  const [runStage, setRunStage] = useState(0);
  const [runSent, setRunSent] = useState(0);
  const [runTotals, setRunTotals] = useState<ImportTotals | null>(null);

  const country = IMPORT_COUNTRIES.find((c) => c.code === countryCode) ?? IMPORT_COUNTRIES[0];
  const parsed: ContactParseResult | null = useMemo(() => (raw.trim() ? parseContactFile(raw, country) : null), [raw, country]);

  const reset = useCallback(() => {
    setRaw(''); setFilename(null); setListName(''); setWantEmail(true); setWantSms(true);
    setConsentSource(''); setConsentDetails(''); setCollectedSince(''); setAttested(false);
    setBusy(false); setProgress(0); setTotals(null); setListImportId(null); setCheck(null); setPhase('form');
    setRunOpen(false); setRunStage(0); setRunSent(0); setRunTotals(null);
  }, []);
  const close = useCallback(() => { if (!busy) { reset(); onClose(); } }, [busy, reset, onClose]);

  useEffect(() => {
    if (open && mode === 'analyze') setPhase('segments');
  }, [open, mode]);

  const onFile = useCallback(async (file: File) => {
    if (file.size > 15 * 1024 * 1024) { toast.error(t('em.import.tooBig')); return; }
    const text = await file.text();
    setFilename(file.name);
    setListName((prev) => prev || file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 60));
    setRaw(text);
  }, [t]);

  // Canaux : proposés selon ce que le fichier contient.
  useEffect(() => {
    if (!parsed) return;
    setWantEmail(parsed.stats.emails > 0);
    setWantSms(parsed.stats.phones > 0);
  }, [parsed?.stats.emails, parsed?.stats.phones]); // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveEmails = parsed && wantEmail ? parsed.stats.emails : 0;
  const effectivePhones = parsed && wantSms ? parsed.stats.phones : 0;
  const canImport = !!parsed && parsed.rows.length > 0 && (effectiveEmails > 0 || effectivePhones > 0)
    && !!consentSource && attested && !busy;

  // ── L'avis avant écriture ──────────────────────────────────────────────
  // Le fichier est déjà lu côté navigateur : on envoie les identités, rien
  // d'autre, et le serveur dit si ce fichier est déjà là. Sans cette étape, un
  // pro qui réimporte sa base fabrique une deuxième liste qui n'annonce pas la
  // bonne taille — et qui, choisie comme audience, touche beaucoup moins de
  // monde que son nom ne le promet.
  const runCheck = useCallback(async (): Promise<ImportCheck | null> => {
    if (!parsed) return null;
    const emails = wantEmail ? parsed.rows.map((r) => r.email).filter((v): v is string => !!v) : [];
    const phones = wantSms ? parsed.rows.map((r) => r.phone).filter((v): v is string => !!v) : [];
    const { data, error } = await supabase.rpc('check_contact_import' as never, {
      ...scopeArgs(scope), p_emails: emails, p_phones: phones,
    } as never);
    if (error) return null; // La vérification est un confort : elle ne bloque jamais un import.
    return (data ?? null) as unknown as ImportCheck | null;
  }, [parsed, scope, wantEmail, wantSms]);

  const doImport = useCallback(async (importMode: 'append' | 'merge') => {
    if (!parsed) return;
    setBusy(true); setProgress(0);
    // Le fichier est lu et les doublons vérifiés avant d'arriver ici : l'écran
    // s'ouvre donc sur sa troisième étape, les deux premières déjà cochées.
    setRunSent(0); setRunTotals(null); setRunStage(2); setRunOpen(true);
    const chunks = chunkRows(parsed.rows, CHUNK);
    const tot: ImportTotals = {
      submitted: 0, rows: 0, invalid: parsed.invalid.length, duplicates: parsed.duplicates,
      emailsAdded: 0, emailsUnchanged: 0, emailsSuppressed: 0, phonesAdded: 0, phonesUnchanged: 0, phonesSuppressed: 0,
      merged: 0,
    };
    let importId: string | null = null;
    const detected = Object.fromEntries(Object.entries(parsed.detected).map(([k, v]) => [k, v ?? true]));
    try {
      for (let i = 0; i < chunks.length; i++) {
        const { data, error } = await supabase.rpc('import_contact_list' as never, {
          p_rows: chunks[i] as unknown as Json,
          p_consent_source: consentSource,
          ...scopeArgs(scope),
          p_filename: filename,
          p_consent_details: consentDetails || null,
          p_collected_since: collectedSince || null,
          p_list_import_id: importId,
          p_list_name: listName.trim() || null,
          p_default_country: country.code,
          p_channels: { email: wantEmail, sms: wantSms },
          p_detected: detected,
          p_mode: importMode,
          // Le dernier lot : c'est là que le serveur calcule l'empreinte du
          // fichier reçu et fusionne si c'est un doublon exact. La garantie
          // est serveur, la case ci-dessous ne fait que la déclencher au bon
          // moment.
          p_final: i === chunks.length - 1,
        } as never);
        if (error) throw error;
        const r = (data ?? {}) as unknown as Record<string, unknown>;
        importId = (r.list_import_id as string) ?? importId;
        tot.submitted += Number(r.submitted || 0);
        tot.rows += Number(r.rows || 0);
        tot.invalid += Number(r.invalid || 0);
        const em = (r.email ?? null) as Record<string, number> | null;
        const sm = (r.sms ?? null) as Record<string, number> | null;
        if (em) {
          tot.emailsAdded += Number(em.inserted || 0) + Number(em.reactivated || 0);
          tot.emailsUnchanged += Number(em.unchanged || 0);
          tot.emailsSuppressed += Number(em.suppressed || 0);
        }
        if (sm) {
          tot.phonesAdded += Number(sm.inserted || 0);
          tot.phonesUnchanged += Number(sm.unchanged || 0);
          tot.phonesSuppressed += Number(sm.suppressed || 0);
        }
        const absorbed = (r.absorbed ?? null) as { retired_email_lists?: string[]; retired_sms_lists?: string[] } | null;
        if (absorbed) {
          tot.merged += (absorbed.retired_email_lists?.length ?? 0) + (absorbed.retired_sms_lists?.length ?? 0);
        }
        setProgress(Math.round(((i + 1) / chunks.length) * 100));
        // Le compteur de l'écran suit les lignes ACCEPTÉES par le serveur,
        // jamais l'horloge : c'est lui qui dit au pro où en est son fichier.
        setRunSent(Math.min(parsed.rows.length, (i + 1) * CHUNK));
      }
      setRunStage(3); // tous les lots sont partis
      setTotals(tot);
      setListImportId(importId);
      setPhase('report');
      onChanged?.();
      // Le dernier lot porte l'empreinte et la fusion : elle est acquise.
      setRunTotals(tot);
      setRunStage(4);
      toast.success(t('cimp.done').replace('{n}', String(tot.rows)));
    } catch (e) {
      const msg = errMsg(e);
      // L'écran se retire : un compteur figé par-dessus un message d'erreur ne
      // dirait rien à personne.
      setRunOpen(false);
      toast.error(msg.includes('support') ? t('em.import.errSupport') : msg);
    } finally {
      setBusy(false);
    }
  }, [parsed, consentSource, scope, filename, listName, consentDetails, collectedSince, country.code, wantEmail, wantSms, onChanged, t]);

  // Le pro clique « Importer » : on demande d'abord l'avis, et on ne
  // l'interrompt que s'il y a vraiment quelque chose à décider. Un
  // recouvrement anecdotique (quelques adresses déjà clientes) passe tout
  // seul ; un fichier déjà importé, ou qui reprend une liste existante, pose
  // la question une fois.
  const startImport = useCallback(async () => {
    if (!parsed || !canImport) return;
    if (isPreviewActive()) { toast.error(t('smsc.previewReadOnly')); return; }
    setBusy(true);
    const verdict = await runCheck();
    setBusy(false);
    // Un vrai doublon ou une liste recouverte : on rend la main au pro avant
    // d'écrire quoi que ce soit — l'écran d'import n'a pas encore à s'ouvrir.
    if (verdict && needsDecision(verdict)) { setCheck(verdict); setPhase('verdict'); return; }
    await doImport('append');
  }, [parsed, canImport, runCheck, doImport, t]);

  const isAnalyze = phase === 'segments';

  const runSteps = useMemo<ActionStep[]>(() => [
    { key: 's1', label: t('owner.importrun.s1'), seconds: 0.9 },
    { key: 's2', label: t('owner.importrun.s2'), seconds: 1.2 },
    { key: 's3', label: t('owner.importrun.s3'), seconds: 2.6, total: parsed?.rows.length, value: runSent },
    { key: 's4', label: t('owner.importrun.s4'), seconds: 1.0 },
  ], [t, parsed, runSent]);

  const emailsKept = runTotals ? runTotals.emailsAdded + runTotals.emailsUnchanged : 0;
  const phonesKept = runTotals ? runTotals.phonesAdded + runTotals.phonesUnchanged : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      {/* Le dialogue ne défile plus lui-même : c'est son contenu qui défile,
          pour que l'écran d'import (`absolute; inset: 0`) recouvre la carte
          visible et non toute la hauteur du formulaire déroulé. Ne JAMAIS y
          ajouter `position: relative` en inline : la classe de base est
          `fixed left-[50%] top-[50%]`, un style inline gagne contre une classe
          et le dialogue retomberait dans le flux de la page. */}
      <DialogContent
        className="max-h-[90vh] max-w-2xl"
        data-action-busy={runOpen && runStage < 4 ? '1' : undefined}
        style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
      <div className="flex-1 min-h-0 overflow-y-auto" style={{
        transition: 'filter .6s cubic-bezier(.16,1,.3,1), transform .6s cubic-bezier(.16,1,.3,1), opacity .5s ease',
        filter: runOpen ? 'blur(10px)' : 'none',
        transform: runOpen ? 'scale(.98)' : 'none',
        opacity: runOpen ? 0.4 : 1,
      }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isAnalyze ? <Sparkles className="h-4 w-4" style={{ color: '#E8192C' }} /> : <Upload className="h-4 w-4" />}
            {isAnalyze ? t('cimp.analyzeTitle') : t('cimp.title')}
          </DialogTitle>
          <DialogDescription>{isAnalyze ? t('cimp.analyzeSubtitle') : t('cimp.subtitle')}</DialogDescription>
        </DialogHeader>

        {phase === 'segments' && (
          <SegmentProposals
            scope={scope}
            listImportId={listImportId}
            onChanged={onChanged}
            onDone={close}
            basePath={basePath}
          />
        )}

        {phase === 'report' && totals && (
          <ImportReport
            totals={totals}
            wantEmail={wantEmail}
            wantSms={wantSms}
            onSegments={() => setPhase('segments')}
            onDone={close}
            t={t}
          />
        )}

        {phase === 'verdict' && check && (
          <ImportVerdict
            check={check}
            busy={busy}
            progress={progress}
            language={language}
            onChoose={(m) => { void doImport(m); }}
            onBack={() => { setCheck(null); setPhase('form'); }}
            t={t}
          />
        )}

        {phase === 'form' && (
          <div className="space-y-5">
            {/* ── 1. Le fichier ─────────────────────────────────────────── */}
            <div>
              <Label className="text-[13px]">{t('em.import.step1')}</Label>
              <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
                  <Upload className="mr-2 h-4 w-4" />{t('em.import.chooseFile')}
                </Button>
                {filename && (
                  <span className="inline-flex items-center gap-1.5 text-[12px] opacity-70">
                    <FileText className="h-3.5 w-3.5" /> {filename}
                    <button type="button" onClick={reset} className="opacity-60 hover:opacity-100" aria-label={t('common.remove')}><X className="h-3.5 w-3.5" /></button>
                  </span>
                )}
              </div>
              <Textarea className="mt-2 min-h-[80px] font-mono text-[12px]" placeholder={t('cimp.pastePlaceholder')}
                value={filename ? '' : raw} disabled={busy || !!filename} onChange={(e) => setRaw(e.target.value)} />
              <p className="mt-1.5 text-[11px] opacity-50">{t('cimp.fileHint')}</p>
            </div>

            {/* ── Rapport de lecture ────────────────────────────────────── */}
            {parsed && (
              <div className="space-y-2.5 rounded-lg border p-3 text-[12.5px]" style={{ borderColor: 'rgb(var(--ink)/0.1)' }}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-semibold">{t('cimp.readTitle').replace('{n}', String(parsed.rows.length))}</span>
                  <span className="opacity-70">{t('cimp.readEmails').replace('{n}', String(parsed.stats.emails))}</span>
                  <span className="opacity-70">{t('cimp.readPhones').replace('{n}', String(parsed.stats.phones))}</span>
                  {parsed.stats.both > 0 && <span className="opacity-50">{t('cimp.readBoth').replace('{n}', String(parsed.stats.both))}</span>}
                  {parsed.duplicates > 0 && <span className="opacity-50">{parsed.duplicates} {t('em.import.dupes')}</span>}
                  {parsed.invalid.length > 0 && (
                    <span className="inline-flex items-center gap-1" style={{ color: 'var(--acc-fcd34d)' }}>
                      <AlertTriangle className="h-3.5 w-3.5" />{parsed.invalid.length} {t('em.import.unreadable')}
                    </span>
                  )}
                </div>
                {Object.keys(parsed.detected).length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="opacity-55">{t('cimp.detected')}</span>
                    {(Object.keys(parsed.detected) as ContactField[]).map((f) => (
                      <span key={f} className="rounded-full px-2 py-0.5 text-[11px]"
                        style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)', color: 'var(--acc-a7f3d0)' }}>
                        {t(FIELD_LABEL_KEYS[f])}
                      </span>
                    ))}
                  </div>
                )}
                {parsed.rows.length > 0 && (
                  <p className="text-[11.5px] leading-relaxed opacity-70">
                    {(parsed.stats.withLocation > 0 || parsed.stats.withSpend > 0 || parsed.stats.withEvents > 0 || parsed.stats.withLastPurchase > 0)
                      ? t('cimp.richHint') : t('cimp.poorHint')}
                  </p>
                )}
                {parsed.invalid.length > 0 && (
                  <details>
                    <summary className="cursor-pointer opacity-55">{t('em.import.showRejected')}</summary>
                    <ul className="mt-1 max-h-24 overflow-y-auto font-mono text-[11px] opacity-70">
                      {parsed.invalid.slice(0, 20).map((l, i) => <li key={i}>{l}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            )}

            {parsed && parsed.rows.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-[12px]">{t('em.import.listName')}</Label>
                  <Input className="mt-1" value={listName} disabled={busy} maxLength={60}
                    placeholder={t('em.import.listNamePlaceholder')} onChange={(e) => setListName(e.target.value)} />
                  <p className="mt-1 text-[11px] opacity-50">{t('em.import.listNameHint')}</p>
                </div>
                {parsed.stats.phones > 0 && (
                  <div>
                    <Label className="text-[12px]">{t('smsc.import.country')}</Label>
                    <Select value={countryCode} onValueChange={setCountryCode} disabled={busy}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {IMPORT_COUNTRIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <p className="mt-1 text-[11px] opacity-50">{t('smsc.import.countryHint')}</p>
                  </div>
                )}
              </div>
            )}

            {/* ── Canaux ─────────────────────────────────────────────────── */}
            {parsed && parsed.rows.length > 0 && (
              <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: 'rgb(var(--ink)/0.1)' }}>
                <Label className="text-[12px]">{t('cimp.channels')}</Label>
                <label className="flex cursor-pointer items-center justify-between gap-3 text-[12.5px]">
                  <span className="opacity-85">{t('cimp.chEmail')} <span className="opacity-50">· {parsed.stats.emails}</span></span>
                  <Switch checked={wantEmail} onCheckedChange={setWantEmail} disabled={busy || parsed.stats.emails === 0} />
                </label>
                <label className="flex cursor-pointer items-center justify-between gap-3 text-[12.5px]">
                  <span className="opacity-85">{t('cimp.chSms')} <span className="opacity-50">· {parsed.stats.phones}</span></span>
                  <Switch checked={wantSms} onCheckedChange={setWantSms} disabled={busy || parsed.stats.phones === 0} />
                </label>
                {effectiveEmails === 0 && effectivePhones === 0 && (
                  <p className="text-[11px]" style={{ color: 'var(--acc-fcd34d)' }}>{t('cimp.chNone')}</p>
                )}
              </div>
            )}

            {/* ── 2. L'attestation ──────────────────────────────────────── */}
            {parsed && parsed.rows.length > 0 && (
              <div className="space-y-3 rounded-lg border p-3" style={{ borderColor: 'rgb(var(--ink)/0.1)', background: 'rgb(var(--ink)/0.02)' }}>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" style={{ color: 'var(--acc-34d399)' }} />
                  <span className="text-[13px] font-semibold">{t('em.import.step2')}</span>
                </div>
                <div>
                  <Label className="text-[12px]">{t('em.import.consentSource')}</Label>
                  <Select value={consentSource} onValueChange={(v) => setConsentSource(v as ConsentSource)} disabled={busy}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder={t('em.import.consentPlaceholder')} /></SelectTrigger>
                    <SelectContent>
                      {CONSENT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{t(o.labelKey)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-[12px]">{t('em.import.collectedSince')}</Label>
                    <Input type="date" className="mt-1" value={collectedSince} disabled={busy} max={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setCollectedSince(e.target.value)} />
                    <p className="mt-1 text-[11px] opacity-50">{t('em.import.collectedSinceHint')}</p>
                  </div>
                  <div>
                    <Label className="text-[12px]">{t('em.import.consentDetails')}</Label>
                    <Textarea className="mt-1 min-h-[54px] text-[12.5px]" value={consentDetails} disabled={busy}
                      placeholder={t('em.import.consentDetailsPlaceholder')} onChange={(e) => setConsentDetails(e.target.value.slice(0, 500))} />
                  </div>
                </div>
                <label className="flex cursor-pointer items-start gap-2.5">
                  <Checkbox checked={attested} onCheckedChange={(v) => setAttested(v === true)} disabled={busy} className="mt-0.5" />
                  <span className="text-[12px] leading-snug opacity-85">{t('cimp.attestation')}</span>
                </label>
              </div>
            )}

            {parsed && parsed.rows.length > 0 && (
              <p className="rounded-lg p-2.5 text-[11.5px] leading-relaxed"
                 style={{ background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.2)', color: 'rgb(var(--ink)/var(--ink-a70,0.7))' }}>
                {t('cimp.afterNotice')}
              </p>
            )}

            {busy && (
              <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: 'rgb(var(--ink)/0.08)' }}>
                <div className="h-full transition-all" style={{ width: `${progress}%`, background: '#E8192C' }} />
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close} disabled={busy}>{t('common.cancel')}</Button>
              <Button onClick={startImport} disabled={!canImport}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {busy ? t('cimp.checking') : t('cimp.cta').replace('{n}', String(parsed?.rows.length ?? 0))}
              </Button>
            </div>
          </div>
        )}
      </div>
      <ActionOverlay
        open={runOpen}
        stage={runStage}
        steps={runSteps}
        kicker={[t('owner.importrun.kicker'), t('owner.importrun.kickerDone')]}
        title={[t('owner.importrun.title'), t('owner.importrun.titleDone')]}
        finalWord={t('owner.importrun.final')}
        primaryLabel={basePath ? t('owner.importrun.seeBase') : undefined}
        onPrimary={basePath ? () => { setRunOpen(false); onClose(); navigate(`${basePath}/contacts`); } : undefined}
        onClose={() => setRunOpen(false)}
        done={runTotals ? (
          <ActionResultCard kicker={t('owner.importrun.cardKicker')}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 9 }}>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 36, lineHeight: .86, letterSpacing: '-.04em', fontVariantNumeric: 'tabular-nums' }}>
                {actionFmt(runTotals.rows)}
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--tx-9a9a9a)', paddingBottom: 4 }}>
                {t('owner.importrun.contacts')}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '.04em', color: 'var(--tx-9a9a9a)', fontVariantNumeric: 'tabular-nums', marginTop: -5 }}>
              {emailsKept > 0 && <div>{actionFmt(emailsKept)} {t('owner.importrun.emails')}</div>}
              {phonesKept > 0 && <div>{actionFmt(phonesKept)} {t('owner.importrun.phones')}</div>}
              {runTotals.merged > 0 && <div>{actionFmt(runTotals.merged)} {t('owner.importrun.merged')}</div>}
            </div>
          </ActionResultCard>
        ) : null}
      />
      </DialogContent>
    </Dialog>
  );
}

// ── Ce fichier est-il déjà là ? ──────────────────────────────────────────────
//
// L'écran ne s'affiche que quand il y a une vraie décision à prendre (voir
// `needsDecision`). Il dit ce qui est déjà en base, nomme les listes
// concernées, et n'offre que deux issues — fusionner ou garder séparé. Les
// deux sont légitimes : un pro qui remplace sa base fusionne, un pro qui
// importe ses VIP après sa base générale garde séparé.
function ImportVerdict({ check, busy, progress, language, onChoose, onBack, t }: {
  check: ImportCheck;
  busy: boolean;
  progress: number;
  language: string;
  onChoose: (mode: 'append' | 'merge') => void;
  onBack: () => void;
  t: (k: string) => string;
}) {
  const dup = check.duplicate_of;
  const total = check.emails + check.phones;
  const known = check.known_emails + check.known_phones;
  const fresh = check.new_emails + check.new_phones;
  const day = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(language, { day: 'numeric', month: 'long', year: 'numeric' });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3.5"
           style={{ background: 'rgba(252,211,77,0.07)', borderColor: 'rgba(252,211,77,0.28)' }}>
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--acc-fcd34d)' }} />
          <div className="space-y-1.5">
            <p className="text-[13.5px] font-semibold">{t(dup ? 'cimp.dup.title' : 'cimp.ov.title')}</p>
            <p className="text-[12.5px] leading-relaxed opacity-80">
              {dup
                ? t('cimp.dup.body')
                    .replace('{n}', String(total))
                    .replace('{list}', overlapName(dup, t('cimp.ov.unnamed')))
                    .replace('{date}', day(dup.created_at))
                : t('cimp.ov.body').replace('{n}', String(known)).replace('{total}', String(total))}
            </p>
          </div>
        </div>
      </div>

      {!dup && check.overlaps.length > 0 && (
        <ul className="space-y-1.5">
          {check.overlaps.map((o) => (
            <li key={`${o.channel}:${o.import_id}`} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-[12.5px]"
                style={{ borderColor: 'rgb(var(--ink)/0.1)' }}>
              <span className="inline-flex items-center gap-1.5 truncate">
                {o.channel === 'sms' ? <Smartphone className="h-3.5 w-3.5 opacity-60" /> : <MailOpen className="h-3.5 w-3.5 opacity-60" />}
                <span className="truncate">{overlapName(o, t('cimp.ov.unnamed'))}</span>
              </span>
              <span className="shrink-0 opacity-70">
                {t('cimp.ov.shared').replace('{n}', String(o.shared)).replace('{size}', String(o.size))}
              </span>
            </li>
          ))}
        </ul>
      )}

      {busy && (
        <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: 'rgb(var(--ink)/0.08)' }}>
          <div className="h-full transition-all" style={{ width: `${progress}%`, background: '#E8192C' }} />
        </div>
      )}

      <div className="space-y-2">
        <button type="button" disabled={busy} onClick={() => onChoose('merge')}
                className="w-full rounded-lg border p-3 text-left transition-colors disabled:opacity-50"
                style={{ borderColor: 'rgba(232,25,44,0.45)', background: 'rgba(232,25,44,0.08)' }}>
          <span className="flex items-center gap-2 text-[13px] font-semibold">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t(dup ? 'cimp.dup.cta' : 'cimp.ov.merge')}
          </span>
          <span className="mt-1 block text-[11.5px] leading-relaxed opacity-70">
            {t(dup ? 'cimp.dup.hint' : 'cimp.ov.mergeHint')}
          </span>
        </button>

        {!dup && (
          <button type="button" disabled={busy} onClick={() => onChoose('append')}
                  className="w-full rounded-lg border p-3 text-left transition-colors disabled:opacity-50"
                  style={{ borderColor: 'rgb(var(--ink)/0.12)' }}>
            <span className="flex items-center gap-2 text-[13px] font-semibold">
              <Database className="h-4 w-4" />{t('cimp.ov.keep')}
            </span>
            <span className="mt-1 block text-[11.5px] leading-relaxed opacity-70">
              {t('cimp.ov.keepHint').replace('{n}', String(fresh))}
            </span>
          </button>
        )}
      </div>

      <div className="flex justify-end">
        <Button variant="ghost" onClick={onBack} disabled={busy}>{t('cimp.ov.back')}</Button>
      </div>
    </div>
  );
}

// ── Rapport d'import ─────────────────────────────────────────────────────────
function ImportReport({ totals, wantEmail, wantSms, onSegments, onDone, t }: {
  totals: ImportTotals; wantEmail: boolean; wantSms: boolean; onSegments: () => void; onDone: () => void; t: (k: string) => string;
}) {
  const rows: Array<[string, number]> = [[t('cimp.rep.rows'), totals.rows]];
  if (wantEmail) rows.push([t('cimp.rep.emailsAdded'), totals.emailsAdded], [t('cimp.rep.emailsAlready'), totals.emailsUnchanged], [t('cimp.rep.emailsSuppressed'), totals.emailsSuppressed]);
  if (wantSms) rows.push([t('cimp.rep.phonesAdded'), totals.phonesAdded], [t('cimp.rep.phonesAlready'), totals.phonesUnchanged], [t('cimp.rep.phonesSuppressed'), totals.phonesSuppressed]);
  rows.push([t('cimp.rep.dupes'), totals.duplicates], [t('cimp.rep.invalid'), totals.invalid]);
  // Une liste absorbée n'est pas une perte : elle a été REMPLACÉE par
  // celle-ci, qui porte désormais tous ses contacts. On le dit, sinon le pro
  // croit avoir effacé quelque chose.
  if (totals.merged > 0) rows.push([t('cimp.rep.merged'), totals.merged]);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <CheckCircle2 className="h-5 w-5" style={{ color: 'var(--acc-34d399)' }} />
        <span className="text-[15px] font-semibold">{t('cimp.rep.title')}</span>
      </div>
      <div className="space-y-1.5 rounded-lg border p-3 text-[12.5px]" style={{ borderColor: 'rgb(var(--ink)/0.1)' }}>
        {rows.map(([label, n]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <span className="opacity-65">{label}</span>
            <span className="font-semibold tabular-nums">{n}</span>
          </div>
        ))}
      </div>
      <div className="rounded-lg p-3" style={{ background: 'rgba(232,25,44,0.07)', border: '1px solid rgba(232,25,44,0.25)' }}>
        <div className="flex items-center gap-2 text-[13px] font-semibold"><Sparkles className="h-4 w-4" style={{ color: '#E8192C' }} />{t('cimp.rep.nextTitle')}</div>
        <p className="mt-1 text-[12px] leading-relaxed opacity-75">{t('cimp.rep.nextBody')}</p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>{t('cseg.skip')}</Button>
        <Button onClick={onSegments}><Sparkles className="mr-2 h-4 w-4" />{t('cimp.rep.nextCta')}</Button>
      </div>
    </div>
  );
}

// ── Propositions de segments ────────────────────────────────────────────────
const GROUP_ICON: Record<SegmentGroup, typeof MapPin> = {
  geo: MapPin, spend: Euro, freq: Repeat, recency: Clock, demo: Users, consent: BadgeCheck, channel: Smartphone,
  engagement: MailOpen, source: Database,
};

export function SegmentProposals({ scope, listImportId, onChanged, onDone, basePath }: {
  scope: ImportScope; listImportId: string | null; onChanged?: () => void; onDone: () => void; basePath?: string;
}) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const [impacts, setImpacts] = useState<CampaignImpact[]>([]);
  // Deux chargements, jamais confondus :
  //   • la vue d'ensemble = l'ÉTAT ACTUEL de la base — les segments
  //     enregistrés avec leur effectif du moment. Un aller-retour, toujours
  //     joué à l'ouverture.
  //   • l'analyseur (`analyze_contact_lists`) = la recherche de NOUVEAUX
  //     segments, qui relit toute la base et coûte plusieurs secondes.
  //     Il n'est JAMAIS rejoué tout seul sur une portée qui a déjà ses
  //     segments : un segment est une définition, pas une photo — il est
  //     recalculé à chaque envoi, et les envois faits depuis l'ont déjà fait
  //     bouger. Le réafficher ne demande pas de repartir de zéro.
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [overview, setOverview] = useState<ContactIntelligenceOverview | null>(null);
  const [analysis, setAnalysis] = useState<ContactAnalysis | null>(null);
  const [segments, setSegments] = useState<ContactSegment[]>([]);
  // Le seuil du panier moyen élevé : valeur Yuno de la portée, ou celle du pro.
  const [basketSuggestion, setBasketSuggestion] = useState<BasketSuggestion | null>(null);
  const [basketThreshold, setBasketThreshold] = useState<number | null>(null);
  const [basketDebounced, setBasketDebounced] = useState<number | null>(null);
  const [presets, setPresets] = useState<SegmentSuggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [createdCount, setCreatedCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const nf = (n: number) => n.toLocaleString(language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR');

  // Les appelants passent `scope={{ kind: 'venue', venueId }}` en littéral :
  // un objet NEUF à chaque rendu du parent. Les effets se règlent donc sur la
  // CLÉ de portée, jamais sur l'objet — sinon le chargement repartait à chaque
  // rendu du parent.
  const scopeKey = scope.kind === 'venue' ? `v:${scope.venueId}`
    : scope.kind === 'organizer' ? `o:${scope.organizerId}` : 'p';
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  /** L'état actuel : segments et leurs effectifs, bilans de campagne, base vivante. */
  const loadOverview = useCallback(async (): Promise<ContactIntelligenceOverview | null> => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase.rpc('get_contact_intelligence_overview' as never, scopeArgs(scopeRef.current) as never);
      if (error) throw error;
      const ov = (data ?? {}) as unknown as ContactIntelligenceOverview;
      setOverview(ov);
      setSegments(ov.segments || []);
      setImpacts(((ov.impacts || []) as Parameters<typeof impactFromOverview>[0][]).map(impactFromOverview));
      return ov;
    } catch (e) {
      // Une erreur n'est PAS « base vide » : on la montre telle quelle, avec
      // un bouton pour réessayer — jamais l'écran « importez d'abord ».
      setLoadError(errMsg(e));
      setOverview(null);
      return null;
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  /** La recherche de nouveaux segments : à la demande, ou quand il n'y a rien d'autre à montrer. */
  const runAnalysis = useCallback(async () => {
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const args = scopeArgs(scopeRef.current);
      const { data: an, error } = listImportId
        ? await supabase.rpc('analyze_contact_list_import' as never, { p_list_import_id: listImportId } as never)
        : await supabase.rpc('analyze_contact_lists' as never, args as never);
      if (error) throw error;
      const a = (an ?? {}) as unknown as ContactAnalysis;
      setAnalysis(a);
      // Pré-cochées : toutes les propositions pas encore créées.
      setSelected(new Set((a.suggestions || []).filter((s) => !s.existing_id).map((s) => s.key)));
      // La valeur Yuno du panier, une fois par portée.
      if (!listImportId) {
        const bs = await loadBasketSuggestion(args);
        setBasketSuggestion(bs);
        setBasketThreshold((cur) => cur ?? bs.threshold);
      }
    } catch (e) {
      setAnalysisError(errMsg(e));
      setAnalysis(null);
    } finally {
      setAnalyzing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, listImportId]);

  const started = useRef('');
  useEffect(() => {
    if (started.current === `${scopeKey}|${listImportId ?? ''}`) return;
    started.current = `${scopeKey}|${listImportId ?? ''}`;
    void (async () => {
      const ov = await loadOverview();
      if (!ov || (ov.contacts || 0) === 0) return;
      // Yuno ne cherche de nouveaux segments tout seul que là où il n'y a rien
      // d'autre à montrer : le fichier qu'on vient d'importer, ou une portée
      // qui n'a encore aucun segment.
      if (listImportId || (ov.segments || []).length === 0) await runAnalysis();
    })();
  }, [scopeKey, listImportId, loadOverview, runAnalysis]);

  useEffect(() => {
    const h = setTimeout(() => setBasketDebounced(basketThreshold), 350);
    return () => clearTimeout(h);
  }, [basketThreshold]);

  // Les segments Yuno (prend des tables, panier moyen élevé, vus depuis peu,
  // habitués qui décrochent) s'ajoutent aux propositions de l'analyseur, qui
  // les tait sous 10 personnes ou 30 % de couverture. Portée entière
  // seulement : sur l'analyse d'UN fichier, un effectif calculé sur toute la
  // base serait un mensonge. Recomptés quand le seuil du panier change.
  useEffect(() => {
    if (listImportId || !analysis || basketDebounced == null) { setPresets([]); return; }
    let cancelled = false;
    loadYunoPresetSuggestions(scopeArgs(scopeRef.current), segments, analysis.contacts || 0, { basketThreshold: basketDebounced })
      .then((rows) => {
        if (cancelled) return;
        setPresets(rows);
        // Un préréglage neuf arrive pré-coché, comme une proposition.
        setSelected((prev) => {
          const n = new Set(prev);
          for (const r of rows) if (!r.existing_id && suggestionBase(r.key) !== BASKET_PRESET_BASE) n.add(r.key);
          return n;
        });
      });
    return () => { cancelled = true; };
  }, [listImportId, analysis, segments, basketDebounced, scopeKey]);

  const toggle = (key: string) => setSelected((prev) => {
    const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n;
  });

  // Propositions de l'analyseur ∪ préréglages Yuno. Le panier de l'analyseur
  // (seuil fixe à 60 €) s'efface derrière le préréglage, qui porte le seuil
  // réglable — deux lignes « Panier moyen élevé » seraient une énigme.
  const suggestions = useMemo(() => {
    const base = analysis?.suggestions || [];
    if (presets.length === 0) return base;
    const known = new Set(presets.map((s) => s.key));
    const hasBasket = presets.some((s) => suggestionBase(s.key) === BASKET_PRESET_BASE);
    return [
      ...base.filter((s) => !known.has(s.key) && !(hasBasket && suggestionBase(s.key) === BASKET_PRESET_BASE)),
      ...presets,
    ];
  }, [analysis, presets]);
  const pending = suggestions.filter((s) => !s.existing_id);
  const selectable = pending.map((s) => s.key);

  const save = useCallback(async () => {
    if (selected.size === 0) return;
    if (isPreviewActive()) { toast.error(t('smsc.previewReadOnly')); return; }
    setSaving(true);
    try {
      const payload = suggestions.filter((s) => selected.has(s.key)).map((s) => {
        const d = describeSuggestion(s, t, language);
        return { key: s.key, name: d.name, description: d.why, definition: s.definition };
      });
      const { data, error } = await supabase.rpc('save_contact_segments' as never, {
        ...scopeArgs(scopeRef.current), p_segments: payload as unknown as Json, p_list_import_id: listImportId,
      } as never);
      if (error) throw error;
      const rows = ((data as unknown) as Array<{ key: string | null; id: string }> | null) || [];
      setCreatedCount(rows.length);
      // Les propositions retenues passent en « Déjà créé » avec l'id rendu par
      // la RPC : relancer l'analyse entière pour retrouver cette information
      // ferait repayer plusieurs secondes pour rien.
      const ids = new Map(rows.filter((r) => r.key).map((r) => [r.key as string, r.id]));
      const mark = (list: SegmentSuggestion[]) => list.map((s) => (ids.has(s.key) ? { ...s, existing_id: ids.get(s.key) as string } : s));
      setAnalysis((a) => (a ? { ...a, suggestions: mark(a.suggestions || []) } : a));
      setPresets(mark);
      setSelected(new Set());
      onChanged?.();
      toast.success(t('cseg.created').replace('{n}', String(rows.length)));
      await loadOverview();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  }, [selected, suggestions, listImportId, onChanged, loadOverview, t, language]);

  const remove = useCallback(async (seg: ContactSegment) => {
    if (isPreviewActive()) { toast.error(t('smsc.previewReadOnly')); return; }
    const { error } = await supabase.from('contact_segments' as never).delete().eq('id', seg.id);
    if (error) { toast.error(error.message); return; }
    toast.success(t('cseg.deleted'));
    onChanged?.();
    await loadOverview();
  }, [loadOverview, onChanged, t]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-[13px] opacity-70">
        <Loader2 className="h-4 w-4 animate-spin" />{t('cseg.loading')}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg p-3 text-[12.5px]" style={{ background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.3)' }}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: '#E8192C' }} />
          <div>
            <div className="font-semibold">{t('cseg.loadError')}</div>
            <div className="mt-0.5 font-mono text-[11px] opacity-70">{loadError}</div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onDone}>{t('common.close')}</Button>
          <Button onClick={() => void loadOverview()}><RefreshCw className="mr-2 h-4 w-4" />{t('cseg.retry')}</Button>
        </div>
      </div>
    );
  }

  if (!overview || (overview.contacts || 0) === 0) {
    return (
      <div className="space-y-4">
        <p className="text-[13px] opacity-75">{t('cseg.noLists')}</p>
        <div className="flex justify-end"><Button onClick={onDone}>{t('common.close')}</Button></div>
      </div>
    );
  }

  // Les faits : ceux de l'analyse quand elle a tourné, ceux de la vue
  // d'ensemble sinon — la base, les canaux, l'origine et l'engagement sont
  // connus sans relire toute la base.
  const f = analysis?.facts;
  const homeN = f?.top_countries?.[0]?.n ?? 0;
  const contactsTotal = analysis?.contacts ?? overview.contacts ?? 0;
  const listsCount = analysis?.lists ?? (overview.lists || []).length;
  const reachE = f?.channels?.emails_reachable ?? overview.reachable_emails ?? 0;
  const reachP = f?.channels?.phones_reachable ?? overview.reachable_phones ?? 0;
  const origin = f?.origin ?? overview.origin ?? null;
  const eng = f?.engagement ?? overview.engagement ?? null;
  const engCampaigns = f?.engagement?.campaigns ?? null;

  return (
    <div className="space-y-5">
      {/* Ce que la dernière campagne a fait à la base */}
      {impacts.length > 0 && (
        <div className="space-y-2">
          <CampaignImpactCard impact={impacts[0]} basePath={basePath || ''} compact />
          {basePath && (
            <button type="button" onClick={() => { onDone(); navigate(`${basePath}/contacts`); }}
              className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: '#E8192C' }}>
              {t('cimpact.seeBase')} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
      {impacts.length === 0 && basePath && (
        <button type="button" onClick={() => { onDone(); navigate(`${basePath}/contacts`); }}
          className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: '#E8192C' }}>
          {t('cimpact.seeBase')} <ArrowRight className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Ce que Yuno a lu */}
      <div className="rounded-lg border p-3 text-[12.5px]" style={{ borderColor: 'rgb(var(--ink)/0.1)' }}>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide opacity-55">{t('cseg.facts.title')}</div>
        <div className="space-y-1 opacity-85">
          <div>{t('cseg.facts.base').replace('{n}', nf(contactsTotal)).replace('{lists}', String(listsCount))}</div>
          <div>{t('cseg.facts.channels').replace('{e}', nf(reachE)).replace('{p}', nf(reachP))}</div>
          {origin && (origin.yuno + origin.both) > 0 && (
            <div>{t('cseg.facts.origin').replace('{yuno}', nf(origin.yuno + origin.both)).replace('{both}', nf(origin.both)).replace('{acc}', nf(origin.with_account))}</div>
          )}
          {eng && eng.sent_any > 0 && (
            <div>{(engCampaigns != null
              ? t('cseg.facts.engagement').replace('{c}', String(engCampaigns))
              : t('cseg.facts.engagementSent'))
              .replace('{sent}', nf(eng.sent_any)).replace('{active}', nf(eng.active)).replace('{passive}', nf(eng.passive))
              .replace('{silent}', nf(eng.silent)).replace('{unsub}', nf(eng.unsubscribed)).replace('{dead}', nf(eng.unreachable))}</div>
          )}
          {analysis?.home_country && homeN > 0 && (
            <div>{t('cseg.facts.home').replace('{country}', countryName(analysis.home_country, language)).replace('{pct}', String(Math.round((homeN / Math.max(1, contactsTotal)) * 100)))}</div>
          )}
          {f?.top_zones && f.top_zones.length > 0 && (
            <div>{t('cseg.facts.zones').replace('{list}', f.top_zones.slice(0, 4).map((z) => `${z.value} (${nf(z.n)})`).join(' · '))}</div>
          )}
          {f?.spend && (f.spend.paid > 0 || f.spend.zero > 0) && (
            <div>{t('cseg.facts.spend').replace('{paid}', nf(f.spend.paid)).replace('{median}', nf(f.spend.median_paid)).replace('{zero}', nf(f.spend.zero))}</div>
          )}
          {f?.events && (f.events.one + f.events.two_three + f.events.four_plus) > 0 && (
            <div>{t('cseg.facts.events').replace('{one}', nf(f.events.one)).replace('{two}', nf(f.events.two_three)).replace('{four}', nf(f.events.four_plus))}</div>
          )}
          {f?.recency && (f.recency.d90 + f.recency.d365 + f.recency.older) > 0 && (
            <div>{t('cseg.facts.recency').replace('{d90}', nf(f.recency.d90)).replace('{d365}', nf(f.recency.d365)).replace('{older}', nf(f.recency.older))}</div>
          )}
        </div>
      </div>

      {/* Vos segments, dans leur état du moment */}
      {segments.length > 0 && (
        <div>
          <div className="mb-1.5 text-[13px] font-semibold">{t('cseg.existingTitle')} <span className="opacity-50">· {segments.length}</span></div>
          <p className="mb-2 text-[11.5px] leading-relaxed opacity-60">{t('cseg.existingLive')}</p>
          <ul className="divide-y rounded-lg border" style={{ borderColor: 'rgb(var(--ink)/0.1)' }}>
            {segments.map((seg) => (
              <li key={seg.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px]" style={{ borderColor: 'rgb(var(--ink)/0.06)' }}>
                <div className="min-w-0">
                  <div className="truncate font-medium">{seg.name}</div>
                  <div className="text-[11px] opacity-55">{t('cseg.reach').replace('{e}', nf(seg.counts.emails)).replace('{p}', nf(seg.counts.phones))}</div>
                </div>
                <button type="button" className="shrink-0 opacity-50 hover:opacity-100" aria-label={t('cseg.delete')} onClick={() => remove(seg)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Propositions — seulement quand l'analyseur a tourné */}
      {analysis && (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[13px] font-semibold">{t('cseg.title')}</div>
            {pending.length > 0 && (
              <div className="flex gap-3 text-[11.5px]">
                <button type="button" className="opacity-60 hover:opacity-100" onClick={() => setSelected(new Set(selectable))}>{t('cseg.selectAll')}</button>
                <button type="button" className="opacity-60 hover:opacity-100" onClick={() => setSelected(new Set())}>{t('cseg.selectNone')}</button>
              </div>
            )}
          </div>
          <p className="mb-3 text-[12px] leading-relaxed opacity-70">
            {suggestions.length === 0
              ? t('cseg.introEmpty')
              : t('cseg.intro').replace('{n}', nf(contactsTotal)).replace('{lists}', String(listsCount)).replace('{k}', String(suggestions.length))}
          </p>

          {SEGMENT_GROUPS.map((g) => {
            const items = suggestions.filter((s) => s.group === g);
            if (items.length === 0) return null;
            const Icon = GROUP_ICON[g];
            return (
              <div key={g} className="mb-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide opacity-55">
                  <Icon className="h-3.5 w-3.5" />{t(`cseg.g.${g}`)}
                </div>
                <div className="space-y-1.5">
                  {items.map((s) => (
                    <div key={s.key}>
                      <SuggestionRow s={s} on={selected.has(s.key)} onToggle={() => toggle(s.key)} t={t} language={language} />
                      {suggestionBase(s.key) === BASKET_PRESET_BASE && basketThreshold != null && !s.existing_id && (
                        <BasketThresholdField compact value={basketThreshold} onChange={setBasketThreshold} suggestion={basketSuggestion} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Chercher de NOUVEAUX segments : à la demande, jamais à l'ouverture
          d'une base qui a déjà les siens. */}
      {!analysis && (
        <div className="rounded-lg p-3" style={{ background: 'rgba(232,25,44,0.07)', border: '1px solid rgba(232,25,44,0.25)' }}>
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <Sparkles className="h-4 w-4" style={{ color: '#E8192C' }} />{t('cseg.look.title')}
          </div>
          <p className="mt-1 text-[12px] leading-relaxed opacity-75">{t('cseg.look.body')}</p>
          {analysisError && <div className="mt-1.5 font-mono text-[11px]" style={{ color: 'var(--acc-fca5a5)' }}>{analysisError}</div>}
          <Button className="mt-2.5" size="sm" onClick={() => void runAnalysis()} disabled={analyzing}>
            {analyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {analyzing ? t('cimp.analyzing') : t('cseg.look.cta')}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {analysis ? (
          <button type="button" className="inline-flex items-center gap-1.5 text-[12px] opacity-60 hover:opacity-100 disabled:opacity-30"
            disabled={analyzing} onClick={() => void runAnalysis()}>
            {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}{t('cseg.rerun')}
          </button>
        ) : <span />}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onDone}>{createdCount != null ? t('common.close') : t('cseg.skip')}</Button>
          {pending.length > 0 && (
            <Button onClick={save} disabled={saving || selected.size === 0}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              {saving ? t('cseg.creating') : t('cseg.create').replace('{n}', String(selected.size))}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function SuggestionRow({ s, on, onToggle, t, language }: {
  s: SegmentSuggestion; on: boolean; onToggle: () => void; t: (k: string) => string; language: string;
}) {
  const d = describeSuggestion(s, t, language);
  const nf = (n: number) => n.toLocaleString(language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR');
  const already = !!s.existing_id;
  return (
    <div
      role={already ? undefined : 'button'}
      onClick={already ? undefined : onToggle}
      className="flex items-start gap-3 rounded-lg border p-2.5 text-left"
      style={{
        cursor: already ? 'default' : 'pointer',
        borderColor: on ? 'rgba(232,25,44,0.35)' : 'rgb(var(--ink)/0.1)',
        background: on ? 'rgba(232,25,44,0.06)' : 'transparent',
        opacity: already ? 0.6 : 1,
      }}
    >
      <div className="mt-0.5">
        {already
          ? <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--acc-34d399)' }} />
          : <Checkbox checked={on} onCheckedChange={onToggle} onClick={(e) => e.stopPropagation()} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="text-[13px] font-semibold">{d.name}</span>
          <span className="text-[11.5px] tabular-nums opacity-70">
            {t('cseg.contacts').replace('{n}', nf(s.contacts))} · {t('cseg.share').replace('{pct}', String(Math.round(s.share * 100)))}
          </span>
        </div>
        <div className="mt-0.5 text-[11px] tabular-nums opacity-55">
          {already ? `${t('cseg.already')} · ` : ''}{t('cseg.reach').replace('{e}', nf(s.emails)).replace('{p}', nf(s.phones))}
        </div>
        {d.why && <p className="mt-1 text-[11.5px] leading-relaxed opacity-70">{d.why}</p>}
      </div>
    </div>
  );
}

