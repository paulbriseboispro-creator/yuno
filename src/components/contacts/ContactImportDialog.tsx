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
  SEGMENT_GROUPS, countryName, describeSuggestion,
  type ContactAnalysis, type ContactIntelligenceOverview, type ContactSegment, type SegmentGroup, type SegmentSuggestion,
} from '@/lib/contactSegments';

export type ImportScope =
  | { kind: 'venue'; venueId: string }
  | { kind: 'organizer'; organizerId: string };

interface Props {
  open: boolean;
  onClose: () => void;
  scope: ImportScope;
  mode?: 'import' | 'analyze';
  /** Appelé après un import réussi ET après la création de segments. */
  onChanged?: () => void;
}

interface ImportTotals {
  submitted: number; rows: number; invalid: number; duplicates: number;
  emailsAdded: number; emailsUnchanged: number; emailsSuppressed: number;
  phonesAdded: number; phonesUnchanged: number; phonesSuppressed: number;
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
  return {
    p_venue_id: scope.kind === 'venue' ? scope.venueId : null,
    p_organizer_user_id: scope.kind === 'organizer' ? scope.organizerId : null,
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message
    : (e && typeof e === 'object' && 'message' in e) ? String((e as { message: unknown }).message) : String(e);
}

export default function ContactImportDialog({ open, onClose, scope, mode = 'import', onChanged }: Props) {
  const { t, language } = useLanguage();
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
  const [phase, setPhase] = useState<'form' | 'report' | 'segments'>('form');

  const country = IMPORT_COUNTRIES.find((c) => c.code === countryCode) ?? IMPORT_COUNTRIES[0];
  const parsed: ContactParseResult | null = useMemo(() => (raw.trim() ? parseContactFile(raw, country) : null), [raw, country]);

  const reset = useCallback(() => {
    setRaw(''); setFilename(null); setListName(''); setWantEmail(true); setWantSms(true);
    setConsentSource(''); setConsentDetails(''); setCollectedSince(''); setAttested(false);
    setBusy(false); setProgress(0); setTotals(null); setListImportId(null); setPhase('form');
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

  const runImport = useCallback(async () => {
    if (!parsed || !canImport) return;
    if (isPreviewActive()) { toast.error(t('smsc.previewReadOnly')); return; }
    setBusy(true); setProgress(0);
    const chunks = chunkRows(parsed.rows, CHUNK);
    const tot: ImportTotals = {
      submitted: 0, rows: 0, invalid: parsed.invalid.length, duplicates: parsed.duplicates,
      emailsAdded: 0, emailsUnchanged: 0, emailsSuppressed: 0, phonesAdded: 0, phonesUnchanged: 0, phonesSuppressed: 0,
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
        setProgress(Math.round(((i + 1) / chunks.length) * 100));
      }
      setTotals(tot);
      setListImportId(importId);
      setPhase('report');
      onChanged?.();
      toast.success(t('cimp.done').replace('{n}', String(tot.rows)));
    } catch (e) {
      const msg = errMsg(e);
      toast.error(msg.includes('support') ? t('em.import.errSupport') : msg);
    } finally {
      setBusy(false);
    }
  }, [parsed, canImport, consentSource, scope, filename, listName, consentDetails, collectedSince, country.code, wantEmail, wantSms, onChanged, t]);

  const isAnalyze = phase === 'segments';

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
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
              <div className="space-y-2.5 rounded-lg border p-3 text-[12.5px]" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-semibold">{t('cimp.readTitle').replace('{n}', String(parsed.rows.length))}</span>
                  <span className="opacity-70">{t('cimp.readEmails').replace('{n}', String(parsed.stats.emails))}</span>
                  <span className="opacity-70">{t('cimp.readPhones').replace('{n}', String(parsed.stats.phones))}</span>
                  {parsed.stats.both > 0 && <span className="opacity-50">{t('cimp.readBoth').replace('{n}', String(parsed.stats.both))}</span>}
                  {parsed.duplicates > 0 && <span className="opacity-50">{parsed.duplicates} {t('em.import.dupes')}</span>}
                  {parsed.invalid.length > 0 && (
                    <span className="inline-flex items-center gap-1" style={{ color: '#FCD34D' }}>
                      <AlertTriangle className="h-3.5 w-3.5" />{parsed.invalid.length} {t('em.import.unreadable')}
                    </span>
                  )}
                </div>
                {Object.keys(parsed.detected).length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="opacity-55">{t('cimp.detected')}</span>
                    {(Object.keys(parsed.detected) as ContactField[]).map((f) => (
                      <span key={f} className="rounded-full px-2 py-0.5 text-[11px]"
                        style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)', color: '#A7F3D0' }}>
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
              <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
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
                  <p className="text-[11px]" style={{ color: '#FCD34D' }}>{t('cimp.chNone')}</p>
                )}
              </div>
            )}

            {/* ── 2. L'attestation ──────────────────────────────────────── */}
            {parsed && parsed.rows.length > 0 && (
              <div className="space-y-3 rounded-lg border p-3" style={{ borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)' }}>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" style={{ color: '#34D399' }} />
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
                 style={{ background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.2)', color: 'rgba(255,255,255,0.7)' }}>
                {t('cimp.afterNotice')}
              </p>
            )}

            {busy && (
              <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                <div className="h-full transition-all" style={{ width: `${progress}%`, background: '#E8192C' }} />
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close} disabled={busy}>{t('common.cancel')}</Button>
              <Button onClick={runImport} disabled={!canImport}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {busy ? t('cimp.importing') : t('cimp.cta').replace('{n}', String(parsed?.rows.length ?? 0))}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
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
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <CheckCircle2 className="h-5 w-5" style={{ color: '#34D399' }} />
        <span className="text-[15px] font-semibold">{t('cimp.rep.title')}</span>
      </div>
      <div className="space-y-1.5 rounded-lg border p-3 text-[12.5px]" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
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
};

export function SegmentProposals({ scope, listImportId, onChanged, onDone }: {
  scope: ImportScope; listImportId: string | null; onChanged?: () => void; onDone: () => void;
}) {
  const { t, language } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState<ContactAnalysis | null>(null);
  const [segments, setSegments] = useState<ContactSegment[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [createdCount, setCreatedCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const nf = (n: number) => n.toLocaleString(language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data: ov, error: e1 } = await supabase.rpc('get_contact_intelligence_overview' as never, scopeArgs(scope) as never);
      if (e1) throw e1;
      const overview = (ov ?? {}) as unknown as ContactIntelligenceOverview;
      setSegments(overview.segments || []);
      if ((overview.contacts || 0) === 0) { setAnalysis({ generated_at: '', contacts: 0, lists: 0, suggestions: [] }); return; }
      const { data: an, error: e2 } = listImportId
        ? await supabase.rpc('analyze_contact_list_import' as never, { p_list_import_id: listImportId } as never)
        : await supabase.rpc('analyze_contact_lists' as never, scopeArgs(scope) as never);
      if (e2) throw e2;
      const a = (an ?? {}) as unknown as ContactAnalysis;
      setAnalysis(a);
      // Pré-cochées : toutes les propositions pas encore créées.
      setSelected(new Set((a.suggestions || []).filter((s) => !s.existing_id).map((s) => s.key)));
    } catch (e) {
      // Une erreur n'est PAS « base vide » : on la montre telle quelle, avec
      // un bouton pour réessayer — jamais l'écran « importez d'abord ».
      setLoadError(errMsg(e));
      setAnalysis(null);
    } finally {
      setLoading(false);
    }
  }, [scope, listImportId]);

  useEffect(() => { void load(); }, [load]);

  const toggle = (key: string) => setSelected((prev) => {
    const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n;
  });

  const suggestions = useMemo(() => analysis?.suggestions || [], [analysis]);
  const pending = suggestions.filter((s) => !s.existing_id);
  const selectable = pending.map((s) => s.key);

  const save = useCallback(async () => {
    if (!analysis || selected.size === 0) return;
    if (isPreviewActive()) { toast.error(t('smsc.previewReadOnly')); return; }
    setSaving(true);
    try {
      const payload = suggestions.filter((s) => selected.has(s.key)).map((s) => {
        const d = describeSuggestion(s, t, language);
        return { key: s.key, name: d.name, description: d.why, definition: s.definition };
      });
      const { data, error } = await supabase.rpc('save_contact_segments' as never, {
        ...scopeArgs(scope), p_segments: payload as unknown as Json, p_list_import_id: listImportId,
      } as never);
      if (error) throw error;
      const created = ((data as unknown) as unknown[] | null)?.length ?? 0;
      setCreatedCount(created);
      onChanged?.();
      toast.success(t('cseg.created').replace('{n}', String(created)));
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  }, [analysis, selected, suggestions, scope, listImportId, onChanged, load, t, language]);

  const remove = useCallback(async (seg: ContactSegment) => {
    if (isPreviewActive()) { toast.error(t('smsc.previewReadOnly')); return; }
    const { error } = await supabase.from('contact_segments' as never).delete().eq('id', seg.id);
    if (error) { toast.error(error.message); return; }
    toast.success(t('cseg.deleted'));
    onChanged?.();
    await load();
  }, [load, onChanged, t]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-[13px] opacity-70">
        <Loader2 className="h-4 w-4 animate-spin" />{t('cimp.analyzing')}
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
          <Button onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />{t('cseg.rerun')}</Button>
        </div>
      </div>
    );
  }

  if (!analysis || analysis.contacts === 0) {
    return (
      <div className="space-y-4">
        <p className="text-[13px] opacity-75">{t('cseg.noLists')}</p>
        <div className="flex justify-end"><Button onClick={onDone}>{t('common.close')}</Button></div>
      </div>
    );
  }

  const f = analysis.facts;
  const homeN = f?.top_countries?.[0]?.n ?? 0;

  return (
    <div className="space-y-5">
      {/* Ce que Yuno a lu */}
      <div className="rounded-lg border p-3 text-[12.5px]" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide opacity-55">{t('cseg.facts.title')}</div>
        <div className="space-y-1 opacity-85">
          <div>{t('cseg.facts.base').replace('{n}', nf(analysis.contacts)).replace('{lists}', String(analysis.lists))}</div>
          {f?.channels && (
            <div>{t('cseg.facts.channels').replace('{e}', nf(f.channels.emails_reachable)).replace('{p}', nf(f.channels.phones_reachable))}</div>
          )}
          {analysis.home_country && homeN > 0 && (
            <div>{t('cseg.facts.home').replace('{country}', countryName(analysis.home_country, language)).replace('{pct}', String(Math.round((homeN / analysis.contacts) * 100)))}</div>
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

      {/* Propositions */}
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
            : t('cseg.intro').replace('{n}', nf(analysis.contacts)).replace('{lists}', String(analysis.lists)).replace('{k}', String(suggestions.length))}
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
                {items.map((s) => <SuggestionRow key={s.key} s={s} on={selected.has(s.key)} onToggle={() => toggle(s.key)} t={t} language={language} />)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Segments existants */}
      {segments.length > 0 && (
        <div>
          <div className="mb-1.5 text-[13px] font-semibold">{t('cseg.existingTitle')} <span className="opacity-50">· {segments.length}</span></div>
          <ul className="divide-y rounded-lg border" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
            {segments.map((seg) => (
              <li key={seg.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px]" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="inline-flex items-center gap-1.5 text-[12px] opacity-60 hover:opacity-100" onClick={() => void load()}>
          <RefreshCw className="h-3.5 w-3.5" />{t('cseg.rerun')}
        </button>
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
        borderColor: on ? 'rgba(232,25,44,0.35)' : 'rgba(255,255,255,0.1)',
        background: on ? 'rgba(232,25,44,0.06)' : 'transparent',
        opacity: already ? 0.6 : 1,
      }}
    >
      <div className="mt-0.5">
        {already
          ? <CheckCircle2 className="h-4 w-4" style={{ color: '#34D399' }} />
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

