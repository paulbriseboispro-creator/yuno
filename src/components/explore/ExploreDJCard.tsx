import { Users, Music, Bell, BadgeCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { useFavorites } from '@/hooks/useFavorites';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';

export interface ExploreDJItem {
  id: string;
  slug: string | null;
  /** Handle public propre (marco-v). Préféré au slug par-venue pour les liens. */
  handle: string | null;
  stageName: string;
  profileImageUrl: string | null;
  musicGenres: string[];
  isVerified: boolean;
  followersCount: number;
}

export function ExploreDJCard({ dj, rank }: { dj: ExploreDJItem; rank: number }) {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { isFavorite, toggleFavorite } = useFavorites();
  const following = isFavorite('dj', dj.id);

  const handleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await toggleFavorite('dj', dj.id);
  };

  const djPath = dj.handle || dj.slug;

  return (
    <div
      onClick={() => djPath && navigate(`/dj/${djPath}`)}
      className="shrink-0 overflow-hidden"
      style={{
        width: 140,
        borderRadius: '14px',
        background: '#141417',
        border: '1px solid rgba(255,255,255,0.08)',
        cursor: djPath ? 'pointer' : 'default',
      }}
    >
      {/* Portrait + overlays */}
      <div className="relative" style={{ height: 150 }}>
        {dj.profileImageUrl ? (
          <img
            src={getOptimizedImageUrl(dj.profileImageUrl, { width: 280, height: 300 })}
            alt={dj.stageName}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
            style={{ objectPosition: 'top', opacity: 0.82 }}
          />
        ) : (
          <div
            className="absolute inset-0 grid place-items-center"
            style={{ background: 'linear-gradient(160deg, #1a0f12, #0f0f12)' }}
          >
            <Music size={28} strokeWidth={2} color="#5A5A5E" />
          </div>
        )}

        {/* Style musical — haut-gauche */}
        {dj.musicGenres.length > 0 && (
          <div className="absolute top-2 left-2 z-10">
            <span className="genre-tag">{dj.musicGenres[0]}</span>
          </div>
        )}

        {/* Bouton favori (abonnement DJ) — haut-droite */}
        <button
          onClick={handleFavorite}
          className="absolute top-2 right-2 z-10 flex items-center justify-center rounded-full w-7 h-7 transition-all"
          style={{
            background: 'rgba(10,10,10,0.55)',
            border: '1px solid rgba(255,255,255,0.12)',
            backdropFilter: 'blur(8px)',
          }}
          aria-label={following ? t('subscribe.active') : t('subscribe.action')}
        >
          <Bell className={cn('h-3.5 w-3.5 transition-all', following ? 'fill-primary text-primary' : 'text-white/70')} />
        </button>

        {/* Numéro de classement fantôme — bas-gauche */}
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
        <div className="flex items-center gap-1" style={{ marginBottom: 5 }}>
          <p
            className="font-display font-bold"
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: '13.5px',
              lineHeight: 1.05,
              color: '#fff',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              margin: 0,
              textTransform: 'uppercase',
            }}
          >
            {dj.stageName}
          </p>
          {dj.isVerified && <BadgeCheck size={13} className="text-primary shrink-0" />}
        </div>
        <span
          className="flex items-center gap-1 font-mono"
          style={{ fontSize: '10px', color: dj.followersCount > 0 ? '#9A9AA4' : '#4A4A54' }}
        >
          <Users className="h-3 w-3 shrink-0" />
          {dj.followersCount.toLocaleString(language)} {t('djPublic.followers')}
        </span>
      </div>
    </div>
  );
}
