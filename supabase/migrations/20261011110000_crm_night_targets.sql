-- ============================================================================
-- Yuno CRM — « Qui cibler » : les audiences d'une soirée à venir (2026-10-07).
-- Plan : docs/designs/CRM_ANALYSIS_NEXT_PLAN.md (lot N2/N3).
--
-- • _crm_night_target_set(scope, soirée, audience) : la porte unique de
--   l'appartenance (concept, lineup, genre, early, last_minute, once_local),
--   toujours SANS place pour la soirée. Lue par la RPC ET par la clé de filtre
--   `ntgt` de _crm_filter_sql : le chiffre affiché = le filtre = l'envoi.
-- • _crm_people_build (corps de 20261010110000) pose la portée de la base
--   construite (`yuno.crm_scope`, transaction) : la clé `ntgt` ne lit que
--   cette portée, une soirée d'un autre compte rend personne.
-- • crm_night_targets : tailles, joignables e-mail / SMS, statut de la famille
--   d'hypothèses sur le compte, moment conseillé, preuves.
-- ============================================================================

SET lock_timeout = '5s';

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
  -- Portée de la base construite, lue par les clés de filtre qui interrogent
  -- une soirée (`ntgt`, 20261011110000) : jamais la soirée d'un autre compte.
  PERFORM set_config('yuno.crm_scope', COALESCE(v_scope, ''), true);
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
           bool_or(g.event_id = v_tonight) AS gl_tonight,
           bool_or(g.event_start > v_at) AS gl_upcoming
      FROM _cpg g
     GROUP BY g.email
  ), first_utm AS (
    -- Le 1er billet VENDU (ni invitation, ni remboursé, ni duplicata), par
    -- date d'achat (20261010110000).
    SELECT DISTINCT ON (lower(et.buyer_email)) lower(et.buyer_email) AS email,
           et.utm->>'utm_source' AS utm_source, et.utm->>'utm_medium' AS utm_medium
      FROM public.external_tickets et
     WHERE et.buyer_email IS NOT NULL
       AND public._crm_ticket_is_sale(et.status, et.raw)
       AND ((p_venue_id IS NOT NULL AND et.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND et.organizer_user_id = p_organizer_user_id))
     ORDER BY lower(et.buyer_email), COALESCE(et.purchased_at, et.first_seen_at), et.id
  ), prof AS (
    -- Profil rapporté par Shotgun (âge, genre, ville, pays) : la valeur connue
    -- la plus récente de chaque acheteur (catalogue de segments, 20261008200000).
    SELECT lower(t.buyer_email) AS email,
           (array_agg(t.age ORDER BY COALESCE(t.purchased_at, t.first_seen_at) DESC)
              FILTER (WHERE t.age BETWEEN 12 AND 110))[1] AS age,
           (array_agg(t.gender ORDER BY COALESCE(t.purchased_at, t.first_seen_at) DESC)
              FILTER (WHERE t.gender IN ('female', 'male', 'other')))[1] AS gender,
           (array_agg(upper(btrim(t.country_code)) ORDER BY COALESCE(t.purchased_at, t.first_seen_at) DESC)
              FILTER (WHERE btrim(t.country_code) ~* '^[a-z]{2}$'))[1] AS country,
           (array_agg(btrim(t.city) ORDER BY COALESCE(t.purchased_at, t.first_seen_at) DESC)
              FILTER (WHERE NULLIF(btrim(t.city), '') IS NOT NULL))[1] AS city
      FROM public.external_tickets t
     WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
       AND t.buyer_email IS NOT NULL
       AND (t.age IS NOT NULL OR t.gender IS NOT NULL OR t.country_code IS NOT NULL OR t.city IS NOT NULL)
     GROUP BY 1
  ), page_first AS (
    -- Première inscription CONFIRMÉE par une page d'inscription de la portée.
    SELECT lower(e.email) AS email, min(e.created_at) AS at
      FROM public.crm_signup_entries e
      JOIN public.crm_signup_pages pg ON pg.id = e.page_id
     WHERE e.email IS NOT NULL AND e.confirmed_at IS NOT NULL AND e.created_at <= v_at
       AND pg.venue_id IS NOT DISTINCT FROM p_venue_id
       AND pg.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     GROUP BY 1
  ), fh AS (
    -- Historique d'un fichier importé (20261008210000).
    SELECT * FROM public._crm_file_history(p_venue_id, p_organizer_user_id, v_at)
  ), base AS (
    SELECT lower(c.email) AS email, c.first_name, c.last_name, c.phone_e164, c.email_ok, c.phone_ok,
           c.origin, COALESCE(c.added_at, c.created_at) AS added_at, c.eng_status, c.bounced,
           c.list_import_id,
           c.age AS f_age, c.gender AS f_gender, c.country_code AS f_country,
           NULLIF(btrim(c.city), '') AS f_city, NULLIF(btrim(c.zone), '') AS f_zone
      FROM _cr c
     WHERE c.email IS NOT NULL
       AND COALESCE(c.added_at, c.created_at, '-infinity'::timestamptz) <= v_at
  )
  SELECT b.email, b.first_name, b.last_name, b.phone_e164 AS phone, b.email_ok, b.phone_ok, b.origin,
         b.added_at, b.eng_status, COALESCE(b.bounced, false) AS bounced, b.list_import_id,
         -- Soirées, dépense, dates : billets Shotgun ET historique des fichiers (voir `h`).
         h.nights::int AS nights, COALESCE(a.nights_win, 0)::int AS nights_win,
         h.first_night, h.last_night, round(h.spent, 2) AS spent,
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
           WHEN h.nights = 0 THEN CASE WHEN y.first_buy IS NOT NULL THEN 'nou' ELSE 'none' END
           -- A repris une place : il n'a pas décroché.
           WHEN h.last_night < v_at - make_interval(months => v_rules.lapse_months)
                AND NOT COALESCE(y.upcoming, false) THEN 'end'
           -- « Habitué » se prouve par des soirées DATÉES (billets) : un total de
           -- fichier ne dit pas combien tombent dans la fenêtre.
           WHEN a.nights_win >= v_rules.regular_min_nights THEN 'hab'
           WHEN h.first_night >= v_at - interval '90 days' THEN 'nou'
           ELSE 'occ' END AS lifecycle,
         n.tags, n.note,
         h.paid_n::int AS paid_n,
         COALESCE(g.gl_n, 0)::int AS gl_n,
         COALESCE(g.gl_came, 0)::int AS gl_came,
         g.gl_first,
         COALESCE(g.gl_events, '{}'::uuid[]) AS gl_events,
         COALESCE(g.gl_noshow, 0)::int AS gl_noshow,
         -- Devenu client : premier billet PAYANT acheté après sa première soirée en guest list.
         (g.gl_first IS NOT NULL AND y.first_paid IS NOT NULL AND y.first_paid > g.gl_first) AS gl_conv,
         -- Catalogue de segments (20261008200000) : profil (Shotgun d'abord, puis
         -- vos fichiers), place pour une soirée à venir, dépense par soirée payée.
         COALESCE(pr.age, CASE WHEN b.f_age BETWEEN 12 AND 110 THEN b.f_age END) AS age,
         COALESCE(pr.gender, CASE WHEN b.f_gender IN ('female', 'male', 'other') THEN b.f_gender END) AS gender,
         COALESCE(pr.country, CASE WHEN btrim(b.f_country) ~* '^[a-z]{2}$' THEN upper(btrim(b.f_country)) END) AS country,
         COALESCE(pr.city, b.f_city, b.f_zone) AS area,
         public._crm_area_key(COALESCE(pr.city, b.f_city, b.f_zone)) AS area_key,
         (COALESCE(y.upcoming, false) OR COALESCE(g.gl_upcoming, false)) AS upcoming,
         CASE WHEN h.paid_n > 0 THEN round(h.spent / h.paid_n, 2) END AS basket,
         -- Ce que dit le fichier, et comment il a compté (fiche client).
         f.f_nights AS hist_nights, f.f_spent AS hist_spent, f.f_last AS hist_last, m.mode AS hist_mode, f.f_list AS hist_list,
         -- Analyse client (20261010110000) : clés de filtre pré-calculées.
         COALESCE(ap.tags, '{}'::text[]) AS an_tags, ap.dist_km AS an_dist_km
    FROM base b
    LEFT JOIN agg a ON a.email = b.email
    LEFT JOIN buy y ON y.email = b.email
    LEFT JOIN gl g ON g.email = b.email
    LEFT JOIN first_utm u ON u.email = b.email
    LEFT JOIN page_first pf ON pf.email = b.email
    LEFT JOIN prof pr ON pr.email = b.email
    LEFT JOIN fh f ON f.email = b.email
    LEFT JOIN public.crm_person_profile ap ON ap.scope_key = v_scope AND ap.email = b.email
    -- Comment l'historique d'un fichier compte :
    --   'added' — il précède le premier billet Shotgun (deux billetteries, ou
    --             pas encore de Shotgun) : les deux s'additionnent ;
    --   'file' / 'live' — les deux se recouvrent (un export de la même
    --             billetterie réimporté) : la source qui connaît le plus de
    --             soirées, JAMAIS la somme (pas de double compte).
    CROSS JOIN LATERAL (
      SELECT CASE WHEN f.email IS NULL THEN NULL
                  WHEN y.first_buy IS NULL OR f.f_asof < y.first_buy - interval '2 days' THEN 'added'
                  WHEN f.f_nights > COALESCE(a.nights, 0) THEN 'file'
                  ELSE 'live' END AS mode
    ) m
    CROSS JOIN LATERAL (
      SELECT CASE m.mode WHEN 'added' THEN COALESCE(a.nights, 0) + f.f_nights WHEN 'file' THEN f.f_nights ELSE COALESCE(a.nights, 0) END AS nights,
             CASE m.mode WHEN 'added' THEN COALESCE(y.spent, 0) + f.f_spent WHEN 'file' THEN f.f_spent ELSE COALESCE(y.spent, 0) END AS spent,
             CASE m.mode WHEN 'added' THEN COALESCE(y.paid_n, 0) + f.f_paid WHEN 'file' THEN f.f_paid ELSE COALESCE(y.paid_n, 0) END AS paid_n,
             CASE WHEN m.mode IS NULL THEN a.last_night ELSE GREATEST(a.last_night, f.f_last) END AS last_night,
             CASE WHEN m.mode IS NULL THEN a.first_night ELSE LEAST(a.first_night, f.f_first) END AS first_night
    ) h
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

  -- Un nombre illisible ne retire plus la condition (le segment devenait
  -- « tout le monde ») : il ne garde personne.
  v := f->>'last_gt_days';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,4}$'
      THEN format('%s.last_night < now() - make_interval(days => %s)', a, v) ELSE 'false' END);
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
      WHEN 'never_sent' THEN format('%s.msg_n = 0', a)
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

  -- ── Catalogue de segments (20261008200000). Valeur illisible ⇒ personne. ──
  v := f->>'nb_min';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,4}$' THEN format('%s.nights >= %s', a, v) ELSE 'false' END);
  END IF;
  v := f->>'nb_max';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,4}$' THEN format('%s.nights <= %s', a, v) ELSE 'false' END);
  END IF;
  -- Venu il y a moins de N jours.
  v := f->>'last_lt_days';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,4}$'
      THEN format('%s.last_night >= now() - make_interval(days => %s)', a, v) ELSE 'false' END);
  END IF;
  v := f->>'sp_min';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,7}(\.[0-9]{1,2})?$' THEN format('%s.spent >= %s', a, v) ELSE 'false' END);
  END IF;
  -- Dépense par soirée payée (personne sans billet payant : aucune valeur, jamais retenue).
  v := f->>'basket_min';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,7}(\.[0-9]{1,2})?$' THEN format('%s.basket >= %s', a, v) ELSE 'false' END);
  END IF;
  v := f->>'paid_min';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,4}$' THEN format('%s.paid_n >= %s', a, v) ELSE 'false' END);
  END IF;
  -- Âge et genre : une personne dont on ne connaît pas l'âge n'entre dans aucune tranche.
  v := f->>'age_min';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,3}$' THEN format('%s.age >= %s', a, v) ELSE 'false' END);
  END IF;
  v := f->>'age_max';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,3}$' THEN format('%s.age <= %s', a, v) ELSE 'false' END);
  END IF;
  v := f->>'gender';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v IN ('female', 'male', 'other') THEN format('%s.gender = %L', a, v) ELSE 'false' END);
  END IF;
  -- Ville (clé de _crm_area_key) et pays (ISO 2).
  IF jsonb_typeof(f->'area') = 'array' AND jsonb_array_length(f->'area') > 0 THEN
    SELECT string_agg(format('%L', public._crm_area_key(x)), ',') INTO lst
      FROM jsonb_array_elements_text(f->'area') x WHERE public._crm_area_key(x) IS NOT NULL;
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.area_key IN (%s)', a, lst) END);
  END IF;
  IF jsonb_typeof(f->'country') = 'array' AND jsonb_array_length(f->'country') > 0 THEN
    SELECT string_agg(format('%L', upper(btrim(x))), ',') INTO lst
      FROM jsonb_array_elements_text(f->'country') x WHERE btrim(x) ~* '^[a-z]{2}$';
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.country IN (%s)', a, lst) END);
  END IF;
  v := f->>'country_not';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN btrim(v) ~* '^[a-z]{2}$'
      THEN format('(%s.country IS NOT NULL AND %s.country <> %L)', a, a, upper(btrim(v))) ELSE 'false' END);
  END IF;
  -- Place (billet ou invitation) pour une soirée qui n'a pas encore commencé.
  v := f->>'up';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN 'yes' THEN format('%s.upcoming', a)
      WHEN 'no' THEN format('NOT %s.upcoming', a)
      ELSE 'false' END);
  END IF;
  -- A cliqué sur un lien d'un e-mail il y a moins de N jours.
  v := f->>'click_lt_days';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,4}$'
      THEN format('%s.last_click >= now() - make_interval(days => %s)', a, v) ELSE 'false' END);
  END IF;
  -- Canaux joignables ensemble ou seuls.
  v := f->>'ch';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN 'both' THEN format('(%s.email_ok AND %s.phone_ok)', a, a)
      WHEN 'email_only' THEN format('(%s.email_ok AND NOT %s.phone_ok)', a, a)
      WHEN 'sms_only' THEN format('(%s.phone_ok AND NOT %s.email_ok)', a, a)
      ELSE 'false' END);
  END IF;

  -- ── Analyse client (20261010110000) : clés pré-calculées (crm_person_profile.tags).
  --    Valeur illisible ⇒ personne. Un contact sans profil (fichier seul) n'a
  --    aucune clé : il n'entre dans aucun de ces filtres.
  IF jsonb_typeof(f->'hyp') = 'array' AND jsonb_array_length(f->'hyp') > 0 THEN
    SELECT string_agg(format('%L', 'h:' || x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'hyp') x WHERE x ~ '^[a-z_]{2,24}$';
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  IF jsonb_typeof(f->'artist') = 'array' AND jsonb_array_length(f->'artist') > 0 THEN
    SELECT string_agg(format('%L', 'a:' || x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'artist') x WHERE x ~ '^(id|slug|name):.{1,160}$';
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  IF jsonb_typeof(f->'genre') = 'array' AND jsonb_array_length(f->'genre') > 0 THEN
    SELECT string_agg(format('%L', 'g:' || lower(btrim(x))), ',') INTO lst
      FROM jsonb_array_elements_text(f->'genre') x WHERE length(btrim(x)) BETWEEN 1 AND 60;
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  IF jsonb_typeof(f->'fmt') = 'array' AND jsonb_array_length(f->'fmt') > 0 THEN
    SELECT string_agg(format('%L', 'fmt:' || lower(btrim(x))), ',') INTO lst
      FROM jsonb_array_elements_text(f->'fmt') x WHERE length(btrim(x)) BETWEEN 1 AND 40;
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  IF jsonb_typeof(f->'series') = 'array' AND jsonb_array_length(f->'series') > 0 THEN
    SELECT string_agg(format('%L', 's:' || lower(btrim(x))), ',') INTO lst
      FROM jsonb_array_elements_text(f->'series') x WHERE length(btrim(x)) BETWEEN 1 AND 300;
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  IF jsonb_typeof(f->'buy') = 'array' AND jsonb_array_length(f->'buy') > 0 THEN
    SELECT string_agg(format('%L', 'b:' || x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'buy') x WHERE x IN ('early', 'launch', 'last_minute', 'door');
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  v := f->>'grp';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v IN ('group', 'solo', 'brought')
      THEN format('%L = ANY (%s.an_tags)', 'grp:' || v, a) ELSE 'false' END);
  END IF;
  IF jsonb_typeof(f->'arr') = 'array' AND jsonb_array_length(f->'arr') > 0 THEN
    SELECT string_agg(format('%L', 'ch:' || x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'arr') x
     WHERE x IN ('ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'so', 'sg', 'au', 'di', 'of', 'gl');
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  v := f->>'dist_min';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,5}$' THEN format('%s.an_dist_km >= %s', a, v) ELSE 'false' END);
  END IF;
  v := f->>'dist_max';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,5}$' THEN format('%s.an_dist_km <= %s', a, v) ELSE 'false' END);
  END IF;
  v := f->>'pass';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN 'yes' THEN format('''pass'' = ANY (%s.an_tags)', a)
      WHEN 'no' THEN format('''loc'' = ANY (%s.an_tags)', a)
      ELSE 'false' END);
  END IF;

  -- « Qui cibler » (20261011110000) : une audience d'une soirée à venir, lue par
  -- la même porte que la RPC crm_night_targets. La portée vient de
  -- _crm_people_build ; une soirée hors de la portée rend personne.
  IF jsonb_typeof(f->'ntgt') = 'object' THEN
    parts := array_append(parts, CASE
      WHEN f->'ntgt'->>'e' ~* '^[0-9a-f-]{36}$'
       AND f->'ntgt'->>'a' IN ('concept', 'lineup', 'genre', 'early', 'last_minute', 'once_local')
      THEN format('%s.email IN (SELECT tg.email FROM public._crm_night_target_set(current_setting(''yuno.crm_scope'', true), %L::uuid, %L) tg)',
                  a, f->'ntgt'->>'e', f->'ntgt'->>'a')
      ELSE 'false' END);
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

-- ── La porte unique : qui est dans une audience d'une soirée à venir ─────────
-- Toutes les audiences écartent ceux qui ont déjà une place pour la soirée
-- (billet valide ou transféré, invitation comprise). Une soirée hors de la
-- portée, passée, annulée ou qui n'est pas une soirée miroir rend personne.
CREATE OR REPLACE FUNCTION public._crm_night_target_set(p_scope text, p_event uuid, p_aud text)
 RETURNS TABLE(email text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  e        record;
  v_series text;
  v_arts   text[];
  v_genres text[];
  v_res    numeric := COALESCE((public.crm_analysis_config()->'rarity'->>'resident_share')::numeric, 0.2);
BEGIN
  IF p_scope IS NULL OR p_scope = '' OR p_event IS NULL THEN RETURN; END IF;
  SELECT ev.id, ev.title, ev.start_at, x.artists, x.genres INTO e
    FROM public.events ev
    LEFT JOIN public.external_events x ON x.event_id = ev.id
   WHERE ev.id = p_event AND ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL
     AND COALESCE(ev.end_at, ev.start_at + interval '6 hours') > now()
     AND (p_scope = 'venue:' || ev.venue_id OR p_scope = 'org:' || ev.organizer_user_id::text)
   LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  v_series := public._crm_night_series(e.title);
  SELECT array_agg(DISTINCT 'a:' || k) INTO v_arts
    FROM (SELECT public._crm_artist_key(a) AS k FROM jsonb_array_elements(COALESCE(e.artists, '[]'::jsonb)) a) z
   WHERE z.k IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.crm_artist_stats s
                      WHERE s.scope_key = p_scope AND s.artist_key = z.k AND s.share > v_res);
  SELECT array_agg(DISTINCT lower(btrim(g))) INTO v_genres
    FROM unnest(COALESCE(e.genres, '{}'::text[])) g WHERE btrim(g) <> '';

  RETURN QUERY
  WITH has AS (
    SELECT DISTINCT lower(t.buyer_email) AS em
      FROM public.external_tickets t
     WHERE t.event_id = p_event AND t.status IN ('valid', 'transferred') AND t.buyer_email IS NOT NULL
  )
  SELECT p.email
    FROM public.crm_person_profile p
   WHERE p.scope_key = p_scope
     AND NOT EXISTS (SELECT 1 FROM has WHERE has.em = p.email)
     AND CASE p_aud
       WHEN 'concept' THEN v_series IS NOT NULL AND ('s:' || lower(v_series)) = ANY (p.tags)
       WHEN 'lineup' THEN v_arts IS NOT NULL AND p.tags && v_arts
       WHEN 'genre' THEN v_genres IS NOT NULL AND p.nights >= 2
                         AND COALESCE((p.agg->'genres'->0->>'n')::int, 0) >= 2
                         AND (p.agg->'genres'->0->>'v') = ANY (v_genres)
       WHEN 'early' THEN p.tags && ARRAY['b:early', 'b:launch']::text[]
       WHEN 'last_minute' THEN 'b:last_minute' = ANY (p.tags)
       WHEN 'once_local' THEN p.nights = 1 AND 'loc' = ANY (p.tags)
       ELSE false END;
END;
$function$;

REVOKE ALL ON FUNCTION public._crm_night_target_set(text, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- ── « Qui cibler » : l'onglet du tiroir d'une soirée à venir ─────────────────
CREATE OR REPLACE FUNCTION public.crm_night_targets(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope  text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  e        record;
  v_tz     text;
  v_local  date;
  v_series text;
  v_res    numeric := COALESCE((public.crm_analysis_config()->'rarity'->>'resident_share')::numeric, 0.2);
  v_eve    timestamptz;
  v_week   timestamptz;
  v_out    jsonb;
  v_auds   jsonb;
  v_union  jsonb;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT ev.id, ev.title, ev.start_at, ev.end_at, ev.timezone, x.artists, x.genres INTO e
    FROM public.events ev
    LEFT JOIN public.external_events x ON x.event_id = ev.id
   WHERE ev.id = p_event_id AND ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL
     AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
       OR (p_venue_id IS NULL AND p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'event_not_found');
  END IF;
  IF COALESCE(e.end_at, e.start_at + interval '6 hours') <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_upcoming');
  END IF;

  v_tz := COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris');
  v_local := (e.start_at AT TIME ZONE v_tz)::date;
  v_series := public._crm_night_series(e.title);
  -- Moments conseillés : la veille à 18 h (heure de la soirée), la semaine
  -- d'avant à 18 h ; jamais dans le passé.
  v_eve := GREATEST(now(), ((v_local - 1)::timestamp + time '18:00') AT TIME ZONE v_tz);
  v_week := GREATEST(now(), ((v_local - 7)::timestamp + time '18:00') AT TIME ZONE v_tz);

  -- Joignables : la même base que l'envoi (consentements e-mail et SMS).
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id);

  DROP TABLE IF EXISTS _ntg;
  CREATE TEMP TABLE _ntg ON COMMIT DROP AS
  SELECT a.aud, t.email
    FROM unnest(ARRAY['concept', 'lineup', 'genre', 'early', 'last_minute', 'once_local']) a(aud)
   CROSS JOIN LATERAL public._crm_night_target_set(v_scope, p_event_id, a.aud) t;

  WITH counts AS (
    SELECT g.aud, count(*)::int AS n,
           count(*) FILTER (WHERE c.email_ok)::int AS email,
           count(*) FILTER (WHERE c.phone_ok)::int AS sms
      FROM _ntg g LEFT JOIN _cp c ON c.email = g.email
     GROUP BY g.aud
  ), fam AS (
    SELECT a.aud, a.family, a.moment
      FROM (VALUES ('concept', 'series', 'now'), ('lineup', 'artist', 'now'), ('genre', 'genre', 'week'),
                   ('early', 'early', 'now'), ('last_minute', 'last_minute', 'eve'), ('once_local', NULL, 'week')) a(aud, family, moment)
  )
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'key', f.aud,
           'n', COALESCE(c.n, 0), 'email', COALESCE(c.email, 0), 'sms', COALESCE(c.sms, 0),
           'family', f.family,
           'status', s.status, 'availability', s.availability, 'gain', s.gain,
           'moment', f.moment,
           'send_at', CASE f.moment WHEN 'eve' THEN v_eve WHEN 'week' THEN v_week ELSE now() END,
           'params', CASE f.aud
             WHEN 'concept' THEN jsonb_build_object('series', v_series,
               'editions', (SELECT count(*) FROM public.crm_night_profile np
                             WHERE np.scope_key = v_scope AND lower(np.series) = lower(v_series) AND np.starts_at < now()))
             WHEN 'lineup' THEN jsonb_build_object('artists', (
               SELECT COALESCE(jsonb_agg(jsonb_build_object('name', z.name, 'n', z.n) ORDER BY z.n DESC, z.name), '[]'::jsonb)
                 FROM (SELECT COALESCE(a->>'name', z0.k) AS name,
                              (SELECT count(*) FROM _ntg g JOIN public.crm_person_profile p ON p.scope_key = v_scope AND p.email = g.email
                                WHERE g.aud = 'lineup' AND ('a:' || z0.k) = ANY (p.tags))::int AS n
                         FROM jsonb_array_elements(COALESCE(e.artists, '[]'::jsonb)) a
                         CROSS JOIN LATERAL (SELECT public._crm_artist_key(a) AS k) z0
                        WHERE z0.k IS NOT NULL
                          AND NOT EXISTS (SELECT 1 FROM public.crm_artist_stats st
                                           WHERE st.scope_key = v_scope AND st.artist_key = z0.k AND st.share > v_res)) z
                WHERE z.n > 0))
             WHEN 'genre' THEN jsonb_build_object('genres', to_jsonb(COALESCE(e.genres, '{}'::text[])))
           END)) ORDER BY
             CASE WHEN s.status = 'supported' AND s.availability IN ('ok', 'reduced') THEN 0 ELSE 1 END,
             COALESCE(c.n, 0) DESC), '[]'::jsonb)
    INTO v_auds
    FROM fam f
    LEFT JOIN counts c ON c.aud = f.aud
    LEFT JOIN LATERAL (
      SELECT fs.status, fs.availability, fs.gain FROM public.crm_family_status fs
       WHERE fs.scope_key = v_scope AND fs.family = f.family AND COALESCE(fs.variant, '') = '' LIMIT 1) s ON true;

  SELECT jsonb_build_object('n', count(*), 'email', count(*) FILTER (WHERE c.email_ok), 'sms', count(*) FILTER (WHERE c.phone_ok))
    INTO v_union
    FROM (SELECT DISTINCT email FROM _ntg) g LEFT JOIN _cp c ON c.email = g.email;

  v_out := jsonb_build_object('ok', true,
    'event', jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'series', v_series,
                                'genres', to_jsonb(COALESCE(e.genres, '{}'::text[]))),
    'days_left', GREATEST(0, v_local - (now() AT TIME ZONE v_tz)::date),
    'has_ticket', (SELECT count(DISTINCT lower(t.buyer_email)) FROM public.external_tickets t
                    WHERE t.event_id = p_event_id AND t.status IN ('valid', 'transferred') AND t.buyer_email IS NOT NULL),
    'computed', EXISTS (SELECT 1 FROM public.crm_analysis_state st WHERE st.scope_key = v_scope),
    'union', v_union,
    'audiences', v_auds);
  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_night_targets(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_night_targets(text, uuid, uuid) TO authenticated, service_role;
