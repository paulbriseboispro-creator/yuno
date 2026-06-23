import { useState } from 'react';
import { Heart, Zap, Users } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { useFavorites } from '@/hooks/useFavorites';
import { format } from 'date-fns';

export interface EventCardData {
  id: string;
  title: string;
  posterUrl: string | null;
  startAt: string;
  endAt: string;
  venueName: string;
  venueSlug: string;
  venueCity: string;
  minPrice: number | null;
  genres: string[];
  interestedCount: number;
  percentSold: number;
  tablesRemaining: number | null;
  isTrending: boolean;
  distance?: number | null;
  eventType?: string;
  isLive?: boolean;
  isOrganizerLed?: boolean;
  organizerName?: string;
  // Affiliate events (external ticket link, no in-app checkout)
  isAffiliate?: boolean;
  affiliateEventSlug?: string;
}

export function EventCard({ event }: { event: EventCardData }) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { isFavorite, toggleFavorite } = useFavorites();
  const reduceMotion = useReducedMotion();
  const favType = event.isAffiliate ? 'affiliate_event' : 'event';
  const liked = isFavorite(favType, event.id);
  const [favPop, setFavPop] = useState(0);

  const dateLabel = format(new Date(event.startAt), 'dd MMM').toUpperCase();
  const timeLabel = format(new Date(event.startAt), 'HH:mm');

  const handleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const willActivate = !liked;
    await toggleFavorite(favType, event.id);
    if (willActivate && !reduceMotion) setFavPop((k) => k + 1);
  };

  const handleClick = () => {
    if (event.isAffiliate && event.affiliateEventSlug) {
      navigate(`/affiliate-event/${event.affiliateEventSlug}`);
    } else if (event.isOrganizerLed || !event.venueSlug) {
      navigate(`/event/${event.id}`);
    } else {
      sessionStorage.setItem('yuno_club_origin', 'explore');
      navigate(`/club/${event.venueSlug}`);
    }
  };

  return (
    <article
      onClick={handleClick}
      className="event-card group flex flex-col"
    >
      {/* Image — carré 1:1 */}
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: '1/1' }}>
        {event.posterUrl ? (
          <>
            <img
              src={event.posterUrl}
              alt={event.title}
              className="event-card-img h-full w-full object-cover"
              loading="lazy"
            />
            <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.10)' }} />
          </>
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(160deg, #1a0f12 0%, #3a1020 100%)' }}
          />
        )}

        {/* Sold out */}
        {event.percentSold >= 100 && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50">
            <span
              className="font-mono font-bold tracking-[0.18em] text-white px-3 py-1"
              style={{ fontSize: '10px', background: '#E8192C', borderRadius: '2px' }}
            >
              SOLD OUT
            </span>
          </div>
        )}

        {/* Top badges */}
        <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1.5">
          {event.isAffiliate && (
            <span
              className="font-mono font-bold tracking-[0.14em]"
              style={{ fontSize: '9px', color: '#C084FC', background: 'rgba(192,132,252,0.15)', border: '1px solid rgba(192,132,252,0.3)', borderRadius: '2px', padding: '2px 6px' }}
            >
              {t('explore.partner')}
            </span>
          )}
          {event.isLive && (
            <span className="badge-live">
              <span className="dot-live" style={{ width: 5, height: 5 }} />
              LIVE
            </span>
          )}
          {event.genres.slice(0, 1).map(g => (
            <span key={g} className="genre-tag">{g}</span>
          ))}
        </div>

        {/* Scarcity */}
        {event.percentSold > 20 && event.percentSold < 100 && (
          <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1">
            <Zap className="h-3 w-3 text-amber-400" />
            <span
              className="font-mono font-bold text-amber-400"
              style={{ fontSize: '10px', letterSpacing: '0.06em' }}
            >
              {Math.round(event.percentSold)}%
            </span>
          </div>
        )}

        {/* Fav button */}
        <button
          onClick={handleFavorite}
          className="absolute bottom-2.5 right-2.5 z-10 flex items-center justify-center rounded-full w-7 h-7 transition-all"
          style={{
            background: 'rgba(10,10,10,0.55)',
            border: '1px solid rgba(255,255,255,0.12)',
            backdropFilter: 'blur(8px)',
          }}
          aria-label={liked ? t('explore.removeFav') : t('explore.addFav')}
        >
          <motion.span
            key={favPop}
            className="inline-flex"
            animate={favPop > 0 ? { scale: [1, 1.3, 1] } : false}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <Heart
              className={cn('h-3.5 w-3.5 transition-all', liked ? 'fill-primary text-primary' : 'text-white/60')}
            />
          </motion.span>
        </button>
      </div>

      {/* Info panel */}
      <div
        className="flex flex-col flex-1 px-3.5 py-3 gap-1.5"
        style={{ background: '#141414' }}
      >
        {/* Club name */}
        <p
          className="font-mono truncate"
          style={{ fontSize: '10px', color: '#9A9A9A', letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1 }}
        >
          {event.venueName}
        </p>

        {/* Titre — Space Grotesk uppercase */}
        <h3
          className="font-display line-clamp-2"
          style={{
            fontSize: 'clamp(14px, 2.5vw, 17px)',
            fontWeight: 700,
            color: '#FFFFFF',
            textTransform: 'uppercase',
            lineHeight: 1.05,
            letterSpacing: '-0.005em',
          }}
        >
          {event.title}
        </h3>

        <div className="flex-1" />

        {/* Bas du panel : date + prix */}
        <div
          className="flex items-center justify-between gap-2 pt-2.5"
          style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
        >
          <p
            className="font-mono"
            style={{ fontSize: '11px', color: '#9A9A9A', letterSpacing: '0.04em' }}
          >
            {dateLabel} · {timeLabel}
            {event.distance != null && (
              <span style={{ color: '#5A5A5E' }}>
                {' '}· {event.distance < 1 ? `${Math.round(event.distance * 1000)}m` : `${event.distance.toFixed(1)}km`}
              </span>
            )}
          </p>

          {event.minPrice !== null ? (
            <p
              className="font-mono font-bold shrink-0"
              style={{ fontSize: '12px', color: '#E8192C', letterSpacing: '0.02em' }}
            >
              {t('explore.from')} {event.minPrice}€
            </p>
          ) : event.interestedCount > 0 ? (
            <span
              className="flex items-center gap-1 font-mono shrink-0"
              style={{ fontSize: '10px', color: '#5A5A5E' }}
            >
              <Users className="h-3 w-3" />
              {event.interestedCount}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}
