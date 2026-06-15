import { useState } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Building2, Calendar, Clock, QrCode, CheckCircle2, Gift, Sparkles, CreditCard, Trash2, Ban, Package } from 'lucide-react';
import { format } from 'date-fns';
import { enUS, es, fr } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import { nowInParis, toParisTime } from '@/lib/timezone';
import { Tables } from '@/integrations/supabase/types';
import { DrinkSelectionStep } from '@/components/orders/DrinkSelectionStep';

type Order = Tables<'orders'> & {
  events?: {
    title: string;
    start_at: string;
    end_at: string;
    poster_url?: string;
    venue_id?: string;
  } | null;
  venueName?: string;
};

interface OrderItem {
  id: string;
  name: string;
  qty: number;
  unitPrice: number;
  imgUrl?: string;
  drinkId?: string;
  isLoyaltyReward?: boolean;
}

interface GroupedDrinksViewProps {
  orders: Order[];
  drinkImages: Record<string, string>;
  loyaltyPoints: Record<string, number>;
  clickCollectModeByVenue: Record<string, boolean>;
  getStatusColor: (status: string) => string;
  getStatusLabel: (status: string) => string;
  getPrepStatusColor: (status: string) => string;
  getPrepStatusLabel: (status: string) => string;
  onShowQR: (order: Order) => void;
  onRequestPreparation: (orderId: string) => void;
  onRequestPrepWithItems?: (order: Order, expandedIndices: number[]) => void;
  onCollect?: (order: Order) => void;
  onPayOrder?: (order: Order) => void;
  onEditOrder?: (order: Order) => void;
  onDeleteOrder?: (orderId: string) => void;
  showPrepButton?: boolean;
  isRewardSection?: boolean;
  isPendingSection?: boolean;
  isArchived?: boolean;
}

// Helper to group items by venue
function groupByVenue(items: Order[]): Record<string, Order[]> {
  return items.reduce((acc, item) => {
    const venue = item.venueName || 'Unknown';
    if (!acc[venue]) acc[venue] = [];
    acc[venue].push(item);
    return acc;
  }, {} as Record<string, Order[]>);
}

// Helper to group items by date - uses event date if available, otherwise order creation date
function groupByDate(items: Order[]): Record<string, Order[]> {
  return items.reduce((acc, item) => {
    // Use event start date if available, otherwise fallback to order creation date
    const dateKey = item.events?.start_at 
      ? format(new Date(item.events.start_at), 'yyyy-MM-dd')
      : format(new Date(item.created_at), 'yyyy-MM-dd');
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(item);
    return acc;
  }, {} as Record<string, Order[]>);
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

// Merge orders with the same event_id into a single virtual order
function mergeOrdersByEvent(orders: Order[]): Order[] {
  const eventGroups: Record<string, Order[]> = {};
  const noEventOrders: Order[] = [];

  orders.forEach(order => {
    const eventId = order.event_id;
    if (eventId) {
      if (!eventGroups[eventId]) eventGroups[eventId] = [];
      eventGroups[eventId].push(order);
    } else {
      noEventOrders.push(order);
    }
  });

  const merged: Order[] = [];
  Object.entries(eventGroups).forEach(([, groupOrders]) => {
    if (groupOrders.length === 1) {
      merged.push(groupOrders[0]);
      return;
    }
    // Merge items from all orders
    const allItems: any[] = [];
    const sourceOrders: { id: string; items: any[]; token?: string; prep_requested?: boolean; prep_status?: string }[] = [];
    let totalAmount = 0;

    groupOrders.forEach(order => {
      const items = Array.isArray(order.items) ? (order.items as any[]) : [];
      sourceOrders.push({
        id: order.id,
        items,
        token: order.token || undefined,
        prep_requested: order.prep_requested || undefined,
        prep_status: order.prep_status || undefined,
      });
      allItems.push(...items);
      totalAmount += Number(order.total);
    });

    // Use the first order as base, override items and total
    const baseOrder = { ...groupOrders[0] };
    (baseOrder as any).items = allItems;
    (baseOrder as any).total = totalAmount;
    (baseOrder as any)._sourceOrders = sourceOrders;
    (baseOrder as any)._mergedOrderIds = groupOrders.map(o => o.id);
    // Prep: consider requested if ANY order has prep_requested
    (baseOrder as any).prep_requested = groupOrders.some(o => o.prep_requested);
    (baseOrder as any).prep_status = groupOrders.some(o => o.prep_status === 'ready') ? 'ready'
      : groupOrders.some(o => o.prep_status === 'preparing') ? 'preparing'
      : groupOrders.some(o => o.prep_status === 'queue') ? 'queue' : null;
    // Not all prep requested
    (baseOrder as any)._hasUnrequestedOrders = groupOrders.some(o => !o.prep_requested);
    merged.push(baseOrder);
  });

  return [...merged, ...noEventOrders];
}

export function GroupedDrinksView({
  orders,
  drinkImages,
  loyaltyPoints,
  clickCollectModeByVenue,
  getStatusColor,
  getStatusLabel,
  getPrepStatusColor,
  getPrepStatusLabel,
  onShowQR,
  onRequestPreparation,
  onRequestPrepWithItems,
  onCollect,
  onPayOrder,
  onEditOrder,
  onDeleteOrder,
  showPrepButton = true,
  isRewardSection = false,
  isPendingSection = false,
  isArchived = false,
}: GroupedDrinksViewProps) {
  const { language, t } = useLanguage();
  const [prepSelectionOrder, setPrepSelectionOrder] = useState<Order | null>(null);

  const getLocale = () => {
    switch (language) {
      case 'fr': return fr;
      case 'es': return es;
      default: return enUS;
    }
  };

  if (orders.length === 0) {
    return null;
  }

  const groupedByVenue = groupByVenue(orders);
  const sortedVenues = getSortedVenues(groupedByVenue);

  // Handle request prep for merged orders (request for all unrequested sub-orders)
  const handleMergedPrepRequest = (order: Order) => {
    const mergedIds = (order as any)._mergedOrderIds as string[] | undefined;
    if (mergedIds) {
      // Request prep for each unrequested sub-order
      const sourceOrders = (order as any)._sourceOrders as any[];
      sourceOrders.forEach((so: any) => {
        if (!so.prep_requested) {
          onRequestPreparation(so.id);
        }
      });
    } else {
      onRequestPreparation(order.id);
    }
  };

  const handlePrepSelection = (order: Order) => {
    // If onRequestPrepWithItems is available, show selection step
    if (onRequestPrepWithItems) {
      setPrepSelectionOrder(order);
    } else {
      handleMergedPrepRequest(order);
    }
  };

  const handlePrepSelectionConfirm = (expandedIndices: number[]) => {
    if (prepSelectionOrder && onRequestPrepWithItems) {
      onRequestPrepWithItems(prepSelectionOrder, expandedIndices);
      setPrepSelectionOrder(null);
    }
  };

  const renderOrder = (order: Order, index: number) => {
    const items = Array.isArray(order.items) ? (order.items as unknown as OrderItem[]) : [];
    const mostExpensiveItem = items.reduce((max, item) => 
      (item.unitPrice > (max?.unitPrice || 0)) ? item : max
    , items[0]);
    const productImage = mostExpensiveItem?.imgUrl || 
      (mostExpensiveItem?.id ? drinkImages[mostExpensiveItem.id] : null) ||
      (mostExpensiveItem?.drinkId ? drinkImages[mostExpensiveItem.drinkId] : null);
    
    const isReward = isRewardSection || (items.some(item => item.isLoyaltyReward === true)) || Number(order.total) === 0;
    const isClickCollect = clickCollectModeByVenue[order.venue_id] || false;

    // Calculate served and prep progress
    let totalUnits = 0, servedUnits = 0, prepUnitsCount = 0;
    items.forEach(item => {
      for (let i = 0; i < item.qty; i++) {
        totalUnits++;
        const isServed = Array.isArray((item as any).servedUnits) 
          ? (item as any).servedUnits[i] === true 
          : (item as any).served === true;
        const isInPrep = Array.isArray((item as any).prepUnits)
          ? (item as any).prepUnits[i] === true
          : false;
        if (isServed) servedUnits++;
        else if (isInPrep) prepUnitsCount++;
      }
    });
    const isPartiallyServed = servedUnits > 0 && servedUnits < totalUnits;
    const isFullyServed = totalUnits > 0 && servedUnits === totalUnits;
    const availableForQR = totalUnits - servedUnits - prepUnitsCount;
    const hasPrepItems = prepUnitsCount > 0;
    const isPrepReady = order.prep_status === 'ready' || 
      ((order as any)._sourceOrders && (order as any)._sourceOrders.some((so: any) => so.prep_status === 'ready'));

    // Archived layout: horizontal like ticket archives
    if (isArchived) {
      const groupedItems: { name: string; totalQty: number; unitPrice: number }[] = [];
      items.forEach((item: any) => {
        const existing = groupedItems.find(g => g.name === item.name);
        if (existing) { existing.totalQty += item.qty; }
        else { groupedItems.push({ name: item.name, totalQty: item.qty, unitPrice: item.unitPrice }); }
      });

      return (
        <motion.div key={order.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }}>
          <Card className="border-0 bg-surface/50 p-3 sm:p-4 shadow-soft">
            <div className="flex gap-3 sm:gap-4">
              {productImage && (
                <div className="w-16 h-22 sm:w-20 sm:h-28 flex-shrink-0 rounded-lg overflow-hidden bg-muted opacity-60 grayscale">
                  <img src={productImage} alt={mostExpensiveItem?.name} className="w-full h-full object-cover" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between mb-2 gap-2">
                  <div className="flex-1 min-w-0">
                    <Badge variant="secondary" className="text-xs mb-1">{getStatusLabel(order.status)}</Badge>
                    {order.events?.title && (
                      <p className="text-xs font-semibold text-muted-foreground truncate">{order.events.title}</p>
                    )}
                    {order.events?.start_at && (
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock className="h-2.5 w-2.5" />
                        {format(new Date(order.events.start_at), 'HH:mm', { locale: getLocale() })} - {format(new Date(order.events.end_at), 'HH:mm', { locale: getLocale() })}
                      </div>
                    )}
                  </div>
                  <p className="text-base font-bold text-muted-foreground">{Number(order.total).toFixed(2)}€</p>
                </div>
                <div className="space-y-0.5">
                  {groupedItems.map((g, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{g.totalQty}x {g.name}</span>
                      <span>{(g.unitPrice * g.totalQty).toFixed(2)}€</span>
                    </div>
                  ))}
                </div>
                {loyaltyPoints[order.id] && (
                  <div className="flex items-center gap-1 mt-1 text-[10px] text-primary">
                    <Sparkles className="h-3 w-3" />
                    <span className="font-medium">+{loyaltyPoints[order.id]} {t('loyalty.pointsEarned') || 'points'}</span>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </motion.div>
      );
    }

    return (
      <motion.div key={order.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }}>
        <Card className={`border-0 bg-surface p-3 sm:p-4 shadow-soft ${isReward ? 'border-l-4 border-l-primary' : isPendingSection ? 'border-l-4 border-l-yellow-500' : 'border-l-4 border-l-blue-500'}`}>
          <div className="flex gap-3 sm:gap-4">
            {productImage && (
              <div className="w-16 h-22 sm:w-20 sm:h-28 flex-shrink-0 rounded-lg overflow-hidden bg-muted">
                <img src={productImage} alt={mostExpensiveItem?.name} className="w-full h-full object-cover" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between mb-1 gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    {isReward ? (
                      <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px]">
                        <Gift className="h-2.5 w-2.5 mr-0.5 inline" />
                        {t('loyalty.reward')}
                      </Badge>
                    ) : (
                      <Badge className={`${getStatusColor(order.status)} text-[10px]`}>{getStatusLabel(order.status)}</Badge>
                    )}
                    {!isReward && <Clock className="h-3 w-3 text-blue-400" />}
                  </div>
                  {order.events?.title && (
                    <>
                      <p className="text-xs font-semibold text-primary truncate">{order.events.title}</p>
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock className="h-2.5 w-2.5" />
                        {format(new Date(order.events.start_at), 'HH:mm', { locale: getLocale() })} - {format(new Date(order.events.end_at), 'HH:mm', { locale: getLocale() })}
                      </div>
                    </>
                  )}
                </div>
                <p className={`text-base font-bold ${isReward ? 'text-primary' : 'text-accent'}`}>
                  {isReward ? t('loyalty.free') : `${Number(order.total).toFixed(2)}€`}
                </p>
              </div>

              {/* Served progress indicator */}
              {(servedUnits > 0 || (isClickCollect && prepUnitsCount > 0)) && (
                <div className="mb-1">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all flex">
                        <div className="h-full bg-green-500" style={{ width: `${(servedUnits / totalUnits) * 100}%` }} />
                        <div className="h-full bg-blue-400" style={{ width: `${(prepUnitsCount / totalUnits) * 100}%` }} />
                      </div>
                    </div>
                    <span className="text-[10px] font-medium text-green-600">
                      {servedUnits}/{totalUnits} {t('drinkSelection.collected')}
                    </span>
                  </div>
                </div>
              )}

              {/* Items list */}
              <div className="space-y-0.5 mb-1">
                {(() => {
                  const grouped: { name: string; totalQty: number; servedQty: number; prepQty: number; unitPrice: number; isRewardItem: boolean }[] = [];
                  items.forEach((item: any) => {
                    const existing = grouped.find(g => g.name === item.name);
                    const itemServedCount = Array.isArray(item.servedUnits) 
                      ? item.servedUnits.filter((s: boolean) => s).length 
                      : item.served ? item.qty : 0;
                    const itemPrepCount = Array.isArray(item.prepUnits)
                      ? item.prepUnits.filter((p: boolean) => p).length
                      : 0;
                    if (existing) {
                      existing.totalQty += item.qty;
                      existing.servedQty += itemServedCount;
                      existing.prepQty += itemPrepCount;
                    } else {
                      grouped.push({ name: item.name, totalQty: item.qty, servedQty: itemServedCount, prepQty: itemPrepCount, unitPrice: item.unitPrice, isRewardItem: item.isLoyaltyReward });
                    }
                  });
                  return grouped.map((g, idx) => {
                    const allServed = g.servedQty >= g.totalQty;
                    const availableQty = g.totalQty - g.servedQty - g.prepQty;
                    return (
                      <div key={idx} className={`flex items-center justify-between text-xs gap-2 ${allServed ? 'opacity-50 line-through' : ''}`}>
                        <span className="truncate font-medium">
                          {allServed ? g.totalQty : availableQty > 0 ? availableQty : g.prepQty}x {g.name}
                          {allServed && <CheckCircle2 className="h-2.5 w-2.5 inline ml-1 text-green-500" />}
                          {!allServed && g.servedQty > 0 && (
                            <span className="text-green-500 ml-1">({g.servedQty} {t('drinkSelection.collected')})</span>
                          )}
                          {!allServed && g.prepQty > 0 && (
                            <span className="text-blue-500 ml-1">({g.prepQty} {t('drinkSelection.inPrep')})</span>
                          )}
                        </span>
                        {!isReward && <span className="flex-shrink-0 text-muted-foreground">{(g.unitPrice * g.totalQty).toFixed(2)}€</span>}
                      </div>
                    );
                  });
                })()}
              </div>

              {loyaltyPoints[order.id] && !isReward && (
                <div className="flex items-center gap-1 mb-1 text-[10px] text-primary">
                  <Sparkles className="h-3 w-3" />
                  <span className="font-medium">+{loyaltyPoints[order.id]} {t('loyalty.pointsEarned') || 'points'}</span>
                </div>
              )}

              {isClickCollect && order.prep_status && order.prep_status !== 'queue' && order.prep_status !== 'ready' && (
                <div className="mb-1">
                  <Badge className={`${getPrepStatusColor(order.prep_status)} text-[10px]`}>{getPrepStatusLabel(order.prep_status)}</Badge>
                </div>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="mt-2">
            {isPendingSection && onPayOrder && onEditOrder && onDeleteOrder ? (
              <div className="flex gap-1.5">
                <Button onClick={() => onPayOrder(order)} className="flex-1 text-xs h-8" variant="default">
                  <CreditCard className="mr-1 h-3 w-3" />{t('orders.payNow')}
                </Button>
                <Button onClick={() => onEditOrder(order)} className="flex-1 text-xs h-8" variant="outline">{t('orders.edit')}</Button>
                <Button onClick={() => onDeleteOrder(order.id)} variant="destructive" size="icon" className="h-8 w-8"><Trash2 className="h-3 w-3" /></Button>
              </div>
            ) : isFullyServed ? (
              <Badge className="w-full justify-center py-1.5 text-[10px] bg-green-500/10 text-green-600 border-green-500/30">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                {t('drinkSelection.allServed')}
              </Badge>
            ) : (
              <div className="flex flex-col sm:flex-row gap-1.5">
                {availableForQR > 0 && (
                  <Button onClick={() => onShowQR(order)} className="flex-1 text-xs h-8" variant="outline">
                    <QrCode className="mr-1 h-3 w-3" />
                    {isPartiallyServed ? t('drinkSelection.collectRemaining') : t('orders.showQR')}
                  </Button>
                )}

                {isClickCollect && isPrepReady && onCollect && (
                  <Button 
                    onClick={() => onCollect(order)} 
                    className="flex-1 text-xs h-8 bg-primary hover:bg-primary/90 text-primary-foreground" 
                    variant="default"
                  >
                    <Package className="mr-1 h-3 w-3" />
                    {t('clickCollect.collectOrder')}
                  </Button>
                )}

                {isClickCollect && showPrepButton && !isPrepReady && (() => {
                  if (availableForQR === 0 && hasPrepItems) {
                    if (order.prep_status === 'queue') {
                      return (
                        <Badge variant="secondary" className="flex-1 justify-center py-1.5 text-[10px]">{t('clickCollect.prepRequested')}</Badge>
                      );
                    }
                    if (order.prep_status === 'preparing') {
                      return (
                        <Badge className="flex-1 justify-center py-1.5 text-[10px] bg-blue-500 text-white">{getPrepStatusLabel('preparing')}</Badge>
                      );
                    }
                    return null;
                  }
                  if (availableForQR > 0) {
                    const startAt = order.events?.start_at;
                    let eventStarted = true;
                    if (startAt) {
                      const now = nowInParis();
                      const eventStart = toParisTime(startAt);
                      if (!Number.isNaN(eventStart.getTime())) {
                        eventStarted = now >= new Date(eventStart.getTime() - 5 * 60 * 1000);
                      }
                    }
                    return (
                      <Button 
                        onClick={() => handlePrepSelection(order)} 
                        className="flex-1 text-xs h-8" 
                        variant="default"
                        disabled={!eventStarted}
                      >
                        {eventStarted ? (
                          <><Clock className="mr-1 h-3 w-3" />{t('clickCollect.requestPrepShort')}</>
                        ) : (
                          <><Ban className="mr-1 h-3 w-3" />{t('clickCollect.eventNotStartedYet')}</>
                        )}
                      </Button>
                    );
                  }
                  return null;
                })()}
              </div>
            )}
          </div>
        </Card>
      </motion.div>
    );
  };

  return (
    <>
      <div className="space-y-6">
        {sortedVenues.map((venueName) => {
          const venueOrders = groupedByVenue[venueName];
          const byDate = groupByDate(venueOrders);
          const sortedDates = getSortedDates(byDate);

          return (
            <motion.div
              key={venueName}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-3"
            >
              <div className="bg-muted/50 rounded-lg border-l-4 border-l-primary p-3">
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  <h3 className="text-sm font-bold uppercase tracking-wide">{venueName}</h3>
                  <Badge variant="secondary" className="ml-auto text-xs">
                    {venueOrders.length}
                  </Badge>
                </div>
              </div>

              <div className="pl-2 space-y-4">
                {sortedDates.map((dateKey) => {
                  const dateOrders = byDate[dateKey];
                  // Merge orders by event within this date
                  const mergedOrders = mergeOrdersByEvent(dateOrders);
                  
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
                        {mergedOrders.map((order, index) => renderOrder(order, index))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Prep Selection Overlay */}
      {prepSelectionOrder && (
        <DrinkSelectionStep
          items={Array.isArray(prepSelectionOrder.items) ? (prepSelectionOrder.items as any[]) : []}
          onConfirm={handlePrepSelectionConfirm}
          onClose={() => setPrepSelectionOrder(null)}
          mode="prep"
        />
      )}
    </>
  );
}
