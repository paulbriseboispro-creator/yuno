/**
 * Le sélecteur de soirée d'Analytics › Ventes, en haut à droite : une pastille
 * ronde qui dit ce qu'on regarde (« Toutes les soirées », ou une soirée), et
 * qui s'ouvre sur la liste défilante de toutes les soirées de la portée — à
 * venir d'abord, puis passées, avec une recherche au-delà de huit.
 *
 * C'est la seule porte entre l'analyse de toutes les soirées et l'analyse d'UNE
 * soirée : les mêmes blocs, le même style, seul le périmètre change. La soirée
 * choisie vit dans l'URL (`?event=`). Un chiffre par ligne : billets ou tables
 * vendus et, pour qui voit l'argent, le CA (RPC `get_analytics_event_rail`).
 */
import { useMemo, useState } from 'react';
import { Check, ChevronDown, Layers, Search } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { KIT, useNumberFormat } from '@/components/analytics/kitFormat';
import { useEventRail, type RailEvent, type RailScope } from '@/hooks/useEventRail';

interface Props {
  scope: RailScope;
  eventId: string | null;
  onSelect: (eventId: string | null) => void;
}

const SEARCH_FROM = 9;
const RED = '#E8192C';

export function EventScopePicker({ scope, eventId, onSelect }: Props) {
  const { t, language } = useLanguage();
  const { n, eur, locale } = useNumberFormat();
  const { events, money } = useEventRail(scope);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const dateFmt = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });

  const current = useMemo(() => (events ?? []).find((e) => e.id === eventId) ?? null, [events, eventId]);

  const { upcoming, past } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (events ?? []).filter((e) => !q || e.title.toLowerCase().includes(q));
    return {
      upcoming: list.filter((e) => e.phase !== 'after').sort((a, b) => a.startAt.localeCompare(b.startAt)),
      past: list.filter((e) => e.phase === 'after'),
    };
  }, [events, query]);

  const metric = (e: RailEvent): string => {
    const units = e.tickets + e.tables + (e.tickets + e.tables === 0 ? e.guests : 0);
    if (units === 0 && !(e.revenue && e.revenue > 0)) return '—';
    const left = e.tickets > 0
      ? t('evl.rail.tickets').replace('{n}', n(e.tickets))
      : e.tables > 0 ? t('evl.rail.tables').replace('{n}', n(e.tables)) : t('evl.rail.guests').replace('{n}', n(e.guests));
    return money && e.revenue != null && e.revenue > 0 ? `${left} · ${eur(e.revenue)}` : left;
  };

  const choose = (id: string | null) => {
    onSelect(id);
    setOpen(false);
    setQuery('');
  };

  const row = (e: RailEvent) => {
    const active = e.id === eventId;
    return (
      <li key={e.id}>
        <button
          type="button"
          role="option"
          aria-selected={active}
          onClick={() => choose(active ? null : e.id)}
          className="flex min-h-[52px] w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors duration-150 hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ background: active ? 'rgb(var(--ink)/0.08)' : 'transparent', boxShadow: active ? `inset 2px 0 0 ${RED}` : undefined }}
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
          {active && <Check className="h-4 w-4 flex-none" style={{ color: RED }} aria-hidden />}
        </button>
      </li>
    );
  };

  const section = (label: string, list: RailEvent[]) => list.length > 0 && (
    <div>
      <h3 className="px-2.5 pb-1 pt-3" style={{ color: KIT.T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{label}</h3>
      <ul className="space-y-0.5" role="listbox">{list.map(row)}</ul>
    </div>
  );

  const label = current ? current.title : t('evl.rail.all');
  const sub = current ? dateFmt.format(new Date(current.startAt)) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          className="inline-flex max-w-[320px] cursor-pointer items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-3.5 text-left transition-all duration-150 hover:brightness-110"
          style={current
            ? { background: 'linear-gradient(180deg,rgba(232,25,44,.18),rgba(232,25,44,.06)),var(--sf-0a0a0c)', border: '1px solid rgba(232,25,44,0.5)', boxShadow: `0 0 22px -8px ${RED}` }
            : { background: 'rgb(var(--ink)/0.05)', border: `1px solid ${KIT.BORDER}` }}
        >
          {current?.poster
            ? <img src={current.poster} alt="" className="h-8 w-8 flex-none rounded-full object-cover" />
            : (
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full" style={{ background: 'rgba(232,25,44,0.12)', color: 'var(--acc-ff5c63)' }}>
                <Layers className="h-4 w-4" aria-hidden />
              </span>
            )}
          <span className="min-w-0">
            <span className="block truncate" style={{ color: KIT.T1, fontSize: 13, fontWeight: 620, letterSpacing: '-0.01em' }}>{label}</span>
            {sub && <span className="block truncate" style={{ color: KIT.T3, fontSize: 11 }}>{sub}</span>}
          </span>
          <ChevronDown className={`h-4 w-4 flex-none transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: KIT.T3 }} aria-hidden />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[340px] rounded-2xl p-2"
        style={{ background: 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)', border: `1px solid ${KIT.BORDER}`, boxShadow: '0 24px 60px -24px rgb(0 0 0/.8)' }}
      >
        <div className="flex items-center justify-between px-2.5 pb-1 pt-1">
          <h2 style={{ color: KIT.T1, fontSize: 13.5, fontWeight: 620, letterSpacing: '-0.01em' }}>{t('evl.rail.title')}</h2>
          {events && <span className="tabular-nums" style={{ color: KIT.T3, fontSize: 11.5 }}>{n(events.length)}</span>}
        </div>

        {(events?.length ?? 0) >= SEARCH_FROM && (
          <label className="relative mx-0.5 mb-1.5 block">
            <span className="sr-only">{t('evl.rail.search')}</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: KIT.T3 }} aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('evl.rail.search')}
              lang={language}
              autoFocus
              className="h-9 w-full rounded-lg pl-8 pr-2.5 text-[12.5px]"
              style={{ background: 'rgb(var(--ink)/0.045)', border: `1px solid ${KIT.BORDER}`, color: KIT.T1, outline: 'none' }}
            />
          </label>
        )}

        <div className="max-h-[min(60vh,520px)] overflow-y-auto pr-0.5" style={{ scrollbarWidth: 'thin' }}>
          <button
            type="button"
            role="option"
            aria-selected={eventId === null}
            onClick={() => choose(null)}
            className="flex min-h-[52px] w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors duration-150 hover:bg-white/[0.04]"
            style={{ background: eventId === null ? 'rgb(var(--ink)/0.08)' : 'transparent', boxShadow: eventId === null ? `inset 2px 0 0 ${RED}` : undefined }}
          >
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg" style={{ background: 'rgba(232,25,44,0.12)', color: 'var(--acc-ff5c63)' }}>
              <Layers className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate" style={{ color: KIT.T1, fontSize: 13, fontWeight: eventId === null ? 620 : 560 }}>{t('evl.rail.all')}</span>
              <span className="mt-0.5 block truncate" style={{ color: KIT.T3, fontSize: 11.5 }}>{t('anf.view.sales.overview')}</span>
            </span>
            {eventId === null && <Check className="h-4 w-4 flex-none" style={{ color: RED }} aria-hidden />}
          </button>

          {events === null ? (
            <div className="space-y-2 px-1 pt-2" aria-busy>
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-[52px] animate-pulse rounded-xl" style={{ background: 'rgb(var(--ink)/0.04)' }} />)}
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
      </PopoverContent>
    </Popover>
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
