-- SMS en bêta privée (20261029100000) sur la PROD, annulé (rehearse.mjs) :
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/sms-beta.sql \
--     20261029100000_crm_sms_beta_access.sql
-- Compte démo CRM seulement (crm@womber.fr). La demande est enregistrée sans
-- alerte (démo), un autre compte ne lit ni ne demande, le pro ne peut pas
-- s'ouvrir l'accès lui-même, l'ouverture admin ouvre la porte serveur et le
-- fil de notifications, une nouvelle demande ne referme pas un accès ouvert.
-- Tout est annulé.
DO $smoke$
DECLARE
  v_org uuid := (SELECT id FROM auth.users WHERE email = 'crm@womber.fr');
  v_other uuid := (SELECT id FROM auth.users WHERE email = 'organizer@womber.fr');
  v_scope text;
  v_r jsonb;
  v_n int;
  v_denied boolean;
BEGIN
  IF v_org IS NULL OR v_other IS NULL THEN RAISE EXCEPTION 'SMOKE_FAIL comptes démo introuvables'; END IF;
  v_scope := public.crm_scope_key(NULL, v_org);

  -- Droits : rien pour anon, la porte serveur au seul service_role.
  IF has_function_privilege('anon', 'public.crm_sms_access_request(text, uuid, text[], text, text, text)', 'execute')
     OR has_function_privilege('anon', 'public.crm_sms_access_get(text, uuid)', 'execute')
     OR has_function_privilege('authenticated', 'public.crm_sms_access_open(text)', 'execute')
     OR has_function_privilege('anon', 'public.crm_admin_sms_access_set(text, text, text)', 'execute') THEN
    RAISE EXCEPTION 'SMOKE_FAIL droits trop larges';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org::text, true);

  v_r := public.crm_sms_access_get(NULL, v_org);
  IF v_r->>'status' IS DISTINCT FROM 'none' THEN RAISE EXCEPTION 'SMOKE_FAIL état initial %', v_r; END IF;

  -- Usage inconnu écarté, au moins un exigé.
  v_denied := false;
  BEGIN PERFORM public.crm_sms_access_request(NULL, v_org, ARRAY['bogus'], 'lt500', NULL, NULL);
  EXCEPTION WHEN invalid_parameter_value THEN v_denied := true; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'SMOKE_FAIL demande sans usage acceptée'; END IF;

  v_r := public.crm_sms_access_request(NULL, v_org, ARRAY['announce', 'bogus', 'last_call', 'announce'], 'lt500', '3AM-Paris!', ' pour la soirée ');
  IF v_r->>'status' <> 'requested' THEN RAISE EXCEPTION 'SMOKE_FAIL demande %', v_r; END IF;
  v_r := public.crm_sms_access_get(NULL, v_org);
  IF v_r->>'status' <> 'requested' OR v_r->'use_cases' <> '["announce", "last_call"]'::jsonb
     OR v_r->>'sender_wish' <> '3AMParis' OR v_r->>'volume' <> 'lt500' OR v_r ? 'decision_reason' THEN
    RAISE EXCEPTION 'SMOKE_FAIL lecture après demande %', v_r;
  END IF;
  SELECT count(*) INTO v_n FROM public.admin_notifications WHERE dedup_key LIKE 'crm_sms_access_request:' || v_scope || ':%';
  IF v_n <> 0 THEN RAISE EXCEPTION 'SMOKE_FAIL alerte émise pour la démo'; END IF;

  -- Le pro ne s'ouvre pas l'accès lui-même ; la porte reste fermée.
  v_denied := false;
  BEGIN PERFORM public.crm_admin_sms_access_set(v_scope, 'granted', 'moi-même');
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'SMOKE_FAIL le pro a ouvert son propre accès'; END IF;
  IF public.crm_sms_access_open(v_scope) THEN RAISE EXCEPTION 'SMOKE_FAIL porte ouverte sur une simple demande'; END IF;

  -- Un autre compte ne lit ni ne demande pour cet espace.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  v_denied := false;
  BEGIN PERFORM public.crm_sms_access_get(NULL, v_org);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'SMOKE_FAIL un autre compte lit l''accès'; END IF;
  v_denied := false;
  BEGIN PERFORM public.crm_sms_access_request(NULL, v_org, ARRAY['announce'], 'lt500', NULL, NULL);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'SMOKE_FAIL un autre compte demande l''accès'; END IF;

  -- Ouverture côté Yuno (porte admin franchie comme le ferait le serveur ;
  -- le journal d'audit veut un auteur : la démo, annulée avec le reste).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org, 'role', 'service_role')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org::text, true);
  v_denied := false;
  BEGIN PERFORM public.crm_admin_sms_access_set(v_scope, 'granted', 'x');
  EXCEPTION WHEN invalid_parameter_value THEN v_denied := true; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'SMOKE_FAIL ouverture sans motif acceptée'; END IF;
  v_r := public.crm_admin_sms_access_set(v_scope, 'granted', 'Smoke : Octopush branché');
  IF NOT public.crm_sms_access_open(v_scope) THEN RAISE EXCEPTION 'SMOKE_FAIL porte fermée après ouverture'; END IF;
  SELECT count(*) INTO v_n FROM public.admin_audit_log WHERE entity_id = v_scope AND action = 'crm_sms_access_granted' AND created_at > now() - interval '1 minute';
  IF v_n <> 1 THEN RAISE EXCEPTION 'SMOKE_FAIL audit %', v_n; END IF;
  v_r := public.crm_admin_sms_access(v_scope);
  IF v_r->>'status' <> 'granted' OR v_r->>'decision_reason' IS NULL THEN RAISE EXCEPTION 'SMOKE_FAIL lecture admin %', v_r; END IF;

  -- Le fil du pro annonce l'ouverture.
  v_r := public._crm_notif_list(NULL, v_org, v_org, false);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_r) x WHERE x->>'kind' = 'sms_access_granted') THEN
    RAISE EXCEPTION 'SMOKE_FAIL notification absente';
  END IF;

  -- Une nouvelle demande ne referme pas un accès ouvert.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org, 'role', 'authenticated')::text, true);
  v_r := public.crm_sms_access_request(NULL, v_org, ARRAY['practical'], 'gt10k', NULL, NULL);
  IF v_r->>'status' <> 'granted' OR NOT public.crm_sms_access_open(v_scope) THEN RAISE EXCEPTION 'SMOKE_FAIL accès refermé %', v_r; END IF;

  -- Refus : la porte se referme, le pro peut redemander.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org, 'role', 'service_role')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org::text, true);
  PERFORM public.crm_admin_sms_access_set(v_scope, 'declined', 'Smoke : refus');
  IF public.crm_sms_access_open(v_scope) THEN RAISE EXCEPTION 'SMOKE_FAIL porte ouverte après refus'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org, 'role', 'authenticated')::text, true);
  v_r := public.crm_sms_access_request(NULL, v_org, ARRAY['comeback'], 'unknown', NULL, NULL);
  IF v_r->>'status' <> 'requested' THEN RAISE EXCEPTION 'SMOKE_FAIL nouvelle demande après refus %', v_r; END IF;

  -- Hors démo, la demande prévient le super admin (espace fictif, porte du
  -- serveur : aucun compte réel n'est touché, et tout est annulé).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org, 'role', 'service_role')::text, true);
  PERFORM public.crm_sms_access_request(NULL, '00000000-0000-4000-8000-0000000005b5'::uuid, ARRAY['announce'], 'lt2k', 'Smoke', NULL);
  SELECT count(*) INTO v_n FROM public.admin_notifications
   WHERE notification_type = 'admin_crm_sms_access_request' AND reference_id = 'org:00000000-0000-4000-8000-0000000005b5';
  IF v_n <> 1 THEN RAISE EXCEPTION 'SMOKE_FAIL alerte super admin absente (%)', v_n; END IF;

  RAISE EXCEPTION 'SMOKE_OK %', jsonb_build_object('scope', v_scope, 'demande', 'ok', 'ouverture', 'ok', 'notification', 'ok', 'refus', 'ok', 'alerte', 'ok');
END
$smoke$;
