/**
 * Barre de filtres globale, collante (spec §4) : Soirée · Période · Comparer à
 * · Exporter CSV, puis les filtres actifs en chips.
 */
import { useMemo, useState } from 'react';
import { ChevronDown, Download } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { RailEvent } from '@/hooks/useEventRail';
import { AN3_PERIODS, type An3Compare, type An3Period, type An3Route } from '@/lib/analytics/an3Nav';
import { an3Locale } from '@/lib/analytics/an3Format';
import { A3Button } from './an3Ui';
import { A3 } from './an3Tokens';

export function FilterBar({ route, events, onChange, onExport, exportEnabled = true }: {
  route: An3Route; events: RailEvent[] | null;
  onChange: (next: Partial<An3Route>) => void;
  onExport?: () => void; exportEnabled?: boolean;
}) {
  const { t, language } = useLanguage();
  const locale = an3Locale(language);
  const [eventOpen, setEventOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [from, setFrom] = useState(route.from ?? '');
  const [to, setTo] = useState(route.to ?? '');
  const dateFmt = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }), [locale]);
  const selected = route.eventId ? events?.find((e) => e.id === route.eventId) ?? null : null;
  const upcoming = (events ?? []).filter((e) => e.phase !== 'after');
  const past = (events ?? []).filter((e) => e.phase === 'after');
  const isEvent = !!route.eventId;

  const compareOptions: { value: An3Compare; label: string }[] = isEvent
    ? [
        { value: 'comparable', label: t('an3.cmp.comparable') },
        { value: 'median5', label: t('an3.cmp.median5') },
        { value: 'yoy', label: t('an3.cmp.yoy') },
        { value: 'none', label: t('an3.cmp.none') },
      ]
    : [
        { value: 'comparable', label: t('an3.cmp.previousPeriod') },
        { value: 'yoy', label: t('an3.cmp.yoy') },
        { value: 'none', label: t('an3.cmp.none') },
      ];

  const pill = (active: boolean) => ({
    background: active ? A3.accentFaint : 'transparent',
    color: active ? A3.t1 : A3.t2,
    border: `1px solid ${active ? A3.accentSoft : A3.border}`,
  });

  return (
    <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2.5 backdrop-blur-md" style={{ background: 'color-mix(in srgb, var(--sf-000000) 82%, transparent)', borderBottom: `1px solid ${A3.border}` }}>
      <div className="flex flex-wrap items-center gap-2">
        {/* Soirée */}
        <Popover open={eventOpen} onOpenChange={setEventOpen}>
          <PopoverTrigger asChild>
            <button type="button" className="inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-medium min-h-[40px] max-w-[70vw] sm:max-w-xs"
              style={{ background: A3.faint, color: A3.t1, border: `1px solid ${A3.border}` }} aria-haspopup="listbox" aria-expanded={eventOpen}>
              <span className="truncate">{selected ? selected.title : route.eventId ? '…' : t('an3.filter.allNights')}</span>
              {selected && <span className="shrink-0 tabular-nums" style={{ color: A3.t3 }}>{dateFmt.format(new Date(selected.startAt))}</span>}
              <ChevronDown className="h-3.5 w-3.5 shrink-0" style={{ color: A3.t3 }} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(92vw,360px)] max-h-[70vh] overflow-y-auto p-1.5 rounded-2xl" style={{ background: 'var(--sf-141416)', border: `1px solid ${A3.border}`, color: A3.t1 }}>
            <EventOption active={!route.eventId} title={t('an3.filter.allNights')} sub={t('an3.filter.allNightsSub')} onPick={() => { onChange({ eventId: null }); setEventOpen(false); }} />
            {upcoming.length > 0 && <Group label={t('an3.filter.upcoming')} />}
            {upcoming.slice().reverse().map((e) => (
              <EventOption key={e.id} active={e.id === route.eventId} title={e.title} sub={dateFmt.format(new Date(e.startAt))} live={e.phase === 'live'}
                onPick={() => { onChange({ eventId: e.id }); setEventOpen(false); }} />
            ))}
            {past.length > 0 && <Group label={t('an3.filter.past')} />}
            {past.map((e) => (
              <EventOption key={e.id} active={e.id === route.eventId} title={e.title} sub={dateFmt.format(new Date(e.startAt))}
                onPick={() => { onChange({ eventId: e.id }); setEventOpen(false); }} />
            ))}
            {events && events.length === 0 && <p className="m-0 px-3 py-2 text-[12.5px]" style={{ color: A3.t3 }}>{t('an3.filter.noNights')}</p>}
          </PopoverContent>
        </Popover>

        {/* Période (seulement pour « toutes les soirées ») */}
        {!isEvent && (
          <div className="inline-flex items-center gap-1 rounded-full p-1" style={{ background: A3.faint, border: `1px solid ${A3.border}` }} role="radiogroup" aria-label={t('an3.filter.period')}>
            {AN3_PERIODS.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={route.period === p} onClick={() => onChange({ period: p as An3Period })}
                className="rounded-full px-3 py-1.5 text-[12.5px] font-medium min-h-[32px]" style={pill(route.period === p)}>
                {t(`an3.period.${p}`)}
              </button>
            ))}
            <Popover open={customOpen} onOpenChange={setCustomOpen}>
              <PopoverTrigger asChild>
                <button type="button" role="radio" aria-checked={route.period === 'custom'} className="rounded-full px-3 py-1.5 text-[12.5px] font-medium min-h-[32px]" style={pill(route.period === 'custom')}>
                  {route.period === 'custom' && route.from && route.to ? `${route.from.slice(5)} → ${route.to.slice(5)}` : t('an3.period.custom')}
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-3 rounded-2xl flex flex-col gap-2" style={{ background: 'var(--sf-141416)', border: `1px solid ${A3.border}`, color: A3.t1 }}>
                <label className="flex items-center justify-between gap-3 text-[12.5px]">{t('an3.period.from')}
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md px-2 py-1 text-[12.5px]" style={{ background: A3.faint, color: A3.t1, border: `1px solid ${A3.border}`, colorScheme: 'dark' }} />
                </label>
                <label className="flex items-center justify-between gap-3 text-[12.5px]">{t('an3.period.to')}
                  <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md px-2 py-1 text-[12.5px]" style={{ background: A3.faint, color: A3.t1, border: `1px solid ${A3.border}`, colorScheme: 'dark' }} />
                </label>
                <A3Button small primary disabled={!from || !to || from > to} onClick={() => { onChange({ period: 'custom', from, to }); setCustomOpen(false); }}>{t('an3.period.apply')}</A3Button>
              </PopoverContent>
            </Popover>
          </div>
        )}

        {/* Comparer à */}
        <label className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] min-h-[40px]" style={{ background: A3.faint, border: `1px solid ${A3.border}`, color: A3.t2 }}>
          <span className="hidden sm:inline">{t('an3.filter.compare')}</span>
          <select value={route.compare === 'previous' ? 'comparable' : route.compare} onChange={(e) => onChange({ compare: e.target.value as An3Compare })}
            className="bg-transparent text-[12.5px] font-medium outline-none pr-1" style={{ color: A3.t1 }} aria-label={t('an3.filter.compare')}>
            {compareOptions.map((o) => <option key={o.value} value={o.value} style={{ color: '#111' }}>{o.label}</option>)}
          </select>
        </label>

        <div className="ml-auto">
          <A3Button small onClick={onExport} disabled={!exportEnabled || !onExport} ariaLabel={t('an3.export.csv')}>
            <Download className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{t('an3.export.csv')}</span>
          </A3Button>
        </div>
      </div>
    </div>
  );
}

function Group({ label }: { label: string }) {
  return <p className="m-0 px-3 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.07em]" style={{ color: A3.t3 }}>{label}</p>;
}

function EventOption({ active, title, sub, live = false, onPick }: { active: boolean; title: string; sub?: string; live?: boolean; onPick: () => void }) {
  return (
    <button type="button" role="option" aria-selected={active} onClick={onPick}
      className="w-full text-left flex items-center justify-between gap-3 rounded-xl px-3 py-2 min-h-[44px] text-[13px]"
      style={{ background: active ? A3.accentFaint : 'transparent', color: A3.t1 }}>
      <span className="truncate inline-flex items-center gap-2">
        {live && <span className="h-1.5 w-1.5 rounded-full" style={{ background: A3.good }} />}
        {title}
      </span>
      {sub && <span className="shrink-0 tabular-nums text-[12px]" style={{ color: A3.t3 }}>{sub}</span>}
    </button>
  );
}
