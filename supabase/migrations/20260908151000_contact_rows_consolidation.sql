-- ───────────────────────────────────────────────────────────────────────────
-- Consolidation d'une personne présente plusieurs fois dans la base importée.
--
-- `contact_rows` garde UNE ligne par identité (email, sinon numéro). Deux
-- lignes créées dans la même seconde (même fichier, ou deux fichiers importés
-- à la suite) départageaient sur l'uuid — donc au hasard — et pouvaient
-- retenir la ligne la plus pauvre (celle sans zone, sans dépenses). À date
-- égale, la ligne la plus RENSEIGNÉE gagne ; entre deux dates, la plus
-- récente gagne toujours (un export plus frais fait foi).
--
-- Les compteurs de `contact_list_imports` sont désormais RECOMPTÉS depuis
-- `imported_contacts` après chaque lot : un ré-import idempotent de la même
-- liste ne gonfle plus `row_count`.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.contact_rows(p_venue_id text, p_organizer_user_id uuid)
RETURNS SETOF public.imported_contacts
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT ON (COALESCE(c.email, c.phone_e164)) c.*
    FROM public.imported_contacts c
   WHERE (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
      OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id)
   ORDER BY COALESCE(c.email, c.phone_e164),
            c.created_at DESC,
            ((c.phone_e164 IS NOT NULL)::int + (c.total_spent IS NOT NULL)::int + (c.event_count IS NOT NULL)::int
             + (c.last_purchase_at IS NOT NULL)::int + (c.zone IS NOT NULL)::int + (c.city IS NOT NULL)::int
             + (c.country_code IS NOT NULL)::int + (c.age IS NOT NULL)::int + (c.gender IS NOT NULL)::int) DESC,
            c.id;
$$;

-- import_contact_list restatée : (1) dédoublonnage par IDENTITÉ (email, sinon
-- numéro) en gardant la ligne la plus riche du lot ; (2) effectifs de la liste
-- recomptés depuis imported_contacts au lieu d'être cumulés.
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
  SELECT DISTINCT ON (COALESCE(email, phone)) *
    FROM typed
   WHERE email IS NOT NULL OR phone IS NOT NULL
   ORDER BY COALESCE(email, phone),
            ((phone IS NOT NULL)::int + (total_spent IS NOT NULL)::int + (event_count IS NOT NULL)::int
             + (last_purchase_at IS NOT NULL)::int + (zone IS NOT NULL)::int + (city IS NOT NULL)::int) DESC,
            ord;

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

  -- Effectifs RECOMPTÉS depuis les lignes stockées : un ré-import idempotent
  -- de la même liste ne gonfle jamais les compteurs.
  UPDATE public.contact_list_imports li
     SET row_count = s.n, email_count = s.e, phone_count = s.p, both_count = s.b
    FROM (SELECT count(*) AS n,
                 count(*) FILTER (WHERE email IS NOT NULL) AS e,
                 count(*) FILTER (WHERE phone_e164 IS NOT NULL) AS p,
                 count(*) FILTER (WHERE email IS NOT NULL AND phone_e164 IS NOT NULL) AS b
            FROM public.imported_contacts WHERE list_import_id = v_list.id) s
   WHERE li.id = v_list.id;

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
