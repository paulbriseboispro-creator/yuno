-- Yuno Tickets › Clients, Segments, Imports — les écrans Clients de Yuno CRM
-- (liste et fiche client, Segments et leur catalogue, Imports de fichiers)
-- branchés sur les ventes que Yuno fait lui-même. Demande de Paul (22/10),
-- deuxième étape après les Analyses (20261109300000).
--
-- Même méthode que les Analyses : chaque fonction `crm_*` de la prod
-- (pg_get_functiondef du 22/10) est recopiée sous le nom `tix_*`, seule la
-- source change :
--   * les personnes : `_tix_people_build` (ventes Yuno, contacts et fichiers
--     de Yuno Tickets, `product IS NULL`) au lieu de `_crm_people_build` ;
--   * les campagnes : `NOT crm_campaign_is_crm` ; les SMS : `product IS NULL` ;
--   * la porte : `_tix_allowed` (lecture), `_tix_writable` (écriture),
--     l'argent : `_tix_money_gate`.
-- Aucune fonction du CRM n'est modifiée.
--
-- Décisions de Paul (22/10) :
--   1. Les segments de Yuno Tickets vivent dans `tix_segments` (même grammaire
--      de filtre que le CRM). Une campagne les vise par l'audience
--      `{kind: 'tix', segmentId | def}` (e-mail : resolve_campaign_audience →
--      _tix_campaign_audience ; SMS : type 'tix_segment' ; push : 'tix:<id>').
--      Les anciens segments (contact_segments, venue_segments) ne changent pas.
--   2. « Écrire à… » crée un brouillon déjà ciblé (front).
--   3. L'import passe par import_contact_list(…, produit NULL), seule porte
--      d'écriture, avec l'attestation de Yuno Tickets (origine, date).
--   4. « Ce qui fait venir », hypothèses et score restent au CRM ; la fiche
--      client garde le bannissement du club.
--
-- Les tables du CRM qui portent une clé de portée sans produit (crm_segments,
-- crm_contact_notes, crm_segment_counts, crm_imports, crm_import_journal) ont
-- ici une sœur `tix_*` : un compte qui a les deux produits ne voit jamais les
-- segments, notes, comptes ou imports de l'autre outil.

-- ── Tables ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tix_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL,
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  description text,
  template text,
  definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((venue_id IS NULL) <> (organizer_user_id IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_tix_segments_scope ON public.tix_segments (scope_key, created_at);

-- Étiquettes et note d'un client (fiche client).
CREATE TABLE IF NOT EXISTS public.tix_contact_notes (
  scope_key text NOT NULL,
  email text NOT NULL,
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  note text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, email),
  CHECK ((venue_id IS NULL) <> (organizer_user_id IS NULL))
);

-- Effectif d'un segment à une date (évolution de l'écran Segments).
CREATE TABLE IF NOT EXISTS public.tix_segment_counts (
  scope_key text NOT NULL,
  seg_key text NOT NULL,
  day date NOT NULL,
  n integer,
  reachable integer,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, seg_key, day)
);

-- Un import fait depuis l'écran Imports (la liste vit dans contact_list_imports).
CREATE TABLE IF NOT EXISTS public.tix_imports (
  list_import_id uuid PRIMARY KEY REFERENCES public.contact_list_imports(id) ON DELETE CASCADE,
  scope_key text NOT NULL,
  venue_id text,
  organizer_user_id uuid,
  kind text NOT NULL DEFAULT 'file' CHECK (kind IN ('file', 'manual')),
  title text,
  consent text NOT NULL CHECK (consent IN ('yes', 'no')),
  mode text NOT NULL DEFAULT 'complete' CHECK (mode IN ('complete', 'keep')),
  new_count integer NOT NULL DEFAULT 0,
  existing_count integer NOT NULL DEFAULT 0,
  file_dup_count integer NOT NULL DEFAULT 0,
  bad_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'undone')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  undone_at timestamptz,
  undone_by uuid
);
CREATE INDEX IF NOT EXISTS tix_imports_scope_idx ON public.tix_imports (scope_key, created_at DESC);

-- L'état d'abonnement d'avant de chaque adresse déjà connue (annulation).
CREATE TABLE IF NOT EXISTS public.tix_import_journal (
  list_import_id uuid NOT NULL REFERENCES public.tix_imports(list_import_id) ON DELETE CASCADE,
  email text NOT NULL,
  prev_opted_in boolean,
  prev_import_id uuid,
  prev_first_name text,
  prev_last_name text,
  PRIMARY KEY (list_import_id, email)
);

-- Tout passe par les fonctions : RLS sans policy.
ALTER TABLE public.tix_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tix_contact_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tix_segment_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tix_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tix_import_journal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tix_segments, public.tix_contact_notes, public.tix_segment_counts,
              public.tix_imports, public.tix_import_journal FROM anon, authenticated;

-- ── Portes ──────────────────────────────────────────────────────────────

-- Écrire (segments, notes, imports) : la lecture de la portée, plus la gestion
-- du club ou le rôle fondateur / admin / éditeur de l'organisation.
CREATE OR REPLACE FUNCTION public._tix_writable(p_venue_id text, p_organizer_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(public._tix_allowed(p_venue_id, p_organizer_user_id)
                  AND public.crm_scope_writable(p_venue_id, p_organizer_user_id), false);
$$;

-- La grammaire de filtre du CRM (_crm_filter_sql), avec les sources de Yuno
-- Tickets : 'yuno' (venu par une vente Yuno), 'import', 'other'. « Qui
-- cibler » (`ntgt`) est un écran du CRM : il ne retient personne ici. Une
-- valeur illisible ne retient personne, comme dans le CRM.
CREATE OR REPLACE FUNCTION public._tix_filter_sql(p_def jsonb, p_alias text DEFAULT 'p'::text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $function$
DECLARE
  a text := quote_ident(COALESCE(p_alias, 'p'));
  d jsonb := COALESCE(p_def, '{}'::jsonb);
  f jsonb;
  v_base text;
  v_src text := NULL;
  lst text;
BEGIN
  IF jsonb_typeof(d) = 'object' AND jsonb_typeof(d->'f') = 'object' THEN
    f := d->'f';
    IF f ? 'ntgt' AND jsonb_typeof(f->'ntgt') <> 'null' THEN RETURN 'false'; END IF;
    IF f ? 'src' AND jsonb_typeof(f->'src') <> 'null' THEN
      IF jsonb_typeof(f->'src') <> 'array' THEN RETURN 'false'; END IF;
      IF jsonb_array_length(f->'src') > 0 THEN
        SELECT string_agg(format('%L', x), ',') INTO lst
          FROM jsonb_array_elements_text(f->'src') x WHERE x IN ('yuno', 'import', 'other');
        v_src := CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.source IN (%s)', a, lst) END;
      END IF;
    END IF;
    d := jsonb_set(d, '{f}', f - 'src' - 'ntgt');
  END IF;
  v_base := public._crm_filter_sql(d, p_alias);
  IF v_src IS NULL THEN RETURN v_base; END IF;
  RETURN '(' || v_base || ' AND ' || v_src || ')';
END;
$function$;

-- ── Les personnes (_cp) : étiquettes et note de Yuno Tickets ─────────────
-- Même fonction que 20261109300000, deux changements : la jointure des
-- étiquettes et de la note lit tix_contact_notes (elle ne lisait rien), et
-- un acheteur d'une soirée à venir est « venu par Yuno » (il était « autre »).
CREATE OR REPLACE FUNCTION public._tix_people_build(p_venue_id text, p_organizer_user_id uuid, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_light boolean DEFAULT false)
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
  -- Pas de mémoire de transaction ici : chaque écran construit sa base une fois.
  v_memo boolean := false;
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
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);
  -- Une base légère réutilise la mémoire d'une base complète ou légère ; une
  -- base complète, seulement celle d'une base complète (tables pleines).
  v_ready := false;
  IF NOT v_ready THEN
    PERFORM public.contact_build_rows(p_venue_id, p_organizer_user_id, 'suite');
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
      SELECT t.id, t.email, t.quantity AS qty, t.amount,
             t.purchased_at AS bought_at,
             t.event_id, e.start_at AS event_start,
             e.end_at AS event_end,
             t.scanned_at, t.deal_name, t.price,
             public._crm_ticket_is_sale(t.status, t.deal_channel) AS sale,
             public._crm_ticket_gl_kind(t.status, t.price, t.deal_channel) AS kind,
             t.src, NULL::text AS utm_medium,
             t.age, t.gender, NULL::text AS country_code, t.city, t.status
        FROM public._tix_sales(p_venue_id, p_organizer_user_id) t
        LEFT JOIN public._tix_scope_events(p_venue_id, p_organizer_user_id) e ON e.id = t.event_id;
  END IF;

  -- Billets vendus (mêmes colonnes que _crm_tickets).
  DROP TABLE IF EXISTS _cpt;
  CREATE TEMP TABLE _cpt ON COMMIT DROP AS
    SELECT x.id, x.email, x.qty, x.amount, x.bought_at, x.event_id, x.event_start, x.scanned_at, x.deal_name, x.price, x.src
      FROM _cpx x
     WHERE x.sale AND x.bought_at <= v_at;

  -- Guest list (invitations + billets à 0 €), migration 20261008100000.
  DROP TABLE IF EXISTS _cpg;
  CREATE TEMP TABLE _cpg ON COMMIT DROP AS
    SELECT x.email, x.event_id, x.event_start, x.event_end, x.kind,
           x.scanned_at, x.bought_at AS at, NULLIF(btrim(x.deal_name), '') AS deal
      FROM _cpx x
     WHERE x.email IS NOT NULL AND x.kind IS NOT NULL AND x.bought_at <= v_at;

  -- Soirées faites (audit 18/10, DATA-02, décision de Paul) : un billet vendu
  -- (même à 0 €) ou une invitation scannée, SAUF une entrée gratuite non
  -- scannée sur une porte mesurée (_crm_sale_counts_as_night) : là, on sait
  -- que la personne n'est pas venue. `came` = soirée faite ; les autres lignes
  -- disent seulement « avait une place » (provenance). Lue aussi par la fiche
  -- client et _crm_activity_build.
  DROP TABLE IF EXISTS _cpd;
  CREATE TEMP TABLE _cpd ON COMMIT DROP AS
    -- Porte mesurée (miroir de _crm_measured_doors) : soirées terminées à la
    -- date, au moins 10 entrées scannées et au moins 10 % des places valides.
    SELECT x.event_id FROM _cpx x
     WHERE x.status = 'valid' AND x.event_id IS NOT NULL AND x.event_end <= v_at
     GROUP BY x.event_id
    HAVING public._crm_door_measured(count(*), count(*) FILTER (WHERE x.scanned_at IS NOT NULL));
  DROP TABLE IF EXISTS _cpa;
  CREATE TEMP TABLE _cpa ON COMMIT DROP AS
    SELECT t.email, t.event_id, t.event_start,
           public._crm_sale_counts_as_night(t.price, t.scanned_at IS NOT NULL, d.event_id IS NOT NULL) AS came
      FROM _cpt t LEFT JOIN _cpd d ON d.event_id = t.event_id
     WHERE t.email IS NOT NULL
    UNION ALL
    SELECT g.email, g.event_id, g.event_start, true
      FROM _cpg g
     WHERE g.kind = 'inv' AND g.scanned_at IS NOT NULL AND g.event_id IS NOT NULL;

  -- « Ce soir » : la prochaine soirée si elle a lieu aujourd'hui (ou est en cours).
  SELECT e.id INTO v_tonight
    FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) e
   WHERE e.end_at > v_at
     AND (e.start_at AT TIME ZONE e.tz)::date <= (v_at AT TIME ZONE e.tz)::date
   ORDER BY e.start_at LIMIT 1;

  -- Premier billet, profil et zones : ne dépendent pas de la date de la base.
  IF NOT v_ready AND p_light THEN
    -- Base légère : mêmes tables, vides (la requête principale reste la même).
    DROP TABLE IF EXISTS _cpm_futm;
    CREATE TEMP TABLE _cpm_futm ON COMMIT DROP AS
      SELECT x.email, x.src AS utm_source, x.utm_medium FROM _cpx x WHERE false;
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
    SELECT DISTINCT ON (x.email) x.email, x.src AS utm_source, x.utm_medium
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
    -- Une soirée faite : voir _cpa plus haut (DATA-02).
    SELECT a.email, a.event_id, a.event_start, a.came FROM _cpa a
  ), agg AS (
    SELECT a.email,
           count(DISTINCT a.event_id) FILTER (WHERE a.came AND a.event_start <= v_at) AS nights,
           count(DISTINCT a.event_id) FILTER (WHERE a.came AND a.event_start <= v_at
                 AND a.event_start > v_at - make_interval(months => v_rules.regular_window_months)) AS nights_win,
           min(a.event_start) FILTER (WHERE a.came AND a.event_start <= v_at) AS first_night,
           max(a.event_start) FILTER (WHERE a.came AND a.event_start <= v_at) AS last_night,
           -- Avait une place pour une soirée passée, venu ou non : la provenance.
           count(DISTINCT a.event_id) FILTER (WHERE a.event_start <= v_at) AS held
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
    -- Soirées terminées dont la porte est mesurée (_crm_measured_doors, lue une fois dans _cpd).
    SELECT d.event_id FROM _cpd d
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
       AND false -- les pages d'inscription sont au CRM
       AND pg.venue_id IS NOT DISTINCT FROM p_venue_id
       AND pg.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     GROUP BY 1
  ), fh AS (
    -- Historique d'un fichier importé (20261008210000).
    SELECT * FROM public._tix_file_history(p_venue_id, p_organizer_user_id, v_at)
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
              -- Venu par Yuno : une place (vente ou guest list) pour une soirée de la
              -- portée, passée OU à venir, ou un contact né d'un achat Yuno. Le CRM
              -- attend que la soirée soit passée (source Shotgun) ; ici l'achat
              -- est déjà la preuve (20261109400000).
              WHEN COALESCE(a.held, 0) > 0 OR y.first_buy IS NOT NULL OR COALESCE(g.gl_n, 0) > 0
                   OR b.origin = 'yuno' THEN 'yuno'
              WHEN b.origin IN ('import', 'both') THEN 'import'
              ELSE 'other' END AS source,
         CASE WHEN NOT p_light THEN u.utm_source END AS utm_source,
         CASE WHEN NOT p_light THEN u.utm_medium END AS utm_medium,
         CASE
           -- A acheté pour une soirée à venir sans en avoir encore fait : nouveau
           -- client, pas un « contact connu » (import, inscription). Une entrée
           -- gratuite passée où il n'est pas venu (DATA-02) n'en fait pas un client.
           WHEN h.nights = 0 THEN CASE WHEN COALESCE(y.upcoming, false) THEN 'nou' ELSE 'none' END
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
    LEFT JOIN public.crm_person_profile ap ON false
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
    -- Étiquettes et note de la fiche client (tix_contact_notes, 20261109400000).
    LEFT JOIN public.tix_contact_notes n ON n.scope_key = v_scope AND n.email = b.email;

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
       AND NOT public.crm_campaign_is_crm(ec.id)
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


-- ── Clients : vue d'ensemble (miroir de crm_clients_overview) ───────────
CREATE OR REPLACE FUNCTION public.tix_clients_overview(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rules record;
  v_now timestamptz := now();
  v_tz text := 'Europe/Paris';
  v_today timestamptz := date_trunc('day', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris';
  v_cur jsonb;
  v_prev jsonb;
  v_spark jsonb;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);

  -- Il y a 30 jours (écarts « vs le mois dernier »). Bases légères : cet
  -- écran ne lit que le cycle de vie, la joignabilité, les soirées, la dépense.
  PERFORM public._tix_people_build(p_venue_id, p_organizer_user_id, v_now - interval '30 days', true);
  SELECT jsonb_build_object(
           'total', count(*),
           'returning_pct', CASE WHEN count(*) FILTER (WHERE nights >= 1) > 0
             THEN round(count(*) FILTER (WHERE nights >= 2)::numeric * 100 / count(*) FILTER (WHERE nights >= 1), 1) END,
           'avg_spend', CASE WHEN count(*) FILTER (WHERE spent > 0) > 0
             THEN round(avg(spent) FILTER (WHERE spent > 0), 2) END)
    INTO v_prev FROM _cp;

  PERFORM public._tix_people_build(p_venue_id, p_organizer_user_id, v_now, true);
  SELECT jsonb_agg(c ORDER BY d) INTO v_spark FROM (
    SELECT d, (SELECT count(*) FROM _cp x WHERE x.added_at < ((date_trunc('day', v_now AT TIME ZONE v_tz) - (29 - d) * interval '1 day' + interval '1 day') AT TIME ZONE v_tz)) AS c
      FROM generate_series(0, 29) d) s;

  SELECT jsonb_build_object(
           'total', count(*),
           'today', count(*) FILTER (WHERE added_at >= v_today),
           'month', count(*) FILTER (WHERE added_at >= v_now - interval '30 days'),
           'lifecycle', jsonb_build_object(
              'hab', count(*) FILTER (WHERE lifecycle = 'hab'),
              'occ', count(*) FILTER (WHERE lifecycle = 'occ'),
              'nou', count(*) FILTER (WHERE lifecycle = 'nou'),
              'end', count(*) FILTER (WHERE lifecycle = 'end'),
              'none', count(*) FILTER (WHERE lifecycle = 'none')),
           'end_reachable', count(*) FILTER (WHERE lifecycle = 'end' AND (email_ok OR phone_ok)),
           'reachable', count(*) FILTER (WHERE email_ok OR phone_ok),
           'unreachable', count(*) FILTER (WHERE NOT email_ok AND NOT phone_ok),
           'returning_pct', CASE WHEN count(*) FILTER (WHERE nights >= 1) > 0
             THEN round(count(*) FILTER (WHERE nights >= 2)::numeric * 100 / count(*) FILTER (WHERE nights >= 1), 1) END,
           'once', count(*) FILTER (WHERE nights = 1),
           'avg_spend', CASE WHEN count(*) FILTER (WHERE spent > 0) > 0
             THEN round(avg(spent) FILTER (WHERE spent > 0), 2) END)
    INTO v_cur FROM _cp;

  RETURN v_cur || jsonb_build_object(
    'spark', COALESCE(v_spark, '[]'::jsonb),
    'prev', v_prev,
    'rules', jsonb_build_object('min_nights', v_rules.regular_min_nights, 'window_months', v_rules.regular_window_months,
                                'lapse_months', v_rules.lapse_months),
    'updated_at', v_now);
END;
$function$;

-- ── Clients : la liste filtrée (miroir de crm_clients_list__core) ───────
CREATE OR REPLACE FUNCTION public.tix_clients_list__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_def jsonb DEFAULT '{}'::jsonb, p_sort text DEFAULT 'last'::text, p_dir integer DEFAULT 1, p_limit integer DEFAULT 12, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pred text;
  v_order text;
  v_total integer;
  v_rows jsonb;
  v_counts jsonb;
  v_desc text := CASE WHEN COALESCE(p_dir, 1) >= 0 THEN 'DESC' ELSE 'ASC' END;
  v_asc text := CASE WHEN COALESCE(p_dir, 1) >= 0 THEN 'ASC' ELSE 'DESC' END;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM public._tix_people_build(p_venue_id, p_organizer_user_id, NULL);
  v_pred := public._tix_filter_sql(p_def, 'p');
  v_order := CASE p_sort
    WHEN 'name' THEN format('lower(COALESCE(p.first_name, p.email)) %s, p.email', v_asc)
    WHEN 'n' THEN format('p.nights %s, p.email', v_desc)
    WHEN 'sp' THEN format('p.spent %s, p.email', v_desc)
    ELSE format('p.last_night %s NULLS LAST, p.added_at %s, p.email', v_desc, v_desc) END;

  EXECUTE format('SELECT count(*) FROM _cp p WHERE %s', v_pred) INTO v_total;
  EXECUTE format($q$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'email', p.email, 'first_name', p.first_name, 'last_name', p.last_name,
             'lifecycle', p.lifecycle, 'nights', p.nights, 'last_night', p.last_night, 'added_at', p.added_at,
             'spent', p.spent, 'email_ok', p.email_ok, 'phone_ok', p.phone_ok, 'tonight', p.tonight,
             'tag', (p.tags)[1], 'source', p.source,
             'gl', p.gl_n, 'gl_only', (p.gl_n > 0 AND p.paid_n = 0)) ORDER BY rn), '[]'::jsonb)
      FROM (SELECT p.*, row_number() OVER (ORDER BY %s) AS rn FROM _cp p WHERE %s ORDER BY %s LIMIT %s OFFSET %s) p
  $q$, v_order, v_pred, v_order, GREATEST(1, LEAST(COALESCE(p_limit, 12), 500)), GREATEST(0, COALESCE(p_offset, 0)))
  INTO v_rows;

  SELECT jsonb_build_object(
           'all', count(*), 'hab', count(*) FILTER (WHERE lifecycle = 'hab'), 'occ', count(*) FILTER (WHERE lifecycle = 'occ'),
           'nou', count(*) FILTER (WHERE lifecycle = 'nou'), 'end', count(*) FILTER (WHERE lifecycle = 'end'),
           'none', count(*) FILTER (WHERE lifecycle = 'none'))
    INTO v_counts FROM _cp;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows, 'counts', v_counts);
END;
$function$;

CREATE OR REPLACE FUNCTION public.tix_clients_list(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_def jsonb DEFAULT '{}'::jsonb, p_sort text DEFAULT 'last'::text, p_dir integer DEFAULT 1, p_limit integer DEFAULT 12, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._tix_money_gate(public.tix_clients_list__core(p_venue_id, p_organizer_user_id, p_def, p_sort, p_dir, p_limit, p_offset), p_venue_id, p_organizer_user_id);
$function$;

-- ── Fiche client (miroir de crm_client__core) ───────────────────────────
-- Ce qui change : achats et invitations lus dans les ventes Yuno (billets,
-- tables VIP, guest list) ; la source d'un achat est sa famille d'attribution
-- (`_tix_source`) ; messages = campagnes de Yuno Tickets ; « a acheté après le
-- clic » = une vente Yuno de la soirée dans les 7 jours. En plus pour un club :
-- le bannissement et les incidents de porte (`door`).
CREATE OR REPLACE FUNCTION public.tix_client__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_email text DEFAULT NULL::text)
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
  v_door jsonb;
  v_rules record;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);
  PERFORM public._tix_people_build(p_venue_id, p_organizer_user_id, NULL);
  SELECT * INTO v_p FROM _cp p WHERE p.email = v_em;
  IF v_p.email IS NULL THEN RETURN NULL; END IF;

  -- Achats : une ligne par soirée (montant de la soirée, places de billetterie).
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at' DESC), '[]'::jsonb) INTO v_buys FROM (
    SELECT jsonb_build_object('kind', 'buy', 'at', min(t.bought_at), 'event_id', t.event_id, 'title', e.title,
                              'event_start', min(t.event_start), 'amount', round(sum(t.amount), 2), 'tickets', sum(t.qty),
                              'scanned', bool_or(t.scanned_at IS NOT NULL), 'first', min(t.event_start) = v_p.first_night,
                              'upcoming', min(t.event_start) > now(),
                              -- Par où est arrivé l'achat : la famille d'attribution de la
                              -- première vente de la personne pour cette soirée.
                              'source', jsonb_build_object('src', NULL, 'kind',
                                (array_agg(t.src ORDER BY t.bought_at, t.id))[1])) AS x
      FROM _cpt t LEFT JOIN public.events e ON e.id = t.event_id
     WHERE t.email = v_em
     GROUP BY t.event_id, e.title
  ) q;

  -- Guest list : une ligne par soirée où la personne était invitée ou
  -- inscrite gratuitement. `came` n'est faux qu'une fois la porte vraiment
  -- scannée (`scan_known`, porte mesurée : _cpd) : sinon on ne sait pas.
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'event_start' DESC), '[]'::jsonb) INTO v_guests FROM (
    SELECT jsonb_build_object('kind', 'guest', 'event_id', g.event_id, 'title', e.title,
             'event_start', min(g.event_start), 'at', min(g.at),
             'gl', CASE WHEN bool_and(g.kind = 'inv') THEN 'inv' WHEN bool_and(g.kind = 'free') THEN 'free' ELSE 'mix' END,
             'list', string_agg(DISTINCT g.deal, ', '),
             'came', bool_or(g.scanned_at IS NOT NULL), 'scanned_at', min(g.scanned_at),
             'scan_known', EXISTS (SELECT 1 FROM _cpd d WHERE d.event_id = g.event_id),
             'upcoming', min(g.event_end) > now()) AS x
      FROM _cpg g LEFT JOIN public.events e ON e.id = g.event_id
     WHERE g.email = v_em AND g.event_id IS NOT NULL
     GROUP BY g.event_id, e.title
  ) q;

  -- Messages : e-mails reçus de Yuno Tickets (et clics).
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at' DESC), '[]'::jsonb) INTO v_msgs FROM (
    SELECT jsonb_build_object('kind', 'email', 'at', r.sent_at, 'name', c.name, 'campaign_id', c.id,
             'opened', EXISTS (SELECT 1 FROM public.email_campaign_events ev WHERE ev.campaign_id = c.id AND lower(ev.recipient_email) = v_em AND ev.event_type = 'opened'),
             'clicked', k.at IS NOT NULL,
             -- La soirée dont parlait l'e-mail, le premier clic, et si la personne a
             -- acheté cette soirée sur Yuno dans les 7 jours qui suivent.
             'event_id', c.event_id, 'event_title', ce.title, 'clicked_at', k.at,
             'bought_after', CASE WHEN c.event_id IS NULL OR k.at IS NULL THEN NULL ELSE EXISTS (
               SELECT 1 FROM _cpt t
                WHERE t.event_id = c.event_id AND t.email = v_em
                  AND t.bought_at BETWEEN k.at AND k.at + interval '7 days') END) AS x
      FROM public.email_campaign_recipients r
      JOIN public.email_campaigns c ON c.id = r.campaign_id
      LEFT JOIN public.events ce ON ce.id = c.event_id
      LEFT JOIN LATERAL (SELECT min(ev.created_at) AS at FROM public.email_campaign_events ev
                          WHERE ev.campaign_id = c.id AND lower(ev.recipient_email) = v_em AND ev.event_type = 'clicked') k ON true
     WHERE lower(r.email) = v_em AND r.status = 'sent' AND r.sent_at IS NOT NULL
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND NOT public.crm_campaign_is_crm(c.id)
     ORDER BY r.sent_at DESC LIMIT 40
  ) q;

  SELECT jsonb_agg(jsonb_build_object('m', to_char(m, 'YYYY-MM'),
           -- Soirées faites, même règle que la base (_cpa).
           'n', (SELECT count(DISTINCT z.event_id) FROM _cpa z
                  WHERE z.email = v_em AND z.came
                    AND date_trunc('month', z.event_start AT TIME ZONE 'Europe/Paris') = m)) ORDER BY m)
    INTO v_months
    FROM generate_series(date_trunc('month', now() AT TIME ZONE 'Europe/Paris') - interval '11 months',
                         date_trunc('month', now() AT TIME ZONE 'Europe/Paris'), interval '1 month') m;

  -- La porte du club : bannissement (adresse) et incidents enregistrés.
  IF p_venue_id IS NOT NULL THEN
    SELECT jsonb_build_object(
             'banned', b.email IS NOT NULL, 'reason', b.ban_reason, 'at', COALESCE(b.banned_at, b.created_at),
             'incidents', COALESCE((
               SELECT jsonb_agg(jsonb_build_object('type', i.incident_type, 'reason', i.reason, 'at', i.created_at) ORDER BY i.created_at DESC)
                 FROM (SELECT ci.* FROM public.customer_incidents ci
                         JOIN public.venue_customers vc ON vc.id = ci.venue_customer_id
                        WHERE ci.venue_id = p_venue_id AND vc.venue_id = p_venue_id AND lower(vc.email) = v_em
                        ORDER BY ci.created_at DESC LIMIT 20) i), '[]'::jsonb))
      INTO v_door
      FROM (SELECT 1) one
      LEFT JOIN LATERAL (SELECT be.* FROM public.venue_banned_emails be
                          WHERE be.venue_id = p_venue_id AND lower(be.email) = v_em
                          ORDER BY be.created_at DESC LIMIT 1) b ON true;
  END IF;

  RETURN jsonb_build_object(
    'email', v_p.email, 'first_name', v_p.first_name, 'last_name', v_p.last_name, 'phone', v_p.phone,
    'email_ok', v_p.email_ok, 'phone_ok', v_p.phone_ok, 'bounced', v_p.bounced, 'eng_status', v_p.eng_status,
    'lifecycle', v_p.lifecycle, 'nights', v_p.nights, 'nights_win', v_p.nights_win, 'spent', v_p.spent,
    'first_night', v_p.first_night, 'last_night', v_p.last_night, 'added_at', v_p.added_at,
    'tonight', v_p.tonight, 'source', v_p.source, 'utm_source', v_p.utm_source, 'origin', v_p.origin,
    'first_source', CASE WHEN v_p.utm_source IS NULL THEN NULL
                         ELSE jsonb_build_object('src', NULL, 'kind', v_p.utm_source) END,
    'tags', COALESCE(to_jsonb(v_p.tags), '[]'::jsonb), 'note', v_p.note,
    'buys', v_buys, 'messages', v_msgs, 'months', v_months,
    'guests', v_guests,
    'door', v_door,
    -- Historique d'un fichier importé : ce qu'il dit et comment il compte.
    'history', CASE WHEN v_p.hist_mode IS NULL THEN NULL ELSE jsonb_build_object(
        'nights', v_p.hist_nights, 'spent', v_p.hist_spent, 'last', v_p.hist_last, 'mode', v_p.hist_mode,
        'list', (SELECT COALESCE(NULLIF(btrim(ti.title), ''), NULLIF(btrim(li.list_name), ''), li.filename)
                   FROM public.contact_list_imports li
                   LEFT JOIN public.tix_imports ti ON ti.list_import_id = li.id
                  WHERE li.id = v_p.hist_list)) END,
    'gl', jsonb_build_object('n', v_p.gl_n, 'came', v_p.gl_came, 'first', v_p.gl_first, 'conv', v_p.gl_conv,
                             'paid_n', v_p.paid_n, 'noshow', v_p.gl_noshow),
    'rules', jsonb_build_object('min_nights', v_rules.regular_min_nights, 'window_months', v_rules.regular_window_months,
                                'lapse_months', v_rules.lapse_months));
END;
$function$;

CREATE OR REPLACE FUNCTION public.tix_client(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_email text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._tix_money_gate(public.tix_client__core(p_venue_id, p_organizer_user_id, p_email), p_venue_id, p_organizer_user_id);
$function$;

-- Étiquettes et note (miroir de crm_client_save).
CREATE OR REPLACE FUNCTION public.tix_client_save(p_venue_id text, p_organizer_user_id uuid, p_email text, p_tags text[] DEFAULT NULL::text[], p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_em text := lower(btrim(COALESCE(p_email, '')));
  v_tags text[];
BEGIN
  IF NOT public._tix_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_em = '' THEN RAISE EXCEPTION 'email_required' USING ERRCODE = '22023'; END IF;
  SELECT array_agg(DISTINCT left(btrim(x), 24)) FILTER (WHERE btrim(x) <> '') INTO v_tags FROM unnest(COALESCE(p_tags, '{}')) x;

  INSERT INTO public.tix_contact_notes AS n (scope_key, email, venue_id, organizer_user_id, tags, note, updated_by)
  VALUES (v_key, v_em, p_venue_id, p_organizer_user_id, COALESCE(v_tags, '{}'), left(p_note, 4000), auth.uid())
  ON CONFLICT (scope_key, email) DO UPDATE SET
    tags = CASE WHEN p_tags IS NULL THEN n.tags ELSE COALESCE(v_tags, '{}') END,
    note = CASE WHEN p_note IS NULL THEN n.note ELSE left(p_note, 4000) END,
    updated_by = auth.uid(),
    updated_at = now();
  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- Export d'une liste (miroir de crm_clients_export__core) : jamais en accès
-- assisté ; un membre d'équipe d'organisation exporte s'il en a le droit.
CREATE OR REPLACE FUNCTION public.tix_clients_export__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_def jsonb DEFAULT '{}'::jsonb, p_emails text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pred text;
  v_rows jsonb;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'export_forbidden_support' USING ERRCODE = '42501';
  END IF;
  IF p_organizer_user_id IS NOT NULL AND p_organizer_user_id <> auth.uid() AND NOT public.is_super_admin()
     AND NOT public.org_member_has_permission(auth.uid(), p_organizer_user_id, 'export') THEN
    RAISE EXCEPTION 'export_forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM public._tix_people_build(p_venue_id, p_organizer_user_id, NULL);
  v_pred := CASE WHEN p_emails IS NOT NULL
                 THEN format('p.email = ANY (%L::text[])', (SELECT array_agg(lower(x)) FROM unnest(p_emails) x))
                 ELSE public._tix_filter_sql(COALESCE(p_def, '{}'::jsonb), 'p') END;

  EXECUTE format($q$
    SELECT COALESCE(jsonb_agg(jsonb_build_array(
             p.email, p.first_name, p.last_name, CASE WHEN p.phone_ok THEN p.phone END, p.lifecycle, p.nights,
             to_char(p.first_night AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD'),
             to_char(p.last_night AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD'),
             p.spent, p.email_ok, p.phone_ok, p.source, array_to_string(COALESCE(p.tags, '{}'), ' ; '))
             ORDER BY p.last_night DESC NULLS LAST, p.email), '[]'::jsonb)
      FROM _cp p WHERE %s
  $q$, v_pred) INTO v_rows;

  RETURN jsonb_build_object(
    'columns', '["email","first_name","last_name","phone","lifecycle","nights","first_night","last_night","spent","email_ok","phone_ok","source","tags"]'::jsonb,
    'rows', v_rows);
END;
$function$;

CREATE OR REPLACE FUNCTION public.tix_clients_export(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_def jsonb DEFAULT '{}'::jsonb, p_emails text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._tix_money_gate(public.tix_clients_export__core(p_venue_id, p_organizer_user_id, p_def, p_emails), p_venue_id, p_organizer_user_id);
$function$;

-- Les soirées du filtre « Soirée » (miroir de crm_events_brief) : les soirées
-- Yuno de la portée, les plus proches d'aujourd'hui d'abord.
CREATE OR REPLACE FUNCTION public.tix_events_brief(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN NULL ELSE
    COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'start_at') DESC) FROM (
      SELECT jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at,
                                'upcoming', e.end_at > now()) AS x
        FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) e
       ORDER BY abs(extract(epoch FROM e.start_at - now()))
       LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 12), 60))
    ) q), '[]'::jsonb) END;
$function$;

-- Effectif d'une audience (« Écrire à… ») : miroir de crm_audience_count.
CREATE OR REPLACE FUNCTION public.tix_audience_count(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_def jsonb DEFAULT NULL::jsonb, p_emails text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res jsonb;
  v_pred text;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM public._tix_people_build(p_venue_id, p_organizer_user_id, NULL);
  IF p_emails IS NOT NULL THEN
    SELECT jsonb_build_object('total', count(*), 'email', count(*) FILTER (WHERE email_ok), 'sms', count(*) FILTER (WHERE phone_ok))
      INTO v_res FROM _cp p WHERE p.email = ANY (SELECT lower(x) FROM unnest(p_emails) x);
  ELSE
    v_pred := public._tix_filter_sql(COALESCE(p_def, '{}'::jsonb), 'p');
    EXECUTE format('SELECT jsonb_build_object(''total'', count(*), ''email'', count(*) FILTER (WHERE p.email_ok), ''sms'', count(*) FILTER (WHERE p.phone_ok)) FROM _cp p WHERE %s', v_pred)
      INTO v_res;
  END IF;
  RETURN v_res;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tix_audience_counts(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_defs jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_def jsonb;
  v_n integer;
  v_r integer;
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_defs) <> 'array' OR jsonb_array_length(p_defs) = 0 THEN RETURN '[]'::jsonb; END IF;

  PERFORM public._tix_people_build(p_venue_id, p_organizer_user_id, NULL);
  FOR v_def IN SELECT x FROM jsonb_array_elements(p_defs) WITH ORDINALITY AS e(x, i) ORDER BY i LIMIT 20 LOOP
    EXECUTE format('SELECT count(*), count(*) FILTER (WHERE p.email_ok OR p.phone_ok) FROM _cp p WHERE %s',
                   public._tix_filter_sql(v_def, 'p'))
      INTO v_n, v_r;
    v_out := v_out || jsonb_build_array(jsonb_build_object('total', v_n, 'reachable', v_r));
  END LOOP;
  RETURN v_out;
END;
$function$;

-- ── Segments ────────────────────────────────────────────────────────────

-- Les segments de la portée : les cinq automatiques (cycle de vie), puis ceux
-- du pro (miroir de _crm_segment_defs).
CREATE OR REPLACE FUNCTION public._tix_segment_defs(p_venue_id text, p_organizer_user_id uuid)
 RETURNS TABLE(seg_key text, kind text, name text, description text, template text, def jsonb, created_at timestamp with time zone, sort integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT x.k, 'auto', NULL::text, NULL::text, NULL::text, jsonb_build_object('seg', x.k), NULL::timestamptz, x.o
    FROM (VALUES ('hab', 1), ('occ', 2), ('nou', 3), ('end', 4), ('none', 5)) AS x(k, o)
  UNION ALL
  SELECT s.id::text, 'custom', s.name, s.description, s.template, s.definition, s.created_at,
         100 + row_number() OVER (ORDER BY s.created_at)::integer
    FROM public.tix_segments s
   WHERE s.scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id);
$function$;

-- Effectifs de chaque segment à une date (lit _cp ; miroir de _crm_segment_counts_write).
CREATE OR REPLACE FUNCTION public._tix_segment_counts_write(p_venue_id text, p_organizer_user_id uuid, p_day date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_seg record;
  v_n integer;
  v_r integer;
BEGIN
  FOR v_seg IN SELECT * FROM public._tix_segment_defs(p_venue_id, p_organizer_user_id) LOOP
    EXECUTE format('SELECT count(*), count(*) FILTER (WHERE p.email_ok OR p.phone_ok) FROM _cp p WHERE %s',
                   public._tix_filter_sql(v_seg.def, 'p'))
      INTO v_n, v_r;
    INSERT INTO public.tix_segment_counts (scope_key, seg_key, day, n, reachable, computed_at)
    VALUES (v_scope, v_seg.seg_key, p_day, v_n, v_r, now())
    ON CONFLICT (scope_key, seg_key, day) DO UPDATE SET n = EXCLUDED.n, reachable = EXCLUDED.reachable, computed_at = now();
  END LOOP;
END;
$function$;

-- Les messages de la période (miroir de _crm_msg_build) : e-mails et SMS de
-- Yuno Tickets, clics, et ventes Yuno attribuées (dernier clic dans les 7
-- jours avant l'achat, _tix_email_attrib). Lit _cp (SMS rattachés par numéro).
CREATE OR REPLACE FUNCTION public._tix_msg_build(p_venue_id text, p_organizer_user_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_n integer;
BEGIN
  -- _cmc (campagnes), _cmk (clics), _cma (ventes attribuées).
  PERFORM public._tix_email_attrib(p_venue_id, p_organizer_user_id);

  DROP TABLE IF EXISTS _cm0;
  CREATE TEMP TABLE _cm0 ON COMMIT DROP AS
    SELECT r.campaign_id, 'email'::text AS channel, lower(r.email) AS email, c.sent_at,
           EXISTS (SELECT 1 FROM _cmk k WHERE k.campaign_id = r.campaign_id AND k.email = lower(r.email)) AS clicked,
           EXISTS (SELECT 1 FROM _cmk k WHERE k.campaign_id = r.campaign_id AND k.email = lower(r.email) AND k.ticketing) AS ticketing,
           COALESCE((SELECT sum(a.amount) FROM _cma a WHERE a.campaign_id = r.campaign_id AND a.email = lower(r.email)), 0) AS revenue
      FROM public.email_campaign_recipients r
      JOIN _cmc c ON c.id = r.campaign_id
     WHERE r.status IN ('sent', 'complained')
       AND c.sent_at >= p_from AND c.sent_at < p_to;

  -- SMS reçus, rattachés à la personne par son numéro.
  INSERT INTO _cm0 (campaign_id, channel, email, sent_at, clicked, ticketing, revenue)
  SELECT r.campaign_id, 'sms', p.email, COALESCE(s.sent_at, r.sent_at), false, false, 0
    FROM public.sms_campaign_recipients r
    JOIN public.sms_campaigns s ON s.id = r.campaign_id
    JOIN _cp p ON p.phone IS NOT NULL
             AND regexp_replace(p.phone, '\D', '', 'g') = regexp_replace(r.phone_e164, '\D', '', 'g')
   WHERE r.status::text IN ('sent', 'delivered')
     AND s.venue_id IS NOT DISTINCT FROM p_venue_id
     AND s.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
     AND s.product IS NULL
     AND COALESCE(s.sent_at, r.sent_at) >= p_from AND COALESCE(s.sent_at, r.sent_at) < p_to;

  DROP TABLE IF EXISTS _cm;
  CREATE TEMP TABLE _cm ON COMMIT DROP AS SELECT m.*, m.revenue > 0 AS bought FROM _cm0 m;
  CREATE INDEX ON _cm (email);
  SELECT count(*) INTO v_n FROM _cm;
  RETURN v_n;
END;
$function$;

-- La cible d'un envoi (miroir de _crm_send_target, audiences {kind:'tix'}).
CREATE OR REPLACE FUNCTION public._tix_send_target(p_aud jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_aud IS NULL OR jsonb_typeof(p_aud) <> 'array' OR jsonb_array_length(p_aud) = 0 THEN 'all'
    WHEN jsonb_array_length(p_aud) > 1 THEN 'custom'
    WHEN p_aud->0->>'kind' = 'tix' AND p_aud->0->>'segmentId' ~ '^[0-9a-f-]{36}$' THEN p_aud->0->>'segmentId'
    WHEN p_aud->0->>'kind' = 'tix'
         AND COALESCE(p_aud->0->'def'->>'seg', 'all') IN ('hab', 'occ', 'nou', 'end', 'none')
         AND COALESCE(p_aud->0->'def'->'f', '{}'::jsonb) = '{}'::jsonb
         AND COALESCE(p_aud->0->'def'->>'q', '') = '' THEN p_aud->0->'def'->>'seg'
    WHEN p_aud->0->>'kind' IN ('all', 'everyone', 'all_subscribers') THEN 'all'
    WHEN p_aud->0->>'kind' = 'tix'
         AND COALESCE(p_aud->0->'def'->>'seg', 'all') = 'all'
         AND COALESCE(p_aud->0->'def'->'f', '{}'::jsonb) = '{}'::jsonb
         AND COALESCE(p_aud->0->'def'->>'q', '') = '' THEN 'all'
    ELSE 'custom' END;
$function$;

-- Écran Segments (miroir de crm_segments_overview__core).
CREATE OR REPLACE FUNCTION public.tix_segments_overview__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
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
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_from := v_now - make_interval(days => v_days);
  v_pfrom := v_from - make_interval(days => v_days);

  -- Dates repères manquantes : comptées ici, calculées ensuite par
  -- tix_segments_fill_anchors (une par appel, appelée par l'écran).
  SELECT count(*) INTO v_pending
    FROM unnest(ARRAY[v_today - v_days, v_today - (v_days * 2 / 3), v_today - (v_days / 3)]) a(day)
   WHERE EXISTS (
     SELECT 1 FROM public._tix_segment_defs(p_venue_id, p_organizer_user_id) d
      WHERE NOT EXISTS (SELECT 1 FROM public.tix_segment_counts c
                         WHERE c.scope_key = v_scope AND c.seg_key = d.seg_key AND c.day = a.day));

  -- La base d'aujourd'hui, puis les messages de la période (et de la précédente).
  PERFORM public._tix_people_build(p_venue_id, p_organizer_user_id, NULL);
  PERFORM public._tix_segment_counts_write(p_venue_id, p_organizer_user_id, v_today);
  PERFORM public._tix_msg_build(p_venue_id, p_organizer_user_id, v_pfrom, v_now);

  -- Une ligne par segment.
  FOR v_seg IN SELECT * FROM public._tix_segment_defs(p_venue_id, p_organizer_user_id) ORDER BY sort LOOP
    v_pred := public._tix_filter_sql(v_seg.def, 'p');
    EXECUTE format($q$
      SELECT jsonb_build_object(
        'n', count(*),
        'reachable', count(*) FILTER (WHERE p.email_ok OR p.phone_ok),
        'email', count(*) FILTER (WHERE p.email_ok),
        'sms', count(*) FILTER (WHERE p.phone_ok),
        'avg_spend', CASE WHEN count(*) > 0 THEN round(sum(p.spent) / count(*), 2) END,
        'avg_nights', CASE WHEN count(*) > 0 THEN round(avg(p.nights)::numeric, 1) END,
        'sources', jsonb_build_object(
          'yuno', count(*) FILTER (WHERE p.source = 'yuno'),
          'import', count(*) FILTER (WHERE p.source = 'import'),
          'other', count(*) FILTER (WHERE p.source NOT IN ('yuno', 'import'))))
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
           'n_start', (SELECT c.n FROM public.tix_segment_counts c
                        WHERE c.scope_key = v_scope AND c.seg_key = v_seg.seg_key AND c.day = v_today - v_days),
           'spark', (SELECT COALESCE(jsonb_agg(jsonb_build_object('d', c.day, 'n', c.n) ORDER BY c.day), '[]'::jsonb)
                       FROM public.tix_segment_counts c
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
           'target', CASE WHEN s.channel = 'email' THEN public._tix_send_target(c.audiences_json) ELSE 'custom' END,
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

CREATE OR REPLACE FUNCTION public.tix_segments_overview(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._tix_money_gate(public.tix_segments_overview__core(p_venue_id, p_organizer_user_id, p_period), p_venue_id, p_organizer_user_id);
$function$;

-- Une date repère manquante de l'écran Segments (miroir de crm_segments_fill_anchors).
CREATE OR REPLACE FUNCTION public.tix_segments_fill_anchors(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text)
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
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_anchors date[];
  v_day date;
  v_left integer;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_anchors := ARRAY[v_today - v_days, v_today - (v_days * 2 / 3), v_today - (v_days / 3)];
  PERFORM pg_advisory_xact_lock(hashtext('tix_segment_anchors:' || v_scope));

  SELECT a.day INTO v_day
    FROM unnest(v_anchors) a(day)
   WHERE EXISTS (
     SELECT 1 FROM public._tix_segment_defs(p_venue_id, p_organizer_user_id) d
      WHERE NOT EXISTS (SELECT 1 FROM public.tix_segment_counts c
                         WHERE c.scope_key = v_scope AND c.seg_key = d.seg_key AND c.day = a.day))
   ORDER BY a.day LIMIT 1;
  IF v_day IS NOT NULL THEN
    PERFORM public._tix_people_build(p_venue_id, p_organizer_user_id,
                                     ((v_day + 1)::timestamp AT TIME ZONE v_tz) - interval '1 second');
    PERFORM public._tix_segment_counts_write(p_venue_id, p_organizer_user_id, v_day);
  END IF;

  SELECT count(*) INTO v_left
    FROM unnest(v_anchors) a(day)
   WHERE EXISTS (
     SELECT 1 FROM public._tix_segment_defs(p_venue_id, p_organizer_user_id) d
      WHERE NOT EXISTS (SELECT 1 FROM public.tix_segment_counts c
                         WHERE c.scope_key = v_scope AND c.seg_key = d.seg_key AND c.day = a.day));
  RETURN jsonb_build_object('filled', v_day, 'remaining', v_left);
END;
$function$;

-- Fiche d'un segment (miroir de crm_segment_detail__core) : entrées, sorties,
-- envois qui l'ont touché.
CREATE OR REPLACE FUNCTION public.tix_segment_detail__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_seg_key text DEFAULT NULL::text, p_period text DEFAULT '30d'::text)
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
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT d.def INTO v_def FROM public._tix_segment_defs(p_venue_id, p_organizer_user_id) d WHERE d.seg_key = p_seg_key;
  IF v_def IS NULL THEN RETURN NULL; END IF;
  v_from := v_now - make_interval(days => v_days);
  v_p := public._tix_filter_sql(v_def, 'p');
  v_q := public._tix_filter_sql(v_def, 'q');

  -- La base au début de la période, gardée à part, puis celle d'aujourd'hui.
  PERFORM public._tix_people_build(p_venue_id, p_organizer_user_id, v_from);
  DROP TABLE IF EXISTS _cp0;
  CREATE TEMP TABLE _cp0 ON COMMIT DROP AS SELECT * FROM _cp;
  PERFORM public._tix_people_build(p_venue_id, p_organizer_user_id, NULL);

  EXECUTE format('SELECT count(*) FROM _cp p WHERE %s AND NOT EXISTS (SELECT 1 FROM _cp0 q WHERE q.email = p.email AND %s)', v_p, v_q)
    INTO v_entered;
  EXECUTE format('SELECT count(*) FROM _cp0 q WHERE %s AND NOT EXISTS (SELECT 1 FROM _cp p WHERE p.email = q.email AND %s)', v_q, v_p)
    INTO v_exited;

  PERFORM public._tix_msg_build(p_venue_id, p_organizer_user_id, v_from, v_now);
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

CREATE OR REPLACE FUNCTION public.tix_segment_detail(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_seg_key text DEFAULT NULL::text, p_period text DEFAULT '30d'::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._tix_money_gate(public.tix_segment_detail__core(p_venue_id, p_organizer_user_id, p_seg_key, p_period), p_venue_id, p_organizer_user_id);
$function$;

-- Les segments du pro et leur effectif (miroir de crm_segments_brief).
CREATE OR REPLACE FUNCTION public.tix_segments_brief(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_out jsonb := '[]'::jsonb;
  v_n integer;
  v_j integer;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tix_segments s WHERE s.scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id)) THEN
    RETURN v_out;
  END IF;
  PERFORM public._tix_people_build(p_venue_id, p_organizer_user_id, NULL);
  FOR r IN SELECT s.id, s.name, s.description, s.template, s.definition, s.created_at
             FROM public.tix_segments s
            WHERE s.scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id)
            ORDER BY s.created_at LOOP
    EXECUTE format('SELECT count(*), count(*) FILTER (WHERE p.email_ok OR p.phone_ok) FROM _cp p WHERE %s', public._tix_filter_sql(r.definition, 'p'))
      INTO v_n, v_j;
    v_out := v_out || jsonb_build_object('id', r.id, 'name', r.name, 'description', r.description, 'template', r.template,
                                         'definition', r.definition, 'n', v_n, 'reachable', v_j, 'created_at', r.created_at);
  END LOOP;
  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tix_segment_save(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_name text, p_definition jsonb, p_template text DEFAULT NULL::text, p_description text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_id uuid;
BEGIN
  IF NOT public._tix_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF btrim(COALESCE(p_name, '')) = '' THEN RAISE EXCEPTION 'name_required' USING ERRCODE = '22023'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.tix_segments (scope_key, venue_id, organizer_user_id, name, description, template, definition, created_by)
    VALUES (v_key, p_venue_id, p_organizer_user_id, left(btrim(p_name), 80), p_description, p_template, COALESCE(p_definition, '{}'::jsonb), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.tix_segments
       SET name = left(btrim(p_name), 80),
           description = COALESCE(p_description, description),
           definition = COALESCE(p_definition, definition),
           updated_at = now()
     WHERE id = p_id AND scope_key = v_key
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
    -- La définition a pu changer : ses effectifs d'avant ne disent plus rien.
    DELETE FROM public.tix_segment_counts WHERE scope_key = v_key AND seg_key = v_id::text;
  END IF;
  RETURN jsonb_build_object('id', v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.tix_segment_delete(p_venue_id text, p_organizer_user_id uuid, p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_ok boolean;
BEGIN
  IF NOT public._tix_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Une campagne qui le visait ne le trouve plus : elle ne vise plus personne.
  DELETE FROM public.tix_segments WHERE id = p_id AND scope_key = v_key;
  v_ok := FOUND;
  DELETE FROM public.tix_segment_counts WHERE scope_key = v_key AND seg_key = p_id::text;
  RETURN v_ok;
END;
$function$;

-- Le catalogue « Choisissez vos segments » (miroir de crm_segment_catalog).
CREATE OR REPLACE FUNCTION public.tix_segment_catalog(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
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
  IF NOT COALESCE(public._tix_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM public._tix_people_build(p_venue_id, p_organizer_user_id, NULL);

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
  -- Une soirée Yuno de la portée qui n'a pas encore commencé.
  SELECT EXISTS (SELECT 1 FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) e WHERE e.start_at > now())
    INTO v_next;

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
                             public._tix_filter_sql(e.x->'def', 'p')), ', ' ORDER BY e.ord)
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
    'existing', COALESCE((SELECT jsonb_agg(DISTINCT s.template) FROM public.tix_segments s
                           WHERE s.scope_key = v_scope AND s.template IS NOT NULL), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.tix_segments_create_many(p_venue_id text, p_organizer_user_id uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_tpl text;
  v_name text;
  v_id uuid;
  v_created jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  r record;
BEGIN
  IF NOT COALESCE(public._tix_writable(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 60 THEN
    RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('tix_segments:' || v_key, 0));

  FOR r IN SELECT e.x FROM jsonb_array_elements(p_items) WITH ORDINALITY AS e(x, ord) ORDER BY e.ord LOOP
    v_tpl := btrim(COALESCE(r.x->>'template', ''));
    v_name := left(btrim(COALESCE(r.x->>'name', '')), 80);
    IF v_tpl !~ '^[a-z0-9_]{1,40}(:.{1,100})?$' OR v_name = '' OR jsonb_typeof(r.x->'definition') IS DISTINCT FROM 'object' THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('template', v_tpl, 'why', 'invalid'));
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.tix_segments s WHERE s.scope_key = v_key AND s.template = v_tpl) THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('template', v_tpl, 'why', 'exists'));
      CONTINUE;
    END IF;
    INSERT INTO public.tix_segments (scope_key, venue_id, organizer_user_id, name, description, template, definition, created_by)
    VALUES (v_key, p_venue_id, p_organizer_user_id, v_name,
            NULLIF(left(btrim(COALESCE(r.x->>'description', '')), 400), ''), v_tpl, r.x->'definition', auth.uid())
    RETURNING id INTO v_id;
    v_created := v_created || jsonb_build_array(jsonb_build_object('template', v_tpl, 'id', v_id));
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'skipped', v_skipped);
END;
$function$;

-- ── Imports ─────────────────────────────────────────────────────────────

-- Compare des e-mails et téléphones à la base (miroir de crm_import_check).
CREATE OR REPLACE FUNCTION public.tix_import_check(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_emails text[] DEFAULT NULL::text[], p_phones text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_emails jsonb;
  v_phones jsonb;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(array_length(p_emails, 1), 0) + COALESCE(array_length(p_phones, 1), 0) > 100000 THEN
    RAISE EXCEPTION 'too_many' USING ERRCODE = '22023';
  END IF;
  PERFORM public._tix_people_build(p_venue_id, p_organizer_user_id, NULL, true);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'e', p.email, 'first_name', p.first_name, 'last_name', p.last_name,
           'nights', p.nights, 'since', COALESCE(p.first_night, p.added_at))), '[]'::jsonb)
    INTO v_emails
    FROM _cp p
   WHERE p.email IN (SELECT DISTINCT lower(btrim(x)) FROM unnest(COALESCE(p_emails, '{}')) x);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'p', p.phone, 'first_name', p.first_name, 'last_name', p.last_name, 'email', p.email,
           'nights', p.nights, 'since', COALESCE(p.first_night, p.added_at))), '[]'::jsonb)
    INTO v_phones
    FROM _cp p
   WHERE p.phone IS NOT NULL
     AND p.phone IN (SELECT DISTINCT btrim(x) FROM unnest(COALESCE(p_phones, '{}')) x);

  RETURN jsonb_build_object('emails', v_emails, 'phones', v_phones);
END;
$function$;

-- Un lot d'import (miroir de crm_import_commit). La seule porte d'écriture
-- reste import_contact_list (produit NULL = Yuno Tickets) : attestation,
-- repoussoir des désabonnés, doublons et absorption y restent. Ce qui change
-- par rapport au CRM : l'accord porte l'attestation de Yuno Tickets (d'où
-- vient l'accord, depuis quand), décision de Paul du 22/10.
CREATE OR REPLACE FUNCTION public.tix_import_commit(p_venue_id text, p_organizer_user_id uuid, p_list_import_id uuid, p_rows jsonb, p_consent text, p_mode text, p_title text, p_final boolean DEFAULT false, p_stats jsonb DEFAULT NULL::jsonb, p_kind text DEFAULT 'file'::text, p_consent_source text DEFAULT NULL::text, p_consent_details text DEFAULT NULL::text, p_collected_since date DEFAULT NULL::date, p_default_country text DEFAULT 'FR'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_consent text := CASE WHEN p_consent = 'yes' THEN 'yes' ELSE 'no' END;
  v_mode text := CASE WHEN p_mode = 'keep' THEN 'keep' ELSE 'complete' END;
  v_kind text := CASE WHEN p_kind = 'manual' THEN 'manual' ELSE 'file' END;
  v_country text := CASE WHEN upper(btrim(COALESCE(p_default_country, ''))) ~ '^[A-Z]{2}$' THEN upper(btrim(p_default_country)) ELSE 'FR' END;
  v_source text;
  v_since date;
  v_channels jsonb;
  v_details text;
  v_list uuid := p_list_import_id;
  v_res jsonb;
  v_ti public.tix_imports%ROWTYPE;
BEGIN
  IF NOT public._tix_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_rows, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_rows, '[]'::jsonb)) > 2000 THEN
    RAISE EXCEPTION 'invalid_rows' USING ERRCODE = '22023';
  END IF;

  -- 1er lot : la liste naît vide (import_contact_list la crée), puis on la note.
  IF v_list IS NULL THEN
    IF v_consent = 'yes' THEN
      -- Avec accord : l'origine attestée est obligatoire (même liste que l'import de la Console).
      IF p_consent_source IS NULL OR p_consent_source NOT IN ('in_person', 'website_form', 'ticketing', 'social', 'other_tool', 'other') THEN
        RAISE EXCEPTION 'consent_source_required' USING ERRCODE = '22023';
      END IF;
      v_source := p_consent_source;
      v_channels := '{"email": true, "sms": true}'::jsonb;
      v_details := COALESCE(NULLIF(left(btrim(COALESCE(p_consent_details, '')), 500), ''),
                            'Console Yuno Tickets : le pro atteste l''accord de ces personnes pour recevoir ses e-mails et SMS.');
    ELSE
      v_source := 'other';
      v_channels := '{"email": false, "sms": false}'::jsonb;
      v_details := 'Console Yuno Tickets : contacts enregistrés sans accord, aucun envoi.';
    END IF;
    v_res := public.import_contact_list(
      '[]'::jsonb, v_source, p_venue_id, p_organizer_user_id, left(COALESCE(p_title, 'Import'), 200), v_details,
      CASE WHEN v_consent = 'yes' THEN p_collected_since END, NULL, left(COALESCE(p_title, 'Import'), 60), v_country,
      v_channels, NULL, 'append', false, NULL);
    v_list := (v_res->>'list_import_id')::uuid;
    INSERT INTO public.tix_imports (list_import_id, scope_key, venue_id, organizer_user_id, kind, title, consent, mode, created_by)
    VALUES (v_list, v_scope, p_venue_id, p_organizer_user_id, v_kind, left(COALESCE(p_title, 'Import'), 200), v_consent, v_mode, auth.uid());
  END IF;

  SELECT * INTO v_ti FROM public.tix_imports WHERE list_import_id = v_list AND scope_key = v_scope;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_ti.status <> 'running' THEN RAISE EXCEPTION 'import_closed' USING ERRCODE = '22023'; END IF;
  -- L'attestation de la liste vaut pour chaque lot (les listes e-mail et SMS
  -- naissent au premier lot qui porte des lignes, avec ces valeurs).
  SELECT l.consent_source, l.consent_details, l.default_country, l.collected_since INTO v_source, v_details, v_country, v_since
    FROM public.contact_list_imports l WHERE l.id = v_list;

  -- Journal : l'état d'abonnement e-mail d'avant, pour chaque adresse du lot
  -- déjà connue de la portée (une adresse nouvelle n'a pas d'avant).
  IF v_ti.consent = 'yes' THEN
    INSERT INTO public.tix_import_journal (list_import_id, email, prev_opted_in, prev_import_id, prev_first_name, prev_last_name)
    SELECT v_list, lower(ns.email), ns.opted_in, ns.import_id, ns.first_name, ns.last_name
      FROM public.newsletter_subscriptions ns
     WHERE public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND ns.product IS NULL
       AND lower(ns.email) IN (SELECT lower(btrim(x->>'email')) FROM jsonb_array_elements(p_rows) x WHERE x ? 'email')
    ON CONFLICT (list_import_id, email) DO NOTHING;
  END IF;

  IF jsonb_array_length(COALESCE(p_rows, '[]'::jsonb)) > 0 OR p_final THEN
    v_res := public.import_contact_list(
      COALESCE(p_rows, '[]'::jsonb), v_source, p_venue_id, p_organizer_user_id, v_ti.title, v_details,
      v_since, v_list, NULL, v_country, NULL, NULL, 'append', COALESCE(p_final, false), NULL);
  END IF;

  IF p_stats IS NOT NULL THEN
    UPDATE public.tix_imports
       SET new_count = GREATEST(0, COALESCE((p_stats->>'new')::int, new_count)),
           existing_count = GREATEST(0, COALESCE((p_stats->>'existing')::int, existing_count)),
           file_dup_count = GREATEST(0, COALESCE((p_stats->>'dup')::int, file_dup_count)),
           bad_count = GREATEST(0, COALESCE((p_stats->>'bad')::int, bad_count))
     WHERE list_import_id = v_list;
  END IF;
  IF p_final THEN
    UPDATE public.tix_imports SET status = 'done', finished_at = now() WHERE list_import_id = v_list;
  END IF;
  RETURN jsonb_build_object('list_import_id', v_list, 'rows', COALESCE(v_res->'rows', '0'::jsonb));
END;
$function$;

-- Annuler un import (miroir de crm_import_undo, produit NULL). Un désabonné
-- reste désabonné : c'est sa mémoire, jamais effacée.
CREATE OR REPLACE FUNCTION public.tix_import_undo(p_venue_id text, p_organizer_user_id uuid, p_list_import_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_ti public.tix_imports%ROWTYPE;
  v_email_import uuid;
  v_sms_import uuid;
  v_contacts integer;
  v_restored integer := 0;
  v_deleted integer := 0;
  v_sms integer := 0;
BEGIN
  IF NOT public._tix_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_ti FROM public.tix_imports WHERE list_import_id = p_list_import_id AND scope_key = v_scope FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_ti.status = 'undone' THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  SELECT email_import_id, sms_import_id INTO v_email_import, v_sms_import
    FROM public.contact_list_imports WHERE id = p_list_import_id;

  IF v_email_import IS NOT NULL THEN
    -- Réactivés par cet import : leur état d'avant (sauf désabonnement depuis).
    WITH r AS (
      UPDATE public.newsletter_subscriptions ns
         SET opted_in = j.prev_opted_in, import_id = j.prev_import_id,
             first_name = j.prev_first_name, last_name = j.prev_last_name, updated_at = now()
        FROM public.tix_import_journal j
       WHERE j.list_import_id = p_list_import_id
         AND lower(ns.email) = j.email
         AND ns.import_id = v_email_import
         AND ns.opted_out_at IS NULL
         AND ns.product IS NULL
         AND public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
      RETURNING 1
    ) SELECT count(*) INTO v_restored FROM r;
    -- Créés par cet import : retirés (un désabonné reste, c'est sa mémoire).
    WITH d AS (
      DELETE FROM public.newsletter_subscriptions ns
       WHERE ns.import_id = v_email_import
         AND ns.opted_out_at IS NULL
         AND ns.product IS NULL
         AND public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
         AND NOT EXISTS (SELECT 1 FROM public.tix_import_journal j WHERE j.list_import_id = p_list_import_id AND j.email = lower(ns.email))
      RETURNING 1
    ) SELECT count(*) INTO v_deleted FROM d;
  END IF;

  IF v_sms_import IS NOT NULL THEN
    WITH d AS (
      DELETE FROM public.venue_sms_contacts vc
       WHERE vc.import_id = v_sms_import
         AND vc.product IS NULL
         AND COALESCE(vc.unsubscribed, false) = false
      RETURNING 1
    ) SELECT count(*) INTO v_sms FROM d;
  END IF;

  WITH d AS (DELETE FROM public.imported_contacts WHERE list_import_id = p_list_import_id RETURNING 1)
  SELECT count(*) INTO v_contacts FROM d;

  UPDATE public.contact_list_imports SET superseded_at = now() WHERE id = p_list_import_id AND superseded_at IS NULL;
  UPDATE public.tix_imports SET status = 'undone', undone_at = now(), undone_by = auth.uid() WHERE list_import_id = p_list_import_id;

  RETURN jsonb_build_object('ok', true, 'contacts', v_contacts, 'emails_removed', v_deleted, 'emails_restored', v_restored, 'sms_removed', v_sms);
END;
$function$;

-- Accueil de l'écran Imports (miroir de crm_imports_overview). À la place de
-- la carte Shotgun : ce que les ventes Yuno apportent à la base (acheteurs et
-- inscrits de la guest list, dont ceux des 30 derniers jours).
CREATE OR REPLACE FUNCTION public.tix_imports_overview(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_sales jsonb;
  v_imports jsonb;
  v_legacy jsonb;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH s AS (
    SELECT x.email, min(x.purchased_at) AS first_at, max(x.purchased_at) AS last_at
      FROM public._tix_sales(p_venue_id, p_organizer_user_id) x
     WHERE x.email IS NOT NULL
     GROUP BY x.email
  )
  SELECT jsonb_build_object('people', count(*),
                            'month', count(*) FILTER (WHERE s.first_at >= now() - interval '30 days'),
                            'last_at', max(s.last_at))
    INTO v_sales FROM s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', i.list_import_id, 'kind', i.kind, 'title', i.title, 'consent', i.consent,
           'created_at', i.created_at, 'status', i.status, 'undone_at', i.undone_at,
           'new', i.new_count, 'existing', i.existing_count, 'dup', i.file_dup_count, 'bad', i.bad_count)
           ORDER BY i.created_at DESC), '[]'::jsonb)
    INTO v_imports
    FROM (SELECT * FROM public.tix_imports WHERE scope_key = v_scope AND status <> 'running' ORDER BY created_at DESC LIMIT 30) i;

  -- Fichiers importés avant cet écran (fenêtre d'import des campagnes).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', l.id, 'title', COALESCE(l.list_name, l.filename), 'created_at', l.created_at, 'rows', l.row_count)
           ORDER BY l.created_at DESC), '[]'::jsonb)
    INTO v_legacy
    FROM (SELECT * FROM public.contact_list_imports l
           WHERE public.marketing_scope_match(l.venue_id, l.organizer_user_id, p_venue_id, p_organizer_user_id)
             AND l.product IS NULL
             AND l.superseded_by IS NULL AND l.superseded_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM public.tix_imports c WHERE c.list_import_id = l.id)
           ORDER BY l.created_at DESC LIMIT 10) l;

  RETURN jsonb_build_object('sales', v_sales, 'imports', v_imports, 'legacy', v_legacy);
END;
$function$;

-- ── Les campagnes de Yuno Tickets visent la base Clients ─────────────────

-- E-mail (miroir de _crm_campaign_audience) : audiences {kind:'tix',
-- segmentId | def}, réunies ; registre de consentement de Yuno Tickets
-- (newsletter_subscriptions sans produit). Un segment supprimé ne vise plus
-- personne ; une audience vide ne vise personne.
CREATE OR REPLACE FUNCTION public._tix_campaign_audience(p_campaign_id uuid)
 RETURNS TABLE(email text, first_name text, last_name text, user_id uuid, unsubscribe_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.email_campaigns%ROWTYPE;
  a jsonb;
  v_def jsonb;
  v_preds text[] := '{}';
  v_recent integer;
  v_excl_buyers boolean;
  v_same uuid[];
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND OR (c.venue_id IS NULL AND c.organizer_user_id IS NULL) THEN RETURN; END IF;
  IF public.crm_campaign_is_crm(p_campaign_id) THEN RETURN; END IF;

  FOR a IN SELECT x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.audiences_json) = 'array' THEN c.audiences_json ELSE '[]'::jsonb END) x LOOP
    CONTINUE WHEN a->>'kind' IS DISTINCT FROM 'tix';
    v_def := NULL;
    IF COALESCE(a->>'segmentId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT s.definition INTO v_def FROM public.tix_segments s
       WHERE s.id = (a->>'segmentId')::uuid
         AND s.scope_key = public.crm_scope_key(c.venue_id, c.organizer_user_id);
      CONTINUE WHEN v_def IS NULL;
    ELSE
      v_def := COALESCE(a->'def', '{}'::jsonb);
    END IF;
    v_preds := array_append(v_preds, '(' || public._tix_filter_sql(v_def, 'p') || ')');
  END LOOP;
  IF cardinality(v_preds) = 0 THEN RETURN; END IF;

  v_recent := CASE WHEN COALESCE(c.exclusions_json->>'recentDays', '') ~ '^[0-9]{1,3}$'
                   THEN (c.exclusions_json->>'recentDays')::integer END;
  v_excl_buyers := COALESCE(c.exclusions_json->>'excludeEventBuyers', 'false') IN ('true', 't', '1') AND c.event_id IS NOT NULL;
  -- « Reçu un e-mail depuis N jours » ne compte que les campagnes de Yuno Tickets.
  v_same := CASE WHEN v_recent IS NULL THEN NULL ELSE public._email_scope_campaign_ids(c.venue_id, c.organizer_user_id, false) END;

  PERFORM public._tix_people_build(c.venue_id, c.organizer_user_id, NULL);

  RETURN QUERY EXECUTE format($q$
    SELECT DISTINCT ON (p.email) p.email::text, COALESCE(p.first_name, ns.first_name)::text,
           COALESCE(p.last_name, ns.last_name)::text, ns.user_id, ns.unsubscribe_token
      FROM _cp p
      JOIN public.newsletter_subscriptions ns
        ON lower(ns.email) = p.email AND ns.opted_in
       AND ((%1$L::text IS NOT NULL AND ns.venue_id = %1$L::text)
         OR (%2$L::uuid IS NOT NULL AND ns.organizer_user_id = %2$L::uuid))
       AND ns.product IS NULL
     WHERE p.email_ok AND (%3$s)
       AND (%4$L::integer IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.email_campaign_recipients r
               JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
              WHERE c2.id <> %5$L::uuid
                AND c2.venue_id IS NOT DISTINCT FROM %1$L::text
                AND c2.organizer_user_id IS NOT DISTINCT FROM %2$L::uuid
                AND c2.id = ANY (%8$L::uuid[])
                AND r.status = 'sent' AND r.sent_at > now() - make_interval(days => %4$L::integer)
                AND lower(r.email) = p.email))
       AND (NOT %6$L::boolean OR NOT (%7$L::uuid = ANY (p.events)))
     ORDER BY p.email, ns.created_at DESC
  $q$, c.venue_id, c.organizer_user_id, array_to_string(v_preds, ' OR '), v_recent, c.id, v_excl_buyers, c.event_id, v_same);
END;
$function$;

-- SMS : les numéros d'un ou plusieurs segments de Yuno Tickets (réunir ou
-- croiser), consentement lu dans le registre SMS de Yuno Tickets (produit
-- NULL, 36 mois, jamais un STOP). Appelée par resolve_sms_campaign_recipients.
CREATE OR REPLACE FUNCTION public._tix_sms_recipients(p_venue_id text, p_organizer_user_id uuid, p_segment_ids uuid[], p_match text DEFAULT 'any'::text)
 RETURNS TABLE(contact_id uuid, phone_e164 text, full_name text, user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_preds text[];
  v_found integer;
  v_want integer := cardinality(COALESCE(p_segment_ids, '{}'::uuid[]));
BEGIN
  IF ((p_venue_id IS NULL) = (p_organizer_user_id IS NULL)) OR v_want = 0 THEN RETURN; END IF;
  SELECT array_agg('(' || public._tix_filter_sql(s.definition, 'p') || ')'), count(*)
    INTO v_preds, v_found
    FROM public.tix_segments s
   WHERE s.id = ANY (p_segment_ids)
     AND s.scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id);
  -- Croiser des segments dont l'un a disparu : personne.
  IF v_found = 0 OR (COALESCE(p_match, 'any') = 'all' AND v_found < v_want) THEN RETURN; END IF;

  -- Base complète : un segment peut lire n'importe quelle colonne de _cp.
  PERFORM public._tix_people_build(p_venue_id, p_organizer_user_id, NULL);
  DROP TABLE IF EXISTS _tixph;
  EXECUTE format('CREATE TEMP TABLE _tixph ON COMMIT DROP AS SELECT DISTINCT p.phone AS ph FROM _cp p WHERE p.phone IS NOT NULL AND (%s)',
                 array_to_string(v_preds, CASE WHEN COALESCE(p_match, 'any') = 'all' THEN ' AND ' ELSE ' OR ' END));

  RETURN QUERY
  SELECT DISTINCT ON (vc.phone_e164) vc.id, vc.phone_e164, vc.full_name, vc.user_id
    FROM public.venue_sms_contacts vc
   WHERE NOT vc.unsubscribed
     AND vc.product IS NULL
     AND vc.sms_consent_at > now() - interval '36 months'
     AND vc.phone_e164 ~ '^\+[1-9][0-9]{6,14}$'
     AND public.marketing_scope_match(vc.venue_id, vc.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND vc.phone_e164 IN (SELECT x.ph FROM _tixph x)
   ORDER BY vc.phone_e164, vc.sms_consent_at DESC;
END;
$function$;

-- L'effectif SMS d'un ou plusieurs segments, pour l'éditeur SMS de la Console.
CREATE OR REPLACE FUNCTION public.tix_sms_audience_count(p_venue_id text, p_organizer_user_id uuid, p_segment_ids uuid[], p_match text DEFAULT 'any'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  IF NOT (public._tix_allowed(p_venue_id, p_organizer_user_id) AND public.sms_scope_allowed(p_venue_id, p_organizer_user_id)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO v_n FROM public._tix_sms_recipients(p_venue_id, p_organizer_user_id, p_segment_ids, p_match);
  RETURN COALESCE(v_n, 0);
END;
$function$;

-- Push : les comptes Yuno d'un segment (adresse du compte = adresse du client).
-- La politique d'envoi (préférences, heures calmes, plafonds) reste appliquée
-- ensuite par send-push-campaign (filter_manual_push_recipients).
CREATE OR REPLACE FUNCTION public.tix_segment_push_users(p_venue_id text, p_organizer_user_id uuid, p_segment_id uuid)
 RETURNS TABLE(user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_def jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'tix_segment_push_users: service_role only' USING ERRCODE = '42501';
  END IF;
  SELECT s.definition INTO v_def FROM public.tix_segments s
   WHERE s.id = p_segment_id AND s.scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id);
  IF v_def IS NULL THEN RETURN; END IF;
  PERFORM public._tix_people_build(p_venue_id, p_organizer_user_id, NULL);
  RETURN QUERY EXECUTE format(
    'SELECT DISTINCT pr.id FROM _cp p JOIN public.profiles pr ON lower(pr.email) = p.email WHERE %s',
    public._tix_filter_sql(v_def, 'p'));
END;
$function$;

-- Les segments de la portée, sans effectif (sélecteurs des éditeurs de campagne).
CREATE OR REPLACE FUNCTION public.tix_segments_list(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN '[]'::jsonb ELSE
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description,
                                                  'template', s.template, 'created_at', s.created_at) ORDER BY s.created_at)
                FROM public.tix_segments s
               WHERE s.scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id)), '[]'::jsonb) END;
$function$;

-- ── Les deux portes d'audience partagées, recopiées de la prod (22/10) ────
-- Une seule branche ajoutée à chacune ; le reste est inchangé.

CREATE OR REPLACE FUNCTION public.resolve_campaign_audience(p_campaign_id uuid)
 RETURNS TABLE(email text, first_name text, last_name text, user_id uuid, unsubscribe_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign RECORD;
  v_is_authorized boolean := false;
  v_audiences jsonb := '[]'::jsonb;
  v_excl_recent_days integer := NULL;
  v_excl_buyers boolean := false;
  -- Mode de combinaison des audiences cochées : 'any' (réunir, défaut) ou
  -- 'all' (croiser : le contact doit être dans CHAQUE audience cochée).
  v_match_all boolean := false;
  v_aud_n integer := 0;
  -- Séparation CRM / Billetterie : produit de la CAMPAGNE (NULL = Billetterie, 'crm' = CRM).
  v_prod text;
  v_same uuid[];
BEGIN
  SELECT * INTO v_campaign FROM public.email_campaigns WHERE id = p_campaign_id;
  IF v_campaign IS NULL THEN RETURN; END IF;
  v_prod := CASE WHEN public.crm_campaign_is_crm(p_campaign_id) THEN 'crm' END;

  IF v_campaign.venue_id IS NOT NULL THEN
    v_is_authorized := public.is_venue_owner(auth.uid(), v_campaign.venue_id) OR public.is_super_admin();
  ELSIF v_campaign.organizer_user_id IS NOT NULL THEN
    v_is_authorized := COALESCE((v_campaign.organizer_user_id = auth.uid()) OR public.is_super_admin(), false);
  ELSE
    -- Portée plateforme : super admin uniquement.
    v_is_authorized := public.is_super_admin();
  END IF;
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    v_is_authorized := true;
  END IF;
  -- E-mail pratique (Yuno CRM) : l'équipe de l'espace le compose aussi.
  IF v_campaign.practical AND NOT v_is_authorized THEN
    v_is_authorized := public.crm_scope_allowed(v_campaign.venue_id, v_campaign.organizer_user_id);
  END IF;
  IF NOT COALESCE(v_is_authorized, false) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- ── E-mail pratique (Yuno CRM, 20261019150000) ───────────────────────────
  -- Les détenteurs d'un billet valide de la soirée, seuls, sans accord
  -- marketing : l'information d'un achat, jamais une audience combinable.
  IF v_campaign.practical THEN
    RETURN QUERY SELECT * FROM public._crm_practical_audience(p_campaign_id);
    RETURN;
  END IF;

  -- ── Console Yuno CRM ─────────────────────────────────────────────────────
  -- Audiences {kind:'crm', segmentId?, def} : la base clients du CRM, filtrée
  -- par la même définition que l'écran Clients (_crm_filter_sql), et toujours
  -- passée par le registre de consentement de la portée (_crm_campaign_audience).
  IF jsonb_typeof(v_campaign.audiences_json) = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_campaign.audiences_json) x WHERE x->>'kind' = 'crm') THEN
    RETURN QUERY SELECT * FROM public._crm_campaign_audience(p_campaign_id);
    RETURN;
  END IF;

  -- ── Console Yuno Tickets › Clients (20261109400000) ─────────────────────
  -- Audiences {kind:'tix', segmentId?, def} : la base clients de Yuno Tickets
  -- (ventes Yuno, contacts et fichiers sans produit), filtrée par la même
  -- définition que l'écran Clients (_tix_filter_sql), toujours passée par le
  -- registre de consentement de Yuno Tickets (_tix_campaign_audience).
  IF v_prod IS NULL AND jsonb_typeof(v_campaign.audiences_json) = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_campaign.audiences_json) x WHERE x->>'kind' = 'tix') THEN
    RETURN QUERY SELECT * FROM public._tix_campaign_audience(p_campaign_id);
    RETURN;
  END IF;

  -- ── Portée plateforme ────────────────────────────────────────────────────
  -- Yuno écrit à SA base, jamais à celle d'un club. Une seule source : le
  -- registre plateforme (`newsletter_subscriptions` avec les deux colonnes de
  -- portée à NULL), alimenté par `sync_platform_marketing_contacts` et par les
  -- imports attestés. C'est lui qui porte le jeton de désinscription : aucune
  -- adresse ne peut entrer dans une campagne sans porte de sortie.
  IF v_campaign.venue_id IS NULL AND v_campaign.organizer_user_id IS NULL THEN
    v_audiences := COALESCE(v_campaign.audiences_json, '[]'::jsonb);
    v_aud_n := CASE WHEN jsonb_typeof(v_audiences) = 'array' THEN jsonb_array_length(v_audiences) ELSE 0 END;
    v_match_all := COALESCE(v_campaign.exclusions_json->>'audienceMatch', 'any') = 'all';
    IF jsonb_typeof(v_audiences) <> 'array' OR jsonb_array_length(v_audiences) = 0 THEN
      RETURN;                       -- audience vide ⇒ personne, jamais « tout le monde »
    END IF;

    v_excl_recent_days := CASE
      WHEN COALESCE(v_campaign.exclusions_json->>'recentDays', '') ~ '^[0-9]{1,3}$'
      THEN (v_campaign.exclusions_json->>'recentDays')::integer
      ELSE NULL
    END;
    v_excl_buyers := COALESCE(v_campaign.exclusions_json->>'excludeEventBuyers', 'false') IN ('true', 't', '1')
                     AND v_campaign.event_id IS NOT NULL;

    RETURN QUERY
    WITH cseg AS (
      SELECT DISTINCT LOWER(r.email) AS addr, cs.id AS sid
        FROM jsonb_array_elements(v_audiences) a
        JOIN public.contact_segments cs
          ON a->>'kind' = 'contact_segment'
         AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND cs.id = (a->>'segmentId')::uuid
         AND cs.venue_id IS NULL AND cs.organizer_user_id IS NULL
        CROSS JOIN LATERAL public.resolve_contact_segment_def(NULL, NULL, cs.definition) r
       WHERE r.email IS NOT NULL
    ), cseg_hits AS (
      SELECT addr, count(DISTINCT sid) AS n FROM cseg GROUP BY addr
    ), subs AS (
      SELECT LOWER(ns.email) AS addr,
             COALESCE(ch.n, 0)::integer AS seg_hits, 0::integer AS vseg_hits,
             COALESCE(p.first_name, ns.first_name) AS fname,
             COALESCE(p.last_name,  ns.last_name)  AS lname,
             ns.user_id AS uid, ns.unsubscribe_token AS tok,
             ns.import_id AS imp,
             COALESCE(ns.source, '') AS src,
             EXISTS (SELECT 1 FROM public.tickets t
                      WHERE LOWER(t.user_email) = LOWER(ns.email) AND t.status = 'paid') AS bought
        FROM public.newsletter_subscriptions ns
        LEFT JOIN cseg_hits ch ON ch.addr = LOWER(ns.email)
        LEFT JOIN public.profiles p ON p.id = ns.user_id
       WHERE ns.venue_id IS NULL AND ns.organizer_user_id IS NULL AND ns.opted_in = true
    ), matched AS (
      SELECT DISTINCT ON (s.addr) s.*
        FROM subs s
       WHERE (
         SELECT count(*) FROM jsonb_array_elements(v_audiences) a
          WHERE a->>'kind' NOT IN ('contact_segment','segment') AND CASE a->>'kind'
            WHEN 'all_subscribers' THEN true
            WHEN 'clients'    THEN s.src = 'platform:clients'
            WHEN 'pros'       THEN s.src = 'platform:pros'
            WHEN 'waitlist'   THEN s.src = 'platform:waitlist'
            WHEN 'leads'      THEN s.src = 'platform:leads'
            WHEN 'app_users'  THEN s.uid IS NOT NULL
            WHEN 'no_account' THEN s.uid IS NULL
            WHEN 'buyers'     THEN s.bought
            WHEN 'contact_segment' THEN false  -- compté via seg_hits
            WHEN 'import'     THEN s.imp IS NOT NULL
                                   AND s.imp::text = lower(COALESCE(a->>'importId',''))
            ELSE false
          END) + s.seg_hits + s.vseg_hits >= CASE WHEN v_match_all THEN v_aud_n ELSE 1 END
    )
    SELECT m.addr::text, m.fname::text, m.lname::text, m.uid, m.tok
      FROM matched m
     WHERE (v_excl_recent_days IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.email_campaign_recipients r
               JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
              WHERE c2.venue_id IS NULL AND c2.organizer_user_id IS NULL
                AND c2.id <> p_campaign_id
                AND r.status = 'sent'
                AND r.sent_at > now() - make_interval(days => v_excl_recent_days)
                AND LOWER(r.email) = m.addr))
       AND (NOT v_excl_buyers OR NOT EXISTS (
             SELECT 1 FROM public.tickets t
              WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                AND LOWER(t.user_email) = m.addr));
    RETURN;
  END IF;

  IF v_campaign.type = 'informational' AND v_campaign.event_id IS NOT NULL THEN
    -- Les acheteurs d'une soirée ne sont joignables en informatif QUE par ses
    -- parties PRINCIPALES : un co-hôte n'a que les contacts qui l'ont nommé
    -- (case du checkout), jamais toute la liste des acheteurs.
    IF NOT public.campaign_scope_is_event_principal(v_campaign.venue_id, v_campaign.organizer_user_id, v_campaign.event_id) THEN
      RETURN;
    END IF;
    IF v_campaign.audience_type IN ('event_buyers','event_all_buyers') THEN
      RETURN QUERY
      SELECT DISTINCT ON (LOWER(t.user_email))
        LOWER(t.user_email)::text,
        SPLIT_PART(COALESCE(t.full_name,''), ' ', 1)::text,
        NULLIF(REGEXP_REPLACE(COALESCE(t.full_name,''), '^\S+\s*', ''), '')::text,
        t.user_id,
        NULL::uuid
      FROM public.tickets t
      WHERE t.event_id = v_campaign.event_id AND t.status = 'paid' AND t.user_email IS NOT NULL;
    END IF;
    IF v_campaign.audience_type IN ('event_table_buyers','event_all_buyers') THEN
      RETURN QUERY
      SELECT DISTINCT ON (LOWER(tr.user_email))
        LOWER(tr.user_email)::text,
        SPLIT_PART(COALESCE(tr.full_name,''), ' ', 1)::text,
        NULLIF(REGEXP_REPLACE(COALESCE(tr.full_name,''), '^\S+\s*', ''), '')::text,
        tr.user_id,
        NULL::uuid
      FROM public.table_reservations tr
      WHERE tr.event_id = v_campaign.event_id AND tr.status = 'confirmed' AND tr.user_email IS NOT NULL;
    END IF;
    RETURN;
  END IF;

  IF v_campaign.type <> 'promotional' THEN RETURN; END IF;

  IF jsonb_typeof(COALESCE(v_campaign.audiences_json, '[]'::jsonb)) = 'array'
     AND jsonb_array_length(COALESCE(v_campaign.audiences_json, '[]'::jsonb)) > 0 THEN

    v_audiences := v_campaign.audiences_json;
    v_aud_n := CASE WHEN jsonb_typeof(v_audiences) = 'array' THEN jsonb_array_length(v_audiences) ELSE 0 END;
    v_match_all := COALESCE(v_campaign.exclusions_json->>'audienceMatch', 'any') = 'all';
    v_excl_recent_days := CASE
      WHEN COALESCE(v_campaign.exclusions_json->>'recentDays', '') ~ '^[0-9]{1,3}$'
      THEN (v_campaign.exclusions_json->>'recentDays')::integer
      ELSE NULL
    END;
    v_excl_buyers := COALESCE(v_campaign.exclusions_json->>'excludeEventBuyers', 'false') IN ('true', 't', '1')
                     AND v_campaign.event_id IS NOT NULL;

    -- « Reçu un e-mail depuis N jours » ne compte que les campagnes du MÊME produit.
    v_same := CASE WHEN v_excl_recent_days IS NULL THEN NULL
                   ELSE public._email_scope_campaign_ids(v_campaign.venue_id, v_campaign.organizer_user_id, v_prod IS NOT NULL) END;
    IF v_campaign.venue_id IS NOT NULL THEN
      RETURN QUERY
      WITH seg_emails AS (
        SELECT DISTINCT LOWER(seg.email) AS addr, vs.id AS sid
          FROM jsonb_array_elements(v_audiences) a
          JOIN public.venue_segments vs
            ON a->>'kind' = 'segment'
           AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           AND vs.id = (a->>'segmentId')::uuid
           AND vs.venue_id = v_campaign.venue_id
          CROSS JOIN LATERAL public.resolve_venue_segment(v_campaign.venue_id, vs.definition) seg
      ), cseg AS (
        -- Segments sur la base importée : la définition est résolue à l'envoi.
        SELECT DISTINCT LOWER(r.email) AS addr, cs.id AS sid
          FROM jsonb_array_elements(v_audiences) a
          JOIN public.contact_segments cs
            ON a->>'kind' = 'contact_segment'
           AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           AND cs.id = (a->>'segmentId')::uuid
           AND cs.venue_id = v_campaign.venue_id
          CROSS JOIN LATERAL public.resolve_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition) r
         WHERE r.email IS NOT NULL
      ), cseg_hits AS (
        SELECT addr, count(DISTINCT sid) AS n FROM cseg GROUP BY addr
      ), vseg_hits AS (
        SELECT addr, count(DISTINCT sid) AS n FROM seg_emails GROUP BY addr
      ), subs AS (
        SELECT LOWER(ns.email) AS addr,
               COALESCE(ch.n, 0)::integer AS seg_hits, COALESCE(vh.n, 0)::integer AS vseg_hits,
               COALESCE(p.first_name, vc.first_name, ns.first_name) AS fname,
               COALESCE(p.last_name,  vc.last_name, ns.last_name)  AS lname,
               ns.user_id AS uid, ns.unsubscribe_token AS tok,
               ns.import_id AS imp,
               COALESCE(vc.total_spent, 0) AS spent,
               (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) AS visits,
               vc.last_visit_at AS last_visit
          FROM public.newsletter_subscriptions ns
          LEFT JOIN public.venue_customers vc
            ON vc.venue_id = v_campaign.venue_id AND LOWER(vc.email) = LOWER(ns.email)
          LEFT JOIN cseg_hits ch ON ch.addr = LOWER(ns.email)
          LEFT JOIN vseg_hits vh ON vh.addr = LOWER(ns.email)
          LEFT JOIN public.profiles p ON p.id = ns.user_id
         WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true
           AND ns.product IS NOT DISTINCT FROM v_prod
      ), matched AS (
        SELECT DISTINCT ON (s.addr) s.*
          FROM subs s
         WHERE (
           SELECT count(*) FROM jsonb_array_elements(v_audiences) a
            WHERE a->>'kind' NOT IN ('contact_segment','segment') AND CASE a->>'kind'
              WHEN 'all_subscribers' THEN true
              WHEN 'vip'           THEN s.spent >= 500
              WHEN 'big_spenders'  THEN s.spent >= 1000
              WHEN 'regulars'      THEN s.visits BETWEEN 2 AND 4
              WHEN 'new_customers' THEN s.visits <= 1
              WHEN 'dormant'       THEN s.last_visit IS NOT NULL AND s.last_visit < now() - interval '90 days'
              WHEN 'event_subscribers' THEN v_campaign.event_id IS NOT NULL AND EXISTS (
                     SELECT 1 FROM public.tickets t
                      WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                        AND LOWER(t.user_email) = s.addr)
              WHEN 'segment' THEN false  -- compté via vseg_hits
              WHEN 'contact_segment' THEN false  -- compté via seg_hits
              WHEN 'import'  THEN s.imp IS NOT NULL
                                  AND s.imp::text = lower(COALESCE(a->>'importId',''))
              ELSE false
            END) + s.seg_hits + s.vseg_hits >= CASE WHEN v_match_all THEN v_aud_n ELSE 1 END
      )
      SELECT m.addr::text, m.fname::text, m.lname::text, m.uid, m.tok
        FROM matched m
       WHERE (v_excl_recent_days IS NULL OR NOT EXISTS (
               SELECT 1 FROM public.email_campaign_recipients r
                 JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
                WHERE c2.venue_id = v_campaign.venue_id
                  AND c2.id <> p_campaign_id AND c2.id = ANY (v_same)
                  AND r.status = 'sent'
                  AND r.sent_at > now() - make_interval(days => v_excl_recent_days)
                  AND LOWER(r.email) = m.addr))
         AND (NOT v_excl_buyers OR (
               NOT EXISTS (SELECT 1 FROM public.tickets t
                            WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                              AND LOWER(t.user_email) = m.addr)
               AND NOT EXISTS (SELECT 1 FROM public.table_reservations tr
                            WHERE tr.event_id = v_campaign.event_id AND tr.status IN ('paid','confirmed')
                              AND LOWER(tr.user_email) = m.addr)));
      RETURN;
    END IF;

    RETURN QUERY
    WITH agg AS (
      -- Un client est quelqu'un qui est VENU : billets, tables ET guest list
      -- (contact_scope_customers, la même source que la base de contacts).
      -- Avant, seuls les billets comptaient : un organisateur qui ne vend que
      -- des tables n'avait ni VIP, ni habitué, ni dormant.
      SELECT c.email AS addr,
             COALESCE(c.spent, 0)::numeric AS spent,
             COALESCE(c.event_count, 0) AS visits,
             c.last_at AS last_seen,
             c.first_name AS fname0,
             c.last_name AS lname0
        FROM public.contact_scope_customers(NULL, v_campaign.organizer_user_id) c
    ), cseg AS (
      SELECT DISTINCT LOWER(r.email) AS addr, cs.id AS sid
        FROM jsonb_array_elements(v_audiences) a
        JOIN public.contact_segments cs
          ON a->>'kind' = 'contact_segment'
         AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND cs.id = (a->>'segmentId')::uuid
         AND cs.organizer_user_id = v_campaign.organizer_user_id
        CROSS JOIN LATERAL public.resolve_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition) r
       WHERE r.email IS NOT NULL
    ), cseg_hits AS (
      SELECT addr, count(DISTINCT sid) AS n FROM cseg GROUP BY addr
    ), subs AS (
      SELECT LOWER(ns.email) AS addr,
             COALESCE(ch.n, 0)::integer AS seg_hits, 0::integer AS vseg_hits,
             COALESCE(p.first_name, ns.first_name, a.fname0) AS fname,
             COALESCE(p.last_name, ns.last_name, a.lname0) AS lname,
             ns.user_id AS uid, ns.unsubscribe_token AS tok,
             ns.import_id AS imp,
             COALESCE(a.spent, 0) AS spent,
             COALESCE(a.visits, 0) AS visits,
             a.last_seen AS last_visit
        FROM public.newsletter_subscriptions ns
        LEFT JOIN agg a ON a.addr = LOWER(ns.email)
        LEFT JOIN cseg_hits ch ON ch.addr = LOWER(ns.email)
        LEFT JOIN public.profiles p ON p.id = ns.user_id
       WHERE ns.organizer_user_id = v_campaign.organizer_user_id AND ns.opted_in = true
         AND ns.product IS NOT DISTINCT FROM v_prod
    ), matched AS (
      SELECT DISTINCT ON (s.addr) s.*
        FROM subs s
       WHERE (
         SELECT count(*) FROM jsonb_array_elements(v_audiences) a2
          WHERE a2->>'kind' NOT IN ('contact_segment','segment') AND CASE a2->>'kind'
            WHEN 'all_subscribers' THEN true
            WHEN 'vip'           THEN s.spent >= 500
            WHEN 'big_spenders'  THEN s.spent >= 1000
            WHEN 'regulars'      THEN s.visits BETWEEN 2 AND 4
            WHEN 'new_customers' THEN s.visits <= 1
            WHEN 'dormant'       THEN s.last_visit IS NOT NULL AND s.last_visit < now() - interval '90 days'
            WHEN 'event_subscribers' THEN v_campaign.event_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM public.tickets t
                    WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                      AND LOWER(t.user_email) = s.addr)
            WHEN 'contact_segment' THEN false  -- compté via seg_hits
            WHEN 'import'  THEN s.imp IS NOT NULL
                                AND s.imp::text = lower(COALESCE(a2->>'importId',''))
            ELSE false
          END) + s.seg_hits + s.vseg_hits >= CASE WHEN v_match_all THEN v_aud_n ELSE 1 END
    )
    SELECT m.addr::text, m.fname::text, m.lname::text, m.uid, m.tok
      FROM matched m
     WHERE (v_excl_recent_days IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.email_campaign_recipients r
               JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
              WHERE c2.organizer_user_id = v_campaign.organizer_user_id
                AND c2.id <> p_campaign_id AND c2.id = ANY (v_same)
                AND r.status = 'sent'
                AND r.sent_at > now() - make_interval(days => v_excl_recent_days)
                AND LOWER(r.email) = m.addr))
       AND (NOT v_excl_buyers OR (
             NOT EXISTS (SELECT 1 FROM public.tickets t
                          WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                            AND LOWER(t.user_email) = m.addr)
             AND NOT EXISTS (SELECT 1 FROM public.table_reservations tr
                          WHERE tr.event_id = v_campaign.event_id AND tr.status IN ('paid','confirmed')
                            AND LOWER(tr.user_email) = m.addr)));
    RETURN;
  END IF;

  IF v_campaign.audience_type = 'all_subscribers' THEN
    RETURN QUERY
    SELECT LOWER(ns.email)::text, p.first_name::text, p.last_name::text, ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    LEFT JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.opted_in = true AND ns.product IS NOT DISTINCT FROM v_prod
      AND ((v_campaign.venue_id IS NOT NULL AND ns.venue_id = v_campaign.venue_id)
           OR (v_campaign.organizer_user_id IS NOT NULL AND ns.organizer_user_id = v_campaign.organizer_user_id));
    RETURN;
  END IF;

  IF v_campaign.audience_type = 'event_subscribers' AND v_campaign.event_id IS NOT NULL THEN
    RETURN QUERY
    SELECT DISTINCT ON (LOWER(ns.email))
      LOWER(ns.email)::text, p.first_name::text, p.last_name::text, ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    JOIN public.tickets t ON LOWER(t.user_email) = LOWER(ns.email)
    LEFT JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.opted_in = true
      AND t.event_id = v_campaign.event_id AND t.status = 'paid'
      AND ns.product IS NOT DISTINCT FROM v_prod
      AND ((v_campaign.venue_id IS NOT NULL AND ns.venue_id = v_campaign.venue_id)
           OR (v_campaign.organizer_user_id IS NOT NULL AND ns.organizer_user_id = v_campaign.organizer_user_id));
    RETURN;
  END IF;

  IF v_campaign.audience_type = 'custom_segment' THEN
    IF v_campaign.venue_id IS NULL OR v_campaign.segment_id IS NULL THEN RETURN; END IF;
    RETURN QUERY
    SELECT DISTINCT ON (LOWER(ns.email))
      LOWER(ns.email)::text,
      COALESCE(p.first_name, vc.first_name)::text,
      COALESCE(p.last_name, vc.last_name)::text,
      ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    JOIN public.resolve_venue_segment(
           v_campaign.venue_id,
           (SELECT vs.definition FROM public.venue_segments vs
             WHERE vs.id = v_campaign.segment_id AND vs.venue_id = v_campaign.venue_id)
         ) seg ON LOWER(seg.email) = LOWER(ns.email)
    LEFT JOIN public.venue_customers vc
      ON vc.venue_id = v_campaign.venue_id AND LOWER(vc.email) = LOWER(ns.email)
    LEFT JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true AND ns.product IS NOT DISTINCT FROM v_prod;
    RETURN;
  END IF;

  IF v_campaign.audience_type IN ('vip','regulars','new_customers','big_spenders','dormant') THEN
    IF v_campaign.venue_id IS NOT NULL THEN
      RETURN QUERY
      SELECT LOWER(ns.email)::text,
             COALESCE(p.first_name, vc.first_name)::text,
             COALESCE(p.last_name, vc.last_name)::text,
             ns.user_id, ns.unsubscribe_token
      FROM public.newsletter_subscriptions ns
      JOIN public.venue_customers vc ON LOWER(vc.email) = LOWER(ns.email) AND vc.venue_id = v_campaign.venue_id
      LEFT JOIN public.profiles p ON p.id = ns.user_id
      WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true AND ns.product IS NOT DISTINCT FROM v_prod
        AND CASE v_campaign.audience_type
          WHEN 'vip' THEN vc.total_spent >= 500
          WHEN 'regulars' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) BETWEEN 2 AND 4
          WHEN 'new_customers' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) <= 1
          WHEN 'big_spenders' THEN vc.total_spent >= 1000
          WHEN 'dormant' THEN vc.last_visit_at < now() - interval '90 days'
          ELSE FALSE
        END;
      RETURN;
    END IF;

    RETURN QUERY
    WITH agg AS (
      SELECT c.email,
             COALESCE(c.spent, 0)::numeric AS spent,
             COALESCE(c.event_count, 0) AS visits,
             c.last_at AS last_seen,
             c.first_name, c.last_name
        FROM public.contact_scope_customers(NULL, v_campaign.organizer_user_id) c
    )
    SELECT a.email::text,
           a.first_name::text,
           a.last_name::text,
           ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    JOIN agg a ON a.email = LOWER(ns.email)
    WHERE ns.organizer_user_id = v_campaign.organizer_user_id AND ns.opted_in = true AND ns.product IS NOT DISTINCT FROM v_prod
      AND CASE v_campaign.audience_type
        WHEN 'vip' THEN a.spent >= 500
        WHEN 'regulars' THEN a.visits BETWEEN 2 AND 4
        WHEN 'new_customers' THEN a.visits = 1
        WHEN 'big_spenders' THEN a.spent >= 1000
        WHEN 'dormant' THEN a.last_seen < now() - interval '90 days'
        ELSE FALSE
      END;
    RETURN;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_sms_campaign_recipients(p_venue_id text, p_organizer_user_id uuid, p_segment_type text, p_event_id uuid DEFAULT NULL::uuid, p_import_id uuid DEFAULT NULL::uuid, p_segment_id uuid DEFAULT NULL::uuid, p_segment_ids uuid[] DEFAULT NULL::uuid[], p_match text DEFAULT 'any'::text)
 RETURNS TABLE(contact_id uuid, phone_e164 text, full_name text, user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[] := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_segment_ids, ARRAY[p_segment_id])) x WHERE x IS NOT NULL);
  v_need integer := CASE WHEN COALESCE(p_match, 'any') = 'all' THEN 1 ELSE 0 END;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'resolve_sms_campaign_recipients: service_role only';
  END IF;
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'resolve_sms_campaign_recipients: une seule portée à la fois';
  END IF;
  -- Segments de Yuno Tickets › Clients (20261109400000) : résolus sur la base
  -- clients de Yuno Tickets, consentement lu dans le même registre qu'ici.
  IF p_segment_type = 'tix_segment' THEN
    RETURN QUERY SELECT * FROM public._tix_sms_recipients(p_venue_id, p_organizer_user_id, v_ids, p_match);
    RETURN;
  END IF;
  -- Croiser : le numéro doit être dans CHAQUE segment ; réunir : dans au moins un.
  v_need := CASE WHEN v_need = 1 THEN cardinality(v_ids) ELSE 1 END;

  RETURN QUERY
  WITH cseg AS (
    SELECT r.phone_e164 AS ph, cs.id AS sid
      FROM public.contact_segments cs
      CROSS JOIN LATERAL public.resolve_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition) r
     WHERE cardinality(v_ids) > 0 AND cs.id = ANY(v_ids)
       AND public.marketing_scope_match(cs.venue_id, cs.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND r.phone_e164 IS NOT NULL
  ), cph AS (
    SELECT ph FROM cseg GROUP BY ph HAVING count(DISTINCT sid) >= v_need
  )
  SELECT DISTINCT ON (c.phone_e164)
         c.id, c.phone_e164, c.full_name, c.user_id
    FROM public.venue_sms_contacts c
   WHERE NOT c.unsubscribed
     AND c.product IS NULL
     AND c.sms_consent_at > now() - interval '36 months'
     AND c.phone_e164 ~ '^\+[1-9][0-9]{6,14}$'
     AND public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND CASE COALESCE(p_segment_type, 'all')
           WHEN 'event'  THEN p_event_id IS NOT NULL AND c.source_event_id = p_event_id
           WHEN 'vip'    THEN c.is_vip
           WHEN 'import' THEN p_import_id IS NOT NULL AND c.import_id = p_import_id
           WHEN 'contact_segment' THEN cardinality(v_ids) > 0 AND c.phone_e164 IN (SELECT ph FROM cph)
           WHEN 'pros'    THEN EXISTS (
             SELECT 1 FROM public.newsletter_subscriptions ns
              WHERE ns.venue_id IS NULL AND ns.organizer_user_id IS NULL
                AND lower(ns.email) = lower(c.email)
                AND ns.source IN ('platform:pros','platform:leads'))
           WHEN 'clients' THEN EXISTS (
             SELECT 1 FROM public.newsletter_subscriptions ns
              WHERE ns.venue_id IS NULL AND ns.organizer_user_id IS NULL
                AND lower(ns.email) = lower(c.email)
                AND ns.source IN ('platform:clients','platform:waitlist'))
           WHEN 'not_event' THEN p_event_id IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM public.tickets t
                WHERE t.event_id = p_event_id
                  AND t.status <> 'refunded' AND t.cancelled_at IS NULL
                  AND public.normalize_phone_e164(COALESCE(t.phone, t.guest_phone)) = c.phone_e164
             )
             AND NOT EXISTS (
               SELECT 1 FROM public.table_reservations tr
                WHERE tr.event_id = p_event_id
                  AND tr.status <> 'refunded'
                  AND public.normalize_phone_e164(COALESCE(tr.phone, tr.guest_phone)) = c.phone_e164
             )
           ELSE true
         END
   ORDER BY c.phone_e164, c.sms_consent_at DESC;
END;
$function$;

-- ── Aperçus démo : ces lectures passent (tables temporaires) ──────────────
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
    'crm_night_plan',
    -- Yuno Tickets › Analyses (20261109300000) : mêmes calculs que le CRM
    'tix_ana_sales', 'tix_ana_traffic', 'tix_ana_community', 'tix_journey',
    -- Yuno Tickets › Clients, Segments, Imports (20261109400000)
    'tix_clients_overview', 'tix_clients_list', 'tix_client', 'tix_audience_count',
    'tix_audience_counts', 'tix_segments_brief', 'tix_segments_overview', 'tix_segment_detail',
    'tix_segments_fill_anchors', 'tix_segment_catalog', 'tix_import_check', 'tix_sms_audience_count'
  ]::text[]);
$function$;

-- ── Droits ──────────────────────────────────────────────────────────────
-- Tout est d'abord fermé, puis les seules lectures et écritures de la Console
-- sont ouvertes à `authenticated` (chacune garde sa porte). Les aides restent
-- au propriétaire ; la résolution push n'est appelable que par service_role.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY['tix_clients_overview', 'tix_clients_list', 'tix_client', 'tix_client_save', 'tix_clients_export', 'tix_events_brief', 'tix_audience_count', 'tix_audience_counts', 'tix_segments_brief', 'tix_segments_overview', 'tix_segment_detail', 'tix_segments_fill_anchors', 'tix_segment_save', 'tix_segment_delete', 'tix_segment_catalog', 'tix_segments_create_many', 'tix_import_check', 'tix_import_commit', 'tix_import_undo', 'tix_imports_overview', 'tix_sms_audience_count', 'tix_segments_list', '_tix_writable', '_tix_filter_sql', '_tix_segment_defs', '_tix_segment_counts_write', '_tix_msg_build', '_tix_send_target', 'tix_clients_list__core', 'tix_client__core', 'tix_clients_export__core', 'tix_segments_overview__core', 'tix_segment_detail__core', '_tix_campaign_audience', '_tix_sms_recipients', 'tix_segment_push_users']) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    IF r.proname = ANY (ARRAY['tix_clients_overview', 'tix_clients_list', 'tix_client', 'tix_client_save', 'tix_clients_export', 'tix_events_brief', 'tix_audience_count', 'tix_audience_counts', 'tix_segments_brief', 'tix_segments_overview', 'tix_segment_detail', 'tix_segments_fill_anchors', 'tix_segment_save', 'tix_segment_delete', 'tix_segment_catalog', 'tix_segments_create_many', 'tix_import_check', 'tix_import_commit', 'tix_import_undo', 'tix_imports_overview', 'tix_sms_audience_count', 'tix_segments_list']) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
    IF r.proname = 'tix_segment_push_users' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    END IF;
  END LOOP;
END $$;
