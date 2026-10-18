-- SEC-06 sur la PROD, annulé (rehearse.mjs) :
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/sec06.sql \
--     20261024100000_promoter_settlement_guards.sql
-- Après la migration : les deux gardes sont INVOKER et posés ; un PATCH direct
-- du propriétaire d'un club sur une commission est refusé ; le cycle en trois
-- temps (préparer, déclarer, confirmer) passe de bout en bout sur un promoteur
-- placé dans un club qui a des commissions dues : le club démo d'abord (au 18/10,
-- les 15 commissions en attente de la prod y sont, chez des promoteurs
-- d'agence, réglés par leur agence), sinon un autre. Tout est annulé :
-- rien n'est réglé, aucune ligne ne reste. Validé au banc par sec06.mjs run.
-- Le DO bascule en `authenticated` (SET LOCAL ROLE) : il faut que l'utilisateur
-- de l'API de gestion en soit membre (c'est le cas de `postgres` sur Supabase).
DO $smoke$
DECLARE
  v_out jsonb := '{}'::jsonb;
  v_pr record;
  v_conv uuid;
  v_n int;
  v_res jsonb;
  v_payout uuid;
  v_count int;
  v_paid int;
BEGIN
  -- 1. Les gardes : INVOKER, et chacun sur sa table.
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.guard_promoter_payout_write()'::regprocedure) THEN
    RAISE EXCEPTION 'SMOKE_FAIL guard_promoter_payout_write est SECURITY DEFINER';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.guard_promoter_conversion_settlement()'::regprocedure) THEN
    RAISE EXCEPTION 'SMOKE_FAIL guard_promoter_conversion_settlement est SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_guard_promoter_conversion_settlement'
                    AND tgrelid = 'public.promoter_conversions'::regclass AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'SMOKE_FAIL trigger trg_guard_promoter_conversion_settlement absent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_guard_promoter_payout_write'
                    AND tgrelid = 'public.promoter_payouts'::regclass AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'SMOKE_FAIL trigger trg_guard_promoter_payout_write absent';
  END IF;

  -- 2. Un promoteur placé dans un club, avec des commissions dues et aucun lot
  --    ouvert. Celui qui règle : son agence s'il en a une, sinon le club.
  SELECT p.id, p.user_id, v.owner_id, COALESCE(a.owner_user_id, v.owner_id) AS payer,
         p.agency_id IS NOT NULL AS by_agency,
         (p.iban IS NULL OR length(trim(p.iban)) < 8) AS no_iban,
         (p.iban_changed_at > now() - interval '24 hours') AS iban_fresh
    INTO v_pr
    FROM public.promoters p JOIN public.venues v ON v.id = p.venue_id
    LEFT JOIN public.agencies a ON a.id = p.agency_id
   WHERE p.user_id IS NOT NULL AND v.owner_id IS NOT NULL
     AND (p.agency_id IS NULL OR a.owner_user_id IS NOT NULL)
     AND EXISTS (SELECT 1 FROM public.promoter_conversions c
                  WHERE c.promoter_id = p.id AND c.status = 'pending' AND COALESCE(c.commission, 0) > 0
                    AND NOT EXISTS (SELECT 1 FROM public.promoter_payout_items i WHERE i.conversion_id = c.id))
     AND NOT EXISTS (SELECT 1 FROM public.promoter_payouts pp
                      WHERE pp.promoter_id = p.id AND pp.status IN ('pending', 'approved', 'disputed'))
   ORDER BY (p.venue_id IN ('womber', 'goya-social-club')) DESC, (p.agency_id IS NOT NULL) DESC, p.created_at
   LIMIT 1;
  IF v_pr.id IS NULL THEN
    RAISE EXCEPTION 'SMOKE_OK gardes posés ; cycle non joué : aucun promoteur de club avec des commissions dues';
  END IF;
  SELECT c.id INTO v_conv FROM public.promoter_conversions c
   WHERE c.promoter_id = v_pr.id AND c.status = 'pending' AND COALESCE(c.commission, 0) > 0 LIMIT 1;

  -- Un IBAN de test si le promoteur n'en a pas (annulé avec le reste).
  IF v_pr.no_iban OR v_pr.iban_fresh THEN
    UPDATE public.promoters SET iban = COALESCE(NULLIF(trim(iban), ''), 'FR7630006000011234567890189') WHERE id = v_pr.id;
    UPDATE public.promoters SET iban_changed_at = now() - interval '3 days' WHERE id = v_pr.id;
    v_out := v_out || jsonb_build_object('iban_de_test', true);
  END IF;

  -- 3. Le propriétaire du club, comme PostgREST : rôle authenticated + claims.
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pr.owner_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_pr.owner_id::text, true);

  BEGIN
    UPDATE public.promoter_conversions SET status = 'paid', paid_at = now() WHERE id = v_conv;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN RAISE EXCEPTION 'SMOKE_FAIL le propriétaire ne voit pas la commission (RLS)'; END IF;
    RAISE EXCEPTION 'SMOKE_FAIL un PATCH direct du propriétaire a soldé une commission';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'conversion_direct_write_forbidden' THEN RAISE; END IF;
  END;
  v_out := v_out || jsonb_build_object('patch_direct', 'refusé', 'réglé_par', CASE WHEN v_pr.by_agency THEN 'agence' ELSE 'club' END);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pr.payer, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_pr.payer::text, true);
  v_res := public.prepare_promoter_payout(v_pr.id);
  IF NOT COALESCE((v_res->>'prepared')::boolean, false) THEN
    RAISE EXCEPTION 'SMOKE_FAIL prepare_promoter_payout : %', v_res;
  END IF;
  v_payout := (v_res->>'payout_id')::uuid;
  v_count := (v_res->>'count')::int;
  v_res := public.declare_promoter_payout_sent(v_payout);
  IF NOT COALESCE((v_res->>'declared')::boolean, false) THEN
    RAISE EXCEPTION 'SMOKE_FAIL declare_promoter_payout_sent : %', v_res;
  END IF;

  -- 4. Le promoteur accuse réception.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pr.user_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_pr.user_id::text, true);
  v_res := public.confirm_promoter_payout_received(v_payout);
  IF NOT COALESCE((v_res->>'confirmed')::boolean, false) THEN
    RAISE EXCEPTION 'SMOKE_FAIL confirm_promoter_payout_received : %', v_res;
  END IF;
  EXECUTE 'RESET ROLE';

  SELECT count(*) INTO v_paid FROM public.promoter_conversions c JOIN public.promoter_payout_items i ON i.conversion_id = c.id
   WHERE i.payout_id = v_payout AND c.status = 'paid';
  IF v_paid <> v_count THEN
    RAISE EXCEPTION 'SMOKE_FAIL % commission(s) du lot sur % passées en paid', v_paid, v_count;
  END IF;
  IF (SELECT status FROM public.promoter_payouts WHERE id = v_payout) <> 'paid' THEN
    RAISE EXCEPTION 'SMOKE_FAIL le lot n''est pas soldé';
  END IF;
  v_out := v_out || jsonb_build_object('cycle', 'préparé, déclaré, confirmé', 'commissions_soldées', v_paid,
                                       'montant', v_res->'amount');

  RAISE EXCEPTION 'SMOKE_OK %', v_out;
END
$smoke$;
