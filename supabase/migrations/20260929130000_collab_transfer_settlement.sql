-- ════════════════════════════════════════════════════════════════════════════
-- Collab club × organisateur — le partage Stripe devient un CHOIX (Oui / Non)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Jusqu'ici un contrat collab répartissait TOUJOURS l'argent sur Stripe, vente
-- par vente : chaque partie qui touche une part devait avoir un compte Stripe
-- actif, sinon rien ne se vendait. Ça bloque un club ou un orga sans Stripe.
--
-- Le contrat porte désormais `revenue_split_rules.settlement` :
--   { mode: 'stripe' }                              — comme avant (défaut) ;
--   { mode: 'transfer', collector: 'venue'|'organizer', payment_terms_days }
--     — UNE partie encaisse tout (seul son compte Stripe est requis), les parts
--       restent celles du contrat, l'argent dû est SUIVI pendant la vente, puis
--       à J+2 le décompte se fige tout seul et le virement part dans le même
--       cycle que les promoteurs : échéance, relances, confirmation par le seul
--       bénéficiaire, litige automatique, arbitrage Yuno.
-- Barème ou tables « sur le total dépensé » ⇒ encaisseur = club (leurs
-- décomptes existants partent du club).
--
-- Réutilise le moteur de virements de la co-organisation (event_coorg_transfers,
-- relances, admin) avec `source = 'collab'`.
--
-- Au passage : le partage se VERROUILLE à la première vente payée même quand la
-- charge est directe (seule une ligne revenue_distributions le verrouillait —
-- les ventes en charge directe laissaient le contrat modifiable), et la porte
-- « paiements prêts » vérifie les comptes réellement utilisés.

-- ─── 1. Lecture du mode ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.collab_settlement_mode(p_rules jsonb)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT CASE WHEN p_rules->'settlement'->>'mode' = 'transfer' THEN 'transfer' ELSE 'stripe' END $$;

CREATE OR REPLACE FUNCTION public.collab_settlement_collector(p_rules jsonb)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT CASE WHEN p_rules->'settlement'->>'collector' = 'organizer' THEN 'organizer' ELSE 'venue' END $$;

-- Part de l'organisateur sur un pilier : miroir EXACT de getSplitForItem +
-- defaultSplitForItem (payment-split.ts) — blocs normalisés à 100, schéma plat
-- hérité, défauts par mode, boissons 100 % club par défaut.
CREATE OR REPLACE FUNCTION public.collab_rules_org_pct(p_rules jsonb, p_pillar text, p_mode text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE b jsonb; o numeric; v numeric;
BEGIN
  IF p_rules IS NOT NULL THEN
    b := p_rules->p_pillar;
    IF b IS NULL AND p_pillar <> 'drinks' AND jsonb_typeof(p_rules->'organizer') = 'number' THEN
      RETURN LEAST(GREATEST((p_rules->>'organizer')::numeric, 0), 100);
    END IF;
    IF jsonb_typeof(b) = 'object' AND (b ? 'organizer_pct' OR b ? 'venue_pct') THEN
      o := COALESCE(NULLIF(b->>'organizer_pct', '')::numeric, 0);
      v := COALESCE(NULLIF(b->>'venue_pct', '')::numeric, 0);
      IF o + v > 0 THEN RETURN o * 100 / (o + v); END IF;
    END IF;
  END IF;
  IF p_pillar = 'drinks' THEN RETURN 0; END IF;
  IF p_mode = 'venue_rental' THEN RETURN CASE WHEN p_pillar = 'tickets' THEN 100 ELSE 0 END; END IF;
  IF p_mode = 'org_hosted' THEN RETURN 100; END IF;
  RETURN CASE WHEN p_pillar = 'tickets' THEN 50 ELSE 0 END;
END;
$$;

-- Forme canonique du bloc (idempotente) : encaisseur forcé au club pour un
-- barème ou des tables au total dépensé, délai 7/15/30 (15 à défaut).
CREATE OR REPLACE FUNCTION public.normalize_collab_settlement(p_rules jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE v_collector text; v_terms int;
BEGIN
  IF p_rules IS NULL OR jsonb_typeof(p_rules) <> 'object' OR NOT (p_rules ? 'settlement') THEN RETURN p_rules; END IF;
  IF public.collab_settlement_mode(p_rules) = 'stripe' THEN
    RETURN jsonb_set(p_rules, '{settlement}', jsonb_build_object('mode', 'stripe'));
  END IF;
  v_collector := public.collab_settlement_collector(p_rules);
  IF public.is_tiered_collab(p_rules) OR p_rules->'tables'->>'basis' = 'total_spend' THEN
    v_collector := 'venue';
  END IF;
  v_terms := CASE WHEN (p_rules->'settlement'->>'payment_terms_days') IN ('7', '15', '30')
                  THEN (p_rules->'settlement'->>'payment_terms_days')::int ELSE 15 END;
  RETURN jsonb_set(p_rules, '{settlement}',
    jsonb_build_object('mode', 'transfer', 'collector', v_collector, 'payment_terms_days', v_terms));
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_normalize_collab_settlement()
RETURNS trigger LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.split_rules IS NOT NULL THEN
    NEW.split_rules := public.normalize_collab_settlement(NEW.split_rules);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS a_normalize_collab_settlement ON public.event_collab_contracts;
CREATE TRIGGER a_normalize_collab_settlement BEFORE INSERT OR UPDATE OF split_rules ON public.event_collab_contracts
  FOR EACH ROW EXECUTE FUNCTION public.trg_normalize_collab_settlement();
DROP TRIGGER IF EXISTS a_normalize_collab_settlement ON public.event_collab_series_contracts;
CREATE TRIGGER a_normalize_collab_settlement BEFORE INSERT OR UPDATE OF split_rules ON public.event_collab_series_contracts
  FOR EACH ROW EXECUTE FUNCTION public.trg_normalize_collab_settlement();

-- ─── 2. Le partage se verrouille à la première vente PAYÉE, charge directe comprise

CREATE OR REPLACE FUNCTION public.lock_event_split_on_paid_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.event_id IS NOT NULL AND NEW.status IN ('paid', 'used', 'confirmed')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE public.events
       SET split_locked_at = now()
     WHERE id = NEW.event_id AND split_locked_at IS NULL AND revenue_split_rules IS NOT NULL;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'lock_event_split_on_paid_sale: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_event_split_on_paid_sale() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_lock_split_on_paid_ticket ON public.tickets;
CREATE TRIGGER trg_lock_split_on_paid_ticket AFTER INSERT OR UPDATE OF status ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.lock_event_split_on_paid_sale();
DROP TRIGGER IF EXISTS trg_lock_split_on_paid_table ON public.table_reservations;
CREATE TRIGGER trg_lock_split_on_paid_table AFTER INSERT OR UPDATE OF status ON public.table_reservations
  FOR EACH ROW EXECUTE FUNCTION public.lock_event_split_on_paid_sale();

-- ─── 3. Chaque vente garde la part prévue par le contrat au moment de l'achat ─
-- Écrit par les checkouts (service role) en mode virement : { mode, collector,
-- venue_pct, organizer_pct, venue_direct } — venue_direct = consos / options
-- d'un billet, 100 % club comme en mode Stripe.
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS collab_split jsonb;
ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS collab_split jsonb;

-- ─── 4. Porte « paiements prêts » : les comptes réellement utilisés ─────────

CREATE OR REPLACE FUNCTION public.event_payments_ready(p_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e record; v_venue text; v_org uuid; v_rules jsonb;
  v_vok boolean := false; v_ook boolean := false;
  v_need_venue boolean := false; v_need_org boolean := false;
  v_collab boolean; p text; v_o numeric;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN false; END IF;
  v_venue := COALESCE(e.venue_id, e.partner_venue_id);
  v_org := COALESCE(e.organizer_user_id, e.partner_organizer_id);
  SELECT v.stripe_account_id IS NOT NULL AND v.stripe_account_id NOT LIKE 'acct\_demo%'
         AND COALESCE(v.stripe_charges_enabled, false)
    INTO v_vok FROM public.venues v WHERE v.id = v_venue;
  SELECT pr.stripe_connect_account_id IS NOT NULL AND pr.stripe_connect_account_id NOT LIKE 'acct\_demo%'
         AND COALESCE(pr.stripe_connect_charges_enabled, false)
    INTO v_ook FROM public.profiles pr WHERE pr.id = v_org;
  v_vok := COALESCE(v_vok, false); v_ook := COALESCE(v_ook, false);

  v_collab := v_venue IS NOT NULL AND v_org IS NOT NULL AND (
       e.event_mode IN ('co_event', 'venue_rental', 'org_hosted')
    OR (e.venue_id IS NOT NULL AND e.partner_organizer_id IS NOT NULL)
    OR (e.organizer_user_id IS NOT NULL AND e.partner_venue_id IS NOT NULL));
  IF NOT v_collab THEN
    RETURN CASE WHEN e.venue_id IS NOT NULL THEN v_vok ELSE v_ook END;
  END IF;

  v_rules := e.revenue_split_rules;
  IF v_rules IS NULL THEN RETURN false; END IF;  -- pas de contrat signé : rien ne se vend
  IF public.collab_settlement_mode(v_rules) = 'transfer' THEN
    RETURN CASE public.collab_settlement_collector(v_rules) WHEN 'organizer' THEN v_ook ELSE v_vok END;
  END IF;
  IF public.is_tiered_collab(v_rules) THEN RETURN v_vok; END IF;

  FOREACH p IN ARRAY ARRAY['tickets', 'tables'] LOOP
    IF public.split_pillar_enabled(v_rules, p) THEN
      v_o := public.collab_rules_org_pct(v_rules, p, e.event_mode::text);
      IF v_o > 0 THEN v_need_org := true; END IF;
      IF v_o < 100 THEN v_need_venue := true; END IF;
    END IF;
  END LOOP;
  RETURN (NOT v_need_venue OR v_vok) AND (NOT v_need_org OR v_ook);
END;
$$;
GRANT EXECUTE ON FUNCTION public.event_payments_ready(uuid) TO anon, authenticated;

-- ─── 5. Virements : une source par module ────────────────────────────────────

ALTER TABLE public.event_coorg_transfers
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'coorg';
ALTER TABLE public.event_coorg_transfers DROP CONSTRAINT IF EXISTS event_coorg_transfers_source_check;
ALTER TABLE public.event_coorg_transfers ADD CONSTRAINT event_coorg_transfers_source_check
  CHECK (source IN ('coorg', 'collab'));

-- Les notifications d'un virement disent de quel module il vient (le lien
-- mène à la page co-organisation OU à la page du collab).
CREATE OR REPLACE FUNCTION public.notify_coorg_party(p_party text, p_event_id uuid, p_type text, p_title text, p_message text, p_ref uuid DEFAULT NULL::uuid, p_dedup text DEFAULT NULL::text, p_meta jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_kind text := split_part(p_party, ':', 1);
  v_id   text := substr(p_party, length(split_part(p_party, ':', 1)) + 2);
  v_meta jsonb := COALESCE(p_meta, '{}'::jsonb);
  v_src  text;
BEGIN
  IF p_ref IS NOT NULL AND NOT (v_meta ? 'source') THEN
    SELECT t.source INTO v_src FROM public.event_coorg_transfers t WHERE t.id = p_ref;
    IF v_src IS NOT NULL THEN v_meta := v_meta || jsonb_build_object('source', v_src); END IF;
  END IF;
  IF v_kind = 'org' THEN
    PERFORM public.emit_organizer_notification(v_id::uuid, p_type, p_title, p_message, 'normal',
      'event_coorg', p_ref, p_event_id, v_meta, p_dedup);
  ELSIF v_kind = 'venue' THEN
    PERFORM public.emit_staff_notification(v_id, 'owner', p_type, p_title, p_message, 'normal',
      'event_coorg', p_ref, p_event_id, v_meta, p_dedup);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_coorg_party: %', SQLERRM;
END;
$$;

-- ─── 6. Le décompte du contrat en mode virement ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.collab_transfer_statements (
  event_id    uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  contract_id uuid,
  collector   text NOT NULL CHECK (collector IN ('venue', 'organizer')),
  status      text NOT NULL DEFAULT 'frozen' CHECK (status IN ('frozen', 'settled')),
  snapshot    jsonb NOT NULL,
  frozen_at   timestamptz NOT NULL DEFAULT now(),
  frozen_by   uuid,
  settled_at  timestamptz
);
ALTER TABLE public.collab_transfer_statements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.collab_transfer_statements FROM anon, authenticated;

-- Calcul (live avant le gel, figé ensuite). Mêmes montants qu'un partage Stripe :
-- net de la commission Yuno, des remboursements et des frais Stripe estimés
-- (1,5 % + 0,25 €), consos d'un billet 100 % club, tables = acompte en ligne
-- (le solde réglé sur place reste au club). Tables « au total dépensé » : réglées
-- par le complément tables existant, hors de ce décompte.
CREATE OR REPLACE FUNCTION public._collab_transfer_compute(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e record; v_rules jsonb; v_venue text; v_org uuid; v_collector text;
  v_tbl_basis text; v_pillars jsonb := '{}'::jsonb;
  v_venue_key text; v_org_key text; v_collector_key text;
  r record;
  v_org_owed_by_collector numeric := 0;   -- part orga de ce qu'a encaissé l'encaisseur
  v_venue_owed_by_collector numeric := 0; -- part club de ce qu'a encaissé l'encaisseur
  v_org_owed_by_venue_drinks numeric := 0;
  v_t_n int := 0; v_t_net numeric := 0; v_t_org numeric := 0;
  v_b_n int := 0; v_b_net numeric := 0; v_b_org numeric := 0;
  v_d_n int := 0; v_d_net numeric := 0; v_d_org numeric := 0;
  v_pct numeric; v_net numeric; v_direct numeric; v_org_part numeric;
  v_from text; v_to text; v_amount numeric;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  v_rules := e.revenue_split_rules;
  IF v_rules IS NULL OR public.collab_settlement_mode(v_rules) <> 'transfer' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_transfer_mode');
  END IF;
  v_venue := COALESCE(e.venue_id, e.partner_venue_id);
  v_org := COALESCE(e.organizer_user_id, e.partner_organizer_id);
  IF v_venue IS NULL OR v_org IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_collab'); END IF;
  v_collector := public.collab_settlement_collector(v_rules);
  v_venue_key := 'venue:' || v_venue; v_org_key := 'org:' || v_org::text;
  v_collector_key := CASE v_collector WHEN 'organizer' THEN v_org_key ELSE v_venue_key END;
  v_tbl_basis := COALESCE(v_rules->'tables'->>'basis', 'deposit');

  -- Billets
  FOR r IN
    SELECT t.total_price, t.service_fee, t.insurance_fee, t.refund_amount, t.collab_split
      FROM public.tickets t
     WHERE t.event_id = p_event_id AND t.status IN ('paid', 'used')
  LOOP
    v_net := GREATEST(COALESCE(r.total_price, 0) - COALESCE(r.service_fee, 0) - COALESCE(r.insurance_fee, 0), 0);
    v_net := v_net - LEAST(GREATEST(COALESCE(r.refund_amount, 0), 0), v_net)
             - CASE WHEN COALESCE(r.total_price, 0) > 0 THEN round(r.total_price * 0.015 + 0.25, 2) ELSE 0 END;
    v_net := GREATEST(v_net, 0);
    v_direct := LEAST(GREATEST(COALESCE((r.collab_split->>'venue_direct')::numeric, 0), 0), v_net);
    v_pct := COALESCE((r.collab_split->>'organizer_pct')::numeric,
                      public.collab_rules_org_pct(v_rules, 'tickets', e.event_mode::text));
    v_org_part := round((v_net - v_direct) * v_pct / 100, 2);
    v_t_n := v_t_n + 1; v_t_net := v_t_net + v_net; v_t_org := v_t_org + v_org_part;
  END LOOP;

  -- Tables (acompte en ligne)
  IF v_tbl_basis <> 'total_spend' THEN
    FOR r IN
      SELECT tr.deposit, tr.service_fee, tr.management_fee, tr.fee_absorbed, tr.refund_amount, tr.collab_split
        FROM public.table_reservations tr
       WHERE tr.event_id = p_event_id AND tr.status IN ('paid', 'confirmed')
         AND COALESCE(tr.payment_mode, 'online') = 'online'
    LOOP
      v_net := GREATEST(COALESCE(r.deposit, 0) - COALESCE(r.service_fee, 0)
                        - CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END, 0);
      v_net := v_net - LEAST(GREATEST(COALESCE(r.refund_amount, 0), 0), v_net)
               - CASE WHEN COALESCE(r.deposit, 0) > 0
                      THEN round((r.deposit + CASE WHEN COALESCE(r.fee_absorbed, false) THEN 0 ELSE COALESCE(r.management_fee, 0) END) * 0.015 + 0.25, 2)
                      ELSE 0 END;
      v_net := GREATEST(v_net, 0);
      v_pct := COALESCE((r.collab_split->>'organizer_pct')::numeric,
                        public.collab_rules_org_pct(v_rules, 'tables', e.event_mode::text));
      v_org_part := round(v_net * v_pct / 100, 2);
      v_b_n := v_b_n + 1; v_b_net := v_b_net + v_net; v_b_org := v_b_org + v_org_part;
    END LOOP;
  END IF;

  -- Boissons via Yuno : toujours encaissées par le club ; part orga seulement si
  -- le contrat lui en donne une (licence alcool attestée).
  v_pct := public.collab_rules_org_pct(v_rules, 'drinks', e.event_mode::text);
  IF v_pct > 0 THEN
    FOR r IN
      SELECT o.total, o.service_fee, o.refund_amount FROM public.orders o
       WHERE o.event_id = p_event_id AND o.status IN ('paid', 'served')
    LOOP
      v_net := GREATEST(COALESCE(r.total, 0) - COALESCE(r.service_fee, 0), 0);
      v_net := GREATEST(v_net - LEAST(GREATEST(COALESCE(r.refund_amount, 0), 0), v_net)
               - CASE WHEN COALESCE(r.total, 0) > 0 THEN round(r.total * 0.015 + 0.25, 2) ELSE 0 END, 0);
      v_d_n := v_d_n + 1; v_d_net := v_d_net + v_net; v_d_org := v_d_org + round(v_net * v_pct / 100, 2);
    END LOOP;
  END IF;

  IF v_collector = 'venue' THEN
    v_org_owed_by_collector := v_t_org + v_b_org;
  ELSE
    v_venue_owed_by_collector := (v_t_net - v_t_org) + (v_b_net - v_b_org);
  END IF;
  v_org_owed_by_venue_drinks := v_d_org;

  -- Solde net : qui doit combien à qui.
  v_amount := (v_org_owed_by_collector + v_org_owed_by_venue_drinks) - v_venue_owed_by_collector;
  IF v_amount >= 0 THEN v_from := v_venue_key; v_to := v_org_key;
  ELSE v_from := v_org_key; v_to := v_venue_key; v_amount := -v_amount; END IF;
  v_amount := round(v_amount, 2);

  RETURN jsonb_build_object(
    'ok', true,
    'collector', v_collector, 'collector_key', v_collector_key,
    'venue_key', v_venue_key, 'org_key', v_org_key,
    'payment_terms_days', COALESCE((v_rules->'settlement'->>'payment_terms_days')::int, 15),
    'tables_basis', v_tbl_basis,
    'pillars', jsonb_build_object(
      'tickets', jsonb_build_object('count', v_t_n, 'net', round(v_t_net, 2), 'organizer', round(v_t_org, 2), 'venue', round(v_t_net - v_t_org, 2)),
      'tables',  jsonb_build_object('count', v_b_n, 'net', round(v_b_net, 2), 'organizer', round(v_b_org, 2), 'venue', round(v_b_net - v_b_org, 2)),
      'drinks',  jsonb_build_object('count', v_d_n, 'net', round(v_d_net, 2), 'organizer', round(v_d_org, 2), 'venue', round(v_d_net - v_d_org, 2))),
    'organizer_total', round(v_t_org + v_b_org + v_d_org, 2),
    'venue_total', round((v_t_net - v_t_org) + (v_b_net - v_b_org) + (v_d_net - v_d_org), 2),
    'transfer', CASE WHEN v_amount >= 0.01 THEN jsonb_build_object('from', v_from, 'to', v_to, 'amount', v_amount) END
  );
END;
$$;
REVOKE ALL ON FUNCTION public._collab_transfer_compute(uuid) FROM PUBLIC, anon, authenticated;

-- Gel du décompte : le cron à J+2 (fenêtre des remboursements), ou une partie
-- « argent » dès la fin de la soirée. Crée le virement suivi.
CREATE OR REPLACE FUNCTION public.freeze_collab_transfer_statement(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e record; v_fig jsonb; v_contract uuid; v_caller_ok boolean; v_id uuid; v_iban text;
  v_due timestamptz; v_ref text; t jsonb;
  -- Interne = le cron (aucun utilisateur) ; anon n'a pas le droit d'exécuter.
  v_internal boolean := auth.uid() IS NULL;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT v_internal THEN
    v_caller_ok := public.coorg_party_level(auth.uid(), 'venue:' || COALESCE(e.venue_id, e.partner_venue_id)) >= 3
                OR public.coorg_party_level(auth.uid(), 'org:' || COALESCE(e.organizer_user_id, e.partner_organizer_id)::text) >= 3;
    IF NOT COALESCE(v_caller_ok, false) THEN RAISE EXCEPTION 'forbidden'; END IF;
    IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  END IF;
  IF COALESCE(e.end_at, e.start_at) > now() THEN RAISE EXCEPTION 'event_not_over'; END IF;
  IF EXISTS (SELECT 1 FROM public.collab_transfer_statements s WHERE s.event_id = p_event_id) THEN
    RAISE EXCEPTION 'already_frozen';
  END IF;
  SELECT c.id INTO v_contract FROM public.event_collab_contracts c
   WHERE c.event_id = p_event_id AND c.status IN ('active', 'locked', 'closed')
   ORDER BY c.created_at DESC LIMIT 1;
  IF v_contract IS NULL THEN RAISE EXCEPTION 'no_signed_contract'; END IF;

  v_fig := public._collab_transfer_compute(p_event_id);
  IF NOT COALESCE((v_fig->>'ok')::boolean, false) THEN RAISE EXCEPTION '%', COALESCE(v_fig->>'reason', 'not_transfer_mode'); END IF;

  t := v_fig->'transfer';
  INSERT INTO public.collab_transfer_statements (event_id, contract_id, collector, status, snapshot, frozen_by, settled_at)
  VALUES (p_event_id, v_contract, v_fig->>'collector',
          CASE WHEN t IS NULL THEN 'settled' ELSE 'frozen' END, v_fig,
          CASE WHEN v_internal THEN NULL ELSE auth.uid() END,
          CASE WHEN t IS NULL THEN now() END);

  IF t IS NOT NULL THEN
    v_iban := NULL;
    IF split_part(t->>'to', ':', 1) = 'org' THEN
      SELECT opd.iban INTO v_iban FROM public.organizer_payout_details opd WHERE opd.user_id = substr(t->>'to', 5)::uuid;
    END IF;
    IF v_iban IS NULL THEN
      SELECT x.payee_iban INTO v_iban FROM public.event_coorg_transfers x
       WHERE x.to_party = t->>'to' AND x.payee_iban IS NOT NULL ORDER BY x.updated_at DESC LIMIT 1;
    END IF;
    v_id := gen_random_uuid();
    v_ref := 'YCO-' || upper(substr(replace(v_id::text, '-', ''), 1, 8));
    v_due := now() + make_interval(days => COALESCE((v_fig->>'payment_terms_days')::int, 15));
    INSERT INTO public.event_coorg_transfers (id, event_id, from_party, to_party, amount, reference, payee_iban, due_at, source)
    VALUES (v_id, p_event_id, t->>'from', t->>'to', (t->>'amount')::numeric, v_ref, v_iban, v_due, 'collab');
    PERFORM public.notify_coorg_party(t->>'from', p_event_id, 'coorg_transfer_due', 'Virement du contrat collab à faire',
      'Décompte de « ' || COALESCE(e.title, 'la soirée') || ' » arrêté : ' || public._coorg_eur((t->>'amount')::numeric)
        || ' à virer avant le ' || to_char(v_due AT TIME ZONE 'Europe/Paris', 'DD/MM') || ' (référence ' || v_ref || ').',
      v_id, 'coorg_transfer_due:' || v_id::text);
    PERFORM public.notify_coorg_party(t->>'to', p_event_id, 'coorg_transfer_sent',
      'Décompte du contrat collab arrêté',
      public._coorg_eur((t->>'amount')::numeric) || ' te reviennent pour « ' || COALESCE(e.title, 'la soirée')
        || ' », à recevoir avant le ' || to_char(v_due AT TIME ZONE 'Europe/Paris', 'DD/MM') || ' (' || v_ref || ').'
        || CASE WHEN v_iban IS NULL THEN ' Renseigne ton IBAN pour que le virement parte.' ELSE '' END,
      v_id, 'collab_statement_frozen:' || v_id::text);
  END IF;
  RETURN jsonb_build_object('status', CASE WHEN t IS NULL THEN 'settled' ELSE 'frozen' END, 'figures', v_fig);
END;
$$;
REVOKE ALL ON FUNCTION public.freeze_collab_transfer_statement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.freeze_collab_transfer_statement(uuid) TO authenticated;

-- Balayage : tout décompte en mode virement dont la soirée est finie depuis 48 h.
CREATE OR REPLACE FUNCTION public.collab_transfer_freeze_sweep()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r record; v_n integer := 0;
BEGIN
  FOR r IN
    SELECT e.id FROM public.events e
     WHERE e.revenue_split_rules IS NOT NULL
       AND public.collab_settlement_mode(e.revenue_split_rules) = 'transfer'
       AND COALESCE(e.end_at, e.start_at) < now() - interval '48 hours'
       AND e.cancelled_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.collab_transfer_statements s WHERE s.event_id = e.id)
       AND EXISTS (SELECT 1 FROM public.event_collab_contracts c
                    WHERE c.event_id = e.id AND c.status IN ('active', 'locked', 'closed'))
  LOOP
    BEGIN
      PERFORM public.freeze_collab_transfer_statement(r.id);
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'collab_transfer_freeze_sweep % : %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.collab_transfer_freeze_sweep() FROM PUBLIC, anon, authenticated;

-- Lecture : décompte en direct avant le gel, figé ensuite, et le virement.
CREATE OR REPLACE FUNCTION public.get_collab_transfer_statement(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e record; v_venue_key text; v_org_key text; v_mine text[] := '{}'; s record; v_fig jsonb;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF e.revenue_split_rules IS NULL OR public.collab_settlement_mode(e.revenue_split_rules) <> 'transfer' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_transfer_mode');
  END IF;
  v_venue_key := 'venue:' || COALESCE(e.venue_id, e.partner_venue_id);
  v_org_key := 'org:' || COALESCE(e.organizer_user_id, e.partner_organizer_id)::text;
  IF public.coorg_party_level(auth.uid(), v_venue_key) >= 3 THEN v_mine := v_mine || v_venue_key; END IF;
  IF public.coorg_party_level(auth.uid(), v_org_key) >= 3 THEN v_mine := v_mine || v_org_key; END IF;
  IF COALESCE(array_length(v_mine, 1), 0) = 0 AND NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT * INTO s FROM public.collab_transfer_statements WHERE event_id = p_event_id;
  v_fig := CASE WHEN s.event_id IS NOT NULL THEN s.snapshot ELSE public._collab_transfer_compute(p_event_id) END;

  RETURN jsonb_build_object(
    'ok', true,
    'event', jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'end_at', e.end_at,
                                'ended', COALESCE(e.end_at, e.start_at) < now(),
                                'auto_freeze_at', COALESCE(e.end_at, e.start_at) + interval '48 hours'),
    'my_parties', to_jsonb(v_mine),
    'names', jsonb_build_object(
       v_venue_key, (SELECT v.name FROM public.venues v WHERE v.id = COALESCE(e.venue_id, e.partner_venue_id)),
       v_org_key, (SELECT op.display_name FROM public.organizer_profiles op WHERE op.user_id = COALESCE(e.organizer_user_id, e.partner_organizer_id))),
    'status', COALESCE(s.status, 'live'),
    'frozen_at', s.frozen_at, 'settled_at', s.settled_at,
    'figures', v_fig,
    'transfers', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', t.id, 'from', t.from_party, 'to', t.to_party, 'amount', t.amount,
        'reference', t.reference, 'status', t.status,
        'payee_iban', CASE WHEN t.from_party = ANY (v_mine) OR t.to_party = ANY (v_mine) THEN t.payee_iban END,
        'sent_at', t.sent_at, 'sent_reference', t.sent_reference,
        'received_at', t.received_at, 'disputed_at', t.disputed_at, 'dispute_reason', t.dispute_reason,
        'i_pay', t.from_party = ANY (v_mine), 'i_receive', t.to_party = ANY (v_mine),
        'due_at', t.due_at, 'confirm_due_at', t.confirm_due_at,
        'reminder_count', t.reminder_count, 'escalated_at', t.escalated_at,
        'last_nudged_at', t.last_nudged_at,
        'resolved_by_admin', t.resolved_by_admin, 'admin_note', t.admin_note
      ) ORDER BY t.created_at), '[]'::jsonb)
      FROM public.event_coorg_transfers t WHERE t.event_id = p_event_id AND t.source = 'collab')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_collab_transfer_statement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_collab_transfer_statement(uuid) TO authenticated;

-- Solde : chaque module se solde sur SES virements.
CREATE OR REPLACE FUNCTION public._coorg_maybe_settle(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.event_coorg_transfers x
                  WHERE x.event_id = p_event_id AND x.source = 'coorg'
                    AND x.status NOT IN ('received', 'cancelled')) THEN
    UPDATE public.event_coorg_settlements SET status = 'settled', settled_at = now(), updated_at = now()
     WHERE event_id = p_event_id AND status = 'approved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.event_coorg_transfers x
                  WHERE x.event_id = p_event_id AND x.source = 'collab'
                    AND x.status NOT IN ('received', 'cancelled')) THEN
    UPDATE public.collab_transfer_statements SET status = 'settled', settled_at = now()
     WHERE event_id = p_event_id AND status = 'frozen';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._coorg_maybe_settle(uuid) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('collab-transfer-freeze')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'collab-transfer-freeze');
  PERFORM cron.schedule('collab-transfer-freeze', '23 * * * *', 'SELECT public.collab_transfer_freeze_sweep();');
END $$;
-- ─── 7. Co-organisation : pas de second partage sur un collab par virement ─

CREATE OR REPLACE FUNCTION public.save_coorg_deal(p_event_id uuid, p_shares jsonb, p_formal boolean DEFAULT false, p_clauses text DEFAULT NULL::text, p_payment_terms_days integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Soirée commencée : l'accord signé tient, les parts ne se rouvrent plus.
  IF public.coorg_deal_frozen(p_event_id) THEN RAISE EXCEPTION 'deal_locked'; END IF;
  -- Collab à barème : l'argent part déjà par le décompte de fin de soirée,
  -- le recompter ici paierait deux fois.
  IF public.is_tiered_collab((SELECT e.revenue_split_rules FROM public.events e WHERE e.id = p_event_id)) THEN
    RAISE EXCEPTION 'tiered_collab_unsupported';
  END IF;
  -- Collab réglé par virement : le contrat partage déjà l'argent entre le club et
  -- l'orga ; un second accord le compterait deux fois.
  IF public.collab_settlement_mode((SELECT e.revenue_split_rules FROM public.events e WHERE e.id = p_event_id)) = 'transfer' THEN
    RAISE EXCEPTION 'collab_transfer_unsupported';
  END IF;
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
$function$;

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
  v_fig   jsonb;
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
  IF v_money THEN
    v_fig := CASE WHEN v_set.status IN ('approved', 'settled') THEN v_set.snapshot ELSE public._coorg_compute(p_event_id) END;
  END IF;

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
                    'figures', v_fig,
                    'fingerprint', CASE WHEN COALESCE(v_set.status, 'open') = 'open' THEN md5(v_fig::text) END) END,
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
                    FROM public.event_coorg_transfers t WHERE t.event_id = p_event_id AND t.source = 'coorg') END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_coorg_transfer_issues()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', t.id, 'source', t.source, 'event_id', t.event_id, 'event_title', e.title, 'event_date', e.start_at,
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
$function$;

