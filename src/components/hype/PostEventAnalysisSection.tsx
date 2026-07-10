import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, ChevronDown, Search, BarChart3, X } from 'lucide-react';
import { usePostEventAnalysis } from '@/hooks/usePostEventAnalysis';
import { PostEventOverview } from './PostEventOverview';
import { PostEventExtendedStats } from './PostEventExtendedStats';
import { PostEventTimeline } from './PostEventTimeline';
import { PostEventWhatWorked } from './PostEventWhatWorked';
import { PostEventCustomerInsights } from './PostEventCustomerInsights';
import { PostEventNotes } from './PostEventNotes';
import { PostEventSuggestions } from './PostEventSuggestions';
import { PostEventAIInsights } from './PostEventAIInsights';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const INNER_BG = 'rgba(255,255,255,0.032)';

interface PostEventAnalysisSectionProps {
  venueId: string | null;
}

export function PostEventAnalysisSection({ venueId }: PostEventAnalysisSectionProps) {
  const { language, t } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const [showPicker, setShowPicker] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  const {
    loading,
    events,
    filteredEvents,
    selectedEventId,
    setSelectedEventId,
    postEventData,
    saveNotes,
    searchQuery,
    setSearchQuery,
  } = usePostEventAnalysis(venueId);

  const allEventsLabel = t('postEvent.allEventsAverage');

  // — Loading skeleton
  if (loading && !postEventData && events.length === 0) {
    return (
      <div className="space-y-4">
        {[48, 128, 80, 192].map((h, i) => (
          <div key={i} style={{ height: h, background: 'rgba(255,255,255,0.04)', borderRadius: 14 }} className="animate-pulse" />
        ))}
      </div>
    );
  }

  // — Empty state
  if (events.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center py-16"
      >
        <Calendar className="h-10 w-10 mx-auto mb-4" style={{ color: T3 }} />
        <h3 style={{ color: T1, fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
          {t('postEvent.noPastEventsLabel')}
        </h3>
        <p style={{ color: T3, fontSize: 13, maxWidth: 320, margin: '0 auto' }}>
          {t('postEvent.postAnalysisAvailable')}
        </p>
      </motion.div>
    );
  }

  const selectedEvent = events.find(e => e.id === selectedEventId);
  const displayLabel = selectedEventId === null
    ? allEventsLabel
    : selectedEvent
      ? `${selectedEvent.title} — ${format(selectedEvent.date, 'd MMM yyyy', { locale: dateLocale })}`
      : t('postEvent.selectEventLabel');

  return (
    <div className="space-y-4">
      {/* Event selector row */}
      <div className="flex gap-2">
        {/* Custom dropdown trigger */}
        <div className="relative flex-1">
          <button
            onClick={() => { setShowPicker(!showPicker); setShowSearch(false); }}
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl cursor-pointer transition-all duration-150"
            style={{ background: INNER_BG, border: `1px solid ${showPicker ? 'rgba(255,255,255,0.18)' : BORDER}` }}
          >
            <span className="flex items-center gap-2 min-w-0">
              {selectedEventId === null
                ? <BarChart3 className="h-4 w-4 flex-none" style={{ color: T3 }} />
                : <Calendar className="h-4 w-4 flex-none" style={{ color: T3 }} />
              }
              <span className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>
                {displayLabel}
              </span>
            </span>
            <motion.div animate={{ rotate: showPicker ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown className="h-4 w-4 flex-none ml-2" style={{ color: T3 }} />
            </motion.div>
          </button>

          {/* Dropdown */}
          <AnimatePresence>
            {showPicker && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
                className="absolute top-full left-0 right-0 mt-1 z-30 overflow-hidden rounded-xl"
                style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, boxShadow: '0 20px 40px -12px rgba(0,0,0,0.95)', maxHeight: 320, overflowY: 'auto' }}
              >
                {/* Search inside dropdown */}
                <div className="sticky top-0 p-2" style={{ background: '#0a0a0c', borderBottom: `1px solid ${F_BORDER}` }}>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: T3 }} />
                    <input
                      placeholder={t('postEvent.searchEventsLabel')}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full outline-none"
                      style={{
                        background: INNER_BG,
                        border: `1px solid ${BORDER}`,
                        borderRadius: 8,
                        padding: '7px 28px 7px 32px',
                        color: T1,
                        fontSize: 12.5,
                        fontFamily: 'inherit',
                      }}
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer"
                        style={{ color: T3 }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* All events option */}
                <button
                  onClick={() => { setSelectedEventId(null); setShowPicker(false); }}
                  className="w-full flex items-center gap-2 px-4 py-3 text-left cursor-pointer transition-all duration-150"
                  style={{
                    borderBottom: `1px solid ${F_BORDER}`,
                    background: selectedEventId === null ? 'rgba(232,25,44,0.06)' : 'transparent',
                  }}
                >
                  <BarChart3 className="h-4 w-4 flex-none" style={{ color: selectedEventId === null ? RED : T3 }} />
                  <div>
                    <p style={{ color: selectedEventId === null ? T1 : T2, fontSize: 13.5, fontWeight: 560 }}>
                      {allEventsLabel}
                    </p>
                    <p style={{ color: T3, fontSize: 11 }}>
                      {t('postEvent.eventsAnalyzedCount').replace('{{count}}', String(events.length))}
                    </p>
                  </div>
                </button>

                {/* Event list */}
                {filteredEvents.length === 0 ? (
                  <div className="py-6 text-center" style={{ color: T3, fontSize: 13 }}>
                    {t('postEvent.noResultsLabel')}
                  </div>
                ) : (
                  filteredEvents.map(event => (
                    <button
                      key={event.id}
                      onClick={() => { setSelectedEventId(event.id); setShowPicker(false); setSearchQuery(''); }}
                      className="w-full flex items-center justify-between px-4 py-3 text-left cursor-pointer transition-all duration-150"
                      style={{
                        borderBottom: `1px solid ${F_BORDER}`,
                        background: selectedEventId === event.id ? 'rgba(232,25,44,0.06)' : 'transparent',
                      }}
                    >
                      <span style={{ color: selectedEventId === event.id ? T1 : T2, fontSize: 13.5, fontWeight: 560 }}>
                        {event.title}
                      </span>
                      <span style={{ color: T3, fontSize: 11.5, flexShrink: 0, marginLeft: 12 }}>
                        {format(event.date, 'EEEE d MMM', { locale: dateLocale })}
                      </span>
                    </button>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Search toggle */}
        <button
          onClick={() => { setShowSearch(!showSearch); setShowPicker(false); }}
          className="w-12 h-12 flex items-center justify-center rounded-xl cursor-pointer transition-all duration-150 flex-none"
          style={{
            background: showSearch ? 'rgba(232,25,44,0.10)' : INNER_BG,
            border: `1px solid ${showSearch ? 'rgba(232,25,44,0.22)' : BORDER}`,
            color: showSearch ? RED : T3,
          }}
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      {/* External search bar */}
      <AnimatePresence>
        {showSearch && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: T3 }} />
              <input
                placeholder={t('postEvent.searchEventsLabel')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="w-full outline-none"
                style={{
                  background: INNER_BG,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 12,
                  padding: '11px 36px',
                  color: T1,
                  fontSize: 13,
                  fontFamily: 'inherit',
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer"
                  style={{ color: T3 }}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Quick results */}
            {searchQuery && filteredEvents.length > 0 && (
              <div className="mt-2 rounded-xl overflow-hidden" style={{ background: '#0a0a0c', border: `1px solid ${BORDER}` }}>
                {filteredEvents.slice(0, 5).map(event => (
                  <button
                    key={event.id}
                    onClick={() => { setSelectedEventId(event.id); setShowSearch(false); setSearchQuery(''); }}
                    className="w-full flex items-center justify-between px-4 py-3 text-left cursor-pointer transition-all duration-150"
                    style={{ borderBottom: `1px solid ${F_BORDER}` }}
                  >
                    <span style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{event.title}</span>
                    <span style={{ color: T3, fontSize: 11.5, flexShrink: 0, marginLeft: 12 }}>
                      {format(event.date, 'EEE d MMM yyyy', { locale: dateLocale })}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Analysis content */}
      {loading ? (
        <div className="space-y-4">
          {[128, 80, 192].map((h, i) => (
            <div key={i} style={{ height: h, background: 'rgba(255,255,255,0.04)', borderRadius: 14 }} className="animate-pulse" />
          ))}
        </div>
      ) : postEventData && (
        <div className="space-y-4">
          <PostEventOverview data={postEventData} />
          <PostEventExtendedStats stats={postEventData.extendedStats} />
          <PostEventTimeline timeline={postEventData.timeline} insights={postEventData.timelineInsights} />
          <PostEventWhatWorked items={postEventData.whatWorked} />
          <PostEventCustomerInsights insights={postEventData.customerInsights} />
          {!postEventData.isAggregate && postEventData.eventId && (
            <PostEventAIInsights eventId={postEventData.eventId} stats={postEventData.rawStats} />
          )}
          {!postEventData.isAggregate && (
            <PostEventNotes notes={postEventData.notes} onSave={saveNotes} />
          )}
          <PostEventSuggestions suggestions={postEventData.suggestions} />
        </div>
      )}
    </div>
  );
}
