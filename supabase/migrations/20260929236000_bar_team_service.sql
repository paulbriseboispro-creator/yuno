-- ════════════════════════════════════════════════════════════════════════════
-- Bar — plusieurs barmans, une seule vérité (2026-09-29)
--
-- Revue du profil barman avant les premières vraies soirées à plusieurs
-- postes. Ce qui est corrigé ici :
--
-- 1. Servir une boisson était une réécriture du JSON `items` ENTIER depuis
--    l'instantané pris au scan, sans verrou : deux barmans qui scannent le même
--    QR (capture d'écran passée à un ami) servaient tous les deux ; deux QR de
--    la même commande servis en même temps s'écrasaient (des boissons déjà
--    servies redevenaient « à servir »). Seule la ligne 0 d'un QR multi-
--    commandes était vérifiée « payée ». Désormais bar_redeem_units() verrouille
--    chaque commande, sert unité par unité, refuse tout le QR si une commande
--    n'est pas payée, et journalise qui a servi quoi (order_unit_redemptions).
--
-- 2. Le jeton / PIN servait la commande ENTIÈRE, y compris ce qui avait déjà
--    été servi, et fermait des boissons payées jamais demandées en Click &
--    Collect. Il ne sert plus que ce qui reste (et, en C&C, ce qui a été
--    préparé).
--
-- 3. Click & Collect : AUCUNE policy ne permettait au client d'écrire sa
--    demande de préparation — 0 commande en 7 634 n'a jamais été demandée.
--    request_order_prep() porte la demande. claim_order_prep() permet de
--    reprendre une préparation abandonnée (pause, téléphone mort).
--
-- 4. Escalade de privilèges : n'importe quel membre du staff pouvait se poser
--    `is_click_collect_manager = true` sur son profil, puis la policy « Click
--    collect managers can update venues » lui ouvrait TOUTES les colonnes du
--    club (compte Stripe, propriétaire, frais…). La policy est remplacée par
--    set_click_collect_mode() et le drapeau ne s'écrit plus soi-même.
--
-- 5. Un barman pouvait passer une commande « payée » à la main, et
--    `served_by` venait du téléphone.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Qui tient le bar d'un club ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_run_bar(p_uid uuid, p_venue text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p_uid IS NOT NULL AND p_venue IS NOT NULL AND (
    public.is_super_admin()
    OR public.is_venue_owner(p_uid, p_venue)
    OR (public.get_user_venue_id(p_uid) = p_venue
        AND (public.has_role(p_uid, 'barman') OR public.has_role(p_uid, 'manager')))
  )
$function$;

-- ─── Journal par unité servie ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.order_unit_redemptions (
  order_id  uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  unit_idx  integer NOT NULL,
  served_by uuid,
  served_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, unit_idx)
);
CREATE INDEX IF NOT EXISTS idx_order_unit_redemptions_served_by ON public.order_unit_redemptions (served_by, served_at);
ALTER TABLE public.order_unit_redemptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Bar staff can view unit redemptions" ON public.order_unit_redemptions;
CREATE POLICY "Bar staff can view unit redemptions" ON public.order_unit_redemptions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND public.can_run_bar(auth.uid(), o.venue_id)));

-- Nombre d'unités d'une commande (items[].qty) et état « servi » d'une unité
-- dans l'ordre DÉPLIÉ (unité 0 = 1re unité du 1er article) — le même ordre que
-- le QR de sélection du client (DrinkOrderDetailModal).
CREATE OR REPLACE FUNCTION public._order_units(p_items jsonb)
 RETURNS TABLE(unit_idx integer, item_idx integer, sub_idx integer, served boolean, prepped boolean, name text)
 LANGUAGE sql
 IMMUTABLE
AS $function$
  WITH it AS (
    SELECT (e.ord - 1)::int AS item_idx, e.item
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_items) = 'array' THEN p_items ELSE '[]'::jsonb END)
           WITH ORDINALITY AS e(item, ord)
  ), units AS (
    SELECT it.item_idx, s.sub_idx::int AS sub_idx, it.item
      FROM it
      CROSS JOIN LATERAL generate_series(0, GREATEST(COALESCE((it.item->>'qty')::int, (it.item->>'quantity')::int, 0), 0) - 1) AS s(sub_idx)
  )
  SELECT (row_number() OVER (ORDER BY item_idx, sub_idx) - 1)::int,
         item_idx, sub_idx,
         COALESCE((item->'servedUnits'->>sub_idx)::boolean, false) OR COALESCE((item->>'served')::boolean, false),
         COALESCE((item->'prepUnits'->>sub_idx)::boolean, false),
         item->>'name'
    FROM units
$function$;

-- Sert des unités. p_segments : [{order_id, indices:[int] | null}] — indices
-- null = tout ce qui reste (jeton / PIN) ; en Click & Collect, seulement ce qui
-- a été préparé. Tout ou rien : une commande non valable refuse le QR entier.
-- Rend {ok, reason?, served:[{order_id, units:[..], names:[..]}], already, mine}.
CREATE OR REPLACE FUNCTION public.bar_redeem_units(p_segments jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_seg     jsonb;
  v_order   record;
  v_event   record;
  v_ids     uuid[];
  v_idx     integer;
  v_want    integer[];
  v_served  jsonb := '[]'::jsonb;
  v_already integer := 0;
  v_mine    integer := 0;
  v_count   integer := 0;
  v_units   integer[];
  v_names   text[];
  v_items   jsonb;
  v_u       record;
  v_all     boolean;
  v_left_prep boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF p_segments IS NULL OR jsonb_typeof(p_segments) <> 'array' OR jsonb_array_length(p_segments) = 0
     OR jsonb_array_length(p_segments) > 20 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;

  SELECT array_agg(DISTINCT (s->>'order_id')::uuid) INTO v_ids FROM jsonb_array_elements(p_segments) s;

  -- Verrou de toutes les commandes du QR, dans un ordre stable (pas d'interblocage).
  PERFORM 1 FROM public.orders WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;

  -- 1) Validation de TOUTES les commandes avant d'écrire quoi que ce soit.
  FOR v_order IN SELECT * FROM public.orders WHERE id = ANY(v_ids) LOOP
    IF NOT public.can_run_bar(v_uid, v_order.venue_id) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
    END IF;
    IF v_order.status <> 'paid' OR COALESCE(v_order.token_used, false) THEN
      -- Fermée entre-temps : tout servi (collègue) ou remboursée.
      RETURN jsonb_build_object('ok', false,
        'reason', CASE WHEN v_order.status = 'served' OR COALESCE(v_order.token_used, false) THEN 'already_served' ELSE 'not_paid' END);
    END IF;
    IF COALESCE(v_order.prep_requested, false) AND v_order.prep_status IS DISTINCT FROM 'ready' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_ready', 'prep_status', v_order.prep_status);
    END IF;
    IF v_order.event_id IS NOT NULL THEN
      SELECT start_at, end_at INTO v_event FROM public.events WHERE id = v_order.event_id;
      IF v_event.start_at IS NOT NULL AND now() < v_event.start_at THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'event_not_started');
      END IF;
      IF v_event.end_at IS NOT NULL AND now() > v_event.end_at THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'event_ended');
      END IF;
    ELSIF v_order.token_expires_at IS NOT NULL AND v_order.token_expires_at < now() THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'expired');
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.orders WHERE id = ANY(v_ids)) <> COALESCE(array_length(v_ids, 1), 0) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- 2) Service, commande par commande.
  FOR v_seg IN SELECT * FROM jsonb_array_elements(p_segments) LOOP
    SELECT * INTO v_order FROM public.orders WHERE id = (v_seg->>'order_id')::uuid;
    v_items := v_order.items;

    IF v_seg->'indices' IS NULL OR jsonb_typeof(v_seg->'indices') <> 'array' THEN
      -- Jeton / PIN : ce qui reste ; en Click & Collect, ce qui a été préparé.
      SELECT array_agg(u.unit_idx ORDER BY u.unit_idx) INTO v_want
        FROM public._order_units(v_items) u
       WHERE NOT u.served AND (NOT COALESCE(v_order.prep_requested, false) OR u.prepped);
    ELSE
      SELECT array_agg(DISTINCT x::int) INTO v_want FROM jsonb_array_elements_text(v_seg->'indices') x;
    END IF;

    v_units := ARRAY[]::integer[];
    v_names := ARRAY[]::text[];
    FOR v_u IN SELECT * FROM public._order_units(v_items) u WHERE u.unit_idx = ANY(COALESCE(v_want, ARRAY[]::integer[])) ORDER BY u.unit_idx LOOP
      IF v_u.served THEN
        -- Notre propre scan d'il y a quelques secondes (réponse perdue) : succès.
        IF EXISTS (SELECT 1 FROM public.order_unit_redemptions r
                    WHERE r.order_id = v_order.id AND r.unit_idx = v_u.unit_idx
                      AND r.served_by = v_uid AND r.served_at > now() - interval '60 seconds') THEN
          v_mine := v_mine + 1;
        ELSE
          v_already := v_already + 1;
        END IF;
        CONTINUE;
      END IF;
      v_items := jsonb_set(
        v_items,
        ARRAY[v_u.item_idx::text, 'servedUnits'],
        (SELECT jsonb_agg(CASE WHEN g = v_u.sub_idx THEN true
                               ELSE COALESCE((v_items->v_u.item_idx->'servedUnits'->>g)::boolean, false)
                                    OR COALESCE((v_items->v_u.item_idx->>'served')::boolean, false) END ORDER BY g)
           FROM generate_series(0, GREATEST(COALESCE((v_items->v_u.item_idx->>'qty')::int, (v_items->v_u.item_idx->>'quantity')::int, 0), 1) - 1) g),
        true);
      INSERT INTO public.order_unit_redemptions (order_id, unit_idx, served_by)
      VALUES (v_order.id, v_u.unit_idx, v_uid)
      ON CONFLICT (order_id, unit_idx) DO NOTHING;
      v_units := v_units || v_u.unit_idx;
      v_names := v_names || COALESCE(v_u.name, '—');
      v_count := v_count + 1;
    END LOOP;

    IF array_length(v_units, 1) IS NULL THEN
      CONTINUE;
    END IF;

    SELECT bool_and(u.served) INTO v_all FROM public._order_units(v_items) u;
    SELECT bool_or(u.prepped AND NOT u.served) INTO v_left_prep FROM public._order_units(v_items) u;

    UPDATE public.orders SET
      items = v_items,
      status = CASE WHEN v_all THEN 'served' ELSE status END,
      token_used = CASE WHEN v_all THEN true ELSE token_used END,
      served_at = CASE WHEN v_all THEN now() ELSE served_at END,
      served_by = v_uid,
      archived = CASE WHEN v_all THEN true ELSE archived END,
      -- Click & Collect : la demande est honorée quand tout ce qui a été
      -- préparé est servi ; le reste redevient demandable par le client.
      prep_requested = CASE WHEN COALESCE(prep_requested, false) AND NOT COALESCE(v_left_prep, false) THEN false ELSE prep_requested END,
      prep_status = CASE
        WHEN v_all THEN 'served'
        WHEN COALESCE(prep_requested, false) AND NOT COALESCE(v_left_prep, false) THEN 'queue'
        ELSE prep_status END,
      prep_claimed_by = CASE WHEN COALESCE(prep_requested, false) AND NOT COALESCE(v_left_prep, false) THEN NULL ELSE prep_claimed_by END
    WHERE id = v_order.id;

    v_served := v_served || jsonb_build_object('order_id', v_order.id, 'units', to_jsonb(v_units), 'names', to_jsonb(v_names));
  END LOOP;

  IF v_count = 0 AND v_mine = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', CASE WHEN v_already > 0 THEN 'already_served' ELSE 'nothing_to_serve' END);
  END IF;
  RETURN jsonb_build_object('ok', true, 'served', v_served, 'served_count', v_count, 'already', v_already, 'mine', v_mine);
END;
$function$;

-- ─── Click & Collect ─────────────────────────────────────────────────────────
-- Le client demande la préparation de certaines unités (ou de tout ce qui
-- reste). Seul le titulaire de la commande, payée, pas encore servie.
CREATE OR REPLACE FUNCTION public.request_order_prep(p_order_id uuid, p_unit_indices integer[] DEFAULT NULL, p_bar text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_order record;
  v_items jsonb;
  v_u     record;
  v_n     integer := 0;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_uid IS NULL OR v_order.user_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_order.status <> 'paid' OR COALESCE(v_order.token_used, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_redeemable');
  END IF;
  IF COALESCE(v_order.prep_requested, false) AND v_order.prep_status IN ('preparing', 'ready') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'in_progress');
  END IF;

  v_items := v_order.items;
  FOR v_u IN SELECT * FROM public._order_units(v_items) u
              WHERE NOT u.served AND (p_unit_indices IS NULL OR u.unit_idx = ANY(p_unit_indices)) LOOP
    v_items := jsonb_set(
      v_items,
      ARRAY[v_u.item_idx::text, 'prepUnits'],
      (SELECT jsonb_agg(CASE WHEN g = v_u.sub_idx THEN true
                             ELSE COALESCE((v_items->v_u.item_idx->'prepUnits'->>g)::boolean, false) END ORDER BY g)
         FROM generate_series(0, GREATEST(COALESCE((v_items->v_u.item_idx->>'qty')::int, (v_items->v_u.item_idx->>'quantity')::int, 0), 1) - 1) g),
      true);
    v_n := v_n + 1;
  END LOOP;
  IF v_n = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'nothing_to_prepare');
  END IF;

  UPDATE public.orders
     SET items = v_items, prep_requested = true, prep_status = 'queue',
         selected_bar = COALESCE(NULLIF(btrim(p_bar), ''), selected_bar),
         prep_claimed_by = NULL, prep_claimed_at = NULL
   WHERE id = p_order_id;
  RETURN jsonb_build_object('ok', true, 'units', v_n);
END;
$function$;

-- Un barman prend une commande en préparation — ou la REPREND à un collègue
-- parti (pause, téléphone mort) au bout de 10 min, ou la RELÂCHE.
-- p_action : 'claim' | 'takeover' | 'release' | 'ready'.
CREATE OR REPLACE FUNCTION public.claim_order_prep(p_order_id uuid, p_action text DEFAULT 'claim', p_bar text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_order record;
  v_boss  boolean;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF NOT public.can_run_bar(v_uid, v_order.venue_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF v_order.status <> 'paid' OR NOT COALESCE(v_order.prep_requested, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_requested');
  END IF;
  v_boss := public.is_venue_owner(v_uid, v_order.venue_id) OR public.has_role(v_uid, 'manager') OR public.is_super_admin();

  IF p_action = 'claim' THEN
    IF v_order.prep_status = 'queue' OR v_order.prep_claimed_by IS NULL OR v_order.prep_claimed_by = v_uid THEN
      UPDATE public.orders
         SET prep_status = 'preparing', prep_claimed_by = v_uid, prep_claimed_at = now(),
             assigned_bar = COALESCE(NULLIF(btrim(p_bar), ''), assigned_bar)
       WHERE id = p_order_id;
      RETURN jsonb_build_object('ok', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'already_claimed', 'claimed_at', v_order.prep_claimed_at);
  ELSIF p_action = 'takeover' THEN
    IF v_order.prep_status = 'preparing'
       AND (v_order.prep_claimed_at < now() - interval '10 minutes' OR v_boss OR v_order.prep_claimed_by = v_uid) THEN
      UPDATE public.orders
         SET prep_claimed_by = v_uid, prep_claimed_at = now(),
             assigned_bar = COALESCE(NULLIF(btrim(p_bar), ''), assigned_bar)
       WHERE id = p_order_id;
      RETURN jsonb_build_object('ok', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'too_early', 'claimed_at', v_order.prep_claimed_at);
  ELSIF p_action = 'release' THEN
    IF v_order.prep_status = 'preparing' AND (v_order.prep_claimed_by = v_uid OR v_boss) THEN
      UPDATE public.orders
         SET prep_status = 'queue', prep_claimed_by = NULL, prep_claimed_at = NULL
       WHERE id = p_order_id;
      RETURN jsonb_build_object('ok', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'not_yours');
  ELSIF p_action = 'ready' THEN
    IF v_order.prep_status = 'preparing' AND (v_order.prep_claimed_by = v_uid OR v_boss) THEN
      UPDATE public.orders
         SET prep_status = 'ready', ready_at = now(), notify_status = 'ready'
       WHERE id = p_order_id;
      RETURN jsonb_build_object('ok', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'not_yours');
  END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
END;
$function$;

-- ─── Mode Click & Collect du club : un interrupteur, pas les clés du club ────
CREATE OR REPLACE FUNCTION public.set_click_collect_mode(p_venue_id text, p_on boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT (
    public.is_super_admin()
    OR public.is_venue_owner(v_uid, p_venue_id)
    OR public.can_manage_venue(v_uid, p_venue_id)
    OR EXISTS (SELECT 1 FROM public.profiles p
                WHERE p.id = v_uid AND p.venue_id = p_venue_id AND p.is_click_collect_manager)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.venues SET click_collect_mode = COALESCE(p_on, false) WHERE id = p_venue_id;
  RETURN FOUND;
END;
$function$;

DROP POLICY IF EXISTS "Click collect managers can update venues" ON public.venues;

-- Le drapeau « responsable Click & Collect » s'accorde (owner, super admin,
-- serveur), il ne se prend pas. Garde INVOKER sur current_user + auth.uid() :
-- l'owner du club garde la main via la policy « Owners update venue staff profiles ».
CREATE OR REPLACE FUNCTION public.guard_click_collect_manager_flag()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND NEW.is_click_collect_manager IS DISTINCT FROM OLD.is_click_collect_manager
     AND NOT public.is_super_admin()
     AND NOT (NEW.venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), NEW.venue_id)) THEN
    RAISE EXCEPTION 'profiles: is_click_collect_manager is granted by the club owner'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_click_collect_manager_flag ON public.profiles;
CREATE TRIGGER trg_guard_click_collect_manager_flag BEFORE UPDATE OF is_click_collect_manager ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_click_collect_manager_flag();

-- ─── Commandes : statut et « servi par » ne mentent plus ────────────────────
CREATE OR REPLACE FUNCTION public.protect_order_immutable_fields()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.total                    IS DISTINCT FROM OLD.total
       OR NEW.paid_at               IS DISTINCT FROM OLD.paid_at
       OR NEW.stripe_payment_intent_id IS DISTINCT FROM OLD.stripe_payment_intent_id
       OR NEW.user_id               IS DISTINCT FROM OLD.user_id
       OR NEW.venue_id              IS DISTINCT FROM OLD.venue_id
       OR NEW.refund_amount         IS DISTINCT FROM OLD.refund_amount
       OR NEW.refunded_at           IS DISTINCT FROM OLD.refunded_at THEN
      RAISE EXCEPTION 'orders: financial fields are immutable for non-service roles';
    END IF;
    -- Un client (barman compris) ne fait qu'une transition : payée → servie.
    -- « Payée » ou « remboursée » se décident côté serveur (Stripe).
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'paid' AND NEW.status = 'served') THEN
      RAISE EXCEPTION 'orders: status can only move from paid to served on a client'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- A consumed QR token may never be re-opened to allow a second pickup.
    IF OLD.token_used = true AND NEW.token_used = false THEN
      RAISE EXCEPTION 'orders: token_used cannot be reset';
    END IF;
    -- Qui a servi : la personne connectée, jamais une valeur envoyée.
    IF NEW.served_at IS DISTINCT FROM OLD.served_at OR NEW.served_by IS DISTINCT FROM OLD.served_by THEN
      NEW.served_by := auth.uid();
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.can_run_bar(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._order_units(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bar_redeem_units(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_order_prep(uuid, integer[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_order_prep(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_click_collect_mode(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_run_bar(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public._order_units(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bar_redeem_units(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_order_prep(uuid, integer[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_order_prep(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_click_collect_mode(text, boolean) TO authenticated;
