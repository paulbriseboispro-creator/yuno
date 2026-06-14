import { VipReservation, VipConsumption } from '@/types';
import { Bell, AlertTriangle, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

interface VipPriorityLaneProps {
  reservations: VipReservation[];
  consumptions: Map<string, VipConsumption[]>;
  pendingOrdersCount: number;
  onOrdersClick: () => void;
  onArrivalsClick: () => void;
  onLowCreditClick: (reservationId: string) => void;
}

export function VipPriorityLane({
  reservations,
  consumptions,
  pendingOrdersCount,
  onOrdersClick,
  onArrivalsClick,
  onLowCreditClick,
}: VipPriorityLaneProps) {
  const { t } = useLanguage();

  const waitingArrivals = reservations.filter(r => r.vipStatus === 'waiting');

  const underMinimumTables = reservations
    .filter(r => ['placed', 'active'].includes(r.vipStatus) && (r.minimumSpend || 0) > 0)
    .filter(r => {
      const tableConsumptions = consumptions.get(r.id) || [];
      const totalConsumed = tableConsumptions.reduce((sum, c) => sum + c.totalPrice, 0);
      const percentage = (totalConsumed / r.minimumSpend!) * 100;
      return percentage < 50;
    });

  const hasUrgent = pendingOrdersCount > 0 || waitingArrivals.length > 0 || underMinimumTables.length > 0;

  if (!hasUrgent) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      {pendingOrdersCount > 0 && (
        <button
          onClick={onOrdersClick}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium',
            'bg-destructive/10 text-destructive border border-destructive/20',
            'animate-pulse hover:bg-destructive/20 transition-colors'
          )}
        >
          <Bell className="w-3.5 h-3.5" />
          {t('vipHost.orderCount').replace('{count}', String(pendingOrdersCount))}
        </button>
      )}

      {waitingArrivals.length > 0 && (
        <button
          onClick={onArrivalsClick}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium',
            'bg-primary/10 text-primary border border-primary/20',
            'animate-pulse hover:bg-primary/20 transition-colors'
          )}
        >
          <Sparkles className="w-3.5 h-3.5" />
          {t('vipHost.arrivalCount').replace('{count}', String(waitingArrivals.length))}
        </button>
      )}

      {underMinimumTables.length > 0 && (
        <button
          onClick={() => underMinimumTables[0] && onLowCreditClick(underMinimumTables[0].id)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium',
            'bg-orange-500/10 text-orange-500 border border-orange-500/20',
            'hover:bg-orange-500/20 transition-colors'
          )}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          {t('vipHost.underMinimumCount').replace('{count}', String(underMinimumTables.length))}
        </button>
      )}
    </div>
  );
}
