-- Trafic PAR SOIRÉE — « est-ce qu'on voit ma soirée, et où est-ce qu'on lâche ? »
--
-- Une seule RPC, `get_event_traffic(p_event_id)`, même porte que le Rapport de
-- soirée (`event_analytics_scope`). Elle rend, en un aller-retour :
--   • visits       : les visites de la page soirée (`visitor_sessions`, même
--                    définition que `get_event_report.totals.visits`), les
--                    visiteurs distincts, ceux qui reviennent, la durée, le
--                    défilement, les appareils, les villes ;
--   • funnel       : le tunnel d'achat (vue → choix → paiement → coordonnées →
--                    achat), global et par pilier, lu dans `event_funnel_events` ;
--                    une étape est « atteinte » dès qu'une étape plus avancée l'est
--                    (un lien direct vers le paiement compte comme une vue) ;
--   • exits / failures : où on lâche, et les refus avec leur motif ;
--   • selections   : les paliers et formules choisis, face à ce qui s'est vendu ;
--   • sources / devices : qui convertit, d'où et sur quoi ;
--   • timing       : le temps entre la vue et l'achat ;
--   • abandoned    : la valeur des paniers abandonnés (pour qui voit l'argent) ;
--   • live         : qui est sur la soirée en ce moment, et à quelle étape.
-- Aucune agrégation côté front, aucune donnée personnelle.

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

  RETURN v_result || jsonb_build_object('takeaways', (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (SELECT x FROM jsonb_array_elements(v_take) x LIMIT 3) z));
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_traffic(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_traffic(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
