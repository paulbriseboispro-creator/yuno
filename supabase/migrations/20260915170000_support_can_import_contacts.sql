-- Import de listes de contacts DEPUIS une session support (décision de lancement)
-- ============================================================================
--
-- POURQUOI ce relâchement, et pourquoi il est temporaire.
--
-- Les premiers testeurs sont méfiants et pressés. On leur demande d'importer
-- eux-mêmes leur fichier de contacts : beaucoup ne le feront jamais, et le
-- lancement attend derrière. Le support Yuno le fait donc POUR eux, dans la
-- session assistée que le pro a lui-même approuvée.
--
-- Ce que ce relâchement ne touche PAS : rien des règles de consentement.
-- L'attestation d'origine reste obligatoire, un désabonné explicite n'est
-- toujours jamais réactivé, le repoussoir `email_opt_outs` et le repoussoir
-- STOP des SMS tiennent. Restent aussi bloqués en session support : l'envoi
-- d'une campagne (edge `send-campaign`), la purge et l'export d'une liste.
-- Le support remplit la matière ; il ne parle à personne à la place du pro.
--
-- Ce que ça coûte, et comment on le paie. `auth.uid()` dans une session
-- support, c'est le PRO : sans rien d'autre, la ligne d'import dirait que le
-- pro a attesté lui-même l'origine de sa liste. C'est le dossier qu'on
-- montrerait à la CNIL ; il doit dire vrai. D'où deux traces :
--   1. `attested_via_support` sur les trois tables d'import,
--   2. le journal d'accès assisté (`log_support_session_write`), qui nomme
--      l'admin réel, la session et le grant.
--
-- À RETIRER après le lancement : remettre le `RAISE EXCEPTION 'Import
-- indisponible en session support'` en tête des trois fonctions. Les colonnes
-- et les triggers d'audit, eux, peuvent rester.

-- 1. La trace sur la ligne d'import ------------------------------------------

ALTER TABLE public.email_list_imports
  ADD COLUMN IF NOT EXISTS attested_via_support boolean NOT NULL DEFAULT false;
ALTER TABLE public.sms_list_imports
  ADD COLUMN IF NOT EXISTS attested_via_support boolean NOT NULL DEFAULT false;
ALTER TABLE public.contact_list_imports
  ADD COLUMN IF NOT EXISTS attested_via_support boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.email_list_imports.attested_via_support IS
  'Import saisi par le support Yuno dans une session assistée (attested_by = le pro).';
COMMENT ON COLUMN public.sms_list_imports.attested_via_support IS
  'Import saisi par le support Yuno dans une session assistée (attested_by = le pro).';
COMMENT ON COLUMN public.contact_list_imports.attested_via_support IS
  'Import saisi par le support Yuno dans une session assistée (attested_by = le pro).';

-- 2. Les trois portes d'import ------------------------------------------------
--    Corps repris de l'état LIVE (pg_get_functiondef) : seul le garde change.

CREATE OR REPLACE FUNCTION public.import_email_contacts(p_contacts jsonb, p_consent_source text, p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_filename text DEFAULT NULL::text, p_consent_details text DEFAULT NULL::text, p_collected_since date DEFAULT NULL::date, p_import_id uuid DEFAULT NULL::uuid, p_list_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_import_id uuid := p_import_id;
  v_uid uuid := auth.uid();
  v_via_support boolean := public.is_support_session();
  v_submitted integer := 0;
  v_valid integer := 0;
  v_invalid integer := 0;
  v_dupes integer := 0;
  v_suppressed integer := 0;
  v_inserted integer := 0;
  v_reactivated integer := 0;
  v_optout integer := 0;
BEGIN
  -- 1. Périmètre : exactement un propriétaire.
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'import_email_contacts: une seule portée à la fois';
  END IF;

  -- 2. Autorisation.
  IF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(v_uid, p_venue_id) OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    IF NOT (p_organizer_user_id = v_uid OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSE
    -- Portée plateforme : la base marketing de Yuno elle-même.
    IF NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  END IF;

  -- Session support : AUTORISÉE (décision de lancement, voir CLAUDE.md).
  -- Elle n'est pas silencieuse pour autant : `attested_by` porte l'uid du PRO
  -- (la session est la sienne), donc sans drapeau le dossier de consentement
  -- dirait que le pro a attesté lui-même. `attested_via_support` dit qui a
  -- vraiment saisi, et le trigger d'audit nomme l'admin.

  IF p_consent_source IS NULL OR p_consent_source NOT IN
     ('in_person','website_form','ticketing','social','other_tool','other') THEN
    RAISE EXCEPTION 'Origine du consentement requise';
  END IF;

  SELECT count(*) INTO v_submitted
    FROM jsonb_array_elements(COALESCE(p_contacts, '[]'::jsonb));
  IF v_submitted > 2000 THEN
    RAISE EXCEPTION 'Maximum 2000 contacts par appel (reçu %)', v_submitted;
  END IF;

  -- 4. Ligne d'import (créée au 1er lot, réutilisée par les suivants).
  IF v_import_id IS NULL THEN
    INSERT INTO public.email_list_imports
      (venue_id, organizer_user_id, filename, consent_source, consent_details,
       collected_since, attested_by, attested_via_support, list_name)
    VALUES (p_venue_id, p_organizer_user_id, p_filename, p_consent_source,
            p_consent_details, p_collected_since, v_uid, v_via_support,
            NULLIF(btrim(COALESCE(p_list_name, '')), ''))
    RETURNING id INTO v_import_id;
  ELSE
    PERFORM 1 FROM public.email_list_imports
     WHERE id = v_import_id
       AND public.marketing_scope_match(venue_id, organizer_user_id, p_venue_id, p_organizer_user_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'Import inconnu'; END IF;
  END IF;

  -- 5. Normalisation + dédoublonnage intra-fichier + validation.
  CREATE TEMP TABLE _in ON COMMIT DROP AS
  WITH raw AS (
    SELECT lower(btrim(COALESCE(x->>'email',''))) AS addr,
           NULLIF(btrim(COALESCE(x->>'first_name','')), '') AS fname,
           NULLIF(btrim(COALESCE(x->>'last_name','')), '')  AS lname,
           row_number() OVER () AS ord
      FROM jsonb_array_elements(COALESCE(p_contacts, '[]'::jsonb)) x
  )
  SELECT DISTINCT ON (addr) addr, fname, lname,
         addr ~ '^[^@\s;,]+@[^@\s;,.]+(\.[^@\s;,.]+)+$' AS valid
    FROM raw
   ORDER BY addr, ord;

  SELECT count(*) FILTER (WHERE valid),
         count(*) FILTER (WHERE NOT valid)
    INTO v_valid, v_invalid FROM _in;
  v_dupes := v_submitted - (v_valid + v_invalid);

  SELECT count(*) INTO v_suppressed
    FROM _in WHERE valid AND public.is_email_suppressed(addr);

  -- 6. Écriture. Le WHERE du DO UPDATE est la règle n°2 : un désabonné
  --    explicite n'est jamais réactivé par un import. Le NOT EXISTS sur
  --    email_opt_outs prolonge la règle APRÈS une purge : la ligne désabonnée
  --    n'existe plus, c'est le repoussoir qui se souvient.
  IF p_venue_id IS NOT NULL THEN
    WITH up AS (
      INSERT INTO public.newsletter_subscriptions
        (venue_id, email, opted_in, source, import_id, consent_source, consent_recorded_at,
         first_name, last_name)
      SELECT p_venue_id, i.addr, true, 'import', v_import_id, p_consent_source, now(),
             i.fname, i.lname
        FROM _in i
       WHERE i.valid AND NOT public.is_email_suppressed(i.addr)
         AND NOT EXISTS (SELECT 1 FROM public.email_opt_outs o
                          WHERE lower(o.email) = i.addr
                            AND public.marketing_scope_match(o.venue_id, o.organizer_user_id, p_venue_id, p_organizer_user_id))
      ON CONFLICT (lower(email), venue_id) WHERE venue_id IS NOT NULL DO UPDATE
        SET opted_in = true,
            import_id = EXCLUDED.import_id,
            consent_source = COALESCE(public.newsletter_subscriptions.consent_source, EXCLUDED.consent_source),
            consent_recorded_at = COALESCE(public.newsletter_subscriptions.consent_recorded_at, EXCLUDED.consent_recorded_at),
            first_name = COALESCE(EXCLUDED.first_name, public.newsletter_subscriptions.first_name),
            last_name = COALESCE(EXCLUDED.last_name, public.newsletter_subscriptions.last_name),
            updated_at = now()
        WHERE public.newsletter_subscriptions.opted_out_at IS NULL
          AND public.newsletter_subscriptions.opted_in = false
      RETURNING (xmax = 0) AS is_insert
    )
    SELECT count(*) FILTER (WHERE is_insert),
           count(*) FILTER (WHERE NOT is_insert)
      INTO v_inserted, v_reactivated FROM up;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    WITH up AS (
      INSERT INTO public.newsletter_subscriptions
        (organizer_user_id, email, opted_in, source, import_id, consent_source, consent_recorded_at,
         first_name, last_name)
      SELECT p_organizer_user_id, i.addr, true, 'import', v_import_id, p_consent_source, now(),
             i.fname, i.lname
        FROM _in i
       WHERE i.valid AND NOT public.is_email_suppressed(i.addr)
         AND NOT EXISTS (SELECT 1 FROM public.email_opt_outs o
                          WHERE lower(o.email) = i.addr
                            AND public.marketing_scope_match(o.venue_id, o.organizer_user_id, p_venue_id, p_organizer_user_id))
      ON CONFLICT (lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL DO UPDATE
        SET opted_in = true,
            import_id = EXCLUDED.import_id,
            consent_source = COALESCE(public.newsletter_subscriptions.consent_source, EXCLUDED.consent_source),
            consent_recorded_at = COALESCE(public.newsletter_subscriptions.consent_recorded_at, EXCLUDED.consent_recorded_at),
            first_name = COALESCE(EXCLUDED.first_name, public.newsletter_subscriptions.first_name),
            last_name = COALESCE(EXCLUDED.last_name, public.newsletter_subscriptions.last_name),
            updated_at = now()
        WHERE public.newsletter_subscriptions.opted_out_at IS NULL
          AND public.newsletter_subscriptions.opted_in = false
      RETURNING (xmax = 0) AS is_insert
    )
    SELECT count(*) FILTER (WHERE is_insert),
           count(*) FILTER (WHERE NOT is_insert)
      INTO v_inserted, v_reactivated FROM up;
  ELSE
    -- Portée plateforme. Arbitre = l'index PARTIEL uniq_newsletter_subs_email_platform.
    WITH up AS (
      INSERT INTO public.newsletter_subscriptions
        (venue_id, organizer_user_id, email, opted_in, source, import_id, consent_source,
         consent_recorded_at, first_name, last_name)
      SELECT NULL, NULL, i.addr, true, 'platform:import', v_import_id, p_consent_source, now(),
             i.fname, i.lname
        FROM _in i
       WHERE i.valid AND NOT public.is_email_suppressed(i.addr)
         AND NOT EXISTS (SELECT 1 FROM public.email_opt_outs o
                          WHERE lower(o.email) = i.addr
                            AND public.marketing_scope_match(o.venue_id, o.organizer_user_id, p_venue_id, p_organizer_user_id))
      ON CONFLICT (lower(email)) WHERE venue_id IS NULL AND organizer_user_id IS NULL DO UPDATE
        SET opted_in = true,
            import_id = EXCLUDED.import_id,
            consent_source = COALESCE(public.newsletter_subscriptions.consent_source, EXCLUDED.consent_source),
            consent_recorded_at = COALESCE(public.newsletter_subscriptions.consent_recorded_at, EXCLUDED.consent_recorded_at),
            first_name = COALESCE(EXCLUDED.first_name, public.newsletter_subscriptions.first_name),
            last_name = COALESCE(EXCLUDED.last_name, public.newsletter_subscriptions.last_name),
            updated_at = now()
        WHERE public.newsletter_subscriptions.opted_out_at IS NULL
          AND public.newsletter_subscriptions.opted_in = false
      RETURNING (xmax = 0) AS is_insert
    )
    SELECT count(*) FILTER (WHERE is_insert),
           count(*) FILTER (WHERE NOT is_insert)
      INTO v_inserted, v_reactivated FROM up;
  END IF;

  -- Ce que le DO UPDATE n'a pas touché : déjà abonné actif, ou désabonné
  -- explicite qu'on respecte. On les compte pour le rapport d'import.
  v_optout := GREATEST(0, (v_valid - v_suppressed) - (v_inserted + v_reactivated));

  UPDATE public.email_list_imports
     SET submitted_count = submitted_count + v_submitted,
         inserted_count = inserted_count + v_inserted,
         reactivated_count = reactivated_count + v_reactivated,
         duplicate_count = duplicate_count + v_dupes,
         invalid_count = invalid_count + v_invalid,
         suppressed_count = suppressed_count + v_suppressed,
         unchanged_count = unchanged_count + v_optout
   WHERE id = v_import_id;

  DROP TABLE IF EXISTS _in;

  RETURN jsonb_build_object(
    'import_id', v_import_id,
    'submitted', v_submitted,
    'valid', v_valid,
    'invalid', v_invalid,
    'duplicates', v_dupes,
    'suppressed', v_suppressed,
    'inserted', v_inserted,
    'reactivated', v_reactivated,
    'unchanged', v_optout
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_sms_contacts(p_contacts jsonb, p_consent_source text, p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_filename text DEFAULT NULL::text, p_consent_details text DEFAULT NULL::text, p_collected_since date DEFAULT NULL::date, p_import_id uuid DEFAULT NULL::uuid, p_list_name text DEFAULT NULL::text, p_default_country text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_import_id uuid := p_import_id;
  v_uid uuid := auth.uid();
  v_via_support boolean := public.is_support_session();
  v_submitted integer := 0;
  v_valid integer := 0;
  v_invalid integer := 0;
  v_dupes integer := 0;
  v_suppressed integer := 0;
  v_inserted integer := 0;
  v_unchanged integer := 0;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'import_sms_contacts: une seule portée à la fois';
  END IF;
  IF NOT public.sms_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  -- Session support : AUTORISÉE (décision de lancement, voir CLAUDE.md).
  -- Elle n'est pas silencieuse pour autant : `attested_by` porte l'uid du PRO
  -- (la session est la sienne), donc sans drapeau le dossier de consentement
  -- dirait que le pro a attesté lui-même. `attested_via_support` dit qui a
  -- vraiment saisi, et le trigger d'audit nomme l'admin.
  IF p_consent_source IS NULL OR p_consent_source NOT IN
     ('in_person','website_form','ticketing','social','other_tool','other') THEN
    RAISE EXCEPTION 'Origine du consentement requise';
  END IF;

  SELECT count(*) INTO v_submitted FROM jsonb_array_elements(COALESCE(p_contacts, '[]'::jsonb));
  IF v_submitted > 2000 THEN
    RAISE EXCEPTION 'Maximum 2000 contacts par appel (reçu %)', v_submitted;
  END IF;

  IF v_import_id IS NULL THEN
    INSERT INTO public.sms_list_imports
      (venue_id, organizer_user_id, filename, list_name, consent_source, consent_details,
       collected_since, default_country, attested_by, attested_via_support)
    VALUES (p_venue_id, p_organizer_user_id, p_filename,
            NULLIF(left(btrim(COALESCE(p_list_name, '')), 60), ''),
            p_consent_source, p_consent_details, p_collected_since, p_default_country, v_uid, v_via_support)
    RETURNING id INTO v_import_id;
  ELSE
    PERFORM 1 FROM public.sms_list_imports
     WHERE id = v_import_id
       AND public.marketing_scope_match(venue_id, organizer_user_id, p_venue_id, p_organizer_user_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'Import inconnu'; END IF;
  END IF;

  -- Normalisation + dédoublonnage intra-fichier + validation.
  CREATE TEMP TABLE _sms_in ON COMMIT DROP AS
  WITH raw AS (
    SELECT public.normalize_phone_e164(COALESCE(x->>'phone','')) AS phone,
           NULLIF(btrim(COALESCE(x->>'first_name','')), '') AS fname,
           NULLIF(btrim(COALESCE(x->>'last_name','')), '')  AS lname,
           row_number() OVER () AS ord
      FROM jsonb_array_elements(COALESCE(p_contacts, '[]'::jsonb)) x
  )
  SELECT DISTINCT ON (COALESCE(phone, 'invalid-' || ord::text))
         phone, fname, lname,
         phone IS NOT NULL AND phone ~ '^\+[1-9][0-9]{6,14}$' AS valid
    FROM raw
   ORDER BY COALESCE(phone, 'invalid-' || ord::text), ord;

  SELECT count(*) FILTER (WHERE valid), count(*) FILTER (WHERE NOT valid)
    INTO v_valid, v_invalid FROM _sms_in;
  v_dupes := v_submitted - (v_valid + v_invalid);

  -- Liste repoussoir : un numéro qui a répondu STOP ou s'est retiré, où que ce
  -- soit chez ce pro, n'est jamais réabonné par un import. Un STOP est global
  -- (le numéro d'envoi est partagé) : on regarde toutes les portées.
  CREATE TEMP TABLE _sms_block ON COMMIT DROP AS
  SELECT DISTINCT i.phone
    FROM _sms_in i
   WHERE i.valid AND EXISTS (
     SELECT 1 FROM public.venue_sms_contacts c
      WHERE c.phone_e164 = i.phone AND c.unsubscribed
   );
  SELECT count(*) INTO v_suppressed FROM _sms_block;

  IF p_venue_id IS NOT NULL THEN
    WITH ins AS (
      INSERT INTO public.venue_sms_contacts
        (venue_id, organizer_user_id, phone_e164, full_name, sms_consent_at, consent_source, import_id, is_vip)
      SELECT p_venue_id, NULL, i.phone,
             btrim(concat_ws(' ', i.fname, i.lname)),
             now(), 'import', v_import_id, false
        FROM _sms_in i
       WHERE i.valid AND i.phone NOT IN (SELECT phone FROM _sms_block)
      ON CONFLICT (venue_id, phone_e164) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_inserted FROM ins;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    WITH ins AS (
      INSERT INTO public.venue_sms_contacts
        (venue_id, organizer_user_id, phone_e164, full_name, sms_consent_at, consent_source, import_id, is_vip)
      SELECT NULL, p_organizer_user_id, i.phone,
             btrim(concat_ws(' ', i.fname, i.lname)),
             now(), 'import', v_import_id, false
        FROM _sms_in i
       WHERE i.valid AND i.phone NOT IN (SELECT phone FROM _sms_block)
      ON CONFLICT (organizer_user_id, phone_e164) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_inserted FROM ins;
  ELSE
    -- Portée plateforme : l'arbitre est l'index PARTIEL posé par
    -- 20260908210000. Sans le WHERE, Postgres ne le reconnaît pas (42P10).
    WITH ins AS (
      INSERT INTO public.venue_sms_contacts
        (venue_id, organizer_user_id, phone_e164, full_name, sms_consent_at, consent_source, import_id, is_vip)
      SELECT NULL, NULL, i.phone,
             btrim(concat_ws(' ', i.fname, i.lname)),
             now(), 'import', v_import_id, false
        FROM _sms_in i
       WHERE i.valid AND i.phone NOT IN (SELECT phone FROM _sms_block)
      ON CONFLICT (phone_e164) WHERE venue_id IS NULL AND organizer_user_id IS NULL DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_inserted FROM ins;
  END IF;

  -- Déjà présents (consentement checkout ou import antérieur) : on ne touche à
  -- rien, la preuve d'origine reste la première.
  v_unchanged := GREATEST(0, (v_valid - v_suppressed) - v_inserted);

  UPDATE public.sms_list_imports
     SET submitted_count = submitted_count + v_submitted,
         inserted_count = inserted_count + v_inserted,
         duplicate_count = duplicate_count + v_dupes,
         invalid_count = invalid_count + v_invalid,
         suppressed_count = suppressed_count + v_suppressed,
         unchanged_count = unchanged_count + v_unchanged
   WHERE id = v_import_id;

  DROP TABLE IF EXISTS _sms_in;
  DROP TABLE IF EXISTS _sms_block;

  RETURN jsonb_build_object(
    'import_id', v_import_id,
    'submitted', v_submitted,
    'valid', v_valid,
    'invalid', v_invalid,
    'duplicates', v_dupes,
    'suppressed', v_suppressed,
    'inserted', v_inserted,
    'unchanged', v_unchanged
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_contact_list(p_rows jsonb, p_consent_source text, p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_filename text DEFAULT NULL::text, p_consent_details text DEFAULT NULL::text, p_collected_since date DEFAULT NULL::date, p_list_import_id uuid DEFAULT NULL::uuid, p_list_name text DEFAULT NULL::text, p_default_country text DEFAULT NULL::text, p_channels jsonb DEFAULT '{"sms": true, "email": true}'::jsonb, p_detected jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_via_support boolean := public.is_support_session();
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
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'import_contact_list: une seule portée à la fois';
  END IF;
  -- Même autorisation que l'import email (le plus strict des deux) : les deux
  -- RPC appelées en dessous doivent passer.
  IF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(v_uid, p_venue_id) OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    IF NOT (p_organizer_user_id = v_uid OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSE
    IF NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  END IF;
  -- Session support : AUTORISÉE (décision de lancement, voir CLAUDE.md).
  -- Elle n'est pas silencieuse pour autant : `attested_by` porte l'uid du PRO
  -- (la session est la sienne), donc sans drapeau le dossier de consentement
  -- dirait que le pro a attesté lui-même. `attested_via_support` dit qui a
  -- vraiment saisi, et le trigger d'audit nomme l'admin.
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
       collected_since, default_country, detected_columns, channels, attested_by, attested_via_support)
    VALUES (p_venue_id, p_organizer_user_id,
            NULLIF(left(btrim(COALESCE(p_list_name, '')), 60), ''),
            p_filename, p_consent_source, p_consent_details, p_collected_since,
            p_default_country, COALESCE(p_detected, '{}'::jsonb),
            jsonb_build_object('email', v_want_email, 'sms', v_want_sms), v_uid, v_via_support)
    RETURNING * INTO v_list;
  ELSE
    SELECT * INTO v_list FROM public.contact_list_imports
     WHERE id = p_list_import_id
       AND public.marketing_scope_match(venue_id, organizer_user_id, p_venue_id, p_organizer_user_id);
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
$function$;

-- 3. Le journal d'accès assisté ------------------------------------------------
--    Le même trigger que les soirées et les guest lists : une ligne par import
--    créé pendant une session support, avec l'admin qui l'a fait. On le pose
--    sur les seules lignes d'EN-TÊTE — jamais sur newsletter_subscriptions ni
--    venue_sms_contacts, où un fichier de 2 000 adresses écrirait 2 000 lignes
--    de journal et noierait le reste.

DROP TRIGGER IF EXISTS trg_support_log_email_list_imports ON public.email_list_imports;
CREATE TRIGGER trg_support_log_email_list_imports
  AFTER INSERT OR UPDATE OR DELETE ON public.email_list_imports
  FOR EACH ROW EXECUTE FUNCTION public.log_support_session_write();

DROP TRIGGER IF EXISTS trg_support_log_sms_list_imports ON public.sms_list_imports;
CREATE TRIGGER trg_support_log_sms_list_imports
  AFTER INSERT OR UPDATE OR DELETE ON public.sms_list_imports
  FOR EACH ROW EXECUTE FUNCTION public.log_support_session_write();

DROP TRIGGER IF EXISTS trg_support_log_contact_list_imports ON public.contact_list_imports;
CREATE TRIGGER trg_support_log_contact_list_imports
  AFTER INSERT OR UPDATE OR DELETE ON public.contact_list_imports
  FOR EACH ROW EXECUTE FUNCTION public.log_support_session_write();
