-- ============================================================================
-- P0-4 — RLS des inscriptions guest list pour les partenaires d'un co-event.
--
-- ÉTAT : guest_lists.SELECT = USING(true) (tout le monde lit la fiche liste), donc
-- le partenaire VOIT déjà l'existence de la liste. Le trou réel est sur
-- guest_list_entries (les invités réels) : la policy SELECT/UPDATE ne couvre que
-- l'owner du club / can_manage_venue / venue_staff. Un organisateur partenaire
-- (ou un club partenaire) ne voit donc PAS les inscrits de SA soirée co-organisée,
-- ni ne peut les scanner à l'entrée.
--
-- FIX : ajouter l'accès partenaire (lecture + scan) via le helper sur l'event_id
-- de la liste parente, exactement comme tickets / table_reservations
-- (cf. 20260421103841). Le partenaire org-led a déjà « Organizers manage own guest
-- lists » côté config ; ici on ouvre la LECTURE/SCAN cross-partie sur les entries.
-- ============================================================================

-- LECTURE — partner venue owner
DROP POLICY IF EXISTS "Partner venue can view co-event guest entries" ON public.guest_list_entries;
CREATE POLICY "Partner venue can view co-event guest entries"
ON public.guest_list_entries FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.guest_lists gl
    WHERE gl.id = guest_list_entries.guest_list_id
      AND gl.event_id IS NOT NULL
      AND public.is_event_partner_venue_owner(auth.uid(), gl.event_id)
  )
);

-- LECTURE — partner organizer
DROP POLICY IF EXISTS "Partner organizer can view co-event guest entries" ON public.guest_list_entries;
CREATE POLICY "Partner organizer can view co-event guest entries"
ON public.guest_list_entries FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.guest_lists gl
    WHERE gl.id = guest_list_entries.guest_list_id
      AND gl.event_id IS NOT NULL
      AND public.is_event_partner_organizer(auth.uid(), gl.event_id)
  )
);

-- SCAN (UPDATE) — partner venue owner
DROP POLICY IF EXISTS "Partner venue can scan co-event guest entries" ON public.guest_list_entries;
CREATE POLICY "Partner venue can scan co-event guest entries"
ON public.guest_list_entries FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.guest_lists gl
    WHERE gl.id = guest_list_entries.guest_list_id
      AND gl.event_id IS NOT NULL
      AND public.is_event_partner_venue_owner(auth.uid(), gl.event_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.guest_lists gl
    WHERE gl.id = guest_list_entries.guest_list_id
      AND gl.event_id IS NOT NULL
      AND public.is_event_partner_venue_owner(auth.uid(), gl.event_id)
  )
);

-- SCAN (UPDATE) — partner organizer
DROP POLICY IF EXISTS "Partner organizer can scan co-event guest entries" ON public.guest_list_entries;
CREATE POLICY "Partner organizer can scan co-event guest entries"
ON public.guest_list_entries FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.guest_lists gl
    WHERE gl.id = guest_list_entries.guest_list_id
      AND gl.event_id IS NOT NULL
      AND public.is_event_partner_organizer(auth.uid(), gl.event_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.guest_lists gl
    WHERE gl.id = guest_list_entries.guest_list_id
      AND gl.event_id IS NOT NULL
      AND public.is_event_partner_organizer(auth.uid(), gl.event_id)
  )
);
