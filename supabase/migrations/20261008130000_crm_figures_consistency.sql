-- ============================================================================
-- Yuno CRM : mêmes chiffres partout, avant le premier client réel (WOH).
--
-- Audit du 05/10 (chaque chiffre de la Console contre le SQL brut) :
--  1. Une soirée de la Console CRM est une soirée de la billetterie connectée
--     (miroir, external_source). L'Accueil (prochaine soirée, soirée de
--     comparaison), « ce soir » des Clients et la liste des soirées des filtres
--     prenaient aussi les soirées Yuno actives, alors que tous leurs chiffres
--     viennent de external_tickets : sur un compte Billetterie + CRM, la
--     prochaine soirée était une soirée Yuno à 0 vendu, et son volet répondait
--     not_found. Aucun changement pour un compte CRM pur.
--  2. Cycle de vie (_crm_people_build) : quelqu'un qui a acheté pour une soirée
--     à venir sans en avoir encore fait est un NOUVEAU client, plus un « contact
--     connu (import, inscription) » ; un ancien client qui a repris une place
--     n'a pas « décroché ». Avant, « Qui vient » perdait ces acheteurs.
--  3. Volet d'une soirée : habitué / occasionnel par la règle de l'espace
--     (crm_scope_rules, cette soirée comprise), comme l'Accueil — il comptait
--     « 3 soirées depuis toujours ». L'Accueil compare à la soirée précédente de
--     la MÊME série d'abord, comme le volet.
--  4. Bilan du dernier envoi (Accueil) : acheteurs et CA par la même règle que
--     Résultats, Parcours et Segments (_crm_email_attrib), plus par « premier
--     clic + 72 h ». Résultats rend aussi `buyers` (personnes distinctes) pour
--     l'étape « Ont acheté » de son entonnoir, qui affichait des billets.
--  5. Accueil : index sur la table temporaire des billets (_ht) — les
--     recherches par acheteur, par soirée et par jour la relisaient en entier.
--  6. Un billet `deal_channel = 'duplicata'` (copie d'un billet déjà vendu,
--     valeur documentée de l'API Shotgun) n'est ni une vente ni une entrée de
--     guest list.
--  7. Imports : un acheteur Shotgun « nouveau » est absent de la base AVANT le
--     jour de la synchro (registre ou fichier importé), plus seulement « jamais
--     vu par Shotgun » — au premier import, toute la base importée passait
--     pour nouvelle.
--
-- Corps repris de la base liée (pg_get_functiondef, 06/10, après la migration
-- guest list 20261008100000) ; seuls les points ci-dessus changent. Aucune
-- signature ne change : pas de rechargement du cache de l'API REST.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.crm_home__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_tz text := 'Europe/Paris';
  v_now timestamptz := now();
  v_hourly boolean := p_period IN ('24h', '48h');
  v_n integer := CASE p_period WHEN '24h' THEN 24 WHEN '48h' THEN 48 WHEN '7d' THEN 7 WHEN '90d' THEN 90 ELSE 30 END;
  v_step interval;
  v_end timestamptz;
  v_start timestamptz;
  v_pstart timestamptz;
  v_rules record;
  cfg jsonb := public.crm_pricing_config();
  v_series jsonb;
  v_sends jsonb;
  v_tot numeric; v_ptot numeric; v_tickets integer; v_ptickets integer;
  v_clients jsonb;
  v_regulars jsonb;
  v_conv jsonb;
  v_reach jsonb;
  v_mission jsonb;
  v_next jsonb;
  v_todo jsonb := '[]'::jsonb;
  v_conn record;
  v_has_conn boolean;
  v_ev record;
  v_prev record;
  v_balance integer;
  v_reserved integer;
  v_n_contacts integer;
  v_today_start timestamptz := date_trunc('day', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris';
  v_relaunch integer;
  v_unreach integer;
  v_row record;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);

  SELECT c.* INTO v_conn FROM public.ticketing_connections c
   WHERE (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
      OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id)
   ORDER BY c.created_at LIMIT 1;
  v_has_conn := FOUND;

  -- ── Ventes par heure / par jour ──────────────────────────────────────────
  IF v_hourly THEN
    v_step := interval '1 hour';
    v_end := date_trunc('hour', v_now) + interval '1 hour';
  ELSE
    v_step := interval '1 day';
    v_end := (date_trunc('day', v_now AT TIME ZONE v_tz) + interval '1 day') AT TIME ZONE v_tz;
  END IF;
  v_start := v_end - v_n * v_step;
  v_pstart := v_start - v_n * v_step;

  DROP TABLE IF EXISTS _ht;
  CREATE TEMP TABLE _ht ON COMMIT DROP AS SELECT * FROM public._crm_tickets(p_venue_id, p_organizer_user_id);
  -- Les recherches par personne, par soirée et par période plus bas passent
  -- par un index : sans lui, chaque acheteur relisait tous les billets.
  CREATE INDEX ON _ht (email);
  CREATE INDEX ON _ht (event_id);
  CREATE INDEX ON _ht (bought_at);
  ANALYZE _ht;

  WITH b AS (
    SELECT g AS i,
           CASE WHEN v_hourly THEN v_start + g * v_step
                ELSE ((v_start AT TIME ZONE v_tz) + g * v_step) AT TIME ZONE v_tz END AS s,
           CASE WHEN v_hourly THEN v_start + (g + 1) * v_step
                ELSE ((v_start AT TIME ZONE v_tz) + (g + 1) * v_step) AT TIME ZONE v_tz END AS e
      FROM generate_series(0, v_n - 1) g
  ), pb AS (
    SELECT i, s - v_n * v_step AS s, e - v_n * v_step AS e FROM b
  )
  SELECT jsonb_agg(jsonb_build_object(
           't', b.s,
           'cur', COALESCE((SELECT round(sum(x.amount), 2) FROM _ht x WHERE x.bought_at >= b.s AND x.bought_at < b.e), 0),
           'prev', COALESCE((SELECT round(sum(x.amount), 2) FROM _ht x WHERE x.bought_at >= pb.s AND x.bought_at < pb.e), 0),
           'tickets', COALESCE((SELECT sum(x.qty) FROM _ht x WHERE x.bought_at >= b.s AND x.bought_at < b.e), 0)
         ) ORDER BY b.i)
    INTO v_series
    FROM b JOIN pb ON pb.i = b.i;

  SELECT COALESCE(round(sum(amount) FILTER (WHERE bought_at >= v_start AND bought_at < v_end), 2), 0),
         COALESCE(round(sum(amount) FILTER (WHERE bought_at >= v_pstart AND bought_at < v_start), 2), 0),
         COALESCE(sum(qty) FILTER (WHERE bought_at >= v_start AND bought_at < v_end), 0),
         COALESCE(sum(qty) FILTER (WHERE bought_at >= v_pstart AND bought_at < v_start), 0)
    INTO v_tot, v_ptot, v_tickets, v_ptickets
    FROM _ht;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at'), '[]'::jsonb) INTO v_sends FROM (
    SELECT jsonb_build_object('at', c.sent_at, 'name', c.name, 'channel', 'email', 'id', c.id) AS x
      FROM public.email_campaigns c
     WHERE c.sent_at >= v_start AND c.sent_at < v_end AND c.status IN ('sent', 'sending')
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND c.automation_id IS NULL
    UNION ALL
    SELECT jsonb_build_object('at', s.sent_at, 'name', s.name, 'channel', 'sms', 'id', s.id)
      FROM public.sms_campaigns s
     WHERE s.sent_at >= v_start AND s.sent_at < v_end AND s.status IN ('sent', 'sending')
       AND s.venue_id IS NOT DISTINCT FROM p_venue_id AND s.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
  ) q;

  -- ── Base vivante : clients et joignables ─────────────────────────────────
  v_n_contacts := public.contact_build_rows(p_venue_id, p_organizer_user_id);

  SELECT jsonb_build_object(
           'total', count(*),
           'today', count(*) FILTER (WHERE COALESCE(added_at, created_at) >= v_today_start),
           'spark', (SELECT jsonb_agg(c ORDER BY d) FROM (
              SELECT d, (SELECT count(*) FROM _cr x
                          WHERE COALESCE(x.added_at, x.created_at) < ((date_trunc('day', v_now AT TIME ZONE v_tz) - (13 - d) * interval '1 day' + interval '1 day') AT TIME ZONE v_tz)) AS c
                FROM generate_series(0, 13) d) s)
         ),
         jsonb_build_object(
           'total', count(*),
           'reachable', count(*) FILTER (WHERE email_ok OR phone_ok),
           'both', count(*) FILTER (WHERE email_ok AND phone_ok),
           'email_only', count(*) FILTER (WHERE email_ok AND NOT phone_ok),
           'sms_only', count(*) FILTER (WHERE phone_ok AND NOT email_ok),
           'none', count(*) FILTER (WHERE NOT email_ok AND NOT phone_ok)
         ),
         count(*) FILTER (WHERE eng_status = 'unreachable' OR bounced)
    INTO v_clients, v_reach, v_unreach
    FROM _cr;

  -- ── Habitués : N soirées sur M mois (règle de l'espace) ─────────────────
  WITH snap AS (
    SELECT k,
           CASE WHEN k = 0 THEN v_now
                ELSE (date_trunc('month', v_now AT TIME ZONE v_tz) - (k - 1) * interval '1 month') AT TIME ZONE v_tz END AS at
      FROM generate_series(0, 6) k
  ), cnt AS (
    SELECT s.k, (
      SELECT count(*) FROM (
        SELECT x.email FROM _ht x
         WHERE x.email IS NOT NULL AND x.event_start IS NOT NULL
           AND x.event_start <= s.at AND x.event_start > s.at - make_interval(months => v_rules.regular_window_months)
         GROUP BY x.email HAVING count(DISTINCT x.event_id) >= v_rules.regular_min_nights) q) AS n
      FROM snap s
  )
  SELECT jsonb_build_object(
           'total', (SELECT n FROM cnt WHERE k = 0),
           'month_delta', (SELECT n FROM cnt WHERE k = 0) - (SELECT n FROM cnt WHERE k = 1),
           'bars', (SELECT jsonb_agg(n ORDER BY k DESC) FROM cnt WHERE k BETWEEN 0 AND 5),
           'min_nights', v_rules.regular_min_nights,
           'window_months', v_rules.regular_window_months)
    INTO v_regulars;

  -- ── Conversion des deux derniers envois e-mail (achat < 48 h) ───────────
  WITH last_sends AS (
    SELECT c.id, c.name, c.sent_at
      FROM public.email_campaigns c
     WHERE c.status = 'sent' AND c.sent_at IS NOT NULL AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     ORDER BY c.sent_at DESC LIMIT 2
  ), conv AS (
    SELECT l.id, l.name, l.sent_at,
           (SELECT count(*) FROM public.email_campaign_recipients r WHERE r.campaign_id = l.id AND r.status = 'sent') AS recipients,
           (SELECT count(DISTINCT x.email) FROM _ht x
             WHERE x.bought_at >= l.sent_at AND x.bought_at < l.sent_at + interval '48 hours'
               AND x.email IN (SELECT lower(r.email) FROM public.email_campaign_recipients r WHERE r.campaign_id = l.id AND r.status = 'sent')) AS buyers
      FROM last_sends l
  )
  SELECT CASE WHEN count(*) = 0 THEN NULL ELSE jsonb_agg(jsonb_build_object(
           'id', id, 'name', name, 'sent_at', sent_at, 'recipients', recipients, 'buyers', buyers,
           'pct', CASE WHEN recipients > 0 THEN round(buyers::numeric * 100 / recipients, 1) END) ORDER BY sent_at DESC) END
    INTO v_conv
    FROM conv;

  -- ── Bilan du dernier envoi (14 jours) ────────────────────────────────────
  -- Acheteurs et CA = même règle que Résultats, Parcours et Segments
  -- (_crm_email_attrib : un clic dans les 7 jours avant l'achat, le dernier
  -- clic gagne), jamais une fenêtre à part.
  PERFORM public._crm_email_attrib(p_venue_id, p_organizer_user_id);
  SELECT jsonb_build_object(
           'id', c.id, 'name', c.name, 'sent_at', c.sent_at, 'channel', 'email',
           'recipients', (SELECT count(*) FROM public.email_campaign_recipients r WHERE r.campaign_id = c.id AND r.status = 'sent'),
           'clickers', (SELECT count(DISTINCT lower(ev.recipient_email)) FROM public.email_campaign_events ev
                         WHERE ev.campaign_id = c.id AND ev.event_type = 'clicked'),
           'buyers', (SELECT count(DISTINCT a.email) FROM _cma a WHERE a.campaign_id = c.id),
           'revenue', (SELECT COALESCE(round(sum(a.amount), 2), 0) FROM _cma a WHERE a.campaign_id = c.id),
           'yunits', COALESCE((SELECT -sum(m.delta) FROM public.crm_yunit_moves m
                                WHERE m.scope_key = v_scope AND m.kind = 'debit' AND m.ref_type = 'email_campaign' AND m.ref_id = c.id::text),
                              (SELECT count(*) FROM public.email_campaign_recipients r WHERE r.campaign_id = c.id AND r.status = 'sent') * (cfg->'rates'->>'email')::int))
    INTO v_mission
    FROM public.email_campaigns c
   WHERE c.status = 'sent' AND c.sent_at > v_now - interval '14 days' AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
   ORDER BY c.sent_at DESC LIMIT 1;

  -- ── Prochaine soirée ─────────────────────────────────────────────────────
  SELECT e.id, e.title, e.start_at, e.end_at, COALESCE(NULLIF(e.timezone, ''), v_tz) AS tz,
         x.left_tickets, x.city, x.cancelled_at
    INTO v_ev
    FROM public.events e
    LEFT JOIN public.external_events x ON x.event_id = e.id
   WHERE ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
     AND e.external_source IS NOT NULL
     AND COALESCE(e.end_at, e.start_at + interval '8 hours') > v_now
     AND x.cancelled_at IS NULL
   ORDER BY e.start_at ASC LIMIT 1;

  IF v_ev.id IS NOT NULL THEN
    SELECT e.id, e.title, e.start_at INTO v_prev
      FROM public.events e
     WHERE ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.external_source IS NOT NULL
       AND e.start_at < v_ev.start_at
       AND COALESCE(e.end_at, e.start_at + interval '8 hours') <= v_now
       AND EXISTS (SELECT 1 FROM _ht x WHERE x.event_id = e.id)
     -- Même règle que le volet d'une soirée : la même série d'abord.
     ORDER BY (lower(COALESCE(public._crm_night_series(e.title), e.title))
               = lower(COALESCE(public._crm_night_series(v_ev.title), v_ev.title))) DESC,
              e.start_at DESC LIMIT 1;

    WITH ev_day AS (
      SELECT (v_ev.start_at AT TIME ZONE v_ev.tz)::date AS d0,
             (v_now AT TIME ZONE v_ev.tz)::date AS today
    ), pts AS (
      -- 8 points : de J-7 (par rapport à aujourd'hui) jusqu'à maintenant.
      SELECT k, ((SELECT today FROM ev_day) - (7 - k)) AS day
        FROM generate_series(0, 7) k
    ), cur AS (
      SELECT p.k, p.day,
             ((SELECT d0 FROM ev_day) - p.day) AS jn,
             (SELECT COALESCE(sum(x.qty), 0) FROM _ht x
               WHERE x.event_id = v_ev.id
                 AND x.bought_at < LEAST(v_now, ((p.day + 1)::timestamp AT TIME ZONE v_ev.tz))) AS sold
        FROM pts p
    )
    SELECT jsonb_build_object(
             'id', v_ev.id, 'title', v_ev.title, 'start_at', v_ev.start_at, 'end_at', v_ev.end_at, 'tz', v_ev.tz,
             'city', v_ev.city,
             'sold', (SELECT COALESCE(sum(x.qty), 0) FROM _ht x WHERE x.event_id = v_ev.id),
             'today', (SELECT COALESCE(sum(x.qty), 0) FROM _ht x WHERE x.event_id = v_ev.id
                        AND x.bought_at >= (date_trunc('day', v_now AT TIME ZONE v_ev.tz) AT TIME ZONE v_ev.tz)),
             'left', v_ev.left_tickets,
             'days_to', (SELECT d0 - today FROM ev_day),
             'curve', (SELECT jsonb_agg(jsonb_build_object(
                        'day', c.day, 'jn', c.jn, 'cur', c.sold,
                        'prev', CASE WHEN v_prev.id IS NULL THEN NULL ELSE
                          (SELECT COALESCE(sum(x.qty), 0) FROM _ht x
                            WHERE x.event_id = v_prev.id
                              AND x.bought_at < ((((v_prev.start_at AT TIME ZONE v_ev.tz)::date - c.jn) + 1)::timestamp AT TIME ZONE v_ev.tz)) END
                       ) ORDER BY c.k) FROM cur c),
             'prev', CASE WHEN v_prev.id IS NULL THEN NULL ELSE jsonb_build_object(
                        'id', v_prev.id, 'title', v_prev.title, 'start_at', v_prev.start_at,
                        'final', (SELECT COALESCE(sum(x.qty), 0) FROM _ht x WHERE x.event_id = v_prev.id)) END,
             'buyers', (
               WITH bb AS (
                 SELECT b.email,
                        (SELECT count(DISTINCT y.event_id) FROM _ht y
                          WHERE y.email = b.email AND y.event_start < v_ev.start_at
                            AND y.event_start > v_ev.start_at - make_interval(months => v_rules.regular_window_months)) AS prior_window,
                        (SELECT count(DISTINCT y.event_id) FROM _ht y WHERE y.email = b.email AND y.event_start < v_ev.start_at) AS prior_all
                   FROM (SELECT DISTINCT x.email FROM _ht x WHERE x.event_id = v_ev.id AND x.email IS NOT NULL) b
               )
               SELECT jsonb_build_object(
                        'total', count(*),
                        'regulars', count(*) FILTER (WHERE prior_window + 1 >= v_rules.regular_min_nights),
                        'new', count(*) FILTER (WHERE prior_all = 0),
                        'occasional', count(*) FILTER (WHERE prior_all > 0 AND prior_window + 1 < v_rules.regular_min_nights))
                 FROM bb)
           )
      INTO v_next;

    -- Habitués joignables qui n'ont pas encore leur place.
    SELECT count(*) INTO v_relaunch FROM (
      SELECT x.email FROM _ht x
       WHERE x.email IS NOT NULL AND x.event_start <= v_now
         AND x.event_start > v_now - make_interval(months => v_rules.regular_window_months)
       GROUP BY x.email HAVING count(DISTINCT x.event_id) >= v_rules.regular_min_nights
    ) reg
    WHERE NOT EXISTS (SELECT 1 FROM _ht y WHERE y.event_id = v_ev.id AND y.email = reg.email)
      AND EXISTS (SELECT 1 FROM _cr c WHERE c.email = reg.email AND c.email_ok);
  END IF;

  -- ── Que faut-il faire aujourd'hui ? ──────────────────────────────────────
  v_balance := public.crm_yunits_balance(v_scope);
  SELECT COALESCE(sum(GREATEST(COALESCE(c.total_recipients, c.recipients_count, 0), 0)), 0)::int
    INTO v_reserved
    FROM public.email_campaigns c
   WHERE c.status = 'scheduled' AND c.scheduled_at > v_now
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;

  IF NOT v_has_conn AND (SELECT count(*) FROM _cr) = 0 THEN
    v_todo := jsonb_build_array(
      jsonb_build_object('id', 'connect', 'kind', 'connect', 'tone', 'todo', 'params', '{}'::jsonb),
      jsonb_build_object('id', 'check', 'kind', 'check', 'tone', 'wait', 'params', '{}'::jsonb),
      jsonb_build_object('id', 'first_send', 'kind', 'first_send', 'tone', 'wait',
                         'params', jsonb_build_object('yunits', v_balance)));
  ELSE
    IF v_ev.id IS NOT NULL AND COALESCE(v_relaunch, 0) > 0 AND (v_next->>'days_to')::int BETWEEN 0 AND 3 THEN
      v_todo := v_todo || jsonb_build_object('id', 'relaunch:' || v_ev.id, 'kind', 'relaunch',
        'tone', CASE WHEN (v_next->>'days_to')::int <= 1 THEN 'todo' ELSE 'warn' END,
        'params', jsonb_build_object('n', v_relaunch, 'event_id', v_ev.id, 'title', v_ev.title,
                                     'days_to', (v_next->>'days_to')::int, 'start_at', v_ev.start_at));
    END IF;

    FOR v_row IN SELECT c.id, c.name, c.scheduled_at, COALESCE(c.total_recipients, c.recipients_count, 0) AS n
               FROM public.email_campaigns c
              WHERE c.status = 'scheduled' AND c.scheduled_at > v_now AND c.scheduled_at < v_now + interval '24 hours'
                AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
              ORDER BY c.scheduled_at LIMIT 2 LOOP
      v_todo := v_todo || jsonb_build_object('id', 'validate:' || v_row.id, 'kind', 'validate', 'tone', 'todo',
        'params', jsonb_build_object('campaign_id', v_row.id, 'name', v_row.name, 'at', v_row.scheduled_at, 'recipients', v_row.n));
    END LOOP;

    FOR v_row IN SELECT c.id, c.name, c.updated_at
               FROM public.email_campaigns c
              WHERE c.status = 'draft' AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
                AND c.updated_at > v_now - interval '14 days'
                AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
              ORDER BY c.updated_at DESC LIMIT 1 LOOP
      v_todo := v_todo || jsonb_build_object('id', 'draft:' || v_row.id, 'kind', 'draft', 'tone', 'wait',
        'params', jsonb_build_object('campaign_id', v_row.id, 'name', v_row.name, 'updated_at', v_row.updated_at));
    END LOOP;

    IF v_balance - v_reserved < (cfg->>'low_balance')::int THEN
      v_todo := v_todo || jsonb_build_object('id', 'yunits', 'kind', 'yunits', 'tone', 'warn',
        'params', jsonb_build_object('after', GREATEST(v_balance - v_reserved, 0), 'balance', v_balance,
                                     'reserved', v_reserved, 'sms_rate', (cfg->'rates'->>'sms')::int));
    END IF;

    IF COALESCE(v_unreach, 0) > 0 THEN
      v_todo := v_todo || jsonb_build_object('id', 'contacts', 'kind', 'contacts', 'tone', 'wait',
        'params', jsonb_build_object('n', v_unreach));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'now', v_now,
    'tz', v_tz,
    'connection', CASE WHEN v_has_conn THEN jsonb_build_object(
        'provider', v_conn.provider, 'status', v_conn.status, 'last_ok_at', v_conn.last_ok_at,
        'last_error_at', v_conn.last_error_at,
        'broken', v_conn.status = 'token_invalid'
                  OR (v_conn.last_error_at IS NOT NULL AND (v_conn.last_ok_at IS NULL OR v_conn.last_error_at > v_conn.last_ok_at) AND v_conn.fail_count >= 3),
        'broken_since', COALESCE(v_conn.last_ok_at, v_conn.last_error_at)) END,
    'sales', jsonb_build_object(
        'period', p_period, 'hourly', v_hourly, 'n', v_n, 'start', v_start, 'end', v_end,
        'series', COALESCE(v_series, '[]'::jsonb), 'total', v_tot, 'prev_total', v_ptot,
        'tickets', v_tickets, 'prev_tickets', v_ptickets, 'sends', v_sends,
        'has_any', EXISTS (SELECT 1 FROM _ht)),
    'kpi', jsonb_build_object('clients', v_clients, 'regulars', v_regulars, 'conversion', v_conv, 'reach', v_reach),
    'mission', v_mission,
    'next', v_next,
    'todo', v_todo,
    'wallet', jsonb_build_object('balance', v_balance, 'reserved', v_reserved)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_events_brief(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN NULL ELSE
    COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'start_at') DESC) FROM (
      SELECT jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at,
                                'upcoming', COALESCE(e.end_at, e.start_at + interval '8 hours') > now()) AS x
        FROM public.events e
       WHERE ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
         AND e.external_source IS NOT NULL
       ORDER BY abs(extract(epoch FROM e.start_at - now()))
       LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 12), 60))
    ) q), '[]'::jsonb) END;
$function$;

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
     AND e.external_source IS NOT NULL
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
           min(t.bought_at) FILTER (WHERE t.amount > 0) AS first_paid,
           bool_or(t.event_start > v_at) AS upcoming
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
           -- A acheté pour une soirée à venir sans en avoir encore fait : nouveau
           -- client, pas un « contact connu » (import, inscription).
           WHEN COALESCE(a.nights, 0) = 0 THEN CASE WHEN y.first_buy IS NOT NULL THEN 'nou' ELSE 'none' END
           -- A repris une place : il n'a pas décroché.
           WHEN a.last_night < v_at - make_interval(months => v_rules.lapse_months)
                AND NOT COALESCE(y.upcoming, false) THEN 'end'
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

CREATE OR REPLACE FUNCTION public.crm_night_detail__core(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  e record;
  x record;
  p record;
  v_tz text;
  v_day date;
  v_upcoming boolean;
  v_d_end integer;
  v_d_start integer;
  v_series text;
  v_curve jsonb;
  v_prev jsonb;
  v_buyers jsonb;
  v_msgs jsonb;
  v_avg numeric;
  v_sold bigint;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT ev.* INTO e FROM public.events ev
   WHERE ev.id = p_event_id AND ev.external_source IS NOT NULL
     AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id));
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  SELECT * INTO x FROM public.external_events WHERE event_id = p_event_id LIMIT 1;

  v_tz := COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris');
  v_day := (e.start_at AT TIME ZONE v_tz)::date;
  v_upcoming := COALESCE(e.end_at, e.start_at + interval '6 hours') > now();
  v_d_end := CASE WHEN v_upcoming THEN GREATEST(0, v_day - (now() AT TIME ZONE v_tz)::date) ELSE 0 END;
  v_series := lower(COALESCE(public._crm_night_series(e.title), e.title));

  -- Billets de la soirée, avec leur « jour avant la soirée ».
  DROP TABLE IF EXISTS _cnt;
  CREATE TEMP TABLE _cnt ON COMMIT DROP AS
    SELECT lower(t.buyer_email) AS email, GREATEST(t.quantity, 1) AS qty,
           GREATEST(0, v_day - (COALESCE(t.purchased_at, t.first_seen_at) AT TIME ZONE v_tz)::date) AS d
      FROM public.external_tickets t
     WHERE t.event_id = p_event_id AND public._crm_ticket_is_sale(t.status, t.raw);
  SELECT COALESCE(sum(qty), 0) INTO v_sold FROM _cnt;

  -- Début de la courbe : l'ouverture des ventes, sinon le premier achat (120 j max).
  v_d_start := LEAST(120, GREATEST(v_d_end,
                 COALESCE(CASE WHEN x.launched_at IS NOT NULL AND x.launched_at <= now()
                               THEN v_day - (x.launched_at AT TIME ZONE v_tz)::date END,
                          (SELECT max(d) FROM _cnt), v_d_end)));

  -- La fois d'avant : même série, sinon la soirée passée précédente, avec des ventes.
  SELECT ev.id, ev.title, ev.start_at, COALESCE(NULLIF(ev.timezone, ''), 'Europe/Paris') AS tz INTO p
    FROM public.events ev
   WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL AND ev.id <> p_event_id
     AND ev.start_at < e.start_at
     AND COALESCE(ev.end_at, ev.start_at + interval '6 hours') <= now()
     AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
     AND EXISTS (SELECT 1 FROM public.external_tickets t WHERE t.event_id = ev.id AND public._crm_ticket_is_sale(t.status, t.raw))
   ORDER BY (lower(COALESCE(public._crm_night_series(ev.title), ev.title)) = v_series) DESC, ev.start_at DESC
   LIMIT 1;

  DROP TABLE IF EXISTS _cnp;
  CREATE TEMP TABLE _cnp ON COMMIT DROP AS
    SELECT GREATEST(t.quantity, 1) AS qty,
           GREATEST(0, (p.start_at AT TIME ZONE p.tz)::date - (COALESCE(t.purchased_at, t.first_seen_at) AT TIME ZONE p.tz)::date) AS d
      FROM public.external_tickets t
     WHERE p.id IS NOT NULL AND t.event_id = p.id AND public._crm_ticket_is_sale(t.status, t.raw);

  SELECT jsonb_agg(jsonb_build_object(
           'd', g.d,
           'v', (SELECT COALESCE(sum(qty), 0) FROM _cnt WHERE _cnt.d >= g.d),
           'pv', CASE WHEN p.id IS NOT NULL THEN (SELECT COALESCE(sum(qty), 0) FROM _cnp WHERE _cnp.d >= g.d) END
         ) ORDER BY g.d DESC)
    INTO v_curve
    FROM generate_series(v_d_end, v_d_start) AS g(d);

  IF p.id IS NOT NULL THEN
    v_prev := jsonb_build_object('id', p.id, 'title', p.title, 'start_at', p.start_at,
      'same_series', lower(COALESCE(public._crm_night_series(p.title), p.title)) = v_series,
      'total', (SELECT COALESCE(sum(qty), 0) FROM _cnp));
  END IF;

  -- Acheteurs : soirées de la portée AVANT celle-ci, classés par la règle
  -- d'habitué de l'espace (N soirées sur M mois, cette soirée comprise),
  -- la même que l'Accueil.
  WITH b AS (SELECT DISTINCT email FROM _cnt WHERE email IS NOT NULL),
  r AS (SELECT * FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id)),
  hist AS (
    SELECT b.email,
           count(DISTINCT t.event_id) FILTER (WHERE t.event_start < e.start_at) AS prior,
           count(DISTINCT t.event_id) FILTER (WHERE t.event_start < e.start_at
                 AND t.event_start > e.start_at - make_interval(months => (SELECT regular_window_months FROM r))) AS prior_window
      FROM b LEFT JOIN public._crm_tickets(p_venue_id, p_organizer_user_id) t ON t.email = b.email
     GROUP BY b.email
  )
  SELECT jsonb_build_object('total', count(*),
           'new', count(*) FILTER (WHERE prior = 0),
           'occasional', count(*) FILTER (WHERE prior > 0 AND prior_window + 1 < (SELECT regular_min_nights FROM r)),
           'regular', count(*) FILTER (WHERE prior > 0 AND prior_window + 1 >= (SELECT regular_min_nights FROM r)))
    INTO v_buyers FROM hist;

  -- Remplissage moyen de la série : les AUTRES soirées passées à capacité
  -- connue, au moins deux (sinon la soirée se comparerait à elle-même).
  SELECT CASE WHEN count(*) >= 2 AND sum(cap) > 0 THEN round(sum(sold)::numeric / sum(cap), 4) END INTO v_avg
    FROM (
      SELECT public._crm_night_capacity(xx.left_tickets, xx.deals, s.sold) AS cap, s.sold
        FROM public.events ev
        JOIN public.external_events xx ON xx.event_id = ev.id
        CROSS JOIN LATERAL (SELECT COALESCE(sum(GREATEST(t.quantity, 1)), 0) AS sold FROM public.external_tickets t
                             WHERE t.event_id = ev.id AND public._crm_ticket_is_sale(t.status, t.raw)) s
       WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL AND ev.id <> p_event_id
         AND COALESCE(ev.end_at, ev.start_at + interval '6 hours') <= now()
         AND lower(COALESCE(public._crm_night_series(ev.title), ev.title)) = v_series
         AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
    ) z WHERE z.cap IS NOT NULL;

  -- Messages, avec le taux d'ouverture des e-mails partis.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', m.id, 'channel', m.channel, 'name', m.name, 'state', m.state, 'at', m.at,
           'open_pct', CASE WHEN m.channel = 'email' AND m.state = 'sent' THEN (
               SELECT CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE EXISTS (
                        SELECT 1 FROM public.email_campaign_events ce
                         WHERE ce.campaign_id = r.campaign_id AND ce.event_type = 'opened'
                           AND lower(ce.recipient_email) = lower(r.email))) / count(*)) END
                 FROM public.email_campaign_recipients r
                WHERE r.campaign_id = m.id AND r.status IN ('sent', 'complained')) END
         ) ORDER BY CASE m.state WHEN 'draft' THEN 0 WHEN 'plan' THEN 1 ELSE 2 END, m.at DESC), '[]'::jsonb)
    INTO v_msgs
    FROM public._crm_night_msgs(p_venue_id, p_organizer_user_id, ARRAY[p_event_id]) m;

  RETURN jsonb_build_object(
    'id', e.id, 'title', e.title, 'series', COALESCE(public._crm_night_series(e.title), e.title),
    'start_at', e.start_at, 'end_at', COALESCE(e.end_at, e.start_at + interval '6 hours'), 'tz', v_tz,
    'upcoming', v_upcoming, 'url', e.external_ticket_url,
    'street', COALESCE(x.street, e.location_address), 'zip', x.zip_code, 'city', COALESCE(x.city, e.location_city),
    'lineup', COALESCE((SELECT jsonb_agg(a->>'name') FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(x.artists) = 'array' THEN x.artists ELSE '[]'::jsonb END) a
                 WHERE NULLIF(btrim(a->>'name'), '') IS NOT NULL), '[]'::jsonb),
    'sale_opens_at', CASE WHEN x.launched_at > now() THEN x.launched_at END,
    'opened_at', CASE WHEN x.launched_at <= now() THEN x.launched_at END,
    'sold', v_sold, 'cap', public._crm_night_capacity(x.left_tickets, x.deals, v_sold),
    'sold_out', COALESCE(e.tickets_sold_out, false) OR COALESCE(x.left_tickets = 0, false),
    'revenue', (SELECT COALESCE(round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)), 2), 0)
                  FROM public.external_tickets t WHERE t.event_id = p_event_id AND public._crm_ticket_is_sale(t.status, t.raw)),
    'today', (SELECT COALESCE(sum(GREATEST(t.quantity, 1)), 0) FROM public.external_tickets t
               WHERE t.event_id = p_event_id AND public._crm_ticket_is_sale(t.status, t.raw)
                 AND (COALESCE(t.purchased_at, t.first_seen_at) AT TIME ZONE 'Europe/Paris')::date = (now() AT TIME ZONE 'Europe/Paris')::date),
    'series_avg_fill', v_avg,
    'tiers', public._crm_night_tiers(p_event_id, x.deals),
    'curve', COALESCE(v_curve, '[]'::jsonb), 'prev', v_prev,
    'buyers', v_buyers, 'msgs', v_msgs,
    'synced_at', x.synced_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_email_stats(p_venue_id text, p_organizer_user_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  PERFORM public._crm_email_attrib(p_venue_id, p_organizer_user_id);

  DROP TABLE IF EXISTS _ces;
  CREATE TEMP TABLE _ces ON COMMIT DROP AS
  SELECT ec.id, ec.name, ec.subject, ec.sent_at, ec.audiences_json, ec.template_kind, ec.event_id,
         r.n, r.bounced, r.complained, GREATEST(r.n - r.bounced, 0) AS received,
         COALESCE(o.opened, 0) AS opened,
         COALESCE(k.clicked, 0) AS clicked, COALESCE(k.ticketing, 0) AS ticketing,
         COALESCE(b.purchases, 0) AS purchases, COALESCE(b.revenue, 0) AS revenue,
         COALESCE(ec.unsubscribes_count, 0) AS unsub,
         COALESCE(b.buyers, 0) AS buyers
    FROM public.email_campaigns ec
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE rr.status IN ('sent', 'complained', 'bounced')) AS n,
             count(*) FILTER (WHERE rr.status = 'bounced') AS bounced,
             count(*) FILTER (WHERE rr.status = 'complained') AS complained
        FROM public.email_campaign_recipients rr WHERE rr.campaign_id = ec.id
    ) r
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT lower(e.recipient_email)) AS opened FROM public.email_campaign_events e
       WHERE e.campaign_id = ec.id AND e.event_type = 'opened'
    ) o ON true
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT kk.email) AS clicked, count(DISTINCT kk.email) FILTER (WHERE kk.ticketing) AS ticketing
        FROM _cmk kk WHERE kk.campaign_id = ec.id
    ) k ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS purchases, COALESCE(sum(aa.amount), 0) AS revenue, count(DISTINCT aa.email) AS buyers
        FROM _cma aa WHERE aa.campaign_id = ec.id
    ) b ON true
   WHERE ec.venue_id IS NOT DISTINCT FROM p_venue_id
     AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
     AND ec.status IN ('sent', 'sending') AND ec.sent_at IS NOT NULL
     AND ec.sent_at >= p_from AND ec.sent_at < p_to;
  SELECT count(*) INTO v_n FROM _ces;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_email_result__core(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  ec public.email_campaigns%ROWTYPE;
  v_me record;
  v_avg record;
  v_rank integer; v_total integer;
  v_tl jsonb; v_links jsonb; v_list jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO ec FROM public.email_campaigns c
   WHERE c.id = p_campaign_id AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  PERFORM public._crm_email_stats(p_venue_id, p_organizer_user_id, now() - interval '25 months', now() + interval '1 day');
  SELECT * INTO v_me FROM _ces WHERE id = p_campaign_id;
  SELECT count(*) AS n_campaigns,
         CASE WHEN sum(received) > 0 THEN sum(opened)::numeric / sum(received) END AS open_rate,
         CASE WHEN sum(received) > 0 THEN sum(clicked)::numeric / sum(received) END AS click_rate,
         CASE WHEN sum(n) > 0 THEN sum(purchases)::numeric * 1000 / sum(n) END AS per_k
    INTO v_avg FROM _ces;
  SELECT count(*) INTO v_total FROM _ces;
  SELECT r INTO v_rank FROM (
    SELECT id, rank() OVER (ORDER BY CASE WHEN n > 0 THEN purchases::numeric / n ELSE 0 END DESC) AS r FROM _ces) z
   WHERE z.id = p_campaign_id;

  -- Réactions heure par heure sur 72 h (première ouverture / premier clic par personne).
  IF ec.sent_at IS NOT NULL THEN
    WITH firsts AS (
      SELECT e.event_type, lower(e.recipient_email) AS em, min(e.created_at) AS at
        FROM public.email_campaign_events e
       WHERE e.campaign_id = p_campaign_id AND e.event_type IN ('opened', 'clicked')
       GROUP BY 1, 2
    )
    SELECT jsonb_agg(jsonb_build_object('h', g.h,
             'opens', (SELECT count(*) FROM firsts f WHERE f.event_type = 'opened' AND f.at < ec.sent_at + make_interval(hours => g.h)),
             'clicks', (SELECT count(*) FROM firsts f WHERE f.event_type = 'clicked' AND f.at < ec.sent_at + make_interval(hours => g.h)))
           ORDER BY g.h)
      INTO v_tl FROM generate_series(0, 72, 3) g(h);

    SELECT COALESCE(jsonb_agg(jsonb_build_object('link', l.link, 'clicks', l.clicks, 'people', l.people) ORDER BY l.people DESC), '[]'::jsonb)
      INTO v_links FROM (
        SELECT regexp_replace(e.metadata->'click'->>'link', '([?&])yc=[^&]*&?', '\1', 'g') AS link,
               count(*) AS clicks, count(DISTINCT lower(e.recipient_email)) AS people
          FROM public.email_campaign_events e
         WHERE e.campaign_id = p_campaign_id AND e.event_type = 'clicked' AND e.metadata->'click'->>'link' IS NOT NULL
         GROUP BY 1 ORDER BY 3 DESC LIMIT 12) l;
  END IF;

  -- Les autres campagnes envoyées (pour passer de l'une à l'autre).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sent_at', sent_at) ORDER BY sent_at DESC), '[]'::jsonb)
    INTO v_list FROM (SELECT id, name, sent_at FROM _ces ORDER BY sent_at DESC LIMIT 24) z;

  RETURN public._crm_email_row(ec) || jsonb_build_object(
    'stats', CASE WHEN v_me.id IS NULL THEN NULL ELSE jsonb_build_object(
      'n', v_me.n, 'received', v_me.received, 'opened', v_me.opened, 'clicked', v_me.clicked, 'ticketing', v_me.ticketing,
      'purchases', v_me.purchases, 'buyers', v_me.buyers, 'revenue', round(v_me.revenue, 2), 'bounced', v_me.bounced, 'complained', v_me.complained,
      'unsub', v_me.unsub, 'non_openers', GREATEST(v_me.received - v_me.opened - v_me.complained, 0)) END,
    'avg', jsonb_build_object('campaigns', v_avg.n_campaigns, 'open_rate', round(v_avg.open_rate, 4), 'click_rate', round(v_avg.click_rate, 4), 'per_k', round(v_avg.per_k, 2)),
    'rank', v_rank, 'rank_of', v_total,
    'timeline', COALESCE(v_tl, '[]'::jsonb), 'links', COALESCE(v_links, '[]'::jsonb), 'others', v_list,
    'resend', jsonb_build_object('enabled', ec.resend_enabled, 'subject', ec.resend_subject, 'done_at', ec.resend_done_at, 'campaign_id', ec.resend_campaign_id),
    'blocks_version', ec.blocks_version);
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_ticket_is_sale(p_status text, p_raw jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  -- Ni une invitation, ni un duplicata (copie d'un billet déjà vendu).
  SELECT p_status = 'valid' AND COALESCE(p_raw->>'deal_channel', '') NOT IN ('invitation', 'duplicata');
$function$;

CREATE OR REPLACE FUNCTION public._crm_ticket_gl_kind(p_status text, p_price numeric, p_raw jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_status IS DISTINCT FROM 'valid' THEN NULL
    -- Un duplicata est la copie d'un billet existant : ni vente, ni guest list.
    WHEN jsonb_typeof(p_raw) = 'object' AND p_raw->>'deal_channel' = 'duplicata' THEN NULL
    WHEN jsonb_typeof(p_raw) = 'object' AND p_raw->>'deal_channel' = 'invitation' THEN 'inv'
    WHEN p_price = 0 THEN 'free'
  END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_imports_overview(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_conn jsonb;
  v_sync jsonb;
  v_imports jsonb;
  v_legacy jsonb;
  v_day date;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
           'state', CASE WHEN c.status IN ('token_invalid', 'error') THEN 'broken'
                         WHEN c.status = 'disconnected' THEN 'off' ELSE 'on' END,
           'status', c.status, 'org_name', c.external_org_name,
           'last_ok_at', c.last_ok_at, 'last_error_at', c.last_error_at)
    INTO v_conn
    FROM public.ticketing_connections c
   WHERE c.provider = 'shotgun'
     AND ((p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id))
   ORDER BY c.updated_at DESC LIMIT 1;

  -- Dernier jour où Shotgun a apporté des acheteurs : nouveaux (premier billet
  -- vu ce jour-là) et déjà présents (un billet plus ancien existait).
  WITH t AS (
    SELECT lower(et.buyer_email) AS email, et.first_seen_at
      FROM public.external_tickets et
     WHERE et.buyer_email IS NOT NULL
       AND ((p_venue_id IS NOT NULL AND et.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND et.organizer_user_id = p_organizer_user_id))
  )
  SELECT max((first_seen_at AT TIME ZONE 'Europe/Paris')::date) INTO v_day FROM t;
  IF v_day IS NOT NULL THEN
    WITH t AS (
      SELECT lower(et.buyer_email) AS email, et.first_seen_at
        FROM public.external_tickets et
       WHERE et.buyer_email IS NOT NULL
         AND ((p_venue_id IS NOT NULL AND et.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND et.organizer_user_id = p_organizer_user_id))
    ), f AS (SELECT email, min(first_seen_at) AS first_at FROM t GROUP BY email),
    d AS (SELECT DISTINCT email FROM t WHERE (first_seen_at AT TIME ZONE 'Europe/Paris')::date = v_day)
    -- « Nouveau » = absent de la base AVANT ce jour : ni billet Shotgun plus
    -- ancien, ni contact du registre ou d'un fichier importé. Au premier
    -- import, un acheteur déjà dans la base (fichier importé avant) est
    -- « déjà présent », plus « nouveau ».
    SELECT jsonb_build_object(
             'day', v_day,
             'new', count(*) FILTER (WHERE (f.first_at AT TIME ZONE 'Europe/Paris')::date = v_day AND NOT k.known),
             'existing', count(*) FILTER (WHERE (f.first_at AT TIME ZONE 'Europe/Paris')::date < v_day OR k.known))
      INTO v_sync
      FROM d JOIN f ON f.email = d.email
      CROSS JOIN LATERAL (
        SELECT EXISTS (
                 SELECT 1 FROM public.newsletter_subscriptions ns
                  WHERE lower(ns.email) = d.email
                    AND ((p_venue_id IS NOT NULL AND ns.venue_id = p_venue_id)
                      OR (p_organizer_user_id IS NOT NULL AND ns.organizer_user_id = p_organizer_user_id))
                    AND ns.created_at < (v_day::timestamp AT TIME ZONE 'Europe/Paris'))
            OR EXISTS (
                 SELECT 1 FROM public.imported_contacts ic
                  WHERE ic.email = d.email
                    AND ((p_venue_id IS NOT NULL AND ic.venue_id = p_venue_id)
                      OR (p_organizer_user_id IS NOT NULL AND ic.organizer_user_id = p_organizer_user_id))
                    AND ic.created_at < (v_day::timestamp AT TIME ZONE 'Europe/Paris')) AS known
      ) k;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', i.list_import_id, 'kind', i.kind, 'title', i.title, 'consent', i.consent,
           'created_at', i.created_at, 'status', i.status, 'undone_at', i.undone_at,
           'new', i.new_count, 'existing', i.existing_count, 'dup', i.file_dup_count, 'bad', i.bad_count)
           ORDER BY i.created_at DESC), '[]'::jsonb)
    INTO v_imports
    FROM (SELECT * FROM public.crm_imports WHERE scope_key = v_scope AND status <> 'running' ORDER BY created_at DESC LIMIT 30) i;

  -- Fichiers importés avant la Console CRM (outil d'import de la Suite).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', l.id, 'title', COALESCE(l.list_name, l.filename), 'created_at', l.created_at, 'rows', l.row_count)
           ORDER BY l.created_at DESC), '[]'::jsonb)
    INTO v_legacy
    FROM (SELECT * FROM public.contact_list_imports l
           WHERE public.marketing_scope_match(l.venue_id, l.organizer_user_id, p_venue_id, p_organizer_user_id)
             AND l.superseded_by IS NULL AND l.superseded_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM public.crm_imports c WHERE c.list_import_id = l.id)
           ORDER BY l.created_at DESC LIMIT 10) l;

  RETURN jsonb_build_object('connection', v_conn, 'sync', v_sync, 'imports', v_imports, 'legacy', v_legacy);
END;
$function$;
