-- ============================================================================
-- AJOUT DÉMO — compte "Hôte VIP" (viphost@womber.fr) rattaché au club Yuno.
--
-- Script ADDITIF et IDEMPOTENT : ne relance PAS seed-demo-womber.sql (qui
-- supprimerait les events édités à la main). Crée uniquement le compte VIP host
-- manquant, pour pouvoir tester l'écran /vip-host (et son intro first-run) via
-- le DemoSwitcher.
--
-- À COLLER DANS : Supabase Dashboard > SQL Editor (projet fulawxvdlwtdlpkycixe).
-- Identifiants : viphost@womber.fr / YunoDemo2026!  (PIN staff 123456).
--
-- Pour le retirer plus tard :
--   DELETE FROM user_roles WHERE user_id = (SELECT id FROM auth.users WHERE email='viphost@womber.fr');
--   DELETE FROM auth.users WHERE email = 'viphost@womber.fr';
-- ============================================================================

DO $$
DECLARE
  v_pw    text := 'YunoDemo2026!';
  v_email text := 'viphost@womber.fr';
  v_owner uuid;
  v_venue text;
  v_org   uuid;
  uid     uuid;
  v_salt  text;
  v_pin   text;
BEGIN
  -- Owner + club Yuno (même résolution que le seed principal)
  SELECT id INTO v_owner FROM auth.users WHERE email = 'owner@womber.fr';
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'owner@womber.fr introuvable — lance d''abord seed-demo-womber.sql.';
  END IF;

  SELECT v.id INTO v_venue FROM venues v WHERE v.owner_id = v_owner LIMIT 1;
  IF v_venue IS NULL THEN
    SELECT p.venue_id INTO v_venue FROM profiles p WHERE p.id = v_owner AND p.venue_id IS NOT NULL;
  END IF;
  IF v_venue IS NULL THEN
    RAISE EXCEPTION 'Club Yuno introuvable — lance d''abord seed-demo-womber.sql.';
  END IF;

  SELECT id INTO v_org FROM auth.users WHERE email = 'organizer@womber.fr';

  -- Créer le compte auth viphost@ si absent (même pattern que le seed)
  SELECT id INTO uid FROM auth.users WHERE email = v_email;
  IF uid IS NULL THEN
    uid := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token)
    VALUES (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_pw, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('first_name', 'Léa', 'last_name', 'Yuno'),
      now(), now(), '', '', '', '');
    INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider,
                                 last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), uid::text, uid,
            jsonb_build_object('sub', uid::text, 'email', v_email, 'email_verified', true),
            'email', now(), now(), now());
    RAISE NOTICE 'Compte créé : %', v_email;
  ELSE
    -- garantir le mdp démo (pour le switch in-app via signInWithPassword)
    UPDATE auth.users SET encrypted_password = extensions.crypt(v_pw, extensions.gen_salt('bf')) WHERE id = uid;
  END IF;

  -- Profil + rattachement club + PIN staff (format salt:sha256, comme le seed).
  -- email est NOT NULL ; on le fournit au cas où le trigger handle_new_user
  -- n'a pas (encore) créé la ligne profiles.
  INSERT INTO profiles (id, email) VALUES (uid, v_email) ON CONFLICT (id) DO NOTHING;
  v_salt := gen_random_uuid()::text;
  v_pin  := v_salt || ':' || encode(extensions.digest('123456' || v_salt, 'sha256'), 'hex');
  UPDATE profiles SET venue_id = v_venue, employee_pin = v_pin WHERE id = uid;

  -- Rôle vip_host (VipHostRoute = RequireRole(['vip_host','owner']) + RequireStaffSession(['vip_host'])).
  -- VIP host est un rôle CLUB (venue), pas org — pas de rattachement org_staff
  -- (org_staff.role n'autorise pas 'vip_host').
  INSERT INTO user_roles (user_id, role) SELECT uid, 'vip_host'::app_role
    WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = uid AND role = 'vip_host'::app_role);

  RAISE NOTICE 'VIP host démo prêt : % (club %, PIN 123456)', v_email, v_venue;
END $$;
