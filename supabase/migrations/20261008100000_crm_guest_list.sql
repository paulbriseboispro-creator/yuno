-- ============================================================================
-- Yuno CRM — la guest list Shotgun dans l'analyse (2026-10-05).
-- Analyse et règles : docs/designs/CRM_GUEST_LIST_ANALYTICS.md.
--
-- Ce que l'API Tickets de Shotgun rend d'une guest list
-- (docs/designs/SHOTGUN_API_REFERENCE.md) :
--   • les INVITATIONS (`deal_channel = 'invitation'`) : un billet gratuit à QR
--     envoyé par l'organisateur — jamais une vente (_crm_ticket_is_sale) ;
--   • les billets à 0 € (`deal_price = 0`, « Guest list gratuite avant 1 h ») :
--     une inscription en libre-service, comptée comme un billet comme avant.
-- Les guestlists de l'app Shotgun Scan (simple liste de noms, sans billet)
-- ne passent PAS par l'API : l'écran le dit, il ne les invente pas.
--
-- 1. Porte unique : `_crm_ticket_gl_kind(status, price, raw)` = 'inv' | 'free'
--    | NULL. Miroir front : `glKindOf` (src/crm/lib/guestlist.ts, testé).
-- 2. « Venu » = billet scanné, sur une soirée dont la porte a scanné au moins
--    la moitié des billets valides (même règle que « On t'a manqué »,
--    20261006230000) : sinon le taux de venue est « non mesuré », jamais 0 %.
-- 3. Registre des personnes (_crm_people_build) : une invitation SCANNÉE vaut
--    une soirée faite (« un scan Shotgun vaut une venue ») — un invité venu
--    trois fois n'est plus « Jamais venu ». Nouvelles colonnes de `_cp` :
--    paid_n, gl_n, gl_came, gl_first, gl_events, gl_noshow, gl_conv.
-- 4. Filtres Clients (_crm_filter_sql) : f.gl = any | only | loyal | conv |
--    noshow, f.glev = invités de ces soirées. Valent aussi pour « Écrire à »,
--    les segments et l'audience d'une campagne (tous lisent `_cp`).
-- 5. Lectures : crm_nights (ligne `gl` par soirée), crm_clients_list (badge),
--    crm_client (parcours d'invité), crm_night_guestlist (onglet Guest list du
--    tiroir d'une soirée), crm_ana_guestlist (Analyses › Guest list).
-- Chaque fonction existante est réécrite depuis sa définition EN BASE
-- (pg_get_functiondef du 05/10) ; seules les lignes citées changent.
-- ============================================================================

-- ── 1. Porte unique ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._crm_ticket_gl_kind(p_status text, p_price numeric, p_raw jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_status IS DISTINCT FROM 'valid' THEN NULL
    WHEN jsonb_typeof(p_raw) = 'object' AND p_raw->>'deal_channel' = 'invitation' THEN 'inv'
    WHEN p_price = 0 THEN 'free'
  END;
$$;
REVOKE ALL ON FUNCTION public._crm_ticket_gl_kind(text, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._crm_ticket_gl_kind(text, numeric, jsonb) TO authenticated, service_role;

-- ── 2. Registre des personnes ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._crm_people_build(p_venue_id text, p_organizer_user_id uuid, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_at timestamptz := COALESCE(p_at, now());
  v_rules record;
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_tonight uuid;
  v_n integer;
BEGIN
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);
  PERFORM public.contact_build_rows(p_venue_id, p_organizer_user_id);

  DROP TABLE IF EXISTS _cpt;
  CREATE TEMP TABLE _cpt ON COMMIT DROP AS
    SELECT * FROM public._crm_tickets(p_venue_id, p_organizer_user_id) x
     WHERE x.bought_at <= v_at;

  -- Guest list (invitations + billets à 0 €), migration 20261008100000.
  DROP TABLE IF EXISTS _cpg;
  CREATE TEMP TABLE _cpg ON COMMIT DROP AS
    SELECT lower(t.buyer_email) AS email, t.event_id, e.start_at AS event_start,
           COALESCE(e.end_at, e.start_at + interval '6 hours') AS event_end,
           public._crm_ticket_gl_kind(t.status, t.price, t.raw) AS kind,
           t.scanned_at, COALESCE(t.purchased_at, t.first_seen_at) AS at,
           NULLIF(btrim(t.deal_name), '') AS deal
      FROM public.external_tickets t
      LEFT JOIN public.events e ON e.id = t.event_id
     WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
       AND t.buyer_email IS NOT NULL
       AND public._crm_ticket_gl_kind(t.status, t.price, t.raw) IS NOT NULL
       AND COALESCE(t.purchased_at, t.first_seen_at) <= v_at;

  -- « Ce soir » : la prochaine soirée si elle a lieu aujourd'hui (ou est en cours).
  SELECT e.id INTO v_tonight
    FROM public.events e
   WHERE ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
     AND (e.is_active OR e.external_source IS NOT NULL)
     AND COALESCE(e.end_at, e.start_at + interval '8 hours') > v_at
     AND (e.start_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'))::date
         <= (v_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'))::date
   ORDER BY e.start_at LIMIT 1;

  DROP TABLE IF EXISTS _cp;
  CREATE TEMP TABLE _cp ON COMMIT DROP AS
  WITH att AS (
    -- Une soirée faite = un billet acheté (même à 0 €), ou une invitation
    -- scannée à la porte.
    SELECT t.email, t.event_id, t.event_start FROM _cpt t WHERE t.email IS NOT NULL
    UNION ALL
    SELECT g.email, g.event_id, g.event_start FROM _cpg g
     WHERE g.kind = 'inv' AND g.scanned_at IS NOT NULL AND g.event_id IS NOT NULL
  ), agg AS (
    SELECT a.email,
           count(DISTINCT a.event_id) FILTER (WHERE a.event_start <= v_at) AS nights,
           count(DISTINCT a.event_id) FILTER (WHERE a.event_start <= v_at
                 AND a.event_start > v_at - make_interval(months => v_rules.regular_window_months)) AS nights_win,
           min(a.event_start) FILTER (WHERE a.event_start <= v_at) AS first_night,
           max(a.event_start) FILTER (WHERE a.event_start <= v_at) AS last_night
      FROM att a
     GROUP BY a.email
  ), buy AS (
    SELECT t.email,
           COALESCE(sum(t.amount), 0) AS spent,
           array_agg(DISTINCT t.event_id) FILTER (WHERE t.event_id IS NOT NULL) AS events,
           bool_or(t.event_id = v_tonight) AS tonight,
           min(t.bought_at) AS first_buy,
           count(DISTINCT COALESCE(t.event_id::text, t.id::text)) FILTER (WHERE t.amount > 0) AS paid_n,
           min(t.bought_at) FILTER (WHERE t.amount > 0) AS first_paid
      FROM _cpt t
     WHERE t.email IS NOT NULL
     GROUP BY t.email
  ), cov AS (
    -- Soirées terminées dont la porte a scanné au moins la moitié des billets.
    SELECT t.event_id
      FROM public.external_tickets t
      JOIN public.events e ON e.id = t.event_id
     WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
       AND t.status = 'valid'
       AND COALESCE(e.end_at, e.start_at + interval '6 hours') <= v_at
     GROUP BY t.event_id
    HAVING count(*) FILTER (WHERE t.scanned_at IS NOT NULL) >= 0.5 * count(*)
  ), gl AS (
    SELECT g.email,
           count(DISTINCT g.event_id) AS gl_n,
           count(DISTINCT g.event_id) FILTER (WHERE g.scanned_at IS NOT NULL) AS gl_came,
           min(g.event_start) AS gl_first,
           array_agg(DISTINCT g.event_id) FILTER (WHERE g.event_id IS NOT NULL) AS gl_events,
           count(*) FILTER (WHERE g.scanned_at IS NULL AND g.event_id IN (SELECT cov.event_id FROM cov)) AS gl_noshow,
           bool_or(g.event_id = v_tonight) AS gl_tonight
      FROM _cpg g
     GROUP BY g.email
  ), first_utm AS (
    SELECT DISTINCT ON (lower(et.buyer_email)) lower(et.buyer_email) AS email,
           et.utm->>'utm_source' AS utm_source, et.utm->>'utm_medium' AS utm_medium
      FROM public.external_tickets et
     WHERE et.buyer_email IS NOT NULL
       AND ((p_venue_id IS NOT NULL AND et.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND et.organizer_user_id = p_organizer_user_id))
     ORDER BY lower(et.buyer_email), COALESCE(et.purchased_at, et.first_seen_at)
  ), page_first AS (
    -- Première inscription CONFIRMÉE par une page d'inscription de la portée.
    SELECT lower(e.email) AS email, min(e.created_at) AS at
      FROM public.crm_signup_entries e
      JOIN public.crm_signup_pages pg ON pg.id = e.page_id
     WHERE e.email IS NOT NULL AND e.confirmed_at IS NOT NULL AND e.created_at <= v_at
       AND pg.venue_id IS NOT DISTINCT FROM p_venue_id
       AND pg.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     GROUP BY 1
  ), base AS (
    SELECT lower(c.email) AS email, c.first_name, c.last_name, c.phone_e164, c.email_ok, c.phone_ok,
           c.origin, COALESCE(c.added_at, c.created_at) AS added_at, c.eng_status, c.bounced,
           c.list_import_id
      FROM _cr c
     WHERE c.email IS NOT NULL
       AND COALESCE(c.added_at, c.created_at, '-infinity'::timestamptz) <= v_at
  )
  SELECT b.email, b.first_name, b.last_name, b.phone_e164 AS phone, b.email_ok, b.phone_ok, b.origin,
         b.added_at, b.eng_status, COALESCE(b.bounced, false) AS bounced, b.list_import_id,
         COALESCE(a.nights, 0)::int AS nights, COALESCE(a.nights_win, 0)::int AS nights_win,
         a.first_night, a.last_night, round(COALESCE(y.spent, 0), 2) AS spent,
         COALESCE(y.events, '{}'::uuid[]) AS events, COALESCE(y.tonight, false) OR COALESCE(g.gl_tonight, false) AS tonight,
         CASE WHEN pf.at IS NOT NULL AND (y.first_buy IS NULL OR pf.at < y.first_buy) THEN 'page'
              WHEN COALESCE(a.nights, 0) > 0 AND lower(u.utm_source) LIKE 'yuno%' THEN 'utm'
              WHEN COALESCE(a.nights, 0) > 0 THEN 'shotgun'
              WHEN b.origin IN ('import', 'both') THEN 'import'
              ELSE 'other' END AS source,
         u.utm_source, u.utm_medium,
         CASE
           WHEN COALESCE(a.nights, 0) = 0 THEN 'none'
           WHEN a.last_night < v_at - make_interval(months => v_rules.lapse_months) THEN 'end'
           WHEN a.nights_win >= v_rules.regular_min_nights THEN 'hab'
           WHEN a.first_night >= v_at - interval '90 days' THEN 'nou'
           ELSE 'occ' END AS lifecycle,
         n.tags, n.note,
         COALESCE(y.paid_n, 0)::int AS paid_n,
         COALESCE(g.gl_n, 0)::int AS gl_n,
         COALESCE(g.gl_came, 0)::int AS gl_came,
         g.gl_first,
         COALESCE(g.gl_events, '{}'::uuid[]) AS gl_events,
         COALESCE(g.gl_noshow, 0)::int AS gl_noshow,
         -- Devenu client : premier billet PAYANT acheté après sa première soirée en guest list.
         (g.gl_first IS NOT NULL AND y.first_paid IS NOT NULL AND y.first_paid > g.gl_first) AS gl_conv
    FROM base b
    LEFT JOIN agg a ON a.email = b.email
    LEFT JOIN buy y ON y.email = b.email
    LEFT JOIN gl g ON g.email = b.email
    LEFT JOIN first_utm u ON u.email = b.email
    LEFT JOIN page_first pf ON pf.email = b.email
    LEFT JOIN public.crm_contact_notes n ON n.scope_key = v_scope AND n.email = b.email;

  -- Comportement face aux messages (12 mois avant la date) : reçus, envois
  -- cliqués, et « a cliqué sans acheter » (dernier clic des 90 jours sans
  -- billet acheté dans les 7 jours qui suivent).
  ALTER TABLE _cp ADD COLUMN msg_n integer NOT NULL DEFAULT 0,
                  ADD COLUMN click_n integer NOT NULL DEFAULT 0,
                  ADD COLUMN last_click timestamptz,
                  ADD COLUMN click_nobuy boolean NOT NULL DEFAULT false;
  WITH c AS (
    SELECT ec.id FROM public.email_campaigns ec
     WHERE ec.status IN ('sent', 'sending') AND ec.sent_at IS NOT NULL
       AND ec.sent_at <= v_at AND ec.sent_at > v_at - interval '12 months'
       AND ec.venue_id IS NOT DISTINCT FROM p_venue_id
       AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
  ), r AS (
    SELECT lower(x.email) AS em, count(*) AS n
      FROM public.email_campaign_recipients x JOIN c ON c.id = x.campaign_id
     WHERE x.status IN ('sent', 'complained')
     GROUP BY 1
  ), k AS (
    SELECT lower(ev.recipient_email) AS em, count(DISTINCT ev.campaign_id) AS n, max(ev.created_at) AS last
      FROM public.email_campaign_events ev JOIN c ON c.id = ev.campaign_id
     WHERE ev.event_type = 'clicked' AND ev.created_at <= v_at AND ev.recipient_email IS NOT NULL
     GROUP BY 1
  )
  UPDATE _cp p
     SET msg_n = COALESCE(r.n, 0), click_n = COALESCE(k.n, 0), last_click = k.last
    FROM (SELECT DISTINCT em FROM (SELECT em FROM r UNION SELECT em FROM k) u) e
    LEFT JOIN r ON r.em = e.em
    LEFT JOIN k ON k.em = e.em
   WHERE p.email = e.em;
  UPDATE _cp p
     SET click_nobuy = true
   WHERE p.last_click > v_at - interval '90 days'
     AND NOT EXISTS (SELECT 1 FROM _cpt t
                      WHERE t.email = p.email AND t.bought_at > p.last_click
                        AND t.bought_at <= LEAST(p.last_click + interval '7 days', v_at));

  SELECT count(*) INTO v_n FROM _cp;
  RETURN v_n;
END;
$function$;

-- ── 3. Filtres Clients ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._crm_filter_sql(p_def jsonb, p_alias text DEFAULT 'p'::text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  a text := quote_ident(COALESCE(p_alias, 'p'));
  parts text[] := '{}';
  d jsonb := COALESCE(p_def, '{}'::jsonb);
  f jsonb := COALESCE(p_def->'f', '{}'::jsonb);
  v text;
  lst text;
  ors text[];
  q text;
  dig text;
BEGIN
  v := d->>'seg';
  IF v IS NOT NULL AND v <> 'all' THEN
    IF v IN ('hab', 'occ', 'nou', 'end', 'none') THEN parts := array_append(parts, format('%s.lifecycle = %L', a, v));
    ELSE parts := array_append(parts, 'false'); END IF;
  END IF;

  IF jsonb_typeof(f->'ev') = 'array' AND jsonb_array_length(f->'ev') > 0 THEN
    ors := '{}';
    SELECT string_agg(format('%L', x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'ev') x WHERE x ~ '^[0-9a-f-]{36}$';
    IF lst IS NOT NULL THEN ors := array_append(ors, format('%s.events && ARRAY[%s]::uuid[]', a, lst)); END IF;
    IF f->'ev' ? 'T' THEN ors := array_append(ors, format('%s.tonight', a)); END IF;
    parts := array_append(parts, CASE WHEN array_length(ors, 1) IS NULL THEN 'false' ELSE '(' || array_to_string(ors, ' OR ') || ')' END);
  END IF;

  v := f->>'last';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN '0-30' THEN format('%s.last_night >= now() - interval ''30 days''', a)
      WHEN '30-90' THEN format('(%s.last_night < now() - interval ''30 days'' AND %s.last_night >= now() - interval ''90 days'')', a, a)
      WHEN '90-180' THEN format('(%s.last_night < now() - interval ''90 days'' AND %s.last_night >= now() - interval ''180 days'')', a, a)
      WHEN '180+' THEN format('%s.last_night < now() - interval ''180 days''', a)
      ELSE 'false' END);
  END IF;

  v := f->>'last_gt_days';
  IF v IS NOT NULL AND v ~ '^[0-9]{1,4}$' THEN
    parts := array_append(parts, format('%s.last_night < now() - make_interval(days => %s)', a, v));
  END IF;

  v := f->>'nb';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN '0' THEN format('%s.nights = 0', a)
      WHEN '1' THEN format('%s.nights = 1', a)
      WHEN '2' THEN format('%s.nights = 2', a)
      WHEN '3-5' THEN format('%s.nights BETWEEN 3 AND 5', a)
      WHEN '6+' THEN format('%s.nights >= 6', a)
      ELSE 'false' END);
  END IF;

  v := f->>'sp';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN '<50' THEN format('%s.spent < 50', a)
      WHEN '50-200' THEN format('%s.spent BETWEEN 50 AND 200', a)
      WHEN '200+' THEN format('%s.spent > 200', a)
      ELSE 'false' END);
  END IF;

  IF jsonb_typeof(f->'rc') = 'array' AND jsonb_array_length(f->'rc') > 0 THEN
    ors := '{}';
    IF f->'rc' ? 'mail' THEN ors := array_append(ors, format('%s.email_ok', a)); END IF;
    IF f->'rc' ? 'sms' THEN ors := array_append(ors, format('%s.phone_ok', a)); END IF;
    IF f->'rc' ? 'none' THEN ors := array_append(ors, format('(NOT %s.email_ok AND NOT %s.phone_ok)', a, a)); END IF;
    parts := array_append(parts, CASE WHEN array_length(ors, 1) IS NULL THEN 'false' ELSE '(' || array_to_string(ors, ' OR ') || ')' END);
  END IF;

  IF jsonb_typeof(f->'src') = 'array' AND jsonb_array_length(f->'src') > 0 THEN
    SELECT string_agg(format('%L', x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'src') x WHERE x IN ('shotgun', 'utm', 'import', 'page', 'other');
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.source IN (%s)', a, lst) END);
  END IF;

  IF jsonb_typeof(f->'tags') = 'array' AND jsonb_array_length(f->'tags') > 0 THEN
    SELECT string_agg(format('%L', x), ',') INTO lst FROM jsonb_array_elements_text(f->'tags') x;
    parts := array_append(parts, format('COALESCE(%s.tags, ''{}'') && ARRAY[%s]::text[]', a, lst));
  END IF;

  v := f->>'msg';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN 'never_clicked' THEN format('(%s.msg_n >= 3 AND %s.click_n = 0)', a, a)
      WHEN 'clicked_no_buy' THEN format('%s.click_nobuy', a)
      ELSE 'false' END);
  END IF;

  -- Guest list (20261008100000). Valeur inconnue ⇒ personne.
  v := f->>'gl';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN 'any' THEN format('%s.gl_n > 0', a)
      WHEN 'only' THEN format('(%s.gl_n > 0 AND %s.paid_n = 0)', a, a)
      WHEN 'loyal' THEN format('(%s.gl_n >= 3 AND %s.paid_n = 0)', a, a)
      WHEN 'conv' THEN format('%s.gl_conv', a)
      WHEN 'noshow' THEN format('%s.gl_noshow >= 2', a)
      ELSE 'false' END);
  END IF;

  IF jsonb_typeof(f->'glev') = 'array' AND jsonb_array_length(f->'glev') > 0 THEN
    SELECT string_agg(format('%L', x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'glev') x WHERE x ~ '^[0-9a-f-]{36}$';
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.gl_events && ARRAY[%s]::uuid[]', a, lst) END);
  END IF;

  -- Liste fixe (une sélection enregistrée en segment) : 5 000 adresses au plus.
  IF jsonb_typeof(f->'emails') = 'array' AND jsonb_array_length(f->'emails') > 0 THEN
    SELECT string_agg(format('%L', lower(btrim(x))), ',') INTO lst
      FROM (SELECT x FROM jsonb_array_elements_text(f->'emails') x LIMIT 5000) z WHERE x ~ '@';
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.email = ANY (ARRAY[%s]::text[])', a, lst) END);
  END IF;

  q := btrim(COALESCE(d->>'q', ''));
  IF q <> '' THEN
    dig := regexp_replace(q, '\D', '', 'g');
    parts := array_append(parts, format(
      '(lower(public.unaccent_safe(COALESCE(%s.first_name, '''') || '' '' || COALESCE(%s.last_name, '''') || '' '' || %s.email)) LIKE %L%s)',
      a, a, a, '%' || replace(replace(lower(public.unaccent_safe(q)), '%', ''), '_', '') || '%',
      CASE WHEN length(dig) >= 3 THEN format(' OR regexp_replace(COALESCE(%s.phone, ''''), ''\D'', '''', ''g'') LIKE %L', a, '%' || dig || '%') ELSE '' END));
  END IF;

  IF array_length(parts, 1) IS NULL THEN RETURN 'true'; END IF;
  RETURN '(' || array_to_string(parts, ' AND ') || ')';
END;
$function$;

-- « La porte a vraiment scanné » : soirée terminée, au moins la moitié des
-- billets valides scannés. Sinon un invité non scanné n'est pas « pas venu ».
CREATE OR REPLACE FUNCTION public._crm_event_scan_known(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.events e
                  WHERE e.id = p_event_id AND COALESCE(e.end_at, e.start_at + interval '6 hours') <= now())
     AND COALESCE((SELECT count(*) > 0 AND count(*) FILTER (WHERE t.scanned_at IS NOT NULL) >= 0.5 * count(*)
                     FROM public.external_tickets t
                    WHERE t.event_id = p_event_id AND t.status = 'valid'), false);
$$;
REVOKE ALL ON FUNCTION public._crm_event_scan_known(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_event_scan_known(uuid) TO service_role;

-- ── 4. Liste Clients : le badge « Guest list » ───────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_clients_list__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_def jsonb DEFAULT '{}'::jsonb, p_sort text DEFAULT 'last'::text, p_dir integer DEFAULT 1, p_limit integer DEFAULT 12, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pred text;
  v_order text;
  v_total integer;
  v_rows jsonb;
  v_counts jsonb;
  v_desc text := CASE WHEN COALESCE(p_dir, 1) >= 0 THEN 'DESC' ELSE 'ASC' END;
  v_asc text := CASE WHEN COALESCE(p_dir, 1) >= 0 THEN 'ASC' ELSE 'DESC' END;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  v_pred := public._crm_filter_sql(p_def, 'p');
  v_order := CASE p_sort
    WHEN 'name' THEN format('lower(COALESCE(p.first_name, p.email)) %s, p.email', v_asc)
    WHEN 'n' THEN format('p.nights %s, p.email', v_desc)
    WHEN 'sp' THEN format('p.spent %s, p.email', v_desc)
    ELSE format('p.last_night %s NULLS LAST, p.added_at %s, p.email', v_desc, v_desc) END;

  EXECUTE format('SELECT count(*) FROM _cp p WHERE %s', v_pred) INTO v_total;
  EXECUTE format($q$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'email', p.email, 'first_name', p.first_name, 'last_name', p.last_name,
             'lifecycle', p.lifecycle, 'nights', p.nights, 'last_night', p.last_night, 'added_at', p.added_at,
             'spent', p.spent, 'email_ok', p.email_ok, 'phone_ok', p.phone_ok, 'tonight', p.tonight,
             'tag', (p.tags)[1], 'source', p.source,
             'gl', p.gl_n, 'gl_only', (p.gl_n > 0 AND p.paid_n = 0)) ORDER BY rn), '[]'::jsonb)
      FROM (SELECT p.*, row_number() OVER (ORDER BY %s) AS rn FROM _cp p WHERE %s ORDER BY %s LIMIT %s OFFSET %s) p
  $q$, v_order, v_pred, v_order, GREATEST(1, LEAST(COALESCE(p_limit, 12), 500)), GREATEST(0, COALESCE(p_offset, 0)))
  INTO v_rows;

  SELECT jsonb_build_object(
           'all', count(*), 'hab', count(*) FILTER (WHERE lifecycle = 'hab'), 'occ', count(*) FILTER (WHERE lifecycle = 'occ'),
           'nou', count(*) FILTER (WHERE lifecycle = 'nou'), 'end', count(*) FILTER (WHERE lifecycle = 'end'),
           'none', count(*) FILTER (WHERE lifecycle = 'none'))
    INTO v_counts FROM _cp;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows, 'counts', v_counts);
END;
$function$;

-- ── 5. Fiche client : le parcours d'invité ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_client__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_email text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_em text := lower(btrim(COALESCE(p_email, '')));
  v_p record;
  v_buys jsonb;
  v_guests jsonb;
  v_msgs jsonb;
  v_months jsonb;
  v_rules record;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  SELECT * INTO v_p FROM _cp p WHERE p.email = v_em;
  IF v_p.email IS NULL THEN RETURN NULL; END IF;

  -- Achats : une ligne par soirée (montant de la soirée, billets).
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at' DESC), '[]'::jsonb) INTO v_buys FROM (
    SELECT jsonb_build_object('kind', 'buy', 'at', min(t.bought_at), 'event_id', t.event_id, 'title', e.title,
                              'event_start', min(t.event_start), 'amount', round(sum(t.amount), 2), 'tickets', sum(t.qty),
                              'scanned', bool_or(t.scanned_at IS NOT NULL), 'first', min(t.event_start) = v_p.first_night,
                              'upcoming', min(t.event_start) > now(),
                              -- Par où est arrivé l'achat : la source que Shotgun rend sur le
                              -- premier billet de la personne pour cette soirée.
                              'source', public._crm_source_label(p_venue_id, p_organizer_user_id, (
                                SELECT lower(et.utm->>'utm_source') FROM public.external_tickets et
                                 WHERE et.event_id = t.event_id AND lower(et.buyer_email) = v_em
                                   AND public._crm_ticket_is_sale(et.status, et.raw)
                                 ORDER BY COALESCE(et.purchased_at, et.first_seen_at) LIMIT 1))) AS x
      FROM _cpt t LEFT JOIN public.events e ON e.id = t.event_id
     WHERE t.email = v_em
     GROUP BY t.event_id, e.title
  ) q;

  -- Guest list : une ligne par soirée où la personne était invitée ou
  -- inscrite gratuitement (20261008100000). `came` n'est faux qu'une fois la
  -- porte vraiment scannée (`scan_known`) : sinon on ne sait pas.
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'event_start' DESC), '[]'::jsonb) INTO v_guests FROM (
    SELECT jsonb_build_object('kind', 'guest', 'event_id', g.event_id, 'title', e.title,
             'event_start', min(g.event_start), 'at', min(g.at),
             'gl', CASE WHEN bool_and(g.kind = 'inv') THEN 'inv' WHEN bool_and(g.kind = 'free') THEN 'free' ELSE 'mix' END,
             'list', string_agg(DISTINCT g.deal, ', '),
             'came', bool_or(g.scanned_at IS NOT NULL), 'scanned_at', min(g.scanned_at),
             'scan_known', public._crm_event_scan_known(g.event_id),
             'upcoming', min(g.event_end) > now()) AS x
      FROM _cpg g LEFT JOIN public.events e ON e.id = g.event_id
     WHERE g.email = v_em AND g.event_id IS NOT NULL
     GROUP BY g.event_id, e.title
  ) q;

  -- Messages : e-mails reçus (et clics), SMS reçus.
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at' DESC), '[]'::jsonb) INTO v_msgs FROM (
    SELECT jsonb_build_object('kind', 'email', 'at', r.sent_at, 'name', c.name, 'campaign_id', c.id,
             'opened', EXISTS (SELECT 1 FROM public.email_campaign_events ev WHERE ev.campaign_id = c.id AND lower(ev.recipient_email) = v_em AND ev.event_type = 'opened'),
             'clicked', k.at IS NOT NULL,
             -- La soirée dont parlait l'e-mail, le premier clic, et si la personne a
             -- acheté cette soirée dans les 7 jours qui suivent (ou par la source de
             -- CETTE campagne, que Shotgun rend sur le billet).
             'event_id', c.event_id, 'event_title', ce.title, 'clicked_at', k.at,
             'bought_after', CASE WHEN c.event_id IS NULL OR k.at IS NULL THEN NULL ELSE EXISTS (
               SELECT 1 FROM public.external_tickets et
                WHERE et.event_id = c.event_id AND lower(et.buyer_email) = v_em
                  AND public._crm_ticket_is_sale(et.status, et.raw)
                  AND (lower(et.utm->>'utm_source') = 'yuno-m-' || left(replace(c.id::text, '-', ''), 8)
                       OR COALESCE(et.purchased_at, et.first_seen_at) BETWEEN k.at AND k.at + interval '7 days')) END) AS x
      FROM public.email_campaign_recipients r
      JOIN public.email_campaigns c ON c.id = r.campaign_id
      LEFT JOIN public.events ce ON ce.id = c.event_id
      LEFT JOIN LATERAL (SELECT min(ev.created_at) AS at FROM public.email_campaign_events ev
                          WHERE ev.campaign_id = c.id AND lower(ev.recipient_email) = v_em AND ev.event_type = 'clicked') k ON true
     WHERE lower(r.email) = v_em AND r.status = 'sent' AND r.sent_at IS NOT NULL
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     ORDER BY r.sent_at DESC LIMIT 40
  ) q;

  SELECT jsonb_agg(jsonb_build_object('m', to_char(m, 'YYYY-MM'),
           'n', (SELECT count(DISTINCT z.event_id) FROM (
                   SELECT t.event_id, t.event_start FROM _cpt t WHERE t.email = v_em
                   UNION ALL
                   SELECT g.event_id, g.event_start FROM _cpg g
                    WHERE g.email = v_em AND g.kind = 'inv' AND g.scanned_at IS NOT NULL) z
                  WHERE date_trunc('month', z.event_start AT TIME ZONE 'Europe/Paris') = m)) ORDER BY m)
    INTO v_months
    FROM generate_series(date_trunc('month', now() AT TIME ZONE 'Europe/Paris') - interval '11 months',
                         date_trunc('month', now() AT TIME ZONE 'Europe/Paris'), interval '1 month') m;

  RETURN jsonb_build_object(
    'email', v_p.email, 'first_name', v_p.first_name, 'last_name', v_p.last_name, 'phone', v_p.phone,
    'email_ok', v_p.email_ok, 'phone_ok', v_p.phone_ok, 'bounced', v_p.bounced, 'eng_status', v_p.eng_status,
    'lifecycle', v_p.lifecycle, 'nights', v_p.nights, 'nights_win', v_p.nights_win, 'spent', v_p.spent,
    'first_night', v_p.first_night, 'last_night', v_p.last_night, 'added_at', v_p.added_at,
    'tonight', v_p.tonight, 'source', v_p.source, 'utm_source', v_p.utm_source, 'origin', v_p.origin,
    'first_source', public._crm_source_label(p_venue_id, p_organizer_user_id, v_p.utm_source),
    'tags', COALESCE(to_jsonb(v_p.tags), '[]'::jsonb), 'note', v_p.note,
    'buys', v_buys, 'messages', v_msgs, 'months', v_months,
    'guests', v_guests,
    'gl', jsonb_build_object('n', v_p.gl_n, 'came', v_p.gl_came, 'first', v_p.gl_first, 'conv', v_p.gl_conv,
                             'paid_n', v_p.paid_n, 'noshow', v_p.gl_noshow),
    'rules', jsonb_build_object('min_nights', v_rules.regular_min_nights, 'window_months', v_rules.regular_window_months,
                                'lapse_months', v_rules.lapse_months));
END;
$function$;

-- ── 6. Liste des soirées : la guest list de chaque soirée ───────────────────
CREATE OR REPLACE FUNCTION public.crm_nights__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
  v_past_total integer;
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_ids uuid[];
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_past_total
    FROM public.events e
   WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL
     AND COALESCE(e.end_at, e.start_at + interval '6 hours') <= now()
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id));

  SELECT array_agg(e.id) INTO v_ids
    FROM public.events e
   WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL
     AND COALESCE(e.end_at, e.start_at + interval '6 hours') > now()
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id));

  WITH tix AS MATERIALIZED (
    SELECT * FROM public._crm_tickets(p_venue_id, p_organizer_user_id)
  ), firsts AS (
    SELECT DISTINCT ON (t.email) t.email, t.event_id
      FROM tix t WHERE t.event_id IS NOT NULL AND t.email IS NOT NULL
     ORDER BY t.email, t.event_start, t.bought_at
  ), nw AS (
    SELECT f.event_id, count(*) AS n FROM firsts f GROUP BY 1
  ), st AS (
    SELECT t.event_id,
           sum(t.qty) AS sold,
           round(sum(t.amount), 2) AS revenue,
           count(DISTINCT t.email) AS buyers,
           COALESCE(sum(t.qty) FILTER (WHERE (t.bought_at AT TIME ZONE 'Europe/Paris')::date = v_today), 0) AS today
      FROM tix t WHERE t.event_id IS NOT NULL GROUP BY 1
  ), gx AS (
    -- Guest list de chaque soirée (20261008100000) et couverture du scan.
    SELECT t.event_id,
           count(*) FILTER (WHERE public._crm_ticket_gl_kind(t.status, t.price, t.raw) IS NOT NULL) AS gl,
           count(*) FILTER (WHERE public._crm_ticket_gl_kind(t.status, t.price, t.raw) = 'inv') AS gl_inv,
           count(*) FILTER (WHERE public._crm_ticket_gl_kind(t.status, t.price, t.raw) IS NOT NULL AND t.scanned_at IS NOT NULL) AS gl_came,
           count(*) FILTER (WHERE public._crm_ticket_gl_kind(t.status, t.price, t.raw) IS NOT NULL
                              AND (COALESCE(t.purchased_at, t.first_seen_at) AT TIME ZONE 'Europe/Paris')::date = v_today) AS gl_today,
           count(*) FILTER (WHERE t.status = 'valid') AS valid,
           count(*) FILTER (WHERE t.status = 'valid' AND t.scanned_at IS NOT NULL) AS scanned
      FROM public.external_tickets t
     WHERE t.event_id IS NOT NULL
       AND ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
     GROUP BY 1
  ), ev AS (
    SELECT e.id, e.title, e.start_at, COALESCE(e.end_at, e.start_at + interval '6 hours') AS end_at,
           COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris') AS tz, e.tickets_sold_out,
           e.external_ticket_url AS url, COALESCE(e.poster_url, e.image_url) AS cover_url,
           COALESCE(x.street, e.location_address) AS street, COALESCE(x.city, e.location_city) AS city,
           x.artists, x.deals, x.left_tickets, x.launched_at,
           COALESCE(st.sold, 0) AS sold, COALESCE(st.revenue, 0) AS revenue, COALESCE(st.buyers, 0) AS buyers,
           COALESCE(st.today, 0) AS today, COALESCE(nw.n, 0) AS new_buyers,
           gx.gl, gx.gl_inv, gx.gl_came, gx.gl_today, gx.valid AS gx_valid, gx.scanned AS gx_scanned,
           COALESCE(e.end_at, e.start_at + interval '6 hours') > now() AS upcoming
      FROM public.events e
      LEFT JOIN public.external_events x ON x.event_id = e.id
      LEFT JOIN st ON st.event_id = e.id
      LEFT JOIN nw ON nw.event_id = e.id
      LEFT JOIN gx ON gx.event_id = e.id
     WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL
       AND e.start_at > now() - interval '25 months'
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
  ), msgs AS (
    SELECT m.event_id,
           jsonb_agg(jsonb_build_object('id', m.id, 'channel', m.channel, 'name', m.name, 'state', m.state, 'at', m.at)
                     ORDER BY CASE m.state WHEN 'draft' THEN 0 WHEN 'plan' THEN 1 ELSE 2 END, m.at DESC) AS list
      FROM public._crm_night_msgs(p_venue_id, p_organizer_user_id, COALESCE(v_ids, '{}')) m
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', ev.id, 'title', ev.title, 'series', COALESCE(public._crm_night_series(ev.title), ev.title),
           'start_at', ev.start_at, 'end_at', ev.end_at, 'tz', ev.tz, 'url', ev.url, 'cover_url', ev.cover_url,
           'street', ev.street, 'city', ev.city,
           'lineup', COALESCE((SELECT jsonb_agg(a->>'name') FROM jsonb_array_elements(
                        CASE WHEN jsonb_typeof(ev.artists) = 'array' THEN ev.artists ELSE '[]'::jsonb END) a
                        WHERE NULLIF(btrim(a->>'name'), '') IS NOT NULL), '[]'::jsonb),
           'upcoming', ev.upcoming,
           'sale_opens_at', CASE WHEN ev.launched_at > now() THEN ev.launched_at END,
           'sold', ev.sold, 'cap', public._crm_night_capacity(ev.left_tickets, ev.deals, ev.sold),
           'sold_out', COALESCE(ev.tickets_sold_out, false) OR COALESCE(ev.left_tickets = 0, false),
           'revenue', ev.revenue, 'buyers', ev.buyers, 'new_buyers', ev.new_buyers, 'today', ev.today,
           'tiers', CASE WHEN ev.upcoming THEN public._crm_night_tiers(ev.id, ev.deals) END,
           'msgs', CASE WHEN ev.upcoming THEN COALESCE(msgs.list, '[]'::jsonb) END,
           'gl', CASE WHEN COALESCE(ev.gl, 0) > 0 THEN jsonb_build_object(
                   'entries', ev.gl, 'inv', ev.gl_inv, 'came', ev.gl_came, 'today', ev.gl_today,
                   'scan_known', NOT ev.upcoming AND ev.gx_valid > 0 AND ev.gx_scanned >= 0.5 * ev.gx_valid) END
         ) ORDER BY ev.start_at), '[]'::jsonb)
    INTO v
    FROM ev LEFT JOIN msgs ON msgs.event_id = ev.id;

  RETURN jsonb_build_object('now', now(), 'past_total', v_past_total, 'nights', v);
END;
$function$;

-- ── 7. Tiroir d'une soirée › Guest list ──────────────────────────────────────
-- Une lecture, sans table temporaire (lisible en aperçu démo). `phase` :
-- upcoming (pas commencée) | live (en cours) | past. Le taux de venue n'existe
-- que pour une soirée passée dont la porte a vraiment scanné (`scan_known`).
-- « Devenu client » : invité sans billet payant AVANT la soirée, qui en a
-- acheté un APRÈS (`after`). Heures médianes en minutes depuis midi (heure de
-- la soirée) : 690 = 23 h 30, 795 = 1 h 15.
CREATE OR REPLACE FUNCTION public.crm_night_guestlist__core(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  e record;
  p record;
  v_tz text;
  v_day date;
  v_today date;
  v_phase text;
  v_series text;
  v_d_end integer;
  v_d_start integer;
  v_known boolean;
  v_out jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT ev.* INTO e FROM public.events ev
   WHERE ev.id = p_event_id AND ev.external_source IS NOT NULL
     AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id));
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  v_tz := COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris');
  v_day := (e.start_at AT TIME ZONE v_tz)::date;
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_phase := CASE WHEN e.start_at > now() THEN 'upcoming'
                  WHEN COALESCE(e.end_at, e.start_at + interval '6 hours') > now() THEN 'live'
                  ELSE 'past' END;
  v_series := lower(COALESCE(public._crm_night_series(e.title), e.title));
  v_d_end := CASE WHEN v_phase = 'upcoming' THEN GREATEST(0, v_day - v_today) ELSE 0 END;
  v_known := v_phase = 'past' AND public._crm_event_scan_known(p_event_id);

  -- La fois d'avant : même série, sinon la soirée passée précédente — avec une guest list.
  SELECT ev.id, ev.title, ev.start_at, COALESCE(NULLIF(ev.timezone, ''), 'Europe/Paris') AS tz,
         lower(COALESCE(public._crm_night_series(ev.title), ev.title)) = v_series AS same_series
    INTO p
    FROM public.events ev
   WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL AND ev.id <> p_event_id
     AND ev.start_at < e.start_at
     AND COALESCE(ev.end_at, ev.start_at + interval '6 hours') <= now()
     AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
     AND EXISTS (SELECT 1 FROM public.external_tickets t
                  WHERE t.event_id = ev.id AND public._crm_ticket_gl_kind(t.status, t.price, t.raw) IS NOT NULL)
   ORDER BY (lower(COALESCE(public._crm_night_series(ev.title), ev.title)) = v_series) DESC, ev.start_at DESC
   LIMIT 1;

  -- Début de la courbe des inscriptions : la plus ancienne (60 jours au plus).
  SELECT LEAST(60, GREATEST(v_d_end, COALESCE(max(GREATEST(0, v_day - (COALESCE(t.purchased_at, t.first_seen_at) AT TIME ZONE v_tz)::date)), v_d_end)))
    INTO v_d_start
    FROM public.external_tickets t
   WHERE t.event_id = p_event_id AND public._crm_ticket_gl_kind(t.status, t.price, t.raw) IS NOT NULL;

  WITH night AS MATERIALIZED (
    SELECT lower(t.buyer_email) AS email, t.status, t.raw_status,
           public._crm_ticket_gl_kind(t.status, t.price, t.raw) AS gl,
           (public._crm_ticket_is_sale(t.status, t.raw) AND COALESCE(t.price, 0) > 0) AS paid,
           COALESCE(t.purchased_at, t.first_seen_at) AS at, t.scanned_at,
           NULLIF(btrim(t.deal_name), '') AS deal, t.gender, t.age,
           NULLIF(btrim(t.buyer_first_name), '') AS fn, NULLIF(btrim(t.buyer_last_name), '') AS ln,
           GREATEST(0, v_day - (COALESCE(t.purchased_at, t.first_seen_at) AT TIME ZONE v_tz)::date) AS d
      FROM public.external_tickets t
     WHERE t.event_id = p_event_id
       AND ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
  ), gl AS (
    SELECT * FROM night WHERE gl IS NOT NULL
  ), pv AS (
    SELECT t.scanned_at,
           GREATEST(0, (p.start_at AT TIME ZONE p.tz)::date - (COALESCE(t.purchased_at, t.first_seen_at) AT TIME ZONE p.tz)::date) AS d
      FROM public.external_tickets t
     WHERE p.id IS NOT NULL AND t.event_id = p.id
       AND public._crm_ticket_gl_kind(t.status, t.price, t.raw) IS NOT NULL
  ), ppl AS (
    SELECT g.email, min(g.at) AS at, min(g.scanned_at) AS scanned_at,
           (array_agg(g.deal ORDER BY g.at))[1] AS deal, (array_agg(g.gl ORDER BY g.at))[1] AS kind,
           max(g.fn) AS fn, max(g.ln) AS ln, count(*) AS n
      FROM gl g WHERE g.email IS NOT NULL
     GROUP BY g.email
  ), pa AS (
    -- Ce que chaque invité a fait chez vous avant et après cette soirée.
    SELECT pp.email,
           bool_or(public._crm_ticket_is_sale(t.status, t.raw) AND COALESCE(t.price, 0) > 0
                   AND COALESCE(t.purchased_at, t.first_seen_at) < e.start_at
                   AND t.event_id IS DISTINCT FROM p_event_id) AS paid_before,
           bool_or(ev.start_at < e.start_at AND t.event_id IS DISTINCT FROM p_event_id
                   AND (public._crm_ticket_is_sale(t.status, t.raw)
                        OR public._crm_ticket_gl_kind(t.status, t.price, t.raw) IS NOT NULL)) AS seen_before,
           min(COALESCE(t.purchased_at, t.first_seen_at)) FILTER (
             WHERE public._crm_ticket_is_sale(t.status, t.raw) AND COALESCE(t.price, 0) > 0
               AND COALESCE(t.purchased_at, t.first_seen_at) > e.start_at
               AND t.event_id IS DISTINCT FROM p_event_id) AS paid_after_at,
           COALESCE(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)) FILTER (
             WHERE public._crm_ticket_is_sale(t.status, t.raw) AND COALESCE(t.price, 0) > 0
               AND COALESCE(t.purchased_at, t.first_seen_at) > e.start_at
               AND t.event_id IS DISTINCT FROM p_event_id), 0) AS paid_after,
           bool_or(ev.start_at > e.start_at
                   AND (public._crm_ticket_is_sale(t.status, t.raw)
                        OR public._crm_ticket_gl_kind(t.status, t.price, t.raw) IS NOT NULL)) AS later
      FROM ppl pp
      JOIN public.external_tickets t
        ON t.buyer_email IS NOT NULL AND lower(t.buyer_email) = pp.email
       AND ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
      LEFT JOIN public.events ev ON ev.id = t.event_id
     GROUP BY pp.email
  ), lists AS (
    SELECT COALESCE(g.deal, '') AS name,
           CASE WHEN bool_and(g.gl = 'inv') THEN 'inv' WHEN bool_and(g.gl = 'free') THEN 'free' ELSE 'mix' END AS kind,
           count(*) AS entries,
           count(*) FILTER (WHERE g.scanned_at IS NOT NULL) AS came,
           count(DISTINCT g.email) FILTER (WHERE NOT a.seen_before) AS first,
           count(DISTINCT g.email) FILTER (WHERE NOT a.paid_before AND a.paid_after_at IS NOT NULL) AS conv
      FROM gl g LEFT JOIN pa a ON a.email = g.email
     GROUP BY COALESCE(g.deal, '')
  ), arr AS (
    SELECT extract(hour FROM n.scanned_at AT TIME ZONE v_tz)::int AS h,
           count(*) FILTER (WHERE n.gl IS NOT NULL) AS gl,
           count(*) FILTER (WHERE n.paid) AS paid
      FROM night n WHERE n.scanned_at IS NOT NULL AND n.status = 'valid'
     GROUP BY 1
  ), med AS (
    SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY m) FILTER (WHERE k = 'gl') AS gl,
           percentile_disc(0.5) WITHIN GROUP (ORDER BY m) FILTER (WHERE k = 'paid') AS paid
      FROM (SELECT CASE WHEN n.gl IS NOT NULL THEN 'gl' WHEN n.paid THEN 'paid' END AS k,
                   ((extract(hour FROM n.scanned_at AT TIME ZONE v_tz)::int * 60
                     + extract(minute FROM n.scanned_at AT TIME ZONE v_tz)::int) + 720) % 1440 AS m
              FROM night n WHERE n.scanned_at IS NOT NULL AND n.status = 'valid') z
  ), prof AS (
    SELECT k,
           count(*) FILTER (WHERE gender IN ('female', 'male', 'other')) AS g_known,
           count(*) FILTER (WHERE gender = 'female') AS f,
           count(*) FILTER (WHERE age BETWEEN 14 AND 99) AS a_known,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY age::float8) FILTER (WHERE age BETWEEN 14 AND 99) AS age_med
      FROM (SELECT CASE WHEN n.gl IS NOT NULL THEN 'gl' WHEN n.paid THEN 'paid' END AS k, n.gender, n.age
              FROM night n) z
     WHERE k IS NOT NULL
     GROUP BY k
  ), tot AS (
    SELECT count(*) FILTER (WHERE gl IS NOT NULL) AS entries,
           count(*) FILTER (WHERE gl = 'inv') AS inv,
           count(*) FILTER (WHERE gl = 'free') AS free,
           count(*) FILTER (WHERE gl IS NOT NULL AND scanned_at IS NOT NULL) AS came,
           count(*) FILTER (WHERE paid) AS paid,
           count(*) FILTER (WHERE paid AND scanned_at IS NOT NULL) AS paid_came,
           count(*) FILTER (WHERE gl IS NOT NULL AND (at AT TIME ZONE v_tz)::date = v_today) AS today,
           count(*) FILTER (WHERE status = 'other' AND lower(COALESCE(raw_status, '')) = 'pending_approval') AS pending,
           count(*) FILTER (WHERE lower(COALESCE(raw_status, '')) = 'rejected') AS rejected,
           count(*) FILTER (WHERE status = 'valid' AND scanned_at IS NOT NULL) AS scanned
      FROM night
  )
  SELECT jsonb_build_object(
    'event', jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at,
               'end_at', COALESCE(e.end_at, e.start_at + interval '6 hours'), 'tz', v_tz,
               'phase', v_phase, 'url', e.external_ticket_url),
    'scan_known', v_known,
    'totals', (SELECT jsonb_build_object(
        'entries', t.entries, 'inv', t.inv, 'free', t.free,
        'people', (SELECT count(*) FROM ppl),
        'came', t.came, 'paid', t.paid, 'paid_came', t.paid_came, 'today', t.today,
        'pending', t.pending, 'rejected', t.rejected,
        'showup', CASE WHEN v_known AND t.entries > 0 THEN round(100.0 * t.came / t.entries, 1) END,
        'paid_showup', CASE WHEN v_known AND t.paid > 0 THEN round(100.0 * t.paid_came / t.paid, 1) END,
        'free_share', CASE WHEN (v_known OR (v_phase = 'live' AND t.scanned > 0)) AND t.came + t.paid_came > 0
                           THEN round(100.0 * t.came / (t.came + t.paid_came), 1) END)
        FROM tot t),
    'prev', CASE WHEN p.id IS NOT NULL THEN (
        SELECT jsonb_build_object('id', p.id, 'title', p.title, 'start_at', p.start_at, 'same_series', p.same_series,
                 'entries', count(*), 'came', count(*) FILTER (WHERE pv.scanned_at IS NOT NULL),
                 'same_day', count(*) FILTER (WHERE pv.d >= v_d_end),
                 'showup', CASE WHEN public._crm_event_scan_known(p.id) AND count(*) > 0
                                THEN round(100.0 * count(*) FILTER (WHERE pv.scanned_at IS NOT NULL) / count(*), 1) END)
          FROM pv) END,
    'curve', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'd', s.d,
                'v', (SELECT count(*) FROM gl WHERE gl.d >= s.d),
                'pv', CASE WHEN p.id IS NOT NULL THEN (SELECT count(*) FROM pv WHERE pv.d >= s.d) END) ORDER BY s.d DESC), '[]'::jsonb)
                FROM generate_series(v_d_end, GREATEST(v_d_end, v_d_start)) AS s(d)),
    'lists', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'name', NULLIF(l.name, ''), 'kind', l.kind, 'entries', l.entries, 'came', l.came,
                'showup', CASE WHEN v_known AND l.entries > 0 THEN round(100.0 * l.came / l.entries, 1) END,
                'first', l.first, 'conv', CASE WHEN v_phase = 'past' THEN l.conv END)
                ORDER BY l.entries DESC, l.name), '[]'::jsonb) FROM lists l),
    'who', (SELECT jsonb_build_object(
              'first', count(*) FILTER (WHERE NOT a.seen_before),
              'gl', count(*) FILTER (WHERE a.seen_before AND NOT a.paid_before),
              'buyers', count(*) FILTER (WHERE a.paid_before))
              FROM ppl pp JOIN pa a ON a.email = pp.email),
    'after', CASE WHEN v_phase = 'past' THEN (SELECT jsonb_build_object(
              'eligible', count(*) FILTER (WHERE NOT a.paid_before),
              'converted', count(*) FILTER (WHERE NOT a.paid_before AND a.paid_after_at IS NOT NULL),
              'revenue', round(COALESCE(sum(a.paid_after) FILTER (WHERE NOT a.paid_before AND a.paid_after_at IS NOT NULL), 0), 2),
              'back', count(*) FILTER (WHERE a.later))
              FROM ppl pp JOIN pa a ON a.email = pp.email) END,
    'arrivals', (SELECT jsonb_build_object(
              'slots', COALESCE((SELECT jsonb_agg(jsonb_build_object('h', r.h, 'gl', r.gl, 'paid', r.paid)
                                   ORDER BY (r.h + 12) % 24) FROM arr r), '[]'::jsonb),
              'gl_med', CASE WHEN (SELECT count(*) FROM gl WHERE gl.scanned_at IS NOT NULL) >= 10 THEN m.gl END,
              'paid_med', CASE WHEN (SELECT count(*) FROM night n WHERE n.paid AND n.scanned_at IS NOT NULL) >= 10 THEN m.paid END)
              FROM med m),
    'profile', (SELECT COALESCE(jsonb_object_agg(pr.k, jsonb_build_object(
              'known', pr.g_known,
              'female_pct', CASE WHEN pr.g_known >= 10 THEN round(100.0 * pr.f / pr.g_known, 1) END,
              'age_known', pr.a_known,
              'age_med', CASE WHEN pr.a_known >= 10 THEN round(pr.age_med::numeric, 0) END)), '{}'::jsonb)
              FROM prof pr),
    'people', (SELECT COALESCE(jsonb_agg(z.x ORDER BY z.o1, z.o2 NULLS LAST, z.o3 DESC), '[]'::jsonb) FROM (
              SELECT jsonb_build_object(
                       'email', pp.email,
                       'name', NULLIF(btrim(COALESCE(pp.fn, '') || ' ' || COALESCE(left(pp.ln, 1) || '.', '')), ''),
                       'list', pp.deal, 'kind', pp.kind, 'n', pp.n,
                       'came', pp.scanned_at IS NOT NULL, 'scanned_at', pp.scanned_at, 'at', pp.at,
                       'tag', CASE WHEN NOT a.seen_before THEN 'first' WHEN a.paid_before THEN 'buyer' ELSE 'gl' END,
                       'conv', v_phase = 'past' AND NOT a.paid_before AND a.paid_after_at IS NOT NULL) AS x,
                     (v_phase <> 'upcoming' AND pp.scanned_at IS NULL) AS o1,
                     CASE WHEN v_phase <> 'upcoming' THEN pp.scanned_at END AS o2,
                     pp.at AS o3
                FROM ppl pp JOIN pa a ON a.email = pp.email
               ORDER BY 2, 3 NULLS LAST, 4 DESC
               LIMIT 80) z),
    'synced_at', (SELECT x.synced_at FROM public.external_events x WHERE x.event_id = p_event_id LIMIT 1)
  ) INTO v_out;

  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_night_guestlist__core(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_night_guestlist__core(text, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_night_guestlist(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._crm_money_gate(public.crm_night_guestlist__core(p_venue_id, p_organizer_user_id, p_event_id), p_venue_id, p_organizer_user_id);
$function$;
REVOKE ALL ON FUNCTION public.crm_night_guestlist(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_night_guestlist(text, uuid, uuid) TO authenticated, service_role;

-- ── 8. Analyses › Guest list (une période) ───────────────────────────────────
-- Soirées COMMENCÉES dont la nuit tombe dans la fenêtre (même découpage que
-- `_crm_ana_setup` : 24 h = la nuit en cours, 7 / 30 / 90 jours, 12 mois),
-- comparées à la même durée juste avant. Taux de venue et part des entrées
-- gratuites : sur les seules soirées dont la porte a vraiment scanné.
-- « Habitués de la guest list » et « inscrits qui ne viennent pas » sont
-- calculés sur tout l'historique, avec les définitions des filtres Clients
-- (`loyal`, `noshow`) : le chiffre affiché = la liste qu'on ouvre.
CREATE OR REPLACE FUNCTION public.crm_ana_guestlist__core(p_venue_id text, p_organizer_user_id uuid, p_period text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tz text := 'Europe/Paris';
  v_eh integer;
  v_today date;
  v_n integer := CASE p_period WHEN '24h' THEN 1 WHEN '48h' THEN 2 WHEN '7d' THEN 7 WHEN '90d' THEN 90 WHEN '12m' THEN 365 ELSE 30 END;
  v_from date;
  v_pfrom date;
  v_out jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT r.night_end_hour INTO v_eh FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id) r;
  v_today := public._crm_night_date(now(), v_tz, COALESCE(v_eh, 6));
  v_from := v_today - (v_n - 1);
  v_pfrom := v_from - v_n;

  WITH evs AS MATERIALIZED (
    SELECT ev.id, ev.title, ev.start_at, COALESCE(NULLIF(ev.timezone, ''), v_tz) AS tz,
           COALESCE(ev.end_at, ev.start_at + interval '6 hours') AS end_at,
           public._crm_night_date(ev.start_at, COALESCE(NULLIF(ev.timezone, ''), v_tz), COALESCE(v_eh, 6)) AS night
      FROM public.events ev
     WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
  ), tk AS MATERIALIZED (
    SELECT t.event_id, lower(t.buyer_email) AS email,
           public._crm_ticket_gl_kind(t.status, t.price, t.raw) AS gl,
           (public._crm_ticket_is_sale(t.status, t.raw) AND COALESCE(t.price, 0) > 0) AS paid,
           COALESCE(t.price, 0) * GREATEST(t.quantity, 1) AS amount,
           COALESCE(t.purchased_at, t.first_seen_at) AS at, t.scanned_at,
           NULLIF(btrim(t.deal_name), '') AS deal, t.gender, t.age
      FROM public.external_tickets t
     WHERE t.status = 'valid'
       AND ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
  ), ev2 AS MATERIALIZED (
    SELECT e.id, e.title, e.start_at, e.tz, e.end_at, e.night,
           count(t.event_id) FILTER (WHERE t.gl IS NOT NULL) AS entries,
           count(t.event_id) FILTER (WHERE t.gl = 'inv') AS inv,
           count(t.event_id) FILTER (WHERE t.gl IS NOT NULL AND t.scanned_at IS NOT NULL) AS came,
           count(t.event_id) FILTER (WHERE t.paid) AS paid,
           count(t.event_id) FILTER (WHERE t.paid AND t.scanned_at IS NOT NULL) AS paid_came,
           (e.end_at <= now() AND count(t.event_id) > 0
             AND count(t.event_id) FILTER (WHERE t.scanned_at IS NOT NULL) >= 0.5 * count(t.event_id)) AS known,
           CASE WHEN e.night BETWEEN v_from AND v_today AND e.start_at <= now() THEN 'cur'
                WHEN e.night BETWEEN v_pfrom AND v_from - 1 AND e.start_at <= now() THEN 'prev' END AS w
      FROM evs e LEFT JOIN tk t ON t.event_id = e.id
     GROUP BY e.id, e.title, e.start_at, e.tz, e.end_at, e.night
  ), wt AS (
    SELECT w,
           count(*) AS nights,
           count(*) FILTER (WHERE entries > 0) AS gl_nights,
           COALESCE(sum(entries), 0) AS entries, COALESCE(sum(inv), 0) AS inv, COALESCE(sum(came), 0) AS came,
           COALESCE(sum(entries) FILTER (WHERE known), 0) AS k_entries,
           COALESCE(sum(came) FILTER (WHERE known), 0) AS k_came,
           COALESCE(sum(paid_came) FILTER (WHERE known), 0) AS k_paid_came,
           count(*) FILTER (WHERE known AND entries > 0) AS k_nights
      FROM ev2 WHERE w IS NOT NULL
     GROUP BY w
  ), wpeople AS (
    SELECT e.w, count(DISTINCT t.email) AS people
      FROM tk t JOIN ev2 e ON e.id = t.event_id
     WHERE e.w IS NOT NULL AND t.gl IS NOT NULL AND t.email IS NOT NULL
     GROUP BY e.w
  ), wppl AS (
    -- Invités des soirées TERMINÉES de la fenêtre : leur première soirée en guest list.
    SELECT t.email, min(e.start_at) AS first_start
      FROM tk t JOIN ev2 e ON e.id = t.event_id
     WHERE e.w = 'cur' AND e.end_at <= now() AND t.gl IS NOT NULL AND t.email IS NOT NULL
     GROUP BY t.email
  ), wconv AS (
    SELECT w.email,
           bool_or(t.paid AND t.at < w.first_start) AS paid_before,
           min(t.at) FILTER (WHERE t.paid AND t.at > w.first_start) AS paid_after_at,
           COALESCE(sum(t.amount) FILTER (WHERE t.paid AND t.at > w.first_start), 0) AS paid_after
      FROM wppl w JOIN tk t ON t.email = w.email
     GROUP BY w.email
  ), wlists AS (
    SELECT COALESCE(t.deal, '') AS name,
           CASE WHEN bool_and(t.gl = 'inv') THEN 'inv' WHEN bool_and(t.gl = 'free') THEN 'free' ELSE 'mix' END AS kind,
           count(DISTINCT t.event_id) AS nights,
           count(*) AS entries,
           count(*) FILTER (WHERE e.known) AS k_entries,
           count(*) FILTER (WHERE e.known AND t.scanned_at IS NOT NULL) AS k_came,
           count(DISTINCT t.email) FILTER (WHERE c.email IS NOT NULL AND NOT c.paid_before) AS eligible,
           count(DISTINCT t.email) FILTER (WHERE c.email IS NOT NULL AND NOT c.paid_before AND c.paid_after_at IS NOT NULL) AS conv
      FROM tk t
      JOIN ev2 e ON e.id = t.event_id AND e.w = 'cur'
      LEFT JOIN wconv c ON c.email = t.email
     WHERE t.gl IS NOT NULL
     GROUP BY COALESCE(t.deal, '')
  ), arr AS (
    SELECT extract(hour FROM t.scanned_at AT TIME ZONE e.tz)::int AS h,
           count(*) FILTER (WHERE t.gl IS NOT NULL) AS gl,
           count(*) FILTER (WHERE t.paid) AS paid
      FROM tk t JOIN ev2 e ON e.id = t.event_id AND e.w = 'cur' AND e.known
     WHERE t.scanned_at IS NOT NULL
     GROUP BY 1
  ), med AS (
    SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY m) FILTER (WHERE k = 'gl') AS gl,
           percentile_disc(0.5) WITHIN GROUP (ORDER BY m) FILTER (WHERE k = 'paid') AS paid,
           count(*) FILTER (WHERE k = 'gl') AS n_gl, count(*) FILTER (WHERE k = 'paid') AS n_paid
      FROM (SELECT CASE WHEN t.gl IS NOT NULL THEN 'gl' WHEN t.paid THEN 'paid' END AS k,
                   ((extract(hour FROM t.scanned_at AT TIME ZONE e.tz)::int * 60
                     + extract(minute FROM t.scanned_at AT TIME ZONE e.tz)::int) + 720) % 1440 AS m
              FROM tk t JOIN ev2 e ON e.id = t.event_id AND e.w = 'cur' AND e.known
             WHERE t.scanned_at IS NOT NULL) z
  ), prof AS (
    SELECT k,
           count(*) FILTER (WHERE gender IN ('female', 'male', 'other')) AS g_known,
           count(*) FILTER (WHERE gender = 'female') AS f,
           count(*) FILTER (WHERE age BETWEEN 14 AND 99) AS a_known,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY age::float8) FILTER (WHERE age BETWEEN 14 AND 99) AS age_med
      FROM (SELECT CASE WHEN t.gl IS NOT NULL THEN 'gl' WHEN t.paid THEN 'paid' END AS k, t.gender, t.age
              FROM tk t JOIN ev2 e ON e.id = t.event_id AND e.w = 'cur') z
     WHERE k IS NOT NULL
     GROUP BY k
  ), persons AS (
    -- Tout l'historique, définitions des filtres Clients `loyal` et `noshow`.
    SELECT t.email,
           count(DISTINCT t.event_id) FILTER (WHERE t.gl IS NOT NULL) AS gl_n,
           count(*) FILTER (WHERE t.paid) AS paid_n,
           count(*) FILTER (WHERE t.gl IS NOT NULL AND t.scanned_at IS NULL AND e.known) AS noshow,
           min(e.start_at) FILTER (WHERE t.gl IS NOT NULL) AS gl_first,
           min(t.at) FILTER (WHERE t.paid) AS first_paid
      FROM tk t LEFT JOIN ev2 e ON e.id = t.event_id
     WHERE t.email IS NOT NULL
     GROUP BY t.email
  ), nxt AS (
    SELECT e.id, e.title, e.start_at, e.tz, e.entries, e.inv,
           (SELECT count(*) FROM tk t WHERE t.event_id = e.id AND t.gl IS NOT NULL
               AND (t.at AT TIME ZONE e.tz)::date = (now() AT TIME ZONE e.tz)::date) AS today
      FROM ev2 e WHERE e.start_at > now()
     ORDER BY e.start_at LIMIT 1
  )
  SELECT jsonb_build_object(
    'meta', jsonb_build_object('period', p_period, 'days', v_n, 'from', v_from, 'to', v_today, 'today', v_today),
    'has_any', EXISTS (SELECT 1 FROM tk WHERE tk.gl IS NOT NULL),
    'totals', (SELECT jsonb_build_object(
        'nights', COALESCE(c.nights, 0), 'gl_nights', COALESCE(c.gl_nights, 0),
        'entries', COALESCE(c.entries, 0), 'inv', COALESCE(c.inv, 0), 'came', COALESCE(c.came, 0),
        'people', COALESCE((SELECT people FROM wpeople WHERE w = 'cur'), 0),
        'scan_nights', COALESCE(c.k_nights, 0),
        'showup', CASE WHEN c.k_entries > 0 THEN round(100.0 * c.k_came / c.k_entries, 1) END,
        'free_share', CASE WHEN c.k_came + c.k_paid_came > 0 THEN round(100.0 * c.k_came / (c.k_came + c.k_paid_came), 1) END,
        'prev_nights', COALESCE(pr.nights, 0),
        'prev_entries', COALESCE(pr.entries, 0),
        'prev_people', COALESCE((SELECT people FROM wpeople WHERE w = 'prev'), 0),
        'prev_showup', CASE WHEN pr.k_entries > 0 THEN round(100.0 * pr.k_came / pr.k_entries, 1) END,
        'prev_free_share', CASE WHEN pr.k_came + pr.k_paid_came > 0 THEN round(100.0 * pr.k_came / (pr.k_came + pr.k_paid_came), 1) END)
        FROM (SELECT 1) one
        LEFT JOIN wt c ON c.w = 'cur'
        LEFT JOIN wt pr ON pr.w = 'prev'),
    'conv', (SELECT jsonb_build_object(
        'eligible', count(*) FILTER (WHERE NOT c.paid_before),
        'converted', count(*) FILTER (WHERE NOT c.paid_before AND c.paid_after_at IS NOT NULL),
        'revenue', round(COALESCE(sum(c.paid_after) FILTER (WHERE NOT c.paid_before AND c.paid_after_at IS NOT NULL), 0), 2),
        'median_days', (SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY GREATEST(0, (c2.paid_after_at::date - w2.first_start::date)))
                          FROM wconv c2 JOIN wppl w2 ON w2.email = c2.email
                         WHERE NOT c2.paid_before AND c2.paid_after_at IS NOT NULL))
        FROM wconv c),
    'nights', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', z.id, 'title', z.title, 'start_at', z.start_at, 'tz', z.tz, 'live', z.end_at > now(),
        'entries', z.entries, 'inv', z.inv, 'came', z.came, 'paid_came', z.paid_came, 'scan_known', z.known,
        'showup', CASE WHEN z.known AND z.entries > 0 THEN round(100.0 * z.came / z.entries, 1) END) ORDER BY z.start_at), '[]'::jsonb)
        FROM (SELECT * FROM ev2 WHERE w = 'cur' ORDER BY start_at DESC LIMIT 40) z),
    'lists', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', NULLIF(l.name, ''), 'kind', l.kind, 'nights', l.nights, 'entries', l.entries,
        'showup', CASE WHEN l.k_entries > 0 THEN round(100.0 * l.k_came / l.k_entries, 1) END,
        'eligible', l.eligible, 'conv', l.conv,
        'conv_pct', CASE WHEN l.eligible >= 10 THEN round(100.0 * l.conv / l.eligible, 1) END)
        ORDER BY l.entries DESC, l.name), '[]'::jsonb) FROM (SELECT * FROM wlists ORDER BY entries DESC LIMIT 12) l),
    'arrivals', (SELECT jsonb_build_object(
        'slots', COALESCE((SELECT jsonb_agg(jsonb_build_object('h', r.h, 'gl', r.gl, 'paid', r.paid) ORDER BY (r.h + 12) % 24) FROM arr r), '[]'::jsonb),
        'gl_med', CASE WHEN m.n_gl >= 10 THEN m.gl END,
        'paid_med', CASE WHEN m.n_paid >= 10 THEN m.paid END)
        FROM med m),
    'profile', (SELECT COALESCE(jsonb_object_agg(pr.k, jsonb_build_object(
        'known', pr.g_known,
        'female_pct', CASE WHEN pr.g_known >= 10 THEN round(100.0 * pr.f / pr.g_known, 1) END,
        'age_known', pr.a_known,
        'age_med', CASE WHEN pr.a_known >= 10 THEN round(pr.age_med::numeric, 0) END)), '{}'::jsonb)
        FROM prof pr),
    'loyal', (SELECT count(*) FROM persons WHERE gl_n >= 3 AND paid_n = 0),
    'noshow', (SELECT count(*) FROM persons WHERE noshow >= 2),
    -- Devenus clients sur tout l'historique : filtre Clients `conv`.
    'conv_all', (SELECT count(*) FROM persons WHERE gl_first IS NOT NULL AND first_paid > gl_first),
    'next', (SELECT jsonb_build_object('id', x.id, 'title', x.title, 'start_at', x.start_at, 'tz', x.tz,
                                       'entries', x.entries, 'inv', x.inv, 'today', x.today) FROM nxt x)
  ) INTO v_out;

  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_ana_guestlist__core(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_ana_guestlist__core(text, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_ana_guestlist(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._crm_money_gate(public.crm_ana_guestlist__core(p_venue_id, p_organizer_user_id, p_period), p_venue_id, p_organizer_user_id);
$function$;
REVOKE ALL ON FUNCTION public.crm_ana_guestlist(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_ana_guestlist(text, uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
