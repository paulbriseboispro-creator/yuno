-- ═══════════════════════════════════════════════════════════════════════════
-- Inscriptions pro (/admin/signups) : une PERSONNE par carte, plus un parcours.
--
-- Le 19/10, Pascal (Poupée) apparaissait 6 fois et Lillo Bacio 2 fois (dont
-- une « compte supprimé ») : chaque ligne `pro_signups` est un parcours, et un
-- pro qui recharge la page, revient par un autre lien ou retente faute d'entrer
-- dans sa Console en ouvre un nouveau à chaque fois. Paul ne comprenait plus
-- qui était qui.
--
-- Une personne = les parcours reliés par la même adresse e-mail, sinon le même
-- numéro (9 derniers chiffres : « 0756388760 » et « 756388760 » sont le même),
-- sinon le même appareil (`visitor_hash`, salé par jour : même IP et même
-- navigateur le même jour, ou le même compte connecté). Les liens se suivent de
-- proche en proche : un parcours anonyme du matin rejoint la personne qui a
-- laissé son e-mail sur le même téléphone dix minutes plus tard.
--
-- Toute l'histoire d'une personne compte (un compte ouvert il y a deux mois ne
-- devient pas « bloqué » parce qu'elle retente aujourd'hui) ; la période choisit
-- les personnes passées par le formulaire (ou dont le compte a été ouvert)
-- pendant la période. Le funnel, la courbe et les sources comptent des
-- PERSONNES, et l'écran le dit.
--
-- Réécrit depuis pg_get_functiondef de la prod (20261103410000, identique).
-- `admin_update_pro_signups` (nouveau) écrit « contacté » et la note sur tous
-- les parcours d'une personne ; `admin_update_pro_signup` reste (anciens
-- onglets ouverts).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_pro_signups(p_days integer DEFAULT 30, p_include_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_from timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 730)));
  v      jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  WITH RECURSIVE
  -- Tous les parcours (toute l'histoire), démo exclue. `mail` = l'adresse du
  -- parcours, sinon celle du compte ouvert (un parcours sans e-mail peut porter
  -- un compte : crm@womber.fr, 02/10).
  s AS MATERIALIZED (
    SELECT ps.*,
           coalesce(nullif(trim(ps.email), ''), u.email) AS mail,
           public._pro_signup_furthest_step(ps.steps) AS fs,
           (ps.offer_invite_id IS NOT NULL
             OR coalesce(ps.source, '') IN ('demo_preview', 'crm_invite')) AS invited,
           nullif(regexp_replace(coalesce(ps.phone, ''), '\D', '', 'g'), '') AS phone_digits
      FROM public.pro_signups ps
      LEFT JOIN auth.users u ON u.id = ps.user_id
     WHERE p_include_demo
        OR coalesce(nullif(trim(ps.email), ''), u.email) IS NULL
        OR NOT public.is_demo_email(coalesce(nullif(trim(ps.email), ''), u.email))
  ),
  -- Ce qui relie deux parcours. Un numéro fait d'un seul chiffre répété
  -- (« 0000000000 ») ne relie personne.
  k AS (
    SELECT s.id, x.key
      FROM s
     CROSS JOIN LATERAL (VALUES
       (CASE WHEN s.mail IS NOT NULL THEN 'e:' || lower(s.mail) END),
       (CASE WHEN length(s.phone_digits) >= 8 AND s.phone_digits !~ '^(\d)\1+$'
             THEN 'p:' || right(s.phone_digits, 9) END),
       (CASE WHEN s.visitor_hash IS NOT NULL THEN 'v:' || s.visitor_hash END)
     ) AS x(key)
     WHERE x.key IS NOT NULL
  ),
  edge AS (
    SELECT DISTINCT a.id AS a, b.id AS b FROM k a JOIN k b ON b.key = a.key
  ),
  -- Composantes connexes : chaque parcours atteint tous ceux de sa personne.
  reach(a, b) AS (
    SELECT edge.a, edge.b FROM edge
    UNION
    SELECT reach.a, edge.b FROM reach JOIN edge ON edge.a = reach.b
  ),
  pkmap AS (
    SELECT reach.a AS id, min(reach.b::text) AS pk FROM reach GROUP BY reach.a
  ),
  g AS MATERIALIZED (
    SELECT s.*, coalesce(pkmap.pk, s.id::text) AS pk
      FROM s LEFT JOIN pkmap ON pkmap.id = s.id
  ),
  prog AS (
    SELECT g.id,
           CASE
             WHEN g.kind = 'club' AND g.venue_id IS NOT NULL THEN
               (SELECT count(*) FROM public.events e WHERE e.venue_id = g.venue_id)
             WHEN g.kind = 'organizer' AND g.user_id IS NOT NULL THEN
               (SELECT count(*) FROM public.events e WHERE e.organizer_user_id = g.user_id)
             ELSE 0
           END AS events,
           CASE
             WHEN g.kind = 'club' AND g.venue_id IS NOT NULL THEN
               coalesce((SELECT vn.stripe_charges_enabled OR vn.stripe_onboarding_complete
                           FROM public.venues vn WHERE vn.id = g.venue_id), false)
             WHEN g.kind = 'organizer' AND g.user_id IS NOT NULL THEN
               coalesce((SELECT pr.stripe_connect_account_id IS NOT NULL
                           FROM public.profiles pr WHERE pr.id = g.user_id), false)
             ELSE false
           END AS payments,
           CASE
             WHEN g.kind = 'club' AND g.venue_id IS NOT NULL THEN
               coalesce((SELECT NOT vn.is_hidden FROM public.venues vn WHERE vn.id = g.venue_id), false)
             WHEN g.kind = 'organizer' AND g.user_id IS NOT NULL THEN
               EXISTS (SELECT 1 FROM public.events e
                        WHERE e.organizer_user_id = g.user_id AND e.published_at IS NOT NULL)
             ELSE false
           END AS live
      FROM g
     WHERE g.user_id IS NOT NULL
  ),
  j AS MATERIALIZED (
    SELECT g.*,
           array_position(ARRAY['console','created','lead','account','structure','role','opened'], g.fs) AS fs_rank,
           (g.account_created_at IS NOT NULL AND g.user_id IS NULL) AS acc_deleted,
           (length(coalesce(g.phone_digits, '')) >= 8) AS has_phone
      FROM g
  ),
  -- Le compte vivant d'une personne : le plus récent.
  main AS (
    SELECT DISTINCT ON (j.pk)
           j.pk, j.kind, j.user_id, j.venue_id, j.account_created_at, j.console_opened_at,
           coalesce(p.events, 0) AS events, coalesce(p.payments, false) AS payments, coalesce(p.live, false) AS live
      FROM j LEFT JOIN prog p ON p.id = j.id
     WHERE j.user_id IS NOT NULL
     ORDER BY j.pk, j.account_created_at DESC NULLS LAST, j.created_at DESC
  ),
  ppl AS MATERIALIZED (
    SELECT j.pk,
           bool_or(j.created_at >= v_from OR j.account_created_at >= v_from) AS in_period,
           min(j.created_at)                                          AS first_at,
           max(greatest(j.created_at, j.updated_at, coalesce(j.account_created_at, j.created_at))) AS last_at,
           min(j.created_at) FILTER (WHERE j.kind IS NOT NULL)        AS role_at,
           min(j.account_created_at)                                  AS account_at,
           bool_or(j.kind IS NOT NULL)                                AS has_role,
           bool_or(j.steps ? 'structure' OR j.steps ? 'lead')         AS has_structure,
           bool_or(j.mail IS NOT NULL)                               AS has_email,
           bool_or(j.mail IS NOT NULL OR j.has_phone)                AS reachable,
           bool_or(j.account_created_at IS NOT NULL)                  AS has_created,
           bool_or(j.console_opened_at IS NOT NULL)                   AS has_console,
           bool_or(j.user_id IS NOT NULL)                             AS has_account,
           count(*) FILTER (WHERE j.acc_deleted)                      AS deleted_n,
           bool_or(j.fs = 'lead')                                     AS has_lead,
           bool_or(j.invited)                                         AS invited,
           (array_agg(j.fs ORDER BY j.fs_rank NULLS LAST))[1]          AS furthest,
           max(j.contacted_at)                                        AS contacted_at,
           (array_agg(j.admin_notes ORDER BY j.created_at DESC)
              FILTER (WHERE j.admin_notes IS NOT NULL))[1]            AS admin_notes,
           array_agg(j.id ORDER BY j.created_at)                      AS ids,
           array_agg(DISTINCT lower(j.mail)) FILTER (WHERE j.mail IS NOT NULL) AS emails,
           -- Identité : celle du compte d'abord, sinon la plus récente.
           (array_agg(j.first_name ORDER BY (j.user_id IS NOT NULL) DESC, j.created_at DESC)
              FILTER (WHERE nullif(trim(j.first_name), '') IS NOT NULL))[1] AS first_name,
           (array_agg(j.last_name ORDER BY (j.user_id IS NOT NULL) DESC, j.created_at DESC)
              FILTER (WHERE nullif(trim(j.last_name), '') IS NOT NULL))[1]  AS last_name,
           (array_agg(j.mail ORDER BY (j.user_id IS NOT NULL) DESC, j.created_at DESC)
              FILTER (WHERE j.mail IS NOT NULL))[1]                       AS email,
           (array_agg(j.org_name ORDER BY (j.user_id IS NOT NULL) DESC, j.created_at DESC)
              FILTER (WHERE nullif(trim(j.org_name), '') IS NOT NULL))[1]  AS org_name,
           (array_agg(j.kind ORDER BY (j.user_id IS NOT NULL) DESC, (j.kind IN ('club', 'organizer')) DESC, j.created_at DESC)
              FILTER (WHERE j.kind IS NOT NULL))[1]                        AS kind,
           (array_agg(j.product ORDER BY (j.user_id IS NOT NULL) DESC, j.created_at DESC)
              FILTER (WHERE j.product IS NOT NULL))[1]                     AS product,
           (array_agg(j.city ORDER BY (j.user_id IS NOT NULL) DESC, j.created_at DESC)
              FILTER (WHERE nullif(trim(j.city), '') IS NOT NULL))[1]      AS city,
           (array_agg(coalesce(j.country, j.geo_country) ORDER BY (j.user_id IS NOT NULL) DESC, j.created_at DESC)
              FILTER (WHERE coalesce(j.country, j.geo_country) IS NOT NULL))[1] AS country,
           (array_agg(j.size_band ORDER BY j.created_at DESC) FILTER (WHERE j.size_band IS NOT NULL))[1]       AS size_band,
           (array_agg(j.frequency ORDER BY j.created_at DESC) FILTER (WHERE j.frequency IS NOT NULL))[1]       AS frequency,
           (array_agg(j.current_tool ORDER BY j.created_at DESC) FILTER (WHERE j.current_tool IS NOT NULL))[1] AS current_tool,
           (array_agg(j.next_night ORDER BY j.created_at DESC) FILTER (WHERE j.next_night IS NOT NULL))[1]     AS next_night,
           (array_agg(j.lang ORDER BY j.created_at DESC) FILTER (WHERE j.lang IS NOT NULL))[1]                 AS lang,
           -- Comment elle est arrivée : son premier parcours.
           (array_agg(jsonb_build_object('source', j.source, 'utm_source', j.utm_source,
                                         'referrer_host', j.referrer_host) ORDER BY j.created_at))[1] AS origin,
           (array_agg(j.offer_invite_id ORDER BY j.created_at)
              FILTER (WHERE j.offer_invite_id IS NOT NULL))[1]             AS offer_invite_id,
           (array_agg(j.source ORDER BY j.created_at)
              FILTER (WHERE j.source IN ('demo_preview', 'crm_invite')))[1] AS invite_source
      FROM j
     GROUP BY j.pk
  ),
  pop AS MATERIALIZED (
    SELECT ppl.*,
           m.kind AS account_kind, m.user_id, m.venue_id, m.account_created_at AS main_account_at,
           m.console_opened_at, coalesce(m.events, 0) AS events,
           coalesce(m.payments, false) AS payments, coalesce(m.live, false) AS live,
           CASE WHEN ppl.has_account      THEN 'account'
                WHEN ppl.deleted_n > 0    THEN 'deleted'
                WHEN ppl.has_lead         THEN 'request'
                WHEN ppl.invited          THEN 'invited'
                ELSE 'blocked' END AS outcome
      FROM ppl
      LEFT JOIN main m ON m.pk = ppl.pk
     WHERE ppl.in_period
  ),
  funnel AS (
    SELECT
      count(*)                                                        AS opened,
      count(*) FILTER (WHERE pop.has_role)                            AS role,
      count(*) FILTER (WHERE pop.has_structure)                       AS structure,
      count(*) FILTER (WHERE pop.has_email)                           AS email,
      count(*) FILTER (WHERE pop.has_created)                         AS created,
      count(*) FILTER (WHERE pop.has_console)                         AS console,
      count(*) FILTER (WHERE pop.events > 0)                          AS first_event,
      count(*) FILTER (WHERE pop.payments)                            AS payments,
      count(*) FILTER (WHERE pop.live)                                AS live,
      count(*) FILTER (WHERE pop.has_account)                         AS accounts,
      count(*) FILTER (WHERE pop.has_account AND pop.account_kind = 'club')      AS clubs,
      count(*) FILTER (WHERE pop.has_account AND pop.account_kind = 'organizer') AS organizers,
      count(*) FILTER (WHERE pop.has_account AND pop.invited)         AS invited_accounts,
      count(*) FILTER (WHERE pop.outcome = 'deleted')                 AS deleted,
      count(*) FILTER (WHERE pop.reachable AND pop.outcome IN ('blocked', 'request', 'invited')) AS leads,
      count(*) FILTER (WHERE pop.reachable AND pop.outcome IN ('blocked', 'request')
                              AND pop.contacted_at IS NULL)           AS to_contact
    FROM pop
  ),
  days AS (
    SELECT d::date AS d
      FROM generate_series(date_trunc('day', v_from), date_trunc('day', now()), interval '1 day') d
  ),
  by_day AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'd', days.d,
             'started', (SELECT count(*) FROM pop WHERE pop.role_at::date = days.d),
             'created', (SELECT count(*) FROM pop WHERE pop.account_at::date = days.d)
           ) ORDER BY days.d), '[]'::jsonb) AS j
      FROM days
  ),
  -- Par provenance du premier parcours ; l'écran la nomme (sourceLabel).
  by_source AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('origin', origin, 'started', started, 'created', created)
                              ORDER BY started DESC), '[]'::jsonb) AS j
      FROM (
        SELECT pop.origin,
               count(*) FILTER (WHERE pop.has_role)    AS started,
               count(*) FILTER (WHERE pop.has_created) AS created
          FROM pop GROUP BY pop.origin
      ) x
     WHERE started > 0
  ),
  people AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'key', p.pk,
             'ids', to_jsonb(p.ids),
             'outcome', p.outcome,
             'furthest_step', p.furthest,
             'first_at', p.first_at, 'last_at', p.last_at,
             'first_name', p.first_name, 'last_name', p.last_name,
             'email', p.email, 'emails', to_jsonb(coalesce(p.emails, '{}'::text[])),
             'phones', (SELECT coalesce(jsonb_agg(x.phone ORDER BY x.at DESC), '[]'::jsonb)
                          FROM (SELECT j.phone, max(j.created_at) AS at
                                  FROM j WHERE j.pk = p.pk AND j.has_phone
                                 GROUP BY j.phone) x),
             'org_name', p.org_name, 'kind', coalesce(p.account_kind, p.kind), 'product', p.product,
             'city', p.city, 'country', p.country, 'lang', p.lang,
             'size_band', p.size_band, 'frequency', p.frequency,
             'current_tool', p.current_tool, 'next_night', p.next_night,
             'origin', p.origin,
             'invited', p.invited,
             'invite', CASE WHEN p.invited THEN jsonb_build_object(
                         'source', p.invite_source, 'offer', oi.offer, 'kind', oi.kind) END,
             'contacted_at', p.contacted_at, 'admin_notes', p.admin_notes,
             'account', CASE WHEN p.has_account THEN jsonb_build_object(
                          'user_id', p.user_id, 'venue_id', p.venue_id,
                          'created_at', p.main_account_at, 'console_opened_at', p.console_opened_at,
                          'events', p.events, 'payments', p.payments, 'live', p.live) END,
             'deleted_accounts', p.deleted_n,
             -- A redonné ses coordonnées après l'ouverture de son compte : il
             -- n'arrive sans doute pas à se connecter (Poupée, 19/10).
             'retries_after_account', CASE WHEN p.has_account THEN
                 (SELECT count(*) FROM j
                   WHERE j.pk = p.pk AND j.mail IS NOT NULL AND j.account_created_at IS NULL
                     AND j.created_at > p.main_account_at) ELSE 0 END,
             'journeys', (SELECT jsonb_agg(jsonb_build_object(
                             'id', j.id, 'at', j.created_at, 'updated_at', j.updated_at,
                             'kind', j.kind, 'product', j.product, 'org_name', j.org_name,
                             'source', j.source, 'utm_source', j.utm_source, 'referrer_host', j.referrer_host,
                             'device', j.device, 'step', j.fs, 'has_email', j.mail IS NOT NULL,
                             'account_created_at', j.account_created_at,
                             'account', j.user_id IS NOT NULL, 'deleted', j.acc_deleted, 'invited', j.invited
                           ) ORDER BY j.created_at DESC)
                            FROM j WHERE j.pk = p.pk),
             'alerts', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                           'kind', a.kind, 'status', a.status, 'at', a.created_at, 'sent_at', a.sent_at,
                           'cockpit', a.cockpit ? 'prospect_id',
                           'push', CASE WHEN coalesce(a.cockpit -> 'push' ->> 'sent', '') ~ '^\d+$'
                                        THEN (a.cockpit -> 'push' ->> 'sent')::int > 0 ELSE false END,
                           'telegram', a.telegram_sent_at IS NOT NULL,
                           'email', a.email_sent_at IS NOT NULL
                         ) ORDER BY a.created_at DESC), '[]'::jsonb)
                          FROM public.pro_signup_alerts a
                         WHERE a.signup_id = ANY (p.ids)
                            OR lower(a.email) = ANY (coalesce(p.emails, '{}'::text[])))
           ) ORDER BY p.last_at DESC), '[]'::jsonb) AS j
      FROM (SELECT * FROM pop WHERE pop.reachable OR pop.has_account
             ORDER BY pop.last_at DESC LIMIT 300) p
      LEFT JOIN public.crm_offer_invites oi ON oi.id = p.offer_invite_id
  )
  SELECT jsonb_build_object(
    'funnel', (SELECT to_jsonb(funnel) FROM funnel),
    'by_day', (SELECT j FROM by_day),
    'by_source', (SELECT j FROM by_source),
    'people', (SELECT j FROM people),
    'from', v_from
  ) INTO v;

  RETURN v;
END $function$;

REVOKE ALL ON FUNCTION public.admin_pro_signups(integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pro_signups(integer, boolean) TO authenticated;

-- « Contacté » et la note valent pour la personne : on les écrit sur tous ses
-- parcours (une note posée reste lisible quand un nouveau parcours arrive :
-- l'écran lit la plus récente).
CREATE OR REPLACE FUNCTION public.admin_update_pro_signups(
  p_ids uuid[], p_contacted boolean DEFAULT NULL, p_notes text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF coalesce(cardinality(p_ids), 0) = 0 OR cardinality(p_ids) > 200 THEN
    RAISE EXCEPTION 'invalid_ids' USING ERRCODE = '22023';
  END IF;
  UPDATE public.pro_signups SET
    contacted_at = CASE WHEN p_contacted IS NULL THEN contacted_at
                        WHEN p_contacted THEN coalesce(contacted_at, now())
                        ELSE NULL END,
    admin_notes  = CASE WHEN p_notes IS NULL THEN admin_notes
                        ELSE nullif(left(trim(p_notes), 2000), '') END
  WHERE id = ANY (p_ids);
END $function$;

REVOKE ALL ON FUNCTION public.admin_update_pro_signups(uuid[], boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_pro_signups(uuid[], boolean, text) TO authenticated;
