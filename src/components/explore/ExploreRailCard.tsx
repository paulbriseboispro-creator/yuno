import { Heart } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useFavorites } from '@/hooks/useFavorites';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { EventCardData } from './EventCard';
import { eventPriceLabel as priceLabel } from '@/lib/eventPriceLabel';
import { eventTargetPath } from '@/lib/eventNavigation';
import { cardImage } from '@/lib/imageOptimization';

const dfLocale = (lang: string) => (lang === 'fr' ? fr : lang === 'es' ? es : enUS);



function navigateToEvent(event: EventCardData, navigate: ReturnType<typeof useNavigate>) {
  navigate(eventTargetPath(event));
}

export function ExploreRailCard({ event }: { event: EventCardData }) {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { isFavorite, toggleFavorite } = useFavorites();
  const favType = event.isAffiliate ? 'affiliate_event' : 'event';
  const liked = isFavorite(favType, event.id);

  const dateLabel = format(new Date(event.startAt), 'EEE dd MMM', { locale: dfLocale(language) }).toUpperCase();
  const price = priceLabel(event, t);

  const handleFav = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(favType, event.id);
  };

  const handleOpen = () => navigateToEvent(event, navigate);

  return (
    <div
      onClick={handleOpen}
      role="button"
      tabIndex={0}
      aria-label={event.title}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpen();
        }
      }}
      className="shrink-0 cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      style={{
        width: 222,
        borderRadius: '18px',
        background: '#141417',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {/* Image area — carré 1:1 */}
      <div className="relative" style={{ aspectRatio: '1 / 1' }}>
        {event.posterUrl ? (
          <img
            src={cardImage(event.posterUrl, 480)}
            alt={event.title}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(160deg, #1a0f12, #0f0f12)' }}
          />
        )}

        {/* Top: PARTENAIRE badge + fav */}
        <div className="absolute top-2.5 left-2.5 right-2.5 flex items-start justify-between">
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
            aria-label={liked ? t('explore.removeFav') : t('explore.addFav')}
            style={{
              width: 32,
              height: 32,
              borderRadius: '999px',
              background: 'rgba(10,10,12,0.55)',
              border: '1px solid rgba(255,255,255,0.25)',
              backdropFilter: 'blur(8px)',
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

      {/* Info panel */}
      <div style={{ padding: '12px 13px 14px' }}>
        <p
          className="font-mono mb-0.5"
          style={{ fontSize: '10.5px', letterSpacing: '0.05em', color: '#65656F', textTransform: 'uppercase' }}
        >
          {event.venueName}
        </p>
        <h3
          className="font-display font-bold mb-2.5"
          style={{ fontSize: '16.5px', lineHeight: 1.1, color: '#fff', margin: '0 0 10px' }}
        >
          {event.title}
        </h3>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono truncate" style={{ fontSize: '11.5px', color: '#9A9AA4' }}>
            {dateLabel}
          </span>
          {price && (
            <span className="font-mono font-bold shrink-0" style={{ fontSize: '13px', color: '#E8192C' }}>
              {price}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
