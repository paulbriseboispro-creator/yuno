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
--
-- Après : deux index uniques (numéro et QR, tant que le vêtement n'est pas
-- rendu), deux RPC atomiques et idempotentes (cloakroom_deposit,
-- cloakroom_retrieve) qui signent l'acte (auth.uid(), now()) et calculent le
-- prix, et une garde qui empêche un client de réécrire le reste.
-- ════════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS uq_cloakroom_open_number
  ON public.cloakroom_transactions (venue_id, event_id, upper(btrim(cloakroom_number)))
  WHERE NOT retrieved;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cloakroom_open_qr
  ON public.cloakroom_transactions (venue_id, attendee_qr)
  WHERE NOT retrieved AND attendee_qr IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cloakroom_venue_event_open
  ON public.cloakroom_transactions (venue_id, event_id, retrieved);

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

-- Dépôt. p_id = identifiant choisi par le téléphone pour CE dépôt : un renvoi
-- après une réponse perdue retombe sur la même ligne et rend « ok ».
-- Rend {ok:true, id, number, price} ou {ok:false, reason} avec reason ∈
-- number_taken | already_deposited | prepaid_used | no_event | forbidden.
CREATE OR REPLACE FUNCTION public.cloakroom_deposit(
  p_id uuid,
  p_venue_id text,
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
  v_items  integer := LEAST(GREATEST(COALESCE(p_items, 1), 1), 20);
  v_number text := btrim(COALESCE(p_number, ''));
  v_qr     text := NULLIF(btrim(COALESCE(p_attendee_qr, '')), '');
BEGIN
  IF NOT public.can_run_cloakroom(v_uid, p_venue_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF p_event_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id = p_event_id AND (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_event');
  END IF;
  IF v_number = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'number_required');
  END IF;

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
      -- Emplacements en plus du prépayé : au tarif du club, payés sur place.
      SELECT COALESCE(v_unit, 0) + COALESCE(cloakroom_price, 4) * (v_items - 1)
        INTO v_price FROM public.venues WHERE id = p_venue_id;
    ELSE
      SELECT COALESCE(cloakroom_price, 4) * v_items INTO v_price FROM public.venues WHERE id = p_venue_id;
    END IF;

    INSERT INTO public.cloakroom_transactions (
      id, venue_id, event_id, ticket_id, attendee_qr, customer_name, cloakroom_number,
      items_count, price, paid_on_site, payment_confirmed, staff_id, processed_by
    ) VALUES (
      p_id, p_venue_id, p_event_id, p_ticket_id, v_qr, NULLIF(btrim(p_customer_name), ''), v_number,
      v_items, COALESCE(v_price, 0),
      p_prepaid_selection_id IS NULL OR v_items > 1,
      (p_prepaid_selection_id IS NOT NULL AND v_items = 1) OR COALESCE(p_payment_confirmed, false),
      v_uid, v_uid
    );
  EXCEPTION WHEN unique_violation THEN
    IF v_qr IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.cloakroom_transactions
       WHERE venue_id = p_venue_id AND attendee_qr = v_qr AND NOT retrieved
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'already_deposited');
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'number_taken');
  END;

  RETURN jsonb_build_object('ok', true, 'id', p_id, 'number', v_number, 'price', COALESCE(v_price, 0));
END;
$function$;

-- Restitution. Rend {ok:true} ou {ok:false, reason:'already_retrieved', at}.
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
  SELECT id, venue_id, ticket_id, retrieved, retrieved_at, retrieved_by
    INTO v_row FROM public.cloakroom_transactions WHERE id = p_tx;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF NOT public.can_run_cloakroom(v_uid, v_row.venue_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  UPDATE public.cloakroom_transactions
     SET retrieved = true, retrieved_at = now(), retrieved_by = v_uid
   WHERE id = p_tx AND NOT retrieved;
  IF NOT FOUND THEN
    SELECT retrieved_at INTO v_row.retrieved_at FROM public.cloakroom_transactions WHERE id = p_tx;
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
REVOKE ALL ON FUNCTION public.cloakroom_deposit(uuid, text, uuid, text, uuid, text, text, integer, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cloakroom_retrieve(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_run_cloakroom(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cloakroom_deposit(uuid, text, uuid, text, uuid, text, text, integer, uuid, boolean) TO authenticated;
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

-- Un préposé (ou un barman, un videur…) ne SUPPRIME plus un dépôt : c'était
-- la façon d'effacer une ligne payée en espèces. L'owner garde la main.
DROP POLICY IF EXISTS "Venue staff can manage cloakroom transactions" ON public.cloakroom_transactions;
CREATE POLICY "Venue staff can view cloakroom transactions" ON public.cloakroom_transactions
  FOR SELECT USING (public.is_venue_staff(auth.uid(), venue_id) OR public.is_venue_owner(auth.uid(), venue_id));
CREATE POLICY "Venue staff can record cloakroom deposits" ON public.cloakroom_transactions
  FOR INSERT WITH CHECK (public.is_venue_staff(auth.uid(), venue_id) OR public.is_venue_owner(auth.uid(), venue_id));
CREATE POLICY "Venue staff can record cloakroom retrievals" ON public.cloakroom_transactions
  FOR UPDATE USING (public.is_venue_staff(auth.uid(), venue_id) OR public.is_venue_owner(auth.uid(), venue_id))
  WITH CHECK (public.is_venue_staff(auth.uid(), venue_id) OR public.is_venue_owner(auth.uid(), venue_id));
CREATE POLICY "Venue owners can delete cloakroom transactions" ON public.cloakroom_transactions
  FOR DELETE USING (public.is_venue_owner(auth.uid(), venue_id));
