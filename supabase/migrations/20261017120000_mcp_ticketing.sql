-- ============================================================================
-- Connecteur IA (MCP) : l'IA monte et modifie la billetterie d'une soirée
-- (2026-10-15). Deux outils, get_ticketing et set_ticketing, derrière la
-- permission « brouillons » (mcp_grants.can_draft) et la porte mcp_write.
--
-- Ce que l'IA peut faire : poser la billetterie LIBRE d'une soirée Yuno de
-- l'espace — billets, prix, quantités, heures limite d'entrée, boisson
-- offerte, affichage, dates de vente, rounds (« s'ouvre quand tel billet est
-- complet », ticket_rounds.opens_after_round_id) et jauge totale.
-- Ce qu'elle ne fait JAMAIS : allumer la billetterie (ticketing_enabled reste
-- tel quel : le pro clique « Activer la vente » dans la Console), supprimer
-- un billet déjà vendu, descendre une quantité sous le vendu, changer le mode
-- d'une soirée qui a déjà vendu dans un autre mode, toucher une soirée
-- externe (miroir Shotgun) ou finie. Sur une billetterie EN VENTE, elle
-- n'écrit qu'avec apply_to_live = true (les acheteurs voient le changement
-- tout de suite).
--
-- Droits : exactement ceux de la Console (policies de ticket_rounds) —
-- propriétaire du club, manager avec la permission « tickets », organisateur
-- d'une soirée sans club, ou can_manage_event_tables (équipe, co-gestion).
-- _mcp_ticketing tourne sous mcp_write (SECURITY DEFINER) : la RLS n'y joue
-- pas, la vérification est donc écrite ici.
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
    'tickets', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'price', r.price,
        'quantity', CASE WHEN r.max_tickets >= 999999 THEN NULL ELSE r.max_tickets END,
        'sold', r.tickets_sold,
        'entry_before', to_char(r.entry_deadline, 'HH24:MI'),
        'includes_drink', coalesce(r.includes_drink, false),
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
BEGIN
  v_event := public._mcp_resolve_event(coalesce(nullif(btrim(v_args->>'event'), ''), 'next'),
                                       public._mcp_email_scope_events(v_venue, v_org));
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

    SELECT * INTO r FROM public.ticket_rounds WHERE id = v_ids[i + 1];
    IF FOUND THEN
      UPDATE public.ticket_rounds SET
        name = btrim(t->>'name'), price = v_price, max_tickets = coalesce(v_qty, 999999), position = i,
        entry_deadline = v_entry::time, includes_drink = v_drink,
        drink_deadline_type = CASE WHEN v_drink THEN coalesce(nullif(r.drink_deadline_type, ''), 'none') ELSE 'none' END,
        drink_deadline_hours = CASE WHEN v_drink THEN r.drink_deadline_hours END,
        drink_cutoff_time = CASE WHEN v_drink THEN r.drink_cutoff_time END,
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
        includes_drink, drink_deadline_type, entry_deadline)
      VALUES (v_ids[i + 1], e.id, btrim(t->>'name'), v_price, coalesce(v_qty, 999999), i, 20,
        'standard', false, v_sale IN ('now', 'at'), v_vis = 'hidden', v_vfrom, v_sstart, v_send,
        v_drink, 'none', v_entry::time);
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
    'changes', jsonb_build_object('created', v_created, 'updated', v_updated, 'removed', v_removed))
    || public._mcp_ticketing_view(e.id);
END;
$function$;

REVOKE ALL ON FUNCTION public._mcp_ticketing_view(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._mcp_ticketing(text, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ── mcp_write : reprise de la version live (= 20261016160000, vérifié le
-- 15/10 par pg_get_functiondef) ; seuls s'ajoutent get_ticketing /
-- set_ticketing, leur journal, leur débit (100 écritures / jour) et leur
-- routage. La permission est celle des brouillons (can_draft) : la branche
-- « ni page ni scénario » s'applique telle quelle.
CREATE OR REPLACE FUNCTION public.mcp_write(p_access_hash text, p_tool text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a          record;
  s          record;
  v_args     jsonb := CASE WHEN jsonb_typeof(p_args) = 'object' THEN p_args ELSE '{}'::jsonb END;
  v_space    text;
  v_call     bigint;
  v_res      jsonb;
  v_min      integer;
  v_day      integer;
  v_creates  integer;
  v_updates  integer;
  v_images   integer;
  v_can      boolean;
  v_pages    boolean;
  v_page_creates integer;
  v_page_updates integer;
  v_is_page  boolean := p_tool IN ('create_signup_page', 'update_signup_page');
  v_is_scn   boolean := p_tool IN ('create_scenario_draft', 'update_scenario_draft');
  v_scn      boolean;
  v_scn_creates integer;
  v_scn_updates integer;
  v_is_tkt   boolean := p_tool IN ('get_ticketing', 'set_ticketing');
  v_tkt_sets integer;
  v_has_space boolean;
  v_summary  jsonb;
BEGIN
  SELECT * INTO a FROM public._mcp_access(p_access_hash);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  IF p_tool NOT IN ('create_email_draft', 'update_email_draft', 'add_email_image', 'create_signup_page', 'update_signup_page',
                    'create_scenario_draft', 'update_scenario_draft', 'get_ticketing', 'set_ticketing') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
  END IF;

  -- Même choix d'espace que mcp_call.
  v_space := nullif(btrim(coalesce(v_args->>'space', '')), '');
  IF v_space IS NOT NULL AND NOT (v_space = ANY (a.spaces)) THEN
    SELECT u.space_key INTO v_space FROM public._mcp_user_spaces(a.user_id) u
     WHERE u.space_key = ANY (a.spaces) AND lower(u.name) = lower(v_space) LIMIT 1;
    v_space := coalesce(v_space, nullif(btrim(v_args->>'space'), ''));
  END IF;
  IF v_space IS NULL THEN
    SELECT u.space_key INTO v_space FROM public._mcp_user_spaces(a.user_id) u
     WHERE u.space_key = ANY (a.spaces)
     ORDER BY CASE WHEN u.role IN ('owner', 'founder') THEN 0 WHEN u.role = 'admin' THEN 1 WHEN u.role = 'manager' THEN 2 ELSE 3 END,
              (u.product = 'crm'), (u.kind <> 'venue'), u.name
     LIMIT 1;
    v_space := coalesce(v_space, a.spaces[1]);
  END IF;
  SELECT * INTO s FROM public._mcp_user_spaces(a.user_id) u
   WHERE u.space_key = v_space AND v_space = ANY (a.spaces)
   ORDER BY (u.role = 'owner' OR u.role = 'founder') DESC LIMIT 1;
  v_has_space := FOUND;

  -- Journal : un résumé, jamais le HTML entier.
  v_summary := jsonb_strip_nulls(jsonb_build_object(
    'draft_id', v_args->>'draft_id', 'product', v_args->>'product', 'event', left(v_args->>'event', 120),
    'name', left(v_args->>'name', 120), 'subject', left(v_args->>'subject', 160),
    'audience', CASE WHEN jsonb_typeof(v_args->'audience') = 'array' THEN v_args->'audience' END,
    'sections', CASE WHEN jsonb_typeof(v_args->'blocks') = 'array' THEN jsonb_array_length(v_args->'blocks') END,
    'bytes', CASE WHEN v_args ? 'blocks' THEN length((v_args->'blocks')::text) END,
    'language', v_args->>'language', 'image', CASE WHEN p_tool = 'add_email_image' THEN left(coalesce(v_args->>'name', v_args->>'source'), 80) END,
    'page_id', v_args->>'page_id', 'kind', v_args->>'kind', 'title', left(v_args->>'title', 120),
    'design', CASE WHEN v_args ? 'custom_design' THEN coalesce(jsonb_typeof(v_args->'custom_design'), 'null') END,
    'page_sections', CASE WHEN jsonb_typeof(v_args->'custom_design'->'sections') = 'array' THEN jsonb_array_length(v_args->'custom_design'->'sections') END,
    'page_bytes', CASE WHEN v_args ? 'custom_design' THEN length((v_args->'custom_design')::text) END,
    'scenario_id', v_args->>'scenario_id',
    'scenario_nodes', CASE WHEN jsonb_typeof(v_args->'graph'->'nodes') = 'object' THEN (SELECT count(*) FROM jsonb_object_keys(v_args->'graph'->'nodes')) END,
    'scenario_trigger', left(v_args->'graph'->'trigger'->>'type', 40),
    'tickets', CASE WHEN jsonb_typeof(v_args->'tickets') = 'array' THEN jsonb_array_length(v_args->'tickets') END,
    'apply_to_live', CASE WHEN v_args ? 'apply_to_live' THEN v_args->'apply_to_live' END));

  -- Chaque famille d'écriture a SA permission, accordée par un écran de
  -- consentement qui l'annonce : brouillons d'e-mails (can_draft), pages
  -- d'inscription (can_pages). Une image sert aux deux.
  SELECT g.can_draft, g.can_pages, g.can_scenarios INTO v_can, v_pages, v_scn FROM public.mcp_grants g WHERE g.id = a.grant_id;
  -- Brouillons de scénarios (lot J5 des Scénarios) : leur propre permission.
  IF v_is_scn AND NOT coalesce(v_scn, false) THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_summary, 'denied', 'scenarios_not_allowed');
    RETURN jsonb_build_object('ok', false, 'error', 'scenarios_not_allowed');
  END IF;
  IF v_is_page AND NOT coalesce(v_pages, false) THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_summary, 'denied', 'pages_not_allowed');
    RETURN jsonb_build_object('ok', false, 'error', 'pages_not_allowed');
  END IF;
  IF NOT v_is_page AND NOT v_is_scn AND NOT (coalesce(v_can, false) OR (p_tool = 'add_email_image' AND coalesce(v_pages, false))) THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_summary, 'denied', 'drafts_not_allowed');
    RETURN jsonb_build_object('ok', false, 'error', 'drafts_not_allowed');
  END IF;
  IF NOT v_has_space THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_summary, 'denied', 'space_not_allowed');
    RETURN jsonb_build_object('ok', false, 'error', 'space_not_allowed', 'spaces', to_jsonb(a.spaces));
  END IF;

  -- Débits : 60 appels / minute et 3 000 / jour (comme mcp_call), 30
  -- brouillons créés et 200 modifications par jour et par connexion ; 20
  -- pages d'inscription créées et 200 modifications ; 20 brouillons de
  -- scénarios créés et 200 modifications.
  SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute'),
         count(*),
         count(*) FILTER (WHERE tool = 'create_email_draft' AND status = 'ok'),
         count(*) FILTER (WHERE tool = 'update_email_draft' AND status = 'ok'),
         count(*) FILTER (WHERE tool = 'add_email_image' AND status = 'ok'),
         count(*) FILTER (WHERE tool = 'create_signup_page' AND status = 'ok'),
         count(*) FILTER (WHERE tool = 'update_signup_page' AND status = 'ok'),
         count(*) FILTER (WHERE tool = 'create_scenario_draft' AND status = 'ok'),
         count(*) FILTER (WHERE tool = 'update_scenario_draft' AND status = 'ok'),
         count(*) FILTER (WHERE tool = 'set_ticketing' AND status = 'ok')
    INTO v_min, v_day, v_creates, v_updates, v_images, v_page_creates, v_page_updates, v_scn_creates, v_scn_updates, v_tkt_sets
    FROM public.mcp_tool_calls
   WHERE grant_id = a.grant_id AND created_at > now() - interval '1 day';
  IF v_min >= 60 OR v_day >= 3000
     OR (p_tool = 'create_email_draft' AND v_creates >= 30)
     OR (p_tool = 'update_email_draft' AND v_updates >= 200)
     OR (p_tool = 'add_email_image' AND v_images >= 60)
     OR (p_tool = 'create_signup_page' AND v_page_creates >= 20)
     OR (p_tool = 'update_signup_page' AND v_page_updates >= 200)
     OR (p_tool = 'create_scenario_draft' AND v_scn_creates >= 20)
     OR (p_tool = 'update_scenario_draft' AND v_scn_updates >= 200)
     OR (p_tool = 'set_ticketing' AND v_tkt_sets >= 100) THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_summary, 'rate_limited', NULL);
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args)
  VALUES (a.grant_id, a.user_id, p_tool, v_space, v_summary)
  RETURNING id INTO v_call;
  UPDATE public.mcp_grants SET last_used_at = now(), calls_count = calls_count + 1 WHERE id = a.grant_id;

  BEGIN
    PERFORM set_config('request.jwt.claims', jsonb_build_object(
      'sub', a.user_id, 'role', 'authenticated', 'aud', 'authenticated', 'yuno_mcp_grant', a.grant_id)::text, true);
    PERFORM set_config('request.jwt.claim.sub', a.user_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.session_id', '', true);
    v_res := CASE
      WHEN p_tool = 'add_email_image'
        THEN public._mcp_email_image_add(s.kind, s.space_id, s.product, v_args, a.user_id, a.grant_id)
      WHEN v_is_page
        THEN public._mcp_signup_write(p_tool, s.kind, s.space_id, s.product, v_args, a.user_id, a.grant_id, a.client_name)
      -- Billetterie (20261017120000) : derrière can_draft, droits de la Console revérifiés.
      WHEN v_is_tkt
        THEN public._mcp_ticketing(p_tool, s.kind, s.space_id, v_args, a.user_id)
      WHEN v_is_scn
        THEN public._mcp_scenario_write(p_tool, s.kind, s.space_id, v_args, a.user_id, a.grant_id, a.client_name)
      ELSE public._mcp_email_write(p_tool, s.kind, s.space_id, s.product, v_args, a.user_id, a.grant_id, a.client_name) END;
  EXCEPTION WHEN others THEN
    UPDATE public.mcp_tool_calls SET status = 'error', error = left(SQLSTATE || ' ' || SQLERRM, 300) WHERE id = v_call;
    RETURN jsonb_build_object('ok', false, 'error',
      CASE WHEN SQLERRM LIKE '%crm_plan_ab_resend%' THEN 'ab_not_in_plan'
           WHEN SQLERRM LIKE '%crm_send_frozen%' OR SQLERRM LIKE '%sending_frozen%' THEN 'sending_frozen'
           WHEN SQLSTATE IN ('22P02', '22007', '22008', '22023') THEN 'invalid_args'
           ELSE 'internal' END,
      'call_id', v_call);
  END;

  IF NOT coalesce((v_res->>'ok')::boolean, false) THEN
    UPDATE public.mcp_tool_calls SET status = 'error', error = left(coalesce(v_res->>'error', 'error'), 300) WHERE id = v_call;
  END IF;
  RETURN jsonb_build_object('ok', coalesce((v_res->>'ok')::boolean, false), 'call_id', v_call,
    'space', jsonb_build_object('key', s.space_key, 'name', s.name, 'kind', s.kind, 'product', s.product),
    'result', v_res);
END;
$function$
;

REVOKE ALL ON FUNCTION public.mcp_write(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_write(text, text, jsonb) TO service_role;
