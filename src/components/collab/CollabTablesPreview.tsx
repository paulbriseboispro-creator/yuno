import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { Eye, Crown, Loader2 } from 'lucide-react';
import { ClientFloorPlanPicker } from '@/components/vip/ClientFloorPlanPicker';
import { OwnerVipOrders } from '@/components/owner/OwnerVipOrders';
import { useTableAvailability } from '@/hooks/useTableAvailability';
import { CollabOperationsPreview } from './CollabOperationsPreview';
import type { VenueFloorPlan } from '@/types';

const T1 = 'rgba(255,255,255,0.96)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';

/**
 * Aperçu LECTURE SEULE des tables VIP, pour la partie qui ne tient pas
 * l'opérationnel. Montre EXACTEMENT ce que voit le client :
 *
 *  - plan de salle interactif (élite) quand le club en a publié un — le plan est
 *    VENUE-scopé (event_id NULL, ouvert par `venues.vip_placement_enabled`), pas
 *    event-scopé. On réplique donc le fallback event→venue de la réservation
 *    cliente (TableCheckout / useVipNight), sinon le plan du club reste invisible
 *    ici et l'aperçu affiche « aucune table » à tort.
 *  - sinon, la liste des packs (mode basic) via CollabOperationsPreview.
 *
 * Puis, en dessous, la liste des réservations VIP de la soirée. Aucune écriture :
 * OwnerVipOrders ne fait que lire, et le partenaire organisateur a bien le droit
 * SELECT sur le plan (policy vip_placement_enabled) comme sur les réservations
 * (policy partner organizer).
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
      setLoading(false);
    })();
    return () => { active = false; };
  }, [eventId]);

  const hasInteractive = (floorPlan?.layout?.tables?.length ?? 0) > 0 && placementEnabled && mode !== 'basic';
  // Hook inconditionnel : eventId seulement quand un plan interactif existe, sinon
  // undefined (le hook ne requête rien). React gère le changement d'argument.
  const { unavailableTableIds } = useTableAvailability(hasInteractive ? eventId : undefined);

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
          <div className="overflow-hidden rounded-xl" style={{ border: `1px solid ${BORDER}`, background: INNER_BG }}>
            <ClientFloorPlanPicker
              floorPlan={floorPlan}
              unavailableTableIds={unavailableTableIds}
              selectedTableId={null}
              onSelectTable={() => {}}
              onSkip={() => {}}
              readOnly
            />
          </div>
          <p style={{ color: T3, fontSize: 11, lineHeight: 1.45 }}>
            {tt(
              'Plan interactif du club. Les tables déjà réservées apparaissent indisponibles — vue identique à celle du client.',
              'Club interactive plan. Already-booked tables show as unavailable — same view your customers see.',
              'Plano interactivo del club. Las mesas ya reservadas aparecen no disponibles — la misma vista que ve tu cliente.',
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
