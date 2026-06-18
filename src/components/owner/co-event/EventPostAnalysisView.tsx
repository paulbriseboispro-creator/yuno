import { useEffect, useRef, useState } from 'react';
import { Trophy, BarChart3, Users, Lightbulb, LucideIcon } from 'lucide-react';
import { usePostEventAnalysis } from '@/hooks/usePostEventAnalysis';
import { useLanguage } from '@/contexts/LanguageContext';
import { PostEventOverview } from '@/components/hype/PostEventOverview';
import { PostEventExtendedStats } from '@/components/hype/PostEventExtendedStats';
import { PostEventTimeline } from '@/components/hype/PostEventTimeline';
import { PostEventWhatWorked } from '@/components/hype/PostEventWhatWorked';
import { PostEventCustomerInsights } from '@/components/hype/PostEventCustomerInsights';
import { PostEventNotes } from '@/components/hype/PostEventNotes';
import { PostEventSuggestions } from '@/components/hype/PostEventSuggestions';

// ─── Yuno pro-dashboard design tokens ─────────────────────────────────────────
const RED = '#E8192C';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';

interface Props {
  /** The single event to analyse. The hook seeds its selected event from this once,
   *  so callers MUST mount this view with `key={eventId}` to re-seed on event change. */
  eventId: string;
  /** Venue scope (club dashboard). */
  venueId: string | null;
  /** Organizer scope (organizer app). When set with a null venueId, the engine
   *  runs org-scoped: tickets + tables across the organizer's events, no drinks. */
  organizerUserId?: string | null;
}

type SectionId = 'verdict' | 'performance' | 'audience' | 'advice';

/** Chapter divider: icon + title + one-line subtitle, gives the page a spine. */
function ChapterHeader({ icon: Icon, title, sub }: { icon: LucideIcon; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
        style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, color: T2 }}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <h2 style={{ color: T1, fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.1 }}>{title}</h2>
        <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>{sub}</p>
      </div>
    </div>
  );
}

/**
 * Verdict-first post-event analysis, scoped to ONE event and stripped of the event
 * picker — the landing view of an event's analytics.
 *
 * Structured as scannable chapters (Verdict → Performance → Audience → Takeaways)
 * with an anchor-nav spine that tracks the section in view, so a non-data user reads
 * top-to-bottom or jumps straight to what they care about.
 *
 * Reuses the existing engine (usePostEventAnalysis) and PostEvent* components, so
 * there is one source of truth for "was this night a success?". Not plan-gated.
 */
export function EventPostAnalysisView({ eventId, venueId, organizerUserId }: Props) {
  const { t } = useLanguage();
  const { loading, postEventData, saveNotes } = usePostEventAnalysis(venueId, eventId, organizerUserId);
  const [active, setActive] = useState<SectionId>('verdict');
  const refs = {
    verdict: useRef<HTMLDivElement>(null),
    performance: useRef<HTMLDivElement>(null),
    audience: useRef<HTMLDivElement>(null),
    advice: useRef<HTMLDivElement>(null),
  };

  // Track which chapter is in view to light up the nav.
  useEffect(() => {
    if (!postEventData) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.getAttribute('data-sec') as SectionId);
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: [0, 0.25, 0.5, 1] },
    );
    Object.values(refs).forEach((r) => r.current && obs.observe(r.current));
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postEventData]);

  if (!venueId && !organizerUserId) return null;

  if (loading && !postEventData) {
    return (
      <div className="space-y-4">
        {[120, 56, 160, 120].map((h, i) => (
          <div key={i} style={{ height: h, background: 'rgba(255,255,255,0.04)', borderRadius: 14 }} className="animate-pulse" />
        ))}
      </div>
    );
  }

  if (!postEventData) return null;

  const nav: { id: SectionId; label: string; icon: LucideIcon }[] = [
    { id: 'verdict', label: t('postEvent.secVerdict'), icon: Trophy },
    { id: 'performance', label: t('postEvent.secPerformance'), icon: BarChart3 },
    { id: 'audience', label: t('postEvent.secAudience'), icon: Users },
    { id: 'advice', label: t('postEvent.secAdvice'), icon: Lightbulb },
  ];

  const goTo = (id: SectionId) => refs[id].current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="space-y-6">
      {/* Anchor nav — sticky spine, parks just under the page header */}
      <div
        className="sticky top-[60px] sm:top-[68px] z-20 flex gap-1.5 overflow-x-auto no-scrollbar px-1 py-2 rounded-2xl"
        style={{ background: 'rgba(10,10,12,0.72)', backdropFilter: 'blur(10px)' }}
      >
        {nav.map(({ id, label, icon: Icon }) => {
          const on = active === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => goTo(id)}
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-full whitespace-nowrap cursor-pointer transition-colors duration-200 flex-none"
              style={{
                background: on ? 'rgba(232,25,44,0.12)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${on ? 'rgba(232,25,44,0.30)' : BORDER}`,
                color: on ? RED : T2,
                fontSize: 12.5,
                fontWeight: 600,
                backdropFilter: 'blur(8px)',
              }}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Chapter 1 — Verdict */}
      <div ref={refs.verdict} data-sec="verdict" style={{ scrollMarginTop: 64 }}>
        <PostEventOverview data={postEventData} />
      </div>

      {/* Chapter 2 — Performance */}
      <div ref={refs.performance} data-sec="performance" className="space-y-4" style={{ scrollMarginTop: 64 }}>
        <ChapterHeader icon={BarChart3} title={t('postEvent.secPerformance')} sub={t('postEvent.secPerformanceSub')} />
        <PostEventExtendedStats stats={postEventData.extendedStats} />
        <PostEventTimeline timeline={postEventData.timeline} insights={postEventData.timelineInsights} />
      </div>

      {/* Chapter 3 — Audience */}
      <div ref={refs.audience} data-sec="audience" className="space-y-4" style={{ scrollMarginTop: 64 }}>
        <ChapterHeader icon={Users} title={t('postEvent.secAudience')} sub={t('postEvent.secAudienceSub')} />
        <PostEventCustomerInsights insights={postEventData.customerInsights} />
      </div>

      {/* Chapter 4 — Takeaways */}
      <div ref={refs.advice} data-sec="advice" className="space-y-4" style={{ scrollMarginTop: 64 }}>
        <ChapterHeader icon={Lightbulb} title={t('postEvent.secAdvice')} sub={t('postEvent.secAdviceSub')} />
        <PostEventWhatWorked items={postEventData.whatWorked} />
        <PostEventSuggestions suggestions={postEventData.suggestions} />
      </div>

      {!postEventData.isAggregate && (
        <PostEventNotes notes={postEventData.notes} onSave={saveNotes} />
      )}
    </div>
  );
}
