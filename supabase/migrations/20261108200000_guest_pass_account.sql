-- ============================================================================
-- Espace invité : un COMPTE obligatoire, l'accès rattaché à la personne (21/10)
-- ============================================================================
-- Décision de Paul : l'espace ne s'ouvre plus par un simple lien porteur.
--   • L'invitation (e-mail, WhatsApp, lien copié) porte un JETON D'INVITATION à
--     usage unique, gardé HACHÉ (`event_guest_pass_invites`, 30 jours au plus,
--     jamais après la fermeture de l'espace). Il ne sert qu'à RATTACHER l'accès
--     à un compte Yuno simple (`redeem_event_guest_pass`) : l'adresse de
--     l'invitation exigée quand elle en porte une (`email_mismatch`), sinon le
--     premier compte connecté ; jamais en accès assisté.
--   • Ensuite l'espace vit à une adresse stable, `/invite/<id de l'accès>`,
--     gardée par la session : `_guest_pass_live` (porte de TOUS les gestes
--     `guest_pass_*`) et `get_event_guest_space` lisent l'id et exigent le
--     compte rattaché (l'équipe de l'organisateur peut regarder l'espace, sans
--     geste). Le jeton seul n'ouvre plus rien. Un accès coupé ne s'ouvre plus.
--   • L'organisateur voit le compte rattaché (`account_email`) et peut
--     « Renvoyer une invitation » (`reset_event_guest_pass_access` : compte
--     détaché, invitations éteintes, jeton neuf).
--   • Profil du compte : `get_my_guest_passes`.
--   • Contrat : signé et IBAN donné par le compte rattaché, sans code e-mail
--     (la session de la personne, rattachée à l'adresse de l'invitation, est
--     la preuve ; le code ne prouvait plus rien de plus).
-- Transition : chaque accès existant reçoit une invitation hachée depuis son
-- ancien jeton (le lien déjà envoyé sert à le réclamer une fois).
-- ============================================================================

ALTER TABLE public.event_guest_passes
  ADD COLUMN IF NOT EXISTS account_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS account_email text,
  ADD COLUMN IF NOT EXISTS account_linked_at timestamptz;
CREATE INDEX IF NOT EXISTS event_guest_passes_account_idx ON public.event_guest_passes (account_user_id) WHERE account_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.event_guest_pass_invites (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pass_id    uuid NOT NULL REFERENCES public.event_guest_passes(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_guest_pass_invites_pass_idx ON public.event_guest_pass_invites (pass_id);
ALTER TABLE public.event_guest_pass_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_guest_pass_invites FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public._guest_pass_hash(p_token text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT encode(extensions.digest('guest-pass:' || coalesce(p_token, ''), 'sha256'), 'hex');
$$;
REVOKE ALL ON FUNCTION public._guest_pass_hash(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._guest_pass_close_at(p_event_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(e.end_at, e.start_at + interval '8 hours') + interval '7 days' FROM public.events e WHERE e.id = p_event_id;
$$;
REVOKE ALL ON FUNCTION public._guest_pass_close_at(uuid) FROM PUBLIC, anon, authenticated;

-- Un jeton d'invitation neuf (rendu UNE fois, gardé haché).
CREATE OR REPLACE FUNCTION public._guest_pass_mint_invite(p_pass_id uuid, p_by uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text := encode(extensions.gen_random_bytes(16), 'hex');
  v_event uuid;
BEGIN
  SELECT event_id INTO v_event FROM public.event_guest_passes WHERE id = p_pass_id;
  INSERT INTO public.event_guest_pass_invites (pass_id, token_hash, expires_at, created_by)
  VALUES (p_pass_id, public._guest_pass_hash(v_token),
          least(now() + interval '30 days', coalesce(public._guest_pass_close_at(v_event), now() + interval '30 days')), p_by);
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public._guest_pass_mint_invite(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Transition : l'ancien jeton de chaque accès devient une invitation hachée.
INSERT INTO public.event_guest_pass_invites (pass_id, token_hash, expires_at)
SELECT h.id, public._guest_pass_hash(h.token),
       least(now() + interval '30 days', coalesce(public._guest_pass_close_at(h.event_id), now() + interval '30 days'))
  FROM public.event_guest_passes h
 WHERE h.revoked_at IS NULL
ON CONFLICT (token_hash) DO NOTHING;

-- La porte de tous les gestes : l'id de l'accès + le compte rattaché.
CREATE OR REPLACE FUNCTION public._guest_pass_live(p_token text)
RETURNS public.event_guest_passes
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass public.event_guest_passes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign_in_required'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  IF p_token IS NULL OR p_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  SELECT * INTO v_pass FROM public.event_guest_passes WHERE id = p_token::uuid;
  IF NOT FOUND OR v_pass.revoked_at IS NOT NULL OR v_pass.account_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF now() > public._guest_pass_close_at(v_pass.event_id) THEN RAISE EXCEPTION 'closed'; END IF;
  RETURN v_pass;
END;
$$;
REVOKE ALL ON FUNCTION public._guest_pass_live(text) FROM PUBLIC, anon, authenticated;

-- La page d'une invitation (avant connexion) : ce qu'elle annonce, jamais l'espace.
CREATE OR REPLACE FUNCTION public.get_event_guest_pass_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv  public.event_guest_pass_invites%ROWTYPE;
  v_pass public.event_guest_passes%ROWTYPE;
  v_ev   record;
  v_org  text;
  v_state text;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN RETURN jsonb_build_object('state', 'not_found'); END IF;
  SELECT * INTO v_inv FROM public.event_guest_pass_invites WHERE token_hash = public._guest_pass_hash(p_token);
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'not_found'); END IF;
  SELECT * INTO v_pass FROM public.event_guest_passes WHERE id = v_inv.pass_id;
  SELECT e.title, e.start_at, coalesce(nullif(e.timezone, ''), 'Europe/Paris') AS tz,
         coalesce(e.poster_url, e.image_url) AS poster, e.location_name, e.location_city
    INTO v_ev FROM public.events e WHERE e.id = v_pass.event_id;
  SELECT p.display_name INTO v_org FROM public.event_parties(v_pass.event_id) p WHERE p.party_key = v_pass.created_by_party;
  v_state := CASE
    WHEN v_pass.revoked_at IS NOT NULL THEN 'revoked'
    WHEN now() > public._guest_pass_close_at(v_pass.event_id) THEN 'closed'
    WHEN v_pass.account_user_id IS NOT NULL AND v_pass.account_user_id = auth.uid() THEN 'mine'
    WHEN v_pass.account_user_id IS NOT NULL THEN 'taken'
    WHEN v_inv.used_at IS NOT NULL OR v_inv.expires_at <= now() THEN 'expired'
    ELSE 'valid' END;
  RETURN jsonb_build_object(
    'state', v_state,
    'pass_id', CASE WHEN v_state = 'mine' THEN v_pass.id END,
    'language', v_pass.language, 'guest_name', v_pass.guest_name, 'guest_kind', v_pass.guest_kind,
    'invite_email', CASE WHEN v_state = 'valid' THEN v_pass.contact_email END,
    'inviter_name', coalesce(v_org, 'Yuno'),
    'event_title', v_ev.title, 'event_start_at', v_ev.start_at, 'timezone', v_ev.tz,
    'poster_url', v_ev.poster, 'location_name', v_ev.location_name, 'location_city', v_ev.location_city
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_event_guest_pass_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_guest_pass_invite(text) TO anon, authenticated;

-- Rattacher l'accès au compte connecté (une fois).
CREATE OR REPLACE FUNCTION public.redeem_event_guest_pass(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_inv   public.event_guest_pass_invites%ROWTYPE;
  v_pass  public.event_guest_passes%ROWTYPE;
  v_email text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'sign_in_required'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_inv FROM public.event_guest_pass_invites WHERE token_hash = public._guest_pass_hash(p_token) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_pass FROM public.event_guest_passes WHERE id = v_inv.pass_id FOR UPDATE;
  IF v_pass.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'revoked'; END IF;
  IF now() > public._guest_pass_close_at(v_pass.event_id) THEN RAISE EXCEPTION 'closed'; END IF;
  -- Déjà rattaché à moi : rien à faire (lien rouvert).
  IF v_pass.account_user_id = v_uid THEN
    RETURN jsonb_build_object('ok', true, 'pass_id', v_pass.id, 'already', true);
  END IF;
  IF v_pass.account_user_id IS NOT NULL THEN RAISE EXCEPTION 'already_linked'; END IF;
  IF v_inv.used_at IS NOT NULL OR v_inv.expires_at <= now() THEN RAISE EXCEPTION 'invite_expired'; END IF;
  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_uid;
  IF v_pass.contact_email IS NOT NULL AND v_pass.contact_email IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'email_mismatch';
  END IF;
  IF (v_pass.event_id = ANY (public.demo_event_ids())) IS DISTINCT FROM public.is_demo_email(v_email) THEN
    RAISE EXCEPTION 'demo_mismatch';
  END IF;
  UPDATE public.event_guest_passes
     SET account_user_id = v_uid, account_email = v_email, account_linked_at = now()
   WHERE id = v_pass.id;
  UPDATE public.event_guest_pass_invites SET used_at = now() WHERE pass_id = v_pass.id AND used_at IS NULL;
  RETURN jsonb_build_object('ok', true, 'pass_id', v_pass.id);
END;
$$;
REVOKE ALL ON FUNCTION public.redeem_event_guest_pass(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_event_guest_pass(text) TO authenticated;

-- Les accès du compte connecté (cartes du profil, accueil Yuno Pro).
CREATE OR REPLACE FUNCTION public.get_my_guest_passes()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'pass_id', h.id, 'guest_name', h.guest_name, 'guest_kind', h.guest_kind,
           'event_title', e.title, 'event_start_at', e.start_at,
           'poster_url', coalesce(e.poster_url, e.image_url),
           'inviter_name', (SELECT p.display_name FROM public.event_parties(h.event_id) p WHERE p.party_key = h.created_by_party))
         ORDER BY e.start_at), '[]'::jsonb)
    FROM public.event_guest_passes h
    JOIN public.events e ON e.id = h.event_id
   WHERE auth.uid() IS NOT NULL AND h.account_user_id = auth.uid() AND h.revoked_at IS NULL
     AND now() <= coalesce(e.end_at, e.start_at + interval '8 hours') + interval '7 days';
$$;
REVOKE ALL ON FUNCTION public.get_my_guest_passes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_guest_passes() TO authenticated;

-- Le lien à partager (copier / WhatsApp) : l'espace s'il est rattaché, sinon une invitation neuve.
CREATE OR REPLACE FUNCTION public.get_event_guest_pass_link(p_pass_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.event_guest_passes%ROWTYPE;
  v_me  record;
BEGIN
  SELECT * INTO v_row FROM public.event_guest_passes WHERE id = p_pass_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_me FROM public._guest_pass_manager(v_row.event_id);
  IF v_me.level < 2 THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_row.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'revoked'; END IF;
  IF v_row.account_user_id IS NOT NULL THEN
    RETURN jsonb_build_object('linked', true, 'pass_id', v_row.id, 'account_email', v_row.account_email);
  END IF;
  RETURN jsonb_build_object('linked', false, 'pass_id', v_row.id, 'token', public._guest_pass_mint_invite(v_row.id, auth.uid()));
END;
$$;
REVOKE ALL ON FUNCTION public.get_event_guest_pass_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_guest_pass_link(uuid) TO authenticated;

-- « Renvoyer une invitation » : le compte est détaché, les invitations éteintes, un jeton neuf.
CREATE OR REPLACE FUNCTION public.reset_event_guest_pass_access(p_pass_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.event_guest_passes%ROWTYPE;
  v_me  record;
BEGIN
  SELECT * INTO v_row FROM public.event_guest_passes WHERE id = p_pass_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_me FROM public._guest_pass_manager(v_row.event_id);
  IF v_me.level < 2 THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_row.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'revoked'; END IF;
  UPDATE public.event_guest_passes SET account_user_id = NULL, account_email = NULL, account_linked_at = NULL WHERE id = p_pass_id;
  UPDATE public.event_guest_pass_invites SET used_at = coalesce(used_at, now()) WHERE pass_id = p_pass_id;
  RETURN jsonb_build_object('ok', true, 'pass_id', p_pass_id, 'token', public._guest_pass_mint_invite(p_pass_id, auth.uid()));
END;
$$;
REVOKE ALL ON FUNCTION public.reset_event_guest_pass_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_event_guest_pass_access(uuid) TO authenticated;

-- Le contrat se signe et l'IBAN se donne par le compte rattaché, sans code e-mail.
DROP FUNCTION IF EXISTS public.guest_pass_sign_contract(text, text, text, integer);
CREATE OR REPLACE FUNCTION public.guest_pass_sign_contract(p_token text, p_signer_name text, p_version integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass  public.event_guest_passes%ROWTYPE;
  v_name  text := left(btrim(regexp_replace(coalesce(p_signer_name, ''), '\s+', ' ', 'g')), 120);
  v_ctx   record;
  v_title text;
BEGIN
  v_pass := public._guest_pass_live(p_token);
  IF v_pass.contract_status IS DISTINCT FROM 'proposed' THEN RAISE EXCEPTION 'nothing_to_sign'; END IF;
  IF p_version IS DISTINCT FROM v_pass.contract_version THEN RAISE EXCEPTION 'contract_changed'; END IF;
  IF char_length(v_name) < 3 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  SELECT * INTO v_ctx FROM public.links_visitor_context();
  UPDATE public.event_guest_passes SET
    contract_status = 'signed', contract_signed_at = now(), contract_signer_name = v_name,
    contract_signer_email = account_email,
    contract_sign_evidence = jsonb_build_object('user_id', auth.uid(), 'account_email', account_email,
                                                'visitor_hash', v_ctx.o_hash, 'device', v_ctx.o_device,
                                                'country', v_ctx.o_country, 'version', contract_version, 'hash', contract_hash)
  WHERE id = v_pass.id
  RETURNING * INTO v_pass;
  SELECT e.title INTO v_title FROM public.events e WHERE e.id = v_pass.event_id;
  PERFORM public.notify_coorg_party(v_pass.created_by_party, v_pass.event_id, 'guest_pass_contract_signed',
    'Contrat signé par ton invité',
    v_pass.guest_name || ' a signé le contrat de « ' || coalesce(v_title, 'la soirée') || ' » (' || v_name || ').',
    v_pass.id, 'guest_pass_signed:' || v_pass.id::text || ':' || v_pass.contract_version, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true, 'signed_at', v_pass.contract_signed_at);
END;
$$;
REVOKE ALL ON FUNCTION public.guest_pass_sign_contract(text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guest_pass_sign_contract(text, text, integer) TO authenticated;

DROP FUNCTION IF EXISTS public.guest_pass_set_iban(text, text, text, text);
CREATE OR REPLACE FUNCTION public.guest_pass_set_iban(p_token text, p_iban text, p_holder text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass   public.event_guest_passes%ROWTYPE;
  v_iban   text := upper(regexp_replace(coalesce(p_iban, ''), '[^A-Za-z0-9]', '', 'g'));
  v_holder text := left(btrim(coalesce(p_holder, '')), 120);
BEGIN
  v_pass := public._guest_pass_live(p_token);
  IF v_pass.contract_status IS DISTINCT FROM 'signed' THEN RAISE EXCEPTION 'contract_not_signed'; END IF;
  IF v_iban !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$' THEN RAISE EXCEPTION 'invalid_iban'; END IF;
  IF char_length(v_holder) < 2 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  IF v_pass.transfer_status IN ('sent', 'received') THEN RAISE EXCEPTION 'transfer_already_sent'; END IF;
  IF NOT public._guest_pass_note(v_pass.id, 'iban', interval '1 minute') THEN RAISE EXCEPTION 'too_many_actions'; END IF;
  UPDATE public.event_guest_passes SET guest_iban = v_iban, guest_iban_holder = v_holder, guest_iban_set_at = now() WHERE id = v_pass.id;
  PERFORM public.notify_coorg_party(v_pass.created_by_party, v_pass.event_id, 'guest_pass_iban',
    'IBAN de ton invité renseigné', v_pass.guest_name || ' a renseigné son IBAN de réception.',
    v_pass.id, 'guest_pass_iban:' || v_pass.id::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'), '{}'::jsonb);
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.guest_pass_set_iban(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guest_pass_set_iban(text, text, text) TO authenticated;

-- Plus de code e-mail pour l'invité.
DROP FUNCTION IF EXISTS public.issue_guest_pass_code(text, text);
DROP FUNCTION IF EXISTS public._guest_pass_use_code(uuid, text, text);

CREATE OR REPLACE FUNCTION public.get_event_guest_space(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pass  public.event_guest_passes%ROWTYPE;
  v_ev    record;
  v_close timestamptz;
  v_team  boolean := false;
  v_ctx   record;
  v_count boolean := true;
  v_paul  text;
BEGIN
  -- p_token = l'ID de l'accès (adresse /invite/<id>). Le jeton d'invitation
  -- n'ouvre plus rien ici : il sert seulement à rattacher l'accès à un compte
  -- (redeem_event_guest_pass). Ouvre : le compte rattaché, ou l'équipe de
  -- l'organisateur (aperçu, lecture).
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('found', false, 'sign_in', true); END IF;
  IF p_token IS NULL OR p_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  SELECT * INTO v_pass FROM public.event_guest_passes WHERE id = p_token::uuid;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  IF v_pass.account_user_id IS DISTINCT FROM auth.uid() AND NOT public._guest_pass_is_team(v_pass.event_id) THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT e.title, e.start_at, e.end_at INTO v_ev FROM public.events e WHERE e.id = v_pass.event_id;
  v_close := coalesce(v_ev.end_at, v_ev.start_at + interval '8 hours') + interval '7 days';
  IF v_pass.revoked_at IS NOT NULL OR now() > v_close THEN
    RETURN jsonb_build_object('found', true, 'closed', true, 'revoked', v_pass.revoked_at IS NOT NULL,
                              'language', v_pass.language, 'guest_name', v_pass.guest_name, 'event_title', v_ev.title);
  END IF;

  -- Contrat d'invité : le décompte se fige 48 h après la fin (une fois).
  IF public._guest_pass_freeze_if_due(v_pass.id) THEN
    SELECT * INTO v_pass FROM public.event_guest_passes WHERE id = v_pass.id;
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
    'found', true, 'closed', false, 'revoked', false, 'pass_id', v_pass.id,
    'guest', jsonb_build_object(
      'kind', v_pass.guest_kind, 'name', v_pass.guest_name, 'contact_email', v_pass.contact_email,
      'party', v_pass.guest_party, 'claim_status', v_pass.claim_status,
      'party_name', (SELECT coalesce(v.name, op.display_name) FROM (SELECT 1) one
                       LEFT JOIN public.venues v ON 'venue:' || v.id = v_pass.guest_party
                       LEFT JOIN public.organizer_profiles op ON 'org:' || op.user_id = v_pass.guest_party),
      'places_requested', v_pass.places_requested, 'door_mode', v_pass.door_mode,
      'account_email', CASE WHEN v_pass.account_user_id = auth.uid() THEN v_pass.account_email END),
    'language', v_pass.language,
    'show_revenue', v_pass.show_revenue,
    'closes_at', v_close,
    'paul_whatsapp', v_paul,
    'is_team', v_team,
    'is_demo', v_pass.event_id = ANY (public.demo_event_ids()),
    'door_staff', CASE WHEN v_pass.guest_kind = 'venue' THEN public._event_door_staff_list(v_pass.event_id, v_pass.id) END
  ) || public._guest_space_payload(v_pass);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_event_guest_passes(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me record;
BEGIN
  SELECT * INTO v_me FROM public._guest_pass_manager(p_event_id);
  PERFORM public._guest_pass_freeze_if_due(h.id) FROM public.event_guest_passes h
   WHERE h.event_id = p_event_id AND h.contract_status = 'signed' AND h.statement_frozen_at IS NULL;
  RETURN jsonb_build_object(
    'ok', true,
    'can_show_revenue', v_me.level >= 3,
    'passes', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', h.id, 'guest_kind', h.guest_kind, 'guest_name', h.guest_name,
               'contact_email', h.contact_email, 'contact_phone', h.contact_phone,
               'language', h.language, 'show_revenue', h.show_revenue,
               'opened_count', h.opened_count, 'first_opened_at', h.first_opened_at, 'last_opened_at', h.last_opened_at,
               'email_sent_count', h.email_sent_count, 'email_sent_at', h.email_sent_at,
               'signup_clicks', h.signup_clicks, 'revoked', h.revoked_at IS NOT NULL, 'created_at', h.created_at,
               'share_tickets_pct', h.share_tickets_pct, 'share_tables_pct', h.share_tables_pct,
               'statement_response', h.statement_response, 'statement_reason', h.statement_reason,
               'statement_responded_at', h.statement_responded_at,
               'places_requested', h.places_requested, 'places_requested_at', h.places_requested_at,
               'guest_list', (SELECT jsonb_build_object('places', gl.quota,
                                'registered', (SELECT count(*) FROM public.guest_list_entries g
                                                WHERE g.guest_list_id = gl.id AND g.status <> 'cancelled'))
                                FROM public.guest_lists gl WHERE gl.guest_pass_id = h.id),
               'links', (SELECT count(*) FROM public.tracked_links tl WHERE tl.guest_pass_id = h.id),
               'link_clicks', (SELECT coalesce(sum(tl.clicks_count), 0) FROM public.tracked_links tl WHERE tl.guest_pass_id = h.id),
               'link_sales', (SELECT count(*) FROM public.tickets t JOIN public.tracked_links tl ON tl.id = t.tracked_link_id
                               WHERE tl.guest_pass_id = h.id AND t.status IN ('paid', 'used'))
                           + (SELECT count(*) FROM public.table_reservations r JOIN public.tracked_links tl ON tl.id = r.tracked_link_id
                               WHERE tl.guest_pass_id = h.id AND r.status IN ('paid', 'confirmed')),
               'contract_status', h.contract_status, 'contract_terms', h.contract_terms,
               'contract_version', h.contract_version, 'contract_signed_at', h.contract_signed_at,
               'contract_signer_name', h.contract_signer_name, 'contract_signer_email', h.contract_signer_email,
               'statement_frozen_at', h.statement_frozen_at,
               'guest_iban', CASE WHEN v_me.level >= 3 THEN h.guest_iban END, 'guest_iban_holder', CASE WHEN v_me.level >= 3 THEN h.guest_iban_holder END,
               'transfer_reference', h.transfer_reference, 'transfer_status', h.transfer_status,
               'transfer_amount', CASE WHEN v_me.level >= 3 THEN h.transfer_amount END,
               'transfer_due_at', h.transfer_due_at, 'transfer_sent_at', h.transfer_sent_at,
               'transfer_received_at', h.transfer_received_at, 'transfer_dispute_reason', h.transfer_dispute_reason
             ) || jsonb_build_object(
               -- (deux objets : jsonb_build_object s'arrête à 100 arguments)
               'door_mode', h.door_mode,
               'account_email', h.account_email, 'account_linked_at', h.account_linked_at,
               'invite_pending', h.account_user_id IS NULL AND EXISTS (
                 SELECT 1 FROM public.event_guest_pass_invites i
                  WHERE i.pass_id = h.id AND i.used_at IS NULL AND i.expires_at > now()),
               'guest_party', h.guest_party, 'claim_status', h.claim_status, 'claimed_at', h.claimed_at,
               'guest_party_name', (SELECT coalesce(v.name, op.display_name) FROM (SELECT 1) one
                                      LEFT JOIN public.venues v ON 'venue:' || v.id = h.guest_party
                                      LEFT JOIN public.organizer_profiles op ON 'org:' || op.user_id = h.guest_party),
               'guest_is_party', h.guest_party IS NOT NULL AND EXISTS (
                 SELECT 1 FROM public.event_parties(p_event_id) p WHERE p.party_key = h.guest_party),
               'guest_invited', h.guest_party IS NOT NULL AND EXISTS (
                 SELECT 1 FROM public.event_cohosts c
                  WHERE c.event_id = p_event_id AND c.status = 'pending'
                    AND ('venue:' || c.venue_id = h.guest_party OR 'org:' || c.organizer_user_id = h.guest_party))
             ) ORDER BY h.revoked_at IS NOT NULL, h.created_at DESC)
        FROM public.event_guest_passes h
       WHERE h.event_id = p_event_id
    ), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_event_guest_pass(p_event_id uuid, p_guest_kind text, p_guest_name text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_language text DEFAULT 'en'::text, p_show_revenue boolean DEFAULT true, p_guest_list_places integer DEFAULT NULL::integer, p_share_tickets_pct numeric DEFAULT NULL::numeric, p_share_tables_pct numeric DEFAULT NULL::numeric, p_guest_party text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_me    record;
  v_ev    record;
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_name  text := btrim(regexp_replace(coalesce(p_guest_name, ''), '\s+', ' ', 'g'));
  v_lang  text := CASE WHEN p_language IN ('en', 'fr', 'es') THEN p_language ELSE 'en' END;
  v_money boolean;
  v_row   public.event_guest_passes%ROWTYPE;
  v_org_email text;
  v_org_phone text;
BEGIN
  SELECT * INTO v_me FROM public._guest_pass_manager(p_event_id);
  IF p_guest_kind NOT IN ('venue', 'org') THEN RAISE EXCEPTION 'invalid_kind'; END IF;

  SELECT * INTO v_ev FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF v_ev.cancelled_at IS NOT NULL OR coalesce(v_ev.end_at, v_ev.start_at + interval '8 hours') < now() THEN
    RAISE EXCEPTION 'event_closed';
  END IF;
  IF char_length(v_name) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  IF v_email IS NULL AND v_phone IS NULL THEN RAISE EXCEPTION 'contact_required'; END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'invalid_email'; END IF;
  IF v_phone IS NOT NULL AND (char_length(v_phone) > 40 OR regexp_replace(v_phone, '\D', '', 'g') !~ '^\d{6,15}$') THEN
    RAISE EXCEPTION 'invalid_phone';
  END IF;
  IF v_email IS NOT NULL
     AND (p_event_id = ANY (public.demo_event_ids())) IS DISTINCT FROM public.is_demo_email(v_email) THEN
    RAISE EXCEPTION 'demo_mismatch';
  END IF;
  IF p_guest_party IS NOT NULL THEN
    IF split_part(p_guest_party, ':', 1) <> (CASE p_guest_kind WHEN 'venue' THEN 'venue' ELSE 'org' END)
       OR (p_guest_kind = 'venue' AND NOT EXISTS (SELECT 1 FROM public.venues v WHERE 'venue:' || v.id = p_guest_party AND v.decommissioned_at IS NULL))
       OR (p_guest_kind = 'org' AND NOT EXISTS (SELECT 1 FROM public.organizer_profiles op WHERE 'org:' || op.user_id = p_guest_party)) THEN
      RAISE EXCEPTION 'invalid_party';
    END IF;
    IF p_guest_party = v_me.party_key THEN RAISE EXCEPTION 'invalid_party'; END IF;
    IF (p_event_id = ANY (public.demo_event_ids())) IS DISTINCT FROM public.coorg_party_is_demo(
         split_part(p_guest_party, ':', 1),
         (CASE WHEN p_guest_kind = 'venue' THEN substr(p_guest_party, 7) END),
         (CASE WHEN p_guest_kind = 'org' THEN substr(p_guest_party, 5)::uuid END)) THEN
      RAISE EXCEPTION 'demo_mismatch';
    END IF;
  END IF;
  IF (SELECT count(*) FROM public.event_guest_passes h WHERE h.event_id = p_event_id AND h.revoked_at IS NULL) >= 8 THEN
    RAISE EXCEPTION 'too_many_guest_passes';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_guest_passes h
              WHERE h.event_id = p_event_id AND h.revoked_at IS NULL AND lower(h.guest_name) = lower(v_name)) THEN
    RAISE EXCEPTION 'already_invited';
  END IF;

  v_money := coalesce(p_show_revenue, true) AND v_me.level >= 3;
  SELECT u.email INTO v_org_email FROM auth.users u WHERE u.id = v_uid;
  v_org_phone := nullif(btrim(coalesce((SELECT pr.phone FROM public.profiles pr WHERE pr.id = v_uid), '')), '');

  INSERT INTO public.event_guest_passes (event_id, guest_kind, guest_name, contact_email, contact_phone, language, token,
                                         show_revenue, organizer_contact_email, organizer_contact_phone,
                                         created_by, created_by_party, guest_party,
                                         share_tickets_pct, share_tables_pct)
  VALUES (p_event_id, p_guest_kind, v_name, v_email, v_phone, v_lang, repeat('0', 32), v_money,
          left(v_org_email, 254), left(v_org_phone, 40), v_uid, v_me.party_key, p_guest_party,
          CASE WHEN v_me.level >= 3 THEN p_share_tickets_pct END,
          CASE WHEN v_me.level >= 3 THEN p_share_tables_pct END)
  RETURNING * INTO v_row;

  UPDATE public.event_guest_passes SET tracked_link_id = public._guest_pass_add_link(v_row, 'direct', v_uid)
   WHERE id = v_row.id
   RETURNING * INTO v_row;
  PERFORM public._guest_pass_set_places(v_row, p_guest_list_places);

  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'token', public._guest_pass_mint_invite(v_row.id, v_uid),
                            'show_revenue', v_row.show_revenue, 'language', v_row.language);
END;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_event_guest_pass_email(p_pass_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.event_guest_passes%ROWTYPE;
  v_ev  record;
  v_org text;
  v_token text;
BEGIN
  SELECT * INTO v_row FROM public.event_guest_passes WHERE id = p_pass_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM 1 FROM public._guest_pass_manager(v_row.event_id);
  IF v_row.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'revoked'; END IF;
  IF v_row.contact_email IS NULL THEN RAISE EXCEPTION 'no_email'; END IF;
  IF v_row.email_sent_count >= 5 THEN RAISE EXCEPTION 'too_many_emails'; END IF;
  IF v_row.email_sent_at > now() - interval '10 minutes' THEN RAISE EXCEPTION 'email_too_soon'; END IF;

  SELECT e.title, e.start_at, coalesce(nullif(e.timezone, ''), 'Europe/Paris') AS tz,
         coalesce(e.poster_url, e.image_url) AS poster, e.location_name, e.location_city
    INTO v_ev FROM public.events e WHERE e.id = v_row.event_id;
  SELECT p.display_name INTO v_org FROM public.event_parties(v_row.event_id) p WHERE p.party_key = v_row.created_by_party;

  UPDATE public.event_guest_passes SET email_sent_count = email_sent_count + 1, email_sent_at = now() WHERE id = p_pass_id;
  -- Rattaché : l'e-mail mène à l'espace (adresse stable). Sinon : un jeton neuf
  -- d'invitation, à usage unique, qui n'ouvre que la réclamation.
  IF v_row.account_user_id IS NULL THEN v_token := public._guest_pass_mint_invite(v_row.id, auth.uid()); END IF;

  RETURN jsonb_build_object(
    'ok', true, 'token', v_token, 'pass_id', v_row.id, 'linked', v_row.account_user_id IS NOT NULL, 'email', v_row.contact_email, 'language', v_row.language,
    'guest_kind', v_row.guest_kind, 'guest_name', v_row.guest_name, 'inviter_name', coalesce(v_org, 'Yuno'),
    'event_title', v_ev.title, 'event_start_at', v_ev.start_at, 'timezone', v_ev.tz,
    'poster_url', v_ev.poster, 'contract_status', v_row.contract_status, 'location_name', v_ev.location_name, 'location_city', v_ev.location_city,
    'is_demo', v_row.event_id = ANY (public.demo_event_ids()) OR public.is_demo_email(v_row.contact_email)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_event_guest_pass(p_token text, p_party text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_pass   public.event_guest_passes%ROWTYPE;
  v_ev     record;
  v_party  text;
  v_pname  text;
  v_email  text;
  v_cohost uuid;
  v_status text;
  v_venue  text;
  v_org    uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  -- p_token = l'ID de l'accès ; seul le compte rattaché ouvre son compte pro depuis l'espace.
  v_pass := public._guest_pass_live(p_token);
  PERFORM 1 FROM public.event_guest_passes WHERE id = v_pass.id FOR UPDATE;

  -- La partie de l'appelant, du bon type : son club, ou son organisation.
  IF v_pass.guest_kind = 'venue' THEN
    SELECT v.id, v.name INTO v_venue, v_pname FROM public.venues v
     WHERE v.owner_id = v_uid AND v.decommissioned_at IS NULL
       AND (p_party IS NULL OR 'venue:' || v.id = p_party)
     ORDER BY v.created_at LIMIT 1;
    IF v_venue IS NULL THEN RAISE EXCEPTION 'no_venue'; END IF;
    v_party := 'venue:' || v_venue;
  ELSE
    SELECT op.user_id, op.display_name INTO v_org, v_pname FROM public.organizer_profiles op
     WHERE (op.user_id = v_uid OR public.is_org_team_member(v_uid, op.user_id, 'admin'))
       AND (p_party IS NULL OR 'org:' || op.user_id = p_party)
     ORDER BY (op.user_id = v_uid) DESC LIMIT 1;
    IF v_org IS NULL THEN RAISE EXCEPTION 'no_organization'; END IF;
    v_party := 'org:' || v_org;
  END IF;

  IF (v_pass.event_id = ANY (public.demo_event_ids())) IS DISTINCT FROM
     public.coorg_party_is_demo(split_part(v_party, ':', 1), v_venue, v_org) THEN
    RAISE EXCEPTION 'demo_mismatch';
  END IF;
  IF v_pass.guest_party IS NOT NULL AND v_pass.guest_party <> v_party THEN RAISE EXCEPTION 'already_claimed'; END IF;
  IF v_party = v_pass.created_by_party THEN RAISE EXCEPTION 'already_party'; END IF;

  SELECT e.end_at, e.start_at, e.cancelled_at INTO v_ev FROM public.events e WHERE e.id = v_pass.event_id;
  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_uid;

  IF EXISTS (SELECT 1 FROM public.event_parties(v_pass.event_id) p WHERE p.party_key = v_party) THEN
    v_status := 'accepted';
  ELSIF v_ev.cancelled_at IS NOT NULL OR coalesce(v_ev.end_at, v_ev.start_at + interval '8 hours') < now() THEN
    v_status := 'recorded';
  ELSIF v_pass.contact_email IS NOT NULL AND v_pass.contact_email = v_email
        AND (SELECT count(*) FROM public.event_cohosts c
              WHERE c.event_id = v_pass.event_id AND c.status IN ('pending', 'accepted')) < 8 THEN
    SELECT c.id INTO v_cohost FROM public.event_cohosts c
     WHERE c.event_id = v_pass.event_id AND c.status = 'pending'
       AND (c.venue_id = v_venue OR c.organizer_user_id = v_org) LIMIT 1;
    IF v_cohost IS NULL THEN
      INSERT INTO public.event_cohosts (event_id, venue_id, organizer_user_id, access, share_crm, invited_by, invited_by_party, role)
      VALUES (v_pass.event_id, v_venue, v_org, 'viewer', false, v_pass.created_by, v_pass.created_by_party, 'cohost')
      RETURNING id INTO v_cohost;
    END IF;
    PERFORM public.respond_event_cohost_invitation(v_cohost, true);
    v_status := 'accepted';
  ELSE
    v_status := 'pending';
    PERFORM public.notify_coorg_party(v_pass.created_by_party, v_pass.event_id, 'host_pass_claimed',
      'Un invité a ouvert son compte',
      v_pname || ' a ouvert son compte Yuno depuis son espace « ' || v_pass.guest_name
        || ' ». Ajoute-le en partenaire de la soirée depuis la page Co-organisation.',
      v_pass.id, 'host_pass_claimed:' || v_pass.id::text, '{}'::jsonb);
  END IF;

  UPDATE public.event_guest_passes
     SET guest_party = v_party, claimed_by = v_uid, claimed_at = coalesce(claimed_at, now()), claim_status = v_status
   WHERE id = v_pass.id
   RETURNING * INTO v_pass;
  PERFORM public._guest_pass_alert(v_pass, 'claimed', 'host_pass_claimed:' || v_pass.id::text);

  RETURN jsonb_build_object('ok', true, 'status', v_status, 'event_id', v_pass.event_id, 'party', v_party);
END;
$function$;

CREATE OR REPLACE FUNCTION public.track_event_guest_pass(p_token text, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pass public.event_guest_passes%ROWTYPE;
BEGIN
  IF p_action NOT IN ('signup', 'whatsapp', 'copy', 'share') THEN RETURN; END IF;
  v_pass := public._guest_pass_live(p_token);
  IF public._guest_pass_is_team(v_pass.event_id) THEN RETURN; END IF;
  IF NOT public._guest_pass_note(v_pass.id, p_action, interval '10 minutes') THEN RETURN; END IF;
  UPDATE public.event_guest_passes SET
    signup_clicks   = signup_clicks + CASE WHEN p_action = 'signup' THEN 1 ELSE 0 END,
    whatsapp_clicks = whatsapp_clicks + CASE WHEN p_action = 'whatsapp' THEN 1 ELSE 0 END,
    link_copies     = link_copies + CASE WHEN p_action IN ('copy', 'share') THEN 1 ELSE 0 END
  WHERE id = v_pass.id
  RETURNING * INTO v_pass;
  IF p_action = 'signup' THEN
    PERFORM public._guest_pass_alert(v_pass, 'signup', 'host_pass_signup:' || v_pass.id::text);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RETURN;
END;
$function$;

-- Plus aucun geste ni lecture d'espace pour un visiteur anonyme : la session du compte rattaché.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname IN ('get_event_guest_space', 'guest_pass_add_guest', 'guest_pass_remove_guest',
                                'guest_pass_request_places', 'guest_pass_create_link', 'guest_pass_statement_response',
                                'guest_pass_invite_door_staff', 'guest_pass_revoke_door_staff', 'guest_pass_confirm_transfer',
                                'track_event_guest_pass', 'claim_event_guest_pass', 'prepare_event_door_invite_email')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
  END LOOP;
END $$;
