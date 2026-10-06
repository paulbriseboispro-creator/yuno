-- ============================================================================
-- Yuno CRM — le catalogue de segments (2026-10-06).
-- Conception : docs/designs/CRM_SEGMENT_CATALOG.md.
--
-- La Console CRM ne proposait que neuf modèles de segment, quand la Billetterie
-- en propose une trentaine à l'import (géographie, âge, genre, dépense,
-- fréquence, récence, canal…). Cette migration donne au CRM la même variété,
-- sur SES données : billets Shotgun, profil que Shotgun rapporte, fichiers
-- importés, mesures Yuno (e-mails, pages d'inscription, liens).
--
-- 1. `_crm_area_key(texte)` : clé d'une ville (minuscules, sans accents, sans
--    code postal ni arrondissement) — « 75011 Paris », « Paris 11e » → « paris ».
-- 2. Registre des personnes (_crm_people_build) : sept colonnes de plus, à la
--    fin de `_cp` — age, gender, country (ISO 2), area (ville affichée),
--    area_key, upcoming (billet ou invitation pour une soirée pas encore
--    commencée), basket (dépense par soirée payée). Profil : la dernière valeur
--    rapportée par Shotgun d'abord, sinon celle de vos fichiers. Rien d'autre ne
--    change (cycle de vie, soirées, dépense : mêmes règles).
-- 3. Filtres (_crm_filter_sql) : nb_min, nb_max, last_lt_days, sp_min,
--    basket_min, paid_min, age_min, age_max, gender, area[], country[],
--    country_not, up (yes|no), click_lt_days, ch (both|email_only|sms_only),
--    msg = never_sent. Valeur illisible ⇒ personne (jamais « tout le monde ») ;
--    last_gt_days suit désormais la même règle.
-- 4. crm_segment_catalog : effectifs de tous les modèles en UNE lecture, plus les
--    modèles qui dépendent des données (meilleurs clients, panier, villes, pays).
-- 5. crm_segments_create_many : la fenêtre de fin d'import crée plusieurs
--    segments d'un coup, sans jamais doubler un modèle déjà créé.
-- 6. Accueil (crm_home__core) : tâche « Choisir vos segments » tant que
--    l'espace n'a aucun segment à lui et compte au moins 10 contacts.
-- Corps de _crm_people_build, _crm_filter_sql, crm_home__core et
-- demo_preview_writable_rpc repris de la base liée (pg_get_functiondef, 06/10) ;
-- seules les lignes citées changent. Les signatures existantes ne changent pas.
-- ============================================================================

-- ── 1. Clé d'une ville ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._crm_area_key(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(btrim(regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(lower(public.unaccent_safe(btrim(COALESCE(p, '')))), '[-_''’.,/()]+', ' ', 'g'),
               '^[0-9]{4,5}\s+', ''),
             '\s+([0-9]{4,5}|cedex(\s+[0-9]+)?|[0-9]{1,2}\s*(e|er|eme)?(\s+arr(ondissement)?)?)\s*$', ''),
           '\s+', ' ', 'g')), '');
$$;
REVOKE ALL ON FUNCTION public._crm_area_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_area_key(text) TO service_role;

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
    SELECT DISTINCT ON (lower(et.buyer_email)) lower(et.buyer_email) AS email,
           et.utm->>'utm_source' AS utm_source, et.utm->>'utm_medium' AS utm_medium
      FROM public.external_tickets et
     WHERE et.buyer_email IS NOT NULL
       AND ((p_venue_id IS NOT NULL AND et.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND et.organizer_user_id = p_organizer_user_id))
     ORDER BY lower(et.buyer_email), COALESCE(et.purchased_at, et.first_seen_at)
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
         (g.gl_first IS NOT NULL AND y.first_paid IS NOT NULL AND y.first_paid > g.gl_first) AS gl_conv,
         -- Catalogue de segments (20261008200000) : profil (Shotgun d'abord, puis
         -- vos fichiers), place pour une soirée à venir, dépense par soirée payée.
         COALESCE(pr.age, CASE WHEN b.f_age BETWEEN 12 AND 110 THEN b.f_age END) AS age,
         COALESCE(pr.gender, CASE WHEN b.f_gender IN ('female', 'male', 'other') THEN b.f_gender END) AS gender,
         COALESCE(pr.country, CASE WHEN btrim(b.f_country) ~* '^[a-z]{2}$' THEN upper(btrim(b.f_country)) END) AS country,
         COALESCE(pr.city, b.f_city, b.f_zone) AS area,
         public._crm_area_key(COALESCE(pr.city, b.f_city, b.f_zone)) AS area_key,
         (COALESCE(y.upcoming, false) OR COALESCE(g.gl_upcoming, false)) AS upcoming,
         CASE WHEN COALESCE(y.paid_n, 0) > 0 THEN round(y.spent / y.paid_n, 2) END AS basket
    FROM base b
    LEFT JOIN agg a ON a.email = b.email
    LEFT JOIN buy y ON y.email = b.email
    LEFT JOIN gl g ON g.email = b.email
    LEFT JOIN first_utm u ON u.email = b.email
    LEFT JOIN page_first pf ON pf.email = b.email
    LEFT JOIN prof pr ON pr.email = b.email
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

-- ── 3. Filtres Clients / segments ────────────────────────────────────────────
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

-- ── 4. Catalogue : effectifs de tous les modèles, en un passage ──────────────
-- p_items : les modèles fixes du front ([{key, def}], 60 au plus, clé
-- ^[a-z0-9_]+$). Le serveur y ajoute les modèles qui dépendent des données :
--   spend_top    meilleurs clients, seuil = 90e centile de la dépense des
--                payeurs (20 payeurs au moins), arrondi ;
--   basket_high  dépense par soirée payée, seuil = 3e quartile (même garde) ;
--   geo_area:<k> les six villes les plus fréquentes (10 personnes au moins) ;
--   geo_abroad   hors du pays le plus fréquent (10 pays connus au moins) ;
--   geo_country:<cc> les trois pays étrangers les plus fréquents (10 au moins).
-- Chaque modèle rend son effectif et ses joignables (e-mail ou SMS accepté).
CREATE OR REPLACE FUNCTION public._crm_nice_amount(p numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p IS NULL OR p <= 0 THEN NULL
              WHEN p < 20 THEN GREATEST(1, round(p))
              WHEN p < 100 THEN round(p / 5) * 5
              WHEN p < 500 THEN round(p / 10) * 10
              ELSE round(p / 50) * 50 END;
$$;
REVOKE ALL ON FUNCTION public._crm_nice_amount(numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_nice_amount(numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_segment_catalog(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_total integer; v_reach integer; v_payers integer;
  v_age integer; v_gender integer; v_area integer; v_country integer; v_msg boolean;
  v_sp90 numeric; v_bk75 numeric; v_home text; v_next boolean;
  v_items jsonb := '[]'::jsonb;
  v_sql text;
  v_cnt bigint[];
  v_out jsonb := '[]'::jsonb;
  r record;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);

  SELECT count(*), count(*) FILTER (WHERE p.email_ok OR p.phone_ok), count(*) FILTER (WHERE p.spent > 0),
         count(*) FILTER (WHERE p.age IS NOT NULL), count(*) FILTER (WHERE p.gender IN ('female', 'male')),
         count(*) FILTER (WHERE p.area_key IS NOT NULL), count(*) FILTER (WHERE p.country IS NOT NULL),
         COALESCE(bool_or(p.msg_n > 0), false)
    INTO v_total, v_reach, v_payers, v_age, v_gender, v_area, v_country, v_msg
    FROM _cp p;

  IF v_payers >= 20 THEN
    SELECT public._crm_nice_amount((percentile_cont(0.9) WITHIN GROUP (ORDER BY p.spent))::numeric)
      INTO v_sp90 FROM _cp p WHERE p.spent > 0;
    SELECT public._crm_nice_amount((percentile_cont(0.75) WITHIN GROUP (ORDER BY p.basket))::numeric)
      INTO v_bk75 FROM _cp p WHERE p.basket > 0;
  END IF;
  IF v_country >= 10 THEN
    SELECT p.country INTO v_home FROM _cp p WHERE p.country IS NOT NULL
     GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1;
  END IF;
  -- Une soirée de la billetterie connectée qui n'a pas encore commencé.
  SELECT EXISTS (
    SELECT 1 FROM public.events e
     WHERE ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.external_source IS NOT NULL AND e.start_at > now()
  ) INTO v_next;

  -- Modèles fixes du front.
  FOR r IN
    SELECT e.x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_items) = 'array' THEN p_items ELSE '[]'::jsonb END)
           WITH ORDINALITY AS e(x, ord)
     ORDER BY e.ord LIMIT 60
  LOOP
    IF COALESCE(r.x->>'key', '') ~ '^[a-z0-9_]{1,40}$' AND jsonb_typeof(r.x->'def') = 'object' THEN
      v_items := v_items || jsonb_build_array(jsonb_build_object('key', r.x->>'key', 'def', r.x->'def', 'params', '{}'::jsonb));
    END IF;
  END LOOP;

  -- Modèles calculés sur les données.
  IF v_sp90 IS NOT NULL THEN
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'spend_top',
      'def', jsonb_build_object('seg', 'all', 'f', jsonb_build_object('sp_min', v_sp90)),
      'params', jsonb_build_object('threshold', v_sp90)));
  END IF;
  IF v_bk75 IS NOT NULL THEN
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'basket_high',
      'def', jsonb_build_object('seg', 'all', 'f', jsonb_build_object('basket_min', v_bk75)),
      'params', jsonb_build_object('threshold', v_bk75)));
  END IF;
  FOR r IN
    SELECT p.area_key AS k, mode() WITHIN GROUP (ORDER BY p.area) AS label
      FROM _cp p WHERE p.area_key IS NOT NULL
     GROUP BY p.area_key HAVING count(*) >= 10
     ORDER BY count(*) DESC, p.area_key LIMIT 6
  LOOP
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'geo_area:' || r.k,
      'def', jsonb_build_object('seg', 'all', 'f', jsonb_build_object('area', jsonb_build_array(r.k))),
      'params', jsonb_build_object('area', r.label)));
  END LOOP;
  IF v_home IS NOT NULL THEN
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'geo_abroad',
      'def', jsonb_build_object('seg', 'all', 'f', jsonb_build_object('country_not', v_home)),
      'params', jsonb_build_object('home', v_home)));
    FOR r IN
      SELECT p.country AS c FROM _cp p WHERE p.country IS NOT NULL AND p.country <> v_home
       GROUP BY 1 HAVING count(*) >= 10 ORDER BY count(*) DESC, 1 LIMIT 3
    LOOP
      v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'geo_country:' || lower(r.c),
        'def', jsonb_build_object('seg', 'all', 'f', jsonb_build_object('country', jsonb_build_array(r.c))),
        'params', jsonb_build_object('code', r.c)));
    END LOOP;
  END IF;

  -- Tous les effectifs en une lecture de la base.
  IF jsonb_array_length(v_items) > 0 THEN
    SELECT string_agg(format('count(*) FILTER (WHERE %1$s), count(*) FILTER (WHERE (%1$s) AND (p.email_ok OR p.phone_ok))',
                             public._crm_filter_sql(e.x->'def', 'p')), ', ' ORDER BY e.ord)
      INTO v_sql
      FROM jsonb_array_elements(v_items) WITH ORDINALITY AS e(x, ord);
    EXECUTE 'SELECT ARRAY[' || v_sql || ']::bigint[] FROM _cp p' INTO v_cnt;
    SELECT jsonb_agg(e.x || jsonb_build_object('n', v_cnt[(2 * e.ord - 1)::int], 'reachable', v_cnt[(2 * e.ord)::int]) ORDER BY e.ord)
      INTO v_out
      FROM jsonb_array_elements(v_items) WITH ORDINALITY AS e(x, ord);
  END IF;

  RETURN jsonb_build_object(
    'total', v_total,
    'reachable', v_reach,
    'payers', v_payers,
    'coverage', jsonb_build_object('age', v_age, 'gender', v_gender, 'area', v_area, 'country', v_country),
    'home', v_home,
    'has_next_event', v_next,
    'has_messages', v_msg,
    'items', COALESCE(v_out, '[]'::jsonb),
    'existing', COALESCE((SELECT jsonb_agg(DISTINCT s.template) FROM public.crm_segments s
                           WHERE s.scope_key = v_scope AND s.template IS NOT NULL), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.crm_segment_catalog(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_segment_catalog(text, uuid, jsonb) TO authenticated, service_role;

-- ── 5. Création de plusieurs segments d'un coup ──────────────────────────────
-- Un modèle déjà créé dans l'espace (même `template`) est sauté, jamais doublé :
-- deux clics ou deux onglets ne font pas deux segments (verrou par espace).
CREATE OR REPLACE FUNCTION public.crm_segments_create_many(
  p_venue_id text, p_organizer_user_id uuid, p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_tpl text;
  v_name text;
  v_id uuid;
  v_created jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  r record;
BEGIN
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 60 THEN
    RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm_segments:' || v_key, 0));

  FOR r IN SELECT e.x FROM jsonb_array_elements(p_items) WITH ORDINALITY AS e(x, ord) ORDER BY e.ord LOOP
    v_tpl := btrim(COALESCE(r.x->>'template', ''));
    v_name := left(btrim(COALESCE(r.x->>'name', '')), 80);
    IF v_tpl !~ '^[a-z0-9_]{1,40}(:.{1,100})?$' OR v_name = '' OR jsonb_typeof(r.x->'definition') IS DISTINCT FROM 'object' THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('template', v_tpl, 'why', 'invalid'));
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.crm_segments s WHERE s.scope_key = v_key AND s.template = v_tpl) THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('template', v_tpl, 'why', 'exists'));
      CONTINUE;
    END IF;
    INSERT INTO public.crm_segments (scope_key, venue_id, organizer_user_id, name, description, template, definition, created_by)
    VALUES (v_key, p_venue_id, p_organizer_user_id, v_name,
            NULLIF(left(btrim(COALESCE(r.x->>'description', '')), 400), ''), v_tpl, r.x->'definition', auth.uid())
    RETURNING id INTO v_id;
    v_created := v_created || jsonb_build_array(jsonb_build_object('template', v_tpl, 'id', v_id));
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'skipped', v_skipped);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_segments_create_many(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_segments_create_many(text, uuid, jsonb) TO authenticated, service_role;

-- ── 6. Accueil : la tâche « Choisir vos segments » ──────────────────────────
-- Corps repris de la base liée ; seul le bloc « Catalogue de segments » est ajouté.
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

    -- Catalogue de segments (20261008200000) : une base d'au moins 10 personnes
    -- et aucun segment à soi → « Choisir vos segments » (la fenêtre du catalogue).
    IF NOT EXISTS (SELECT 1 FROM public.crm_segments s WHERE s.scope_key = v_scope)
       AND COALESCE(v_n_contacts, 0) >= 10 THEN
      v_todo := v_todo || jsonb_build_object('id', 'segments', 'kind', 'segments', 'tone', 'wait', 'params', '{}'::jsonb);
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

-- La lecture du catalogue passe par des tables temporaires : ouverte en aperçu démo.
CREATE OR REPLACE FUNCTION public.demo_preview_writable_rpc(p_name text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT lower(coalesce(p_name, '')) = ANY (ARRAY[
    -- CTA « Activer mon compte » des sessions vitrine (seul canal d'écriture voulu)
    'request_showcase_claim',
    -- mesure d'audience / live view (battements, vues, clics)
    'ping_live_visitor', 'platform_heartbeat', 'track_platform_view',
    'track_links_event', 'ping_affiliate_live', 'flush_affiliate_session',
    'track_guest_artist_click',
    -- parcours client consultable depuis la démo (anti-flood, déverrouillage)
    'check_promo_code', 'unlock_event_sale', 'open_discovery_selection',
    -- écrans de lecture dont le calcul passe par une table temporaire / un cache
    'list_contact_base', 'count_contact_segment_def', 'analyze_contact_lists',
    'check_contact_import', 'get_contact_intelligence_overview',
    'get_contact_segment_panel', 'get_campaign_list_impact',
    'get_dj_audience', 'get_tracked_link_stats', 'get_user_nightlife_stats',
    'seed_event_tracked_links', 'seed_guest_list_tracked_links',
    'seed_venue_tracked_links', 'demo_is_live',
    -- composition d'un email (20260927162000) : rien de tout ça n'envoie
    'save_contact_segments', 'bump_email_template_usage',
    'refresh_contact_engagement', 'refresh_campaign_list_impacts',
    -- Console Yuno CRM : lectures calculées dans des tables temporaires
    'crm_home', 'crm_clients_overview', 'crm_clients_list', 'crm_client',
    'crm_audience_count', 'crm_audience_counts', 'crm_segments_brief',
    'crm_segments_overview', 'crm_segment_detail', 'crm_import_check',
    'crm_email_overview', 'crm_email_campaigns', 'crm_email_analysis',
    'crm_email_result', 'crm_email_result_segments', 'crm_email_recipients',
    'crm_email_recipient_emails', 'crm_email_send_options',
    'crm_email_audience_preview', 'crm_email_audience_sizes',
    'crm_night_detail', 'crm_rules_preview',
    'crm_ana_sales', 'crm_ana_traffic', 'crm_ana_community',
    'crm_journey', 'crm_automations',
    'crm_sms_overview', 'crm_sms_campaigns', 'crm_sms_result', 'crm_sms_analysis',
    'crm_sms_send_options', 'crm_sms_audience_preview', 'crm_sms_settings_get', 'crm_sms_draft_sizes',
    -- catalogue de segments (20261008200000)
    'crm_segment_catalog'
  ]::text[]);
$function$;

NOTIFY pgrst, 'reload schema';
