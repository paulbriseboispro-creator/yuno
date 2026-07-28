import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAgency } from '@/hooks/useAgency';
import { useAgencyData, promoterName } from '@/hooks/useAgencyData';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import {
  ArrowDownLeft, ArrowUpRight, TrendingUp, ChevronDown, ChevronUp, Copy,
  Landmark, ShieldCheck, AlertTriangle, X, Hourglass, CheckCircle2,
} from 'lucide-react';
import {
  PromoCard, StatTile, SectionLabel, PromoEmpty, PromoButton, PromoPill, CopyField,
  T1, T2, T3, RED, POS, WARN,
} from '@/components/promoter/promoter-ui';
import {
  preparePayout, declarePayoutSent, resolvePayoutDispute, cancelPayout,
  notifyPayoutParties, payoutErrorKey, formatIban, euro, daysUntil,
  PAYOUT_COLUMNS, type PayoutStatus, type PromoterPayoutRow,
} from '@/lib/promoterPayout';

const eur = (n: number) => `${(Number(n) || 0).toFixed(2)} €`;

interface AgencyPayout extends PromoterPayoutRow {
  promoterLabel: string;
  promoterIban: string | null;
}

/**
 * Finance agence — le règlement des promoteurs suit le MÊME cycle en trois
 * temps que les clubs (prepare → declare → accusé de réception du promoteur).
 * L'ancien « Régler » en un clic effaçait la dette sans IBAN ni preuve de
 * virement ; désormais l'agence prépare un lot (IBAN + référence à recopier
 * dans sa banque), déclare avoir viré, et seul le promoteur solde.
 */
export default function AgencyFinance() {
  const { agency } = useAgency();
  const { promoters, contracts, conversions, totals, loading, refetch } = useAgencyData(agency?.id ?? null);
  const { t, language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [acting, setActing] = useState(false);
  const [expandedClub, setExpandedClub] = useState<string | null>(null);
  const [payouts, setPayouts] = useState<AgencyPayout[]>([]);
  const [payoutsLoading, setPayoutsLoading] = useState(true);

  const fail = (err: unknown) => {
    console.error(err);
    toast.error(t(payoutErrorKey(err)));
  };

  const promoterInfo = useMemo(() => {
    const map = new Map<string, { label: string; iban: string | null }>();
    for (const p of promoters) {
      const club = p.venues?.name || contracts.find(c =>
        (p.venue_id && c.venue_id === p.venue_id) ||
        (p.organizer_user_id && c.organizer_user_id === p.organizer_user_id)
      )?.venues?.name;
      map.set(p.id, {
        label: club ? `${promoterName(p)} · ${club}` : promoterName(p),
        iban: p.iban ?? null,
      });
    }
    return map;
  }, [promoters, contracts]);

  const fetchPayouts = useCallback(async () => {
    if (promoters.length === 0) { setPayouts([]); setPayoutsLoading(false); return; }
    const { data, error } = await supabase
      .from('promoter_payouts')
      .select(PAYOUT_COLUMNS)
      .in('promoter_id', promoters.map(p => p.id))
      .order('created_at', { ascending: false });
    if (error) { console.error(error); setPayoutsLoading(false); return; }
    setPayouts(((data || []) as unknown as PromoterPayoutRow[]).map(row => ({
      ...row,
      status: row.status as PayoutStatus,
      promoterLabel: promoterInfo.get(row.promoter_id)?.label || '—',
      promoterIban: promoterInfo.get(row.promoter_id)?.iban ?? null,
    })));
    setPayoutsLoading(false);
  }, [promoters, promoterInfo]);

  useEffect(() => { if (!loading) fetchPayouts(); }, [loading, fetchPayouts]);

  const refresh = async () => { await refetch(); await fetchPayouts(); };

  const venueName = (venueId: string | null, orgId: string | null) => {
    if (venueId) return contracts.find(c => c.venue_id === venueId)?.venues?.name || venueId;
    if (orgId) return tt('Organisateur', 'Organizer');
    return tt('Club', 'Club');
  };

  const receivables = useMemo(() => {
    const map = new Map<string, { amount: number; conversions: typeof conversions }>();
    for (const c of conversions) {
      if (c.club_status !== 'pending') continue;
      const key = c.venue_id || c.organizer_user_id || 'unknown';
      if (!map.has(key)) map.set(key, { amount: 0, conversions: [] });
      const entry = map.get(key)!;
      entry.amount += Number(c.gross_amount || 0);
      entry.conversions.push(c);
    }
    return [...map.entries()]
      .map(([key, { amount, conversions: convs }]) => ({
        key,
        amount,
        label: venueName(key === 'unknown' ? null : key, null),
        contact: contracts.find(c => c.venue_id === key || c.organizer_user_id === key),
        convs,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [conversions, contracts, language]);

  const openPayouts = payouts.filter(p => p.status !== 'paid');
  const historyPayouts = payouts.filter(p => p.status === 'paid');

  // Un promoteur avec un lot ouvert ne réapparaît pas en « dette » : ses
  // commissions sont figées dans le lot, une seconde préparation serait refusée.
  const openPromoterIds = new Set(openPayouts.map(p => p.promoter_id));
  const payables = promoters
    .filter(p => Number(p.pending_amount) > 0 && !openPromoterIds.has(p.id))
    .sort((a, b) => Number(b.pending_amount) - Number(a.pending_amount));

  // ── Étape 1 : préparer le lot (fige IBAN + référence) ─────────────────────
  const handlePrepare = async (promoterId: string) => {
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
      await refresh();
    } catch (err) { fail(err); }
    finally { setActing(false); }
  };

  // ── Étape 2 : l'agence déclare avoir viré ─────────────────────────────────
  const handleDeclare = async (payoutId: string) => {
    setActing(true);
    try {
      await declarePayoutSent(payoutId);
      notifyPayoutParties(payoutId);
      toast.success(t('promoterSettlement.declaredToast'));
      await refresh();
    } catch (err) { fail(err); }
    finally { setActing(false); }
  };

  const handleCancel = async (payoutId: string) => {
    if (!window.confirm(t('promoterSettlement.cancelConfirm'))) return;
    setActing(true);
    try {
      await cancelPayout(payoutId);
      toast.success(t('promoterSettlement.cancelledToast'));
      await refresh();
    } catch (err) { fail(err); }
    finally { setActing(false); }
  };

  const handleResolveDispute = async (payoutId: string, action: 'redeclare' | 'cancel') => {
    if (action === 'cancel' && !window.confirm(t('promoterSettlement.disputeCancelConfirm'))) return;
    setActing(true);
    try {
      await resolvePayoutDispute(payoutId, action);
      if (action === 'redeclare') notifyPayoutParties(payoutId);
      toast.success(t(action === 'redeclare'
        ? 'promoterSettlement.redeclaredToast'
        : 'promoterSettlement.cancelledToast'));
      await refresh();
    } catch (err) { fail(err); }
    finally { setActing(false); }
  };

  const statusPill = (s: PayoutStatus) =>
    s === 'paid' ? <PromoPill tone="success">{t('promoterPayouts.paid')}</PromoPill>
    : s === 'disputed' ? <PromoPill tone="danger">{t('promoterSettlement.disputed')}</PromoPill>
    : s === 'approved' ? <PromoPill tone="warn">{t('promoterSettlement.declared')}</PromoPill>
    : <PromoPill tone="muted">{t('promoterSettlement.prepared')}</PromoPill>;

  const maskIban = (iban: string) => `${iban.slice(0, 4)}···${iban.slice(-4)}`;

  if (loading || payoutsLoading) {
    return <div className="py-16 text-center" style={{ color: T3, fontSize: 13 }}>{tt('Chargement…', 'Loading…')}</div>;
  }

  const totalInFlight = openPayouts.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatTile icon={ArrowDownLeft} value={eur(totals.receivableFromClubs)} label={tt('Dû par les clubs', 'Owed by clubs')} tone="pos" />
        <StatTile icon={ArrowUpRight} value={eur(totals.payableToPromoters)} label={tt('Dû aux promoteurs', 'Owed to promoters')} tone="warn" />
        <StatTile icon={TrendingUp} value={eur(totals.marginRealized)} label={tt('Marge agence', 'Agency margin')} />
      </div>

      {/* Receivables from clubs */}
      <SectionLabel>{tt('À recevoir des clubs', 'Receivable from clubs')}</SectionLabel>
      {receivables.length === 0 ? (
        <PromoEmpty
          icon={ArrowDownLeft}
          title={tt('Rien en attente', 'Nothing pending')}
          description={tt('Les clubs sont à jour de leurs règlements.', 'Clubs are settled up.')}
        />
      ) : (
        <div className="space-y-2">
          {receivables.map(r => (
            <PromoCard key={r.key} style={{ padding: 0, overflow: 'hidden' }}>
              <button
                onClick={() => setExpandedClub(expandedClub === r.key ? null : r.key)}
                className="w-full flex items-center justify-between"
                style={{ padding: '12px 14px', cursor: 'pointer', background: 'none', outline: 'none', textAlign: 'left' }}
              >
                <span style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{r.label}</span>
                <div className="flex items-center gap-3">
                  <span style={{ color: POS, fontSize: 14, fontWeight: 680 }}>{eur(r.amount)}</span>
                  {expandedClub === r.key
                    ? <ChevronUp className="h-4 w-4" style={{ color: T3 }} />
                    : <ChevronDown className="h-4 w-4" style={{ color: T3 }} />
                  }
                </div>
              </button>
              {expandedClub === r.key && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '8px 14px 12px' }}>
                  <div className="space-y-1 mb-3">
                    {r.convs.slice(0, 10).map(c => (
                      <div key={c.id} className="flex justify-between" style={{ fontSize: 12 }}>
                        <span style={{ color: T3 }}>
                          {new Date(c.created_at).toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-GB', { day: '2-digit', month: 'short' })}
                        </span>
                        <span style={{ color: T2 }}>{eur(c.gross_amount)}</span>
                      </div>
                    ))}
                    {r.convs.length > 10 && (
                      <p style={{ color: T3, fontSize: 11 }}>
                        +{r.convs.length - 10} {tt('autres', 'more')}
                      </p>
                    )}
                  </div>
                  {agency?.contact_email ? (
                    <button
                      onClick={() => {
                        const email = agency!.contact_email || '';
                        navigator.clipboard.writeText(email);
                        toast.success(tt('Email copié', 'Email copied'));
                      }}
                      style={{ color: T3, fontSize: 11, cursor: 'pointer', background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <Copy className="h-3 w-3" />
                      {tt('Le club règle depuis son dashboard. Copier votre email de contact pour le relancer.', 'The club settles from their dashboard. Copy your contact email to remind them.')}
                    </button>
                  ) : (
                    <p style={{ color: T3, fontSize: 11 }}>
                      {tt('Le club règle l\'agence depuis son propre tableau de bord.', 'Clubs settle the agency from their own dashboard.')}
                    </p>
                  )}
                </div>
              )}
            </PromoCard>
          ))}
        </div>
      )}

      {/* ── Règlements promoteurs en cours — l'action du jour, en haut ── */}
      {openPayouts.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <SectionLabel>{t('promoterSettlement.inProgress')}</SectionLabel>
            <span style={{ color: WARN, fontSize: 12.5, fontWeight: 660 }}>
              <Hourglass className="h-3.5 w-3.5 inline mr-1" style={{ marginTop: -2 }} />
              {eur(totalInFlight)}
            </span>
          </div>
          <div className="space-y-2">
            {openPayouts.map(payout => {
              const left = daysUntil(payout.confirm_due_at);
              return (
                <PromoCard key={payout.id}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="min-w-0">
                      <p className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 620, margin: 0 }}>{payout.promoterLabel}</p>
                      {payout.period_label && <p style={{ color: T3, fontSize: 11.5, margin: 0 }}>{payout.period_label}</p>}
                    </div>
                    <div className="text-right flex-none">
                      <p style={{ color: T1, fontSize: 17, fontWeight: 740, margin: 0 }}>{Number(payout.amount).toFixed(2)}€</p>
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
                          value={Number(payout.amount).toFixed(2)}
                          copiedLabel={t('promoterSettlement.copied')}
                        />
                      </div>
                      <p style={{ color: T3, fontSize: 11, margin: '10px 0 0' }}>{t('promoterSettlement.referenceWhy')}</p>
                      <div className="flex gap-2 mt-3">
                        <PromoButton size="sm" onClick={() => handleDeclare(payout.id)} disabled={acting}>
                          <ShieldCheck className="h-4 w-4" />{t('promoterSettlement.declareSent')}
                        </PromoButton>
                        <PromoButton variant="ghost" size="sm" onClick={() => handleCancel(payout.id)} disabled={acting}>
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
                        <PromoButton size="sm" onClick={() => handleResolveDispute(payout.id, 'redeclare')} disabled={acting}>
                          <ShieldCheck className="h-4 w-4" />{t('promoterSettlement.disputeRedeclare')}
                        </PromoButton>
                        <PromoButton variant="danger" size="sm" onClick={() => handleResolveDispute(payout.id, 'cancel')} disabled={acting}>
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

      {/* ── Commissions dues aux promoteurs ── */}
      <SectionLabel>{tt('À reverser aux promoteurs', 'Payable to promoters')}</SectionLabel>
      {payables.length === 0 && openPayouts.length === 0 ? (
        <PromoEmpty
          icon={ArrowUpRight}
          title={tt('Rien à reverser', 'Nothing to pay out')}
          description={tt('Vos promoteurs sont à jour.', 'Your promoters are settled up.')}
        />
      ) : payables.length === 0 ? (
        <p style={{ color: T3, fontSize: 12 }}>
          {tt('Toutes les commissions dues sont dans un règlement en cours.', 'All owed commissions are in a settlement in progress.')}
        </p>
      ) : (
        <div className="space-y-2">
          {payables.map(p => (
            <PromoCard key={p.id}>
              <div className="flex items-center justify-between mb-3">
                <div className="min-w-0">
                  <p className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 620, margin: 0 }}>
                    {promoterInfo.get(p.id)?.label || promoterName(p)}
                  </p>
                  <p style={{ color: T3, fontSize: 11.5, margin: 0 }}>
                    {p.iban
                      ? <>IBAN {maskIban(p.iban)}</>
                      : <span style={{ color: WARN }}>{t('promoterSettlement.noIban')}</span>}
                  </p>
                </div>
                <p style={{ color: RED, fontSize: 17, fontWeight: 740, margin: 0, flex: 'none' }}>
                  {Number(p.pending_amount).toFixed(2)}€
                </p>
              </div>
              <PromoButton full size="sm" onClick={() => handlePrepare(p.id)} disabled={acting || !p.iban}>
                <Landmark className="h-4 w-4" /> {t('promoterSettlement.prepare').replace('{amount}', euro(Number(p.pending_amount)))}
              </PromoButton>
            </PromoCard>
          ))}
        </div>
      )}

      {/* ── Historique ── */}
      {historyPayouts.length > 0 && (
        <>
          <SectionLabel>{tt('Historique des paiements', 'Payout history')}</SectionLabel>
          <div className="space-y-2">
            {historyPayouts.map(payout => (
              <PromoCard key={payout.id}>
                <div className="flex items-center justify-between mb-1">
                  <div className="min-w-0">
                    <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 620, margin: 0 }}>{payout.promoterLabel}</p>
                    {payout.period_label && <p style={{ color: T3, fontSize: 11, margin: 0 }}>{payout.period_label}</p>}
                  </div>
                  <div className="text-right flex-none">
                    <p style={{ color: T1, fontSize: 15, fontWeight: 700, margin: 0 }}>{Number(payout.amount).toFixed(2)}€</p>
                    <div className="mt-1">{statusPill(payout.status)}</div>
                  </div>
                </div>
                <p style={{ color: T3, fontSize: 10.5, margin: 0 }}>
                  {payout.transfer_reference && <>{payout.transfer_reference} · </>}
                  {payout.paid_at && (
                    <>
                      <CheckCircle2 className="h-3 w-3 inline mr-0.5" style={{ color: POS, marginTop: -2 }} />
                      {t('promoterSettlement.confirmedOn')} {new Date(payout.paid_at).toLocaleDateString('fr-FR')}
                    </>
                  )}
                </p>
              </PromoCard>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
