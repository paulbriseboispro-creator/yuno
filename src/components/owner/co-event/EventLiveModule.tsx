import { motion } from 'framer-motion';
import { Radio } from 'lucide-react';
import { useLiveNightData, TimeWindow } from '@/hooks/useLiveNightData';
import { LiveKPIBar } from '@/components/live/LiveKPIBar';
import { LiveAlerts } from '@/components/live/LiveAlerts';
import { LiveActivityFeed } from '@/components/live/LiveActivityFeed';
import { LiveOrderPipeline } from '@/components/live/LiveOrderPipeline';
import { LiveStaffActivity } from '@/components/live/LiveStaffActivity';
import { LiveEntryFlow } from '@/components/live/LiveEntryFlow';
import { LiveAdvancedMetricsBar } from '@/components/live/LiveAdvancedMetrics';
import { LiveVisitorsPanel } from '@/components/live/LiveVisitorsPanel';
import { Skeleton } from '@/components/ui/skeleton';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { useLanguage } from '@/contexts/LanguageContext';

interface Props {
  eventId: string;
  venueId: string | null;
}

/**
 * Reusable live night module strictly scoped to one event.
 * Powered by useLiveNightData with a forced scopedEventId.
 */
export function EventLiveModule({ eventId, venueId }: Props) {
  const { t } = useLanguage();
  const { plan } = useSubscriptionPlan();
  // Collab plan + Pro/Elite get live visitors. Solo organizers always get it (no plan).
  const hasLiveVisitorsAccess = !venueId || plan === 'pro' || plan === 'elite' || plan === 'collab';
  const {
    kpis, feed, alerts, pipeline, staffActivity, entryFlow, advancedMetrics,
    activeEvent, loading, isPaused, timeWindow,
    setIsPaused, setTimeWindow, dismissAlert,
  } = useLiveNightData(venueId, eventId);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-24" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  const timeWindows: { key: TimeWindow; label: string; isLive?: boolean }[] = [
    { key: 'live', label: 'Live (10 min)', isLive: true },
    { key: '1h', label: '1h' },
    { key: 'full', label: t('coEvent.fullEvent') },
  ];

  return (
    <div className="space-y-4">
      {/* Header: event + time window */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      >
        <div className="flex items-center gap-3">
          <Radio className="h-4 w-4 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">{activeEvent?.title || t('coEvent.eventFallback')}</h2>
            <p className="text-xs text-muted-foreground">{t('coEvent.coEventModeNote')}</p>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-xl bg-white/[0.03] border border-white/[0.06] p-1">
          {timeWindows.map(tw => (
            <button
              key={tw.key}
              onClick={() => setTimeWindow(tw.key)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
                timeWindow === tw.key
                  ? 'bg-primary/20 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tw.isLive && timeWindow === tw.key && (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
              )}
              {tw.label}
            </button>
          ))}
        </div>
      </motion.div>

      <LiveAlerts alerts={alerts} onDismiss={dismissAlert} />
      <LiveKPIBar kpis={kpis} />

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
        <LiveAdvancedMetricsBar metrics={advancedMetrics} />
      </motion.div>

      {/* Live visitors funnel — Pro/Elite/Collab clubs + organizers */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.09 }}>
        <LiveVisitorsPanel
          venueId={venueId}
          eventId={eventId}
          hasAccess={hasLiveVisitorsAccess}
        />
      </motion.div>

      {(pipeline.pending + pipeline.paid + pipeline.ready + pipeline.served + pipeline.refunded) > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <LiveOrderPipeline pipeline={pipeline} />
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <LiveActivityFeed feed={feed} isPaused={isPaused} onTogglePause={() => setIsPaused(!isPaused)} />
        </motion.div>
        <div className="space-y-4">
          {staffActivity.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <LiveStaffActivity staff={staffActivity} />
            </motion.div>
          )}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
            <LiveEntryFlow entryFlow={entryFlow} totalEntries={kpis.entriesCount} />
          </motion.div>
        </div>
      </div>
    </div>
  );
}
