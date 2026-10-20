-- ═══════════════════════════════════════════════════════════════════════════
-- Inscriptions pro (/admin/signups) : les robots ne comptent plus dans le funnel.
--
-- Le 20/10, « Formulaire ouvert » comptait 47 personnes sur 30 jours pour 14
-- profils choisis. L'écart venait surtout de rafales d'ouvertures anonymes
-- (rien choisi, rien laissé), toutes en anglais, à quelques secondes l'une de
-- l'autre : le 04/10 (20:28-23:56 UTC), le 10/10 (17:34-20:27) et le 19/10
-- (10:05 et 10:53).
--
-- Ce que c'est (journaux de l'API Supabase du 19/10, edge_logs) : une flotte
-- de navigateurs automatisés qui parcourt yunoapp.eu (soirées, clubs, images,
-- track_platform_view, platform_heartbeat : ~800 appels ce jour-là), ouvre
-- /auth et suit son lien « Créer un compte pro » jusqu'à
-- landing.yunoapp.eu/start?utm_source=yuno_app&utm_medium=auth : la page
-- s'affiche, son JavaScript écrit l'étape « opened ». Deux user-agents, et
-- seulement eux :
--   · Chrome 130 figé sur Mac (« … Chrome/130.0.0.0 Safari/537.36 », une
--     version d'octobre 2024) ;
--   · le profil « iPhone 13 » de Playwright (« iPhone OS 15_0 … Version/15.0
--     Mobile/15E148 », iOS 15.0 exactement, qu'aucun iPhone réel n'affiche
--     plus).
-- Ils passent par des réseaux de proxys (code200, web2objects, EarthMeta,
-- EGIHosting, Comcast relayé : d'où PL, DE, LT, RO, US, ES) avec un score de
-- confiance Cloudflare de 1 à 29, quand les vrais visiteurs du même jour
-- (Pascal à Lyon, deux organisateurs, Paul) sont entre 45 et 99. La landing
-- n'est pas pré-rendue pour eux : ce sont de vrais navigateurs qui exécutent
-- la page.
--
-- La règle, en deux parties :
--   1. À l'écriture, `track_pro_signup` note sur le parcours ce que son
--      user-agent annonce (`pro_signups.robot`) : `declared` (pas un
--      navigateur, ou s'annonce robot / aperçu de lien / navigateur piloté),
--      `automation` (les deux user-agents de la flotte ci-dessus), `internal`
--      (le navigateur intégré de l'app Claude : nos propres sessions de test).
--      Elle n'en refuse aucun : la landing marche pour tout le monde, et un
--      faux positif ne coûte rien (point 3).
--   2. À la lecture, `admin_pro_signups` traite aussi comme robot une
--      ouverture anonyme arrivée à moins de 3 minutes d'une autre ouverture
--      anonyme venue d'un AUTRE appareil (`visitor_hash` différent). C'est ce
--      qui couvre l'historique (le user-agent n'était pas gardé) et une flotte
--      qui changerait d'user-agent.
--   3. Une PERSONNE n'est écartée que si tous ses parcours sont des robots ET
--      qu'elle n'a laissé ni e-mail ni téléphone, ni ouvert de compte, ni reçu
--      d'invitation. Un vrai contact compte toujours.
-- Le funnel rend `robots` : le nombre de personnes écartées sur la période.
--
-- Sur la prod le 20/10 (répété dans une transaction annulée avant d'être
-- appliqué) : sur 30 jours, « Formulaire ouvert » 47 → 19 et 28 personnes
-- écartées (26 parcours de la flotte, 2 tests depuis le navigateur de l'app
-- Claude) ; sur 7 jours, 12 → 5. Toutes les autres étapes sont inchangées
-- (« Profil choisi » 14, comptes 6) et les 7 fiches de la liste aussi. Les 19
-- restantes = 14 profils choisis + 5 ouvertures sans suite, en français
-- depuis Ségovie ou la France, qui ressemblent à des tests de Paul. Trois
-- personnes du 04/10 (20:48-20:54, anglais, DE / US / FR) ont choisi « club »
-- sans rien laisser : elles restent comptées, rien ne prouve que ce sont des
-- robots.
--
-- Rattrapage : les 5 parcours du 19/10 dont les journaux de l'API donnent
-- l'user-agent de la flotte passent en `automation`, les 2 parcours ouverts
-- depuis le navigateur de l'app Claude (17/10 18:21, 19/10 10:14) en
-- `internal`. Les autres journées n'ont plus de journaux (3 jours) : la règle
-- de lecture les couvre.
--
-- Réécrit depuis pg_get_functiondef de la prod : track_pro_signup =
-- 20261019420000, admin_pro_signups = 20261104220000 (identiques).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.pro_signups ADD COLUMN IF NOT EXISTS robot text;
ALTER TABLE public.pro_signups DROP CONSTRAINT IF EXISTS pro_signups_robot_chk;
ALTER TABLE public.pro_signups ADD CONSTRAINT pro_signups_robot_chk
  CHECK (robot IS NULL OR robot IN ('declared', 'automation', 'internal'));
COMMENT ON COLUMN public.pro_signups.robot IS
  'Ce que l''user-agent du premier appel annonçait (20261104230000) : declared | automation | internal ; NULL = un navigateur ordinaire. Jamais un refus.';

-- Ce qu'un user-agent annonce. NULL = un navigateur ordinaire.
CREATE OR REPLACE FUNCTION public._pro_signup_robot_ua(p_ua text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    -- Pas un navigateur : tous les navigateurs, applications intégrées
    -- comprises (Instagram, TikTok, l'app Yuno), commencent par « Mozilla/ ».
    WHEN coalesce(p_ua, '') !~ '^Mozilla/' THEN 'declared'
    -- S'annonce robot, aperçu de lien ou navigateur piloté (« Cubot » est une
    -- marque de téléphones).
    WHEN p_ua ~* '(bot|crawl|spider|slurp|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|phantomjs|selenium|puppeteer|playwright|facebookexternalhit|preview)'
         AND p_ua !~* 'cubot' THEN 'declared'
    -- La flotte de navigateurs automatisés des 04, 10 et 19/10.
    WHEN p_ua ~ '\(Macintosh; Intel Mac OS X 10_15_7\) AppleWebKit/537\.36 \(KHTML, like Gecko\) Chrome/130\.0\.0\.0 Safari/537\.36$'
      THEN 'automation'
    WHEN p_ua ~ '\(iPhone; CPU iPhone OS 15_0 like Mac OS X\) AppleWebKit/605\.1\.15 \(KHTML, like Gecko\) Version/15\.0 Mobile/15E148 Safari/604\.1$'
      THEN 'automation'
    -- Le navigateur intégré de l'app Claude : nos propres sessions de test.
    WHEN p_ua ~ ' Claude/[0-9]' THEN 'internal'
  END
$function$;

REVOKE ALL ON FUNCTION public._pro_signup_robot_ua(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.track_pro_signup(p_key text, p_step text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx      record;
  v_row      public.pro_signups%ROWTYPE;
  v_inv      public.crm_offer_invites%ROWTYPE;
  v_recent   integer;
  v_d        jsonb := CASE WHEN jsonb_typeof(p_data) = 'object' AND length(p_data::text) <= 4000
                           THEN p_data ELSE '{}'::jsonb END;
  v_kind     text := lower(nullif(trim(coalesce(v_d->>'kind', '')), ''));
  v_email    text := lower(nullif(trim(coalesce(v_d->>'email', '')), ''));
  v_product  text := lower(nullif(trim(coalesce(v_d->>'product', '')), ''));
  v_pillars  text[];
  v_offer    uuid;
  v_contact  text;
  v_first    text;
  v_last     text;
  v_hdr      json;
  v_robot    text;
BEGIN
  IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN RETURN; END IF;
  IF p_step NOT IN ('opened','role','structure','account','lead') THEN RETURN; END IF;
  IF v_kind IS NOT NULL AND v_kind NOT IN ('club','organizer','promoter','other') THEN v_kind := NULL; END IF;
  IF v_product IS NOT NULL AND v_product NOT IN ('suite','crm') THEN v_product := NULL; END IF;
  IF v_email IS NOT NULL AND (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254) THEN
    v_email := NULL;
  END IF;

  -- Invitation Yuno CRM (offre fondateurs ou non) : elle suit le parcours et
  -- apporte son pré-profil (20261017230000, 20261019420000).
  IF nullif(v_d->>'offer', '') IS NOT NULL THEN
    SELECT i.* INTO v_inv FROM public.crm_offer_invites i
     WHERE i.token = v_d->>'offer' AND i.status = 'pending' AND i.expires_at > now();
    v_offer := v_inv.id;
    IF v_offer IS NOT NULL THEN
      v_contact := trim(coalesce(v_inv.contact_name, ''));
      v_first := nullif(split_part(v_contact, ' ', 1), '');
      v_last := nullif(trim(substr(v_contact, length(coalesce(v_first, '')) + 1)), '');
    END IF;
  END IF;

  IF jsonb_typeof(v_d->'pillars') = 'array' THEN
    SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_pillars
      FROM jsonb_array_elements_text(v_d->'pillars') x
     WHERE x IN ('tickets','guest_list','tables','drinks');
  END IF;

  SELECT * INTO v_row FROM public.pro_signups WHERE client_key = p_key FOR UPDATE;

  IF NOT FOUND THEN
    SELECT * INTO v_ctx FROM public.links_visitor_context();
    -- Anti-flood : 20 parcours neufs par visiteur et par heure.
    SELECT count(*) INTO v_recent FROM public.pro_signups
     WHERE visitor_hash = v_ctx.o_hash AND created_at > now() - interval '1 hour';
    IF v_recent >= 20 THEN RETURN; END IF;

    -- Robot ? (20261104230000) Lu sur l'user-agent de l'appel quand il vient
    -- de l'API (un appel SQL interne n'a pas d'en-têtes). Le parcours s'écrit
    -- quand même : c'est le funnel de /admin/signups qui l'écarte.
    BEGIN
      v_hdr := current_setting('request.headers', true)::json;
      IF v_hdr IS NOT NULL THEN
        v_robot := public._pro_signup_robot_ua(v_hdr->>'user-agent');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_robot := NULL;
    END;

    INSERT INTO public.pro_signups (client_key, visitor_hash, device, geo_country, robot)
    VALUES (p_key, v_ctx.o_hash, v_ctx.o_device, v_ctx.o_country, v_robot)
    RETURNING * INTO v_row;
  END IF;

  -- Un parcours qui a déjà produit un compte ne s'écrit plus anonymement.
  IF v_row.user_id IS NOT NULL THEN RETURN; END IF;

  UPDATE public.pro_signups SET
    updated_at    = now(),
    kind          = coalesce(v_kind, kind, v_inv.kind),
    -- Une invitation Yuno CRM mène au CRM, quel que soit le défaut du brouillon.
    product       = coalesce(v_product, CASE WHEN v_offer IS NOT NULL THEN 'crm' END, product),
    lang          = coalesce(lower(left(nullif(v_d->>'lang', ''), 2)), lang, v_inv.lang),
    first_name    = coalesce(left(nullif(trim(v_d->>'first_name'), ''), 80), first_name, left(v_first, 80)),
    last_name     = coalesce(left(nullif(trim(v_d->>'last_name'), ''), 80), last_name, left(v_last, 80)),
    email         = coalesce(v_email, email, v_inv.email),
    phone         = coalesce(left(nullif(trim(v_d->>'phone'), ''), 40), phone, v_inv.phone),
    org_name      = coalesce(left(nullif(regexp_replace(trim(v_d->>'org_name'), '\s+', ' ', 'g'), ''), 120), org_name, v_inv.org_name),
    city          = coalesce(left(nullif(trim(v_d->>'city'), ''), 120), city, v_inv.city),
    country       = coalesce(upper(left(nullif(trim(v_d->>'country'), ''), 2)), country),
    size_band     = coalesce(left(nullif(v_d->>'size_band', ''), 20), size_band),
    frequency     = coalesce(left(nullif(v_d->>'frequency', ''), 20), frequency),
    pillars       = coalesce(v_pillars, pillars),
    current_tool  = coalesce(left(nullif(v_d->>'current_tool', ''), 40), current_tool),
    next_night    = coalesce(left(nullif(v_d->>'next_night', ''), 20), next_night),
    source        = coalesce(source, left(nullif(v_d->>'source', ''), 60), CASE WHEN v_offer IS NOT NULL THEN 'crm_invite' END),
    utm_source    = coalesce(utm_source, left(nullif(v_d->>'utm_source', ''), 120)),
    utm_medium    = coalesce(utm_medium, left(nullif(v_d->>'utm_medium', ''), 120)),
    utm_campaign  = coalesce(utm_campaign, left(nullif(v_d->>'utm_campaign', ''), 120)),
    referrer_host = coalesce(referrer_host, left(nullif(v_d->>'referrer_host', ''), 120)),
    offer_invite_id = coalesce(v_offer, offer_invite_id),
    steps         = CASE WHEN steps ? p_step THEN steps
                         ELSE steps || jsonb_build_object(p_step, now()) END,
    last_step     = p_step
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  -- Promoteur / autre : pas de compte en libre-service, c'est un lead chaud.
  IF p_step = 'lead' AND v_row.email IS NOT NULL AND NOT public.is_demo_email(v_row.email) THEN
    BEGIN
      PERFORM public.emit_admin_notification(
        'admin_pro_signup_lead',
        'Nouveau lead pro (landing)',
        coalesce(nullif(trim(coalesce(v_row.first_name, '') || ' ' || coalesce(v_row.last_name, '')), ''), v_row.email)
          || coalesce(' — ' || v_row.org_name, '') || coalesce(' (' || v_row.city || ')', '')
          || ' · ' || coalesce(v_row.kind, 'other') || '.',
        'high', 'pro_signup', v_row.id::text,
        jsonb_build_object('kind', v_row.kind, 'email', v_row.email, 'phone', v_row.phone,
                           'org_name', v_row.org_name, 'city', v_row.city, 'lang', v_row.lang),
        'pro_signup_lead:' || v_row.id::text
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
END $function$;

REVOKE ALL ON FUNCTION public.track_pro_signup(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_pro_signup(text, text, jsonb) TO anon, authenticated;

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
           (length(coalesce(g.phone_digits, '')) >= 8) AS has_phone,
           -- Ouverture anonyme : le formulaire s'est affiché, rien n'a été
           -- choisi ni laissé, personne n'a invité.
           (g.fs = 'opened' AND g.kind IS NULL AND g.mail IS NULL
             AND length(coalesce(g.phone_digits, '')) < 8
             AND g.user_id IS NULL AND g.account_created_at IS NULL AND NOT g.invited) AS anon_open
      FROM g
  ),
  -- Robots (20261104230000). Un parcours est un robot quand son navigateur
  -- s'annonçait robot, piloté ou de test à l'écriture (`robot`), ou quand
  -- c'est une ouverture anonyme arrivée à moins de 3 minutes d'une autre
  -- ouverture anonyme venue d'un AUTRE appareil (les rafales de navigateurs
  -- automatisés derrière des proxys des 04, 10 et 19/10).
  jr AS MATERIALIZED (
    SELECT j.id,
           (j.robot IS NOT NULL
             OR (j.anon_open AND j.visitor_hash IS NOT NULL AND EXISTS (
                   SELECT 1 FROM j o
                    WHERE o.anon_open AND o.id <> j.id
                      AND o.visitor_hash IS NOT NULL AND o.visitor_hash <> j.visitor_hash
                      AND o.created_at BETWEEN j.created_at - interval '3 minutes'
                                           AND j.created_at + interval '3 minutes'))) AS robot
      FROM j
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
              FILTER (WHERE j.source IN ('demo_preview', 'crm_invite')))[1] AS invite_source,
           -- Une personne n'est un robot que si TOUS ses parcours en sont et
           -- qu'elle n'a laissé ni e-mail ni téléphone, ni ouvert de compte,
           -- ni reçu d'invitation : un vrai contact compte toujours.
           (bool_and(jr.robot)
             AND NOT bool_or(j.mail IS NOT NULL OR j.has_phone)
             AND NOT bool_or(j.user_id IS NOT NULL OR j.account_created_at IS NOT NULL)
             AND NOT bool_or(j.invited))                              AS is_robot
      FROM j JOIN jr ON jr.id = j.id
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
     WHERE ppl.in_period AND NOT ppl.is_robot
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
                              AND pop.contacted_at IS NULL)           AS to_contact,
      (SELECT count(*) FROM ppl WHERE ppl.in_period AND ppl.is_robot) AS robots
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

-- Rattrapage, preuve à l'appui (journaux de l'API du 17 au 19/10).
UPDATE public.pro_signups SET robot = 'automation'
 WHERE robot IS NULL AND email IS NULL AND user_id IS NULL
   AND id IN ('1cc5da06-3117-45f3-97ec-7b395d8e7620',   -- 19/10 10:05:23, code200 (PL)
              '7a19d46e-87a0-4ce6-a53a-a3e7f3ccc275',   -- 19/10 10:05:50, Comcast relayé (US)
              '150ecdb7-c3d4-44ac-84b8-fc6c0ad5425c',   -- 19/10 10:53:54, web2objects (DE)
              '1bdf5028-fabf-46f3-b9fe-215d68977d4f',   -- 19/10 10:54:26, Comcast relayé (US)
              'c87a9d47-206b-4494-9143-85cb54206ddc');  -- 19/10 10:54:29, profil iPhone 13 (US)
UPDATE public.pro_signups SET robot = 'internal'
 WHERE robot IS NULL AND email IS NULL AND user_id IS NULL
   AND id IN ('c36df0cd-95b7-440f-8ecf-0cbf04984382',   -- 17/10 18:21:45, navigateur de l'app Claude
              'ff57e9bc-137d-4971-8e54-ab9ca99863a4');  -- 19/10 10:14:23, navigateur de l'app Claude
