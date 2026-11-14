-- Yuno Tickets › Clients : « avoir une place » et « être venu » sont deux faits (11/11).
--
-- Constat (Amoris, lancement de House Of Love #1, 18/11) : sur 14 acheteurs de la
-- nouvelle édition, 3 avaient déjà acheté House Of Masquerade (28/10) et 2 y étaient
-- venus (place scannée). L'écran Clients n'en disait rien :
--   * le cycle de vie (Habitué / Occasionnel / Nouveau / Endormi) compte des soirées
--     FAITES et ne regarde jamais une soirée précise : avec une seule édition passée,
--     222 clients sur 227 sont « Nouveaux », Habitué et Occasionnel sont à 0 (règle
--     « 3 soirées en 6 mois » / « première soirée il y a plus de 90 jours ») ;
--   * le filtre « Soirée » se lisait « A participé à » mais retient ceux qui ont une
--     PLACE (vente) pour la soirée, venus ou non, et ne voyait pas les invités d'un
--     billet de plusieurs personnes ;
--   * rien ne répondait à « parmi mes billets vendus, lesquels viennent de quelqu'un
--     qui est déjà venu ? ».
--
-- Ce qui change :
--   1. `_tix_people_build` pose la table temporaire `_cpv` (personne, soirée, rôle,
--      place scannée, billets, montant) : acheteurs (billets, tables, guest list) ET
--      invités d'un billet. `nights`, le cycle de vie et tout le reste ne bougent pas.
--   2. `_tix_filter_sql` : `ev` (« Place pour ») compte aussi les invités d'un billet ;
--      nouvelle clé `came` (« Venu à » : place scannée à l'une de ces soirées) ; nouvelle
--      clé `rel` = {ev, k} : la personne VUE DEPUIS une soirée —
--        back  a une place à la soirée et est déjà venue à une soirée plus ancienne,
--        held  a une place à la soirée et avait une place avant, sans être venue,
--        new   a une place à la soirée et n'avait jamais eu de place avant,
--        away  est déjà venue avant, et n'a pas (encore) de place à la soirée.
--   3. `tix_night_audience(soirée)` : la lecture de l'écran — d'où viennent les billets
--      d'une soirée (déjà venus / avaient une place / nouveaux), combien de ceux qui
--      sont déjà venus ont repris une place, combien restent à rappeler.
-- Aucun pourcentage sous 10 personnes (règle du dictionnaire). Montants sous la clé
-- `revenue`, masqués par la porte d'argent comme les autres lectures.

-- ── 1. La présence par soirée (_cpv), posée par _tix_people_build ────────────
DO $do$
DECLARE
  v_def text;
  v_anchor text := $a$  -- « Ce soir » : la prochaine soirée$a$;
  v_block text := $blk$  -- Présence par soirée (11/11) : qui avait une place pour quelle soirée, et qui
  -- est VENU (place scannée). Avoir une place et être venu sont deux faits :
  -- « Place pour », « Venu à » et la lecture d'une soirée (filtres `ev`, `came`,
  -- `rel`, écran « Vos billets par soirée ») les lisent ici, jamais dans `nights`,
  -- qui reste la règle du cycle de vie. Acheteurs (billets, tables, guest list) et
  -- invités d'un billet de plusieurs personnes ; `sale` = vente (ni invitation).
  DROP TABLE IF EXISTS _cpv;
  CREATE TEMP TABLE _cpv ON COMMIT DROP AS
    SELECT x.email, x.event_id, x.event_start, 'buyer'::text AS role,
           (x.scanned_at IS NOT NULL) AS scanned,
           COALESCE(x.qty, 0)::int AS places, COALESCE(x.sale, false) AS sale,
           COALESCE(x.amount, 0) AS amount
      FROM _cpx x
     WHERE x.email IS NOT NULL AND x.event_id IS NOT NULL AND x.event_start IS NOT NULL
       AND x.status = 'valid' AND x.bought_at <= v_at
    UNION ALL
    SELECT lower(btrim(ta.email)), t.event_id, e.start_at, 'guest'::text,
           COALESCE(ta.entry_scanned, false), 1, false, 0::numeric
      FROM public.ticket_attendees ta
      JOIN public.tickets t ON t.id = ta.ticket_id
      JOIN public._tix_scope_events(p_venue_id, p_organizer_user_id) e ON e.id = t.event_id
     WHERE ta.email IS NOT NULL AND btrim(ta.email) <> ''
       AND t.paid_at IS NOT NULL AND t.status IN ('paid', 'used')
       AND ta.refunded_at IS NULL
       AND ta.created_at <= v_at
       AND lower(btrim(ta.email)) IS DISTINCT FROM lower(btrim(COALESCE(t.user_email, '')));
  CREATE INDEX ON _cpv (email);
$blk$;
BEGIN
  v_def := pg_get_functiondef('public._tix_people_build(text,uuid,timestamptz,boolean)'::regprocedure);
  IF position('_cpv' IN v_def) > 0 THEN RETURN; END IF;
  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION '_tix_people_build : repère « Ce soir » introuvable, la fonction a changé';
  END IF;
  v_def := replace(v_def, v_anchor, v_block || v_anchor);
  EXECUTE v_def;
END
$do$;

-- ── 2. Le filtre : Place pour, Venu à, et la lecture depuis une soirée ───────
CREATE OR REPLACE FUNCTION public._tix_filter_sql(p_def jsonb, p_alias text DEFAULT 'p'::text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $function$
DECLARE
  a text := quote_ident(COALESCE(p_alias, 'p'));
  d jsonb := COALESCE(p_def, '{}'::jsonb);
  f jsonb;
  v_base text;
  v_parts text[] := '{}';
  lst text;
  ids text;
  v_ev text;
  v_k text;
  v_n text;
  v_start text;
  v_before_any text;
  v_before_came text;
BEGIN
  IF jsonb_typeof(d) = 'object' AND jsonb_typeof(d->'f') = 'object' THEN
    f := d->'f';
    IF f ? 'ntgt' AND jsonb_typeof(f->'ntgt') <> 'null' THEN RETURN 'false'; END IF;

    -- Provenance.
    IF f ? 'src' AND jsonb_typeof(f->'src') <> 'null' THEN
      IF jsonb_typeof(f->'src') <> 'array' THEN RETURN 'false'; END IF;
      IF jsonb_array_length(f->'src') > 0 THEN
        SELECT string_agg(format('%L', x), ',') INTO lst
          FROM jsonb_array_elements_text(f->'src') x WHERE x IN ('yuno', 'import', 'other');
        v_parts := array_append(v_parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.source IN (%s)', a, lst) END);
      END IF;
    END IF;

    -- Place pour une soirée (`ev`) : acheteur OU invité d'un billet, venu ou non.
    -- Le « ce soir » (`T`) et la lecture historique restent celles du moteur commun.
    IF jsonb_typeof(f->'ev') = 'array' AND jsonb_array_length(f->'ev') > 0 THEN
      SELECT string_agg(format('%L', x), ',') INTO ids
        FROM jsonb_array_elements_text(f->'ev') x WHERE x ~ '^[0-9a-f-]{36}$';
      IF ids IS NOT NULL THEN
        v_ev := public._crm_filter_sql(jsonb_build_object('f', jsonb_build_object('ev', f->'ev')), p_alias);
        v_parts := array_append(v_parts, format(
          '(%s OR EXISTS (SELECT 1 FROM _cpv _v1 WHERE _v1.email = %s.email AND _v1.event_id = ANY(ARRAY[%s]::uuid[])))', v_ev, a, ids));
        f := f - 'ev';
      END IF;
    END IF;

    -- Venu à une soirée (`came`) : une place SCANNÉE (acheteur ou invité d'un billet).
    IF f ? 'came' AND jsonb_typeof(f->'came') <> 'null' THEN
      IF jsonb_typeof(f->'came') <> 'array' THEN RETURN 'false'; END IF;
      IF jsonb_array_length(f->'came') > 0 THEN
        SELECT string_agg(format('%L', x), ',') INTO ids
          FROM jsonb_array_elements_text(f->'came') x WHERE x ~ '^[0-9a-f-]{36}$';
        v_parts := array_append(v_parts, CASE WHEN ids IS NULL THEN 'false' ELSE format(
          'EXISTS (SELECT 1 FROM _cpv _v1 WHERE _v1.email = %s.email AND _v1.scanned AND _v1.event_id = ANY(ARRAY[%s]::uuid[]))', a, ids) END);
      END IF;
    END IF;

    -- La personne vue depuis une soirée (`rel` = {ev, k}).
    IF f ? 'rel' AND jsonb_typeof(f->'rel') <> 'null' THEN
      IF jsonb_typeof(f->'rel') <> 'object' THEN RETURN 'false'; END IF;
      v_ev := f->'rel'->>'ev';
      v_k := f->'rel'->>'k';
      IF v_ev IS NULL OR v_ev !~ '^[0-9a-f-]{36}$' OR v_k IS NULL OR v_k NOT IN ('back', 'held', 'new', 'away') THEN
        RETURN 'false';
      END IF;
      v_n := format('EXISTS (SELECT 1 FROM _cpv _v1 WHERE _v1.email = %s.email AND _v1.event_id = %L::uuid)', a, v_ev);
      v_start := format('(SELECT _e.start_at FROM public.events _e WHERE _e.id = %L::uuid)', v_ev);
      v_before_any := format('EXISTS (SELECT 1 FROM _cpv _v2 WHERE _v2.email = %s.email AND _v2.event_id <> %L::uuid AND _v2.event_start < %s)', a, v_ev, v_start);
      v_before_came := format('EXISTS (SELECT 1 FROM _cpv _v3 WHERE _v3.email = %s.email AND _v3.scanned AND _v3.event_id <> %L::uuid AND _v3.event_start < %s)', a, v_ev, v_start);
      v_parts := array_append(v_parts, CASE v_k
        WHEN 'back' THEN format('(%s AND %s)', v_n, v_before_came)
        WHEN 'held' THEN format('(%s AND %s AND NOT %s)', v_n, v_before_any, v_before_came)
        WHEN 'new'  THEN format('(%s AND NOT %s)', v_n, v_before_any)
        ELSE format('(NOT %s AND %s)', v_n, v_before_came) END);
    END IF;

    d := jsonb_set(d, '{f}', f - 'src' - 'ntgt' - 'came' - 'rel');
  END IF;

  v_base := public._crm_filter_sql(d, p_alias);
  IF array_length(v_parts, 1) IS NULL THEN RETURN v_base; END IF;
  RETURN '(' || v_base || ' AND ' || array_to_string(v_parts, ' AND ') || ')';
END;
$function$;

-- ── 3. « Vos billets par soirée » : d'où viennent les billets d'une soirée ───
CREATE OR REPLACE FUNCTION public.tix_night_audience__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_event uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_ev uuid; v_title text; v_start timestamptz; v_up boolean;
  v_prev uuid; v_prev_title text; v_prev_start timestamptz;
  v_nights jsonb;
  v_out jsonb;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Base légère : la joignabilité suffit, la présence (_cpv) est posée dans tous les cas.
  PERFORM public._tix_people_build(p_venue_id, p_organizer_user_id, NULL, true);

  -- Les soirées qui ont eu une place vendue, invitée ou partagée.
  DROP TABLE IF EXISTS _nan;
  CREATE TEMP TABLE _nan ON COMMIT DROP AS
    SELECT e.id, e.title, e.start_at, (e.end_at > v_now) AS upcoming, count(DISTINCT v.email) AS people
      FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) e
      JOIN _cpv v ON v.event_id = e.id
     GROUP BY e.id, e.title, e.start_at, e.end_at;

  SELECT n.id, n.title, n.start_at, n.upcoming INTO v_ev, v_title, v_start, v_up FROM _nan n WHERE n.id = p_event;
  IF v_ev IS NULL THEN
    -- Par défaut : la prochaine soirée à venir qui a des places, sinon la dernière passée.
    SELECT n.id, n.title, n.start_at, n.upcoming INTO v_ev, v_title, v_start, v_up
      FROM _nan n
     ORDER BY n.upcoming DESC,
              CASE WHEN n.upcoming THEN extract(epoch FROM n.start_at) ELSE -extract(epoch FROM n.start_at) END
     LIMIT 1;
  END IF;
  IF v_ev IS NULL THEN
    RETURN jsonb_build_object('night', NULL, 'nights', '[]'::jsonb, 'updated_at', v_now);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', q.id, 'title', q.title, 'start_at', q.start_at,
                                               'upcoming', q.upcoming, 'people', q.people) ORDER BY q.start_at DESC), '[]'::jsonb)
    INTO v_nights
    FROM (SELECT * FROM _nan ORDER BY start_at DESC LIMIT 12) q;

  SELECT n.id, n.title, n.start_at INTO v_prev, v_prev_title, v_prev_start
    FROM _nan n WHERE n.start_at < v_start ORDER BY n.start_at DESC LIMIT 1;

  WITH cur AS (
    SELECT v.email,
           COALESCE(sum(v.places) FILTER (WHERE v.sale AND v.role = 'buyer'), 0)::int AS tickets,
           COALESCE(sum(v.amount) FILTER (WHERE v.role = 'buyer'), 0) AS amount,
           bool_or(v.scanned) AS came_here
      FROM _cpv v WHERE v.event_id = v_ev GROUP BY v.email
  ), hist AS (
    SELECT v.email, bool_or(v.scanned) AS was_there
      FROM _cpv v WHERE v.event_id <> v_ev AND v.event_start < v_start GROUP BY v.email
  ), grp AS (
    SELECT c.*, CASE WHEN h.was_there THEN 'back' WHEN h.email IS NOT NULL THEN 'held' ELSE 'new' END AS g
      FROM cur c LEFT JOIN hist h ON h.email = c.email
  ), agg AS (
    SELECT g, count(*)::int AS people, sum(tickets)::int AS tickets, round(sum(amount), 2) AS revenue
      FROM grp GROUP BY g
  ), away AS (
    SELECT h.email FROM hist h WHERE h.was_there AND NOT EXISTS (SELECT 1 FROM cur c WHERE c.email = h.email)
  ), prev AS (
    SELECT count(DISTINCT v.email)::int AS came,
           count(DISTINCT v.email) FILTER (WHERE EXISTS (SELECT 1 FROM cur c WHERE c.email = v.email))::int AS rebought
      FROM _cpv v WHERE v.event_id = v_prev AND v.scanned
  ), pool AS (
    SELECT (SELECT count(*) FROM grp WHERE g = 'back')::int AS back,
           (SELECT count(*) FROM away)::int AS away,
           (SELECT count(*) FROM away a JOIN _cp p ON p.email = a.email WHERE p.email_ok OR p.phone_ok)::int AS away_reachable
  )
  SELECT jsonb_build_object(
    'night', jsonb_build_object('id', v_ev, 'title', v_title, 'start_at', v_start, 'upcoming', v_up),
    'nights', v_nights,
    'total', jsonb_build_object(
       'people', (SELECT count(*) FROM grp)::int,
       'tickets', COALESCE((SELECT sum(tickets) FROM grp), 0)::int,
       'revenue', COALESCE((SELECT round(sum(amount), 2) FROM grp), 0)),
    'groups', jsonb_build_object(
       'back', jsonb_build_object('people', COALESCE((SELECT people FROM agg WHERE g = 'back'), 0),
                                  'tickets', COALESCE((SELECT tickets FROM agg WHERE g = 'back'), 0),
                                  'revenue', COALESCE((SELECT revenue FROM agg WHERE g = 'back'), 0)),
       'held', jsonb_build_object('people', COALESCE((SELECT people FROM agg WHERE g = 'held'), 0),
                                  'tickets', COALESCE((SELECT tickets FROM agg WHERE g = 'held'), 0),
                                  'revenue', COALESCE((SELECT revenue FROM agg WHERE g = 'held'), 0)),
       'new',  jsonb_build_object('people', COALESCE((SELECT people FROM agg WHERE g = 'new'), 0),
                                  'tickets', COALESCE((SELECT tickets FROM agg WHERE g = 'new'), 0),
                                  'revenue', COALESCE((SELECT revenue FROM agg WHERE g = 'new'), 0))),
    'pool', jsonb_build_object(
       'came_before', (SELECT back + away FROM pool),
       'rebought', (SELECT back FROM pool),
       'away', (SELECT away FROM pool),
       'away_reachable', (SELECT away_reachable FROM pool),
       'pct', (SELECT CASE WHEN back + away >= 10 THEN round(back * 100.0 / (back + away), 1) END FROM pool)),
    'prev', CASE WHEN v_prev IS NULL THEN NULL ELSE jsonb_build_object(
       'id', v_prev, 'title', v_prev_title, 'start_at', v_prev_start,
       'came', (SELECT came FROM prev), 'rebought', (SELECT rebought FROM prev),
       'pct', (SELECT CASE WHEN came >= 10 THEN round(rebought * 100.0 / came, 1) END FROM prev)) END,
    'here', jsonb_build_object(
       'came', (SELECT count(*) FROM cur WHERE came_here)::int),
    'updated_at', v_now)
    INTO v_out;
  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tix_night_audience(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_event uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._tix_money_gate(public.tix_night_audience__core(p_venue_id, p_organizer_user_id, p_event), p_venue_id, p_organizer_user_id);
$function$;

REVOKE ALL ON FUNCTION public.tix_night_audience__core(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tix_night_audience(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tix_night_audience(text, uuid, uuid) TO authenticated, service_role;

-- ── 4. Aperçu démo : la lecture crée des tables temporaires ──────────────────
DO $do$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.demo_preview_writable_rpc(text)'::regprocedure);
  IF position('tix_night_audience' IN v_def) > 0 THEN RETURN; END IF;
  IF position($a$'tix_clients_overview', 'tix_clients_list'$a$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'demo_preview_writable_rpc : repère introuvable, la fonction a changé';
  END IF;
  v_def := replace(v_def, $a$'tix_clients_overview', 'tix_clients_list'$a$,
                          $b$'tix_clients_overview', 'tix_night_audience', 'tix_clients_list'$b$);
  EXECUTE v_def;
END
$do$;

NOTIFY pgrst, 'reload schema';
