-- ============================================================================
-- Scan promoteur : lui donner les droits RLS qu'il n'a JAMAIS eus.
--
-- Constat : aucune policy de public.tickets ne mentionne les promoteurs (les
-- rôles couverts sont client, owner, barman, videur, manager, super admin,
-- organisateur et partenaires de co-event). Sur guest_list_entries il existe
-- une policy de LECTURE promoteur mais aucune d'ÉCRITURE.
--
-- Conséquence à la porte, invisible pour le promoteur :
--   • billet : le SELECT par qr_code ne renvoie rien → « Billet invalide » sur
--     un billet parfaitement valide ;
--   • guest list : le SELECT passe, mais l'UPDATE est filtré → 0 ligne mise à
--     jour → le composant affiche « Déjà scanné » à un invité jamais scanné, et
--     la commission de la tête n'est jamais enregistrée ;
--   • le compteur « scannés » lit tickets → toujours 0.
--
-- On suit le motif du videur (policies dédiées + accès direct aux tables), pas
-- une RPC : c'est l'architecture de scan déjà en place dans ce projet.
--
-- Deux garde-fous sont portés par la policy elle-même, donc INCONTOURNABLES
-- (aujourd'hui la propriété du billet n'est vérifiée qu'en JavaScript, donc
-- contournable par un promoteur qui appelle l'API directement) :
--   1. le billet doit être attribué à CE promoteur (promoter_conversions) ;
--   2. le promoteur doit avoir can_scan_entries = true, donc l'interrupteur
--      « Scanner les entrées » de la fiche owner devient réellement appliqué.
-- ============================================================================

-- Le promoteur est-il autorisé à scanner, et ce billet est-il le sien ?
CREATE OR REPLACE FUNCTION public.promoter_owns_ticket(_user_id uuid, _ticket_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.promoter_conversions pc
    JOIN public.promoters p ON p.id = pc.promoter_id
    WHERE pc.ticket_id = _ticket_id
      AND pc.conversion_type = 'ticket'
      AND p.user_id = _user_id
      AND p.is_active
      AND p.can_scan_entries
  );
$$;

-- Idem pour une inscription guest list : la part appartient-elle à ce promoteur ?
CREATE OR REPLACE FUNCTION public.promoter_owns_guest_entry(_user_id uuid, _entry_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.guest_list_entries gle
    JOIN public.promoters p ON p.id = gle.promoter_id
    WHERE gle.id = _entry_id
      AND p.user_id = _user_id
      AND p.is_active
      AND p.can_scan_entries
  );
$$;

-- ── tickets : lecture + marquage d'entrée, limités aux billets du promoteur ──

DROP POLICY IF EXISTS "Promoters can view their own attributed tickets" ON public.tickets;
CREATE POLICY "Promoters can view their own attributed tickets"
ON public.tickets FOR SELECT
TO authenticated
USING (public.promoter_owns_ticket(auth.uid(), id));

DROP POLICY IF EXISTS "Promoters can scan their own attributed tickets" ON public.tickets;
CREATE POLICY "Promoters can scan their own attributed tickets"
ON public.tickets FOR UPDATE
TO authenticated
USING (public.promoter_owns_ticket(auth.uid(), id))
WITH CHECK (public.promoter_owns_ticket(auth.uid(), id));

-- ── ticket_attendees : même logique, via le billet parent ──

DROP POLICY IF EXISTS "Promoters can view attendees of their tickets" ON public.ticket_attendees;
CREATE POLICY "Promoters can view attendees of their tickets"
ON public.ticket_attendees FOR SELECT
TO authenticated
USING (public.promoter_owns_ticket(auth.uid(), ticket_id));

DROP POLICY IF EXISTS "Promoters can scan attendees of their tickets" ON public.ticket_attendees;
CREATE POLICY "Promoters can scan attendees of their tickets"
ON public.ticket_attendees FOR UPDATE
TO authenticated
USING (public.promoter_owns_ticket(auth.uid(), ticket_id))
WITH CHECK (public.promoter_owns_ticket(auth.uid(), ticket_id));

-- ── guest_list_entries : l'écriture manquait (la lecture existait déjà) ──

DROP POLICY IF EXISTS "Promoters can scan their own guest entries" ON public.guest_list_entries;
CREATE POLICY "Promoters can scan their own guest entries"
ON public.guest_list_entries FOR UPDATE
TO authenticated
USING (public.promoter_owns_guest_entry(auth.uid(), id))
WITH CHECK (public.promoter_owns_guest_entry(auth.uid(), id));

-- ── Rattrapage : ne pas retirer un droit que l'interface accordait déjà ──
-- Le dashboard promoteur affichait l'onglet Scan à TOUT LE MONDE (canScan
-- codé en dur à true), alors que la colonne vaut false par défaut. Maintenant
-- que la policy s'appuie sur ce drapeau, on l'active pour les promoteurs
-- existants : personne ne perd un accès qu'il croyait avoir. Les promoteurs
-- créés ensuite gardent le défaut false et l'owner les active explicitement.
UPDATE public.promoters
SET can_scan_entries = true
WHERE is_active
  AND can_scan_entries = false;
