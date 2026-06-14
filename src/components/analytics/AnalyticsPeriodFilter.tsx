import { CalendarRange } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { subDays, subHours } from 'date-fns';

export type AnalyticsRange = '24h' | '7d' | '30d' | '90d' | 'all';

export function rangeToDates(range: AnalyticsRange): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString();
  let from: Date;
  switch (range) {
    case '24h': from = subHours(now, 24); break;
    case '7d': from = subDays(now, 7); break;
    case '30d': from = subDays(now, 30); break;
    case '90d': from = subDays(now, 90); break;
    case 'all': from = new Date('2020-01-01'); break;
  }
  return { from: from.toISOString(), to };
}

interface Props {
  range: AnalyticsRange;
  onChange: (r: AnalyticsRange) => void;
  device?: string;
  onDeviceChange?: (d: string) => void;
  source?: string;
  onSourceChange?: (s: string) => void;
}

const BORDER = 'rgba(255,255,255,0.085)';
const T1 = 'rgba(255,255,255,0.96)';
const T3 = 'rgba(255,255,255,0.36)';
const RED = '#E8192C';

const selectStyle: React.CSSProperties = {
  height: 28,
  paddingLeft: 8,
  paddingRight: 8,
  borderRadius: 8,
  background: 'rgba(255,255,255,0.04)',
  border: `1px solid ${BORDER}`,
  color: T1,
  fontSize: 12,
  outline: 'none',
  cursor: 'pointer',
};

export function AnalyticsPeriodFilter({ range, onChange, device, onDeviceChange, source, onSourceChange }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string) => (language === 'fr' ? fr : en);

  const ranges: { key: AnalyticsRange; label: string }[] = [
    { key: '24h', label: '24h' },
    { key: '7d', label: tt('7 j', '7d') },
    { key: '30d', label: tt('30 j', '30d') },
    { key: '90d', label: tt('90 j', '90d') },
    { key: 'all', label: tt('Tout', 'All') },
  ];

  const devices = ['all', 'mobile', 'tablet', 'desktop'];
  const sources = ['all', 'direct', 'social', 'paid_social', 'search', 'paid_search', 'email', 'qr', 'referral', 'affiliate', 'internal'];

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-2xl p-3"
      style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${BORDER}` }}
    >
      <div className="flex items-center gap-1.5">
        <CalendarRange className="h-3.5 w-3.5" style={{ color: T3 }} />
        <span className="text-[10px] uppercase tracking-wider" style={{ color: T3 }}>
          {tt('Période', 'Period')}
        </span>
      </div>

      <div
        className="flex gap-0.5 p-0.5 rounded-xl"
        style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}` }}
      >
        {ranges.map(r => (
          <button
            key={r.key}
            onClick={() => onChange(r.key)}
            className="px-2.5 py-1 rounded-lg text-[12px] font-medium cursor-pointer transition-all duration-150"
            style={range === r.key
              ? { color: '#fff', background: RED, boxShadow: `0 0 14px -4px ${RED}88` }
              : { color: T3 }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {onDeviceChange && (
        <>
          <span className="hidden sm:block w-px h-4" style={{ background: BORDER }} />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider" style={{ color: T3 }}>
              {tt('Appareil', 'Device')}
            </span>
            <select value={device || 'all'} onChange={(e) => onDeviceChange(e.target.value)} style={selectStyle}>
              {devices.map(d => (
                <option key={d} value={d} style={{ background: '#0a0a0c' }}>
                  {d === 'all' ? tt('Tous', 'All') : d}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {onSourceChange && (
        <>
          <span className="hidden sm:block w-px h-4" style={{ background: BORDER }} />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider" style={{ color: T3 }}>Source</span>
            <select value={source || 'all'} onChange={(e) => onSourceChange(e.target.value)} style={selectStyle}>
              {sources.map(s => (
                <option key={s} value={s} style={{ background: '#0a0a0c' }}>
                  {s === 'all' ? tt('Toutes', 'All') : s}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
    </div>
  );
}
