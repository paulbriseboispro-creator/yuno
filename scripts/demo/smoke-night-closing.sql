-- Smoke test ANNULÉ du décompte de soirée à barème (collab club ↔ organisateur).
--
--   supabase db query --linked -f scripts/demo/smoke-night-closing.sql
--
-- Pose trois jambes retenues fictives sur la soirée démo « Goya Thursday »,
-- déclare en tant que club, tente l'acceptation SANS IBAN (attendu :
-- organizer_iban_missing), pose un IBAN vieux de 2 jours, accepte, puis lit la
-- répartition (jambes organisateur au prorata, lot SEPA pour le reste) et lève
-- une exception 'SMOKE {…}' qui ANNULE tout : rien n'est écrit en base.
-- Le résultat se lit dans error.message de la réponse JSON de la CLI.
-- Ids : soirée démo, organizer@womber.fr, owner@womber.fr — périmètre démo seul.
DO $smoke$
DECLARE
  v_event uuid := '63da1e2c-9694-4c4a-b531-c5efb89178d5';
  v_org   uuid := 'ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9';
  v_owner uuid := 'a810aed8-1b10-4e41-b325-4bf07f657d72';
  v_out   jsonb := '{}'::jsonb;
  v_res   jsonb;
  v_closing uuid;
  r record;
  v_rows jsonb;
BEGIN
  -- Fixtures : trois jambes retenues (charges plateforme, transfert sans date),
  -- comme le webhook les écrirait pour des ventes Stripe réelles en barème.
  INSERT INTO public.revenue_distributions (event_id, item_type, split_mode, primary_account_id, primary_recipient_kind, primary_recipient_venue_id, primary_amount_cents, primary_transfer_status, transfers_release_at, gross_amount_cents, yuno_fee_cents, payment_intent_id)
  VALUES
    (v_event, 'ticket', 'separate', 'acct_demo_venue', 'venue', 'womber', 1155, 'scheduled', NULL, 1299, 99, 'pi_smoke_1'),
    (v_event, 'ticket', 'separate', 'acct_demo_venue', 'venue', 'womber', 1155, 'scheduled', NULL, 1299, 99, 'pi_smoke_2'),
    (v_event, 'table',  'separate', 'acct_demo_venue', 'venue', 'womber', 7358, 'scheduled', NULL, 7800, 300, 'pi_smoke_3');

  -- Nettoyer un décompte existant de la soirée (fixture) puis déclarer en tant que CLUB.
  DELETE FROM public.collab_night_closings WHERE event_id = v_event;
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_owner)::text, true);
  PERFORM set_config('role','authenticated', true);
  v_res := public.declare_collab_night_closing(v_event, 5000, 25, 375, 180, 0, NULL, 'smoke', 'Z-42');
  v_out := v_out || jsonb_build_object('declare', v_res);
  v_closing := (v_res->>'closing_id')::uuid;

  -- Accepter en tant qu'ORGANISATEUR (compte Stripe démo "actif", IBAN absent → SEPA impossible).
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_org)::text, true);
  BEGIN
    v_res := public.accept_collab_night_closing(v_closing);
    v_out := v_out || jsonb_build_object('accept_without_iban', v_res);
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('accept_without_iban_error', SQLERRM);
  END;

  -- Poser un IBAN (vieux de 2 jours) puis accepter.
  INSERT INTO public.organizer_payout_details (user_id, iban, iban_changed_at) VALUES (v_org, 'FR7630006000011234567890189', now() - interval '2 days')
  ON CONFLICT (user_id) DO UPDATE SET iban = EXCLUDED.iban, iban_changed_at = EXCLUDED.iban_changed_at;
  v_res := public.accept_collab_night_closing(v_closing);
  v_out := v_out || jsonb_build_object('accept', v_res);

  SELECT jsonb_agg(jsonb_build_object('item', item_type, 'primary', primary_amount_cents, 'secondary', secondary_amount_cents, 'sec_kind', secondary_recipient_kind, 'sec_acct', secondary_account_id, 'p_status', primary_transfer_status, 's_status', secondary_transfer_status, 'release', transfers_release_at IS NOT NULL) ORDER BY primary_amount_cents DESC)
    INTO v_rows FROM public.revenue_distributions WHERE event_id = v_event;
  v_out := v_out || jsonb_build_object('rows', v_rows);
  SELECT jsonb_build_object('amount', amount, 'status', status, 'kind', kind, 'ref', transfer_reference, 'pct', organizer_pct_applied, 'night_revenue', night_revenue, 'prepaid', organizer_prepaid)
    INTO v_res FROM public.collab_table_settlements WHERE closing_id = v_closing;
  v_out := v_out || jsonb_build_object('settlement', v_res);
  v_out := v_out || jsonb_build_object('compute_after', public.compute_collab_night_closing(v_event)->'projection');

  RAISE EXCEPTION 'SMOKE %', jsonb_pretty(v_out);
END $smoke$;
