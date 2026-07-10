import { motion } from 'framer-motion';
import { Radio } from 'lucide-react';
import { OwnerHeader } from '@/components/OwnerHeader';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOwnerVenue } from '@/hooks/useOwnerVenue';
import { useLiveNightData, TimeWindow } from '@/hooks/useLiveNightData';
import { LiveKPIBar } from '@/components/live/LiveKPIBar';
import { LiveAlerts } from '@/components/live/LiveAlerts';
import { LiveActivityFeed } from '@/components/live/LiveActivityFeed';
import { LiveOrderPipeline } from '@/components/live/LiveOrderPipeline';
import { LiveStaffActivity } from '@/components/live/LiveStaffActivity';
import { LiveEntryFlow } from '@/components/live/LiveEntryFlow';
import { LiveAdvancedMetricsBar } from '@/components/live/LiveAdvancedMetrics';
import { BrandedLoader } from '@/components/BrandedLoader';
import { LiveVisitorsPanel } from '@/components/live/LiveVisitorsPanel';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED    = '#E8192C';
const POS    = '#34D399';
const T1     = 'rgba(255,255,255,0.96)';
const T2     = 'rgba(255,255,255,0.58)';
const T3     = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';

export default function OwnerLiveNight() {
  const { t } = useLanguage();
  const { venueId, venue, loading: venueLoading } = useOwnerVenue();
  const { plan } = useSubscriptionPlan();
  const hasLiveVisitorsAccess = plan === 'pro' || plan === 'elite';
  const {
    kpis, feed, alerts, pipeline, staffActivity, entryFlow, advancedMetrics,
    activeEvent, loading, isPaused, timeWindow,
    setIsPaused, setTimeWindow, dismissAlert,
  } = useLiveNightData(venueId);

  if (venueLoading || loading) return <BrandedLoader />;

  const timeWindows: { key: TimeWindow; label: string; isLive?: boolean }[] = [
    { key: 'live', label: t('live.liveWindow'), isLive: true },
    { key: '1h', label: '1h' },
    { key: 'full', label: t('live.fullNight') },
  ];

  return (
    <div className="min-h-screen pb-24" style={{ background: '#000' }}>
      {/* Ambient vignette */}
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }} />

      <OwnerHeader
        title={t('live.title')}
        showBackButton
        backTo="/owner/dashboard"
        rightContent={
          activeEvent ? (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full"
              style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.22)' }}>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: POS }} />
                <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: POS }} />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: POS }}>LIVE</span>
            </div>
          ) : undefined
        }
      />

      <div className="relative z-10 mx-auto max-w-7xl px-3 sm:px-6 pt-2 pb-4 space-y-4">
        {/* Event header + time window */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <Radio className="h-4 w-4 flex-shrink-0" style={{ color: T3 }} />
            <div>
              <h2 style={{ color: T1, fontSize: 14, fontWeight: 600 }}>
                {activeEvent ? activeEvent.title : venue?.name || t('live.title')}
              </h2>
              <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>
                {activeEvent ? t('live.eventActive') : t('live.noActiveEvent')}
              </p>
            </div>
          </div>

          {/* Time window selector */}
          <div className="flex items-center gap-0.5 p-1 rounded-xl"
            style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
            {timeWindows.map(tw => (
              <button key={tw.key} onClick={() => setTimeWindow(tw.key)}
                className="text-[12px] px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                style={timeWindow === tw.key
                  ? { background: `rgba(232,25,44,0.12)`, color: RED, fontWeight: 600, border: `1px solid rgba(232,25,44,0.2)` }
                  : { color: T3, border: '1px solid transparent' }}>
                {tw.isLive && timeWindow === tw.key && (
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: POS }} />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: POS }} />
                  </span>
                )}
                {tw.label}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Alerts */}
        <LiveAlerts alerts={alerts} onDismiss={dismissAlert} />

        {/* KPIs */}
        <LiveKPIBar kpis={kpis} />

        {/* Advanced metrics */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
          <LiveAdvancedMetricsBar metrics={advancedMetrics} />
        </motion.div>

        {/* Live visitors (Pro+) */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }}>
          <LiveVisitorsPanel
            venueId={venueId}
            eventId={activeEvent?.id || null}
            hasAccess={hasLiveVisitorsAccess}
            upgradeMessage={t('live.visitorsUpgrade')}
          />
        </motion.div>

        {/* Order Pipeline */}
        {(pipeline.pending + pipeline.paid + pipeline.preparing + pipeline.ready + pipeline.served + pipeline.refunded) > 0 && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <LiveOrderPipeline pipeline={pipeline} />
          </motion.div>
        )}

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <LiveActivityFeed feed={feed} isPaused={isPaused} onTogglePause={() => setIsPaused(!isPaused)} />
          </motion.div>
          <div className="space-y-4">
            {staffActivity.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
                <LiveStaffActivity staff={staffActivity} />
              </motion.div>
            )}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
              <LiveEntryFlow entryFlow={entryFlow} totalEntries={kpis.entriesCount} />
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
