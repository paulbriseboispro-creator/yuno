-- ════════════════════════════════════════════════════════════════════════════
-- Vestiaire — plusieurs préposés, une seule vérité (2026-09-29)
--
-- Avant : le téléphone insérait et modifiait lui-même cloakroom_transactions,
-- sans aucune contrainte en base.
--   • Deux téléphones pouvaient donner le MÊME numéro de cintre à deux clients.
--   • Le même QR pouvait être déposé deux fois (double tap, renvoi après une
--     réponse perdue, deux scans simultanés) — et ce client devenait alors
--     impossible à restituer par scan (maybeSingle sur 2 lignes).
--   • Une restitution faite sur un autre téléphone s'affichait « réussie ».
--   • Une option vestiaire prépayée pouvait servir deux fois.
--   • Qui a déposé / rendu, le prix, le paiement : écrits par le téléphone.
--   • Le vestiaire d'une soirée d'ORGANISATEUR n'existait pas : un préposé
--     invité par l'organisateur (sans club) tombait sur une page morte, et
--     l'onglet Vestiaire du check-in orga ne pouvait rien lire.
--
-- Après : la SOIRÉE est la portée (venue_id devient facultatif : une soirée
-- sans club n'en a pas) ; deux index uniques (numéro et QR, tant que le
-- vêtement n'est pas rendu) ; une recherche de QR côté serveur
-- (cloakroom_lookup, une requête au lieu de cinq, lisible par un préposé qui
-- n'a pas accès aux billets) ; deux RPC atomiques et idempotentes
-- (cloakroom_deposit, cloakroom_retrieve) qui signent l'acte et calculent le
-- prix ; un prix de vestiaire pour l'organisateur ; une garde qui empêche un
-- client de réécrire le reste.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.cloakroom_transactions ALTER COLUMN venue_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cloakroom_open_number
  ON public.cloakroom_transactions (event_id, upper(btrim(cloakroom_number)))
  WHERE NOT retrieved;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cloakroom_open_qr
  ON public.cloakroom_transactions (event_id, attendee_qr)
  WHERE NOT retrieved AND attendee_qr IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cloakroom_event_open
  ON public.cloakroom_transactions (event_id, retrieved);

-- Prix du vestiaire d'un organisateur (soirées sans club).
ALTER TABLE public.organizer_profiles ADD COLUMN IF NOT EXISTS cloakroom_price numeric(8,2);
GRANT SELECT (cloakroom_price) ON public.organizer_profiles TO authenticated;

-- Qui peut tenir le vestiaire d'un club.
CREATE OR REPLACE FUNCTION public.can_run_cloakroom(p_uid uuid, p_venue text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p_uid IS NOT NULL AND p_venue IS NOT NULL AND (
    public.is_super_admin()
    OR public.is_venue_owner(p_uid, p_venue)
    OR public.can_manage_venue(p_uid, p_venue)
    OR public.is_venue_staff(p_uid, p_venue)
  )
$function$;

-- Qui peut tenir le vestiaire d'une SOIRÉE : le staff du club qui l'accueille
-- (lead ou partenaire), l'organisateur, son équipe (admin / éditeur), son
-- staff de terrain (vestiaire, porte), les co-hôtes qui tiennent la porte.
CREATE OR REPLACE FUNCTION public.can_run_event_cloakroom(p_uid uuid, p_event uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p_uid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id = p_event
       AND (
         public.is_super_admin()
         OR (e.venue_id IS NOT NULL AND public.can_run_cloakroom(p_uid, e.venue_id))
         OR (e.partner_venue_id IS NOT NULL AND public.can_run_cloakroom(p_uid, e.partner_venue_id))
         OR p_uid IN (e.organizer_user_id, e.partner_organizer_id)
         OR EXISTS (SELECT 1 FROM public.org_staff os
                     WHERE os.organizer_user_id IN (e.organizer_user_id, e.partner_organizer_id)
                       AND os.user_id = p_uid AND os.invitation_status = 'accepted'
                       AND os.role IN ('cloakroom', 'bouncer'))
         OR EXISTS (SELECT 1 FROM public.org_members om
                     WHERE om.organizer_user_id IN (e.organizer_user_id, e.partner_organizer_id)
                       AND om.member_user_id = p_uid AND om.invitation_status = 'accepted'
                       AND om.role IN ('admin', 'editor'))
         OR public.is_event_door_staff(p_uid, e.id)
       )
  )
$function$;

-- Prix d'un emplacement pour une soirée : celui du club qui l'accueille,
-- sinon celui de l'organisateur, sinon 4 €. 0 € = vestiaire gratuit.
CREATE OR REPLACE FUNCTION public.cloakroom_event_price(p_event uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT v.cloakroom_price FROM public.events e JOIN public.venues v ON v.id = COALESCE(e.venue_id, e.partner_venue_id)
      WHERE e.id = p_event),
    (SELECT op.cloakroom_price FROM public.events e JOIN public.organizer_profiles op ON op.user_id = e.organizer_user_id
      WHERE e.id = p_event),
    4)
$function$;

-- L'organisateur règle le prix de son vestiaire (soirées sans club).
CREATE OR REPLACE FUNCTION public.set_organizer_cloakroom_price(p_price numeric)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_price IS NULL OR p_price < 0 OR p_price > 100 THEN
    RETURN false;
  END IF;
  UPDATE public.organizer_profiles SET cloakroom_price = round(p_price, 2) WHERE user_id = auth.uid();
  RETURN FOUND;
END;
$function$;

-- Qui porte ce QR ce soir ? Une requête au lieu de cinq, et lisible par un
-- préposé qui n'a pas le droit de lire les billets. Rend :
--   {ok:true, mode:'retrieve', tx:{…}}                         dépôt ouvert
--   {ok:true, mode:'deposit', name, ticket_id, prepaid:{id,unit_price}|null}
--   {ok:false, reason: unknown | other_night | not_valid | forbidden}
CREATE OR REPLACE FUNCTION public.cloakroom_lookup(p_qr text, p_event uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_qr     text := btrim(COALESCE(p_qr, ''));
  v_tx     record;
  v_name   text;
  v_ticket uuid;
  v_event  uuid;
  v_valid  boolean;
  v_found  boolean := false;
  v_pre_id uuid;
  v_pre_price numeric;
BEGIN
  IF NOT public.can_run_event_cloakroom(auth.uid(), p_event) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF v_qr = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown');
  END IF;

  SELECT id, cloakroom_number, items_count, customer_name, ticket_id INTO v_tx
    FROM public.cloakroom_transactions
   WHERE event_id = p_event AND attendee_qr = v_qr AND NOT retrieved
   ORDER BY deposited_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'mode', 'retrieve', 'tx', jsonb_build_object(
      'id', v_tx.id, 'cloakroom_number', v_tx.cloakroom_number, 'items_count', v_tx.items_count,
      'customer_name', v_tx.customer_name, 'ticket_id', v_tx.ticket_id));
  END IF;

  SELECT a.full_name, t.id, t.event_id, t.status = 'paid'
    INTO v_name, v_ticket, v_event, v_valid
    FROM public.ticket_attendees a JOIN public.tickets t ON t.id = a.ticket_id
   WHERE a.qr_code = v_qr LIMIT 1;
  v_found := FOUND;
  IF NOT v_found THEN
    SELECT t.full_name, t.id, t.event_id, t.status = 'paid'
      INTO v_name, v_ticket, v_event, v_valid
      FROM public.tickets t WHERE t.qr_code = v_qr LIMIT 1;
    v_found := FOUND;
  END IF;
  IF NOT v_found THEN
    SELECT g.full_name, NULL::uuid, gl.event_id, g.status IS DISTINCT FROM 'cancelled'
      INTO v_name, v_ticket, v_event, v_valid
      FROM public.guest_list_entries g JOIN public.guest_lists gl ON gl.id = g.guest_list_id
     WHERE g.qr_code = v_qr LIMIT 1;
    v_found := FOUND;
  END IF;

  IF NOT v_found THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown');
  END IF;
  IF v_event IS DISTINCT FROM p_event THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'other_night');
  END IF;
  IF NOT COALESCE(v_valid, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_valid');
  END IF;

  IF v_ticket IS NOT NULL THEN
    SELECT s.id, s.unit_price INTO v_pre_id, v_pre_price
      FROM public.ticket_upsell_selections s
     WHERE s.ticket_id = v_ticket AND s.offer_type = 'cloakroom'
       AND NOT COALESCE(s.cloakroom_deposited, false)
     ORDER BY s.created_at LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'mode', 'deposit', 'name', v_name, 'ticket_id', v_ticket,
    'prepaid', CASE WHEN v_pre_id IS NOT NULL
                    THEN jsonb_build_object('id', v_pre_id, 'unit_price', v_pre_price) END,
    'unit_price', public.cloakroom_event_price(p_event));
END;
$function$;

-- Dépôt. p_id = identifiant choisi par le téléphone pour CE dépôt : un renvoi
-- après une réponse perdue retombe sur la même ligne et rend « ok ».
-- Rend {ok:true, id, number, price} ou {ok:false, reason} avec reason ∈
-- number_taken | already_deposited | prepaid_used | no_event | forbidden.
CREATE OR REPLACE FUNCTION public.cloakroom_deposit(
  p_id uuid,
  p_event_id uuid,
  p_attendee_qr text,
  p_ticket_id uuid,
  p_customer_name text,
  p_number text,
  p_items integer,
  p_prepaid_selection_id uuid DEFAULT NULL,
  p_payment_confirmed boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_prev   record;
  v_price  numeric;
  v_unit   numeric;
  v_venue  text;
  v_items  integer := LEAST(GREATEST(COALESCE(p_items, 1), 1), 20);
  v_number text := btrim(COALESCE(p_number, ''));
  v_qr     text := NULLIF(btrim(COALESCE(p_attendee_qr, '')), '');
BEGIN
  IF p_event_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_event');
  END IF;
  IF NOT public.can_run_event_cloakroom(v_uid, p_event_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF v_number = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'number_required');
  END IF;
  SELECT COALESCE(venue_id, partner_venue_id) INTO v_venue FROM public.events WHERE id = p_event_id;

  -- Renvoi du même dépôt : on rend ce qui est déjà enregistré.
  SELECT id, cloakroom_number, price INTO v_prev FROM public.cloakroom_transactions WHERE id = p_id;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'id', v_prev.id, 'number', v_prev.cloakroom_number, 'price', v_prev.price);
  END IF;

  -- Un seul sous-bloc : si le numéro ou le QR est déjà pris, l'option prépayée
  -- consommée juste avant est rendue par le même rollback.
  BEGIN
    IF p_prepaid_selection_id IS NOT NULL THEN
      -- L'option prépayée ne sert qu'une fois, et seulement sur un billet
      -- encore PAYÉ (un billet remboursé ne rouvre pas le vestiaire offert).
      UPDATE public.ticket_upsell_selections s
         SET cloakroom_deposited = true,
             cloakroom_deposited_at = now(),
             cloakroom_number = v_number
       WHERE s.id = p_prepaid_selection_id
         AND s.offer_type = 'cloakroom'
         AND s.ticket_id IS NOT DISTINCT FROM p_ticket_id
         AND NOT COALESCE(s.cloakroom_deposited, false)
         AND EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = s.ticket_id AND t.status = 'paid')
      RETURNING s.unit_price INTO v_unit;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'prepaid_used');
      END IF;
      -- Emplacements en plus du prépayé : au tarif de la soirée, payés sur place.
      v_price := COALESCE(v_unit, 0) + public.cloakroom_event_price(p_event_id) * (v_items - 1);
    ELSE
      v_price := public.cloakroom_event_price(p_event_id) * v_items;
    END IF;

    INSERT INTO public.cloakroom_transactions (
      id, venue_id, event_id, ticket_id, attendee_qr, customer_name, cloakroom_number,
      items_count, price, paid_on_site, payment_confirmed, staff_id, processed_by
    ) VALUES (
      p_id, v_venue, p_event_id, p_ticket_id, v_qr, NULLIF(btrim(p_customer_name), ''), v_number,
      v_items, COALESCE(v_price, 0),
      p_prepaid_selection_id IS NULL OR v_items > 1,
      (p_prepaid_selection_id IS NOT NULL AND v_items = 1) OR COALESCE(p_payment_confirmed, false),
      v_uid, v_uid
    );
  EXCEPTION WHEN unique_violation THEN
    IF v_qr IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.cloakroom_transactions
       WHERE event_id = p_event_id AND attendee_qr = v_qr AND NOT retrieved
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'already_deposited');
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'number_taken');
  END;

  RETURN jsonb_build_object('ok', true, 'id', p_id, 'number', v_number, 'price', COALESCE(v_price, 0));
END;
$function$;

-- Restitution. Rend {ok:true} ou {ok:false, reason:'already_retrieved', at, mine}.
CREATE OR REPLACE FUNCTION public.cloakroom_retrieve(p_tx uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row record;
BEGIN
  SELECT id, event_id, ticket_id, retrieved, retrieved_at, retrieved_by
    INTO v_row FROM public.cloakroom_transactions WHERE id = p_tx;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF NOT public.can_run_event_cloakroom(v_uid, v_row.event_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  UPDATE public.cloakroom_transactions
     SET retrieved = true, retrieved_at = now(), retrieved_by = v_uid
   WHERE id = p_tx AND NOT retrieved;
  IF NOT FOUND THEN
    SELECT retrieved_at, retrieved_by INTO v_row.retrieved_at, v_row.retrieved_by
      FROM public.cloakroom_transactions WHERE id = p_tx;
    RETURN jsonb_build_object('ok', false, 'reason', 'already_retrieved', 'at', v_row.retrieved_at,
                              'mine', v_row.retrieved_by = v_uid);
  END IF;

  IF v_row.ticket_id IS NOT NULL THEN
    UPDATE public.ticket_upsell_selections
       SET cloakroom_retrieved = true, cloakroom_retrieved_at = now()
     WHERE ticket_id = v_row.ticket_id
       AND offer_type = 'cloakroom'
       AND COALESCE(cloakroom_deposited, false)
       AND NOT COALESCE(cloakroom_retrieved, false);
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.can_run_cloakroom(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_run_event_cloakroom(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cloakroom_event_price(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_organizer_cloakroom_price(numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cloakroom_lookup(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cloakroom_deposit(uuid, uuid, text, uuid, text, text, integer, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cloakroom_retrieve(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_run_cloakroom(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_run_event_cloakroom(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cloakroom_event_price(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_organizer_cloakroom_price(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cloakroom_lookup(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cloakroom_deposit(uuid, uuid, text, uuid, text, text, integer, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cloakroom_retrieve(uuid) TO authenticated;

-- ─── Écritures directes restantes : signées par la base, jamais réécrites ───
-- (le front passe par les RPC ; ce qui reste d'accès direct ne peut plus
-- mentir sur qui, quand ni combien). INVOKER + current_user : cf. CLAUDE.md.
CREATE OR REPLACE FUNCTION public.guard_cloakroom_client_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.staff_id := auth.uid();
    NEW.processed_by := auth.uid();
    NEW.deposited_at := now();
    NEW.retrieved := false;
    NEW.retrieved_at := NULL;
    NEW.retrieved_by := NULL;
    RETURN NEW;
  END IF;
  -- UPDATE : seule la restitution est permise, et elle est signée ici.
  IF NEW.price IS DISTINCT FROM OLD.price
     OR NEW.payment_confirmed IS DISTINCT FROM OLD.payment_confirmed
     OR NEW.paid_on_site IS DISTINCT FROM OLD.paid_on_site
     OR NEW.cloakroom_number IS DISTINCT FROM OLD.cloakroom_number
     OR NEW.staff_id IS DISTINCT FROM OLD.staff_id
     OR NEW.processed_by IS DISTINCT FROM OLD.processed_by
     OR NEW.venue_id IS DISTINCT FROM OLD.venue_id
     OR NEW.event_id IS DISTINCT FROM OLD.event_id
     OR NEW.attendee_qr IS DISTINCT FROM OLD.attendee_qr
     OR NEW.deposited_at IS DISTINCT FROM OLD.deposited_at
     OR (OLD.retrieved AND NOT NEW.retrieved) THEN
    RAISE EXCEPTION 'cloakroom_transactions: only the retrieval can be recorded by a client'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.retrieved AND NOT OLD.retrieved THEN
    NEW.retrieved_by := auth.uid();
    NEW.retrieved_at := now();
  ELSE
    NEW.retrieved_by := OLD.retrieved_by;
    NEW.retrieved_at := OLD.retrieved_at;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_cloakroom_client_write ON public.cloakroom_transactions;
CREATE TRIGGER trg_guard_cloakroom_client_write
  BEFORE INSERT OR UPDATE ON public.cloakroom_transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_cloakroom_client_write();

-- Portée = la SOIRÉE (club, organisateur, leurs équipes). Un préposé (ou un
-- barman, un videur…) ne SUPPRIME plus un dépôt : c'était la façon d'effacer
-- une ligne payée en espèces. L'owner du club garde la main.
DROP POLICY IF EXISTS "Venue staff can manage cloakroom transactions" ON public.cloakroom_transactions;
DROP POLICY IF EXISTS "Venue owners can view cloakroom transactions" ON public.cloakroom_transactions;
CREATE POLICY "Cloakroom staff can view event deposits" ON public.cloakroom_transactions
  FOR SELECT TO authenticated USING (public.can_run_event_cloakroom(auth.uid(), event_id));
CREATE POLICY "Cloakroom staff can record deposits" ON public.cloakroom_transactions
  FOR INSERT TO authenticated WITH CHECK (public.can_run_event_cloakroom(auth.uid(), event_id));
CREATE POLICY "Cloakroom staff can record retrievals" ON public.cloakroom_transactions
  FOR UPDATE TO authenticated
  USING (public.can_run_event_cloakroom(auth.uid(), event_id))
  WITH CHECK (public.can_run_event_cloakroom(auth.uid(), event_id));
CREATE POLICY "Venue owners can delete cloakroom transactions" ON public.cloakroom_transactions
  FOR DELETE TO authenticated USING (venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id));
