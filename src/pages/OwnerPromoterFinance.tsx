import { useState, useEffect, useCallback } from 'react';
import { translate } from '@/i18n/orgTranslate';
import { supabase } from '@/integrations/supabase/client';
import { usePromoterScope } from '@/hooks/usePromoterScope';
import { getScopeFilter, scopeId } from '@/lib/promoterScopeHelpers';
import { useCollabReadOnly } from '@/hooks/useCollabReadOnly';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { toast } from 'sonner';
import {
  Clock, CheckCircle2, ShieldCheck, Download, Wallet, Landmark,
  AlertTriangle, X, FileText, Hourglass,
} from 'lucide-react';
import {
  PromoHeader, PromoPage, PromoCard, StatTile, SectionLabel, PromoPill, PromoButton, PromoEmpty,
  CopyField, RED, POS, WARN, T1, T2, T3, BORDER,
} from '@/components/promoter/promoter-ui';
import {
  preparePayout, declarePayoutSent, resolvePayoutDispute, cancelPayout,
  notifyPayoutParties, payoutErrorKey, formatIban, euro, daysUntil,
  PAYOUT_COLUMNS, type PayoutStatus, type PromoterPayoutRow,
} from '@/lib/promoterPayout';
import { generatePayoutReceiptPDF, payoutReceiptFilename, type PayoutReceiptLine } from '@/lib/generatePayoutReceiptPDF';

interface PromoterDebt {
  promoterId: string;
  promoterName: string;
  promoterIban: string | null;
  pendingConversions: number;
  pendingAmount: number;
}

interface Payout extends PromoterPayoutRow {
  promoterName: string;
  promoterIban: string | null;
}

/**
 * Règlement des promoteurs, en trois temps.
 *
 * L'ancien écran soldait tout d'un clic : le club appuyait sur « Régler », la
 * dette disparaissait, et rien ne prouvait qu'un euro avait bougé. Un club
 * pouvait effacer une dette sans payer ; un promoteur pouvait affirmer n'avoir
 * jamais rien reçu. Aucune des deux parties n'avait de recours.
 *
 * Désormais : le club PRÉPARE (le périmètre se fige et devient annulable), vire
 * depuis sa propre banque avec la référence fournie, DÉCLARE l'avoir fait, et
 * le promoteur ACCUSE RÉCEPTION. Les commissions ne sont soldées qu'à cette
 * dernière étape — celle que le club ne contrôle pas.
 *
 * Yuno ne touche jamais les fonds : le virement est un SEPA classique de banque
 * à banque. Ce qui est sécurisé ici, c'est l'accord et son horodatage.
 */
export default function OwnerPromoterFinance() {
  const scope = usePromoterScope();
  const sid = scopeId(scope);
  const scopeFilter = getScopeFilter(scope);
  const { basePath } = useDashboardMode();
  const { t, language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const { canExport } = useCollabReadOnly();
  const [debts, setDebts] = useState<PromoterDebt[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [payerName, setPayerName] = useState('');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const fail = (err: unknown) => {
    console.error(err);
    toast.error(t(payoutErrorKey(err)));
  };

  const fetchData = useCallback(async () => {
    if (!sid) return;
    try {
      // Agency-managed promoters are settled by their agency, not the club.
      const { data: promoters, error: promotersError } = await supabase.from('promoters')
        .select('id, user_id, iban, promo_code')
        .eq(scopeFilter.column, sid).is('agency_id', null);
      // Une erreur RLS/réseau renvoyait `data = null`, indistinguable d'un club
      // sans promoteur : la page affichait « 0€ / 0€ / 0€ » et un état vide alors
      // que les dettes et l'historique existaient. On la remonte désormais.
      if (promotersError) throw promotersError;
      if (!promoters || promoters.length === 0) {
        setDebts([]); setPayouts([]); setLoading(false); return;
      }

      const promoterIds = promoters.map(p => p.id);
      const userIds = promoters.map(p => p.user_id);

      const { data: profiles } = await supabase.from('profiles')
        .select('id, first_name, last_name, email').in('id', userIds);
      const profileMap = new Map((profiles || []).map(p => [p.id, p]));
      const promoterInfoMap = new Map(promoters.map(p => {
        const prof = profileMap.get(p.user_id);
        return [p.id, {
          name: prof ? `${prof.first_name || ''} ${prof.last_name || ''}`.trim() || prof.email : p.promo_code,
          iban: p.iban,
        }];
      }));

      // Qui paie — c'est ce nom qui figure sur le reçu contresigné.
      if (scope.kind === 'venue') {
        const { data: venue } = await supabase.from('venues').select('name').eq('id', sid).maybeSingle();
        setPayerName(venue?.name || '');
      } else {
        const { data: me } = await supabase.from('profiles')
          .select('first_name, last_name, email').eq('id', sid).maybeSingle();
        setPayerName(me ? `${me.first_name || ''} ${me.last_name || ''}`.trim() || me.email || '' : '');
      }

      // PostgREST plafonne une réponse à 1000 lignes. Sans pagination, un club
      // au-delà de ce seuil voyait un « À payer » tronqué et cliquait « Régler
      // X€ » alors que la RPC, elle, somme le vrai total côté serveur : l'owner
      // validait un montant plus petit que celui réellement payé.
      const pendingConvs: Array<{ promoter_id: string; commission: number | null }> = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data: page, error: pageError } = await supabase.from('promoter_conversions')
          .select('promoter_id, commission')
          .in('promoter_id', promoterIds)
          .eq('status', 'pending')
          .range(from, from + PAGE - 1);
        if (pageError) throw pageError;
        if (!page || page.length === 0) break;
        pendingConvs.push(...page);
        if (page.length < PAGE) break;
      }

      const debtMap = new Map<string, { count: number; amount: number }>();
      (pendingConvs || []).forEach(c => {
        const existing = debtMap.get(c.promoter_id) || { count: 0, amount: 0 };
        existing.count++;
        existing.amount += c.commission || 0;
        debtMap.set(c.promoter_id, existing);
      });

      // Restreint aux promoteurs du club. Un règlement fait par une AGENCE à son
      // propre promoteur écrit quand même le venue_id du club sur la ligne de
      // paiement : sans ce filtre, le total « Payé » du club gonflait d'argent
      // qu'il n'a jamais versé, et ces lignes s'affichaient en « N/A » puisque le
      // promoteur agence est volontairement exclu plus haut.
      const { data: payoutsData, error: payoutsError } = await supabase.from('promoter_payouts')
        .select(PAYOUT_COLUMNS).eq(scopeFilter.column, sid)
        .in('promoter_id', promoterIds)
        .order('created_at', { ascending: false });
      if (payoutsError) throw payoutsError;

      const rows = ((payoutsData || []) as unknown as PromoterPayoutRow[]).map(d => ({
        ...d,
        status: d.status as PayoutStatus,
        promoterName: promoterInfoMap.get(d.promoter_id)?.name || 'N/A',
        promoterIban: promoterInfoMap.get(d.promoter_id)?.iban || null,
      }));
      setPayouts(rows);

      // Un promoteur dont le règlement est déjà en cours ne doit plus apparaître
      // en « commissions dues » : ses commissions sont figées dans le lot ouvert,
      // et une seconde préparation serait refusée par la base. L'afficher avec un
      // bouton « Préparer » qui échoue systématiquement n'aide personne.
      const openPromoterIds = new Set(
        rows.filter(p => p.status !== 'paid').map(p => p.promoter_id)
      );

      const debtsList: PromoterDebt[] = [];
      debtMap.forEach((val, promoterId) => {
        const info = promoterInfoMap.get(promoterId);
        if (val.amount > 0 && !openPromoterIds.has(promoterId)) {
          debtsList.push({
            promoterId,
            promoterName: info?.name || 'N/A',
            promoterIban: info?.iban || null,
            pendingConversions: val.count,
            pendingAmount: val.amount,
          });
        }
      });
      debtsList.sort((a, b) => b.pendingAmount - a.pendingAmount);
      setDebts(debtsList);
    } catch (err) {
      console.error(err);
      toast.error(t('promoterPayouts.loadError'));
    } finally {
      setLoading(false);
    }
  }, [sid]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Étape 1 : préparer le lot ──────────────────────────────────────────────
  async function prepare(promoterId: string) {
    if (!sid) return;
    setActing(true);
    try {
      const res = await preparePayout(promoterId);
      if (res?.prepared) {
        toast.success(tt(
          `Règlement préparé : ${euro(Number(res.amount))}`,
          `Settlement prepared: ${euro(Number(res.amount))}`,
          `Liquidación preparada: ${euro(Number(res.amount))}`,
        ));
      } else {
        toast.info(t('promoterSettlement.nothingPending'));
      }
      await fetchData();
    } catch (err) { fail(err); }
    finally { setActing(false); }
  }

  // ── Étape 2 : le club déclare avoir viré ───────────────────────────────────
  async function declareSent(payoutId: string) {
    setActing(true);
    try {
      await declarePayoutSent(payoutId);
      notifyPayoutParties(payoutId);
      toast.success(t('promoterSettlement.declaredToast'));
      await fetchData();
    } catch (err) { fail(err); }
    finally { setActing(false); }
  }

  async function cancel(payoutId: string) {
    if (!window.confirm(t('promoterSettlement.cancelConfirm'))) return;
    setActing(true);
    try {
      await cancelPayout(payoutId);
      toast.success(t('promoterSettlement.cancelledToast'));
      await fetchData();
    } catch (err) { fail(err); }
    finally { setActing(false); }
  }

  // ── Litige : le club tranche ───────────────────────────────────────────────
  async function resolveDispute(payoutId: string, action: 'redeclare' | 'cancel') {
    if (action === 'cancel' && !window.confirm(t('promoterSettlement.disputeCancelConfirm'))) return;
    setActing(true);
    try {
      await resolvePayoutDispute(payoutId, action);
      // « redeclare » remet le lot en attente d'accusé de réception : le
      // promoteur doit être re-sollicité, sinon il ne saura pas qu'on lui
      // redemande de vérifier son compte.
      if (action === 'redeclare') notifyPayoutParties(payoutId);
      toast.success(t(action === 'redeclare'
        ? 'promoterSettlement.redeclaredToast'
        : 'promoterSettlement.cancelledToast'));
      await fetchData();
    } catch (err) { fail(err); }
    finally { setActing(false); }
  }

  // ── Reçu contresigné ───────────────────────────────────────────────────────
  async function downloadReceipt(payout: Payout) {
    setActing(true);
    try {
      // Le détail des commissions n'est chargé qu'ici : un club qui consulte
      // l'historique n'a pas besoin de tirer des centaines de lignes par lot.
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
        promoterName: payout.promoterName,
        promoterIban: payout.promoterIban,
        preparedAt: payout.created_at,
        declaredAt: payout.approved_at,
        confirmedAt: payout.paid_at,
        lines,
      }, language);
      doc.save(payoutReceiptFilename(payout.transfer_reference || payout.id));
    } catch (err) { fail(err); }
    finally { setActing(false); }
  }

  /** Échappement CSV : les guillemets internes se doublent, sinon un nom comme
   *  Jean "JD" Dupont décale toute la ligne. */
  const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

  function exportCSV() {
    // On exporte les virements RESTANT À FAIRE en premier : c'est la raison d'être
    // du fichier (le coller dans l'interface de virement de sa banque). Avant, seul
    // l'historique sortait — un club n'ayant jamais réglé téléchargeait un fichier
    // ne contenant que l'en-tête.
    const rows = [[
      t('owner.promoB.csvPromoter'), t('owner.promoB.csvAmount'), t('owner.promoB.csvStatus'),
      t('owner.promoB.csvPeriod'), 'IBAN', t('promoterSettlement.reference'), t('owner.promoB.csvDate'),
    ].map(csvCell).join(',')];

    debts.forEach(d => {
      rows.push([
        csvCell(d.promoterName), d.pendingAmount.toFixed(2), csvCell(t('promoterPayouts.pending')),
        csvCell(''), csvCell(d.promoterIban || ''), csvCell(''),
        csvCell(new Date().toISOString().slice(0, 10)),
      ].join(','));
    });
    payouts.forEach(p => {
      rows.push([
        csvCell(p.promoterName), p.amount.toFixed(2), csvCell(p.status), csvCell(p.period_label || ''),
        csvCell(p.promoterIban || ''), csvCell(p.transfer_reference || ''),
        csvCell(new Date(p.created_at).toISOString().slice(0, 10)),
      ].join(','));
    });

    // BOM UTF-8 : sans lui Excel affiche les accents en mojibake.
    const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `promoteurs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  const openPayouts = payouts.filter(p => p.status !== 'paid');
  const historyPayouts = payouts.filter(p => p.status === 'paid');

  const totalDebt = debts.reduce((s, d) => s + d.pendingAmount, 0);
  const totalInFlight = openPayouts.reduce((s, p) => s + p.amount, 0);
  const totalPaid = historyPayouts.reduce((s, p) => s + p.amount, 0);

  const statusPill = (s: PayoutStatus) =>
    s === 'paid' ? <PromoPill tone="success">{t('promoterPayouts.paid')}</PromoPill>
    : s === 'disputed' ? <PromoPill tone="danger">{t('promoterSettlement.disputed')}</PromoPill>
    : s === 'approved' ? <PromoPill tone="warn">{t('promoterSettlement.declared')}</PromoPill>
    : <PromoPill tone="muted">{t('promoterSettlement.prepared')}</PromoPill>;

  const maskIban = (iban: string) => `${iban.slice(0, 4)}···${iban.slice(-4)}`;

  if (loading) return <OwnerPageSkeleton />;

  return (
    <>
      <PromoHeader
        title={t('promoterPayouts.title')}
        subtitle={t('promoterSettlement.subtitle')}
        backTo={`${basePath}/promoters`}
        right={
          <PromoButton size="sm" variant="ghost" onClick={exportCSV} disabled={!canExport}
            title={!canExport ? tt('Export indisponible en mode démo Collab', 'Export unavailable in Collab demo mode') : undefined}>
            <Download className="h-4 w-4" />CSV
          </PromoButton>
        }
      />

      <PromoPage maxWidth={640}>
        {/* Summary */}
        <div className="grid grid-cols-3 gap-3">
          <StatTile icon={Clock} value={euro(totalDebt)} label={tt('À payer', 'To pay')} tone="red" />
          <StatTile icon={Hourglass} value={euro(totalInFlight)} label={t('promoterSettlement.inFlight')} tone="warn" />
          <StatTile icon={CheckCircle2} value={euro(totalPaid)} label={t('promoterPayouts.paid')} tone="pos" />
        </div>

        {/* Règlements en cours — l'action du jour, donc en haut */}
        {openPayouts.length > 0 && (
          <>
            <SectionLabel>{t('promoterSettlement.inProgress')}</SectionLabel>
            <div className="space-y-2.5">
              {openPayouts.map(payout => {
                const left = daysUntil(payout.confirm_due_at);
                return (
                  <PromoCard key={payout.id}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="min-w-0">
                        <p className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 620, margin: 0 }}>{payout.promoterName}</p>
                        {payout.period_label && <p style={{ color: T3, fontSize: 11.5, margin: 0 }}>{payout.period_label}</p>}
                      </div>
                      <div className="text-right flex-none">
                        <p style={{ color: T1, fontSize: 18, fontWeight: 740, margin: 0 }}>{payout.amount.toFixed(2)}€</p>
                        <div className="mt-1">{statusPill(payout.status)}</div>
                      </div>
                    </div>

                    {/* PRÉPARÉ — les coordonnées à recopier dans sa banque */}
                    {payout.status === 'pending' && (
                      <>
                        <div className="flex items-start gap-2 mb-3" style={{ color: T2, fontSize: 12 }}>
                          <Landmark className="h-4 w-4 flex-none" style={{ color: T3, marginTop: 1 }} />
                          <p style={{ margin: 0 }}>{t('promoterSettlement.transferHint')}</p>
                        </div>
                        <div className="space-y-2">
                          {payout.promoterIban && (
                            <CopyField label="IBAN" value={formatIban(payout.promoterIban)} copiedLabel={t('promoterSettlement.copied')} />
                          )}
                          <CopyField
                            label={t('promoterSettlement.reference')}
                            value={payout.transfer_reference || '—'}
                            copiedLabel={t('promoterSettlement.copied')}
                          />
                          <CopyField
                            label={t('promoterSettlement.amountToTransfer')}
                            value={payout.amount.toFixed(2)}
                            copiedLabel={t('promoterSettlement.copied')}
                          />
                        </div>
                        <p style={{ color: T3, fontSize: 11, margin: '10px 0 0' }}>{t('promoterSettlement.referenceWhy')}</p>
                        <div className="flex gap-2 mt-3">
                          <PromoButton size="sm" onClick={() => declareSent(payout.id)} disabled={acting}>
                            <ShieldCheck className="h-4 w-4" />{t('promoterSettlement.declareSent')}
                          </PromoButton>
                          <PromoButton variant="ghost" size="sm" onClick={() => cancel(payout.id)} disabled={acting}>
                            <X className="h-4 w-4" />{t('promoterSettlement.cancel')}
                          </PromoButton>
                        </div>
                      </>
                    )}

                    {/* DÉCLARÉ — la balle est dans le camp du promoteur */}
                    {payout.status === 'approved' && (
                      <div style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.18)', borderRadius: 11, padding: '10px 12px' }}>
                        <p style={{ color: WARN, fontSize: 12.5, fontWeight: 620, margin: 0 }}>
                          {t('promoterSettlement.awaitingAck')}
                        </p>
                        <p style={{ color: T3, fontSize: 11.5, margin: '3px 0 0' }}>
                          {payout.transfer_reference && <>{t('promoterSettlement.reference')} : {payout.transfer_reference} · </>}
                          {left !== null && left >= 0
                            ? t('promoterSettlement.daysLeft').replace('{days}', String(left))
                            : t('promoterSettlement.overdue')}
                        </p>
                      </div>
                    )}

                    {/* LITIGE — le promoteur dit n'avoir rien reçu */}
                    {payout.status === 'disputed' && (
                      <>
                        <div style={{ background: 'rgba(255,92,99,0.07)', border: '1px solid rgba(255,92,99,0.22)', borderRadius: 11, padding: '10px 12px' }}>
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 flex-none" style={{ color: RED, marginTop: 1 }} />
                            <div className="min-w-0">
                              <p style={{ color: RED, fontSize: 12.5, fontWeight: 620, margin: 0 }}>
                                {payout.dispute_reason === 'auto:no_acknowledgement'
                                  ? t('promoterSettlement.disputeAuto')
                                  : t('promoterSettlement.disputeManual')}
                              </p>
                              {payout.dispute_reason && payout.dispute_reason !== 'auto:no_acknowledgement' && (
                                <p style={{ color: T2, fontSize: 11.5, margin: '3px 0 0' }}>« {payout.dispute_reason} »</p>
                              )}
                              <p style={{ color: T3, fontSize: 11.5, margin: '4px 0 0' }}>
                                {t('promoterSettlement.disputeHint')}
                                {payout.transfer_reference && <> ({payout.transfer_reference})</>}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-3">
                          <PromoButton size="sm" onClick={() => resolveDispute(payout.id, 'redeclare')} disabled={acting}>
                            <ShieldCheck className="h-4 w-4" />{t('promoterSettlement.disputeRedeclare')}
                          </PromoButton>
                          <PromoButton variant="danger" size="sm" onClick={() => resolveDispute(payout.id, 'cancel')} disabled={acting}>
                            <X className="h-4 w-4" />{t('promoterSettlement.disputeCancel')}
                          </PromoButton>
                        </div>
                      </>
                    )}
                  </PromoCard>
                );
              })}
            </div>
          </>
        )}

        {/* Debts from real conversions */}
        {debts.length > 0 && (
          <>
            <SectionLabel>{tt('Commissions dues', 'Commissions owed')}</SectionLabel>
            <div className="space-y-2.5">
              {debts.map(debt => (
                <PromoCard key={debt.promoterId}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="min-w-0">
                      <p className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 620, margin: 0 }}>{debt.promoterName}</p>
                      <p style={{ color: T3, fontSize: 11.5, margin: 0 }}>
                        {tt(`${debt.pendingConversions} conversion${debt.pendingConversions > 1 ? 's' : ''} en attente`, `${debt.pendingConversions} pending conversion${debt.pendingConversions > 1 ? 's' : ''}`, `${debt.pendingConversions} ${debt.pendingConversions > 1 ? 'conversiones pendientes' : 'conversión pendiente'}`)}
                        {debt.promoterIban
                          ? <> · IBAN {maskIban(debt.promoterIban)}</>
                          : <> · <span style={{ color: WARN }}>{t('promoterSettlement.noIban')}</span></>}
                      </p>
                    </div>
                    <p style={{ color: RED, fontSize: 18, fontWeight: 740, margin: 0, flex: 'none' }}>{debt.pendingAmount.toFixed(2)}€</p>
                  </div>
                  <PromoButton full size="sm" onClick={() => prepare(debt.promoterId)} disabled={acting || !debt.promoterIban}>
                    <Landmark className="h-4 w-4" /> {t('promoterSettlement.prepare').replace('{amount}', euro(debt.pendingAmount))}
                  </PromoButton>
                </PromoCard>
              ))}
            </div>
          </>
        )}

        {/* Payout history */}
        {historyPayouts.length > 0 && (
          <>
            <SectionLabel>{tt('Historique des paiements', 'Payout history')}</SectionLabel>
            <div className="space-y-2.5">
              {historyPayouts.map(payout => (
                <PromoCard key={payout.id}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="min-w-0">
                      <p className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 620, margin: 0 }}>{payout.promoterName}</p>
                      {payout.period_label && <p style={{ color: T3, fontSize: 11.5, margin: 0 }}>{payout.period_label}</p>}
                    </div>
                    <div className="text-right flex-none">
                      <p style={{ color: T1, fontSize: 17, fontWeight: 740, margin: 0 }}>{payout.amount.toFixed(2)}€</p>
                      <div className="mt-1">{statusPill(payout.status)}</div>
                    </div>
                  </div>
                  <p style={{ color: T3, fontSize: 11, margin: 0 }}>
                    {payout.transfer_reference && <>{payout.transfer_reference} · </>}
                    {payout.approved_at && <>{t('promoterSettlement.declaredOn')} {new Date(payout.approved_at).toLocaleDateString('fr-FR')}</>}
                    {payout.approved_at && payout.paid_at && ' · '}
                    {payout.paid_at && <>{t('promoterSettlement.confirmedOn')} {new Date(payout.paid_at).toLocaleDateString('fr-FR')}</>}
                  </p>
                  <div className="mt-3">
                    <PromoButton variant="secondary" size="sm" onClick={() => downloadReceipt(payout)} disabled={acting}>
                      <FileText className="h-4 w-4" />{t('promoterSettlement.receipt')}
                    </PromoButton>
                  </div>
                </PromoCard>
              ))}
            </div>
          </>
        )}

        {debts.length === 0 && payouts.length === 0 && (
          <PromoEmpty icon={Wallet} title={t('promoterPayouts.noPending')} description={tt('Les commissions apparaîtront ici dès que vos promoteurs génèrent des ventes ou valident des entrées.', 'Commissions will appear here as soon as your promoters make sales or validate entries.')} />
        )}
      </PromoPage>
    </>
  );
}
