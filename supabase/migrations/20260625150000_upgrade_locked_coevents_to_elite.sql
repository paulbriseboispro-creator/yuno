-- =============================================================================
-- Rattrapage : les co-soirées verrouillées sur le plan du club qui ont un VRAI
-- plan interactif (layout.tables non vide) passent de 'basic' à 'elite'.
--
-- Contexte : ces co-soirées ont été activées via l'ancien RPC
-- enable_collab_basic_tables (avant la détection élite). Du coup elles affichent
-- le plan interactif du club comme une simple IMAGE (onglet Plan de salle basic)
-- et n'ont pas le suivi des réservations. Or la donnée interactive est bien là
-- (venue_floor_plans.layout.tables event-scopé). On les bascule en élite pour
-- que l'orga voie le plan interactif + les réservations et que le client puisse
-- choisir sa table.
--
-- Sûr : ciblé sur tables_locked_to_venue (marqueur co-soirée posé par nos RPC) +
-- présence d'un plan interactif. Le mode élite lit zones/packs venue du club pour
-- les prix (déjà en place). On (ré)active vip_placement_enabled sur ces clubs.
-- =============================================================================
UPDATE public.events e
   SET tables_mode = 'elite'
 WHERE e.tables_enabled = true
   AND e.tables_mode = 'basic'
   AND e.tables_locked_to_venue = true
   AND EXISTS (
     SELECT 1 FROM public.venue_floor_plans vfp
      WHERE vfp.event_id = e.id
        AND jsonb_array_length(coalesce(vfp.layout->'tables', '[]'::jsonb)) > 0
   );

-- Le placement interactif côté client doit être actif sur les venues hôtes de
-- ces co-soirées élite (l'ancien RPC basic ne le posait pas).
UPDATE public.venues v
   SET vip_placement_enabled = true
 WHERE v.vip_placement_enabled IS DISTINCT FROM true
   AND v.id IN (
     SELECT coalesce(e.venue_id, e.partner_venue_id)
       FROM public.events e
      WHERE e.tables_mode = 'elite' AND e.tables_locked_to_venue = true
   );
