-- Smoke rejouable : sets DJ d'artistes externes, IBAN, paiement, gardes.
-- Tout est annulé à la fin (RAISE 'SMOKE_OK'). Joue l'organisateur démo et un DJ démo.
DO $$
DECLARE
  v_org  uuid := (SELECT id FROM auth.users WHERE email = 'organizer@womber.fr');
  v_dj   public.djs%ROWTYPE;
  v_ev   uuid;
  v_ext  uuid;
  v_set  uuid;
  v_row  public.dj_sets%ROWTYPE;
  v_pre  jsonb;
  v_log  text := '';
BEGIN
  SELECT * INTO v_dj FROM public.djs WHERE organizer_user_id = v_org LIMIT 1;
  SELECT id INTO v_ev FROM public.events WHERE organizer_user_id = v_org ORDER BY start_at DESC LIMIT 1;
  IF v_dj.id IS NULL OR v_ev IS NULL THEN RAISE EXCEPTION 'smoke: pas de DJ ou de soirée démo'; END IF;

  -- 1. L'organisateur ajoute un artiste externe, IBAN saisi avec espaces.
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_org)::text, true);
  PERFORM set_config('role','authenticated', true);
  INSERT INTO public.dj_sets (event_id, organizer_user_id, artist_name, start_time, end_time, fee, fee_paid, payee_name, payee_iban)
  VALUES (v_ev, v_org, '  Artiste Externe ', now(), now() + interval '2 hours', 150, false, 'A. Externe', 'fr76 3000 6000 0112 3456 7890 189')
  RETURNING id INTO v_ext;
  SELECT * INTO v_row FROM public.dj_sets WHERE id = v_ext;
  IF v_row.payee_iban <> 'FR7630006000011234567890189' OR v_row.artist_name <> 'Artiste Externe' THEN
    RAISE EXCEPTION 'smoke 1: normalisation KO (%/%)', v_row.payee_iban, v_row.artist_name;
  END IF;
  v_log := v_log || '1 ok; ';

  -- 2. Un set sans interprète est refusé.
  BEGIN
    INSERT INTO public.dj_sets (event_id, organizer_user_id, start_time, end_time) VALUES (v_ev, v_org, now(), now());
    RAISE EXCEPTION 'smoke 2: set sans interprète accepté';
  EXCEPTION WHEN check_violation THEN v_log := v_log || '2 ok; ';
  END;

  -- 3. Payé par virement : horodaté. Repassé à régler : horodatage et moyen effacés.
  UPDATE public.dj_sets SET fee_paid = true, payment_method = 'transfer' WHERE id = v_ext;
  SELECT * INTO v_row FROM public.dj_sets WHERE id = v_ext;
  IF v_row.fee_paid_at IS NULL THEN RAISE EXCEPTION 'smoke 3: fee_paid_at absent'; END IF;
  UPDATE public.dj_sets SET fee_paid = false WHERE id = v_ext;
  SELECT * INTO v_row FROM public.dj_sets WHERE id = v_ext;
  IF v_row.fee_paid_at IS NOT NULL OR v_row.payment_method IS NOT NULL THEN RAISE EXCEPTION 'smoke 3b: remise à régler KO'; END IF;
  v_log := v_log || '3 ok; ';

  -- 4. Set d'un DJ Yuno.
  INSERT INTO public.dj_sets (dj_id, event_id, organizer_user_id, start_time, end_time, fee, fee_paid, artist_name)
  VALUES (v_dj.id, v_ev, v_org, now(), now() + interval '1 hour', 200, false, 'ignoré')
  RETURNING id INTO v_set;
  SELECT * INTO v_row FROM public.dj_sets WHERE id = v_set;
  IF v_row.artist_name IS NOT NULL THEN RAISE EXCEPTION 'smoke 4: artist_name gardé sur un DJ Yuno'; END IF;
  v_log := v_log || '4 ok; ';

  -- 5. Le DJ saisit son IBAN ; il ne peut changer que la visibilité de son set.
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_dj.user_id)::text, true);
  INSERT INTO public.dj_payout_details (user_id, holder_name, iban)
  VALUES (v_dj.user_id, ' DJ Démo ', 'de89 3704 0044 0532 0130 00')
  ON CONFLICT (user_id) DO UPDATE SET holder_name = EXCLUDED.holder_name, iban = EXCLUDED.iban;
  UPDATE public.dj_sets SET show_on_profile = false WHERE id = v_set;
  BEGIN
    UPDATE public.dj_sets SET fee = 9999 WHERE id = v_set;
    RAISE EXCEPTION 'smoke 5: le DJ a modifié son cachet';
  EXCEPTION WHEN insufficient_privilege THEN v_log := v_log || '5 ok; ';
  END;

  -- 6. L'organisateur lit l'IBAN du DJ pour pré-remplir ; un inconnu non.
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_org)::text, true);
  v_pre := public.get_dj_payout_prefill(v_dj.id);
  IF v_pre->>'iban' <> 'DE89370400440532013000' OR v_pre->>'holder_name' <> 'DJ Démo' THEN
    RAISE EXCEPTION 'smoke 6: prefill KO %', v_pre;
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',gen_random_uuid())::text, true);
  IF public.get_dj_payout_prefill(v_dj.id) IS NOT NULL THEN RAISE EXCEPTION 'smoke 6b: IBAN lisible par un inconnu'; END IF;
  -- … ni la table en direct.
  IF EXISTS (SELECT 1 FROM public.dj_payout_details WHERE user_id = v_dj.user_id) THEN RAISE EXCEPTION 'smoke 6c: table lisible'; END IF;
  v_log := v_log || '6 ok; ';

  PERFORM set_config('role','postgres', true);
  RAISE EXCEPTION 'SMOKE_OK %', v_log;
END $$;
