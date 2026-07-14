import { VipReservation, VipConsumption } from '@/types';
import { Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

const T1 = 'rgba(255,255,255,0.96)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';

interface VipTableGridProps {
  reservations: VipReservation[];
  consumptions: Map<string, VipConsumption[]>;
  onSelect: (reservation: VipReservation) => void;
}

export function VipTableGrid({ reservations, consumptions, onSelect }: VipTableGridProps) {
  const { t } = useLanguage();

  const getStatusColor = (reservation: VipReservation, totalConsumed: number) => {
    if (reservation.vipStatus === 'denied') return 'destructive';
    if (reservation.vipStatus === 'no_show') return 'muted';

    const hasArrived = reservation.hasArrived ??
      (reservation.checkedInAt !== null || ['placed', 'active', 'finished'].includes(reservation.vipStatus));

    if (!hasArrived) return 'expected';
    
    const hasMinimum = (reservation.minimumSpend || 0) > 0;
    const minimumReached = hasMinimum ? totalConsumed >= reservation.minimumSpend! : true;
    
    if (!minimumReached) return 'warning';
    return totalConsumed > 0 ? 'success' : 'default';
  };

  const statusStyles: Record<string, React.CSSProperties> = {
    expected: { background: INNER_BG, border: `1px solid ${BORDER}`, opacity: 0.6 },
    destructive: { background: 'rgba(232,25,44,0.05)', border: '1px solid rgba(232,25,44,0.5)' },
    warning: { background: 'rgba(234,179,8,0.05)', border: '1px solid rgba(234,179,8,0.5)' },
    success: { background: 'rgba(52,211,153,0.05)', border: '1px solid rgba(52,211,153,0.5)' },
    muted: { background: 'rgba(255,255,255,0.02)', border: `1px solid ${BORDER}`, opacity: 0.45 },
    default: { background: INNER_BG, border: `1px solid ${BORDER}` },
  };

  const dotStyles: Record<string, string> = {
    expected: 'rgba(255,255,255,0.36)',
    destructive: '#E8192C',
    warning: '#FCD34D',
    success: '#34D399',
    muted: 'rgba(255,255,255,0.25)',
    default: 'rgba(255,255,255,0.36)',
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {reservations.map((reservation) => {
        const tableConsumptions = consumptions.get(reservation.id) || [];
        const totalConsumed = tableConsumptions.reduce((sum, c) => sum + c.totalPrice, 0);
        const status = getStatusColor(reservation, totalConsumed);
        const hasArrived = reservation.hasArrived ??
          (reservation.checkedInAt !== null || ['placed', 'active', 'finished'].includes(reservation.vipStatus));

        return (
          <div
            key={reservation.id}
            className="p-3 cursor-pointer transition-all active:scale-[0.98]"
            style={{ borderRadius: 14, ...statusStyles[status] }}
            onClick={() => onSelect(reservation)}
          >
            <div className="flex items-start justify-between gap-1.5 mb-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <div
                  className={cn('w-2 h-2 rounded-full shrink-0', status === 'expected' && 'animate-pulse')}
                  style={{ background: dotStyles[status] }}
                />
                {/* Nom de table saisi par le club : peut être long ("Carré Cristal") sur 2 colonnes. */}
                <span className="min-w-0 truncate" style={{ color: T3, fontSize: 12, fontWeight: 500 }}>
                  {reservation.assignedTableName || reservation.assignedTableId || reservation.zoneName?.slice(0, 8)}
                </span>
              </div>
              <div
                className="w-2 h-2 shrink-0 rounded-full mt-1"
                style={{ backgroundColor: reservation.zoneColor || '#666' }}
              />
            </div>

            <div className="truncate mb-1" style={{ color: hasArrived ? T1 : T3, fontSize: 14, fontWeight: 600 }}>
              {reservation.fullName.split(' ')[0]}
              {!hasArrived && <span className="text-[10px] ml-1">({t('vipHost.expectedLabel')})</span>}
            </div>

            <div className="flex items-center justify-between gap-1 text-xs">
              <span
                className="min-w-0 truncate tabular-nums"
                style={{ fontWeight: 700, color: !hasArrived ? T3 : totalConsumed > 0 ? '#34D399' : T3 }}
              >
                {totalConsumed.toFixed(0)}€
              </span>
              <span className="flex shrink-0 items-center gap-0.5 tabular-nums" style={{ color: T3 }}>
                <Users className="w-3 h-3" />
                {reservation.guestCount}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
