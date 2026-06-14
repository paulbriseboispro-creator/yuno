import { Heart, Flame } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useFavorites } from '@/hooks/useFavorites';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { EventCardData } from './EventCard';

function priceLabel(event: EventCardData, t: (k: string) => string): string {
  if (event.minPrice === 0) return t('explore.free');
  if (event.minPrice !== null) return `${t('explore.priceFrom')} ${event.minPrice}€`;
  return '';
}

function navigateToEvent(event: EventCardData, navigate: ReturnType<typeof useNavigate>) {
  if (event.isAffiliate && event.affiliateEventSlug) {
    navigate(`/affiliate-event/${event.affiliateEventSlug}`);
  } else if (event.isOrganizerLed || !event.venueSlug) {
    navigate(`/event/${event.id}`);
  } else {
    sessionStorage.setItem('yuno_club_origin', 'explore');
    navigate(`/club/${event.venueSlug}`);
  }
}

export function ExploreHeroCard({ event }: { event: EventCardData }) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { isFavorite, toggleFavorite } = useFavorites();
  const favType = event.isAffiliate ? 'affiliate_event' : 'event';
  const liked = isFavorite(favType, event.id);

  const dateLabel = format(new Date(event.startAt), 'dd MMM').toUpperCase();
  const timeLabel = format(new Date(event.startAt), 'HH:mm');
  const price = priceLabel(event, t);

  const handleFav = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(favType, event.id);
  };

  return (
    <div
      onClick={() => navigateToEvent(event, navigate)}
      className="relative cursor-pointer overflow-hidden"
      style={{
        borderRadius: '20px',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 18px 40px -20px rgba(0,0,0,0.7)',
        height: 300,
      }}
    >
      {/* Background image or fallback gradient */}
      {event.posterUrl ? (
        <img
          src={event.posterUrl}
          alt={event.title}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(160deg, #1a0f12 0%, #3a1020 70%, #0f0f12 100%)' }}
        />
      )}

      {/* Gradient overlay for text readability */}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(to top, rgba(8,8,10,0.96) 15%, rgba(0,0,0,0.15) 60%, transparent)' }}
      />

      {/* Top row: PARTENAIRE badge + fav */}
      <div className="absolute top-3.5 left-3.5 right-3.5 flex items-start justify-between">
        <div>
          {event.isAffiliate && (
            <span
              className="font-mono font-semibold"
              style={{
                fontSize: '9.5px',
                letterSpacing: '0.14em',
                color: '#A78BFA',
                background: 'rgba(167,139,250,0.16)',
                border: '1px solid rgba(167,139,250,0.4)',
                borderRadius: '7px',
                padding: '4px 8px',
                backdropFilter: 'blur(6px)',
              }}
            >
              {t('explore.partner')}
            </span>
          )}
        </div>
        <button
          onClick={handleFav}
          className="flex items-center justify-center"
          aria-label={liked ? t('explore.removeFav') : t('explore.addFav')}
          style={{
            width: 36,
            height: 36,
            borderRadius: '999px',
            background: liked ? '#E8192C' : 'rgba(10,10,12,0.55)',
            border: `1px solid ${liked ? '#E8192C' : 'rgba(255,255,255,0.25)'}`,
            backdropFilter: 'blur(8px)',
            transition: '0.18s',
            cursor: 'pointer',
          }}
        >
          <Heart
            className="h-4 w-4"
            style={{ color: '#fff', fill: liked ? '#fff' : 'none' }}
          />
        </button>
      </div>

      {/* Bottom content */}
      <div className="absolute left-4 right-4 bottom-4">
        <div className="flex items-center gap-2 mb-2">
          {event.genres.length > 0 && (
            <span
              className="font-mono"
              style={{
                fontSize: '10.5px',
                fontWeight: 500,
                color: '#9A9AA4',
                border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: '6px',
                padding: '2px 7px',
              }}
            >
              {event.genres[0]}
            </span>
          )}
          {event.isTrending && (
            <span
              className="flex items-center gap-1 font-mono"
              style={{ fontSize: '10.5px', color: '#E8192C' }}
            >
              <Flame className="h-3.5 w-3.5" />
              {t('explore.veryBooked')}
            </span>
          )}
          {event.isLive && (
            <span
              className="flex items-center gap-1 font-mono font-bold"
              style={{
                fontSize: '9px',
                letterSpacing: '0.1em',
                color: '#fff',
                background: '#E8192C',
                borderRadius: '4px',
                padding: '2px 6px',
              }}
            >
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff', display: 'inline-block' }} />
              LIVE
            </span>
          )}
        </div>

        <p
          className="font-mono mb-1"
          style={{ fontSize: '11.5px', letterSpacing: '0.06em', color: '#9A9AA4' }}
        >
          {event.venueName.toUpperCase()}
        </p>

        <h2
          className="font-display font-bold mb-3.5"
          style={{ fontSize: '26px', letterSpacing: '-0.01em', lineHeight: 1.05, color: '#fff', margin: '0 0 14px' }}
        >
          {event.title}
        </h2>

        <div className="flex items-center justify-between">
          <span className="font-mono" style={{ fontSize: '13px', color: '#9A9AA4' }}>
            {dateLabel} · {timeLabel}
          </span>
          {price && (
            <span className="font-mono font-bold" style={{ fontSize: '15px', color: '#E8192C' }}>
              {price}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
