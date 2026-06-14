import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

interface MinimumSpendBarProps {
  minimumSpend: number;
  totalConsumed: number;
  deposit: number;
  compact?: boolean;
  showAlertAt?: number; // Percentage at which to show alert (default 50%)
  className?: string;
}

export function MinimumSpendBar({
  minimumSpend,
  totalConsumed,
  deposit,
  compact = false,
  showAlertAt = 50,
  className,
}: MinimumSpendBarProps) {
  const { t } = useLanguage();

  // If no minimum spend configured, don't show this component
  if (!minimumSpend || minimumSpend <= 0) return null;

  const percentage = Math.min(100, (totalConsumed / minimumSpend) * 100);
  const remaining = Math.max(0, minimumSpend - totalConsumed);
  const isAchieved = totalConsumed >= minimumSpend;
  const upsellAmount = Math.max(0, totalConsumed - minimumSpend);
  const isBelowThreshold = percentage < showAlertAt;

  // Determine status and colors
  const getStatus = () => {
    if (isAchieved) return { color: 'text-emerald-400', bg: 'bg-emerald-500', icon: CheckCircle2 };
    if (isBelowThreshold) return { color: 'text-amber-400', bg: 'bg-amber-500', icon: AlertTriangle };
    return { color: 'text-primary', bg: 'bg-primary', icon: TrendingUp };
  };

  const status = getStatus();
  const StatusIcon = status.icon;

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div
            className={cn("h-full rounded-full transition-all duration-700", status.bg)}
            style={{ width: `${percentage}%` }}
          />
        </div>
        <span className={cn("text-xs font-medium whitespace-nowrap tabular-nums", status.color)}>
          {isAchieved ? (
            <>+{upsellAmount.toFixed(0)}€ <span style={{ color: 'rgba(255,255,255,0.36)' }}>upsell</span></>
          ) : (
            <>{remaining.toFixed(0)}€ <span style={{ color: 'rgba(255,255,255,0.36)' }}>{t('vipHost.toMinimum')}</span></>
          )}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-1.5">
          <StatusIcon className={cn("w-4 h-4", status.color)} />
          <span className="font-medium">{t('vipHost.minimumSpend')}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("font-bold", status.color)}>
            {totalConsumed.toFixed(0)}€
          </span>
          <span className="text-muted-foreground">/ {minimumSpend.toFixed(0)}€</span>
        </div>
      </div>

      <div className="relative">
        <Progress 
          value={percentage} 
          className="h-2.5" 
        />
        {/* Deposit marker if deposit < minimum */}
        {deposit < minimumSpend && deposit > 0 && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-muted-foreground/50"
            style={{ left: `${(deposit / minimumSpend) * 100}%` }}
            title={`${t('vipHost.deposit')}: ${deposit}€`}
          />
        )}
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {percentage.toFixed(0)}% {t('vipHost.achieved')}
        </span>
        {isAchieved ? (
          <Badge variant="outline" className="text-emerald-400 border-emerald-400/30 text-[10px] px-1.5 py-0">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            +{upsellAmount.toFixed(0)}€ upsell
          </Badge>
        ) : (
          <span className={cn("font-medium", isBelowThreshold ? "text-amber-400" : "text-muted-foreground")}>
            {remaining.toFixed(0)}€ {t('vipHost.remaining')}
          </span>
        )}
      </div>
    </div>
  );
}
