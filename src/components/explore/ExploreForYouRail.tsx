import { Heart, Disc3, Star, Sparkles, Music } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { useFavorites } from '@/hooks/useFavorites';
import { useLanguage } from '@/contexts/LanguageContext';
import { eventTargetPath } from '@/lib/eventNavigation';
import { FadeInView } from '@/components/motion';
import { ExploreSectionTitle } from './ExploreSectionTitle';
import type { EventCardData } from './EventCard';
import type { ForYouItem, ForYouReasonCode } from '@/hooks/useForYouFeed';

// Module « Pour toi » — DESIGN_SYSTEM_PUBLIC (éditorial, noir, mono trackée).
//
// La carte porte SA RAISON. C'est la seule chose qui distingue visuellement une
// recommandation d'une ligne de programme : « GUEST joue », « Au Sabot, que tu
// suis », « Comme la soirée que tu as aimée ». Sans elle le module redevient
// une liste, quel que soit le classement derrière.

const dfLocale = (lang: string) => (lang === 'fr' ? fr : lang === 'es' ? es : enUS);

const REASON_ICON: Record<ForYouReasonCode, typeof Disc3> = {
  dj: Disc3,
  venue: Star,
  similar: Sparkles,
  genre: Music,
  taste: Sparkles,
};

function ForYouCard({ item }: { item: ForYouItem }) {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { isFavorite, toggleFavorite } = useFavorites();

  const event: EventCardData = item.event;
  const liked = isFavorite('event', event.id);
  const dateLabel = format(new Date(event.startAt), 'EEE dd MMM', { locale: dfLocale(language) }).toUpperCase();
  const price =
    event.minPrice === 0 ? t('explore.free')
    : event.minPrice !== null ? `${t('explore.priceFrom')} ${event.minPrice}€`
    : '';

  const value = item.reasonValue || '';
  const reason =
    item.reasonCode === 'dj'      ? t('foryou.reason.dj').replace('{name}', value)
    : item.reasonCode === 'venue' ? t('foryou.reason.venue').replace('{name}', value)
    : item.reasonCode === 'similar' ? t('foryou.reason.similar').replace('{title}', value)
    : item.reasonCode === 'genre' ? t('foryou.reason.genre').replace('{genre}', value)
    : t('foryou.reason.taste');

  const ReasonIcon = REASON_ICON[item.reasonCode];

  return (
    <div
      onClick={() => navigate(eventTargetPath(event))}
      className="shrink-0 cursor-pointer overflow-hidden"
      style={{
        width: 240,
        borderRadius: '18px',
        background: '#141417',
        // Le liseré rouge signe le module : ces cartes ne sont pas le programme,
        // elles sont un choix qu'on assume.
        border: '1px solid rgba(232,25,44,0.32)',
      }}
    >
      <div className="relative" style={{ aspectRatio: '1 / 1' }}>
        {event.posterUrl ? (
          <img src={event.posterUrl} alt={event.title} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, #1a0f12, #0f0f12)' }} />
        )}

        <button
          onClick={(e) => { e.stopPropagation(); toggleFavorite('event', event.id); }}
          aria-label={liked ? t('explore.removeFav') : t('explore.addFav')}
          className="absolute"
          style={{
            top: 10, right: 10, width: 32, height: 32, borderRadius: '999px',
            background: 'rgba(10,10,12,0.55)', border: '1px solid rgba(255,255,255,0.25)',
            backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', cursor: 'pointer', transition: '0.18s',
          }}
        >
          <Heart className="h-3.5 w-3.5" style={{ color: liked ? '#E8192C' : '#fff', fill: liked ? '#E8192C' : 'none' }} />
        </button>
      </div>

      {/* La raison, juste sous l'image : on explique avant de vendre. */}
      <div
        className="flex items-center gap-1.5"
        style={{
          padding: '8px 13px',
          background: 'rgba(232,25,44,0.09)',
          borderBottom: '1px solid rgba(232,25,44,0.16)',
        }}
      >
        <ReasonIcon className="h-3 w-3 shrink-0" style={{ color: '#E8192C' }} />
        <span
          className="font-mono truncate"
          style={{ fontSize: '10px', letterSpacing: '0.07em', textTransform: 'uppercase', color: '#F2A2AB' }}
        >
          {reason}
        </span>
      </div>

      <div style={{ padding: '11px 13px 14px' }}>
        <p
          className="font-mono mb-0.5 truncate"
          style={{ fontSize: '10.5px', letterSpacing: '0.05em', color: '#65656F', textTransform: 'uppercase' }}
        >
          {event.venueName}
        </p>
        <h3
          className="font-display font-bold"
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

export function ExploreForYouRail({ items }: { items: ForYouItem[] }) {
  const { t } = useLanguage();

  // En dessous de 3, une « sélection » n'en est pas une : on ne montre rien.
  // La RPC applique déjà la même règle ; on la redit ici pour que le module
  // reste correct même si on l'appelle avec une autre source un jour.
  if (items.length < 3) return null;

  return (
    <FadeInView style={{ marginTop: 32 }}>
      <ExploreSectionTitle kicker={t('foryou.kicker')} title={t('foryou.title')} />
      <p
        className="font-mono"
        style={{ fontSize: '11px', color: '#65656F', margin: '-8px 0 12px', paddingLeft: 20, paddingRight: 20 }}
      >
        {t('foryou.subtitle')}
      </p>
      <div
        className="flex overflow-x-auto"
        style={{ gap: 14, paddingBottom: 8, paddingLeft: 20, paddingRight: 20, scrollbarWidth: 'none' } as React.CSSProperties}
      >
        {items.map((item) => (
          <ForYouCard key={item.event.id} item={item} />
        ))}
      </div>
    </FadeInView>
  );
}
