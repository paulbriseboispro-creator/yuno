import { Heart, Bell } from 'lucide-react';
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
  const isActive = isFavorite(type, id);
  const subscription = isSubscriptionType(type);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await toggleFavorite(type, id);
    onToggle?.();
  };

  const Icon = subscription ? Bell : Heart;

  const inactiveLabel = label ?? (subscription ? t('subscribe.action') : t('favorites.like'));
  const activeLabel = followingLabel ?? (subscription ? t('subscribe.active') : t('favorites.liked'));

  // Filled-pill follow style: a solid CTA that flips to a quiet outline once active.
  const isFollowButton = showLabel && variant === 'default';

  const resolvedVariant = isFollowButton && isActive ? 'outline' : variant;
  const resolvedClassName = isFollowButton && isActive
    ? cn("transition-all ring-0 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 outline-none border-border text-foreground", className?.replace(/bg-primary\b/g, '').replace(/text-primary-foreground/g, '').replace(/hover:bg-primary-hover/g, ''))
    : cn("transition-all ring-0 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 outline-none", isActive && !isFollowButton && "text-primary hover:text-primary-hover", className);

  return (
    <Button
      variant={resolvedVariant}
      size={size}
      onClick={handleClick}
      className={resolvedClassName}
      style={style}
      aria-pressed={isActive}
    >
      <Icon
        className={cn(
          "h-5 w-5 transition-all",
          isActive && !isFollowButton ? "fill-primary text-primary" : "",
          iconClassName
        )}
      />
      {showLabel && (
        <span className="ml-1">
          {isActive ? activeLabel : inactiveLabel}
        </span>
      )}
    </Button>
  );
}
