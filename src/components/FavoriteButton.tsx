import { useState } from 'react';
import { Heart, Bell } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useFavorites, FavoriteType, isSubscriptionType } from '@/hooks/useFavorites';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

interface FavoriteButtonProps {
  type: FavoriteType;
  id: string;
  size?: 'sm' | 'default' | 'lg' | 'icon';
  variant?: 'ghost' | 'outline' | 'default';
  className?: string;
  showLabel?: boolean;
  /** Override the inactive label. Defaults to "Subscribe"/"Add to favorites" by kind. */
  label?: string;
  /** Override the active label. Defaults to "Subscribed"/"Saved" by kind. */
  followingLabel?: string;
  onToggle?: () => void;
  iconClassName?: string;
  style?: React.CSSProperties;
}

/**
 * One toggle, two meanings (same storage, see FavoritesContext):
 *   - subscription types (club / dj / affiliate_venue) → Bell + "S'abonner / Abonné"
 *   - favorite types (drink / event / affiliate_event)  → Heart + "Favori"
 * The kind is derived from `type`, so call sites never have to pick an icon.
 */
export function FavoriteButton({
  type,
  id,
  size = 'icon',
  variant = 'ghost',
  className,
  showLabel = false,
  label,
  followingLabel,
  onToggle,
  iconClassName,
  style,
}: FavoriteButtonProps) {
  const { isFavorite, toggleFavorite } = useFavorites();
  const { t } = useLanguage();
  const reduceMotion = useReducedMotion();
  const isActive = isFavorite(type, id);
  const subscription = isSubscriptionType(type);
  // Pop "à la Instagram" uniquement à l'activation (pas au retrait), incrémenté
  // pour rejouer le keyframe. Reduced-motion → aucun pop (juste le remplissage).
  const [popKey, setPopKey] = useState(0);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const willActivate = !isActive;
    // L'haptique vit dans useFavorites().toggleFavorite — commun à TOUTES les
    // surfaces (cartes Explore, pages affiliées…), pas seulement à ce bouton.
    await toggleFavorite(type, id);
    if (willActivate && !reduceMotion) setPopKey((k) => k + 1);
    onToggle?.();
  };

  const Icon = subscription ? Bell : Heart;

  const inactiveLabel = label ?? (subscription ? t('subscribe.action') : t('favorites.like'));
  const activeLabel = followingLabel ?? (subscription ? t('subscribe.active') : t('favorites.liked'));

  // Filled-pill follow style: a solid CTA that flips to a quiet outline once active.
  const isFollowButton = showLabel && variant === 'default';

  const resolvedVariant = isFollowButton && isActive ? 'outline' : variant;
  // Once active ("Subscribed"), the button is a quiet unsubscribe toggle, not a CTA.
  // The Button `outline` variant ships `hover:bg-accent` (solid red) — fine for the
  // inactive Subscribe CTA, but in the active state the foreground is also red
  // (text-primary + a fill-primary bell), so a red hover background renders red-on-red.
  // It's worst on touch, where :hover sticks after the tap that toggled the state.
  // Neutralize the accent hover in active states so it stays a calm, readable pill.
  const resolvedClassName = isFollowButton && isActive
    ? cn("transition-all ring-0 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 outline-none border-border text-foreground hover:bg-muted hover:text-foreground", className?.replace(/bg-primary\b/g, '').replace(/text-primary-foreground/g, '').replace(/hover:bg-primary-hover/g, ''))
    : cn("transition-all ring-0 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 outline-none", isActive && !isFollowButton && "text-primary hover:text-primary-hover hover:bg-muted", className);

  return (
    <Button
      variant={resolvedVariant}
      size={size}
      onClick={handleClick}
      className={resolvedClassName}
      style={style}
      aria-pressed={isActive}
    >
      <motion.span
        key={popKey}
        className="inline-flex"
        animate={popKey > 0 ? { scale: [1, 1.25, 1] } : false}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      >
        <Icon
          className={cn(
            "h-5 w-5 transition-all",
            isActive && !isFollowButton ? "fill-primary text-primary" : "",
            iconClassName
          )}
        />
      </motion.span>
      {showLabel && (
        <span className="ml-1">
          {isActive ? activeLabel : inactiveLabel}
        </span>
      )}
    </Button>
  );
}
