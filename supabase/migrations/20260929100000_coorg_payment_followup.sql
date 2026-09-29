-- ════════════════════════════════════════════════════════════════════════════
-- Co-organisation — suivi des virements : échéance, relances, escalade, litige
-- ════════════════════════════════════════════════════════════════════════════
--
-- Au-delà de deux parties, Yuno ne répartit rien sur Stripe : il fige un
-- décompte, puis les parties se virent l'argent de banque à banque. Ce qui
-- manquait, c'est le SUIVI — le même que le règlement promoteur :
--
--   • une ÉCHÉANCE convenue dans l'accord (7, 15 ou 30 jours après l'arrêté du
--     décompte, 15 par défaut) : `event_coorg_deals.payment_terms_days`, signée
--     avec le reste (la changer relance les signatures, comme les parts) ;
--   • chaque virement porte `due_at` (payer avant) et, une fois annoncé,
--     `confirm_due_at` (le bénéficiaire confirme avant, 7 jours) ;
--   • un balayage quotidien (`coorg_transfer_followup_sweep`, cron) relance :
--       - le bénéficiaire sans IBAN connu (le payeur ne peut rien faire sans) ;
--       - le payeur 3 jours avant l'échéance, le jour même, puis tous les 3
--         jours de retard (6 relances max) ;
--       - à 7 jours de retard, TOUTES les autres parties sont prévenues (une
--         fois) ; à 14 jours, le super admin (alerte) ;
--       - le bénéficiaire d'un virement annoncé, 2 jours avant la fin de son
--         délai de confirmation ; à l'échéance sans réponse, le virement passe
--         en litige automatique (même doctrine que le promoteur : le silence du
--         bénéficiaire ne vaut jamais « reçu ») ;
--   • le bénéficiaire peut RELANCER lui-même le payeur (1 fois / 24 h) ;
--   • un litige remonte au super admin, qui peut le trancher (reçu / annulé),
--     traçé, jamais sans motif.
-- Yuno ne touche jamais aux fonds : il horodate, relance et trace.

-- ─── 1. Colonnes ─────────────────────────────────────────────────────────────

ALTER TABLE public.event_coorg_deals
  ADD COLUMN IF NOT EXISTS payment_terms_days integer NOT NULL DEFAULT 15
    CHECK (payment_terms_days IN (7, 15, 30));

ALTER TABLE public.event_coorg_transfers
  ADD COLUMN IF NOT EXISTS due_at            timestamptz,
  ADD COLUMN IF NOT EXISTS confirm_due_at    timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reminded_at  timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_at      timestamptz,
  ADD COLUMN IF NOT EXISTS admin_alerted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS last_nudged_at    timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_note        text;

ALTER TABLE public.event_coorg_transfers DROP CONSTRAINT IF EXISTS event_coorg_transfers_status_check;
ALTER TABLE public.event_coorg_transfers
  ADD CONSTRAINT event_coorg_transfers_status_check
  CHECK (status IN ('pending', 'sent', 'received', 'disputed', 'cancelled'));

-- Virements déjà créés : échéance à 15 jours de leur création.
UPDATE public.event_coorg_transfers
   SET due_at = created_at + interval '15 days'
 WHERE due_at IS NULL;
UPDATE public.event_coorg_transfers
   SET confirm_due_at = sent_at + interval '7 days'
 WHERE status = 'sent' AND confirm_due_at IS NULL AND sent_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS event_coorg_transfers_open_idx
  ON public.event_coorg_transfers (status, due_at) WHERE status IN ('pending', 'sent', 'disputed');

-- ─── 1 bis. Montant au format français (« 3 481,73 € ») ──────────────────────

CREATE OR REPLACE FUNCTION public._coorg_eur(p numeric)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT translate(to_char(COALESCE(p, 0), 'FM999G999G990D00'), ',.', ' ,') || ' €' $$;

-- ─── 2. L'accord porte le délai de paiement ─────────────────────────────────

DROP FUNCTION IF EXISTS public.save_coorg_deal(uuid, jsonb, boolean, text);
CREATE OR REPLACE FUNCTION public.save_coorg_deal(
  p_event_id uuid, p_shares jsonb, p_formal boolean DEFAULT false, p_clauses text DEFAULT NULL,
  p_payment_terms_days integer DEFAULT 15
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_me record; v_total numeric := 0; k text; v_pct numeric; v_n integer := 0;
  v_terms integer := COALESCE(p_payment_terms_days, 15);
BEGIN
  SELECT * INTO v_me FROM public.my_event_party(p_event_id);
  IF v_me.party_key IS NULL OR v_me.role NOT IN ('lead', 'partner') OR v_me.level < 3 THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  IF v_terms NOT IN (7, 15, 30) THEN RAISE EXCEPTION 'invalid_terms'; END IF;
  IF EXISTS (SELECT 1 FROM public.event_coorg_settlements s WHERE s.event_id = p_event_id AND s.status <> 'open') THEN
    RAISE EXCEPTION 'settlement_locked';
  END IF;
  IF jsonb_typeof(p_shares) <> 'object' THEN RAISE EXCEPTION 'invalid_shares'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_shares) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.event_parties(p_event_id) p WHERE p.party_key = k) THEN
      RAISE EXCEPTION 'unknown_party %', k;
    END IF;
    v_pct := (p_shares ->> k)::numeric;
    IF v_pct < 0 OR v_pct > 100 THEN RAISE EXCEPTION 'invalid_pct'; END IF;
    v_total := v_total + v_pct;
    v_n := v_n + 1;
  END LOOP;
  IF v_n < 2 THEN RAISE EXCEPTION 'at_least_two_parties'; END IF;
  IF abs(v_total - 100) > 0.001 THEN RAISE EXCEPTION 'shares_must_total_100'; END IF;

  INSERT INTO public.event_coorg_deals (event_id, shares, formal, clauses, payment_terms_days, created_by, status, signatures)
  VALUES (p_event_id, p_shares, COALESCE(p_formal, false), NULLIF(btrim(COALESCE(p_clauses, '')), ''), v_terms,
          auth.uid(), 'pending', '{}'::jsonb)
  ON CONFLICT (event_id) DO UPDATE
     SET shares = EXCLUDED.shares, formal = EXCLUDED.formal, clauses = EXCLUDED.clauses,
         payment_terms_days = EXCLUDED.payment_terms_days,
         status = 'pending', signatures = '{}'::jsonb, activated_at = NULL,
         version = public.event_coorg_deals.version + 1, updated_at = now();

  PERFORM public.sign_coorg_deal(p_event_id, v_me.party_key, NULL, NULL);

  UPDATE public.event_coorg_settlements SET approvals = '{}'::jsonb, version = version + 1, updated_at = now()
   WHERE event_id = p_event_id AND status = 'open';

  PERFORM public.notify_coorg_party(k2, p_event_id, 'coorg_deal_to_sign',
      CASE WHEN p_formal THEN 'Contrat de co-organisation à signer' ELSE 'Accord de co-organisation à valider' END,
      'Les parts de « ' || COALESCE((SELECT title FROM public.events WHERE id = p_event_id), 'la soirée') || ' » attendent ton accord.',
      NULL, NULL)
    FROM jsonb_object_keys(p_shares) AS k2 WHERE k2 <> v_me.party_key;

  RETURN (SELECT to_jsonb(d) FROM public.event_coorg_deals d WHERE d.event_id = p_event_id);
END;
$$;

-- ─── 3. Échéance posée à l'arrêté du décompte ───────────────────────────────
-- Le corps d'approve_coorg_settlement est repris, seul l'INSERT des virements
-- change : due_at = maintenant + délai de l'accord, IBAN pré-rempli aussi pour
-- un club (dernier IBAN qu'il a donné sur un virement de co-organisation).

CREATE OR REPLACE FUNCTION public.approve_coorg_settlement(p_event_id uuid, p_party text, p_version integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ev record; d record; s record; v_fig jsonb; v_all boolean; t jsonb; v_iban text; v_id uuid;
  v_due timestamptz;
BEGIN
  IF public.coorg_party_level(auth.uid(), p_party) < 3 THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  SELECT * INTO v_ev FROM public.events WHERE id = p_event_id;
  IF v_ev.end_at > now() THEN RAISE EXCEPTION 'event_not_over'; END IF;
  SELECT * INTO d FROM public.event_coorg_deals WHERE event_id = p_event_id;
  IF NOT FOUND OR d.status <> 'active' THEN RAISE EXCEPTION 'deal_not_active'; END IF;
  IF NOT (d.shares ? p_party) THEN RAISE EXCEPTION 'not_in_deal'; END IF;

  INSERT INTO public.event_coorg_settlements (event_id) VALUES (p_event_id) ON CONFLICT (event_id) DO NOTHING;
  SELECT * INTO s FROM public.event_coorg_settlements WHERE event_id = p_event_id FOR UPDATE;
  IF s.status <> 'open' THEN RAISE EXCEPTION 'already_approved'; END IF;
  IF p_version IS DISTINCT FROM s.version THEN RAISE EXCEPTION 'stale_version'; END IF;

  UPDATE public.event_coorg_settlements
     SET approvals = approvals || jsonb_build_object(p_party, jsonb_build_object('at', now(), 'by', auth.uid(), 'version', s.version)),
         updated_at = now()
   WHERE event_id = p_event_id;

  SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_object_keys(d.shares) k
     WHERE NOT (ss.approvals ? k) OR (ss.approvals -> k ->> 'version')::integer <> ss.version
  ) INTO v_all FROM public.event_coorg_settlements ss WHERE ss.event_id = p_event_id;

  IF NOT v_all THEN
    PERFORM public.notify_coorg_party(k, p_event_id, 'coorg_settlement_to_approve',
        'Décompte de co-organisation à valider',
        'Une partie a validé le décompte de « ' || COALESCE(v_ev.title, 'la soirée') || ' ». À toi.',
        NULL, 'coorg_settle:' || p_event_id::text || ':' || s.version::text || ':' || k)
      FROM jsonb_object_keys(d.shares) AS k
     WHERE NOT ((SELECT approvals FROM public.event_coorg_settlements WHERE event_id = p_event_id) ? k);
    RETURN jsonb_build_object('status', 'open', 'waiting', true);
  END IF;

  v_fig := public._coorg_compute(p_event_id);
  UPDATE public.event_coorg_settlements
     SET status = CASE WHEN jsonb_array_length(v_fig -> 'transfers') = 0 THEN 'settled' ELSE 'approved' END,
         snapshot = v_fig || jsonb_build_object('party_set',
                      (SELECT jsonb_object_agg(k, true) FROM jsonb_object_keys(d.shares) k)),
         approved_at = now(),
         settled_at = CASE WHEN jsonb_array_length(v_fig -> 'transfers') = 0 THEN now() END,
         updated_at = now()
   WHERE event_id = p_event_id;

  v_due := now() + make_interval(days => COALESCE(d.payment_terms_days, 15));
  FOR t IN SELECT * FROM jsonb_array_elements(v_fig -> 'transfers') LOOP
    v_iban := NULL;
    IF split_part(t->>'to', ':', 1) = 'org' THEN
      SELECT opd.iban INTO v_iban FROM public.organizer_payout_details opd
       WHERE opd.user_id = substr(t->>'to', 5)::uuid;
    END IF;
    IF v_iban IS NULL THEN
      SELECT x.payee_iban INTO v_iban FROM public.event_coorg_transfers x
       WHERE x.to_party = t->>'to' AND x.payee_iban IS NOT NULL
       ORDER BY x.updated_at DESC LIMIT 1;
    END IF;
    v_id := gen_random_uuid();
    INSERT INTO public.event_coorg_transfers (id, event_id, from_party, to_party, amount, reference, payee_iban, due_at)
    VALUES (v_id, p_event_id, t->>'from', t->>'to', (t->>'amount')::numeric,
            'YCO-' || upper(substr(replace(v_id::text, '-', ''), 1, 8)), v_iban, v_due);
    PERFORM public.notify_coorg_party(t->>'from', p_event_id, 'coorg_transfer_due', 'Virement de co-organisation à faire',
      'Décompte validé : ' || public._coorg_eur((t->>'amount')::numeric) || ' à virer avant le '
        || to_char(v_due AT TIME ZONE 'Europe/Paris', 'DD/MM') || ' (référence YCO-'
        || upper(substr(replace(v_id::text, '-', ''), 1, 8)) || ').',
      v_id, 'coorg_transfer_due:' || v_id::text);
    IF v_iban IS NULL THEN
      PERFORM public.notify_coorg_party(t->>'to', p_event_id, 'coorg_iban_needed', 'IBAN à renseigner',
        'Un virement de ' || public._coorg_eur((t->>'amount')::numeric) || ' t''attend : donne ton IBAN pour qu''il parte.',
        v_id, 'coorg_iban_needed:' || v_id::text || ':0');
    END IF;
  END LOOP;
  RETURN jsonb_build_object('status', 'approved');
END;
$$;

-- Annoncé = délai de confirmation de 7 jours pour le bénéficiaire.
CREATE OR REPLACE FUNCTION public.declare_coorg_transfer_sent(p_transfer_id uuid, p_reference text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE t record;
BEGIN
  SELECT * INTO t FROM public.event_coorg_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF public.coorg_party_level(auth.uid(), t.from_party) < 3 THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  IF t.status NOT IN ('pending', 'disputed') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  UPDATE public.event_coorg_transfers
     SET status = 'sent', sent_at = now(), sent_by = auth.uid(),
         sent_reference = NULLIF(btrim(COALESCE(p_reference, '')), ''),
         confirm_due_at = now() + interval '7 days',
         disputed_at = NULL, dispute_reason = NULL, updated_at = now()
   WHERE id = p_transfer_id;
  PERFORM public.notify_coorg_party(t.to_party, t.event_id, 'coorg_transfer_sent', 'Virement annoncé',
    public._coorg_eur(t.amount) || ' annoncés comme virés (' || t.reference || '). Confirme la réception sous 7 jours.',
    p_transfer_id, 'coorg_transfer_sent:' || p_transfer_id::text || ':' || extract(epoch FROM now())::bigint::text);
END;
$$;

-- ─── 4. Relance manuelle du bénéficiaire (1 / 24 h) ─────────────────────────

CREATE OR REPLACE FUNCTION public.nudge_coorg_transfer(p_transfer_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE t record; v_title text;
BEGIN
  SELECT * INTO t FROM public.event_coorg_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF public.coorg_party_level(auth.uid(), t.to_party) < 3 THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF t.status NOT IN ('pending', 'disputed') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  IF t.last_nudged_at IS NOT NULL AND t.last_nudged_at > now() - interval '24 hours' THEN
    RAISE EXCEPTION 'nudge_too_soon';
  END IF;
  UPDATE public.event_coorg_transfers SET last_nudged_at = now(), updated_at = now() WHERE id = p_transfer_id;
  SELECT title INTO v_title FROM public.events WHERE id = t.event_id;
  PERFORM public.notify_coorg_party(t.from_party, t.event_id, 'coorg_transfer_nudge', 'Relance de virement',
    (SELECT p.display_name FROM public.event_parties(t.event_id) p WHERE p.party_key = t.to_party)
      || ' attend ' || public._coorg_eur(t.amount) || ' (' || t.reference || ') pour « '
      || COALESCE(v_title, 'la soirée') || ' ».',
    p_transfer_id, 'coorg_nudge:' || p_transfer_id::text || ':' || to_char(now(), 'YYYYMMDD'));
END;
$$;

-- ─── 5. Le balayage quotidien ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.coorg_transfer_followup_sweep()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  t record;
  v_title text;
  v_payer text; v_payee text;
  v_late integer;
  v_n_iban integer := 0; v_n_soon integer := 0; v_n_late integer := 0; v_n_esc integer := 0;
  v_n_admin integer := 0; v_n_confirm integer := 0; v_n_auto integer := 0;
  p record;
BEGIN
  FOR t IN
    SELECT x.* FROM public.event_coorg_transfers x
     WHERE x.status IN ('pending', 'sent')
     ORDER BY x.created_at
  LOOP
    BEGIN
      SELECT e.title INTO v_title FROM public.events e WHERE e.id = t.event_id;
      SELECT pp.display_name INTO v_payer FROM public.event_parties(t.event_id) pp WHERE pp.party_key = t.from_party;
      SELECT pp.display_name INTO v_payee FROM public.event_parties(t.event_id) pp WHERE pp.party_key = t.to_party;
      v_title := COALESCE(v_title, 'la soirée');
      v_payer := COALESCE(v_payer, 'Une partie');
      v_payee := COALESCE(v_payee, 'une partie');

      IF t.status = 'pending' THEN
        -- a) Pas d'IBAN : le bénéficiaire, tous les 3 jours.
        IF t.payee_iban IS NULL THEN
          PERFORM public.notify_coorg_party(t.to_party, t.event_id, 'coorg_iban_needed', 'IBAN à renseigner',
            v_payer || ' ne peut pas te virer ' || public._coorg_eur(t.amount) || ' (' || t.reference
              || ') sans ton IBAN. Renseigne-le sur la page de la soirée.',
            t.id, 'coorg_iban_needed:' || t.id::text || ':' || (extract(epoch FROM now())::bigint / 259200)::text);
          v_n_iban := v_n_iban + 1;
        END IF;

        -- b) Échéance dans 3 jours ou moins (une fois), puis le jour J.
        IF t.due_at IS NOT NULL AND t.due_at > now() AND t.due_at <= now() + interval '3 days' THEN
          PERFORM public.notify_coorg_party(t.from_party, t.event_id, 'coorg_transfer_due_soon', 'Virement à faire bientôt',
            public._coorg_eur(t.amount) || ' à virer à ' || v_payee || ' avant le '
              || to_char(t.due_at AT TIME ZONE 'Europe/Paris', 'DD/MM') || ' (' || t.reference || ').',
            t.id, 'coorg_due_soon:' || t.id::text);
          v_n_soon := v_n_soon + 1;
        END IF;

        -- c) En retard : le payeur tous les 3 jours (6 relances max).
        IF t.due_at IS NOT NULL AND t.due_at <= now() THEN
          v_late := GREATEST(0, floor(extract(epoch FROM (now() - t.due_at)) / 86400))::integer;
          IF t.reminder_count < 6
             AND (t.last_reminded_at IS NULL OR t.last_reminded_at <= now() - interval '71 hours') THEN
            PERFORM public.notify_coorg_party(t.from_party, t.event_id, 'coorg_transfer_overdue', 'Virement en retard',
              CASE WHEN v_late = 0 THEN 'C''est aujourd''hui : ' ELSE 'En retard de ' || v_late || ' j : ' END
                || public._coorg_eur(t.amount) || ' à virer à ' || v_payee || ' (' || t.reference
                || ') pour « ' || v_title || ' ».',
              t.id, 'coorg_overdue:' || t.id::text || ':' || t.reminder_count::text);
            UPDATE public.event_coorg_transfers
               SET reminder_count = reminder_count + 1, last_reminded_at = now(), updated_at = now()
             WHERE id = t.id;
            v_n_late := v_n_late + 1;
          END IF;

          -- d) 7 jours de retard : toutes les autres parties, une fois.
          IF v_late >= 7 AND t.escalated_at IS NULL THEN
            FOR p IN SELECT * FROM public.event_parties(t.event_id) pp WHERE pp.party_key <> t.from_party LOOP
              PERFORM public.notify_coorg_party(p.party_key, t.event_id, 'coorg_transfer_escalated', 'Impayé de co-organisation',
                v_payer || ' n''a pas viré ' || public._coorg_eur(t.amount) || ' à ' || v_payee
                  || ' (' || t.reference || '), échéance dépassée de ' || v_late || ' jours.',
                t.id, 'coorg_escalated:' || t.id::text || ':' || p.party_key);
            END LOOP;
            UPDATE public.event_coorg_transfers SET escalated_at = now(), updated_at = now() WHERE id = t.id;
            v_n_esc := v_n_esc + 1;
          END IF;

          -- e) 14 jours : le super admin.
          IF v_late >= 14 AND t.admin_alerted_at IS NULL THEN
            PERFORM public.emit_admin_notification('admin_coorg_transfer_overdue',
              'Virement de co-organisation impayé',
              v_payer || ' → ' || v_payee || ' : ' || public._coorg_eur(t.amount) || ' (' || t.reference
                || '), « ' || v_title || ' », ' || v_late || ' jours de retard.',
              'high', 'event_coorg_transfer', t.id::text,
              jsonb_build_object('event_id', t.event_id, 'transfer_id', t.id),
              'admin_coorg_overdue:' || t.id::text, t.event_id);
            UPDATE public.event_coorg_transfers SET admin_alerted_at = now(), updated_at = now() WHERE id = t.id;
            v_n_admin := v_n_admin + 1;
          END IF;
        END IF;

      ELSIF t.status = 'sent' AND t.confirm_due_at IS NOT NULL THEN
        -- f) Le bénéficiaire doit confirmer : rappel à 48 h de la fin du délai.
        IF t.confirm_due_at > now() AND t.confirm_due_at <= now() + interval '48 hours' THEN
          PERFORM public.notify_coorg_party(t.to_party, t.event_id, 'coorg_confirm_reminder', 'Confirme la réception',
            v_payer || ' a annoncé ' || public._coorg_eur(t.amount) || ' (' || t.reference
              || '). Confirme la réception ou conteste avant le '
              || to_char(t.confirm_due_at AT TIME ZONE 'Europe/Paris', 'DD/MM') || '.',
            t.id, 'coorg_confirm_reminder:' || t.id::text || ':' || extract(epoch FROM t.sent_at)::bigint::text);
          v_n_confirm := v_n_confirm + 1;
        ELSIF t.confirm_due_at <= now() THEN
          -- g) Silence du bénéficiaire = litige, jamais « reçu ».
          UPDATE public.event_coorg_transfers
             SET status = 'disputed', disputed_at = now(), dispute_reason = 'auto:no_acknowledgement', updated_at = now()
           WHERE id = t.id AND status = 'sent';
          PERFORM public.notify_coorg_party(t.from_party, t.event_id, 'coorg_transfer_auto_disputed', 'Virement non confirmé',
            v_payee || ' n''a pas confirmé la réception de ' || public._coorg_eur(t.amount) || ' (' || t.reference
              || '). Vérifiez ensemble ; tu peux l''annoncer à nouveau.',
            t.id, 'coorg_auto_disputed:' || t.id::text || ':' || extract(epoch FROM t.sent_at)::bigint::text);
          PERFORM public.notify_coorg_party(t.to_party, t.event_id, 'coorg_transfer_auto_disputed', 'Virement non confirmé',
            'Tu n''as pas confirmé ' || public._coorg_eur(t.amount) || ' (' || t.reference
              || ') : le virement est passé en litige. Confirme-le s''il est bien arrivé.',
            t.id, 'coorg_auto_disputed_payee:' || t.id::text || ':' || extract(epoch FROM t.sent_at)::bigint::text);
          PERFORM public.emit_admin_notification('admin_coorg_transfer_disputed',
            'Virement de co-organisation en litige',
            v_payer || ' → ' || v_payee || ' : ' || public._coorg_eur(t.amount) || ' (' || t.reference
              || '), réception non confirmée.',
            'normal', 'event_coorg_transfer', t.id::text,
            jsonb_build_object('event_id', t.event_id, 'transfer_id', t.id),
            'admin_coorg_disputed:' || t.id::text || ':' || extract(epoch FROM t.sent_at)::bigint::text, t.event_id);
          v_n_auto := v_n_auto + 1;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'coorg_transfer_followup_sweep % : %', t.id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object('iban', v_n_iban, 'due_soon', v_n_soon, 'overdue', v_n_late,
    'escalated', v_n_esc, 'admin', v_n_admin, 'confirm', v_n_confirm, 'auto_disputed', v_n_auto);
END;
$$;

-- Un litige posé par le bénéficiaire prévient aussi le super admin.
CREATE OR REPLACE FUNCTION public.confirm_coorg_transfer(p_transfer_id uuid, p_received boolean, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE t record;
BEGIN
  SELECT * INTO t FROM public.event_coorg_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF public.coorg_party_level(auth.uid(), t.to_party) < 3 THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  IF p_received THEN
    IF t.status NOT IN ('sent', 'pending', 'disputed') THEN RAISE EXCEPTION 'invalid_status'; END IF;
    UPDATE public.event_coorg_transfers
       SET status = 'received', received_at = now(), received_by = auth.uid(), updated_at = now()
     WHERE id = p_transfer_id;
    PERFORM public.notify_coorg_party(t.from_party, t.event_id, 'coorg_transfer_received', 'Virement reçu',
      public._coorg_eur(t.amount) || ' confirmés reçus (' || t.reference || ').',
      p_transfer_id, 'coorg_transfer_received:' || p_transfer_id::text);
    PERFORM public._coorg_maybe_settle(t.event_id);
  ELSE
    IF t.status NOT IN ('sent', 'pending') THEN RAISE EXCEPTION 'invalid_status'; END IF;
    IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
    UPDATE public.event_coorg_transfers
       SET status = 'disputed', disputed_at = now(), dispute_reason = left(btrim(p_reason), 500), updated_at = now()
     WHERE id = p_transfer_id;
    PERFORM public.notify_coorg_party(t.from_party, t.event_id, 'coorg_transfer_disputed', 'Virement contesté',
      'Le virement ' || t.reference || ' est contesté : ' || left(btrim(p_reason), 200),
      p_transfer_id, 'coorg_transfer_disputed:' || p_transfer_id::text || ':' || extract(epoch FROM now())::bigint::text);
    PERFORM public.emit_admin_notification('admin_coorg_transfer_disputed',
      'Virement de co-organisation contesté',
      t.reference || ' (' || public._coorg_eur(t.amount) || ') contesté : ' || left(btrim(p_reason), 200),
      'normal', 'event_coorg_transfer', t.id::text,
      jsonb_build_object('event_id', t.event_id, 'transfer_id', t.id),
      'admin_coorg_disputed:' || t.id::text || ':' || extract(epoch FROM now())::bigint::text, t.event_id);
  END IF;
END;
$$;

-- Décompte soldé dès que plus aucun virement n'est ouvert (reçu ou annulé).
CREATE OR REPLACE FUNCTION public._coorg_maybe_settle(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.event_coorg_transfers x
                  WHERE x.event_id = p_event_id AND x.status NOT IN ('received', 'cancelled')) THEN
    UPDATE public.event_coorg_settlements SET status = 'settled', settled_at = now(), updated_at = now()
     WHERE event_id = p_event_id AND status = 'approved';
  END IF;
END;
$$;

-- ─── 5 bis. La page lit l'échéance et les relances ─────────────────────────

CREATE OR REPLACE FUNCTION public.get_event_coorg(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_me    record;
  v_ev    record;
  v_money boolean;
  v_mine  text[];
  v_set   record;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated'); END IF;
  SELECT * INTO v_ev FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  SELECT * INTO v_me FROM public.my_event_party(p_event_id);

  -- Une invitation en attente se lit aussi (pour décider).
  IF v_me.party_key IS NULL AND NOT public.is_super_admin() THEN
    IF NOT EXISTS (SELECT 1 FROM public.event_cohosts c
                    WHERE c.event_id = p_event_id AND c.status = 'pending'
                      AND public.coorg_party_level(v_uid,
                            CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id ELSE 'org:' || c.organizer_user_id END) >= 1) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
    END IF;
  END IF;

  SELECT array_agg(p.party_key) INTO v_mine FROM public.event_parties(p_event_id) p
   WHERE public.coorg_party_level(v_uid, p.party_key) >= 3;
  v_money := public.is_super_admin() OR COALESCE(array_length(v_mine, 1), 0) > 0;

  SELECT * INTO v_set FROM public.event_coorg_settlements WHERE event_id = p_event_id;

  RETURN jsonb_build_object(
    'ok', true,
    'event', jsonb_build_object('id', v_ev.id, 'title', v_ev.title, 'start_at', v_ev.start_at, 'end_at', v_ev.end_at,
                                'ended', v_ev.end_at < now(), 'has_stripe_collab',
                                EXISTS (SELECT 1 FROM public.event_collab_contracts cc
                                         WHERE cc.event_id = p_event_id AND cc.status IN ('active', 'locked', 'closed'))),
    'me', CASE WHEN v_me.party_key IS NULL THEN NULL
               ELSE jsonb_build_object('party', v_me.party_key, 'role', v_me.role, 'access', v_me.access, 'level', v_me.level) END,
    'my_parties', COALESCE(to_jsonb(v_mine), '[]'::jsonb),
    'can_invite', COALESCE(v_me.role IN ('lead', 'partner') AND v_me.level >= 2, false)
                  AND v_ev.end_at > now() AND v_ev.cancelled_at IS NULL,
    'can_deal', COALESCE(v_me.role IN ('lead', 'partner') AND v_me.level >= 3, false),
    'parties', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'key', p.party_key, 'kind', p.kind, 'role', p.role, 'access', p.access,
                  'share_crm', p.share_crm, 'cohost_id', p.cohost_id, 'name', p.display_name,
                  'slug', p.slug, 'avatar_url', p.avatar_url, 'city', p.city) ORDER BY p.ord), '[]'::jsonb)
                  FROM public.event_parties(p_event_id) p),
    'invitations', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                      'id', c.id, 'status', c.status, 'access', c.access, 'share_crm', c.share_crm,
                      'invited_at', c.invited_at, 'message', c.message,
                      'party', CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id ELSE 'org:' || c.organizer_user_id END,
                      'name', COALESCE(v.name, op.display_name),
                      'avatar_url', COALESCE(v.logo_url, op.avatar_url),
                      'mine', public.coorg_party_level(v_uid,
                                CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id ELSE 'org:' || c.organizer_user_id END) >= 1
                    ) ORDER BY c.invited_at DESC), '[]'::jsonb)
                      FROM public.event_cohosts c
                      LEFT JOIN public.venues v ON v.id = c.venue_id
                      LEFT JOIN public.organizer_profiles op ON op.user_id = c.organizer_user_id
                     WHERE c.event_id = p_event_id AND c.status IN ('pending', 'declined')),
    'deal', CASE WHEN v_money THEN (SELECT to_jsonb(d) - 'created_by' FROM public.event_coorg_deals d WHERE d.event_id = p_event_id) END,
    'ledger', CASE WHEN v_money THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'id', l.id, 'kind', l.kind, 'party', l.party_key, 'category', l.category, 'label', l.label,
                  'amount', l.amount, 'note', l.note, 'created_at', l.created_at,
                  'mine', l.party_key = ANY (COALESCE(v_mine, '{}'::text[]))) ORDER BY l.created_at), '[]'::jsonb)
                  FROM public.event_coorg_ledger l WHERE l.event_id = p_event_id AND l.voided_at IS NULL) END,
    'settlement', CASE WHEN v_money THEN jsonb_build_object(
                    'status', COALESCE(v_set.status, 'open'),
                    'version', COALESCE(v_set.version, 1),
                    'approvals', COALESCE(v_set.approvals, '{}'::jsonb),
                    'approved_at', v_set.approved_at, 'settled_at', v_set.settled_at,
                    'figures', CASE WHEN v_set.status IN ('approved', 'settled') THEN v_set.snapshot
                                    ELSE public._coorg_compute(p_event_id) END) END,
    'transfers', CASE WHEN v_money THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', t.id, 'from', t.from_party, 'to', t.to_party, 'amount', t.amount,
                    'reference', t.reference, 'status', t.status,
                    'payee_iban', CASE WHEN t.from_party = ANY (COALESCE(v_mine, '{}'::text[]))
                                         OR t.to_party = ANY (COALESCE(v_mine, '{}'::text[]))
                                       THEN t.payee_iban END,
                    'sent_at', t.sent_at, 'sent_reference', t.sent_reference,
                    'received_at', t.received_at, 'disputed_at', t.disputed_at, 'dispute_reason', t.dispute_reason,
                    'i_pay', t.from_party = ANY (COALESCE(v_mine, '{}'::text[])),
                    'i_receive', t.to_party = ANY (COALESCE(v_mine, '{}'::text[])),
                    'due_at', t.due_at, 'confirm_due_at', t.confirm_due_at,
                    'reminder_count', t.reminder_count, 'escalated_at', t.escalated_at,
                    'last_nudged_at', t.last_nudged_at,
                    'resolved_by_admin', t.resolved_by_admin, 'admin_note', t.admin_note
                  ) ORDER BY t.amount DESC), '[]'::jsonb)
                    FROM public.event_coorg_transfers t WHERE t.event_id = p_event_id) END
  );
END;
$function$;

-- ─── 6. Super admin : lire et trancher ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_coorg_transfer_issues()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', t.id, 'event_id', t.event_id, 'event_title', e.title, 'event_date', e.start_at,
      'from', t.from_party, 'to', t.to_party,
      'from_name', (SELECT p.display_name FROM public.event_parties(t.event_id) p WHERE p.party_key = t.from_party),
      'to_name', (SELECT p.display_name FROM public.event_parties(t.event_id) p WHERE p.party_key = t.to_party),
      'amount', t.amount, 'reference', t.reference, 'status', t.status, 'due_at', t.due_at,
      'sent_at', t.sent_at, 'sent_reference', t.sent_reference, 'disputed_at', t.disputed_at,
      'dispute_reason', t.dispute_reason, 'reminder_count', t.reminder_count,
      'days_late', CASE WHEN t.status = 'pending' AND t.due_at < now()
                        THEN floor(extract(epoch FROM (now() - t.due_at)) / 86400)::integer END
    ) ORDER BY t.status = 'disputed' DESC, t.due_at)
      FROM public.event_coorg_transfers t
      JOIN public.events e ON e.id = t.event_id
     WHERE t.status = 'disputed' OR (t.status = 'pending' AND t.due_at < now())
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_resolve_coorg_transfer(p_transfer_id uuid, p_outcome text, p_note text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE t record;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_outcome NOT IN ('received', 'cancelled') THEN RAISE EXCEPTION 'invalid_outcome'; END IF;
  IF COALESCE(btrim(p_note), '') = '' THEN RAISE EXCEPTION 'note_required'; END IF;
  SELECT * INTO t FROM public.event_coorg_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF t.status IN ('received', 'cancelled') THEN RAISE EXCEPTION 'already_closed'; END IF;
  UPDATE public.event_coorg_transfers
     SET status = p_outcome,
         received_at = CASE WHEN p_outcome = 'received' THEN now() ELSE received_at END,
         received_by = CASE WHEN p_outcome = 'received' THEN auth.uid() ELSE received_by END,
         resolved_by_admin = true, admin_note = left(btrim(p_note), 1000), updated_at = now()
   WHERE id = p_transfer_id;
  PERFORM public.notify_coorg_party(k, t.event_id, 'coorg_transfer_resolved', 'Virement tranché par Yuno',
      t.reference || ' : ' || CASE WHEN p_outcome = 'received' THEN 'réglé' ELSE 'annulé' END
        || '. Motif : ' || left(btrim(p_note), 200),
      t.id, 'coorg_resolved:' || t.id::text || ':' || k)
    FROM unnest(ARRAY[t.from_party, t.to_party]) AS k;
  PERFORM public._coorg_maybe_settle(t.event_id);
END;
$$;

REVOKE ALL ON FUNCTION public.coorg_transfer_followup_sweep() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._coorg_maybe_settle(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_coorg_transfer_issues() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_resolve_coorg_transfer(uuid, text, text) FROM PUBLIC, anon;

-- Cron quotidien à 09:47 UTC (jitter : pas à l'heure pile).
DO $$
BEGIN
  PERFORM cron.unschedule('coorg-transfer-followup')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'coorg-transfer-followup');
  PERFORM cron.schedule('coorg-transfer-followup', '47 9 * * *', 'SELECT public.coorg_transfer_followup_sweep();');
END $$;
