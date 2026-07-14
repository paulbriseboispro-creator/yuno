import { VipReservation, VipConsumption } from '@/types';
import { Button } from '@/components/ui/button';
import { Users, Clock, MapPin, Wine, Sparkles, Target, Plus, MoreHorizontal, Check } from 'lucide-react';
import { formatDistanceToNow, differenceInMinutes } from 'date-fns';
import { fr, es } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import { MinimumSpendBar } from './MinimumSpendBar';
import { VipServiceTimer } from './VipServiceTimer';
import { QuickAddPopover } from './QuickAddPopover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface QuickItem {
  id: string;
  name: string;
  price: number;
  type: 'bottle' | 'extra' | 'service';
}

interface VipReservationCardProps {
  reservation: VipReservation;
  consumptions: VipConsumption[];
  onClick: () => void;
  quickItems?: QuickItem[];
  venueId?: string;
  onOrderSent?: () => void;
  onFinish?: () => void;
  compact?: boolean;
}

const getStatusConfig = (t: (key: string) => string): Record<string, { label: string; color: string; bg: string }> => ({
  waiting: { label: t('vip.waiting'), color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
  placed: { label: t('vip.inside'), color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
  active: { label: t('vip.inside'), color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
  finished: { label: t('vip.finished'), color: 'text-muted-foreground', bg: 'bg-muted/50 border-muted' },
  no_show: { label: t('vipHost.statusNoShow'), color: 'text-muted-foreground', bg: 'bg-muted/50 border-muted' },
  denied: { label: t('vipHost.statusDenied'), color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30' },
});

const getArrivalConfig = (t: (key: string) => string) => ({
  arrived: { label: t('vip.inside'), color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
  expected: { label: t('vip.expected'), color: 'text-muted-foreground', bg: 'bg-muted/30 border-muted opacity-70' },
});

export function VipReservationCard({ 
  reservation, 
  consumptions, 
  onClick,
  quickItems = [],
  venueId,
  onOrderSent,
  onFinish,
  compact = false,
}: VipReservationCardProps) {
  const { language, t } = useLanguage();
  const statusConfig = getStatusConfig(t);
  const arrivalConfig = getArrivalConfig(t);
  const status = statusConfig[reservation.vipStatus] || statusConfig.waiting;
  
  // Determine if guest has arrived
  const hasArrived = reservation.hasArrived ?? 
    (reservation.checkedInAt !== null || ['placed', 'active', 'finished'].includes(reservation.vipStatus));
  const arrivalStatus = hasArrived ? arrivalConfig.arrived : arrivalConfig.expected;
  
  const locale = language === 'fr' ? fr : language === 'es' ? es : undefined;
  
  const totalConsumed = consumptions.reduce((sum, c) => sum + c.totalPrice, 0);
  const remainingCredit = reservation.totalPrice - totalConsumed;
  const itemCount = consumptions.reduce((sum, c) => sum + c.quantity, 0);
  const hasMinimumSpend = (reservation.minimumSpend || 0) > 0;
  const minimumSpend = reservation.minimumSpend || 0;

  const timeAgo = reservation.placedAt 
    ? formatDistanceToNow(new Date(reservation.placedAt), { addSuffix: false, locale })
    : null;

  // Check if just arrived (within last 10 minutes)
  const isJustArrived = reservation.vipStatus === 'waiting' && reservation.createdAt &&
    differenceInMinutes(new Date(), new Date(reservation.createdAt)) <= 10;

  // Check if under minimum spend
  const isUnderMinimum = hasMinimumSpend && totalConsumed < minimumSpend;
  const minimumPercentage = hasMinimumSpend ? (totalConsumed / minimumSpend) * 100 : 100;

  const showQuickActions = ['placed', 'active'].includes(reservation.vipStatus) && venueId;

  // Use arrival-aware background for "expected" (not arrived) guests
  const cardBg = !hasArrived ? arrivalStatus.bg : status.bg;

  // Pastille d'angle (« nouveau » / « attendu ») : elle est en position absolue dans le
  // coin haut-droit et recouvrirait le montant. On décale la colonne de droite quand elle
  // est affichée.
  const hasCornerBadge = (isJustArrived && hasArrived) || !hasArrived;

  return (
    <div
      className={`p-3 cursor-pointer transition-all active:scale-[0.98] ${cardBg} border relative overflow-hidden`}
      style={{ borderRadius: 14 }}
      onClick={onClick}
    >
      {/* "Just arrived" indicator */}
      {isJustArrived && hasArrived && (
        <div
          className="absolute top-0 right-0 px-2 py-0.5 text-[10px] font-medium rounded-bl-lg flex items-center gap-1"
          style={{ background: '#E8192C', color: '#fff' }}
        >
          <Sparkles className="w-3 h-3" />
          {t('vip.new')}
        </div>
      )}

      {/* "Expected" indicator for guests not yet arrived */}
      {!hasArrived && (
        <div
          className="absolute top-0 right-0 px-2 py-0.5 text-[10px] font-medium rounded-bl-lg flex items-center gap-1"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.36)' }}
        >
          <Clock className="w-3 h-3" />
          {t('vip.expected')}
        </div>
      )}

      {/* mt-2 : la pastille d'angle fait ~18px de haut et recouvrirait la 1re ligne
          (nom + pastilles à gauche, montant à droite). On pousse tout le contenu. */}
      <div className={`flex items-start justify-between gap-2 ${hasCornerBadge ? 'mt-2' : ''}`}>
        <div className="flex-1 min-w-0">
          {/* Header row: Name + Status + Table.
              flex-wrap : à 390px, 3 pastilles + un nom long ne tiennent pas sur une ligne —
              les pastilles passent en dessous au lieu d'écraser le nom du client. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: reservation.zoneColor || '#666' }}
            />
            <h3 className="min-w-0 truncate" style={{ color: hasArrived ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.36)', fontSize: 14, fontWeight: 600 }}>
              {reservation.fullName}
            </h3>
            {(reservation.assignedTableName || reservation.assignedTableId) && (
              <span className="text-[10px] px-1.5 h-4 shrink-0 flex items-center rounded-full" style={{ border: '1px solid rgba(255,255,255,0.085)', color: 'rgba(255,255,255,0.58)' }}>
                {reservation.assignedTableName || reservation.assignedTableId}
              </span>
            )}
            {(reservation as any).placementStatus && (reservation as any).placementStatus !== 'none' && (
              <span
                className="text-[10px] px-1.5 h-4 shrink-0 inline-flex items-center gap-0.5 rounded-full"
                style={{
                  border: '1px solid',
                  borderColor: (reservation as any).placementStatus === 'requested' ? 'rgba(234,179,8,0.3)' : (reservation as any).placementStatus === 'approved' ? 'rgba(52,211,153,0.3)' : 'rgba(255,255,255,0.085)',
                  color: (reservation as any).placementStatus === 'requested' ? '#FCD34D' : (reservation as any).placementStatus === 'approved' ? '#34D399' : 'rgba(255,255,255,0.36)',
                }}
              >
                {(reservation as any).placementStatus === 'requested' ? <MapPin className="w-2.5 h-2.5" /> :
                 (reservation as any).placementStatus === 'approved' ? <Check className="w-2.5 h-2.5" /> : null}
                {t(`vipPlacement.${(reservation as any).placementStatus}`) || (reservation as any).placementStatus}
              </span>
            )}
            <span
              className={`border text-[10px] px-1.5 h-4 shrink-0 flex items-center rounded-full ${hasArrived ? status.color : ''}`}
              style={{ borderColor: 'currentColor', color: hasArrived ? undefined : 'rgba(255,255,255,0.36)' }}
            >
              {hasArrived ? status.label : t('vip.notArrivedYet')}
            </span>
          </div>

          {/* Info row */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs" style={{ color: 'rgba(255,255,255,0.36)' }}>
            <span className="flex items-center gap-0.5 tabular-nums">
              <Users className="w-3 h-3" />
              {reservation.guestCount}
            </span>

            {/* C7: Service timer — shows how long they've been waiting/seated */}
            {['waiting', 'placed', 'active'].includes(reservation.vipStatus) && (
              <VipServiceTimer createdAt={reservation.placedAt || reservation.createdAt} />
            )}

            {timeAgo && !['waiting', 'placed', 'active'].includes(reservation.vipStatus) && (
              <span className="flex items-center gap-0.5">
                <Clock className="w-3 h-3" />
                {timeAgo}
              </span>
            )}

            {itemCount > 0 && (
              <span className="flex items-center gap-0.5 tabular-nums">
                <Wine className="w-3 h-3" />
                {itemCount}
              </span>
            )}

            {hasMinimumSpend && (
              <span className="flex items-center gap-0.5 tabular-nums" style={{ color: isUnderMinimum ? '#FCD34D' : '#34D399' }}>
                <Target className="w-3 h-3" />
                {minimumPercentage.toFixed(0)}%
              </span>
            )}
          </div>

          {/* Minimum Spend Bar - compact version */}
          {hasMinimumSpend && ['placed', 'active'].includes(reservation.vipStatus) && (
            <div className="mt-2">
              <MinimumSpendBar
                minimumSpend={minimumSpend}
                totalConsumed={totalConsumed}
                deposit={reservation.totalPrice}
                compact={true}
              />
            </div>
          )}
        </div>
        
        {/* Right side: Credit + Quick Actions */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div className="text-right">
            <div className="tabular-nums" style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em', color: totalConsumed > 0 ? '#34D399' : 'rgba(255,255,255,0.36)' }}>
              {totalConsumed.toFixed(0)}€
            </div>
            <div className="text-[10px] tabular-nums" style={{ color: 'rgba(255,255,255,0.36)' }}>
              /{reservation.totalPrice}€
            </div>
          </div>

          {/* Quick action buttons */}
          {showQuickActions && (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <QuickAddPopover 
                items={quickItems}
                reservationId={reservation.id}
                venueId={venueId!}
                onOrderSent={onOrderSent}
              >
                <Button size="sm" variant="secondary" className="h-9 px-2.5 text-xs gap-1">
                  <Plus className="w-3 h-3" />
                  {t('vip.conso')}
                </Button>
              </QuickAddPopover>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-9 w-9 p-0">
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={onClick}>
                    {t('vip.viewDetail')}
                  </DropdownMenuItem>
                  {onFinish && (
                    <DropdownMenuItem onClick={onFinish} className="text-destructive">
                      {t('vip.endService')}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}