-- Parcours « offre fondateurs » de bout en bout sur la PROD, annulé (rehearse.mjs) :
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/founder-invite.sql \
--     [20261029100000_crm_sms_beta_access.sql]
-- Ce que fait l'Admin CRM › Inviter (offre fondateurs, organisateur, pré-profil,
-- accès assisté proposé), puis ce que fait la landing crm.yunoapp.eu/fr/start
-- ?offer=<jeton> (aperçu anonyme, suivi du parcours, compte créé, ouverture),
-- et ce que le compte reçoit : essai jusqu'à la fin de l'offre, 15 000 Yunits,
-- place prise, demande d'accès assisté en attente, alerte super admin. Adresse
-- fictive @bench.test, compte auth créé DANS la transaction : tout est annulé.
DO $smoke$
DECLARE
  v_admin uuid := (SELECT id FROM auth.users WHERE email = 'crm@womber.fr');
  v_cfg jsonb := public.crm_founder_offer_config();
  v_seats0 int := public._crm_offer_seats_taken();
  v_inv jsonb;
  v_token text;
  v_inv_id uuid;
  v_prev jsonb;
  v_key text := 'smoke3am' || substr(md5(random()::text), 1, 16);
  v_uid uuid := gen_random_uuid();
  v_email text := 'jules-' || substr(md5(random()::text), 1, 8) || '@bench.test';
  v_done jsonb;
  v_scope text;
  v_sub record;
  v_bal int;
  v_n int;
  v_sms jsonb;
BEGIN
  IF v_admin IS NULL THEN RAISE EXCEPTION 'SMOKE_FAIL compte démo introuvable'; END IF;

  -- 1. Admin CRM › Inviter : offre fondateurs (porte admin franchie comme le serveur).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'service_role')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_inv := public.crm_admin_invite_create(jsonb_build_object(
    'offer', 'founder', 'kind', 'organizer', 'org_name', '3AM (smoke)', 'contact_name', 'Jules Test',
    'email', v_email, 'phone', '+33 6 12 34 56 78', 'city', 'Paris', 'lang', 'fr', 'support_offer', true));
  -- Le jeton ne sort que dans l'URL (celle que l'Admin CRM copie ou met dans WhatsApp).
  v_token := substring(v_inv->>'url' FROM 'offer=([A-Za-z0-9_-]+)$');
  v_inv_id := (v_inv->>'id')::uuid;
  IF v_token IS NULL OR v_inv->>'url' IS DISTINCT FROM 'https://crm.yunoapp.eu/fr/start?offer=' || v_token THEN
    RAISE EXCEPTION 'SMOKE_FAIL lien %', v_inv;
  END IF;
  IF public._crm_offer_seats_taken() <> v_seats0 + 1 THEN RAISE EXCEPTION 'SMOKE_FAIL place non prise par le lien'; END IF;

  -- 2. La landing ouvre le lien (visiteur anonyme) : pré-profil et offre.
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_prev := public.crm_offer_invite_preview(v_token);
  IF v_prev->>'status' <> 'ok' OR v_prev->>'offer' <> 'founder' OR v_prev->>'first_name' <> 'Jules' OR v_prev->>'last_name' <> 'Test'
     OR v_prev->>'email' <> v_email OR (v_prev->>'free_months')::int <> (v_cfg->>'free_months')::int OR (v_prev->>'yunits')::int <> (v_cfg->>'yunits')::int THEN
    RAISE EXCEPTION 'SMOKE_FAIL aperçu %', v_prev;
  END IF;
  IF (SELECT opened_at FROM public.crm_offer_invites WHERE id = v_inv_id) IS NULL THEN RAISE EXCEPTION 'SMOKE_FAIL ouverture non notée'; END IF;
  PERFORM public.track_pro_signup(v_key, 'opened', jsonb_build_object('offer', v_token, 'lang', 'fr'));
  PERFORM public.track_pro_signup(v_key, 'role', jsonb_build_object('kind', 'organizer', 'offer', v_token));
  PERFORM public.track_pro_signup(v_key, 'structure', jsonb_build_object('org_name', '3AM (smoke)', 'city', 'Paris', 'offer', v_token));
  PERFORM public.track_pro_signup(v_key, 'account', jsonb_build_object('email', v_email, 'offer', v_token));
  IF NOT EXISTS (SELECT 1 FROM public.pro_signups WHERE client_key = v_key AND offer_invite_id = v_inv_id AND product = 'crm' AND kind = 'organizer') THEN
    RAISE EXCEPTION 'SMOKE_FAIL brouillon %', (SELECT to_jsonb(s) - 'visitor_hash' FROM public.pro_signups s WHERE client_key = v_key);
  END IF;

  -- 3. Le compte est créé (auth.signUp), puis la landing ouvre l'espace.
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_email, '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated', 'email', v_email)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  v_done := public.complete_pro_signup(v_key);
  IF v_done->>'product' <> 'crm' OR COALESCE((v_done->'offer'->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'SMOKE_FAIL ouverture %', v_done;
  END IF;
  v_scope := 'org:' || v_uid::text;

  -- 4. Ce que le compte reçoit.
  SELECT * INTO v_sub FROM public.crm_subscriptions WHERE scope_key = v_scope;
  IF v_sub IS NULL OR v_sub.status <> 'trialing' OR v_sub.offer <> 'founder' OR NOT v_sub.founder
     OR v_sub.trial_ends_at IS DISTINCT FROM v_sub.offer_until
     OR v_sub.offer_until < now() + make_interval(months => (v_cfg->>'free_months')::int) - interval '1 day'
     OR v_sub.offer_until > now() + make_interval(months => (v_cfg->>'free_months')::int) + interval '1 day' THEN
    RAISE EXCEPTION 'SMOKE_FAIL abonnement %', to_jsonb(v_sub);
  END IF;
  IF public.crm_effective_plan(v_scope) <> 'base' THEN RAISE EXCEPTION 'SMOKE_FAIL offre effective %', public.crm_effective_plan(v_scope); END IF;
  v_bal := public.crm_yunits_balance(v_scope);
  IF v_bal <> (v_cfg->>'yunits')::int THEN RAISE EXCEPTION 'SMOKE_FAIL Yunits % au lieu de %', v_bal, v_cfg->>'yunits'; END IF;
  IF (SELECT status FROM public.crm_offer_invites WHERE id = v_inv_id) <> 'claimed'
     OR (SELECT scope_key FROM public.crm_offer_invites WHERE id = v_inv_id) <> v_scope THEN
    RAISE EXCEPTION 'SMOKE_FAIL invitation non rattachée';
  END IF;
  IF public._crm_offer_seats_taken() <> v_seats0 + 1 THEN RAISE EXCEPTION 'SMOKE_FAIL places % au lieu de %', public._crm_offer_seats_taken(), v_seats0 + 1; END IF;
  IF (SELECT product FROM public.organizer_profiles WHERE user_id = v_uid) <> 'crm' THEN RAISE EXCEPTION 'SMOKE_FAIL produit du compte'; END IF;
  IF NOT public.crm_scope_allowed(NULL, v_uid) THEN RAISE EXCEPTION 'SMOKE_FAIL Console fermée au titulaire'; END IF;
  SELECT count(*) INTO v_n FROM public.admin_support_grants WHERE target_user_id = v_uid AND status = 'pending';
  IF v_n <> 1 THEN RAISE EXCEPTION 'SMOKE_FAIL accès assisté proposé : %', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.admin_notifications WHERE dedup_key = 'crm_offer_claimed:' || v_inv_id::text;
  IF v_n <> 1 THEN RAISE EXCEPTION 'SMOKE_FAIL alerte offre fondateurs : %', v_n; END IF;

  -- 5. SMS en bêta privée (si 20261029100000 est jouée) : fermé, demandable.
  IF to_regprocedure('public.crm_sms_access_get(text, uuid)') IS NOT NULL THEN
    v_sms := public.crm_sms_access_get(NULL, v_uid);
    IF v_sms->>'status' <> 'none' THEN RAISE EXCEPTION 'SMOKE_FAIL SMS %', v_sms; END IF;
    v_sms := public.crm_sms_access_request(NULL, v_uid, ARRAY['last_call'], 'lt2k', '3AM', NULL);
    IF v_sms->>'status' <> 'requested' OR public.crm_sms_access_open(v_scope) THEN RAISE EXCEPTION 'SMOKE_FAIL demande SMS %', v_sms; END IF;
    SELECT count(*) INTO v_n FROM public.admin_notifications WHERE notification_type = 'admin_crm_sms_access_request' AND reference_id = v_scope;
    IF v_n <> 1 THEN RAISE EXCEPTION 'SMOKE_FAIL alerte SMS : %', v_n; END IF;
  END IF;

  RAISE EXCEPTION 'SMOKE_OK %', jsonb_build_object('lien', 'crm.yunoapp.eu/fr/start?offer=…', 'apercu', 'Jules Test', 'essai_jusqu_au', v_sub.offer_until,
    'yunits', v_bal, 'places', public._crm_offer_seats_taken(), 'acces_assiste', 'proposé', 'sms', COALESCE(v_sms->>'status', 'non testé'));
END
$smoke$;
