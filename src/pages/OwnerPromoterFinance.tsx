import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { usePromoterScope } from '@/hooks/usePromoterScope';
import { getScopeFilter, scopeId } from '@/lib/promoterScopeHelpers';
import { useCollabReadOnly } from '@/hooks/useCollabReadOnly';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { toast } from 'sonner';
import { Clock, CheckCircle2, ShieldCheck, Download, Wallet } from 'lucide-react';
import {
  PromoHeader, PromoPage, PromoCard, StatTile, SectionLabel, PromoPill, PromoButton, PromoEmpty,
  RED, POS, WARN, T1, T2, T3, BORDER, TILE_BG,
} from '@/components/promoter/promoter-ui';

interface PromoterDebt {
  promoterId: string;
  promoterName: string;
  promoterIban: string | null;
  pendingConversions: number;
  pendingAmount: number;
}

interface Payout {
  id: string;
  promoter_id: string;
  amount: number;
  status: 'pending' | 'approved' | 'paid';
  period_label: string | null;
  approved_at: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  promoterName: string;
  promoterIban: string | null;
}

export default function OwnerPromoterFinance() {
  const scope = usePromoterScope();
  const sid = scopeId(scope);
  const scopeFilter = getScopeFilter(scope);
  const { basePath } = useDashboardMode();
  const { t, language } = useLanguage();
  const tt = (fr: string, en: string) => (language === 'fr' ? fr : en);
  const { canExport } = useCollabReadOnly();
  const [debts, setDebts] = useState<PromoterDebt[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!sid) return;
    try {
      const { data: promoters } = await supabase.from('promoters')
        .select('id, user_id, iban, promo_code')
        .eq(scopeFilter.column, sid);
      if (!promoters || promoters.length === 0) { setLoading(false); return; }

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

      const { data: pendingConvs } = await supabase.from('promoter_conversions')
        .select('promoter_id, commission')
        .in('promoter_id', promoterIds)
        .eq('status', 'pending');

      const debtMap = new Map<string, { count: number; amount: number }>();
      (pendingConvs || []).forEach(c => {
        const existing = debtMap.get(c.promoter_id) || { count: 0, amount: 0 };
        existing.count++;
        existing.amount += c.commission || 0;
        debtMap.set(c.promoter_id, existing);
      });

      const debtsList: PromoterDebt[] = [];
      debtMap.forEach((val, promoterId) => {
        const info = promoterInfoMap.get(promoterId);
        if (val.amount > 0) {
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

      const { data: payoutsData } = await supabase.from('promoter_payouts')
        .select('*').eq(scopeFilter.column, sid).order('created_at', { ascending: false });

      setPayouts((payoutsData || []).map(d => ({
        ...d,
        status: d.status as 'pending' | 'approved' | 'paid',
        promoterName: promoterInfoMap.get(d.promoter_id)?.name || 'N/A',
        promoterIban: promoterInfoMap.get(d.promoter_id)?.iban || null,
      })));
    } catch (err) {
      console.error(err);
      toast.error(t('promoterPayouts.loadError'));
    } finally {
      setLoading(false);
    }
  }, [sid]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // One-click atomic settle: pays out all pending commissions for a promoter,
  // flips their conversions to paid and resets their balance in one transaction.
  async function settleNow(promoterId: string) {
    if (!sid) return;
    setActing(true);
    try {
      const { data, error } = await supabase.rpc('settle_promoter_payout', { p_promoter_id: promoterId });
      if (error) throw error;
      const res = data as { settled?: boolean; amount?: number } | null;
      if (res?.settled) toast.success(tt(`Réglé : ${Number(res.amount).toFixed(2)}€`, `Settled: ${Number(res.amount).toFixed(2)}€`));
      else toast.info(tt('Rien à régler', 'Nothing to settle'));
      fetchData();
    } catch { toast.error(t('promoterPayouts.updateError')); }
    finally { setActing(false); }
  }

  async function updateStatus(id: string, newStatus: 'approved' | 'paid') {
    setActing(true);
    try {
      const updates: TablesUpdate<'promoter_payouts'> = { status: newStatus };
      if (newStatus === 'approved') updates.approved_at = new Date().toISOString();
      if (newStatus === 'paid') updates.paid_at = new Date().toISOString();
      const { error } = await supabase.from('promoter_payouts').update(updates).eq('id', id);
      if (error) throw error;

      if (newStatus === 'paid') {
        const payout = payouts.find(p => p.id === id);
        if (payout) {
          await supabase.from('promoter_conversions')
            .update({ status: 'paid', paid_at: new Date().toISOString() })
            .eq('promoter_id', payout.promoter_id)
            .eq('status', 'pending');

          const { data: promo } = await supabase.from('promoters')
            .select('pending_amount, total_paid')
            .eq('id', payout.promoter_id).maybeSingle();
          if (promo) {
            await supabase.from('promoters').update({
              pending_amount: 0,
              total_paid: (promo.total_paid || 0) + payout.amount,
            }).eq('id', payout.promoter_id);
          }
        }
      }

      toast.success(t('promoterPayouts.statusUpdated'));
      fetchData();
    } catch { toast.error(t('promoterPayouts.updateError')); }
    finally { setActing(false); }
  }

  function exportCSV() {
    const rows = [['Promoteur', 'Montant', 'Statut', 'Période', 'IBAN', 'Date'].join(',')];
    payouts.forEach(p => {
      rows.push([
        `"${p.promoterName}"`, p.amount.toFixed(2), p.status, `"${p.period_label || ''}"`,
        `"${p.promoterIban || ''}"`, new Date(p.created_at).toLocaleDateString(),
      ].join(','));
    });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `payouts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  const totalDebt = debts.reduce((s, d) => s + d.pendingAmount, 0);
  const totalApproved = payouts.filter(p => p.status === 'approved').reduce((s, p) => s + p.amount, 0);
  const totalPaid = payouts.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0);

  const statusPill = (s: string) =>
    s === 'paid' ? <PromoPill tone="success">{t('promoterPayouts.paid')}</PromoPill>
    : s === 'approved' ? <PromoPill tone="warn">{t('promoterPayouts.approved')}</PromoPill>
    : <PromoPill tone="muted">{t('promoterPayouts.pending')}</PromoPill>;

  const maskIban = (iban: string) => `${iban.slice(0, 4)}···${iban.slice(-4)}`;

  if (loading) return <OwnerPageSkeleton />;

  return (
    <>
      <PromoHeader
        title={t('promoterPayouts.title')}
        subtitle={tt('Soldez vos promoteurs en deux clics', 'Settle your promoters in two clicks')}
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
          <StatTile icon={Clock} value={`${totalDebt.toFixed(0)}€`} label={tt('À payer', 'To pay')} tone="red" />
          <StatTile icon={ShieldCheck} value={`${totalApproved.toFixed(0)}€`} label={t('promoterPayouts.approved')} tone="warn" />
          <StatTile icon={CheckCircle2} value={`${totalPaid.toFixed(0)}€`} label={t('promoterPayouts.paid')} tone="pos" />
        </div>

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
                        {tt(`${debt.pendingConversions} conversion${debt.pendingConversions > 1 ? 's' : ''} en attente`, `${debt.pendingConversions} pending conversion${debt.pendingConversions > 1 ? 's' : ''}`)}
                        {debt.promoterIban && <> · IBAN {maskIban(debt.promoterIban)}</>}
                      </p>
                    </div>
                    <p style={{ color: RED, fontSize: 18, fontWeight: 740, margin: 0, flex: 'none' }}>{debt.pendingAmount.toFixed(2)}€</p>
                  </div>
                  <PromoButton full size="sm" onClick={() => settleNow(debt.promoterId)} disabled={acting}>
                    <CheckCircle2 className="h-4 w-4" /> {tt(`Régler ${debt.pendingAmount.toFixed(0)}€ maintenant`, `Settle ${debt.pendingAmount.toFixed(0)}€ now`)}
                  </PromoButton>
                </PromoCard>
              ))}
            </div>
          </>
        )}

        {/* Payout history */}
        {payouts.length > 0 && (
          <>
            <SectionLabel>{tt('Historique des paiements', 'Payout history')}</SectionLabel>
            <div className="space-y-2.5">
              {payouts.map(payout => (
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
                  {(payout.approved_at || payout.paid_at) && (
                    <p style={{ color: T3, fontSize: 11, margin: 0 }}>
                      {payout.approved_at && <>{t('promoterPayouts.approvedOn')} {new Date(payout.approved_at).toLocaleDateString('fr-FR')}</>}
                      {payout.approved_at && payout.paid_at && ' · '}
                      {payout.paid_at && <>{t('promoterPayouts.paidOn')} {new Date(payout.paid_at).toLocaleDateString('fr-FR')}</>}
                    </p>
                  )}
                  {payout.status !== 'paid' && (
                    <div className="flex gap-2 mt-3">
                      {payout.status === 'pending' && (
                        <PromoButton variant="secondary" size="sm" onClick={() => updateStatus(payout.id, 'approved')} disabled={acting}>
                          <ShieldCheck className="h-4 w-4" />{t('promoterPayouts.approve')}
                        </PromoButton>
                      )}
                      {payout.status === 'approved' && (
                        <PromoButton size="sm" onClick={() => updateStatus(payout.id, 'paid')} disabled={acting}>
                          <CheckCircle2 className="h-4 w-4" />{t('promoterPayouts.markPaid')}
                        </PromoButton>
                      )}
                    </div>
                  )}
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
