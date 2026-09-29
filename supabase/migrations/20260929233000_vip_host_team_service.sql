-- ════════════════════════════════════════════════════════════════════════════
-- Hôte VIP — plusieurs hôtes sur la même soirée, une seule vérité (2026-09-29)
--
-- Revue complète du profil hôte VIP avant les premières vraies soirées à
-- plusieurs téléphones. Ce qui est corrigé ici :
--
-- 1. Les pré-commandes du checkout étaient REFUSÉES par la base : la contrainte
--    de statut de vip_table_orders ignorait 'preorder', l'insert de
--    create-table-checkout échouait (« non bloquant ») et la bouteille choisie
--    par le client disparaissait sans un mot.
--
-- 2. Une table pouvait accueillir deux groupes : le trigger vérifiait
--    « table déjà prise » par un SELECT sans verrou (deux hôtes qui installent
--    au même instant passaient tous les deux), lisait un plan de salle AU
--    HASARD quand le club a des plans par soirée, et ne vérifiait rien quand
--    un client pré-placé était installé sur SA table (colonne inchangée) ni à
--    la réouverture d'une table terminée. D'où : index unique partiel (la
--    garantie), verrou consultatif partagé avec la création de walk-in (le
--    message propre), plan de la soirée d'abord.
--
-- 3. Une table libérée restait bloquée pour les walk-ins toute la nuit :
--    create_manual_table_reservation comptait comme « prise » toute résa qui
--    avait un jour porté la table (terminée, no-show comprises) et comptait
--    les résas terminées dans la capacité de la zone. Un club fait tourner
--    ses tables ; seule une résa qui TIENT la table la bloque.
--
-- 4. Servir une commande n'était pas atomique : le téléphone passait la
--    commande en « servie » puis écrivait le grand livre ligne à ligne, en
--    lisant les articles dans SA mémoire. Réseau coupé entre les deux, ou
--    articles pas encore arrivés par le realtime (la commande client est
--    insérée avant ses lignes) = commande servie, crédit du client jamais
--    débité. Désormais vip_serve_table_order() fait tout dans une transaction
--    et relit les articles en base.
--
-- 5. Prendre une commande / servir en direct : mêmes écritures en plusieurs
--    allers-retours, prix envoyés par le téléphone. vip_create_table_order()
--    et vip_serve_items() lisent les prix dans la carte, écrivent tout ou rien,
--    et sont idempotentes (p_request_id) : un renvoi après une réponse perdue
--    sur le wifi du club ne débite pas deux fois la table.
--
-- 6. Un client pouvait RÉÉCRIRE sa propre commande (policy UPDATE sans garde :
--    montant, statut, et même la résa visée — donc la table débitée).
--
-- 7. Les moments de service (bottle parade, anniversaire) n'étaient pas
--    diffusés en realtime : un collègue ne les voyait qu'au poll de 60 s.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Statut « preorder » ──────────────────────────────────────────────────
ALTER TABLE public.vip_table_orders DROP CONSTRAINT IF EXISTS vip_table_orders_status_check;
ALTER TABLE public.vip_table_orders ADD CONSTRAINT vip_table_orders_status_check
  CHECK (status = ANY (ARRAY['preorder', 'pending', 'confirmed', 'preparing', 'served', 'cancelled']));

-- ─── 2. Une table = un groupe installé à la fois ─────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_table_reservations_live_table
  ON public.table_reservations (event_id, assigned_table_id)
  WHERE assigned_table_id IS NOT NULL
    AND vip_status IN ('placed', 'active')
    AND status NOT IN ('cancelled', 'refunded');

CREATE OR REPLACE FUNCTION public.enforce_assigned_table_exists()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue  text;
  v_layout jsonb;
  v_table_changed boolean;
  v_now_seated    boolean;
BEGIN
  -- Libérer une table (assign_on_arrival, fin de service) est toujours permis.
  IF NEW.assigned_table_id IS NULL OR NEW.status IN ('cancelled', 'refunded') THEN
    RETURN NEW;
  END IF;

  v_table_changed := NEW.assigned_table_id IS DISTINCT FROM OLD.assigned_table_id;
  -- Installer un client pré-placé sur SA table, ou rouvrir une table terminée,
  -- ne change pas la colonne mais occupe la table : on vérifie aussi.
  v_now_seated := NEW.vip_status IN ('placed', 'active')
                  AND OLD.vip_status IS DISTINCT FROM NEW.vip_status
                  AND OLD.vip_status NOT IN ('placed', 'active');

  IF NOT v_table_changed AND NOT v_now_seated THEN
    RETURN NEW;
  END IF;

  -- Même verrou que create_manual_table_reservation : deux hôtes qui prennent
  -- la même table au même instant passent l'un après l'autre.
  IF NEW.event_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(NEW.event_id::text || ':' || NEW.assigned_table_id::text, 0));
  END IF;

  SELECT venue_id INTO v_venue FROM public.table_zones WHERE id = NEW.zone_id;

  -- 1) La table doit exister sur le plan de CETTE soirée (plan de la soirée
  --    d'abord, plan du club ensuite — même résolution que la page publique et
  --    l'outil hôte). Un club avec des co-soirées a plusieurs plans.
  IF v_table_changed THEN
    IF NEW.event_id IS NOT NULL THEN
      SELECT layout INTO v_layout
        FROM public.venue_floor_plans
       WHERE event_id = NEW.event_id
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1;
    END IF;
    IF v_layout IS NULL AND v_venue IS NOT NULL THEN
      SELECT layout INTO v_layout
        FROM public.venue_floor_plans
       WHERE venue_id = v_venue AND event_id IS NULL
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1;
    END IF;
    IF v_layout IS NOT NULL AND NOT EXISTS (
      SELECT 1
        FROM jsonb_array_elements(COALESCE(v_layout->'tables', '[]'::jsonb)) AS e
       WHERE e->>'id' = NEW.assigned_table_id::text
    ) THEN
      RAISE EXCEPTION
        'Table "%" does not exist in this event''s floor plan. Refresh the plan and pick an existing table.',
        NEW.assigned_table_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  -- 2) Personne ne doit être INSTALLÉ à cette table ce soir.
  IF EXISTS (
    SELECT 1 FROM public.table_reservations tr2
     WHERE tr2.id <> NEW.id
       AND tr2.event_id = NEW.event_id
       AND tr2.assigned_table_id = NEW.assigned_table_id
       AND tr2.vip_status IN ('placed', 'active')
       AND tr2.status NOT IN ('cancelled', 'refunded')
  ) THEN
    RAISE EXCEPTION 'Table "%" is already taken by another guest tonight.', NEW.assigned_table_id
      USING ERRCODE = 'unique_violation';
  END IF;

  -- 3) Pré-placement (client pas encore installé) : pas deux clients promis à
  --    la même table. Installer quelqu'un sur une table promise à un autre
  --    reste permis — c'est une décision de l'hôte, l'écran la lui fait
  --    confirmer.
  IF NEW.vip_status = 'waiting' AND v_table_changed AND EXISTS (
    SELECT 1 FROM public.table_reservations tr3
     WHERE tr3.id <> NEW.id
       AND tr3.event_id = NEW.event_id
       AND tr3.assigned_table_id = NEW.assigned_table_id
       AND tr3.vip_status = 'waiting'
       AND tr3.status NOT IN ('cancelled', 'refunded')
  ) THEN
    RAISE EXCEPTION 'Table "%" is already promised to another guest.', NEW.assigned_table_id
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- ─── 3. Walk-in : seule une résa qui TIENT la table la bloque ────────────────
CREATE OR REPLACE FUNCTION public.create_manual_table_reservation(p_event_id uuid, p_zone_id uuid, p_full_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_guest_count integer DEFAULT 1, p_total_price numeric DEFAULT 0, p_minimum_spend numeric DEFAULT 0, p_assigned_table_id uuid DEFAULT NULL::uuid, p_remarks text DEFAULT NULL::text, p_open_tab boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_venue      text;
  v_zone_event uuid;
  v_max        integer;
  v_zone_name  text;
  v_used       integer;
  v_email      text := COALESCE(NULLIF(btrim(p_email), ''), '');
  v_org        uuid;
  v_id         uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT venue_id, event_id, tables_count, name
    INTO v_venue, v_zone_event, v_max, v_zone_name
    FROM public.table_zones
   WHERE id = p_zone_id
     FOR UPDATE;
  IF v_venue IS NULL AND v_zone_event IS NULL THEN
    RAISE EXCEPTION 'zone not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_venue IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.events e
       WHERE e.id = p_event_id
         AND (e.venue_id = v_venue OR e.partner_venue_id = v_venue)
    ) THEN
      RAISE EXCEPTION 'event not in venue' USING ERRCODE = '22023';
    END IF;

    IF NOT (
      public.is_venue_owner(v_uid, v_venue)
      OR public.manager_has_permission(v_uid, v_venue, 'tables')
      OR (public.get_user_venue_id(v_uid) = v_venue AND public.has_role(v_uid, 'vip_host'))
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    -- Zone d'une soirée sans club : elle doit appartenir À CETTE soirée, et
    -- l'appelant en être l'organisateur (ou de son équipe).
    IF v_zone_event <> p_event_id THEN
      RAISE EXCEPTION 'zone not in event' USING ERRCODE = '22023';
    END IF;
    SELECT organizer_user_id INTO v_org FROM public.events WHERE id = p_event_id;
    IF NOT (
      public.can_manage_organizer_rooms(v_uid, v_org)
      OR public.is_event_partner_organizer(v_uid, p_event_id)
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Capacité de la zone : une résa terminée, no-show ou refusée a rendu sa
  -- table — le club la refait tourner dans la nuit.
  IF v_max IS NOT NULL AND v_max > 0 THEN
    SELECT COUNT(*) INTO v_used
      FROM public.table_reservations
     WHERE event_id = p_event_id
       AND zone_id = p_zone_id
       AND status IN ('pending', 'paid', 'confirmed')
       AND COALESCE(vip_status, 'waiting') NOT IN ('finished', 'no_show', 'denied');
    IF v_used >= v_max THEN
      RAISE EXCEPTION 'La zone "%" est complète (%/% tables).', v_zone_name, v_used, v_max
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF p_assigned_table_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || p_assigned_table_id::text, 0));
    -- Tient la table : un groupe installé, un client pré-placé qui n'est pas
    -- encore arrivé, une demande de table en attente de réponse.
    IF EXISTS (
      SELECT 1 FROM public.table_reservations r
       WHERE r.event_id = p_event_id
         AND r.status IN ('pending', 'paid', 'confirmed')
         AND (
           (r.assigned_table_id = p_assigned_table_id
             AND COALESCE(r.vip_status, 'waiting') IN ('waiting', 'placed', 'active'))
           OR (r.requested_table_id = p_assigned_table_id
             AND r.assigned_table_id IS NULL
             AND r.placement_status = 'requested'
             AND COALESCE(r.vip_status, 'waiting') = 'waiting')
         )
    ) THEN
      RAISE EXCEPTION 'Cette table est déjà prise.' USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  INSERT INTO public.table_reservations (
    event_id, zone_id, user_id, user_email, is_guest, guest_count,
    deposit, total_price, service_fee, management_fee, fee_absorbed,
    minimum_spend, status, paid_at, full_name, phone, remarks,
    assigned_table_id, placed_by, placed_at, placement_status, vip_status,
    purchase_source, newsletter_opt_in
  ) VALUES (
    p_event_id, p_zone_id, NULL, v_email, true, GREATEST(COALESCE(p_guest_count, 1), 1),
    0,
    CASE WHEN p_open_tab THEN 0 ELSE GREATEST(COALESCE(p_total_price, 0), 0) END,
    0, 0, false,
    GREATEST(COALESCE(p_minimum_spend, 0), 0), 'paid', now(),
    NULLIF(btrim(p_full_name), ''), NULLIF(btrim(p_phone), ''), p_remarks,
    p_assigned_table_id,
    CASE WHEN p_assigned_table_id IS NOT NULL THEN v_uid ELSE NULL END,
    CASE WHEN p_assigned_table_id IS NOT NULL THEN now() ELSE NULL END,
    CASE WHEN p_assigned_table_id IS NOT NULL THEN 'approved' ELSE 'none' END,
    'active',
    CASE WHEN p_open_tab THEN 'manual_open' ELSE 'manual' END,
    (v_email <> '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- ─── 4-5. Service : écritures atomiques, prix lus dans la carte ──────────────

-- Qui peut faire le service VIP d'un club : owner, manager « tables », hôte
-- VIP rattaché au club (et le barman quand il s'agit de SERVIR une commande
-- partie au bar), super admin.
CREATE OR REPLACE FUNCTION public.can_run_vip_service(p_uid uuid, p_venue text, p_include_bar boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p_uid IS NOT NULL AND p_venue IS NOT NULL AND (
    public.is_super_admin()
    OR public.is_venue_owner(p_uid, p_venue)
    OR public.manager_has_permission(p_uid, p_venue, 'tables')
    OR (
      public.get_user_venue_id(p_uid) = p_venue
      AND (
        public.has_role(p_uid, 'vip_host')
        OR public.has_role(p_uid, 'manager')
        OR (p_include_bar AND public.has_role(p_uid, 'barman'))
      )
    )
  )
$function$;

-- Miroir SQL de consumptionItemType() (src/components/vip-service/serviceTypes.ts).
CREATE OR REPLACE FUNCTION public.vip_consumption_item_type(p_category text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_category IS NULL THEN 'bottle'
    WHEN p_category IN ('champagne', 'vodka', 'whisky', 'gin', 'rum', 'tequila', 'cognac', 'wine', 'bottle') THEN 'bottle'
    WHEN p_category IN ('mixer', 'soft') THEN 'extra'
    ELSE 'service'
  END
$function$;

-- Registre d'idempotence des écritures de service : une ligne par envoi du
-- téléphone. RLS sans policy : seules les RPC y écrivent.
CREATE TABLE IF NOT EXISTS public.vip_service_requests (
  id         uuid PRIMARY KEY,
  kind       text NOT NULL,
  result     uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vip_service_requests_created ON public.vip_service_requests (created_at);
ALTER TABLE public.vip_service_requests ENABLE ROW LEVEL SECURITY;

-- Prend une commande pour une table. Staff du club → part au bar en
-- 'confirmed' (l'hôte EST la validation). Client titulaire de la résa →
-- 'pending', l'hôte la confirme. p_items : [{menu_item_id, quantity,
-- parent_menu_item_id?}] — un mixer porte la bouteille qu'il accompagne.
CREATE OR REPLACE FUNCTION public.vip_create_table_order(
  p_reservation_id uuid,
  p_items jsonb,
  p_note text DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_res    record;
  v_staff  boolean;
  v_order  uuid;
  v_total  numeric := 0;
  v_item   jsonb;
  v_menu   record;
  v_qty    integer;
  v_ids    jsonb := '{}'::jsonb;
  v_new    uuid;
  v_prev   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'empty order' USING ERRCODE = '22023';
  END IF;

  IF p_request_id IS NOT NULL THEN
    DELETE FROM public.vip_service_requests WHERE created_at < now() - interval '7 days';
    SELECT result INTO v_prev FROM public.vip_service_requests WHERE id = p_request_id;
    IF FOUND THEN
      RETURN v_prev; -- déjà enregistrée : la réponse s'était perdue
    END IF;
  END IF;

  SELECT tr.id, tr.user_id, tr.status, tr.vip_status, tz.venue_id
    INTO v_res
    FROM public.table_reservations tr
    JOIN public.table_zones tz ON tz.id = tr.zone_id
   WHERE tr.id = p_reservation_id;
  IF NOT FOUND OR v_res.venue_id IS NULL THEN
    RAISE EXCEPTION 'reservation not found' USING ERRCODE = 'P0002';
  END IF;

  v_staff := public.can_run_vip_service(v_uid, v_res.venue_id, false);
  IF NOT v_staff AND v_res.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_res.status <> 'paid' OR COALESCE(v_res.vip_status, 'waiting') IN ('finished', 'no_show', 'denied') THEN
    RAISE EXCEPTION 'reservation closed' USING ERRCODE = '22023';
  END IF;

  -- Validation + total AVANT d'écrire : prix de la carte, jamais du téléphone.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT id, price INTO v_menu
      FROM public.vip_menu_items
     WHERE id = NULLIF(v_item->>'menu_item_id', '')::uuid
       AND venue_id = v_res.venue_id
       AND is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'menu item unavailable' USING ERRCODE = '22023';
    END IF;
    v_qty := LEAST(GREATEST(COALESCE((v_item->>'quantity')::integer, 1), 1), 99);
    v_total := v_total + COALESCE(v_menu.price, 0) * v_qty;
  END LOOP;

  INSERT INTO public.vip_table_orders (
    table_reservation_id, venue_id, user_id, status, total_amount, notes,
    confirmed_at, confirmed_by
  ) VALUES (
    p_reservation_id, v_res.venue_id,
    CASE WHEN v_staff THEN NULL ELSE v_uid END,
    CASE WHEN v_staff THEN 'confirmed' ELSE 'pending' END,
    v_total, NULLIF(btrim(p_note), ''),
    CASE WHEN v_staff THEN now() ELSE NULL END,
    CASE WHEN v_staff THEN v_uid ELSE NULL END
  )
  RETURNING id INTO v_order;

  -- Bouteilles d'abord, puis les mixers reliés à leur bouteille.
  FOR v_item IN
    SELECT * FROM jsonb_array_elements(p_items) e
     WHERE NULLIF(e->>'parent_menu_item_id', '') IS NULL
  LOOP
    SELECT id, price INTO v_menu FROM public.vip_menu_items WHERE id = (v_item->>'menu_item_id')::uuid;
    v_qty := LEAST(GREATEST(COALESCE((v_item->>'quantity')::integer, 1), 1), 99);
    INSERT INTO public.vip_table_order_items (order_id, menu_item_id, quantity, unit_price, is_included)
    VALUES (v_order, v_menu.id, v_qty, COALESCE(v_menu.price, 0), COALESCE(v_menu.price, 0) = 0)
    RETURNING id INTO v_new;
    IF NOT (v_ids ? v_menu.id::text) THEN
      v_ids := v_ids || jsonb_build_object(v_menu.id::text, v_new);
    END IF;
  END LOOP;

  FOR v_item IN
    SELECT * FROM jsonb_array_elements(p_items) e
     WHERE NULLIF(e->>'parent_menu_item_id', '') IS NOT NULL
  LOOP
    SELECT id, price INTO v_menu FROM public.vip_menu_items WHERE id = (v_item->>'menu_item_id')::uuid;
    v_qty := LEAST(GREATEST(COALESCE((v_item->>'quantity')::integer, 1), 1), 99);
    INSERT INTO public.vip_table_order_items (
      order_id, menu_item_id, quantity, unit_price, is_included, parent_order_item_id
    ) VALUES (
      v_order, v_menu.id, v_qty, COALESCE(v_menu.price, 0), COALESCE(v_menu.price, 0) = 0,
      (v_ids->>(v_item->>'parent_menu_item_id'))::uuid
    );
  END LOOP;

  IF p_request_id IS NOT NULL THEN
    INSERT INTO public.vip_service_requests (id, kind, result, created_by)
    VALUES (p_request_id, 'order', v_order, v_uid);
  END IF;

  RETURN v_order;
END;
$function$;

-- Sert une commande : statut + grand livre dans la même transaction, articles
-- relus en base. Rend {served:false, status} si un collègue l'a déjà servie
-- ou annulée — rien n'est compté deux fois.
CREATE OR REPLACE FUNCTION public.vip_serve_table_order(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_order  record;
  v_event  uuid;
  v_source text;
  v_it     record;
  v_ids    jsonb := '{}'::jsonb;
  v_cid    uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order FROM public.vip_table_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_run_vip_service(v_uid, v_order.venue_id, true) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_order.status NOT IN ('pending', 'confirmed', 'preparing') THEN
    RETURN jsonb_build_object('served', false, 'status', v_order.status);
  END IF;

  SELECT event_id INTO v_event FROM public.table_reservations WHERE id = v_order.table_reservation_id;

  UPDATE public.vip_table_orders
     SET status = 'served', served_at = now()
   WHERE id = p_order_id;

  v_source := CASE
    WHEN COALESCE(v_order.notes, '') LIKE 'Pré-commande%' THEN 'preorder'
    WHEN v_order.user_id IS NOT NULL THEN 'qr'
    ELSE 'staff'
  END;

  FOR v_it IN
    SELECT i.id, i.menu_item_id, i.quantity, i.unit_price, m.name, m.category, m.brand
      FROM public.vip_table_order_items i
      LEFT JOIN public.vip_menu_items m ON m.id = i.menu_item_id
     WHERE i.order_id = p_order_id AND i.parent_order_item_id IS NULL
     ORDER BY i.created_at, i.id
  LOOP
    INSERT INTO public.vip_consumptions (
      table_reservation_id, venue_id, event_id, item_name, item_type, quantity,
      unit_price, total_price, served_by, menu_item_id, category, brand, source
    ) VALUES (
      v_order.table_reservation_id, v_order.venue_id, v_event, COALESCE(v_it.name, '—'),
      public.vip_consumption_item_type(v_it.category), v_it.quantity,
      v_it.unit_price, v_it.unit_price * v_it.quantity, v_uid, v_it.menu_item_id,
      v_it.category, v_it.brand, v_source
    ) RETURNING id INTO v_cid;
    v_ids := v_ids || jsonb_build_object(v_it.id::text, v_cid);
  END LOOP;

  FOR v_it IN
    SELECT i.id, i.menu_item_id, i.quantity, i.unit_price, i.parent_order_item_id, m.name, m.category, m.brand
      FROM public.vip_table_order_items i
      LEFT JOIN public.vip_menu_items m ON m.id = i.menu_item_id
     WHERE i.order_id = p_order_id AND i.parent_order_item_id IS NOT NULL
     ORDER BY i.created_at, i.id
  LOOP
    INSERT INTO public.vip_consumptions (
      table_reservation_id, venue_id, event_id, item_name, item_type, quantity,
      unit_price, total_price, served_by, menu_item_id, category, brand, source,
      parent_consumption_id
    ) VALUES (
      v_order.table_reservation_id, v_order.venue_id, v_event, COALESCE(v_it.name, '—'),
      public.vip_consumption_item_type(v_it.category), v_it.quantity,
      v_it.unit_price, v_it.unit_price * v_it.quantity, v_uid, v_it.menu_item_id,
      v_it.category, v_it.brand, v_source,
      (v_ids->>(v_it.parent_order_item_id::text))::uuid
    );
  END LOOP;

  -- La table passe en service à la première conso.
  UPDATE public.table_reservations
     SET vip_status = 'active'
   WHERE id = v_order.table_reservation_id AND vip_status = 'placed';

  RETURN jsonb_build_object('served', true, 'status', 'served');
END;
$function$;

-- Service direct (« déjà servi ») : le grand livre en une écriture.
-- p_items : [{menu_item_id | quick_item_id, quantity, parent_menu_item_id?}].
-- Rend le nombre de lignes écrites (0 = envoi déjà enregistré).
CREATE OR REPLACE FUNCTION public.vip_serve_items(
  p_reservation_id uuid,
  p_items jsonb,
  p_note text DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_res   record;
  v_item  jsonb;
  v_menu  record;
  v_quick record;
  v_qty   integer;
  v_ids   jsonb := '{}'::jsonb;
  v_cid   uuid;
  v_count integer := 0;
  v_note  text := NULLIF(btrim(p_note), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'empty order' USING ERRCODE = '22023';
  END IF;

  IF p_request_id IS NOT NULL THEN
    DELETE FROM public.vip_service_requests WHERE created_at < now() - interval '7 days';
    IF EXISTS (SELECT 1 FROM public.vip_service_requests WHERE id = p_request_id) THEN
      RETURN 0;
    END IF;
  END IF;

  SELECT tr.id, tr.event_id, tr.status, tz.venue_id
    INTO v_res
    FROM public.table_reservations tr
    JOIN public.table_zones tz ON tz.id = tr.zone_id
   WHERE tr.id = p_reservation_id;
  IF NOT FOUND OR v_res.venue_id IS NULL THEN
    RAISE EXCEPTION 'reservation not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_run_vip_service(v_uid, v_res.venue_id, false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_res.status <> 'paid' THEN
    RAISE EXCEPTION 'reservation closed' USING ERRCODE = '22023';
  END IF;

  -- Lignes principales (bouteilles, boutons rapides).
  FOR v_item IN
    SELECT * FROM jsonb_array_elements(p_items) e
     WHERE NULLIF(e->>'parent_menu_item_id', '') IS NULL
  LOOP
    v_qty := LEAST(GREATEST(COALESCE((v_item->>'quantity')::integer, 1), 1), 99);
    IF NULLIF(v_item->>'menu_item_id', '') IS NOT NULL THEN
      SELECT id, name, category, brand, price INTO v_menu
        FROM public.vip_menu_items
       WHERE id = (v_item->>'menu_item_id')::uuid AND venue_id = v_res.venue_id AND is_active;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'menu item unavailable' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.vip_consumptions (
        table_reservation_id, venue_id, event_id, item_name, item_type, quantity,
        unit_price, total_price, served_by, menu_item_id, category, brand, source, notes
      ) VALUES (
        p_reservation_id, v_res.venue_id, v_res.event_id, v_menu.name,
        public.vip_consumption_item_type(v_menu.category), v_qty,
        COALESCE(v_menu.price, 0), COALESCE(v_menu.price, 0) * v_qty, v_uid, v_menu.id,
        v_menu.category, v_menu.brand, 'staff', v_note
      ) RETURNING id INTO v_cid;
      IF NOT (v_ids ? v_menu.id::text) THEN
        v_ids := v_ids || jsonb_build_object(v_menu.id::text, v_cid);
      END IF;
    ELSE
      SELECT id, name, item_type, default_price INTO v_quick
        FROM public.vip_quick_items
       WHERE id = NULLIF(v_item->>'quick_item_id', '')::uuid AND venue_id = v_res.venue_id AND is_active;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'menu item unavailable' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.vip_consumptions (
        table_reservation_id, venue_id, event_id, item_name, item_type, quantity,
        unit_price, total_price, served_by, source, notes
      ) VALUES (
        p_reservation_id, v_res.venue_id, v_res.event_id, v_quick.name,
        COALESCE(v_quick.item_type, 'service'), v_qty,
        COALESCE(v_quick.default_price, 0), COALESCE(v_quick.default_price, 0) * v_qty, v_uid,
        'staff', v_note
      );
    END IF;
    v_count := v_count + 1;
  END LOOP;

  -- Mixers, reliés à leur bouteille.
  FOR v_item IN
    SELECT * FROM jsonb_array_elements(p_items) e
     WHERE NULLIF(e->>'parent_menu_item_id', '') IS NOT NULL
  LOOP
    v_qty := LEAST(GREATEST(COALESCE((v_item->>'quantity')::integer, 1), 1), 99);
    SELECT id, name, category, brand, price INTO v_menu
      FROM public.vip_menu_items
     WHERE id = NULLIF(v_item->>'menu_item_id', '')::uuid AND venue_id = v_res.venue_id AND is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'menu item unavailable' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.vip_consumptions (
      table_reservation_id, venue_id, event_id, item_name, item_type, quantity,
      unit_price, total_price, served_by, menu_item_id, category, brand, source,
      parent_consumption_id
    ) VALUES (
      p_reservation_id, v_res.venue_id, v_res.event_id, v_menu.name, 'extra', v_qty,
      COALESCE(v_menu.price, 0), COALESCE(v_menu.price, 0) * v_qty, v_uid, v_menu.id,
      v_menu.category, v_menu.brand, 'staff',
      (v_ids->>(v_item->>'parent_menu_item_id'))::uuid
    );
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.table_reservations
     SET vip_status = 'active'
   WHERE id = p_reservation_id AND vip_status = 'placed';

  IF p_request_id IS NOT NULL THEN
    INSERT INTO public.vip_service_requests (id, kind, result, created_by)
    VALUES (p_request_id, 'serve', p_reservation_id, v_uid);
  END IF;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.can_run_vip_service(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vip_create_table_order(uuid, jsonb, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vip_serve_table_order(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vip_serve_items(uuid, jsonb, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_run_vip_service(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vip_create_table_order(uuid, jsonb, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vip_serve_table_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vip_serve_items(uuid, jsonb, text, uuid) TO authenticated;

-- ─── 6. Un client ne réécrit pas sa commande ─────────────────────────────────
-- L'ancienne policy laissait le titulaire modifier TOUTE colonne de sa
-- commande (statut, montant, résa visée). Aucun écran client n'écrit dans
-- cette table après l'envoi : on ne garde que l'owner.
DROP POLICY IF EXISTS "Venue owners/staff can update orders" ON public.vip_table_orders;
CREATE POLICY "Venue owners can update orders" ON public.vip_table_orders
  FOR UPDATE TO authenticated
  USING (public.is_venue_owner(auth.uid(), venue_id))
  WITH CHECK (public.is_venue_owner(auth.uid(), venue_id));

-- ─── 7. Moments de service en realtime ───────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'vip_service_moments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vip_service_moments;
  END IF;
END $$;
