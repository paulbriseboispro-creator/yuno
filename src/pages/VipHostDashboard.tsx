import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useVipNight } from '@/hooks/useVipNight';
import { useStaffNotifications } from '@/hooks/useStaffNotifications';
import { useLanguage } from '@/contexts/LanguageContext';
import { PublicPage } from '@/components/PublicPage';
import { StaffHeader } from '@/components/staff/StaffHeader';
import { StaffOnboardingGate } from '@/components/staff/StaffOnboardingGate';
import { StaffNightPanel } from '@/components/staff/StaffNightPanel';
import { haptics } from '@/lib/haptics';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import {
  Crown, Map as MapIcon, List, Bell, BarChart3, RefreshCw, Image, DoorOpen, CalendarOff,
} from 'lucide-react';
import { ServiceFloorPlan } from '@/components/vip-service/ServiceFloorPlan';
import { ServiceTablesTab } from '@/components/vip-service/ServiceTablesTab';
import { ServiceOrdersTab } from '@/components/vip-service/ServiceOrdersTab';
import { ServiceNightTab } from '@/components/vip-service/ServiceNightTab';
import { TableServiceSheet } from '@/components/vip-service/TableServiceSheet';
import { SeatPickerSheet } from '@/components/vip-service/SeatPickerSheet';
import { OrderComposerSheet } from '@/components/vip-service/OrderComposerSheet';
import {
  ServiceOrder, ServiceReservation, CartLine, fmtAge,
} from '@/components/vip-service/serviceTypes';

// ─── Yuno Design Tokens (pro) ────────────────────────────────────────────────
const RED = '#E8192C';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const C_FAINT = 'rgba(255,255,255,0.06)';
const BORDER = 'rgba(255,255,255,0.085)';
const GOLD = '#E7C15A';

type Tab = 'room' | 'tables' | 'service' | 'night';

/**
 * Outil serveur VIP — reconstruit autour de quatre onglets :
 *   Salle   : le plan interactif, écran d'accueil du service.
 *   Tables  : la liste triée par « qui a besoin de moi ».
 *   Service : le pipeline des commandes (pré-commandes → bar → servies).
 *   Soirée  : la nuit en chiffres.
 * Un seul modèle mental : Commandes = ce que le bar prépare, Consos = le
 * grand livre de ce qui est servi (c'est lui qui consomme le crédit client).
 */
export default function VipHostDashboard() {
  const { t } = useLanguage();
  const night = useVipNight();
  const {
    venueId, loading, noVenue, connectionStale, activeEvent, reservations, consumptions,
    orders, ordersByReservation, moments, floorPlan, menuItems, quickItems, serviceInfo,
    doorQueue, refresh,
  } = night;

  const { notifications, markAsRead } = useStaffNotifications({ venueId, targetRole: 'vip_host' });

  const [tab, setTab] = useState<Tab>('room');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [seatPicker, setSeatPicker] = useState<{ reservation: ServiceReservation; moveMode: boolean } | null>(null);
  const [composerId, setComposerId] = useState<string | null>(null);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [showFloorBackground, setShowFloorBackground] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data?.user?.id ?? null));
  }, []);

  // La prise de poste vit dans StaffNightPanel (rituel d'ouverture la nuit,
  // silencieuse en journée).

  const reservationById = useMemo(() => {
    const map = new Map<string, ServiceReservation>();
    reservations.forEach(r => map.set(r.id, r));
    return map;
  }, [reservations]);

  const selected = selectedId ? reservationById.get(selectedId) || null : null;
  const composerFor = composerId ? reservationById.get(composerId) || null : null;

  // Tables demandées par des clients pas encore installés (tap plan → placement).
  const requestedByTable = useMemo(() => {
    const map = new Map<string, ServiceReservation>();
    reservations.forEach(r => {
      if (r.requestedTableId && !r.assignedTableId && r.vipStatus === 'waiting' && r.placementStatus === 'requested') {
        map.set(r.requestedTableId, r);
      }
    });
    return map;
  }, [reservations]);

  const serviceBadge = useMemo(() => {
    const pending = orders.filter(o => o.status === 'pending').length;
    const preordersArrived = orders.filter(
      o => o.status === 'preorder' && reservationById.get(o.reservationId)?.hasArrived
    ).length;
    return pending + preordersArrived;
  }, [orders, reservationById]);

  // ─── Actions ────────────────────────────────────────────────────────────────

  const placementErrorMessage = (error: unknown): string => {
    const code = (error as { code?: string } | null)?.code;
    if (code === '23505') return t('vipHost.tableTaken');
    if (code === '23503') return t('vipHost.tableMissing');
    return (error as Error)?.message || t('vipnight.error');
  };

  const tableName = (tableId: string) =>
    floorPlan?.layout?.tables?.find(tb => tb.id === tableId)?.name || tableId;

  const handleSeatConfirm = async (tableId: string) => {
    if (!seatPicker) return;
    const { reservation, moveMode } = seatPicker;
    setActionBusy(true);
    try {
      if (moveMode) {
        await night.moveGuest(reservation.id, tableId);
        toast.success(t('vipnight.guestMoved').replace('{name}', reservation.fullName).replace('{table}', tableName(tableId)));
      } else {
        await night.seatGuest(reservation.id, tableId);
        toast.success(t('vipnight.seated').replace('{name}', reservation.fullName).replace('{table}', tableName(tableId)));
        // L'arrivée est traitée : on solde les notifications de cette résa.
        notifications
          .filter(n => n.notificationType === 'vip_entry' && n.referenceId === reservation.id && !n.readAt)
          .forEach(n => markAsRead(n.id));
      }
      haptics.success();
      setSeatPicker(null);
    } catch (error) {
      haptics.error();
      toast.error(placementErrorMessage(error));
    } finally {
      setActionBusy(false);
    }
  };

  const handleMarkAbsent = async (status: 'no_show' | 'denied') => {
    if (!seatPicker) return;
    setActionBusy(true);
    try {
      await night.markAbsent(seatPicker.reservation.id, status);
      toast.success(status === 'no_show' ? t('vipnight.markedNoShow') : t('vipnight.markedDenied'));
      setSeatPicker(null);
      setSelectedId(null);
    } catch (error) {
      toast.error(placementErrorMessage(error));
    } finally {
      setActionBusy(false);
    }
  };

  const handleMarkArrived = async (r: ServiceReservation) => {
    try {
      await night.markArrived(r.id);
      haptics.success();
      toast.success(t('vipnight.markedArrived').replace('{name}', r.fullName));
    } catch (error) {
      haptics.error();
      toast.error(placementErrorMessage(error));
    }
  };

  const handleFinish = async (r: ServiceReservation) => {
    try {
      await night.finishService(r.id);
      haptics.success();
      toast.success(t('vipnight.finished'));
      setSelectedId(null);
    } catch (error) {
      toast.error(placementErrorMessage(error));
    }
  };

  const handleReopen = async (r: ServiceReservation) => {
    try {
      await night.reopenService(r.id);
      haptics.success();
    } catch (error) {
      toast.error(placementErrorMessage(error));
    }
  };

  const handleConfirmOrder = async (order: ServiceOrder) => {
    setBusyOrderId(order.id);
    try {
      const ok = await night.confirmOrder(order.id);
      if (ok) {
        haptics.success();
        toast.success(order.status === 'preorder' ? t('vipnight.preorderValidated') : t('vipnight.orderConfirmed'));
      } else {
        toast.info(t('vipnight.alreadyHandled'));
      }
    } catch (error) {
      haptics.error();
      toast.error(placementErrorMessage(error));
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleServeOrder = async (order: ServiceOrder) => {
    setBusyOrderId(order.id);
    try {
      const ok = await night.serveOrder(order);
      if (ok) {
        haptics.success();
        toast.success(t('vipnight.orderServed'));
      } else {
        toast.info(t('vipnight.alreadyHandled'));
      }
    } catch (error) {
      haptics.error();
      toast.error(placementErrorMessage(error));
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleCancelOrder = async (order: ServiceOrder) => {
    if (!window.confirm(t('vipnight.confirmCancelOrder'))) return;
    setBusyOrderId(order.id);
    try {
      const ok = await night.cancelOrder(order.id);
      if (ok) toast.success(t('vipnight.orderCancelled'));
      else toast.info(t('vipnight.alreadyHandled'));
    } catch (error) {
      toast.error(placementErrorMessage(error));
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleSubmitCart = async (lines: CartLine[], opts: { directServe: boolean; note?: string }) => {
    if (!composerFor) return;
    setActionBusy(true);
    try {
      await night.submitCart(composerFor.id, lines, opts);
      haptics.success();
      toast.success(opts.directServe ? t('vipnight.servedAdded') : t('vipnight.orderSent'));
      setComposerId(null);
    } catch (error) {
      haptics.error();
      toast.error(placementErrorMessage(error));
    } finally {
      setActionBusy(false);
    }
  };

  const handleUndoConsumption = async (consumptionId: string) => {
    try {
      await night.undoConsumption(consumptionId);
      toast.success(t('vipnight.undoDone'));
    } catch {
      toast.error(t('vipnight.error'));
    }
  };

  const handleScheduleMoment = async (kind: string, label: string | null, inMinutes: number) => {
    if (!selected) return;
    try {
      await night.scheduleMoment(selected.id, kind, label, new Date(Date.now() + inMinutes * 60000).toISOString());
      haptics.success();
      toast.success(t('vipnight.momentPlanned'));
    } catch {
      toast.error(t('vipnight.error'));
    }
  };

  // ─── États globaux ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#000' }}>
        <div className="h-12 w-12 animate-spin rounded-full border-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
      </div>
    );
  }

  if (noVenue) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6" style={{ background: '#000' }}>
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}>
            <Crown className="h-6 w-6" style={{ color: T3 }} />
          </div>
          <h1 style={{ color: T1, fontSize: 19, fontWeight: 700, letterSpacing: '-0.01em' }}>{t('vipHost.noVenueTitle')}</h1>
          <p style={{ color: T2, fontSize: 14, lineHeight: 1.55, marginTop: 10 }}>{t('vipHost.noVenueBody')}</p>
        </div>
      </div>
    );
  }

  const tabs: { key: Tab; label: string; icon: typeof MapIcon; badge?: number }[] = [
    { key: 'room', label: t('vipnight.tabRoom'), icon: MapIcon },
    { key: 'tables', label: t('vipnight.tabTables'), icon: List, badge: doorQueue.length || undefined },
    { key: 'service', label: t('vipnight.tabService'), icon: Bell, badge: serviceBadge || undefined },
    { key: 'night', label: t('vipnight.tabNight'), icon: BarChart3 },
  ];

  return (
    <div
      className="min-h-screen"
      // La tab bar est `fixed` : le padding bas couvre sa hauteur + l'indicateur
      // d'accueil iPhone, sinon le dernier élément passe dessous.
      style={{ background: '#000', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)' }}
    >
      <StaffOnboardingGate />
      <div className="pointer-events-none fixed inset-0 z-0" style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }} />

      <StaffHeader
        role="vip_host"
        online={!connectionStale}
        // Sur cet écran, l'événement en cours prime sur le nom du club : c'est
        // le contexte qui change d'une nuit à l'autre.
        subtitle={activeEvent?.title}
        backButtonClassName="h-10 w-10 shrink-0"
        actions={<>
          <button
            type="button"
            className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl transition-all duration-150"
            style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}
            onClick={() => refresh()}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </>}
      />

      {/* Bandeau connexion perdue : données possiblement périmées, écritures gelées. */}
      {connectionStale && (
        <div
          className="sticky z-30 flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium"
          style={{
            top: 'calc(env(safe-area-inset-top, 0px) + 56px)',
            background: 'rgba(232,25,44,0.16)',
            color: '#FCA5A5',
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          {t('vipHost.connectionStale')}
        </div>
      )}

      {/* PublicPage n'enveloppe QUE le contenu défilant : header sticky, bandeau
          et tab bar fixed restent en sibling (un ancêtre transformé casserait
          leur positionnement). */}
      <PublicPage variant="flow">
        <main className="relative z-10 space-y-3 p-3">
          {/* Ce soir : consigne, tables, équipe, appels */}
          <StaffNightPanel role="vip_host" />

          {!activeEvent && (
            <div className="flex items-center gap-3 rounded-2xl px-4 py-3.5" style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}>
              <CalendarOff className="h-5 w-5 shrink-0" style={{ color: T3 }} />
              <div className="min-w-0">
                <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{t('vipnight.noEvent')}</p>
                <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>{t('vipnight.noEventHint')}</p>
              </div>
            </div>
          )}

          {tab === 'room' && (
            <>
              {/* File de la porte : arrivés, pas encore installés */}
              {doorQueue.length > 0 && (
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 px-1" style={{ color: GOLD, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    <DoorOpen className="h-3.5 w-3.5" />
                    {t('vipnight.doorQueue')}
                  </p>
                  <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                    {doorQueue.map(r => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setSeatPicker({ reservation: r, moveMode: false })}
                        className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 transition-all duration-150"
                        style={{ background: 'rgba(231,193,90,0.09)', border: '1px solid rgba(231,193,90,0.4)' }}
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: 'rgba(231,193,90,0.18)', color: GOLD }}>
                          {r.guestCount}
                        </span>
                        <span className="text-left">
                          <span className="block truncate" style={{ color: T1, fontSize: 12.5, fontWeight: 600, maxWidth: 120 }}>
                            {r.fullName}
                          </span>
                          <span className="block tabular-nums" style={{ color: T3, fontSize: 9.5 }}>
                            {fmtAge(r.checkedInAt)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {floorPlan?.backgroundImageUrl && (
                <div className="flex items-center justify-end gap-2 px-1">
                  <Image className="h-3.5 w-3.5" style={{ color: T3 }} />
                  <span style={{ color: T3, fontSize: 11 }}>{t('vipnight.showBackground')}</span>
                  <Switch checked={showFloorBackground} onCheckedChange={setShowFloorBackground} className="scale-75" />
                </div>
              )}

              <ServiceFloorPlan
                floorPlan={floorPlan}
                reservations={reservations}
                serviceInfo={serviceInfo}
                mode="live"
                showBackground={showFloorBackground}
                onTableTap={(tableId, seated) => {
                  if (seated) {
                    haptics.selection();
                    setSelectedId(seated.id);
                    return;
                  }
                  const requester = requestedByTable.get(tableId);
                  if (requester) {
                    haptics.selection();
                    setSeatPicker({ reservation: requester, moveMode: false });
                  }
                }}
              />
            </>
          )}

          {tab === 'tables' && (
            <ServiceTablesTab
              reservations={reservations}
              serviceInfo={serviceInfo}
              disabled={connectionStale}
              onSelect={r => setSelectedId(r.id)}
              onSeat={r => setSeatPicker({ reservation: r, moveMode: false })}
            />
          )}

          {tab === 'service' && (
            <ServiceOrdersTab
              orders={orders}
              reservationById={reservationById}
              busyOrderId={busyOrderId}
              disabled={connectionStale}
              onConfirm={handleConfirmOrder}
              onServe={handleServeOrder}
              onCancel={handleCancelOrder}
              onGuestTap={r => setSelectedId(r.id)}
            />
          )}

          {tab === 'night' && (
            <ServiceNightTab
              reservations={reservations}
              consumptions={consumptions}
              serviceInfo={serviceInfo}
              moments={moments}
            />
          )}
        </main>
      </PublicPage>

      {/* Tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 backdrop-blur-xl"
        style={{ background: 'rgba(10,10,12,0.82)', borderTop: `1px solid ${BORDER}`, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="mx-auto flex max-w-md">
          {tabs.map(({ key, label, icon: Icon, badge }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  haptics.selection();
                  setTab(key);
                }}
                className="relative flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-1 pb-2 pt-2.5 transition-all duration-150"
                style={{ color: active ? T1 : T3 }}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" style={{ color: active ? RED : undefined }} />
                  {!!badge && (
                    <span
                      className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold tabular-nums"
                      style={{ background: RED, color: '#fff' }}
                    >
                      {badge}
                    </span>
                  )}
                </span>
                <span className="max-w-full truncate px-1" style={{ fontSize: 10, fontWeight: active ? 700 : 500 }}>
                  {label}
                </span>
                {active && (
                  <span className="absolute inset-x-6 top-0 h-0.5 rounded-full" style={{ background: RED }} />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Détail table */}
      <TableServiceSheet
        reservation={selected}
        info={selected ? serviceInfo.get(selected.id) || null : null}
        consumptions={selected ? consumptions.get(selected.id) || [] : []}
        orders={selected ? ordersByReservation.get(selected.id) || [] : []}
        moments={moments}
        venueId={venueId || ''}
        currentUserId={currentUserId}
        busyOrderId={busyOrderId}
        disabled={connectionStale}
        onClose={() => setSelectedId(null)}
        onSeat={() => selected && setSeatPicker({ reservation: selected, moveMode: false })}
        onMove={() => selected && setSeatPicker({ reservation: selected, moveMode: true })}
        onMarkArrived={() => selected && handleMarkArrived(selected)}
        onOpenComposer={() => selected && setComposerId(selected.id)}
        onFinish={() => selected && handleFinish(selected)}
        onReopen={() => selected && handleReopen(selected)}
        onConfirmOrder={handleConfirmOrder}
        onServeOrder={handleServeOrder}
        onCancelOrder={handleCancelOrder}
        onUndoConsumption={handleUndoConsumption}
        onScheduleMoment={handleScheduleMoment}
        onCompleteMoment={id => night.completeMoment(id).catch(() => toast.error(t('vipnight.error')))}
      />

      {/* Placement / déplacement */}
      <SeatPickerSheet
        open={!!seatPicker}
        reservation={seatPicker?.reservation || null}
        moveMode={seatPicker?.moveMode || false}
        floorPlan={floorPlan}
        reservations={reservations}
        serviceInfo={serviceInfo}
        busy={actionBusy}
        disabled={connectionStale}
        onConfirm={handleSeatConfirm}
        onMarkAbsent={handleMarkAbsent}
        onClose={() => setSeatPicker(null)}
      />

      {/* Prise de commande */}
      <OrderComposerSheet
        open={!!composerFor}
        reservation={composerFor}
        info={composerFor ? serviceInfo.get(composerFor.id) || null : null}
        menuItems={menuItems}
        quickItems={quickItems}
        busy={actionBusy}
        disabled={connectionStale}
        onSubmit={handleSubmitCart}
        onClose={() => setComposerId(null)}
      />
    </div>
  );
}
