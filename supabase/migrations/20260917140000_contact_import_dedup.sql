-- Import de contacts : relier les imports entre eux, refuser les doublons
-- ============================================================================
--
-- Ce qu'on répare (constaté sur le compte organisateur WOH, 17/09/2026) :
--
--   1er sept.  deux fichiers importés séparément (10 759 « acheteurs » +
--              317 « abonnés newsletter ») par l'ancien import email.
--   8 sept.    le MÊME public réimporté d'un seul fichier de 12 315 adresses,
--              par l'import unifié.
--
-- Personne n'a été dupliqué — `newsletter_subscriptions` est unique par portée
-- et par adresse — mais l'ATTRIBUTION s'est fragmentée : la clause
-- `ON CONFLICT … DO UPDATE … WHERE opted_in = false` de `import_email_contacts`
-- ne retouche jamais un abonné déjà actif, donc les 11 076 personnes déjà
-- présentes sont restées rattachées aux deux anciens fichiers. La liste
-- « MAILING INTELLIGENT », qui porte les 12 315 adresses du fichier, n'en
-- possédait que 1 239. Un pro qui la choisit comme audience touche 1 239
-- personnes en croyant en toucher 12 315 : un manque de 90 %, silencieux.
--
-- Ce que cette migration pose :
--
--   1. `fingerprint` — l'empreinte du fichier (nombre + md5 de ses identités
--      triées) sur les trois tables d'import. Deux fichiers identiques ont la
--      même empreinte, quel que soit l'ordre des lignes.
--   2. `superseded_by` / `superseded_at` — une liste vidée par un import plus
--      récent n'est pas détruite (c'est une pièce du dossier de consentement)
--      mais RETIRÉE : elle sort des panneaux, garde son attestation.
--   3. `check_contact_import()` — l'avis AVANT écriture : ce fichier est-il
--      déjà importé, et combien de ses contacts appartiennent déjà à quelle
--      liste. C'est ce que le dialogue d'import montre au pro.
--   4. `contact_import_absorb()` — la fusion : la nouvelle liste prend la
--      propriété de TOUTES ses identités, les listes laissées vides sont
--      retirées, et les campagnes en brouillon qui les visaient sont
--      recâblées sur la liste qui les remplace (sans ça, un brouillon
--      partirait à zéro destinataire sans le dire).
--   5. `import_contact_list()` gagne `p_mode` et `p_final` : au dernier lot,
--      le serveur calcule l'empreinte lui-même et absorbe si le fichier est
--      un doublon exact — la garantie ne dépend pas du client.
--   6. Les compteurs de WOH remis d'aplomb par ce même chemin.
--
-- Ce qui ne bouge pas : aucune règle de consentement. La fusion déplace un
-- rattachement de liste, jamais un opt-in, jamais une date d'attestation,
-- jamais un désabonnement.

-- ── 1. Colonnes ─────────────────────────────────────────────────────────────

ALTER TABLE public.email_list_imports
  ADD COLUMN IF NOT EXISTS fingerprint text,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.email_list_imports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

ALTER TABLE public.sms_list_imports
  ADD COLUMN IF NOT EXISTS fingerprint text,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.sms_list_imports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

ALTER TABLE public.contact_list_imports
  ADD COLUMN IF NOT EXISTS fingerprint text,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.contact_list_imports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

COMMENT ON COLUMN public.email_list_imports.fingerprint IS
  'Empreinte du fichier : nombre d''adresses + md5 de leur liste triée. Deux imports de même empreinte sont le même fichier.';
COMMENT ON COLUMN public.email_list_imports.superseded_by IS
  'Liste qui a absorbé celle-ci. La ligne survit (dossier de consentement) mais ne s''affiche plus.';

CREATE INDEX IF NOT EXISTS idx_email_list_imports_fingerprint
  ON public.email_list_imports (fingerprint) WHERE fingerprint IS NOT NULL AND superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_sms_list_imports_fingerprint
  ON public.sms_list_imports (fingerprint) WHERE fingerprint IS NOT NULL AND superseded_by IS NULL;

-- ── 2. L'empreinte ──────────────────────────────────────────────────────────
-- Un fichier est identifié par l'ENSEMBLE de ses identités, pas par son nom ni
-- par son ordre : « 12315:<md5> ». Le nombre en préfixe évite qu'une collision
-- md5 suffise, et rend l'empreinte lisible à l'œil dans une requête d'audit.

CREATE OR REPLACE FUNCTION public.contact_fingerprint(p_values text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN count(*) = 0 THEN NULL
              ELSE count(*)::text || ':' || md5(string_agg(v, ',' ORDER BY v)) END
    FROM (SELECT DISTINCT lower(btrim(x)) AS v
            FROM unnest(COALESCE(p_values, '{}'::text[])) x
           WHERE btrim(COALESCE(x, '')) <> '') s;
$$;

COMMENT ON FUNCTION public.contact_fingerprint(text[]) IS
  'Empreinte d''un ensemble d''identités : « n:md5 ». Insensible à l''ordre et aux doublons.';

-- ── 3. La fusion ────────────────────────────────────────────────────────────
-- La nouvelle liste prend la propriété de toutes les identités de son fichier.
-- Les listes qu'elle vide sont retirées, jamais supprimées. Interne : appelée
-- par `import_contact_list` et par les correctifs de données.

CREATE OR REPLACE FUNCTION public.contact_import_absorb(p_list_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_list public.contact_list_imports%ROWTYPE;
  v_prev uuid[];
  v_id uuid;
  v_emails integer := 0;
  v_phones integer := 0;
  v_retired_email uuid[] := '{}'::uuid[];
  v_retired_sms uuid[] := '{}'::uuid[];
BEGIN
  SELECT * INTO v_list FROM public.contact_list_imports WHERE id = p_list_import_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('emails_moved', 0, 'phones_moved', 0,
                              'retired_email_lists', '[]'::jsonb, 'retired_sms_lists', '[]'::jsonb);
  END IF;

  -- ── Emails ──
  IF v_list.email_import_id IS NOT NULL THEN
    -- Qui possédait ces adresses avant nous ? (avant de bouger quoi que ce soit)
    SELECT COALESCE(array_agg(DISTINCT s.import_id), '{}'::uuid[]) INTO v_prev
      FROM public.newsletter_subscriptions s
     WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, v_list.venue_id, v_list.organizer_user_id)
       AND s.import_id IS NOT NULL
       AND s.import_id <> v_list.email_import_id
       AND EXISTS (SELECT 1 FROM public.imported_contacts c
                    WHERE c.list_import_id = p_list_import_id
                      AND c.email IS NOT NULL AND lower(c.email) = lower(s.email));

    WITH moved AS (
      UPDATE public.newsletter_subscriptions s
         SET import_id = v_list.email_import_id, updated_at = now()
       WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, v_list.venue_id, v_list.organizer_user_id)
         AND s.import_id IS DISTINCT FROM v_list.email_import_id
         AND EXISTS (SELECT 1 FROM public.imported_contacts c
                      WHERE c.list_import_id = p_list_import_id
                        AND c.email IS NOT NULL AND lower(c.email) = lower(s.email))
      RETURNING 1
    )
    SELECT count(*) INTO v_emails FROM moved;

    FOREACH v_id IN ARRAY v_prev LOOP
      IF NOT EXISTS (SELECT 1 FROM public.newsletter_subscriptions WHERE import_id = v_id) THEN
        UPDATE public.email_list_imports
           SET superseded_by = v_list.email_import_id, superseded_at = now()
         WHERE id = v_id AND superseded_by IS NULL;
        IF FOUND THEN v_retired_email := v_retired_email || v_id; END IF;
      END IF;
    END LOOP;
  END IF;

  -- ── Numéros ──
  IF v_list.sms_import_id IS NOT NULL THEN
    SELECT COALESCE(array_agg(DISTINCT vc.import_id), '{}'::uuid[]) INTO v_prev
      FROM public.venue_sms_contacts vc
     WHERE public.marketing_scope_match(vc.venue_id, vc.organizer_user_id, v_list.venue_id, v_list.organizer_user_id)
       AND vc.import_id IS NOT NULL
       AND vc.import_id <> v_list.sms_import_id
       AND EXISTS (SELECT 1 FROM public.imported_contacts c
                    WHERE c.list_import_id = p_list_import_id
                      AND c.phone_e164 IS NOT NULL AND c.phone_e164 = vc.phone_e164);

    WITH moved AS (
      UPDATE public.venue_sms_contacts vc
         SET import_id = v_list.sms_import_id
       WHERE public.marketing_scope_match(vc.venue_id, vc.organizer_user_id, v_list.venue_id, v_list.organizer_user_id)
         AND vc.import_id IS DISTINCT FROM v_list.sms_import_id
         AND EXISTS (SELECT 1 FROM public.imported_contacts c
                      WHERE c.list_import_id = p_list_import_id
                        AND c.phone_e164 IS NOT NULL AND c.phone_e164 = vc.phone_e164)
      RETURNING 1
    )
    SELECT count(*) INTO v_phones FROM moved;

    FOREACH v_id IN ARRAY v_prev LOOP
      IF NOT EXISTS (SELECT 1 FROM public.venue_sms_contacts WHERE import_id = v_id) THEN
        UPDATE public.sms_list_imports
           SET superseded_by = v_list.sms_import_id, superseded_at = now()
         WHERE id = v_id AND superseded_by IS NULL;
        IF FOUND THEN v_retired_sms := v_retired_sms || v_id; END IF;
      END IF;
    END LOOP;
  END IF;

  -- La liste unifiée d'où venaient ces fichiers suit ses deux canaux : elle est
  -- retirée quand elle n'a plus aucun canal vivant.
  UPDATE public.contact_list_imports li
     SET superseded_by = p_list_import_id, superseded_at = now()
   WHERE li.id <> p_list_import_id
     AND li.superseded_by IS NULL
     AND (li.email_import_id IS NULL OR li.email_import_id = ANY(v_retired_email))
     AND (li.sms_import_id IS NULL OR li.sms_import_id = ANY(v_retired_sms))
     AND (li.email_import_id IS NOT NULL OR li.sms_import_id IS NOT NULL);

  -- Un brouillon qui visait une liste retirée partirait à zéro destinataire
  -- sans rien dire : on le recâble sur la liste qui la remplace.
  IF array_length(v_retired_email, 1) > 0 THEN
    UPDATE public.email_campaigns ec
       SET audiences_json = (
             SELECT COALESCE(jsonb_agg(DISTINCT CASE
                      WHEN el->>'kind' = 'import' AND (el->>'importId')::uuid = ANY(v_retired_email)
                        THEN jsonb_build_object('kind', 'import', 'importId', v_list.email_import_id::text)
                      ELSE el END), '[]'::jsonb)
               FROM jsonb_array_elements(ec.audiences_json) el)
     WHERE public.marketing_scope_match(ec.venue_id, ec.organizer_user_id, v_list.venue_id, v_list.organizer_user_id)
       AND ec.status IN ('draft', 'scheduled')
       AND jsonb_typeof(ec.audiences_json) = 'array'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(ec.audiences_json) el
                    WHERE el->>'kind' = 'import'
                      AND (el->>'importId') ~ '^[0-9a-f-]{36}$'
                      AND (el->>'importId')::uuid = ANY(v_retired_email));
  END IF;

  RETURN jsonb_build_object(
    'emails_moved', v_emails,
    'phones_moved', v_phones,
    'retired_email_lists', to_jsonb(v_retired_email),
    'retired_sms_lists', to_jsonb(v_retired_sms));
END;
$$;

REVOKE ALL ON FUNCTION public.contact_import_absorb(uuid) FROM PUBLIC, anon, authenticated;

-- ── 4. L'avis avant écriture ────────────────────────────────────────────────
-- Le dialogue d'import a déjà lu le fichier ; il envoie les identités (et rien
-- d'autre) et reçoit le verdict : fichier déjà importé ? combien de ces
-- contacts sont déjà à vous, et dans quelle liste ? Rien n'est écrit.

CREATE OR REPLACE FUNCTION public.check_contact_import(
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL,
  p_emails text[] DEFAULT '{}'::text[],
  p_phones text[] DEFAULT '{}'::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_fp_email text;
  v_fp_phone text;
  v_emails integer := 0;
  v_phones integer := 0;
  v_known_emails integer := 0;
  v_known_phones integer := 0;
  v_dup jsonb := NULL;
  v_overlaps jsonb := '[]'::jsonb;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'check_contact_import: une seule portée à la fois';
  END IF;
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

  IF COALESCE(array_length(p_emails, 1), 0) + COALESCE(array_length(p_phones, 1), 0) > 200000 THEN
    RAISE EXCEPTION 'Fichier trop grand pour la vérification';
  END IF;

  DROP TABLE IF EXISTS _chk_e;
  DROP TABLE IF EXISTS _chk_p;

  CREATE TEMP TABLE _chk_e ON COMMIT DROP AS
    SELECT DISTINCT lower(btrim(x)) AS e
      FROM unnest(COALESCE(p_emails, '{}'::text[])) x
     WHERE lower(btrim(COALESCE(x, ''))) ~ '^[^@\s;,]+@[^@\s;,.]+(\.[^@\s;,.]+)+$';

  CREATE TEMP TABLE _chk_p ON COMMIT DROP AS
    SELECT DISTINCT public.normalize_phone_e164(x) AS p
      FROM unnest(COALESCE(p_phones, '{}'::text[])) x
     WHERE public.normalize_phone_e164(x) ~ '^\+[1-9][0-9]{6,14}$';

  SELECT count(*) INTO v_emails FROM _chk_e;
  SELECT count(*) INTO v_phones FROM _chk_p;
  SELECT public.contact_fingerprint(array_agg(e)) INTO v_fp_email FROM _chk_e;
  SELECT public.contact_fingerprint(array_agg(p)) INTO v_fp_phone FROM _chk_p;

  SELECT count(*) INTO v_known_emails
    FROM _chk_e c
   WHERE EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                  WHERE lower(s.email) = c.e
                    AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id));

  SELECT count(*) INTO v_known_phones
    FROM _chk_p c
   WHERE EXISTS (SELECT 1 FROM public.venue_sms_contacts vc
                  WHERE vc.phone_e164 = c.p
                    AND public.marketing_scope_match(vc.venue_id, vc.organizer_user_id, p_venue_id, p_organizer_user_id));

  -- Doublon exact : une liste vivante de la portée porte la même empreinte.
  -- L'email fait foi quand le fichier en contient ; sinon le numéro.
  IF v_fp_email IS NOT NULL THEN
    SELECT jsonb_build_object('channel', 'email', 'import_id', i.id, 'list_name', i.list_name,
                              'filename', i.filename, 'created_at', i.created_at, 'size', v_emails)
      INTO v_dup
      FROM public.email_list_imports i
     WHERE public.marketing_scope_match(i.venue_id, i.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND i.superseded_by IS NULL AND i.fingerprint = v_fp_email
     ORDER BY i.created_at DESC LIMIT 1;
  END IF;
  IF v_dup IS NULL AND v_fp_email IS NULL AND v_fp_phone IS NOT NULL THEN
    SELECT jsonb_build_object('channel', 'sms', 'import_id', i.id, 'list_name', i.list_name,
                              'filename', i.filename, 'created_at', i.created_at, 'size', v_phones)
      INTO v_dup
      FROM public.sms_list_imports i
     WHERE public.marketing_scope_match(i.venue_id, i.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND i.superseded_by IS NULL AND i.fingerprint = v_fp_phone
     ORDER BY i.created_at DESC LIMIT 1;
  END IF;

  -- Recouvrement liste par liste, les deux canaux ensemble.
  WITH e AS (
    SELECT i.id, 'email'::text AS channel, i.list_name, i.filename, i.created_at,
           (SELECT count(*) FROM public.newsletter_subscriptions s WHERE s.import_id = i.id) AS size,
           (SELECT count(*) FROM public.newsletter_subscriptions s
             JOIN _chk_e c ON c.e = lower(s.email) WHERE s.import_id = i.id) AS shared
      FROM public.email_list_imports i
     WHERE public.marketing_scope_match(i.venue_id, i.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND i.superseded_by IS NULL
  ), s AS (
    SELECT i.id, 'sms'::text AS channel, i.list_name, i.filename, i.created_at,
           (SELECT count(*) FROM public.venue_sms_contacts vc WHERE vc.import_id = i.id) AS size,
           (SELECT count(*) FROM public.venue_sms_contacts vc
             JOIN _chk_p c ON c.p = vc.phone_e164 WHERE vc.import_id = i.id) AS shared
      FROM public.sms_list_imports i
     WHERE public.marketing_scope_match(i.venue_id, i.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND i.superseded_by IS NULL
  ), all_lists AS (
    SELECT * FROM e UNION ALL SELECT * FROM s
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'import_id', id, 'channel', channel, 'list_name', list_name, 'filename', filename,
           'created_at', created_at, 'size', size, 'shared', shared
         ) ORDER BY shared DESC, created_at DESC), '[]'::jsonb)
    INTO v_overlaps
    FROM (SELECT * FROM all_lists WHERE shared > 0 ORDER BY shared DESC LIMIT 8) x;

  DROP TABLE IF EXISTS _chk_e;
  DROP TABLE IF EXISTS _chk_p;

  RETURN jsonb_build_object(
    'emails', v_emails,
    'phones', v_phones,
    'known_emails', v_known_emails,
    'known_phones', v_known_phones,
    'new_emails', v_emails - v_known_emails,
    'new_phones', v_phones - v_known_phones,
    'fingerprint_email', v_fp_email,
    'fingerprint_phone', v_fp_phone,
    'duplicate_of', v_dup,
    'overlaps', v_overlaps);
END;
$$;

REVOKE ALL ON FUNCTION public.check_contact_import(text, uuid, text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_contact_import(text, uuid, text[], text[]) TO authenticated;

-- ── 5. L'import unifié : mode de fusion + garantie serveur ──────────────────
-- Deux paramètres nouveaux :
--   `p_mode`  'append' (défaut, le comportement d'avant : la nouvelle liste ne
--             réclame que les contacts qu'elle apporte) ou 'merge' (elle prend
--             la propriété de tout son fichier — le choix du pro quand le
--             dialogue lui a montré le recouvrement).
--   `p_final` posé sur le DERNIER lot. C'est là que le serveur calcule
--             l'empreinte à partir de ce qu'il a réellement reçu et absorbe
--             si le fichier est un doublon exact d'une liste déjà présente.
--             La garantie ne dépend donc pas du client : un import refait à
--             l'identique ne crée jamais une seconde liste.
--
-- Ajouter un paramètre = DROP + CREATE. Un CREATE OR REPLACE poserait une
-- SURCHARGE, et les appels à arguments nommés des bundles déjà déployés
-- deviendraient ambigus (erreur 300).
DROP FUNCTION IF EXISTS public.import_contact_list(jsonb, text, text, uuid, text, text, date, uuid, text, text, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.import_contact_list(
  p_rows jsonb,
  p_consent_source text,
  p_venue_id text DEFAULT NULL::text,
  p_organizer_user_id uuid DEFAULT NULL::uuid,
  p_filename text DEFAULT NULL::text,
  p_consent_details text DEFAULT NULL::text,
  p_collected_since date DEFAULT NULL::date,
  p_list_import_id uuid DEFAULT NULL::uuid,
  p_list_name text DEFAULT NULL::text,
  p_default_country text DEFAULT NULL::text,
  p_channels jsonb DEFAULT '{"sms": true, "email": true}'::jsonb,
  p_detected jsonb DEFAULT NULL::jsonb,
  p_mode text DEFAULT 'append'::text,
  p_final boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  v_mode text := CASE WHEN lower(COALESCE(p_mode, 'append')) = 'merge' THEN 'merge' ELSE 'append' END;
  v_fp_email text; v_fp_phone text; v_fp_all text;
  v_twin uuid := NULL;
  v_absorb jsonb := NULL;
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

  -- 6. Dernier lot : empreintes, doublon exact, fusion.
  IF p_final THEN
    SELECT public.contact_fingerprint(array_agg(c.email) FILTER (WHERE c.email IS NOT NULL)),
           public.contact_fingerprint(array_agg(c.phone_e164) FILTER (WHERE c.phone_e164 IS NOT NULL)),
           public.contact_fingerprint(array_agg(COALESCE(c.email, '') || '|' || COALESCE(c.phone_e164, '')))
      INTO v_fp_email, v_fp_phone, v_fp_all
      FROM public.imported_contacts c WHERE c.list_import_id = v_list.id;

    UPDATE public.contact_list_imports SET fingerprint = v_fp_all WHERE id = v_list.id;
    IF v_list.email_import_id IS NOT NULL THEN
      UPDATE public.email_list_imports SET fingerprint = v_fp_email WHERE id = v_list.email_import_id;
    END IF;
    IF v_list.sms_import_id IS NOT NULL THEN
      UPDATE public.sms_list_imports SET fingerprint = v_fp_phone WHERE id = v_list.sms_import_id;
    END IF;

    -- Le jumeau : une liste vivante de la portée qui porte la même empreinte.
    -- L'email fait foi quand le fichier en contient ; sinon le numéro.
    IF v_fp_email IS NOT NULL THEN
      SELECT i.id INTO v_twin FROM public.email_list_imports i
       WHERE public.marketing_scope_match(i.venue_id, i.organizer_user_id, p_venue_id, p_organizer_user_id)
         AND i.superseded_by IS NULL AND i.fingerprint = v_fp_email
         AND i.id <> COALESCE(v_list.email_import_id, '00000000-0000-0000-0000-000000000000'::uuid)
       ORDER BY i.created_at LIMIT 1;
    ELSIF v_fp_phone IS NOT NULL THEN
      SELECT i.id INTO v_twin FROM public.sms_list_imports i
       WHERE public.marketing_scope_match(i.venue_id, i.organizer_user_id, p_venue_id, p_organizer_user_id)
         AND i.superseded_by IS NULL AND i.fingerprint = v_fp_phone
         AND i.id <> COALESCE(v_list.sms_import_id, '00000000-0000-0000-0000-000000000000'::uuid)
       ORDER BY i.created_at LIMIT 1;
    END IF;

    -- Doublon exact = fusion d'office : le fichier qui vient d'arriver porte la
    -- donnée la plus fraîche, il prend la liste ; l'ancienne est retirée sans
    -- être détruite. Un import refait à l'identique ne crée donc jamais une
    -- seconde liste, même si le client n'a pas demandé la vérification.
    IF v_twin IS NOT NULL OR v_mode = 'merge' THEN
      v_absorb := public.contact_import_absorb(v_list.id);
    END IF;
  END IF;

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
    'sms', v_sms_res,
    'mode', v_mode,
    'duplicate_of', v_twin,
    'absorbed', v_absorb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_contact_list(jsonb, text, text, uuid, text, text, date, uuid, text, text, jsonb, jsonb, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_contact_list(jsonb, text, text, uuid, text, text, date, uuid, text, text, jsonb, jsonb, text, boolean) TO authenticated;

-- ── 6. Les panneaux ne montrent plus une liste retirée ──────────────────────
-- Trois surfaces listent des imports : « Listes importées » de l'écran
-- Audience (email), l'onglet SMS, et la page Contacts (listes unifiées).
-- Une liste absorbée garde sa ligne — c'est une pièce du dossier de
-- consentement — mais elle n'est plus une cible : elle disparaît des trois.
CREATE OR REPLACE FUNCTION public.get_email_lists_health(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'get_email_lists_health: une seule portée à la fois';
  END IF;
  IF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), p_venue_id) OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    IF NOT (p_organizer_user_id = auth.uid() OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  WITH imports AS (
    SELECT i.id, i.filename, i.list_name, i.created_at
      FROM public.email_list_imports i
     WHERE public.marketing_scope_match(i.venue_id, i.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND i.superseded_by IS NULL
     ORDER BY i.created_at DESC
     LIMIT 50
  ),
  subs AS (
    SELECT s.import_id,
           count(*) AS total,
           count(*) FILTER (WHERE s.opted_in AND s.opted_out_at IS NULL AND NOT public.is_email_suppressed(s.email)) AS active,
           count(*) FILTER (WHERE public.is_email_suppressed(s.email)) AS dead,
           count(*) FILTER (WHERE NOT public.is_email_suppressed(s.email) AND (NOT s.opted_in OR s.opted_out_at IS NOT NULL)) AS unsubscribed
      FROM public.newsletter_subscriptions s
     WHERE s.import_id IN (SELECT id FROM imports)
     GROUP BY s.import_id
  ),
  purged AS (
    SELECT o.import_id, count(*) AS n
      FROM public.email_opt_outs o
     WHERE o.import_id IN (SELECT id FROM imports)
     GROUP BY o.import_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'import_id', i.id,
           'filename', i.filename,
           'list_name', i.list_name,
           'created_at', i.created_at,
           'total', COALESCE(s.total, 0),
           'active', COALESCE(s.active, 0),
           'unsubscribed', COALESCE(s.unsubscribed, 0),
           'dead', COALESCE(s.dead, 0),
           'purged', COALESCE(p.n, 0)
         ) ORDER BY i.created_at DESC), '[]'::jsonb)
    INTO v_out
    FROM imports i
    LEFT JOIN subs s ON s.import_id = i.id
    LEFT JOIN purged p ON p.import_id = i.id;
  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_sms_contacts_overview(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT public.sms_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  WITH base AS (
    SELECT c.*
      FROM public.venue_sms_contacts c
     WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
  ),
  live AS (
    SELECT * FROM base
     WHERE NOT unsubscribed AND sms_consent_at > now() - interval '36 months'
  ),
  per_event AS (
    SELECT l.source_event_id AS event_id, e.title, e.start_at, count(DISTINCT l.phone_e164) AS n
      FROM live l JOIN public.events e ON e.id = l.source_event_id
     GROUP BY l.source_event_id, e.title, e.start_at
     ORDER BY e.start_at DESC
     LIMIT 12
  ),
  imports AS (
    SELECT li.id, li.list_name, li.filename, li.created_at,
           (SELECT count(DISTINCT l.phone_e164) FROM live l WHERE l.import_id = li.id) AS n
      FROM public.sms_list_imports li
     WHERE public.marketing_scope_match(li.venue_id, li.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND li.superseded_by IS NULL
     ORDER BY li.created_at DESC
     LIMIT 24
  )
  SELECT jsonb_build_object(
    'active',       (SELECT count(DISTINCT phone_e164) FROM live),
    'vip',          (SELECT count(DISTINCT phone_e164) FROM live WHERE is_vip),
    'last_30d',     (SELECT count(DISTINCT phone_e164) FROM live WHERE sms_consent_at > now() - interval '30 days'),
    'imported',     (SELECT count(DISTINCT phone_e164) FROM live WHERE import_id IS NOT NULL),
    'unsubscribed', (SELECT count(*) FROM base WHERE unsubscribed),
    'events',       COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'event_id', event_id, 'title', title, 'start_at', start_at, 'contacts', n
                      )) FROM per_event), '[]'::jsonb),
    'imports',      COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'id', id, 'list_name', list_name, 'filename', filename, 'created_at', created_at, 'contacts', n
                      )) FROM imports), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_contact_intelligence_overview(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer := 0;
  v_segs jsonb := '[]'::jsonb;
  v_key text := COALESCE('v:' || p_venue_id, 'o:' || p_organizer_user_id::text, 'p');
  v_refreshed timestamptz;
  v_eng jsonb; v_orig jsonb; v_reach integer; v_reach_sms integer;
  r record;
  c_n integer; c_e integer; c_p integer;
BEGIN
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT s.refreshed_at INTO v_refreshed FROM public.contact_engagement_state s WHERE s.scope_key = v_key;

  v_n := public.contact_build_rows(p_venue_id, p_organizer_user_id);

  FOR r IN
    SELECT cs.* FROM public.contact_segments cs
     WHERE public.marketing_scope_match(cs.venue_id, cs.organizer_user_id, p_venue_id, p_organizer_user_id)
     ORDER BY cs.created_at DESC
  LOOP
    EXECUTE format('SELECT count(*), count(*) FILTER (WHERE c.email_ok), count(*) FILTER (WHERE c.phone_ok) FROM _cr c WHERE %s',
                   public.contact_definition_predicate(r.definition, 'c'))
      INTO c_n, c_e, c_p;
    v_segs := v_segs || jsonb_build_object(
      'id', r.id, 'name', r.name, 'description', r.description, 'definition', r.definition,
      'origin', r.origin, 'suggestion_key', r.suggestion_key, 'created_at', r.created_at,
      'counts', jsonb_build_object('contacts', COALESCE(c_n,0), 'emails', COALESCE(c_e,0), 'phones', COALESCE(c_p,0)));
  END LOOP;

  SELECT jsonb_build_object(
           'active', count(*) FILTER (WHERE eng_status = 'active'),
           'passive', count(*) FILTER (WHERE eng_status = 'passive'),
           'silent', count(*) FILTER (WHERE eng_status = 'silent'),
           'new', count(*) FILTER (WHERE eng_status = 'new'),
           'unreachable', count(*) FILTER (WHERE eng_status = 'unreachable'),
           'unsubscribed', count(*) FILTER (WHERE eng_status = 'unsubscribed'),
           'sent_any', count(*) FILTER (WHERE emails_sent > 0)),
         jsonb_build_object(
           'import', count(*) FILTER (WHERE origin = 'import'),
           'yuno', count(*) FILTER (WHERE origin = 'yuno'),
           'both', count(*) FILTER (WHERE origin = 'both'),
           'with_account', count(*) FILTER (WHERE has_account)),
         count(*) FILTER (WHERE email_ok),
         count(*) FILTER (WHERE phone_ok)
    INTO v_eng, v_orig, v_reach, v_reach_sms
    FROM _cr;
  DROP TABLE IF EXISTS _cr;

  RETURN jsonb_build_object(
    'lists', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'id', li.id, 'list_name', li.list_name, 'filename', li.filename, 'created_at', li.created_at,
                 'row_count', li.row_count, 'email_count', li.email_count, 'phone_count', li.phone_count,
                 'both_count', li.both_count, 'analyzed_at', li.analyzed_at,
                 'email_import_id', li.email_import_id, 'sms_import_id', li.sms_import_id,
                 'detected_columns', li.detected_columns) ORDER BY li.created_at DESC)
               FROM public.contact_list_imports li
              WHERE public.marketing_scope_match(li.venue_id, li.organizer_user_id, p_venue_id, p_organizer_user_id)
                AND li.superseded_by IS NULL), '[]'::jsonb),
    'segments', v_segs,
    'contacts', v_n,
    'reachable_emails', COALESCE(v_reach, 0),
    'reachable_phones', COALESCE(v_reach_sms, 0),
    'engagement', v_eng,
    'origin', v_orig,
    'refreshed_at', v_refreshed,
    'impacts', COALESCE((
      SELECT jsonb_agg(x.obj ORDER BY x.sent_at DESC) FROM (
        SELECT ec.sent_at, jsonb_build_object(
                 'campaign_id', i.campaign_id, 'name', ec.name, 'subject', ec.subject, 'sent_at', ec.sent_at,
                 'recipients', ec.recipients_count, 'opens', ec.opens_count, 'clickers', ec.clickers_count,
                 'unsubscribes', ec.unsubscribes_count, 'bounced', ec.bounced_count, 'complained', ec.complained_count,
                 'baseline', i.baseline, 'baseline_at', i.baseline_at, 'current', i.current, 'computed_at', i.computed_at) AS obj
          FROM public.email_campaign_list_impact i
          JOIN public.email_campaigns ec ON ec.id = i.campaign_id
         WHERE public.marketing_scope_match(i.venue_id, i.organizer_user_id, p_venue_id, p_organizer_user_id)
           AND ec.status = 'sent' AND ec.sent_at > now() - interval '60 days'
         ORDER BY ec.sent_at DESC LIMIT 6) x), '[]'::jsonb),
    'analysis', (SELECT li.analysis FROM public.contact_list_imports li
                  WHERE li.analysis IS NOT NULL
                    AND (public.marketing_scope_match(li.venue_id, li.organizer_user_id, p_venue_id, p_organizer_user_id))
                  ORDER BY li.analyzed_at DESC LIMIT 1)
  );
END;
$function$;
-- ── 7. Rattrapage : empreintes des imports déjà en base ─────────────────────
-- L'empreinte décrit le FICHIER, pas ce que la liste possède aujourd'hui.
-- Quand l'import est venu de l'import unifié, ses identités sont dans
-- `imported_contacts` : c'est là qu'on lit le fichier. Pour les imports
-- email-only d'avant l'import unifié, rien d'autre n'en garde trace que leurs
-- abonnés — et comme rien n'a encore jamais été déplacé, ils sont exacts.

UPDATE public.email_list_imports i
   SET fingerprint = COALESCE(
     (SELECT public.contact_fingerprint(array_agg(c.email))
        FROM public.contact_list_imports li
        JOIN public.imported_contacts c ON c.list_import_id = li.id AND c.email IS NOT NULL
       WHERE li.email_import_id = i.id),
     (SELECT public.contact_fingerprint(array_agg(lower(s.email)))
        FROM public.newsletter_subscriptions s WHERE s.import_id = i.id))
 WHERE i.fingerprint IS NULL;

UPDATE public.sms_list_imports i
   SET fingerprint = COALESCE(
     (SELECT public.contact_fingerprint(array_agg(c.phone_e164))
        FROM public.contact_list_imports li
        JOIN public.imported_contacts c ON c.list_import_id = li.id AND c.phone_e164 IS NOT NULL
       WHERE li.sms_import_id = i.id),
     (SELECT public.contact_fingerprint(array_agg(vc.phone_e164))
        FROM public.venue_sms_contacts vc WHERE vc.import_id = i.id))
 WHERE i.fingerprint IS NULL;

UPDATE public.contact_list_imports li
   SET fingerprint = (SELECT public.contact_fingerprint(array_agg(COALESCE(c.email, '') || '|' || COALESCE(c.phone_e164, '')))
                        FROM public.imported_contacts c WHERE c.list_import_id = li.id)
 WHERE li.fingerprint IS NULL;

-- ── 8. Réparation : le fichier complet reprend ce que les fichiers partiels
--      tenaient encore ────────────────────────────────────────────────────
-- Cas WOH : 10 759 + 317 adresses importées séparément le 1er septembre, puis
-- le même public réimporté d'un seul fichier de 12 315 le 8. La liste complète
-- n'avait gardé que les 1 239 nouvelles. La règle appliquée ici est étroite et
-- se vérifie ligne à ligne : une liste plus ANCIENNE dont TOUS les membres
-- sans exception se retrouvent dans le fichier d'une liste plus récente est
-- absorbée par elle. Une liste qui contient ne serait-ce qu'une adresse
-- absente du nouveau fichier n'est pas touchée.
DO $$
DECLARE r record; v jsonb;
BEGIN
  FOR r IN
    SELECT li.id, li.list_name
      FROM public.contact_list_imports li
     WHERE li.superseded_by IS NULL
       AND EXISTS (
         SELECT 1 FROM public.email_list_imports e
          WHERE e.superseded_by IS NULL
            AND e.id IS DISTINCT FROM li.email_import_id
            AND public.marketing_scope_match(e.venue_id, e.organizer_user_id, li.venue_id, li.organizer_user_id)
            AND e.created_at < li.created_at
            AND EXISTS (SELECT 1 FROM public.newsletter_subscriptions s WHERE s.import_id = e.id)
            AND NOT EXISTS (
              SELECT 1 FROM public.newsletter_subscriptions s
               WHERE s.import_id = e.id
                 AND NOT EXISTS (SELECT 1 FROM public.imported_contacts c
                                  WHERE c.list_import_id = li.id
                                    AND c.email IS NOT NULL
                                    AND lower(c.email) = lower(s.email))))
     ORDER BY li.created_at
  LOOP
    v := public.contact_import_absorb(r.id);
    RAISE NOTICE 'Liste « % » (%) absorbe les fichiers partiels : %', r.list_name, r.id, v;
  END LOOP;
END $$;
