-- Base légère : ni guest list, ni index de _cpt.
--
-- Communauté et Clients (seuls appelants de p_light) ne lisent ni la guest
-- list de la base (gl_*, gl_conv), ni tonight / upcoming, ni _cpt par index :
-- en base légère, le calcul de la guest list (avec sa règle de porte) et les
-- deux index de _cpt sont sautés (~0,2 s). Le cycle de vie ne change pas (il
-- lit la place à venir des billets, pas de la guest list). Communauté 12 m
-- 3,1 → 2,8 s, Clients 2,0 → 1,6 s, réponses identiques (md5).

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
  -- messages (msg_n, click_*), guest list (gl_*, gl_conv), tonight, upcoming
  -- ne sont pas calculés : NULL ou leur défaut ; _cpt n'a pas ses index.
  -- Tout le reste (soirées, dépense, cycle de vie, guest list…) est la même
  -- règle, mot pour mot. Ne JAMAIS la passer à un lecteur de ces colonnes.
BEGIN
  -- Portée de la base construite, lue par les clés de filtre qui interrogent
  -- une soirée (`ntgt`, 20261011110000) : jamais la soirée d'un autre compte.
  PERFORM set_config('yuno.crm_scope', COALESCE(v_scope, ''), true);
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);
  -- Une base légère réutilise la mémoire d'une base complète ou légère ; une
  -- base complète, seulement celle d'une base complète (tables pleines).
  v_ready := v_memo AND (COALESCE(current_setting('yuno.crm_cp_memo_ready', true), '') = v_scope
                         OR (p_light AND COALESCE(current_setting('yuno.crm_cp_memo_light', true), '') = v_scope))
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
    IF v_memo THEN
      PERFORM set_config('yuno.crm_cp_memo_light', v_scope, true);
    END IF;
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
     WHERE NOT p_light
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
         COALESCE(y.events, '{}'::uuid[]) AS events,
         CASE WHEN NOT p_light THEN COALESCE(y.tonight, false) OR COALESCE(g.gl_tonight, false) END AS tonight,
         CASE WHEN p_light THEN NULL
              WHEN pf.at IS NOT NULL AND (y.first_buy IS NULL OR pf.at < y.first_buy) THEN 'page'
              WHEN COALESCE(a.nights, 0) > 0 AND lower(u.utm_source) LIKE 'yuno%' THEN 'utm'
              WHEN COALESCE(a.nights, 0) > 0 THEN 'shotgun'
              WHEN b.origin IN ('import', 'both') THEN 'import'
              ELSE 'other' END AS source,
         CASE WHEN NOT p_light THEN u.utm_source END AS utm_source,
         CASE WHEN NOT p_light THEN u.utm_medium END AS utm_medium,
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
         CASE WHEN NOT p_light THEN (g.gl_first IS NOT NULL AND y.first_paid IS NOT NULL AND y.first_paid > g.gl_first) END AS gl_conv,
         -- Catalogue de segments (20261008200000) : profil (Shotgun d'abord, puis
         -- vos fichiers), place pour une soirée à venir, dépense par soirée payée.
         CASE WHEN NOT p_light THEN COALESCE(pr.age, CASE WHEN b.f_age BETWEEN 12 AND 110 THEN b.f_age END) END AS age,
         CASE WHEN NOT p_light THEN COALESCE(pr.gender, CASE WHEN b.f_gender IN ('female', 'male', 'other') THEN b.f_gender END) END AS gender,
         CASE WHEN NOT p_light THEN COALESCE(pr.country, CASE WHEN btrim(b.f_country) ~* '^[a-z]{2}$' THEN upper(btrim(b.f_country)) END) END AS country,
         CASE WHEN NOT p_light THEN COALESCE(pr.city, b.f_city, b.f_zone) END AS area,
         CASE WHEN NOT p_light THEN ak.k END AS area_key,
         CASE WHEN NOT p_light THEN (COALESCE(y.upcoming, false) OR COALESCE(g.gl_upcoming, false)) END AS upcoming,
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
  IF NOT p_light THEN
    CREATE INDEX ON _cpt (email, bought_at);
    CREATE INDEX ON _cpt (id);
  END IF;

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
