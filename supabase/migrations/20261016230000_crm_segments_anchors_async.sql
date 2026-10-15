-- Yuno CRM : Segments sans reconstruction pendant la requête, fiche d'un
-- segment en une base et demie.
--
-- Suite de 20261016220000. Mesuré en prod (transaction annulée, compte d'un
-- organisateur réel + ~32 000 billets Shotgun simulés, machine Micro) :
--   - Segments : 6,8 s quand ses trois dates repères manquaient (première
--     visite, visite qui suit la création d'un segment, périodes 90 j / 12 m) ;
--     2,0 s désormais dans tous les cas. L'écran ne les reconstruit plus : il
--     rend `anchors_pending`, et le front appelle crm_segments_fill_anchors
--     (une date par appel, ~1,4 s) puis relit l'écran. Une fois les dates
--     faites, sortie identique à l'ancienne (comptes compris).
--   - Fiche d'un segment : 3,0 s → 1,9 s. _crm_people_build garde en mémoire
--     de transaction ce qui ne dépend pas de la date (contacts, billets,
--     premier billet, profil, zones) quand l'appelant pose yuno.crm_cp_memo =
--     sa portée : la fiche et le balayage nocturne. Le profil Shotgun se lit
--     en une passe triée (agrégat pré-trié de PG 17) au lieu de quatre tris
--     par acheteur.
-- Égalité vérifiée ligne à ligne (_cp, _cpt, _cpg à trois dates, avec et
-- sans mémoire) sur le compte démo et le compte simulé ; fiches identiques.

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
  -- Mémoire de transaction (20261016230000) : un appelant qui construit
  -- plusieurs bases de la MÊME portée dans la même transaction (fiche d'un
  -- segment, balayage nocturne) pose yuno.crm_cp_memo = sa portée ; ce qui ne
  -- dépend pas de la date (contacts, billets, premier billet, profil, zones)
  -- n'est alors lu qu'une fois. Sans ce réglage, rien n'est réutilisé.
  v_memo boolean := v_scope IS NOT NULL AND COALESCE(current_setting('yuno.crm_cp_memo', true), '') = v_scope;
  v_ready boolean;
BEGIN
  -- Portée de la base construite, lue par les clés de filtre qui interrogent
  -- une soirée (`ntgt`, 20261011110000) : jamais la soirée d'un autre compte.
  PERFORM set_config('yuno.crm_scope', COALESCE(v_scope, ''), true);
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);
  v_ready := v_memo AND COALESCE(current_setting('yuno.crm_cp_memo_ready', true), '') = v_scope
             AND to_regclass('pg_temp._cr') IS NOT NULL AND to_regclass('pg_temp._cpm_tk') IS NOT NULL;
  IF NOT v_ready THEN
    PERFORM public.contact_build_rows(p_venue_id, p_organizer_user_id);
  END IF;

  IF v_memo AND NOT v_ready THEN
    -- Billets et guest list sans borne de date, filtrés ensuite à chaque base.
    DROP TABLE IF EXISTS _cpm_tk;
    CREATE TEMP TABLE _cpm_tk ON COMMIT DROP AS
      SELECT * FROM public._crm_tickets(p_venue_id, p_organizer_user_id);
    DROP TABLE IF EXISTS _cpm_gl;
    CREATE TEMP TABLE _cpm_gl ON COMMIT DROP AS
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
         AND public._crm_ticket_gl_kind(t.status, t.price, t.raw) IS NOT NULL;
  END IF;

  DROP TABLE IF EXISTS _cpt;
  IF v_memo THEN
    CREATE TEMP TABLE _cpt ON COMMIT DROP AS
      SELECT * FROM _cpm_tk x WHERE x.bought_at <= v_at;
  ELSE
    CREATE TEMP TABLE _cpt ON COMMIT DROP AS
      SELECT * FROM public._crm_tickets(p_venue_id, p_organizer_user_id) x
       WHERE x.bought_at <= v_at;
  END IF;
  -- Lu par personne plus bas (« a cliqué sans acheter ») et par les écrans
  -- (Parcours, Analyses) : sans index, chaque recherche relisait tous les
  -- billets — quadratique sur un compte de 30 000 billets (20261016210000).
  CREATE INDEX ON _cpt (email, bought_at);
  CREATE INDEX ON _cpt (id);

  -- Guest list (invitations + billets à 0 €), migration 20261008100000.
  DROP TABLE IF EXISTS _cpg;
  IF v_memo THEN
    CREATE TEMP TABLE _cpg ON COMMIT DROP AS
      SELECT * FROM _cpm_gl g WHERE g.at <= v_at;
  ELSE
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
  END IF;

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

  -- Premier billet, profil et zones : ne dépendent pas de la date de la base.
  IF NOT v_ready THEN
    DROP TABLE IF EXISTS _cpm_futm;
    CREATE TEMP TABLE _cpm_futm ON COMMIT DROP AS
    -- Le 1er billet VENDU (ni invitation, ni remboursé, ni duplicata), par
    -- date d'achat (20261010110000).
    SELECT DISTINCT ON (lower(et.buyer_email)) lower(et.buyer_email) AS email,
           et.utm->>'utm_source' AS utm_source, et.utm->>'utm_medium' AS utm_medium
      FROM public.external_tickets et
     WHERE et.buyer_email IS NOT NULL
       AND public._crm_ticket_is_sale(et.status, et.raw)
       AND ((p_venue_id IS NOT NULL AND et.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND et.organizer_user_id = p_organizer_user_id))
     ORDER BY lower(et.buyer_email), COALESCE(et.purchased_at, et.first_seen_at), et.id;
    DROP TABLE IF EXISTS _cpm_prof;
    CREATE TEMP TABLE _cpm_prof ON COMMIT DROP AS
    -- Profil rapporté par Shotgun (âge, genre, ville, pays) : la valeur connue
    -- la plus récente de chaque acheteur (catalogue de segments, 20261008200000).
    -- Entrée triée par (acheteur, date) : les quatre agrégats partagent le
    -- même ORDER BY et lisent ce tri une fois (agrégat pré-trié), au lieu de
    -- quatre tris par acheteur (20261016230000). Mêmes valeurs.
    SELECT t.email,
           (array_agg(t.age ORDER BY t.ts DESC) FILTER (WHERE t.age BETWEEN 12 AND 110))[1] AS age,
           (array_agg(t.gender ORDER BY t.ts DESC) FILTER (WHERE t.gender IN ('female', 'male', 'other')))[1] AS gender,
           (array_agg(upper(btrim(t.country_code)) ORDER BY t.ts DESC)
              FILTER (WHERE btrim(t.country_code) ~* '^[a-z]{2}$'))[1] AS country,
           (array_agg(btrim(t.city) ORDER BY t.ts DESC) FILTER (WHERE NULLIF(btrim(t.city), '') IS NOT NULL))[1] AS city
      FROM (SELECT lower(x.buyer_email) AS email, COALESCE(x.purchased_at, x.first_seen_at) AS ts,
                   x.age, x.gender, x.country_code, x.city
              FROM public.external_tickets x
             WHERE ((p_venue_id IS NOT NULL AND x.venue_id = p_venue_id)
                 OR (p_organizer_user_id IS NOT NULL AND x.organizer_user_id = p_organizer_user_id))
               AND x.buyer_email IS NOT NULL
               AND (x.age IS NOT NULL OR x.gender IS NOT NULL OR x.country_code IS NOT NULL OR x.city IS NOT NULL)
             ORDER BY 1, 2 DESC) t
     GROUP BY t.email;
    DROP TABLE IF EXISTS _cpm_akey;
    CREATE TEMP TABLE _cpm_akey ON COMMIT DROP AS
    -- Clé de zone (_crm_area_key) calculée UNE fois par lieu distinct, pas par
    -- personne : la fonction n'est pas « inlinée » (SET search_path) et
    -- coûtait 0,2 s sur 14 000 contacts (20261016220000). Tous les lieux
    -- possibles (billets, fiches) : un sur-ensemble suffit à la jointure.
    SELECT x.a, public._crm_area_key(x.a) AS k
      FROM (SELECT NULLIF(btrim(t.city), '') FROM public.external_tickets t
             WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
                 OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
               AND NULLIF(btrim(t.city), '') IS NOT NULL
            UNION SELECT NULLIF(btrim(c.city), '') FROM _cr c WHERE NULLIF(btrim(c.city), '') IS NOT NULL
            UNION SELECT NULLIF(btrim(c.zone), '') FROM _cr c WHERE NULLIF(btrim(c.zone), '') IS NOT NULL) x(a);
    IF v_memo THEN
      PERFORM set_config('yuno.crm_cp_memo_ready', v_scope, true);
    END IF;
  END IF;

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
    SELECT * FROM _cpm_futm
  ), prof AS (
    SELECT * FROM _cpm_prof
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
  ), akey AS (
    SELECT * FROM _cpm_akey
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
         ak.k AS area_key,
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
    LEFT JOIN akey ak ON ak.a = COALESCE(pr.city, b.f_city, b.f_zone)
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

CREATE OR REPLACE FUNCTION public.crm_segment_detail__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_seg_key text DEFAULT NULL::text, p_period text DEFAULT '30d'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_days integer := CASE p_period WHEN '90d' THEN 91 WHEN '12m' THEN 360 ELSE 30 END;
  v_now timestamptz := now();
  v_from timestamptz;
  v_def jsonb;
  v_p text;
  v_q text;
  v_entered integer;
  v_exited integer;
  v_sends jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT d.def INTO v_def FROM public._crm_segment_defs(p_venue_id, p_organizer_user_id) d WHERE d.seg_key = p_seg_key;
  IF v_def IS NULL THEN RETURN NULL; END IF;
  v_from := v_now - make_interval(days => v_days);
  v_p := public._crm_filter_sql(v_def, 'p');
  v_q := public._crm_filter_sql(v_def, 'q');

  -- La base au début de la période, gardée à part, puis celle d'aujourd'hui.
  -- Les deux partagent ce qui ne dépend pas de la date (mémoire de
  -- transaction de _crm_people_build, 20261016230000).
  PERFORM set_config('yuno.crm_cp_memo', COALESCE(public.crm_scope_key(p_venue_id, p_organizer_user_id), ''), true);
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, v_from);
  DROP TABLE IF EXISTS _cp0;
  CREATE TEMP TABLE _cp0 ON COMMIT DROP AS SELECT * FROM _cp;
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  PERFORM set_config('yuno.crm_cp_memo', '', true);

  EXECUTE format('SELECT count(*) FROM _cp p WHERE %s AND NOT EXISTS (SELECT 1 FROM _cp0 q WHERE q.email = p.email AND %s)', v_p, v_q)
    INTO v_entered;
  EXECUTE format('SELECT count(*) FROM _cp0 q WHERE %s AND NOT EXISTS (SELECT 1 FROM _cp p WHERE p.email = q.email AND %s)', v_q, v_p)
    INTO v_exited;

  PERFORM public._crm_msg_build(p_venue_id, p_organizer_user_id, v_from, v_now);
  EXECUTE format($q$
    WITH s AS (
      SELECT m.campaign_id, m.channel, min(m.sent_at) AS sent_at, count(*) AS received,
             count(*) FILTER (WHERE m.clicked) AS clicked, COALESCE(round(sum(m.revenue), 2), 0) AS revenue,
             count(DISTINCT m.email) FILTER (WHERE m.bought) AS buyers
        FROM _cm m JOIN _cp p ON p.email = m.email
       WHERE %s
       GROUP BY m.campaign_id, m.channel
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', s.campaign_id, 'channel', s.channel,
             'name', COALESCE(c.name, sc.name), 'sent_at', s.sent_at, 'received', s.received,
             'clicked', s.clicked, 'revenue', s.revenue, 'buyers', s.buyers) ORDER BY s.sent_at DESC), '[]'::jsonb)
      FROM s
      LEFT JOIN _cmc c ON s.channel = 'email' AND c.id = s.campaign_id
      LEFT JOIN public.sms_campaigns sc ON s.channel = 'sms' AND sc.id = s.campaign_id $q$, v_p)
    INTO v_sends;

  RETURN jsonb_build_object('key', p_seg_key, 'period', p_period, 'entered', v_entered, 'exited', v_exited, 'sends', v_sends);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_segment_counts_sweep()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sc record;
  v_n integer := 0;
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_anchor date;
BEGIN
  FOR v_sc IN
    SELECT v.id AS venue_id, NULL::uuid AS org FROM public.venues v
     WHERE v.product = 'crm' OR 'crm' = ANY (v.extra_products)
    UNION ALL
    SELECT NULL::text, o.user_id FROM public.organizer_profiles o
     WHERE o.product = 'crm' OR 'crm' = ANY (o.extra_products)
  LOOP
    -- Base du jour et dates repères partagent ce qui ne dépend pas de la date
    -- (mémoire de transaction de _crm_people_build, 20261016230000).
    PERFORM set_config('yuno.crm_cp_memo', COALESCE(public.crm_scope_key(v_sc.venue_id, v_sc.org), ''), true);
    BEGIN
      PERFORM public._crm_people_build(v_sc.venue_id, v_sc.org, NULL);
      PERFORM public._crm_segment_counts_write(v_sc.venue_id, v_sc.org, v_today);
      v_n := v_n + 1;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'crm_segment_counts_sweep % %: %', v_sc.venue_id, v_sc.org, SQLERRM;
    END;
    -- Dates repères de l'écran Segments (période 30 jours, la période par
    -- défaut), remplies d'avance (20261016220000) : chacune manquante coûte à
    -- l'écran une base complète au jour dit (~1,4 s sur un compte de 30 000
    -- billets). Un compte de moins d'un mois les rate chaque jour, puisque le
    -- balayage n'écrit que la date du jour. Même calcul, même instant de fin
    -- de journée que crm_segments_overview__core.
    BEGIN
      FOREACH v_anchor IN ARRAY ARRAY[v_today - 30, v_today - 20, v_today - 10] LOOP
        IF EXISTS (
          SELECT 1 FROM public._crm_segment_defs(v_sc.venue_id, v_sc.org) d
           WHERE NOT EXISTS (SELECT 1 FROM public.crm_segment_counts c
                              WHERE c.scope_key = public.crm_scope_key(v_sc.venue_id, v_sc.org)
                                AND c.seg_key = d.seg_key AND c.day = v_anchor)) THEN
          PERFORM public._crm_people_build(v_sc.venue_id, v_sc.org,
                                           ((v_anchor + 1)::timestamp AT TIME ZONE 'Europe/Paris') - interval '1 second');
          PERFORM public._crm_segment_counts_write(v_sc.venue_id, v_sc.org, v_anchor);
        END IF;
      END LOOP;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'crm_segment_counts_sweep anchors % %: %', v_sc.venue_id, v_sc.org, SQLERRM;
    END;
  END LOOP;
  PERFORM set_config('yuno.crm_cp_memo', '', true);
  DELETE FROM public.crm_segment_counts WHERE day < v_today - 800;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_segments_overview__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_tz text := 'Europe/Paris';
  v_days integer := CASE p_period WHEN '90d' THEN 91 WHEN '12m' THEN 360 ELSE 30 END;
  v_step integer := CASE p_period WHEN '90d' THEN 7 WHEN '12m' THEN 30 ELSE 1 END;
  v_now timestamptz := now();
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_from timestamptz;
  v_pfrom timestamptz;
  v_seg record;
  v_pred text;
  v_stats jsonb;
  v_msg jsonb;
  v_segs jsonb := '[]'::jsonb;
  v_tot jsonb;
  v_prev numeric;
  v_series jsonb;
  v_sends jsonb;
  v_pending integer := 0;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_from := v_now - make_interval(days => v_days);
  v_pfrom := v_from - make_interval(days => v_days);

  -- Dates repères manquantes : comptées, plus reconstruites ici
  -- (20261016230000). Chacune coûtait une base complète au jour dit
  -- (~1,4 s sur un compte de 30 000 billets, 3 au plus : jusqu'à 6 s). Le
  -- front les fait calculer juste après par crm_segments_fill_anchors, une
  -- par appel, puis relit l'écran ; le balayage nocturne remplit celles de la
  -- période 30 jours. En attendant, l'écart et l'étincelle s'appuient sur les
  -- comptes qui existent (n_start nul si la date de début manque).
  SELECT count(*) INTO v_pending
    FROM unnest(ARRAY[v_today - v_days, v_today - (v_days * 2 / 3), v_today - (v_days / 3)]) a(day)
   WHERE EXISTS (
     SELECT 1 FROM public._crm_segment_defs(p_venue_id, p_organizer_user_id) d
      WHERE NOT EXISTS (SELECT 1 FROM public.crm_segment_counts c
                         WHERE c.scope_key = v_scope AND c.seg_key = d.seg_key AND c.day = a.day));

  -- La base d'aujourd'hui, puis les messages de la période (et de la précédente).
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  PERFORM public._crm_segment_counts_write(p_venue_id, p_organizer_user_id, v_today);
  PERFORM public._crm_msg_build(p_venue_id, p_organizer_user_id, v_pfrom, v_now);

  -- Une ligne par segment.
  FOR v_seg IN SELECT * FROM public._crm_segment_defs(p_venue_id, p_organizer_user_id) ORDER BY sort LOOP
    v_pred := public._crm_filter_sql(v_seg.def, 'p');
    EXECUTE format($q$
      SELECT jsonb_build_object(
        'n', count(*),
        'reachable', count(*) FILTER (WHERE p.email_ok OR p.phone_ok),
        'email', count(*) FILTER (WHERE p.email_ok),
        'sms', count(*) FILTER (WHERE p.phone_ok),
        'avg_spend', CASE WHEN count(*) > 0 THEN round(sum(p.spent) / count(*), 2) END,
        'avg_nights', CASE WHEN count(*) > 0 THEN round(avg(p.nights)::numeric, 1) END,
        'sources', jsonb_build_object(
          'shotgun', count(*) FILTER (WHERE p.source = 'shotgun'),
          'utm', count(*) FILTER (WHERE p.source = 'utm'),
          'import', count(*) FILTER (WHERE p.source = 'import'),
          'other', count(*) FILTER (WHERE p.source NOT IN ('shotgun', 'utm', 'import'))))
        FROM _cp p WHERE %s $q$, v_pred) INTO v_stats;
    EXECUTE format($q$
      SELECT jsonb_build_object(
        'received', count(*),
        'clicked', count(*) FILTER (WHERE m.clicked),
        'ticketing', count(*) FILTER (WHERE m.ticketing),
        'bought', count(*) FILTER (WHERE m.bought),
        'buyers', count(DISTINCT m.email) FILTER (WHERE m.bought),
        'revenue', COALESCE(round(sum(m.revenue), 2), 0))
        FROM _cm m JOIN _cp p ON p.email = m.email
       WHERE m.sent_at >= %L AND %s $q$, v_from, v_pred) INTO v_msg;

    v_segs := v_segs || jsonb_build_array(
      jsonb_build_object('key', v_seg.seg_key, 'kind', v_seg.kind, 'name', v_seg.name, 'description', v_seg.description,
                         'template', v_seg.template, 'definition', v_seg.def, 'created_at', v_seg.created_at)
      || v_stats
      || jsonb_build_object('msg', v_msg,
           'n_start', (SELECT c.n FROM public.crm_segment_counts c
                        WHERE c.scope_key = v_scope AND c.seg_key = v_seg.seg_key AND c.day = v_today - v_days),
           'spark', (SELECT COALESCE(jsonb_agg(jsonb_build_object('d', c.day, 'n', c.n) ORDER BY c.day), '[]'::jsonb)
                       FROM public.crm_segment_counts c
                      WHERE c.scope_key = v_scope AND c.seg_key = v_seg.seg_key
                        AND c.day >= v_today - v_days AND c.day <= v_today)));
  END LOOP;

  -- Totaux de la période et ventes de la période précédente.
  SELECT jsonb_build_object(
           'received', count(*),
           'sends', count(DISTINCT m.campaign_id),
           'clicked', count(*) FILTER (WHERE m.clicked),
           'ticketing', count(*) FILTER (WHERE m.ticketing),
           'bought', count(*) FILTER (WHERE m.bought),
           'buyers', count(DISTINCT m.email) FILTER (WHERE m.bought),
           'revenue', COALESCE(round(sum(m.revenue), 2), 0))
    INTO v_tot
    FROM _cm m WHERE m.sent_at >= v_from;
  SELECT COALESCE(round(sum(m.revenue), 2), 0) INTO v_prev FROM _cm m WHERE m.sent_at < v_from;

  -- Ventes attribuées par tranche (jour / semaine / mois), date d'achat ;
  -- les envois de chaque tranche pour les points du graphique.
  WITH b AS (
    SELECT g AS i, v_now - make_interval(days => v_days - g * v_step) AS lo,
           v_now - make_interval(days => v_days - (g + 1) * v_step) AS hi
      FROM generate_series(0, v_days / v_step - 1) g
  ), att AS (
    SELECT a.amount, a.bought_at FROM _cma a
     WHERE EXISTS (SELECT 1 FROM _cm m WHERE m.campaign_id = a.campaign_id AND m.email = a.email AND m.sent_at >= v_from)
  )
  SELECT jsonb_agg(jsonb_build_object(
           't', b.lo,
           'v', COALESCE((SELECT round(sum(att.amount), 2) FROM att WHERE att.bought_at >= b.lo AND att.bought_at < b.hi), 0),
           'sends', COALESCE((SELECT jsonb_agg(c.name ORDER BY c.sent_at) FROM _cmc c WHERE c.sent_at >= b.lo AND c.sent_at < b.hi), '[]'::jsonb))
           ORDER BY b.i)
    INTO v_series FROM b;

  -- Les envois de la période (e-mail et SMS), du plus récent au plus ancien.
  WITH s AS (
    SELECT m.campaign_id, m.channel, min(m.sent_at) AS sent_at,
           count(*) AS received, count(*) FILTER (WHERE m.clicked) AS clicked,
           count(*) FILTER (WHERE m.ticketing) AS ticketing, count(*) FILTER (WHERE m.bought) AS bought,
           count(DISTINCT m.email) FILTER (WHERE m.bought) AS buyers, COALESCE(round(sum(m.revenue), 2), 0) AS revenue
      FROM _cm m WHERE m.sent_at >= v_from
     GROUP BY m.campaign_id, m.channel
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', s.campaign_id, 'channel', s.channel,
           'name', COALESCE(c.name, sc.name), 'sent_at', s.sent_at,
           'target', CASE WHEN s.channel = 'email' THEN public._crm_send_target(c.audiences_json) ELSE 'custom' END,
           'received', s.received, 'clicked', s.clicked, 'ticketing', s.ticketing, 'bought', s.bought,
           'buyers', s.buyers, 'revenue', s.revenue) ORDER BY s.sent_at DESC), '[]'::jsonb)
    INTO v_sends
    FROM s
    LEFT JOIN _cmc c ON s.channel = 'email' AND c.id = s.campaign_id
    LEFT JOIN public.sms_campaigns sc ON s.channel = 'sms' AND sc.id = s.campaign_id;

  RETURN jsonb_build_object(
    'period', p_period, 'from', v_from, 'to', v_now, 'step_days', v_step,
    'totals', v_tot || jsonb_build_object('prev_revenue', v_prev,
                         'has_prev', EXISTS (SELECT 1 FROM _cm m WHERE m.sent_at < v_from)),
    'series', COALESCE(v_series, '[]'::jsonb),
    'segments', v_segs,
    'sends', v_sends,
    'rules', (SELECT to_jsonb(r) FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id) r),
    'computed_at', v_now,
    'anchors_pending', v_pending);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_segments_fill_anchors(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
-- Calcule UNE date repère manquante de l'écran Segments (la plus ancienne) :
-- la base au jour dit, puis les comptes de chaque segment ce jour-là. Même
-- calcul que crm_segments_overview__core avant 20261016230000. Le front
-- l'appelle tant que `remaining` > 0, puis relit l'écran.
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_tz text := 'Europe/Paris';
  v_days integer := CASE p_period WHEN '90d' THEN 91 WHEN '12m' THEN 360 ELSE 30 END;
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_anchors date[];
  v_day date;
  v_left integer;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_anchors := ARRAY[v_today - v_days, v_today - (v_days * 2 / 3), v_today - (v_days / 3)];
  -- Deux onglets ouverts : le second attend le premier puis trouve la date faite.
  PERFORM pg_advisory_xact_lock(hashtext('crm_segment_anchors:' || v_scope));

  SELECT a.day INTO v_day
    FROM unnest(v_anchors) a(day)
   WHERE EXISTS (
     SELECT 1 FROM public._crm_segment_defs(p_venue_id, p_organizer_user_id) d
      WHERE NOT EXISTS (SELECT 1 FROM public.crm_segment_counts c
                         WHERE c.scope_key = v_scope AND c.seg_key = d.seg_key AND c.day = a.day))
   ORDER BY a.day LIMIT 1;
  IF v_day IS NOT NULL THEN
    PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id,
                                     ((v_day + 1)::timestamp AT TIME ZONE v_tz) - interval '1 second');
    PERFORM public._crm_segment_counts_write(p_venue_id, p_organizer_user_id, v_day);
  END IF;

  SELECT count(*) INTO v_left
    FROM unnest(v_anchors) a(day)
   WHERE EXISTS (
     SELECT 1 FROM public._crm_segment_defs(p_venue_id, p_organizer_user_id) d
      WHERE NOT EXISTS (SELECT 1 FROM public.crm_segment_counts c
                         WHERE c.scope_key = v_scope AND c.seg_key = d.seg_key AND c.day = a.day));
  RETURN jsonb_build_object('filled', v_day, 'remaining', v_left);
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_segments_fill_anchors(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_segments_fill_anchors(text, uuid, text) TO authenticated, service_role;

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
    -- dates repères de l'écran Segments, calculées après coup (20261016230000)
    'crm_segments_fill_anchors',
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
    'crm_segment_catalog',
    -- « Qui cibler » (20261011110000) : il construit `_cp`, il manquait ici
    'crm_night_targets',
    -- Scénarios (20261016140000) : effectifs, « Avant de publier », rapport
    'crm_scenario_counts', 'crm_scenario_preview', 'crm_scenario_report',
    -- Plan de soirée (20261016155000) : il passe par « Qui cibler »
    'crm_night_plan'
  ]::text[]);
$function$;
