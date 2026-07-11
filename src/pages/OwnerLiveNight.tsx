import { useState } from 'react';
import { motion } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { Radio, ChevronDown, ChevronUp, BarChart3, ChevronRight } from 'lucide-react';
import { OwnerHeader } from '@/components/OwnerHeader';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOwnerVenue } from '@/hooks/useOwnerVenue';
import { useLiveNightData } from '@/hooks/useLiveNightData';
import { LiveAlerts } from '@/components/live/LiveAlerts';
import { LiveOpsAlerts } from '@/components/live/LiveOpsAlerts';
import { LiveRadioFeed } from '@/components/live/LiveRadioFeed';
import { LivePulseHero } from '@/components/live/LivePulseHero';
import { LiveEventSelector } from '@/components/live/LiveEventSelector';
import { CapacityDialog } from '@/components/live/CapacityDialog';
import { DoorStation } from '@/components/live/stations/DoorStation';
import { BarStation } from '@/components/live/stations/BarStation';
import { VipStation } from '@/components/live/stations/VipStation';
import { CloakroomStation } from '@/components/live/stations/CloakroomStation';
import { StaffStation } from '@/components/live/stations/StaffStation';
import { BrandedLoader } from '@/components/BrandedLoader';
import { LiveVisitorsPanel } from '@/components/live/LiveVisitorsPanel';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { bucketHourParis } from '@/lib/liveops/nightWindow';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const POS    = '#34D399';
const T1     = 'rgba(255,255,255,0.96)';
const T3     = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';

export default function OwnerLiveNight() {
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const basePath = location.pathname.startsWith('/manager') ? '/manager' : '/owner';
  const isOwner = basePath === '/owner';
  const { venueId, venue, loading: venueLoading } = useOwnerVenue();
  const { plan } = useSubscriptionPlan();
  const hasLiveVisitorsAccess = plan === 'pro' || plan === 'elite';
  const {
    kpis, feed, alerts, pipeline, staffActivity, advancedMetrics,
    activeEvent, activeEvents, selectedEventId,
    extended, comparison, capacity,
    loading, isPaused,
    setIsPaused, setSelectedEventId, dismissAlert, refreshCapacity,
  } = useLiveNightData(venueId, undefined, { extended: true });

  const [capacityDialogOpen, setCapacityDialogOpen] = useState(false);
  const [showVisitors, setShowVisitors] = useState(false);

  if (venueLoading || loading) return <BrandedLoader />;

  // End of the night: the cloakroom becomes the hot station (retrieval rush).
  const parisHour = bucketHourParis(new Date().toISOString());
  const cloakroomFirst = parisHour >= 3 && parisHour < 7;

  // Ouvre le FAB assistant avec un point de situation pré-envoyé (le tool
  // get_live_ops côté owner-assistant lit l'état complet de la soirée).
  const triggerBriefing = () => {
    window.dispatchEvent(new CustomEvent('yuno:owner-assistant-prompt', {
      detail: { prompt: t('liveops.briefing.prompt') },
    }));
  };

  // Soirée terminée mais activité cette nuit → pont vers le Night Report IA.
  const nightEnded = !activeEvent && (kpis.entriesCount > 0 || kpis.ordersPlaced > 0);

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
        {/* Event header + selector */}
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
          <LiveEventSelector events={activeEvents} selectedId={selectedEventId} onSelect={setSelectedEventId} />
        </motion.div>

        {/* Alertes persistées du moteur serveur (cloche + push) — les signaux
            instantanés restent visibles dans les stations et via LiveAlerts */}
        {venueId && <LiveOpsAlerts venueId={venueId} basePath={basePath} />}
        <LiveAlerts alerts={alerts} onDismiss={dismissAlert} />

        {/* Pulse hero */}
        <LivePulseHero
          activeEvent={activeEvent}
          entriesCount={kpis.entriesCount}
          revenue={kpis.revenue}
          door={extended?.door ?? null}
          capacity={capacity}
          comparison={comparison}
          onEditCapacity={() => setCapacityDialogOpen(true)}
          onBriefing={isOwner ? triggerBriefing : undefined}
        />

        {/* Fin de soirée → Night Report IA (généré côté Hype, cache event_ai_reports) */}
        {nightEnded && isOwner && (
          <motion.button
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => navigate('/owner/hype')}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl cursor-pointer text-left"
            style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}
          >
            <div className="p-2 rounded-xl flex-none" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
              <BarChart3 className="h-4 w-4" style={{ color: '#E8192C' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{t('liveops.nightEnd.title')}</p>
              <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>{t('liveops.nightEnd.desc')}</p>
            </div>
            <ChevronRight className="h-4 w-4 flex-none" style={{ color: T3 }} />
          </motion.button>
        )}

        {/* Stations */}
        {extended && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
              <DoorStation door={extended.door} incidents={extended.incidents} attendanceRate={advancedMetrics.attendanceRate} />
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
              <BarStation bar={extended.bar} pipeline={pipeline} avgPrepMinutes={advancedMetrics.avgPrepMinutes} outOfStock={extended.outOfStock} />
            </motion.div>
            {cloakroomFirst ? (
              <>
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}>
                  <CloakroomStation cloakroom={extended.cloakroom} />
                </motion.div>
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                  <VipStation vip={extended.vip} eventEndAt={activeEvent?.end_at ?? null} />
                </motion.div>
              </>
            ) : (
              <>
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}>
                  <VipStation vip={extended.vip} eventEndAt={activeEvent?.end_at ?? null} />
                </motion.div>
                {(extended.cloakroom.active > 0 || extended.cloakroom.retrieved > 0) && (
                  <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                    <CloakroomStation cloakroom={extended.cloakroom} />
                  </motion.div>
                )}
              </>
            )}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }}>
              <StaffStation staff={staffActivity} />
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }}>
              <LiveRadioFeed feed={feed} incidents={extended.incidents} isPaused={isPaused} onTogglePause={() => setIsPaused(!isPaused)} />
            </motion.div>
          </div>
        )}

        {/* Web funnel — secondary at 1am, tucked away but reachable */}
        <div>
          <button
            onClick={() => setShowVisitors(v => !v)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg cursor-pointer transition-colors"
            style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T3, fontSize: 12 }}
          >
            {showVisitors ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {t('liveops.visitors.toggle')}
          </button>
          {showVisitors && (
            <div className="mt-3">
              <LiveVisitorsPanel
                venueId={venueId}
                eventId={activeEvent?.id || null}
                hasAccess={hasLiveVisitorsAccess}
                upgradeMessage={t('live.visitorsUpgrade')}
              />
            </div>
          )}
        </div>
      </div>

      {venueId && (
        <CapacityDialog
          open={capacityDialogOpen}
          onOpenChange={setCapacityDialogOpen}
          venueId={venueId}
          capacity={capacity}
          onSaved={refreshCapacity}
        />
      )}
    </div>
  );
}
