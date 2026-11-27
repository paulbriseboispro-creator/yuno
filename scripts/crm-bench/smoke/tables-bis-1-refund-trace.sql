-- Smoke ANNULÉ — vague C bis, I4 : une réservation de remboursement SANS succès Stripe n'émet aucun avoir ; confirmée, elle en émet un, borné au cumul confirmé.
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-bis-1-refund-trace.sql 20261227100000_invoice_fee_vat_seller_rate.sql 20261227110000_credit_notes.sql 20261227120000_credit_notes_sweep_accounting.sql 20261228110000_refund_confirmation_trace.sql
DO $smoke$
DECLARE
  v_evB  uuid := '135bab45-ebfb-4b87-bf34-28ade93e1ed1';
  v_SAT  uuid := 'a0d17000-0000-4000-8000-000000000001';
  v_gold uuid := '6fe30ed6-994b-45bb-8e66-69917f0ca6bf';
  r1 uuid; res jsonb; n int;
BEGIN
  -- Vente HORS démo : on prend la soirée de l'organisateur, hors démo seulement si la démo ne la couvre pas ; on retire donc la garde démo
  -- en insérant la vente sur un événement quelconque puis en neutralisant demo_event_ids / demo_venue_ids pour la durée du smoke.
  CREATE OR REPLACE FUNCTION pg_temp.noop() RETURNS void LANGUAGE sql AS 'SELECT 1';
  INSERT INTO table_reservations (event_id, pack_id, user_email, total_price, deposit, management_fee, status, paid_at, qr_code, fee_absorbed, payment_mode, charged_lines, charged_total)
    VALUES (v_evB, v_gold, 'bis1@test', 300, 100, 4, 'paid', now() - interval '3 days', 'smkbis1', false, 'online',
            '[{"kind":"deposit","cents":10000},{"kind":"fee","cents":400}]'::jsonb, 104) RETURNING id INTO r1;
  PERFORM issue_sale_invoice(NULL, r1, NULL);
  -- La démo n'émet jamais : on sort la vente du périmètre démo en vidant temporairement ses marqueurs sur la facture.
  UPDATE invoices SET event_id = NULL, venue_id = (SELECT id FROM venues WHERE id <> ALL (demo_venue_ids()) LIMIT 1), seller_kind = 'venue', organizer_user_id = NULL WHERE table_reservation_id = r1;
  -- Réservation orpheline : refund_amount posé, jamais confirmé par Stripe, vieille de 2 jours.
  UPDATE table_reservations SET refund_amount = 50, refunded_at = now() - interval '2 days' WHERE id = r1;
  res := issue_missing_credit_notes();
  SELECT count(*) INTO n FROM credit_notes WHERE table_reservation_id = r1;
  IF n <> 0 THEN RAISE EXCEPTION 'SMOKE_FAIL : avoir émis sans confirmation Stripe (%)', n; END IF;
  IF (res->>'unconfirmed')::int < 1 THEN RAISE EXCEPTION 'SMOKE_FAIL : pas d''alerte de réservation non confirmée %', res; END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_notifications WHERE dedup_key = 'refund_unconfirmed:table:' || r1::text) THEN
    RAISE EXCEPTION 'SMOKE_FAIL : alerte absente';
  END IF;
  -- Confirmation partielle (30 € sur les 50 réservés) : l'avoir est borné à 30.
  PERFORM confirm_sale_refund('table', r1, 3000);
  res := issue_missing_credit_notes();
  SELECT count(*) INTO n FROM credit_notes WHERE table_reservation_id = r1 AND round(amount*100) = 3000;
  IF n <> 1 THEN RAISE EXCEPTION 'SMOKE_FAIL : avoir borné au cumul confirmé absent % %', res, (SELECT message FROM admin_notifications WHERE dedup_key = 'credit_note_failed:table:' || r1::text); END IF;
  -- Rejeu : rien de plus.
  res := issue_missing_credit_notes();
  IF (res->>'issued')::int <> 0 THEN RAISE EXCEPTION 'SMOKE_FAIL : rejeu %', res; END IF;
  -- Droits : la confirmation n'est pas ouverte aux clients.
  BEGIN
    PERFORM set_config('role','anon', true);
    PERFORM confirm_sale_refund('table', r1, 100);
    RAISE EXCEPTION 'SMOKE_FAIL : confirm anon permis';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  RAISE EXCEPTION 'SMOKE_OK trace refund';
END
$smoke$;
