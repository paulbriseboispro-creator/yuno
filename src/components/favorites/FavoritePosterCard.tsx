import { Bell, Calendar, Music, Users, Wine } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { FavoriteButton } from '@/components/FavoriteButton';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { D, glowStyle, hueFromId, type FavItem, type FavKind } from './shared';

/** Icône de repli quand un favori n'a ni affiche ni logo. */
const FALLBACK_ICON: Record<FavKind, React.ElementType> = {
  club: Music,
  event: Calendar,
  dj: Music,
  drink: Wine,
  organizer: Users,
};

/** Libellé du badge type, en haut à gauche. */
function typeLabel(kind: FavKind, t: (k: string) => string): string {
  switch (kind) {
    case 'club':      return t('favorites.typeClub');
    case 'event':     return t('favorites.typeEvent');
    case 'dj':        return t('favorites.typeDJ');
    case 'drink':     return t('favorites.typeDrink');
    case 'organizer': return t('favorites.typeOrganizer');
  }
}

/* ── Badge en verre, coin haut-gauche ── */
function GlassBadge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'violet' }) {
  const violet = tone === 'violet';
  return (
    <span style={{
      display: 'inline-block',
      width: 'fit-content',
      fontFamily: D.mono,
      fontSize: 9,
      fontWeight: 600,
      letterSpacing: '.14em',
      lineHeight: 1,
      textTransform: 'uppercase',
      padding: '5px 7px',
      borderRadius: 7,
      color: violet ? D.violet : '#E5E5E5',
      background: violet ? 'rgba(23,10,30,.72)' : 'rgba(10,10,10,.62)',
      border: `1px solid ${violet ? 'rgba(167,139,250,.45)' : 'rgba(255,255,255,.16)'}`,
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

/* ── Pill de genre, ligne du bas ── */
function GenrePill({ text }: { text: string }) {
  return (
    <span style={{
      flexShrink: 0,
      maxWidth: 100,
      fontFamily: D.mono,
      fontSize: 9.5,
      fontWeight: 600,
      lineHeight: 1,
      letterSpacing: '.04em',
      padding: '4px 7px',
      borderRadius: 6,
      color: D.redText,
      background: 'rgba(232,25,44,.16)',
      border: '1px solid rgba(232,25,44,.30)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }}>
      {text}
    </span>
  );
}

/**
 * Carte « affiche » de la mosaïque favoris : image plein cadre, dégradé, badge de
 * type, bouton cœur/cloche en verre, bloc texte ancré en bas. Une seule carte pour
 * les cinq familles — elle ne lit que les primitives de présentation du FavItem
 * (voir shared.ts), jamais le métier.
 *
 * `onUnfollow` n'est fourni que pour les organisateurs : eux seuls vivent hors de
 * la table `favorites` (→ `organizer_profile_followers`) et ne peuvent donc pas
 * passer par <FavoriteButton>.
 */
export function FavoritePosterCard({ item, onUnfollow }: { item: FavItem; onUnfollow?: () => void }) {
  const { t } = useLanguage();
  const hue = hueFromId(item.id);
  const clickable = !!item.onOpen;
  const Fallback = FALLBACK_ICON[item.kind];
  const contain = item.imageFit === 'contain';

  return (
    <article
      className="fav-poster"
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={item.onOpen}
      onKeyDown={(e) => {
        if (!clickable) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          item.onOpen?.();
        }
      }}
      style={{
        position: 'relative',
        aspectRatio: '1 / 1',
        borderRadius: 18,
        overflow: 'hidden',
        border: `1px solid ${D.line}`,
        boxShadow: '0 18px 38px -26px rgba(0,0,0,.95)',
        cursor: clickable ? 'pointer' : 'default',
        // Image → fond noir uni : une image transparente (logo PNG) ne doit pas
        // laisser passer de couleur. Pas d'image → le glow prend le relais pour
        // que la carte reste une affiche, jamais un rectangle vide.
        ...(item.imageUrl ? { background: '#0A0A0A' } : glowStyle(hue)),
      }}
    >
      {/* Artwork — cadre 1:1. `contain` laisse la bouteille entière et centrée
          sur le noir ; le padding bas la dégage du bloc titre/prix. */}
      {item.imageUrl ? (
        <img
          src={getOptimizedImageUrl(item.imageUrl, contain
            ? { width: 480, height: 480, resize: 'contain' }
            : { width: 480, height: 480 })}
          alt=""
          loading="lazy"
          decoding="async"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: contain ? 'contain' : 'cover',
            display: 'block',
            ...(contain ? { padding: '12% 12% 26%', boxSizing: 'border-box' as const } : {}),
          }}
        />
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          <Fallback size={40} strokeWidth={1.5} color="rgba(255,255,255,.8)" />
        </div>
      )}

      {/* Dégradé de lisibilité — le texte du bas doit tenir sur n'importe quelle affiche */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to top, rgba(8,8,10,.94) 0%, rgba(8,8,10,.72) 28%, rgba(8,8,10,.12) 58%, rgba(8,8,10,.42) 100%)',
        }}
      />

      {/* Badges type + partenaire */}
      <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 5, maxWidth: 'calc(100% - 62px)' }}>
        <GlassBadge>{typeLabel(item.kind, t)}</GlassBadge>
        {item.isAffiliate && <GlassBadge tone="violet">{t('favorites.badgePartner')}</GlassBadge>}
      </div>

      {/* Cœur / cloche */}
      <div style={{ position: 'absolute', top: 10, right: 10 }} onClick={(e) => e.stopPropagation()}>
        {item.favType ? (
          <FavoriteButton
            type={item.favType}
            id={item.id}
            className="h-9 w-9 rounded-full backdrop-blur-md"
            iconClassName="h-4 w-4"
            style={{ background: 'rgba(10,10,10,.58)', border: '1px solid rgba(255,255,255,.16)' }}
          />
        ) : (
          <button
            onClick={onUnfollow}
            aria-label={t('subscribe.active')}
            className="h-9 w-9 rounded-full backdrop-blur-md"
            style={{
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              padding: 0,
              background: 'rgba(10,10,10,.58)',
              border: '1px solid rgba(255,255,255,.16)',
            }}
          >
            <Bell size={16} strokeWidth={2} fill={D.red} color={D.red} />
          </button>
        )}
      </div>

      {/* Bloc texte — ancré en bas : il grandit vers le HAUT, donc la ligne meta
          reste alignée d'une carte à l'autre quel que soit le nombre de lignes du titre. */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '12px 12px 13px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h3 style={{
          margin: 0,
          minWidth: 0,
          fontFamily: D.display,
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: '-.02em',
          lineHeight: 1.15,
          color: '#fff',
          // 2 lignes plutôt qu'une ellipse : sur 160px de large, « Une soirée au
          // titre vraiment très long » se réduisait à « Une soirée au t… ». Le nom
          // est ce qu'on cherche du regard — on lui laisse deux lignes avant de couper.
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical' as const,
          overflow: 'hidden',
          overflowWrap: 'anywhere',
          textShadow: '0 2px 12px rgba(0,0,0,.55)',
        }}>
          {item.title}
        </h3>

        {(item.footerTag || item.price || item.meta) && (
          // `wrap` plutôt qu'ellipsis : sur 160px, « [Melodic] 3,2 k abonnés » déborde
          // d'une poignée de pixels. Passer à la ligne garde les deux infos entières.
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, rowGap: 5, minWidth: 0, flexWrap: 'wrap' }}>
            {item.footerTag && <GenrePill text={item.footerTag} />}
            {item.price && (
              <span style={{
                flexShrink: 0,
                fontFamily: D.mono,
                fontSize: 13,
                fontWeight: 700,
                color: D.red,
                lineHeight: 1.1,
                whiteSpace: 'nowrap',
              }}>
                {item.price}
              </span>
            )}
            {item.meta && (
              <span style={{
                minWidth: 0,
                fontFamily: D.mono,
                fontSize: 10.5,
                fontWeight: item.metaTone === 'accent' ? 600 : 400,
                letterSpacing: '.04em',
                color: item.metaTone === 'accent' ? D.red : D.muted,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {item.meta}
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
