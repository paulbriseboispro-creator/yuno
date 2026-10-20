-- ============================================================================
-- Staff de porte limité à UNE soirée (le staff du club invité)
-- ============================================================================
-- Demande de Paul (20/10) : le staff du club qui accueille une soirée scanne à
-- la porte de CETTE soirée, avec l'app Yuno Pro, aux côtés de l'équipe de
-- l'organisateur, sans recevoir aucun rôle sur l'organisation qui mène.
--
-- Aujourd'hui un videur d'organisateur (`org_staff`) a la porte de TOUTES les
-- soirées de l'organisateur : rien ne lie un videur à une soirée. D'où une
-- table à part, `event_door_staff`, lue par `is_event_door_staff` (porte
-- unique du manifeste, des billets, de la guest list, des tables et de la
-- synchro hors ligne) et `event_door_staff_ids`. L'accès s'arrête 6 h après la
-- fin de la soirée.
--
-- Deux façons d'inviter, même résultat : le club depuis son espace (par son
-- lien, onglet Porte), ou l'organisateur depuis sa Console. Le compte de la
-- personne se crée à l'acceptation (edge `accept-staff-invitation`, action
-- `accept_event_door`), qui pose le rôle `bouncer` ; la porte, elle, ne
-- s'ouvre que sur la soirée.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.event_door_staff (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  guest_pass_id uuid REFERENCES public.event_guest_passes(id) ON DELETE SET NULL,
  display_name  text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  email         text CHECK (email IS NULL OR (char_length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  phone         text CHECK (phone IS NULL OR char_length(phone) <= 40),
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  token         text NOT NULL UNIQUE CHECK (token ~ '^[0-9a-f]{32}$'),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_by_kind text NOT NULL CHECK (invited_by_kind IN ('guest', 'organizer')),
  invited_by_party text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  accepted_at   timestamptz,
  revoked_at    timestamptz,
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS event_door_staff_event_idx ON public.event_door_staff (event_id);
CREATE INDEX IF NOT EXISTS event_door_staff_user_idx ON public.event_door_staff (user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS event_door_staff_live_email_key
  ON public.event_door_staff (event_id, lower(email)) WHERE email IS NOT NULL AND status <> 'revoked';
ALTER TABLE public.event_door_staff ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_door_staff FROM anon, authenticated;
COMMENT ON TABLE public.event_door_staff IS
  'Staff de porte limité à UNE soirée (staff du club invité). Lu par is_event_door_staff ; accès coupé 6 h après la fin. RLS sans policy, tout par RPC.';

CREATE OR REPLACE FUNCTION public.event_door_staff_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.token := replace(gen_random_uuid()::text, '-', '');
  ELSE
    NEW.token := OLD.token;
    NEW.event_id := OLD.event_id;
  END IF;
  NEW.display_name := btrim(regexp_replace(NEW.display_name, '\s+', ' ', 'g'));
  NEW.email := nullif(lower(btrim(NEW.email)), '');
  NEW.phone := nullif(btrim(NEW.phone), '');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.event_door_staff_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_event_door_staff_guard ON public.event_door_staff;
CREATE TRIGGER trg_event_door_staff_guard BEFORE INSERT OR UPDATE ON public.event_door_staff
  FOR EACH ROW EXECUTE FUNCTION public.event_door_staff_guard();

-- La fenêtre d'une soirée pour son staff : jusqu'à 6 h après la fin.
CREATE OR REPLACE FUNCTION public._event_door_window_open(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.events e
                  WHERE e.id = p_event_id AND e.cancelled_at IS NULL
                    AND now() <= coalesce(e.end_at, e.start_at + interval '8 hours') + interval '6 hours');
$$;
REVOKE ALL ON FUNCTION public._event_door_window_open(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. La porte unique : + le staff de cette soirée.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_event_door_staff(_user_id uuid, _event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.events e
     WHERE e.id = _event_id
       AND (
         EXISTS (
           SELECT 1 FROM public.org_members om
            WHERE om.organizer_user_id IN (e.organizer_user_id, e.partner_organizer_id)
              AND om.member_user_id = _user_id
              AND om.invitation_status = 'accepted'
              AND om.role IN ('admin', 'editor', 'scanner')
         )
         OR EXISTS (
           SELECT 1 FROM public.org_staff os
            WHERE os.organizer_user_id IN (e.organizer_user_id, e.partner_organizer_id)
              AND os.user_id = _user_id
              AND os.invitation_status = 'accepted'
              AND os.role = 'bouncer'
         )
         -- Co-hôtes ÉDITEURS acceptés de cette soirée.
         OR EXISTS (
           SELECT 1 FROM public.event_cohosts c
            WHERE c.event_id = e.id
              AND c.status = 'accepted'
              AND c.access = 'editor'
              AND (
                (c.organizer_user_id IS NOT NULL AND (
                   c.organizer_user_id = _user_id
                   OR EXISTS (SELECT 1 FROM public.org_members om2
                               WHERE om2.organizer_user_id = c.organizer_user_id
                                 AND om2.member_user_id = _user_id
                                 AND om2.invitation_status = 'accepted'
                                 AND om2.role IN ('admin', 'editor', 'scanner'))
                   OR EXISTS (SELECT 1 FROM public.org_staff os2
                               WHERE os2.organizer_user_id = c.organizer_user_id
                                 AND os2.user_id = _user_id
                                 AND os2.invitation_status = 'accepted'
                                 AND os2.role = 'bouncer')))
                OR (c.venue_id IS NOT NULL AND (
                   EXISTS (SELECT 1 FROM public.venues v WHERE v.id = c.venue_id AND v.owner_id = _user_id)
                   OR public.can_manage_venue(_user_id, c.venue_id)))
              )
         )
         -- Staff de porte de CETTE soirée (staff du club invité), jusqu'à 6 h après la fin.
         OR EXISTS (
           SELECT 1 FROM public.event_door_staff ds
            WHERE ds.event_id = e.id
              AND ds.user_id = _user_id
              AND ds.status = 'accepted'
              AND e.cancelled_at IS NULL
              AND now() <= coalesce(e.end_at, e.start_at + interval '8 hours') + interval '6 hours'
         )
       )
  )
$function$;

CREATE OR REPLACE FUNCTION public.event_door_staff_ids(p_event_id uuid)
 RETURNS TABLE(user_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT s.user_id
    FROM events e
    CROSS JOIN LATERAL (
      -- Staff de club : le rattachement se lit sur profiles.venue_id, comme
      -- partout ailleurs (il n'y a pas de table de jonction staff ↔ club).
      SELECT ur.user_id
        FROM user_roles ur
        JOIN profiles p ON p.id = ur.user_id
       WHERE ur.role IN ('bouncer', 'manager')
         AND p.venue_id IS NOT NULL
         AND p.venue_id IN (e.venue_id, e.partner_venue_id)
      UNION
      SELECT os.user_id
        FROM org_staff os
       WHERE os.user_id IS NOT NULL
         AND os.invitation_status = 'accepted'
         AND os.role = 'bouncer'
         AND os.organizer_user_id IN (e.organizer_user_id, e.partner_organizer_id)
      UNION
      SELECT om.member_user_id
        FROM org_members om
       WHERE om.member_user_id IS NOT NULL
         AND om.invitation_status = 'accepted'
         AND om.role IN ('admin', 'editor', 'scanner')
         AND om.organizer_user_id IN (e.organizer_user_id, e.partner_organizer_id)
      UNION
      -- Staff de porte de cette soirée seulement.
      SELECT ds.user_id
        FROM event_door_staff ds
       WHERE ds.event_id = e.id AND ds.status = 'accepted' AND ds.user_id IS NOT NULL
    ) AS s(user_id)
   WHERE e.id = p_event_id
     AND s.user_id IS NOT NULL;
$function$;

-- Les soirées dont l'appelant tient la porte comme staff d'UNE soirée (app Yuno Pro).
CREATE OR REPLACE FUNCTION public.get_my_event_door_events()
RETURNS TABLE(event_id uuid, title text, start_at timestamptz, end_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.title, e.start_at, e.end_at
    FROM public.event_door_staff ds
    JOIN public.events e ON e.id = ds.event_id
   WHERE ds.user_id = auth.uid() AND ds.status = 'accepted'
     AND e.cancelled_at IS NULL
     AND now() <= coalesce(e.end_at, e.start_at + interval '8 hours') + interval '6 hours'
   ORDER BY e.start_at;
$$;
REVOKE ALL ON FUNCTION public.get_my_event_door_events() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_event_door_events() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Inviter : par l'invité (son lien) ou par l'organisateur (sa Console).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_door_invite(
  p_event_id uuid, p_pass_id uuid, p_name text, p_email text, p_phone text,
  p_by uuid, p_by_kind text, p_by_party text
)
RETURNS public.event_door_staff
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_name  text := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 80);
  v_row   public.event_door_staff%ROWTYPE;
BEGIN
  IF char_length(v_name) < 2 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  IF v_email IS NULL AND v_phone IS NULL THEN RAISE EXCEPTION 'contact_required'; END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'invalid_email'; END IF;
  IF v_phone IS NOT NULL AND regexp_replace(v_phone, '\D', '', 'g') !~ '^\d{6,15}$' THEN RAISE EXCEPTION 'invalid_phone'; END IF;
  IF NOT public._event_door_window_open(p_event_id) THEN RAISE EXCEPTION 'event_closed'; END IF;
  IF v_email IS NOT NULL
     AND (p_event_id = ANY (public.demo_event_ids())) IS DISTINCT FROM public.is_demo_email(v_email) THEN
    RAISE EXCEPTION 'demo_mismatch';
  END IF;
  IF (SELECT count(*) FROM public.event_door_staff ds WHERE ds.event_id = p_event_id AND ds.status <> 'revoked') >= 20 THEN
    RAISE EXCEPTION 'too_many_staff';
  END IF;
  IF v_email IS NOT NULL AND EXISTS (SELECT 1 FROM public.event_door_staff ds
      WHERE ds.event_id = p_event_id AND lower(ds.email) = v_email AND ds.status <> 'revoked') THEN
    RAISE EXCEPTION 'already_invited';
  END IF;
  INSERT INTO public.event_door_staff (event_id, guest_pass_id, display_name, email, phone, token,
                                       invited_by, invited_by_kind, invited_by_party)
  VALUES (p_event_id, p_pass_id, v_name, v_email, v_phone, repeat('0', 32), p_by, p_by_kind, p_by_party)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public._event_door_invite(uuid, uuid, text, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guest_pass_invite_door_staff(p_token text, p_name text, p_email text DEFAULT NULL, p_phone text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass public.event_guest_passes%ROWTYPE;
  v_row  public.event_door_staff%ROWTYPE;
BEGIN
  v_pass := public._guest_pass_live(p_token);
  IF v_pass.guest_kind <> 'venue' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT public._guest_pass_note(v_pass.id, 'staff') THEN RAISE EXCEPTION 'too_many_actions'; END IF;
  v_row := public._event_door_invite(v_pass.event_id, v_pass.id, p_name, p_email, p_phone, auth.uid(), 'guest', v_pass.guest_party);
  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'invite_token', v_row.token, 'email', v_row.email, 'phone', v_row.phone);
END;
$$;
REVOKE ALL ON FUNCTION public.guest_pass_invite_door_staff(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_pass_invite_door_staff(text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.invite_event_door_staff(p_event_id uuid, p_name text, p_email text DEFAULT NULL,
                                                         p_phone text DEFAULT NULL, p_pass_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me  record;
  v_row public.event_door_staff%ROWTYPE;
BEGIN
  SELECT * INTO v_me FROM public._guest_pass_manager(p_event_id);
  IF p_pass_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.event_guest_passes h
                                            WHERE h.id = p_pass_id AND h.event_id = p_event_id AND h.guest_kind = 'venue') THEN
    RAISE EXCEPTION 'invalid_pass';
  END IF;
  v_row := public._event_door_invite(p_event_id, p_pass_id, p_name, p_email, p_phone, auth.uid(), 'organizer', v_me.party_key);
  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'invite_token', v_row.token, 'email', v_row.email, 'phone', v_row.phone);
END;
$$;
REVOKE ALL ON FUNCTION public.invite_event_door_staff(uuid, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_event_door_staff(uuid, text, text, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.guest_pass_revoke_door_staff(p_token text, p_staff_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass public.event_guest_passes%ROWTYPE;
  v_n    integer;
BEGIN
  v_pass := public._guest_pass_live(p_token);
  UPDATE public.event_door_staff SET status = 'revoked', revoked_at = now()
   WHERE id = p_staff_id AND guest_pass_id = v_pass.id AND status <> 'revoked';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.guest_pass_revoke_door_staff(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_pass_revoke_door_staff(text, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.revoke_event_door_staff(p_staff_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ev uuid;
BEGIN
  SELECT event_id INTO v_ev FROM public.event_door_staff WHERE id = p_staff_id;
  IF v_ev IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM 1 FROM public._guest_pass_manager(v_ev);
  UPDATE public.event_door_staff SET status = 'revoked', revoked_at = now() WHERE id = p_staff_id AND status <> 'revoked';
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_event_door_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_event_door_staff(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public._event_door_staff_list(p_event_id uuid, p_pass_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', ds.id, 'name', ds.display_name, 'email', ds.email, 'phone', ds.phone,
           'status', ds.status, 'invited_by_kind', ds.invited_by_kind,
           'guest_name', (SELECT h.guest_name FROM public.event_guest_passes h WHERE h.id = ds.guest_pass_id),
           'created_at', ds.created_at, 'accepted_at', ds.accepted_at
         ) ORDER BY ds.status = 'revoked', ds.created_at), '[]'::jsonb)
    FROM public.event_door_staff ds
   WHERE ds.event_id = p_event_id AND (p_pass_id IS NULL OR ds.guest_pass_id = p_pass_id)
     AND ds.status <> 'revoked';
$$;
REVOKE ALL ON FUNCTION public._event_door_staff_list(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_event_door_staff(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public._guest_pass_manager(p_event_id);
  RETURN public._event_door_staff_list(p_event_id, NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.list_event_door_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_event_door_staff(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. L'email d'invitation (edge, sans JWT pour l'invité : son jeton suffit).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_door_invite_mail(p_staff public.event_door_staff)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'ok', true, 'invite_token', p_staff.token, 'email', p_staff.email, 'phone', p_staff.phone,
    'name', p_staff.display_name, 'event_title', e.title, 'event_start_at', e.start_at,
    'timezone', coalesce(nullif(e.timezone, ''), 'Europe/Paris'),
    'language', coalesce(h.language, 'en'),
    'inviter_name', coalesce(h.guest_name,
                             (SELECT p.display_name FROM public.event_parties(e.id) p WHERE p.party_key = p_staff.invited_by_party),
                             'Yuno'),
    'is_demo', e.id = ANY (public.demo_event_ids()) OR coalesce(public.is_demo_email(p_staff.email), false))
  FROM public.events e
  LEFT JOIN public.event_guest_passes h ON h.id = p_staff.guest_pass_id
  WHERE e.id = p_staff.event_id;
$$;
REVOKE ALL ON FUNCTION public._event_door_invite_mail(public.event_door_staff) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prepare_event_door_invite_email(p_staff_id uuid, p_pass_token text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row  public.event_door_staff%ROWTYPE;
  v_pass public.event_guest_passes%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.event_door_staff WHERE id = p_staff_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF p_pass_token IS NOT NULL THEN
    v_pass := public._guest_pass_live(p_pass_token);
    IF v_row.guest_pass_id IS DISTINCT FROM v_pass.id THEN RAISE EXCEPTION 'forbidden'; END IF;
  ELSE
    PERFORM 1 FROM public._guest_pass_manager(v_row.event_id);
  END IF;
  IF v_row.email IS NULL THEN RAISE EXCEPTION 'no_email'; END IF;
  RETURN public._event_door_invite_mail(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.prepare_event_door_invite_email(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_event_door_invite_email(uuid, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Accepter (lecture du lien par la page, acceptation par l'edge).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_event_door_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.event_door_staff%ROWTYPE;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT * INTO v_row FROM public.event_door_staff WHERE token = p_token;
  IF NOT FOUND OR v_row.status = 'revoked' THEN RETURN jsonb_build_object('found', false); END IF;
  RETURN jsonb_build_object(
    'found', true, 'status', v_row.status, 'name', v_row.display_name,
    'has_email', v_row.email IS NOT NULL,
    'email_hint', CASE WHEN v_row.email IS NOT NULL
                       THEN left(v_row.email, 2) || '•••@' || split_part(v_row.email, '@', 2) END,
    'open', public._event_door_window_open(v_row.event_id)
  ) || (public._event_door_invite_mail(v_row) - 'invite_token' - 'email' - 'phone' - 'ok' - 'is_demo');
END;
$$;
REVOKE ALL ON FUNCTION public.get_event_door_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_door_invite(text) TO anon, authenticated;

-- service_role seul (edge accept-staff-invitation, après la création du compte).
CREATE OR REPLACE FUNCTION public.accept_event_door_invite(p_token text, p_user_id uuid, p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.event_door_staff%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.event_door_staff WHERE token = p_token FOR UPDATE;
  IF NOT FOUND OR v_row.status = 'revoked' THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public._event_door_window_open(v_row.event_id) THEN RAISE EXCEPTION 'event_closed'; END IF;
  IF v_row.status = 'accepted' THEN
    IF v_row.user_id = p_user_id THEN RETURN jsonb_build_object('ok', true, 'event_id', v_row.event_id, 'already', true); END IF;
    RAISE EXCEPTION 'already_accepted';
  END IF;
  IF v_row.email IS NOT NULL AND v_row.email <> lower(btrim(coalesce(p_email, ''))) THEN RAISE EXCEPTION 'email_mismatch'; END IF;
  IF (v_row.event_id = ANY (public.demo_event_ids())) IS DISTINCT FROM public.is_demo_email(p_email) THEN
    RAISE EXCEPTION 'demo_mismatch';
  END IF;
  UPDATE public.event_door_staff
     SET user_id = p_user_id, status = 'accepted', accepted_at = now(), email = coalesce(email, lower(btrim(p_email)))
   WHERE id = v_row.id;
  RETURN jsonb_build_object('ok', true, 'event_id', v_row.event_id);
END;
$$;
REVOKE ALL ON FUNCTION public.accept_event_door_invite(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_event_door_invite(text, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. L'espace de l'invité liste SON équipe à la porte.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_event_guest_space(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass  public.event_guest_passes%ROWTYPE;
  v_ev    record;
  v_close timestamptz;
  v_team  boolean := false;
  v_ctx   record;
  v_count boolean := true;
  v_paul  text;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT * INTO v_pass FROM public.event_guest_passes WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;

  SELECT e.title, e.start_at, e.end_at INTO v_ev FROM public.events e WHERE e.id = v_pass.event_id;
  v_close := coalesce(v_ev.end_at, v_ev.start_at + interval '8 hours') + interval '7 days';
  IF v_pass.revoked_at IS NOT NULL OR now() > v_close THEN
    RETURN jsonb_build_object('found', true, 'closed', true, 'revoked', v_pass.revoked_at IS NOT NULL,
                              'language', v_pass.language, 'guest_name', v_pass.guest_name, 'event_title', v_ev.title);
  END IF;

  v_team := public._guest_pass_is_team(v_pass.event_id);
  IF NOT v_team THEN
    BEGIN
      SELECT * INTO v_ctx FROM public.links_visitor_context();
      IF EXISTS (SELECT 1 FROM public.event_guest_pass_opens o
                  WHERE o.pass_id = v_pass.id AND o.action = 'open' AND o.visitor_hash = v_ctx.o_hash
                    AND o.created_at > now() - interval '30 minutes')
         OR (SELECT count(*) FROM public.event_guest_pass_opens o
              WHERE o.visitor_hash = v_ctx.o_hash AND o.created_at > now() - interval '1 hour') >= 60 THEN
        v_count := false;
      END IF;
      IF v_count THEN
        INSERT INTO public.event_guest_pass_opens (pass_id, visitor_hash, action) VALUES (v_pass.id, v_ctx.o_hash, 'open');
        UPDATE public.event_guest_passes
           SET opened_count = opened_count + 1, first_opened_at = coalesce(first_opened_at, now()), last_opened_at = now()
         WHERE id = v_pass.id
         RETURNING * INTO v_pass;
        IF v_pass.opened_count = 1 THEN
          PERFORM public._guest_pass_alert(v_pass, 'open', 'host_pass_open:' || v_pass.id::text);
        ELSIF v_pass.opened_count = 5 THEN
          PERFORM public._guest_pass_alert(v_pass, 'hot', 'host_pass_hot:' || v_pass.id::text);
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'get_event_guest_space count: %', SQLERRM;
    END;
  END IF;

  SELECT nullif(regexp_replace(coalesce(c.config->>'whatsapp_number', ''), '\D', '', 'g'), '')
    INTO v_paul FROM public.links_page_config c WHERE c.id = 'default';

  RETURN jsonb_build_object(
    'found', true, 'closed', false, 'revoked', false,
    'guest', jsonb_build_object(
      'kind', v_pass.guest_kind, 'name', v_pass.guest_name, 'contact_email', v_pass.contact_email,
      'party', v_pass.guest_party, 'claim_status', v_pass.claim_status,
      'party_name', (SELECT coalesce(v.name, op.display_name) FROM (SELECT 1) one
                       LEFT JOIN public.venues v ON 'venue:' || v.id = v_pass.guest_party
                       LEFT JOIN public.organizer_profiles op ON 'org:' || op.user_id = v_pass.guest_party),
      'places_requested', v_pass.places_requested),
    'language', v_pass.language,
    'show_revenue', v_pass.show_revenue,
    'closes_at', v_close,
    'paul_whatsapp', v_paul,
    'is_team', v_team,
    'is_demo', v_pass.event_id = ANY (public.demo_event_ids()),
    'door_staff', CASE WHEN v_pass.guest_kind = 'venue' THEN public._event_door_staff_list(v_pass.event_id, v_pass.id) END
  ) || public._guest_space_payload(v_pass);
END;
$$;
REVOKE ALL ON FUNCTION public.get_event_guest_space(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_guest_space(text) TO anon, authenticated;
