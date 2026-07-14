import { useMemo } from 'react';
import { VipReservation, VipConsumption } from '@/types';
import { Users, Wine, Clock, Euro, TrendingUp } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

const RED = '#E8192C';
const T1 = 'rgba(255,255,255,0.96)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';

interface VipNightStatsProps {
  reservations: VipReservation[];
  consumptions: Map<string, VipConsumption[]>;
}

export function VipNightStats({ reservations, consumptions }: VipNightStatsProps) {
  const { t } = useLanguage();

  const stats = useMemo(() => {
    const activeReservations = reservations.filter(r => 
      ['placed', 'active'].includes(r.vipStatus)
    );
    const finishedReservations = reservations.filter(r => r.vipStatus === 'finished');
    const allReservations = [...activeReservations, ...finishedReservations];
    const totalGuests = activeReservations.reduce((sum, r) => sum + r.guestCount, 0);

    let totalRevenue = 0;
    consumptions.forEach((items) => {
      totalRevenue += items.reduce((sum, c) => sum + c.totalPrice, 0);
    });

    const totalDeposits = allReservations.reduce((sum, r) => sum + r.totalPrice, 0);

    let avgTime = 0;
    if (finishedReservations.length > 0) {
      const times = finishedReservations
        .filter(r => r.placedAt && r.finishedAt)
        .map(r => {
          const placed = new Date(r.placedAt!).getTime();
          const finished = new Date(r.finishedAt!).getTime();
          return (finished - placed) / (1000 * 60);
        });
      if (times.length > 0) {
        avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      }
    }

    const avgTimeFormatted = avgTime > 0 
      ? `${Math.floor(avgTime / 60)}h${Math.round(avgTime % 60).toString().padStart(2, '0')}`
      : '-';

    return {
      activeTables: activeReservations.length,
      totalTables: reservations.length,
      totalGuests,
      totalRevenue,
      totalDeposits,
      avgTimeFormatted,
    };
  }, [reservations, consumptions]);

  return (
    <div style={{ background: INNER_BG, border: `1px dashed ${BORDER}`, borderRadius: 14, padding: 16 }}>
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-4 h-4" style={{ color: RED }} />
        <h4 style={{ color: T1, fontSize: 14, fontWeight: 500 }}>{t('vipHost.tonight')}</h4>
      </div>

      {/* 4 colonnes à 390px : le chiffre passe à 15px sur téléphone, sinon un CA à 5 chiffres
          déborde de la carte (et fait scroller la page horizontalement). */}
      <div className="grid grid-cols-4 gap-2 text-center sm:gap-3">
        <div className="min-w-0">
          <div className="tabular-nums text-[15px] sm:text-[18px]" style={{ color: T1, fontWeight: 640, letterSpacing: '-0.02em' }}>
            {stats.activeTables}/{stats.totalTables}
          </div>
          <div className="text-[10px] truncate" style={{ color: T3 }}>{t('vipHost.tables')}</div>
        </div>
        <div className="min-w-0">
          <div className="flex items-center justify-center gap-0.5 tabular-nums text-[15px] sm:text-[18px]" style={{ color: T1, fontWeight: 640, letterSpacing: '-0.02em' }}>
            <Users className="w-3.5 h-3.5 shrink-0" />
            {stats.totalGuests}
          </div>
          <div className="text-[10px] truncate" style={{ color: T3 }}>VIPs</div>
        </div>
        <div className="min-w-0">
          <div className="tabular-nums text-[15px] sm:text-[18px]" style={{ color: RED, fontWeight: 640, letterSpacing: '-0.02em' }}>
            {stats.totalRevenue.toFixed(0)}€
          </div>
          <div className="text-[10px] truncate" style={{ color: T3 }}>{t('vipHost.conso')}</div>
        </div>
        <div className="min-w-0">
          <div className="flex items-center justify-center gap-0.5 tabular-nums text-[15px] sm:text-[18px]" style={{ color: T1, fontWeight: 640, letterSpacing: '-0.02em' }}>
            <Clock className="w-3.5 h-3.5 shrink-0" />
            {stats.avgTimeFormatted}
          </div>
          <div className="text-[10px] truncate" style={{ color: T3 }}>{t('vipHost.avg')}</div>
        </div>
      </div>
    </div>
  );
}
