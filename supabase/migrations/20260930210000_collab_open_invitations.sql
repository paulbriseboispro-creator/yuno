-- ═══════════════════════════════════════════════════════════════════════════
-- Collaboration ouverte : UN verbe, « inviter sur une soirée » (2026-09-30)
-- Plan : docs/designs/COLLAB_OPEN_INVITE_PLAN.md
--
-- Avant : proposer une soirée à un club (ou à un organisateur) exigeait un
-- PARTENARIAT actif préalable (demande + pourcentages + acceptation), et la
-- co-organisation à plusieurs vivait à côté, avec son propre système
-- d'invitation. Deux produits pour une seule question : « avec qui je fais
-- cette soirée ? ».
--
-- Après : tout passe par l'invitation de co-organisation (event_cohosts), qui
-- vaut consentement. Une invitation porte un RÔLE :
--   • 'cohost'    — partenaire ou co-gestion (inchangé) ;
--   • 'principal' — le LIEU (club invité par un organisateur qui mène) ou
--                   l'ORGANISATEUR (organisation invitée par un club qui mène).
--                   À l'acceptation, la partie devient partner_venue_id /
--                   partner_organizer_id, avec le mode et l'accord d'argent que
--                   le lead a choisis (`principal_terms`) : « réglé entre vous »
--                   (partage 100/0 par pilier, vente ouverte) ou « encadré par
--                   Yuno » (contrat pré-signé par le lead, réglé par virement —
--                   Stripe n'autorise que les charges directes).
-- Plus AUCUN partenariat préalable n'est exigé : l'acceptation de l'invitation
-- est l'accord de l'autre partie.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Colonnes ────────────────────────────────────────────────────────────
ALTER TABLE public.event_cohosts
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'cohost',
  ADD COLUMN IF NOT EXISTS principal_terms jsonb;
ALTER TABLE public.event_cohosts DROP CONSTRAINT IF EXISTS event_cohosts_role_check;
ALTER TABLE public.event_cohosts ADD CONSTRAINT event_cohosts_role_check CHECK (role IN ('cohost', 'principal'));
-- 'promoted' : l'invitation a été acceptée et la partie est devenue la partie
-- principale (colonnes de l'événement). Elle ne compte plus comme co-hôte.
ALTER TABLE public.event_cohosts DROP CONSTRAINT IF EXISTS event_cohosts_status_check;
ALTER TABLE public.event_cohosts ADD CONSTRAINT event_cohosts_status_check
  CHECK (status IN ('pending', 'accepted', 'declined', 'removed', 'left', 'promoted'));

ALTER TABLE public.event_cohost_email_invites
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'cohost',
  ADD COLUMN IF NOT EXISTS principal_terms jsonb;
ALTER TABLE public.event_cohost_email_invites DROP CONSTRAINT IF EXISTS event_cohost_email_invites_role_check;
ALTER TABLE public.event_cohost_email_invites ADD CONSTRAINT event_cohost_email_invites_role_check
  CHECK (role IN ('cohost', 'principal'));

-- ─── 2. Termes d'une invitation principale ─────────────────────────────────
-- Forme normalisée : {mode, agreement, tickets, tables, rules?}. Une valeur
-- inconnue retombe sur le défaut, jamais sur une erreur.
CREATE OR REPLACE FUNCTION public._collab_principal_terms(p jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'mode', CASE WHEN p->>'mode' IN ('co_event', 'venue_rental', 'org_hosted') THEN p->>'mode' ELSE 'co_event' END,
    'agreement', CASE WHEN p->>'agreement' = 'yuno' THEN 'yuno' ELSE 'external' END,
    'tickets', CASE WHEN p->>'tickets' IN ('organizer', 'venue') THEN p->>'tickets' END,
    'tables', CASE WHEN p->>'tables' IN ('organizer', 'venue') THEN p->>'tables' END,
    'rules', CASE WHEN jsonb_typeof(p->'rules') = 'object' THEN p->'rules' END
  ));
$$;

-- Une invitation principale est-elle possible sur cette soirée, pour ce type
-- de partie ? Rend NULL si oui, sinon le code d'erreur.
CREATE OR REPLACE FUNCTION public._collab_principal_blocker(p_event_id uuid, p_invitee_kind text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e record;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN 'event_not_found'; END IF;
  IF e.event_kind::text = 'private_event' THEN RETURN 'principal_private_event'; END IF;
  IF e.venue_id IS NULL THEN
    -- Soirée d'un organisateur : on invite son LIEU (un club).
    IF p_invitee_kind <> 'venue' THEN RETURN 'principal_wrong_kind'; END IF;
    IF e.partner_venue_id IS NOT NULL THEN RETURN 'principal_slot_taken'; END IF;
  ELSE
    -- Soirée d'un club : on invite SON organisateur.
    IF p_invitee_kind <> 'org' THEN RETURN 'principal_wrong_kind'; END IF;
    IF e.organizer_user_id IS NOT NULL OR e.partner_organizer_id IS NOT NULL THEN RETURN 'principal_slot_taken'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_collab_contracts c WHERE c.event_id = p_event_id AND c.status <> 'cancelled') THEN
    RETURN 'principal_slot_taken';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_cohosts c WHERE c.event_id = p_event_id AND c.status = 'pending' AND c.role = 'principal')
     OR EXISTS (SELECT 1 FROM public.event_cohost_email_invites i WHERE i.event_id = p_event_id
                  AND i.status = 'pending' AND i.expires_at > now() AND i.role = 'principal') THEN
    RETURN 'principal_already_invited';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public._collab_principal_blocker(uuid, text) FROM PUBLIC, anon, authenticated;

-- ─── 3. Promotion à l'acceptation ──────────────────────────────────────────
-- Appelée par respond_event_cohost_invitation (donc sous son contrôle d'accès).
-- SECURITY DEFINER : les gardes de colonnes d'events (INVOKER, discriminant sur
-- `current_user`) laissent passer, comme pour la signature d'un contrat.
CREATE OR REPLACE FUNCTION public._collab_promote_principal(p_cohost_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c        public.event_cohosts%ROWTYPE;
  e        record;
  v_terms  jsonb;
  v_mode   public.event_mode;
  v_venue  text;
  v_org    uuid;
  v_lead   text;
  v_tickets text;
  v_tables  text;
  v_rules  jsonb;
  v_part   uuid;
BEGIN
  SELECT * INTO c FROM public.event_cohosts WHERE id = p_cohost_id FOR UPDATE;
  IF NOT FOUND OR c.role <> 'principal' THEN RETURN; END IF;

  SELECT * INTO e FROM public.events WHERE id = c.event_id FOR UPDATE;
  -- La place a pu être prise entre l'invitation et la réponse.
  IF e.venue_id IS NULL THEN
    IF c.venue_id IS NULL OR e.partner_venue_id IS NOT NULL THEN RAISE EXCEPTION 'principal_slot_taken'; END IF;
  ELSE
    IF c.organizer_user_id IS NULL OR e.organizer_user_id IS NOT NULL OR e.partner_organizer_id IS NOT NULL THEN
      RAISE EXCEPTION 'principal_slot_taken';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_collab_contracts x WHERE x.event_id = e.id AND x.status <> 'cancelled') THEN
    RAISE EXCEPTION 'principal_slot_taken';
  END IF;

  v_terms := public._collab_principal_terms(c.principal_terms);
  v_mode := (v_terms->>'mode')::public.event_mode;
  v_lead := CASE WHEN e.venue_id IS NOT NULL THEN 'venue' ELSE 'organizer' END;

  IF v_lead = 'organizer' THEN
    UPDATE public.events
       SET partner_venue_id = c.venue_id, event_mode = v_mode,
           collab_responsibilities = public.default_collab_responsibilities(v_mode)
     WHERE id = e.id;
    v_venue := c.venue_id; v_org := e.organizer_user_id;
  ELSE
    UPDATE public.events
       SET partner_organizer_id = c.organizer_user_id, event_mode = v_mode,
           collab_responsibilities = public.default_collab_responsibilities(v_mode)
     WHERE id = e.id;
    v_venue := e.venue_id; v_org := c.organizer_user_id;
  END IF;

  IF v_terms->>'agreement' = 'external' THEN
    -- Même partage que set_event_collab_external_agreement.
    v_tickets := COALESCE(v_terms->>'tickets', 'organizer');
    v_tables  := COALESCE(v_terms->>'tables', CASE WHEN v_mode = 'org_hosted' THEN 'organizer' ELSE 'venue' END);
    v_rules := jsonb_build_object(
      'agreement', 'external',
      'tickets', jsonb_build_object(
        'organizer_pct', CASE WHEN v_tickets = 'organizer' THEN 100 ELSE 0 END,
        'venue_pct',     CASE WHEN v_tickets = 'organizer' THEN 0 ELSE 100 END),
      'tables', jsonb_build_object(
        'organizer_pct', CASE WHEN v_tables = 'organizer' THEN 100 ELSE 0 END,
        'venue_pct',     CASE WHEN v_tables = 'organizer' THEN 0 ELSE 100 END),
      'drinks', jsonb_build_object('organizer_pct', 0, 'venue_pct', 100));
    UPDATE public.events
       SET revenue_split_rules = v_rules, revenue_split_proposal = NULL,
           split_proposed_by = NULL, split_proposed_at = NULL,
           split_approved_by_venue = false, split_approved_by_organizer = false
     WHERE id = e.id;
  ELSE
    -- Contrat Yuno : les conditions choisies par le lead (sinon le partage par
    -- défaut), réglées par VIREMENT — l'encaisseur est le lead. Pré-signé par
    -- le lead ; l'invité signe depuis la page de la soirée.
    v_rules := COALESCE(v_terms->'rules', jsonb_build_object(
      'tickets', jsonb_build_object('organizer_pct', 50, 'venue_pct', 50),
      'tables',  jsonb_build_object('organizer_pct', 0,  'venue_pct', 100),
      'drinks',  jsonb_build_object('organizer_pct', 0,  'venue_pct', 100)));
    IF v_rules->'settlement' IS NULL THEN
      v_rules := v_rules || jsonb_build_object('settlement', jsonb_build_object(
        'mode', 'transfer', 'collector', v_lead, 'payment_terms_days', 15));
    END IF;
    v_rules := public.enforce_drinks_alcohol_gate(v_rules, v_org);
    SELECT id INTO v_part FROM public.venue_organizer_partnerships
     WHERE venue_id = v_venue AND organizer_user_id = v_org AND status = 'active' LIMIT 1;

    INSERT INTO public.event_collab_contracts (
      event_id, partnership_id, venue_id, organizer_user_id, created_by,
      status, split_rules, cancellation_policy, auto_release_at,
      venue_signed_at, venue_signed_by, org_signed_at, org_signed_by
    ) VALUES (
      e.id, v_part, v_venue, v_org, c.invited_by,
      'pending_signatures', v_rules, 'pro_rata_refund', COALESCE(e.end_at, e.start_at) + interval '2 days',
      CASE WHEN v_lead = 'venue' THEN now() END, CASE WHEN v_lead = 'venue' THEN c.invited_by END,
      CASE WHEN v_lead = 'organizer' THEN now() END, CASE WHEN v_lead = 'organizer' THEN c.invited_by END
    );
    UPDATE public.events
       SET revenue_split_proposal = v_rules, split_proposed_by = c.invited_by, split_proposed_at = now(),
           split_approved_by_venue = (v_lead = 'venue'), split_approved_by_organizer = (v_lead = 'organizer')
     WHERE id = e.id;
  END IF;

  UPDATE public.event_cohosts SET status = 'promoted', updated_at = now() WHERE id = c.id;
END;
$$;
REVOKE ALL ON FUNCTION public._collab_promote_principal(uuid) FROM PUBLIC, anon, authenticated;

-- ─── 4. invite_event_cohost : le rôle principal ────────────────────────────
-- DROP + CREATE : une surcharge rendrait ambigus les appels à arguments nommés.
DROP FUNCTION IF EXISTS public.invite_event_cohost(uuid, uuid, text, text, boolean, text);
CREATE FUNCTION public.invite_event_cohost(
  p_event_id uuid, p_organizer_user_id uuid DEFAULT NULL, p_venue_id text DEFAULT NULL,
  p_access text DEFAULT 'editor', p_share_crm boolean DEFAULT true, p_message text DEFAULT NULL,
  p_principal boolean DEFAULT false, p_terms jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_me    record;
  v_ev    record;
  v_party text;
  v_id    uuid;
  v_count integer;
  v_title text;
  v_ev_demo boolean;
  v_inv_demo boolean;
  v_sandbox text;
  v_block text;
  v_from  text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF (p_organizer_user_id IS NULL) = (p_venue_id IS NULL) THEN RAISE EXCEPTION 'one_party_required'; END IF;
  IF p_access NOT IN ('editor', 'viewer') THEN RAISE EXCEPTION 'invalid_access'; END IF;

  SELECT * INTO v_ev FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF v_ev.cancelled_at IS NOT NULL OR v_ev.end_at < now() THEN RAISE EXCEPTION 'event_closed'; END IF;

  SELECT * INTO v_me FROM public.my_event_party(p_event_id);
  IF v_me.party_key IS NULL OR v_me.role NOT IN ('lead', 'partner') OR v_me.level < 2 THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF COALESCE(p_principal, false) THEN
    -- Le lieu / l'organisateur de la soirée : le lead seul, niveau argent.
    IF v_me.role <> 'lead' OR v_me.level < 3 THEN RAISE EXCEPTION 'forbidden'; END IF;
    v_block := public._collab_principal_blocker(p_event_id, CASE WHEN p_venue_id IS NOT NULL THEN 'venue' ELSE 'org' END);
    IF v_block IS NOT NULL THEN RAISE EXCEPTION '%', v_block; END IF;
  END IF;

  v_party := CASE WHEN p_venue_id IS NOT NULL THEN 'venue:' || p_venue_id ELSE 'org:' || p_organizer_user_id END;
  IF EXISTS (SELECT 1 FROM public.event_parties(p_event_id) p WHERE p.party_key = v_party) THEN
    RAISE EXCEPTION 'already_party';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_cohosts c WHERE c.event_id = p_event_id AND c.status = 'pending'
              AND (c.organizer_user_id = p_organizer_user_id OR c.venue_id = p_venue_id)) THEN
    RAISE EXCEPTION 'already_invited';
  END IF;

  IF p_organizer_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.organizer_profiles op WHERE op.user_id = p_organizer_user_id) THEN
      RAISE EXCEPTION 'organizer_not_found';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.decommissioned_at IS NULL) THEN
      RAISE EXCEPTION 'venue_not_found';
    END IF;
  END IF;

  v_ev_demo := p_event_id = ANY (public.demo_event_ids());
  v_inv_demo := CASE WHEN p_venue_id IS NOT NULL THEN p_venue_id = ANY (public.demo_venue_ids())
                     ELSE COALESCE((SELECT public.is_demo_email(u.email) FROM auth.users u WHERE u.id = p_organizer_user_id), false) END;
  IF v_ev_demo IS DISTINCT FROM v_inv_demo THEN
    v_sandbox := CASE WHEN v_inv_demo AND NOT v_ev_demo THEN public.coorg_demo_sandbox_status(p_event_id) END;
    IF v_sandbox = 'not_private' THEN RAISE EXCEPTION 'demo_sandbox_private_only'; END IF;
    IF v_sandbox IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'demo_mismatch'; END IF;
  END IF;

  SELECT count(*) INTO v_count FROM public.event_cohosts c
   WHERE c.event_id = p_event_id AND c.status IN ('pending', 'accepted');
  IF v_count >= 8 THEN RAISE EXCEPTION 'too_many_cohosts'; END IF;

  INSERT INTO public.event_cohosts (event_id, organizer_user_id, venue_id, access, share_crm, message,
                                    invited_by, invited_by_party, role, principal_terms)
  VALUES (p_event_id, p_organizer_user_id, p_venue_id,
          CASE WHEN COALESCE(p_principal, false) THEN 'editor' ELSE p_access END,
          COALESCE(p_share_crm, true),
          NULLIF(btrim(COALESCE(p_message, '')), ''), v_uid, v_me.party_key,
          CASE WHEN COALESCE(p_principal, false) THEN 'principal' ELSE 'cohost' END,
          CASE WHEN COALESCE(p_principal, false) THEN public._collab_principal_terms(p_terms) END)
  RETURNING id INTO v_id;

  v_title := COALESCE(v_ev.title, 'Soirée');
  v_from := COALESCE((SELECT display_name FROM public.event_parties(p_event_id) WHERE party_key = v_me.party_key), 'Un partenaire');
  PERFORM public.notify_coorg_party(v_party, p_event_id, 'cohost_invited',
    CASE WHEN NOT COALESCE(p_principal, false) THEN 'Invitation sur une soirée'
         WHEN p_venue_id IS NOT NULL THEN 'Invitation à accueillir une soirée'
         ELSE 'Invitation à organiser une soirée' END,
    v_from || CASE WHEN NOT COALESCE(p_principal, false) THEN ' t''invite sur « '
                   WHEN p_venue_id IS NOT NULL THEN ' t''invite à accueillir « '
                   ELSE ' t''invite à organiser avec lui « ' END || v_title || ' ».',
    v_id, 'cohost_invited:' || v_id::text);
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.invite_event_cohost(uuid, uuid, text, text, boolean, text, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_event_cohost(uuid, uuid, text, text, boolean, text, boolean, jsonb) TO authenticated;

-- ─── 5. Réponse : promotion d'une invitation principale ────────────────────
CREATE OR REPLACE FUNCTION public.respond_event_cohost_invitation(p_cohost_id uuid, p_accept boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  c     record;
  v_key text;
  v_title text;
  v_name text;
BEGIN
  SELECT * INTO c FROM public.event_cohosts WHERE id = p_cohost_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  v_key := CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id ELSE 'org:' || c.organizer_user_id END;
  IF public.coorg_party_level(v_uid, v_key) < 2 THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  IF c.status <> 'pending' THEN RAISE EXCEPTION 'not_pending'; END IF;
  IF p_accept AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = c.event_id
                           AND (e.end_at < now() OR e.cancelled_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'event_closed';
  END IF;
  -- Devenir le lieu / l'organisateur engage l'argent : niveau argent requis.
  IF p_accept AND c.role = 'principal' AND public.coorg_party_level(v_uid, v_key) < 3 THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.event_cohosts
     SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
         responded_at = now(), responded_by = v_uid, updated_at = now()
   WHERE id = p_cohost_id;

  IF p_accept AND c.role = 'principal' THEN
    PERFORM public._collab_promote_principal(p_cohost_id);
  END IF;

  SELECT title INTO v_title FROM public.events WHERE id = c.event_id;
  SELECT COALESCE(v.name, op.display_name, 'Un partenaire') INTO v_name
    FROM (SELECT 1) one
    LEFT JOIN public.venues v ON v.id = c.venue_id
    LEFT JOIN public.organizer_profiles op ON op.user_id = c.organizer_user_id;

  IF c.invited_by_party IS NOT NULL THEN
    PERFORM public.notify_coorg_party(c.invited_by_party, c.event_id,
      CASE WHEN p_accept THEN 'cohost_accepted' ELSE 'cohost_declined' END,
      CASE WHEN NOT p_accept THEN 'Invitation déclinée'
           WHEN c.role = 'principal' THEN 'Invitation acceptée'
           ELSE 'Co-organisation acceptée' END,
      v_name || CASE WHEN NOT p_accept THEN ' a décliné « '
                     WHEN c.role = 'principal' AND c.venue_id IS NOT NULL THEN ' accueille « '
                     WHEN c.role = 'principal' THEN ' organise avec toi « '
                     ELSE ' co-organise désormais « ' END
        || COALESCE(v_title, 'la soirée') || ' ».',
      p_cohost_id, 'cohost_resp:' || p_cohost_id::text);
  END IF;
  RETURN CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END;
END;
$function$;

-- ─── 6. Invitation par email : le rôle principal ───────────────────────────
DROP FUNCTION IF EXISTS public.create_cohost_email_invite(uuid, text, text, text, boolean, text, text);
CREATE FUNCTION public.create_cohost_email_invite(
  p_event_id uuid, p_email text, p_name text DEFAULT NULL, p_access text DEFAULT 'editor',
  p_share_crm boolean DEFAULT true, p_message text DEFAULT NULL, p_lang text DEFAULT 'fr',
  p_principal boolean DEFAULT false, p_terms jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
  v_block text;
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
  IF COALESCE(p_principal, false) THEN
    -- Par email, le principal ne peut être qu'une ORGANISATION (l'invité crée
    -- son espace en acceptant) ; un club hors Yuno passe par invite-club-collab,
    -- qui crée le club.
    IF v_me.role <> 'lead' OR v_me.level < 3 THEN RAISE EXCEPTION 'forbidden'; END IF;
    v_block := public._collab_principal_blocker(p_event_id, 'org');
    IF v_block IS NOT NULL THEN RAISE EXCEPTION '%', v_block; END IF;
  END IF;

  IF (p_event_id = ANY (public.demo_event_ids())) IS DISTINCT FROM public.is_demo_email(v_email) THEN
    RAISE EXCEPTION 'demo_mismatch';
  END IF;

  IF EXISTS (SELECT 1 FROM public.event_cohost_email_invites i
              WHERE i.event_id = p_event_id AND lower(i.email) = v_email AND i.status = 'pending'
                AND i.expires_at > now()) THEN
    RAISE EXCEPTION 'already_invited';
  END IF;
  UPDATE public.event_cohost_email_invites SET status = 'expired', updated_at = now()
   WHERE event_id = p_event_id AND lower(email) = v_email AND status = 'pending' AND expires_at <= now();

  SELECT (SELECT count(*) FROM public.event_cohosts c
           WHERE c.event_id = p_event_id AND c.status IN ('pending', 'accepted'))
       + (SELECT count(*) FROM public.event_cohost_email_invites i
           WHERE i.event_id = p_event_id AND i.status = 'pending' AND i.expires_at > now())
    INTO v_count;
  IF v_count >= 8 THEN RAISE EXCEPTION 'too_many_cohosts'; END IF;

  INSERT INTO public.event_cohost_email_invites
    (event_id, email, name, access, share_crm, message, lang, invited_by, invited_by_party, role, principal_terms)
  VALUES
    (p_event_id, v_email, NULLIF(btrim(COALESCE(p_name, '')), ''),
     CASE WHEN COALESCE(p_principal, false) THEN 'editor' ELSE p_access END,
     COALESCE(p_share_crm, true), NULLIF(btrim(COALESCE(p_message, '')), ''),
     CASE WHEN p_lang IN ('fr', 'en', 'es') THEN p_lang ELSE 'fr' END, v_uid, v_me.party_key,
     CASE WHEN COALESCE(p_principal, false) THEN 'principal' ELSE 'cohost' END,
     CASE WHEN COALESCE(p_principal, false) THEN public._collab_principal_terms(p_terms) END)
  RETURNING * INTO v_row;

  SELECT display_name INTO v_inviter FROM public.event_parties(p_event_id) WHERE party_key = v_me.party_key;
  SELECT COALESCE(v.name, pv.name) INTO v_venue
    FROM (SELECT 1) one
    LEFT JOIN public.venues v ON v.id = v_ev.venue_id
    LEFT JOIN public.venues pv ON pv.id = v_ev.partner_venue_id;

  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'token', v_row.token, 'email', v_row.email,
    'lang', v_row.lang, 'inviter_name', COALESCE(v_inviter, 'Yuno'), 'event_title', v_ev.title,
    'event_start_at', v_ev.start_at, 'venue_name', v_venue, 'access', v_row.access, 'message', v_row.message,
    'name', v_row.name, 'role', v_row.role);
END;
$function$;
REVOKE ALL ON FUNCTION public.create_cohost_email_invite(uuid, text, text, text, boolean, text, text, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_cohost_email_invite(uuid, text, text, text, boolean, text, text, boolean, jsonb) TO authenticated;

-- Acceptation par email : la ligne event_cohosts reprend le rôle et les termes.
CREATE OR REPLACE FUNCTION public.accept_cohost_email_invite(p_token text, p_party text DEFAULT NULL::text)
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
  -- Une invitation « organisateur de la soirée » se reçoit en organisation.
  IF i.role = 'principal' AND v_kind <> 'org' THEN RAISE EXCEPTION 'principal_wrong_kind'; END IF;

  IF v_kind = 'org' THEN
    BEGIN v_org := v_id::uuid; EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid_party'; END;
    IF v_org = v_uid THEN
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

  SELECT id INTO v_cid FROM public.event_cohosts c
   WHERE c.event_id = i.event_id AND c.status = 'pending'
     AND ((v_org IS NOT NULL AND c.organizer_user_id = v_org) OR (v_venue IS NOT NULL AND c.venue_id = v_venue));
  IF v_cid IS NULL THEN
    INSERT INTO public.event_cohosts (event_id, organizer_user_id, venue_id, access, share_crm, message,
                                      invited_by, invited_by_party, role, principal_terms)
    VALUES (i.event_id, v_org, v_venue, i.access, i.share_crm, i.message, i.invited_by, i.invited_by_party,
            i.role, i.principal_terms)
    RETURNING id INTO v_cid;
  ELSIF i.role = 'principal' THEN
    UPDATE public.event_cohosts SET role = 'principal', principal_terms = i.principal_terms WHERE id = v_cid;
  END IF;

  -- Même porte que l'acceptation d'une invitation par compte (niveau,
  -- promotion du principal, notification).
  PERFORM public.respond_event_cohost_invitation(v_cid, true);

  UPDATE public.event_cohost_email_invites
     SET status = 'accepted', accepted_by = v_uid, accepted_party = v_party, cohost_id = v_cid, updated_at = now()
   WHERE id = i.id;

  RETURN jsonb_build_object('ok', true, 'event_id', i.event_id, 'party', v_party, 'cohost_id', v_cid, 'role', i.role);
END;
$function$;

-- ─── 7. Boîte de réception : le rôle de l'invitation ───────────────────────
CREATE OR REPLACE FUNCTION public.get_my_cohost_invitations(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id, 'event_id', c.event_id, 'access', c.access, 'share_crm', c.share_crm,
           'message', c.message, 'invited_at', c.invited_at,
           'role', c.role, 'terms', c.principal_terms,
           'event_title', e.title, 'start_at', e.start_at, 'end_at', e.end_at,
           'poster_url', COALESCE(e.poster_url, e.image_url),
           'location', COALESCE(v.name, e.location_name), 'city', COALESCE(v.city, e.location_city),
           'invited_by_name', (SELECT p.display_name FROM public.event_parties(c.event_id) p
                                WHERE p.party_key = c.invited_by_party),
           'parties', (SELECT jsonb_agg(jsonb_build_object('name', p.display_name, 'kind', p.kind, 'role', p.role))
                         FROM public.event_parties(c.event_id) p)
         ) ORDER BY e.start_at), '[]'::jsonb)
    FROM public.event_cohosts c
    JOIN public.events e ON e.id = c.event_id
    LEFT JOIN public.venues v ON v.id = COALESCE(e.venue_id, e.partner_venue_id)
   WHERE c.status = 'pending' AND e.end_at > now()
     AND (
       (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id
        AND public.coorg_party_level(auth.uid(), 'org:' || p_organizer_user_id) >= 1)
       OR (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id
        AND public.coorg_party_level(auth.uid(), 'venue:' || p_venue_id) >= 1)
     );
$function$;

-- ─── 8. L'annuaire : avec qui je travaille ─────────────────────────────────
-- Remplace les partenariats (demande + pourcentages). Une ligne par partie :
-- soirées ensemble (à venir / passées), prochaine soirée, invitations en
-- attente dans les deux sens. Plus les invitations envoyées par email.
CREATE OR REPLACE FUNCTION public.get_collab_directory(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_key text;
  v_people jsonb;
  v_emails jsonb;
BEGIN
  v_key := CASE WHEN p_venue_id IS NOT NULL THEN 'venue:' || p_venue_id
                WHEN p_organizer_user_id IS NOT NULL THEN 'org:' || p_organizer_user_id END;
  IF v_key IS NULL OR public.coorg_party_level(auth.uid(), v_key) < 1 THEN
    RETURN jsonb_build_object('people', '[]'::jsonb, 'emails', '[]'::jsonb);
  END IF;

  WITH my_events AS (
    SELECT e.id, e.title, e.start_at, e.end_at FROM public.events e
     WHERE e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id
              OR e.id IN (SELECT public.cohost_event_ids_venue(p_venue_id))))
         OR (p_organizer_user_id IS NOT NULL AND (e.organizer_user_id = p_organizer_user_id
              OR e.partner_organizer_id = p_organizer_user_id
              OR e.id IN (SELECT public.cohost_event_ids_org(p_organizer_user_id)))))
  ),
  together AS (
    SELECT p.party_key, p.kind, p.venue_id, p.organizer_user_id, me.id AS event_id, me.title, me.start_at, me.end_at
      FROM my_events me
      CROSS JOIN LATERAL public.event_parties(me.id) p
     WHERE p.party_key <> v_key
  ),
  -- Invitations en attente, par compte, dans les deux sens.
  pend AS (
    SELECT CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id ELSE 'org:' || c.organizer_user_id END AS party_key,
           CASE WHEN c.venue_id IS NOT NULL THEN 'venue' ELSE 'org' END AS kind,
           c.venue_id, c.organizer_user_id, 'out'::text AS dir, c.event_id, e.title, e.start_at, c.role
      FROM public.event_cohosts c JOIN public.events e ON e.id = c.event_id
     WHERE c.status = 'pending' AND c.invited_by_party = v_key AND e.end_at > now() AND e.cancelled_at IS NULL
    UNION ALL
    SELECT c.invited_by_party,
           split_part(c.invited_by_party, ':', 1),
           CASE WHEN c.invited_by_party LIKE 'venue:%' THEN substr(c.invited_by_party, 7) END,
           CASE WHEN c.invited_by_party LIKE 'org:%' THEN substr(c.invited_by_party, 5)::uuid END,
           'in', c.event_id, e.title, e.start_at, c.role
      FROM public.event_cohosts c JOIN public.events e ON e.id = c.event_id
     WHERE c.status = 'pending' AND e.end_at > now() AND e.cancelled_at IS NULL
       AND c.invited_by_party IS NOT NULL
       AND ((p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id))
  ),
  -- Relations enregistrées avant l'annuaire (anciens partenariats actifs) :
  -- rien ne disparaît, elles apparaissent sans soirée.
  legacy AS (
    SELECT CASE WHEN p_venue_id IS NOT NULL THEN 'org:' || vp.organizer_user_id ELSE 'venue:' || vp.venue_id END AS party_key,
           CASE WHEN p_venue_id IS NOT NULL THEN 'org' ELSE 'venue' END AS kind,
           CASE WHEN p_venue_id IS NULL THEN vp.venue_id END AS venue_id,
           CASE WHEN p_venue_id IS NOT NULL THEN vp.organizer_user_id END AS organizer_user_id
      FROM public.venue_organizer_partnerships vp
     WHERE vp.status = 'active'
       AND ((p_venue_id IS NOT NULL AND vp.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND vp.organizer_user_id = p_organizer_user_id))
  ),
  keys AS (
    SELECT party_key, kind, venue_id, organizer_user_id FROM together
    UNION SELECT party_key, kind, venue_id, organizer_user_id FROM pend
    UNION SELECT party_key, kind, venue_id, organizer_user_id FROM legacy
  ),
  ppl AS (
    SELECT DISTINCT ON (k.party_key) k.party_key, k.kind, k.venue_id, k.organizer_user_id
      FROM keys k ORDER BY k.party_key
  )
  SELECT COALESCE(jsonb_agg(s.r ORDER BY (s.r->>'sort')::int, s.r->>'next_at', s.r->>'last_at' DESC), '[]'::jsonb)
    INTO v_people
    FROM (
      SELECT jsonb_build_object(
        'key', x.party_key, 'kind', x.kind, 'venue_id', x.venue_id, 'organizer_user_id', x.organizer_user_id,
        'name', COALESCE(v.name, op.display_name, pr.organization_name, 'Organisateur'),
        'slug', COALESCE(v.slug, op.slug),
        'avatar_url', COALESCE(v.logo_url, op.avatar_url, pr.organization_logo_url),
        'city', COALESCE(v.city, op.city),
        'events_total', (SELECT count(DISTINCT t.event_id) FROM together t WHERE t.party_key = x.party_key),
        'events_upcoming', (SELECT count(DISTINCT t.event_id) FROM together t WHERE t.party_key = x.party_key AND t.end_at >= now()),
        'next_event', (SELECT jsonb_build_object('id', t.event_id, 'title', t.title, 'start_at', t.start_at)
                         FROM together t WHERE t.party_key = x.party_key AND t.end_at >= now()
                        ORDER BY t.start_at LIMIT 1),
        'next_at', (SELECT min(t.start_at) FROM together t WHERE t.party_key = x.party_key AND t.end_at >= now()),
        'last_at', (SELECT max(t.start_at) FROM together t WHERE t.party_key = x.party_key AND t.end_at < now()),
        'pending', COALESCE((SELECT jsonb_agg(jsonb_build_object('dir', pd.dir, 'event_id', pd.event_id,
                                'title', pd.title, 'start_at', pd.start_at, 'role', pd.role) ORDER BY pd.start_at)
                               FROM pend pd WHERE pd.party_key = x.party_key), '[]'::jsonb),
        'sort', CASE
          WHEN EXISTS (SELECT 1 FROM pend pd WHERE pd.party_key = x.party_key AND pd.dir = 'in') THEN 0
          WHEN EXISTS (SELECT 1 FROM together t WHERE t.party_key = x.party_key AND t.end_at >= now()) THEN 1
          WHEN EXISTS (SELECT 1 FROM pend pd WHERE pd.party_key = x.party_key) THEN 2
          ELSE 3 END
      ) AS r
      FROM ppl x
      LEFT JOIN public.venues v ON v.id = x.venue_id
      LEFT JOIN public.organizer_profiles op ON op.user_id = x.organizer_user_id
      LEFT JOIN public.profiles pr ON pr.id = x.organizer_user_id
     WHERE (x.venue_id IS NULL OR v.decommissioned_at IS NULL)
    ) s;

  -- Invitations envoyées par email, pas encore acceptées.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('email', q.email, 'name', q.name, 'kind', q.kind,
           'event_id', q.event_id, 'title', q.title, 'start_at', q.start_at, 'sent_at', q.sent_at) ORDER BY q.sent_at DESC), '[]'::jsonb)
    INTO v_emails
    FROM (
      SELECT i.email, i.name, 'org'::text AS kind, i.event_id, e.title, e.start_at, i.created_at AS sent_at
        FROM public.event_cohost_email_invites i JOIN public.events e ON e.id = i.event_id
       WHERE i.invited_by_party = v_key AND i.status = 'pending' AND i.expires_at > now()
      UNION ALL
      SELECT ci.club_email, ci.club_name, 'venue', ci.event_id, e.title, e.start_at, ci.created_at
        FROM public.venue_claim_invitations ci LEFT JOIN public.events e ON e.id = ci.event_id
       WHERE p_organizer_user_id IS NOT NULL AND ci.organizer_user_id = p_organizer_user_id
         AND ci.status = 'pending' AND (ci.expires_at IS NULL OR ci.expires_at > now())
      UNION ALL
      SELECT oi.organizer_email, oi.organizer_name, 'org', oi.event_id, e.title, e.start_at, oi.created_at
        FROM public.organizer_claim_invitations oi LEFT JOIN public.events e ON e.id = oi.event_id
       WHERE p_venue_id IS NOT NULL AND oi.inviting_venue_id = p_venue_id
         AND oi.status = 'pending' AND (oi.expires_at IS NULL OR oi.expires_at > now())
    ) q;

  RETURN jsonb_build_object('people', v_people, 'emails', v_emails);
END;
$$;
REVOKE ALL ON FUNCTION public.get_collab_directory(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_collab_directory(text, uuid) TO authenticated;
