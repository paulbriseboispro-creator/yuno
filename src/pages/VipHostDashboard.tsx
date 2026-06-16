import { useState, useMemo } from 'react';
import { useVipHost } from '@/hooks/useVipHost';
import { useVipMenuItems } from '@/hooks/useVipMenuItems';
import { useStaffNotifications } from '@/hooks/useStaffNotifications';
import { useLanguage } from '@/contexts/LanguageContext';
import { VipReservation, VipStatus } from '@/types';
import { VipReservationCard } from '@/components/vip-host/VipReservationCard';
import { VipTableDetail } from '@/components/vip-host/VipTableDetail';
import { VipFloorPlan } from '@/components/vip-host/VipFloorPlan';
import { VipOrderNotifications } from '@/components/vip-host/VipOrderNotifications';
import { VipEntryNotifications } from '@/components/vip-host/VipEntryNotifications';
import { VipZoneTabs } from '@/components/vip-host/VipZoneTabs';
import { VipPriorityLane } from '@/components/vip-host/VipPriorityLane';
import { VipTableGrid } from '@/components/vip-host/VipTableGrid';
import { VipCompactStats } from '@/components/vip-host/VipCompactStats';
import { VipActionBar } from '@/components/vip-host/VipActionBar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { 
  Crown, Map, List, RefreshCw, Loader2, Bell, ArrowLeft, Sparkles, LayoutGrid, ImageOff, Image
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED    = '#E8192C';
const T1     = 'rgba(255,255,255,0.96)';
const T2     = 'rgba(255,255,255,0.58)';
const T3     = 'rgba(255,255,255,0.36)';
const C_FAINT = 'rgba(255,255,255,0.06)';
const BORDER = 'rgba(255,255,255,0.085)';

type SortBy = 'status' | 'time';

export default function VipHostDashboard() {
  const { t } = useLanguage();
  const {
    reservations, consumptions, floorPlan, loading, activeEvent, venueId,
    updateReservationStatus, addConsumption, reassignTable, refresh, connectionStale
  } = useVipHost();

  const { quickItems, loading: menuLoading } = useVipMenuItems(venueId);
  const { notifications, markAsRead, markAllAsRead } = useStaffNotifications({ venueId, targetRole: 'vip_host' });

  const [selectedReservation, setSelectedReservation] = useState<VipReservation | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>('status');
  const [showPlacementSheet, setShowPlacementSheet] = useState(false);
  const [pendingPlacement, setPendingPlacement] = useState<VipReservation | null>(null);
  const [reassignMode, setReassignMode] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [placementLoading, setPlacementLoading] = useState(false);
  const [showOrders, setShowOrders] = useState(false);
  const [pendingOrdersCount, setPendingOrdersCount] = useState(0);
  const [showArrivals, setShowArrivals] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [showFloorBackground, setShowFloorBackground] = useState(true);

  // Extract unique zones with counts
  const zones = useMemo(() => {
    const zoneMap = new window.Map<string, { name: string; color: string; count: number }>();
    reservations.forEach(r => {
      if (!zoneMap.has(r.zoneName)) {
        zoneMap.set(r.zoneName, { name: r.zoneName, color: r.zoneColor, count: 0 });
      }
      if (['placed', 'active'].includes(r.vipStatus)) {
        const zone = zoneMap.get(r.zoneName)!;
        zone.count++;
      }
    });
    return Array.from(zoneMap.values());
  }, [reservations]);

  // Filter reservations by selected zone
  const zoneFilteredReservations = useMemo(() => {
    if (!selectedZone) return reservations;
    return reservations.filter(r => r.zoneName === selectedZone);
  }, [reservations, selectedZone]);

  // Sort reservations
  const sortedReservations = useMemo(() => {
    const sorted = [...zoneFilteredReservations];
    
    if (sortBy === 'status') {
      const statusOrder: Record<VipStatus, number> = {
        waiting: 0,
        placed: 1,
        active: 2,
        finished: 3,
        no_show: 4,
        denied: 5,
      };
      sorted.sort((a, b) => statusOrder[a.vipStatus] - statusOrder[b.vipStatus]);
    } else {
      sorted.sort((a, b) => {
        const timeA = a.placedAt || a.createdAt;
        const timeB = b.placedAt || b.createdAt;
        return new Date(timeA).getTime() - new Date(timeB).getTime();
      });
    }
    
    return sorted;
  }, [zoneFilteredReservations, sortBy]);

  const activeTablesCount = reservations.filter(r => ['placed', 'active'].includes(r.vipStatus)).length;

  const arrivalCount = notifications.filter(
    n => n.notificationType === 'vip_entry' && !n.readAt
  ).length;

  const cardQuickItems = quickItems.map(item => ({
    id: item.id,
    name: item.name,
    price: item.default_price,
    type: item.item_type,
  }));

  // Map known DB guard codes to precise, localized messages (vs a generic error).
  const placementErrorMessage = (error: unknown): string => {
    const code = (error as { code?: string } | null)?.code;
    if (code === '23505') return t('vipHost.tableTaken');     // occupancy guard
    if (code === '23503') return t('vipHost.tableMissing');   // not on floor plan
    return (error as Error)?.message || t('vipHost.placementError');
  };

  // Handle starting placement for a reservation (initial seating)
  const handleStartPlacement = (reservationId: string) => {
    const reservation = reservations.find(r => r.id === reservationId);
    if (reservation) {
      setShowArrivals(false);
      setReassignMode(false);
      setSelectedTableId(null);
      setPendingPlacement(reservation);
      setShowPlacementSheet(true);
    }
  };

  // Handle starting a table REASSIGNMENT for an already-placed guest
  const handleStartReassign = (reservation: VipReservation) => {
    setSelectedReservation(null);
    setReassignMode(true);
    setSelectedTableId(reservation.assignedTableId || null);
    setPendingPlacement(reservation);
    setShowPlacementSheet(true);
  };

  const closePlacementSheet = () => {
    setShowPlacementSheet(false);
    setPendingPlacement(null);
    setSelectedTableId(null);
    setReassignMode(false);
  };

  // Handle table placement / reassignment
  const handlePlaceTable = async () => {
    if (!pendingPlacement || !selectedTableId) return;

    setPlacementLoading(true);
    try {
      if (reassignMode) {
        await reassignTable(pendingPlacement.id, selectedTableId);
      } else {
        await updateReservationStatus(pendingPlacement.id, 'placed', selectedTableId);
      }
      const tableName = floorPlan?.layout?.tables?.find(t => t.id === selectedTableId)?.name || selectedTableId;
      toast.success(`${pendingPlacement.fullName} → ${tableName}`);
      closePlacementSheet();
    } catch (error) {
      // Surface the real reason (e.g. table already taken / no longer on plan).
      toast.error(placementErrorMessage(error));
    } finally {
      setPlacementLoading(false);
    }
  };

  // Quick add now handled by QuickAddPopover creating orders directly

  // Handle finish service
  const handleFinishService = async (reservationId: string) => {
    await updateReservationStatus(reservationId, 'finished');
    toast.success(t('vipHost.serviceFinished'));
  };

  // Mark a not-yet-arrived guest as no-show or denied entry (from placement sheet)
  const handleMarkAbsent = async (status: 'no_show' | 'denied') => {
    if (!pendingPlacement) return;
    setPlacementLoading(true);
    try {
      await updateReservationStatus(pendingPlacement.id, status);
      toast.success(status === 'no_show' ? t('vipHost.markedNoShow') : t('vipHost.markedDenied'));
      closePlacementSheet();
    } catch (error) {
      toast.error(placementErrorMessage(error));
    } finally {
      setPlacementLoading(false);
    }
  };

  // Handle clicking on low credit table from priority lane
  const handleLowCreditClick = (reservationId: string) => {
    const reservation = reservations.find(r => r.id === reservationId);
    if (reservation) {
      setSelectedReservation(reservation);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#000' }}>
        <div
          className="h-12 w-12 animate-spin rounded-full border-2"
          style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20" style={{ background: '#000' }}>
      {/* Vignette ambiante */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }}
      />

      {/* Compact Header */}
      <header
        className="sticky top-0 z-40 px-3 py-2 backdrop-blur-xl"
        style={{ background: 'rgba(10,10,12,0.72)', borderBottom: `1px solid ${BORDER}`, paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" asChild className="h-8 w-8">
              <Link to="/profile">
                <ArrowLeft className="w-4 h-4" />
              </Link>
            </Button>
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center flex-none"
              style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}
            >
              <Crown className="w-4 h-4" style={{ color: RED }} />
            </div>
            <div>
              <h1 style={{ color: T1, fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>VIP Host</h1>
              {activeEvent && (
                <p className="truncate max-w-[140px]" style={{ color: T3, fontSize: 10, marginTop: 1 }}>
                  {activeEvent.title}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => refresh()}
            >
              <RefreshCw className="w-4 h-4" />
            </Button>

            <button
              type="button"
              className="h-8 w-8 relative flex items-center justify-center rounded-xl cursor-pointer transition-all duration-150"
              style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}
              onClick={() => setShowArrivals(true)}
            >
              <Sparkles className="w-4 h-4" />
              {arrivalCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 w-4 h-4 text-[9px] font-bold rounded-full flex items-center justify-center tabular-nums"
                  style={{ background: RED, color: '#fff' }}
                >
                  {arrivalCount}
                </span>
              )}
            </button>

            <button
              type="button"
              className="h-8 w-8 relative flex items-center justify-center rounded-xl cursor-pointer transition-all duration-150"
              style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}
              onClick={() => setShowOrders(true)}
            >
              <Bell className="w-4 h-4" />
              {pendingOrdersCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 w-4 h-4 text-[9px] font-bold rounded-full flex items-center justify-center tabular-nums"
                  style={{ background: '#FCD34D', color: '#000' }}
                >
                  {pendingOrdersCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Stale-connection banner: realtime socket dropped or device offline.
          Data may be out of date and write actions are disabled until reconnect. */}
      {!loading && connectionStale && (
        <div
          className="sticky z-30 flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium"
          style={{
            top: 'calc(env(safe-area-inset-top, 0px) + 48px)',
            background: 'rgba(232,25,44,0.16)',
            color: '#FCA5A5',
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          {t('vipHost.connectionStale')}
        </div>
      )}

      <main className="relative z-10 p-3 space-y-3">
        {/* Zone Tabs */}
        {zones.length > 1 && (
          <VipZoneTabs
            zones={zones}
            selectedZone={selectedZone}
            onSelectZone={setSelectedZone}
            totalCount={activeTablesCount}
          />
        )}

        {/* Priority Lane */}
        <VipPriorityLane
          reservations={reservations}
          consumptions={consumptions}
          pendingOrdersCount={pendingOrdersCount}
          onOrdersClick={() => setShowOrders(true)}
          onArrivalsClick={() => setShowArrivals(true)}
          onLowCreditClick={handleLowCreditClick}
        />

        {/* Collapsible Stats */}
        {reservations.length > 0 && (
          <VipCompactStats
            reservations={reservations}
            consumptions={consumptions}
            open={showStats}
            onOpenChange={setShowStats}
          />
        )}

        {/* Main content tabs */}
        <Tabs defaultValue="list">
          <div className="flex items-center justify-between mb-3">
            <TabsList className="owner-tabs h-8">
              <TabsTrigger value="list" className="gap-1 text-xs h-7 px-2">
                <List className="w-3.5 h-3.5" />
                {t('vipHost.list')}
              </TabsTrigger>
              <TabsTrigger value="grid" className="gap-1 text-xs h-7 px-2">
                <LayoutGrid className="w-3.5 h-3.5" />
                {t('vipHost.grid')}
              </TabsTrigger>
              <TabsTrigger value="map" className="gap-1 text-xs h-7 px-2">
                <Map className="w-3.5 h-3.5" />
                {t('vipHost.plan')}
              </TabsTrigger>
            </TabsList>

            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => setSortBy(sortBy === 'status' ? 'time' : 'status')}
              className="text-xs h-7"
            >
              {sortBy === 'status' ? t('vipHost.byStatus') : t('vipHost.byTime')}
            </Button>
          </div>

          <TabsContent value="list" className="mt-0 space-y-2">
            {sortedReservations.length === 0 ? (
              <EmptyState />
            ) : (
              sortedReservations.map(reservation => (
                <VipReservationCard
                  key={reservation.id}
                  reservation={reservation}
                  consumptions={consumptions.get(reservation.id) || []}
                  quickItems={cardQuickItems}
                  venueId={['placed', 'active'].includes(reservation.vipStatus) ? venueId || undefined : undefined}
                  onOrderSent={refresh}
                  onFinish={['placed', 'active'].includes(reservation.vipStatus)
                    ? () => handleFinishService(reservation.id)
                    : undefined
                  }
                  onClick={() => {
                    if (['waiting', 'no_show', 'denied'].includes(reservation.vipStatus)) {
                      handleStartPlacement(reservation.id);
                    } else {
                      setSelectedReservation(reservation);
                    }
                  }}
                />
              ))
            )}
          </TabsContent>

          <TabsContent value="grid" className="mt-0">
            {sortedReservations.length === 0 ? (
              <EmptyState />
            ) : (
              <VipTableGrid
                reservations={sortedReservations}
                consumptions={consumptions}
                onSelect={(reservation) => {
                  if (['waiting', 'no_show', 'denied'].includes(reservation.vipStatus)) {
                    handleStartPlacement(reservation.id);
                  } else {
                    setSelectedReservation(reservation);
                  }
                }}
              />
            )}
          </TabsContent>

          <TabsContent value="map" className="mt-0">
            {floorPlan?.backgroundImageUrl && (
              <div className="flex items-center justify-end gap-2 mb-2 px-1">
                <Image className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{t('vipHost.showBackground') || 'Fond'}</span>
                <Switch
                  checked={showFloorBackground}
                  onCheckedChange={setShowFloorBackground}
                  className="scale-75"
                />
              </div>
            )}
            <VipFloorPlan
              floorPlan={floorPlan}
              reservations={reservations}
              consumptions={consumptions}
              mode="view"
              showBackground={showFloorBackground}
              onTableSelect={(tableId) => {
                const reservation = reservations.find(r => r.assignedTableId === tableId);
                if (reservation) {
                  setSelectedReservation(reservation);
                }
              }}
            />
          </TabsContent>
        </Tabs>
      </main>

      {/* Bottom Action Bar */}
      <VipActionBar
        mode="default"
        onOrders={() => setShowOrders(true)}
        onStats={() => setShowStats(true)}
        pendingCount={pendingOrdersCount}
      />

      {/* Table detail sheet */}
      <VipTableDetail
        reservation={selectedReservation}
        consumptions={selectedReservation ? consumptions.get(selectedReservation.id) || [] : []}
        quickItems={quickItems}
        open={!!selectedReservation}
        onClose={() => setSelectedReservation(null)}
        onAddConsumption={addConsumption}
        onUpdateStatus={updateReservationStatus}
        onReassign={handleStartReassign}
        canReassign={(floorPlan?.layout?.tables?.length ?? 0) > 0}
        actionsDisabled={connectionStale}
        venueId={venueId}
      />

      {/* Placement sheet (initial seating + reassignment) */}
      <Sheet open={showPlacementSheet} onOpenChange={(o) => { if (!o) closePlacementSheet(); }}>
        <SheetContent side="bottom" className="h-[80vh] rounded-t-3xl">
          <SheetHeader className="pb-4">
            <SheetTitle>
              {(reassignMode ? t('vipHost.reassignGuest') : t('vipHost.placeGuest')).replace('{name}', pendingPlacement?.fullName || '')}
            </SheetTitle>
            <p className="text-sm text-muted-foreground">
              {t('vipHost.personsInZone').replace('{count}', String(pendingPlacement?.guestCount || 0)).replace('{zone}', pendingPlacement?.zoneName || '')}
            </p>
          </SheetHeader>

          <VipFloorPlan
            floorPlan={floorPlan}
            reservations={reservations}
            mode="placement"
            selectedTableId={selectedTableId || undefined}
            pendingReservation={pendingPlacement}
            onTableSelect={(tableId) => setSelectedTableId(tableId)}
          />

          <div className="absolute bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur border-t space-y-2" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}>
            <Button
              className="w-full h-12 font-semibold"
              disabled={!selectedTableId || placementLoading || connectionStale}
              onClick={handlePlaceTable}
            >
              {placementLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : connectionStale ? (
                t('vipHost.connectionStale')
              ) : (
                `${t('vipHost.placeTo')} ${selectedTableId ? (floorPlan?.layout?.tables?.find(tbl => tbl.id === selectedTableId)?.name || selectedTableId) : '...'}`
              )}
            </Button>

            {/* No-show / denied entry — only for initial seating, not reassignment */}
            {!reassignMode && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 h-10"
                  disabled={placementLoading || connectionStale}
                  onClick={() => handleMarkAbsent('no_show')}
                >
                  {t('vipHost.markNoShow')}
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 h-10 text-destructive hover:text-destructive"
                  disabled={placementLoading || connectionStale}
                  onClick={() => handleMarkAbsent('denied')}
                >
                  {t('vipHost.markDenied')}
                </Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Arrivals Notifications Sheet */}
      <Sheet open={showArrivals} onOpenChange={setShowArrivals}>
        <SheetContent side="right" className="w-full sm:max-w-md" style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top, 0px))' }}>
          <SheetHeader className="pb-4">
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              {t('vipHost.vipArrivals')}
            </SheetTitle>
          </SheetHeader>
          <VipEntryNotifications 
            notifications={notifications}
            onMarkAsRead={markAsRead}
            onMarkAllAsRead={markAllAsRead}
            onPlaceGuest={handleStartPlacement}
          />
        </SheetContent>
      </Sheet>

      {/* Orders Notifications Sheet */}
      <Sheet open={showOrders} onOpenChange={setShowOrders}>
        <SheetContent side="right" className="w-full sm:max-w-md" style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top, 0px))' }}>
          <SheetHeader className="pb-4">
            <SheetTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5" />
              {t('vipHost.vipOrders')}
            </SheetTitle>
          </SheetHeader>
          {venueId && (
            <VipOrderNotifications 
              venueId={venueId} 
              onOrderConfirmed={() => refresh()}
              onPendingCountChange={setPendingOrdersCount}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function EmptyState() {
  const { t } = useLanguage();
  return (
    <div className="text-center py-12">
      <Crown className="w-12 h-12 mx-auto mb-3" style={{ color: 'rgba(255,255,255,0.14)' }} />
      <p style={{ color: 'rgba(255,255,255,0.36)', fontSize: 13 }}>{t('vipHost.noVipReservations')}</p>
    </div>
  );
}
