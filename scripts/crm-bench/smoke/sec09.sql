-- SEC-09 sur la PROD, annulé (rehearse.mjs) :
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/sec09.sql \
--     20261026100000_promoter_conversion_scope.sql \
--     20261026100100_agency_promoter_contract_policy.sql
-- Après les migrations : record_promoter_conversion porte ses deux gardes et
-- n'est pas exécutable par anon ; la policy ALL de l'agence est remplacée par
-- quatre policies. En service_role, une commission hors périmètre rend
-- `out_of_scope` sans rien écrire, une commission dans le périmètre s'écrit
-- encore. Un promoteur ne se crédite plus de billet. Un chef d'agence ne crée
-- ni ne déplace de promoteur hors contrat actif, mais règle encore ses fiches.
-- Tout est annulé. Validé au banc par sec09.mjs run.
-- Le DO bascule en `service_role` puis `authenticated` (SET LOCAL ROLE) : il
-- faut que l'utilisateur de l'API de gestion en soit membre (c'est le cas de
-- `postgres` sur Supabase).
DO $smoke$
DECLARE
  v_out jsonb := '{}'::jsonb;
  v_sig constant text := 'public.record_promoter_conversion(uuid,text,numeric,uuid,uuid,uuid,uuid,uuid,timestamptz,numeric)';
  v_pr record;
  v_ev uuid;
  v_in uuid;
  v_res jsonb;
  v_before bigint;
  v_after bigint;
  v_ag record;
  v_venue text;
  v_ap uuid;
  v_n int;
BEGIN
  -- 1. Les pièces sont posées.
  IF to_regprocedure('public.agency_owner_can_place_promoter(uuid,text,uuid)') IS NULL
     OR to_regprocedure('public.promoter_agency_scope_unchanged(uuid,uuid,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'SMOKE_FAIL fonctions de la policy agence absentes';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'promoters'
                AND policyname = 'Agency owner manages own promoters') THEN
    RAISE EXCEPTION 'SMOKE_FAIL l''ancienne policy ALL de l''agence est encore là';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'promoters'
         AND policyname IN ('Agency owner views own promoters', 'Agency owner adds promoters under an active contract',
                            'Agency owner updates own promoters', 'Agency owner removes own promoters')) <> 4 THEN
    RAISE EXCEPTION 'SMOKE_FAIL les quatre policies de l''agence ne sont pas toutes posées';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = v_sig::regprocedure) NOT LIKE '%out_of_scope%' THEN
    RAISE EXCEPTION 'SMOKE_FAIL record_promoter_conversion sans garde de périmètre';
  END IF;
  IF has_function_privilege('anon', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'SMOKE_FAIL record_promoter_conversion exécutable par anon';
  END IF;

  -- 2. Un promoteur avec compte, une soirée dont il n'est pas partie, une
  --    soirée dont il l'est.
  SELECT p.id, p.user_id, p.venue_id, p.organizer_user_id INTO v_pr
    FROM public.promoters p
   WHERE p.user_id IS NOT NULL AND p.is_active
     -- Sur la prod, jamais un vrai compte : promoteurs démo (@womber.fr) seulement ; @bench.test = le banc.
     AND (SELECT u.email FROM auth.users u WHERE u.id = p.user_id) ~* '@((demo\.)?womber\.fr|bench\.test)$'
     AND (p.venue_id IS NOT NULL OR p.organizer_user_id IS NOT NULL)
   ORDER BY (p.venue_id = 'womber') DESC, p.created_at
   LIMIT 1;
  IF v_pr.id IS NULL THEN
    RAISE EXCEPTION 'SMOKE_OK pièces posées ; scénarios non joués : aucun promoteur actif avec compte';
  END IF;
  SELECT e.id INTO v_ev FROM public.events e
   -- Une portée absente du promoteur (NULL) n'exclut rien : sans ces gardes,
   -- un promoteur de club sans organisateur ne trouvait aucune soirée.
   WHERE (v_pr.venue_id IS NULL OR (e.venue_id IS DISTINCT FROM v_pr.venue_id
                                     AND e.partner_venue_id IS DISTINCT FROM v_pr.venue_id))
     AND (v_pr.organizer_user_id IS NULL OR (e.organizer_user_id IS DISTINCT FROM v_pr.organizer_user_id
                                              AND e.partner_organizer_id IS DISTINCT FROM v_pr.organizer_user_id))
     AND NOT EXISTS (SELECT 1 FROM public.event_cohosts c WHERE c.event_id = e.id AND c.status = 'accepted'
                        AND (c.venue_id = v_pr.venue_id OR c.organizer_user_id = v_pr.organizer_user_id))
   ORDER BY e.start_at DESC LIMIT 1;
  SELECT e.id INTO v_in FROM public.events e
   WHERE e.venue_id = v_pr.venue_id OR e.organizer_user_id = v_pr.organizer_user_id
   ORDER BY e.start_at DESC LIMIT 1;

  -- 3. Les checkouts et verify-*-payment : service_role.
  SELECT count(*) INTO v_before FROM public.promoter_conversions;
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF v_ev IS NOT NULL THEN
    v_res := public.record_promoter_conversion(p_promoter_id := v_pr.id, p_conversion_type := 'ticket',
                                               p_amount := 1, p_event_id := v_ev);
    IF NOT COALESCE((v_res->>'out_of_scope')::boolean, false) THEN
      RAISE EXCEPTION 'SMOKE_FAIL commission hors périmètre acceptée : %', v_res;
    END IF;
    SELECT count(*) INTO v_after FROM public.promoter_conversions;
    IF v_after <> v_before THEN RAISE EXCEPTION 'SMOKE_FAIL une commission hors périmètre a été écrite'; END IF;
    v_out := v_out || jsonb_build_object('hors_perimetre', 'out_of_scope, rien d''écrit');
  END IF;
  IF v_in IS NOT NULL THEN
    v_res := public.record_promoter_conversion(p_promoter_id := v_pr.id, p_conversion_type := 'ticket',
                                               p_amount := 1, p_event_id := v_in);
    IF v_res->>'conversion_id' IS NULL THEN
      RAISE EXCEPTION 'SMOKE_FAIL commission dans le périmètre refusée : %', v_res;
    END IF;
    v_out := v_out || jsonb_build_object('dans_le_perimetre', 'écrite');
  END IF;
  EXECUTE 'RESET ROLE';

  -- 4. Le promoteur lui-même, comme PostgREST.
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pr.user_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_pr.user_id::text, true);
  BEGIN
    PERFORM public.record_promoter_conversion(p_promoter_id := v_pr.id, p_conversion_type := 'ticket', p_amount := 10000);
    RAISE EXCEPTION 'SMOKE_FAIL le promoteur s''est crédité une commission de billet';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Not authorized to record this conversion%' THEN RAISE; END IF;
  END;
  EXECUTE 'RESET ROLE';
  v_out := v_out || jsonb_build_object('promoteur_seul', 'refusé');

  -- 5. Un chef d'agence (pas super admin) et un club sans contrat actif avec
  --    son agence, qu'il ne possède ni ne gère.
  SELECT a.id AS agency_id, a.owner_user_id INTO v_ag
    FROM public.agencies a
   WHERE a.owner_user_id IS NOT NULL
     -- Sur la prod, jamais un vrai compte : agences démo (@womber.fr) seulement ; @bench.test = le banc.
     AND (SELECT u.email FROM auth.users u WHERE u.id = a.owner_user_id) ~* '@((demo\.)?womber\.fr|bench\.test)$'
     AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = a.owner_user_id AND r.role = 'admin')
   ORDER BY EXISTS (SELECT 1 FROM public.promoters p WHERE p.agency_id = a.id) DESC, a.created_at
   LIMIT 1;
  IF v_ag.agency_id IS NULL THEN
    RAISE EXCEPTION 'SMOKE_OK % ; agence non jouée : aucune agence', v_out;
  END IF;
  SELECT v.id INTO v_venue FROM public.venues v
   WHERE v.owner_id IS DISTINCT FROM v_ag.owner_user_id
     AND NOT public.manager_has_permission(v_ag.owner_user_id, v.id, 'promoters')
     AND NOT EXISTS (SELECT 1 FROM public.agency_venue_contracts c
                      WHERE c.agency_id = v_ag.agency_id AND c.venue_id = v.id AND c.status = 'active')
   ORDER BY v.id LIMIT 1;
  SELECT p.id INTO v_ap FROM public.promoters p WHERE p.agency_id = v_ag.agency_id ORDER BY p.created_at LIMIT 1;

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ag.owner_user_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_ag.owner_user_id::text, true);
  IF public.is_super_admin() THEN
    RAISE EXCEPTION 'SMOKE_FAIL le chef d''agence choisi est super admin';
  END IF;
  IF v_venue IS NOT NULL THEN
    BEGIN
      INSERT INTO public.promoters (agency_id, venue_id, promo_code, first_name, is_active)
      VALUES (v_ag.agency_id, v_venue, 'SMOKESEC09', 'Smoke', true);
      RAISE EXCEPTION 'SMOKE_FAIL le chef d''agence a créé un promoteur hors contrat';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    v_out := v_out || jsonb_build_object('agence_creation_hors_contrat', 'refusée');
  END IF;
  IF v_ap IS NOT NULL THEN
    IF v_venue IS NOT NULL THEN
      BEGIN
        UPDATE public.promoters SET venue_id = v_venue WHERE id = v_ap;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n = 0 THEN RAISE EXCEPTION 'SMOKE_FAIL le chef d''agence ne voit pas son promoteur'; END IF;
        RAISE EXCEPTION 'SMOKE_FAIL le chef d''agence a déplacé son promoteur hors contrat';
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
      v_out := v_out || jsonb_build_object('agence_deplacement_hors_contrat', 'refusé');
    END IF;
    UPDATE public.promoters SET agency_ticket_cap = COALESCE(agency_ticket_cap, 0) + 1 WHERE id = v_ap;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'SMOKE_FAIL le chef d''agence ne règle plus le plafond de son promoteur'; END IF;
    v_out := v_out || jsonb_build_object('agence_plafond', 'modifié');
  END IF;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'SMOKE_OK %', v_out;
END
$smoke$;
