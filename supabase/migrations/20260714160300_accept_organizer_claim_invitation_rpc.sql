-- ============================================================================
-- Flux « un club invite un ORGANISATEUR externe » : réparation complète.
--
-- ÉTAT CASSÉ constaté (audit 2026-07-14) — la page
-- src/pages/AcceptOrganizerInvitation.tsx faisait tout côté CLIENT :
--   1. Lecture de l'invitation par token : la seule policy SELECT de
--      organizer_claim_invitations est réservée aux owners du club → l'invité
--      qui clique le lien de l'email voit « Invitation introuvable ». Mort-né.
--   2. Même en lisant : INSERT user_roles (réservé super-admin/owner-manager),
--      INSERT venue_organizer_partnerships avec initiated_by='venue' (exige
--      is_venue_owner), UPDATE events — tous rejetés par RLS. supabase-js ne
--      lève pas d'exception sur un rejet RLS et la page ne lisait pas `error`
--      → toast « Partenariat activé 🎉 » mensonger, zéro écriture en base.
--   3. Aucune vérification que l'accepteur est bien le destinataire de
--      l'email (contrairement au flux miroir accept-club-collab-invitation).
--
-- FIX : trois RPC SECURITY DEFINER (pas d'edge function → pas de plafond de
-- déploiement), transactionnelles et atomiques :
--   - get_organizer_claim_invitation(token)  : lecture publique restreinte
--     aux champs d'affichage (pas de PII du club au-delà du nécessaire).
--   - accept_organizer_claim_invitation(token) : vérifie expiration + statut
--     + IDENTITÉ (email du compte connecté = organizer_email, insensible à la
--     casse), promeut le profil en organisateur, pose le rôle, crée le
--     partenariat actif (avec les default_split_rules de l'invitation),
--     rattache l'event en co_event, marque l'invitation acceptée — tout ou
--     rien.
--   - decline_organizer_claim_invitation(token) : refus par le détenteur du
--     lien (action inoffensive, autorisée sans compte).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_organizer_claim_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv RECORD;
BEGIN
  SELECT i.id, i.organizer_email, i.organizer_name, i.contact_first_name,
         i.contact_last_name, i.invitation_message, i.inviting_venue_id,
         i.event_id, i.status, i.expires_at
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
$$;

CREATE OR REPLACE FUNCTION public.accept_organizer_claim_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  inv RECORD;
  v_org_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
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
    NULLIF(inv.organizer_name, ''),
    NULLIF(trim(COALESCE(inv.contact_first_name, '') || ' ' || COALESCE(inv.contact_last_name, '')), '')
  );

  -- 1. Promotion du profil en organisateur.
  UPDATE profiles
     SET profile_type = 'organizer',
         organization_name = COALESCE(organization_name, v_org_name),
         first_name = COALESCE(first_name, inv.contact_first_name),
         last_name = COALESCE(last_name, inv.contact_last_name)
   WHERE id = v_uid;

  -- 2. Rôle organisateur.
  INSERT INTO user_roles (user_id, role, email)
  VALUES (v_uid, 'organizer', v_email)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- 3. Partenariat actif club ↔ orga (les défauts de split de l'invitation
  --    deviennent les défauts du partenariat). Idempotent si une paire
  --    pending/active existe déjà : on l'active.
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

  -- 4. Rattachement de la soirée en co-event (l'orga rejoint comme partenaire).
  IF inv.event_id IS NOT NULL THEN
    UPDATE events
       SET partner_organizer_id = v_uid,
           event_mode = CASE
             WHEN event_mode IS NULL OR event_mode IN ('solo_venue', 'solo_organizer')
               THEN 'co_event'
             ELSE event_mode
           END
     WHERE id = inv.event_id
       AND partner_organizer_id IS NULL;
  END IF;

  -- 5. Invitation consommée.
  UPDATE organizer_claim_invitations
     SET status = 'accepted', accepted_at = now(),
         created_organizer_user_id = v_uid, updated_at = now()
   WHERE id = inv.id;

  RETURN jsonb_build_object(
    'partnership_venue_id', inv.inviting_venue_id,
    'event_id', inv.event_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.decline_organizer_claim_invitation(p_token text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE organizer_claim_invitations
     SET status = 'declined', updated_at = now()
   WHERE token = p_token
     AND status = 'pending';
END;
$$;

-- La page d'invitation se charge avant connexion : lecture + refus ouverts au
-- détenteur du lien ; l'acceptation exige un compte (et le bon email).
GRANT EXECUTE ON FUNCTION public.get_organizer_claim_invitation(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decline_organizer_claim_invitation(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_organizer_claim_invitation(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.accept_organizer_claim_invitation(text) FROM anon;
