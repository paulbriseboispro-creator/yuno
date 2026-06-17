import { useState, useEffect, useMemo } from 'react';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { useNavigate } from 'react-router-dom';
import { VipMenuManager } from '@/components/owner/VipMenuManager';
import { VipQRCodeSection } from '@/components/owner/VipQRCodeSection';
import { VipEventSelector } from '@/components/owner/vip/VipEventSelector';
import { VipOverviewTab } from '@/components/owner/vip/VipOverviewTab';
import { VipReservationsTab } from '@/components/owner/vip/VipReservationsTab';
import { VipPlacementRequests } from '@/components/owner/vip/VipPlacementRequests';
import { VipFloorPlan } from '@/components/vip-host/VipFloorPlan';
import { OwnerTableDetailSheet } from '@/components/owner/vip/OwnerTableDetailSheet';
import { PlacementFloorPlanSheet } from '@/components/owner/vip/PlacementFloorPlanSheet';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOwnerVipData } from '@/hooks/useOwnerVipData';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Wine, MapPin, Crown, UserCheck, Settings, LayoutGrid,
  Plus, Trash2, Edit2, BarChart3, ListTree, ChevronRight, type LucideIcon,
} from 'lucide-react';
import {
  VipPage, VipCard, VipButton, VipPill, VipEmpty, VipInput, VipFieldLabel, VipSelect,
  RED, T1, T2, T3, BORDER, F_BORDER, C_FAINT, INNER_BG,
} from '@/components/owner/vip/vip-ui';

interface QuickItem {
  id: string;
  name: string;
  item_type: 'bottle' | 'extra' | 'service';
  default_price: number;
  position: number;
  is_active: boolean;
}

interface TableZone {
  id: string;
  name: string;
  color: string;
}

type VipTab = 'overview' | 'reservations' | 'placement' | 'menu' | 'staff' | 'settings';

export default function OwnerVipService() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { venueId, loading, events, reservations, consumptions, orders, refresh } = useOwnerVipData();

  const [activeTab, setActiveTab] = useState<VipTab>('overview');
  const [selectedEventId, setSelectedEventId] = useState<string>('all');
  const [vipHosts, setVipHosts] = useState<any[]>([]);
  const [quickItems, setQuickItems] = useState<QuickItem[]>([]);
  const [zones, setZones] = useState<TableZone[]>([]);
  const [editingItem, setEditingItem] = useState<QuickItem | null>(null);
  const [newItem, setNewItem] = useState({ name: '', item_type: 'bottle' as const, default_price: 0 });
  const [showAddItem, setShowAddItem] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [vipPlacementEnabled, setVipPlacementEnabled] = useState(false);
  const [floorPlan, setFloorPlan] = useState<any>(null);
  const [selectedTableReservation, setSelectedTableReservation] = useState<any>(null);
  const [modifyingReservation, setModifyingReservation] = useState<any>(null);

  // Auto-select the most recent/active event
  useEffect(() => {
    if (events.length > 0 && selectedEventId === 'all') {
      const now = new Date();
      const active = events.find(e => new Date(e.endAt) >= now);
      if (active) setSelectedEventId(active.id);
    }
  }, [events]);

  // Fetch settings-related data (hosts, floor plan, quick items, zones)
  useEffect(() => {
    if (!venueId) return;
    const fetchSettings = async () => {
      setSettingsLoading(true);
      try {
        const [hostsRes, zonesRes, itemsRes, venueRes, fpRes] = await Promise.all([
          // VIP Hosts
          supabase.from('user_roles').select('user_id').eq('role', 'vip_host').then(async ({ data }) => {
            const ids = (data || []).map(r => r.user_id);
            if (ids.length === 0) return [];
            const { data: profiles } = await supabase.from('profiles').select('id, first_name, last_name, email').in('id', ids).eq('venue_id', venueId);
            return profiles || [];
          }),
          supabase.from('table_zones').select('id, name, color').eq('venue_id', venueId).order('name'),
          supabase.from('vip_quick_items').select('*').eq('venue_id', venueId).order('position'),
          supabase.from('venues').select('vip_placement_enabled').eq('id', venueId).maybeSingle(),
          supabase.from('venue_floor_plans').select('*').eq('venue_id', venueId).maybeSingle(),
        ]);

        setVipHosts(hostsRes);
        setZones(zonesRes.data || []);
        setQuickItems((itemsRes.data || []).map((item: any) => ({
          id: item.id, name: item.name, item_type: item.item_type,
          default_price: item.default_price, position: item.position, is_active: item.is_active,
        })));
        setVipPlacementEnabled(venueRes.data?.vip_placement_enabled || false);
        if (fpRes.data) {
          setFloorPlan({
            id: fpRes.data.id,
            venueId: fpRes.data.venue_id,
            backgroundImageUrl: fpRes.data.background_image_url,
            layout: fpRes.data.layout,
            createdAt: fpRes.data.created_at,
            updatedAt: fpRes.data.updated_at,
          });
        }
      } catch (error) {
        console.error('Error fetching settings:', error);
      } finally {
        setSettingsLoading(false);
      }
    };
    fetchSettings();
  }, [venueId]);

  // Filter reservations/consumptions by selected event
  const filteredReservations = useMemo(() => {
    if (selectedEventId === 'all') return reservations;
    return reservations.filter(r => r.eventId === selectedEventId);
  }, [reservations, selectedEventId]);

  // Placement requests: reservations with any placement_status (not 'none')
  const placementRequests = useMemo(() => {
    return filteredReservations
      .filter(r => r.placementStatus && r.placementStatus !== 'none')
      .map(r => ({
        id: r.id,
        fullName: r.fullName,
        email: r.userEmail,
        phone: r.phone,
        guestCount: r.guestCount,
        zoneName: r.zoneName,
        zoneColor: r.zoneColor,
        requestedTableId: r.requestedTableId,
        requestedTableName: floorPlan?.layout?.tables?.find((t: any) => t.id === r.requestedTableId)?.name,
        placementStatus: r.placementStatus || 'requested',
        totalPrice: r.totalPrice,
        deposit: r.deposit,
        createdAt: r.createdAt,
      }));
  }, [filteredReservations, floorPlan]);

  const pendingPlacements = placementRequests.filter(r => r.placementStatus === 'requested').length;

  const filteredConsumptions = useMemo(() => {
    const resIds = new Set(filteredReservations.map(r => r.id));
    return consumptions.filter(c => resIds.has(c.reservationId));
  }, [consumptions, filteredReservations]);

  // Build consumptions map for floor plan
  const consumptionsMap = useMemo(() => {
    const map = new Map<string, any[]>();
    filteredConsumptions.forEach(c => {
      const existing = map.get(c.reservationId) || [];
      map.set(c.reservationId, [...existing, c]);
    });
    return map;
  }, [filteredConsumptions]);

  const filteredOrders = useMemo(() => {
    const resIds = new Set(filteredReservations.map(r => r.id));
    return orders.filter(o => resIds.has(o.reservationId));
  }, [orders, filteredReservations]);

  // Quick item handlers
  const handleAddQuickItem = async () => {
    if (!venueId || !newItem.name) return;
    try {
      const { error } = await supabase.from('vip_quick_items').insert({
        venue_id: venueId, name: newItem.name, item_type: newItem.item_type,
        default_price: newItem.default_price, position: quickItems.length,
      });
      if (error) throw error;
      toast.success(t('vipHost.itemAdded'));
      setNewItem({ name: '', item_type: 'bottle', default_price: 0 });
      setShowAddItem(false);
      refresh();
    } catch { toast.error(t('common.error')); }
  };

  const handleUpdateQuickItem = async () => {
    if (!editingItem) return;
    try {
      const { error } = await supabase.from('vip_quick_items').update({
        name: editingItem.name, item_type: editingItem.item_type, default_price: editingItem.default_price,
      }).eq('id', editingItem.id);
      if (error) throw error;
      toast.success(t('vipHost.itemUpdated'));
      setEditingItem(null);
      refresh();
    } catch { toast.error(t('common.error')); }
  };

  const handleDeleteQuickItem = async (itemId: string) => {
    try {
      const { error } = await supabase.from('vip_quick_items').delete().eq('id', itemId);
      if (error) throw error;
      toast.success(t('vipHost.itemDeleted'));
      refresh();
    } catch { toast.error(t('common.error')); }
  };

  const itemTypeTone = (type: string): 'warn' | 'info' | 'success' =>
    type === 'bottle' ? 'warn' : type === 'extra' ? 'info' : 'success';

  if (loading) return <OwnerPageSkeleton />;

  const tabs: { id: VipTab; label: string; icon: LucideIcon; badge?: number }[] = [
    { id: 'overview', label: t('owner.overview'), icon: BarChart3 },
    { id: 'reservations', label: t('tables.reservations'), icon: Crown },
    { id: 'placement', label: t('vipCheckout.step.placement'), icon: MapPin, badge: pendingPlacements },
    { id: 'menu', label: t('vipMenu.menuTab'), icon: Wine },
    { id: 'staff', label: t('owner.staff'), icon: UserCheck },
    { id: 'settings', label: t('owner.settings') || 'Settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen pb-28" style={{ background: '#000' }}>
      <OwnerHeader title={t('owner.vipService')} showBackButton={true} />

      <VipPage>
        {/* Event Selector */}
        <VipEventSelector
          events={events}
          selectedEventId={selectedEventId}
          onSelect={setSelectedEventId}
        />

        {/* Tab bar */}
        <div className="flex gap-0.5 overflow-x-auto scrollbar-hide" style={{ borderBottom: `1px solid ${BORDER}` }}>
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="relative inline-flex items-center gap-2 px-4 py-3 text-[13.5px] font-[560] transition-colors duration-150 cursor-pointer flex-none"
                style={{ color: isActive ? T1 : T3 }}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
                {tab.badge ? (
                  <span
                    className="inline-flex items-center justify-center tabular-nums"
                    style={{ minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999, background: RED, color: '#fff', fontSize: 9, fontWeight: 700 }}
                  >
                    {tab.badge}
                  </span>
                ) : null}
                {isActive && (
                  <span
                    className="absolute left-3 right-3 rounded-full"
                    style={{ bottom: -1, height: 2, background: RED, boxShadow: '0 0 10px rgba(232,25,44,0.6)' }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="space-y-4">
          {/* Overview */}
          {activeTab === 'overview' && (
            <VipOverviewTab reservations={filteredReservations} consumptions={filteredConsumptions} orders={filteredOrders} />
          )}

          {/* Reservations */}
          {activeTab === 'reservations' && (
            <VipReservationsTab
              reservations={filteredReservations}
              consumptions={filteredConsumptions}
              events={events}
              selectedEventId={selectedEventId}
            />
          )}

          {/* Placement & Live Floor Plan */}
          {activeTab === 'placement' && (
            <div className="space-y-4">
              {floorPlan && (
                <VipCard
                  icon={<LayoutGrid className="w-4 h-4" />}
                  title={t('owner.vip.liveFloorPlan')}
                  sub={t('vipPlacement.liveFloorPlanSub') || undefined}
                >
                  <VipFloorPlan
                    floorPlan={floorPlan}
                    reservations={filteredReservations as any}
                    consumptions={consumptionsMap}
                    mode="view"
                    selectedTableId={selectedTableReservation?.assignedTableId}
                    onTableSelect={(tableId) => {
                      const res = filteredReservations.find(r => r.assignedTableId === tableId);
                      if (res) setSelectedTableReservation(res);
                    }}
                  />
                </VipCard>
              )}

              <VipPlacementRequests
                requests={placementRequests}
                onRefresh={refresh}
                floorPlan={floorPlan}
                reservations={filteredReservations as any}
              />
            </div>
          )}

          {/* Menu */}
          {activeTab === 'menu' && venueId && <VipMenuManager venueId={venueId} />}

          {/* Staff */}
          {activeTab === 'staff' && (
            <VipCard
              icon={<UserCheck className="w-4 h-4" />}
              title={t('vipHost.vipHosts')}
              right={<VipButton size="sm" variant="secondary" onClick={() => navigate('/owner/staff')}>{t('owner.manageStaff')}</VipButton>}
            >
              {vipHosts.length === 0 ? (
                <VipEmpty
                  icon={UserCheck}
                  title={t('vipHost.noHosts')}
                  description={t('vipHost.addHostHint')}
                />
              ) : (
                <div className="space-y-2">
                  {vipHosts.map((host: any) => (
                    <div
                      key={host.id}
                      className="flex items-center justify-between py-2.5 px-3 rounded-xl"
                      style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className="h-9 w-9 rounded-full flex items-center justify-center flex-none"
                          style={{ background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.22)' }}
                        >
                          <Crown className="h-4 w-4" style={{ color: RED }} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium truncate" style={{ color: T1, fontSize: 13.5 }}>{host.first_name} {host.last_name}</p>
                          <p className="truncate" style={{ color: T3, fontSize: 11.5 }}>{host.email}</p>
                        </div>
                      </div>
                      <VipPill tone="red">VIP Host</VipPill>
                    </div>
                  ))}
                </div>
              )}
            </VipCard>
          )}

          {/* Settings */}
          {activeTab === 'settings' && (
            <div className="space-y-4">
              {/* Placement Toggle */}
              <VipCard>
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="font-semibold flex items-center gap-2" style={{ color: T1, fontSize: 15 }}>
                      <MapPin className="h-4 w-4" style={{ color: T2 }} />
                      {t('vipPlacement.enableTitle') || 'Client table selection'}
                    </h3>
                    <p className="mt-1" style={{ color: T3, fontSize: 12.5 }}>
                      {t('vipPlacement.enableDescription') || 'Allow clients to choose their table during booking'}
                    </p>
                  </div>
                  <Toggle
                    checked={vipPlacementEnabled}
                    onChange={async (checked) => {
                      setVipPlacementEnabled(checked);
                      if (venueId) {
                        await supabase.from('venues').update({ vip_placement_enabled: checked }).eq('id', venueId);
                        toast.success(checked ? (t('vipPlacement.enabled') || 'Placement enabled') : (t('vipPlacement.disabled') || 'Placement disabled'));
                      }
                    }}
                  />
                </div>
              </VipCard>

              {/* Floor Plan cross-link */}
              <VipCard>
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="font-semibold flex items-center gap-2" style={{ color: T1, fontSize: 15 }}>
                      <LayoutGrid className="h-4 w-4" style={{ color: T2 }} />
                      {t('vipHost.floorPlan')}
                    </h3>
                    <p className="mt-1" style={{ color: T3, fontSize: 12.5 }}>
                      {t('vipHost.floorPlanManagedInTables')}
                    </p>
                  </div>
                  <VipButton size="sm" variant="secondary" onClick={() => navigate('/owner/tables')}>
                    {t('vipHost.editFloorPlan')}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </VipButton>
                </div>
              </VipCard>

              <VipQRCodeSection venueId={venueId || ''} floorPlanLayout={undefined} />

              {/* Quick Items */}
              <VipCard
                icon={<ListTree className="w-4 h-4" />}
                title={t('vipHost.quickItems')}
                sub={t('vipHost.quickItemsDescription')}
                right={
                  <VipButton size="sm" variant="primary" onClick={() => setShowAddItem(!showAddItem)}>
                    <Plus className="h-4 w-4" />
                    {t('vipHost.addItem')}
                  </VipButton>
                }
              >
                {showAddItem && (
                  <div className="mb-4 p-4 rounded-xl space-y-3" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2">
                        <VipFieldLabel>{t('vipHost.itemName')}</VipFieldLabel>
                        <VipInput value={newItem.name} onChange={v => setNewItem(p => ({ ...p, name: v }))} placeholder="Champagne" />
                      </div>
                      <div>
                        <VipFieldLabel>{t('vipHost.itemPrice')}</VipFieldLabel>
                        <VipInput type="number" value={newItem.default_price} onChange={v => setNewItem(p => ({ ...p, default_price: parseFloat(v) || 0 }))} placeholder="150" />
                      </div>
                    </div>
                    <div>
                      <VipFieldLabel>{t('vipHost.itemType')}</VipFieldLabel>
                      <VipSelect value={newItem.item_type} onChange={v => setNewItem(p => ({ ...p, item_type: v as any }))} className="w-full h-auto py-2.5">
                        <option value="bottle" style={{ background: '#0a0a0c' }}>{t('vipHost.typeBottle')}</option>
                        <option value="extra" style={{ background: '#0a0a0c' }}>{t('vipHost.typeExtra')}</option>
                        <option value="service" style={{ background: '#0a0a0c' }}>{t('vipHost.typeService')}</option>
                      </VipSelect>
                    </div>
                    <div className="flex gap-2">
                      <VipButton size="sm" variant="primary" onClick={handleAddQuickItem} disabled={!newItem.name}>{t('common.save')}</VipButton>
                      <VipButton size="sm" variant="ghost" onClick={() => setShowAddItem(false)}>{t('common.cancel')}</VipButton>
                    </div>
                  </div>
                )}

                {quickItems.length === 0 && !showAddItem ? (
                  <VipEmpty icon={Wine} title={t('vipHost.noQuickItems')} />
                ) : (
                  <div className="space-y-2">
                    {quickItems.map(item => (
                      <div key={item.id}>
                        {editingItem?.id === item.id ? (
                          <div className="p-3 rounded-xl space-y-3" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                            <div className="grid grid-cols-3 gap-3">
                              <div className="col-span-2">
                                <VipInput value={editingItem.name} onChange={v => setEditingItem(p => p ? { ...p, name: v } : null)} />
                              </div>
                              <div>
                                <VipInput type="number" value={editingItem.default_price} onChange={v => setEditingItem(p => p ? { ...p, default_price: parseFloat(v) || 0 } : null)} />
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <VipButton size="sm" variant="primary" onClick={handleUpdateQuickItem}>{t('common.save')}</VipButton>
                              <VipButton size="sm" variant="ghost" onClick={() => setEditingItem(null)}>{t('common.cancel')}</VipButton>
                            </div>
                          </div>
                        ) : (
                          <div
                            className="flex items-center justify-between py-2.5 px-3 rounded-xl"
                            style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <Wine className="h-4 w-4 flex-none" style={{ color: T3 }} />
                              <div className="min-w-0">
                                <span className="font-medium" style={{ color: T1, fontSize: 13.5 }}>{item.name}</span>
                                {item.default_price > 0 && <span className="ml-2 tabular-nums" style={{ color: T3, fontSize: 11.5 }}>{item.default_price}€</span>}
                              </div>
                              <VipPill tone={itemTypeTone(item.item_type)}>{t(`vipHost.type${item.item_type.charAt(0).toUpperCase()}${item.item_type.slice(1)}`)}</VipPill>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                className="h-8 w-8 inline-flex items-center justify-center rounded-lg transition-colors"
                                style={{ color: T2 }}
                                onClick={() => setEditingItem(item)}
                                onMouseEnter={(e) => (e.currentTarget.style.background = C_FAINT)}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                              >
                                <Edit2 className="h-4 w-4" />
                              </button>
                              <button
                                className="h-8 w-8 inline-flex items-center justify-center rounded-lg transition-colors"
                                style={{ color: '#FF5C63' }}
                                onClick={() => handleDeleteQuickItem(item.id)}
                                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,92,99,0.1)')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </VipCard>
            </div>
          )}
        </div>

        {/* Owner table detail sheet */}
        <OwnerTableDetailSheet
          reservation={selectedTableReservation}
          consumptions={selectedTableReservation
            ? filteredConsumptions.filter(c => c.reservationId === selectedTableReservation.id)
            : []
          }
          open={!!selectedTableReservation}
          onClose={() => setSelectedTableReservation(null)}
          onModifyPlacement={(res) => setModifyingReservation(res)}
          onChanged={() => { refresh(); setSelectedTableReservation(null); }}
          tableName={
            selectedTableReservation?.assignedTableId
              ? floorPlan?.layout?.tables?.find((t: any) => t.id === selectedTableReservation.assignedTableId)?.name
              : undefined
          }
        />

        {/* Placement modification sheet */}
        <PlacementFloorPlanSheet
          open={!!modifyingReservation}
          onClose={() => setModifyingReservation(null)}
          reservation={modifyingReservation ? {
            id: modifyingReservation.id,
            fullName: modifyingReservation.fullName,
            guestCount: modifyingReservation.guestCount,
            zoneName: modifyingReservation.zoneName,
            requestedTableId: modifyingReservation.requestedTableId || modifyingReservation.assignedTableId,
            requestedTableName: floorPlan?.layout?.tables?.find((t: any) => t.id === (modifyingReservation.requestedTableId || modifyingReservation.assignedTableId))?.name,
          } : null}
          floorPlan={floorPlan}
          reservations={filteredReservations as any}
          onRefresh={refresh}
        />
      </VipPage>
    </div>
  );
}

// ─── Dark toggle (replaces shadcn Switch in the Yuno DA) ───────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative inline-flex flex-none items-center rounded-full transition-colors duration-150 cursor-pointer"
      style={{
        width: 44, height: 26,
        background: checked ? RED : 'rgba(255,255,255,0.1)',
        border: `1px solid ${checked ? 'rgba(232,25,44,0.5)' : BORDER}`,
        boxShadow: checked ? `0 0 14px -4px ${RED}` : undefined,
      }}
    >
      <span
        className="inline-block rounded-full transition-transform duration-150"
        style={{
          width: 20, height: 20, background: '#fff',
          transform: checked ? 'translateX(20px)' : 'translateX(2px)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
        }}
      />
    </button>
  );
}
