-- ============================================================================
-- Yuno CRM — Compte : l'équipe d'un espace et les préférences de
-- notification de chaque personne.
--
-- Équipe (organisation) : le fondateur, puis org_members (admin, éditeur,
-- lecteur ; les scanners de porte de la Suite n'en font pas partie) et les
-- invitations en attente. Le fondateur et les admins changent un rôle ou
-- retirent quelqu'un (crm_user_manages_team) ; personne ne change le rôle du
-- fondateur ni le sien. Un espace club rend son propriétaire et ses gérants,
-- en lecture : l'invitation d'un gérant vit encore dans la Suite.
--
-- Préférences : une ligne par (espace, personne), lue par le centre de
-- notifications. Les valeurs par défaut vivent ICI (crm_notif_defaults) ;
-- la synchro coupée et la connexion depuis un nouvel appareil ne se coupent
-- jamais.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.crm_team_get(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_members jsonb;
  v_invites jsonb := '[]'::jsonb;
  v_my text;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_organizer_user_id IS NOT NULL THEN
    v_my := public.crm_org_role(v_me, p_organizer_user_id);
    SELECT COALESCE(jsonb_agg(x ORDER BY x->>'sort', x->>'name'), '[]'::jsonb) INTO v_members FROM (
      SELECT jsonb_build_object(
               'id', 'owner', 'user_id', p.id,
               'name', NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''),
               'email', p.email, 'avatar_url', p.avatar_url, 'role', 'owner',
               'you', p.id = v_me, 'last_seen_at', u.last_sign_in_at, 'sort', '0') AS x
        FROM public.profiles p LEFT JOIN auth.users u ON u.id = p.id
       WHERE p.id = p_organizer_user_id
      UNION ALL
      SELECT jsonb_build_object(
               'id', m.id, 'user_id', m.member_user_id,
               'name', NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''),
               'email', COALESCE(p.email, m.member_email), 'avatar_url', p.avatar_url, 'role', m.role,
               'you', m.member_user_id = v_me, 'last_seen_at', u.last_sign_in_at,
               'sort', CASE m.role WHEN 'admin' THEN '1' WHEN 'editor' THEN '2' ELSE '3' END)
        FROM public.org_members m
        LEFT JOIN public.profiles p ON p.id = m.member_user_id
        LEFT JOIN auth.users u ON u.id = m.member_user_id
       WHERE m.organizer_user_id = p_organizer_user_id AND m.invitation_status = 'accepted'
         AND m.role IN ('admin', 'editor', 'viewer')
    ) q;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'email', m.member_email, 'role', m.role,
             'created_at', m.created_at, 'expires_at', m.expires_at,
             'expired', m.expires_at IS NOT NULL AND m.expires_at < now()) ORDER BY m.created_at DESC), '[]'::jsonb)
      INTO v_invites
      FROM public.org_members m
     WHERE m.organizer_user_id = p_organizer_user_id AND m.invitation_status = 'pending'
       AND m.role IN ('admin', 'editor', 'viewer');
  ELSE
    v_my := CASE WHEN EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.owner_id = v_me) THEN 'owner' ELSE 'admin' END;
    SELECT COALESCE(jsonb_agg(x ORDER BY x->>'sort', x->>'name'), '[]'::jsonb) INTO v_members FROM (
      SELECT jsonb_build_object(
               'id', 'owner', 'user_id', p.id,
               'name', NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''),
               'email', p.email, 'avatar_url', p.avatar_url, 'role', 'owner',
               'you', p.id = v_me, 'last_seen_at', u.last_sign_in_at, 'sort', '0') AS x
        FROM public.venues v JOIN public.profiles p ON p.id = v.owner_id LEFT JOIN auth.users u ON u.id = p.id
       WHERE v.id = p_venue_id
      UNION ALL
      SELECT jsonb_build_object(
               'id', mp.id, 'user_id', mp.user_id,
               'name', NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''),
               'email', p.email, 'avatar_url', p.avatar_url, 'role', 'admin',
               'you', mp.user_id = v_me, 'last_seen_at', u.last_sign_in_at, 'sort', '1')
        FROM public.manager_permissions mp
        LEFT JOIN public.profiles p ON p.id = mp.user_id
        LEFT JOIN auth.users u ON u.id = mp.user_id
       WHERE mp.venue_id = p_venue_id
    ) q;
  END IF;

  RETURN jsonb_build_object(
    'my_role', v_my,
    'can_manage', p_organizer_user_id IS NOT NULL AND public.crm_user_manages_team(v_me, NULL, p_organizer_user_id),
    'kind', CASE WHEN p_venue_id IS NOT NULL THEN 'venue' ELSE 'org' END,
    'members', v_members,
    'invites', v_invites);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_team_get(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_team_get(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_team_set_role(p_organizer_user_id uuid, p_member_id uuid, p_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.org_members%ROWTYPE;
BEGIN
  IF NOT public.crm_user_manages_team(auth.uid(), NULL, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'support_session' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('admin', 'editor', 'viewer') THEN
    RAISE EXCEPTION 'bad_role' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row FROM public.org_members
   WHERE id = p_member_id AND organizer_user_id = p_organizer_user_id AND role IN ('admin', 'editor', 'viewer')
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_row.member_user_id = auth.uid() THEN
    RAISE EXCEPTION 'own_role' USING ERRCODE = '42501';
  END IF;
  UPDATE public.org_members SET role = p_role WHERE id = p_member_id;
  RETURN jsonb_build_object('ok', true, 'role', p_role);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_team_set_role(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_team_set_role(uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_team_remove(p_organizer_user_id uuid, p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.org_members%ROWTYPE;
BEGIN
  IF NOT public.crm_user_manages_team(auth.uid(), NULL, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'support_session' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.org_members
   WHERE id = p_member_id AND organizer_user_id = p_organizer_user_id AND role IN ('admin', 'editor', 'viewer')
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_row.member_user_id = auth.uid() THEN
    RAISE EXCEPTION 'own_access' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.org_members WHERE id = p_member_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_team_remove(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_team_remove(uuid, uuid) TO authenticated, service_role;

-- ── Préférences de notification ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_notification_prefs (
  scope_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  quiet_on boolean NOT NULL DEFAULT true,
  quiet_from smallint NOT NULL DEFAULT 2 CHECK (quiet_from BETWEEN 0 AND 23),
  quiet_to smallint NOT NULL DEFAULT 11 CHECK (quiet_to BETWEEN 0 AND 23),
  low_balance integer NOT NULL DEFAULT 2000 CHECK (low_balance IN (1000, 2000, 5000, 10000)),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, user_id)
);
ALTER TABLE public.crm_notification_prefs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_notification_prefs FROM anon, authenticated;
COMMENT ON TABLE public.crm_notification_prefs IS
  'Yuno CRM : ce que chaque personne veut recevoir, par espace. RLS sans policy : crm_notif_prefs_get / _set.';

-- m = e-mail, a = dans Yuno ; lock = ne se coupe pas ; app = false : pas de
-- version « dans Yuno » (facture, résumé du lundi).
CREATE OR REPLACE FUNCTION public.crm_notif_defaults()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'rapport', jsonb_build_object('m', true, 'a', true),
    'prog', jsonb_build_object('m', false, 'a', true),
    'bloque', jsonb_build_object('m', true, 'a', true),
    'solde', jsonb_build_object('m', true, 'a', true),
    'sync', jsonb_build_object('m', true, 'a', true, 'lock', true),
    'import', jsonb_build_object('m', false, 'a', true),
    'facture', jsonb_build_object('m', true, 'a', false, 'app', false),
    'equipe', jsonb_build_object('m', false, 'a', true),
    'secu', jsonb_build_object('m', true, 'a', true, 'lock', true),
    'digest', jsonb_build_object('m', true, 'a', false, 'app', false));
$$;

CREATE OR REPLACE FUNCTION public.crm_notif_prefs_get(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r public.crm_notification_prefs%ROWTYPE;
  v_def jsonb := public.crm_notif_defaults();
  v_out jsonb := '{}'::jsonb;
  k text;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.crm_notification_prefs
   WHERE scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id) AND user_id = auth.uid();
  FOR k IN SELECT jsonb_object_keys(v_def) LOOP
    v_out := v_out || jsonb_build_object(k,
      CASE WHEN COALESCE((v_def->k->>'lock')::boolean, false) THEN v_def->k
           ELSE (v_def->k) || COALESCE(r.prefs->k, '{}'::jsonb) END);
  END LOOP;
  RETURN jsonb_build_object(
    'kinds', v_out,
    'quiet_on', COALESCE(r.quiet_on, true), 'quiet_from', COALESCE(r.quiet_from, 2), 'quiet_to', COALESCE(r.quiet_to, 11),
    'low_balance', COALESCE(r.low_balance, 2000), 'updated_at', r.updated_at);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_notif_prefs_get(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_notif_prefs_get(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_notif_prefs_set(p_venue_id text, p_organizer_user_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_def jsonb := public.crm_notif_defaults();
  v_kinds jsonb := '{}'::jsonb;
  k text;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- On ne garde que les clés connues, les canaux m/a en booléens, et jamais
  -- une notification verrouillée.
  IF jsonb_typeof(p_patch->'kinds') = 'object' THEN
    FOR k IN SELECT jsonb_object_keys(p_patch->'kinds') LOOP
      IF v_def ? k AND NOT COALESCE((v_def->k->>'lock')::boolean, false) THEN
        v_kinds := v_kinds || jsonb_build_object(k, jsonb_strip_nulls(jsonb_build_object(
          'm', CASE WHEN jsonb_typeof(p_patch->'kinds'->k->'m') = 'boolean' THEN p_patch->'kinds'->k->'m' END,
          'a', CASE WHEN COALESCE((v_def->k->>'app')::boolean, true) AND jsonb_typeof(p_patch->'kinds'->k->'a') = 'boolean'
                    THEN p_patch->'kinds'->k->'a' END)));
      END IF;
    END LOOP;
  END IF;
  INSERT INTO public.crm_notification_prefs (scope_key, user_id) VALUES (v_key, auth.uid())
  ON CONFLICT (scope_key, user_id) DO NOTHING;
  UPDATE public.crm_notification_prefs SET
    prefs = prefs || v_kinds,
    quiet_on = CASE WHEN p_patch ? 'quiet_on' THEN (p_patch->>'quiet_on')::boolean ELSE quiet_on END,
    quiet_from = CASE WHEN p_patch ? 'quiet_from' THEN (p_patch->>'quiet_from')::smallint ELSE quiet_from END,
    quiet_to = CASE WHEN p_patch ? 'quiet_to' THEN (p_patch->>'quiet_to')::smallint ELSE quiet_to END,
    low_balance = CASE WHEN p_patch ? 'low_balance' THEN (p_patch->>'low_balance')::int ELSE low_balance END,
    updated_at = now()
  WHERE scope_key = v_key AND user_id = auth.uid();
  RETURN public.crm_notif_prefs_get(p_venue_id, p_organizer_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_notif_prefs_set(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_notif_prefs_set(text, uuid, jsonb) TO authenticated, service_role;
