import { motion } from 'framer-motion';
import { Users, Gauge, Sparkles, Pencil } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { ActiveEventInfo } from '@/hooks/useLiveNightData';
import type { DoorStats } from '@/lib/liveops/extended';
import { seriesValueAt, type ComparableNight } from '@/lib/liveops/compare';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED    = '#E8192C';
const POS    = '#34D399';
const AMBER  = '#FCD34D';
const T1     = 'rgba(255,255,255,0.96)';
const T2     = 'rgba(255,255,255,0.58)';
const T3     = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface Props {
  activeEvent: ActiveEventInfo | null;
  entriesCount: number;
  revenue: number;
  door: DoorStats | null;
  capacity: number | null;
  comparison: ComparableNight | null;
  onEditCapacity: () => void;
  onBriefing?: () => void;
}

function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
}

function PaceSparkline({ buckets }: { buckets: number[] }) {
  const max = Math.max(1, ...buckets);
  return (
    <div className="flex items-end gap-[3px] h-8">
      {buckets.map((v, i) => (
        <div
          key={i}
          className="w-[7px] rounded-sm"
          style={{
            height: `${Math.max(8, (v / max) * 100)}%`,
            background: i === buckets.length - 1
              ? RED
              : v > 0 ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.08)',
          }}
        />
      ))}
    </div>
  );
}

export function LivePulseHero({ activeEvent, entriesCount, revenue, door, capacity, comparison, onEditCapacity, onBriefing }: Props) {
  const { t } = useLanguage();

  // Computed on every render: live data flows in every few seconds anyway, so
  // the minute-level labels stay fresh without a dedicated ticker.
  let timing: { elapsedMin: number; remainingMin: number; progress: number } | null = null;
  if (activeEvent) {
    const startMs = new Date(activeEvent.start_at).getTime();
    const endMs = new Date(activeEvent.end_at).getTime();
    const current = Date.now();
    timing = {
      elapsedMin: Math.max(0, Math.floor((current - startMs) / 60_000)),
      remainingMin: Math.max(0, Math.floor((endMs - current) / 60_000)),
      progress: endMs > startMs ? Math.min(1, Math.max(0, (current - startMs) / (endMs - startMs))) : 0,
    };
  }

  const compare = comparison && timing
    ? {
        entries: seriesValueAt(comparison.entriesSeries, timing.elapsedMin),
        revenue: seriesValueAt(comparison.revenueSeries, timing.elapsedMin),
      }
    : null;

  const fillPct = capacity && capacity > 0 ? Math.min(100, Math.round((entriesCount / capacity) * 100)) : null;
  const gaugeColor = fillPct === null ? T3 : fillPct >= 95 ? RED : fillPct >= 80 ? AMBER : POS;

  const entriesDelta = compare ? entriesCount - compare.entries : null;
  const revenueDelta = compare ? revenue - compare.revenue : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden"
      style={{
        background: `radial-gradient(ellipse 70% 50% at 90% -20%, rgba(232,25,44,0.08) 0%, transparent 65%),
          linear-gradient(180deg,rgba(255,255,255,.03) 0%,rgba(255,255,255,.005) 100%),#0a0a0c`,
        border: `1px solid ${BORDER}`,
        borderRadius: 18,
        boxShadow: CARD_SHADOW,
      }}
    >
      <div className="pointer-events-none absolute -top-14 -right-14 w-52 h-52 rounded-full"
        style={{ background: 'rgba(232,25,44,0.10)', filter: 'blur(56px)' }} />
      <div className="pointer-events-none absolute -bottom-20 left-6 w-44 h-44 rounded-full"
        style={{ background: 'rgba(232,25,44,0.06)', filter: 'blur(56px)' }} />

      <div style={{ position: 'relative', padding: 22 }}>
        {/* Timeline of the night */}
        {timing && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                {t('liveops.hero.elapsed')} · <span className="tabular-nums" style={{ color: T2 }}>{formatClock(timing.elapsedMin)}</span>
              </span>
              <span style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                {t('liveops.hero.remaining')} · <span className="tabular-nums" style={{ color: T2 }}>{formatClock(timing.remainingMin)}</span>
              </span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
              <div className="h-full rounded-full" style={{ width: `${timing.progress * 100}%`, background: RED }} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Entries + pace */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Users className="h-3.5 w-3.5" style={{ color: T3 }} />
              <span style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                {t('liveops.hero.entries')}
              </span>
            </div>
            <div className="tabular-nums leading-none" style={{ color: T1, fontSize: 'clamp(26px,3vw,36px)', fontWeight: 640, letterSpacing: '-0.025em' }}>
              {entriesCount}
            </div>
            {entriesDelta !== null && (
              <p className="tabular-nums" style={{ color: entriesDelta >= 0 ? POS : '#FF5C63', fontSize: 11.5, marginTop: 4, fontWeight: 600 }}>
                {entriesDelta >= 0 ? '+' : ''}{entriesDelta} {t('liveops.hero.vsCompare')}
              </p>
            )}
          </div>

          {/* Pace sparkline */}
          <div>
            <span style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              {t('liveops.hero.pace')}
            </span>
            <div className="mt-2">
              <PaceSparkline buckets={door?.paceBuckets ?? new Array(12).fill(0)} />
            </div>
            <p className="tabular-nums" style={{ color: T2, fontSize: 11.5, marginTop: 4 }}>
              {t('liveops.hero.last10min').replace('{n}', String(door?.entriesLast10Min ?? 0))}
            </p>
          </div>

          {/* Capacity gauge */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Gauge className="h-3.5 w-3.5" style={{ color: T3 }} />
              <span style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                {t('liveops.hero.capacity')}
              </span>
            </div>
            {fillPct !== null ? (
              <>
                <div className="tabular-nums leading-none" style={{ color: gaugeColor, fontSize: 'clamp(26px,3vw,36px)', fontWeight: 640, letterSpacing: '-0.025em' }}>
                  {fillPct}%
                </div>
                <div className="h-1.5 rounded-full overflow-hidden mt-2" style={{ background: 'rgba(255,255,255,0.07)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${fillPct}%`, background: gaugeColor }} />
                </div>
                <button onClick={onEditCapacity} className="flex items-center gap-1 mt-1.5 cursor-pointer" style={{ color: T3, fontSize: 10.5 }}>
                  <span className="tabular-nums">{entriesCount}/{capacity}</span> · {t('liveops.hero.entriesCumulative')}
                  <Pencil className="h-2.5 w-2.5" />
                </button>
              </>
            ) : (
              <button
                onClick={onEditCapacity}
                className="mt-1 px-3 py-2 rounded-lg cursor-pointer transition-colors"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 12 }}
              >
                {t('liveops.hero.setCapacity')}
              </button>
            )}
          </div>

          {/* Revenue */}
          <div>
            <span style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              {t('liveops.hero.revenue')}
            </span>
            <div className="tabular-nums leading-none mt-1.5" style={{ color: T1, fontSize: 'clamp(26px,3vw,36px)', fontWeight: 640, letterSpacing: '-0.025em' }}>
              {revenue.toFixed(0)} €
            </div>
            {revenueDelta !== null && (
              <p className="tabular-nums" style={{ color: revenueDelta >= 0 ? POS : '#FF5C63', fontSize: 11.5, marginTop: 4, fontWeight: 600 }}>
                {revenueDelta >= 0 ? '+' : ''}{revenueDelta.toFixed(0)} € {t('liveops.hero.vsCompare')}
              </p>
            )}
          </div>
        </div>

        {/* Comparable night footnote + briefing */}
        <div className="flex flex-wrap items-center justify-between gap-2 mt-4">
          {comparison ? (
            <p style={{ color: T3, fontSize: 11.5 }}>
              {(comparison.match === 'same_weekday'
                ? t('liveops.hero.compareWeekday')
                : t('liveops.hero.compareRecent')
              ).replace('{event}', comparison.eventTitle)}
              {compare && (
                <span className="tabular-nums" style={{ color: T2 }}>
                  {' '}· {compare.entries} {t('liveops.hero.entriesShort')} / {compare.revenue.toFixed(0)} €
                </span>
              )}
            </p>
          ) : <span />}
          {onBriefing && (
            <button
              onClick={onBriefing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer transition-colors"
              style={{ background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.2)', color: RED, fontSize: 12, fontWeight: 600 }}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {t('liveops.hero.briefing')}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
