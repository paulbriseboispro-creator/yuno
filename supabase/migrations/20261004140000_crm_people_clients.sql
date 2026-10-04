-- ============================================================================
-- Yuno CRM — les personnes : base de clients, filtres, fiche client.
-- (écran « Clients » du design, et socle de Segments et des audiences).
--
-- _crm_people_build(portée, à_la_date) : une table de travail `_cp`, une ligne
--   par client de la base vivante (contact_build_rows), enrichie des soirées
--   de la billetterie connectée (_crm_tickets) : nombre de soirées (toutes et
--   dans la fenêtre de la règle « habitué »), première et dernière soirée,
--   dépense, soirées faites, place pour ce soir, source d'arrivée, et le CYCLE
--   DE VIE selon les réglages de l'espace (crm_scope_rules) :
--     end  endormi    : dernière soirée plus ancienne que « à réactiver » ;
--     hab  habitué    : au moins N soirées sur les M derniers mois ;
--     nou  nouveau    : première soirée il y a moins de 90 jours ;
--     occ  occasionnel: les autres clients déjà venus ;
--     none sans soirée: contact connu (import, inscription) jamais venu.
--   Les cinq ne se chevauchent pas. `p_at` rejoue la base à une date passée
--   (écarts « vs le mois dernier »).
-- _crm_filter_sql(def) : le filtre de la liste Clients (et des segments à
--   vous) en SQL, sur une liste blanche de critères ; un critère inconnu ne
--   filtre rien de plus, une valeur inconnue ne laisse passer personne.
-- crm_clients_overview / crm_clients_list / crm_client / crm_client_save /
--   crm_audience_count : lectures et notes de l'écran Clients.
-- crm_contact_notes : étiquettes et note interne d'un client (par portée).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.crm_contact_notes (
  scope_key text NOT NULL,
  email text NOT NULL,
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  tags text[] NOT NULL DEFAULT '{}',
  note text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, email),
  CHECK ((venue_id IS NULL) <> (organizer_user_id IS NULL))
);
ALTER TABLE public.crm_contact_notes ENABLE ROW LEVEL SECURITY;

-- ── Table de travail des personnes ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._crm_people_build(p_venue_id text, p_organizer_user_id uuid, p_at timestamptz DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET plan_cache_mode = 'force_custom_plan'
AS $$
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
  WITH agg AS (
    SELECT t.email,
           count(DISTINCT t.event_id) FILTER (WHERE t.event_start <= v_at) AS nights,
           count(DISTINCT t.event_id) FILTER (WHERE t.event_start <= v_at
                 AND t.event_start > v_at - make_interval(months => v_rules.regular_window_months)) AS nights_win,
           min(t.event_start) FILTER (WHERE t.event_start <= v_at) AS first_night,
           max(t.event_start) FILTER (WHERE t.event_start <= v_at) AS last_night,
           COALESCE(sum(t.amount), 0) AS spent,
           array_agg(DISTINCT t.event_id) FILTER (WHERE t.event_id IS NOT NULL) AS events,
           bool_or(t.event_id = v_tonight) AS tonight,
           min(t.bought_at) AS first_buy
      FROM _cpt t
     WHERE t.email IS NOT NULL
     GROUP BY t.email
  ), first_utm AS (
    SELECT DISTINCT ON (lower(et.buyer_email)) lower(et.buyer_email) AS email,
           et.utm->>'utm_source' AS utm_source, et.utm->>'utm_medium' AS utm_medium
      FROM public.external_tickets et
     WHERE et.buyer_email IS NOT NULL
       AND ((p_venue_id IS NOT NULL AND et.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND et.organizer_user_id = p_organizer_user_id))
     ORDER BY lower(et.buyer_email), COALESCE(et.purchased_at, et.first_seen_at)
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
         a.first_night, a.last_night, round(COALESCE(a.spent, 0), 2) AS spent,
         COALESCE(a.events, '{}'::uuid[]) AS events, COALESCE(a.tonight, false) AS tonight,
         CASE WHEN COALESCE(a.nights, 0) > 0 AND u.utm_source = 'yuno' THEN 'utm'
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
         n.tags, n.note
    FROM base b
    LEFT JOIN agg a ON a.email = b.email
    LEFT JOIN first_utm u ON u.email = b.email
    LEFT JOIN public.crm_contact_notes n ON n.scope_key = v_scope AND n.email = b.email;

  SELECT count(*) INTO v_n FROM _cp;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public._crm_people_build(text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_people_build(text, uuid, timestamptz) TO service_role;

-- ── Filtre (liste Clients, segments à vous) ────────────────────────────────

CREATE OR REPLACE FUNCTION public._crm_filter_sql(p_def jsonb, p_alias text DEFAULT 'p')
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
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
$$;

REVOKE ALL ON FUNCTION public._crm_filter_sql(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_filter_sql(jsonb, text) TO service_role;

-- ── Vue d'ensemble de la base ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crm_clients_overview(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules record;
  v_now timestamptz := now();
  v_tz text := 'Europe/Paris';
  v_today timestamptz := date_trunc('day', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris';
  v_cur jsonb;
  v_prev jsonb;
  v_spark jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);

  -- Il y a 30 jours (écarts « vs le mois dernier »).
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, v_now - interval '30 days');
  SELECT jsonb_build_object(
           'total', count(*),
           'returning_pct', CASE WHEN count(*) FILTER (WHERE nights >= 1) > 0
             THEN round(count(*) FILTER (WHERE nights >= 2)::numeric * 100 / count(*) FILTER (WHERE nights >= 1), 1) END,
           'avg_spend', CASE WHEN count(*) FILTER (WHERE spent > 0) > 0
             THEN round(avg(spent) FILTER (WHERE spent > 0), 2) END)
    INTO v_prev FROM _cp;

  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, v_now);
  SELECT jsonb_agg(c ORDER BY d) INTO v_spark FROM (
    SELECT d, (SELECT count(*) FROM _cp x WHERE x.added_at < ((date_trunc('day', v_now AT TIME ZONE v_tz) - (29 - d) * interval '1 day' + interval '1 day') AT TIME ZONE v_tz)) AS c
      FROM generate_series(0, 29) d) s;

  SELECT jsonb_build_object(
           'total', count(*),
           'today', count(*) FILTER (WHERE added_at >= v_today),
           'month', count(*) FILTER (WHERE added_at >= v_now - interval '30 days'),
           'lifecycle', jsonb_build_object(
              'hab', count(*) FILTER (WHERE lifecycle = 'hab'),
              'occ', count(*) FILTER (WHERE lifecycle = 'occ'),
              'nou', count(*) FILTER (WHERE lifecycle = 'nou'),
              'end', count(*) FILTER (WHERE lifecycle = 'end'),
              'none', count(*) FILTER (WHERE lifecycle = 'none')),
           'end_reachable', count(*) FILTER (WHERE lifecycle = 'end' AND (email_ok OR phone_ok)),
           'reachable', count(*) FILTER (WHERE email_ok OR phone_ok),
           'unreachable', count(*) FILTER (WHERE NOT email_ok AND NOT phone_ok),
           'returning_pct', CASE WHEN count(*) FILTER (WHERE nights >= 1) > 0
             THEN round(count(*) FILTER (WHERE nights >= 2)::numeric * 100 / count(*) FILTER (WHERE nights >= 1), 1) END,
           'once', count(*) FILTER (WHERE nights = 1),
           'avg_spend', CASE WHEN count(*) FILTER (WHERE spent > 0) > 0
             THEN round(avg(spent) FILTER (WHERE spent > 0), 2) END)
    INTO v_cur FROM _cp;

  RETURN v_cur || jsonb_build_object(
    'spark', COALESCE(v_spark, '[]'::jsonb),
    'prev', v_prev,
    'rules', jsonb_build_object('min_nights', v_rules.regular_min_nights, 'window_months', v_rules.regular_window_months,
                                'lapse_months', v_rules.lapse_months),
    'updated_at', v_now);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_clients_overview(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_clients_overview(text, uuid) TO authenticated;

-- ── Liste ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crm_clients_list(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_def jsonb DEFAULT '{}'::jsonb,
  p_sort text DEFAULT 'last', p_dir integer DEFAULT 1, p_limit integer DEFAULT 12, p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
             'tag', (p.tags)[1], 'source', p.source) ORDER BY rn), '[]'::jsonb)
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
$$;

REVOKE ALL ON FUNCTION public.crm_clients_list(text, uuid, jsonb, text, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_clients_list(text, uuid, jsonb, text, integer, integer, integer) TO authenticated;

-- Nombre de joignables d'une sélection (fenêtre « Écrire à… ») : par filtre,
-- ou par liste d'adresses (sélection cochée).
CREATE OR REPLACE FUNCTION public.crm_audience_count(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_def jsonb DEFAULT NULL, p_emails text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res jsonb;
  v_pred text;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  IF p_emails IS NOT NULL THEN
    SELECT jsonb_build_object('total', count(*), 'email', count(*) FILTER (WHERE email_ok), 'sms', count(*) FILTER (WHERE phone_ok))
      INTO v_res FROM _cp p WHERE p.email = ANY (SELECT lower(x) FROM unnest(p_emails) x);
  ELSE
    v_pred := public._crm_filter_sql(COALESCE(p_def, '{}'::jsonb), 'p');
    EXECUTE format('SELECT jsonb_build_object(''total'', count(*), ''email'', count(*) FILTER (WHERE p.email_ok), ''sms'', count(*) FILTER (WHERE p.phone_ok)) FROM _cp p WHERE %s', v_pred)
      INTO v_res;
  END IF;
  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_audience_count(text, uuid, jsonb, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_audience_count(text, uuid, jsonb, text[]) TO authenticated;

-- ── Fiche client ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crm_client(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_email text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_em text := lower(btrim(COALESCE(p_email, '')));
  v_p record;
  v_buys jsonb;
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
                              'upcoming', min(t.event_start) > now()) AS x
      FROM _cpt t LEFT JOIN public.events e ON e.id = t.event_id
     WHERE t.email = v_em
     GROUP BY t.event_id, e.title
  ) q;

  -- Messages : e-mails reçus (et clics), SMS reçus.
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at' DESC), '[]'::jsonb) INTO v_msgs FROM (
    SELECT jsonb_build_object('kind', 'email', 'at', r.sent_at, 'name', c.name, 'campaign_id', c.id,
             'opened', EXISTS (SELECT 1 FROM public.email_campaign_events ev WHERE ev.campaign_id = c.id AND lower(ev.recipient_email) = v_em AND ev.event_type = 'opened'),
             'clicked', EXISTS (SELECT 1 FROM public.email_campaign_events ev WHERE ev.campaign_id = c.id AND lower(ev.recipient_email) = v_em AND ev.event_type = 'clicked')) AS x
      FROM public.email_campaign_recipients r
      JOIN public.email_campaigns c ON c.id = r.campaign_id
     WHERE lower(r.email) = v_em AND r.status = 'sent' AND r.sent_at IS NOT NULL
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     ORDER BY r.sent_at DESC LIMIT 40
  ) q;

  SELECT jsonb_agg(jsonb_build_object('m', to_char(m, 'YYYY-MM'),
           'n', (SELECT count(DISTINCT t.event_id) FROM _cpt t WHERE t.email = v_em
                  AND date_trunc('month', t.event_start AT TIME ZONE 'Europe/Paris') = m)) ORDER BY m)
    INTO v_months
    FROM generate_series(date_trunc('month', now() AT TIME ZONE 'Europe/Paris') - interval '11 months',
                         date_trunc('month', now() AT TIME ZONE 'Europe/Paris'), interval '1 month') m;

  RETURN jsonb_build_object(
    'email', v_p.email, 'first_name', v_p.first_name, 'last_name', v_p.last_name, 'phone', v_p.phone,
    'email_ok', v_p.email_ok, 'phone_ok', v_p.phone_ok, 'bounced', v_p.bounced, 'eng_status', v_p.eng_status,
    'lifecycle', v_p.lifecycle, 'nights', v_p.nights, 'nights_win', v_p.nights_win, 'spent', v_p.spent,
    'first_night', v_p.first_night, 'last_night', v_p.last_night, 'added_at', v_p.added_at,
    'tonight', v_p.tonight, 'source', v_p.source, 'utm_source', v_p.utm_source, 'origin', v_p.origin,
    'tags', COALESCE(to_jsonb(v_p.tags), '[]'::jsonb), 'note', v_p.note,
    'buys', v_buys, 'messages', v_msgs, 'months', v_months,
    'rules', jsonb_build_object('min_nights', v_rules.regular_min_nights, 'window_months', v_rules.regular_window_months,
                                'lapse_months', v_rules.lapse_months));
END;
$$;

REVOKE ALL ON FUNCTION public.crm_client(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_client(text, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_client_save(
  p_venue_id text, p_organizer_user_id uuid, p_email text, p_tags text[] DEFAULT NULL, p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_em text := lower(btrim(COALESCE(p_email, '')));
  v_tags text[];
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_em = '' THEN RAISE EXCEPTION 'email_required' USING ERRCODE = '22023'; END IF;
  SELECT array_agg(DISTINCT left(btrim(x), 24)) FILTER (WHERE btrim(x) <> '') INTO v_tags FROM unnest(COALESCE(p_tags, '{}')) x;

  INSERT INTO public.crm_contact_notes AS n (scope_key, email, venue_id, organizer_user_id, tags, note, updated_by)
  VALUES (v_key, v_em, p_venue_id, p_organizer_user_id, COALESCE(v_tags, '{}'), left(p_note, 4000), auth.uid())
  ON CONFLICT (scope_key, email) DO UPDATE SET
    tags = CASE WHEN p_tags IS NULL THEN n.tags ELSE COALESCE(v_tags, '{}') END,
    note = CASE WHEN p_note IS NULL THEN n.note ELSE left(p_note, 4000) END,
    updated_by = auth.uid(),
    updated_at = now();
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_client_save(text, uuid, text, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_client_save(text, uuid, text, text[], text) TO authenticated;
