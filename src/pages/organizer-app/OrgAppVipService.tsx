import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { VipEventSelector } from '@/components/owner/vip/VipEventSelector';
import { VipOverviewTab } from '@/components/owner/vip/VipOverviewTab';
import { VipReservationsTab } from '@/components/owner/vip/VipReservationsTab';
import { ManualReservationDialog } from '@/components/owner/vip/ManualReservationDialog';
import { VipPlacementRequests } from '@/components/owner/vip/VipPlacementRequests';
import { VipFloorPlan } from '@/components/vip-host/VipFloorPlan';
import { OwnerTableDetailSheet } from '@/components/owner/vip/OwnerTableDetailSheet';
import { PlacementFloorPlanSheet } from '@/components/owner/vip/PlacementFloorPlanSheet';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { useAuth } from '@/hooks/useAuth';
import { useOrganizerVipData } from '@/hooks/useOrganizerVipData';
import type { OwnerVipReservation, OwnerVipConsumption } from '@/hooks/useOwnerVipData';
import type { VenueFloorPlan, VipReservation, VipConsumption } from '@/types';
import type { Tables } from '@/integrations/supabase/types';
import { supabase } from '@/integrations/supabase/client';
import { Crown, MapPin, LayoutGrid, Plus, BarChart3, ChevronRight, Loader2, FileDown, type LucideIcon } from 'lucide-react';
import { RosterExportDialog } from '@/components/roster/RosterExportDialog';
import { buildTableRoster } from '@/lib/rosterBuilders';
import { VipCard, VipButton, VipEmpty } from '@/components/owner/vip/vip-ui';
import { OrgPage, OrgPageHeader, RED, T1, T3, BORDER } from '@/components/org-ui';

interface TableZone { id: string; name: string; color: string }

type VipTab = 'overview' | 'reservations' | 'placement';

/**
 * Service VIP de l'organisateur (/organizer-app/vip-service) : la soirée en
 * cours vue table par table — réservations, placement des clients sur le plan,
 * arrivées, réservations manuelles à la porte. Même outil que le club
 * (/owner/vip-service), scopé sur les soirées de l'organisateur. La
 * CONFIGURATION (zones, packs, plan) vit sur /organizer-app/tables.
 */
export default function OrgAppVipService() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const { loading, events, reservations, consumptions, orders, refresh } = useOrganizerVipData(user?.id);

  const [activeTab, setActiveTab] = useState<VipTab>('overview');
  const [selectedEventId, setSelectedEventId] = useState<string>(searchParams.get('event') || 'all');
  const [showManualRes, setShowManualRes] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [zones, setZones] = useState<TableZone[]>([]);
  const [floorPlan, setFloorPlan] = useState<VenueFloorPlan | null>(null);
  const [selectedTableReservation, setSelectedTableReservation] = useState<OwnerVipReservation | null>(null);
  const [modifyingReservation, setModifyingReservation] = useState<OwnerVipReservation | null>(null);

  // Sélection par défaut : la prochaine soirée (ou celle en cours).
  useEffect(() => {
    if (events.length > 0 && selectedEventId === 'all') {
      const now = new Date();
      const active = [...events].reverse().find(e => new Date(e.endAt) >= now);
      if (active) setSelectedEventId(active.id);
    }
  }, [events]); // eslint-disable-line react-hooks/exhaustive-deps

  // Zones + plan de la soirée sélectionnée — tout est event-scopé côté orga.
  useEffect(() => {
    if (!selectedEventId || selectedEventId === 'all') { setZones([]); setFloorPlan(null); return; }
    let cancelled = false;
    (async () => {
      const [{ data: zs }, { data: fp }] = await Promise.all([
        supabase.from('table_zones').select('id, name, color').eq('event_id', selectedEventId).order('name'),
        supabase.from('venue_floor_plans').select('*').eq('event_id', selectedEventId).maybeSingle(),
      ]);
      if (cancelled) return;
      setZones(zs || []);
      const row = fp as Tables<'venue_floor_plans'> | null;
      setFloorPlan(row ? {
        id: row.id,
        venueId: row.venue_id ?? '',
        backgroundImageUrl: row.background_image_url,
        layout: row.layout as unknown as VenueFloorPlan['layout'],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      } : null);
    })();
    return () => { cancelled = true; };
  }, [selectedEventId]);

  const filteredReservations = useMemo(
    () => (selectedEventId === 'all' ? reservations : reservations.filter(r => r.eventId === selectedEventId)),
    [reservations, selectedEventId],
  );

  const placementRequests = useMemo(() => filteredReservations
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
      requestedTableName: floorPlan?.layout?.tables?.find(tb => tb.id === r.requestedTableId)?.name,
      placementStatus: r.placementStatus || 'requested',
      totalPrice: r.totalPrice,
      deposit: r.deposit,
      createdAt: r.createdAt,
    })), [filteredReservations, floorPlan]);

  const pendingPlacements = placementRequests.filter(r => r.placementStatus === 'requested').length;

  const filteredConsumptions = useMemo(() => {
    const ids = new Set(filteredReservations.map(r => r.id));
    return consumptions.filter(c => ids.has(c.reservationId));
  }, [consumptions, filteredReservations]);

  const consumptionsMap = useMemo(() => {
    const map = new Map<string, OwnerVipConsumption[]>();
    filteredConsumptions.forEach(c => map.set(c.reservationId, [...(map.get(c.reservationId) || []), c]));
    return map;
  }, [filteredConsumptions]);

  const filteredOrders = useMemo(() => {
    const ids = new Set(filteredReservations.map(r => r.id));
    return orders.filter(o => ids.has(o.reservationId));
  }, [orders, filteredReservations]);

  const preorderReservationIds = useMemo(() => {
    const set = new Set<string>();
    filteredOrders.forEach(o => {
      const n = (o.notes || '').toLowerCase();
      if (n.includes('pré-commande') || n.includes('pre-order') || n.includes('preorder')) set.add(o.reservationId);
    });
    return set;
  }, [filteredOrders]);

  const tabs: { id: VipTab; label: string; icon: LucideIcon; badge?: number }[] = [
    { id: 'overview', label: tt("Vue d'ensemble", 'Overview', 'Resumen'), icon: BarChart3 },
    { id: 'reservations', label: tt('Réservations', 'Reservations', 'Reservas'), icon: Crown },
    { id: 'placement', label: tt('Placement', 'Placement', 'Colocación'), icon: MapPin, badge: pendingPlacements },
  ];

  return (
    <>
      <OrgPageHeader
        title={tt('Service VIP', 'VIP Service', 'Servicio VIP')}
        subtitle={tt(
          'Vos tables soirée par soirée : réservations, placement sur le plan, arrivées.',
          'Your tables night by night: reservations, placement on the plan, arrivals.',
          'Tus mesas noche a noche: reservas, colocación en el plano, llegadas.',
        )}
        actions={
          <VipButton size="sm" variant="secondary" onClick={() => navigate(selectedEventId !== 'all' ? `/organizer-app/tables?event=${selectedEventId}` : '/organizer-app/tables')}>
            <LayoutGrid className="h-3.5 w-3.5" />
            {tt('Configurer les tables', 'Configure tables', 'Configurar mesas')}
            <ChevronRight className="h-3.5 w-3.5" />
          </VipButton>
        }
      />
      <OrgPage>
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} /></div>
        ) : events.length === 0 ? (
          <VipEmpty
            icon={Crown}
            title={tt('Aucune soirée avec tables activées', 'No event with tables enabled', 'Ninguna noche con mesas activadas')}
            description={tt('Activez les tables VIP sur une soirée depuis la page Tables VIP.', 'Enable VIP tables on an event from the VIP Tables page.', 'Activa las mesas VIP en una noche desde la página Mesas VIP.')}
            action={<VipButton variant="primary" onClick={() => navigate('/organizer-app/tables')}>{tt('Tables VIP', 'VIP Tables', 'Mesas VIP')}</VipButton>}
          />
        ) : (
          <div className="space-y-4">
            <VipEventSelector events={events} selectedEventId={selectedEventId} onSelect={setSelectedEventId} />

            <div className="flex gap-0.5 overflow-x-auto scrollbar-hide" style={{ borderBottom: `1px solid ${BORDER}` }}>
              {tabs.map(tab => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className="relative inline-flex items-center gap-2 px-4 py-3 text-[13.5px] font-[560] transition-colors duration-150 cursor-pointer flex-none"
                    style={{ color: isActive ? T1 : T3, background: 'transparent', border: 'none' }}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                    {tab.badge ? (
                      <span className="inline-flex items-center justify-center tabular-nums"
                        style={{ minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999, background: RED, color: '#fff', fontSize: 9, fontWeight: 700 }}>
                        {tab.badge}
                      </span>
                    ) : null}
                    {isActive && (
                      <span className="absolute left-3 right-3 rounded-full" style={{ bottom: -1, height: 2, background: RED, boxShadow: '0 0 10px rgba(232,25,44,0.6)' }} />
                    )}
                  </button>
                );
              })}
            </div>

            {activeTab === 'overview' && (
              <VipOverviewTab reservations={filteredReservations} consumptions={filteredConsumptions} orders={filteredOrders} />
            )}

            {activeTab === 'reservations' && (
              <div className="space-y-3">
                <div className="flex flex-wrap justify-end gap-2">
                  {/* Liste des tables pour le club (PDF de porte, détail complet, tableur Excel) :
                      c'est ce que l'organisateur transmet quand le lieu prépare sa salle lui-même. */}
                  <VipButton size="sm" variant="secondary" disabled={selectedEventId === 'all'} onClick={() => setExportOpen(true)}>
                    <FileDown className="h-3.5 w-3.5" />
                    {tt('Exporter la liste', 'Export list', 'Exportar lista')}
                  </VipButton>
                  <VipButton size="sm" variant="primary" disabled={selectedEventId === 'all' || zones.length === 0} onClick={() => setShowManualRes(true)}>
                    <Plus className="h-3.5 w-3.5" />
                    {tt('Réservation manuelle', 'Manual reservation', 'Reserva manual')}
                  </VipButton>
                </div>
                <VipReservationsTab
                  reservations={filteredReservations}
                  consumptions={filteredConsumptions}
                  orders={filteredOrders}
                  events={events}
                  selectedEventId={selectedEventId}
                />
              </div>
            )}

            {activeTab === 'placement' && (
              <div className="space-y-4">
                {floorPlan && (floorPlan.layout?.tables?.length ?? 0) > 0 ? (
                  <VipCard
                    icon={<LayoutGrid className="w-4 h-4" />}
                    title={tt('Plan en direct', 'Live floor plan', 'Plano en directo')}
                    sub={tt('Touchez une table occupée pour voir la réservation.', 'Tap an occupied table to see its reservation.', 'Toca una mesa ocupada para ver la reserva.')}
                  >
                    <VipFloorPlan
                      floorPlan={floorPlan}
                      reservations={filteredReservations as unknown as VipReservation[]}
                      consumptions={consumptionsMap as unknown as Map<string, VipConsumption[]>}
                      mode="view"
                      preorderReservationIds={preorderReservationIds}
                      selectedTableId={selectedTableReservation?.assignedTableId}
                      onTableSelect={(tableId) => {
                        const res = filteredReservations.find(r => r.assignedTableId === tableId);
                        if (res) setSelectedTableReservation(res);
                      }}
                    />
                  </VipCard>
                ) : (
                  <VipCard>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p style={{ color: T3, fontSize: 12.5 }}>
                        {selectedEventId === 'all'
                          ? tt('Choisissez une soirée pour voir son plan.', 'Pick an event to see its plan.', 'Elige una noche para ver su plano.')
                          : tt('Cette soirée n’a pas encore de plan interactif.', 'This event has no interactive plan yet.', 'Esta noche aún no tiene plano interactivo.')}
                      </p>
                      {selectedEventId !== 'all' && (
                        <VipButton size="sm" variant="secondary" onClick={() => navigate(`/organizer-app/tables?event=${selectedEventId}`)}>
                          {tt('Construire le plan', 'Build the plan', 'Construir el plano')} <ChevronRight className="h-3.5 w-3.5" />
                        </VipButton>
                      )}
                    </div>
                  </VipCard>
                )}

                <VipPlacementRequests
                  requests={placementRequests}
                  onRefresh={refresh}
                  floorPlan={floorPlan}
                  reservations={filteredReservations as unknown as VipReservation[]}
                />
              </div>
            )}
          </div>
        )}

        <OwnerTableDetailSheet
          reservation={selectedTableReservation}
          consumptions={selectedTableReservation ? filteredConsumptions.filter(c => c.reservationId === selectedTableReservation.id) : []}
          orders={selectedTableReservation ? filteredOrders.filter(o => o.reservationId === selectedTableReservation.id) : []}
          open={!!selectedTableReservation}
          onClose={() => setSelectedTableReservation(null)}
          onModifyPlacement={(res) => setModifyingReservation(res)}
          onChanged={() => { refresh(); setSelectedTableReservation(null); }}
          tableName={selectedTableReservation?.assignedTableId
            ? floorPlan?.layout?.tables?.find(tb => tb.id === selectedTableReservation.assignedTableId)?.name
            : undefined}
        />

        <PlacementFloorPlanSheet
          open={!!modifyingReservation}
          onClose={() => setModifyingReservation(null)}
          reservation={modifyingReservation ? {
            id: modifyingReservation.id,
            fullName: modifyingReservation.fullName,
            guestCount: modifyingReservation.guestCount,
            zoneName: modifyingReservation.zoneName,
            requestedTableId: modifyingReservation.requestedTableId || modifyingReservation.assignedTableId,
            requestedTableName: floorPlan?.layout?.tables?.find(tb => tb.id === (modifyingReservation.requestedTableId || modifyingReservation.assignedTableId))?.name,
          } : null}
          floorPlan={floorPlan}
          reservations={filteredReservations as unknown as VipReservation[]}
          onRefresh={refresh}
        />

        {exportOpen && selectedEventId !== 'all' && (() => {
          const ev = events.find(e => e.id === selectedEventId);
          if (!ev) return null;
          return (
            <RosterExportDialog
              open
              onClose={() => setExportOpen(false)}
              title={tt('Exporter les tables VIP', 'Export VIP tables', 'Exportar mesas VIP')}
              build={() => buildTableRoster(
                { id: ev.id, title: ev.title, start_at: ev.startAt, timezone: ev.timezone, venueName: ev.locationName ?? null },
                language,
                null,
              )}
            />
          );
        })()}

        <ManualReservationDialog
          open={showManualRes}
          events={events.filter(e => e.id === selectedEventId)}
          zones={zones}
          defaultEventId={selectedEventId}
          onCreated={refresh}
          onClose={() => setShowManualRes(false)}
        />
      </OrgPage>
    </>
  );
}
