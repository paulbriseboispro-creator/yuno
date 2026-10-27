-- Yuno Tickets › Analyses › Trafic : l'attention, en personnes (plan
-- docs/designs/TRAFFIC_TAB_PLAN.md, lot T1, décision de Paul du 27/10).
--
-- Trafic se compte en personnes, Ventes en euros. Cette lecture ne touche
-- QUE des visites (visitor_sessions), le tunnel de la page d'une soirée
-- (event_funnel_events), les clics des liens suivis et des artistes. Les
-- lectures qui attribuent une vente à une source (tix_ana_traffic,
-- tix_ana_traffic_detail) ne changent pas : Ventes les appelle.
--
-- Un seul pont vers l'argent : `bridge` (les ventes nées de ces visites, et
-- leur CA club sous `revenue`, mis à null par _tix_money_gate pour qui ne voit
-- pas l'argent). Aucune table temporaire : la lecture reste ouverte en aperçu
-- démo. Les durées sont des MÉDIANES (une page laissée ouverte une nuit fausse
-- une moyenne), plafonnées à 2 h ; un pourcentage se calcule au front, jamais
-- sous 10 (MIN_SAMPLE).

-- ── Famille d'une visite ─────────────────────────────────────────────────
-- lk = vos liens suivis (/l/, partenaires, co-soirée), ms = e-mails et push,
-- so = Instagram et réseaux, yu = Yuno (Explore, app), se = recherche,
-- ot = QR et autres sites, di = direct. Un lien suivi reconnu (même soirée,
-- même utm_source / utm_medium) l'emporte sur la catégorie du référent.
CREATE OR REPLACE FUNCTION public._tix_visit_family(
  p_cat text, p_link_net text, p_link_med text, p_has_link boolean,
  p_utm_source text, p_utm_medium text, p_landing text
) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  -- Une seule expression, sans FROM : Postgres l'insère dans la requête qui l'appelle.
  SELECT CASE
    WHEN COALESCE(p_has_link, false) THEN CASE
      WHEN lower(COALESCE(p_link_net, '')) IN ('newsletter', 'email', 'mail', 'sms', 'push')
        OR lower(COALESCE(p_link_med, '')) IN ('sms_campaign', 'email', 'push') THEN 'ms'
      ELSE 'lk' END
    WHEN lower(COALESCE(p_utm_medium, '')) IN ('partner_link', 'party_link', 'dj_link', 'partner')
      OR lower(COALESCE(p_cat, '')) = 'affiliate' THEN 'lk'
    WHEN lower(COALESCE(p_cat, '')) = 'email' OR lower(COALESCE(p_utm_source, '')) IN ('newsletter', 'email', 'push')
      OR lower(COALESCE(p_utm_medium, '')) IN ('email', 'push')
      OR COALESCE(p_landing, '') ~ '[?&](yc|pc|an)=' THEN 'ms'
    WHEN lower(COALESCE(p_cat, '')) IN ('social', 'paid_social') THEN 'so'
    WHEN lower(COALESCE(p_cat, '')) = 'internal' THEN 'yu'
    WHEN lower(COALESCE(p_cat, '')) IN ('search', 'paid_search') THEN 'se'
    WHEN lower(COALESCE(p_cat, '')) IN ('referral', 'qr') THEN 'ot'
    ELSE 'di' END;
$$;

-- Domaine lisible d'un référent : sans www., l., m., lm. (Instagram, Facebook).
CREATE OR REPLACE FUNCTION public._tix_ref_domain(p text) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT NULLIF(regexp_replace(lower(btrim(COALESCE(p, ''))), '^(www\.|l\.|lm\.|m\.)+', ''), '');
$$;

CREATE OR REPLACE FUNCTION public.tix_ana_visits__core(
  p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d', p_event uuid DEFAULT NULL, p_compare uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_tz text := 'Europe/Paris';
  v_eh int;
  v_now timestamptz := now();
  v_today date;
  v_mode text; v_n int;
  v_start timestamptz; v_d0 date; v_m0 date;
  v_from timestamptz; v_to timestamptz; v_pfrom timestamptz;
  v_ids uuid[];
  v_ev record; v_cev record;
  v_ev_id uuid; v_ev_title text; v_ev_start timestamptz; v_ev_end timestamptz;
  v_cev_id uuid; v_cev_title text; v_cev_start timestamptz;
  v_ev_night date; v_cev_night date;
  v_left int := 0; v_D int := 21;
  v_lat double precision; v_lon double precision;
  m jsonb; v_labels jsonb; r jsonb; v_keep jsonb := '[]'::jsonb;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT s.night_end_hour INTO v_eh FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id) s;
  v_eh := COALESCE(v_eh, 6);
  v_today := public._crm_night_date(v_now, v_tz, v_eh);
  SELECT COALESCE(array_agg(e.id), '{}') INTO v_ids FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) e;

  IF p_event IS NOT NULL THEN
    -- ── Une soirée : depuis sa publication, contre la soirée comparée ──────
    SELECT e.id, e.title, e.start_at, e.end_at, e.tz, COALESCE(public._crm_night_series(e.title), e.title) AS series
      INTO v_ev FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) e WHERE e.id = p_event;
    IF v_ev.id IS NULL THEN RAISE EXCEPTION 'event_not_found' USING ERRCODE = '22023'; END IF;
    v_ev_night := public._crm_night_date(v_ev.start_at, v_ev.tz, v_eh);
    v_ev_id := v_ev.id; v_ev_title := v_ev.title; v_ev_start := v_ev.start_at; v_ev_end := v_ev.end_at;
    IF p_compare IS NOT NULL AND p_compare <> p_event THEN
      SELECT e.id, e.title, e.start_at INTO v_cev_id, v_cev_title, v_cev_start
        FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) e WHERE e.id = p_compare;
    END IF;
    IF v_cev_id IS NULL THEN
      SELECT e.id, e.title, e.start_at INTO v_cev_id, v_cev_title, v_cev_start
        FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) e
       WHERE e.start_at < v_ev.start_at AND e.id <> v_ev.id
       ORDER BY (COALESCE(public._crm_night_series(e.title), e.title) = v_ev.series) DESC, e.start_at DESC LIMIT 1;
    END IF;
    IF v_cev_id IS NOT NULL THEN
      v_cev_night := public._crm_night_date(v_cev_start, (SELECT e.tz FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) e WHERE e.id = v_cev_id), v_eh);
    END IF;
    v_left := CASE WHEN v_ev_end > v_now THEN GREATEST(0, v_ev_night - v_today) ELSE 0 END;
    -- La courbe commence à la plus ancienne visite des deux soirées (60 jours au plus, 7 au moins).
    SELECT LEAST(60, GREATEST(7, COALESCE(max(x.d), 0))) INTO v_D FROM (
      SELECT v_ev_night - public._crm_night_date(s.visited_at, v_tz, v_eh) AS d FROM public.visitor_sessions s WHERE s.event_id = v_ev_id
      UNION ALL
      SELECT v_cev_night - public._crm_night_date(s.visited_at, v_tz, v_eh) FROM public.visitor_sessions s WHERE v_cev_id IS NOT NULL AND s.event_id = v_cev_id
    ) x;
    v_mode := 'event'; v_n := v_D + 1;
    SELECT jsonb_agg(to_jsonb(v_ev_night - (v_D - g)) ORDER BY g) INTO v_labels FROM generate_series(0, v_D) g;
    SELECT s.latitude, s.longitude INTO v_lat, v_lon
      FROM public.events e JOIN public.venues s ON s.id = COALESCE(e.venue_id, e.partner_venue_id) WHERE e.id = v_ev_id;
  ELSIF p_period IN ('24h', '48h') THEN
    v_mode := 'hour'; v_n := CASE p_period WHEN '24h' THEN 24 ELSE 48 END;
    v_to := date_trunc('hour', v_now) + interval '1 hour';
    v_from := v_to - make_interval(hours => v_n);
    v_pfrom := v_from - make_interval(hours => v_n);
    v_start := v_from;
  ELSIF p_period = '12m' THEN
    v_mode := 'month'; v_n := 12;
    v_m0 := (date_trunc('month', v_today) - interval '11 months')::date;
    v_from := (v_m0::timestamp + make_interval(hours => v_eh)) AT TIME ZONE v_tz;
    v_to := ((v_today + 1)::timestamp + make_interval(hours => v_eh)) AT TIME ZONE v_tz;
    v_pfrom := ((v_m0 - interval '12 months')::timestamp + make_interval(hours => v_eh)) AT TIME ZONE v_tz;
  ELSE
    v_mode := 'day'; v_n := CASE p_period WHEN '7d' THEN 7 WHEN '90d' THEN 90 ELSE 30 END;
    v_d0 := v_today - (v_n - 1);
    v_from := (v_d0::timestamp + make_interval(hours => v_eh)) AT TIME ZONE v_tz;
    v_to := ((v_today + 1)::timestamp + make_interval(hours => v_eh)) AT TIME ZONE v_tz;
    v_pfrom := ((v_d0 - v_n)::timestamp + make_interval(hours => v_eh)) AT TIME ZONE v_tz;
  END IF;

  IF v_mode <> 'event' THEN
    SELECT jsonb_agg(CASE v_mode
             WHEN 'hour' THEN to_jsonb(v_start + make_interval(hours => g))
             WHEN 'day' THEN to_jsonb(v_d0 + g)
             ELSE to_jsonb((v_m0 + make_interval(months => g))::date) END ORDER BY g)
      INTO v_labels FROM generate_series(0, v_n - 1) g;
  END IF;

  m := jsonb_build_object(
    'mode', v_mode, 'n', v_n, 'period', p_period, 'seg', 'all', 'tz', v_tz, 'night_end_hour', v_eh,
    'today', v_today, 'now', v_now, 'labels', v_labels,
    'money', public._tix_money(p_venue_id, p_organizer_user_id),
    'start', CASE v_mode WHEN 'hour' THEN to_jsonb(v_start) WHEN 'day' THEN to_jsonb(v_d0)
                         WHEN 'month' THEN to_jsonb(v_m0) ELSE to_jsonb(v_ev_night - v_D) END,
    'event', CASE WHEN v_mode = 'event' THEN jsonb_build_object(
        'id', v_ev_id, 'title', v_ev_title, 'start_at', v_ev_start, 'night', v_ev_night,
        'upcoming', v_ev_end > v_now, 'days_left', v_left) END,
    'prev_event', CASE WHEN v_cev_id IS NOT NULL THEN jsonb_build_object(
        'id', v_cev_id, 'title', v_cev_title, 'start_at', v_cev_start, 'night', v_cev_night) END);

  WITH
  -- ── Les visites lues : la période et celle d'avant, ou la soirée et la soirée comparée ──
  raw AS MATERIALIZED (
    SELECT s.session_id, s.visited_at, s.event_id, s.user_id,
           COALESCE(s.visitor_id, s.session_id) AS visitor,
           (s.event_id IS NULL) AS page,
           COALESCE(NULLIF(s.referrer_category, ''), 'direct') AS cat,
           public._tix_ref_domain(s.referrer_domain) AS domain,
           NULLIF(lower(btrim(s.utm_source)), '') AS us, NULLIF(lower(btrim(s.utm_medium)), '') AS um,
           NULLIF(btrim(s.utm_campaign), '') AS uc, s.landing_page_full AS landing,
           CASE WHEN s.duration_seconds > 0 THEN LEAST(s.duration_seconds, 7200) END AS dur,
           CASE WHEN s.duration_seconds > 0 THEN LEAST(GREATEST(COALESCE(s.scroll_depth_max, 0), 0), 100) END AS scroll,
           CASE WHEN s.duration_seconds > 0 THEN LEAST(GREATEST(COALESCE(s.pages_viewed, 1), 1), 50) END AS pages,
           COALESCE(s.completed_order, false) AS done,
           COALESCE(s.is_returning, false) AS ret,
           COALESCE(NULLIF(s.device_type, ''), 'unknown') AS device,
           CASE WHEN s.user_agent ~* 'instagram' THEN 'instagram'
                WHEN s.user_agent ~* 'FBAN|FBAV|FB_IAB' THEN 'facebook'
                WHEN s.user_agent ~* 'musical_ly|BytedanceWebview|TikTok' THEN 'tiktok' END AS inapp,
           NULLIF(lower(left(btrim(s.language), 2)), '') AS lang,
           NULLIF(btrim(s.city), '') AS city, NULLIF(upper(btrim(s.country_code)), '') AS cc,
           s.latitude AS lat, s.longitude AS lon,
           CASE WHEN v_mode = 'event' THEN s.event_id = v_ev_id ELSE s.visited_at >= v_from END AS cur,
           CASE WHEN v_mode = 'event'
                THEN s.event_id = v_cev_id
                     AND (v_left = 0 OR v_cev_night - public._crm_night_date(s.visited_at, v_tz, v_eh) >= v_left)
                ELSE s.visited_at < v_from END AS prev,
           CASE WHEN v_mode = 'event' THEN
             (CASE WHEN s.event_id = v_ev_id THEN v_ev_night ELSE v_cev_night END) - public._crm_night_date(s.visited_at, v_tz, v_eh) END AS d
      FROM public.visitor_sessions s
     WHERE CASE WHEN v_mode = 'event'
                THEN s.event_id = v_ev_id OR (v_cev_id IS NOT NULL AND s.event_id = v_cev_id)
                ELSE s.visited_at >= v_pfrom AND s.visited_at < v_to
                     AND (s.event_id = ANY (v_ids)
                       OR (s.event_id IS NULL AND p_venue_id IS NOT NULL AND s.venue_id = p_venue_id AND s.entry_page_type = 'venue_page')
                       OR (s.event_id IS NULL AND p_organizer_user_id IS NOT NULL AND s.organizer_user_id = p_organizer_user_id
                           AND s.entry_page_type = 'organizer_profile')) END
  ),
  -- Les liens suivis des soirées lues et de la page : une ligne par (soirée, utm_source, utm_medium).
  lmap AS MATERIALIZED (
    SELECT DISTINCT ON (t.event_id, lower(btrim(t.utm_source)), COALESCE(NULLIF(lower(btrim(t.utm_medium)), ''), ''))
           t.id, t.event_id, lower(btrim(t.utm_source)) AS net_k, COALESCE(NULLIF(lower(btrim(t.utm_medium)), ''), '') AS med_k,
           COALESCE(NULLIF(btrim(t.partner_name), ''), CASE WHEN t.utm_medium = 'party_link' THEN NULL ELSE NULLIF(btrim(t.label), '') END) AS label,
           NULLIF(lower(btrim(t.utm_source)), '') AS net, NULLIF(lower(btrim(t.utm_medium)), '') AS med
      FROM public.tracked_links t
     WHERE NULLIF(btrim(t.utm_source), '') IS NOT NULL
       AND (t.event_id IN (SELECT DISTINCT event_id FROM raw WHERE event_id IS NOT NULL)
         OR (t.event_id IS NULL AND ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
                                  OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))))
     ORDER BY t.event_id, lower(btrim(t.utm_source)), COALESCE(NULLIF(lower(btrim(t.utm_medium)), ''), ''),
              t.archived_at IS NULL DESC, t.created_at DESC
  ),
  -- Le lien suivi d'où vient la visite : même soirée (ou la page), même utm_source / utm_medium.
  v AS MATERIALIZED (
    SELECT r0.*, tl.id AS link_id, tl.label AS link_label, tl.net AS link_net, tl.med AS link_med,
           public._tix_visit_family(r0.cat, tl.net, tl.med, tl.id IS NOT NULL, r0.us, r0.um, r0.landing) AS fam,
           CASE WHEN r0.cur AND v_mode <> 'event' THEN CASE v_mode
             WHEN 'hour' THEN floor(extract(epoch FROM r0.visited_at - v_start) / 3600)::int
             WHEN 'day' THEN public._crm_night_date(r0.visited_at, v_tz, v_eh) - v_d0
             ELSE ((extract(year FROM public._crm_night_date(r0.visited_at, v_tz, v_eh)) - extract(year FROM v_m0)) * 12
                   + extract(month FROM public._crm_night_date(r0.visited_at, v_tz, v_eh)) - extract(month FROM v_m0))::int END END AS ci
      FROM raw r0
      LEFT JOIN lmap tl ON r0.us IS NOT NULL AND tl.net_k = r0.us AND tl.med_k = COALESCE(r0.um, '')
                       AND tl.event_id IS NOT DISTINCT FROM r0.event_id
  ),
  c AS MATERIALIZED (SELECT * FROM v WHERE cur),
  p AS MATERIALIZED (SELECT * FROM v WHERE prev),
  -- Première visite d'une personne sur vos pages (soirées de la portée, page du club), 25 mois.
  firsts AS MATERIALIZED (
    SELECT COALESCE(s.visitor_id, s.session_id) AS visitor, min(s.visited_at) AS first_at
      FROM public.visitor_sessions s
     WHERE COALESCE(s.visitor_id, s.session_id) IN (SELECT visitor FROM v)
       AND s.visited_at > v_now - interval '25 months'
       AND (s.event_id = ANY (v_ids)
         OR (s.event_id IS NULL AND p_venue_id IS NOT NULL AND s.venue_id = p_venue_id AND s.entry_page_type = 'venue_page')
         OR (s.event_id IS NULL AND p_organizer_user_id IS NOT NULL AND s.organizer_user_id = p_organizer_user_id
             AND s.entry_page_type = 'organizer_profile'))
     GROUP BY 1
  ),
  tot AS (
    SELECT (SELECT count(*) FROM c) AS visits,
           (SELECT count(DISTINCT visitor) FROM c) AS visitors,
           (SELECT count(DISTINCT c.visitor) FROM c JOIN firsts f ON f.visitor = c.visitor
             WHERE CASE WHEN v_mode = 'event' THEN f.first_at >= (SELECT min(visited_at) FROM c) ELSE f.first_at >= v_from END) AS new_visitors,
           (SELECT count(DISTINCT visitor) FROM c WHERE ret) AS ret_visitors,
           (SELECT count(*) FROM c WHERE ret) AS ret_visits,
           (SELECT count(*) FROM c WHERE dur IS NOT NULL) AS measured,
           (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dur))::int FROM c WHERE dur IS NOT NULL) AS median_s,
           (SELECT round(avg(pages), 1) FROM c WHERE pages IS NOT NULL) AS pages,
           (SELECT count(*) FROM c WHERE done) AS orders,
           (SELECT count(*) FROM p) AS prev_visits,
           (SELECT count(DISTINCT visitor) FROM p) AS prev_visitors,
           (SELECT count(DISTINCT p.visitor) FROM p JOIN firsts f ON f.visitor = p.visitor
             WHERE CASE WHEN v_mode = 'event' THEN f.first_at >= (SELECT min(visited_at) FROM p) ELSE f.first_at >= v_pfrom END) AS prev_new,
           (SELECT count(*) FROM p WHERE dur IS NOT NULL) AS prev_measured,
           (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dur))::int FROM p WHERE dur IS NOT NULL) AS prev_median_s,
           (SELECT count(*) FROM p WHERE done) AS prev_orders
  ),
  -- ── Sources : la famille, puis le site, le lien ou la campagne ─────────
  kid AS (
    SELECT c.*,
           CASE WHEN c.link_id IS NOT NULL THEN 'l:' || c.link_id::text
                WHEN c.fam IN ('lk', 'ms') AND c.uc IS NOT NULL THEN 'c:' || c.uc
                WHEN c.fam IN ('lk', 'ms') AND c.us IS NOT NULL THEN 'u:' || c.us
                WHEN c.fam IN ('so', 'se', 'ot') AND c.domain IS NOT NULL AND c.domain <> 'yunoapp.eu' THEN 'd:' || c.domain
                WHEN c.fam IN ('so', 'se', 'ot') AND c.us IS NOT NULL THEN 'u:' || c.us END AS kkey,
           COALESCE(c.link_label, c.uc, CASE WHEN c.domain <> 'yunoapp.eu' THEN c.domain END, c.us) AS klabel
      FROM c
  ),
  fam_rows AS (
    SELECT fam, count(*) AS visits, count(DISTINCT visitor) AS visitors,
           count(*) FILTER (WHERE dur IS NOT NULL) AS measured,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dur) FILTER (WHERE dur IS NOT NULL))::int AS median_s,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY scroll) FILTER (WHERE scroll IS NOT NULL))::int AS median_scroll,
           count(*) FILTER (WHERE dur IS NOT NULL AND dur < 10) AS short,
           count(*) FILTER (WHERE done) AS orders
      FROM c GROUP BY fam
  ),
  kid_rows AS MATERIALIZED (
    SELECT fam, kkey, max(klabel) AS label, max(link_net) AS net, max(link_med) AS med,
           bool_or(link_id IS NOT NULL) AS is_link,
           count(*) AS visits, count(DISTINCT visitor) AS visitors,
           count(*) FILTER (WHERE dur IS NOT NULL) AS measured,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dur) FILTER (WHERE dur IS NOT NULL))::int AS median_s,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY scroll) FILTER (WHERE scroll IS NOT NULL))::int AS median_scroll,
           count(*) FILTER (WHERE done) AS orders,
           row_number() OVER (PARTITION BY fam ORDER BY count(*) DESC, kkey) AS rk
      FROM kid WHERE kkey IS NOT NULL GROUP BY fam, kkey
  ),
  prev_fam AS (SELECT fam, count(*) AS visits, count(*) FILTER (WHERE done) AS orders FROM p GROUP BY fam),
  -- ── Le tunnel de la page d'une soirée (une session = son étape la plus avancée) ──
  fn AS MATERIALIZED (
    SELECT f.session_id, f.step, f.pillar, f.ref_id, f.reason,
           CASE f.step WHEN 'viewed' THEN 1 WHEN 'selected' THEN 2 WHEN 'checkout' THEN 3
                       WHEN 'details' THEN 4 WHEN 'payment' THEN 4 WHEN 'purchased' THEN 5 END AS rk
      FROM public.event_funnel_events f
     WHERE CASE WHEN v_mode = 'event' THEN f.event_id = v_ev_id
                ELSE f.event_id = ANY (v_ids) AND f.created_at >= v_from AND f.created_at < v_to END
  ),
  fsess AS (
    SELECT session_id, COALESCE(max(rk), 1) AS rk, bool_or(step = 'failed') AS failed,
           bool_or(step = 'shared') AS shared, bool_or(step = 'waitlist') AS waitlist
      FROM fn GROUP BY session_id
  ),
  funnel AS (
    SELECT count(*) FILTER (WHERE rk >= 1) AS viewed, count(*) FILTER (WHERE rk >= 2) AS selected,
           count(*) FILTER (WHERE rk >= 3) AS checkout, count(*) FILTER (WHERE rk >= 4) AS details,
           count(*) FILTER (WHERE rk >= 5) AS purchased,
           count(*) FILTER (WHERE failed) AS failed, count(*) FILTER (WHERE failed AND rk < 5) AS failed_open,
           count(*) FILTER (WHERE shared) AS shared, count(*) FILTER (WHERE waitlist) AS waitlist
      FROM fsess
  ),
  fail_reasons AS (
    SELECT COALESCE(NULLIF(reason, ''), 'server') AS reason, count(DISTINCT session_id) AS n
      FROM fn WHERE step = 'failed' GROUP BY 1
  ),
  -- Le billet le plus choisi sans être payé (sessions qui n'ont pas acheté).
  unpaid AS (
    SELECT fn.pillar, fn.ref_id, count(DISTINCT fn.session_id) AS n
      FROM fn JOIN fsess s ON s.session_id = fn.session_id AND s.rk < 5
     WHERE fn.step = 'selected' AND fn.pillar IN ('tickets', 'tables') AND fn.ref_id IS NOT NULL
     GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 1
  ),
  -- ── Les soirées de la période ───────────────────────────────────────────
  nights AS (
    SELECT c.event_id, count(*) AS visits, count(DISTINCT c.visitor) AS visitors,
           count(*) FILTER (WHERE c.dur IS NOT NULL) AS measured,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY c.dur) FILTER (WHERE c.dur IS NOT NULL))::int AS median_s,
           count(*) FILTER (WHERE c.done) AS orders
      FROM c WHERE c.event_id IS NOT NULL AND v_mode <> 'event' GROUP BY 1 ORDER BY 2 DESC LIMIT 12
  ),
  -- ── La page du club / de l'organisateur (règle de tix_ana_traffic_detail) ──
  pg AS (
    SELECT v.*, (v.done OR EXISTS (
             SELECT 1 FROM public.visitor_sessions b
              WHERE b.visitor_id = v.visitor AND COALESCE(b.completed_order, false)
                AND b.event_id = ANY (v_ids)
                AND b.visited_at >= v.visited_at AND b.visited_at < v.visited_at + interval '24 hours')) AS ordered
      FROM v WHERE v.page AND v_mode <> 'event'
  ),
  -- ── Les liens suivis : clics, personnes, téléphone, commandes ──────────
  lk AS MATERIALIZED (
    SELECT t.id, t.event_id, t.created_at,
           COALESCE(NULLIF(btrim(t.partner_name), ''), CASE WHEN t.utm_medium = 'party_link' THEN NULL ELSE NULLIF(btrim(t.label), '') END) AS label,
           NULLIF(lower(btrim(t.utm_source)), '') AS net, NULLIF(lower(btrim(t.utm_medium)), '') AS med,
           t.target_kind
      FROM public.tracked_links t
     WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
       AND CASE WHEN v_mode = 'event' THEN t.event_id = v_ev_id
                ELSE t.event_id = ANY (v_ids) OR t.event_id IS NULL END
  ),
  clk AS (
    SELECT k.tracked_link_id AS id, count(*) AS clicks,
           count(DISTINCT COALESCE(k.visitor_id, k.ip_hash, k.id::text)) AS people,
           count(*) FILTER (WHERE k.device_type = 'mobile') AS mobile,
           count(*) FILTER (WHERE k.device_type IS NOT NULL) AS dev_known
      FROM public.tracked_link_clicks k
     WHERE k.tracked_link_id IN (SELECT id FROM lk)
       AND (v_mode = 'event' OR (k.clicked_at >= v_from AND k.clicked_at < v_to))
     GROUP BY 1
  ),
  lsales AS (
    SELECT x.link_id AS id, count(*) AS orders FROM (
      SELECT t.tracked_link_id AS link_id, COALESCE(t.paid_at, t.created_at) AS at
        FROM public.tickets t WHERE t.tracked_link_id IN (SELECT id FROM lk) AND t.status IN ('paid', 'used')
      UNION ALL
      SELECT r.tracked_link_id, COALESCE(r.paid_at, r.created_at)
        FROM public.table_reservations r WHERE r.tracked_link_id IN (SELECT id FROM lk) AND r.status IN ('paid', 'confirmed')
    ) x WHERE v_mode = 'event' OR (x.at >= v_from AND x.at < v_to) GROUP BY 1
  ),
  lvis AS (
    SELECT link_id AS id, count(*) AS visits,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dur) FILTER (WHERE dur IS NOT NULL))::int AS median_s,
           count(*) FILTER (WHERE dur IS NOT NULL) AS measured
      FROM c WHERE link_id IS NOT NULL GROUP BY 1
  ),
  links AS (
    SELECT lk.*, e.title AS event_title, e.start_at AS event_start,
           COALESCE(k.clicks, 0) AS clicks, COALESCE(k.people, 0) AS people,
           COALESCE(k.mobile, 0) AS mobile, COALESCE(k.dev_known, 0) AS dev_known,
           COALESCE(s.orders, 0) AS orders, COALESCE(vv.visits, 0) AS visits, vv.median_s, COALESCE(vv.measured, 0) AS measured
      FROM lk
      LEFT JOIN public.events e ON e.id = lk.event_id
      LEFT JOIN clk k ON k.id = lk.id
      LEFT JOIN lsales s ON s.id = lk.id
      LEFT JOIN lvis vv ON vv.id = lk.id
     WHERE COALESCE(k.clicks, 0) > 0 OR COALESCE(s.orders, 0) > 0
     ORDER BY COALESCE(k.clicks, 0) DESC, COALESCE(s.orders, 0) DESC LIMIT 12
  ),
  -- ── Le pont vers Ventes : les commandes nées de ces visites, et le CA club
  -- des ventes Yuno de la période (ou de la soirée), le chiffre du héros de
  -- Ventes (règle de fees.ts / _tix_sales, remboursement déduit ; rien pour une
  -- soirée qu'un club ne fait qu'accueillir).
  bridge AS (
    SELECT (SELECT count(*) FROM c WHERE c.done) AS orders,
           COALESCE(sum(CASE WHEN se.money THEN x.gross - LEAST(GREATEST(x.refund, 0), x.gross) ELSE 0 END), 0) AS revenue
      FROM (
        SELECT t.event_id, COALESCE(t.paid_at, t.created_at) AS at,
               GREATEST(COALESCE(t.total_price, 0) - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0) AS gross,
               COALESCE(t.refund_amount, 0) AS refund
          FROM public.tickets t WHERE t.event_id = ANY (v_ids) AND t.status IN ('paid', 'used')
        UNION ALL
        SELECT r.event_id, COALESCE(r.paid_at, r.created_at),
               GREATEST(COALESCE(r.total_price, 0) - COALESCE(r.service_fee, 0)
                 - CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END, 0),
               COALESCE(r.refund_amount, 0)
          FROM public.table_reservations r WHERE r.event_id = ANY (v_ids) AND r.status IN ('paid', 'confirmed')
      ) x
      JOIN public._tix_scope_events(p_venue_id, p_organizer_user_id) se ON se.id = x.event_id
     WHERE CASE WHEN v_mode = 'event' THEN x.event_id = v_ev_id ELSE x.at >= v_from AND x.at < v_to END
  ),
  -- ── Une soirée : distance au club, artistes, déjà venus ────────────────
  dist AS (
    SELECT count(*) AS known,
           count(*) FILTER (WHERE km < 30) AS near, count(*) FILTER (WHERE km >= 30 AND km < 150) AS mid,
           count(*) FILTER (WHERE km >= 150) AS far
      FROM (SELECT 6371 * 2 * asin(sqrt(power(sin(radians(c.lat - v_lat) / 2), 2)
                     + cos(radians(v_lat)) * cos(radians(c.lat)) * power(sin(radians(c.lon - v_lon) / 2), 2))) AS km
              FROM c WHERE v_mode = 'event' AND v_lat IS NOT NULL AND c.lat IS NOT NULL AND c.lon IS NOT NULL) x
  ),
  artists AS (
    SELECT a.id, a.name, a.photo_url, count(k.id) AS clicks
      FROM public.guest_artist_link_clicks k
      JOIN public.event_guest_artists a ON a.id = k.artist_id
     WHERE CASE WHEN v_mode = 'event' THEN k.event_id = v_ev_id
                ELSE k.event_id = ANY (v_ids) AND k.clicked_at >= v_from AND k.clicked_at < v_to END
     GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 8
  ),
  connected AS (
    SELECT DISTINCT c.user_id, min(c.visited_at) AS at FROM c WHERE c.user_id IS NOT NULL AND v_mode = 'event' GROUP BY 1
  ),
  known_before AS (
    SELECT count(*) AS connected,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.tickets t JOIN public.events e ON e.id = t.event_id
              WHERE t.user_id = cn.user_id AND t.status IN ('paid', 'used') AND e.id = ANY (v_ids)
                AND e.id <> v_ev_id AND e.start_at < cn.at)
             OR EXISTS (
             SELECT 1 FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
              WHERE r.user_id = cn.user_id AND r.status IN ('paid', 'confirmed') AND e.id = ANY (v_ids)
                AND e.id <> v_ev_id AND e.start_at < cn.at)) AS came
      FROM connected cn
  )
  SELECT jsonb_build_object(
    'meta', m,
    'totals', (SELECT to_jsonb(tot) FROM tot),
    'series', CASE WHEN v_mode <> 'event' THEN (
      SELECT jsonb_agg(jsonb_build_object('v', COALESCE(a.v, '{}'::jsonb), 'u', COALESCE(a.u, '{}'::jsonb), 'visitors', COALESCE(b.u, 0)) ORDER BY g)
        FROM generate_series(0, v_n - 1) g
        LEFT JOIN (SELECT ci, jsonb_object_agg(fam, n) AS v, jsonb_object_agg(fam, u) AS u
                     FROM (SELECT ci, fam, count(*) AS n, count(DISTINCT visitor) AS u FROM c WHERE ci IS NOT NULL GROUP BY 1, 2) x
                    GROUP BY ci) a ON a.ci = g
        LEFT JOIN (SELECT ci, count(DISTINCT visitor) AS u FROM c WHERE ci IS NOT NULL GROUP BY 1) b ON b.ci = g) END,
    'curve', CASE WHEN v_mode = 'event' THEN jsonb_build_object(
      'cur', (SELECT jsonb_agg(CASE WHEN v_left > 0 AND (v_D - g) < v_left THEN NULL
                                    ELSE (SELECT count(*) FROM c WHERE c.d >= v_D - g) END ORDER BY g)
                FROM generate_series(0, v_D) g),
      'prev', CASE WHEN v_cev_id IS NOT NULL THEN (
                SELECT jsonb_agg((SELECT count(*) FROM v WHERE v.event_id = v_cev_id AND v.d >= v_D - g) ORDER BY g)
                  FROM generate_series(0, v_D) g) END) END,
    'sources', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'k', f.fam, 'visits', f.visits, 'visitors', f.visitors, 'measured', f.measured,
               'median_s', f.median_s, 'median_scroll', f.median_scroll, 'short', f.short, 'orders', f.orders,
               'prev_visits', COALESCE(pf.visits, 0), 'prev_orders', COALESCE(pf.orders, 0),
               'kids', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                          'key', k.kkey, 'label', k.label, 'link', k.is_link, 'net', k.net, 'med', k.med,
                          'visits', k.visits, 'visitors', k.visitors, 'measured', k.measured,
                          'median_s', k.median_s, 'median_scroll', k.median_scroll, 'orders', k.orders) ORDER BY k.visits DESC)
                          FROM kid_rows k WHERE k.fam = f.fam AND k.rk <= 8), '[]'::jsonb)) ORDER BY f.visits DESC)
        FROM fam_rows f LEFT JOIN prev_fam pf ON pf.fam = f.fam), '[]'::jsonb),
    'engagement', jsonb_build_object(
      'measured', (SELECT count(*) FROM c WHERE dur IS NOT NULL),
      'dur', (SELECT jsonb_build_array(
                count(*) FILTER (WHERE dur < 10), count(*) FILTER (WHERE dur >= 10 AND dur < 60),
                count(*) FILTER (WHERE dur >= 60 AND dur < 180), count(*) FILTER (WHERE dur >= 180 AND dur < 600),
                count(*) FILTER (WHERE dur >= 600)) FROM c WHERE dur IS NOT NULL),
      'scroll', (SELECT jsonb_build_array(
                count(*), count(*) FILTER (WHERE scroll >= 25), count(*) FILTER (WHERE scroll >= 50),
                count(*) FILTER (WHERE scroll >= 75), count(*) FILTER (WHERE scroll >= 90)) FROM c WHERE dur IS NOT NULL),
      'artist_clicks', (SELECT COALESCE(sum(clicks), 0) FROM artists),
      'shares', (SELECT shared FROM funnel)),
    'funnel', (SELECT jsonb_build_object(
        'viewed', viewed, 'selected', selected, 'checkout', checkout, 'details', details, 'purchased', purchased,
        'failed', failed, 'failed_open', failed_open, 'shared', shared, 'waitlist', waitlist,
        'reasons', COALESCE((SELECT jsonb_agg(jsonb_build_object('reason', reason, 'n', n) ORDER BY n DESC) FROM fail_reasons), '[]'::jsonb),
        'unpaid', (SELECT jsonb_build_object('pillar', u.pillar, 'n', u.n,
                     'name', COALESCE((SELECT tr.name FROM public.ticket_rounds tr WHERE u.pillar = 'tickets' AND tr.id::text = u.ref_id),
                                      (SELECT tp.name FROM public.table_packs tp WHERE u.pillar = 'tables' AND tp.id::text = u.ref_id)))
                     FROM unpaid u))
      FROM funnel),
    'heat', (SELECT jsonb_agg(row_j ORDER BY dd) FROM (
        SELECT dd, jsonb_agg(COALESCE(h.n, 0) ORDER BY hh) AS row_j
          FROM generate_series(0, 6) dd CROSS JOIN generate_series(0, 23) hh
          LEFT JOIN (SELECT (extract(isodow FROM visited_at AT TIME ZONE v_tz)::int - 1) AS d,
                            extract(hour FROM visited_at AT TIME ZONE v_tz)::int AS h, count(*) AS n
                       FROM c GROUP BY 1, 2) h ON h.d = dd AND h.h = hh
         GROUP BY dd) x),
    'devices', (SELECT jsonb_build_object(
        'mobile', count(*) FILTER (WHERE device = 'mobile'), 'desktop', count(*) FILTER (WHERE device = 'desktop'),
        'tablet', count(*) FILTER (WHERE device = 'tablet'), 'unknown', count(*) FILTER (WHERE device NOT IN ('mobile', 'desktop', 'tablet')))
      FROM c),
    'in_app', (SELECT jsonb_build_object(
        'instagram', count(*) FILTER (WHERE inapp = 'instagram'), 'facebook', count(*) FILTER (WHERE inapp = 'facebook'),
        'tiktok', count(*) FILTER (WHERE inapp = 'tiktok'),
        'visits', count(*) FILTER (WHERE inapp IS NOT NULL), 'orders', count(*) FILTER (WHERE inapp IS NOT NULL AND done),
        'other_visits', count(*) FILTER (WHERE inapp IS NULL), 'other_orders', count(*) FILTER (WHERE inapp IS NULL AND done))
      FROM c),
    'langs', jsonb_build_object(
      'known', (SELECT count(*) FROM c WHERE lang IS NOT NULL),
      'top', COALESCE((SELECT jsonb_agg(jsonb_build_object('l', lang, 'n', n) ORDER BY n DESC)
                         FROM (SELECT lang, count(*) AS n FROM c WHERE lang IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 4) x), '[]'::jsonb)),
    'cities', jsonb_build_object(
      'known', (SELECT count(*) FROM c WHERE cc IS NOT NULL),
      'france', (SELECT count(*) FROM c WHERE cc = 'FR'),
      'top', COALESCE((SELECT jsonb_agg(jsonb_build_object('city', city, 'n', n) ORDER BY n DESC)
                         FROM (SELECT city, count(*) AS n FROM c WHERE cc = 'FR' AND city IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 6) x), '[]'::jsonb),
      'abroad', COALESCE((SELECT jsonb_agg(jsonb_build_object('cc', cc, 'n', n) ORDER BY n DESC)
                            FROM (SELECT cc, count(*) AS n FROM c WHERE cc IS NOT NULL AND cc <> 'FR' GROUP BY 1 ORDER BY 2 DESC LIMIT 6) x), '[]'::jsonb)),
    'nights', CASE WHEN v_mode <> 'event' THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', e.id, 'title', e.title, 'start_at', e.start_at, 'upcoming', COALESCE(e.end_at, e.start_at + interval '6 hours') > v_now,
               'state', CASE WHEN COALESCE(e.end_at, e.start_at + interval '6 hours') <= v_now THEN 'past'
                             WHEN public._crm_night_date(e.start_at, v_tz, v_eh) = v_today THEN 'tonight' ELSE 'presale' END,
               'visits', n.visits, 'visitors', n.visitors, 'measured', n.measured, 'median_s', n.median_s, 'orders', n.orders) ORDER BY n.visits DESC)
        FROM nights n JOIN public.events e ON e.id = n.event_id), '[]'::jsonb) END,
    'page', CASE WHEN v_mode <> 'event' THEN jsonb_build_object(
      'kind', CASE WHEN p_venue_id IS NOT NULL THEN 'venue' ELSE 'organizer' END,
      'visits', (SELECT count(*) FROM pg WHERE cur), 'prev_visits', (SELECT count(*) FROM pg WHERE prev),
      'visitors', (SELECT count(DISTINCT visitor) FROM pg WHERE cur),
      'returning', (SELECT count(*) FROM pg WHERE cur AND ret),
      'ordered', (SELECT count(*) FROM pg WHERE cur AND ordered),
      'series', (SELECT jsonb_agg(COALESCE(b.n, 0) ORDER BY g) FROM generate_series(0, v_n - 1) g
                   LEFT JOIN (SELECT ci, count(*) AS n FROM pg WHERE cur GROUP BY 1) b ON b.ci = g),
      'sources', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', x.cat, 'visits', x.n, 'ordered', x.o) ORDER BY x.n DESC)
                             FROM (SELECT cat, count(*) AS n, count(*) FILTER (WHERE ordered) AS o FROM pg WHERE cur GROUP BY 1) x), '[]'::jsonb)) END,
    'links', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', l.id, 'label', l.label, 'net', l.net, 'med', l.med, 'target', l.target_kind,
        'event_id', l.event_id, 'event_title', l.event_title, 'event_start', l.event_start, 'created_at', l.created_at,
        'clicks', l.clicks, 'people', l.people, 'mobile', l.mobile, 'dev_known', l.dev_known, 'orders', l.orders,
        'visits', l.visits, 'measured', l.measured, 'median_s', l.median_s)) FROM links l), '[]'::jsonb),
    'hours', CASE WHEN v_mode = 'event' THEN (
      SELECT jsonb_agg(COALESCE(h.n, 0) ORDER BY hh) FROM generate_series(0, 23) hh
        LEFT JOIN (SELECT extract(hour FROM visited_at AT TIME ZONE v_tz)::int AS h, count(*) AS n FROM c GROUP BY 1) h ON h.h = hh) END,
    'distance', CASE WHEN v_mode = 'event' AND v_lat IS NOT NULL THEN (SELECT to_jsonb(dist) FROM dist) END,
    'artists', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'photo', a.photo_url, 'clicks', a.clicks) ORDER BY a.clicks DESC) FROM artists a), '[]'::jsonb),
    'known_before', CASE WHEN v_mode = 'event' THEN (SELECT to_jsonb(known_before) FROM known_before) END,
    'bridge', (SELECT jsonb_build_object('orders', orders, 'revenue', round(revenue, 2)) FROM bridge),
    -- Repères du graphique : e-mails, SMS et push envoyés (règle de l'onglet Ventes).
    'sends', CASE WHEN v_mode <> 'event' THEN public._tix_ana_sends(p_venue_id, p_organizer_user_id, m) ELSE '[]'::jsonb END
  ) INTO r;

  -- ── À retenir : des constats, chacun avec son seuil (textes ya.tr.tk.*) ──
  IF v_mode <> 'event' AND (r->'totals'->>'visits')::int >= 30 THEN
    WITH s AS (
      SELECT x->>'k' AS k, (x->>'visits')::int AS visits, (x->>'orders')::int AS orders,
             (x->>'measured')::int AS measured, (x->>'short')::int AS short
        FROM jsonb_array_elements(r->'sources') x
    ), t AS (SELECT (r->'totals'->>'visits')::numeric AS visits), top AS (
      SELECT s.* FROM s ORDER BY visits DESC LIMIT 1
    ), best AS (
      SELECT s.* FROM s, top, t
       WHERE s.k <> top.k AND s.visits >= 30 AND s.visits >= 0.05 * t.visits AND top.visits >= 30 AND top.orders > 0
         AND s.orders::numeric / s.visits >= 1.3 * top.orders::numeric / top.visits
       ORDER BY s.orders::numeric / s.visits DESC LIMIT 1
    )
    SELECT jsonb_agg(z) INTO v_keep FROM (
      SELECT jsonb_build_object('k', 'top', 'fam', top.k, 'pct', round(100 * top.visits / t.visits)) AS z
        FROM top, t WHERE top.visits / t.visits >= 0.25
      UNION ALL
      SELECT jsonb_build_object('k', 'best_conv', 'fam', best.k, 'top', top.k,
               'pct', round(100 * best.visits / t.visits),
               'conv', round(100.0 * best.orders / best.visits, 1), 'top_conv', round(100.0 * top.orders / top.visits, 1),
               'ratio', round((best.orders::numeric / best.visits) / (top.orders::numeric / top.visits), 1))
        FROM best, top, t
      UNION ALL
      SELECT jsonb_build_object('k', 'short', 'pct', round(100.0 * e.short / e.measured),
               'fams', (SELECT jsonb_agg(k ORDER BY sh DESC) FROM (
                          SELECT k, short::numeric / measured AS sh FROM s WHERE measured >= 10 ORDER BY 2 DESC LIMIT 2) q))
        FROM (SELECT sum(short) AS short, sum(measured) AS measured FROM s) e
       WHERE e.measured >= 30 AND e.short::numeric / e.measured >= 0.2
    ) q;
  END IF;

  RETURN r || jsonb_build_object('keep', COALESCE(v_keep, '[]'::jsonb), 'has_any', (r->'totals'->>'visits')::int > 0 OR (r->'totals'->>'prev_visits')::int > 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.tix_ana_visits(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_period text DEFAULT '30d',
  p_event uuid DEFAULT NULL, p_compare uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._tix_money_gate(public.tix_ana_visits__core(p_venue_id, p_organizer_user_id, p_period, p_event, p_compare), p_venue_id, p_organizer_user_id);
$$;

REVOKE ALL ON FUNCTION public._tix_visit_family(text, text, text, boolean, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._tix_ref_domain(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tix_ana_visits__core(text, uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tix_ana_visits(text, uuid, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tix_ana_visits(text, uuid, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public._tix_visit_family(text, text, text, boolean, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public._tix_ref_domain(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.tix_ana_visits__core(text, uuid, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.tix_ana_visits(text, uuid, text, uuid, uuid) TO service_role;
