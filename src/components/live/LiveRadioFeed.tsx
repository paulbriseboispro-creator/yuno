import { useMemo, useState } from 'react';
import { Pause, Play, RadioTower } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { FeedItem } from '@/hooks/useLiveNightData';
import type { IncidentLive } from '@/lib/liveops/extended';
import { buildRadioFeed, interpolate, type RadioStation } from '@/lib/liveops/narrative';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED    = '#E8192C';
const POS    = '#34D399';
const NEG    = '#FF5C63';
const T1     = 'rgba(255,255,255,0.96)';
const T2     = 'rgba(255,255,255,0.58)';
const T3     = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';
const TILE_BG  = 'rgba(255,255,255,0.025)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const STATION_COLOR: Record<RadioStation, string> = {
  door: POS,
  bar: 'rgba(255,255,255,0.55)',
  vip: RED,
  cloakroom: T3,
};

type Filter = 'all' | RadioStation;

interface Props {
  feed: FeedItem[];
  incidents: IncidentLive[];
  isPaused: boolean;
  onTogglePause: () => void;
}

export function LiveRadioFeed({ feed, incidents, isPaused, onTogglePause }: Props) {
  const { t } = useLanguage();
  const [filter, setFilter] = useState<Filter>('all');

  const items = useMemo(() => buildRadioFeed(feed, incidents), [feed, incidents]);
  const visible = filter === 'all' ? items : items.filter(i => i.station === filter);

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: t('liveops.radio.all') },
    { key: 'door', label: t('liveops.station.door') },
    { key: 'bar', label: t('liveops.station.bar') },
    { key: 'vip', label: t('liveops.door.vip') },
    { key: 'cloakroom', label: t('liveops.station.cloakroom') },
  ];

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '18px 20px', overflow: 'hidden' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <RadioTower className="h-3.5 w-3.5" style={{ color: T3 }} />
          </div>
          <h3 style={{ color: T1, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>
            {t('liveops.radio.title')}
          </h3>
        </div>
        <button
          onClick={onTogglePause}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg cursor-pointer"
          style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: isPaused ? T2 : POS, fontSize: 11, fontWeight: 600 }}
        >
          {isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
          {isPaused ? t('liveops.radio.resume') : t('liveops.radio.pause')}
        </button>
      </div>

      {/* Station filters */}
      <div className="flex items-center gap-1 mb-3 overflow-x-auto">
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className="text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap cursor-pointer transition-colors"
            style={filter === f.key
              ? { background: 'rgba(232,25,44,0.12)', color: RED, fontWeight: 600, border: '1px solid rgba(232,25,44,0.2)' }
              : { color: T3, border: `1px solid ${BORDER}` }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="py-6 text-center" style={{ color: T3, fontSize: 12.5 }}>
          {t('liveops.radio.empty')}
        </p>
      ) : (
        <div className="space-y-1 max-h-[420px] overflow-y-auto pr-1">
          {visible.map(item => {
            const template = t(item.tKey);
            let text = template === item.tKey ? Object.values(item.params).join(' ') : interpolate(template, item.params);
            // Incident templates are plain labels — the free-text reason tags along.
            if (item.params.reason && !template.includes('{reason}')) text = `${text} — ${item.params.reason}`;
            return (
              <div key={item.id} className="flex items-start gap-2.5 px-3 py-2 rounded-xl" style={{ background: TILE_BG }}>
                <div className="mt-1.5 w-1.5 h-1.5 rounded-full flex-none"
                  style={{ background: item.severity === 'warn' ? NEG : STATION_COLOR[item.station] }} />
                <div className="flex-1 min-w-0">
                  <p style={{ color: item.severity === 'warn' ? NEG : T2, fontSize: 12.5, lineHeight: 1.4 }}>
                    <span style={{ color: T3, fontWeight: 600, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {t(`liveops.radio.station.${item.station}`)}
                    </span>
                    {' — '}
                    <span style={{ color: item.severity === 'warn' ? NEG : T1 }}>{text}</span>
                  </p>
                </div>
                <span className="tabular-nums flex-none mt-0.5" style={{ color: T3, fontSize: 10 }}>
                  {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
