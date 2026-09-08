-- ============================================================================
-- Intelligence de la base importée — import unifié (email + SMS) et
-- segmentation proposée.
-- ============================================================================
--
-- Un pro qui arrive avec l'export de son ancienne billetterie (Kevin / WOH :
-- 12 000 lignes avec email, téléphone, ville, pays, âge, genre, total dépensé,
-- nombre de soirées, dernier achat) devait l'importer DEUX fois (une liste
-- email, une liste SMS) et perdait toute la matière qui rend une base
-- exploitable : qui vient de Paris, qui n'a jamais payé, qui achète des
-- tables, qui est venu quatre fois, qui n'est pas revenu depuis un an.
--
-- Ce que cette migration pose :
--
--   1. `contact_list_imports` : UNE liste = UN fichier = UNE attestation, qui
--      alimente à la fois `email_list_imports` (emails → newsletter_subscriptions)
--      et `sms_list_imports` (numéros → venue_sms_contacts). L'import unifié
--      `import_contact_list` APPELLE les deux RPC existantes : les portes de
--      conformité (attestation, liste repoussoir STOP, désabonné jamais
--      réactivé, suppression, session support) restent celles qui existent —
--      rien n'est dupliqué, rien n'est contourné.
--
--   2. `imported_contacts` : la ligne brute typée de chaque contact du fichier
--      (localisation, dépenses, fréquence, récence, démographie). C'est la
--      matière première de l'analyse. Elle ne porte AUCUN consentement : un
--      contact n'est joignable que s'il existe dans newsletter_subscriptions
--      (opt-in) ou venue_sms_contacts (consentement < 36 mois, pas de STOP).
--
--   3. `contact_segments` : segments sur les attributs importés, aux DEUX
--      portées (club ET organisateur — contrairement à `venue_segments`).
--      Définition jsonb v1 {"version":1,"match":"all","conditions":[...]},
--      résolue À L'ENVOI (`resolve_contact_segment_def`), condition inconnue
--      ⇒ FAUX. Consommés par l'audience email (kind 'contact_segment', toujours
--      ∩ opt-in) et par le SMS (segment_type 'contact_segment', toujours ∩
--      consentement SMS).
--
--   4. `analyze_contact_lists` : l'analyse déterministe (pas d'IA — les
--      chiffres doivent être exacts et reproductibles) qui propose des
--      segments avec leur effectif RÉEL joignable par canal et une raison
--      chiffrée. Le pro coche ce qu'il garde ; `save_contact_segments` crée.
--
-- Une même personne présente dans plusieurs fichiers est consolidée sur sa
-- ligne la plus récente (`contact_rows`) : un ancien export à 0 € ne la
-- classe pas « gratuite » si le nouveau la montre à 300 €.
-- ============================================================================

-- ── 0. Garde de portée ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.contact_scope_allowed(p_venue_id text, p_organizer_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.sms_scope_allowed(p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.contact_scope_allowed(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_scope_allowed(text, uuid) TO authenticated, service_role;

-- ── 1. Listes unifiées ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contact_list_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  email_import_id uuid REFERENCES public.email_list_imports(id) ON DELETE SET NULL,
  sms_import_id uuid REFERENCES public.sms_list_imports(id) ON DELETE SET NULL,
  list_name text CHECK (list_name IS NULL OR char_length(btrim(list_name)) BETWEEN 1 AND 60),
  filename text,
  consent_source text NOT NULL
    CHECK (consent_source IN ('in_person','website_form','ticketing','social','other_tool','other')),
  consent_details text,
  collected_since date,
  default_country text,
  detected_columns jsonb NOT NULL DEFAULT '{}'::jsonb,
  channels jsonb NOT NULL DEFAULT '{"email":true,"sms":true}'::jsonb,
  row_count integer NOT NULL DEFAULT 0,
  email_count integer NOT NULL DEFAULT 0,
  phone_count integer NOT NULL DEFAULT 0,
  both_count integer NOT NULL DEFAULT 0,
  analysis jsonb,
  analyzed_at timestamptz,
  attested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  attested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_list_imports_owner_check CHECK (
    (venue_id IS NOT NULL AND organizer_user_id IS NULL)
    OR (venue_id IS NULL AND organizer_user_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_contact_list_imports_venue ON public.contact_list_imports (venue_id, created_at DESC) WHERE venue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contact_list_imports_org ON public.contact_list_imports (organizer_user_id, created_at DESC) WHERE organizer_user_id IS NOT NULL;

ALTER TABLE public.contact_list_imports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_list_imports_scope_read ON public.contact_list_imports;
CREATE POLICY contact_list_imports_scope_read ON public.contact_list_imports FOR SELECT TO authenticated
  USING (public.contact_scope_allowed(venue_id, organizer_user_id));
-- Aucune policy d'écriture : tout passe par les RPC.

-- ── 2. Lignes importées typées ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.imported_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_import_id uuid NOT NULL REFERENCES public.contact_list_imports(id) ON DELETE CASCADE,
  venue_id text,
  organizer_user_id uuid,
  email text,
  phone_e164 text,
  first_name text,
  last_name text,
  country_code text,
  country text,
  region text,
  city text,
  postal_code text,
  zone text,
  age integer,
  gender text CHECK (gender IS NULL OR gender IN ('female','male','other')),
  newsletter_opt_in boolean,
  added_at timestamptz,
  last_purchase_at timestamptz,
  total_spent numeric(12,2),
  event_count integer,
  extra jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT imported_contacts_identity_check CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_imported_contacts_identity
  ON public.imported_contacts (list_import_id, COALESCE(email,''), COALESCE(phone_e164,''));
CREATE INDEX IF NOT EXISTS idx_imported_contacts_venue ON public.imported_contacts (venue_id) WHERE venue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_imported_contacts_org ON public.imported_contacts (organizer_user_id) WHERE organizer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_imported_contacts_email ON public.imported_contacts (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_imported_contacts_phone ON public.imported_contacts (phone_e164) WHERE phone_e164 IS NOT NULL;

ALTER TABLE public.imported_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS imported_contacts_scope_read ON public.imported_contacts;
CREATE POLICY imported_contacts_scope_read ON public.imported_contacts FOR SELECT TO authenticated
  USING (public.contact_scope_allowed(venue_id, organizer_user_id));

-- ── 3. Segments sur attributs importés (club ET organisateur) ──────────────
CREATE TABLE IF NOT EXISTS public.contact_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  description text,
  definition jsonb NOT NULL DEFAULT '{"version":1,"match":"all","conditions":[]}'::jsonb,
  origin text NOT NULL DEFAULT 'suggested' CHECK (origin IN ('suggested','manual')),
  suggestion_key text,
  list_import_id uuid REFERENCES public.contact_list_imports(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_segments_owner_check CHECK (
    (venue_id IS NOT NULL AND organizer_user_id IS NULL)
    OR (venue_id IS NULL AND organizer_user_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_segments_venue_name
  ON public.contact_segments (venue_id, lower(name)) WHERE venue_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_segments_org_name
  ON public.contact_segments (organizer_user_id, lower(name)) WHERE organizer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contact_segments_venue ON public.contact_segments (venue_id, created_at DESC) WHERE venue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contact_segments_org ON public.contact_segments (organizer_user_id, created_at DESC) WHERE organizer_user_id IS NOT NULL;

ALTER TABLE public.contact_segments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_segments_scope_all ON public.contact_segments;
CREATE POLICY contact_segments_scope_all ON public.contact_segments FOR ALL TO authenticated
  USING (public.contact_scope_allowed(venue_id, organizer_user_id))
  WITH CHECK (public.contact_scope_allowed(venue_id, organizer_user_id));

DROP TRIGGER IF EXISTS update_contact_segments_updated_at ON public.contact_segments;
CREATE TRIGGER update_contact_segments_updated_at
  BEFORE UPDATE ON public.contact_segments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 4. Consolidation : une personne = sa ligne la plus récente ──────────────
CREATE OR REPLACE FUNCTION public.contact_rows(p_venue_id text, p_organizer_user_id uuid)
RETURNS SETOF public.imported_contacts
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT ON (COALESCE(c.email, c.phone_e164)) c.*
    FROM public.imported_contacts c
   WHERE (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
      OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id)
   ORDER BY COALESCE(c.email, c.phone_e164), c.created_at DESC, c.id;
$$;
REVOKE ALL ON FUNCTION public.contact_rows(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contact_rows(text, uuid) TO service_role;

-- ── 5. Le matcher : une ligne (jsonb) satisfait-elle une définition ? ──────
-- Vocabulaire v1 (toute condition inconnue ⇒ FAUX ; un attribut absent ⇒ FAUX) :
--   country {in[]} · country_not {in[]} · zone {in[]} · city {in[]} · region {in[]}
--   spent {op,value} · spent_per_event {op,value} · events {op,value}
--   last_purchase_days {op,value} · added_days {op,value} · age {min,max}
--   gender {in[]} · newsletter_opt_in {value} · has_email {value} · has_phone {value}
--   list {in[]}
-- op ∈ gte | gt | lte | lt | eq
CREATE OR REPLACE FUNCTION public.contact_num_cmp(a numeric, op text, b numeric)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT COALESCE(CASE op
    WHEN 'gte' THEN a >= b
    WHEN 'gt'  THEN a > b
    WHEN 'lte' THEN a <= b
    WHEN 'lt'  THEN a < b
    WHEN 'eq'  THEN a = b
    ELSE false END, false);
$$;

CREATE OR REPLACE FUNCTION public.contact_row_matches(p_row jsonb, p_definition jsonb)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT NOT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(COALESCE(p_definition->'conditions', '[]'::jsonb)) AS c
     WHERE NOT COALESCE(CASE c->>'type'
       WHEN 'country' THEN
         upper(COALESCE(p_row->>'country_code','')) IN (SELECT upper(x) FROM jsonb_array_elements_text(COALESCE(c->'in','[]'::jsonb)) x)
       WHEN 'country_not' THEN
         p_row->>'country_code' IS NOT NULL
         AND upper(p_row->>'country_code') NOT IN (SELECT upper(x) FROM jsonb_array_elements_text(COALESCE(c->'in','[]'::jsonb)) x)
       WHEN 'zone' THEN
         lower(btrim(COALESCE(p_row->>'zone',''))) IN (SELECT lower(btrim(x)) FROM jsonb_array_elements_text(COALESCE(c->'in','[]'::jsonb)) x)
       WHEN 'city' THEN
         lower(btrim(COALESCE(p_row->>'city',''))) IN (SELECT lower(btrim(x)) FROM jsonb_array_elements_text(COALESCE(c->'in','[]'::jsonb)) x)
       WHEN 'region' THEN
         lower(btrim(COALESCE(p_row->>'region',''))) IN (SELECT lower(btrim(x)) FROM jsonb_array_elements_text(COALESCE(c->'in','[]'::jsonb)) x)
       WHEN 'spent' THEN
         public.contact_num_cmp((p_row->>'total_spent')::numeric, c->>'op', (c->>'value')::numeric)
       WHEN 'spent_per_event' THEN
         public.contact_num_cmp(
           (p_row->>'total_spent')::numeric / NULLIF((p_row->>'event_count')::numeric, 0),
           c->>'op', (c->>'value')::numeric)
       WHEN 'events' THEN
         public.contact_num_cmp((p_row->>'event_count')::numeric, c->>'op', (c->>'value')::numeric)
       WHEN 'last_purchase_days' THEN
         p_row->>'last_purchase_at' IS NOT NULL
         AND public.contact_num_cmp(
           EXTRACT(EPOCH FROM (now() - (p_row->>'last_purchase_at')::timestamptz)) / 86400.0,
           c->>'op', (c->>'value')::numeric)
       WHEN 'added_days' THEN
         p_row->>'added_at' IS NOT NULL
         AND public.contact_num_cmp(
           EXTRACT(EPOCH FROM (now() - (p_row->>'added_at')::timestamptz)) / 86400.0,
           c->>'op', (c->>'value')::numeric)
       WHEN 'age' THEN
         (p_row->>'age')::int BETWEEN COALESCE((c->>'min')::int, 0) AND COALESCE((c->>'max')::int, 200)
       WHEN 'gender' THEN
         COALESCE(p_row->>'gender','') IN (SELECT x FROM jsonb_array_elements_text(COALESCE(c->'in','[]'::jsonb)) x)
       WHEN 'newsletter_opt_in' THEN
         (p_row->>'newsletter_opt_in')::boolean = COALESCE((c->>'value')::boolean, true)
       WHEN 'has_email' THEN
         ((p_row->>'email') IS NOT NULL) = COALESCE((c->>'value')::boolean, true)
       WHEN 'has_phone' THEN
         ((p_row->>'phone_e164') IS NOT NULL) = COALESCE((c->>'value')::boolean, true)
       WHEN 'list' THEN
         COALESCE(p_row->>'list_import_id','') IN (SELECT x FROM jsonb_array_elements_text(COALESCE(c->'in','[]'::jsonb)) x)
       ELSE false
     END, false)
  );
$$;

-- ── 6. Résolveurs ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_contact_segment_def(
  p_venue_id text, p_organizer_user_id uuid, p_definition jsonb
)
RETURNS TABLE(email text, phone_e164 text, first_name text, last_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'resolve_contact_segment_def: exactly one scope required';
  END IF;
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.email, c.phone_e164, c.first_name, c.last_name
    FROM public.contact_rows(p_venue_id, p_organizer_user_id) c
   WHERE public.contact_row_matches(to_jsonb(c), p_definition);
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_contact_segment_def(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_contact_segment_def(text, uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_contact_segment(p_segment_id uuid)
RETURNS TABLE(email text, phone_e164 text, first_name text, last_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE s public.contact_segments%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.contact_segments WHERE id = p_segment_id;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM public.resolve_contact_segment_def(s.venue_id, s.organizer_user_id, s.definition);
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_contact_segment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_contact_segment(uuid) TO authenticated, service_role;

-- Effectif RÉEL joignable par canal : la ligne importée ne vaut rien sans le
-- consentement — email opt-in non supprimé, SMS consenti < 36 mois sans STOP.
CREATE OR REPLACE FUNCTION public.count_contact_segment_def(
  p_venue_id text, p_organizer_user_id uuid, p_definition jsonb
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_n integer; v_e integer; v_p integer;
BEGIN
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  SELECT count(*),
         count(*) FILTER (WHERE r.email IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.newsletter_subscriptions ns
            WHERE lower(ns.email) = r.email AND ns.opted_in
              AND ((p_venue_id IS NOT NULL AND ns.venue_id = p_venue_id)
                OR (p_organizer_user_id IS NOT NULL AND ns.organizer_user_id = p_organizer_user_id))
         ) AND NOT public.is_email_suppressed(r.email)),
         count(*) FILTER (WHERE r.phone_e164 IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.venue_sms_contacts vc
            WHERE vc.phone_e164 = r.phone_e164 AND NOT vc.unsubscribed
              AND vc.sms_consent_at > now() - interval '36 months'
              AND ((p_venue_id IS NOT NULL AND vc.venue_id = p_venue_id)
                OR (p_organizer_user_id IS NOT NULL AND vc.organizer_user_id = p_organizer_user_id))
         ))
    INTO v_n, v_e, v_p
    FROM public.resolve_contact_segment_def(p_venue_id, p_organizer_user_id, p_definition) r;
  RETURN jsonb_build_object('contacts', COALESCE(v_n,0), 'emails', COALESCE(v_e,0), 'phones', COALESCE(v_p,0));
END;
$$;
REVOKE ALL ON FUNCTION public.count_contact_segment_def(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_contact_segment_def(text, uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.count_contact_segment(p_segment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE s public.contact_segments%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.contact_segments WHERE id = p_segment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('contacts', 0, 'emails', 0, 'phones', 0); END IF;
  RETURN public.count_contact_segment_def(s.venue_id, s.organizer_user_id, s.definition);
END;
$$;
REVOKE ALL ON FUNCTION public.count_contact_segment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_contact_segment(uuid) TO authenticated, service_role;

-- ── 7. Import unifié ────────────────────────────────────────────────────────
-- p_rows : [{email, phone, first_name, last_name, country_code, country, region,
--            city, postal_code, zone, age, gender, newsletter_opt_in, added_at,
--            last_purchase_at, total_spent, event_count, extra}]
-- Le front a déjà typé et normalisé (E.164, ISO-2, ISO dates, nombres) ; le
-- serveur revalide chaque champ et ignore ce qui ne passe pas — jamais d'erreur
-- sur une cellule, toujours sur une règle (portée, consentement, session).
CREATE OR REPLACE FUNCTION public.import_contact_list(
  p_rows jsonb,
  p_consent_source text,
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL,
  p_filename text DEFAULT NULL,
  p_consent_details text DEFAULT NULL,
  p_collected_since date DEFAULT NULL,
  p_list_import_id uuid DEFAULT NULL,
  p_list_name text DEFAULT NULL,
  p_default_country text DEFAULT NULL,
  p_channels jsonb DEFAULT '{"email":true,"sms":true}'::jsonb,
  p_detected jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_list public.contact_list_imports%ROWTYPE;
  v_submitted integer := 0;
  v_rows integer := 0;
  v_emails integer := 0;
  v_phones integer := 0;
  v_both integer := 0;
  v_invalid integer := 0;
  v_email_res jsonb := NULL;
  v_sms_res jsonb := NULL;
  v_email_payload jsonb;
  v_sms_payload jsonb;
  v_want_email boolean := COALESCE((p_channels->>'email')::boolean, true);
  v_want_sms boolean := COALESCE((p_channels->>'sms')::boolean, true);
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'import_contact_list: fournir p_venue_id OU p_organizer_user_id';
  END IF;
  -- Même autorisation que l'import email (le plus strict des deux) : les deux
  -- RPC appelées en dessous doivent passer.
  IF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(v_uid, p_venue_id) OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSE
    IF NOT (p_organizer_user_id = v_uid OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  END IF;
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'Import indisponible en session support';
  END IF;
  IF p_consent_source IS NULL OR p_consent_source NOT IN
     ('in_person','website_form','ticketing','social','other_tool','other') THEN
    RAISE EXCEPTION 'Origine du consentement requise';
  END IF;

  SELECT count(*) INTO v_submitted FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb));
  IF v_submitted > 2000 THEN
    RAISE EXCEPTION 'Maximum 2000 contacts par appel (reçu %)', v_submitted;
  END IF;

  -- 1. La liste (créée au 1er lot, réutilisée ensuite).
  IF p_list_import_id IS NULL THEN
    INSERT INTO public.contact_list_imports
      (venue_id, organizer_user_id, list_name, filename, consent_source, consent_details,
       collected_since, default_country, detected_columns, channels, attested_by)
    VALUES (p_venue_id, p_organizer_user_id,
            NULLIF(left(btrim(COALESCE(p_list_name, '')), 60), ''),
            p_filename, p_consent_source, p_consent_details, p_collected_since,
            p_default_country, COALESCE(p_detected, '{}'::jsonb),
            jsonb_build_object('email', v_want_email, 'sms', v_want_sms), v_uid)
    RETURNING * INTO v_list;
  ELSE
    SELECT * INTO v_list FROM public.contact_list_imports
     WHERE id = p_list_import_id
       AND ((p_venue_id IS NOT NULL AND venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND organizer_user_id = p_organizer_user_id));
    IF NOT FOUND THEN RAISE EXCEPTION 'Import inconnu'; END IF;
    v_want_email := COALESCE((v_list.channels->>'email')::boolean, v_want_email);
    v_want_sms := COALESCE((v_list.channels->>'sms')::boolean, v_want_sms);
  END IF;

  -- 2. Typage défensif de chaque ligne.
  CREATE TEMP TABLE _ucl ON COMMIT DROP AS
  WITH raw AS (
    SELECT x, row_number() OVER () AS ord FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) x
  ), typed AS (
    SELECT ord,
      CASE WHEN lower(btrim(COALESCE(x->>'email',''))) ~ '^[^@\s;,]+@[^@\s;,.]+(\.[^@\s;,.]+)+$'
           THEN lower(btrim(x->>'email')) END AS email,
      CASE WHEN public.normalize_phone_e164(x->>'phone') ~ '^\+[1-9][0-9]{6,14}$'
           THEN public.normalize_phone_e164(x->>'phone') END AS phone,
      NULLIF(left(btrim(COALESCE(x->>'first_name','')), 80), '') AS first_name,
      NULLIF(left(btrim(COALESCE(x->>'last_name','')), 80), '') AS last_name,
      CASE WHEN upper(btrim(COALESCE(x->>'country_code',''))) ~ '^[A-Z]{2}$' THEN upper(btrim(x->>'country_code')) END AS country_code,
      NULLIF(left(btrim(COALESCE(x->>'country','')), 80), '') AS country,
      NULLIF(left(btrim(COALESCE(x->>'region','')), 80), '') AS region,
      NULLIF(left(btrim(COALESCE(x->>'city','')), 80), '') AS city,
      NULLIF(left(btrim(COALESCE(x->>'postal_code','')), 20), '') AS postal_code,
      NULLIF(left(btrim(COALESCE(x->>'zone','')), 80), '') AS zone,
      CASE WHEN COALESCE(x->>'age','') ~ '^[0-9]{1,3}$' AND (x->>'age')::int BETWEEN 12 AND 110 THEN (x->>'age')::int END AS age,
      CASE WHEN x->>'gender' IN ('female','male','other') THEN x->>'gender' END AS gender,
      CASE WHEN x->>'newsletter_opt_in' IN ('true','false') THEN (x->>'newsletter_opt_in')::boolean END AS newsletter_opt_in,
      CASE WHEN COALESCE(x->>'added_at','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (x->>'added_at')::timestamptz END AS added_at,
      CASE WHEN COALESCE(x->>'last_purchase_at','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (x->>'last_purchase_at')::timestamptz END AS last_purchase_at,
      CASE WHEN COALESCE(x->>'total_spent','') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN GREATEST(0, (x->>'total_spent')::numeric) END AS total_spent,
      CASE WHEN COALESCE(x->>'event_count','') ~ '^[0-9]{1,6}$' THEN (x->>'event_count')::int END AS event_count,
      CASE WHEN jsonb_typeof(x->'extra') = 'object' THEN x->'extra' END AS extra
    FROM raw
  )
  SELECT DISTINCT ON (COALESCE(email,''), COALESCE(phone,'')) *
    FROM typed
   WHERE email IS NOT NULL OR phone IS NOT NULL
   ORDER BY COALESCE(email,''), COALESCE(phone,''), ord;

  SELECT count(*), count(*) FILTER (WHERE email IS NOT NULL), count(*) FILTER (WHERE phone IS NOT NULL),
         count(*) FILTER (WHERE email IS NOT NULL AND phone IS NOT NULL)
    INTO v_rows, v_emails, v_phones, v_both FROM _ucl;
  v_invalid := v_submitted - v_rows;

  -- 3. Les lignes typées (idempotent sur une même liste).
  INSERT INTO public.imported_contacts
    (list_import_id, venue_id, organizer_user_id, email, phone_e164, first_name, last_name,
     country_code, country, region, city, postal_code, zone, age, gender, newsletter_opt_in,
     added_at, last_purchase_at, total_spent, event_count, extra)
  SELECT v_list.id, p_venue_id, p_organizer_user_id, u.email, u.phone, u.first_name, u.last_name,
         u.country_code, u.country, u.region, u.city, u.postal_code, u.zone, u.age, u.gender,
         u.newsletter_opt_in, u.added_at, u.last_purchase_at, u.total_spent, u.event_count, u.extra
    FROM _ucl u
  ON CONFLICT (list_import_id, COALESCE(email,''), COALESCE(phone_e164,'')) DO UPDATE
    SET first_name = COALESCE(EXCLUDED.first_name, public.imported_contacts.first_name),
        last_name = COALESCE(EXCLUDED.last_name, public.imported_contacts.last_name),
        country_code = COALESCE(EXCLUDED.country_code, public.imported_contacts.country_code),
        country = COALESCE(EXCLUDED.country, public.imported_contacts.country),
        region = COALESCE(EXCLUDED.region, public.imported_contacts.region),
        city = COALESCE(EXCLUDED.city, public.imported_contacts.city),
        postal_code = COALESCE(EXCLUDED.postal_code, public.imported_contacts.postal_code),
        zone = COALESCE(EXCLUDED.zone, public.imported_contacts.zone),
        age = COALESCE(EXCLUDED.age, public.imported_contacts.age),
        gender = COALESCE(EXCLUDED.gender, public.imported_contacts.gender),
        newsletter_opt_in = COALESCE(EXCLUDED.newsletter_opt_in, public.imported_contacts.newsletter_opt_in),
        added_at = COALESCE(EXCLUDED.added_at, public.imported_contacts.added_at),
        last_purchase_at = COALESCE(EXCLUDED.last_purchase_at, public.imported_contacts.last_purchase_at),
        total_spent = COALESCE(EXCLUDED.total_spent, public.imported_contacts.total_spent),
        event_count = COALESCE(EXCLUDED.event_count, public.imported_contacts.event_count),
        extra = COALESCE(EXCLUDED.extra, public.imported_contacts.extra);

  -- 4. Canal email → la RPC existante (attestation, désabonnés, suppression).
  IF v_want_email AND v_emails > 0 THEN
    SELECT jsonb_agg(jsonb_build_object('email', u.email, 'first_name', u.first_name, 'last_name', u.last_name))
      INTO v_email_payload FROM _ucl u WHERE u.email IS NOT NULL;
    v_email_res := public.import_email_contacts(
      v_email_payload, p_consent_source, p_venue_id, p_organizer_user_id, p_filename,
      p_consent_details, p_collected_since, v_list.email_import_id, p_list_name);
    IF v_list.email_import_id IS NULL THEN
      v_list.email_import_id := (v_email_res->>'import_id')::uuid;
      UPDATE public.contact_list_imports SET email_import_id = v_list.email_import_id WHERE id = v_list.id;
    END IF;
  END IF;

  -- 5. Canal SMS → la RPC existante (liste repoussoir STOP, jamais réabonné).
  IF v_want_sms AND v_phones > 0 THEN
    SELECT jsonb_agg(jsonb_build_object('phone', u.phone, 'first_name', u.first_name, 'last_name', u.last_name))
      INTO v_sms_payload FROM _ucl u WHERE u.phone IS NOT NULL;
    v_sms_res := public.import_sms_contacts(
      v_sms_payload, p_consent_source, p_venue_id, p_organizer_user_id, p_filename,
      p_consent_details, p_collected_since, v_list.sms_import_id, p_list_name, p_default_country);
    IF v_list.sms_import_id IS NULL THEN
      v_list.sms_import_id := (v_sms_res->>'import_id')::uuid;
      UPDATE public.contact_list_imports SET sms_import_id = v_list.sms_import_id WHERE id = v_list.id;
    END IF;
    -- Le contact SMS connaît son email : c'est ce qui relie les deux canaux.
    UPDATE public.venue_sms_contacts vc
       SET email = u.email
      FROM _ucl u
     WHERE vc.import_id = v_list.sms_import_id
       AND vc.phone_e164 = u.phone
       AND u.email IS NOT NULL
       AND vc.email IS NULL;
  END IF;

  UPDATE public.contact_list_imports
     SET row_count = row_count + v_rows,
         email_count = email_count + v_emails,
         phone_count = phone_count + v_phones,
         both_count = both_count + v_both
   WHERE id = v_list.id;

  DROP TABLE IF EXISTS _ucl;

  RETURN jsonb_build_object(
    'list_import_id', v_list.id,
    'email_import_id', v_list.email_import_id,
    'sms_import_id', v_list.sms_import_id,
    'submitted', v_submitted,
    'rows', v_rows,
    'emails', v_emails,
    'phones', v_phones,
    'both', v_both,
    'invalid', v_invalid,
    'email', v_email_res,
    'sms', v_sms_res
  );
END;
$$;
REVOKE ALL ON FUNCTION public.import_contact_list(jsonb, text, text, uuid, text, text, date, uuid, text, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_contact_list(jsonb, text, text, uuid, text, text, date, uuid, text, text, jsonb, jsonb) TO authenticated;

-- ── 8. L'analyse : faits + segments proposés ────────────────────────────────
-- Déterministe et scope-wide : les segments créés valent pour TOUTE la base
-- importée du pro (toutes ses listes), donc les effectifs annoncés sont ceux
-- que le pro obtiendra vraiment à l'envoi. Chaque proposition porte :
--   key (stable, sert à ne pas reproposer ce qui existe), group, definition,
--   contacts / emails / phones (joignables), share, params (pour le libellé et
--   la raison, traduits côté front).
CREATE OR REPLACE FUNCTION public.analyze_contact_lists(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_n integer := 0;
  v_min integer;
  v_lists integer := 0;
  v_cov jsonb;
  v_facts jsonb;
  v_sugs jsonb := '[]'::jsonb;
  v_home_country text;
  v_home_n integer := 0;
  v_zone_field text := 'zone';
  v_spend_top numeric;
  v_spend_median numeric;
  v_cnt_country integer; v_cnt_zone integer; v_cnt_city integer; v_cnt_spent integer;
  v_cnt_events integer; v_cnt_last integer; v_cnt_age integer; v_cnt_gender integer; v_cnt_news integer;
  v_emails integer; v_phones integer; v_both integer; v_email_ok integer; v_phone_ok integer;
  r record;
  v_c integer; v_ce integer; v_cp integer;
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'analyze_contact_lists: exactly one scope required';
  END IF;
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  DROP TABLE IF EXISTS _cr;
  CREATE TEMP TABLE _cr ON COMMIT DROP AS
  SELECT c.*, to_jsonb(c) AS j,
         (c.email IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.newsletter_subscriptions ns
            WHERE lower(ns.email) = c.email AND ns.opted_in
              AND ((p_venue_id IS NOT NULL AND ns.venue_id = p_venue_id)
                OR (p_organizer_user_id IS NOT NULL AND ns.organizer_user_id = p_organizer_user_id)))
          AND NOT public.is_email_suppressed(c.email)) AS email_ok,
         (c.phone_e164 IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.venue_sms_contacts vc
            WHERE vc.phone_e164 = c.phone_e164 AND NOT vc.unsubscribed
              AND vc.sms_consent_at > now() - interval '36 months'
              AND ((p_venue_id IS NOT NULL AND vc.venue_id = p_venue_id)
                OR (p_organizer_user_id IS NOT NULL AND vc.organizer_user_id = p_organizer_user_id)))) AS phone_ok
    FROM public.contact_rows(p_venue_id, p_organizer_user_id) c;

  SELECT count(*) INTO v_n FROM _cr;
  SELECT count(*) INTO v_lists FROM public.contact_list_imports li
   WHERE (p_venue_id IS NOT NULL AND li.venue_id = p_venue_id)
      OR (p_organizer_user_id IS NOT NULL AND li.organizer_user_id = p_organizer_user_id);

  IF v_n = 0 THEN
    RETURN jsonb_build_object('generated_at', now(), 'contacts', 0, 'lists', v_lists, 'suggestions', '[]'::jsonb);
  END IF;

  -- Taille minimale d'un segment proposé : 10 personnes ou 1 % de la base.
  v_min := GREATEST(10, round(v_n * 0.01));

  SELECT count(*) FILTER (WHERE country_code IS NOT NULL),
         count(*) FILTER (WHERE zone IS NOT NULL),
         count(*) FILTER (WHERE city IS NOT NULL),
         count(*) FILTER (WHERE total_spent IS NOT NULL),
         count(*) FILTER (WHERE event_count IS NOT NULL),
         count(*) FILTER (WHERE last_purchase_at IS NOT NULL),
         count(*) FILTER (WHERE age IS NOT NULL),
         count(*) FILTER (WHERE gender IN ('female','male')),
         count(*) FILTER (WHERE newsletter_opt_in IS NOT NULL),
         count(*) FILTER (WHERE email IS NOT NULL),
         count(*) FILTER (WHERE phone_e164 IS NOT NULL),
         count(*) FILTER (WHERE email IS NOT NULL AND phone_e164 IS NOT NULL),
         count(*) FILTER (WHERE email_ok),
         count(*) FILTER (WHERE phone_ok)
    INTO v_cnt_country, v_cnt_zone, v_cnt_city, v_cnt_spent, v_cnt_events, v_cnt_last,
         v_cnt_age, v_cnt_gender, v_cnt_news, v_emails, v_phones, v_both, v_email_ok, v_phone_ok
    FROM _cr;

  v_cov := jsonb_build_object(
    'country', v_cnt_country, 'zone', v_cnt_zone, 'city', v_cnt_city, 'spent', v_cnt_spent,
    'events', v_cnt_events, 'last_purchase', v_cnt_last, 'age', v_cnt_age, 'gender', v_cnt_gender,
    'newsletter', v_cnt_news);

  -- Pays d'attache = le plus fréquent.
  SELECT country_code, count(*) INTO v_home_country, v_home_n
    FROM _cr WHERE country_code IS NOT NULL GROUP BY country_code ORDER BY count(*) DESC LIMIT 1;
  -- Zone : la colonne « zone géographique » si elle est bien remplie, sinon la ville.
  IF v_cnt_zone < GREATEST(v_cnt_city, 1) * 0.6 THEN v_zone_field := 'city'; END IF;

  -- Seuil « meilleurs clients » : 90e percentile des dépenses parmi ceux qui ont payé.
  SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY total_spent),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY total_spent)
    INTO v_spend_top, v_spend_median
    FROM _cr WHERE total_spent > 0;

  v_facts := jsonb_build_object(
    'top_countries', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', code, 'n', n) ORDER BY n DESC)
                       FROM (SELECT country_code AS code, count(*) AS n FROM _cr WHERE country_code IS NOT NULL
                             GROUP BY country_code ORDER BY n DESC LIMIT 8) t), '[]'::jsonb),
    'zone_field', v_zone_field,
    'top_zones', COALESCE((SELECT jsonb_agg(jsonb_build_object('value', v, 'n', n) ORDER BY n DESC)
                   FROM (SELECT CASE WHEN v_zone_field = 'zone' THEN zone ELSE city END AS v, count(*) AS n
                           FROM _cr WHERE (CASE WHEN v_zone_field = 'zone' THEN zone ELSE city END) IS NOT NULL
                          GROUP BY 1 ORDER BY n DESC LIMIT 10) t), '[]'::jsonb),
    'spend', jsonb_build_object(
      'zero', (SELECT count(*) FROM _cr WHERE total_spent = 0),
      'paid', (SELECT count(*) FROM _cr WHERE total_spent > 0),
      'median_paid', round(COALESCE(v_spend_median, 0), 2),
      'top_threshold', round(COALESCE(v_spend_top, 0), 2),
      'total', (SELECT round(COALESCE(sum(total_spent), 0), 2) FROM _cr),
      'tables', (SELECT count(*) FROM _cr WHERE total_spent / NULLIF(event_count, 0) >= 60)),
    'events', jsonb_build_object(
      'one', (SELECT count(*) FROM _cr WHERE event_count = 1),
      'two_three', (SELECT count(*) FROM _cr WHERE event_count BETWEEN 2 AND 3),
      'four_plus', (SELECT count(*) FROM _cr WHERE event_count >= 4)),
    'recency', jsonb_build_object(
      'd90', (SELECT count(*) FROM _cr WHERE last_purchase_at > now() - interval '90 days'),
      'd365', (SELECT count(*) FROM _cr WHERE last_purchase_at <= now() - interval '90 days' AND last_purchase_at > now() - interval '365 days'),
      'older', (SELECT count(*) FROM _cr WHERE last_purchase_at <= now() - interval '365 days')),
    'age', jsonb_build_object(
      'avg', (SELECT round(avg(age), 1) FROM _cr WHERE age IS NOT NULL),
      'b18_21', (SELECT count(*) FROM _cr WHERE age BETWEEN 18 AND 21),
      'b22_25', (SELECT count(*) FROM _cr WHERE age BETWEEN 22 AND 25),
      'b26_30', (SELECT count(*) FROM _cr WHERE age BETWEEN 26 AND 30),
      'b31', (SELECT count(*) FROM _cr WHERE age >= 31)),
    'gender', jsonb_build_object(
      'female', (SELECT count(*) FROM _cr WHERE gender = 'female'),
      'male', (SELECT count(*) FROM _cr WHERE gender = 'male')),
    'newsletter_yes', (SELECT count(*) FROM _cr WHERE newsletter_opt_in = true),
    'channels', jsonb_build_object('emails', v_emails, 'phones', v_phones, 'both', v_both,
                                   'emails_reachable', v_email_ok, 'phones_reachable', v_phone_ok)
  );

  -- ── Candidats ────────────────────────────────────────────────────────────
  DROP TABLE IF EXISTS _cand;
  CREATE TEMP TABLE _cand (ord serial, key text, grp text, def jsonb, params jsonb) ON COMMIT DROP;

  -- Géographie
  IF v_cnt_country >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params)
    SELECT 'geo_country:' || code, 'geo',
           jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'country', 'in', jsonb_build_array(code)))),
           jsonb_build_object('code', code)
      FROM (SELECT country_code AS code, count(*) AS n FROM _cr WHERE country_code IS NOT NULL
             GROUP BY country_code HAVING count(*) >= GREATEST(v_min, v_n * 0.02) ORDER BY n DESC LIMIT 6) t;
    IF v_home_country IS NOT NULL THEN
      INSERT INTO _cand (key, grp, def, params) VALUES
        ('geo_abroad', 'geo',
         jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'country_not', 'in', jsonb_build_array(v_home_country)))),
         jsonb_build_object('home', v_home_country));
    END IF;
  END IF;
  IF GREATEST(v_cnt_zone, v_cnt_city) >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params)
    SELECT 'geo_zone:' || lower(v), 'geo',
           jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', v_zone_field, 'in', jsonb_build_array(v)))),
           jsonb_build_object('zone', v, 'field', v_zone_field)
      FROM (SELECT CASE WHEN v_zone_field = 'zone' THEN zone ELSE city END AS v, count(*) AS n
              FROM _cr WHERE (CASE WHEN v_zone_field = 'zone' THEN zone ELSE city END) IS NOT NULL
             GROUP BY 1 HAVING count(*) >= GREATEST(v_min, v_n * 0.02) ORDER BY n DESC LIMIT 8) t;
  END IF;

  -- Dépenses
  IF v_cnt_spent >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('spend_free', 'spend',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'spent', 'op', 'eq', 'value', 0))),
       '{}'::jsonb),
      ('spend_tickets', 'spend',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'spent', 'op', 'gt', 'value', 0),
         jsonb_build_object('type', 'spent_per_event', 'op', 'lt', 'value', 60))),
       jsonb_build_object('median', round(COALESCE(v_spend_median, 0)))),
      ('spend_tables', 'spend',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'spent_per_event', 'op', 'gte', 'value', 60))),
       jsonb_build_object('threshold', 60));
    IF COALESCE(v_spend_top, 0) > 0 THEN
      INSERT INTO _cand (key, grp, def, params) VALUES
        ('spend_top', 'spend',
         jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'spent', 'op', 'gte', 'value', round(v_spend_top)))),
         jsonb_build_object('threshold', round(v_spend_top)));
    END IF;
  END IF;

  -- Fréquence
  IF v_cnt_events >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('freq_once', 'freq',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'events', 'op', 'eq', 'value', 1))), '{}'::jsonb),
      ('freq_regular', 'freq',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'events', 'op', 'gte', 'value', 2), jsonb_build_object('type', 'events', 'op', 'lte', 'value', 3))), '{}'::jsonb),
      ('freq_loyal', 'freq',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'events', 'op', 'gte', 'value', 4))), '{}'::jsonb);
  END IF;

  -- Récence
  IF v_cnt_last >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('recent_active', 'recency',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'last_purchase_days', 'op', 'lte', 'value', 90))), '{}'::jsonb),
      ('recent_lapsed', 'recency',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'last_purchase_days', 'op', 'gt', 'value', 90), jsonb_build_object('type', 'last_purchase_days', 'op', 'lte', 'value', 365))), '{}'::jsonb),
      ('recent_dormant', 'recency',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'last_purchase_days', 'op', 'gt', 'value', 365))), '{}'::jsonb);
    IF v_cnt_events >= v_n * 0.3 THEN
      INSERT INTO _cand (key, grp, def, params) VALUES
        ('winback_regulars', 'recency',
         jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
           jsonb_build_object('type', 'events', 'op', 'gte', 'value', 2), jsonb_build_object('type', 'last_purchase_days', 'op', 'gt', 'value', 120))), '{}'::jsonb),
        ('new_recent', 'recency',
         jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
           jsonb_build_object('type', 'events', 'op', 'eq', 'value', 1), jsonb_build_object('type', 'last_purchase_days', 'op', 'lte', 'value', 60))), '{}'::jsonb);
    END IF;
  END IF;

  -- Démographie
  IF v_cnt_age >= v_n * 0.4 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('age_18_21', 'demo', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'age', 'min', 18, 'max', 21))), '{}'::jsonb),
      ('age_22_25', 'demo', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'age', 'min', 22, 'max', 25))), '{}'::jsonb),
      ('age_26_30', 'demo', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'age', 'min', 26, 'max', 30))), '{}'::jsonb),
      ('age_31_plus', 'demo', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'age', 'min', 31, 'max', 120))), '{}'::jsonb);
  END IF;
  IF v_cnt_gender >= v_n * 0.4 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('gender_female', 'demo', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'gender', 'in', jsonb_build_array('female')))), '{}'::jsonb),
      ('gender_male', 'demo', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'gender', 'in', jsonb_build_array('male')))), '{}'::jsonb);
  END IF;

  -- Consentement déclaré dans l'ancien outil
  IF v_cnt_news >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('newsletter_yes', 'consent', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'newsletter_opt_in', 'value', true))), '{}'::jsonb);
  END IF;

  -- Canaux
  IF v_phones > 0 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('channel_both', 'channel', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'has_email', 'value', true), jsonb_build_object('type', 'has_phone', 'value', true))), '{}'::jsonb),
      ('channel_sms_only', 'channel', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'has_email', 'value', false), jsonb_build_object('type', 'has_phone', 'value', true))), '{}'::jsonb);
  END IF;

  -- ── Effectifs réels par candidat ─────────────────────────────────────────
  FOR r IN SELECT * FROM _cand ORDER BY ord LOOP
    SELECT count(*), count(*) FILTER (WHERE email_ok), count(*) FILTER (WHERE phone_ok)
      INTO v_c, v_ce, v_cp
      FROM _cr x WHERE public.contact_row_matches(x.j, r.def);
    IF v_c >= v_min THEN
      v_sugs := v_sugs || jsonb_build_object(
        'key', r.key, 'group', r.grp, 'definition', r.def, 'params', r.params,
        'contacts', v_c, 'emails', v_ce, 'phones', v_cp,
        'share', round(v_c::numeric / v_n, 4),
        'existing_id', (SELECT cs.id FROM public.contact_segments cs
                         WHERE cs.suggestion_key = r.key
                           AND ((p_venue_id IS NOT NULL AND cs.venue_id = p_venue_id)
                             OR (p_organizer_user_id IS NOT NULL AND cs.organizer_user_id = p_organizer_user_id))
                         LIMIT 1));
    END IF;
  END LOOP;

  DROP TABLE IF EXISTS _cand;
  DROP TABLE IF EXISTS _cr;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'contacts', v_n,
    'lists', v_lists,
    'min_size', v_min,
    'home_country', v_home_country,
    'coverage', v_cov,
    'facts', v_facts,
    'suggestions', v_sugs
  );
END;
$$;
REVOKE ALL ON FUNCTION public.analyze_contact_lists(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analyze_contact_lists(text, uuid) TO authenticated, service_role;

-- Analyse d'une liste : calcule sur la portée, mémorise sur la ligne de la liste.
CREATE OR REPLACE FUNCTION public.analyze_contact_list_import(p_list_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_list public.contact_list_imports%ROWTYPE; v_res jsonb;
BEGIN
  SELECT * INTO v_list FROM public.contact_list_imports WHERE id = p_list_import_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import inconnu'; END IF;
  IF NOT public.contact_scope_allowed(v_list.venue_id, v_list.organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  v_res := public.analyze_contact_lists(v_list.venue_id, v_list.organizer_user_id);
  UPDATE public.contact_list_imports SET analysis = v_res, analyzed_at = now() WHERE id = p_list_import_id;
  RETURN v_res;
END;
$$;
REVOKE ALL ON FUNCTION public.analyze_contact_list_import(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analyze_contact_list_import(uuid) TO authenticated, service_role;

-- ── 9. Accepter des propositions ────────────────────────────────────────────
-- p_segments : [{key, name, description, definition}] — le nom arrive déjà
-- traduit dans la langue du pro (c'est ce qu'il verra à l'envoi).
CREATE OR REPLACE FUNCTION public.save_contact_segments(
  p_venue_id text, p_organizer_user_id uuid, p_segments jsonb, p_list_import_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  x jsonb; v_id uuid; v_out jsonb := '[]'::jsonb;
  v_name text; v_key text; v_def jsonb; v_desc text;
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'save_contact_segments: exactly one scope required';
  END IF;
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_segments, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'p_segments doit être un tableau';
  END IF;

  FOR x IN SELECT * FROM jsonb_array_elements(p_segments) LOOP
    v_name := NULLIF(left(btrim(COALESCE(x->>'name', '')), 80), '');
    v_key := NULLIF(btrim(COALESCE(x->>'key', '')), '');
    v_desc := NULLIF(left(btrim(COALESCE(x->>'description', '')), 400), '');
    v_def := x->'definition';
    IF v_name IS NULL OR v_def IS NULL OR jsonb_typeof(v_def->'conditions') <> 'array' THEN CONTINUE; END IF;

    -- Même clé de proposition déjà créée : on rafraîchit la définition et le nom.
    v_id := NULL;
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_id FROM public.contact_segments cs
       WHERE cs.suggestion_key = v_key
         AND ((p_venue_id IS NOT NULL AND cs.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND cs.organizer_user_id = p_organizer_user_id))
       LIMIT 1;
    END IF;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM public.contact_segments cs
       WHERE lower(cs.name) = lower(v_name)
         AND ((p_venue_id IS NOT NULL AND cs.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND cs.organizer_user_id = p_organizer_user_id))
       LIMIT 1;
    END IF;

    IF v_id IS NULL THEN
      INSERT INTO public.contact_segments
        (venue_id, organizer_user_id, name, description, definition, origin, suggestion_key, list_import_id, created_by)
      VALUES (p_venue_id, p_organizer_user_id, v_name, v_desc, v_def,
              CASE WHEN v_key IS NULL THEN 'manual' ELSE 'suggested' END, v_key, p_list_import_id, v_uid)
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.contact_segments
         SET name = v_name, description = COALESCE(v_desc, description), definition = v_def,
             suggestion_key = COALESCE(suggestion_key, v_key),
             list_import_id = COALESCE(p_list_import_id, list_import_id)
       WHERE id = v_id;
    END IF;
    v_out := v_out || jsonb_build_object('key', v_key, 'id', v_id, 'name', v_name);
  END LOOP;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.save_contact_segments(text, uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_contact_segments(text, uuid, jsonb, uuid) TO authenticated;

-- ── 10. Vue d'ensemble pour les écrans (listes + segments + dernière analyse) ─
CREATE OR REPLACE FUNCTION public.get_contact_intelligence_overview(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'lists', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'id', li.id, 'list_name', li.list_name, 'filename', li.filename, 'created_at', li.created_at,
                 'row_count', li.row_count, 'email_count', li.email_count, 'phone_count', li.phone_count,
                 'both_count', li.both_count, 'analyzed_at', li.analyzed_at,
                 'email_import_id', li.email_import_id, 'sms_import_id', li.sms_import_id,
                 'detected_columns', li.detected_columns) ORDER BY li.created_at DESC)
               FROM public.contact_list_imports li
              WHERE (p_venue_id IS NOT NULL AND li.venue_id = p_venue_id)
                 OR (p_organizer_user_id IS NOT NULL AND li.organizer_user_id = p_organizer_user_id)), '[]'::jsonb),
    'segments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'id', cs.id, 'name', cs.name, 'description', cs.description, 'definition', cs.definition,
                 'origin', cs.origin, 'suggestion_key', cs.suggestion_key, 'created_at', cs.created_at,
                 'counts', public.count_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition))
                 ORDER BY cs.created_at DESC)
               FROM public.contact_segments cs
              WHERE (p_venue_id IS NOT NULL AND cs.venue_id = p_venue_id)
                 OR (p_organizer_user_id IS NOT NULL AND cs.organizer_user_id = p_organizer_user_id)), '[]'::jsonb),
    'contacts', (SELECT count(*) FROM public.contact_rows(p_venue_id, p_organizer_user_id)),
    'analysis', (SELECT li.analysis FROM public.contact_list_imports li
                  WHERE li.analysis IS NOT NULL
                    AND ((p_venue_id IS NOT NULL AND li.venue_id = p_venue_id)
                      OR (p_organizer_user_id IS NOT NULL AND li.organizer_user_id = p_organizer_user_id))
                  ORDER BY li.analyzed_at DESC LIMIT 1)
  ) INTO v;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.get_contact_intelligence_overview(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contact_intelligence_overview(text, uuid) TO authenticated, service_role;

-- ============================================================================
-- 11. Audience EMAIL : kind {"kind":"contact_segment","segmentId":"<uuid>"}
-- resolve_campaign_audience restatée INTÉGRALEMENT (pattern 20260901103000) ;
-- seules les lignes `cseg` et le WHEN 'contact_segment' changent, dans les
-- DEUX branches. Le JOIN opt-in reste la porte de consentement.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.resolve_campaign_audience(p_campaign_id uuid)
RETURNS TABLE(email text, first_name text, last_name text, user_id uuid, unsubscribe_token uuid)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign RECORD;
  v_is_authorized boolean := false;
  v_audiences jsonb := '[]'::jsonb;
  v_excl_recent_days integer := NULL;
  v_excl_buyers boolean := false;
BEGIN
  SELECT * INTO v_campaign FROM public.email_campaigns WHERE id = p_campaign_id;
  IF v_campaign IS NULL THEN RETURN; END IF;

  IF v_campaign.venue_id IS NOT NULL THEN
    v_is_authorized := public.is_venue_owner(auth.uid(), v_campaign.venue_id) OR public.is_super_admin();
  ELSIF v_campaign.organizer_user_id IS NOT NULL THEN
    v_is_authorized := (v_campaign.organizer_user_id = auth.uid()) OR public.is_super_admin();
  END IF;
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    v_is_authorized := true;
  END IF;
  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF v_campaign.type = 'informational' AND v_campaign.event_id IS NOT NULL THEN
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
    v_excl_recent_days := CASE
      WHEN COALESCE(v_campaign.exclusions_json->>'recentDays', '') ~ '^[0-9]{1,3}$'
      THEN (v_campaign.exclusions_json->>'recentDays')::integer
      ELSE NULL
    END;
    v_excl_buyers := COALESCE(v_campaign.exclusions_json->>'excludeEventBuyers', 'false') IN ('true', 't', '1')
                     AND v_campaign.event_id IS NOT NULL;

    IF v_campaign.venue_id IS NOT NULL THEN
      RETURN QUERY
      WITH seg_emails AS (
        SELECT DISTINCT LOWER(seg.email) AS addr
          FROM jsonb_array_elements(v_audiences) a
          JOIN public.venue_segments vs
            ON a->>'kind' = 'segment'
           AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           AND vs.id = (a->>'segmentId')::uuid
           AND vs.venue_id = v_campaign.venue_id
          CROSS JOIN LATERAL public.resolve_venue_segment(v_campaign.venue_id, vs.definition) seg
      ), cseg AS (
        -- Segments sur la base importée : la définition est résolue à l'envoi.
        SELECT DISTINCT LOWER(r.email) AS addr
          FROM jsonb_array_elements(v_audiences) a
          JOIN public.contact_segments cs
            ON a->>'kind' = 'contact_segment'
           AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           AND cs.id = (a->>'segmentId')::uuid
           AND cs.venue_id = v_campaign.venue_id
          CROSS JOIN LATERAL public.resolve_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition) r
         WHERE r.email IS NOT NULL
      ), subs AS (
        SELECT LOWER(ns.email) AS addr,
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
          LEFT JOIN public.profiles p ON p.id = ns.user_id
         WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true
      ), matched AS (
        SELECT DISTINCT ON (s.addr) s.*
          FROM subs s
         WHERE EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_audiences) a
            WHERE CASE a->>'kind'
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
              WHEN 'segment' THEN s.addr IN (SELECT se.addr FROM seg_emails se)
              WHEN 'contact_segment' THEN s.addr IN (SELECT ce.addr FROM cseg ce)
              WHEN 'import'  THEN s.imp IS NOT NULL
                                  AND s.imp::text = lower(COALESCE(a->>'importId',''))
              ELSE false
            END)
      )
      SELECT m.addr::text, m.fname::text, m.lname::text, m.uid, m.tok
        FROM matched m
       WHERE (v_excl_recent_days IS NULL OR NOT EXISTS (
               SELECT 1 FROM public.email_campaign_recipients r
                 JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
                WHERE c2.venue_id = v_campaign.venue_id
                  AND c2.id <> p_campaign_id
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
      SELECT LOWER(t.user_email) AS addr,
             SUM(t.total_price)::numeric AS spent,
             COUNT(DISTINCT t.event_id) AS visits,
             MAX(t.created_at) AS last_seen,
             MAX(t.full_name) AS full_name
        FROM public.tickets t
        JOIN public.events e ON e.id = t.event_id
       WHERE t.status = 'paid' AND t.user_email IS NOT NULL
         AND (e.organizer_user_id = v_campaign.organizer_user_id
              OR e.partner_organizer_id = v_campaign.organizer_user_id)
       GROUP BY LOWER(t.user_email)
    ), cseg AS (
      SELECT DISTINCT LOWER(r.email) AS addr
        FROM jsonb_array_elements(v_audiences) a
        JOIN public.contact_segments cs
          ON a->>'kind' = 'contact_segment'
         AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND cs.id = (a->>'segmentId')::uuid
         AND cs.organizer_user_id = v_campaign.organizer_user_id
        CROSS JOIN LATERAL public.resolve_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition) r
       WHERE r.email IS NOT NULL
    ), subs AS (
      SELECT LOWER(ns.email) AS addr,
             COALESCE(p.first_name, ns.first_name, SPLIT_PART(COALESCE(a.full_name,''), ' ', 1)) AS fname,
             COALESCE(p.last_name, ns.last_name,
                      NULLIF(REGEXP_REPLACE(COALESCE(a.full_name,''), '^\S+\s*', ''), '')) AS lname,
             ns.user_id AS uid, ns.unsubscribe_token AS tok,
             ns.import_id AS imp,
             COALESCE(a.spent, 0) AS spent,
             COALESCE(a.visits, 0) AS visits,
             a.last_seen AS last_visit
        FROM public.newsletter_subscriptions ns
        LEFT JOIN agg a ON a.addr = LOWER(ns.email)
        LEFT JOIN public.profiles p ON p.id = ns.user_id
       WHERE ns.organizer_user_id = v_campaign.organizer_user_id AND ns.opted_in = true
    ), matched AS (
      SELECT DISTINCT ON (s.addr) s.*
        FROM subs s
       WHERE EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_audiences) a2
          WHERE CASE a2->>'kind'
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
            WHEN 'contact_segment' THEN s.addr IN (SELECT ce.addr FROM cseg ce)
            WHEN 'import'  THEN s.imp IS NOT NULL
                                AND s.imp::text = lower(COALESCE(a2->>'importId',''))
            ELSE false
          END)
    )
    SELECT m.addr::text, m.fname::text, m.lname::text, m.uid, m.tok
      FROM matched m
     WHERE (v_excl_recent_days IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.email_campaign_recipients r
               JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
              WHERE c2.organizer_user_id = v_campaign.organizer_user_id
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

  IF v_campaign.audience_type = 'all_subscribers' THEN
    RETURN QUERY
    SELECT LOWER(ns.email)::text, p.first_name::text, p.last_name::text, ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    LEFT JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.opted_in = true
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
    WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true;
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
      WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true
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
      SELECT LOWER(t.user_email) AS email,
             SUM(t.total_price)::numeric AS spent,
             COUNT(DISTINCT t.event_id) AS visits,
             MAX(t.created_at) AS last_seen,
             MAX(t.full_name) AS full_name
      FROM public.tickets t
      JOIN public.events e ON e.id = t.event_id
      WHERE t.status = 'paid' AND t.user_email IS NOT NULL
        AND (e.organizer_user_id = v_campaign.organizer_user_id OR e.partner_organizer_id = v_campaign.organizer_user_id)
      GROUP BY LOWER(t.user_email)
    )
    SELECT a.email::text,
           SPLIT_PART(COALESCE(a.full_name,''), ' ', 1)::text,
           NULLIF(REGEXP_REPLACE(COALESCE(a.full_name,''), '^\S+\s*', ''), '')::text,
           ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    JOIN agg a ON a.email = LOWER(ns.email)
    WHERE ns.organizer_user_id = v_campaign.organizer_user_id AND ns.opted_in = true
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
$$;
GRANT EXECUTE ON FUNCTION public.resolve_campaign_audience(uuid) TO authenticated, service_role;

-- ============================================================================
-- 12. SMS : segment_type 'contact_segment' + segment_filters.segment_id
-- Ajout d'un paramètre = DROP + CREATE (jamais de surcharge).
-- ============================================================================
DROP FUNCTION IF EXISTS public.resolve_sms_campaign_recipients(text, uuid, text, uuid, uuid);
CREATE FUNCTION public.resolve_sms_campaign_recipients(
  p_venue_id          text,
  p_organizer_user_id uuid,
  p_segment_type      text,
  p_event_id          uuid DEFAULT NULL,
  p_import_id         uuid DEFAULT NULL,
  p_segment_id        uuid DEFAULT NULL
)
RETURNS TABLE(contact_id uuid, phone_e164 text, full_name text, user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'resolve_sms_campaign_recipients: service_role only';
  END IF;
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'resolve_sms_campaign_recipients: exactly one scope required';
  END IF;

  RETURN QUERY
  WITH cseg AS (
    SELECT r.phone_e164 AS ph
      FROM public.contact_segments cs
      CROSS JOIN LATERAL public.resolve_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition) r
     WHERE p_segment_id IS NOT NULL AND cs.id = p_segment_id
       AND ((p_venue_id IS NOT NULL AND cs.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND cs.organizer_user_id = p_organizer_user_id))
       AND r.phone_e164 IS NOT NULL
  )
  SELECT DISTINCT ON (c.phone_e164)
         c.id, c.phone_e164, c.full_name, c.user_id
    FROM public.venue_sms_contacts c
   WHERE NOT c.unsubscribed
     AND c.sms_consent_at > now() - interval '36 months'
     AND c.phone_e164 ~ '^\+[1-9][0-9]{6,14}$'
     AND (
       (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id)
     )
     AND CASE COALESCE(p_segment_type, 'all')
           WHEN 'event'  THEN p_event_id IS NOT NULL AND c.source_event_id = p_event_id
           WHEN 'vip'    THEN c.is_vip
           WHEN 'import' THEN p_import_id IS NOT NULL AND c.import_id = p_import_id
           WHEN 'contact_segment' THEN p_segment_id IS NOT NULL AND c.phone_e164 IN (SELECT ph FROM cseg)
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
$$;
REVOKE ALL ON FUNCTION public.resolve_sms_campaign_recipients(text, uuid, text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_sms_campaign_recipients(text, uuid, text, uuid, uuid, uuid) TO service_role;

DROP FUNCTION IF EXISTS public.count_sms_campaign_recipients(text, uuid, text, uuid, uuid);
CREATE FUNCTION public.count_sms_campaign_recipients(
  p_venue_id          text,
  p_organizer_user_id uuid,
  p_segment_type      text,
  p_event_id          uuid DEFAULT NULL,
  p_import_id         uuid DEFAULT NULL,
  p_segment_id        uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF NOT public.sms_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  WITH cseg AS (
    SELECT r.phone_e164 AS ph
      FROM public.contact_segments cs
      CROSS JOIN LATERAL public.resolve_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition) r
     WHERE p_segment_id IS NOT NULL AND cs.id = p_segment_id
       AND ((p_venue_id IS NOT NULL AND cs.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND cs.organizer_user_id = p_organizer_user_id))
       AND r.phone_e164 IS NOT NULL
  )
  SELECT count(*) INTO v_count
    FROM (
      SELECT DISTINCT c.phone_e164
        FROM public.venue_sms_contacts c
       WHERE NOT c.unsubscribed
         AND c.sms_consent_at > now() - interval '36 months'
         AND c.phone_e164 ~ '^\+[1-9][0-9]{6,14}$'
         AND (
           (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id)
         )
         AND CASE COALESCE(p_segment_type, 'all')
               WHEN 'event'  THEN p_event_id IS NOT NULL AND c.source_event_id = p_event_id
               WHEN 'vip'    THEN c.is_vip
               WHEN 'import' THEN p_import_id IS NOT NULL AND c.import_id = p_import_id
               WHEN 'contact_segment' THEN p_segment_id IS NOT NULL AND c.phone_e164 IN (SELECT ph FROM cseg)
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
    ) d;
  RETURN COALESCE(v_count, 0);
END;
$$;
REVOKE ALL ON FUNCTION public.count_sms_campaign_recipients(text, uuid, text, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_sms_campaign_recipients(text, uuid, text, uuid, uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enqueue_sms_campaign_recipients(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c        public.sms_campaigns%ROWTYPE;
  v_seg    text;
  v_event  uuid;
  v_import uuid;
  v_segid  uuid;
  v_total  integer;
  v_pending integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'enqueue_sms_campaign_recipients: service_role only';
  END IF;
  SELECT * INTO c FROM public.sms_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign not found'; END IF;

  v_seg    := COALESCE(c.segment_filters->>'type', 'all');
  v_event  := COALESCE(c.event_id, NULLIF(c.segment_filters->>'event_id', '')::uuid);
  v_import := NULLIF(c.segment_filters->>'import_id', '')::uuid;
  v_segid  := CASE WHEN COALESCE(c.segment_filters->>'segment_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   THEN (c.segment_filters->>'segment_id')::uuid END;

  INSERT INTO public.sms_campaign_recipients (campaign_id, contact_id, user_id, phone_e164, full_name, lang)
  SELECT p_campaign_id, r.contact_id, r.user_id, r.phone_e164, r.full_name,
         COALESCE(pr.preferred_language, 'fr')
    FROM public.resolve_sms_campaign_recipients(c.venue_id, c.organizer_id, v_seg, v_event, v_import, v_segid) r
    LEFT JOIN public.profiles pr ON pr.id = r.user_id
  ON CONFLICT (campaign_id, phone_e164) DO NOTHING;

  SELECT count(*), count(*) FILTER (WHERE status = 'pending')
    INTO v_total, v_pending
    FROM public.sms_campaign_recipients WHERE campaign_id = p_campaign_id;

  UPDATE public.sms_campaigns
     SET total_recipients = v_total, estimated_recipients = v_total
   WHERE id = p_campaign_id;

  RETURN jsonb_build_object('total', v_total, 'pending', v_pending);
END;
$$;
