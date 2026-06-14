import { motion } from 'framer-motion';
import { Gift, Wine, Ticket, Crown, Star, Lock, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

interface RewardCardProps {
  id: string;
  name: string;
  description?: string | null;
  pointsRequired: number;
  rewardType: string;
  currentBalance: number;
  onRedeem: (id: string) => void;
  isRedeeming?: boolean;
  isRedeemed?: boolean;
}

const rewardIcons: Record<string, typeof Gift> = {
  free_drink: Wine,
  discount: Star,
  priority_access: Ticket,
  vip_perk: Crown,
  custom: Gift
};

export function RewardCard({
  id,
  name,
  description,
  pointsRequired,
  rewardType,
  currentBalance,
  onRedeem,
  isRedeeming = false,
  isRedeemed = false
}: RewardCardProps) {
  const { t } = useLanguage();
  const canAfford = currentBalance >= pointsRequired;
  const Icon = rewardIcons[rewardType] || Gift;
  const pointsNeeded = pointsRequired - currentBalance;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        'relative p-3 rounded-xl border transition-all overflow-hidden',
        canAfford && !isRedeemed
          ? 'bg-gradient-to-br from-primary/10 to-primary/5 border-primary/30 shadow-md'
          : 'bg-card/50 border-border/50',
        isRedeemed && 'opacity-60'
      )}
    >
      <div className="flex items-start gap-3 min-w-0">
        <div
          className={cn(
            'h-10 w-10 rounded-xl flex items-center justify-center shrink-0',
            canAfford ? 'bg-primary/20' : 'bg-muted'
          )}
        >
          <Icon className={cn('h-5 w-5', canAfford ? 'text-primary' : 'text-muted-foreground')} />
        </div>

        <div className="flex-1 min-w-0">
          <h4 className="font-semibold truncate">{name}</h4>
          {description && (
            <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">{description}</p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <span className={cn(
              'text-sm font-medium',
              canAfford ? 'text-primary' : 'text-muted-foreground'
            )}>
              {pointsRequired.toLocaleString()} {t('rewardCard.points')}
            </span>
            {!canAfford && !isRedeemed && (
              <span className="text-xs text-muted-foreground">
                ({t('rewardCard.needMore')} {pointsNeeded})
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0">
          {isRedeemed ? (
            <div className="h-10 w-10 rounded-full bg-green-500/20 flex items-center justify-center">
              <Check className="h-5 w-5 text-green-500" />
            </div>
          ) : canAfford ? (
            <Button
              size="sm"
              onClick={() => onRedeem(id)}
              disabled={isRedeeming}
              className="gap-1 text-xs shrink-0 px-3"
            >
              <Gift className="h-3.5 w-3.5" />
              {t('rewardCard.redeem')}
            </Button>
          ) : (
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
              <Lock className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}