import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { Check, Copy, Landmark, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  djSetReference, formatIban, isValidIban, normalizeIban, performerName,
  type DjSetPaymentMethod,
} from '@/lib/djPayout';

// ─── Yuno pro tokens ─────────────────────────────────────────────────────────
const RED = '#E8192C';
const POS = 'var(--acc-34d399)';
const WARN = 'var(--acc-fcd34d)';
const T1 = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T2 = 'rgb(var(--ink)/var(--ink-a58,0.58))';
const T3 = 'rgb(var(--ink)/var(--ink-a36,0.36))';
const BORDER = 'rgb(var(--ink)/0.085)';
const INNER_BG = 'rgb(var(--ink)/0.032)';

export interface PayableDjSet {
  id: string;
  dj_id: string | null;
  artist_name?: string | null;
  start_time: string;
  fee: number;
  fee_paid: boolean;
  fee_paid_at?: string | null;
  payee_name?: string | null;
  payee_iban?: string | null;
  payment_method?: DjSetPaymentMethod | null;
  dj?: { first_name: string; last_name: string; stage_name?: string | null } | null;
  event?: { title: string } | null;
}

/** Prénom + nom d'un DJ Yuno : titulaire par défaut quand le DJ n'a rien saisi. */
const fullName = (set: PayableDjSet) =>
  set.dj ? `${set.dj.first_name} ${set.dj.last_name}`.trim() : (set.artist_name || '').trim();

/** Erreur serveur → message lisible (la garde support vit en base). */
export function djPayoutErrorKey(err: unknown): string {
  const msg = String((err as { message?: string })?.message ?? err ?? '');
  if (msg.includes('support_session_forbidden')) return 'djPay.supportForbidden';
  return 'djPay.error';
}

/** Lit l'IBAN que le DJ Yuno a saisi dans « Mes paiements ». Null si rien / pas le droit. */
export async function fetchDjPayoutPrefill(djId: string): Promise<{ holder_name: string; iban: string } | null> {
  const { data: raw, error } = await supabase.rpc('get_dj_payout_prefill', { p_dj_id: djId });
  const data = raw as { holder_name: string; iban: string } | null;
  if (error || !data?.iban) return null;
  return data;
}

// ─── Champs titulaire + IBAN (création de set et édition) ──────────────────────
export function DJPayoutFields({
  holder, iban, onHolder, onIban, hint, hintTone = 'muted',
}: {
  holder: string; iban: string;
  onHolder: (v: string) => void; onIban: (v: string) => void;
  hint?: string | null; hintTone?: 'muted' | 'pos';
}) {
  const { t } = useLanguage();
  const invalid = iban.trim() !== '' && !isValidIban(iban);
  return (
    <div className="space-y-3">
      <div>
        <Label>{t('djPay.payeeName')} <span style={{ color: T3 }}>· {t('djPay.optional')}</span></Label>
        <Input value={holder} onChange={e => onHolder(e.target.value)} autoComplete="off" />
      </div>
      <div>
        <Label>{t('djPay.iban')} <span style={{ color: T3 }}>· {t('djPay.optional')}</span></Label>
        <Input
          value={iban}
          onChange={e => onIban(e.target.value.toUpperCase())}
          onBlur={() => { if (iban.trim() && isValidIban(iban)) onIban(formatIban(normalizeIban(iban))); }}
          placeholder="FR76 3000 6000 0112 3456 7890 189"
          autoComplete="off"
          spellCheck={false}
          className="font-mono tracking-wide"
          aria-invalid={invalid}
          style={invalid ? { borderColor: 'var(--acc-ff5c63)' } : undefined}
        />
        {invalid ? (
          <p className="text-[11px] mt-1" style={{ color: 'var(--acc-ff5c63)' }}>{t('djPay.ibanInvalid')}</p>
        ) : hint ? (
          <p className="text-[11px] mt-1" style={{ color: hintTone === 'pos' ? POS : T3 }}>{hint}</p>
        ) : null}
      </div>
    </div>
  );
}

// ─── Ligne copiable du virement ───────────────────────────────────────────────
function CopyRow({ label, value, display, mono }: { label: string; value: string; display?: string; mono?: boolean }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* presse-papier refusé : la valeur reste lisible à l'écran */ }
  };
  return (
    <div className="flex items-center justify-between gap-3 py-2.5" style={{ borderTop: `1px solid ${BORDER}` }}>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: T3 }}>{label}</div>
        <div className={`text-[14px] font-[560] break-all ${mono ? 'font-mono tracking-wide' : ''}`} style={{ color: T1 }}>
          {display ?? value}
        </div>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={`${t('djPay.copy')} ${label}`}
        className="flex-none inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors hover:bg-white/[0.06]"
        style={{ border: `1px solid ${BORDER}`, color: copied ? POS : T2 }}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? t('djPay.copied') : t('djPay.copy')}
      </button>
    </div>
  );
}

// ─── Fiche de paiement d'un set ──────────────────────────────────────────────
export function DJSetPaymentDialog({
  set, open, onOpenChange, onChanged, onDelete, canEdit = true,
}: {
  set: PayableDjSet | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  onDelete?: (set: PayableDjSet) => void;
  canEdit?: boolean;
}) {
  const { t, language } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const [editing, setEditing] = useState(false);
  const [holder, setHolder] = useState('');
  const [iban, setIban] = useState('');
  const [fee, setFee] = useState('');
  const [method, setMethod] = useState<DjSetPaymentMethod>('transfer');
  const [busy, setBusy] = useState(false);
  const [prefillHint, setPrefillHint] = useState<string | null>(null);

  useEffect(() => {
    if (!set || !open) return;
    setEditing(false);
    setHolder(set.payee_name || '');
    setIban(set.payee_iban ? formatIban(set.payee_iban) : '');
    setFee(set.fee ? String(set.fee) : '');
    setMethod(set.payee_iban ? 'transfer' : 'cash');
    setPrefillHint(null);
  }, [set, open]);

  if (!set) return null;

  const name = performerName(set) || '—';
  const amount = new Intl.NumberFormat(language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB', {
    style: 'currency', currency: 'EUR', maximumFractionDigits: Number.isInteger(set.fee) ? 0 : 2,
  }).format(set.fee || 0);
  const amountPlain = (set.fee || 0).toFixed(2);
  const reference = djSetReference(set.id);
  const beneficiary = set.payee_name || fullName(set);

  const update = async (patch: { fee_paid?: boolean; payment_method?: string; fee_paid_at?: string; payee_name?: string | null; payee_iban?: string | null; fee?: number }) => {
    const { data, error } = await supabase
      .from('dj_sets')
      .update(patch)
      .eq('id', set.id)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('not_allowed');
  };

  const run = async (fn: () => Promise<void>, successKey: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(t(successKey));
      onChanged();
    } catch (e) {
      toast.error(t(djPayoutErrorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  const markPaid = () => run(async () => {
    await update({ fee_paid: true, payment_method: method, fee_paid_at: new Date().toISOString() });
    // Registre historique des paiements d'un DJ Yuno (lu par sa fiche club).
    if (set.dj_id) {
      await supabase.from('dj_payments').insert({
        dj_id: set.dj_id,
        dj_set_id: set.id,
        amount: set.fee,
        description: set.event?.title || `Set ${format(new Date(set.start_time), 'dd/MM/yyyy')}`,
      });
    }
    onOpenChange(false);
  }, 'djPay.markedPaid');

  const markUnpaid = () => run(async () => {
    await update({ fee_paid: false });
    if (set.dj_id) await supabase.from('dj_payments').delete().eq('dj_set_id', set.id);
  }, 'djPay.markedUnpaid');

  const ibanInvalid = iban.trim() !== '' && !isValidIban(iban);
  const saveDetails = () => run(async () => {
    await update({
      payee_name: holder.trim() || null,
      payee_iban: iban.trim() ? normalizeIban(iban) : null,
      fee: Math.max(0, parseFloat(fee.replace(',', '.')) || 0),
    });
    setEditing(false);
  }, 'djPay.saved');

  const pullYunoIban = async () => {
    if (!set.dj_id) return;
    const p = await fetchDjPayoutPrefill(set.dj_id);
    if (p) {
      setHolder(p.holder_name);
      setIban(formatIban(p.iban));
      setPrefillHint(t('djPay.ibanPrefilled'));
    } else {
      setPrefillHint(t('djPay.ibanMissingYuno'));
    }
  };

  const copyAll = async () => {
    const lines = [
      `${t('djPay.beneficiary')} : ${beneficiary}`,
      `${t('djPay.iban')} : ${set.payee_iban ? formatIban(set.payee_iban) : '—'}`,
      `${t('djPay.amount')} : ${amountPlain} EUR`,
      `${t('djPay.reference')} : ${reference}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast.success(t('djPay.copied'));
    } catch { /* lisible à l'écran */ }
  };

  const methods: DjSetPaymentMethod[] = ['transfer', 'cash', 'other'];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('djPay.dialogTitle').replace('{name}', name)}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Soirée + montant + statut */}
          <div className="rounded-xl p-3.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-[560] truncate" style={{ color: T1 }}>{set.event?.title || '—'}</p>
                <p className="text-xs tabular-nums capitalize" style={{ color: T3 }}>
                  {format(new Date(set.start_time), 'EEEE d MMMM yyyy · HH:mm', { locale: dateLocale })}
                </p>
              </div>
              <div className="text-right flex-none">
                <div className="text-[22px] font-[680] tabular-nums leading-none" style={{ color: T1, letterSpacing: '-0.02em' }}>{amount}</div>
                <div className="text-[11px] mt-1 font-semibold" style={{ color: set.fee_paid ? POS : WARN }}>
                  {set.fee_paid
                    ? t('djPay.statusPaid').replace('{date}', set.fee_paid_at ? format(new Date(set.fee_paid_at), 'd MMM yyyy', { locale: dateLocale }) : '')
                    : t('djPay.statusDue')}
                </div>
              </div>
            </div>
            {set.fee_paid && set.payment_method && (
              <p className="text-xs mt-2" style={{ color: T2 }}>
                {t('djPay.paidWith')} {t(`djPay.method.${set.payment_method}`).toLowerCase()}
              </p>
            )}
          </div>

          {editing ? (
            <div className="space-y-3">
              <div>
                <Label>{t('djPay.feeLabel')}</Label>
                <Input type="number" inputMode="decimal" min={0} value={fee} onChange={e => setFee(e.target.value)} placeholder="0" />
              </div>
              <DJPayoutFields
                holder={holder}
                iban={iban}
                onHolder={setHolder}
                onIban={v => { setIban(v); setPrefillHint(null); }}
                hint={prefillHint}
                hintTone={prefillHint === t('djPay.ibanPrefilled') ? 'pos' : 'muted'}
              />
              {set.dj_id && (
                <button type="button" onClick={pullYunoIban} className="text-[12.5px] font-semibold underline-offset-2 hover:underline" style={{ color: T2 }}>
                  {t('djPay.useYunoIban')}
                </button>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={() => setEditing(false)} disabled={busy}>{t('djPay.cancel')}</Button>
                <Button onClick={saveDetails} disabled={busy || ibanInvalid} style={{ background: RED, color: '#fff' }}>
                  {busy ? '…' : t('djPay.save')}
                </Button>
              </div>
            </div>
          ) : set.fee > 0 ? (
            <div className="rounded-xl px-3.5 pt-3 pb-1" style={{ border: `1px solid ${BORDER}` }}>
              <div className="flex items-center justify-between gap-2 pb-2">
                <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: T1 }}>
                  <Landmark className="h-4 w-4" style={{ color: T3 }} />
                  {set.fee_paid ? t('djPay.transferDone') : t('djPay.transferTitle')}
                </div>
                {set.payee_iban && (
                  <button type="button" onClick={copyAll} className="text-[12px] font-semibold hover:underline" style={{ color: T2 }}>
                    {t('djPay.copyAll')}
                  </button>
                )}
              </div>
              {set.payee_iban ? (
                <>
                  <CopyRow label={t('djPay.beneficiary')} value={beneficiary} />
                  <CopyRow label={t('djPay.iban')} value={set.payee_iban} display={formatIban(set.payee_iban)} mono />
                  <CopyRow label={t('djPay.amount')} value={amountPlain} display={amount} />
                  <CopyRow label={t('djPay.reference')} value={reference} mono />
                </>
              ) : (
                <div className="py-3 flex items-center justify-between gap-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                  <p className="text-[13px]" style={{ color: T3 }}>{t('djPay.noIban')}</p>
                  {canEdit && (
                    <Button size="sm" variant="outline" onClick={() => { setEditing(true); if (set.dj_id) void pullYunoIban(); }}>
                      {t('djPay.addIban')}
                    </Button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm" style={{ color: T3 }}>{t('djPay.noFee')}</p>
          )}

          {/* Actions */}
          {canEdit && !editing && (
            <div className="space-y-3">
              {set.fee > 0 && !set.fee_paid && (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.06em] mb-1.5" style={{ color: T3 }}>{t('djPay.paidWith')}</div>
                  <div className="inline-flex gap-0.5 p-1 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }} role="radiogroup">
                    {methods.map(m => (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={method === m}
                        onClick={() => setMethod(m)}
                        className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition-all"
                        style={method === m
                          ? { color: T1, background: 'linear-gradient(180deg,rgb(var(--ink)/.13),rgb(var(--ink)/.07))' }
                          : { color: T3 }}
                      >
                        {t(`djPay.method.${m}`)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setEditing(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold hover:bg-white/[0.06]"
                    style={{ color: T2 }}>
                    <Pencil className="h-3.5 w-3.5" /> {t('djPay.edit')}
                  </button>
                  {onDelete && (
                    <button type="button" onClick={() => onDelete(set)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold hover:bg-white/[0.06]"
                      style={{ color: 'var(--acc-ff5c63)' }}>
                      <Trash2 className="h-3.5 w-3.5" /> {t('djPay.delete')}
                    </button>
                  )}
                </div>
                {set.fee > 0 && (set.fee_paid ? (
                  <Button variant="outline" onClick={markUnpaid} disabled={busy}>{t('djPay.markUnpaid')}</Button>
                ) : (
                  <Button onClick={markPaid} disabled={busy} style={{ background: RED, color: '#fff' }}>
                    {busy ? '…' : t('djPay.markPaid')}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
