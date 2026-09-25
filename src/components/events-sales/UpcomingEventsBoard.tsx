/**
 * « Vos prochaines soirées » — tableau de bord club et organisateur.
 *
 * Le premier écran de Shotgun, à la Yuno : une ligne par soirée à venir, avec
 * le compte à rebours, le CA (total + aujourd'hui) et une jauge par pilier
 * ouvert. Remplace le héros qui ne montrait qu'UNE soirée. Chaque ligne mène
 * à l'analyse de sa soirée ; le soir même, un lien « Suivre en direct ».
 */
import { ArrowRight, CalendarDays, Radio } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { UpdatedAt } from '@/components/analytics/kit';
import { KIT } from '@/components/analytics/kitFormat';
import { countdownFor, type EventSales } from '@/lib/eventsSales';
import { useEventsSalesSummary, type EventsSalesScope } from '@/hooks/useEventsSalesSummary';
import { CountdownTile, EventMetricsGrid } from './EventSalesParts';

const CARD_BG = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
const CARD_SHADOW = '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))';

interface Props {
  scope: EventsSalesScope;
  /** Où mène une ligne (l'analyse de la soirée, ou sa fiche). */
  statsHref: (eventId: string) => string;
  /** La liste complète des soirées. */
  allHref: string;
  /** Suivi en direct le soir même, si la surface en a un. */
  liveHref?: (eventId: string) => string | null;
  /** Nombre de lignes montrées. */
  limit?: number;
  /** Bouton de l'état vide (« Créer une soirée »). */
  emptyCta?: { label: string; href: string };
}

export function UpcomingEventsBoard({ scope, statsHref, allHref, liveHref, limit = 5, emptyCta }: Props) {
  const { t, language } = useLanguage();
  const { data, loading, fetchedAt } = useEventsSalesSummary(scope);
  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';

  const upcoming = (data?.events ?? []).filter((e) => countdownFor(e.startAt, e.endAt).kind !== 'past');
  const shown = upcoming.slice(0, limit);

  const dateFmt = new Intl.DateTimeFormat(locale, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
  });

  return (
    <section style={{ background: CARD_BG, border: `1px solid ${KIT.BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW }}>
      <header className="flex flex-wrap items-end justify-between gap-2 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <h2 style={{ color: KIT.T1, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('evs.board.title')}</h2>
          <p style={{ color: KIT.T3, fontSize: 11.5, marginTop: 2 }}>{t('evs.board.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <UpdatedAt at={fetchedAt} />
          <Link to={allHref} className="inline-flex items-center gap-1 text-[11.5px] font-medium" style={{ color: KIT.T2 }}>
            {t('evs.board.all')} <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        </div>
      </header>

      {loading && !data ? (
        <div className="space-y-2 px-5 pb-5" aria-busy>
          {[0, 1].map((i) => (
            <div key={i} className="h-[92px] animate-pulse rounded-xl" style={{ background: 'rgb(var(--ink)/0.04)' }} />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 pb-8 pt-4 text-center">
          <CalendarDays className="h-8 w-8" style={{ color: 'rgb(var(--ink)/0.14)' }} aria-hidden />
          <p style={{ color: KIT.T2, fontSize: 13 }}>{t('evs.board.empty')}</p>
          {emptyCta && (
            <Link
              to={emptyCta.href}
              className="mt-2 inline-flex items-center rounded-xl px-4 py-2 text-[13px] font-semibold"
              style={{ background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.30)', color: KIT.RED }}
            >
              {emptyCta.label}
            </Link>
          )}
        </div>
      ) : (
        <ul className="space-y-2 px-3 pb-3 sm:px-4 sm:pb-4">
          {shown.map((ev) => (
            <BoardRow
              key={ev.id}
              ev={ev}
              when={dateFmt.format(new Date(ev.startAt))}
              href={statsHref(ev.id)}
              liveHref={liveHref?.(ev.id) ?? null}
              hasLive={!!liveHref}
            />
          ))}
          {upcoming.length > shown.length && (
            <li className="pt-1 text-center">
              <Link to={allHref} className="text-[12px] font-medium" style={{ color: KIT.T3 }}>
                {upcoming.length - shown.length === 1 ? t('evs.board.moreOne') : t('evs.board.more').replace('{n}', String(upcoming.length - shown.length))}
              </Link>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function BoardRow({ ev, when, href, liveHref, hasLive }: { ev: EventSales; when: string; href: string; liveHref: string | null; hasLive: boolean }) {
  const { t } = useLanguage();
  const c = countdownFor(ev.startAt, ev.endAt);
  const tonight = c.kind === 'live' || c.kind === 'today';

  return (
    <li
      className="relative rounded-xl transition-colors"
      style={{ background: 'rgb(var(--ink)/0.028)', border: `1px solid ${tonight ? 'rgba(232,25,44,0.22)' : KIT.BORDER}` }}
    >
      <div className="flex flex-col gap-3 p-3 xl:flex-row xl:items-center xl:gap-5">
        <div className="flex min-w-0 items-center gap-3 xl:w-[280px] xl:flex-none">
          <CountdownTile ev={ev} />
          {ev.poster ? (
            <img src={ev.poster} alt="" className="h-14 w-14 flex-none rounded-lg object-cover" loading="lazy" />
          ) : null}
          <div className="min-w-0">
            {/* Le titre porte le lien : toute la ligne devient cliquable via ::after. */}
            <Link
              to={href}
              className="line-clamp-2 after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none"
              style={{ color: KIT.T1, fontSize: 14, fontWeight: 600 }}
            >
              {ev.title}
            </Link>
            <p className="truncate capitalize" style={{ color: KIT.T3, fontSize: 11.5, marginTop: 2 }}>{when}</p>
            {ev.status === 'postponed' && (
              <span className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--acc-f59e0b)' }}>
                {t('evs.postponed')}
              </span>
            )}
          </div>
        </div>

        {/* Au-dessus du lien de ligne pour que les ⓘ restent survolables, mais
            transparent aux clics : cliquer un chiffre ouvre la soirée. */}
        <EventMetricsGrid ev={ev} className="pointer-events-none relative z-10 flex-1" />

        {/* Case d'action réservée sur chaque ligne dès que la surface a un
            suivi en direct : sans elle, la ligne du soir décalerait ses
            colonnes par rapport aux autres. */}
        {hasLive && (
          <div className="flex-none xl:w-[150px] xl:text-right">
            {tonight && liveHref && (
              <Link
                to={liveHref}
                className="relative z-10 inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[12px] font-semibold"
                style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.25)', color: 'var(--acc-ff5c63)' }}
              >
                <Radio className="h-3.5 w-3.5" aria-hidden />
                {t('evs.live')}
              </Link>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
