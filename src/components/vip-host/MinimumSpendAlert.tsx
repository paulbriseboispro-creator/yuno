import { useState, useMemo } from 'react';
import { VipReservation, VipConsumption } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

const T1 = 'rgba(255,255,255,0.96)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const TILE_BG = 'rgba(255,255,255,0.025)';
import { AlertTriangle, TrendingUp, ChevronRight, Clock } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface MinimumSpendAlertProps {
  reservations: VipReservation[];
  consumptions: Map<string, VipConsumption[]>;
  eventEndTime?: Date;
  onTableClick?: (reservationId: string) => void;
}

interface TableSpendStatus {
  reservation: VipReservation;
  totalConsumed: number;
  minimumSpend: number;
  remaining: number;
  percentage: number;
  hoursRemaining?: number;
}

export function MinimumSpendAlert({
  reservations,
  consumptions,
  eventEndTime,
  onTableClick,
}: MinimumSpendAlertProps) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);

  const tablesUnderMinimum = useMemo(() => {
    const now = new Date();
    const hoursToEnd = eventEndTime 
      ? (eventEndTime.getTime() - now.getTime()) / (1000 * 60 * 60)
      : null;

    return reservations
      .filter(r => 
        ['placed', 'active'].includes(r.vipStatus) && 
        (r as any).minimumSpend > 0
      )
      .map(r => {
        const items = consumptions.get(r.id) || [];
        const totalConsumed = items.reduce((sum, c) => sum + c.totalPrice, 0);
        const minimumSpend = (r as any).minimumSpend || 0;
        const remaining = Math.max(0, minimumSpend - totalConsumed);
        const percentage = minimumSpend > 0 ? (totalConsumed / minimumSpend) * 100 : 100;

        return {
          reservation: r,
          totalConsumed,
          minimumSpend,
          remaining,
          percentage,
          hoursRemaining: hoursToEnd || undefined,
        } as TableSpendStatus;
      })
      .filter(t => t.percentage < 100)
      .sort((a, b) => a.percentage - b.percentage);
  }, [reservations, consumptions, eventEndTime]);

  // Only show if there are tables under minimum and it's getting late
  const criticalTables = tablesUnderMinimum.filter(t => 
    t.percentage < 50 || (t.hoursRemaining && t.hoursRemaining < 2)
  );

  if (tablesUnderMinimum.length === 0) return null;

  const totalRemaining = tablesUnderMinimum.reduce((sum, t) => sum + t.remaining, 0);

  return (
    <div className="p-4" style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', borderRadius: 14 }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" style={{ color: '#FCD34D' }} />
          <span className="font-medium" style={{ color: '#FCD34D' }}>
            {t('vipHost.minimumSpendAlert')}
          </span>
        </div>
        <Badge variant="outline" className="border-amber-400/30 text-amber-400">
          {tablesUnderMinimum.length} {tablesUnderMinimum.length === 1 ? 'table' : 'tables'}
        </Badge>
      </div>

      <p className="text-sm mb-3" style={{ color: T3 }}>
        {t('vipHost.totalRemainingToMinimum')}: <span className="font-bold tabular-nums" style={{ color: '#FCD34D' }}>{totalRemaining.toFixed(0)}€</span>
      </p>

      {expanded ? (
        <ScrollArea className="max-h-48">
          <div className="space-y-2">
            {tablesUnderMinimum.map((table) => (
              <div
                key={table.reservation.id}
                className="flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors"
                style={{ background: TILE_BG, border: `1px solid ${BORDER}` }}
                onClick={() => onTableClick?.(table.reservation.id)}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: table.reservation.zoneColor }}
                  />
                  <div>
                    <div className="font-medium text-sm" style={{ color: T1 }}>{table.reservation.fullName}</div>
                    <div className="text-xs tabular-nums" style={{ color: T3 }}>
                      {table.percentage.toFixed(0)}% • {table.remaining.toFixed(0)}€ {t('vipHost.remaining')}
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4" style={{ color: T3 }} />
              </div>
            ))}
          </div>
        </ScrollArea>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          {criticalTables.slice(0, 3).map((table) => (
            <Badge
              key={table.reservation.id}
              variant="outline"
              className="cursor-pointer"
              onClick={() => onTableClick?.(table.reservation.id)}
            >
              <div
                className="w-2 h-2 rounded-full mr-1.5"
                style={{ backgroundColor: table.reservation.zoneColor }}
              />
              {table.reservation.fullName.split(' ')[0]}
              <span className="ml-1 tabular-nums" style={{ color: '#FCD34D' }}>{table.percentage.toFixed(0)}%</span>
            </Badge>
          ))}
          {tablesUnderMinimum.length > 3 && (
            <Badge variant="secondary" className="cursor-pointer" onClick={() => setExpanded(true)}>
              +{tablesUnderMinimum.length - 3}
            </Badge>
          )}
        </div>
      )}

      {tablesUnderMinimum.length > 3 && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full mt-2 text-xs"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? t('common.showLess') : t('common.showMore')}
        </Button>
      )}
    </div>
  );
}
