import { cn } from '@/lib/utils';
import { Crown, Star, Award, Medal } from 'lucide-react';

interface TierBadgeProps {
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

const tierConfig = {
  bronze: {
    label: 'Bronze',
    icon: Medal,
    colors: 'bg-amber-900/20 text-amber-600 border-amber-600/30',
    iconColor: 'text-amber-600'
  },
  silver: {
    label: 'Silver',
    icon: Award,
    colors: 'bg-slate-400/20 text-slate-300 border-slate-400/30',
    iconColor: 'text-slate-300'
  },
  gold: {
    label: 'Gold',
    icon: Star,
    colors: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    iconColor: 'text-yellow-400'
  },
  platinum: {
    label: 'Platinum',
    icon: Crown,
    colors: 'bg-purple-500/20 text-purple-300 border-purple-400/30',
    iconColor: 'text-purple-300'
  }
};

const sizeConfig = {
  sm: {
    container: 'px-2 py-0.5 text-xs gap-1',
    icon: 'h-3 w-3'
  },
  md: {
    container: 'px-3 py-1 text-sm gap-1.5',
    icon: 'h-4 w-4'
  },
  lg: {
    container: 'px-4 py-1.5 text-base gap-2',
    icon: 'h-5 w-5'
  }
};

export function TierBadge({ tier, size = 'md', showLabel = true, className }: TierBadgeProps) {
  const config = tierConfig[tier];
  const sizes = sizeConfig[size];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full border font-medium',
        config.colors,
        sizes.container,
        className
      )}
    >
      <Icon className={cn(sizes.icon, config.iconColor)} />
      {showLabel && <span>{config.label}</span>}
    </div>
  );
}
