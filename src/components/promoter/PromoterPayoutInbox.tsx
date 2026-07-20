import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { CheckCircle2, AlertTriangle, Hourglass, FileText, Landmark } from 'lucide-react';
import {
  confirmPayoutReceived, disputePayout, notifyPayoutParties, payoutErrorKey, euro, daysUntil,
  PAYOUT_COLUMNS, type PromoterPayoutRow,
} from '@/lib/promoterPayout';
import { generatePayoutReceiptPDF, payoutReceiptFilename, type PayoutReceiptLine } from '@/lib/generatePayoutReceiptPDF';

/**
 * Accusé de réception d'un règlement, côté promoteur.
 *
 * C'est l'étape qui fait tenir tout le système : les commissions ne passent en
 * « payé » que quand la personne payée dit avoir reçu l'argent. Le club ne peut
 * pas la déclencher à sa place.
 *
 * Volontairement placé en haut de l'onglet, pas dans un sous-menu. Un règlement
 * déclaré et jamais confirmé bascule en litige au bout de quelques jours et
 * alerte le club — le promoteur doit tomber dessus sans le chercher.
 */
export function PromoterPayoutInbox({
  promoterId, promoterName, promoterIban, payerName, onSettled,
}: {
  promoterId: string;
  /** Nom affiché sur le reçu. Résolu depuis le profil si non fourni. */
  promoterName?: string;
  promoterIban?: string | null;
  payerName: string;
  onSettled?: () => void;
}) {
  const { t, language } = useLanguage();
  const [payouts, setPayouts] = useState<PromoterPayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [disputingId, setDisputingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const fetchPayouts = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('promoter_payouts')
        .select(PAYOUT_COLUMNS)
        .eq('promoter_id', promoterId)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      setPayouts((data || []) as unknown as PromoterPayoutRow[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [promoterId]);

  useEffect(() => { fetchPayouts(); }, [fetchPayouts]);

  const fail = (err: unknown) => {
    console.error(err);
    toast.error(t(payoutErrorKey(err)));
  };

  async function confirm(payoutId: string) {
    setActing(true);
    try {
      const res = await confirmPayoutReceived(payoutId);
      notifyPayoutParties(payoutId);
      toast.success(t('promoterSettlement.confirmedToast').replace('{amount}', euro(Number(res?.amount ?? 0))));
      await fetchPayouts();
      onSettled?.();
    } catch (err) { fail(err); }
    finally { setActing(false); }
  }

  async function dispute(payoutId: string) {
    setActing(true);
    try {
      await disputePayout(payoutId, reason.trim() || undefined);
      notifyPayoutParties(payoutId);
      toast.success(t('promoterSettlement.disputeOpenedToast'));
      setDisputingId(null);
      setReason('');
      await fetchPayouts();
    } catch (err) { fail(err); }
    finally { setActing(false); }
  }

  /**
   * Nom à porter sur le reçu. Le code promo est un identifiant technique, pas
   * une identité : un reçu au nom de « PAUL22 » n'a aucune valeur devant un
   * comptable. On va chercher le vrai nom, et on ne retombe sur le prop qu'en
   * dernier recours.
   */
  async function resolvePromoterName(): Promise<string> {
    const { data: p } = await supabase.from('promoters')
      .select('user_id').eq('id', promoterId).maybeSingle();
    if (!p?.user_id) return promoterName || '—';
    const { data: prof } = await supabase.from('profiles')
      .select('first_name, last_name, email').eq('id', p.user_id).maybeSingle();
    const full = `${prof?.first_name || ''} ${prof?.last_name || ''}`.trim();
    return full || prof?.email || promoterName || '—';
  }

  async function downloadReceipt(payout: PromoterPayoutRow) {
    setActing(true);
    try {
      const { data: items } = await supabase.from('promoter_payout_items' as never)
        .select('commission, promoter_conversions(conversion_type, amount, created_at)')
        .eq('payout_id', payout.id);

      const typeLabel: Record<string, string> = {
        ticket: t('promoterSettlement.line.ticket'),
        table: t('promoterSettlement.line.table'),
        order: t('promoterSettlement.line.order'),
        guestlist: t('promoterSettlement.line.guestlist'),
        override: t('promoterSettlement.line.override'),
      };

      const lines: PayoutReceiptLine[] = ((items || []) as unknown as Array<{
        commission: number;
        promoter_conversions: { conversion_type: string; amount: number | null; created_at: string } | null;
      }>).map(it => {
        const c = it.promoter_conversions;
        const label = typeLabel[c?.conversion_type || ''] || c?.conversion_type || '—';
        return {
          label: c?.amount ? `${label} — ${Number(c.amount).toFixed(2)} €` : label,
          date: c?.created_at,
          commission: Number(it.commission || 0),
        };
      });

      const doc = generatePayoutReceiptPDF({
        reference: payout.transfer_reference || '—',
        amount: Number(payout.amount || 0),
        periodLabel: payout.period_label,
        payerName,
        promoterName: await resolvePromoterName(),
        promoterIban,
        preparedAt: payout.created_at,
        declaredAt: payout.approved_at,
        confirmedAt: payout.paid_at,
        lines,
      }, language);
      doc.save(payoutReceiptFilename(payout.transfer_reference || payout.id));
    } catch (err) { fail(err); }
    finally { setActing(false); }
  }

  if (loading) return null;

  const awaiting = payouts.filter(p => p.status === 'approved');
  const disputed = payouts.filter(p => p.status === 'disputed');
  const preparing = payouts.filter(p => p.status === 'pending');
  const settled = payouts.filter(p => p.status === 'paid').slice(0, 5);

  if (payouts.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* ── La question, en grand : « Bien reçu ? » ────────────────────────── */}
      {awaiting.map(p => {
        const left = daysUntil(p.confirm_due_at);
        return (
          <Card key={p.id} className="border-primary/50 bg-primary/5">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start gap-3">
                <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {t('promoterSettlement.ackQuestion')
                      .replace('{payer}', payerName)
                      .replace('{amount}', euro(Number(p.amount)))}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {p.transfer_reference && <>{t('promoterSettlement.reference')} : <span className="font-mono">{p.transfer_reference}</span> · </>}
                    {left !== null && left >= 0
                      ? t('promoterSettlement.ackDeadline').replace('{days}', String(left))
                      : t('promoterSettlement.overdue')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{t('promoterSettlement.ackHint')}</p>
                </div>
              </div>

              {disputingId === p.id ? (
                <div className="space-y-2">
                  <Textarea
                    value={reason}
                    onChange={e => setReason(e.target.value.slice(0, 500))}
                    placeholder={t('promoterSettlement.disputeReasonPlaceholder')}
                    rows={3}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="destructive" disabled={acting} onClick={() => dispute(p.id)}>
                      <AlertTriangle className="mr-1.5 h-4 w-4" />{t('promoterSettlement.disputeSubmit')}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={acting} onClick={() => { setDisputingId(null); setReason(''); }}>
                      {t('promoterSettlement.back')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={acting} onClick={() => confirm(p.id)}>
                    <CheckCircle2 className="mr-1.5 h-4 w-4" />{t('promoterSettlement.ackYes')}
                  </Button>
                  <Button size="sm" variant="outline" disabled={acting} onClick={() => setDisputingId(p.id)}>
                    {t('promoterSettlement.ackNo')}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* ── Litige ouvert — la porte reste ouverte si l'argent arrive tard ── */}
      {disputed.map(p => (
        <Card key={p.id} className="border-destructive/50 bg-destructive/5">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {t('promoterSettlement.disputeOpen').replace('{amount}', euro(Number(p.amount)))}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {p.dispute_reason === 'auto:no_acknowledgement'
                    ? t('promoterSettlement.disputeAutoPromoter')
                    : t('promoterSettlement.disputeClubAlerted')}
                </p>
              </div>
            </div>
            {/* Un virement peut arriver avec deux jours de retard bancaire : le
                litige ne doit pas empêcher de confirmer une fois l'argent là. */}
            <Button size="sm" disabled={acting} onClick={() => confirm(p.id)}>
              <CheckCircle2 className="mr-1.5 h-4 w-4" />{t('promoterSettlement.disputeGotItAfterAll')}
            </Button>
          </CardContent>
        </Card>
      ))}

      {/* ── En préparation — rien à faire, mais bon à savoir ───────────────── */}
      {preparing.map(p => (
        <Card key={p.id}>
          <CardContent className="flex items-start gap-3 p-4">
            <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {t('promoterSettlement.preparingByClub').replace('{amount}', euro(Number(p.amount)))}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('promoterSettlement.preparingHint')}</p>
            </div>
          </CardContent>
        </Card>
      ))}

      {/* ── Reçus des règlements soldés ────────────────────────────────────── */}
      {settled.length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('promoterSettlement.receipts')}
            </p>
            {settled.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-3 border-t border-border pt-2 first:border-0 first:pt-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold tabular-nums">{euro(Number(p.amount))}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {p.transfer_reference && <span className="font-mono">{p.transfer_reference}</span>}
                    {p.paid_at && <> · {new Date(p.paid_at).toLocaleDateString()}</>}
                  </p>
                </div>
                <Button size="sm" variant="ghost" className="shrink-0" disabled={acting} onClick={() => downloadReceipt(p)}>
                  <FileText className="mr-1.5 h-4 w-4" />{t('promoterSettlement.receipt')}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
