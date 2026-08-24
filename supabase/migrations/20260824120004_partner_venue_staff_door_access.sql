-- Porte d'une co-soirée org-led : donner au STAFF du club partenaire l'accès
-- aux billets qu'il doit scanner.
--
-- Cas concret, celui du 11/09 : une soirée portée par un organisateur a
-- `events.venue_id = NULL` et le club en `partner_venue_id`. Or toutes les
-- policies « porte » de `tickets` et `ticket_attendees` comparent
-- `profiles.venue_id` à `events.venue_id` — donc NULL, donc faux. Le club
-- partenaire a bien une policy, mais elle vise `is_event_partner_venue_owner`,
-- c'est-à-dire **le patron seul**.
--
-- Conséquence : le videur du club, sur la soirée de son propre club, scanne un
-- QR parfaitement valide et lit « billet introuvable ». `.maybeSingle()` renvoie
-- zéro ligne sans erreur, donc rien ne trahit un problème de droits — ni dans
-- l'app, ni dans les logs. Le même trou fait échouer la recherche par nom
-- (le manifeste liste les gens, la relecture RLS ne les retrouve pas).
--
-- `ticket_attendees` n'avait AUCUNE policy club partenaire, même pour l'owner :
-- les billets nominatifs étaient donc illisibles côté partenaire quel que soit
-- le rôle.
--
-- On ajoute le strict nécessaire : le staff de porte (et le manager) du club
-- partenaire peut LIRE et MARQUER L'ENTRÉE. Aucun accès à l'argent, aucune
-- annulation, aucun remboursement — un videur ne fait qu'ouvrir la porte.

CREATE OR REPLACE FUNCTION public.is_event_partner_venue_staff(_user_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.events e
      JOIN public.profiles p ON p.id = _user_id
      JOIN public.user_roles ur ON ur.user_id = p.id
     WHERE e.id = _event_id
       AND e.partner_venue_id IS NOT NULL
       AND p.venue_id = e.partner_venue_id
       AND ur.role IN ('bouncer', 'vip_host', 'manager')
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_event_partner_venue_staff(uuid, uuid) TO authenticated;

-- ── tickets ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Partner venue staff can view event tickets" ON public.tickets;
CREATE POLICY "Partner venue staff can view event tickets"
  ON public.tickets FOR SELECT TO authenticated
  USING (public.is_event_partner_venue_staff(auth.uid(), event_id));

DROP POLICY IF EXISTS "Partner venue staff can scan event tickets" ON public.tickets;
CREATE POLICY "Partner venue staff can scan event tickets"
  ON public.tickets FOR UPDATE TO authenticated
  USING (public.is_event_partner_venue_staff(auth.uid(), event_id))
  WITH CHECK (public.is_event_partner_venue_staff(auth.uid(), event_id));

-- ── ticket_attendees ─────────────────────────────────────────────────────────
-- Le lien vers l'événement passe par le billet parent.
DROP POLICY IF EXISTS "Partner venue staff can view event ticket attendees" ON public.ticket_attendees;
CREATE POLICY "Partner venue staff can view event ticket attendees"
  ON public.ticket_attendees FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tickets t
     WHERE t.id = ticket_attendees.ticket_id
       AND public.is_event_partner_venue_staff(auth.uid(), t.event_id)
  ));

DROP POLICY IF EXISTS "Partner venue staff can scan event ticket attendees" ON public.ticket_attendees;
CREATE POLICY "Partner venue staff can scan event ticket attendees"
  ON public.ticket_attendees FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tickets t
     WHERE t.id = ticket_attendees.ticket_id
       AND public.is_event_partner_venue_staff(auth.uid(), t.event_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tickets t
     WHERE t.id = ticket_attendees.ticket_id
       AND public.is_event_partner_venue_staff(auth.uid(), t.event_id)
  ));

-- Le patron du club partenaire n'avait pas non plus de vue sur les porteurs
-- nominatifs (aucune policy partenaire sur cette table).
DROP POLICY IF EXISTS "Partner venue owner can view event ticket attendees" ON public.ticket_attendees;
CREATE POLICY "Partner venue owner can view event ticket attendees"
  ON public.ticket_attendees FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tickets t
     WHERE t.id = ticket_attendees.ticket_id
       AND public.is_event_partner_venue_owner(auth.uid(), t.event_id)
  ));

-- ── guest_list_entries ───────────────────────────────────────────────────────
-- Une part guest list d'une soirée org-led porte souvent `venue_id NULL` (elle
-- appartient à l'organisateur) : même angle mort pour le staff de porte.
DROP POLICY IF EXISTS "Partner venue staff can view co-event guest entries" ON public.guest_list_entries;
CREATE POLICY "Partner venue staff can view co-event guest entries"
  ON public.guest_list_entries FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.guest_lists gl
     WHERE gl.id = guest_list_entries.guest_list_id
       AND public.is_event_partner_venue_staff(auth.uid(), gl.event_id)
  ));

DROP POLICY IF EXISTS "Partner venue staff can scan co-event guest entries" ON public.guest_list_entries;
CREATE POLICY "Partner venue staff can scan co-event guest entries"
  ON public.guest_list_entries FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.guest_lists gl
     WHERE gl.id = guest_list_entries.guest_list_id
       AND public.is_event_partner_venue_staff(auth.uid(), gl.event_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.guest_lists gl
     WHERE gl.id = guest_list_entries.guest_list_id
       AND public.is_event_partner_venue_staff(auth.uid(), gl.event_id)
  ));

-- ── table_reservations ───────────────────────────────────────────────────────
-- Même raisonnement pour l'accueil des tables VIP à la porte.
DROP POLICY IF EXISTS "Partner venue staff can view co-event reservations" ON public.table_reservations;
CREATE POLICY "Partner venue staff can view co-event reservations"
  ON public.table_reservations FOR SELECT TO authenticated
  USING (public.is_event_partner_venue_staff(auth.uid(), event_id));

DROP POLICY IF EXISTS "Partner venue staff can scan co-event reservations" ON public.table_reservations;
CREATE POLICY "Partner venue staff can scan co-event reservations"
  ON public.table_reservations FOR UPDATE TO authenticated
  USING (public.is_event_partner_venue_staff(auth.uid(), event_id))
  WITH CHECK (public.is_event_partner_venue_staff(auth.uid(), event_id));
