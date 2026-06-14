import { useNavigate } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { toParisTime } from '@/lib/timezone';
import { FavoriteButton } from '@/components/FavoriteButton';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';

interface TodayEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  ticketsRemaining: number | null;
  ticketingEnabled: boolean;
}

interface VenueCardProps {
  id: string;
  name: string;
  city: string;
  coverUrl: string | null;
  logoUrl: string | null;
  distance?: number;
  isNew?: boolean;
  isPopular?: boolean;
  todayEvent?: TodayEvent;
  priority?: boolean;
}

const VenueCard = ({
  id,
  name,
  city,
  coverUrl,
  logoUrl,
  distance,
  isNew,
  isPopular,
  todayEvent,
  priority = false,
}: VenueCardProps) => {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const formatDistance = (d: number) => {
    if (d === Infinity) return null;
    if (d < 1) return `${Math.round(d * 1000)}m`;
    return `${Math.round(d)}km`;
  };

  return (
    <article
      className="event-card group flex flex-col cursor-pointer"
      onClick={() => {
        sessionStorage.setItem('fromWelcome', 'true');
        navigate(`/club/${id}`);
      }}
    >
      {/* Cover — 16:9 */}
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: '16/9' }}>
        {coverUrl ? (
          <>
            <img
              src={getOptimizedImageUrl(coverUrl, { width: 480, quality: 65 })}
              alt={name}
              width={480}
              height={270}
              loading={priority ? 'eager' : 'lazy'}
              decoding={priority ? 'sync' : 'async'}
              fetchPriority={priority ? 'high' : undefined}
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
            />
            <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.10)' }} />
          </>
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: 'linear-gradient(160deg, #1a0f12 0%, #3a1020 100%)' }}
          >
            <span
              className="font-display font-bold text-primary/40"
              style={{ fontSize: '48px' }}
            >
              {name.charAt(0)}
            </span>
          </div>
        )}

        {/* Gradient overlay */}
        <div className="card-overlay absolute inset-0" />

        {/* Top badges */}
        <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1.5">
          {isNew && (
            <span
              className="font-mono font-bold uppercase tracking-wider"
              style={{
                fontSize: '10px',
                letterSpacing: '0.10em',
                padding: '3px 9px',
                borderRadius: '999px',
                background: 'rgba(16, 185, 129, 0.15)',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                color: '#10b981',
              }}
            >
              {t('badge.new')}
            </span>
          )}
          {isPopular && (
            <span
              className="font-mono font-bold uppercase tracking-wider"
              style={{
                fontSize: '10px',
                letterSpacing: '0.10em',
                padding: '3px 9px',
                borderRadius: '999px',
                background: 'rgba(245, 158, 11, 0.15)',
                border: '1px solid rgba(245, 158, 11, 0.40)',
                color: '#f59e0b',
              }}
            >
              HOT
            </span>
          )}
          {todayEvent && (
            <span className="badge-live">
              <span className="dot-live" style={{ width: 5, height: 5 }} />
              TONIGHT
            </span>
          )}
        </div>

        {/* Distance */}
        {distance !== undefined && distance !== Infinity && (
          <div
            className="absolute top-2.5 right-2.5 z-10 font-mono font-bold"
            style={{
              fontSize: '10px',
              letterSpacing: '0.06em',
              padding: '3px 8px',
              borderRadius: '999px',
              background: 'rgba(10,10,10,0.6)',
              border: '1px solid rgba(255,255,255,0.14)',
              color: '#9A9A9A',
              backdropFilter: 'blur(8px)',
            }}
          >
            {formatDistance(distance)}
          </div>
        )}

        {/* Fav button */}
        <FavoriteButton
          type="club"
          id={id}
          className="absolute bottom-2.5 right-2.5 z-10 h-7 w-7 opacity-70 hover:opacity-100 transition-opacity"
          style={{
            background: 'rgba(10,10,10,0.55)',
            border: '1px solid rgba(255,255,255,0.12)',
            backdropFilter: 'blur(8px)',
          }}
          size="icon"
        />

        {/* Logo */}
        {logoUrl && (
          <div className="absolute bottom-3 left-3 z-10">
            <img
              src={getOptimizedImageUrl(logoUrl, { width: 96, height: 96, quality: 85 })}
              alt={`${name} logo`}
              className="w-10 h-10 rounded-full object-cover"
              style={{ border: '2px solid rgba(255,255,255,0.15)' }}
            />
          </div>
        )}
      </div>

      {/* Info panel */}
      <div
        className="flex flex-col px-3.5 py-3 gap-1"
        style={{ background: '#141414' }}
      >
        <h3
          className="font-display truncate"
          style={{
            fontSize: 'clamp(14px, 2.5vw, 17px)',
            fontWeight: 700,
            color: '#FFFFFF',
            textTransform: 'uppercase',
            letterSpacing: '-0.005em',
            lineHeight: 1.1,
          }}
        >
          {name}
        </h3>

        <div
          className="flex items-center justify-between gap-2 pt-2"
          style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div className="flex items-center gap-1">
            <MapPin className="w-3 h-3 shrink-0" style={{ color: '#5A5A5E' }} />
            <span
              className="font-mono truncate"
              style={{ fontSize: '11px', color: '#9A9A9A', letterSpacing: '0.04em' }}
            >
              {city}
            </span>
          </div>

          {todayEvent && (
            <span
              className="font-mono font-bold shrink-0"
              style={{ fontSize: '11px', color: '#E8192C', letterSpacing: '0.04em' }}
            >
              {format(toParisTime(new Date(todayEvent.startAt)), 'HH:mm')}
              {' → '}
              {format(toParisTime(new Date(todayEvent.endAt)), 'HH:mm')}
            </span>
          )}
        </div>
      </div>
    </article>
  );
};

export default VenueCard;
