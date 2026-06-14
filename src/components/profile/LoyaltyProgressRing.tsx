import { cn } from '@/lib/utils';

interface LoyaltyProgressRingProps {
  percent: number;
  size?: number;
  strokeWidth?: number;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  children?: React.ReactNode;
  className?: string;
}

const TIER_STROKE_COLORS: Record<string, string> = {
  bronze: 'stroke-amber-600',
  silver: 'stroke-slate-400',
  gold: 'stroke-yellow-500',
  platinum: 'stroke-violet-400',
};

const TIER_TRACK_COLORS: Record<string, string> = {
  bronze: 'stroke-amber-900/20',
  silver: 'stroke-slate-400/15',
  gold: 'stroke-yellow-500/15',
  platinum: 'stroke-violet-400/15',
};

export function LoyaltyProgressRing({
  percent,
  size = 72,
  strokeWidth = 4,
  tier,
  children,
  className,
}: LoyaltyProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (Math.min(percent, 100) / 100) * circumference;

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className={TIER_TRACK_COLORS[tier]}
        />
        {/* Progress */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className={cn(TIER_STROKE_COLORS[tier], 'transition-all duration-700 ease-out')}
          style={{ strokeDasharray: circumference, strokeDashoffset }}
        />
      </svg>
      {/* Inner content */}
      <div className="absolute inset-0 flex items-center justify-center">
        {children}
      </div>
    </div>
  );
}
