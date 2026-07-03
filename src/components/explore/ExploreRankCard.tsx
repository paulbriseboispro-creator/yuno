import { Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import { EventCardData } from './EventCard';
import { eventPath } from '@/lib/eventUrl';

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

export function ExploreRankCard({ event, rank }: { event: EventCardData; rank: number }) {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const dateLabel = format(new Date(event.startAt), 'd MMM', { locale: dateLocale }).toUpperCase();

  return (
    <div
      onClick={() => navigateToEvent(event, navigate)}
      className="shrink-0 cursor-pointer overflow-hidden"
      style={{
        width: 165,
        borderRadius: '14px',
        background: '#141417',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {/* Image avec numéro en overlay */}
      <div className="relative" style={{ height: 100 }}>
        {event.posterUrl ? (
          <img
            src={event.posterUrl}
            alt={event.title}
            className="absolute inset-0 w-full h-full object-cover"
            style={{ opacity: 0.75 }}
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(160deg, #1a0f12, #0f0f12)' }}
          />
        )}
        {/* Numéro fantôme en bas à gauche de l'image */}
        <span
          className="font-display font-bold"
          style={{
            position: 'absolute',
            bottom: 4,
            left: 8,
            fontSize: '52px',
            lineHeight: 0.85,
            color: 'transparent',
            WebkitTextStroke: '1.5px rgba(255,255,255,0.32)',
            pointerEvents: 'none',
          }}
        >
          {rank}
        </span>
      </div>

      {/* Info */}
      <div style={{ padding: '9px 10px 10px' }}>
        <p
          className="font-mono"
          style={{ fontSize: '9.5px', letterSpacing: '0.06em', color: '#65656F', margin: '0 0 3px', textTransform: 'uppercase' }}
        >
          {dateLabel}
        </p>
        <p
          className="font-display font-bold"
          style={{
            fontSize: '13.5px',
            lineHeight: 1.05,
            color: '#fff',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            margin: '0 0 6px',
          }}
        >
          {event.title}
        </p>
        <span
          className="flex items-center gap-1 font-mono"
          style={{ fontSize: '10px', color: event.interestedCount > 0 ? '#9A9AA4' : '#4A4A54' }}
        >
          <Users className="h-3 w-3 shrink-0" />
          {event.interestedCount > 0
            ? `${event.interestedCount.toLocaleString(language)} ${t('explore.interested')}`
            : `0 ${t('explore.interested')}`}
        </span>
      </div>
    </div>
  );
}
