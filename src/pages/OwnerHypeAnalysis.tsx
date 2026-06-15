import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { OwnerHeader } from '@/components/OwnerHeader';
import { LanguageSelector } from '@/components/LanguageSelector';
import { HypeScoreSection } from '@/components/hype/HypeScoreSection';
import { HypeBaselineForm } from '@/components/hype/HypeBaselineForm';
import { PostEventAnalysisSection } from '@/components/hype/PostEventAnalysisSection';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useHypeBaseline, isBaselineConfigured } from '@/hooks/useHypeBaseline';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { Flame, BarChart3, Calendar, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { BrandedLoader } from '@/components/BrandedLoader';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';

interface UpcomingEvent {
  id: string;
  title: string;
  start_at: string;
}

export default function OwnerHypeAnalysis() {
  const { t, language } = useLanguage();
  const { venueId, loading: venueLoading } = useVenueContext();
  const [activeTab, setActiveTab] = useState<'pre-event' | 'post-event'>('pre-event');
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [showEventPicker, setShowEventPicker] = useState(false);

  // Baseline calibration — owned here so the quick-access works from any tab.
  const { baseline, saving, save } = useHypeBaseline(venueId);
  const [showBaselineForm, setShowBaselineForm] = useState(false);
  const [baselineVersion, setBaselineVersion] = useState(0);
  const baselineSet = isBaselineConfigured(baseline);

  const handleSaveBaseline = async (values: Parameters<typeof save>[0]) => {
    const ok = await save(values);
    if (ok) setBaselineVersion((v) => v + 1);
    return ok;
  };

  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  useEffect(() => {
    if (!venueId) return;
    const fetchEvents = async () => {
      const { data } = await supabase
        .from('events')
        .select('id, title, start_at')
        .eq('venue_id', venueId)
        .eq('is_active', true)
        .gte('end_at', new Date().toISOString())
        .order('start_at', { ascending: true })
        .limit(20);

      setUpcomingEvents(data || []);
      if (data && data.length > 0 && !selectedEventId) {
        setSelectedEventId(data[0].id);
      }
    };
    fetchEvents();
  }, [venueId]);

  if (venueLoading) return <BrandedLoader />;

  if (!venueId) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#000' }}>
        <p style={{ color: T3, fontSize: 14 }}>{t('owner.noVenueAssigned')}</p>
      </div>
    );
  }

  const tabs = [
    { id: 'pre-event' as const, label: t('owner.preEvent'), icon: Flame },
    { id: 'post-event' as const, label: t('owner.postEvent'), icon: BarChart3 },
  ];

  const selectedEvent = upcomingEvents.find(e => e.id === selectedEventId);

  return (
    <div className="min-h-screen pb-24" style={{ background: '#000' }}>
      {/* Ambient vignette */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }}
      />

      <OwnerHeader
        title={t('owner.hypeAnalysis')}
        showBackButton
        backTo="/owner/dashboard"
        rightContent={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowBaselineForm(true)}
              title={t('baseline.title')}
              className="flex items-center gap-1.5 h-9 px-3 rounded-xl cursor-pointer transition-all duration-150"
              style={{
                background: baselineSet ? INNER_BG : 'rgba(232,25,44,0.1)',
                border: `1px solid ${baselineSet ? BORDER : 'rgba(232,25,44,0.25)'}`,
                color: baselineSet ? T2 : RED,
                fontSize: 12.5,
                fontWeight: 560,
              }}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('baseline.quickAccess')}</span>
            </button>
            <LanguageSelector />
          </div>
        }
      />

      <div className="relative z-10 mx-auto max-w-4xl px-4 sm:px-6 pt-2 pb-4">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>

          {/* Tab bar */}
          <div className="flex gap-0.5 mb-5" style={{ borderBottom: `1px solid ${BORDER}` }}>
            {tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className="relative inline-flex items-center gap-2 px-4 py-3 cursor-pointer transition-colors duration-150"
                  style={{ color: isActive ? T1 : T3, fontSize: 13.5, fontWeight: 560 }}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  {isActive && (
                    <span
                      className="absolute left-3 right-3 rounded-full"
                      style={{ bottom: -1, height: 2, background: RED, boxShadow: `0 0 10px rgba(232,25,44,0.6)` }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <AnimatePresence mode="wait">
            {activeTab === 'pre-event' && (
              <motion.div
                key="pre-event"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                <p style={{ color: T3, fontSize: 13 }}>{t('owner.anticipateHype')}</p>

                {/* Event picker */}
                {upcomingEvents.length > 0 ? (
                  <div className="relative">
                    <button
                      onClick={() => setShowEventPicker(!showEventPicker)}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-xl cursor-pointer transition-all duration-150"
                      style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Calendar className="h-4 w-4 flex-none" style={{ color: T3 }} />
                        <span className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>
                          {selectedEvent ? selectedEvent.title : t('hype.selectEvent')}
                        </span>
                        {selectedEvent && (
                          <span className="flex-none" style={{ color: T3, fontSize: 12 }}>
                            {format(new Date(selectedEvent.start_at), 'EEE d MMM', { locale: dateLocale })}
                          </span>
                        )}
                      </div>
                      <ChevronDown className="h-4 w-4 flex-none ml-2" style={{ color: T3 }} />
                    </button>

                    <AnimatePresence>
                      {showEventPicker && (
                        <motion.div
                          initial={{ opacity: 0, y: -8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.15 }}
                          className="absolute top-full left-0 right-0 mt-1 rounded-xl overflow-hidden z-20"
                          style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, boxShadow: '0 20px 40px -12px rgba(0,0,0,0.9)' }}
                        >
                          {upcomingEvents.map(event => (
                            <button
                              key={event.id}
                              onClick={() => { setSelectedEventId(event.id); setShowEventPicker(false); }}
                              className="w-full flex items-center justify-between px-4 py-3 cursor-pointer transition-all duration-150 text-left"
                              style={{
                                borderBottom: '1px solid rgba(255,255,255,0.04)',
                                background: selectedEventId === event.id ? 'rgba(232,25,44,0.06)' : 'transparent',
                              }}
                            >
                              <span style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{event.title}</span>
                              <span style={{ color: T3, fontSize: 12, flexShrink: 0 }}>
                                {format(new Date(event.start_at), 'EEE d MMM', { locale: dateLocale })}
                              </span>
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ) : (
                  <div className="text-center py-4 px-4 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                    <p style={{ color: T3, fontSize: 13 }}>{t('hype.noUpcomingEvents')}</p>
                  </div>
                )}

                <HypeScoreSection
                  venueId={venueId}
                  eventId={selectedEventId}
                  baselineSet={baselineSet}
                  onEditBaseline={() => setShowBaselineForm(true)}
                  baselineVersion={baselineVersion}
                />
              </motion.div>
            )}

            {activeTab === 'post-event' && (
              <motion.div
                key="post-event"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                <p style={{ color: T3, fontSize: 13, marginBottom: 16 }}>{t('owner.analyzeEvents')}</p>
                <PostEventAnalysisSection venueId={venueId} />
              </motion.div>
            )}
          </AnimatePresence>

        </motion.div>
      </div>

      <HypeBaselineForm
        open={showBaselineForm}
        initial={baseline}
        saving={saving}
        onClose={() => setShowBaselineForm(false)}
        onSubmit={handleSaveBaseline}
      />
    </div>
  );
}
