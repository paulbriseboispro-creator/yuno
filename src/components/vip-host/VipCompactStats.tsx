import { useMemo } from 'react';
import { VipReservation, VipConsumption } from '@/types';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { ChevronDown, Users, TrendingUp, Clock, Euro } from 'lucide-react';
import { VipNightStats } from './VipNightStats';
import { VipUpsellStats } from './VipUpsellStats';
import { useLanguage } from '@/contexts/LanguageContext';

interface VipCompactStatsProps {
  reservations: VipReservation[];
  consumptions: Map<string, VipConsumption[]>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VipCompactStats({ 
  reservations, 
  consumptions, 
  open, 
  onOpenChange 
}: VipCompactStatsProps) {
  const { t } = useLanguage();

  const stats = useMemo(() => {
    const activeReservations = reservations.filter(r => 
      ['placed', 'active'].includes(r.vipStatus)
    );
    const totalGuests = activeReservations.reduce((sum, r) => sum + r.guestCount, 0);

    let totalRevenue = 0;
    consumptions.forEach((items) => {
      totalRevenue += items.reduce((sum, c) => sum + c.totalPrice, 0);
    });

    return {
      activeTables: activeReservations.length,
      totalTables: reservations.length,
      totalGuests,
      totalRevenue,
    };
  }, [reservations, consumptions]);

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="w-full min-h-[44px] justify-between gap-2 h-auto py-2 px-3"
          style={{ background: 'rgba(255,255,255,0.032)', border: '1px solid rgba(255,255,255,0.085)', borderRadius: 14 }}
        >
          {/* Le Button shadcn est whitespace-nowrap : sans min-w-0 + truncate, un gros CA
              pousse la ligne hors de la carte (scroll horizontal de page). */}
          <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden text-xs sm:gap-4">
            <span className="flex min-w-0 items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5 shrink-0" style={{ color: '#E8192C' }} />
              <span className="tabular-nums shrink-0" style={{ color: 'rgba(255,255,255,0.96)', fontWeight: 500 }}>{stats.activeTables}/{stats.totalTables}</span>
              <span className="truncate" style={{ color: 'rgba(255,255,255,0.36)' }}>{t('vipHost.tables').toLowerCase()}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <Users className="w-3.5 h-3.5 shrink-0" style={{ color: 'rgba(255,255,255,0.36)' }} />
              <span className="tabular-nums" style={{ color: 'rgba(255,255,255,0.96)', fontWeight: 500 }}>{stats.totalGuests}</span>
              <span style={{ color: 'rgba(255,255,255,0.36)' }}>VIPs</span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <Euro className="w-3.5 h-3.5 shrink-0" style={{ color: '#E8192C' }} />
              <span className="tabular-nums" style={{ color: '#E8192C', fontWeight: 700 }}>{stats.totalRevenue.toFixed(0)}€</span>
            </span>
          </div>
          <ChevronDown
            className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
            style={{ color: 'rgba(255,255,255,0.36)' }}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-3">
        <VipUpsellStats reservations={reservations} consumptions={consumptions} />
        <VipNightStats reservations={reservations} consumptions={consumptions} />
      </CollapsibleContent>
    </Collapsible>
  );
}
