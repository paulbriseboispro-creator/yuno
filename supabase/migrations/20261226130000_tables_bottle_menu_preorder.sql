-- Tables VIP, vague C1 — P5.2 / P5.3 (D8) carte de bouteilles d'une soirée et précommande SANS paiement.
--
-- D8 : on rouvre UNIQUEMENT la carte bouteilles d'une table et une précommande qui n'est pas payée en ligne. Le bar reste en pause.
--
-- 1. `vip_menu_items` accepte `event_id` (carte propre à une soirée, organisateur sans club) : CHECK club OU soirée (exactement
--    un des deux), droits d'écriture = gestion des tables de la soirée (`can_manage_event_tables`), lecture publique des articles
--    actifs comme avant.
-- 2. Périmètre de la carte d'une soirée, UNE règle (`_table_menu_scope`) : la carte du club effectif (venue_id ?? partner_venue_id)
--    quand il y en a un, sinon la carte de la soirée. Lecture client : `get_table_menu(event)`.
-- 3. Précommande relue EN BASE : `table_preorder_check(event, items)` (validation, avant de créer la réservation) et
--    `create_table_preorder(réservation, items)` (écriture atomique) ne prennent du navigateur que {menuItemId, quantity} : prix
--    et noms viennent de la carte. Article d'un autre périmètre / inactif / inconnu = refus, quantités bornées (1 à 20 par ligne,
--    20 lignes). Écrite en `vip_table_orders` statut `preorder`, « à régler sur place » ; rien n'entre dans la session Stripe, le CA
--    en ligne ni la facture. `vip_table_orders.venue_id` devient facultatif (soirée d'organisateur sans club) et porte `event_id`.
-- 4. `organizer_vip_rooms.menu` : la carte suit la salle VIP (save_event_vip_room / apply_vip_room_to_event).
-- 5. `included_bottles_quota` : ni écrit ni lu par les salles VIP (la colonne reste, jamais supprimée).
-- 6. `get_table_receipt` rend `preorder` ({total, items}) pour la confirmation de l'acheteur.

-- ── 1. vip_menu_items : carte de soirée ─────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.vip_menu_items ALTER COLUMN venue_id DROP NOT NULL;
ALTER TABLE public.vip_menu_items ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE CASCADE;
ALTER TABLE public.vip_menu_items DROP CONSTRAINT IF EXISTS vip_menu_items_scope_chk;
ALTER TABLE public.vip_menu_items ADD CONSTRAINT vip_menu_items_scope_chk CHECK ((venue_id IS NOT NULL) <> (event_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_vip_menu_items_event ON public.vip_menu_items (event_id) WHERE event_id IS NOT NULL;

DROP POLICY IF EXISTS "Event table managers manage event menu items" ON public.vip_menu_items;
CREATE POLICY "Event table managers manage event menu items" ON public.vip_menu_items
  FOR ALL TO authenticated
  USING (event_id IS NOT NULL AND public.can_manage_event_tables(auth.uid(), event_id))
  WITH CHECK (event_id IS NOT NULL AND public.can_manage_event_tables(auth.uid(), event_id));

-- ── 2. vip_table_orders : soirée sans club ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.vip_table_orders ALTER COLUMN venue_id DROP NOT NULL;
ALTER TABLE public.vip_table_orders ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE CASCADE;
ALTER TABLE public.vip_table_orders DROP CONSTRAINT IF EXISTS vip_table_orders_scope_chk;
ALTER TABLE public.vip_table_orders ADD CONSTRAINT vip_table_orders_scope_chk CHECK (venue_id IS NOT NULL OR event_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_vip_table_orders_event ON public.vip_table_orders (event_id) WHERE event_id IS NOT NULL;

-- La soirée d'une commande vient de sa réservation (tous les écrivains, personnel du club compris).
CREATE OR REPLACE FUNCTION public.vip_table_orders_set_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.event_id IS NULL THEN
    SELECT event_id INTO NEW.event_id FROM public.table_reservations WHERE id = NEW.table_reservation_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_vip_table_orders_set_event ON public.vip_table_orders;
CREATE TRIGGER trg_vip_table_orders_set_event BEFORE INSERT ON public.vip_table_orders
  FOR EACH ROW EXECUTE FUNCTION public.vip_table_orders_set_event();
REVOKE ALL ON FUNCTION public.vip_table_orders_set_event() FROM PUBLIC, anon, authenticated;

-- Lecture / mise à jour par la gestion de la soirée (Service VIP d'un organisateur sans club : pas de venue_id).
DROP POLICY IF EXISTS "Event table managers view event orders" ON public.vip_table_orders;
CREATE POLICY "Event table managers view event orders" ON public.vip_table_orders
  FOR SELECT TO authenticated
  USING (event_id IS NOT NULL AND public.can_manage_event_vip_tables(auth.uid(), event_id));
DROP POLICY IF EXISTS "Event table managers update event orders" ON public.vip_table_orders;
CREATE POLICY "Event table managers update event orders" ON public.vip_table_orders
  FOR UPDATE TO authenticated
  USING (event_id IS NOT NULL AND public.can_manage_event_vip_tables(auth.uid(), event_id))
  WITH CHECK (event_id IS NOT NULL AND public.can_manage_event_vip_tables(auth.uid(), event_id));

DROP POLICY IF EXISTS "Order items visible to event table managers" ON public.vip_table_order_items;
CREATE POLICY "Order items visible to event table managers" ON public.vip_table_order_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.vip_table_orders o
                  WHERE o.id = vip_table_order_items.order_id
                    AND o.event_id IS NOT NULL AND public.can_manage_event_vip_tables(auth.uid(), o.event_id)));

-- ── 3. Périmètre de la carte, lecture client, précommande ──────────────────────────────────────────────────────────────
-- Une seule règle : club effectif (hôte, sinon partenaire) → sa carte ; sinon la carte de la soirée.
CREATE OR REPLACE FUNCTION public._table_menu_scope(p_event_id uuid)
RETURNS TABLE (venue_id text, event_id uuid)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(e.venue_id, e.partner_venue_id) AS venue_id,
         CASE WHEN COALESCE(e.venue_id, e.partner_venue_id) IS NULL THEN e.id END AS event_id
    FROM public.events e WHERE e.id = p_event_id;
$$;

CREATE OR REPLACE FUNCTION public.get_table_menu(p_event_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', m.id, 'name', m.name, 'description', m.description, 'category', m.category, 'brand', m.brand,
           'volume_cl', m.volume_cl,
           -- « Sans les prix » choisi par le club : la carte se montre, pas les prix.
           'price', CASE WHEN v.vip_menu_visibility = 'no_prices' THEN NULL ELSE m.price END, 'image_url', m.image_url,
           'needs_mixer', m.needs_mixer, 'max_mixers', m.max_mixers, 'position', m.position
         ) ORDER BY m.position NULLS LAST, m.created_at), '[]'::jsonb)
    FROM public._table_menu_scope(p_event_id) s
    LEFT JOIN public.venues v ON v.id = s.venue_id
    JOIN public.vip_menu_items m
      ON m.is_active
     AND ((s.venue_id IS NOT NULL AND m.venue_id = s.venue_id) OR (s.event_id IS NOT NULL AND m.event_id = s.event_id))
   -- D17 : un club qui cache sa carte n'en montre aucune (la carte d'une soirée sans club se montre toujours).
   WHERE s.venue_id IS NULL OR v.vip_menu_visibility IS DISTINCT FROM 'hidden';
$$;

-- Validation d'une précommande : rend les lignes RELUES en base ({id, name, quantity, unit_price}) et le total, ou lève
-- invalid_preorder:<raison> (SQLSTATE YU020). Rien d'autre que {menuItemId, quantity} n'est lu du navigateur.
CREATE OR REPLACE FUNCTION public.table_preorder_check(p_event_id uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_scope  record;
  v_lines  jsonb := '[]'::jsonb;
  v_total  numeric := 0;
  v_in     record;
  v_item   record;
  v_n      integer := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('lines', '[]'::jsonb, 'total', 0);
  END IF;
  IF jsonb_array_length(p_items) > 20 THEN
    RAISE EXCEPTION 'invalid_preorder:too_many_lines' USING ERRCODE = 'YU020';
  END IF;

  SELECT * INTO v_scope FROM public._table_menu_scope(p_event_id);
  IF NOT FOUND OR (v_scope.venue_id IS NULL AND v_scope.event_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_preorder:no_menu' USING ERRCODE = 'YU020';
  END IF;
  -- D17 : précommande refusée quand le club a caché sa carte ou coupé la précommande.
  IF v_scope.venue_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.venues v
     WHERE v.id = v_scope.venue_id AND v.vip_menu_visibility <> 'hidden' AND v.vip_preorder_enabled
  ) THEN
    RAISE EXCEPTION 'invalid_preorder:no_menu' USING ERRCODE = 'YU020';
  END IF;

  -- Une ligne par article (les doublons s'additionnent), quantité entière de 1 à 20.
  FOR v_in IN
    SELECT i.id, sum(i.qty)::integer AS qty
      FROM (
        SELECT CASE WHEN (x->>'menuItemId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (x->>'menuItemId')::uuid END AS id,
               CASE WHEN (x->>'quantity') ~ '^[0-9]{1,3}$' THEN (x->>'quantity')::integer ELSE 0 END AS qty
          FROM jsonb_array_elements(p_items) x
      ) i
     GROUP BY i.id
  LOOP
    IF v_in.id IS NULL THEN
      RAISE EXCEPTION 'invalid_preorder:item_not_found' USING ERRCODE = 'YU020';
    END IF;
    IF v_in.qty < 1 OR v_in.qty > 20 THEN
      RAISE EXCEPTION 'invalid_preorder:bad_quantity' USING ERRCODE = 'YU020';
    END IF;
    SELECT m.id, m.name, m.price INTO v_item
      FROM public.vip_menu_items m
     WHERE m.id = v_in.id AND m.is_active
       AND ((v_scope.venue_id IS NOT NULL AND m.venue_id = v_scope.venue_id)
            OR (v_scope.event_id IS NOT NULL AND m.event_id = v_scope.event_id));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_preorder:item_not_found' USING ERRCODE = 'YU020';
    END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'id', v_item.id, 'name', v_item.name, 'quantity', v_in.qty, 'unit_price', v_item.price));
    v_total := v_total + v_item.price * v_in.qty;
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('lines', v_lines, 'total', round(v_total, 2));
END;
$$;

-- Écriture atomique (service_role : create-table-checkout). Idempotente : une réservation n'a qu'UNE précommande.
-- Une seule précommande par réservation.
CREATE UNIQUE INDEX IF NOT EXISTS vip_table_orders_one_preorder_uidx
  ON public.vip_table_orders (table_reservation_id) WHERE status = 'preorder';

CREATE OR REPLACE FUNCTION public.create_table_preorder(p_reservation_id uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r        public.table_reservations%ROWTYPE;
  v_check  jsonb;
  v_scope  record;
  v_order  uuid;
  v_line   jsonb;
BEGIN
  SELECT * INTO r FROM public.table_reservations WHERE id = p_reservation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF r.status NOT IN ('pending', 'paid', 'confirmed') THEN
    RAISE EXCEPTION 'reservation_not_active' USING ERRCODE = 'YU013';
  END IF;

  v_check := public.table_preorder_check(r.event_id, p_items);
  IF jsonb_array_length(v_check->'lines') = 0 THEN
    RETURN jsonb_build_object('order_id', NULL, 'total', 0, 'lines', '[]'::jsonb);
  END IF;

  -- Deux appels simultanés : le second attend le premier, puis voit sa précommande (l'index unique ci-dessous est le filet).
  PERFORM pg_advisory_xact_lock(hashtextextended('yuno_table_preorder:' || r.id::text, 0));
  SELECT id INTO v_order FROM public.vip_table_orders WHERE table_reservation_id = r.id AND status = 'preorder' LIMIT 1;
  IF v_order IS NOT NULL THEN
    RETURN jsonb_build_object('order_id', v_order, 'total', (SELECT total_amount FROM public.vip_table_orders WHERE id = v_order),
                              'lines', v_check->'lines', 'already', true);
  END IF;

  SELECT * INTO v_scope FROM public._table_menu_scope(r.event_id);
  INSERT INTO public.vip_table_orders (table_reservation_id, venue_id, event_id, user_id, status, total_amount, notes)
  VALUES (r.id, v_scope.venue_id, r.event_id, r.user_id, 'preorder', (v_check->>'total')::numeric,
          'Pré-commande (checkout) · à régler sur place')
  RETURNING id INTO v_order;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_check->'lines') LOOP
    INSERT INTO public.vip_table_order_items (order_id, menu_item_id, quantity, unit_price, is_included)
    VALUES (v_order, (v_line->>'id')::uuid, (v_line->>'quantity')::integer, (v_line->>'unit_price')::numeric, false);
  END LOOP;

  RETURN jsonb_build_object('order_id', v_order, 'total', (v_check->>'total')::numeric, 'lines', v_check->'lines');
END;
$$;

-- Récap de la précommande d'une réservation (confirmation, reçu) : NULL sans précommande.
CREATE OR REPLACE FUNCTION public._table_preorder_summary(p_reservation_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
           'order_id', o.id, 'status', o.status, 'total', o.total_amount, 'payment', 'on_site',
           'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', m.name, 'quantity', i.quantity, 'unit_price', i.unit_price)
                                              ORDER BY i.created_at)
                                FROM public.vip_table_order_items i JOIN public.vip_menu_items m ON m.id = i.menu_item_id
                               WHERE i.order_id = o.id), '[]'::jsonb))
    FROM public.vip_table_orders o
   WHERE o.table_reservation_id = p_reservation_id AND o.status <> 'cancelled'
   ORDER BY (o.status = 'preorder') DESC, o.created_at
   LIMIT 1;
$$;

-- ── 4. La carte suit la salle VIP ───────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.organizer_vip_rooms ADD COLUMN IF NOT EXISTS menu jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  -- save_event_vip_room : la carte de la soirée entre dans la salle ; plus de quota de bouteilles.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'save_event_vip_room';
  v_new := v_def;
  v_new := replace(v_new, E'  v_packs   jsonb;\n  v_id      uuid;', E'  v_packs   jsonb;\n  v_menu    jsonb;\n  v_id      uuid;');
  v_new := replace(v_new, E'''included_items'', p.included_items, ''included_bottles_quota'', p.included_bottles_quota,', E'''included_items'', p.included_items,');
  v_new := replace(v_new, E'    FROM public.table_packs p WHERE p.event_id = p_event_id;\n',
    E'    FROM public.table_packs p WHERE p.event_id = p_event_id;\n\n  SELECT COALESCE(jsonb_agg(jsonb_build_object(\n           ''name'', m.name, ''description'', m.description, ''category'', m.category, ''brand'', m.brand,\n           ''volume_cl'', m.volume_cl, ''price'', m.price, ''image_url'', m.image_url, ''is_active'', m.is_active,\n           ''position'', m.position, ''needs_mixer'', m.needs_mixer, ''max_mixers'', m.max_mixers\n         ) ORDER BY m.position NULLS LAST, m.created_at), ''[]''::jsonb)\n    INTO v_menu\n    FROM public.vip_menu_items m WHERE m.event_id = p_event_id;\n');
  v_new := replace(v_new, E'           packs = v_packs,\n           source_event_id = p_event_id,', E'           packs = v_packs,\n           menu = v_menu,\n           source_event_id = p_event_id,');
  v_new := replace(v_new, E'zones, packs, source_event_id)\n  VALUES\n    (v_org, v_name, v_loc, v_addr, COALESCE(v_layout, ''{"tables": []}''::jsonb), v_bg, v_zones, v_packs, p_event_id)',
                          E'zones, packs, menu, source_event_id)\n  VALUES\n    (v_org, v_name, v_loc, v_addr, COALESCE(v_layout, ''{"tables": []}''::jsonb), v_bg, v_zones, v_packs, v_menu, p_event_id)');
  IF v_new = v_def OR v_new NOT LIKE '%menu = v_menu%' OR v_new NOT LIKE '%v_packs, v_menu, p_event_id%' OR v_new LIKE '%included_bottles_quota%' THEN
    RAISE EXCEPTION 'patch save_event_vip_room: motif introuvable';
  END IF;
  EXECUTE v_new;

  -- apply_vip_room_to_event : plus de quota de bouteilles ; la carte de la salle remplace celle de la soirée.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'apply_vip_room_to_event';
  v_new := v_def;
  v_new := replace(v_new, E'deposit, deposit_type, included_items, included_bottles_quota,', E'deposit, deposit_type, included_items,');
  v_new := replace(v_new, E'         v_pack->>''included_items'',\n         COALESCE((v_pack->>''included_bottles_quota'')::int, 0),\n', E'         v_pack->>''included_items'',\n');
  v_new := replace(v_new, E'  DELETE FROM public.venue_floor_plans WHERE event_id = p_event_id;\n',
    E'  DELETE FROM public.venue_floor_plans WHERE event_id = p_event_id;\n\n  -- La carte de bouteilles suit la salle (jamais écrasée par une salle sans carte). Un article déjà commandé est désactivé, pas supprimé.\n  IF jsonb_array_length(COALESCE(v_room.menu, ''[]''::jsonb)) > 0 THEN\n    DELETE FROM public.vip_menu_items m WHERE m.event_id = p_event_id\n       AND NOT EXISTS (SELECT 1 FROM public.vip_table_order_items i WHERE i.menu_item_id = m.id);\n    UPDATE public.vip_menu_items SET is_active = false WHERE event_id = p_event_id;\n    INSERT INTO public.vip_menu_items (event_id, name, description, category, brand, volume_cl, price, image_url, is_active, position, needs_mixer, max_mixers)\n    SELECT p_event_id, x->>''name'', x->>''description'', COALESCE(x->>''category'', ''other''), x->>''brand'',\n           NULLIF(x->>''volume_cl'', '''')::int, COALESCE((x->>''price'')::numeric, 0), x->>''image_url'',\n           COALESCE((x->>''is_active'')::boolean, true), COALESCE((x->>''position'')::int, 0),\n           COALESCE((x->>''needs_mixer'')::boolean, false), GREATEST(COALESCE((x->>''max_mixers'')::int, 1), 1)\n      FROM jsonb_array_elements(v_room.menu) x;\n  END IF;\n');
  IF v_new = v_def OR v_new NOT LIKE '%v_room.menu%' OR v_new LIKE '%included_bottles_quota%' THEN
    RAISE EXCEPTION 'patch apply_vip_room_to_event: motif introuvable';
  END IF;
  EXECUTE v_new;

  -- get_table_receipt : la précommande de l'acheteur (page de confirmation, Mes commandes).
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_table_receipt';
  v_new := replace(v_def, E'    ''guests'', v_guests\n  );', E'    ''guests'', v_guests,\n    ''preorder'', public._table_preorder_summary(r.id)\n  );');
  IF v_new = v_def THEN RAISE EXCEPTION 'patch get_table_receipt: motif introuvable'; END IF;
  EXECUTE v_new;
END
$patch$;

-- ── 5. Droits ───────────────────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._table_menu_scope(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_table_menu(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.table_preorder_check(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_table_preorder(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._table_preorder_summary(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._table_menu_scope(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_table_menu(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.table_preorder_check(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_table_preorder(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public._table_preorder_summary(uuid) TO service_role;
