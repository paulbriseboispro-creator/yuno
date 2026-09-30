/**
 * La colonne des soirées, à droite de chaque vue d'ensemble d'Analytics.
 *
 * Première ligne : « Toutes les soirées » (la période choisie en haut) ; dessous,
 * chaque soirée — à venir d'abord, puis les passées. Cliquer une soirée lit la
 * MÊME vue de son point de vue ; recliquer « Toutes les soirées » revient à la
 * période. La soirée choisie vit dans l'URL (`?event=`).
 *
 * Un chiffre par ligne, propre à la famille, calculé comme la vue qu'il ouvre :
 * Ventes (billets, CA), Trafic (visites), Communauté (personnes).
 */
import { useMemo, useState } from 'react';
import { Layers, Search } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { KIT, useNumberFormat } from '@/components/analytics/kitFormat';
import { useEventRail, type RailEvent } from '@/hooks/useEventRail';
import type { LensScope } from '@/hooks/useLens';
import type { AnalyticsFamily } from '@/lib/analyticsNav';
import { useAnalyticsPeriod } from '@/hooks/useAnalyticsPeriod';

interface Props {
  scope: LensScope;
  family: Exclude<AnalyticsFamily, 'live'>;
  eventId: string | null;
  onSelect: (eventId: string | null) => void;
}

const SEARCH_FROM = 9;

export function EventRail({ scope, family, eventId, onSelect }: Props) {
  const { t, language } = useLanguage();
  const { n, eur, locale } = useNumberFormat();
  const { events, money } = useEventRail(scope);
  const [period] = useAnalyticsPeriod();
  const [query, setQuery] = useState('');
  const dateFmt = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });

  const { upcoming, past } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (events ?? []).filter((e) => !q || e.title.toLowerCase().includes(q));
    return {
      upcoming: list.filter((e) => e.phase !== 'after').sort((a, b) => a.startAt.localeCompare(b.startAt)),
      past: list.filter((e) => e.phase === 'after'),
    };
  }, [events, query]);

  const metric = (e: RailEvent): string => {
    if (family === 'sales') {
      const units = e.tickets + e.tables + (e.tickets + e.tables === 0 ? e.guests : 0);
      if (units === 0 && !(e.revenue && e.revenue > 0)) return '—';
      const left = e.tickets > 0 ? t('evl.rail.tickets').replace('{n}', n(e.tickets)) : e.tables > 0 ? t('evl.rail.tables').replace('{n}', n(e.tables)) : t('evl.rail.guests').replace('{n}', n(e.guests));
      return money && e.revenue != null && e.revenue > 0 ? `${left} · ${eur(e.revenue)}` : left;
    }
    if (family === 'traffic') return e.visits > 0 ? t('evl.rail.visits').replace('{n}', n(e.visits)) : '—';
    return e.people > 0 ? t('evl.rail.people').replace('{n}', n(e.people)) : '—';
  };

  const row = (e: RailEvent) => {
    const active = e.id === eventId;
    return (
      <li key={e.id}>
        <button
          type="button"
          onClick={() => onSelect(active ? null : e.id)}
          aria-current={active ? 'true' : undefined}
          className="group flex min-h-[52px] w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{
            background: active ? 'rgb(var(--ink)/0.08)' : 'transparent',
            boxShadow: active ? `inset 2px 0 0 ${KIT.RED}` : undefined,
          }}
        >
          {e.poster
            ? <img src={e.poster} alt="" loading="lazy" className="h-10 w-10 flex-none rounded-lg object-cover" />
            : <span className="h-10 w-10 flex-none rounded-lg" style={{ background: 'rgb(var(--ink)/0.06)' }} aria-hidden />}
          <span className="min-w-0 flex-1">
            <span className="block truncate" style={{ color: KIT.T1, fontSize: 13, fontWeight: active ? 620 : 540, letterSpacing: '-0.005em' }}>{e.title}</span>
            <span className="mt-0.5 flex items-center gap-1.5 truncate tabular-nums" style={{ color: KIT.T3, fontSize: 11.5 }}>
              <PhaseDot phase={e.phase} label={t(`er.phase.${e.phase}`)} />
              {dateFmt.format(new Date(e.startAt))} · {metric(e)}
            </span>
          </span>
        </button>
      </li>
    );
  };

  const section = (label: string, list: RailEvent[]) => list.length > 0 && (
    <div className="contents lg:block">
      <h3 className="hidden px-2.5 pb-1 pt-3 lg:block" style={{ color: KIT.T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{label}</h3>
      <ul className="contents lg:block lg:space-y-0.5">{list.map(row)}</ul>
    </div>
  );

  return (
    <nav
      aria-label={t('evl.rail.title')}
      className="rounded-2xl p-1.5 lg:p-2"
      style={{ background: 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)', border: `1px solid ${KIT.BORDER}` }}
    >
      <div className="hidden items-center justify-between px-2.5 pb-1 pt-1.5 lg:flex">
        <h2 style={{ color: KIT.T1, fontSize: 13.5, fontWeight: 620, letterSpacing: '-0.01em' }}>{t('evl.rail.title')}</h2>
        {events && <span className="tabular-nums" style={{ color: KIT.T3, fontSize: 11.5 }}>{n(events.length)}</span>}
      </div>

      {(events?.length ?? 0) >= SEARCH_FROM && (
        <label className="relative mx-1 mb-1.5 hidden lg:block">
          <span className="sr-only">{t('evl.rail.search')}</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: KIT.T3 }} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('evl.rail.search')}
            lang={language}
            className="h-9 w-full rounded-lg pl-8 pr-2.5 text-[12.5px]"
            style={{ background: 'rgb(var(--ink)/0.045)', border: `1px solid ${KIT.BORDER}`, color: KIT.T1, outline: 'none' }}
          />
        </label>
      )}

      {/* Téléphone : bande horizontale ; ordinateur : liste défilante collée. */}
      <div
        className="flex snap-x gap-1.5 overflow-x-auto pb-1 lg:block lg:max-h-[calc(100vh-13rem)] lg:snap-none lg:space-y-0.5 lg:overflow-y-auto lg:overflow-x-hidden lg:pb-0 lg:pr-0.5 [&>*]:snap-start [&_li]:w-[232px] [&_li]:flex-none lg:[&_li]:w-auto"
        style={{ scrollbarWidth: 'thin' }}
      >
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-current={eventId === null ? 'true' : undefined}
          className="flex min-h-[52px] w-[232px] flex-none cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 lg:w-full"
          style={{ background: eventId === null ? 'rgb(var(--ink)/0.08)' : 'transparent', boxShadow: eventId === null ? `inset 2px 0 0 ${KIT.RED}` : undefined }}
        >
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg" style={{ background: 'rgba(232,25,44,0.12)', color: 'var(--acc-ff5c63)' }}>
            <Layers className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block truncate" style={{ color: KIT.T1, fontSize: 13, fontWeight: eventId === null ? 620 : 560 }}>{t('evl.rail.all')}</span>
            <span className="mt-0.5 block truncate" style={{ color: KIT.T3, fontSize: 11.5 }}>{t(`evl.period.${period}Long`)}</span>
          </span>
        </button>

        {events === null ? (
          <div className="hidden space-y-2 px-1 pt-2 lg:block" aria-busy>
            {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-[52px] animate-pulse rounded-xl" style={{ background: 'rgb(var(--ink)/0.04)' }} />)}
          </div>
        ) : events.length === 0 ? (
          <p className="px-2.5 py-4" style={{ color: KIT.T3, fontSize: 12.5 }}>{t('evl.rail.empty')}</p>
        ) : (
          <>
            {section(t('evl.rail.upcoming'), upcoming)}
            {section(t('evl.rail.past'), past)}
            {upcoming.length + past.length === 0 && <p className="px-2.5 py-4" style={{ color: KIT.T3, fontSize: 12.5 }}>{t('evl.rail.noMatch')}</p>}
          </>
        )}
      </div>
    </nav>
  );
}

function PhaseDot({ phase, label }: { phase: RailEvent['phase']; label: string }) {
  const color = phase === 'live' ? 'var(--acc-ff5c63)' : phase === 'before' ? 'var(--acc-34d399)' : 'rgb(var(--ink)/0.3)';
  return (
    <span className="relative inline-flex h-1.5 w-1.5 flex-none" title={label}>
      {phase === 'live' && <span className="absolute inset-0 animate-ping rounded-full opacity-70 motion-reduce:hidden" style={{ background: color }} />}
      <span className="relative h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
