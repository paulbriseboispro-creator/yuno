import { Heart } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useFavorites } from '@/hooks/useFavorites';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { EventCardData } from './EventCard';
import { eventPath } from '@/lib/eventUrl';

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

export function ExploreListRow({ event }: { event: EventCardData }) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { isFavorite, toggleFavorite } = useFavorites();
  const favType = event.isAffiliate ? 'affiliate_event' : 'event';
  const liked = isFavorite(favType, event.id);

  const timeLabel = format(new Date(event.startAt), 'HH:mm');
  const price = priceLabel(event, t);

  const handleFav = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(favType, event.id);
  };

  return (
    <div
      onClick={() => navigateToEvent(event, navigate)}
      className="flex items-center gap-3 cursor-pointer"
      style={{ padding: '10px 0' }}
    >
      {/* Thumbnail */}
      <div
        className="relative shrink-0 overflow-hidden"
        style={{ width: 74, height: 74, borderRadius: '14px' }}
      >
        {event.posterUrl ? (
          <img
            src={event.posterUrl}
            alt={event.title}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(160deg, #1a0f12, #0f0f12)' }}
          />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <p
            className="font-mono"
            style={{ fontSize: '10px', letterSpacing: '0.05em', color: '#65656F', textTransform: 'uppercase' }}
          >
            {event.venueName}
          </p>
          {event.isAffiliate && (
            <span
              style={{ width: 5, height: 5, borderRadius: '50%', background: '#A78BFA', flexShrink: 0 }}
            />
          )}
        </div>
        <p
          className="font-display font-bold"
          style={{
            fontSize: '16px',
            lineHeight: 1.1,
            color: '#fff',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            margin: '0 0 6px',
          }}
        >
          {event.title}
        </p>
        <div className="flex items-center gap-2 font-mono" style={{ fontSize: '11px', color: '#9A9AA4' }}>
          <span>{timeLabel}</span>
          {event.genres.length > 0 && (
            <span
              style={{
                border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: '6px',
                padding: '2px 7px',
                fontSize: '10.5px',
              }}
            >
              {event.genres[0]}
            </span>
          )}
        </div>
      </div>

      {/* Right: price + fav */}
      <div className="flex flex-col items-end gap-2 shrink-0">
        {price && (
          <span
            className="font-mono font-bold"
            style={{ fontSize: '13px', color: '#E8192C', whiteSpace: 'nowrap' }}
          >
            {price}
          </span>
        )}
        <button
          onClick={handleFav}
          aria-label={liked ? t('explore.removeFav') : t('explore.addFav')}
          style={{
            width: 30,
            height: 30,
            borderRadius: '999px',
            background: 'rgba(10,10,12,0.55)',
            border: '1px solid rgba(255,255,255,0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: '0.18s',
          }}
        >
          <Heart
            className="h-3.5 w-3.5"
            style={{ color: liked ? '#E8192C' : '#fff', fill: liked ? '#E8192C' : 'none' }}
          />
        </button>
      </div>
    </div>
  );
}
