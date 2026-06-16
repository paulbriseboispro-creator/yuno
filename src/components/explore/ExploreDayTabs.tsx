import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { useLanguage } from '@/contexts/LanguageContext';
import { ExploreListRow } from './ExploreListRow';
import { EventCardData } from './EventCard';
import type { ExploreFilters } from './FilterPage';

export interface WeekDayData {
  key: string;
  date: Date;
  events: EventCardData[];
}

interface ExploreDayTabsProps {
  weekData: WeekDayData[];
  chipGenres: string[];
  freeOnly: boolean;
  exploreFilters?: ExploreFilters;
}

const MAX_SHOWN = 4;

const normGenre = (g: string) =>
  g.toLowerCase().replace(/[-_/]/g, ' ').replace(/\s+/g, ' ').trim();

export function ExploreDayTabs({ weekData, chipGenres, freeOnly, exploreFilters }: ExploreDayTabsProps) {
  const { t } = useLanguage();
  const [selIdx, setSelIdx] = useState(0);

  if (weekData.length === 0) {
    return (
      <p
        className="font-mono px-4 py-4 text-center"
        style={{ fontSize: '13px', color: '#65656F' }}
      >
        {t('explore.noEventWeek')}
      </p>
    );
  }

  const safeIdx = Math.min(selIdx, weekData.length - 1);
  const day = weekData[safeIdx];

  // Apply chip filters to the day's events
  let dayEvents = day.events;
  if (freeOnly) dayEvents = dayEvents.filter(e => e.minPrice === 0);
  if (chipGenres.length > 0) {
    const normalizedChips = chipGenres.map(normGenre);
    dayEvents = dayEvents.filter(e => e.genres.some(g => normalizedChips.includes(normGenre(g))));
  }
  // Apply FilterPage filters
  if (exploreFilters?.eventTypes && exploreFilters.eventTypes.length > 0) {
    dayEvents = dayEvents.filter(e =>
      e.eventType === 'affiliate' || exploreFilters.eventTypes.includes(e.eventType || 'club')
    );
  }
  if (exploreFilters?.genres && exploreFilters.genres.length > 0) {
    const normalizedFilterGenres = exploreFilters.genres.map(normGenre);
    dayEvents = dayEvents.filter(e => e.genres.some(g => normalizedFilterGenres.includes(normGenre(g))));
  }

  const shown = dayEvents.slice(0, MAX_SHOWN);
  const extraCount = dayEvents.length - MAX_SHOWN;

  return (
    <div>
      {/* Day selector tabs */}
      <div
        className="flex gap-2 overflow-x-auto"
        style={{ paddingBottom: 16, paddingLeft: 20, paddingRight: 20, scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
      >
        {weekData.map((d, i) => {
          const on = i === safeIdx;
          return (
            <button
              key={d.key}
              onClick={() => setSelIdx(i)}
              className="shrink-0 text-center"
              style={{
                padding: '8px 14px',
                borderRadius: '14px',
                border: `1px solid ${on ? '#E8192C' : 'rgba(255,255,255,0.14)'}`,
                background: on ? '#E8192C' : '#141417',
                cursor: 'pointer',
              }}
            >
              <p
                className="font-mono"
                style={{ fontSize: '9.5px', letterSpacing: '0.06em', color: on ? 'rgba(255,255,255,0.85)' : '#65656F', margin: 0 }}
              >
                {d.key}
              </p>
              <p
                className="font-display font-bold"
                style={{ fontSize: '17px', color: '#fff', lineHeight: 1.15, margin: 0 }}
              >
                {format(d.date, 'dd')}
              </p>
              {/* Event indicator dots — up to 3, scaling with the number of parties that day.
                  Fixed-height row so days with no event keep the same card height. */}
              <div
                style={{
                  display: 'flex',
                  gap: '3px',
                  justifyContent: 'center',
                  alignItems: 'center',
                  height: '5px',
                  marginTop: '4px',
                }}
              >
                {Array.from({ length: Math.min(d.events.length, 3) }).map((_, di) => (
                  <span
                    key={di}
                    style={{
                      width: '4px',
                      height: '4px',
                      borderRadius: '50%',
                      background: on ? 'rgba(255,255,255,0.9)' : '#E8192C',
                    }}
                  />
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* Event list */}
      <div style={{ padding: '0 20px' }}>
        {shown.length === 0 ? (
          <p
            className="font-mono py-4 text-center"
            style={{ fontSize: '13px', color: '#65656F' }}
          >
            {t('explore.noEventDay')}
          </p>
        ) : (
          <>
            {shown.map((event, i) => (
              <div
                key={event.id}
                style={{
                  borderTop: i === 0 ? '1px solid rgba(255,255,255,0.08)' : 'none',
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <ExploreListRow event={event} />
              </div>
            ))}

            {extraCount > 0 && (
              <button
                className="w-full flex items-center justify-center gap-1.5 font-mono font-semibold"
                style={{
                  background: '#141417',
                  border: '1px solid rgba(255,255,255,0.14)',
                  color: '#fff',
                  borderRadius: '13px',
                  padding: '13px',
                  fontSize: '13.5px',
                  cursor: 'pointer',
                  marginTop: '14px',
                }}
              >
                voir les {dayEvents.length} events
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
