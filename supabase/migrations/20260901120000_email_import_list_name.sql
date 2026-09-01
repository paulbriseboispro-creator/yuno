-- ───────────────────────────────────────────────────────────────────────────
-- Nommer sa liste au moment de l'import.
--
-- Depuis 20260901103000, chaque fichier importé est un segment d'audience à
-- part entière. Il s'affichait sous son nom de FICHIER — « woh-2-acheteurs-
-- sans-optin-10759 » n'est pas un nom de segment, c'est un nom d'export. Le
-- pro donne maintenant son propre nom au moment où il dépose le fichier, et
-- c'est ce nom qu'il retrouve à l'envoi.
--
-- • `email_list_imports.list_name` (60 caractères max) — le nom du pro.
-- • `filename` reste intact : c'est une pièce du dossier de consentement, pas
--   une étiquette d'affichage. On ajoute une étiquette, on ne réécrit pas la
--   preuve.
-- • Le front retombe sur le nom de fichier quand `list_name` est vide : les
--   imports d'avant ce jour restent lisibles sans reprise de données.
-- • `import_email_contacts` : DROP + CREATE avec `p_list_name` en DERNIER
--   paramètre. Pas de CREATE OR REPLACE — une signature différente créerait
--   une SURCHARGE, et un appel à 8 arguments nommés deviendrait ambigu
--   (erreur 300, déjà vécue en 20260827110200). Le nom n'est lu qu'au 1er lot,
--   celui qui crée la ligne d'import : un fichier = un nom, pas cinq.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.email_list_imports
  ADD COLUMN IF NOT EXISTS list_name text;

ALTER TABLE public.email_list_imports
  DROP CONSTRAINT IF EXISTS email_list_imports_list_name_check;
ALTER TABLE public.email_list_imports
  ADD CONSTRAINT email_list_imports_list_name_check
  CHECK (list_name IS NULL OR char_length(btrim(list_name)) BETWEEN 1 AND 60);

-- DROP + CREATE dans la MÊME migration : la transaction ne laisse aucune
-- fenêtre où la fonction n'existe pas.
DROP FUNCTION IF EXISTS public.import_email_contacts(jsonb, text, text, uuid, text, text, date, uuid);

CREATE OR REPLACE FUNCTION public.import_email_contacts(
  p_contacts jsonb,
  p_consent_source text,
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL,
  p_filename text DEFAULT NULL,
  p_consent_details text DEFAULT NULL,
  p_collected_since date DEFAULT NULL,
  p_import_id uuid DEFAULT NULL,
  p_list_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_import_id uuid := p_import_id;
  v_uid uuid := auth.uid();
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
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'import_email_contacts: fournir p_venue_id OU p_organizer_user_id';
  END IF;

  -- 2. Autorisation.
  IF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(v_uid, p_venue_id) OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSE
    IF NOT (p_organizer_user_id = v_uid OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  END IF;

  -- 3. Jamais depuis une session support.
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'Import indisponible en session support';
  END IF;

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
       collected_since, attested_by, list_name)
    VALUES (p_venue_id, p_organizer_user_id, p_filename, p_consent_source,
            p_consent_details, p_collected_since, v_uid,
            NULLIF(btrim(COALESCE(p_list_name, '')), ''))
    RETURNING id INTO v_import_id;
  ELSE
    PERFORM 1 FROM public.email_list_imports
     WHERE id = v_import_id
       AND ((p_venue_id IS NOT NULL AND venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND organizer_user_id = p_organizer_user_id));
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
  --    explicite n'est jamais réactivé par un import.
  IF p_venue_id IS NOT NULL THEN
    WITH up AS (
      INSERT INTO public.newsletter_subscriptions
        (venue_id, email, opted_in, source, import_id, consent_source, consent_recorded_at,
         first_name, last_name)
      SELECT p_venue_id, i.addr, true, 'import', v_import_id, p_consent_source, now(),
             i.fname, i.lname
        FROM _in i
       WHERE i.valid AND NOT public.is_email_suppressed(i.addr)
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
  ELSE
    WITH up AS (
      INSERT INTO public.newsletter_subscriptions
        (organizer_user_id, email, opted_in, source, import_id, consent_source, consent_recorded_at,
         first_name, last_name)
      SELECT p_organizer_user_id, i.addr, true, 'import', v_import_id, p_consent_source, now(),
             i.fname, i.lname
        FROM _in i
       WHERE i.valid AND NOT public.is_email_suppressed(i.addr)
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
$$;

REVOKE ALL ON FUNCTION public.import_email_contacts(jsonb, text, text, uuid, text, text, date, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_email_contacts(jsonb, text, text, uuid, text, text, date, uuid, text) TO authenticated;
