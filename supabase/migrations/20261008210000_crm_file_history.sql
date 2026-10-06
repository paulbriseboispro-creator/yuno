-- ============================================================================
-- Yuno CRM — l'historique d'un fichier importé compte (2026-10-06).
-- Décision de Paul : « c'est une vraie valeur si on peut analyser leur
-- historique ». Un fichier qui donne le total dépensé, le nombre de soirées et
-- le dernier achat (export Shotgun, Dice, Weezevent…) nourrit le cycle de vie,
-- la liste Clients, les segments et les analyses ; avant, un tel contact
-- restait « Jamais venu ».
--
-- Règle anti double compte (_crm_people_build, colonne hist_mode) :
--   'added' — le fichier précède le premier billet Shotgun de la personne (de
--             plus de 2 jours) ou il n'y a pas de billet Shotgun : on additionne ;
--   'file' / 'live' — sinon les deux se recouvrent (un export de la même
--             billetterie réimporté) : on garde la source qui connaît le plus de
--             soirées, jamais la somme.
-- « Habitué » reste prouvé par des soirées DATÉES (billets) : un total de fichier
-- ne dit pas combien tombent dans la fenêtre. Dernière venue = la plus récente
-- des deux ; première venue = la plus ancienne.
--
-- 1. _crm_file_history : une ligne d'historique par adresse.
-- 2. _crm_people_build : soirées, dépense, soirées payantes, panier, dates et
--    cycle de vie combinés ; hist_nights, hist_spent, hist_last, hist_mode,
--    hist_list à la fin de `_cp`.
-- 3. Accueil (prochaine soirée) et volet d'une soirée : un acheteur venu avant
--    Shotgun d'après son fichier n'est plus « nouveau ».
-- 4. Fiche client : `history` (ce que dit le fichier, comment il compte, quel
--    fichier) — montant masqué sans accès à l'argent (_crm_null_money).
-- Corps repris de la base liée (pg_get_functiondef, 06/10, après
-- 20261008200000) ; seules les lignes citées changent. Aucune signature
-- existante ne change.
-- ============================================================================

-- ── 1. Historique d'un fichier importé, une ligne par adresse ───────────────
-- La ligne importée la plus récente qui porte un historique (un import plus
-- récent sans ces colonnes ne l'efface pas). f_nights : nombre de soirées du
-- fichier, au moins 1 s'il donne une dépense ou un dernier achat ; f_paid :
-- soirées payantes estimées (toutes, si le fichier donne une dépense) ;
-- f_first : première trace (ajout ou dernier achat) ; f_asof : dernier achat,
-- sinon date de l'import (ce que le fichier sait au plus tard).
CREATE OR REPLACE FUNCTION public._crm_file_history(p_venue_id text, p_organizer_user_id uuid, p_at timestamptz DEFAULT NULL)
RETURNS TABLE(email text, f_nights integer, f_spent numeric, f_paid integer, f_first timestamptz, f_last timestamptz,
              f_asof timestamptz, f_list uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (lower(c.email))
         lower(c.email),
         GREATEST(COALESCE(c.event_count, 0),
                  CASE WHEN COALESCE(c.total_spent, 0) > 0 OR c.last_purchase_at IS NOT NULL THEN 1 ELSE 0 END),
         COALESCE(c.total_spent, 0),
         CASE WHEN COALESCE(c.total_spent, 0) > 0 THEN GREATEST(COALESCE(c.event_count, 0), 1) ELSE 0 END,
         LEAST(c.added_at, c.last_purchase_at),
         c.last_purchase_at,
         COALESCE(c.last_purchase_at, c.created_at),
         c.list_import_id
    FROM public.imported_contacts c
   WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND c.email IS NOT NULL
     AND (COALESCE(c.event_count, 0) > 0 OR COALESCE(c.total_spent, 0) > 0 OR c.last_purchase_at IS NOT NULL)
     AND c.created_at <= COALESCE(p_at, now())
     AND (c.last_purchase_at IS NULL OR c.last_purchase_at <= COALESCE(p_at, now()))
   ORDER BY lower(c.email), c.created_at DESC,
            ((c.event_count IS NOT NULL)::int + (c.total_spent IS NOT NULL)::int + (c.last_purchase_at IS NOT NULL)::int) DESC,
            c.id;
$$;
REVOKE ALL ON FUNCTION public._crm_file_history(text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_file_history(text, uuid, timestamptz) TO service_role;

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
         f.f_nights AS hist_nights, f.f_spent AS hist_spent, f.f_last AS hist_last, m.mode AS hist_mode, f.f_list AS hist_list
    FROM base b
    LEFT JOIN agg a ON a.email = b.email
    LEFT JOIN buy y ON y.email = b.email
    LEFT JOIN gl g ON g.email = b.email
    LEFT JOIN first_utm u ON u.email = b.email
    LEFT JOIN page_first pf ON pf.email = b.email
    LEFT JOIN prof pr ON pr.email = b.email
    LEFT JOIN fh f ON f.email = b.email
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

-- ── 3. Accueil : les acheteurs de la prochaine soirée ───────────────────────
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
                        (SELECT count(DISTINCT y.event_id) FROM _ht y WHERE y.email = b.email AND y.event_start < v_ev.start_at) AS prior_all,
                        -- Venu avant Shotgun d'après un fichier importé (même règle que _crm_people_build).
                        (f.email IS NOT NULL AND f.f_asof < (SELECT min(y.bought_at) FROM _ht y WHERE y.email = b.email) - interval '2 days') AS file_prior
                   FROM (SELECT DISTINCT x.email FROM _ht x WHERE x.event_id = v_ev.id AND x.email IS NOT NULL) b
                   LEFT JOIN public._crm_file_history(p_venue_id, p_organizer_user_id, NULL) f ON f.email = b.email
               )
               SELECT jsonb_build_object(
                        'total', count(*),
                        'regulars', count(*) FILTER (WHERE prior_window + 1 >= v_rules.regular_min_nights),
                        'new', count(*) FILTER (WHERE prior_all = 0 AND NOT file_prior),
                        'occasional', count(*) FILTER (WHERE (prior_all > 0 OR file_prior) AND prior_window + 1 < v_rules.regular_min_nights))
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

-- ── 3 bis. Volet d'une soirée : ses acheteurs ───────────────────────────────
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
                 AND t.event_start > e.start_at - make_interval(months => (SELECT regular_window_months FROM r))) AS prior_window,
           min(t.bought_at) AS first_buy
      FROM b LEFT JOIN public._crm_tickets(p_venue_id, p_organizer_user_id) t ON t.email = b.email
     GROUP BY b.email
  ), fp AS (
    -- Venu avant Shotgun d'après un fichier importé (même règle que _crm_people_build).
    SELECT hist.*, (f.email IS NOT NULL AND f.f_asof < hist.first_buy - interval '2 days') AS file_prior
      FROM hist LEFT JOIN public._crm_file_history(p_venue_id, p_organizer_user_id, NULL) f ON f.email = hist.email
  )
  SELECT jsonb_build_object('total', count(*),
           'new', count(*) FILTER (WHERE prior = 0 AND NOT file_prior),
           'occasional', count(*) FILTER (WHERE (prior > 0 OR file_prior) AND prior_window + 1 < (SELECT regular_min_nights FROM r)),
           'regular', count(*) FILTER (WHERE prior > 0 AND prior_window + 1 >= (SELECT regular_min_nights FROM r)))
    INTO v_buyers FROM fp;

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

-- ── 4. Fiche client : l'historique du fichier ────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_client__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_email text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_em text := lower(btrim(COALESCE(p_email, '')));
  v_p record;
  v_buys jsonb;
  v_guests jsonb;
  v_msgs jsonb;
  v_months jsonb;
  v_rules record;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  SELECT * INTO v_p FROM _cp p WHERE p.email = v_em;
  IF v_p.email IS NULL THEN RETURN NULL; END IF;

  -- Achats : une ligne par soirée (montant de la soirée, billets).
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at' DESC), '[]'::jsonb) INTO v_buys FROM (
    SELECT jsonb_build_object('kind', 'buy', 'at', min(t.bought_at), 'event_id', t.event_id, 'title', e.title,
                              'event_start', min(t.event_start), 'amount', round(sum(t.amount), 2), 'tickets', sum(t.qty),
                              'scanned', bool_or(t.scanned_at IS NOT NULL), 'first', min(t.event_start) = v_p.first_night,
                              'upcoming', min(t.event_start) > now(),
                              -- Par où est arrivé l'achat : la source que Shotgun rend sur le
                              -- premier billet de la personne pour cette soirée.
                              'source', public._crm_source_label(p_venue_id, p_organizer_user_id, (
                                SELECT lower(et.utm->>'utm_source') FROM public.external_tickets et
                                 WHERE et.event_id = t.event_id AND lower(et.buyer_email) = v_em
                                   AND public._crm_ticket_is_sale(et.status, et.raw)
                                 ORDER BY COALESCE(et.purchased_at, et.first_seen_at) LIMIT 1))) AS x
      FROM _cpt t LEFT JOIN public.events e ON e.id = t.event_id
     WHERE t.email = v_em
     GROUP BY t.event_id, e.title
  ) q;

  -- Guest list : une ligne par soirée où la personne était invitée ou
  -- inscrite gratuitement (20261008100000). `came` n'est faux qu'une fois la
  -- porte vraiment scannée (`scan_known`) : sinon on ne sait pas.
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'event_start' DESC), '[]'::jsonb) INTO v_guests FROM (
    SELECT jsonb_build_object('kind', 'guest', 'event_id', g.event_id, 'title', e.title,
             'event_start', min(g.event_start), 'at', min(g.at),
             'gl', CASE WHEN bool_and(g.kind = 'inv') THEN 'inv' WHEN bool_and(g.kind = 'free') THEN 'free' ELSE 'mix' END,
             'list', string_agg(DISTINCT g.deal, ', '),
             'came', bool_or(g.scanned_at IS NOT NULL), 'scanned_at', min(g.scanned_at),
             'scan_known', public._crm_event_scan_known(g.event_id),
             'upcoming', min(g.event_end) > now()) AS x
      FROM _cpg g LEFT JOIN public.events e ON e.id = g.event_id
     WHERE g.email = v_em AND g.event_id IS NOT NULL
     GROUP BY g.event_id, e.title
  ) q;

  -- Messages : e-mails reçus (et clics), SMS reçus.
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at' DESC), '[]'::jsonb) INTO v_msgs FROM (
    SELECT jsonb_build_object('kind', 'email', 'at', r.sent_at, 'name', c.name, 'campaign_id', c.id,
             'opened', EXISTS (SELECT 1 FROM public.email_campaign_events ev WHERE ev.campaign_id = c.id AND lower(ev.recipient_email) = v_em AND ev.event_type = 'opened'),
             'clicked', k.at IS NOT NULL,
             -- La soirée dont parlait l'e-mail, le premier clic, et si la personne a
             -- acheté cette soirée dans les 7 jours qui suivent (ou par la source de
             -- CETTE campagne, que Shotgun rend sur le billet).
             'event_id', c.event_id, 'event_title', ce.title, 'clicked_at', k.at,
             'bought_after', CASE WHEN c.event_id IS NULL OR k.at IS NULL THEN NULL ELSE EXISTS (
               SELECT 1 FROM public.external_tickets et
                WHERE et.event_id = c.event_id AND lower(et.buyer_email) = v_em
                  AND public._crm_ticket_is_sale(et.status, et.raw)
                  AND (lower(et.utm->>'utm_source') = 'yuno-m-' || left(replace(c.id::text, '-', ''), 8)
                       OR COALESCE(et.purchased_at, et.first_seen_at) BETWEEN k.at AND k.at + interval '7 days')) END) AS x
      FROM public.email_campaign_recipients r
      JOIN public.email_campaigns c ON c.id = r.campaign_id
      LEFT JOIN public.events ce ON ce.id = c.event_id
      LEFT JOIN LATERAL (SELECT min(ev.created_at) AS at FROM public.email_campaign_events ev
                          WHERE ev.campaign_id = c.id AND lower(ev.recipient_email) = v_em AND ev.event_type = 'clicked') k ON true
     WHERE lower(r.email) = v_em AND r.status = 'sent' AND r.sent_at IS NOT NULL
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     ORDER BY r.sent_at DESC LIMIT 40
  ) q;

  SELECT jsonb_agg(jsonb_build_object('m', to_char(m, 'YYYY-MM'),
           'n', (SELECT count(DISTINCT z.event_id) FROM (
                   SELECT t.event_id, t.event_start FROM _cpt t WHERE t.email = v_em
                   UNION ALL
                   SELECT g.event_id, g.event_start FROM _cpg g
                    WHERE g.email = v_em AND g.kind = 'inv' AND g.scanned_at IS NOT NULL) z
                  WHERE date_trunc('month', z.event_start AT TIME ZONE 'Europe/Paris') = m)) ORDER BY m)
    INTO v_months
    FROM generate_series(date_trunc('month', now() AT TIME ZONE 'Europe/Paris') - interval '11 months',
                         date_trunc('month', now() AT TIME ZONE 'Europe/Paris'), interval '1 month') m;

  RETURN jsonb_build_object(
    'email', v_p.email, 'first_name', v_p.first_name, 'last_name', v_p.last_name, 'phone', v_p.phone,
    'email_ok', v_p.email_ok, 'phone_ok', v_p.phone_ok, 'bounced', v_p.bounced, 'eng_status', v_p.eng_status,
    'lifecycle', v_p.lifecycle, 'nights', v_p.nights, 'nights_win', v_p.nights_win, 'spent', v_p.spent,
    'first_night', v_p.first_night, 'last_night', v_p.last_night, 'added_at', v_p.added_at,
    'tonight', v_p.tonight, 'source', v_p.source, 'utm_source', v_p.utm_source, 'origin', v_p.origin,
    'first_source', public._crm_source_label(p_venue_id, p_organizer_user_id, v_p.utm_source),
    'tags', COALESCE(to_jsonb(v_p.tags), '[]'::jsonb), 'note', v_p.note,
    'buys', v_buys, 'messages', v_msgs, 'months', v_months,
    'guests', v_guests,
    -- Historique d'un fichier importé : ce qu'il dit et comment il compte (20261008210000).
    'history', CASE WHEN v_p.hist_mode IS NULL THEN NULL ELSE jsonb_build_object(
        'nights', v_p.hist_nights, 'spent', v_p.hist_spent, 'last', v_p.hist_last, 'mode', v_p.hist_mode,
        'list', (SELECT COALESCE(NULLIF(btrim(ci.title), ''), NULLIF(btrim(li.list_name), ''), li.filename)
                   FROM public.contact_list_imports li
                   LEFT JOIN public.crm_imports ci ON ci.list_import_id = li.id
                  WHERE li.id = v_p.hist_list)) END,
    'gl', jsonb_build_object('n', v_p.gl_n, 'came', v_p.gl_came, 'first', v_p.gl_first, 'conv', v_p.gl_conv,
                             'paid_n', v_p.paid_n, 'noshow', v_p.gl_noshow),
    'rules', jsonb_build_object('min_nights', v_rules.regular_min_nights, 'window_months', v_rules.regular_window_months,
                                'lapse_months', v_rules.lapse_months));
END;
$function$;
