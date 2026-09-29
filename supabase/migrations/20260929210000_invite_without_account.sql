-- Inviter une structure qui n'a PAS de compte Yuno (point 5, 2026-09-29).
--
-- A. Collab — club → organisateur externe (organizer_claim_invitations).
--    L'acceptation promouvait le profil en organisateur mais ne créait JAMAIS
--    la ligne organizer_profiles : le club voyait « Un organisateur », la
--    Console Organisateur s'ouvrait sans identité, et invite_event_cohost
--    refusait ce compte (organizer_not_found). Et l'invitation ne portait pas
--    de deal : la soirée était rattachée sans contrat. Désormais, comme dans
--    le sens organisateur → club (accept-club-collab-invitation) :
--      • l'identité organisateur est créée (nom de l'invitation) ;
--      • avec une soirée ET des conditions, le contrat s'ouvre PRÉ-SIGNÉ par
--        le club (Stripe OUI/NON compris : `settlement` voyage dans les
--        règles et est normalisé par le trigger du contrat) ; l'organisateur
--        n'a plus qu'à signer ;
--      • un compte démo n'invite qu'un compte démo.
--
-- B. Co-organisation — inviter par EMAIL une structure absente de Yuno.
--    `event_cohost_email_invites` : une ligne par invitation, jeton dans
--    l'email. Seul le destinataire (même adresse, compte créé ou existant)
--    accepte ; il rejoint la soirée comme co-hôte au titre de SON espace
--    organisateur (créé s'il n'en a pas), ou d'un club qu'il possède, ou d'une
--    organisation dont il est admin. Mêmes gardes que invite_event_cohost
--    (partie principale niveau ≥ 2, soirée ouverte, 8 co-hôtes max, démo ↔
--    démo) ; jamais en session d'accès assisté. Tables sans policy : tout passe
--    par les RPC.

-- ═══════════════════════════ A. collab club → orga ═══════════════════════════
CREATE OR REPLACE FUNCTION public.get_organizer_claim_invitation(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  inv RECORD;
BEGIN
  SELECT i.id, i.organizer_email, i.organizer_name, i.contact_first_name,
         i.contact_last_name, i.invitation_message, i.inviting_venue_id,
         i.event_id, i.status, i.expires_at, i.default_split_rules
    INTO inv
    FROM organizer_claim_invitations i
   WHERE i.token = p_token
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', inv.id,
    'organizer_email', inv.organizer_email,
    'organizer_name', inv.organizer_name,
    'contact_first_name', inv.contact_first_name,
    'contact_last_name', inv.contact_last_name,
    'invitation_message', inv.invitation_message,
    'inviting_venue_id', inv.inviting_venue_id,
    'event_id', inv.event_id,
    'status', inv.status,
    'expires_at', inv.expires_at,
    -- Le deal proposé : le destinataire lit ce qu'on lui propose AVANT d'accepter.
    'split_rules', CASE WHEN inv.event_id IS NOT NULL THEN inv.default_split_rules END,
    'venue', (
      SELECT jsonb_build_object('id', v.id, 'name', v.name, 'city', v.city, 'logo_url', v.logo_url)
        FROM venues v WHERE v.id = inv.inviting_venue_id
    ),
    'event', (
      SELECT jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at)
        FROM events e WHERE e.id = inv.event_id
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.accept_organizer_claim_invitation(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  inv RECORD;
  v_org_name text;
  v_partnership uuid;
  v_ev RECORD;
  v_rules jsonb;
  v_contract uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'support_session_forbidden';
  END IF;

  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_uid;

  SELECT * INTO inv
    FROM organizer_claim_invitations
   WHERE token = p_token
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_not_found';
  END IF;
  IF inv.status <> 'pending' THEN
    RAISE EXCEPTION 'invitation_not_pending';
  END IF;
  IF inv.expires_at < now() THEN
    UPDATE organizer_claim_invitations SET status = 'expired', updated_at = now()
     WHERE id = inv.id;
    RAISE EXCEPTION 'invitation_expired';
  END IF;
  -- Anti-détournement de lien : seul le destinataire de l'email peut accepter
  -- (même règle que accept-club-collab-invitation côté club).
  IF v_email IS NULL OR v_email <> lower(inv.organizer_email) THEN
    RAISE EXCEPTION 'email_mismatch';
  END IF;

  v_org_name := COALESCE(
    NULLIF(btrim(inv.organizer_name), ''),
    NULLIF(trim(COALESCE(inv.contact_first_name, '') || ' ' || COALESCE(inv.contact_last_name, '')), ''),
    split_part(v_email, '@', 1)
  );

  -- 1. Promotion du profil en organisateur — jamais pour un compte déjà pro
  --    d'un autre type (un owner de club garde son type ; il gagne le rôle).
  UPDATE profiles
     SET profile_type = CASE WHEN profile_type = 'club'::public.profile_type
                             THEN 'organizer'::public.profile_type ELSE profile_type END,
         organization_name = COALESCE(organization_name, v_org_name),
         first_name = COALESCE(first_name, inv.contact_first_name),
         last_name = COALESCE(last_name, inv.contact_last_name)
   WHERE id = v_uid;

  -- 2. Identité organisateur (lue par le club, les contrats, la co-organisation)
  --    et rôle.
  INSERT INTO organizer_profiles (user_id, display_name)
  VALUES (v_uid, v_org_name)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO user_roles (user_id, role, email)
  VALUES (v_uid, 'organizer', v_email)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- 3. Partenariat actif club ↔ orga.
  INSERT INTO venue_organizer_partnerships
    (venue_id, organizer_user_id, status, initiated_by, accepted_at,
     invitation_message, default_split_rules)
  VALUES
    (inv.inviting_venue_id, v_uid, 'active', 'venue', now(),
     inv.invitation_message, COALESCE(inv.default_split_rules,
       '{"tickets":{"organizer_pct":100,"venue_pct":0},"tables":{"organizer_pct":0,"venue_pct":100},"drinks":{"organizer_pct":0,"venue_pct":100}}'::jsonb))
  ON CONFLICT DO NOTHING;

  UPDATE venue_organizer_partnerships
     SET status = 'active', accepted_at = COALESCE(accepted_at, now())
   WHERE venue_id = inv.inviting_venue_id
     AND organizer_user_id = v_uid
     AND status = 'pending';

  SELECT id INTO v_partnership FROM venue_organizer_partnerships
   WHERE venue_id = inv.inviting_venue_id AND organizer_user_id = v_uid
   ORDER BY (status = 'active') DESC, created_at DESC LIMIT 1;

  -- 4. Rattachement de la soirée + contrat pré-signé par le club.
  IF inv.event_id IS NOT NULL THEN
    UPDATE events
       SET partner_organizer_id = v_uid,
           event_mode = CASE
             WHEN event_mode IS NULL OR event_mode IN ('solo_venue', 'solo_organizer')
               THEN 'co_event'
             ELSE event_mode
           END
     WHERE id = inv.event_id
       AND partner_organizer_id IS NULL
       AND organizer_user_id IS NULL
       AND cancelled_at IS NULL
       AND end_at > now()
       -- La soirée doit appartenir au club qui invite : jamais celle d'un autre.
       AND venue_id = inv.inviting_venue_id
    RETURNING id, end_at, start_at INTO v_ev;

    IF v_ev.id IS NOT NULL AND inv.default_split_rules IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM event_collab_contracts c
                        WHERE c.event_id = v_ev.id AND c.status IN ('pending_signatures', 'active', 'locked')) THEN
      -- Boissons : 100 % club — un organisateur qui arrive n'a pas d'attestation
      -- alcool (même règle que enforce_drinks_alcohol_gate).
      v_rules := jsonb_set(inv.default_split_rules, '{drinks}',
                           '{"organizer_pct":0,"venue_pct":100}'::jsonb, true);
      INSERT INTO event_collab_contracts
        (event_id, partnership_id, venue_id, organizer_user_id, created_by, status,
         split_rules, cancellation_policy, auto_release_at, venue_signed_at, venue_signed_by)
      VALUES
        (v_ev.id, v_partnership, inv.inviting_venue_id, v_uid, inv.invited_by_user_id, 'pending_signatures',
         v_rules, 'pro_rata_refund', COALESCE(v_ev.end_at, v_ev.start_at) + interval '2 days',
         now(), inv.invited_by_user_id)
      RETURNING id INTO v_contract;

      UPDATE events
         SET revenue_split_proposal = v_rules,
             split_proposed_by = inv.invited_by_user_id,
             split_proposed_at = now(),
             split_approved_by_venue = true,
             split_approved_by_organizer = false
       WHERE id = v_ev.id;
    END IF;
  END IF;

  -- 5. Invitation consommée.
  UPDATE organizer_claim_invitations
     SET status = 'accepted', accepted_at = now(),
         created_organizer_user_id = v_uid, updated_at = now()
   WHERE id = inv.id;

  RETURN jsonb_build_object(
    'partnership_venue_id', inv.inviting_venue_id,
    'event_id', v_ev.id,
    'contract_id', v_contract
  );
END;
$function$;

-- Refuser une invitation : seul son destinataire (un jeton volé ne doit pas
-- pouvoir faire disparaître une proposition).
CREATE OR REPLACE FUNCTION public.decline_organizer_claim_invitation(p_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_email text;
BEGIN
  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = auth.uid();
  IF v_email IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE organizer_claim_invitations
     SET status = 'declined', updated_at = now()
   WHERE token = p_token
     AND status = 'pending'
     AND lower(organizer_email) = v_email;
  IF NOT FOUND THEN RAISE EXCEPTION 'email_mismatch'; END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.decline_organizer_claim_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_organizer_claim_invitation(text) TO authenticated;
REVOKE ALL ON FUNCTION public.accept_organizer_claim_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_organizer_claim_invitation(text) TO authenticated;

-- ═══════════════════════ B. co-organisation par email ════════════════════════
CREATE TABLE IF NOT EXISTS public.event_cohost_email_invites (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  email              text NOT NULL,
  name               text,
  access             text NOT NULL DEFAULT 'editor' CHECK (access IN ('editor', 'viewer')),
  share_crm          boolean NOT NULL DEFAULT true,
  message            text,
  lang               text NOT NULL DEFAULT 'fr' CHECK (lang IN ('fr', 'en', 'es')),
  token              text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  invited_by         uuid NOT NULL,
  invited_by_party   text NOT NULL,
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  expires_at         timestamptz NOT NULL DEFAULT now() + interval '14 days',
  accepted_by        uuid,
  accepted_party     text,
  cohost_id          uuid REFERENCES public.event_cohosts(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS event_cohost_email_invites_live_idx
  ON public.event_cohost_email_invites (event_id, lower(email)) WHERE status = 'pending';
ALTER TABLE public.event_cohost_email_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_cohost_email_invites FROM anon, authenticated;

-- Créer l'invitation (appelée par l'edge invite-organizer-collab, kind « coorg », avec le JWT du pro).
CREATE OR REPLACE FUNCTION public.create_cohost_email_invite(
  p_event_id uuid, p_email text, p_name text DEFAULT NULL, p_access text DEFAULT 'editor',
  p_share_crm boolean DEFAULT true, p_message text DEFAULT NULL, p_lang text DEFAULT 'fr')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_ev    record;
  v_me    record;
  v_row   public.event_cohost_email_invites%ROWTYPE;
  v_count integer;
  v_inviter text;
  v_venue text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'invalid_email'; END IF;
  IF p_access NOT IN ('editor', 'viewer') THEN RAISE EXCEPTION 'invalid_access'; END IF;

  SELECT * INTO v_ev FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF v_ev.cancelled_at IS NOT NULL OR v_ev.end_at < now() THEN RAISE EXCEPTION 'event_closed'; END IF;

  SELECT * INTO v_me FROM public.my_event_party(p_event_id);
  IF v_me.party_key IS NULL OR v_me.role NOT IN ('lead', 'partner') OR v_me.level < 2 THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- La démo ne s'invite qu'entre comptes démo, et ne part jamais vers une vraie
  -- boîte mail.
  IF (p_event_id = ANY (public.demo_event_ids())) IS DISTINCT FROM public.is_demo_email(v_email) THEN
    RAISE EXCEPTION 'demo_mismatch';
  END IF;

  IF EXISTS (SELECT 1 FROM public.event_cohost_email_invites i
              WHERE i.event_id = p_event_id AND lower(i.email) = v_email AND i.status = 'pending'
                AND i.expires_at > now()) THEN
    RAISE EXCEPTION 'already_invited';
  END IF;
  -- Une invitation périmée libère la place.
  UPDATE public.event_cohost_email_invites SET status = 'expired', updated_at = now()
   WHERE event_id = p_event_id AND lower(email) = v_email AND status = 'pending' AND expires_at <= now();

  SELECT (SELECT count(*) FROM public.event_cohosts c
           WHERE c.event_id = p_event_id AND c.status IN ('pending', 'accepted'))
       + (SELECT count(*) FROM public.event_cohost_email_invites i
           WHERE i.event_id = p_event_id AND i.status = 'pending' AND i.expires_at > now())
    INTO v_count;
  IF v_count >= 8 THEN RAISE EXCEPTION 'too_many_cohosts'; END IF;

  INSERT INTO public.event_cohost_email_invites
    (event_id, email, name, access, share_crm, message, lang, invited_by, invited_by_party)
  VALUES
    (p_event_id, v_email, NULLIF(btrim(COALESCE(p_name, '')), ''), p_access, COALESCE(p_share_crm, true),
     NULLIF(btrim(COALESCE(p_message, '')), ''),
     CASE WHEN p_lang IN ('fr', 'en', 'es') THEN p_lang ELSE 'fr' END, v_uid, v_me.party_key)
  RETURNING * INTO v_row;

  SELECT display_name INTO v_inviter FROM public.event_parties(p_event_id) WHERE party_key = v_me.party_key;
  SELECT COALESCE(v.name, pv.name) INTO v_venue
    FROM (SELECT 1) one
    LEFT JOIN public.venues v ON v.id = v_ev.venue_id
    LEFT JOIN public.venues pv ON pv.id = v_ev.partner_venue_id;

  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'token', v_row.token, 'email', v_row.email,
    'lang', v_row.lang, 'inviter_name', COALESCE(v_inviter, 'Yuno'), 'event_title', v_ev.title,
    'event_start_at', v_ev.start_at, 'venue_name', v_venue, 'access', v_row.access, 'message', v_row.message,
    'name', v_row.name);
END;
$function$;

-- Lire une invitation depuis son lien (le destinataire, connecté ou non).
CREATE OR REPLACE FUNCTION public.get_cohost_email_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_email text;
  i       public.event_cohost_email_invites%ROWTYPE;
  v_ev    record;
  v_opts  jsonb := '[]'::jsonb;
BEGIN
  IF p_token IS NULL OR length(p_token) < 20 THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  SELECT * INTO i FROM public.event_cohost_email_invites WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  SELECT e.id, e.title, e.start_at, e.end_at, e.image_url AS cover, e.cancelled_at,
         COALESCE(v.name, pv.name) AS venue_name, COALESCE(v.city, pv.city) AS city
    INTO v_ev
    FROM public.events e
    LEFT JOIN public.venues v ON v.id = e.venue_id
    LEFT JOIN public.venues pv ON pv.id = e.partner_venue_id
   WHERE e.id = i.event_id;

  IF v_uid IS NOT NULL THEN
    SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_uid;
    IF v_email = lower(i.email) THEN
      -- Au titre de quoi la personne peut rejoindre : son espace organisateur
      -- (existant ou à créer), les clubs qu'elle possède, les organisations
      -- qu'elle administre.
      SELECT COALESCE(jsonb_agg(o ORDER BY o->>'kind', o->>'name'), '[]'::jsonb) INTO v_opts FROM (
        SELECT jsonb_build_object('party', 'org:' || v_uid, 'kind', 'org',
                 'name', COALESCE(op.display_name, pr.organization_name, i.name, split_part(v_email, '@', 1)),
                 'exists', op.user_id IS NOT NULL) AS o
          FROM (SELECT 1) one
          LEFT JOIN public.organizer_profiles op ON op.user_id = v_uid
          LEFT JOIN public.profiles pr ON pr.id = v_uid
        UNION ALL
        SELECT jsonb_build_object('party', 'venue:' || v.id, 'kind', 'venue', 'name', v.name, 'exists', true)
          FROM public.venues v WHERE v.owner_id = v_uid AND v.decommissioned_at IS NULL
        UNION ALL
        SELECT DISTINCT jsonb_build_object('party', 'org:' || m.organizer_user_id, 'kind', 'org',
                 'name', COALESCE(op.display_name, 'Organisation'), 'exists', true)
          FROM public.org_members m
          LEFT JOIN public.organizer_profiles op ON op.user_id = m.organizer_user_id
         WHERE m.member_user_id = v_uid AND m.organizer_user_id <> v_uid
           AND public.is_org_team_member(v_uid, m.organizer_user_id, 'admin')
      ) s;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', CASE WHEN i.status = 'pending' AND i.expires_at <= now() THEN 'expired' ELSE i.status END,
    'email', i.email, 'name', i.name, 'access', i.access, 'share_crm', i.share_crm, 'message', i.message,
    'lang', i.lang, 'expires_at', i.expires_at,
    'inviter_name', (SELECT display_name FROM public.event_parties(i.event_id) WHERE party_key = i.invited_by_party),
    'event', jsonb_build_object('id', v_ev.id, 'title', v_ev.title, 'start_at', v_ev.start_at,
                                'cover', v_ev.cover, 'venue_name', v_ev.venue_name, 'city', v_ev.city,
                                'closed', v_ev.cancelled_at IS NOT NULL OR v_ev.end_at < now()),
    'signed_in', v_uid IS NOT NULL,
    'email_matches', v_email IS NOT NULL AND v_email = lower(i.email),
    'options', v_opts,
    'accepted_party', i.accepted_party
  );
END;
$function$;

-- Accepter : rejoindre la soirée comme co-hôte au titre de `p_party`
-- ('org:<moi>' par défaut — l'espace organisateur est créé s'il manque).
CREATE OR REPLACE FUNCTION public.accept_cohost_email_invite(p_token text, p_party text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_email text;
  i       public.event_cohost_email_invites%ROWTYPE;
  v_ev    record;
  v_party text;
  v_kind  text;
  v_id    text;
  v_org   uuid;
  v_venue text;
  v_name  text;
  v_cid   uuid;
  v_count integer;
  v_demo  boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_uid;

  SELECT * INTO i FROM public.event_cohost_email_invites WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation_not_found'; END IF;
  IF i.status <> 'pending' THEN RAISE EXCEPTION 'invitation_not_pending'; END IF;
  IF i.expires_at <= now() THEN
    UPDATE public.event_cohost_email_invites SET status = 'expired', updated_at = now() WHERE id = i.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'invitation_expired');
  END IF;
  IF v_email IS NULL OR v_email <> lower(i.email) THEN RAISE EXCEPTION 'email_mismatch'; END IF;

  SELECT * INTO v_ev FROM public.events WHERE id = i.event_id;
  IF v_ev.cancelled_at IS NOT NULL OR v_ev.end_at < now() THEN RAISE EXCEPTION 'event_closed'; END IF;

  v_party := COALESCE(NULLIF(btrim(p_party), ''), 'org:' || v_uid::text);
  v_kind := split_part(v_party, ':', 1);
  v_id := substr(v_party, length(v_kind) + 2);

  IF v_kind = 'org' THEN
    BEGIN v_org := v_id::uuid; EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid_party'; END;
    IF v_org = v_uid THEN
      -- Son propre espace organisateur : créé à la volée (l'invitation d'un pro
      -- vaut porte d'entrée, comme l'invitation collab d'un club).
      v_name := COALESCE(i.name, split_part(v_email, '@', 1));
      UPDATE public.profiles
         SET profile_type = CASE WHEN profile_type = 'club'::public.profile_type
                                 THEN 'organizer'::public.profile_type ELSE profile_type END,
             organization_name = COALESCE(organization_name, v_name)
       WHERE id = v_uid;
      INSERT INTO public.organizer_profiles (user_id, display_name) VALUES (v_uid, v_name)
        ON CONFLICT (user_id) DO NOTHING;
      INSERT INTO public.user_roles (user_id, role, email) VALUES (v_uid, 'organizer', v_email)
        ON CONFLICT (user_id, role) DO NOTHING;
    ELSIF NOT public.is_org_team_member(v_uid, v_org, 'admin') THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  ELSIF v_kind = 'venue' THEN
    v_venue := v_id;
    IF NOT EXISTS (SELECT 1 FROM public.venues v WHERE v.id = v_venue AND v.owner_id = v_uid AND v.decommissioned_at IS NULL) THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid_party';
  END IF;

  IF EXISTS (SELECT 1 FROM public.event_parties(i.event_id) p WHERE p.party_key = v_party) THEN
    RAISE EXCEPTION 'already_party';
  END IF;

  v_demo := CASE WHEN v_venue IS NOT NULL THEN v_venue = ANY (public.demo_venue_ids())
                 ELSE COALESCE((SELECT public.is_demo_email(u.email) FROM auth.users u WHERE u.id = v_org), false) END;
  IF (i.event_id = ANY (public.demo_event_ids())) IS DISTINCT FROM v_demo THEN RAISE EXCEPTION 'demo_mismatch'; END IF;

  SELECT count(*) INTO v_count FROM public.event_cohosts c
   WHERE c.event_id = i.event_id AND c.status IN ('pending', 'accepted');
  IF v_count >= 8 THEN RAISE EXCEPTION 'too_many_cohosts'; END IF;

  -- Une invitation « par compte » déjà en attente pour cette partie : on la reprend.
  SELECT id INTO v_cid FROM public.event_cohosts c
   WHERE c.event_id = i.event_id AND c.status = 'pending'
     AND ((v_org IS NOT NULL AND c.organizer_user_id = v_org) OR (v_venue IS NOT NULL AND c.venue_id = v_venue));
  IF v_cid IS NULL THEN
    INSERT INTO public.event_cohosts (event_id, organizer_user_id, venue_id, access, share_crm, message,
                                      invited_by, invited_by_party)
    VALUES (i.event_id, v_org, v_venue, i.access, i.share_crm, i.message, i.invited_by, i.invited_by_party)
    RETURNING id INTO v_cid;
  END IF;

  -- Même porte que l'acceptation d'une invitation par compte (niveau, notification).
  PERFORM public.respond_event_cohost_invitation(v_cid, true);

  UPDATE public.event_cohost_email_invites
     SET status = 'accepted', accepted_by = v_uid, accepted_party = v_party, cohost_id = v_cid, updated_at = now()
   WHERE id = i.id;

  RETURN jsonb_build_object('ok', true, 'event_id', i.event_id, 'party', v_party, 'cohost_id', v_cid);
END;
$function$;

CREATE OR REPLACE FUNCTION public.decline_cohost_email_invite(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_email text;
  i public.event_cohost_email_invites%ROWTYPE;
BEGIN
  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = auth.uid();
  IF v_email IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  UPDATE public.event_cohost_email_invites SET status = 'declined', updated_at = now()
   WHERE token = p_token AND status = 'pending' AND lower(email) = v_email
  RETURNING * INTO i;
  IF i.id IS NULL THEN RAISE EXCEPTION 'email_mismatch'; END IF;
  PERFORM public.notify_coorg_party(i.invited_by_party, i.event_id, 'cohost_declined',
    'Co-organisation déclinée', i.email || ' a décliné l''invitation à co-organiser.',
    NULL, 'cohost_email_resp:' || i.id::text);
END;
$function$;

-- Annuler une invitation envoyée (partie principale, niveau ≥ 2).
CREATE OR REPLACE FUNCTION public.cancel_cohost_email_invite(p_invite_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event uuid;
  v_me record;
BEGIN
  SELECT event_id INTO v_event FROM public.event_cohost_email_invites WHERE id = p_invite_id AND status = 'pending';
  IF v_event IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_me FROM public.my_event_party(v_event);
  IF v_me.party_key IS NULL OR v_me.role NOT IN ('lead', 'partner') OR v_me.level < 2 THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.event_cohost_email_invites SET status = 'cancelled', updated_at = now() WHERE id = p_invite_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_cohost_email_invite(uuid, text, text, text, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_cohost_email_invite(uuid, text, text, text, boolean, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_cohost_email_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cohost_email_invite(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_cohost_email_invite(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_cohost_email_invite(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.decline_cohost_email_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_cohost_email_invite(text) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_cohost_email_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_cohost_email_invite(uuid) TO authenticated;

-- get_event_coorg : + email_invitations (reprise de l'état LIVE, une clé ajoutée).
CREATE OR REPLACE FUNCTION public.get_event_coorg(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_me    record;
  v_ev    record;
  v_money boolean;
  v_mine  text[];
  v_set   record;
  v_fig   jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated'); END IF;
  SELECT * INTO v_ev FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  SELECT * INTO v_me FROM public.my_event_party(p_event_id);

  -- Une invitation en attente se lit aussi (pour décider).
  IF v_me.party_key IS NULL AND NOT public.is_super_admin() THEN
    IF NOT EXISTS (SELECT 1 FROM public.event_cohosts c
                    WHERE c.event_id = p_event_id AND c.status = 'pending'
                      AND public.coorg_party_level(v_uid,
                            CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id ELSE 'org:' || c.organizer_user_id END) >= 1) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
    END IF;
  END IF;

  SELECT array_agg(p.party_key) INTO v_mine FROM public.event_parties(p_event_id) p
   WHERE public.coorg_party_level(v_uid, p.party_key) >= 3;
  v_money := public.is_super_admin() OR COALESCE(array_length(v_mine, 1), 0) > 0;

  SELECT * INTO v_set FROM public.event_coorg_settlements WHERE event_id = p_event_id;
  IF v_money THEN
    v_fig := CASE WHEN v_set.status IN ('approved', 'settled') THEN v_set.snapshot ELSE public._coorg_compute(p_event_id) END;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'event', jsonb_build_object('id', v_ev.id, 'title', v_ev.title, 'start_at', v_ev.start_at, 'end_at', v_ev.end_at,
                                'ended', v_ev.end_at < now(), 'has_stripe_collab',
                                EXISTS (SELECT 1 FROM public.event_collab_contracts cc
                                         WHERE cc.event_id = p_event_id AND cc.status IN ('active', 'locked', 'closed'))),
    'me', CASE WHEN v_me.party_key IS NULL THEN NULL
               ELSE jsonb_build_object('party', v_me.party_key, 'role', v_me.role, 'access', v_me.access, 'level', v_me.level) END,
    'my_parties', COALESCE(to_jsonb(v_mine), '[]'::jsonb),
    'can_invite', COALESCE(v_me.role IN ('lead', 'partner') AND v_me.level >= 2, false)
                  AND v_ev.end_at > now() AND v_ev.cancelled_at IS NULL,
    'can_deal', COALESCE(v_me.role IN ('lead', 'partner') AND v_me.level >= 3, false),
    'parties', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'key', p.party_key, 'kind', p.kind, 'role', p.role, 'access', p.access,
                  'share_crm', p.share_crm, 'cohost_id', p.cohost_id, 'name', p.display_name,
                  'slug', p.slug, 'avatar_url', p.avatar_url, 'city', p.city) ORDER BY p.ord), '[]'::jsonb)
                  FROM public.event_parties(p_event_id) p),
    'invitations', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                      'id', c.id, 'status', c.status, 'access', c.access, 'share_crm', c.share_crm,
                      'invited_at', c.invited_at, 'message', c.message,
                      'party', CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id ELSE 'org:' || c.organizer_user_id END,
                      'name', COALESCE(v.name, op.display_name),
                      'avatar_url', COALESCE(v.logo_url, op.avatar_url),
                      'mine', public.coorg_party_level(v_uid,
                                CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id ELSE 'org:' || c.organizer_user_id END) >= 1
                    ) ORDER BY c.invited_at DESC), '[]'::jsonb)
                      FROM public.event_cohosts c
                      LEFT JOIN public.venues v ON v.id = c.venue_id
                      LEFT JOIN public.organizer_profiles op ON op.user_id = c.organizer_user_id
                     WHERE c.event_id = p_event_id AND c.status IN ('pending', 'declined')),
    -- Invitations par email (structures sans compte) : visibles des parties principales.
    'email_invitations', CASE WHEN COALESCE(v_me.role IN ('lead', 'partner') AND v_me.level >= 2, false) OR public.is_super_admin()
                         THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                                 'id', i.id, 'email', i.email, 'name', i.name, 'access', i.access,
                                 'invited_at', i.created_at, 'expires_at', i.expires_at) ORDER BY i.created_at DESC), '[]'::jsonb)
                                 FROM public.event_cohost_email_invites i
                                WHERE i.event_id = p_event_id AND i.status = 'pending' AND i.expires_at > now())
                         ELSE '[]'::jsonb END,
    'deal', CASE WHEN v_money THEN (SELECT to_jsonb(d) - 'created_by' FROM public.event_coorg_deals d WHERE d.event_id = p_event_id) END,
    'ledger', CASE WHEN v_money THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'id', l.id, 'kind', l.kind, 'party', l.party_key, 'category', l.category, 'label', l.label,
                  'amount', l.amount, 'note', l.note, 'created_at', l.created_at,
                  'mine', l.party_key = ANY (COALESCE(v_mine, '{}'::text[]))) ORDER BY l.created_at), '[]'::jsonb)
                  FROM public.event_coorg_ledger l WHERE l.event_id = p_event_id AND l.voided_at IS NULL) END,
    'settlement', CASE WHEN v_money THEN jsonb_build_object(
                    'status', COALESCE(v_set.status, 'open'),
                    'version', COALESCE(v_set.version, 1),
                    'approvals', COALESCE(v_set.approvals, '{}'::jsonb),
                    'approved_at', v_set.approved_at, 'settled_at', v_set.settled_at,
                    'figures', v_fig,
                    'fingerprint', CASE WHEN COALESCE(v_set.status, 'open') = 'open' THEN md5(v_fig::text) END) END,
    'transfers', CASE WHEN v_money THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', t.id, 'from', t.from_party, 'to', t.to_party, 'amount', t.amount,
                    'reference', t.reference, 'status', t.status,
                    'payee_iban', CASE WHEN t.from_party = ANY (COALESCE(v_mine, '{}'::text[]))
                                         OR t.to_party = ANY (COALESCE(v_mine, '{}'::text[]))
                                       THEN t.payee_iban END,
                    'sent_at', t.sent_at, 'sent_reference', t.sent_reference,
                    'received_at', t.received_at, 'disputed_at', t.disputed_at, 'dispute_reason', t.dispute_reason,
                    'i_pay', t.from_party = ANY (COALESCE(v_mine, '{}'::text[])),
                    'i_receive', t.to_party = ANY (COALESCE(v_mine, '{}'::text[])),
                    'due_at', t.due_at, 'confirm_due_at', t.confirm_due_at,
                    'reminder_count', t.reminder_count, 'escalated_at', t.escalated_at,
                    'last_nudged_at', t.last_nudged_at,
                    'resolved_by_admin', t.resolved_by_admin, 'admin_note', t.admin_note
                  ) ORDER BY t.amount DESC), '[]'::jsonb)
                    FROM public.event_coorg_transfers t WHERE t.event_id = p_event_id AND t.source = 'coorg') END
  );
END;
$function$;
