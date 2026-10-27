-- Porte : scanner un QR nominatif prenait ~1 s DANS la base (27/10, mesuré avant
-- House Of Masquerade) : 0,5 s pour PLANIFIER la requête, 0,5 s pour l'exécuter,
-- alors que les triggers du scan ne coûtent que 4 ms.
--
-- Cause : les 12 policies de `ticket_attendees` lisaient `tickets`, `events` et
-- `profiles` dans des sous-requêtes soumises à LEUR propre RLS — chaque policy
-- dépliait les dizaines de policies de `tickets` puis celles d'`events`. Une
-- lecture de 3 places par le videur coûtait 4 451 pages de cache ; le marquage
-- d'une place, une seconde.
--
-- Correctif : UNE porte de lecture et UNE porte d'écriture, chacune une
-- fonction SECURITY DEFINER qui évalue EXACTEMENT les conditions des anciennes
-- policies (reprises une par une ci-dessous), sans redéplier la RLS des tables
-- qu'elle consulte. Aucune condition n'est ajoutée ni retirée : chaque ancienne
-- policy était autosuffisante (elle nomme elle-même le lien qui donne l'accès :
-- acheteur, staff de porte, organisateur, club partenaire, promoteur, staff du
-- club), la RLS imbriquée n'ajoutait que du coût.
--
-- Équivalence vérifiée avant application, ligne par ligne, lecture ET écriture,
-- pour les 17 comptes qui ont un lien avec une place (staff de porte, acheteurs,
-- organisateurs, clubs, staff des clubs, promoteurs, équipes), dans une
-- transaction annulée : aucune différence.

CREATE OR REPLACE FUNCTION public.ticket_attendee_can_read(p_ticket_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
        FROM tickets t
        LEFT JOIN events e ON e.id = t.event_id
       WHERE t.id = p_ticket_id
         AND (
           -- « Users can view their own ticket attendees »
           t.user_id = auth.uid()
           -- « Organizers can view their event ticket attendees »
           OR (e.id IS NOT NULL AND (e.organizer_user_id = auth.uid() OR is_event_partner_organizer(auth.uid(), e.id)))
           -- « Staff can view venue ticket attendees » : la sous-requête de
           -- l'ancienne policy passait par la RLS de `tickets`, qui n'ouvre les
           -- billets d'un club qu'à ses videurs, barmans, owner et managers —
           -- jamais à l'hôte VIP ni au vestiaire. Même restriction, écrite ici.
           OR (e.id IS NOT NULL AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.venue_id = e.venue_id)
               AND (has_role(auth.uid(), 'bouncer') OR has_role(auth.uid(), 'barman')
                    OR has_role(auth.uid(), 'owner') OR has_role(auth.uid(), 'manager')))
           -- « Door staff can view organizer ticket attendees »
           OR is_event_door_staff(auth.uid(), t.event_id)
           -- « Partner venue owner can view event ticket attendees »
           OR is_event_partner_venue_owner(auth.uid(), t.event_id)
           -- « Partner venue staff can view event ticket attendees »
           OR is_event_partner_venue_staff(auth.uid(), t.event_id)
         )
    )
    -- « Promoters can view attendees of their tickets »
    OR promoter_owns_ticket(auth.uid(), p_ticket_id);
$$;

CREATE OR REPLACE FUNCTION public.ticket_attendee_can_write(p_ticket_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
        FROM tickets t
        LEFT JOIN events e ON e.id = t.event_id
       WHERE t.id = p_ticket_id
         AND (
           -- « Organizers can update their event ticket attendees »
           (e.id IS NOT NULL AND (e.organizer_user_id = auth.uid() OR is_event_partner_organizer(auth.uid(), e.id)))
           -- « Staff can update ticket attendees » (même restriction que la lecture)
           OR (e.id IS NOT NULL AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.venue_id = e.venue_id)
               AND (has_role(auth.uid(), 'bouncer') OR has_role(auth.uid(), 'barman')
                    OR has_role(auth.uid(), 'owner') OR has_role(auth.uid(), 'manager')))
           -- « Door staff can scan organizer ticket attendees »
           OR is_event_door_staff(auth.uid(), t.event_id)
           -- « Partner venue staff can scan event ticket attendees »
           OR is_event_partner_venue_staff(auth.uid(), t.event_id)
         )
    )
    -- « Promoters can scan attendees of their tickets »
    OR promoter_owns_ticket(auth.uid(), p_ticket_id);
$$;

REVOKE ALL ON FUNCTION public.ticket_attendee_can_read(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ticket_attendee_can_write(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ticket_attendee_can_read(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ticket_attendee_can_write(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Door staff can scan organizer ticket attendees" ON public.ticket_attendees;
DROP POLICY IF EXISTS "Door staff can view organizer ticket attendees" ON public.ticket_attendees;
DROP POLICY IF EXISTS "Organizers can update their event ticket attendees" ON public.ticket_attendees;
DROP POLICY IF EXISTS "Organizers can view their event ticket attendees" ON public.ticket_attendees;
DROP POLICY IF EXISTS "Partner venue owner can view event ticket attendees" ON public.ticket_attendees;
DROP POLICY IF EXISTS "Partner venue staff can scan event ticket attendees" ON public.ticket_attendees;
DROP POLICY IF EXISTS "Partner venue staff can view event ticket attendees" ON public.ticket_attendees;
DROP POLICY IF EXISTS "Promoters can scan attendees of their tickets" ON public.ticket_attendees;
DROP POLICY IF EXISTS "Promoters can view attendees of their tickets" ON public.ticket_attendees;
DROP POLICY IF EXISTS "Staff can update ticket attendees" ON public.ticket_attendees;
DROP POLICY IF EXISTS "Staff can view venue ticket attendees" ON public.ticket_attendees;
DROP POLICY IF EXISTS "Users can view their own ticket attendees" ON public.ticket_attendees;
-- « Service role can insert attendees » reste tel quel.

CREATE POLICY "Ticket attendees: read" ON public.ticket_attendees
  FOR SELECT TO authenticated
  USING (public.ticket_attendee_can_read(ticket_id));

CREATE POLICY "Ticket attendees: scan" ON public.ticket_attendees
  FOR UPDATE TO authenticated
  USING (public.ticket_attendee_can_write(ticket_id))
  WITH CHECK (public.ticket_attendee_can_write(ticket_id));
