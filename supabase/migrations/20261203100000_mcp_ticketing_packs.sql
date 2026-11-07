-- ============================================================================
-- MCP : l'IA range les billets d'une soirée dans des PACKS (2026-11-07).
-- set_ticketing sait désormais : `packs` (liste des packs de la soirée : nom,
-- phrase), `pack` sur chaque billet (nom ou id d'un pack), `description` d'un
-- billet (200 caractères) et `drink_until` (« boisson offerte jusqu'à 02:00 »,
-- heure limite fixe). get_ticketing rend les packs, et pour chaque billet son
-- pack, sa description et l'heure limite de sa boisson.
--
-- Règles : `packs` donné = la liste COMPLÈTE (un pack laissé de côté est
-- supprimé, ses billets sortent du pack) ; omis = les packs restent, les
-- billets s'y rangent par leur nom. Sur un billet existant, `pack`,
-- `description` et `drink_until` omis = inchangés ; null / texte vide = retirés.
-- Reprise de la définition VIVANTE de _mcp_ticketing et _mcp_ticketing_view
-- (identique à 20261107140000, vérifiée par pg_get_functiondef le 07/11).
-- ============================================================================

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public._mcp_ticketing_view(p_event uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'event', jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'end_at', e.end_at,
                                'timezone', coalesce(e.timezone, 'Europe/Paris')),
    'ticketing_on_sale', coalesce(e.ticketing_enabled, false),
    'selling_mode', coalesce(e.ticket_selling_mode, 'rounds'),
    'capacity', e.max_tickets,
    'sold_total', coalesce((SELECT sum(r.tickets_sold) FROM public.ticket_rounds r WHERE r.event_id = e.id), 0),
    'packs', coalesce((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'description', g.description,
                'tickets', (SELECT count(*) FROM public.ticket_rounds x WHERE x.group_id = g.id)) ORDER BY g.position, g.created_at)
      FROM public.ticket_groups g WHERE g.event_id = e.id), '[]'::jsonb),
    'tickets', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'price', r.price,
        'quantity', CASE WHEN r.max_tickets >= 999999 THEN NULL ELSE r.max_tickets END,
        'sold', r.tickets_sold,
        'entry_before', to_char(r.entry_deadline, 'HH24:MI'),
        'includes_drink', coalesce(r.includes_drink, false),
        'drink_until', CASE WHEN coalesce(r.includes_drink, false) AND r.drink_deadline_type = 'fixed_time' THEN to_char(r.drink_cutoff_time, 'HH24:MI') END,
        'description', r.description,
        'pack', (SELECT g.name FROM public.ticket_groups g WHERE g.id = r.group_id),
        'pack_id', r.group_id,
        'visibility', CASE WHEN r.hidden THEN 'hidden' WHEN r.visible_from IS NOT NULL THEN 'at' ELSE 'now' END,
        'visible_from', r.visible_from,
        'sale', CASE WHEN r.opens_after_round_id IS NOT NULL THEN 'after'
                     WHEN NOT r.is_active AND NOT coalesce(r.manually_sold_out, false) AND r.tickets_sold < r.max_tickets THEN 'manual'
                     WHEN r.sale_starts_at IS NOT NULL THEN 'at' ELSE 'now' END,
        'sale_starts_at', r.sale_starts_at, 'sale_ends_at', r.sale_ends_at,
        'opens_after', r.opens_after_round_id,
        'opens_after_name', (SELECT p.name FROM public.ticket_rounds p WHERE p.id = r.opens_after_round_id),
        'status', CASE
          WHEN coalesce(r.manually_sold_out, false) OR r.tickets_sold >= r.max_tickets THEN 'sold_out'
          WHEN r.hidden OR (r.visible_from IS NOT NULL AND r.visible_from > now()) THEN 'hidden'
          WHEN r.sale_ends_at IS NOT NULL AND r.sale_ends_at <= now() THEN 'ended'
          WHEN NOT r.is_active AND r.opens_after_round_id IS NOT NULL THEN 'waiting_previous'
          WHEN NOT r.is_active THEN 'not_open'
          WHEN r.sale_starts_at IS NOT NULL AND r.sale_starts_at > now() THEN 'scheduled'
          ELSE 'on_sale' END
      ) ORDER BY r.position, r.created_at)
      FROM public.ticket_rounds r WHERE r.event_id = e.id), '[]'::jsonb))
  FROM public.events e WHERE e.id = p_event
$function$;

CREATE OR REPLACE FUNCTION public._mcp_ticketing(p_tool text, p_kind text, p_space_id text, p_args jsonb, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_args   jsonb := coalesce(p_args, '{}'::jsonb);
  v_venue  text := CASE WHEN p_kind = 'venue' THEN p_space_id END;
  v_org    uuid := CASE WHEN p_kind <> 'venue' THEN p_space_id::uuid END;
  v_event  uuid;
  e        public.events%ROWTYPE;
  v_sold   integer;
  v_list   jsonb := v_args->'tickets';
  v_n      integer;
  t        jsonb;
  i        integer;
  v_ids    uuid[] := '{}';
  v_keys   text[] := '{}';
  v_names  text[] := '{}';
  v_links  uuid[] := '{}';
  v_id     uuid;
  v_key    text;
  v_ref    text;
  v_j      integer;
  v_bad    text;
  v_cursor uuid;
  v_steps  integer;
  v_sale   text;
  v_vis    text;
  v_qty    integer;
  v_price  numeric;
  v_entry  text;
  v_vfrom  timestamptz;
  v_sstart timestamptz;
  v_send   timestamptz;
  v_drink  boolean;
  r        public.ticket_rounds%ROWTYPE;
  v_created integer := 0;
  v_updated integer := 0;
  v_removed integer := 0;
  -- Packs (ticket_groups) : liste de la soirée, billets rangés dedans.
  v_packs   jsonb := v_args->'packs';
  v_pack_given boolean := false;
  v_pn      integer;
  pk        jsonb;
  v_pids    uuid[] := '{}';
  v_pnames  text[] := '{}';
  v_pdescs  text[] := '{}';
  v_pk_removed integer := 0;
  v_tg      uuid[] := '{}';
  v_tg_set  boolean[] := '{}';
  v_td      text[] := '{}';
  v_td_set  boolean[] := '{}';
  v_du      text;
  v_dus     text[] := '{}';
  v_pref    text;
BEGIN
  v_event := public._mcp_resolve_event(coalesce(nullif(btrim(v_args->>'event'), ''), 'next'),
                                       public._mcp_email_scope_events(v_venue, v_org, 'suite'));
  IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
  SELECT * INTO e FROM public.events WHERE id = v_event;
  IF e.external_source IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'external_event'); END IF;

  -- Les droits de la Console sur la billetterie (policies de ticket_rounds).
  IF NOT (
       (e.venue_id IS NOT NULL AND (public.is_venue_owner(p_uid, e.venue_id) OR public.manager_has_permission(p_uid, e.venue_id, 'tickets')))
    OR (e.organizer_user_id = p_uid AND e.venue_id IS NULL)
    OR public.can_manage_event_tables(p_uid, e.id)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'write_forbidden');
  END IF;

  IF p_tool = 'get_ticketing' THEN
    RETURN jsonb_build_object('ok', true) || public._mcp_ticketing_view(e.id);
  END IF;

  -- ── set_ticketing ─────────────────────────────────────────────────────────
  IF coalesce(e.end_at, e.start_at + interval '8 hours') < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'event_over');
  END IF;
  IF coalesce(e.ticketing_enabled, false) AND coalesce((v_args->>'apply_to_live')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ticketing_live');
  END IF;
  SELECT coalesce(sum(tickets_sold), 0) INTO v_sold FROM public.ticket_rounds WHERE event_id = e.id;
  IF coalesce(e.ticket_selling_mode, 'rounds') <> 'free' AND v_sold > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mode_has_sales');
  END IF;
  IF jsonb_typeof(v_list) <> 'array' THEN RETURN jsonb_build_object('ok', false, 'error', 'tickets_required'); END IF;
  v_n := jsonb_array_length(v_list);
  IF v_n < 1 OR v_n > 40 THEN RETURN jsonb_build_object('ok', false, 'error', 'tickets_count'); END IF;

  -- 0) Les packs. « packs » donné = la liste COMPLÈTE de la soirée (un pack
  -- laissé de côté est supprimé, ses billets sortent du pack) ; omis = les
  -- packs actuels restent tels quels et les billets s'y rangent par leur nom.
  IF v_args ? 'packs' AND jsonb_typeof(v_packs) NOT IN ('array', 'null') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pack', 'message', 'packs must be a list');
  END IF;
  v_pack_given := jsonb_typeof(v_packs) = 'array';
  IF v_pack_given THEN
    v_pn := jsonb_array_length(v_packs);
    IF v_pn > 20 THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_pack', 'message', 'at most 20 packs'); END IF;
    FOR i IN 0 .. v_pn - 1 LOOP
      pk := v_packs->i;
      IF jsonb_typeof(pk) <> 'object' OR length(btrim(coalesce(pk->>'name', ''))) NOT BETWEEN 1 AND 60 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_pack', 'index', i + 1, 'message', 'name: 1 to 60 characters');
      END IF;
      IF length(coalesce(pk->>'description', '')) > 200 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_pack', 'index', i + 1, 'message', 'description: 200 characters at most');
      END IF;
      v_id := NULL;
      IF coalesce(pk->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT g.id INTO v_id FROM public.ticket_groups g WHERE g.id = (pk->>'id')::uuid AND g.event_id = e.id;
        IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unknown_pack_id', 'index', i + 1); END IF;
        IF v_id = ANY (v_pids) THEN RETURN jsonb_build_object('ok', false, 'error', 'duplicate_pack', 'index', i + 1); END IF;
      END IF;
      IF lower(btrim(pk->>'name')) = ANY (v_pnames) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'duplicate_pack', 'index', i + 1);
      END IF;
      v_pids := array_append(v_pids, coalesce(v_id, gen_random_uuid()));
      v_pnames := array_append(v_pnames, lower(btrim(pk->>'name')));
      v_pdescs := array_append(v_pdescs, nullif(btrim(coalesce(pk->>'description', '')), ''));
    END LOOP;
  ELSE
    SELECT coalesce(array_agg(g.id ORDER BY g.position, g.created_at), '{}'), coalesce(array_agg(lower(btrim(g.name)) ORDER BY g.position, g.created_at), '{}')
      INTO v_pids, v_pnames FROM public.ticket_groups g WHERE g.event_id = e.id;
  END IF;

  -- 1) Identité de chaque ligne : un billet existant de CETTE soirée (id), sinon un nouvel id.
  FOR i IN 0 .. v_n - 1 LOOP
    t := v_list->i;
    IF jsonb_typeof(t) <> 'object' OR length(btrim(coalesce(t->>'name', ''))) NOT BETWEEN 1 AND 80 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_ticket', 'index', i + 1, 'message', 'name: 1 to 80 characters');
    END IF;
    v_id := NULL;
    IF coalesce(t->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT id INTO v_id FROM public.ticket_rounds WHERE id = (t->>'id')::uuid AND event_id = e.id;
      IF v_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'unknown_ticket_id', 'index', i + 1);
      END IF;
      IF v_id = ANY (v_ids) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'duplicate_ticket', 'index', i + 1);
      END IF;
    END IF;
    v_ids := array_append(v_ids, coalesce(v_id, gen_random_uuid()));
    v_keys := array_append(v_keys, lower(btrim(coalesce(nullif(t->>'ref', ''), t->>'id', t->>'name'))));
    v_names := array_append(v_names, lower(btrim(t->>'name')));
  END LOOP;

  -- 2) Un billet vendu ne disparaît jamais.
  SELECT string_agg(r2.name, ', ') INTO v_bad FROM public.ticket_rounds r2
   WHERE r2.event_id = e.id AND r2.tickets_sold > 0 AND NOT (r2.id = ANY (v_ids));
  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cannot_remove_sold', 'tickets', v_bad);
  END IF;

  -- 3) Les liens « s'ouvre quand … est complet » : par ref, id ou nom exact d'un billet de la liste.
  FOR i IN 0 .. v_n - 1 LOOP
    t := v_list->i;
    v_ref := lower(btrim(coalesce(t->>'opens_after', '')));
    v_sale := coalesce(nullif(t->>'sale', ''), CASE WHEN v_ref <> '' THEN 'after' ELSE 'now' END);
    IF v_sale NOT IN ('now', 'at', 'manual', 'after') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_ticket', 'index', i + 1, 'message', 'sale: now, at, manual or after');
    END IF;
    IF v_sale = 'after' THEN
      IF v_ref = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'opens_after_required', 'index', i + 1);
      END IF;
      v_id := NULL;
      FOR v_j IN 1 .. v_n LOOP
        IF v_keys[v_j] = v_ref OR v_ids[v_j]::text = v_ref OR v_names[v_j] = v_ref THEN v_id := v_ids[v_j]; EXIT; END IF;
      END LOOP;
      IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unknown_opens_after', 'index', i + 1); END IF;
      IF v_id = v_ids[i + 1] THEN RETURN jsonb_build_object('ok', false, 'error', 'chain_self', 'index', i + 1); END IF;
      v_links := array_append(v_links, v_id);
    ELSE
      v_links := array_append(v_links, NULL::uuid);
    END IF;
    -- Tout le reste de la ligne est vérifié ICI, avant la moindre écriture :
    -- une erreur au 5e billet ne laisse jamais les 4 premiers écrits.
    v_vis := coalesce(nullif(t->>'visibility', ''), CASE WHEN coalesce(t->>'visible_from', '') <> '' THEN 'at' ELSE 'now' END);
    IF v_vis NOT IN ('now', 'at', 'hidden') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_ticket', 'index', i + 1, 'message', 'visibility: now, at or hidden');
    END IF;
    v_price := CASE WHEN jsonb_typeof(t->'price') = 'number' THEN (t->>'price')::numeric END;
    IF v_price IS NULL OR v_price < 0 OR v_price > 10000 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_ticket', 'index', i + 1, 'message', 'price: a number from 0 to 10000 (euros)');
    END IF;
    v_qty := CASE WHEN jsonb_typeof(t->'quantity') = 'number' THEN (t->>'quantity')::numeric::int END;
    IF v_qty IS NOT NULL AND (v_qty < 1 OR v_qty >= 999999) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_ticket', 'index', i + 1, 'message', 'quantity: 1 or more, or null for no limit');
    END IF;
    IF (SELECT tickets_sold FROM public.ticket_rounds WHERE id = v_ids[i + 1]) > coalesce(v_qty, 999999) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'quantity_below_sold', 'index', i + 1,
        'sold', (SELECT tickets_sold FROM public.ticket_rounds WHERE id = v_ids[i + 1]));
    END IF;
    v_entry := nullif(btrim(coalesce(t->>'entry_before', '')), '');
    IF v_entry IS NOT NULL AND v_entry !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_ticket', 'index', i + 1, 'message', 'entry_before: HH:MM (local time of the night)');
    END IF;
    v_vfrom := CASE WHEN v_vis = 'at' THEN nullif(t->>'visible_from', '')::timestamptz END;
    v_sstart := CASE WHEN v_sale = 'at' THEN nullif(t->>'sale_starts_at', '')::timestamptz END;
    v_send := nullif(t->>'sale_ends_at', '')::timestamptz;
    IF (v_vis = 'at' AND v_vfrom IS NULL) OR (v_sale = 'at' AND v_sstart IS NULL) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'date_required', 'index', i + 1);
    END IF;
    IF v_sstart IS NOT NULL AND v_send IS NOT NULL AND v_send <= v_sstart THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_ticket', 'index', i + 1, 'message', 'sale_ends_at must be after sale_starts_at');
    END IF;

    -- Description (200 caractères), boisson jusqu'à une heure, pack. Champ omis
    -- = inchangé sur un billet existant ; null ou texte vide = retiré.
    IF t ? 'description' THEN
      IF jsonb_typeof(t->'description') NOT IN ('string', 'null') OR length(coalesce(t->>'description', '')) > 200 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_ticket', 'index', i + 1, 'message', 'description: text of 200 characters at most');
      END IF;
      v_td := array_append(v_td, nullif(btrim(coalesce(t->>'description', '')), ''));
      v_td_set := array_append(v_td_set, true);
    ELSE
      v_td := array_append(v_td, NULL::text);
      v_td_set := array_append(v_td_set, false);
    END IF;
    v_du := nullif(btrim(coalesce(t->>'drink_until', '')), '');
    IF v_du IS NOT NULL AND v_du !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_ticket', 'index', i + 1, 'message', 'drink_until: HH:MM (local time of the night, "02:00")');
    END IF;
    IF v_du IS NOT NULL AND NOT coalesce((t->>'includes_drink')::boolean, false) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_ticket', 'index', i + 1, 'message', 'drink_until needs includes_drink: true');
    END IF;
    v_dus := array_append(v_dus, v_du);
    IF t ? 'pack' THEN
      v_pref := lower(btrim(coalesce(t->>'pack', '')));
      v_tg_set := array_append(v_tg_set, true);
      IF v_pref = '' THEN
        v_tg := array_append(v_tg, NULL::uuid);
      ELSE
        v_id := NULL;
        FOR v_j IN 1 .. coalesce(array_length(v_pids, 1), 0) LOOP
          IF v_pids[v_j]::text = v_pref OR v_pnames[v_j] = v_pref THEN v_id := v_pids[v_j]; EXIT; END IF;
        END LOOP;
        IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unknown_pack', 'index', i + 1); END IF;
        v_tg := array_append(v_tg, v_id);
      END IF;
    ELSE
      v_tg_set := array_append(v_tg_set, false);
      v_tg := array_append(v_tg, NULL::uuid);
    END IF;
  END LOOP;
  -- Pas de boucle : deux billets qui s'attendent ne s'ouvriraient jamais.
  FOR i IN 1 .. v_n LOOP
    v_cursor := v_links[i];
    v_steps := 0;
    WHILE v_cursor IS NOT NULL AND v_steps <= v_n LOOP
      IF v_cursor = v_ids[i] THEN
        RETURN jsonb_build_object('ok', false, 'error', 'chain_cycle', 'index', i);
      END IF;
      v_cursor := v_links[array_position(v_ids, v_cursor)];
      v_steps := v_steps + 1;
    END LOOP;
  END LOOP;

  -- 4) Écriture. Mode libre d'abord (une soirée sans vente dans un autre mode
  -- repart de zéro), puis billets retirés, billets posés, enfin les liens.
  IF coalesce(e.ticket_selling_mode, 'rounds') <> 'free' THEN
    DELETE FROM public.ticket_rounds WHERE event_id = e.id;
    UPDATE public.events SET ticket_selling_mode = 'free' WHERE id = e.id;
  END IF;
  WITH d AS (DELETE FROM public.ticket_rounds WHERE event_id = e.id AND NOT (id = ANY (v_ids)) RETURNING 1)
  SELECT count(*) INTO v_removed FROM d;

  -- Packs : ceux qui ne sont plus dans la liste partent (leurs billets sortent
  -- du pack par la base), les autres sont créés ou mis à jour, dans l'ordre.
  IF v_pack_given THEN
    WITH d AS (DELETE FROM public.ticket_groups WHERE event_id = e.id AND NOT (id = ANY (v_pids)) RETURNING 1)
    SELECT count(*) INTO v_pk_removed FROM d;
    FOR i IN 0 .. coalesce(array_length(v_pids, 1), 0) - 1 LOOP
      pk := v_packs->i;
      INSERT INTO public.ticket_groups (id, event_id, name, description, position)
      VALUES (v_pids[i + 1], e.id, btrim(pk->>'name'), v_pdescs[i + 1], i)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, position = EXCLUDED.position;
    END LOOP;
  END IF;

  FOR i IN 0 .. v_n - 1 LOOP
    t := v_list->i;
    v_sale := coalesce(nullif(t->>'sale', ''), CASE WHEN coalesce(t->>'opens_after', '') <> '' THEN 'after' ELSE 'now' END);
    v_vis := coalesce(nullif(t->>'visibility', ''), CASE WHEN coalesce(t->>'visible_from', '') <> '' THEN 'at' ELSE 'now' END);
    v_price := (t->>'price')::numeric;
    v_qty := CASE WHEN jsonb_typeof(t->'quantity') = 'number' THEN (t->>'quantity')::numeric::int END;
    v_entry := nullif(btrim(coalesce(t->>'entry_before', '')), '');
    v_vfrom := CASE WHEN v_vis = 'at' THEN nullif(t->>'visible_from', '')::timestamptz END;
    v_sstart := CASE WHEN v_sale = 'at' THEN nullif(t->>'sale_starts_at', '')::timestamptz END;
    v_send := nullif(t->>'sale_ends_at', '')::timestamptz;
    v_drink := coalesce((t->>'includes_drink')::boolean, false);
    v_du := v_dus[i + 1];

    SELECT * INTO r FROM public.ticket_rounds WHERE id = v_ids[i + 1];
    IF FOUND THEN
      UPDATE public.ticket_rounds SET
        name = btrim(t->>'name'), price = v_price, max_tickets = coalesce(v_qty, 999999), position = i,
        entry_deadline = v_entry::time, includes_drink = v_drink,
        drink_deadline_type = CASE WHEN v_drink AND v_du IS NOT NULL THEN 'fixed_time'
                                   WHEN v_drink THEN coalesce(nullif(r.drink_deadline_type, ''), 'none') ELSE 'none' END,
        drink_deadline_hours = CASE WHEN v_drink AND v_du IS NOT NULL THEN NULL WHEN v_drink THEN r.drink_deadline_hours END,
        drink_cutoff_time = CASE WHEN v_drink AND v_du IS NOT NULL THEN v_du::time WHEN v_drink THEN r.drink_cutoff_time END,
        description = CASE WHEN v_td_set[i + 1] THEN v_td[i + 1] ELSE r.description END,
        group_id = CASE WHEN v_tg_set[i + 1] THEN v_tg[i + 1] ELSE r.group_id END,
        hidden = (v_vis = 'hidden'), visible_from = v_vfrom,
        sale_starts_at = v_sstart, sale_ends_at = v_send,
        -- « après » : la garde du lien décide (étape 5) ; épuisé reste fermé.
        is_active = CASE WHEN v_sale = 'after' THEN r.is_active
                         WHEN coalesce(r.manually_sold_out, false) OR r.tickets_sold >= coalesce(v_qty, 999999) THEN false
                         ELSE v_sale IN ('now', 'at') END
      WHERE id = r.id;
      v_updated := v_updated + 1;
    ELSE
      INSERT INTO public.ticket_rounds (id, event_id, name, price, max_tickets, position, last_tickets_threshold,
        ticket_type, auto_activate, is_active, hidden, visible_from, sale_starts_at, sale_ends_at,
        includes_drink, drink_deadline_type, drink_cutoff_time, entry_deadline, description, group_id)
      VALUES (v_ids[i + 1], e.id, btrim(t->>'name'), v_price, coalesce(v_qty, 999999), i, 20,
        'standard', false, v_sale IN ('now', 'at'), v_vis = 'hidden', v_vfrom, v_sstart, v_send,
        v_drink, CASE WHEN v_drink AND v_du IS NOT NULL THEN 'fixed_time' ELSE 'none' END,
        CASE WHEN v_drink AND v_du IS NOT NULL THEN v_du::time END, v_entry::time,
        CASE WHEN v_td_set[i + 1] THEN v_td[i + 1] END, CASE WHEN v_tg_set[i + 1] THEN v_tg[i + 1] END);
      v_created := v_created + 1;
    END IF;
  END LOOP;

  -- 5) Les liens, posés une fois que tous les billets existent : la garde
  -- (guard_ticket_round_opens_after) ouvre un billet dont le précédent est déjà
  -- complet et garde ouvert un billet déjà ouvert par un lien inchangé.
  FOR i IN 1 .. v_n LOOP
    UPDATE public.ticket_rounds SET opens_after_round_id = v_links[i]
     WHERE id = v_ids[i] AND opens_after_round_id IS DISTINCT FROM v_links[i];
  END LOOP;

  IF v_args ? 'capacity' THEN
    UPDATE public.events SET max_tickets = CASE WHEN jsonb_typeof(v_args->'capacity') = 'number' AND (v_args->>'capacity')::numeric >= 1
                                                THEN (v_args->>'capacity')::numeric::int END
     WHERE id = e.id;
  END IF;

  RETURN jsonb_build_object('ok', true,
    'changes', jsonb_build_object('created', v_created, 'updated', v_updated, 'removed', v_removed, 'packs_removed', v_pk_removed))
    || public._mcp_ticketing_view(e.id);
END;
$function$;

REVOKE ALL ON FUNCTION public._mcp_ticketing_view(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._mcp_ticketing(text, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated, service_role;
