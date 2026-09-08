-- ============================================================================
-- Import de listes de contacts SMS — même contrat que l'import email.
-- ============================================================================
--
-- Un pro (Kevin) qui arrive avec un fichier de numéros collectés ailleurs doit
-- pouvoir s'en servir en SMS comme en email. Mêmes portes de conformité :
--   • attestation d'origine du consentement, horodatée, une par fichier
--     (sms_list_imports) ;
--   • un numéro qui a dit STOP (ou s'est retiré) n'est JAMAIS réabonné par un
--     import — c'est la « liste repoussoir » de la CNIL, durable ;
--   • chaque fichier reste un segment d'audience (type 'import') ;
--   • interdit en session d'assistance.

-- ── 1. Attestations d'import ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sms_list_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  filename text,
  list_name text CHECK (list_name IS NULL OR char_length(list_name) <= 60),
  consent_source text NOT NULL
    CHECK (consent_source IN ('in_person','website_form','ticketing','social','other_tool','other')),
  consent_details text,
  collected_since date,
  default_country text,
  attested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  attested_at timestamptz NOT NULL DEFAULT now(),
  submitted_count integer NOT NULL DEFAULT 0,
  inserted_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  invalid_count integer NOT NULL DEFAULT 0,
  suppressed_count integer NOT NULL DEFAULT 0,
  unchanged_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sms_list_imports_owner_check CHECK (
    (venue_id IS NOT NULL AND organizer_user_id IS NULL)
    OR (venue_id IS NULL AND organizer_user_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_sms_list_imports_venue ON public.sms_list_imports (venue_id) WHERE venue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sms_list_imports_org ON public.sms_list_imports (organizer_user_id) WHERE organizer_user_id IS NOT NULL;

ALTER TABLE public.sms_list_imports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sms_list_imports_owner_read ON public.sms_list_imports;
CREATE POLICY sms_list_imports_owner_read ON public.sms_list_imports FOR SELECT TO authenticated
  USING (
    (venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
    OR public.is_super_admin()
  );
-- Aucune policy d'écriture : tout passe par les RPC ci-dessous.

ALTER TABLE public.venue_sms_contacts
  ADD COLUMN IF NOT EXISTS import_id uuid REFERENCES public.sms_list_imports(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sms_contacts_import ON public.venue_sms_contacts (import_id) WHERE import_id IS NOT NULL;

-- ── 2. Import (pro, gardé) ──────────────────────────────────────────────────
-- p_contacts : [{"phone":"+33612345678","first_name":"Léa","last_name":"Martin"}]
-- Les numéros arrivent DÉJÀ en E.164 (le front applique le pays par défaut) ;
-- le serveur renormalise et rejette tout ce qui n'est pas +[1-9][0-9]{6,14}.
CREATE OR REPLACE FUNCTION public.import_sms_contacts(
  p_contacts jsonb,
  p_consent_source text,
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL,
  p_filename text DEFAULT NULL,
  p_consent_details text DEFAULT NULL,
  p_collected_since date DEFAULT NULL,
  p_import_id uuid DEFAULT NULL,
  p_list_name text DEFAULT NULL,
  p_default_country text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
  v_unchanged integer := 0;
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'import_sms_contacts: fournir p_venue_id OU p_organizer_user_id';
  END IF;
  IF NOT public.sms_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'Import indisponible en session support';
  END IF;
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
       collected_since, default_country, attested_by)
    VALUES (p_venue_id, p_organizer_user_id, p_filename,
            NULLIF(left(btrim(COALESCE(p_list_name, '')), 60), ''),
            p_consent_source, p_consent_details, p_collected_since, p_default_country, v_uid)
    RETURNING id INTO v_import_id;
  ELSE
    PERFORM 1 FROM public.sms_list_imports
     WHERE id = v_import_id
       AND ((p_venue_id IS NOT NULL AND venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND organizer_user_id = p_organizer_user_id));
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
  ELSE
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
$$;
REVOKE ALL ON FUNCTION public.import_sms_contacts(jsonb, text, text, uuid, text, text, date, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_sms_contacts(jsonb, text, text, uuid, text, text, date, uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rename_sms_list_import(p_import_id uuid, p_name text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_venue text; v_org uuid;
  v_clean text := NULLIF(left(btrim(COALESCE(p_name, '')), 60), '');
BEGIN
  SELECT venue_id, organizer_user_id INTO v_venue, v_org FROM public.sms_list_imports WHERE id = p_import_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import inconnu'; END IF;
  IF NOT public.sms_scope_allowed(v_venue, v_org) THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  UPDATE public.sms_list_imports SET list_name = v_clean WHERE id = p_import_id;
  RETURN v_clean;
END;
$$;
REVOKE ALL ON FUNCTION public.rename_sms_list_import(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_sms_list_import(uuid, text) TO authenticated;

-- ── 3. Segment d'audience 'import' ─────────────────────────────────────────
-- Ajout d'un paramètre = DROP + CREATE (jamais de surcharge : l'appel nommé
-- des bundles en cache deviendrait ambigu).
DROP FUNCTION IF EXISTS public.resolve_sms_campaign_recipients(text, uuid, text, uuid);
CREATE FUNCTION public.resolve_sms_campaign_recipients(
  p_venue_id          text,
  p_organizer_user_id uuid,
  p_segment_type      text,
  p_event_id          uuid DEFAULT NULL,
  p_import_id         uuid DEFAULT NULL
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
REVOKE ALL ON FUNCTION public.resolve_sms_campaign_recipients(text, uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_sms_campaign_recipients(text, uuid, text, uuid, uuid) TO service_role;

DROP FUNCTION IF EXISTS public.count_sms_campaign_recipients(text, uuid, text, uuid);
CREATE FUNCTION public.count_sms_campaign_recipients(
  p_venue_id          text,
  p_organizer_user_id uuid,
  p_segment_type      text,
  p_event_id          uuid DEFAULT NULL,
  p_import_id         uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF NOT public.sms_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
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
REVOKE ALL ON FUNCTION public.count_sms_campaign_recipients(text, uuid, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_sms_campaign_recipients(text, uuid, text, uuid, uuid) TO authenticated, service_role;

-- L'enqueue passe désormais l'import_id lu dans segment_filters.
CREATE OR REPLACE FUNCTION public.enqueue_sms_campaign_recipients(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c        public.sms_campaigns%ROWTYPE;
  v_seg    text;
  v_event  uuid;
  v_import uuid;
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

  INSERT INTO public.sms_campaign_recipients (campaign_id, contact_id, user_id, phone_e164, full_name, lang)
  SELECT p_campaign_id, r.contact_id, r.user_id, r.phone_e164, r.full_name,
         COALESCE(pr.preferred_language, 'fr')
    FROM public.resolve_sms_campaign_recipients(c.venue_id, c.organizer_id, v_seg, v_event, v_import) r
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

-- La vue d'ensemble liste les fichiers importés (segments d'audience).
CREATE OR REPLACE FUNCTION public.get_sms_contacts_overview(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.sms_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  WITH base AS (
    SELECT c.*
      FROM public.venue_sms_contacts c
     WHERE (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
        OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id)
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
     WHERE (p_venue_id IS NOT NULL AND li.venue_id = p_venue_id)
        OR (p_organizer_user_id IS NOT NULL AND li.organizer_user_id = p_organizer_user_id)
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
$$;
