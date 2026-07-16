import { Bell, Calendar, Music, Users, Wine } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { FavoriteButton } from '@/components/FavoriteButton';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { D, glowStyle, hueFromId, type FavItem, type FavKind } from './shared';

const FALLBACK_ICON: Record<FavKind, React.ElementType> = {
  club: Music,
  event: Calendar,
  dj: Music,
  drink: Wine,
  organizer: Users,
};

function typeLabel(kind: FavKind, t: (k: string) => string): string {
  switch (kind) {
    case 'club':      return t('favorites.typeClub');
    case 'event':     return t('favorites.typeEvent');
    case 'dj':        return t('favorites.typeDJ');
    case 'drink':     return t('favorites.typeDrink');
    case 'organizer': return t('favorites.typeOrganizer');
  }
}

/**
 * Vue liste de la mosaïque : même FavItem que <FavoritePosterCard>, densité
 * différente. L'affiche séduit, la ligne scanne — au-delà d'une trentaine de
 * favoris, la grille demande trop de scroll pour retrouver un item précis.
 *
 * Anatomie DS public §6.1 : kicker mono (le type) au-dessus du titre, puis la
 * ligne meta. Le type passe en kicker plutôt qu'en badge posé sur l'image :
 * dans une liste mélangée, c'est la première chose qu'on lit.
 */
export function FavoriteListRow({ item, onUnfollow }: { item: FavItem; onUnfollow?: () => void }) {
  const { t } = useLanguage();
  const hue = hueFromId(item.id);
  const clickable = !!item.onOpen;
  const Fallback = FALLBACK_ICON[item.kind];
  const cover = item.fit === 'cover' && item.imageUrl;

  return (
    <div
      className="fav-row"
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
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 13px',
        background: `linear-gradient(150deg, ${D.surface2}, ${D.surface})`,
        border: `1px solid ${D.line}`,
        borderRadius: 16,
        boxShadow: '0 14px 30px -22px rgba(0,0,0,.9)',
        cursor: clickable ? 'pointer' : 'default',
        outline: 'none',
      }}
    >
      {/* Vignette */}
      <div style={{
        position: 'relative',
        width: 56,
        height: 56,
        flex: 'none',
        borderRadius: 13,
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)',
        ...(cover ? { background: D.surface } : glowStyle(hue)),
      }}>
        {item.imageUrl ? (
          <img
            src={getOptimizedImageUrl(item.imageUrl, cover
              ? { width: 112, height: 112 }
              : { width: 112, height: 112, resize: 'contain' })}
            alt=""
            loading="lazy"
            decoding="async"
            style={cover
              ? { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }
              : { width: '78%', height: '78%', objectFit: 'contain', display: 'block' }}
          />
        ) : (
          <Fallback size={22} strokeWidth={1.8} color="rgba(255,255,255,.8)" />
        )}
        <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'linear-gradient(160deg, transparent 45%, rgba(8,8,10,.4))' }} />
      </div>

      {/* Texte */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{
            fontFamily: D.mono,
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '.14em',
            textTransform: 'uppercase',
            color: D.faint,
          }}>
            {typeLabel(item.kind, t)}
          </span>
          {item.isAffiliate && (
            <span style={{
              fontFamily: D.mono,
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '.14em',
              color: D.violet,
            }}>
              · {t('favorites.badgePartner')}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, marginBottom: 3 }}>
          <span style={{
            flex: 1,
            minWidth: 0,
            fontFamily: D.display,
            fontSize: 16.5,
            fontWeight: 700,
            letterSpacing: '-.015em',
            lineHeight: 1.15,
            color: '#fff',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {item.title}
          </span>
          {item.price && (
            <span style={{ flexShrink: 0, fontFamily: D.mono, fontSize: 13.5, fontWeight: 700, color: D.red }}>
              {item.price}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          {item.footerTag && (
            <span style={{
              flexShrink: 0,
              maxWidth: 96,
              fontFamily: D.mono,
              fontSize: 9.5,
              fontWeight: 600,
              lineHeight: 1,
              letterSpacing: '.04em',
              padding: '3px 6px',
              borderRadius: 5,
              color: D.redText,
              background: 'rgba(232,25,44,.16)',
              border: '1px solid rgba(232,25,44,.30)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {item.footerTag}
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
      </div>

      {/* Cœur / cloche */}
      <div style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
        {item.favType ? (
          <FavoriteButton type={item.favType} id={item.id} />
        ) : (
          <button
            onClick={onUnfollow}
            aria-label={t('subscribe.active')}
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              background: 'transparent',
              border: 'none',
              padding: 0,
            }}
          >
            <Bell size={16} strokeWidth={2} fill={D.red} color={D.red} />
          </button>
        )}
      </div>
    </div>
  );
}
