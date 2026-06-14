import { Heart, Bookmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFavorites, FavoriteType } from '@/hooks/useFavorites';
import { cn } from '@/lib/utils';

interface FavoriteButtonProps {
  type: FavoriteType;
  id: string;
  size?: 'sm' | 'default' | 'lg' | 'icon';
  variant?: 'ghost' | 'outline' | 'default';
  className?: string;
  showLabel?: boolean;
  label?: string;
  followingLabel?: string;
  onToggle?: () => void;
  icon?: 'heart' | 'bookmark';
  iconClassName?: string;
  style?: React.CSSProperties;
}

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
  icon = 'heart',
  iconClassName,
  style,
}: FavoriteButtonProps) {
  const { isFavorite, toggleFavorite } = useFavorites();
  const isLiked = isFavorite(type, id);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await toggleFavorite(type, id);
    onToggle?.();
  };

  const Icon = icon === 'bookmark' ? Bookmark : Heart;

  // For "follow" style buttons (showLabel + default variant), toggle between filled and outline
  const isFollowButton = showLabel && variant === 'default';

  const resolvedVariant = isFollowButton && isLiked ? 'outline' : variant;
  const resolvedClassName = isFollowButton && isLiked
    ? cn("transition-all ring-0 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 outline-none border-border text-foreground", className?.replace(/bg-primary\b/g, '').replace(/text-primary-foreground/g, '').replace(/hover:bg-primary-hover/g, ''))
    : cn("transition-all ring-0 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 outline-none", isLiked && !isFollowButton && "text-primary hover:text-primary-hover", className);

  return (
    <Button
      variant={resolvedVariant}
      size={size}
      onClick={handleClick}
      className={resolvedClassName}
      style={style}
    >
      <Icon 
        className={cn(
          "h-5 w-5 transition-all",
          isLiked && !isFollowButton ? "fill-primary text-primary" : "",
          iconClassName
        )} 
      />
      {showLabel && (
        <span className="ml-1">
          {isLiked ? (followingLabel || label) : label}
        </span>
      )}
    </Button>
  );
}
