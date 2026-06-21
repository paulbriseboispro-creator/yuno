import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { BarChart3, Music, Euro, Bell } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDJData } from '@/contexts/DJDataContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  DJPage, DJHeading, PCard, MonthlyBars,
  POS, T1, T2, T3, WARN, INNER_BG, BORDER,
} from '@/components/dj/dj-ui';

export default function DJPayments() {
  const { language, t } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  // Money reads the unified agenda (all venue + organizer profiles) and is computed
  // from gig fees (fee_paid flag) — the dj_payments ledger is a legacy/secondary
  // table that's empty for most DJs, so the real "paid / owed" truth is on dj_sets.
  const { dj, allSets, venues } = useDJData();
  const [remindingId, setRemindingId] = useState<string | null>(null);

  const multiVenue = venues.length > 1;

  const feeSets = useMemo(() => allSets.filter(s => s.fee > 0), [allSets]);
  const received = useMemo(() => feeSets.filter(s => s.fee_paid).reduce((a, s) => a + s.fee, 0), [feeSets]);
  const pending = useMemo(() => feeSets.filter(s => !s.fee_paid).reduce((a, s) => a + s.fee, 0), [feeSets]);
  // Monthly earnings — paid gig fees grouped by gig month. allSets is ordered
  // ascending by start_time, so insertion order is already chronological.
  const earnData = useMemo(() => {
    const grouped: Record<string, number> = {};
    feeSets.filter(s => s.fee_paid).forEach(s => {
      const m = format(new Date(s.start_time), 'MMM yyyy', { locale: dateLocale });
      grouped[m] = (grouped[m] || 0) + s.fee;
    });
    return Object.entries(grouped).map(([month, amount]) => ({ month, amount }));
  }, [feeSets, dateLocale]);

  // B3 — let the DJ nudge the club about an unpaid fee. The RPC validates ownership,
  // rate-limits to once per 24h, and drops a notification in the owner's inbox.
  const handleRemind = async (setId: string) => {
    setRemindingId(setId);
    try {
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        fn: 'dj_remind_unpaid_fee',
        args: { p_dj_set_id: string },
      ) => Promise<{ data: { ok?: boolean; reason?: string } | null; error: unknown }>;
      const { data, error } = await rpc('dj_remind_unpaid_fee', { p_dj_set_id: setId });
      if (error) throw error;
      if (data?.ok) toast.success(t('dj.pay.reminded'));
      else if (data?.reason === 'rate_limited') toast(t('dj.pay.remindRateLimited'));
      else toast.error(t('dj.pay.remindError'));
    } catch {
      toast.error(t('dj.pay.remindError'));
    } finally {
      setRemindingId(null);
    }
  };

  if (!dj) return null;

  return (
    <DJPage>
      <DJHeading title={t('dj.myPayments')} subtitle={multiVenue ? t('dj.planning.allVenues') : dj.venue?.name} />

      {/* Money summary — received vs owed, aggregate across all profiles */}
      <div className="grid grid-cols-2 gap-3">
        <PCard>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: T3 }}>{t('dj.totalReceived')}</span>
            <span style={{ color: T3 }}><Euro className="w-4 h-4" /></span>
          </div>
          <div className="mt-3 text-[clamp(22px,3vw,30px)] font-[640] leading-none tabular-nums"
            style={{ color: received > 0 ? POS : T1, letterSpacing: '-0.025em' }}>
            {received} €
          </div>
        </PCard>
        <PCard>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: T3 }}>{t('dj.pending')}</span>
            <span style={{ color: T3 }}><BarChart3 className="w-4 h-4" /></span>
          </div>
          <div className="mt-3 text-[clamp(22px,3vw,30px)] font-[640] leading-none tabular-nums"
            style={{ color: pending > 0 ? WARN : T1, letterSpacing: '-0.025em' }}>
            {pending} €
          </div>
        </PCard>
      </div>

      {earnData.length > 0 && (
        <PCard
          icon={<BarChart3 className="w-4 h-4" />}
          title={t('dj.monthlyEarnings')}
          right={
            <div className="text-right">
              <div className="text-[clamp(20px,2.5vw,26px)] font-[640] tabular-nums leading-none" style={{ color: POS, letterSpacing: '-0.025em' }}>
                {received} €
              </div>
              <div className="text-xs mt-1" style={{ color: T3 }}>{t('dj.totalReceived')}</div>
            </div>
          }
        >
          <MonthlyBars data={earnData} />
        </PCard>
      )}

      {feeSets.length > 0 ? (
        <PCard icon={<Music className="w-4 h-4" />} title={t('dj.perSetBreakdown')} sub={multiVenue ? t('dj.planning.allVenues') : undefined}>
          <div className="space-y-2">
            {feeSets
              .slice()
              .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
              .map(set => (
                <div key={set.id} className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-3"
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                  <div className="min-w-0">
                    <p className="font-[560] text-sm truncate" style={{ color: T1 }}>
                      {set.event?.title || set.title || set.venue?.name || t('dj.set')}
                    </p>
                    <p className="text-xs truncate" style={{ color: T3 }}>
                      {format(new Date(set.start_time), 'dd MMM yyyy', { locale: dateLocale })}
                      {set.venue?.name && ` • ${set.venue.name}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-none">
                    {!set.fee_paid && set.venue_id && (
                      <button
                        onClick={() => handleRemind(set.id)}
                        disabled={remindingId === set.id}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors hover:bg-white/[0.06] disabled:opacity-50"
                        style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, color: T2 }}
                      >
                        <Bell className="h-3.5 w-3.5" />
                        {remindingId === set.id ? '…' : t('dj.pay.remind')}
                      </button>
                    )}
                    <div className="text-right">
                      <span className="font-[640] text-sm tabular-nums" style={{ color: set.fee_paid ? POS : WARN }}>{set.fee} €</span>
                      <p className="text-[10px]" style={{ color: T3 }}>{set.fee_paid ? t('dj.paid') : t('dj.pending')}</p>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </PCard>
      ) : (
        <PCard icon={<Euro className="w-4 h-4" />} title={t('dj.paymentHistory')}>
          <p className="text-sm" style={{ color: T3 }}>{t('dj.noPayments')}</p>
        </PCard>
      )}
    </DJPage>
  );
}
