-- ============================================================================
-- Yuno CRM — écran Imports : « Ajoutez des contacts, jamais deux fois. »
--
--   crm_import_check(portée, e-mails[], téléphones[])  qui est déjà dans la
--     base (même e-mail OU même téléphone), avec son nom et son ancienneté.
--   crm_import_commit(...)  un lot du fichier → import_contact_list (la porte
--     d'import existante : typage, consentement, désabonnés, empreinte), mais
--     APRÈS avoir noté l'état d'abonnement e-mail de chaque adresse du lot :
--     c'est ce journal qui rend l'annulation exacte.
--   crm_import_undo(portée, import)  retire ce que l'import a ajouté : ses
--     lignes de contact, les abonnements e-mail qu'il a créés, les numéros
--     SMS qu'il a créés, et rend leur état d'avant aux abonnements qu'il a
--     réactivés. Un désabonnement survenu depuis n'est jamais effacé.
--   crm_imports_overview(portée)  la carte Shotgun et « Derniers ajouts ».
--
-- Accord (choix du design) : « oui » = l'import passe par les canaux e-mail
-- et SMS de import_contact_list (accord attesté par le pro, origine 'other',
-- détail « Console CRM ») ; « non » = les contacts rejoignent la base sans
-- aucun canal ouvert : ni e-mail ni SMS de la part du pro.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.crm_imports (
  list_import_id   uuid PRIMARY KEY REFERENCES public.contact_list_imports(id) ON DELETE CASCADE,
  scope_key        text NOT NULL,
  venue_id         text,
  organizer_user_id uuid,
  kind             text NOT NULL DEFAULT 'file' CHECK (kind IN ('file', 'manual')),
  title            text,
  consent          text NOT NULL CHECK (consent IN ('yes', 'no')),
  mode             text NOT NULL DEFAULT 'complete' CHECK (mode IN ('complete', 'keep')),
  new_count        integer NOT NULL DEFAULT 0,
  existing_count   integer NOT NULL DEFAULT 0,
  file_dup_count   integer NOT NULL DEFAULT 0,
  bad_count        integer NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'undone')),
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  undone_at        timestamptz,
  undone_by        uuid
);
CREATE INDEX IF NOT EXISTS crm_imports_scope_idx ON public.crm_imports (scope_key, created_at DESC);
ALTER TABLE public.crm_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_imports FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.crm_import_journal (
  list_import_id  uuid NOT NULL REFERENCES public.crm_imports(list_import_id) ON DELETE CASCADE,
  email           text NOT NULL,
  prev_opted_in   boolean NOT NULL,
  prev_import_id  uuid,
  prev_first_name text,
  prev_last_name  text,
  PRIMARY KEY (list_import_id, email)
);
ALTER TABLE public.crm_import_journal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_import_journal FROM anon, authenticated;

-- ── Qui est déjà dans la base ? ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_import_check(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_emails text[] DEFAULT NULL, p_phones text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  v_emails jsonb;
  v_phones jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(array_length(p_emails, 1), 0) + COALESCE(array_length(p_phones, 1), 0) > 100000 THEN
    RAISE EXCEPTION 'too_many' USING ERRCODE = '22023';
  END IF;
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);

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
$$;
REVOKE ALL ON FUNCTION public.crm_import_check(text, uuid, text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_import_check(text, uuid, text[], text[]) TO authenticated;

-- ── Un lot du fichier ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_import_commit(
  p_venue_id text, p_organizer_user_id uuid, p_list_import_id uuid, p_rows jsonb,
  p_consent text, p_mode text, p_title text, p_final boolean DEFAULT false,
  p_stats jsonb DEFAULT NULL, p_kind text DEFAULT 'file'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_consent text := CASE WHEN p_consent = 'yes' THEN 'yes' ELSE 'no' END;
  v_mode text := CASE WHEN p_mode = 'keep' THEN 'keep' ELSE 'complete' END;
  v_kind text := CASE WHEN p_kind = 'manual' THEN 'manual' ELSE 'file' END;
  v_channels jsonb;
  v_details text;
  v_list uuid := p_list_import_id;
  v_res jsonb;
  v_ci public.crm_imports%ROWTYPE;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_rows, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_rows, '[]'::jsonb)) > 2000 THEN
    RAISE EXCEPTION 'invalid_rows' USING ERRCODE = '22023';
  END IF;
  v_channels := CASE WHEN v_consent = 'yes' THEN '{"email": true, "sms": true}'::jsonb ELSE '{"email": false, "sms": false}'::jsonb END;
  v_details := CASE WHEN v_consent = 'yes'
                    THEN 'Console CRM : le pro atteste l''accord de ces personnes pour recevoir ses e-mails et SMS.'
                    ELSE 'Console CRM : contacts enregistrés sans accord, aucun envoi.' END;

  -- 1er lot : la liste naît vide (import_contact_list la crée), puis on la note.
  IF v_list IS NULL THEN
    v_res := public.import_contact_list(
      '[]'::jsonb, 'other', p_venue_id, p_organizer_user_id, left(COALESCE(p_title, 'Import'), 200), v_details,
      NULL, NULL, left(COALESCE(p_title, 'Import'), 60), 'FR', v_channels, NULL, 'append', false);
    v_list := (v_res->>'list_import_id')::uuid;
    INSERT INTO public.crm_imports (list_import_id, scope_key, venue_id, organizer_user_id, kind, title, consent, mode, created_by)
    VALUES (v_list, v_scope, p_venue_id, p_organizer_user_id, v_kind, left(COALESCE(p_title, 'Import'), 200), v_consent, v_mode, auth.uid());
  END IF;

  SELECT * INTO v_ci FROM public.crm_imports WHERE list_import_id = v_list AND scope_key = v_scope;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_ci.status <> 'running' THEN RAISE EXCEPTION 'import_closed' USING ERRCODE = '22023'; END IF;

  -- Journal : l'état d'abonnement e-mail d'avant, pour chaque adresse du lot
  -- déjà connue de la portée (une adresse nouvelle n'a pas d'avant).
  IF v_ci.consent = 'yes' THEN
    INSERT INTO public.crm_import_journal (list_import_id, email, prev_opted_in, prev_import_id, prev_first_name, prev_last_name)
    SELECT v_list, lower(ns.email), ns.opted_in, ns.import_id, ns.first_name, ns.last_name
      FROM public.newsletter_subscriptions ns
     WHERE public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND lower(ns.email) IN (SELECT lower(btrim(x->>'email')) FROM jsonb_array_elements(p_rows) x WHERE x ? 'email')
    ON CONFLICT (list_import_id, email) DO NOTHING;
  END IF;

  IF jsonb_array_length(COALESCE(p_rows, '[]'::jsonb)) > 0 OR p_final THEN
    v_res := public.import_contact_list(
      COALESCE(p_rows, '[]'::jsonb), 'other', p_venue_id, p_organizer_user_id, v_ci.title, v_details,
      NULL, v_list, NULL, 'FR', v_channels, NULL, 'append', COALESCE(p_final, false));
  END IF;

  IF p_stats IS NOT NULL THEN
    UPDATE public.crm_imports
       SET new_count = GREATEST(0, COALESCE((p_stats->>'new')::int, new_count)),
           existing_count = GREATEST(0, COALESCE((p_stats->>'existing')::int, existing_count)),
           file_dup_count = GREATEST(0, COALESCE((p_stats->>'dup')::int, file_dup_count)),
           bad_count = GREATEST(0, COALESCE((p_stats->>'bad')::int, bad_count))
     WHERE list_import_id = v_list;
  END IF;
  IF p_final THEN
    UPDATE public.crm_imports SET status = 'done', finished_at = now() WHERE list_import_id = v_list;
  END IF;
  RETURN jsonb_build_object('list_import_id', v_list, 'rows', COALESCE(v_res->'rows', '0'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_import_commit(text, uuid, uuid, jsonb, text, text, text, boolean, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_import_commit(text, uuid, uuid, jsonb, text, text, text, boolean, jsonb, text) TO authenticated;

-- ── Annuler un import ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_import_undo(
  p_venue_id text, p_organizer_user_id uuid, p_list_import_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_ci public.crm_imports%ROWTYPE;
  v_email_import uuid;
  v_sms_import uuid;
  v_contacts integer;
  v_restored integer := 0;
  v_deleted integer := 0;
  v_sms integer := 0;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_ci FROM public.crm_imports WHERE list_import_id = p_list_import_id AND scope_key = v_scope FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_ci.status = 'undone' THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  SELECT email_import_id, sms_import_id INTO v_email_import, v_sms_import
    FROM public.contact_list_imports WHERE id = p_list_import_id;

  IF v_email_import IS NOT NULL THEN
    -- Réactivés par cet import : leur état d'avant (sauf désabonnement depuis).
    WITH r AS (
      UPDATE public.newsletter_subscriptions ns
         SET opted_in = j.prev_opted_in, import_id = j.prev_import_id,
             first_name = j.prev_first_name, last_name = j.prev_last_name, updated_at = now()
        FROM public.crm_import_journal j
       WHERE j.list_import_id = p_list_import_id
         AND lower(ns.email) = j.email
         AND ns.import_id = v_email_import
         AND ns.opted_out_at IS NULL
         AND public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
      RETURNING 1
    ) SELECT count(*) INTO v_restored FROM r;
    -- Créés par cet import : retirés (un désabonné reste, c'est sa mémoire).
    WITH d AS (
      DELETE FROM public.newsletter_subscriptions ns
       WHERE ns.import_id = v_email_import
         AND ns.opted_out_at IS NULL
         AND public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
         AND NOT EXISTS (SELECT 1 FROM public.crm_import_journal j WHERE j.list_import_id = p_list_import_id AND j.email = lower(ns.email))
      RETURNING 1
    ) SELECT count(*) INTO v_deleted FROM d;
  END IF;

  IF v_sms_import IS NOT NULL THEN
    WITH d AS (
      DELETE FROM public.venue_sms_contacts vc
       WHERE vc.import_id = v_sms_import
         AND COALESCE(vc.unsubscribed, false) = false
      RETURNING 1
    ) SELECT count(*) INTO v_sms FROM d;
  END IF;

  WITH d AS (DELETE FROM public.imported_contacts WHERE list_import_id = p_list_import_id RETURNING 1)
  SELECT count(*) INTO v_contacts FROM d;

  UPDATE public.contact_list_imports SET superseded_at = now() WHERE id = p_list_import_id AND superseded_at IS NULL;
  UPDATE public.crm_imports SET status = 'undone', undone_at = now(), undone_by = auth.uid() WHERE list_import_id = p_list_import_id;

  RETURN jsonb_build_object('ok', true, 'contacts', v_contacts, 'emails_removed', v_deleted, 'emails_restored', v_restored, 'sms_removed', v_sms);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_import_undo(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_import_undo(text, uuid, uuid) TO authenticated;

-- ── La page : connexion Shotgun et derniers ajouts ──────────────────────────
CREATE OR REPLACE FUNCTION public.crm_imports_overview(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_conn jsonb;
  v_sync jsonb;
  v_imports jsonb;
  v_legacy jsonb;
  v_day date;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
           'state', CASE WHEN c.status IN ('token_invalid', 'error') THEN 'broken'
                         WHEN c.status = 'disconnected' THEN 'off' ELSE 'on' END,
           'status', c.status, 'org_name', c.external_org_name,
           'last_ok_at', c.last_ok_at, 'last_error_at', c.last_error_at)
    INTO v_conn
    FROM public.ticketing_connections c
   WHERE c.provider = 'shotgun'
     AND ((p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id))
   ORDER BY c.updated_at DESC LIMIT 1;

  -- Dernier jour où Shotgun a apporté des acheteurs : nouveaux (premier billet
  -- vu ce jour-là) et déjà présents (un billet plus ancien existait).
  WITH t AS (
    SELECT lower(et.buyer_email) AS email, et.first_seen_at
      FROM public.external_tickets et
     WHERE et.buyer_email IS NOT NULL
       AND ((p_venue_id IS NOT NULL AND et.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND et.organizer_user_id = p_organizer_user_id))
  )
  SELECT max((first_seen_at AT TIME ZONE 'Europe/Paris')::date) INTO v_day FROM t;
  IF v_day IS NOT NULL THEN
    WITH t AS (
      SELECT lower(et.buyer_email) AS email, et.first_seen_at
        FROM public.external_tickets et
       WHERE et.buyer_email IS NOT NULL
         AND ((p_venue_id IS NOT NULL AND et.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND et.organizer_user_id = p_organizer_user_id))
    ), f AS (SELECT email, min(first_seen_at) AS first_at FROM t GROUP BY email),
    d AS (SELECT DISTINCT email FROM t WHERE (first_seen_at AT TIME ZONE 'Europe/Paris')::date = v_day)
    SELECT jsonb_build_object(
             'day', v_day,
             'new', count(*) FILTER (WHERE (f.first_at AT TIME ZONE 'Europe/Paris')::date = v_day),
             'existing', count(*) FILTER (WHERE (f.first_at AT TIME ZONE 'Europe/Paris')::date < v_day))
      INTO v_sync
      FROM d JOIN f ON f.email = d.email;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', i.list_import_id, 'kind', i.kind, 'title', i.title, 'consent', i.consent,
           'created_at', i.created_at, 'status', i.status, 'undone_at', i.undone_at,
           'new', i.new_count, 'existing', i.existing_count, 'dup', i.file_dup_count, 'bad', i.bad_count)
           ORDER BY i.created_at DESC), '[]'::jsonb)
    INTO v_imports
    FROM (SELECT * FROM public.crm_imports WHERE scope_key = v_scope AND status <> 'running' ORDER BY created_at DESC LIMIT 30) i;

  -- Fichiers importés avant la Console CRM (outil d'import de la Suite).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', l.id, 'title', COALESCE(l.list_name, l.filename), 'created_at', l.created_at, 'rows', l.row_count)
           ORDER BY l.created_at DESC), '[]'::jsonb)
    INTO v_legacy
    FROM (SELECT * FROM public.contact_list_imports l
           WHERE public.marketing_scope_match(l.venue_id, l.organizer_user_id, p_venue_id, p_organizer_user_id)
             AND l.superseded_by IS NULL AND l.superseded_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM public.crm_imports c WHERE c.list_import_id = l.id)
           ORDER BY l.created_at DESC LIMIT 10) l;

  RETURN jsonb_build_object('connection', v_conn, 'sync', v_sync, 'imports', v_imports, 'legacy', v_legacy);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_imports_overview(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_imports_overview(text, uuid) TO authenticated;

-- Un import resté « en cours » (onglet fermé en plein envoi) se clôt seul au
-- bout d'une heure : il garde ce qu'il a ajouté et peut être annulé.
CREATE OR REPLACE FUNCTION public.crm_imports_close_stale()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH u AS (
    UPDATE public.crm_imports SET status = 'done', finished_at = now()
     WHERE status = 'running' AND created_at < now() - interval '1 hour'
    RETURNING 1
  ) SELECT count(*)::integer FROM u;
$$;
REVOKE ALL ON FUNCTION public.crm_imports_close_stale() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_imports_close_stale() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('crm-imports-close-stale') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crm-imports-close-stale');
  PERFORM cron.schedule('crm-imports-close-stale', '7 * * * *', 'SELECT public.crm_imports_close_stale()');
END $$;
