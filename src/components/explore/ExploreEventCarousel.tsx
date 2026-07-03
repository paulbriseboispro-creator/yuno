import { Heart, Flame, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useFavorites } from '@/hooks/useFavorites';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { EventCardData } from './EventCard';
import { eventPath } from '@/lib/eventUrl';

const dfLocale = (language: string) => (language === 'fr' ? fr : language === 'es' ? es : enUS);

function priceLabel(event: EventCardData, t: (k: string) => string): string {
  if (event.minPrice === 0) return t('explore.free');
  if (event.minPrice !== null) return `${t('explore.priceFrom')} ${event.minPrice}€`;
  return '';
}

function navigateToEvent(event: EventCardData, navigate: ReturnType<typeof useNavigate>) {
  if (event.isAffiliate && event.affiliateEventSlug) {
    navigate(`/affiliate-event/${event.affiliateEventSlug}`);
  } else if (event.isOrganizerLed || !event.venueSlug) {
    navigate(eventPath(event));
  } else {
    sessionStorage.setItem('yuno_club_origin', 'explore');
    navigate(`/club/${event.venueSlug}`);
  }
}

function CarouselCard({ event }: { event: EventCardData }) {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { isFavorite, toggleFavorite } = useFavorites();
  const favType = event.isAffiliate ? 'affiliate_event' : 'event';
  const liked = isFavorite(favType, event.id);

  const dateLabel = format(new Date(event.startAt), 'dd MMM', { locale: dfLocale(language) }).toUpperCase();
  const timeLabel = format(new Date(event.startAt), 'HH:mm');
  const price = priceLabel(event, t);

  const handleFav = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(favType, event.id);
  };

  return (
    <div
      onClick={() => navigateToEvent(event, navigate)}
      className="shrink-0 cursor-pointer overflow-hidden"
      style={{
        width: 265,
        borderRadius: 20,
        background: '#141417',
        border: '1px solid rgba(255,255,255,0.08)',
        scrollSnapAlign: 'start',
      }}
    >
      {/* Image zone */}
      <div className="relative" style={{ height: 210 }}>
        {event.posterUrl ? (
          <img
            src={event.posterUrl}
            alt={event.title}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, #1a0f12, #0f0f12)' }} />
        )}
        {/* Gradient */}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(8,8,10,0.92) 0%, transparent 55%)' }} />

        {/* Top badges + fav */}
        <div className="absolute top-3 left-3 right-3 flex items-start justify-between">
          <div className="flex flex-col gap-1.5">
            {event.isAffiliate && (
              <span className="font-mono font-semibold" style={{ fontSize: '9.5px', letterSpacing: '0.14em', color: '#A78BFA', background: 'rgba(167,139,250,0.16)', border: '1px solid rgba(167,139,250,0.4)', borderRadius: '7px', padding: '4px 8px', backdropFilter: 'blur(6px)' }}>
                {t('explore.partner')}
              </span>
            )}
            {event.isLive && (
              <span className="font-mono font-bold flex items-center gap-1" style={{ fontSize: '9px', letterSpacing: '0.1em', color: '#fff', background: '#E8192C', borderRadius: '4px', padding: '2px 7px' }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff', display: 'inline-block' }} />
                LIVE
              </span>
            )}
          </div>
          <button
            onClick={handleFav}
            aria-label={t('explore.favorite')}
            style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(10,10,12,0.6)', border: '1px solid rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', backdropFilter: 'blur(8px)', transition: '0.18s' }}
          >
            <Heart style={{ width: 14, height: 14, color: liked ? '#E8192C' : '#fff', fill: liked ? '#E8192C' : 'none' }} />
          </button>
        </div>

        {/* Bottom of image: sold % indicator */}
        {event.percentSold > 20 && event.percentSold < 100 && (
          <div className="absolute bottom-3 left-3 flex items-center gap-1">
            <Zap style={{ width: 11, height: 11, color: '#FBBF24' }} />
            <span className="font-mono font-bold" style={{ fontSize: '10px', color: '#FBBF24', letterSpacing: '0.04em' }}>
              {Math.round(event.percentSold)}% {t('explore.complete')}
            </span>
          </div>
        )}
        {event.percentSold >= 100 && (
          <div className="absolute bottom-3 left-3">
            <span className="font-mono font-bold" style={{ fontSize: '9px', letterSpacing: '0.14em', color: '#fff', background: '#E8192C', borderRadius: '3px', padding: '2px 7px' }}>
              SOLD OUT
            </span>
          </div>
        )}
      </div>

      {/* Info zone */}
      <div style={{ padding: '13px 14px 15px' }}>
        {/* Genre + trending */}
        <div className="flex items-center gap-2 mb-2">
          {event.genres.length > 0 && (
            <span className="font-mono" style={{ fontSize: '10px', color: '#9A9AA4', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '5px', padding: '2px 7px' }}>
              {event.genres[0]}
            </span>
          )}
          {event.isTrending && (
            <span className="flex items-center gap-0.5 font-mono" style={{ fontSize: '10px', color: '#E8192C' }}>
              <Flame style={{ width: 11, height: 11 }} />
              {t('explore.veryBooked')}
            </span>
          )}
        </div>

        <p className="font-mono" style={{ fontSize: '10.5px', letterSpacing: '0.05em', color: '#65656F', textTransform: 'uppercase', margin: '0 0 3px' }}>
          {event.venueName}
        </p>

        <h3
          className="font-display font-bold"
          style={{ fontSize: '18px', lineHeight: 1.1, color: '#fff', margin: '0 0 11px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {event.title}
        </h3>

        <div className="flex items-center justify-between">
          <span className="font-mono" style={{ fontSize: '11.5px', color: '#9A9AA4' }}>
            {dateLabel} · {timeLabel}
          </span>
          {price && (
            <span className="font-mono font-bold" style={{ fontSize: '13.5px', color: '#E8192C' }}>
              {price}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// Full-width hero card — utilisé quand il n'y a qu'une seule soirée
function HeroCard({ event }: { event: EventCardData }) {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { isFavorite, toggleFavorite } = useFavorites();
  const favType = event.isAffiliate ? 'affiliate_event' : 'event';
  const liked = isFavorite(favType, event.id);

  const dateLabel = format(new Date(event.startAt), 'dd MMM', { locale: dfLocale(language) }).toUpperCase();
  const timeLabel = format(new Date(event.startAt), 'HH:mm');
  const price = priceLabel(event, t);

  const handleFav = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(favType, event.id);
  };

  const handleClick = () => navigateToEvent(event, navigate);

  return (
    <div
      onClick={handleClick}
      className="relative cursor-pointer overflow-hidden"
      style={{ borderRadius: 20, border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 18px 40px -20px rgba(0,0,0,0.7)', height: 310 }}
    >
      {event.posterUrl ? (
        <img src={event.posterUrl} alt={event.title} className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg,#1a0f12,#3a1020 70%,#0f0f12)' }} />
      )}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to top,rgba(8,8,10,0.96) 15%,rgba(0,0,0,0.15) 60%,transparent)' }} />

      {/* Top */}
      <div className="absolute top-3.5 left-3.5 right-3.5 flex justify-between items-start">
        <div>
          {event.isAffiliate && (
            <span className="font-mono font-semibold" style={{ fontSize: '9.5px', letterSpacing: '0.14em', color: '#A78BFA', background: 'rgba(167,139,250,0.16)', border: '1px solid rgba(167,139,250,0.4)', borderRadius: 7, padding: '4px 8px', backdropFilter: 'blur(6px)' }}>
              {t('explore.partner')}
            </span>
          )}
          {event.isLive && (
            <span className="font-mono font-bold flex items-center gap-1 mt-1" style={{ fontSize: '9px', color: '#fff', background: '#E8192C', borderRadius: 4, padding: '2px 7px' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff', display: 'inline-block' }} />
              LIVE
            </span>
          )}
        </div>
        <button onClick={handleFav} aria-label="Favori" style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(10,10,12,0.55)', border: '1px solid rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', backdropFilter: 'blur(8px)', transition: '0.18s' }}>
          <Heart style={{ width: 16, height: 16, color: liked ? '#E8192C' : '#fff', fill: liked ? '#E8192C' : 'none' }} />
        </button>
      </div>

      {/* Bottom */}
      <div className="absolute left-4 right-4 bottom-4">
        <div className="flex items-center gap-2 mb-2">
          {event.genres.length > 0 && (
            <span className="font-mono" style={{ fontSize: '10.5px', color: '#9A9AA4', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, padding: '2px 7px' }}>
              {event.genres[0]}
            </span>
          )}
          {event.isTrending && (
            <span className="flex items-center gap-1 font-mono" style={{ fontSize: '10.5px', color: '#E8192C' }}>
              <Flame style={{ width: 13, height: 13 }} /> {t('explore.veryBooked')}
            </span>
          )}
        </div>
        <p className="font-mono" style={{ fontSize: '11.5px', letterSpacing: '0.06em', color: '#9A9AA4', margin: '0 0 4px' }}>
          {event.venueName.toUpperCase()}
        </p>
        <h2 className="font-display font-bold" style={{ fontSize: 28, letterSpacing: '-0.01em', lineHeight: 1.05, color: '#fff', margin: '0 0 14px' }}>
          {event.title}
        </h2>
        <div className="flex items-center justify-between">
          <span className="font-mono" style={{ fontSize: 13, color: '#9A9AA4' }}>{dateLabel} · {timeLabel}</span>
          {price && <span className="font-mono font-bold" style={{ fontSize: 16, color: '#E8192C' }}>{price}</span>}
        </div>
      </div>
    </div>
  );
}

interface ExploreEventCarouselProps {
  events: EventCardData[];
  city: string;
  periodLabel: string;
}

export function ExploreEventCarousel({ events, city, periodLabel }: ExploreEventCarouselProps) {
  const { t } = useLanguage();
  const Heading = (
    <div style={{ padding: '24px 20px 14px' }}>
      <p className="font-mono" style={{ fontSize: '10.5px', letterSpacing: '0.14em', color: '#65656F', marginBottom: 6 }}>
        {t('explore.selectionBasedOnTastes')}
      </p>
      <div className="flex items-baseline justify-between gap-2">
        <h1
          className="font-display font-bold"
          style={{ fontSize: '21px', color: '#fff', letterSpacing: '-0.01em', lineHeight: 1.1, margin: 0 }}
        >
          {periodLabel} {t('explore.atCity')} {city.toUpperCase()}
        </h1>
        {events.length > 1 && (
          <span className="font-mono shrink-0" style={{ fontSize: '11px', color: '#65656F' }}>
            {events.length} {t('explore.eventsWord')}
          </span>
        )}
      </div>
    </div>
  );

  // 0 events → empty state
  if (events.length === 0) {
    return (
      <div>
        {Heading}
        <p className="font-mono" style={{ padding: '0 20px 8px', fontSize: '13px', color: '#65656F' }}>
          {t('explore.noEventPeriod')}
        </p>
      </div>
    );
  }

  // 1 event → full-width hero card (comme le design original)
  if (events.length === 1) {
    return (
      <div>
        {Heading}
        <div style={{ padding: '0 20px 4px' }}>
          <HeroCard event={events[0]} />
        </div>
      </div>
    );
  }

  // 2+ events → carrousel swipeable, avec peek du suivant
  return (
    <div>
      {Heading}
      <div
        className="flex overflow-x-auto"
        style={{
          gap: 12,
          paddingBottom: 4,
          paddingLeft: 20,
          paddingRight: 20,
          scrollbarWidth: 'none',
          scrollSnapType: 'x mandatory',
          scrollPaddingLeft: 20,
          WebkitOverflowScrolling: 'touch',
        } as React.CSSProperties}
      >
        {events.map(e => (
          <CarouselCard key={e.id} event={e} />
        ))}
      </div>
    </div>
  );
}
