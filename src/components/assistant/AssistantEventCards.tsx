import { Heart, ChevronRight, Ticket } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import { useFavorites } from '@/hooks/useFavorites';
import { eventTargetPath } from '@/lib/eventNavigation';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { eventPriceLabel } from '@/lib/eventPriceLabel';
import { FadeImage } from '@/components/ui/fade-image';
import { useAssistantEventCards, type AssistantEventCardData } from '@/hooks/useAssistantEventCards';

/**
 * Les soirées que l'assistant propose, en vraies cartes cliquables.
 *
 * Même anatomie que la carte de l'Explore (design system public §6.1) : affiche
 * 1:1, panneau d'info #141414, club en mono gris, titre display capitales,
 * filet, date/heure en mono et prix en rouge. Deux ajouts propres au chat, qui
 * portent l'argument de vente que la prose ne dira plus : l'heure d'entrée
 * gratuite et le prix plancher d'une table.
 *
 * Une seule soirée -> une carte pleine largeur. Plusieurs -> un rail horizontal
 * à aimantation, la grammaire des carrousels Explore.
 */

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="font-mono inline-flex items-center gap-1 whitespace-nowrap"
      style={{
        fontSize: '10px',
        letterSpacing: '0.04em',
        color: '#E5E5E5',
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: '6px',
        padding: '3px 7px',
      }}
    >
      {children}
    </span>
  );
}

function AssistantEventCard({ event }: { event: AssistantEventCardData }) {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { isFavorite, toggleFavorite } = useFavorites();
  // La date se lit dans la langue de la conversation : l'assistant répond en
  // français, sa carte n'affiche pas « FRI 11 SEP ».
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const reduceMotion = useReducedMotion();
  const favType = event.isAffiliate ? 'affiliate_event' : 'event';
  const liked = isFavorite(favType, event.id);

  const start = new Date(event.startAt);
  // « ven. 11 sept. » -> « VEN 11 SEPT » : les points d'abréviation français
  // n'apportent rien en capitales mono et poussaient le prix à la ligne.
  const dateLabel = format(start, 'EEE d MMM', { locale }).replace(/\./g, '').toUpperCase();
  const timeLabel = format(start, 'HH:mm', { locale });
  const price = eventPriceLabel(event, t);
  const poster = event.posterUrl
    ? getOptimizedImageUrl(event.posterUrl, { width: 600, height: 600, quality: 75, resize: 'cover' })
    : null;

  const open = () => navigate(eventTargetPath(event));

  return (
    <motion.article
      onClick={open}
      role="button"
      tabIndex={0}
      aria-label={`${event.title} — ${event.venueName}`}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      whileTap={reduceMotion ? undefined : { scale: 0.985 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="group flex h-full flex-col overflow-hidden cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      style={{
        background: '#141414',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '16px',
      }}
    >
      {/* Affiche 1:1 */}
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: '1/1' }}>
        {poster ? (
          <>
            <FadeImage
              src={poster}
              alt={event.title}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.10)' }} />
          </>
        ) : (
          <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, #1a0f12 0%, #3a1020 100%)' }} />
        )}

        <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1.5">
          {event.isAffiliate && (
            <span
              className="font-mono font-bold tracking-[0.14em]"
              style={{ fontSize: '9px', color: '#C084FC', background: 'rgba(192,132,252,0.15)', border: '1px solid rgba(192,132,252,0.3)', borderRadius: '2px', padding: '2px 6px' }}
            >
              {t('explore.partner')}
            </span>
          )}
          {/* Pas la `.genre-tag` de l'Explore : son fond blanc à 6 % disparaît
              sur une affiche claire (le flyer WOH est blanc). Pastille sombre
              en verre, lisible sur toutes les affiches. */}
          {event.genres.slice(0, 1).map((g) => (
            <span
              key={g}
              className="font-mono font-bold"
              style={{
                fontSize: '9.5px', letterSpacing: '0.08em', textTransform: 'uppercase',
                color: '#FFFFFF', background: 'rgba(10,10,10,0.62)',
                border: '1px solid rgba(255,255,255,0.18)', backdropFilter: 'blur(8px)',
                borderRadius: '999px', padding: '3px 8px',
              }}
            >
              {g}
            </span>
          ))}
        </div>

        {/* Cible tactile de 44px, pastille visible de 30px (règle des 44px) */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleFavorite(favType, event.id); }}
          aria-label={liked ? t('explore.removeFav') : t('explore.addFav')}
          aria-pressed={liked}
          className="absolute bottom-0 right-0 z-10 flex items-center justify-center"
          style={{ width: 44, height: 44 }}
        >
          <span
            className="flex items-center justify-center rounded-full transition-colors duration-200"
            style={{
              width: 30,
              height: 30,
              background: 'rgba(10,10,10,0.55)',
              border: '1px solid rgba(255,255,255,0.18)',
              backdropFilter: 'blur(8px)',
            }}
          >
            <Heart
              className="h-3.5 w-3.5 transition-colors duration-200"
              style={{ color: liked ? '#E8192C' : 'rgba(255,255,255,0.75)', fill: liked ? '#E8192C' : 'none' }}
            />
          </span>
        </button>
      </div>

      {/* Panneau d'info */}
      <div className="flex flex-1 flex-col gap-1.5 px-3.5 py-3">
        <p
          className="font-mono truncate"
          style={{ fontSize: '10px', color: '#9A9A9A', letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1 }}
        >
          {[event.venueName, event.venueCity].filter(Boolean).join(' · ')}
        </p>

        <h3
          className="font-display line-clamp-2"
          style={{ fontSize: '17px', fontWeight: 700, color: '#FFFFFF', textTransform: 'uppercase', lineHeight: 1.05, letterSpacing: '-0.005em' }}
        >
          {event.title}
        </h3>

        {(event.freeBefore || (event.tableMinPrice != null && !event.tablesOnly)) && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {event.freeBefore && (
              <Chip>
                <Ticket className="h-3 w-3" style={{ color: '#E8192C' }} aria-hidden="true" />
                {t('assistant.card.freeBefore').replace('{time}', event.freeBefore)}
              </Chip>
            )}
            {/* Sur une soirée tables-uniquement, le libellé de prix dit déjà
                « Table dès X€ » : la pastille ferait doublon. Elle ne sert que
                quand la soirée vend AUSSI des billets. */}
            {event.tableMinPrice != null && !event.tablesOnly && (
              <Chip>{t('assistant.card.tablesFrom').replace('{price}', String(event.tableMinPrice))}</Chip>
            )}
          </div>
        )}

        {/* Pousse le pied de carte en bas : dans un rail, deux titres de
            longueurs différentes doivent aligner leurs dates et leurs prix. */}
        <div className="flex-1" />

        <div
          className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-2.5 mt-0.5"
          style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
        >
          <p className="font-mono" style={{ fontSize: '11px', color: '#9A9A9A', letterSpacing: '0.04em' }}>
            {dateLabel} · {timeLabel}
          </p>
          {price && (
            <p className="font-mono font-bold shrink-0" style={{ fontSize: '12px', color: '#E8192C', letterSpacing: '0.02em' }}>
              {price}
            </p>
          )}
        </div>

        <span
          className="font-mono inline-flex items-center gap-1 pt-1.5 transition-colors duration-200 group-hover:text-white"
          style={{ fontSize: '11px', color: '#E8192C', letterSpacing: '0.06em', textTransform: 'uppercase' }}
        >
          {t('assistant.card.cta')}
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </div>
    </motion.article>
  );
}

function CardSkeleton() {
  // Réserver la place de la carte : sans ça la bulle saute quand elle arrive.
  return (
    <div
      className="animate-pulse overflow-hidden"
      style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px' }}
    >
      <div style={{ aspectRatio: '1/1', background: 'rgba(255,255,255,0.05)' }} />
      <div className="px-3.5 py-3 flex flex-col gap-2">
        <div style={{ height: 8, width: '40%', borderRadius: 4, background: 'rgba(255,255,255,0.07)' }} />
        <div style={{ height: 14, width: '75%', borderRadius: 4, background: 'rgba(255,255,255,0.09)' }} />
        <div style={{ height: 10, width: '55%', borderRadius: 4, background: 'rgba(255,255,255,0.05)' }} />
      </div>
    </div>
  );
}

export function AssistantEventCards({ ids }: { ids: string[] }) {
  const { data, isLoading } = useAssistantEventCards(ids);

  if (isLoading) {
    return (
      <div className="my-3" style={{ maxWidth: 280 }}>
        <CardSkeleton />
      </div>
    );
  }
  // Un id qui ne rend rien (soirée passée, dépubliée) ne laisse pas de trou :
  // la prose autour de la carte se suffit à elle-même.
  if (!data || data.length === 0) return null;

  if (data.length === 1) {
    return (
      <div className="my-3" style={{ maxWidth: 280 }}>
        <AssistantEventCard event={data[0]} />
      </div>
    );
  }

  return (
    <div
      className="my-3 -mx-1 flex items-stretch gap-3 overflow-x-auto px-1 pb-1 snap-x snap-mandatory"
      style={{ scrollbarWidth: 'none' }}
    >
      {data.map((event) => (
        <div key={event.id} className="shrink-0 snap-start" style={{ width: 232 }}>
          <AssistantEventCard event={event} />
        </div>
      ))}
    </div>
  );
}
