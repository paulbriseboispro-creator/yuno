-- ============================================================================
-- CRM guest list : pas de pourcentage sous 10 personnes (règle MIN_SAMPLE de Yuno).
--
-- Vu sur la démo le 06/10 : « Presse & partenaires », 6 invités, affichait
-- « 50 % de venue ». Sous 10, un taux n'informe personne : taux de venue (soirée,
-- liste, période, soirée d'avant, payants) et part des entrées gratuites rendent
-- désormais NULL ; l'écran montre les nombres bruts (« 3 / 6 ») à la place. Les
-- autres pourcentages de ces deux fonctions (devenus clients, âge, genre, heures
-- médianes) avaient déjà leur seuil.
--
-- Corps repris de la base liée (pg_get_functiondef), seuls ces seuils changent.
-- ============================================================================

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
           COALESCE(bool_or(public._crm_ticket_is_sale(t.status, t.raw) AND COALESCE(t.price, 0) > 0
                   AND COALESCE(t.purchased_at, t.first_seen_at) < e.start_at
                   AND t.event_id IS DISTINCT FROM p_event_id), false) AS paid_before,
           -- Déjà vu = une place (achat ou guest list) pour une soirée d'avant, OU un
           -- billet payant acheté avant celle-ci, même pour une soirée plus tardive :
           -- « Première fois », « Déjà venus en guest list » et « Clients payants »
           -- forment ainsi une partition exacte des invités.
           COALESCE(bool_or(t.event_id IS DISTINCT FROM p_event_id
                   AND ((ev.start_at < e.start_at
                         AND (public._crm_ticket_is_sale(t.status, t.raw)
                              OR public._crm_ticket_gl_kind(t.status, t.price, t.raw) IS NOT NULL))
                     OR (public._crm_ticket_is_sale(t.status, t.raw) AND COALESCE(t.price, 0) > 0
                         AND COALESCE(t.purchased_at, t.first_seen_at) < e.start_at))), false) AS seen_before,
           min(COALESCE(t.purchased_at, t.first_seen_at)) FILTER (
             WHERE public._crm_ticket_is_sale(t.status, t.raw) AND COALESCE(t.price, 0) > 0
               AND COALESCE(t.purchased_at, t.first_seen_at) > e.start_at
               AND t.event_id IS DISTINCT FROM p_event_id) AS paid_after_at,
           COALESCE(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)) FILTER (
             WHERE public._crm_ticket_is_sale(t.status, t.raw) AND COALESCE(t.price, 0) > 0
               AND COALESCE(t.purchased_at, t.first_seen_at) > e.start_at
               AND t.event_id IS DISTINCT FROM p_event_id), 0) AS paid_after,
           COALESCE(bool_or(ev.start_at > e.start_at
                   AND (public._crm_ticket_is_sale(t.status, t.raw)
                        OR public._crm_ticket_gl_kind(t.status, t.price, t.raw) IS NOT NULL)), false) AS later
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
        'showup', CASE WHEN v_known AND t.entries >= 10 THEN round(100.0 * t.came / t.entries, 1) END,
        'paid_showup', CASE WHEN v_known AND t.paid >= 10 THEN round(100.0 * t.paid_came / t.paid, 1) END,
        'free_share', CASE WHEN (v_known OR (v_phase = 'live' AND t.scanned > 0)) AND t.came + t.paid_came >= 10
                           THEN round(100.0 * t.came / (t.came + t.paid_came), 1) END)
        FROM tot t),
    'prev', CASE WHEN p.id IS NOT NULL THEN (
        SELECT jsonb_build_object('id', p.id, 'title', p.title, 'start_at', p.start_at, 'same_series', p.same_series,
                 'entries', count(*), 'came', count(*) FILTER (WHERE pv.scanned_at IS NOT NULL),
                 'same_day', count(*) FILTER (WHERE pv.d >= v_d_end),
                 'showup', CASE WHEN public._crm_event_scan_known(p.id) AND count(*) >= 10
                                THEN round(100.0 * count(*) FILTER (WHERE pv.scanned_at IS NOT NULL) / count(*), 1) END)
          FROM pv) END,
    'curve', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'd', s.d,
                'v', (SELECT count(*) FROM gl WHERE gl.d >= s.d),
                'pv', CASE WHEN p.id IS NOT NULL THEN (SELECT count(*) FROM pv WHERE pv.d >= s.d) END) ORDER BY s.d DESC), '[]'::jsonb)
                FROM generate_series(v_d_end, GREATEST(v_d_end, v_d_start)) AS s(d)),
    'lists', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'name', NULLIF(l.name, ''), 'kind', l.kind, 'entries', l.entries, 'came', l.came,
                'showup', CASE WHEN v_known AND l.entries >= 10 THEN round(100.0 * l.came / l.entries, 1) END,
                'first', l.first, 'conv', CASE WHEN v_phase = 'past' THEN l.conv END)
                ORDER BY l.entries DESC, l.name), '[]'::jsonb) FROM lists l),
    'who', (SELECT jsonb_build_object(
              'first', count(*) FILTER (WHERE NOT a.seen_before),
              'gl', count(*) FILTER (WHERE a.seen_before AND NOT a.paid_before),
              'buyers', count(*) FILTER (WHERE a.seen_before AND a.paid_before))
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
        'showup', CASE WHEN c.k_entries >= 10 THEN round(100.0 * c.k_came / c.k_entries, 1) END,
        'free_share', CASE WHEN c.k_came + c.k_paid_came >= 10 THEN round(100.0 * c.k_came / (c.k_came + c.k_paid_came), 1) END,
        'prev_nights', COALESCE(pr.nights, 0),
        'prev_entries', COALESCE(pr.entries, 0),
        'prev_people', COALESCE((SELECT people FROM wpeople WHERE w = 'prev'), 0),
        'prev_showup', CASE WHEN pr.k_entries >= 10 THEN round(100.0 * pr.k_came / pr.k_entries, 1) END,
        'prev_free_share', CASE WHEN pr.k_came + pr.k_paid_came >= 10 THEN round(100.0 * pr.k_came / (pr.k_came + pr.k_paid_came), 1) END)
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
        'showup', CASE WHEN z.known AND z.entries >= 10 THEN round(100.0 * z.came / z.entries, 1) END) ORDER BY z.start_at), '[]'::jsonb)
        FROM (SELECT * FROM ev2 WHERE w = 'cur' ORDER BY start_at DESC LIMIT 40) z),
    'lists', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', NULLIF(l.name, ''), 'kind', l.kind, 'nights', l.nights, 'entries', l.entries,
        'showup', CASE WHEN l.k_entries >= 10 THEN round(100.0 * l.k_came / l.k_entries, 1) END,
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


REVOKE ALL ON FUNCTION public.crm_night_guestlist__core(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_night_guestlist__core(text, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.crm_ana_guestlist__core(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_ana_guestlist__core(text, uuid, text) TO service_role;
