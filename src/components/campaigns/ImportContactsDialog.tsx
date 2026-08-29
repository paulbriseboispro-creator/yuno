// Import d'une base email existante.
//
// Le pro qui arrive avec 5 000 adresses collectées ailleurs ne pouvait rien
// envoyer depuis Yuno : les audiences promotionnelles exigent un opt-in, et
// rien n'alimentait cette table hors achat de billet. Ce dialogue est la porte
// d'entrée — et c'est aussi une porte de CONFORMITÉ : on ne prend pas un
// fichier sans savoir d'où vient le consentement.
//
// Trois écrans, dans l'ordre où le pro pense :
//   1. « voilà mon fichier »   → lecture + rapport de lecture immédiat
//   2. « d'où vient ma liste » → attestation, obligatoire, horodatée
//   3. « voilà ce que ça donne » → rapport d'import honnête, y compris ce
//      qu'on a REFUSÉ (désabonnés respectés, adresses supprimées)
//
// Toute la validation est refaite côté serveur par `import_email_contacts` :
// ici c'est du confort, pas de la sécurité.

import { useCallback, useMemo, useRef, useState } from 'react';
import { Upload, FileText, CheckCircle2, AlertTriangle, Loader2, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { parseContactList, chunkContacts, type ParseResult, type ConsentSource } from '@/lib/emailImport';

export type ImportScope =
  | { kind: 'venue'; venueId: string }
  | { kind: 'organizer'; organizerId: string };

interface Props {
  open: boolean;
  onClose: () => void;
  scope: ImportScope;
  onImported?: (summary: ImportSummary) => void;
}

export interface ImportSummary {
  submitted: number;
  inserted: number;
  reactivated: number;
  duplicates: number;
  invalid: number;
  suppressed: number;
  unchanged: number;
}

const CONSENT_OPTIONS: Array<{ value: ConsentSource; labelKey: string }> = [
  { value: 'in_person',    labelKey: 'em.import.src.inPerson' },
  { value: 'website_form', labelKey: 'em.import.src.websiteForm' },
  { value: 'ticketing',    labelKey: 'em.import.src.ticketing' },
  { value: 'social',       labelKey: 'em.import.src.social' },
  { value: 'other_tool',   labelKey: 'em.import.src.otherTool' },
  { value: 'other',        labelKey: 'em.import.src.other' },
];

// La RPC plafonne à 2 000 par appel ; on envoie par 1 000 pour garder une barre
// de progression qui bouge vraiment sur un gros fichier.
const CHUNK = 1000;

export default function ImportContactsDialog({ open, onClose, scope, onImported }: Props) {
  const { t } = useLanguage();
  const fileRef = useRef<HTMLInputElement>(null);

  const [raw, setRaw] = useState('');
  const [filename, setFilename] = useState<string | null>(null);
  const [consentSource, setConsentSource] = useState<ConsentSource | ''>('');
  const [consentDetails, setConsentDetails] = useState('');
  const [collectedSince, setCollectedSince] = useState('');
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const parsed: ParseResult | null = useMemo(
    () => (raw.trim() ? parseContactList(raw) : null),
    [raw],
  );

  const reset = useCallback(() => {
    setRaw(''); setFilename(null); setConsentSource(''); setConsentDetails('');
    setCollectedSince(''); setAttested(false); setBusy(false); setProgress(0); setSummary(null);
  }, []);

  const close = useCallback(() => { if (!busy) { reset(); onClose(); } }, [busy, reset, onClose]);

  const onFile = useCallback(async (file: File) => {
    // 15 Mo couvre très largement 100 000 contacts ; au-delà c'est un mauvais
    // fichier (un export complet de CRM, pas une liste de diffusion).
    if (file.size > 15 * 1024 * 1024) {
      toast.error(t('em.import.tooBig'));
      return;
    }
    const text = await file.text();
    setFilename(file.name);
    setRaw(text);
  }, [t]);

  const canImport = !!parsed && parsed.contacts.length > 0 && !!consentSource && attested && !busy;

  const runImport = useCallback(async () => {
    if (!parsed || !canImport) return;
    setBusy(true);
    setProgress(0);

    const chunks = chunkContacts(parsed.contacts, CHUNK);
    const totals: ImportSummary = {
      submitted: 0, inserted: 0, reactivated: 0,
      duplicates: parsed.duplicates, invalid: parsed.invalid.length,
      suppressed: 0, unchanged: 0,
    };
    let importId: string | null = null;

    try {
      for (let i = 0; i < chunks.length; i++) {
        // Cast : la RPC vient d'être créée, `types.ts` sera régénéré après le
        // `supabase db push` (convention déjà en place dans le repo).
        const { data, error } = await (supabase as unknown as {
          rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
        }).rpc('import_email_contacts', {
          p_contacts: chunks[i],
          p_consent_source: consentSource,
          p_venue_id: scope.kind === 'venue' ? scope.venueId : null,
          p_organizer_user_id: scope.kind === 'organizer' ? scope.organizerId : null,
          p_filename: filename,
          p_consent_details: consentDetails || null,
          p_collected_since: collectedSince || null,
          // Les lots suivants se rattachent à la MÊME ligne d'import : un
          // fichier = une attestation, pas cinq.
          p_import_id: importId,
        });
        if (error) throw error;

        const r = (data ?? {}) as unknown as Record<string, number | string>;
        importId = (r.import_id as string) ?? importId;
        totals.submitted += Number(r.submitted || 0);
        totals.inserted += Number(r.inserted || 0);
        totals.reactivated += Number(r.reactivated || 0);
        totals.suppressed += Number(r.suppressed || 0);
        totals.unchanged += Number(r.unchanged || 0);
        setProgress(Math.round(((i + 1) / chunks.length) * 100));
      }

      setSummary(totals);
      onImported?.(totals);
      toast.success(t('em.import.done').replace('{n}', String(totals.inserted + totals.reactivated)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg.includes('support') ? t('em.import.errSupport') : msg);
    } finally {
      setBusy(false);
    }
  }, [parsed, canImport, consentSource, scope, filename, consentDetails, collectedSince, onImported, t]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('em.import.title')}</DialogTitle>
          <DialogDescription>{t('em.import.subtitle')}</DialogDescription>
        </DialogHeader>

        {summary ? (
          <ImportReport summary={summary} onDone={close} t={t} />
        ) : (
          <div className="space-y-5">
            {/* ── 1. Le fichier ─────────────────────────────────────────── */}
            <div>
              <Label className="text-[13px]">{t('em.import.step1')}</Label>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/plain"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
              />
              <div className="mt-2 flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
                  <Upload className="mr-2 h-4 w-4" />
                  {t('em.import.chooseFile')}
                </Button>
                {filename && (
                  <span className="inline-flex items-center gap-1.5 text-[12px] opacity-70">
                    <FileText className="h-3.5 w-3.5" /> {filename}
                    <button type="button" onClick={reset} className="opacity-60 hover:opacity-100" aria-label={t('common.remove')}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </div>
              <Textarea
                className="mt-2 min-h-[90px] font-mono text-[12px]"
                placeholder={t('em.import.pastePlaceholder')}
                value={filename ? '' : raw}
                disabled={busy || !!filename}
                onChange={(e) => setRaw(e.target.value)}
              />
            </div>

            {/* ── Rapport de lecture ────────────────────────────────────── */}
            {parsed && (
              <div className="rounded-lg border p-3 text-[12.5px]" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-semibold">{parsed.contacts.length} {t('em.import.validAddresses')}</span>
                  {parsed.duplicates > 0 && <span className="opacity-60">{parsed.duplicates} {t('em.import.dupes')}</span>}
                  {parsed.invalid.length > 0 && (
                    <span className="inline-flex items-center gap-1" style={{ color: '#FCD34D' }}>
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {parsed.invalid.length} {t('em.import.unreadable')}
                    </span>
                  )}
                </div>
                {(parsed.detected.email || parsed.detected.firstName || parsed.detected.fullName) && (
                  <p className="mt-1.5 opacity-55">
                    {t('em.import.detected')} {[parsed.detected.email, parsed.detected.firstName, parsed.detected.lastName, parsed.detected.fullName].filter(Boolean).join(' · ')}
                  </p>
                )}
                {parsed.invalid.length > 0 && (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer opacity-55">{t('em.import.showRejected')}</summary>
                    <ul className="mt-1 max-h-24 overflow-y-auto font-mono text-[11px] opacity-70">
                      {parsed.invalid.slice(0, 20).map((l, i) => <li key={i}>{l}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            )}

            {/* ── 2. L'attestation ──────────────────────────────────────── */}
            {parsed && parsed.contacts.length > 0 && (
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
                      {CONSENT_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{t(o.labelKey)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-[12px]">{t('em.import.collectedSince')}</Label>
                  <Input
                    type="date" className="mt-1" value={collectedSince} disabled={busy}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setCollectedSince(e.target.value)}
                  />
                  <p className="mt-1 text-[11px] opacity-50">{t('em.import.collectedSinceHint')}</p>
                </div>

                <div>
                  <Label className="text-[12px]">{t('em.import.consentDetails')}</Label>
                  <Textarea
                    className="mt-1 min-h-[54px] text-[12.5px]" value={consentDetails} disabled={busy}
                    placeholder={t('em.import.consentDetailsPlaceholder')}
                    onChange={(e) => setConsentDetails(e.target.value.slice(0, 500))}
                  />
                </div>

                <label className="flex cursor-pointer items-start gap-2.5">
                  <Checkbox checked={attested} onCheckedChange={(v) => setAttested(v === true)} disabled={busy} className="mt-0.5" />
                  <span className="text-[12px] leading-snug opacity-85">{t('em.import.attestation')}</span>
                </label>
              </div>
            )}

            {/* ── Ce qui va se passer ensuite ───────────────────────────── */}
            {parsed && parsed.contacts.length > 0 && (
              <p className="rounded-lg p-2.5 text-[11.5px] leading-relaxed"
                 style={{ background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.2)', color: 'rgba(255,255,255,0.7)' }}>
                {t('em.import.warmupNotice')}
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
                {busy
                  ? t('em.import.importing')
                  : t('em.import.cta').replace('{n}', String(parsed?.contacts.length ?? 0))}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Un rapport honnête : on montre AUSSI ce qu'on a refusé. Un pro qui voit
// « 4 812 sur 5 000 » et comprend pourquoi ne rappelle pas le support.
function ImportReport({ summary, onDone, t }: { summary: ImportSummary; onDone: () => void; t: (k: string) => string }) {
  const added = summary.inserted + summary.reactivated;
  const rows: Array<[string, number, string?]> = [
    [t('em.import.rep.added'), added],
    [t('em.import.rep.already'), summary.unchanged],
    [t('em.import.rep.dupes'), summary.duplicates],
    [t('em.import.rep.invalid'), summary.invalid],
    [t('em.import.rep.suppressed'), summary.suppressed, t('em.import.rep.suppressedWhy')],
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <CheckCircle2 className="h-5 w-5" style={{ color: '#34D399' }} />
        <span className="text-[15px] font-semibold">{added} {t('em.import.rep.title')}</span>
      </div>
      <div className="space-y-1.5 rounded-lg border p-3 text-[12.5px]" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
        {rows.map(([label, n, why]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <span className="opacity-65">{label}{why && n > 0 ? ` — ${why}` : ''}</span>
            <span className="font-semibold tabular-nums">{n}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <Button onClick={onDone}>{t('common.close')}</Button>
      </div>
    </div>
  );
}
