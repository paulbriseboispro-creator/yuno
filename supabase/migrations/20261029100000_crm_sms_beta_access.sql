-- ============================================================================
-- Yuno CRM — le SMS en BÊTA PRIVÉE, ouvert compte par compte (2026-10-19).
--
-- Décision de Paul (19/10, avant l'arrivée de 3AM) : le SMS ne s'affiche plus
-- « Bientôt » mais comme une bêta dont l'accès se demande. Le pro fait une
-- demande (usages, volume, nom d'expéditeur souhaité) ; le super admin reçoit
-- une alerte, branche l'abonnement Octopush si besoin, puis ouvre l'accès du
-- compte depuis l'Admin CRM. Rien ne change pour un compte non ouvert : les
-- écrans SMS restent fermés, et send-sms-campaign refuse tout test ou envoi
-- d'une campagne CRM d'un compte dont l'accès n'est pas ouvert
-- (`crm_sms_access_required`), cron compris.
--
-- Porte unique : `crm_sms_access_open(scope_key)` (service_role), lue par
-- send-sms-campaign ; la Console lit `crm_sms_access_get`.
--
-- Table sans policy : tout passe par les RPC ci-dessous.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.crm_sms_access (
  scope_key         text PRIMARY KEY,
  venue_id          text,
  organizer_user_id uuid,
  status            text NOT NULL CHECK (status IN ('requested', 'granted', 'declined')),
  use_cases         text[] NOT NULL DEFAULT '{}'::text[],
  volume            text CHECK (volume IN ('lt500', 'lt2k', 'lt10k', 'gt10k', 'unknown')),
  sender_wish       text,
  note              text,
  requested_at      timestamptz,
  requested_by      uuid,
  decided_at        timestamptz,
  decided_by        uuid,
  decision_reason   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_sms_access_scope_chk CHECK (venue_id IS NOT NULL OR organizer_user_id IS NOT NULL)
);
ALTER TABLE public.crm_sms_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_sms_access FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.crm_sms_access IS
  'Yuno CRM : accès au SMS (bêta privée), un par compte. Demandé par le pro (crm_sms_access_request), ouvert ou refusé par le super admin (crm_admin_sms_access_set). Lu par send-sms-campaign via crm_sms_access_open.';

-- ── Porte serveur ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_sms_access_open(p_scope_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.crm_sms_access a WHERE a.scope_key = p_scope_key AND a.status = 'granted');
$$;
REVOKE ALL ON FUNCTION public.crm_sms_access_open(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_sms_access_open(text) TO service_role;

-- ── Lecture de la Console ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_sms_access_get(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v public.crm_sms_access%ROWTYPE;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.crm_sms_access WHERE scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;
  -- Le motif d'une décision reste interne à Yuno : jamais rendu au pro.
  RETURN jsonb_build_object(
    'status', v.status,
    'requested_at', v.requested_at,
    'decided_at', v.decided_at,
    'use_cases', to_jsonb(v.use_cases),
    'volume', v.volume,
    'sender_wish', v.sender_wish);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_sms_access_get(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_sms_access_get(text, uuid) TO authenticated, service_role;

-- ── Demande du pro ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_sms_access_request(
  p_venue_id text, p_organizer_user_id uuid,
  p_use_cases text[], p_volume text, p_sender_wish text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_cur public.crm_sms_access%ROWTYPE;
  v_uses text[];
  v_sender text;
  v_note text;
  v_name text;
BEGIN
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_volume IS NOT NULL AND p_volume NOT IN ('lt500', 'lt2k', 'lt10k', 'gt10k', 'unknown') THEN
    RAISE EXCEPTION 'bad_volume' USING ERRCODE = '22023';
  END IF;
  -- Usages connus seulement, sans doublon ; au moins un.
  SELECT COALESCE(array_agg(DISTINCT u ORDER BY u), '{}'::text[]) INTO v_uses
    FROM unnest(COALESCE(p_use_cases, '{}'::text[])) u
   WHERE u IN ('announce', 'last_call', 'practical', 'comeback', 'other');
  IF cardinality(v_uses) = 0 THEN
    RAISE EXCEPTION 'use_required' USING ERRCODE = '22023';
  END IF;
  -- Nom d'expéditeur souhaité : un souhait, pas un réglage (il se règle dans
  -- SMS › Réglages une fois l'accès ouvert, avec ses vraies règles).
  v_sender := NULLIF(left(regexp_replace(COALESCE(p_sender_wish, ''), '[^A-Za-z0-9]', '', 'g'), 11), '');
  v_note := NULLIF(left(trim(COALESCE(p_note, '')), 500), '');

  SELECT * INTO v_cur FROM public.crm_sms_access WHERE scope_key = v_scope;
  IF FOUND AND v_cur.status = 'granted' THEN
    RETURN jsonb_build_object('status', 'granted', 'requested_at', v_cur.requested_at, 'decided_at', v_cur.decided_at);
  END IF;

  INSERT INTO public.crm_sms_access AS a (scope_key, venue_id, organizer_user_id, status, use_cases, volume, sender_wish, note, requested_at, requested_by)
  VALUES (v_scope, p_venue_id, p_organizer_user_id, 'requested', v_uses, COALESCE(p_volume, 'unknown'), v_sender, v_note, now(), auth.uid())
  ON CONFLICT (scope_key) DO UPDATE
     SET status = 'requested', use_cases = EXCLUDED.use_cases, volume = EXCLUDED.volume, sender_wish = EXCLUDED.sender_wish,
         note = EXCLUDED.note, requested_at = now(), requested_by = auth.uid(),
         decided_at = NULL, decided_by = NULL, decision_reason = NULL, updated_at = now()
   WHERE a.status <> 'granted';

  -- Alerte au super admin (jamais pour la démo) ; elle ne fait jamais échouer la demande.
  IF NOT COALESCE(public.is_demo_marketing_scope(p_venue_id, p_organizer_user_id), false) THEN
    BEGIN
      v_name := COALESCE(public.crm_space_display_name(p_venue_id, p_organizer_user_id), v_scope);
      PERFORM public.emit_admin_notification(
        'admin_crm_sms_access_request',
        'Demande d''accès SMS',
        v_name || ' demande l''accès au SMS (bêta). Usages : ' || array_to_string(v_uses, ', ')
          || ' · volume : ' || COALESCE(p_volume, 'unknown')
          || CASE WHEN v_sender IS NOT NULL THEN ' · expéditeur souhaité : ' || v_sender ELSE '' END || '.',
        'high', 'crm_account', v_scope,
        jsonb_build_object('scope_key', v_scope, 'org_name', v_name, 'use_cases', to_jsonb(v_uses),
                           'volume', COALESCE(p_volume, 'unknown'), 'sender_wish', v_sender, 'note', v_note),
        'crm_sms_access_request:' || v_scope || ':' || to_char(now(), 'YYYYMMDDHH24MI'), NULL);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object('status', 'requested', 'requested_at', now());
END;
$$;
REVOKE ALL ON FUNCTION public.crm_sms_access_request(text, uuid, text[], text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_sms_access_request(text, uuid, text[], text, text, text) TO authenticated, service_role;

-- ── Admin CRM : lire et décider ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_admin_sms_access(p_scope_key text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v public.crm_sms_access%ROWTYPE;
BEGIN
  PERFORM public._crm_admin_gate();
  SELECT * INTO v FROM public.crm_sms_access WHERE scope_key = p_scope_key;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'none'); END IF;
  RETURN jsonb_build_object(
    'status', v.status, 'use_cases', to_jsonb(v.use_cases), 'volume', v.volume, 'sender_wish', v.sender_wish, 'note', v.note,
    'requested_at', v.requested_at,
    'requested_by', (SELECT NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), '') FROM public.profiles p WHERE p.id = v.requested_by),
    'requested_email', (SELECT p.email FROM public.profiles p WHERE p.id = v.requested_by),
    'decided_at', v.decided_at, 'decision_reason', v.decision_reason);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_sms_access(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_sms_access(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_admin_sms_access_set(p_scope_key text, p_status text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_parts record;
BEGIN
  PERFORM public._crm_admin_gate();
  IF p_status NOT IN ('granted', 'declined') THEN RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023'; END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_parts FROM public.crm_scope_parts(p_scope_key);
  IF v_parts.venue_id IS NULL AND v_parts.organizer_user_id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;

  INSERT INTO public.crm_sms_access AS a (scope_key, venue_id, organizer_user_id, status, decided_at, decided_by, decision_reason)
  VALUES (p_scope_key, v_parts.venue_id, v_parts.organizer_user_id, p_status, now(), auth.uid(), left(trim(p_reason), 300))
  ON CONFLICT (scope_key) DO UPDATE
     SET status = EXCLUDED.status, decided_at = now(), decided_by = auth.uid(),
         decision_reason = EXCLUDED.decision_reason, updated_at = now();

  PERFORM public._crm_admin_audit(CASE WHEN p_status = 'granted' THEN 'crm_sms_access_granted' ELSE 'crm_sms_access_declined' END,
                                  p_scope_key, jsonb_build_object('reason', left(trim(p_reason), 300)));
  RETURN jsonb_build_object('status', p_status);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_sms_access_set(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_sms_access_set(text, text, text) TO authenticated, service_role;

-- ── Fil de notifications du pro : « Votre accès SMS est ouvert » ─────────────
-- Corps repris de la prod (pg_get_functiondef du 19/10, identique à
-- 20261019420000) ; seul le bloc « Accès SMS » est ajouté, après l'accès
-- assisté. Montré 14 jours après l'ouverture.

CREATE OR REPLACE FUNCTION public._crm_notif_list(p_venue_id text, p_organizer_user_id uuid, p_user uuid, p_enrich boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  cfg jsonb := public.crm_pricing_config();
  v_def jsonb := public.crm_notif_defaults();
  v_pref public.crm_notification_prefs%ROWTYPE;
  v_kinds jsonb := '{}'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_balance integer := public.crm_yunits_balance(v_scope);
  v_threshold integer;
  v_short boolean := false;
  v_cum integer := 0;
  v_out jsonb := '[]'::jsonb;
  v_left integer := 2;
  k text;
  r record;
  it jsonb;
  st public.crm_notification_states%ROWTYPE;
  v_buyers integer;
BEGIN
  -- Préférences « dans Yuno » de la personne (défauts complétés).
  SELECT * INTO v_pref FROM public.crm_notification_prefs WHERE scope_key = v_scope AND user_id = p_user;
  FOR k IN SELECT jsonb_object_keys(v_def) LOOP
    v_kinds := v_kinds || jsonb_build_object(k,
      CASE WHEN COALESCE((v_def->k->>'lock')::boolean, false) THEN v_def->k
           ELSE (v_def->k) || COALESCE(v_pref.prefs->k, '{}'::jsonb) END);
  END LOOP;
  v_threshold := COALESCE(v_pref.low_balance, (cfg->>'low_balance')::int, 2000);

  -- ── À faire ───────────────────────────────────────────────────────────────
  -- Un envoi programmé dans l'heure.
  FOR r IN SELECT c.id, c.name, c.scheduled_at FROM public.email_campaigns c
            WHERE c.status = 'scheduled' AND c.scheduled_at > now() AND c.scheduled_at <= now() + interval '1 hour'
              AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
              AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id LOOP
    v_items := v_items || jsonb_build_object('id', 'send_soon:' || r.id, 'kind', 'send_soon', 'cat', 'envois', 'tone', 'todo',
      'need', true, 'lock', false, 'pref', 'prog', 'at', LEAST(now(), r.scheduled_at - interval '1 hour'), 'due_at', r.scheduled_at,
      'params', jsonb_build_object('campaign_id', r.id, 'name', r.name, 'at', r.scheduled_at,
                                   'recipients', public._crm_campaign_estimate(r.id)));
  END LOOP;

  -- Des Yunits qui manquent pour les envois programmés (le premier qui casse).
  FOR r IN SELECT c.id, c.name, c.scheduled_at,
                  public._crm_campaign_estimate(c.id) * (cfg->'rates'->>'email')::int AS cost
             FROM public.email_campaigns c
            WHERE c.status = 'scheduled' AND c.scheduled_at > now()
              AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
            ORDER BY c.scheduled_at LOOP
    v_cum := v_cum + COALESCE(r.cost, 0);
    IF v_cum > v_balance THEN
      v_short := true;
      v_items := v_items || jsonb_build_object('id', 'yunits_short:' || r.id, 'kind', 'yunits_short', 'cat', 'envois', 'tone', 'todo',
        'need', true, 'lock', false, 'pref', 'bloque', 'at', now(), 'due_at', r.scheduled_at,
        'params', jsonb_build_object('campaign_id', r.id, 'name', r.name, 'missing', v_cum - v_balance, 'cost', r.cost, 'balance', v_balance));
      EXIT;
    END IF;
  END LOOP;

  -- La synchro Shotgun interrompue (verrouillée), puis reprise.
  FOR r IN SELECT c.id, c.status, c.last_ok_at, c.last_error_at, c.fail_count FROM public.ticketing_connections c
            WHERE (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id) LOOP
    IF r.status = 'token_invalid'
       OR (r.last_error_at IS NOT NULL AND (r.last_ok_at IS NULL OR r.last_error_at > r.last_ok_at) AND COALESCE(r.fail_count, 0) >= 3) THEN
      v_items := v_items || jsonb_build_object('id', 'sync_broken:' || r.id || ':' || to_char(COALESCE(r.last_ok_at, r.last_error_at, now()), 'YYYYMMDD'),
        'kind', 'sync_broken', 'cat', 'donnees', 'tone', 'todo', 'need', true, 'lock', true, 'pref', 'sync',
        'at', COALESCE(r.last_error_at, now()), 'due_at', NULL, 'params', jsonb_build_object('since_at', COALESCE(r.last_ok_at, r.last_error_at)));
    ELSIF r.last_error_at IS NOT NULL AND r.last_error_at > now() - interval '7 days' AND r.last_ok_at > r.last_error_at THEN
      v_items := v_items || jsonb_build_object('id', 'sync_resolved:' || r.id || ':' || to_char(r.last_ok_at, 'YYYYMMDD'),
        'kind', 'sync_resolved', 'cat', 'donnees', 'tone', 'ok', 'need', false, 'lock', false, 'pref', 'sync',
        'at', r.last_ok_at, 'due_at', NULL, 'params', '{}'::jsonb);
    END IF;
  END LOOP;

  -- L'abonnement : essai qui finit, compte en pause.
  FOR r IN SELECT s.status, s.trial_ends_at, s.stripe_subscription_id FROM public.crm_subscriptions s WHERE s.scope_key = v_scope LOOP
    IF r.status = 'trialing' AND r.stripe_subscription_id IS NULL AND r.trial_ends_at > now() AND r.trial_ends_at <= now() + interval '3 days' THEN
      v_items := v_items || jsonb_build_object('id', 'trial_ending:' || to_char(r.trial_ends_at, 'YYYYMMDD'),
        'kind', 'trial_ending', 'cat', 'compte', 'tone', 'warn', 'need', true, 'lock', false, 'pref', NULL,
        'at', r.trial_ends_at - interval '3 days', 'due_at', NULL,
        'params', jsonb_build_object('days', GREATEST(1, ceil(extract(epoch FROM r.trial_ends_at - now()) / 86400))::int));
    END IF;
  END LOOP;
  IF public.crm_effective_plan(v_scope) = 'paused' THEN
    v_items := v_items || jsonb_build_object('id', 'account_paused', 'kind', 'account_paused', 'cat', 'compte', 'tone', 'todo',
      'need', true, 'lock', true, 'pref', NULL, 'at', now(), 'due_at', NULL, 'params', '{}'::jsonb);
  END IF;

  -- Accès assisté (20261019420000) : une demande de l'équipe Yuno attend la
  -- réponse du titulaire (le consentement est le sien : elle ne vise que lui),
  -- et une session de l'équipe Yuno en cours dans le compte.
  FOR r IN SELECT g.id, g.created_at FROM public.admin_support_grants g
            WHERE g.target_user_id = p_user AND g.status = 'pending' AND g.revoked_at IS NULL
              AND (g.expires_at IS NULL OR g.expires_at > now())
            ORDER BY g.created_at DESC LIMIT 1 LOOP
    v_items := v_items || jsonb_build_object('id', 'support_request:' || r.id, 'kind', 'support_request', 'cat', 'compte', 'tone', 'todo',
      'need', true, 'lock', false, 'pref', NULL, 'at', r.created_at, 'due_at', NULL,
      'params', jsonb_build_object('grant_id', r.id));
  END LOOP;
  FOR r IN SELECT s.id, s.created_at, s.expires_at FROM public.admin_support_sessions s
            WHERE s.target_user_id = p_user AND s.status = 'active' AND s.expires_at > now()
            ORDER BY s.created_at DESC LIMIT 1 LOOP
    v_items := v_items || jsonb_build_object('id', 'support_live:' || r.id, 'kind', 'support_live', 'cat', 'compte', 'tone', 'warn',
      'need', false, 'lock', true, 'pref', NULL, 'at', r.created_at, 'due_at', NULL,
      'params', jsonb_build_object('until_at', r.expires_at));
  END LOOP;

  -- Accès SMS (bêta privée, 20261029100000) : ouvert par l'équipe Yuno.
  FOR r IN SELECT a.decided_at FROM public.crm_sms_access a
            WHERE a.scope_key = v_scope AND a.status = 'granted'
              AND a.decided_at > now() - interval '14 days' LOOP
    v_items := v_items || jsonb_build_object('id', 'sms_access_granted:' || to_char(r.decided_at, 'YYYYMMDD'),
      'kind', 'sms_access_granted', 'cat', 'compte', 'tone', 'ok', 'need', false, 'lock', false, 'pref', NULL,
      'at', r.decided_at, 'due_at', NULL, 'params', '{}'::jsonb);
  END LOOP;

  -- ── Historique (30 jours) ─────────────────────────────────────────────────
  FOR r IN SELECT c.id, c.name, c.sent_at, COALESCE(NULLIF(c.recipients_count, 0), c.total_recipients, 0) AS n,
                  COALESCE(c.clickers_count, 0) AS clickers, COALESCE(c.policy_skipped_count, 0) + COALESCE(c.suppressed_count, 0) AS excluded
             FROM public.email_campaigns c
            WHERE c.status = 'sent' AND c.sent_at > now() - interval '30 days'
              AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
              AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id LOOP
    v_items := v_items || jsonb_build_object('id', 'send_done:' || r.id, 'kind', 'send_done', 'cat', 'envois', 'tone', 'ok',
      'need', false, 'lock', false, 'pref', 'prog', 'at', r.sent_at, 'due_at', NULL,
      'params', jsonb_build_object('campaign_id', r.id, 'name', r.name, 'at', r.sent_at, 'recipients', r.n));
    IF r.sent_at < now() - interval '20 hours' THEN
      SELECT buyers INTO v_buyers FROM public.crm_notif_report_cache WHERE campaign_id = r.id;
      IF v_buyers IS NULL AND p_enrich AND v_left > 0 THEN
        v_left := v_left - 1;
        BEGIN
          v_buyers := COALESCE((public.crm_email_result__core(p_venue_id, p_organizer_user_id, r.id)->'stats'->>'purchases')::int, 0);
          BEGIN
            INSERT INTO public.crm_notif_report_cache (campaign_id, buyers) VALUES (r.id, v_buyers)
            ON CONFLICT (campaign_id) DO UPDATE SET buyers = EXCLUDED.buyers, computed_at = now();
          EXCEPTION WHEN others THEN NULL;
          END;
        EXCEPTION WHEN others THEN v_buyers := NULL;
        END;
      END IF;
      v_items := v_items || jsonb_build_object('id', 'send_report:' || r.id, 'kind', 'send_report', 'cat', 'envois', 'tone', 'info',
        'need', false, 'lock', false, 'pref', 'rapport', 'at', r.sent_at + interval '20 hours', 'due_at', NULL,
        'params', jsonb_build_object('campaign_id', r.id, 'name', r.name, 'clickers', r.clickers, 'buyers', v_buyers));
    END IF;
    IF r.excluded > 0 THEN
      v_items := v_items || jsonb_build_object('id', 'send_blocked:' || r.id, 'kind', 'send_blocked', 'cat', 'envois', 'tone', 'warn',
        'need', false, 'lock', false, 'pref', 'bloque', 'at', r.sent_at, 'due_at', NULL,
        'params', jsonb_build_object('campaign_id', r.id, 'name', r.name, 'excluded', r.excluded));
    END IF;
  END LOOP;

  FOR r IN SELECT i.list_import_id, i.finished_at, i.new_count, i.existing_count, i.file_dup_count FROM public.crm_imports i
            WHERE i.scope_key = v_scope AND i.status = 'done' AND i.finished_at > now() - interval '30 days' LOOP
    v_items := v_items || jsonb_build_object('id', 'import_done:' || r.list_import_id, 'kind', 'import_done', 'cat', 'donnees', 'tone', 'ok',
      'need', false, 'lock', false, 'pref', 'import', 'at', r.finished_at, 'due_at', NULL,
      'params', jsonb_build_object('added', COALESCE(r.new_count, 0), 'merged', COALESCE(r.existing_count, 0) + COALESCE(r.file_dup_count, 0)));
  END LOOP;

  FOR r IN SELECT count(*)::int AS n FROM public.contact_engagement e WHERE e.scope_key = public.contact_base_scope_key(p_venue_id, p_organizer_user_id) AND e.status = 'unreachable' LOOP
    IF r.n > 0 THEN
      v_items := v_items || jsonb_build_object('id', 'contacts_unreadable:' || to_char(now() AT TIME ZONE 'Europe/Paris', 'IYYYIW'),
        'kind', 'contacts_unreadable', 'cat', 'donnees', 'tone', 'warn', 'need', false, 'lock', false, 'pref', 'import',
        'at', date_trunc('week', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris', 'due_at', NULL,
        'params', jsonb_build_object('n', r.n));
    END IF;
  END LOOP;

  FOR r IN SELECT m.id, m.at, m.delta FROM public.crm_yunit_moves m
            WHERE m.scope_key = v_scope AND m.kind = 'credit' AND m.lot_kind = 'purchase' AND m.at > now() - interval '30 days' LOOP
    v_items := v_items || jsonb_build_object('id', 'recharge_done:' || r.id, 'kind', 'recharge_done', 'cat', 'compte', 'tone', 'ok',
      'need', false, 'lock', false, 'pref', 'facture', 'at', r.at, 'due_at', NULL,
      'params', jsonb_build_object('amount', r.delta, 'balance', v_balance));
  END LOOP;

  IF NOT v_short AND v_balance < v_threshold AND public.crm_effective_plan(v_scope) <> 'paused' THEN
    v_items := v_items || jsonb_build_object('id', 'yunits_low:' || v_threshold || ':' || to_char(now() AT TIME ZONE 'Europe/Paris', 'IYYYIW'),
      'kind', 'yunits_low', 'cat', 'envois', 'tone', 'warn', 'need', false, 'lock', false, 'pref', 'solde',
      'at', date_trunc('week', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris', 'due_at', NULL,
      'params', jsonb_build_object('balance', v_balance, 'threshold', v_threshold));
  END IF;

  IF p_organizer_user_id IS NOT NULL THEN
    FOR r IN SELECT om.id, om.accepted_at, om.member_user_id,
                    COALESCE(NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''), om.member_email) AS name
               FROM public.org_members om LEFT JOIN public.profiles p ON p.id = om.member_user_id
              WHERE om.organizer_user_id = p_organizer_user_id AND om.invitation_status = 'accepted'
                AND om.accepted_at > now() - interval '30 days' AND om.member_user_id IS DISTINCT FROM p_user LOOP
      v_items := v_items || jsonb_build_object('id', 'team_joined:' || r.id, 'kind', 'team_joined', 'cat', 'compte', 'tone', 'info',
        'need', false, 'lock', false, 'pref', 'equipe', 'at', r.accepted_at, 'due_at', NULL,
        'params', jsonb_build_object('name', r.name));
    END LOOP;
  END IF;

  -- Scénarios : l'étape « Me prévenir » (20261016130000), un compteur par jour
  -- et par étape, jamais une alerte par personne. Le libellé est celui de la
  -- version en ligne (sinon du brouillon).
  FOR r IN SELECT d.scenario_id, d.node_id, d.day, d.n, s.name,
                  COALESCE(v.graph->'nodes'->d.node_id->>'label', s.draft->'nodes'->d.node_id->>'label') AS label
             FROM public.crm_scenario_notify_daily d
             JOIN public.crm_scenarios s ON s.id = d.scenario_id
             LEFT JOIN public.crm_scenario_versions v ON v.id = s.live_version_id
            WHERE s.scope_key = v_scope AND d.n > 0
              AND d.day > (now() AT TIME ZONE 'Europe/Paris')::date - 30 LOOP
    v_items := v_items || jsonb_build_object('id', 'scenario_notify:' || r.scenario_id || ':' || r.node_id || ':' || to_char(r.day, 'YYYYMMDD'),
      'kind', 'scenario_notify', 'cat', 'envois', 'tone', 'info', 'need', false, 'lock', false, 'pref', 'rapport',
      'at', LEAST(now(), (r.day::timestamp + interval '23 hours 59 minutes') AT TIME ZONE 'Europe/Paris'), 'due_at', NULL,
      'params', jsonb_build_object('scenario_id', r.scenario_id, 'name', r.name, 'label', COALESCE(r.label, ''), 'n', r.n,
                                   'seen_at', (r.day::timestamp + interval '12 hours') AT TIME ZONE 'Europe/Paris',
                                   'today', r.day = (now() AT TIME ZONE 'Europe/Paris')::date));
  END LOOP;

  -- Plan de soirée prêt (lot A1) : compte en essai, premier import fait,
  -- analyse calculée, prochaine soirée à plus de 24 h. Une entrée par soirée.
  FOR r IN SELECT e.id, e.title, e.start_at, GREATEST(an.computed_at, tc.done_at) AS at
             FROM public.crm_subscriptions cs
             JOIN public.crm_analysis_state an ON an.scope_key = v_scope AND an.computed_at IS NOT NULL
             CROSS JOIN LATERAL (SELECT max(c.initial_import_done_at) AS done_at FROM public.ticketing_connections c
                                  WHERE c.venue_id IS NOT DISTINCT FROM p_venue_id
                                    AND (p_venue_id IS NOT NULL OR c.organizer_user_id = p_organizer_user_id)) tc
             CROSS JOIN LATERAL (SELECT ev.id, ev.title, ev.start_at FROM public.events ev
                                  WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL
                                    AND ev.start_at > now() + interval '24 hours'
                                    AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
                                      OR (p_venue_id IS NULL AND ev.organizer_user_id = p_organizer_user_id))
                                  ORDER BY ev.start_at LIMIT 1) e
            WHERE cs.scope_key = v_scope AND cs.status = 'trialing' AND COALESCE(cs.trial_ends_at, now() + interval '1 day') > now()
              AND tc.done_at IS NOT NULL LOOP
    v_items := v_items || jsonb_build_object('id', 'night_plan_ready:' || r.id,
      'kind', 'night_plan_ready', 'cat', 'donnees', 'tone', 'todo', 'need', false, 'lock', false, 'pref', 'rapport',
      'at', LEAST(now(), r.at), 'due_at', r.start_at,
      'params', jsonb_build_object('event_id', r.id, 'title', r.title, 'start_at', r.start_at));
  END LOOP;

  -- Bilan de la semaine (lot A3) : le lundi à partir de 8 h (Paris).
  IF now() >= ((date_trunc('week', now() AT TIME ZONE 'Europe/Paris') + interval '8 hours') AT TIME ZONE 'Europe/Paris')
     AND (EXISTS (SELECT 1 FROM public.email_campaigns c
                   WHERE c.venue_id IS NOT DISTINCT FROM p_venue_id AND (p_venue_id IS NOT NULL OR c.organizer_user_id = p_organizer_user_id)
                     AND c.sent_at >= ((date_trunc('week', now() AT TIME ZONE 'Europe/Paris') - interval '7 days') AT TIME ZONE 'Europe/Paris')
                     AND c.sent_at < ((date_trunc('week', now() AT TIME ZONE 'Europe/Paris')) AT TIME ZONE 'Europe/Paris'))
       OR EXISTS (SELECT 1 FROM public.crm_scenarios s WHERE s.scope_key = v_scope AND s.status = 'active')
       OR EXISTS (SELECT 1 FROM public.events ev
                   WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL AND ev.start_at > now() AND ev.start_at < now() + interval '21 days'
                     AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id) OR (p_venue_id IS NULL AND ev.organizer_user_id = p_organizer_user_id)))) THEN
    v_items := v_items || jsonb_build_object(
      'id', 'weekly_review:' || to_char(date_trunc('week', now() AT TIME ZONE 'Europe/Paris') - interval '7 days', 'IYYYIW'),
      'kind', 'weekly_review', 'cat', 'envois', 'tone', 'info', 'need', false, 'lock', false, 'pref', 'rapport',
      'at', (date_trunc('week', now() AT TIME ZONE 'Europe/Paris') + interval '8 hours') AT TIME ZONE 'Europe/Paris', 'due_at', NULL,
      'params', jsonb_build_object('from_at', (date_trunc('week', now() AT TIME ZONE 'Europe/Paris') - interval '7 days') AT TIME ZONE 'Europe/Paris',
                                   'to_at', (date_trunc('week', now() AT TIME ZONE 'Europe/Paris') - interval '1 day') AT TIME ZONE 'Europe/Paris'));
  END IF;

  -- ── Préférences et état de la personne ────────────────────────────────────
  FOR it IN SELECT x FROM jsonb_array_elements(v_items) x LOOP
    k := it->>'pref';
    -- Coupée « dans Yuno » : on ne la montre pas (sauf alerte verrouillée).
    CONTINUE WHEN k IS NOT NULL AND NOT COALESCE((it->>'lock')::boolean, false)
                  AND COALESCE((v_kinds->k->>'app')::boolean, true)
                  AND NOT COALESCE((v_kinds->k->>'a')::boolean, true);
    SELECT * INTO st FROM public.crm_notification_states
     WHERE scope_key = v_scope AND user_id = p_user AND item_id = it->>'id';
    v_out := v_out || jsonb_build_array((it - 'pref') || jsonb_build_object(
      'icon', it->>'kind', 'resolved', false, 'href', NULL,
      'read', st.read_at IS NOT NULL, 'archived', st.archived_at IS NOT NULL,
      'snoozed_until', CASE WHEN st.snoozed_until > now() THEN st.snoozed_until END));
  END LOOP;

  RETURN COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'need')::boolean DESC, (x->>'at')::timestamptz DESC)
                     FROM jsonb_array_elements(v_out) x), '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public._crm_notif_list(text, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_notif_list(text, uuid, uuid, boolean) TO service_role;
