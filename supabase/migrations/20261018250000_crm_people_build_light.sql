-- Communauté : une base des personnes « légère » (sorties identiques).
--
-- Communauté (Analyses) ne lit dans la base des personnes que le cycle de vie,
-- la joignabilité, les soirées et la dépense. _crm_people_build gagne
-- p_light : mêmes colonnes, mêmes règles pour tout ce qu'elle calcule, mais ni
-- source / utm, ni profil Shotgun (âge, genre, pays, lieu, zone), ni analyse
-- client, étiquettes, note, ni comportement face aux messages (NULL ou défaut).
-- ~0,6 s de moins sur 48 000 billets ; Communauté 12 m 3,7 → 3,0 s, une soirée
-- 3,3 → 2,4 s, md5 de la réponse égal (nouvelle version jouée d'abord, dans
-- une transaction propre, puis l'ancienne).
--
-- Nouveau paramètre = DROP + CREATE (une surcharge rendrait les appels à 2 ou
-- 3 arguments ambigus) ; ses appelants plpgsql résolvent à l'exécution.

DROP FUNCTION IF EXISTS public._crm_people_build(text, uuid, timestamp with time zone);
CREATE OR REPLACE FUNCTION public._crm_people_build(p_venue_id text, p_organizer_user_id uuid, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_light boolean DEFAULT false)
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
  -- p_light (20261018250000) : base LÉGÈRE, pour un écran qui ne lit que le
  -- cycle de vie, la joignabilité, les soirées et la dépense (Communauté).
  -- Mêmes colonnes, mais source, utm_*, âge / genre / pays / lieu Shotgun,
  -- area_key, an_tags / an_dist_km, étiquettes, note et comportement face aux
  -- messages (msg_n, click_*) ne sont pas calculés : NULL ou leur défaut.
  -- Tout le reste (soirées, dépense, cycle de vie, guest list…) est la même
  -- règle, mot pour mot. Ne JAMAIS la passer à un lecteur de ces colonnes.
BEGIN
  -- Portée de la base construite, lue par les clés de filtre qui interrogent
  -- une soirée (`ntgt`, 20261011110000) : jamais la soirée d'un autre compte.
  PERFORM set_config('yuno.crm_scope', COALESCE(v_scope, ''), true);
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);
  v_ready := v_memo AND COALESCE(current_setting('yuno.crm_cp_memo_ready', true), '') = v_scope
             AND to_regclass('pg_temp._cr') IS NOT NULL AND to_regclass('pg_temp._cpx') IS NOT NULL;
  IF NOT v_ready THEN
    PERFORM public.contact_build_rows(p_venue_id, p_organizer_user_id);
  END IF;

  -- Les billets de la portée, lus UNE fois (20261018110000) : ventes, guest
  -- list, premier billet, profil et lieux en sortent. Avant, cinq lectures de
  -- external_tickets (dont une par l'index des adresses sur TOUTE la table)
  -- coûtaient ~0,9 s sur 48 000 billets. Le canal du tarif se lit dans sa
  -- colonne (20261018100000), plus dans le billet brut. Sans borne de date :
  -- chaque base filtre ensuite à sa date ; en mémoire de transaction, la
  -- lecture sert à toutes les bases de la portée.
  IF NOT v_ready THEN
    DROP TABLE IF EXISTS _cpx;
    CREATE TEMP TABLE _cpx ON COMMIT DROP AS
      SELECT t.id, lower(t.buyer_email) AS email, GREATEST(t.quantity, 1) AS qty,
             COALESCE(t.price, 0) * GREATEST(t.quantity, 1) AS amount,
             COALESCE(t.purchased_at, t.first_seen_at) AS bought_at,
             t.event_id, e.start_at AS event_start,
             COALESCE(e.end_at, e.start_at + interval '6 hours') AS event_end,
             t.scanned_at, t.deal_name, t.price,
             public._crm_ticket_is_sale(t.status, t.deal_channel) AS sale,
             public._crm_ticket_gl_kind(t.status, t.price, t.deal_channel) AS kind,
             t.utm->>'utm_source' AS utm_source, t.utm->>'utm_medium' AS utm_medium,
             t.age, t.gender, t.country_code, t.city
        FROM public.external_tickets t
        LEFT JOIN public.events e ON e.id = t.event_id
       WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id));
  END IF;

  -- Billets vendus (mêmes colonnes que _crm_tickets).
  DROP TABLE IF EXISTS _cpt;
  CREATE TEMP TABLE _cpt ON COMMIT DROP AS
    SELECT x.id, x.email, x.qty, x.amount, x.bought_at, x.event_id, x.event_start, x.scanned_at, x.deal_name, x.price
      FROM _cpx x
     WHERE x.sale AND x.bought_at <= v_at;

  -- Guest list (invitations + billets à 0 €), migration 20261008100000.
  DROP TABLE IF EXISTS _cpg;
  CREATE TEMP TABLE _cpg ON COMMIT DROP AS
    SELECT x.email, x.event_id, x.event_start, x.event_end, x.kind,
           x.scanned_at, x.bought_at AS at, NULLIF(btrim(x.deal_name), '') AS deal
      FROM _cpx x
     WHERE x.email IS NOT NULL AND x.kind IS NOT NULL AND x.bought_at <= v_at;

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
  IF NOT v_ready AND p_light THEN
    -- Base légère : mêmes tables, vides (la requête principale reste la même).
    DROP TABLE IF EXISTS _cpm_futm;
    CREATE TEMP TABLE _cpm_futm ON COMMIT DROP AS
      SELECT x.email, x.utm_source, x.utm_medium FROM _cpx x WHERE false;
    DROP TABLE IF EXISTS _cpm_prof;
    CREATE TEMP TABLE _cpm_prof ON COMMIT DROP AS
      SELECT x.email, x.age, x.gender, x.country_code AS country, x.city FROM _cpx x WHERE false;
    DROP TABLE IF EXISTS _cpm_akey;
    CREATE TEMP TABLE _cpm_akey ON COMMIT DROP AS
      SELECT NULL::text AS a, NULL::text AS k WHERE false;
  ELSIF NOT v_ready THEN
    DROP TABLE IF EXISTS _cpm_futm;
    CREATE TEMP TABLE _cpm_futm ON COMMIT DROP AS
    -- Le 1er billet VENDU (ni invitation, ni remboursé, ni duplicata), par
    -- date d'achat (20261010110000).
    SELECT DISTINCT ON (x.email) x.email, x.utm_source, x.utm_medium
      FROM _cpx x
     WHERE x.email IS NOT NULL AND x.sale
     ORDER BY x.email, x.bought_at, x.id;
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
      FROM (SELECT x.email, x.bought_at AS ts, x.age, x.gender, x.country_code, x.city
              FROM _cpx x
             WHERE x.email IS NOT NULL
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
      FROM (SELECT NULLIF(btrim(t.city), '') FROM _cpx t
             WHERE NULLIF(btrim(t.city), '') IS NOT NULL
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
       AND NOT p_light
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
         CASE WHEN p_light THEN NULL
              WHEN pf.at IS NOT NULL AND (y.first_buy IS NULL OR pf.at < y.first_buy) THEN 'page'
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
         CASE WHEN NOT p_light THEN COALESCE(pr.age, CASE WHEN b.f_age BETWEEN 12 AND 110 THEN b.f_age END) END AS age,
         CASE WHEN NOT p_light THEN COALESCE(pr.gender, CASE WHEN b.f_gender IN ('female', 'male', 'other') THEN b.f_gender END) END AS gender,
         CASE WHEN NOT p_light THEN COALESCE(pr.country, CASE WHEN btrim(b.f_country) ~* '^[a-z]{2}$' THEN upper(btrim(b.f_country)) END) END AS country,
         CASE WHEN NOT p_light THEN COALESCE(pr.city, b.f_city, b.f_zone) END AS area,
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
    LEFT JOIN public.crm_person_profile ap ON NOT p_light AND ap.scope_key = v_scope AND ap.email = b.email
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
    LEFT JOIN public.crm_contact_notes n ON NOT p_light AND n.scope_key = v_scope AND n.email = b.email;

  -- Lu par personne plus bas (« a cliqué sans acheter ») et par les écrans
  -- (Parcours, Analyses) : sans index, chaque recherche relisait tous les
  -- billets — quadratique sur un compte de 30 000 billets (20261016210000).
  -- Créés APRÈS la base : la requête principale lit tous les billets, un index
  -- déjà posé l'y faisait passer par des accès aléatoires (0,2 s).
  CREATE INDEX ON _cpt (email, bought_at);
  CREATE INDEX ON _cpt (id);

  -- Comportement face aux messages (12 mois avant la date) : reçus, envois
  -- cliqués, et « a cliqué sans acheter » (dernier clic des 90 jours sans
  -- billet acheté dans les 7 jours qui suivent).
  ALTER TABLE _cp ADD COLUMN msg_n integer NOT NULL DEFAULT 0,
                  ADD COLUMN click_n integer NOT NULL DEFAULT 0,
                  ADD COLUMN last_click timestamptz,
                  ADD COLUMN click_nobuy boolean NOT NULL DEFAULT false;
  IF NOT p_light THEN
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

  END IF;

  SELECT count(*) INTO v_n FROM _cp;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_people_build(text, uuid, timestamp with time zone, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_people_build(text, uuid, timestamp with time zone, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_ana_community__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid, p_seg text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  m jsonb;
  v_n int;
  v_seg text;
  v_today date;
  v_series jsonb; v_lc jsonb; v_reach jsonb; v_stats jsonb; v_spark jsonb; v_cohort jsonb; v_hist jsonb;
  v_aud jsonb; v_age jsonb; v_city jsonb; v_top jsonb; v_wake jsonb; v_base_total int; v_base_prev int;
  v_next uuid;
  v_rules record;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  m := public._crm_ana_setup(p_venue_id, p_organizer_user_id, p_period, p_event, p_seg);
  -- _crm_ana_setup ne construit la base des personnes que pour un segment.
  IF m->>'seg' = 'all' THEN
    -- Base légère : cet écran ne lit ni la source, ni le profil Shotgun, ni
    -- les messages (_crm_people_build, p_light).
    PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL, true);
  END IF;
  v_n := (m->>'n')::int;
  v_seg := m->>'seg';
  v_today := (m->>'today')::date;
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);

  -- Les personnes regardées : toute la base, ou le segment ; pour une soirée,
  -- ses acheteurs.
  DROP TABLE IF EXISTS _apeo;
  CREATE TEMP TABLE _apeo ON COMMIT DROP AS
  WITH fb AS (
    SELECT a.email, min(a.bought_at) AS first_buy FROM _atk_all a WHERE a.ok GROUP BY a.email
  ), cr AS (
    -- La fiche (âge, ville) : une ligne par adresse, jointe d'un coup.
    SELECT DISTINCT ON (lower(x.email)) lower(x.email) AS em, x.age, x.city
      FROM _cr x WHERE x.email IS NOT NULL
     ORDER BY lower(x.email), (x.age IS NULL), (x.city IS NULL)
  )
  SELECT p.*, LEAST(p.first_night, p.added_at, fb.first_buy) AS joined_at,
         c.age AS c_age, c.city AS c_city
    FROM _cp p
    LEFT JOIN fb ON fb.email = p.email
    LEFT JOIN cr c ON c.em = p.email
   WHERE (v_seg = 'all' OR p.lifecycle = v_seg)
     AND (m->>'mode' <> 'event' OR EXISTS (SELECT 1 FROM _atk_all a WHERE a.email = p.email AND a.ok
                                            AND a.event_id = (m->'event'->>'id')::uuid));

  -- Courbe : la base au total à la fin de chaque case, et les nouveaux venus.
  -- Pour une soirée : ses acheteurs, jour après jour.
  IF m->>'mode' = 'event' THEN
    -- Une lecture par mesure (20261018100000) au lieu de quatre sous-requêtes
    -- par jour : 22 jours × 4 relisaient tous les billets (1,6 s sur
    -- 48 000 billets). Mêmes règles, jour pour jour :
    --   total      : acheteurs (de la base regardée) dont un billet tombe au
    --                plus tard dans la case → leur première case ;
    --   new        : acheteurs dont un billet de la case est leur PREMIER
    --                billet vendu (aucun billet vendu plus tôt) ;
    --   prev_total / prev_new : idem sur la soirée de comparaison, sans le
    --                filtre de la base (comme avant).
    WITH fm AS MATERIALIZED (
      SELECT a.email, min(a.bought_at) AS mb FROM _atk_all a WHERE a.ok AND a.email IS NOT NULL GROUP BY a.email
    ), ce AS MATERIALIZED (
      SELECT a.email, min(a.ci) AS mci FROM _atk_all a JOIN _apeo p ON p.email = a.email
       WHERE a.ok AND a.ci IS NOT NULL GROUP BY a.email
    ), cn AS MATERIALIZED (
      SELECT a.ci AS g, count(DISTINCT a.email) AS n
        FROM _atk_all a JOIN _apeo p ON p.email = a.email JOIN fm ON fm.email = a.email AND fm.mb = a.bought_at
       WHERE a.ok AND a.ci IS NOT NULL GROUP BY a.ci
    ), pe AS MATERIALIZED (
      SELECT a.email, min(a.pi) AS mpi FROM _atk_all a WHERE a.ok AND a.pi IS NOT NULL AND a.email IS NOT NULL GROUP BY a.email
    ), pn AS MATERIALIZED (
      SELECT a.pi AS g, count(DISTINCT a.email) AS n
        FROM _atk_all a JOIN fm ON fm.email = a.email AND fm.mb = a.bought_at
       WHERE a.ok AND a.pi IS NOT NULL GROUP BY a.pi
    )
    SELECT jsonb_agg(jsonb_build_object(
             'total', (SELECT count(*) FROM ce WHERE ce.mci <= g.g),
             'new', COALESCE((SELECT cn.n FROM cn WHERE cn.g = g.g), 0),
             'prev_total', (SELECT count(*) FROM pe WHERE pe.mpi <= g.g),
             'prev_new', COALESCE((SELECT pn.n FROM pn WHERE pn.g = g.g), 0)
           ) ORDER BY g.g)
      INTO v_series FROM generate_series(0, v_n - 1) g(g);
  ELSE
    -- Une passe sur la base (20261016220000) : la date de nuit, la case et la
    -- case de la période précédente de chaque personne sont calculées UNE
    -- fois, puis comptées par case. Avant, chaque case relisait toute la base
    -- en appelant _crm_ana_bucket (plpgsql) par personne : 2,7 s sur un
    -- compte de 14 000 contacts. Mêmes règles, mot pour mot :
    --   total    : arrivée (nuit) au plus tard à la fin de la case ;
    --   new      : _crm_ana_bucket(m, joined_at) = la case (même calcul, en SQL) ;
    --   prev_new : la tranche de même rang de la période précédente (le rang
    --              candidat est revérifié par le prédicat d'origine).
    WITH pj AS (
      SELECT p.joined_at AS ts,
             public._crm_night_date(p.joined_at, m->>'tz', (m->>'night_end_hour')::int) AS nd
        FROM _apeo p
       WHERE p.joined_at IS NOT NULL
    ), pk AS (
      SELECT pj.nd,
             CASE m->>'mode'
               WHEN 'hour' THEN floor(extract(epoch FROM pj.ts - (m->>'start')::timestamptz) / 3600)::int
               WHEN 'day' THEN pj.nd - (m->>'start')::date
               WHEN 'month' THEN ((extract(year FROM pj.nd) - extract(year FROM (m->>'start')::date)) * 12
                                  + extract(month FROM pj.nd) - extract(month FROM (m->>'start')::date))::int
             END AS i,
             CASE m->>'mode'
               WHEN 'hour' THEN floor(extract(epoch FROM pj.ts - ((m->>'start')::timestamptz - make_interval(hours => v_n))) / 3600)::int
               WHEN 'month' THEN ((extract(year FROM pj.nd) - extract(year FROM ((m->>'start')::date - interval '12 months')::date)) * 12
                                  + extract(month FROM pj.nd) - extract(month FROM ((m->>'start')::date - interval '12 months')::date))::int
               ELSE pj.nd - ((m->>'start')::date - v_n)
             END AS pi,
             pj.ts
        FROM pj
    ), pv AS (
      -- Rang de la période précédente, gardé seulement s'il vérifie le prédicat d'origine.
      SELECT pk.nd, CASE WHEN pk.i BETWEEN 0 AND v_n - 1 THEN pk.i END AS i,
             CASE WHEN pk.pi BETWEEN 0 AND v_n - 1 AND CASE m->>'mode'
                     WHEN 'hour' THEN pk.ts >= (m->>'start')::timestamptz - make_interval(hours => v_n - pk.pi)
                                      AND pk.ts < (m->>'start')::timestamptz - make_interval(hours => v_n - pk.pi - 1)
                     WHEN 'month' THEN pk.nd >= ((m->>'start')::date - interval '12 months' + make_interval(months => pk.pi))::date
                                       AND pk.nd < ((m->>'start')::date - interval '12 months' + make_interval(months => pk.pi + 1))::date
                     ELSE pk.nd = (m->>'start')::date - v_n + pk.pi END
                  THEN pk.pi END AS pi
        FROM pk
    ), byd AS MATERIALIZED (
      SELECT pv.nd, count(*) AS c FROM pv GROUP BY pv.nd
    ), byi AS MATERIALIZED (
      SELECT pv.i, count(*) AS c FROM pv WHERE pv.i IS NOT NULL GROUP BY pv.i
    ), byp AS MATERIALIZED (
      SELECT pv.pi, count(*) AS c FROM pv WHERE pv.pi IS NOT NULL GROUP BY pv.pi
    )
    SELECT jsonb_agg(jsonb_build_object(
             'total', COALESCE((SELECT sum(byd.c) FROM byd
                                 WHERE byd.nd <= CASE m->>'mode'
                                   WHEN 'hour' THEN public._crm_night_date((m->>'start')::timestamptz + make_interval(hours => g + 1), m->>'tz', (m->>'night_end_hour')::int)
                                   WHEN 'month' THEN ((m->>'start')::date + make_interval(months => g + 1) - interval '1 day')::date
                                   ELSE (m->>'start')::date + g END), 0)::bigint,
             'new', COALESCE((SELECT byi.c FROM byi WHERE byi.i = g), 0),
             'prev_new', COALESCE((SELECT byp.c FROM byp WHERE byp.pi = g), 0)
           ) ORDER BY g)
      INTO v_series FROM generate_series(0, v_n - 1) g;
  END IF;

  SELECT count(*) INTO v_base_total FROM _apeo;

  -- Cycle de vie (toute la base, ou les acheteurs de la soirée).
  SELECT jsonb_build_object(
           'hab', count(*) FILTER (WHERE lifecycle = 'hab'), 'occ', count(*) FILTER (WHERE lifecycle = 'occ'),
           'nou', count(*) FILTER (WHERE lifecycle = 'nou'), 'end', count(*) FILTER (WHERE lifecycle = 'end'),
           'none', count(*) FILTER (WHERE lifecycle = 'none'))
    INTO v_lc
    FROM _cp p
   WHERE m->>'mode' <> 'event' OR EXISTS (SELECT 1 FROM _atk_all a WHERE a.email = p.email AND a.ok
                                           AND a.event_id = (m->'event'->>'id')::uuid);

  SELECT jsonb_build_object(
           'total', count(*),
           'email_sms', count(*) FILTER (WHERE email_ok AND phone_ok),
           'email', count(*) FILTER (WHERE email_ok AND NOT phone_ok),
           'sms', count(*) FILTER (WHERE phone_ok AND NOT email_ok),
           'none', count(*) FILTER (WHERE NOT email_ok AND NOT phone_ok))
    INTO v_reach FROM _apeo;

  SELECT jsonb_build_object(
           'came', count(*) FILTER (WHERE nights > 0),
           'returning', count(*) FILTER (WHERE nights >= 2),
           'avg_nights', round(avg(nights) FILTER (WHERE nights > 0), 2),
           'spent', round(avg(spent) FILTER (WHERE nights > 0), 2))
    INTO v_stats FROM _apeo;

  -- Les mêmes mesures à la fin des six derniers mois (étincelles, écart).
  -- Une passe (20261016220000) au lieu de six : chaque billet porte le rang k
  -- le plus ancien dont la borne le suit, puis chaque personne compte, pour
  -- chaque k, ses soirées et sa dépense d'avant la borne. Mêmes nombres.
  WITH cut AS (
    -- Les six bornes, de la plus récente (k = 0, maintenant) à la plus ancienne.
    SELECT now() AS c0,
           (date_trunc('month', now() AT TIME ZONE 'Europe/Paris') - make_interval(months => 0)) AT TIME ZONE 'Europe/Paris' AS c1,
           (date_trunc('month', now() AT TIME ZONE 'Europe/Paris') - make_interval(months => 1)) AT TIME ZONE 'Europe/Paris' AS c2,
           (date_trunc('month', now() AT TIME ZONE 'Europe/Paris') - make_interval(months => 2)) AT TIME ZONE 'Europe/Paris' AS c3,
           (date_trunc('month', now() AT TIME ZONE 'Europe/Paris') - make_interval(months => 3)) AT TIME ZONE 'Europe/Paris' AS c4,
           (date_trunc('month', now() AT TIME ZONE 'Europe/Paris') - make_interval(months => 4)) AT TIME ZONE 'Europe/Paris' AS c5
  ), tk AS (
    -- kk = le plus grand k dont la borne suit l'achat (les bornes reculent avec k).
    SELECT a.email, a.event_id, a.amount,
           CASE WHEN a.bought_at < cut.c5 THEN 5 WHEN a.bought_at < cut.c4 THEN 4 WHEN a.bought_at < cut.c3 THEN 3
                WHEN a.bought_at < cut.c2 THEN 2 WHEN a.bought_at < cut.c1 THEN 1 WHEN a.bought_at < cut.c0 THEN 0 END AS kk
      FROM _atk_all a JOIN _apeo p ON p.email = a.email CROSS JOIN cut
     WHERE a.ok AND a.event_id IS NOT NULL
  ), pe AS (
    -- Par personne et soirée : la borne la plus ancienne qu'un billet précède.
    SELECT tk.email, tk.event_id, max(tk.kk) AS kev FROM tk WHERE tk.kk IS NOT NULL GROUP BY tk.email, tk.event_id
  ), ps AS (
    -- Par personne et rang : la dépense.
    SELECT tk.email, tk.kk, sum(tk.amount) AS s FROM tk WHERE tk.kk IS NOT NULL GROUP BY tk.email, tk.kk
  ), pp AS (
    -- Une ligne par personne, sans jointure entre agrégats (estimations sûres).
    SELECT u.email,
           count(*) FILTER (WHERE u.kev >= 0) AS n0, count(*) FILTER (WHERE u.kev >= 1) AS n1,
           count(*) FILTER (WHERE u.kev >= 2) AS n2, count(*) FILTER (WHERE u.kev >= 3) AS n3,
           count(*) FILTER (WHERE u.kev >= 4) AS n4, count(*) FILTER (WHERE u.kev >= 5) AS n5,
           sum(u.s) FILTER (WHERE u.kk >= 0) AS s0, sum(u.s) FILTER (WHERE u.kk >= 1) AS s1,
           sum(u.s) FILTER (WHERE u.kk >= 2) AS s2, sum(u.s) FILTER (WHERE u.kk >= 3) AS s3,
           sum(u.s) FILTER (WHERE u.kk >= 4) AS s4, sum(u.s) FILTER (WHERE u.kk >= 5) AS s5
      FROM (SELECT pe.email, pe.kev, NULL::integer AS kk, NULL::numeric AS s FROM pe
            UNION ALL
            SELECT ps.email, NULL::integer, ps.kk, ps.s FROM ps) u
     GROUP BY u.email
  ), x AS (
    SELECT v.k, pp.email, v.n, v.s
      FROM pp
     CROSS JOIN LATERAL (VALUES (0, pp.n0, pp.s0), (1, pp.n1, pp.s1), (2, pp.n2, pp.s2),
                                (3, pp.n3, pp.s3), (4, pp.n4, pp.s4), (5, pp.n5, pp.s5)) v(k, n, s)
     WHERE v.n > 0
  )
  SELECT jsonb_agg(jsonb_build_object('returning_pct', q.rp, 'avg_nights', q.an, 'spent', q.sp) ORDER BY q.k DESC)
    INTO v_spark FROM (
      SELECT k,
             round(100.0 * count(*) FILTER (WHERE n >= 2) / NULLIF(count(*), 0), 1) AS rp,
             round(avg(n), 2) AS an, round(avg(s), 2) AS sp
        FROM x
       GROUP BY k) q;

  -- Qui revient : les cinq dernières soirées passées, et la part de leurs
  -- acheteurs revenus aux soirées suivantes (+1 à +4).
  WITH evs AS (
    SELECT e.id, e.title, e.start_at, e.night, row_number() OVER (ORDER BY e.start_at) AS rn
      FROM _aev e WHERE EXISTS (SELECT 1 FROM _atk_all a WHERE a.event_id = e.id AND a.ok)
  ), last5 AS (
    SELECT * FROM evs WHERE start_at < now() ORDER BY start_at DESC LIMIT 5
  ), rel AS (
    -- Les seules soirées lues plus bas : les cinq et leurs quatre suivantes
    -- (20261016220000 : la liste des acheteurs n'est plus relue en entier).
    SELECT l.id FROM last5 l
    UNION SELECT nx.id FROM last5 l JOIN evs nx ON nx.rn BETWEEN l.rn + 1 AND l.rn + 4
  ), buyers AS (
    SELECT DISTINCT a.event_id, a.email FROM _atk_all a JOIN _apeo p ON p.email = a.email
     WHERE a.ok AND a.email IS NOT NULL AND a.event_id IN (SELECT rel.id FROM rel)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', l.id, 'title', l.title, 'night', l.night,
           'buyers', (SELECT count(*) FROM buyers b WHERE b.event_id = l.id),
           'back', (SELECT jsonb_agg(CASE WHEN nx.id IS NULL THEN NULL ELSE
                       (SELECT round(100.0 * count(*) / NULLIF((SELECT count(*) FROM buyers b0 WHERE b0.event_id = l.id), 0), 0)
                          FROM buyers b WHERE b.event_id = l.id
                           AND EXISTS (SELECT 1 FROM buyers b2 WHERE b2.event_id = nx.id AND b2.email = b.email)) END ORDER BY s)
                     FROM generate_series(1, 4) s LEFT JOIN evs nx ON nx.rn = l.rn + s)
         ) ORDER BY l.start_at), '[]'::jsonb)
    INTO v_cohort FROM last5 l;

  SELECT jsonb_build_object(
           'n1', count(*) FILTER (WHERE nights = 1), 'n2', count(*) FILTER (WHERE nights = 2),
           'n3', count(*) FILTER (WHERE nights BETWEEN 3 AND 4), 'n5', count(*) FILTER (WHERE nights BETWEEN 5 AND 9),
           'n10', count(*) FILTER (WHERE nights >= 10))
    INTO v_hist FROM _apeo;

  -- Qui vient : les acheteurs de la fenêtre, par cycle de vie.
  WITH lg AS (
    SELECT p.lifecycle AS k, count(DISTINCT x.email) AS buyers, COALESCE(round(sum(x.amount), 2), 0) AS revenue
      FROM _atk x JOIN _cp p ON p.email = x.email
     WHERE x.ok AND x.ci IS NOT NULL AND p.lifecycle IN ('nou', 'occ', 'hab', 'end')
     GROUP BY p.lifecycle
  )
  SELECT jsonb_build_object(
           'buyers', (SELECT count(DISTINCT a.email) FROM _atk a WHERE a.ok AND a.ci IS NOT NULL),
           'groups', (SELECT jsonb_object_agg(g.k, jsonb_build_object(
                          'buyers', COALESCE(lg.buyers, 0),
                          'revenue', COALESCE(lg.revenue, 0)))
                        FROM unnest(ARRAY['nou', 'occ', 'hab', 'end']) g(k) LEFT JOIN lg ON lg.k = g.k))
    INTO v_aud;

  -- Âge et lieu : billets d'abord (déclarés à l'achat), sinon la fiche.
  WITH ta AS (
    SELECT a.email, max(a.age) AS age FROM _atk_all a WHERE a.age BETWEEN 14 AND 99 GROUP BY a.email
  ), tc AS (
    SELECT DISTINCT ON (a.email) a.email, a.city FROM _atk_all a WHERE a.city IS NOT NULL ORDER BY a.email, a.bought_at DESC
  ), pa AS (
    SELECT p.email,
           COALESCE(ta.age, NULLIF(p.c_age, 0)) AS age,
           COALESCE(tc.city, NULLIF(btrim(p.c_city), '')) AS city
      FROM _apeo p
      LEFT JOIN ta ON ta.email = p.email
      LEFT JOIN tc ON tc.email = p.email
  )
  SELECT jsonb_build_object(
           'known', count(*) FILTER (WHERE age IS NOT NULL), 'total', count(*),
           'b', jsonb_build_array(count(*) FILTER (WHERE age BETWEEN 14 AND 21), count(*) FILTER (WHERE age BETWEEN 22 AND 25),
                                  count(*) FILTER (WHERE age BETWEEN 26 AND 30), count(*) FILTER (WHERE age BETWEEN 31 AND 35),
                                  count(*) FILTER (WHERE age >= 36))),
         jsonb_build_object(
           'known', count(*) FILTER (WHERE city IS NOT NULL), 'total', count(*),
           'top', (SELECT COALESCE(jsonb_agg(jsonb_build_object('city', c, 'n', k) ORDER BY k DESC), '[]'::jsonb) FROM (
                     -- initcap par ville distincte, puis regroupement (même compte).
                     SELECT initcap(lower(pc.city)) AS c, sum(pc.n)::bigint AS k
                       FROM (SELECT city, count(*) AS n FROM pa WHERE city IS NOT NULL GROUP BY city) pc
                      GROUP BY 1 ORDER BY 2 DESC LIMIT 5) t))
    INTO v_age, v_city FROM pa;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'email', p.email, 'first_name', p.first_name, 'last_name', p.last_name,
           'nights', p.nights, 'spent', p.spent, 'last_night', p.last_night) ORDER BY p.spent DESC), '[]'::jsonb)
    INTO v_top FROM (SELECT email, first_name, last_name, nights, spent, last_night
                       FROM _apeo WHERE nights > 0 ORDER BY spent DESC, nights DESC LIMIT 5) p;

  -- À réveiller : endormis, venus une seule fois (il y a plus d'un mois),
  -- habitués sans place pour la prochaine soirée.
  SELECT id INTO v_next FROM _aev WHERE upcoming ORDER BY start_at LIMIT 1;
  SELECT jsonb_build_object(
           'end', jsonb_build_object('n', count(*) FILTER (WHERE lifecycle = 'end'),
                                     'reachable', count(*) FILTER (WHERE lifecycle = 'end' AND (email_ok OR phone_ok))),
           'once', jsonb_build_object('n', count(*) FILTER (WHERE nights = 1 AND last_night < now() - interval '30 days'),
                                      'reachable', count(*) FILTER (WHERE nights = 1 AND last_night < now() - interval '30 days' AND (email_ok OR phone_ok))),
           'hab_no_ticket', CASE WHEN v_next IS NOT NULL THEN jsonb_build_object(
               'event_id', v_next, 'title', (SELECT title FROM _aev WHERE id = v_next),
               'n', count(*) FILTER (WHERE lifecycle = 'hab' AND NOT EXISTS (
                      SELECT 1 FROM _atk_all a WHERE a.email = _cp.email AND a.ok AND a.event_id = v_next)),
               'reachable', count(*) FILTER (WHERE lifecycle = 'hab' AND (email_ok OR phone_ok) AND NOT EXISTS (
                      SELECT 1 FROM _atk_all a WHERE a.email = _cp.email AND a.ok AND a.event_id = v_next))) END)
    INTO v_wake FROM _cp;

  RETURN jsonb_build_object(
    'meta', m,
    'rules', jsonb_build_object('min_nights', v_rules.regular_min_nights, 'window_months', v_rules.regular_window_months,
                                'lapse_months', v_rules.lapse_months),
    'series', COALESCE(v_series, '[]'::jsonb),
    'base', v_base_total,
    'lifecycle', v_lc,
    'reach', v_reach,
    'stats', v_stats,
    'spark', COALESCE(v_spark, '[]'::jsonb),
    'cohort', v_cohort,
    'hist', v_hist,
    'audience', v_aud,
    'age', v_age,
    'city', v_city,
    'top', v_top,
    'wake', v_wake,
    'has_any', EXISTS (SELECT 1 FROM _cp)
  );
END;
$function$;
