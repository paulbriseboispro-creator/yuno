import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Building2, Calendar, Clock, QrCode, CheckCircle2, Shield, X, Users, Gift, Sparkles, Shirt, Wine } from 'lucide-react';
import { VipPlacementTracker } from '@/components/orders/VipPlacementTracker';
import { format } from 'date-fns';
import { enUS, es, fr } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNavigate } from 'react-router-dom';

// Types
interface TicketWithDetails {
  id: string;
  eventTitle: string;
  eventStartAt: string;
  eventEndAt: string;
  eventPosterUrl?: string;
  eventImageUrl?: string;
  venueName: string;
  roundName: string;
  quantity: number;
  totalPrice: number;
  serviceFee: number;
  status: string;
  qrCode: string;
  used: boolean;
  paidAt?: string;
  includesDrink?: boolean;
  drinkRedeemed?: boolean;
  hasInsurance?: boolean;
  insuranceFee?: number;
  drinkDeadlineType?: string;
  drinkDeadlineHours?: number;
  drinkCutoffTime?: string;
  entryScanned?: boolean;
  entryScannedAt?: string;
  refundAmount?: number;
  refundReason?: string;
  hasCloakroom?: boolean;
}

interface VipReservationWithDetails {
  id: string;
  eventTitle: string;
  eventStartAt: string;
  eventEndAt: string;
  eventPosterUrl?: string;
  eventImageUrl?: string;
  venueName: string;
  zoneName: string;
  packName: string;
  guestCount: number;
  totalPrice: number;
  deposit: number;
  managementFee: number;
  serviceFee: number;
  status: string;
  qrCode: string;
  paidAt?: string;
  fullName: string;
  entryScanned?: boolean;
  entryScannedAt?: string;
  refundAmount?: number;
  refundReason?: string;
  placementStatus?: string;
  requestedTableName?: string;
  assignedTableName?: string;
  placementNote?: string;
}

interface GroupedTicketItem {
  type: 'ticket' | 'vip';
  data: TicketWithDetails | VipReservationWithDetails;
  venueName: string;
  eventStartAt: string;
}

interface GroupedTicketsViewProps {
  tickets: TicketWithDetails[];
  vipReservations: VipReservationWithDetails[];
  loyaltyPoints: Record<string, number>;
  formatDrinkDeadline: (ticket: TicketWithDetails) => string | null;
  canCancelTicket: (ticket: TicketWithDetails) => boolean;
  onShowTicketQR: (ticket: TicketWithDetails) => void;
  onShowVipQR: (reservation: VipReservationWithDetails) => void;
  onCancelTicket: (ticket: TicketWithDetails) => void;
}

// Helper to group items by venue
function groupByVenue<T extends { venueName: string }>(items: T[]): Record<string, T[]> {
  return items.reduce((acc, item) => {
    const venue = item.venueName || 'Unknown';
    if (!acc[venue]) acc[venue] = [];
    acc[venue].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

// Helper to group items by date
function groupByDate<T extends { eventStartAt: string }>(items: T[]): Record<string, T[]> {
  return items.reduce((acc, item) => {
    const dateKey = item.eventStartAt 
      ? format(new Date(item.eventStartAt), 'yyyy-MM-dd')
      : 'no-date';
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

// Sort venues alphabetically
function getSortedVenues(grouped: Record<string, any[]>): string[] {
  return Object.keys(grouped).sort((a, b) => a.localeCompare(b));
}

// Sort dates chronologically (closest first)
function getSortedDates(grouped: Record<string, any[]>): string[] {
  return Object.keys(grouped).sort((a, b) => {
    if (a === 'no-date') return 1;
    if (b === 'no-date') return -1;
    return new Date(a).getTime() - new Date(b).getTime();
  });
}

export function GroupedTicketsView({
  tickets,
  vipReservations,
  loyaltyPoints,
  formatDrinkDeadline,
  canCancelTicket,
  onShowTicketQR,
  onShowVipQR,
  onCancelTicket,
}: GroupedTicketsViewProps) {
  const { language, t } = useLanguage();
  const navigate = useNavigate();

  const getLocale = () => {
    switch (language) {
      case 'fr': return fr;
      case 'es': return es;
      default: return enUS;
    }
  };

  // Combine tickets and VIP reservations into a single list with unified format
  const allItems: GroupedTicketItem[] = [
    ...tickets.map(t => ({
      type: 'ticket' as const,
      data: t,
      venueName: t.venueName,
      eventStartAt: t.eventStartAt,
    })),
    ...vipReservations.map(v => ({
      type: 'vip' as const,
      data: v,
      venueName: v.venueName,
      eventStartAt: v.eventStartAt,
    })),
  ];

  if (allItems.length === 0) {
    return null;
  }

  const groupedByVenue = groupByVenue(allItems);
  const sortedVenues = getSortedVenues(groupedByVenue);

  const renderTicket = (ticket: TicketWithDetails, index: number) => {
    const drinkDeadline = formatDrinkDeadline(ticket);
    const posterImage = ticket.eventPosterUrl || ticket.eventImageUrl;
    
    return (
      <motion.div key={ticket.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }}>
        <Card className="border-0 bg-surface p-3 shadow-soft border-l-4 border-l-primary overflow-hidden">
          <div className="flex gap-3">
            {posterImage && (
              <div className="w-16 h-22 sm:w-20 sm:h-28 flex-shrink-0 rounded-lg overflow-hidden bg-muted">
                <img src={posterImage} alt={ticket.eventTitle} className="w-full h-full object-cover" />
              </div>
            )}
            
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between mb-1.5 gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 mb-1 flex-wrap">
                    <Badge className="bg-green-500/10 text-green-600 border-green-500/30 text-[10px] px-1.5 py-0">
                      {t('tickets.valid')}
                    </Badge>
                    {ticket.entryScanned && (
                      <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/30 text-[10px] px-1.5 py-0">
                        <CheckCircle2 className="h-2.5 w-2.5 mr-0.5 inline" />
                        {t('tickets.scanned')}
                      </Badge>
                    )}
                  </div>
                  {ticket.includesDrink && ticket.drinkRedeemed && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 mb-1 block w-fit">
                      {t('tickets.drinkRedeemed')}
                    </Badge>
                  )}
                  {ticket.hasInsurance && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-500/30 text-blue-500 bg-blue-500/10 mb-1 block w-fit">
                      <Shield className="h-2.5 w-2.5 mr-0.5 inline" />
                      {t('tickets.hasInsurance')}
                    </Badge>
                  )}
                  {ticket.hasCloakroom && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-teal-500/30 text-teal-500 bg-teal-500/10 mb-1 block w-fit">
                      <Shirt className="h-2.5 w-2.5 mr-0.5 inline" />
                      {t('orders.cloakroomAccess')}
                    </Badge>
                  )}
                  <p className="text-xs font-semibold text-primary truncate">{ticket.eventTitle}</p>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
                    <Clock className="h-2.5 w-2.5" />
                    {format(new Date(ticket.eventStartAt), 'HH:mm')} - {format(new Date(ticket.eventEndAt), 'HH:mm')}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-accent">{ticket.totalPrice.toFixed(2)}€</p>
                </div>
              </div>
              
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">{ticket.quantity}x {ticket.roundName}</span>
                  {ticket.quantity > 1 && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 border-muted-foreground/30">
                      <Users className="h-2 w-2 mr-0.5 inline" />
                      {ticket.quantity} {t('tickets.entries')}
                    </Badge>
                  )}
                </div>
                {loyaltyPoints[ticket.id] && (
                  <div className="flex items-center gap-1 text-[10px] text-primary">
                    <Sparkles className="h-2.5 w-2.5" />
                    <span className="font-medium">+{loyaltyPoints[ticket.id]}</span>
                  </div>
                )}
              </div>
              
              <div className="flex flex-col sm:flex-row gap-1.5">
                <Button onClick={() => onShowTicketQR(ticket)} className="flex-1 text-xs h-8" variant="outline">
                  <QrCode className="mr-1 h-3 w-3" />
                  {t('tickets.showQR')}
                </Button>
                {ticket.hasInsurance && (
                  <Button 
                    onClick={() => onCancelTicket(ticket)} 
                    className="flex-1 text-xs h-8" 
                    variant="destructive"
                    disabled={!canCancelTicket(ticket)}
                  >
                    <X className="mr-1 h-3 w-3" />
                    {t('tickets.cancelTicket')}
                  </Button>
                )}
              </div>

            </div>
          </div>
        </Card>

        {/* Free drink credit info — outside the card */}
        {ticket.includesDrink && !ticket.drinkRedeemed && (
          <div className="mt-1.5 px-3 py-2 rounded-lg border border-border/40 bg-card/50">
            <p className="text-[11px] text-muted-foreground">
              <Wine className="h-3 w-3 inline mr-1 opacity-60" />
              {t('orders.ticketIncludesPre')} {ticket.quantity} {t('orders.ticketIncludesPost')}
            </p>
          </div>
        )}
      </motion.div>
    );
  };

  const renderVipReservation = (reservation: VipReservationWithDetails, index: number) => {
    const posterImage = reservation.eventPosterUrl || reservation.eventImageUrl;
    const depositPaid = reservation.deposit;
    
    return (
      <motion.div key={reservation.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }}>
        <Card className="border-0 bg-surface p-3 shadow-soft border-l-4 border-l-amber-500 overflow-hidden">
          <div className="flex gap-3">
            {posterImage && (
              <div className="w-16 sm:w-20 aspect-[3/4] flex-shrink-0 rounded-lg overflow-hidden bg-muted">
                <img src={posterImage} alt={reservation.eventTitle} className="w-full h-full object-cover" />
              </div>
            )}
            
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between mb-1.5 gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 mb-1 flex-wrap">
                    <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/30 text-[10px] px-1.5 py-0">
                      VIP
                    </Badge>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      <Users className="h-2.5 w-2.5 mr-0.5 inline" />
                      {reservation.guestCount} {t('vipTable.guests')}
                    </Badge>
                    {reservation.entryScanned && (
                      <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/30 text-[10px] px-1.5 py-0">
                        <CheckCircle2 className="h-2.5 w-2.5 mr-0.5 inline" />
                        {t('bouncer.entryApproved')}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs font-semibold text-primary truncate">{reservation.eventTitle}</p>
                  <p className="text-[10px] text-amber-500 font-medium">{reservation.zoneName} - {reservation.packName}</p>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
                    <Clock className="h-2.5 w-2.5" />
                    {format(new Date(reservation.eventStartAt), 'HH:mm')} - {format(new Date(reservation.eventEndAt), 'HH:mm')}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-accent">{reservation.totalPrice.toFixed(2)}€</p>
                  <p className="text-[9px] text-muted-foreground">{t('tickets.depositPaid')}: {depositPaid.toFixed(2)}€</p>
                </div>
              </div>
              
              <div className="mb-2 p-1.5 bg-muted/30 rounded text-[10px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('tickets.reservedFor')}:</span>
                  <span className="font-medium">{reservation.fullName}</span>
                </div>
              </div>

              <Button onClick={() => onShowVipQR(reservation)} className="w-full text-xs h-8 mt-2" variant="outline">
                <QrCode className="mr-1 h-3 w-3" />
                {t('tickets.showQR')}
              </Button>
            </div>
          </div>
        </Card>

        {/* Placement tracker — horizontal module below the ticket */}
        {reservation.placementStatus && reservation.placementStatus !== 'none' && (
          <VipPlacementTracker
            reservationId={reservation.id}
            placementStatus={reservation.placementStatus}
            requestedTableName={reservation.requestedTableName}
            assignedTableName={reservation.assignedTableName}
            placementNote={reservation.placementNote}
          />
        )}
      </motion.div>
    );
  };

  return (
    <div className="space-y-6">
      {sortedVenues.map((venueName) => {
        const venueItems = groupedByVenue[venueName];
        const byDate = groupByDate(venueItems);
        const sortedDates = getSortedDates(byDate);

        return (
          <motion.div
            key={venueName}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
          >
            {/* Venue Header */}
            <div className="bg-muted/50 rounded-lg border-l-4 border-l-primary p-3">
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                <h3 className="text-sm font-bold uppercase tracking-wide">{venueName}</h3>
                <Badge variant="secondary" className="ml-auto text-xs">
                  {venueItems.length}
                </Badge>
              </div>
            </div>

            {/* Date Groups */}
            <div className="pl-2 space-y-4">
              {sortedDates.map((dateKey) => {
                const dateItems = byDate[dateKey];
                
                return (
                  <div key={dateKey} className="space-y-2">
                    {/* Date Header */}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-1 border-b border-border/30">
                      <Calendar className="h-3 w-3" />
                      {dateKey === 'no-date' ? (
                        <span>{t('orders.noDateInfo')}</span>
                      ) : (
                        <span className="capitalize">
                          {format(new Date(dateKey), 'EEEE d MMMM', { locale: getLocale() })}
                        </span>
                      )}
                    </div>

                    {/* Items */}
                    <div className="space-y-2">
                      {dateItems.map((item, index) => {
                        if (item.type === 'ticket') {
                          return renderTicket(item.data as TicketWithDetails, index);
                        } else {
                          return renderVipReservation(item.data as VipReservationWithDetails, index);
                        }
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
