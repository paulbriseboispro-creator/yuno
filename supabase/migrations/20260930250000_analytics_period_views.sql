-- Analyse : la MÊME lecture pour une période (24 h → tout) et pour une soirée, et la colonne des soirées.
-- Suite de 20260930243000 → 245000. Voir src/lib/analyticsPeriod.ts.

-- ─── La porte « toute la portée » ────────────────────────────────────────────
-- Même droit que `get_sales_overview` : un club (owner, manager) ou un
-- organisateur (fondateur, équipe éditeur+, super admin). `money` = voit les
-- montants ; `scope_ids` = les soirées de la portée (hôte, partenaire, co-hôte).
CREATE OR REPLACE FUNCTION public.analytics_scope_gate(p_venue_id text, p_organizer_user_id uuid)
RETURNS TABLE (ok boolean, reason text, scope_venue text, scope_org uuid, money boolean, tz text, scope_ids uuid[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_money boolean := false;
  v_tz    text := 'Europe/Paris';
  v_ids   uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'not_authenticated'::text, null::text, null::uuid, false, v_tz, '{}'::uuid[]; RETURN;
  END IF;
  IF p_organizer_user_id IS NOT NULL THEN
    IF NOT (v_uid = p_organizer_user_id OR public.is_super_admin()
            OR public.is_org_team_member(v_uid, p_organizer_user_id, 'editor')) THEN
      RETURN QUERY SELECT false, 'forbidden'::text, null::text, null::uuid, false, v_tz, '{}'::uuid[]; RETURN;
    END IF;
    v_money := v_uid = p_organizer_user_id OR public.is_super_admin()
               OR public.org_member_has_permission(v_uid, p_organizer_user_id, 'view_finance');
    SELECT coalesce(array_agg(x.id), '{}') INTO v_ids FROM public.events x
     WHERE x.organizer_user_id = p_organizer_user_id OR x.partner_organizer_id = p_organizer_user_id
        OR x.id IN (SELECT public.cohost_event_ids_org(p_organizer_user_id));
    RETURN QUERY SELECT true, null::text, null::text, p_organizer_user_id, v_money, v_tz, v_ids; RETURN;
  END IF;
  IF p_venue_id IS NULL OR NOT (public.can_manage_venue(v_uid, p_venue_id) OR public.is_super_admin()) THEN
    RETURN QUERY SELECT false, 'forbidden'::text, null::text, null::uuid, false, v_tz, '{}'::uuid[]; RETURN;
  END IF;
  v_money := public.is_super_admin()
    OR EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.owner_id = v_uid)
    OR EXISTS (SELECT 1 FROM public.manager_permissions mp
                WHERE mp.user_id = v_uid AND mp.venue_id = p_venue_id
                  AND (coalesce(mp.can_view_analytics, false) OR coalesce(mp.can_view_finance, false)));
  SELECT coalesce(v.timezone, 'Europe/Paris') INTO v_tz FROM public.venues v WHERE v.id = p_venue_id;
  SELECT coalesce(array_agg(x.id), '{}') INTO v_ids FROM public.events x
   WHERE x.venue_id = p_venue_id OR x.partner_venue_id = p_venue_id
      OR x.id IN (SELECT public.cohost_event_ids_venue(p_venue_id));
  RETURN QUERY SELECT true, null::text, p_venue_id, null::uuid, v_money, coalesce(v_tz, 'Europe/Paris'), v_ids;
END;
$$;
REVOKE ALL ON FUNCTION public.analytics_scope_gate(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_scope_gate(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.lens_traffic_takeaways(p_result jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
AS $function$
DECLARE
  v_result    jsonb := p_result;
  v_take      jsonb := '[]'::jsonb;
  v_sess      integer;
  v_sel       integer;
  v_co        integer;
  v_de        integer;
  v_pu        integer;
  v_lost      integer;
  v_best_lost integer := 0;
  v_key       text;
  v_pct       numeric;
  v_row       record;
  v_conv_all  numeric;
  v_mob       jsonb;
  v_desk      jsonb;
  v_ab        jsonb;
BEGIN
  -- ── « À retenir » : 0 à 3 constats, chacun avec son seuil de volume ────────
  -- (calculés ici, jamais au front : un constat nouveau se pose en SQL.)
  IF COALESCE((v_result #>> '{funnel,tracked}')::boolean, false) THEN
    v_sess := (v_result #>> '{funnel,sessions}')::int;
    v_sel  := (v_result #>> '{funnel,selected}')::int;
    v_co   := (v_result #>> '{funnel,checkout}')::int;
    v_de   := (v_result #>> '{funnel,details}')::int;
    v_pu   := (v_result #>> '{funnel,purchased}')::int;

    -- La plus grosse fuite parmi les trois passages après le choix.
    FOR v_row IN
      SELECT * FROM (VALUES ('leak_checkout', v_sel, v_co), ('leak_details', v_co, v_de), ('leak_payment', v_de, v_pu)) AS x(k, a, b)
    LOOP
      v_lost := v_row.a - v_row.b;
      IF v_row.a >= 10 AND v_lost >= 10 AND v_lost::numeric / v_row.a >= 0.3 AND v_lost > v_best_lost THEN
        v_best_lost := v_lost;
        v_key := v_row.k;
        v_pct := round(v_lost::numeric / v_row.a * 100);
      END IF;
    END LOOP;
    IF v_key IS NOT NULL THEN
      v_take := v_take || jsonb_build_array(jsonb_build_object(
        'key', v_key, 'tone', 'bad', 'section', 'funnel', 'params', jsonb_build_object('lost', v_best_lost, 'pct', v_pct)));
    END IF;

    -- Mobile contre ordinateur : un écart de conversion du simple au double et demi.
    SELECT d INTO v_mob FROM jsonb_array_elements(v_result -> 'devices') d WHERE d ->> 'device' = 'mobile' LIMIT 1;
    SELECT d INTO v_desk FROM jsonb_array_elements(v_result -> 'devices') d WHERE d ->> 'device' = 'desktop' LIMIT 1;
    IF v_mob IS NOT NULL AND v_desk IS NOT NULL
       AND (v_mob ->> 'sessions')::int >= 10 AND (v_desk ->> 'sessions')::int >= 10 THEN
      DECLARE
        v_cm numeric := (v_mob ->> 'purchased')::numeric / (v_mob ->> 'sessions')::numeric * 100;
        v_cd numeric := (v_desk ->> 'purchased')::numeric / (v_desk ->> 'sessions')::numeric * 100;
      BEGIN
        IF v_cd > 0 AND v_cm < v_cd / 1.5 THEN
          v_take := v_take || jsonb_build_array(jsonb_build_object(
            'key', 'mobile_gap', 'tone', 'bad', 'section', 'audience',
            'params', jsonb_build_object('a', round(v_cm, 1), 'b', round(v_cd, 1))));
        ELSIF v_cm > 0 AND v_cd < v_cm / 1.5 THEN
          v_take := v_take || jsonb_build_array(jsonb_build_object(
            'key', 'desktop_gap', 'tone', 'bad', 'section', 'audience',
            'params', jsonb_build_object('a', round(v_cd, 1), 'b', round(v_cm, 1))));
        END IF;
      END;
    END IF;

    -- Les paniers abandonnés.
    v_ab := v_result -> 'abandoned';
    IF (v_ab ->> 'sessions')::int >= 5 THEN
      v_take := v_take || jsonb_build_array(jsonb_build_object(
        'key', 'abandoned', 'tone', 'info', 'section', 'funnel',
        'params', jsonb_build_object('n', (v_ab ->> 'sessions')::int, 'amount', v_ab -> 'amount')));
    END IF;

    -- La source qui convertit le mieux, au moins une fois et demie la moyenne.
    IF v_sess >= 10 AND v_pu > 0 THEN
      v_conv_all := v_pu::numeric / v_sess * 100;
      SELECT s ->> 'source' AS src, round((s ->> 'purchased')::numeric / (s ->> 'sessions')::numeric * 100, 1) AS pct
        INTO v_row
        FROM jsonb_array_elements(v_result -> 'sources') s
       WHERE (s ->> 'sessions')::int >= 10 AND (s ->> 'source') <> 'unknown'
         AND (s ->> 'purchased')::numeric / (s ->> 'sessions')::numeric * 100 >= v_conv_all * 1.5
       ORDER BY (s ->> 'purchased')::numeric / (s ->> 'sessions')::numeric DESC
       LIMIT 1;
      IF FOUND THEN
        v_take := v_take || jsonb_build_array(jsonb_build_object(
          'key', 'best_source', 'tone', 'good', 'section', 'audience',
          'params', jsonb_build_object('source', v_row.src, 'pct', v_row.pct)));
      END IF;
    END IF;
  END IF;

  RETURN (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (SELECT x FROM jsonb_array_elements(v_take) x LIMIT 3) z);
END;
$function$;

CREATE OR REPLACE FUNCTION public.lens_community_takeaways(p_result jsonb, p_days numeric)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
AS $function$
DECLARE
  v_result    jsonb := p_result;
  v_take      jsonb := '[]'::jsonb;
  v_people    integer;
  v_fresh     integer;
  v_any       integer;
  v_noemail   integer;
  v_gained    integer;
  v_days      numeric := p_days;
  v_expected  numeric;
  v_top       record;
  v_known     integer;
BEGIN
  -- ── « À retenir » : 0 à 3 constats, chacun avec son seuil de volume ────────
  -- (calculés ici, jamais au front : un constat nouveau se pose en SQL.)
  v_people  := (v_result #>> '{people,total}')::int;
  v_fresh   := (v_result #>> '{crm,new}')::int;
  v_any     := (v_result #>> '{crm,anyReach}')::int;
  v_noemail := (v_result #>> '{people,noEmail}')::int;

  IF v_people >= 10 AND v_fresh::numeric / v_people >= 0.4 THEN
    v_take := v_take || jsonb_build_array(jsonb_build_object(
      'key', 'new_contacts', 'tone', 'good', 'section', 'crm',
      'params', jsonb_build_object('n', v_fresh, 'pct', round(v_fresh::numeric / v_people * 100),
                                   'email', (v_result #>> '{crm,newEmailOk}')::int)));
  END IF;
  IF v_people >= 20 AND v_any::numeric / v_people < 0.4 THEN
    v_take := v_take || jsonb_build_array(jsonb_build_object(
      'key', 'low_reach', 'tone', 'bad', 'section', 'crm',
      'params', jsonb_build_object('pct', round(v_any::numeric / v_people * 100))));
  END IF;
  IF v_noemail >= 10 THEN
    v_take := v_take || jsonb_build_array(jsonb_build_object(
      'key', 'no_email', 'tone', 'bad', 'section', 'crm', 'params', jsonb_build_object('n', v_noemail)));
  END IF;
  IF v_result -> 'followers' IS NOT NULL AND v_result ->> 'followers' <> 'null' THEN
    v_gained := (v_result #>> '{followers,gained}')::int;
    v_expected := (v_result #>> '{followers,baselinePerDay}')::numeric * v_days;
    IF v_gained >= 5 AND v_expected >= 1 AND v_gained >= 2 * v_expected THEN
      v_take := v_take || jsonb_build_array(jsonb_build_object(
        'key', 'follower_lift', 'tone', 'good', 'section', 'followers',
        'params', jsonb_build_object('n', v_gained, 'lift', round(v_gained / v_expected, 1))));
    END IF;
  END IF;
  IF v_result -> 'retention' IS NOT NULL AND v_result ->> 'retention' <> 'null' AND v_people >= 20 THEN
    v_take := v_take || jsonb_build_array(jsonb_build_object(
      'key', 'comes_back', 'tone', 'info', 'section', 'who',
      'params', jsonb_build_object('pct', round((v_result #>> '{retention,returned}')::numeric / v_people * 100))));
  END IF;
  SELECT COALESCE(sum((p ->> 'brought')::int), 0) INTO v_known FROM jsonb_array_elements(v_result -> 'parties') p;
  IF jsonb_array_length(v_result -> 'parties') > 1 AND v_known >= 20 THEN
    SELECT p ->> 'name' AS name, round((p ->> 'brought')::numeric / v_known * 100) AS pct
      INTO v_top
      FROM jsonb_array_elements(v_result -> 'parties') p
     ORDER BY (p ->> 'brought')::int DESC LIMIT 1;
    IF v_top.pct >= 50 THEN
      v_take := v_take || jsonb_build_array(jsonb_build_object(
        'key', 'partner_lead', 'tone', 'info', 'section', 'parties',
        'params', jsonb_build_object('name', v_top.name, 'pct', v_top.pct)));
    END IF;
  END IF;

  RETURN (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (SELECT x FROM jsonb_array_elements(v_take) x LIMIT 3) z);
END;
$function$;

-- Les deux lentilles d'une soirée lisent désormais leurs « À retenir » dans les fonctions partagées.
CREATE OR REPLACE FUNCTION public.get_event_traffic(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  g           record;
  e           record;
  v_now       timestamptz := now();
  v_tz        text;
  v_day_start timestamptz;
  v_end       timestamptz;
  v_phase     text;
  v_result    jsonb;
  v_take      jsonb := '[]'::jsonb;
  v_sess      integer;
  v_sel       integer;
  v_co        integer;
  v_de        integer;
  v_pu        integer;
  v_lost      integer;
  v_best_lost integer := 0;
  v_key       text;
  v_pct       numeric;
  v_row       record;
  v_conv_all  numeric;
  v_mob       jsonb;
  v_desk      jsonb;
  v_ab        jsonb;
BEGIN
  SELECT * INTO g FROM public.event_analytics_scope(p_event_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;

  SELECT ev.*, COALESCE(ev.timezone, v.timezone, 'Europe/Paris') AS tz
    INTO e
    FROM public.events ev
    LEFT JOIN public.venues v ON v.id = COALESCE(ev.venue_id, ev.partner_venue_id)
   WHERE ev.id = p_event_id;

  v_tz := e.tz;
  v_day_start := date_trunc('day', v_now AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  v_end := COALESCE(e.end_at, e.start_at + interval '8 hours');
  v_phase := CASE WHEN v_now < e.start_at THEN 'before' WHEN v_now < v_end THEN 'live' ELSE 'after' END;

  WITH
  -- ── Visites de la page (une ligne par visite, comme le Rapport) ───────────
  vis AS MATERIALIZED (
    SELECT s.session_id, s.visited_at, s.visitor_id, COALESCE(s.is_returning, false) AS is_returning,
           COALESCE(NULLIF(s.referrer_category, ''), 'direct') AS source,
           s.device_type, s.duration_seconds, s.scroll_depth_max, s.city, s.country_code
      FROM public.visitor_sessions s
     WHERE s.event_id = p_event_id
  ),
  -- ── Le tunnel : rang de chaque étape, une ligne par événement ─────────────
  fn AS MATERIALIZED (
    SELECT f.session_id, f.step, f.pillar, f.ref_id, f.quantity, f.amount_cents, f.reason, f.device, f.source, f.created_at,
           CASE f.step WHEN 'viewed' THEN 1 WHEN 'selected' THEN 2 WHEN 'checkout' THEN 3
                       WHEN 'details' THEN 4 WHEN 'payment' THEN 4 WHEN 'purchased' THEN 5 END AS rk
      FROM public.event_funnel_events f
     WHERE f.event_id = p_event_id
  ),
  -- Une ligne par session : l'étape la plus avancée et quand.
  sess AS MATERIALIZED (
    SELECT f.session_id,
           min(f.created_at) AS first_at,
           COALESCE(max(f.rk), 1) AS rk,
           min(f.created_at) FILTER (WHERE f.step = 'checkout') AS checkout_at,
           min(f.created_at) FILTER (WHERE f.step = 'purchased') AS purchased_at,
           bool_or(f.step = 'failed') AS failed,
           (array_agg(f.device) FILTER (WHERE f.device IS NOT NULL))[1] AS device,
           (array_agg(f.source) FILTER (WHERE f.source IS NOT NULL))[1] AS source
      FROM fn f
     GROUP BY f.session_id
  ),
  -- Une ligne par (session, pilier) : le tunnel de chaque pilier.
  sess_p AS MATERIALIZED (
    SELECT f.session_id, f.pillar, COALESCE(max(f.rk), 2) AS rk
      FROM fn f
     WHERE f.pillar IS NOT NULL AND f.rk IS NOT NULL
     GROUP BY f.session_id, f.pillar
  ),

  stage AS (
    SELECT count(*) AS sessions,
           count(*) FILTER (WHERE rk >= 2) AS selected,
           count(*) FILTER (WHERE rk >= 3) AS checkout,
           count(*) FILTER (WHERE rk >= 4) AS details,
           count(*) FILTER (WHERE rk >= 5) AS purchased,
           count(*) FILTER (WHERE rk < 5 AND failed) AS failed_open
      FROM sess
  ),
  stage_p AS (
    SELECT pillar,
           count(*) FILTER (WHERE rk >= 2) AS selected,
           count(*) FILTER (WHERE rk >= 3) AS checkout,
           count(*) FILTER (WHERE rk >= 4) AS details,
           count(*) FILTER (WHERE rk >= 5) AS purchased
      FROM sess_p GROUP BY pillar
  ),

  -- ── Les refus, avec leur motif et l'étape où ils tombent ──────────────────
  fail_reasons AS (
    SELECT COALESCE(NULLIF(f.reason, ''), 'server') AS reason, count(DISTINCT f.session_id) AS sessions
      FROM fn f WHERE f.step = 'failed'
     GROUP BY 1 ORDER BY 2 DESC LIMIT 8
  ),

  -- ── Choix des paliers / formules, face aux ventes réelles ─────────────────
  sel AS (
    SELECT f.pillar, f.ref_id, count(DISTINCT f.session_id) AS sessions, COALESCE(sum(f.quantity), 0) AS units
      FROM fn f
     WHERE f.step = 'selected' AND f.pillar IN ('tickets', 'tables') AND f.ref_id IS NOT NULL
     GROUP BY f.pillar, f.ref_id
  ),
  sold_t AS (
    SELECT t.ticket_round_id::text AS ref_id, sum(greatest(COALESCE(t.quantity, 1), 1)) AS sold
      FROM public.tickets t
     WHERE t.event_id = p_event_id AND t.status IN ('paid', 'used')
     GROUP BY 1
  ),
  sold_r AS (
    SELECT r.pack_id::text AS ref_id, count(*) AS sold
      FROM public.table_reservations r
     WHERE r.event_id = p_event_id AND r.status IN ('paid', 'confirmed')
     GROUP BY 1
  ),
  sel_rows AS (
    SELECT s.pillar, s.ref_id, s.sessions, s.units,
           COALESCE(tr.name, tp.name) AS name,
           CASE WHEN s.pillar = 'tickets' THEN COALESCE(st.sold, 0) ELSE COALESCE(sr.sold, 0) END AS sold
      FROM sel s
      LEFT JOIN public.ticket_rounds tr ON s.pillar = 'tickets' AND tr.id::text = s.ref_id
      LEFT JOIN public.table_packs tp ON s.pillar = 'tables' AND tp.id::text = s.ref_id
      LEFT JOIN sold_t st ON s.pillar = 'tickets' AND st.ref_id = s.ref_id
      LEFT JOIN sold_r sr ON s.pillar = 'tables' AND sr.ref_id = s.ref_id
     ORDER BY s.sessions DESC
     LIMIT 12
  ),

  -- ── Sources : visites, puis ce qu'elles deviennent dans le tunnel ─────────
  src_v AS (SELECT source, count(*) AS visits FROM vis GROUP BY source),
  src_f AS (
    SELECT COALESCE(s.source, 'unknown') AS source,
           count(*) AS sessions,
           count(*) FILTER (WHERE s.rk >= 3) AS checkout,
           count(*) FILTER (WHERE s.rk >= 5) AS purchased
      FROM sess s
     GROUP BY 1
  ),
  sources AS (
    SELECT COALESCE(a.source, b.source) AS source, COALESCE(a.visits, 0) AS visits,
           COALESCE(b.sessions, 0) AS sessions, COALESCE(b.checkout, 0) AS checkout, COALESCE(b.purchased, 0) AS purchased
      FROM src_v a FULL JOIN src_f b ON a.source = b.source
     ORDER BY COALESCE(a.visits, 0) DESC, COALESCE(b.sessions, 0) DESC
     LIMIT 10
  ),

  -- ── Appareils : visites, et conversion du tunnel (l'appareil y est posé) ──
  dev_v AS (SELECT COALESCE(device_type, 'unknown') AS device, count(*) AS visits FROM vis GROUP BY 1),
  dev_f AS (
    SELECT COALESCE(device, 'unknown') AS device,
           count(*) AS sessions,
           count(*) FILTER (WHERE rk >= 3) AS checkout,
           count(*) FILTER (WHERE rk >= 5) AS purchased
      FROM sess GROUP BY 1
  ),
  devices AS (
    SELECT COALESCE(a.device, b.device) AS device, COALESCE(a.visits, 0) AS visits,
           COALESCE(b.sessions, 0) AS sessions, COALESCE(b.checkout, 0) AS checkout, COALESCE(b.purchased, 0) AS purchased
      FROM dev_v a FULL JOIN dev_f b ON a.device = b.device
     ORDER BY COALESCE(a.visits, 0) DESC
  ),

  -- ── Temps : vue → achat, paiement → achat (médianes, en secondes) ─────────
  timing AS (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (purchased_at - first_at)))
             FILTER (WHERE purchased_at IS NOT NULL AND purchased_at >= first_at) AS view_to_buy,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (purchased_at - checkout_at)))
             FILTER (WHERE purchased_at IS NOT NULL AND checkout_at IS NOT NULL AND purchased_at >= checkout_at) AS checkout_to_buy,
           count(*) FILTER (WHERE purchased_at IS NOT NULL) AS buyers
      FROM sess
  ),

  -- ── Valeur des paniers abandonnés (entrés au paiement, pas d'achat) ───────
  cart_last AS (
    SELECT f.session_id, f.pillar, (array_agg(f.amount_cents ORDER BY f.created_at DESC))[1] AS cents
      FROM fn f
     WHERE f.step = 'selected' AND f.amount_cents IS NOT NULL
     GROUP BY f.session_id, f.pillar
  ),
  abandoned AS (
    SELECT count(*) AS sessions, COALESCE(sum(c.cents), 0) AS cents
      FROM sess s
      JOIN (SELECT session_id, sum(cents) AS cents FROM cart_last GROUP BY session_id) c ON c.session_id = s.session_id
     WHERE s.rk IN (3, 4)
  ),

  -- ── Engagement de la page (visites mesurées) ──────────────────────────────
  eng AS (
    SELECT count(*) AS visits,
           count(*) FILTER (WHERE visited_at >= v_day_start) AS today,
           count(DISTINCT visitor_id) AS visitors,
           count(*) FILTER (WHERE is_returning) AS returning_n,
           avg(duration_seconds) FILTER (WHERE duration_seconds BETWEEN 1 AND 3600) AS avg_duration,
           count(*) FILTER (WHERE duration_seconds BETWEEN 1 AND 3600) AS duration_n,
           -- Le défilement est écrit avec la durée, à la sortie de la page : une
           -- visite sans durée n'a pas été mesurée, son 0 ne veut pas dire « n'a pas défilé ».
           count(*) FILTER (WHERE duration_seconds BETWEEN 1 AND 3600) AS scroll_n,
           count(*) FILTER (WHERE duration_seconds BETWEEN 1 AND 3600 AND scroll_depth_max >= 50) AS scroll_half,
           count(*) FILTER (WHERE duration_seconds BETWEEN 1 AND 3600 AND scroll_depth_max >= 90) AS scroll_full
      FROM vis
  ),
  cities AS (
    SELECT city, count(*) AS visits FROM vis WHERE city IS NOT NULL AND city <> '' GROUP BY city ORDER BY 2 DESC LIMIT 6
  ),

  -- ── Jour par jour (d = jours calendaires avant la soirée) ─────────────────
  day_rows AS (
    SELECT (e.start_at AT TIME ZONE v_tz)::date - (visited_at AT TIME ZONE v_tz)::date AS d, 1 AS visits, 0 AS checkout, 0 AS purchased FROM vis
    UNION ALL
    SELECT (e.start_at AT TIME ZONE v_tz)::date - (checkout_at AT TIME ZONE v_tz)::date, 0, 1, 0 FROM sess WHERE checkout_at IS NOT NULL
    UNION ALL
    SELECT (e.start_at AT TIME ZONE v_tz)::date - (purchased_at AT TIME ZONE v_tz)::date, 0, 0, 1 FROM sess WHERE purchased_at IS NOT NULL
  ),
  series AS (
    SELECT d, sum(visits) AS visits, sum(checkout) AS checkout, sum(purchased) AS purchased
      FROM day_rows WHERE d BETWEEN -3 AND 120 GROUP BY d
  ),

  -- ── En ce moment ──────────────────────────────────────────────────────────
  live AS (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE stage = 'cart') AS cart,
           count(*) FILTER (WHERE stage = 'checkout') AS checkout
      FROM public.live_visitor_pings p
     WHERE p.event_id = p_event_id AND p.last_seen > v_now - interval '75 seconds'
  )
  SELECT jsonb_build_object(
    'ok', true,
    'now', v_now,
    'tz', v_tz,
    'money', g.money,
    'scope', CASE WHEN g.scope_venue IS NOT NULL THEN 'venue' ELSE 'organizer' END,
    'event', jsonb_build_object(
      'id', e.id, 'title', e.title, 'startAt', e.start_at, 'endAt', v_end, 'poster', e.poster_url,
      'cancelled', e.cancelled_at IS NOT NULL, 'phase', v_phase
    ),
    'visits', (SELECT jsonb_build_object(
        'total', visits, 'today', today, 'visitors', visitors, 'returning', returning_n,
        'avgDuration', CASE WHEN duration_n >= 10 THEN round(avg_duration)::int END,
        'scrollSample', scroll_n, 'scrollHalf', scroll_half, 'scrollFull', scroll_full
      ) FROM eng),
    'cities', COALESCE((SELECT jsonb_agg(jsonb_build_object('city', city, 'visits', visits)) FROM cities), '[]'::jsonb),
    'funnel', (SELECT jsonb_build_object(
        'tracked', sessions > 0,
        'sessions', sessions, 'selected', selected, 'checkout', checkout, 'details', details, 'purchased', purchased,
        'failedOpen', failed_open
      ) FROM stage),
    'pillars', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'pillar', pillar, 'selected', selected, 'checkout', checkout, 'details', details, 'purchased', purchased
      ) ORDER BY pillar) FROM stage_p), '[]'::jsonb),
    'failures', COALESCE((SELECT jsonb_agg(jsonb_build_object('reason', reason, 'sessions', sessions)) FROM fail_reasons), '[]'::jsonb),
    'selections', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'pillar', pillar, 'ref', ref_id, 'name', name, 'sessions', sessions, 'units', units, 'sold', sold
      ) ORDER BY sessions DESC) FROM sel_rows), '[]'::jsonb),
    'sources', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'source', source, 'visits', visits, 'sessions', sessions, 'checkout', checkout, 'purchased', purchased
      )) FROM sources), '[]'::jsonb),
    'devices', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'device', device, 'visits', visits, 'sessions', sessions, 'checkout', checkout, 'purchased', purchased
      )) FROM devices), '[]'::jsonb),
    'timing', (SELECT jsonb_build_object(
        'buyers', buyers,
        'viewToBuy', CASE WHEN buyers >= 5 THEN round(view_to_buy)::int END,
        'checkoutToBuy', CASE WHEN buyers >= 5 THEN round(checkout_to_buy)::int END
      ) FROM timing),
    'abandoned', (SELECT jsonb_build_object(
        'sessions', sessions, 'amount', CASE WHEN g.money THEN round(cents / 100.0, 2) END
      ) FROM abandoned),
    'series', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'd', d, 'visits', visits, 'checkout', checkout, 'purchased', purchased) ORDER BY d DESC) FROM series), '[]'::jsonb),
    'live', (SELECT jsonb_build_object('total', total, 'cart', cart, 'checkout', checkout) FROM live)
  ) INTO v_result;

  RETURN v_result || jsonb_build_object('takeaways', public.lens_traffic_takeaways(v_result));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_community(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  g           record;
  e           record;
  v_uid       uuid := auth.uid();
  v_now       timestamptz := now();
  v_tz        text;
  v_end       timestamptz;
  v_phase     text;
  v_win_start timestamptz;
  v_win_end   timestamptz;
  v_me        text;
  v_later_cnt integer;
  v_result    jsonb;
  v_take      jsonb := '[]'::jsonb;
  v_people    integer;
  v_fresh     integer;
  v_any       integer;
  v_noemail   integer;
  v_gained    integer;
  v_days      numeric;
  v_expected  numeric;
  v_top       record;
  v_known     integer;
BEGIN
  SELECT * INTO g FROM public.event_analytics_scope(p_event_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;

  SELECT ev.*, COALESCE(ev.timezone, v.timezone, 'Europe/Paris') AS tz
    INTO e
    FROM public.events ev
    LEFT JOIN public.venues v ON v.id = COALESCE(ev.venue_id, ev.partner_venue_id)
   WHERE ev.id = p_event_id;

  v_tz := e.tz;
  v_end := COALESCE(e.end_at, e.start_at + interval '8 hours');
  v_phase := CASE WHEN v_now < e.start_at THEN 'before' WHEN v_now < v_end THEN 'live' ELSE 'after' END;
  v_me := CASE WHEN g.scope_venue IS NOT NULL THEN 'venue:' || g.scope_venue ELSE 'org:' || g.scope_org::text END;

  -- Début de fenêtre : la première vente / inscription, sinon la publication.
  SELECT least(
           COALESCE((SELECT min(COALESCE(t.paid_at, t.created_at)) FROM public.tickets t
                      WHERE t.event_id = p_event_id AND t.status IN ('paid', 'used')), 'infinity'::timestamptz),
           COALESCE((SELECT min(COALESCE(r.paid_at, r.created_at)) FROM public.table_reservations r
                      WHERE r.event_id = p_event_id AND r.status IN ('paid', 'confirmed')), 'infinity'::timestamptz),
           COALESCE((SELECT min(ge.created_at) FROM public.guest_list_entries ge
                       JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
                      WHERE gl.event_id = p_event_id AND ge.status <> 'cancelled'), 'infinity'::timestamptz),
           COALESCE(e.published_at, e.created_at))
    INTO v_win_start;
  v_win_end := LEAST(v_end + interval '72 hours', v_now);
  IF v_win_start IS NULL OR v_win_start = 'infinity'::timestamptz THEN v_win_start := e.created_at; END IF;

  WITH
  promo AS (
    SELECT pr.id,
           CASE WHEN pr.organizer_user_id IS NOT NULL THEN 'org:' || pr.organizer_user_id
                WHEN pr.venue_id IS NOT NULL THEN 'venue:' || pr.venue_id END AS pkey
      FROM public.promoters pr
  ),
  links AS (
    SELECT tl.id,
           COALESCE((SELECT pm.pkey FROM promo pm WHERE pm.id = tl.promoter_id),
                    CASE WHEN tl.organizer_user_id IS NOT NULL THEN 'org:' || tl.organizer_user_id
                         WHEN tl.venue_id IS NOT NULL THEN 'venue:' || tl.venue_id END) AS pkey
      FROM public.tracked_links tl
     WHERE tl.event_id = p_event_id
  ),
  -- ── Une ligne par venue (billet, table, inscription), avec la partie qui l'a amenée
  rows_all AS MATERIALIZED (
    SELECT 'tickets'::text AS pillar, lower(btrim(t.user_email)) AS email, t.user_id,
           COALESCE(t.paid_at, t.created_at) AS at_ts,
           greatest(COALESCE(t.quantity, 1), 1) AS heads,
           greatest(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)
             - least(greatest(COALESCE(t.refund_amount, 0), 0),
                     greatest(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)) AS amount,
           COALESCE(l.pkey,
             (SELECT pm.pkey FROM public.promoter_conversions c JOIN promo pm ON pm.id = c.promoter_id
               WHERE c.ticket_id = t.id AND pm.pkey IS NOT NULL LIMIT 1)) AS pkey
      FROM public.tickets t
      LEFT JOIN links l ON l.id = t.tracked_link_id
     WHERE t.event_id = p_event_id AND t.status IN ('paid', 'used')
    UNION ALL
    SELECT 'tables', lower(btrim(r.user_email)), r.user_id,
           COALESCE(r.paid_at, r.created_at),
           greatest(COALESCE(r.guest_count, 0), 1),
           greatest(r.total_price - COALESCE(r.service_fee, 0)
                    - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(COALESCE(r.refund_amount, 0), 0),
                     greatest(r.total_price - COALESCE(r.service_fee, 0)
                              - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0)),
           COALESCE(l.pkey,
             (SELECT pm.pkey FROM public.promoter_conversions c JOIN promo pm ON pm.id = c.promoter_id
               WHERE c.table_reservation_id = r.id AND pm.pkey IS NOT NULL LIMIT 1))
      FROM public.table_reservations r
      LEFT JOIN links l ON l.id = r.tracked_link_id
     WHERE r.event_id = p_event_id AND r.status IN ('paid', 'confirmed')
    UNION ALL
    SELECT 'guest_list', lower(nullif(btrim(ge.email), '')), ge.user_id, ge.created_at, 1, 0::numeric,
           COALESCE(l.pkey,
             (SELECT pm.pkey FROM promo pm WHERE pm.id = ge.promoter_id),
             (SELECT pm.pkey FROM promo pm WHERE pm.id = gl.promoter_id),
             CASE WHEN gl.organizer_user_id IS NOT NULL THEN 'org:' || gl.organizer_user_id
                  WHEN gl.venue_id IS NOT NULL THEN 'venue:' || gl.venue_id END)
      FROM public.guest_list_entries ge
      JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
      LEFT JOIN links l ON l.id = ge.tracked_link_id
     WHERE gl.event_id = p_event_id AND ge.status <> 'cancelled'
  ),
  -- ── Les personnes (un email = une personne) ───────────────────────────────
  people AS MATERIALIZED (
    SELECT r.email,
           min(r.at_ts) AS first_at,
           (array_agg(r.user_id) FILTER (WHERE r.user_id IS NOT NULL))[1] AS user_id,
           sum(r.heads) FILTER (WHERE r.pillar <> 'guest_list') AS heads_paid,
           bool_or(r.pillar IN ('tickets', 'tables')) AS buyer,
           bool_or(r.pillar = 'guest_list') AS guest,
           COALESCE(sum(r.amount), 0) AS amount,
           (array_agg(r.pkey ORDER BY r.at_ts) FILTER (WHERE r.pkey IS NOT NULL))[1] AS pkey
      FROM rows_all r
     WHERE r.email IS NOT NULL
     GROUP BY r.email
  ),
  no_email AS (SELECT count(*) AS n FROM rows_all WHERE email IS NULL),
  scope_events AS MATERIALIZED (
    SELECT x.id, x.start_at FROM public.events x
     WHERE x.id = ANY (g.scope_ids) AND x.id <> p_event_id AND x.cancelled_at IS NULL
  ),
  -- ── Fidélité : à combien de soirées ANTÉRIEURES de la portée chacun est venu
  -- (ensembliste : on lit les soirées d'avant UNE fois, puis on les recoupe
  -- avec les personnes — jamais une recherche par personne).
  prior_ev AS MATERIALIZED (SELECT id FROM scope_events WHERE start_at < e.start_at),
  prior_rows AS MATERIALIZED (
    SELECT lower(btrim(t.user_email)) AS email, t.event_id FROM public.tickets t
     WHERE t.event_id IN (SELECT id FROM prior_ev) AND t.status IN ('paid', 'used')
    UNION ALL
    SELECT lower(btrim(r.user_email)), r.event_id FROM public.table_reservations r
     WHERE r.event_id IN (SELECT id FROM prior_ev) AND r.status IN ('paid', 'confirmed')
    UNION ALL
    SELECT lower(btrim(ge.email)), gl.event_id FROM public.guest_list_entries ge
      JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
     WHERE gl.event_id IN (SELECT id FROM prior_ev) AND ge.status <> 'cancelled'
  ),
  prior_hits AS (
    SELECT pr.email, pr.event_id FROM prior_rows pr WHERE pr.email IN (SELECT email FROM people)
  ),
  prior_n AS (SELECT email, count(DISTINCT event_id) AS n FROM prior_hits GROUP BY email),
  -- ── Retour : venus à une soirée POSTÉRIEURE (déjà passée) de la portée ────
  later_events AS MATERIALIZED (
    SELECT id FROM scope_events WHERE start_at > v_end AND start_at < v_now
  ),
  later_rows AS MATERIALIZED (
    SELECT lower(btrim(t.user_email)) AS email FROM public.tickets t
     WHERE t.event_id IN (SELECT id FROM later_events) AND t.status IN ('paid', 'used')
    UNION ALL
    SELECT lower(btrim(r.user_email)) FROM public.table_reservations r
     WHERE r.event_id IN (SELECT id FROM later_events) AND r.status IN ('paid', 'confirmed')
    UNION ALL
    SELECT lower(btrim(ge.email)) FROM public.guest_list_entries ge
      JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
     WHERE gl.event_id IN (SELECT id FROM later_events) AND ge.status <> 'cancelled'
  ),
  later_hits AS (
    SELECT DISTINCT lr.email FROM later_rows lr WHERE lr.email IN (SELECT email FROM people)
  ),
  -- ── Les parties de la soirée (une seule hors collab) ──────────────────────
  parties AS MATERIALIZED (
    SELECT pt.party_key, pt.kind, pt.venue_id, pt.organizer_user_id, pt.role, pt.share_crm,
           pt.display_name, pt.avatar_url, pt.ord,
           CASE WHEN pt.kind = 'venue' THEN 'venue' ELSE 'organizer' END AS subject_type,
           CASE WHEN pt.kind = 'venue' THEN pt.venue_id ELSE pt.organizer_user_id::text END AS subject_id
      FROM public.event_parties(p_event_id) pt
  ),
  -- ── Le registre de consentement de chaque partie, restreint aux personnes ─
  ns AS MATERIALIZED (
    SELECT p.party_key, lower(n.email) AS email, n.opted_in, n.created_at
      FROM parties p
      JOIN public.newsletter_subscriptions n ON n.venue_id = p.venue_id
     WHERE p.kind = 'venue' AND lower(n.email) IN (SELECT email FROM people)
    UNION ALL
    SELECT p.party_key, lower(n.email), n.opted_in, n.created_at
      FROM parties p
      JOIN public.newsletter_subscriptions n ON n.organizer_user_id = p.organizer_user_id
     WHERE p.kind = 'org' AND lower(n.email) IN (SELECT email FROM people)
  ),
  sm AS MATERIALIZED (
    SELECT p.party_key, lower(c.email) AS email, c.phone_e164, c.sms_consent_at, c.source_event_id
      FROM parties p
      JOIN public.venue_sms_contacts c ON c.venue_id = p.venue_id
     WHERE p.kind = 'venue' AND COALESCE(c.unsubscribed, false) = false
       AND (c.source_event_id = p_event_id OR lower(c.email) IN (SELECT email FROM people))
    UNION ALL
    SELECT p.party_key, lower(c.email), c.phone_e164, c.sms_consent_at, c.source_event_id
      FROM parties p
      JOIN public.venue_sms_contacts c ON c.organizer_user_id = p.organizer_user_id
     WHERE p.kind = 'org' AND COALESCE(c.unsubscribed, false) = false
       AND (c.source_event_id = p_event_id OR lower(c.email) IN (SELECT email FROM people))
  ),
  -- ── Abonnés : le journal de chaque partie, dans la fenêtre de la soirée ───
  fw AS MATERIALIZED (
    SELECT p.party_key, f.follower_user_id, f.action, f.source, f.created_at
      FROM parties p
      JOIN public.audience_follow_events f
        ON f.subject_type = p.subject_type AND f.subject_id = p.subject_id
     WHERE f.created_at >= v_win_start - interval '60 days' AND f.created_at <= v_win_end
  ),
  fw_party AS (
    SELECT p.party_key,
           count(*) FILTER (WHERE f.action = 'follow' AND f.created_at >= v_win_start) AS gained,
           count(*) FILTER (WHERE f.action = 'unfollow' AND f.created_at >= v_win_start) AS lost,
           count(*) FILTER (WHERE f.action = 'follow' AND f.created_at >= v_win_start AND f.source = 'event_page') AS from_event_page,
           count(DISTINCT f.follower_user_id) FILTER (
             WHERE f.action = 'follow' AND f.created_at >= v_win_start
               AND f.follower_user_id IN (SELECT user_id FROM people WHERE user_id IS NOT NULL)) AS from_attendees,
           count(*) FILTER (WHERE f.action = 'follow' AND f.created_at < v_win_start) AS before_follows
      FROM parties p LEFT JOIN fw f ON f.party_key = p.party_key
     GROUP BY p.party_key
  ),
  snap AS (
    SELECT DISTINCT ON (s.subject_type, s.subject_id) s.subject_type, s.subject_id, s.followers_total
      FROM public.audience_daily_snapshots s
     WHERE (s.subject_type, s.subject_id) IN (SELECT subject_type, subject_id FROM parties)
     ORDER BY s.subject_type, s.subject_id, s.snapshot_date DESC
  ),
  -- ── Chiffres de chaque partie ─────────────────────────────────────────────
  party_rows AS (
    SELECT p.party_key, p.display_name, p.kind, p.role, p.share_crm, p.avatar_url, p.ord,
           (SELECT count(*) FROM people x WHERE x.pkey = p.party_key) AS brought,
           (SELECT count(*) FROM people x WHERE x.pkey = p.party_key
               AND NOT EXISTS (SELECT 1 FROM prior_n pn WHERE pn.email = x.email)) AS brought_new,
           (SELECT count(DISTINCT n.email) FROM ns n WHERE n.party_key = p.party_key AND n.opted_in) AS email_total,
           (SELECT count(DISTINCT n.email) FROM ns n
             WHERE n.party_key = p.party_key AND n.opted_in AND n.created_at >= v_win_start) AS email_gained,
           (SELECT count(DISTINCT COALESCE(s.phone_e164, s.email)) FROM sm s WHERE s.party_key = p.party_key) AS sms_total,
           (SELECT count(DISTINCT COALESCE(s.phone_e164, s.email)) FROM sm s
             WHERE s.party_key = p.party_key
               AND (s.source_event_id = p_event_id OR s.sms_consent_at >= v_win_start)) AS sms_gained,
           COALESCE(fp.gained, 0) AS followers_gained, COALESCE(fp.lost, 0) AS followers_lost,
           COALESCE(fp.from_event_page, 0) AS followers_event_page, COALESCE(fp.from_attendees, 0) AS followers_attendees,
           COALESCE(fp.before_follows, 0) AS followers_before,
           (SELECT sn.followers_total FROM snap sn WHERE sn.subject_type = p.subject_type AND sn.subject_id = p.subject_id) AS followers_total
      FROM parties p LEFT JOIN fw_party fp ON fp.party_key = p.party_key
  ),
  -- ── Joignabilité des personnes, pour la partie de l'appelant ──────────────
  me_ns AS (SELECT DISTINCT email FROM ns WHERE party_key = v_me AND opted_in),
  me_sm AS (SELECT DISTINCT email FROM sm WHERE party_key = v_me AND email IS NOT NULL),
  app AS (
    SELECT DISTINCT p.email
      FROM people p
     WHERE p.user_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = p.user_id AND ps.platform = 'ios')
  ),
  acct AS (
    SELECT DISTINCT p.email
      FROM people p
     WHERE p.user_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.profiles pf WHERE lower(pf.email) = p.email)
  ),
  reach AS (
    SELECT count(*) AS people,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM me_ns)) AS email_ok,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM me_sm)) AS sms_ok,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM app)) AS app,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM acct)) AS account,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM me_ns) OR p.email IN (SELECT email FROM me_sm)
                                OR p.email IN (SELECT email FROM app)) AS any_ok,
           count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM prior_n pn WHERE pn.email = p.email)) AS fresh,
           count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM prior_n pn WHERE pn.email = p.email)
                              AND p.email IN (SELECT email FROM me_ns)) AS fresh_email_ok,
           count(*) FILTER (WHERE p.buyer) AS buyers,
           count(*) FILTER (WHERE p.guest AND NOT p.buyer) AS guests_only,
           COALESCE(sum(p.heads_paid), 0) AS heads_paid,
           COALESCE(sum(p.amount), 0) AS amount
      FROM people p
  ),
  loyalty AS (
    SELECT count(*) FILTER (WHERE COALESCE(pn.n, 0) = 0) AS first_time,
           count(*) FILTER (WHERE pn.n = 1) AS second_time,
           count(*) FILTER (WHERE pn.n >= 2) AS regulars
      FROM people p LEFT JOIN prior_n pn ON pn.email = p.email
  ),
  retention AS (
    SELECT (SELECT count(*) FROM later_events) AS later_events,
           (SELECT count(*) FROM later_hits) AS returned
  ),
  -- ── Dans le temps (d = jours calendaires avant la soirée) ─────────────────
  tl_people AS (
    SELECT (e.start_at AT TIME ZONE v_tz)::date - (p.first_at AT TIME ZONE v_tz)::date AS d,
           count(*) AS people,
           count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM prior_n pn WHERE pn.email = p.email)) AS fresh
      FROM people p GROUP BY 1
  ),
  tl_fw AS (
    SELECT (e.start_at AT TIME ZONE v_tz)::date - (f.created_at AT TIME ZONE v_tz)::date AS d, count(*) AS followers
      FROM fw f
     WHERE f.party_key = v_me AND f.action = 'follow' AND f.created_at >= v_win_start
     GROUP BY 1
  ),
  tl_ns AS (
    SELECT (e.start_at AT TIME ZONE v_tz)::date - (n.created_at AT TIME ZONE v_tz)::date AS d, count(DISTINCT n.email) AS optins
      FROM ns n
     WHERE n.party_key = v_me AND n.opted_in AND n.created_at >= v_win_start
     GROUP BY 1
  ),
  tl_days AS (
    SELECT d FROM tl_people UNION SELECT d FROM tl_fw UNION SELECT d FROM tl_ns
  ),
  timeline AS (
    SELECT t.d, COALESCE(pp.people, 0) AS people, COALESCE(pp.fresh, 0) AS fresh,
           COALESCE(ff.followers, 0) AS followers, COALESCE(nn.optins, 0) AS optins
      FROM tl_days t
      LEFT JOIN tl_people pp ON pp.d = t.d
      LEFT JOIN tl_fw ff ON ff.d = t.d
      LEFT JOIN tl_ns nn ON nn.d = t.d
     WHERE t.d BETWEEN -3 AND 120
  ),
  -- Le même flux d'abonnés, hors soirée : la moyenne quotidienne des 60 jours avant.
  baseline AS (
    SELECT count(*) FILTER (WHERE f.action = 'follow' AND f.created_at < v_win_start)::numeric / 60.0 AS per_day
      FROM fw f WHERE f.party_key = v_me
  )
  SELECT jsonb_build_object(
    'ok', true,
    'now', v_now,
    'tz', v_tz,
    'money', g.money,
    'scope', CASE WHEN g.scope_venue IS NOT NULL THEN 'venue' ELSE 'organizer' END,
    'me', v_me,
    'event', jsonb_build_object(
      'id', e.id, 'title', e.title, 'startAt', e.start_at, 'endAt', v_end, 'poster', e.poster_url,
      'cancelled', e.cancelled_at IS NOT NULL, 'phase', v_phase
    ),
    'window', jsonb_build_object('from', v_win_start, 'to', v_win_end),
    'people', (SELECT jsonb_build_object(
        'total', people, 'buyers', buyers, 'guestsOnly', guests_only, 'headsPaid', heads_paid,
        'noEmail', (SELECT n FROM no_email),
        'spend', CASE WHEN g.money AND buyers > 0 THEN round(amount, 2) END
      ) FROM reach),
    'crm', (SELECT jsonb_build_object(
        'new', fresh, 'known', people - fresh,
        'emailOk', email_ok, 'smsOk', sms_ok, 'app', app, 'account', account, 'anyReach', any_ok,
        'newEmailOk', fresh_email_ok
      ) FROM reach),
    'loyalty', (SELECT jsonb_build_object('first', first_time, 'second', second_time, 'regulars', regulars) FROM loyalty),
    'retention', (SELECT CASE WHEN later_events >= 1 AND v_phase = 'after' AND v_end < v_now - interval '14 days'
                              THEN jsonb_build_object('laterEvents', later_events, 'returned', returned) END
                    FROM retention),
    'parties', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'party', party_key, 'name', display_name, 'kind', kind, 'role', role, 'shareCrm', share_crm,
        'avatar', avatar_url, 'mine', party_key = v_me,
        'brought', brought, 'broughtNew', brought_new,
        'emailTotal', email_total, 'emailGained', email_gained,
        'smsTotal', sms_total, 'smsGained', sms_gained,
        'followersGained', followers_gained, 'followersLost', followers_lost,
        'followersEventPage', followers_event_page, 'followersAttendees', followers_attendees,
        'followersTotal', followers_total
      ) ORDER BY ord, party_key) FROM party_rows), '[]'::jsonb),
    'followers', (SELECT jsonb_build_object(
        'gained', followers_gained, 'lost', followers_lost, 'eventPage', followers_event_page,
        'attendees', followers_attendees, 'total', followers_total,
        'baselinePerDay', round((SELECT per_day FROM baseline), 2)
      ) FROM party_rows WHERE party_key = v_me),
    'timeline', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'd', d, 'people', people, 'fresh', fresh, 'followers', followers, 'optins', optins) ORDER BY d DESC) FROM timeline), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result || jsonb_build_object('takeaways', public.lens_community_takeaways(v_result, greatest(1, round(extract(epoch FROM (v_win_end - v_win_start)) / 86400.0))));
END;
$function$;

-- ─── Trafic sur une PÉRIODE : la même lecture que `get_event_traffic`, pour toutes les soirées ──
-- Même forme de réponse que la lentille d'une soirée (visites, tunnel, piliers,
-- refus, choix, sources, appareils, temps, paniers, courbe, villes, en ce
-- moment) — c'est ce qui permet au front d'afficher EXACTEMENT les mêmes blocs
-- pour « les 7 derniers jours » et pour une soirée. La courbe est clée par DATE
-- (et non par J-N) ; `previous` donne la période d'avant, de même durée.
-- `p_hours` : 24, 48, 168, 720, 2160 ; NULL = depuis toujours.
CREATE OR REPLACE FUNCTION public.get_traffic_period(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_hours integer DEFAULT 720)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  g           record;
  v_now       timestamptz := now();
  v_from      timestamptz;
  v_prev_from timestamptz;
  v_day_start timestamptz;
  v_result    jsonb;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;
  v_from := CASE WHEN p_hours IS NULL THEN '-infinity'::timestamptz ELSE v_now - make_interval(hours => p_hours) END;
  v_prev_from := CASE WHEN p_hours IS NULL THEN NULL ELSE v_from - make_interval(hours => p_hours) END;
  v_day_start := date_trunc('day', v_now AT TIME ZONE g.tz) AT TIME ZONE g.tz;

  WITH
  vis AS MATERIALIZED (
    SELECT s.session_id, s.event_id, s.visited_at, s.visitor_id, COALESCE(s.is_returning, false) AS is_returning,
           s.duration_seconds, s.scroll_depth_max, s.city, s.device_type,
           COALESCE(NULLIF(s.referrer_category, ''), 'direct') AS source,
           s.visited_at >= v_from AS cur
      FROM public.visitor_sessions s
     WHERE s.event_id = ANY (g.scope_ids) AND s.visited_at >= COALESCE(v_prev_from, v_from)
  ),
  fn AS MATERIALIZED (
    SELECT f.event_id, f.session_id, f.step, f.pillar, f.ref_id, f.quantity, f.amount_cents, f.reason, f.device, f.source, f.created_at,
           CASE f.step WHEN 'viewed' THEN 1 WHEN 'selected' THEN 2 WHEN 'checkout' THEN 3
                       WHEN 'details' THEN 4 WHEN 'payment' THEN 4 WHEN 'purchased' THEN 5 END AS rk
      FROM public.event_funnel_events f
     WHERE f.event_id = ANY (g.scope_ids) AND f.created_at >= COALESCE(v_prev_from, v_from)
  ),
  -- Un parcours = une session sur UNE soirée (la même personne sur deux soirées = deux parcours).
  sess AS MATERIALIZED (
    SELECT f.event_id, f.session_id,
           min(f.created_at) AS first_at,
           min(f.created_at) >= v_from AS cur,
           COALESCE(max(f.rk), 1) AS rk,
           min(f.created_at) FILTER (WHERE f.step = 'checkout') AS checkout_at,
           min(f.created_at) FILTER (WHERE f.step = 'purchased') AS purchased_at,
           bool_or(f.step = 'failed') AS failed,
           (array_agg(f.device) FILTER (WHERE f.device IS NOT NULL))[1] AS device,
           (array_agg(f.source) FILTER (WHERE f.source IS NOT NULL))[1] AS source
      FROM fn f GROUP BY f.event_id, f.session_id
  ),
  sess_c AS (SELECT * FROM sess WHERE cur),
  sess_p AS MATERIALIZED (
    SELECT f.event_id, f.session_id, f.pillar, COALESCE(max(f.rk), 2) AS rk
      FROM fn f
     WHERE f.pillar IS NOT NULL AND f.rk IS NOT NULL AND f.created_at >= v_from
     GROUP BY f.event_id, f.session_id, f.pillar
  ),
  stage AS (
    SELECT count(*) AS sessions,
           count(*) FILTER (WHERE rk >= 2) AS selected, count(*) FILTER (WHERE rk >= 3) AS checkout,
           count(*) FILTER (WHERE rk >= 4) AS details, count(*) FILTER (WHERE rk >= 5) AS purchased,
           count(*) FILTER (WHERE rk < 5 AND failed) AS failed_open
      FROM sess_c
  ),
  stage_prev AS (
    SELECT count(*) AS sessions, count(*) FILTER (WHERE rk >= 3) AS checkout, count(*) FILTER (WHERE rk >= 5) AS purchased
      FROM sess WHERE NOT cur
  ),
  stage_p AS (
    SELECT pillar, count(*) FILTER (WHERE rk >= 2) AS selected, count(*) FILTER (WHERE rk >= 3) AS checkout,
           count(*) FILTER (WHERE rk >= 4) AS details, count(*) FILTER (WHERE rk >= 5) AS purchased
      FROM sess_p GROUP BY pillar
  ),
  fail_reasons AS (
    SELECT COALESCE(NULLIF(f.reason, ''), 'server') AS reason, count(DISTINCT (f.event_id, f.session_id)) AS sessions
      FROM fn f WHERE f.step = 'failed' AND f.created_at >= v_from GROUP BY 1 ORDER BY 2 DESC LIMIT 8
  ),
  -- Les choix se regroupent par NOM de palier / de formule (les mêmes reviennent d'une soirée à l'autre).
  sel AS (
    SELECT f.pillar, COALESCE(tr.name, tp.name) AS name,
           count(DISTINCT (f.event_id, f.session_id)) AS sessions, COALESCE(sum(f.quantity), 0) AS units
      FROM fn f
      LEFT JOIN public.ticket_rounds tr ON f.pillar = 'tickets' AND tr.id::text = f.ref_id
      LEFT JOIN public.table_packs tp ON f.pillar = 'tables' AND tp.id::text = f.ref_id
     WHERE f.step = 'selected' AND f.pillar IN ('tickets', 'tables') AND f.ref_id IS NOT NULL AND f.created_at >= v_from
       AND COALESCE(tr.name, tp.name) IS NOT NULL
     GROUP BY 1, 2
  ),
  sold_t AS (
    SELECT tr.name, sum(greatest(COALESCE(t.quantity, 1), 1)) AS sold
      FROM public.tickets t JOIN public.ticket_rounds tr ON tr.id = t.ticket_round_id
     WHERE t.event_id = ANY (g.scope_ids) AND t.status IN ('paid', 'used') AND COALESCE(t.paid_at, t.created_at) >= v_from
     GROUP BY tr.name
  ),
  sold_r AS (
    SELECT tp.name, count(*) AS sold
      FROM public.table_reservations r JOIN public.table_packs tp ON tp.id = r.pack_id
     WHERE r.event_id = ANY (g.scope_ids) AND r.status IN ('paid', 'confirmed') AND COALESCE(r.paid_at, r.created_at) >= v_from
     GROUP BY tp.name
  ),
  sel_rows AS (
    SELECT s.pillar, s.name AS ref, s.name, s.sessions, s.units,
           CASE WHEN s.pillar = 'tickets' THEN COALESCE(st.sold, 0) ELSE COALESCE(sr.sold, 0) END AS sold
      FROM sel s LEFT JOIN sold_t st ON s.pillar = 'tickets' AND st.name = s.name
                 LEFT JOIN sold_r sr ON s.pillar = 'tables' AND sr.name = s.name
     ORDER BY s.sessions DESC LIMIT 12
  ),
  src_v AS (SELECT source, count(*) AS visits FROM vis WHERE cur GROUP BY source),
  src_f AS (
    SELECT COALESCE(source, 'unknown') AS source, count(*) AS sessions,
           count(*) FILTER (WHERE rk >= 3) AS checkout, count(*) FILTER (WHERE rk >= 5) AS purchased
      FROM sess_c GROUP BY 1
  ),
  sources AS (
    SELECT COALESCE(a.source, b.source) AS source, COALESCE(a.visits, 0) AS visits, COALESCE(b.sessions, 0) AS sessions,
           COALESCE(b.checkout, 0) AS checkout, COALESCE(b.purchased, 0) AS purchased
      FROM src_v a FULL JOIN src_f b ON a.source = b.source
     ORDER BY COALESCE(a.visits, 0) DESC, COALESCE(b.sessions, 0) DESC LIMIT 10
  ),
  dev_v AS (SELECT COALESCE(device_type, 'unknown') AS device, count(*) AS visits FROM vis WHERE cur GROUP BY 1),
  dev_f AS (
    SELECT COALESCE(device, 'unknown') AS device, count(*) AS sessions,
           count(*) FILTER (WHERE rk >= 3) AS checkout, count(*) FILTER (WHERE rk >= 5) AS purchased
      FROM sess_c GROUP BY 1
  ),
  devices AS (
    SELECT COALESCE(a.device, b.device) AS device, COALESCE(a.visits, 0) AS visits, COALESCE(b.sessions, 0) AS sessions,
           COALESCE(b.checkout, 0) AS checkout, COALESCE(b.purchased, 0) AS purchased
      FROM dev_v a FULL JOIN dev_f b ON a.device = b.device ORDER BY COALESCE(a.visits, 0) DESC
  ),
  timing AS (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (purchased_at - first_at)))
             FILTER (WHERE purchased_at IS NOT NULL AND purchased_at >= first_at) AS view_to_buy,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (purchased_at - checkout_at)))
             FILTER (WHERE purchased_at IS NOT NULL AND checkout_at IS NOT NULL AND purchased_at >= checkout_at) AS checkout_to_buy,
           count(*) FILTER (WHERE purchased_at IS NOT NULL) AS buyers
      FROM sess_c
  ),
  cart_last AS (
    SELECT f.event_id, f.session_id, f.pillar, (array_agg(f.amount_cents ORDER BY f.created_at DESC))[1] AS cents
      FROM fn f WHERE f.step = 'selected' AND f.amount_cents IS NOT NULL AND f.created_at >= v_from
     GROUP BY f.event_id, f.session_id, f.pillar
  ),
  abandoned AS (
    SELECT count(*) AS sessions, COALESCE(sum(c.cents), 0) AS cents
      FROM sess_c s
      JOIN (SELECT event_id, session_id, sum(cents) AS cents FROM cart_last GROUP BY event_id, session_id) c
        ON c.event_id = s.event_id AND c.session_id = s.session_id
     WHERE s.rk IN (3, 4)
  ),
  eng AS (
    SELECT count(*) AS visits, count(*) FILTER (WHERE visited_at >= v_day_start) AS today,
           count(DISTINCT visitor_id) AS visitors, count(*) FILTER (WHERE is_returning) AS returning_n,
           avg(duration_seconds) FILTER (WHERE duration_seconds BETWEEN 1 AND 3600) AS avg_duration,
           count(*) FILTER (WHERE duration_seconds BETWEEN 1 AND 3600) AS duration_n,
           count(*) FILTER (WHERE duration_seconds BETWEEN 1 AND 3600) AS scroll_n,
           count(*) FILTER (WHERE duration_seconds BETWEEN 1 AND 3600 AND scroll_depth_max >= 50) AS scroll_half,
           count(*) FILTER (WHERE duration_seconds BETWEEN 1 AND 3600 AND scroll_depth_max >= 90) AS scroll_full
      FROM vis WHERE cur
  ),
  eng_prev AS (SELECT count(*) AS visits FROM vis WHERE NOT cur),
  cities AS (
    SELECT city, count(*) AS visits FROM vis WHERE cur AND city IS NOT NULL AND city <> '' GROUP BY city ORDER BY 2 DESC LIMIT 6
  ),
  day_rows AS (
    SELECT to_char(visited_at AT TIME ZONE g.tz, 'YYYY-MM-DD') AS date, 1 AS visits, 0 AS checkout, 0 AS purchased FROM vis WHERE cur
    UNION ALL
    SELECT to_char(checkout_at AT TIME ZONE g.tz, 'YYYY-MM-DD'), 0, 1, 0 FROM sess_c WHERE checkout_at IS NOT NULL
    UNION ALL
    SELECT to_char(purchased_at AT TIME ZONE g.tz, 'YYYY-MM-DD'), 0, 0, 1 FROM sess_c WHERE purchased_at IS NOT NULL
  ),
  series AS (
    SELECT date, sum(visits) AS visits, sum(checkout) AS checkout, sum(purchased) AS purchased
      FROM day_rows GROUP BY date ORDER BY date DESC LIMIT 366
  ),
  live AS (
    SELECT count(*) AS total, count(*) FILTER (WHERE stage = 'cart') AS cart, count(*) FILTER (WHERE stage = 'checkout') AS checkout
      FROM public.live_visitor_pings p WHERE p.event_id = ANY (g.scope_ids) AND p.last_seen > v_now - interval '75 seconds'
  ),
  nights AS (SELECT count(DISTINCT event_id) AS n FROM (SELECT event_id FROM vis WHERE cur UNION SELECT event_id FROM sess_c) x)
  SELECT jsonb_build_object(
    'ok', true, 'now', v_now, 'tz', g.tz, 'money', g.money,
    'scope', CASE WHEN g.scope_venue IS NOT NULL THEN 'venue' ELSE 'organizer' END,
    'event', null,
    'period', jsonb_build_object('hours', p_hours, 'from', CASE WHEN p_hours IS NULL THEN null ELSE v_from END, 'nights', (SELECT n FROM nights)),
    'visits', (SELECT jsonb_build_object(
        'total', visits, 'today', today, 'visitors', visitors, 'returning', returning_n,
        'avgDuration', CASE WHEN duration_n >= 10 THEN round(avg_duration)::int END,
        'scrollSample', scroll_n, 'scrollHalf', scroll_half, 'scrollFull', scroll_full) FROM eng),
    'cities', COALESCE((SELECT jsonb_agg(jsonb_build_object('city', city, 'visits', visits)) FROM cities), '[]'::jsonb),
    'funnel', (SELECT jsonb_build_object('tracked', sessions > 0, 'sessions', sessions, 'selected', selected, 'checkout', checkout,
                                         'details', details, 'purchased', purchased, 'failedOpen', failed_open) FROM stage),
    'pillars', COALESCE((SELECT jsonb_agg(jsonb_build_object('pillar', pillar, 'selected', selected, 'checkout', checkout,
                                         'details', details, 'purchased', purchased) ORDER BY pillar) FROM stage_p), '[]'::jsonb),
    'failures', COALESCE((SELECT jsonb_agg(jsonb_build_object('reason', reason, 'sessions', sessions)) FROM fail_reasons), '[]'::jsonb),
    'selections', COALESCE((SELECT jsonb_agg(jsonb_build_object('pillar', pillar, 'ref', ref, 'name', name, 'sessions', sessions,
                                         'units', units, 'sold', sold) ORDER BY sessions DESC) FROM sel_rows), '[]'::jsonb),
    'sources', COALESCE((SELECT jsonb_agg(jsonb_build_object('source', source, 'visits', visits, 'sessions', sessions,
                                         'checkout', checkout, 'purchased', purchased)) FROM sources), '[]'::jsonb),
    'devices', COALESCE((SELECT jsonb_agg(jsonb_build_object('device', device, 'visits', visits, 'sessions', sessions,
                                         'checkout', checkout, 'purchased', purchased)) FROM devices), '[]'::jsonb),
    'timing', (SELECT jsonb_build_object('buyers', buyers,
        'viewToBuy', CASE WHEN buyers >= 5 THEN round(view_to_buy)::int END,
        'checkoutToBuy', CASE WHEN buyers >= 5 THEN round(checkout_to_buy)::int END) FROM timing),
    'abandoned', (SELECT jsonb_build_object('sessions', sessions, 'amount', CASE WHEN g.money THEN round(cents / 100.0, 2) END) FROM abandoned),
    'series', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', date, 'visits', visits, 'checkout', checkout,
                                         'purchased', purchased) ORDER BY date) FROM series), '[]'::jsonb),
    'live', (SELECT jsonb_build_object('total', total, 'cart', cart, 'checkout', checkout) FROM live),
    'previous', CASE WHEN p_hours IS NULL THEN null ELSE jsonb_build_object(
        'visits', (SELECT visits FROM eng_prev), 'sessions', (SELECT sessions FROM stage_prev),
        'checkout', (SELECT checkout FROM stage_prev), 'purchased', (SELECT purchased FROM stage_prev)) END
  ) INTO v_result;

  RETURN v_result || jsonb_build_object('takeaways', public.lens_traffic_takeaways(v_result));
END;
$function$;
REVOKE ALL ON FUNCTION public.get_traffic_period(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_traffic_period(text, uuid, integer) TO authenticated;

-- ─── Communauté sur une PÉRIODE : la même lecture que `get_event_community`, pour toutes les soirées ──
-- Personnes = emails distincts qui ont acheté ou se sont inscrits PENDANT la
-- période (billet, table, guest list). « Nouveau » = jamais vu à une soirée de
-- la portée avant la période. Fidélité = nombre de soirées de la portée
-- auxquelles la personne est venue (une, deux, trois et plus). Abonnés = le
-- journal de la portée, sur la période, face à son rythme des 60 jours d'avant.
-- Même forme de réponse que la lentille d'une soirée ; `parties` est vide
-- (l'attribution par partie n'a de sens que sur UNE soirée).
CREATE OR REPLACE FUNCTION public.get_community_period(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_hours integer DEFAULT 720)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  g           record;
  v_now       timestamptz := now();
  v_from      timestamptz;
  v_prev_from timestamptz;
  v_win_from  timestamptz;
  v_me        text;
  v_stype     text;
  v_sid       text;
  v_result    jsonb;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;
  v_me := CASE WHEN g.scope_venue IS NOT NULL THEN 'venue:' || g.scope_venue ELSE 'org:' || g.scope_org::text END;
  v_stype := CASE WHEN g.scope_venue IS NOT NULL THEN 'venue' ELSE 'organizer' END;
  v_sid := CASE WHEN g.scope_venue IS NOT NULL THEN g.scope_venue ELSE g.scope_org::text END;
  v_from := CASE WHEN p_hours IS NULL THEN '-infinity'::timestamptz ELSE v_now - make_interval(hours => p_hours) END;
  v_prev_from := CASE WHEN p_hours IS NULL THEN NULL ELSE v_from - make_interval(hours => p_hours) END;

  WITH
  scope_ev AS MATERIALIZED (
    SELECT x.id FROM public.events x WHERE x.id = ANY (g.scope_ids) AND x.cancelled_at IS NULL
  ),
  rows_all AS MATERIALIZED (
    SELECT 'tickets'::text AS pillar, t.event_id, lower(btrim(t.user_email)) AS email, t.user_id,
           COALESCE(t.paid_at, t.created_at) AS at_ts,
           greatest(COALESCE(t.quantity, 1), 1) AS heads,
           greatest(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)
             - least(greatest(COALESCE(t.refund_amount, 0), 0), greatest(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)) AS amount
      FROM public.tickets t WHERE t.event_id IN (SELECT id FROM scope_ev) AND t.status IN ('paid', 'used')
    UNION ALL
    SELECT 'tables', r.event_id, lower(btrim(r.user_email)), r.user_id, COALESCE(r.paid_at, r.created_at),
           greatest(COALESCE(r.guest_count, 0), 1),
           greatest(r.total_price - COALESCE(r.service_fee, 0) - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(COALESCE(r.refund_amount, 0), 0),
                     greatest(r.total_price - COALESCE(r.service_fee, 0) - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0))
      FROM public.table_reservations r WHERE r.event_id IN (SELECT id FROM scope_ev) AND r.status IN ('paid', 'confirmed')
    UNION ALL
    SELECT 'guest_list', gl.event_id, lower(nullif(btrim(ge.email), '')), ge.user_id, ge.created_at, 1, 0::numeric
      FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
     WHERE gl.event_id IN (SELECT id FROM scope_ev) AND ge.status <> 'cancelled'
  ),
  win_rows AS MATERIALIZED (SELECT * FROM rows_all WHERE at_ts >= v_from),
  people AS MATERIALIZED (
    SELECT r.email, min(r.at_ts) AS first_at,
           (array_agg(r.user_id) FILTER (WHERE r.user_id IS NOT NULL))[1] AS user_id,
           bool_or(r.pillar IN ('tickets', 'tables')) AS buyer, bool_or(r.pillar = 'guest_list') AS guest,
           sum(r.heads) FILTER (WHERE r.pillar <> 'guest_list') AS heads_paid, COALESCE(sum(r.amount), 0) AS amount
      FROM win_rows r WHERE r.email IS NOT NULL GROUP BY r.email
  ),
  no_email AS (SELECT count(*) AS n FROM win_rows WHERE email IS NULL),
  people_prev AS (
    SELECT count(DISTINCT email) AS n FROM rows_all
     WHERE email IS NOT NULL AND v_prev_from IS NOT NULL AND at_ts >= v_prev_from AND at_ts < v_from
  ),
  -- Déjà connus AVANT la période, et nombre de soirées faites (toute la vie de la portée).
  life AS (
    SELECT r.email, count(DISTINCT r.event_id) AS nights, min(r.at_ts) AS first_ever
      FROM rows_all r WHERE r.email IN (SELECT email FROM people) GROUP BY r.email
  ),
  ns AS MATERIALIZED (
    SELECT lower(n.email) AS email, n.opted_in, n.created_at
      FROM public.newsletter_subscriptions n
     WHERE ((g.scope_venue IS NOT NULL AND n.venue_id = g.scope_venue) OR (g.scope_org IS NOT NULL AND n.organizer_user_id = g.scope_org))
       AND lower(n.email) IN (SELECT email FROM people)
  ),
  sm AS MATERIALIZED (
    SELECT lower(c.email) AS email, c.phone_e164, c.sms_consent_at
      FROM public.venue_sms_contacts c
     WHERE ((g.scope_venue IS NOT NULL AND c.venue_id = g.scope_venue) OR (g.scope_org IS NOT NULL AND c.organizer_user_id = g.scope_org))
       AND COALESCE(c.unsubscribed, false) = false AND lower(c.email) IN (SELECT email FROM people)
  ),
  app AS (
    SELECT DISTINCT p.email FROM people p
     WHERE p.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = p.user_id AND ps.platform = 'ios')
  ),
  acct AS (
    SELECT DISTINCT p.email FROM people p
     WHERE p.user_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.profiles pf WHERE lower(pf.email) = p.email)
  ),
  me_ns AS (SELECT DISTINCT email FROM ns WHERE opted_in),
  me_sm AS (SELECT DISTINCT email FROM sm WHERE email IS NOT NULL),
  fresh AS (SELECT p.email FROM people p JOIN life l ON l.email = p.email WHERE l.first_ever >= v_from),
  reach AS (
    SELECT count(*) AS people,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM me_ns)) AS email_ok,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM me_sm)) AS sms_ok,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM app)) AS app,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM acct)) AS account,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM me_ns) OR p.email IN (SELECT email FROM me_sm) OR p.email IN (SELECT email FROM app)) AS any_ok,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM fresh)) AS fresh_n,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM fresh) AND p.email IN (SELECT email FROM me_ns)) AS fresh_email_ok,
           count(*) FILTER (WHERE p.buyer) AS buyers,
           count(*) FILTER (WHERE p.guest AND NOT p.buyer) AS guests_only,
           COALESCE(sum(p.heads_paid), 0) AS heads_paid, COALESCE(sum(p.amount), 0) AS amount
      FROM people p
  ),
  loyalty AS (
    SELECT count(*) FILTER (WHERE COALESCE(l.nights, 1) <= 1) AS first_time,
           count(*) FILTER (WHERE l.nights = 2) AS second_time, count(*) FILTER (WHERE l.nights >= 3) AS regulars
      FROM people p LEFT JOIN life l ON l.email = p.email
  ),
  fw AS MATERIALIZED (
    SELECT f.follower_user_id, f.action, f.source, f.created_at
      FROM public.audience_follow_events f
     WHERE f.subject_type = v_stype AND f.subject_id = v_sid
       AND f.created_at >= CASE WHEN p_hours IS NULL THEN '-infinity'::timestamptz ELSE v_from - interval '60 days' END
  ),
  fw_sum AS (
    SELECT count(*) FILTER (WHERE action = 'follow' AND created_at >= v_from) AS gained,
           count(*) FILTER (WHERE action = 'unfollow' AND created_at >= v_from) AS lost,
           count(*) FILTER (WHERE action = 'follow' AND created_at >= v_from AND source = 'event_page') AS from_event_page,
           count(DISTINCT follower_user_id) FILTER (WHERE action = 'follow' AND created_at >= v_from
              AND follower_user_id IN (SELECT user_id FROM people WHERE user_id IS NOT NULL)) AS from_attendees,
           count(*) FILTER (WHERE action = 'follow' AND created_at < v_from AND p_hours IS NOT NULL) AS before_follows,
           count(*) FILTER (WHERE action = 'follow' AND created_at >= COALESCE(v_prev_from, v_from) AND created_at < v_from AND p_hours IS NOT NULL) AS prev_gained
      FROM fw
  ),
  snap AS (
    SELECT s.followers_total FROM public.audience_daily_snapshots s
     WHERE s.subject_type = v_stype AND s.subject_id = v_sid ORDER BY s.snapshot_date DESC LIMIT 1
  ),
  win AS (SELECT CASE WHEN p_hours IS NULL THEN COALESCE((SELECT min(at_ts) FROM rows_all), v_now) ELSE v_from END AS from_ts),
  tl_people AS (
    SELECT to_char(p.first_at AT TIME ZONE g.tz, 'YYYY-MM-DD') AS date, count(*) AS people,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM fresh)) AS fresh
      FROM people p GROUP BY 1
  ),
  tl_fw AS (
    SELECT to_char(created_at AT TIME ZONE g.tz, 'YYYY-MM-DD') AS date, count(*) AS followers
      FROM fw WHERE action = 'follow' AND created_at >= v_from GROUP BY 1
  ),
  tl_ns AS (
    SELECT to_char(created_at AT TIME ZONE g.tz, 'YYYY-MM-DD') AS date, count(DISTINCT email) AS optins
      FROM ns WHERE opted_in AND created_at >= v_from GROUP BY 1
  ),
  tl_days AS (SELECT date FROM tl_people UNION SELECT date FROM tl_fw UNION SELECT date FROM tl_ns),
  timeline AS (
    SELECT d.date, COALESCE(pp.people, 0) AS people, COALESCE(pp.fresh, 0) AS fresh,
           COALESCE(ff.followers, 0) AS followers, COALESCE(nn.optins, 0) AS optins
      FROM tl_days d LEFT JOIN tl_people pp ON pp.date = d.date LEFT JOIN tl_fw ff ON ff.date = d.date LEFT JOIN tl_ns nn ON nn.date = d.date
     ORDER BY d.date DESC LIMIT 366
  )
  SELECT jsonb_build_object(
    'ok', true, 'now', v_now, 'tz', g.tz, 'money', g.money,
    'scope', CASE WHEN g.scope_venue IS NOT NULL THEN 'venue' ELSE 'organizer' END,
    'me', v_me, 'event', null,
    'period', jsonb_build_object('hours', p_hours, 'from', (SELECT from_ts FROM win), 'to', v_now),
    'window', jsonb_build_object('from', (SELECT from_ts FROM win), 'to', v_now),
    'people', (SELECT jsonb_build_object('total', people, 'buyers', buyers, 'guestsOnly', guests_only, 'headsPaid', heads_paid,
                 'noEmail', (SELECT n FROM no_email), 'spend', CASE WHEN g.money AND buyers > 0 THEN round(amount, 2) END) FROM reach),
    'crm', (SELECT jsonb_build_object('new', fresh_n, 'known', people - fresh_n, 'emailOk', email_ok, 'smsOk', sms_ok, 'app', app,
                 'account', account, 'anyReach', any_ok, 'newEmailOk', fresh_email_ok) FROM reach),
    'loyalty', (SELECT jsonb_build_object('first', first_time, 'second', second_time, 'regulars', regulars) FROM loyalty),
    'retention', null,
    'parties', '[]'::jsonb,
    'followers', (SELECT jsonb_build_object('gained', gained, 'lost', lost, 'eventPage', from_event_page, 'attendees', from_attendees,
                 'total', (SELECT followers_total FROM snap),
                 'baselinePerDay', CASE WHEN p_hours IS NULL THEN 0 ELSE round(before_follows::numeric / 60.0, 2) END) FROM fw_sum),
    'timeline', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', date, 'people', people, 'fresh', fresh,
                 'followers', followers, 'optins', optins) ORDER BY date) FROM timeline), '[]'::jsonb),
    'previous', CASE WHEN p_hours IS NULL THEN null
                     ELSE jsonb_build_object('people', (SELECT n FROM people_prev), 'followers', (SELECT prev_gained FROM fw_sum)) END
  ) INTO v_result;

  RETURN v_result || jsonb_build_object('takeaways', public.lens_community_takeaways(
    v_result, greatest(1, round(extract(epoch FROM (v_now - (v_result #>> '{period,from}')::timestamptz)) / 86400.0))));
END;
$function$;
REVOKE ALL ON FUNCTION public.get_community_period(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_community_period(text, uuid, integer) TO authenticated;

-- ─── La colonne des soirées (à droite de chaque vue d'analyse) ───────────────
-- Une ligne par soirée de la portée, avec UN chiffre par famille, calculé comme
-- la lentille qu'il ouvre : Ventes (billets, CA), Trafic (visites), Communauté
-- (personnes = emails distincts). Jamais un chiffre « à part ».
CREATE OR REPLACE FUNCTION public.get_analytics_event_rail(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_limit integer DEFAULT 80)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  g record;
  v_now timestamptz := now();
  v_rows jsonb;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;

  WITH ev AS MATERIALIZED (
    SELECT e.id, e.title, e.start_at, COALESCE(e.end_at, e.start_at + interval '8 hours') AS end_ts,
           COALESCE(e.poster_url, e.image_url) AS poster,
           (g.scope_venue IS NOT NULL AND e.venue_id = g.scope_venue) OR (g.scope_org IS NOT NULL AND e.organizer_user_id = g.scope_org) AS hosted
      FROM public.events e
     WHERE e.id = ANY (g.scope_ids) AND e.cancelled_at IS NULL AND COALESCE(e.status, 'active') <> 'cancelled'
     ORDER BY e.start_at DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 80), 200))
  ),
  tx AS MATERIALIZED (
    SELECT t.event_id, lower(btrim(t.user_email)) AS email, greatest(COALESCE(t.quantity, 1), 1) AS units, 'tickets' AS pillar,
           greatest(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)
             - least(greatest(COALESCE(t.refund_amount, 0), 0), greatest(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)) AS amount
      FROM public.tickets t WHERE t.event_id IN (SELECT id FROM ev) AND t.status IN ('paid', 'used')
    UNION ALL
    SELECT r.event_id, lower(btrim(r.user_email)), 1, 'tables',
           greatest(r.total_price - COALESCE(r.service_fee, 0) - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(COALESCE(r.refund_amount, 0), 0),
                     greatest(r.total_price - COALESCE(r.service_fee, 0) - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0))
      FROM public.table_reservations r WHERE r.event_id IN (SELECT id FROM ev) AND r.status IN ('paid', 'confirmed')
    UNION ALL
    SELECT gl.event_id, lower(nullif(btrim(ge.email), '')), 1, 'guests', 0::numeric
      FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
     WHERE gl.event_id IN (SELECT id FROM ev) AND ge.status <> 'cancelled'
    UNION ALL
    SELECT o.event_id, null, 0, 'drinks',
           greatest(o.total - COALESCE(o.service_fee, 0), 0)
             - least(greatest(COALESCE(o.refund_amount, 0), 0), greatest(o.total - COALESCE(o.service_fee, 0), 0))
      FROM public.orders o
     WHERE g.scope_venue IS NOT NULL AND o.venue_id = g.scope_venue AND o.event_id IN (SELECT id FROM ev) AND o.status IN ('paid', 'served')
  ),
  agg AS (
    SELECT event_id,
           sum(units) FILTER (WHERE pillar = 'tickets') AS tickets,
           count(*) FILTER (WHERE pillar = 'tables') AS tables,
           count(*) FILTER (WHERE pillar = 'guests') AS guests,
           count(DISTINCT email) FILTER (WHERE pillar <> 'drinks') AS people,
           sum(amount) AS revenue
      FROM tx GROUP BY event_id
  ),
  vis AS (SELECT s.event_id, count(*) AS n FROM public.visitor_sessions s WHERE s.event_id IN (SELECT id FROM ev) GROUP BY s.event_id)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', ev.id, 'title', ev.title, 'startAt', ev.start_at, 'endAt', ev.end_ts, 'poster', ev.poster,
           'phase', CASE WHEN v_now < ev.start_at THEN 'before' WHEN v_now < ev.end_ts THEN 'live' ELSE 'after' END,
           'tickets', COALESCE(a.tickets, 0), 'tables', COALESCE(a.tables, 0), 'guests', COALESCE(a.guests, 0),
           'people', COALESCE(a.people, 0), 'visits', COALESCE(v.n, 0),
           'revenue', CASE WHEN g.money AND ev.hosted THEN round(COALESCE(a.revenue, 0), 2) END
         ) ORDER BY ev.start_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM ev LEFT JOIN agg a ON a.event_id = ev.id LEFT JOIN vis v ON v.event_id = ev.id;

  RETURN jsonb_build_object('ok', true, 'money', g.money, 'now', v_now, 'events', v_rows);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_analytics_event_rail(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_event_rail(text, uuid, integer) TO authenticated;

-- Ventes : périodes en temps (nights terminées dans la fenêtre), en plus de last / last4 / month / year / all.
CREATE OR REPLACE FUNCTION public.get_sales_overview(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT 'last4'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_now    timestamptz := now();
  v_money  boolean := false;
  v_is_org boolean := p_organizer_user_id is not null;
  v_tz     text := 'Europe/Paris';
  v_from   timestamptz;
  v_by_end boolean := false;
  v_limit  integer;
  v_result jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if v_is_org then
    if not (
      v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(v_uid, p_organizer_user_id, 'editor')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_money := v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.org_member_has_permission(v_uid, p_organizer_user_id, 'view_finance');
  elsif p_venue_id is null
     or not (public.can_manage_venue(v_uid, p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  else
    v_money := public.is_super_admin()
      or exists (select 1 from public.venues v where v.id = p_venue_id and v.owner_id = v_uid)
      or exists (
        select 1 from public.manager_permissions mp
        where mp.user_id = v_uid and mp.venue_id = p_venue_id
          and (coalesce(mp.can_view_analytics, false) or coalesce(mp.can_view_finance, false))
      );
    select coalesce(v.timezone, 'Europe/Paris') into v_tz from public.venues v where v.id = p_venue_id;
  end if;

  -- Périodes en temps (24 h, 48 h, 7 j, 30 j, 90 j) : les soirées TERMINÉES
  -- dont la fin tombe dans la fenêtre ; la période d'avant = le même nombre de
  -- soirées juste avant (règle inchangée : on ne compare qu'à nombre égal).
  v_by_end := p_period in ('d1', 'd2', 'd7', 'd30', 'd90');
  v_from := case p_period
    when 'month' then date_trunc('month', v_now at time zone v_tz) at time zone v_tz
    when 'year'  then date_trunc('year',  v_now at time zone v_tz) at time zone v_tz
    when 'd1'    then v_now - interval '24 hours'
    when 'd2'    then v_now - interval '48 hours'
    when 'd7'    then v_now - interval '7 days'
    when 'd30'   then v_now - interval '30 days'
    when 'd90'   then v_now - interval '90 days'
    else null
  end;
  v_limit := case p_period when 'last' then 1 when 'last4' then 4 else null end;

  with
  -- Toutes les soirées commencées de la portée, de la plus récente à la plus
  -- ancienne ; `rn` numérote cette file.
  scope as materialized (
    select e.id, e.title, e.start_at, coalesce(e.end_at, e.start_at + interval '8 hours') as end_ts, coalesce(e.poster_url, e.image_url) as poster,
           e.max_tickets, e.venue_id, e.partner_venue_id,
           case when v_is_org then v_money else v_money and e.venue_id = p_venue_id end as show_money,
           row_number() over (order by e.start_at desc) as rn
    from public.events e
    -- Soirées TERMINÉES : une soirée en cours (entrées partielles) n'est pas
    -- « la dernière soirée ».
    where coalesce(e.end_at, e.start_at + interval '8 hours') <= v_now
      and e.cancelled_at is null
      and coalesce(e.status, 'active') <> 'cancelled'
      and (
           (not v_is_org and (e.venue_id = p_venue_id or e.partner_venue_id = p_venue_id))
        or (v_is_org and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id))
      )
    order by e.start_at desc
    limit 1000
  ),
  cur_n as (
    select count(*)::integer as n from scope s
    where (v_limit is null or s.rn <= v_limit)
      and (v_from is null or (case when v_by_end then s.end_ts else s.start_at end) >= v_from)
  ),
  -- Période courante = les N premières ; précédente = les N suivantes.
  -- « Tout » n'a pas de période précédente.
  nights as materialized (
    select s.*, case when s.rn <= c.n then 'cur' else 'prev' end as bucket
    from scope s cross join cur_n c
    where s.rn <= c.n
       or (p_period <> 'all' and c.n > 0 and s.rn > c.n and s.rn <= 2 * c.n)
  ),

  tk as (
    select t.event_id,
           sum(greatest(coalesce(t.quantity, 1), 1)) as sold,
           count(*) as orders,
           sum(greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
               - least(greatest(coalesce(t.refund_amount, 0), 0),
                       greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))) as amount,
           sum(case when coalesce(t.total_price, 0) > 0 then round(t.total_price * 0.015 + 0.25, 2) else 0 end) as stripe,
           sum(greatest(coalesce(t.quantity, 1), 1))
             filter (where coalesce(t.entry_scanned, false) or coalesce(t.used, false) or t.status = 'used') as entered
    from public.tickets t
    join nights n on n.id = t.event_id
    where t.status in ('paid', 'used')
    group by t.event_id
  ),
  tb as (
    select r.event_id,
           count(*) as booked,
           sum(greatest(coalesce(r.guest_count, 0), 0)) as guests,
           sum(greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
               - least(greatest(coalesce(r.refund_amount, 0), 0),
                       greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))) as amount,
           sum(case when coalesce(r.payment_mode, 'online') <> 'on_site' and coalesce(r.total_price, 0) > 0
                    then round(r.total_price * 0.015 + 0.25, 2) else 0 end) as stripe,
           count(*) filter (where coalesce(r.entry_scanned, false) or r.checked_in_at is not null) as arrived,
           sum(greatest(coalesce(r.guest_count, 0), 1))
             filter (where coalesce(r.entry_scanned, false) or r.checked_in_at is not null) as entered
    from public.table_reservations r
    join nights n on n.id = r.event_id
    where r.status in ('paid', 'confirmed')
    group by r.event_id
  ),
  dr as (
    select o.event_id,
           count(*) as orders,
           sum(greatest(o.total - coalesce(o.service_fee, 0), 0)
               - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))) as amount,
           sum(case when coalesce(o.total, 0) > 0 then round(o.total * 0.015 + 0.25, 2) else 0 end) as stripe
    from public.orders o
    join nights n on n.id = o.event_id
    where not v_is_org
      and o.status in ('paid', 'served')
    group by o.event_id
  ),
  gl as (
    select g.event_id,
           count(*) as registered,
           count(*) filter (where coalesce(e2.entry_scanned, false)) as entered
    from public.guest_list_entries e2
    join public.guest_lists g on g.id = e2.guest_list_id
    join nights n on n.id = g.event_id
    where e2.status <> 'cancelled'
    group by g.event_id
  ),
  caps as (
    select n.id as event_id,
           -- Même capacité que get_event_report : un palier illimité rend la
           -- jauge sans capacité (pas un remplissage au-delà de 100 %).
           case when coalesce(n.max_tickets, 0) > 0 then n.max_tickets
                when exists (select 1 from public.ticket_rounds tr where tr.event_id = n.id)
                 and not exists (select 1 from public.ticket_rounds tr where tr.event_id = n.id and coalesce(tr.max_tickets, 0) <= 0)
                  then (select sum(tr.max_tickets) from public.ticket_rounds tr where tr.event_id = n.id)
                else null end as cap
    from nights n
  ),
  -- Personnes distinctes par soirée et par période (tous piliers).
  people as (
    select n.bucket, n.id as event_id, lower(trim(x.email)) as email
    from nights n
    join lateral (
      select t.user_email as email from public.tickets t where t.event_id = n.id and t.status in ('paid', 'used')
      union all
      select r.user_email from public.table_reservations r where r.event_id = n.id and r.status in ('paid', 'confirmed')
      union all
      select o.user_email from public.orders o where not v_is_org and o.event_id = n.id and o.status in ('paid', 'served')
      union all
      select e2.email from public.guest_list_entries e2 join public.guest_lists g on g.id = e2.guest_list_id
       where g.event_id = n.id and e2.status <> 'cancelled'
    ) x on true
    where nullif(trim(x.email), '') is not null
  ),
  per_night as (
    select n.id, n.title, n.start_at, n.poster, n.bucket, n.rn, n.show_money,
           coalesce(tk.sold, 0) as tickets, coalesce(tk.orders, 0) as ticket_orders,
           coalesce(tb.booked, 0) as tables, coalesce(tb.guests, 0) as table_guests, coalesce(tb.arrived, 0) as tables_arrived,
           coalesce(dr.orders, 0) as bar_orders,
           coalesce(gl.registered, 0) as gl_registered, coalesce(gl.entered, 0) as gl_entered,
           coalesce(tk.entered, 0) + coalesce(tb.entered, 0) + coalesce(gl.entered, 0) as entries,
           coalesce(tk.entered, 0) as ticket_entries,
           case when n.show_money then coalesce(tk.amount, 0) else 0 end as rev_tickets,
           case when n.show_money then coalesce(tb.amount, 0) else 0 end as rev_tables,
           case when n.show_money then coalesce(dr.amount, 0) else 0 end as rev_bar,
           case when n.show_money then coalesce(tk.stripe, 0) + coalesce(tb.stripe, 0) + coalesce(dr.stripe, 0) else 0 end as stripe,
           caps.cap,
           (select count(distinct p.email) from people p where p.event_id = n.id) as customers
    from nights n
    left join tk on tk.event_id = n.id
    left join tb on tb.event_id = n.id
    left join dr on dr.event_id = n.id
    left join gl on gl.event_id = n.id
    left join caps on caps.event_id = n.id
  ),
  totals as (
    select b.bucket,
           count(pn.id) as nights,
           coalesce(sum(pn.rev_tickets + pn.rev_tables + pn.rev_bar), 0) as revenue,
           coalesce(sum(pn.rev_tickets), 0) as rev_tickets,
           coalesce(sum(pn.rev_tables), 0) as rev_tables,
           coalesce(sum(pn.rev_bar), 0) as rev_bar,
           coalesce(sum(pn.stripe), 0) as stripe,
           coalesce(sum(pn.entries), 0) as entries,
           coalesce(sum(pn.ticket_entries), 0) as ticket_entries,
           coalesce(sum(pn.tickets), 0) as tickets,
           coalesce(sum(pn.ticket_orders), 0) as ticket_orders,
           coalesce(sum(pn.tables), 0) as tables,
           coalesce(sum(pn.table_guests), 0) as table_guests,
           coalesce(sum(pn.tables_arrived), 0) as tables_arrived,
           coalesce(sum(pn.bar_orders), 0) as bar_orders,
           coalesce(sum(pn.gl_registered), 0) as gl_registered,
           coalesce(sum(pn.gl_entered), 0) as gl_entered,
           coalesce(sum(pn.cap) filter (where pn.cap > 0), 0) as ticket_cap,
           coalesce(sum(pn.tickets) filter (where pn.cap > 0), 0) as tickets_with_cap,
           -- Dénominateurs justes (revue du 25/09) : la dépense par tête ne
           -- compte que les soirées dont on voit l'argent ET où la porte a
           -- scanné ; la présence, que les soirées où la porte a scanné (sans
           -- scan, « pas scanné » ne veut pas dire « pas venu ») ; prix moyens
           -- sur les soirées dont on voit l'argent.
           count(pn.id) filter (where pn.show_money) as money_nights,
           coalesce(sum(pn.rev_tickets + pn.rev_tables + pn.rev_bar) filter (where pn.show_money and pn.entries > 0), 0) as spend_revenue,
           coalesce(sum(pn.entries) filter (where pn.show_money and pn.entries > 0), 0) as spend_entries,
           coalesce(sum(pn.entries) filter (where pn.entries > 0), 0) as presence_entries,
           coalesce(sum(pn.tickets + pn.table_guests + pn.gl_registered) filter (where pn.entries > 0), 0) as presence_expected,
           coalesce(sum(pn.gl_registered) filter (where pn.gl_entered > 0), 0) as gl_presence_registered,
           coalesce(sum(pn.gl_entered) filter (where pn.gl_entered > 0), 0) as gl_presence_entered,
           coalesce(sum(pn.tables) filter (where pn.tables_arrived > 0), 0) as tables_presence_booked,
           coalesce(sum(pn.tables_arrived) filter (where pn.tables_arrived > 0), 0) as tables_presence_arrived,
           coalesce(sum(pn.tickets) filter (where pn.show_money), 0) as money_tickets,
           coalesce(sum(pn.tables) filter (where pn.show_money), 0) as money_tables,
           coalesce(sum(pn.bar_orders) filter (where pn.show_money), 0) as money_bar_orders,
           (select count(distinct p.email) from people p where p.bucket = b.bucket) as customers
    from (values ('cur'), ('prev')) b(bucket)
    left join per_night pn on pn.bucket = b.bucket
    group by b.bucket
  ),
  -- Détail des piliers, période courante seulement.
  rounds_list as (
    select tr.name,
           sum(greatest(coalesce(t.quantity, 1), 1)) as sold,
           sum(case when n.show_money then
               greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
               - least(greatest(coalesce(t.refund_amount, 0), 0),
                       greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))
               else 0 end) as amount
    from public.tickets t
    join nights n on n.id = t.event_id and n.bucket = 'cur'
    join public.ticket_rounds tr on tr.id = t.ticket_round_id
    where t.status in ('paid', 'used')
    group by tr.name
    order by 2 desc
    limit 12
  ),
  packs_list as (
    select coalesce(p.name, '—') as name,
           count(*) as booked,
           sum(greatest(coalesce(r.guest_count, 0), 0)) as guests,
           sum(case when n.show_money then
               greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
               - least(greatest(coalesce(r.refund_amount, 0), 0),
                       greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))
               else 0 end) as amount
    from public.table_reservations r
    join nights n on n.id = r.event_id and n.bucket = 'cur'
    left join public.table_packs p on p.id = r.pack_id
    where r.status in ('paid', 'confirmed')
    group by 1
    order by 4 desc, 2 desc
    limit 12
  ),
  -- Montant d'un produit = sa part du CA CLUB de la commande (fees.ts : total
  -- − frais Yuno, remboursement déduit), au prorata du prix carte : la somme
  -- des produits retombe exactement sur le CA du bar, jamais au-dessus.
  order_lines as (
    select o.id as order_id,
           it.value ->> 'name' as name,
           greatest(coalesce((it.value ->> 'quantity')::numeric, (it.value ->> 'qty')::numeric, 1), 1) as qty,
           greatest(coalesce((it.value ->> 'quantity')::numeric, (it.value ->> 'qty')::numeric, 1), 1)
             * greatest(coalesce((it.value ->> 'price')::numeric, 0), 0) as gross,
           greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0)) as order_net
    from public.orders o
    join nights n on n.id = o.event_id and n.bucket = 'cur' and n.show_money
    cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) it
    where not v_is_org and o.status in ('paid', 'served')
      and nullif(it.value ->> 'name', '') is not null
  ),
  products_list as (
    select l.name,
           sum(l.qty) as qty,
           round(sum(case when t.gross_total > 0 then l.order_net * l.gross / t.gross_total else 0 end), 2) as amount
    from order_lines l
    join (select order_id, sum(gross) as gross_total from order_lines group by 1) t on t.order_id = l.order_id
    group by 1
    order by 2 desc
    limit 10
  ),
  bar_service as (
    select percentile_cont(0.5) within group (
             order by extract(epoch from (o.served_at - coalesce(o.paid_at, o.created_at))) / 60.0
           ) as median_min,
           count(*) as sample
    from public.orders o
    join nights n on n.id = o.event_id and n.bucket = 'cur'
    where not v_is_org and o.status = 'served' and o.served_at is not null
      and o.served_at > coalesce(o.paid_at, o.created_at)
      and o.served_at < coalesce(o.paid_at, o.created_at) + interval '3 hours'
  ),
  holders_list as (
    select case g.holder_type
             when 'club' then 'club' when 'organizer' then 'organizer' else coalesce(nullif(g.holder_label, ''), g.holder_type)
           end as name,
           g.holder_type as kind,
           count(*) as registered,
           count(*) filter (where coalesce(e2.entry_scanned, false)) as entered
    from public.guest_list_entries e2
    join public.guest_lists g on g.id = e2.guest_list_id
    join nights n on n.id = g.event_id and n.bucket = 'cur'
    where e2.status <> 'cancelled'
    group by 1, 2
    order by 3 desc
    limit 12
  ),
  -- Déjà vendu pour les soirées À VENIR (renvoie vers les prochaines soirées).
  upcoming as (
    select count(distinct e.id) as nights,
           coalesce(sum(
             case when (v_is_org and v_money) or (not v_is_org and v_money and e.venue_id = p_venue_id) then x.amount else 0 end
           ), 0) as amount
    from public.events e
    left join lateral (
      select coalesce(sum(greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
                          - least(greatest(coalesce(t.refund_amount, 0), 0),
                                  greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))), 0)
           + coalesce((select sum(greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
                          - least(greatest(coalesce(r.refund_amount, 0), 0),
                                  greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)))
                       from public.table_reservations r where r.event_id = e.id and r.status in ('paid', 'confirmed')), 0) as amount
      from public.tickets t where t.event_id = e.id and t.status in ('paid', 'used')
    ) x on true
    where e.start_at > v_now
      and e.cancelled_at is null
      and coalesce(e.status, 'active') <> 'cancelled'
      and (
           (not v_is_org and (e.venue_id = p_venue_id or e.partner_venue_id = p_venue_id))
        or (v_is_org and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id))
      )
  )
  select jsonb_build_object(
    'ok', true,
    'money', v_money,
    'has_bar', not v_is_org,
    'period', p_period,
    'generated_at', v_now,
    'current', (select to_jsonb(t) - 'bucket' from totals t where t.bucket = 'cur'),
    'previous', case when p_period = 'all' then null
                     -- Une comparaison n'a de sens qu'à nombre de soirées égal.
                     else (select case when t.nights > 0 and t.nights = (select n from cur_n) then to_jsonb(t) - 'bucket' end
                           from totals t where t.bucket = 'prev') end,
    'nights', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pn.id, 'title', pn.title, 'start_at', pn.start_at, 'poster', pn.poster,
               'revenue', case when pn.show_money then pn.rev_tickets + pn.rev_tables + pn.rev_bar end,
               'rev_tickets', case when pn.show_money then pn.rev_tickets end,
               'rev_tables', case when pn.show_money then pn.rev_tables end,
               'rev_bar', case when pn.show_money then pn.rev_bar end,
               'entries', pn.entries, 'customers', pn.customers,
               'tickets', pn.tickets, 'ticket_cap', pn.cap, 'tables', pn.tables,
               'table_guests', pn.table_guests, 'tables_arrived', pn.tables_arrived,
               'bar_orders', pn.bar_orders,
               'gl_registered', pn.gl_registered, 'gl_entered', pn.gl_entered
             ) order by pn.start_at desc)
      from per_night pn where pn.bucket = 'cur'
    ), '[]'::jsonb),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('name', r.name, 'sold', r.sold,
                         'amount', case when v_money then r.amount end)) from rounds_list r), '[]'::jsonb),
    'packs', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'booked', p.booked, 'guests', p.guests,
                        'amount', case when v_money then p.amount end)) from packs_list p), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'qty', p.qty,
                           'amount', case when v_money then p.amount end)) from products_list p), '[]'::jsonb),
    'bar_service_min', (select case when b.sample >= 5 then round(b.median_min::numeric, 1) end from bar_service b),
    'holders', coalesce((select jsonb_agg(jsonb_build_object('name', h.name, 'kind', h.kind,
                          'registered', h.registered, 'entered', h.entered)) from holders_list h), '[]'::jsonb),
    'upcoming', (select jsonb_build_object('nights', u.nights, 'amount', case when v_money then u.amount end) from upcoming u)
  ) into v_result;

  -- Sans l'argent, aucun montant ne sort, même agrégé.
  if not v_money then
    v_result := jsonb_set(v_result, '{current}',
      (v_result -> 'current') - 'revenue' - 'rev_tickets' - 'rev_tables' - 'rev_bar' - 'stripe' - 'spend_revenue');
    if v_result -> 'previous' is not null and jsonb_typeof(v_result -> 'previous') = 'object' then
      v_result := jsonb_set(v_result, '{previous}',
        (v_result -> 'previous') - 'revenue' - 'rev_tickets' - 'rev_tables' - 'rev_bar' - 'stripe' - 'spend_revenue');
    end if;
  end if;

  return v_result;
end;
$function$;

NOTIFY pgrst, 'reload schema';
