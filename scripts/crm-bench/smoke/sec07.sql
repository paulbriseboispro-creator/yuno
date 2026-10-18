-- SEC-07 sur la PROD, annulé (rehearse.mjs) :
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/sec07.sql \
--     20261025200000_promoter_self_update_guard.sql
-- Après la migration : le garde est INVOKER, posé, activé et premier des
-- triggers BEFORE UPDATE de `promoters` ; un promoteur sans droit de gestion
-- sur sa fiche ne relève plus sa commission ni n'antidate son changement
-- d'IBAN, mais modifie encore son profil et son IBAN (gel de 24 h posé) ; celui
-- qui le gère (son agence, sinon son club, sinon son organisateur) règle
-- encore sa commission. Tout est annulé. Validé au banc par sec07.mjs run.
-- Le DO bascule en `authenticated` (SET LOCAL ROLE) : il faut que l'utilisateur
-- de l'API de gestion en soit membre (c'est le cas de `postgres` sur Supabase).
DO $smoke$
DECLARE
  v_out jsonb := '{}'::jsonb;
  v_pr record;
  v_n int;
  v_first text;
  v_stamp timestamptz;
BEGIN
  -- 1. Le garde : INVOKER, posé, et premier des triggers BEFORE UPDATE (ordre
  --    alphabétique des noms) : il voit la ligne telle que le client l'envoie.
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.guard_promoter_self_update()'::regprocedure) THEN
    RAISE EXCEPTION 'SMOKE_FAIL guard_promoter_self_update est SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_a_guard_promoter_self_update'
                    AND tgrelid = 'public.promoters'::regclass AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'SMOKE_FAIL trigger trg_a_guard_promoter_self_update absent';
  END IF;
  SELECT min(tgname) INTO v_first FROM pg_trigger
   WHERE tgrelid = 'public.promoters'::regclass AND NOT tgisinternal
     AND (tgtype & 2) <> 0 AND (tgtype & 16) <> 0;  -- BEFORE, UPDATE
  IF v_first <> 'trg_a_guard_promoter_self_update' THEN
    RAISE EXCEPTION 'SMOKE_FAIL le garde ne passe pas en premier (%)', v_first;
  END IF;

  -- 2. Un promoteur SANS droit de gestion sur sa fiche (miroir du garde), et
  --    celui qui le gère : son agence, sinon son club, sinon son organisateur.
  SELECT p.id, p.user_id, COALESCE(a.owner_user_id, v.owner_id, p.organizer_user_id) AS manager
    INTO v_pr
    FROM public.promoters p
    LEFT JOIN public.venues v ON v.id = p.venue_id
    LEFT JOIN public.agencies a ON a.id = p.agency_id
   WHERE p.user_id IS NOT NULL
     AND COALESCE(a.owner_user_id, v.owner_id, p.organizer_user_id) IS NOT NULL
     AND COALESCE(a.owner_user_id, v.owner_id, p.organizer_user_id) <> p.user_id
     AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.user_id AND r.role = 'admin')
     AND NOT (p.venue_id IS NOT NULL AND (public.is_venue_owner(p.user_id, p.venue_id)
                                          OR public.manager_has_permission(p.user_id, p.venue_id, 'promoters')))
     AND NOT (p.organizer_user_id IS NOT NULL
              AND COALESCE(public.is_organizer_promoter_admin(p.user_id, p.organizer_user_id), false))
     AND NOT (p.agency_id IS NOT NULL AND public.is_agency_owner(p.user_id, p.agency_id))
   ORDER BY (p.venue_id IN ('womber', 'goya-social-club')) DESC, p.created_at
   LIMIT 1;
  IF v_pr.id IS NULL THEN
    RAISE EXCEPTION 'SMOKE_OK garde posé ; scénarios non joués : aucun promoteur géré par un tiers';
  END IF;

  -- 3. Le promoteur, comme PostgREST : rôle authenticated + claims.
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pr.user_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_pr.user_id::text, true);

  BEGIN
    UPDATE public.promoters SET ticket_commission_value = ticket_commission_value + 1 WHERE id = v_pr.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN RAISE EXCEPTION 'SMOKE_FAIL le promoteur ne voit pas sa fiche (RLS)'; END IF;
    RAISE EXCEPTION 'SMOKE_FAIL le promoteur a relevé sa propre commission';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE 'promoter_self_update_forbidden%' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.promoters SET iban_changed_at = now() - interval '30 days' WHERE id = v_pr.id;
    RAISE EXCEPTION 'SMOKE_FAIL le promoteur a antidaté son changement d''IBAN';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE 'promoter_self_update_forbidden%' THEN RAISE; END IF;
  END;
  v_out := v_out || jsonb_build_object('commission_par_le_promoteur', 'refusée', 'gel_antidaté', 'refusé');

  UPDATE public.promoters SET instagram_url = 'https://instagram.com/yuno_smoke_sec07' WHERE id = v_pr.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'SMOKE_FAIL le promoteur ne modifie plus son profil'; END IF;

  UPDATE public.promoters SET iban = 'FR7699999000019876543210987', bic = 'SMOKFRPP' WHERE id = v_pr.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'SMOKE_FAIL le promoteur ne modifie plus son IBAN'; END IF;
  SELECT iban_changed_at INTO v_stamp FROM public.promoters WHERE id = v_pr.id;
  IF v_stamp IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'SMOKE_FAIL gel de 24 h non posé après le changement d''IBAN (%)', v_stamp;
  END IF;
  v_out := v_out || jsonb_build_object('profil', 'modifié', 'iban', 'modifié, gel posé');

  -- 4. Celui qui gère ce promoteur garde la main sur sa commission.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pr.manager, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_pr.manager::text, true);
  UPDATE public.promoters SET ticket_commission_value = ticket_commission_value + 1 WHERE id = v_pr.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'SMOKE_FAIL celui qui gère le promoteur ne règle plus sa commission'; END IF;
  EXECUTE 'RESET ROLE';
  v_out := v_out || jsonb_build_object('commission_par_le_gestionnaire', 'modifiée');

  RAISE EXCEPTION 'SMOKE_OK %', v_out;
END
$smoke$;
