import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { Eye, Crown, Loader2 } from 'lucide-react';
import { ServiceFloorPlan } from '@/components/vip-service/ServiceFloorPlan';
import type { ServiceReservation, TableServiceInfo } from '@/components/vip-service/serviceTypes';
import { OwnerVipOrders } from '@/components/owner/OwnerVipOrders';
import { CollabOperationsPreview } from './CollabOperationsPreview';
import type { VenueFloorPlan, VipReservation } from '@/types';

const T1 = 'rgba(255,255,255,0.96)';
const T3 = 'rgba(255,255,255,0.36)';

type ResaRow = {
  id: string;
  zone_id: string | null;
  event_id: string;
  user_email: string | null;
  full_name: string | null;
  guest_count: number | null;
  deposit: number | null;
  total_price: number | null;
  minimum_spend: number | null;
  status: string;
  vip_status: string | null;
  paid_at: string | null;
  placed_at: string | null;
  assigned_table_id: string | null;
  requested_table_id: string | null;
  placement_status: string | null;
  created_at: string;
  checked_in_at: string | null;
};

/**
 * Aperçu LECTURE SEULE des tables VIP, pour la partie qui ne tient pas
 * l'opérationnel. Montre EXACTEMENT ce que voit / gère le club :
 *
 *  - plan de salle interactif (élite) quand le club en a publié un. Le plan est
 *    VENUE-scopé (event_id NULL, ouvert par `venues.vip_placement_enabled`), pas
 *    event-scopé : on réplique le fallback event→venue de la réservation cliente,
 *    sinon le plan du club reste invisible et l'aperçu dit « aucune table » à tort.
 *  - sur ce plan, l'état RÉEL de chaque table : réservée/demandée, et le PRÉNOM
 *    de la personne placée (via ServiceFloorPlan en lecture seule).
 *  - sinon (mode basic), la liste des packs via CollabOperationsPreview.
 *
 * Puis, en dessous, la liste des réservations VIP. Aucune écriture : on ne fait
 * que lire `table_reservations`, `venue_floor_plans` et `venues`, tout ce que le
 * partenaire organisateur a déjà le droit de lire (policies partner organizer /
 * vip_placement_enabled).
 */
export function CollabTablesPreview({
  eventId,
  showChrome = true,
  showReservations = true,
}: {
  eventId: string;
  /** Bandeau « Aperçu — lecture seule ». Coupé quand un dialogue l'affiche déjà. */
  showChrome?: boolean;
  /** Liste des réservations VIP sous le plan. */
  showReservations?: boolean;
}) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [floorPlan, setFloorPlan] = useState<VenueFloorPlan | null>(null);
  const [placementEnabled, setPlacementEnabled] = useState(false);
  const [mode, setMode] = useState<string | null>(null);
  const [reservations, setReservations] = useState<ServiceReservation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data: ev } = await supabase
        .from('events')
        .select('venue_id, partner_venue_id, tables_mode')
        .eq('id', eventId)
        .maybeSingle();
      const effVenueId = ev?.venue_id ?? ev?.partner_venue_id ?? null;

      // Plan : event-scopé d'abord, puis venue-scopé (event_id NULL) — même
      // résolution que la réservation cliente.
      const { data: fpEvent } = await supabase
        .from('venue_floor_plans')
        .select('id, venue_id, layout, background_image_url')
        .eq('event_id', eventId)
        .maybeSingle();
      let fp = fpEvent;
      if (!fp && effVenueId) {
        const { data: fpVenue } = await supabase
          .from('venue_floor_plans')
          .select('id, venue_id, layout, background_image_url')
          .eq('venue_id', effVenueId)
          .is('event_id', null)
          .maybeSingle();
        fp = fpVenue ?? null;
      }

      // Le placement interactif est porté par le club (venue), pas par l'event.
      let placement = false;
      if (effVenueId) {
        const { data: v } = await supabase.from('venues').select('vip_placement_enabled').eq('id', effVenueId).maybeSingle();
        placement = !!(v as { vip_placement_enabled?: boolean } | null)?.vip_placement_enabled;
      }

      // Réservations actives → placements sur le plan (prénom + état de table).
      const { data: resa } = await supabase
        .from('table_reservations')
        .select('id, zone_id, event_id, user_email, full_name, guest_count, deposit, total_price, minimum_spend, status, vip_status, paid_at, placed_at, assigned_table_id, requested_table_id, placement_status, created_at, checked_in_at')
        .eq('event_id', eventId)
        .in('status', ['pending', 'paid', 'confirmed']);

      if (!active) return;
      setMode((ev as { tables_mode?: string | null } | null)?.tables_mode ?? null);
      setPlacementEnabled(placement);
      setFloorPlan(fp ? {
        id: fp.id,
        venueId: (fp as { venue_id?: string }).venue_id ?? '',
        backgroundImageUrl: fp.background_image_url ?? null,
        layout: (fp.layout ?? { tables: [] }) as VenueFloorPlan['layout'],
        createdAt: '', updatedAt: '',
      } : null);
      setReservations(((resa as ResaRow[] | null) ?? []).map((r): ServiceReservation => ({
        id: r.id,
        zoneId: r.zone_id ?? '',
        eventId: r.event_id,
        userEmail: r.user_email ?? '',
        fullName: r.full_name || r.user_email?.split('@')[0] || tt('Invité', 'Guest', 'Invitado'),
        guestCount: r.guest_count ?? 0,
        deposit: r.deposit ?? 0,
        totalPrice: r.total_price ?? 0,
        minimumSpend: r.minimum_spend ?? 0,
        status: r.status,
        vipStatus: (r.vip_status || 'waiting') as VipReservation['vipStatus'],
        paidAt: r.paid_at ?? undefined,
        placedAt: r.placed_at ?? undefined,
        assignedTableId: r.assigned_table_id ?? undefined,
        createdAt: r.created_at,
        checkedInAt: r.checked_in_at ?? undefined,
        hasArrived: r.checked_in_at !== null || ['placed', 'active', 'finished'].includes(r.vip_status || ''),
        placementStatus: r.placement_status || 'none',
        requestedTableId: r.requested_table_id,
      })));
      setLoading(false);
    })();
    return () => { active = false; };
  }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sans données de service (conso/commandes) : les tables placées s'affichent en
  // vert avec le prénom, les tables demandées en rouge pointillé, le reste libre.
  const emptyServiceInfo = useMemo(() => new Map<string, TableServiceInfo>(), []);
  const hasInteractive = (floorPlan?.layout?.tables?.length ?? 0) > 0 && placementEnabled && mode !== 'basic';

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: T3 }} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showChrome && (
        <div className="flex items-center gap-1.5" style={{ color: T3, fontSize: 11 }}>
          <Eye className="h-3.5 w-3.5" />
          {tt('Aperçu — lecture seule', 'Preview — read only', 'Vista previa — solo lectura')}
        </div>
      )}

      {hasInteractive && floorPlan ? (
        <>
          <ServiceFloorPlan
            floorPlan={floorPlan}
            reservations={reservations}
            serviceInfo={emptyServiceInfo}
            mode="live"
            readOnly
            onTableTap={() => {}}
          />
          <p style={{ color: T3, fontSize: 11, lineHeight: 1.45 }}>
            {tt(
              'Plan interactif du club — état en direct : tables réservées ou demandées, et le prénom des personnes placées. Vous ne pouvez pas le modifier.',
              'Club interactive plan — live state: reserved or requested tables, and the first name of seated guests. You cannot edit it.',
              'Plano interactivo del club — estado en vivo: mesas reservadas o solicitadas y el nombre de las personas sentadas. No puedes editarlo.',
            )}
          </p>
        </>
      ) : (
        // Pas de plan interactif publié → mode basic : liste des packs.
        <CollabOperationsPreview eventId={eventId} kind="tables" showChrome={false} />
      )}

      {showReservations && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>
            <Crown className="h-4 w-4" style={{ color: T3 }} />
            {tt('Réservations VIP', 'VIP reservations', 'Reservas VIP')}
          </h3>
          {/* eventIds = périmètre organisateur (lecture) — jamais les actions club. */}
          <OwnerVipOrders eventIds={[eventId]} />
        </div>
      )}
    </div>
  );
}

export default CollabTablesPreview;
