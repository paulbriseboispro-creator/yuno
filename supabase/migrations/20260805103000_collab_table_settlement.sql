-- =============================================================================
-- Répartition des tables d'une collab : base ACOMPTE ou TOTAL SPENDING,
-- et règlement de fin de soirée en double vérification.
--
-- CONSTAT (Paul) : le partage Stripe des tables ne porte que sur l'ACOMPTE payé
-- en ligne. Si l'accord porte sur le TOTAL dépensé (acompte + solde sur place +
-- extras au-delà du budget), le club doit un COMPLÉMENT à l'organisateur à la
-- fin de la soirée — et rien ne le calculait, rien ne le traçait.
--
-- CE QUE CETTE MIGRATION POSE :
--   • La convention `basis` sur le bloc tables de split_rules :
--       { tables: { organizer_pct, venue_pct, basis: 'deposit' | 'total_spend' } }
--     Absent = 'deposit' (comportement historique, rien ne change).
--   • organizer_payout_details : IBAN/BIC de l'organisateur dans une table
--     DÉDIÉE (organizer_profiles est lisible publiquement — un IBAN n'a rien à
--     y faire). Gel anti-détournement 24 h comme les promoteurs.
--   • Le cycle en trois temps, copié du règlement promoteur (20260721090000) :
--       'pending'  → lot PRÉPARÉ   : calcul figé par réservation, annulable
--       'approved' → virement DÉCLARÉ par le club, compte à rebours d'accusé
--       'paid'     → réception CONFIRMÉE par l'organisateur — et lui seul
--       'disputed' → contesté, ou sans réponse passé le délai (watchdog)
--     Yuno sécurise l'ACCORD, jamais les fonds : virement SEPA de banque à
--     banque, référence de rapprochement, horodatage des trois temps.
--
-- LE CALCUL (par réservation payée de la soirée, jamais les remboursées) :
--   revenu_nuit = (venue ? total_price : acompte seul)   -- no-show garde l'acompte
--               + GREATEST(conso_servie - total_price, 0) -- extras au-delà du budget
--   part_orga   = pct_tables × revenu_nuit
--   déjà_reçu   = jambes organisateur de revenue_distributions (acomptes Stripe)
--   dû          = Σ part_orga - Σ déjà_reçu
--   « venue » = scan d'entrée OU check-in OU résa manuelle/walk-in OU conso > 0.
--   La conso servie vit dans vip_consumptions (le grand livre du service VIP).
-- =============================================================================

-- ── 1. Coordonnées bancaires de l'organisateur ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.organizer_payout_details (
  user_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  iban            text,
  bic             text,
  iban_changed_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.organizer_payout_details IS
  'IBAN/BIC de l''organisateur pour les règlements collab hors Stripe (base total spending). Table dédiée : organizer_profiles est lisible publiquement, un IBAN n''y a pas sa place. Le club n''y accède JAMAIS en direct — les RPC du cycle le lui servent.';

ALTER TABLE public.organizer_payout_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Organizer manages own payout details" ON public.organizer_payout_details;
CREATE POLICY "Organizer manages own payout details" ON public.organizer_payout_details
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Super admin views payout details" ON public.organizer_payout_details;
CREATE POLICY "Super admin views payout details" ON public.organizer_payout_details
  FOR SELECT TO authenticated
  USING (public.is_super_admin());

DROP TRIGGER IF EXISTS trg_organizer_payout_details_updated_at ON public.organizer_payout_details;
CREATE TRIGGER trg_organizer_payout_details_updated_at
  BEFORE UPDATE ON public.organizer_payout_details
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Gel anti-détournement : changer d'IBAN horodate, et prepare refuse pendant
-- 24 h (même mécanique que promoters.iban_changed_at).
CREATE OR REPLACE FUNCTION public.stamp_organizer_iban_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF NEW.iban IS DISTINCT FROM OLD.iban THEN
    NEW.iban_changed_at := now();
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_stamp_organizer_iban_change ON public.organizer_payout_details;
CREATE TRIGGER trg_stamp_organizer_iban_change
  BEFORE UPDATE OF iban ON public.organizer_payout_details
  FOR EACH ROW EXECUTE FUNCTION public.stamp_organizer_iban_change();

-- ── 2. Le lot de règlement et ses lignes ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.collab_table_settlements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  contract_id           uuid REFERENCES public.event_collab_contracts(id) ON DELETE SET NULL,
  venue_id              text NOT NULL,
  organizer_user_id     uuid NOT NULL,
  amount                numeric NOT NULL DEFAULT 0,
  currency              text NOT NULL DEFAULT 'EUR',
  organizer_pct_applied numeric,
  night_revenue         numeric,
  organizer_theoretical numeric,
  organizer_prepaid     numeric,
  breakdown             jsonb,
  status                text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'paid', 'disputed')),
  transfer_reference    text,
  confirm_due_at        timestamptz,
  approved_at           timestamptz,
  approved_by           uuid,
  paid_at               timestamptz,
  paid_by               uuid,
  disputed_at           timestamptz,
  dispute_reason        text,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid
);

COMMENT ON TABLE public.collab_table_settlements IS
  'Règlement club → organisateur du complément tables d''une co-soirée (base total spending). Cycle en trois temps copié du règlement promoteur : pending → approved (virement déclaré) → paid (réception confirmée par l''organisateur), plus disputed. Yuno ne touche jamais les fonds.';
COMMENT ON COLUMN public.collab_table_settlements.transfer_reference IS
  'Référence à reporter sur le virement SEPA (YUNO-TBL-XXXXX-DDMM). Seule clé de rapprochement bancaire commune aux deux parties.';

-- Un seul lot ouvert par soirée. 'disputed' compte comme ouvert.
CREATE UNIQUE INDEX IF NOT EXISTS collab_table_settlements_open_uniq
  ON public.collab_table_settlements (event_id)
  WHERE status IN ('pending', 'approved', 'disputed');

CREATE UNIQUE INDEX IF NOT EXISTS collab_table_settlements_reference_uniq
  ON public.collab_table_settlements (transfer_reference)
  WHERE transfer_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_collab_table_settlements_confirm_due
  ON public.collab_table_settlements (confirm_due_at)
  WHERE status = 'approved';

CREATE INDEX IF NOT EXISTS idx_collab_table_settlements_org
  ON public.collab_table_settlements (organizer_user_id, status);

-- Les lignes : une réservation ne peut être réglée qu'UNE fois, tous lots
-- confondus (même garantie que promoter_payout_items.conversion_uniq).
CREATE TABLE IF NOT EXISTS public.collab_table_settlement_items (
  settlement_id        uuid NOT NULL REFERENCES public.collab_table_settlements(id) ON DELETE CASCADE,
  table_reservation_id uuid NOT NULL REFERENCES public.table_reservations(id) ON DELETE CASCADE,
  night_revenue        numeric NOT NULL DEFAULT 0,
  organizer_share      numeric NOT NULL DEFAULT 0,
  organizer_prepaid    numeric NOT NULL DEFAULT 0,
  amount               numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (settlement_id, table_reservation_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS collab_settlement_items_reservation_uniq
  ON public.collab_table_settlement_items (table_reservation_id);

ALTER TABLE public.collab_table_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collab_table_settlement_items ENABLE ROW LEVEL SECURITY;

-- Lecture pour les deux parties ; AUCUNE policy d'écriture : le cycle ne bouge
-- que par les RPC SECURITY DEFINER ci-dessous.
DROP POLICY IF EXISTS "Parties view their settlements" ON public.collab_table_settlements;
CREATE POLICY "Parties view their settlements" ON public.collab_table_settlements
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR organizer_user_id = auth.uid()
    OR public.is_venue_owner(auth.uid(), venue_id)
    OR public.can_manage_venue(auth.uid(), venue_id)
  );

DROP POLICY IF EXISTS "Parties view settlement items" ON public.collab_table_settlement_items;
CREATE POLICY "Parties view settlement items" ON public.collab_table_settlement_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.collab_table_settlements s
    WHERE s.id = settlement_id
      AND (
        public.is_super_admin()
        OR s.organizer_user_id = auth.uid()
        OR public.is_venue_owner(auth.uid(), s.venue_id)
        OR public.can_manage_venue(auth.uid(), s.venue_id)
      )
  ));

-- Ceinture et bretelles : même sans policy d'écriture, on verrouille le cycle
-- contre toute écriture cliente directe (SECURITY INVOKER, cf. 20260721090000 —
-- un trigger DEFINER se désactiverait lui-même).
CREATE OR REPLACE FUNCTION public.guard_collab_settlement_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF NOT public.is_direct_client_write() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'settlement_direct_write_forbidden'
      USING HINT = 'Annulez le lot via cancel_collab_table_settlement.';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
     OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
     OR NEW.disputed_at IS DISTINCT FROM OLD.disputed_at
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.transfer_reference IS DISTINCT FROM OLD.transfer_reference THEN
    RAISE EXCEPTION 'settlement_direct_write_forbidden'
      USING HINT = 'Le cycle passe par declare_collab_settlement_sent / confirm_collab_settlement_received.';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_guard_collab_settlement_write ON public.collab_table_settlements;
CREATE TRIGGER trg_guard_collab_settlement_write
  BEFORE UPDATE OR DELETE ON public.collab_table_settlements
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_collab_settlement_write();

-- ── 3. Fabrique de référence de virement ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.build_collab_settlement_reference(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_name text;
  v_slug text;
  v_base text;
  v_ref  text;
  v_try  int := 0;
BEGIN
  SELECT display_name INTO v_name FROM organizer_profiles WHERE user_id = p_org_id;

  v_slug := upper(
    translate(
      COALESCE(v_name, ''),
      'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
      'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY'
    )
  );
  v_slug := regexp_replace(v_slug, '[^A-Z0-9]', '', 'g');
  IF v_slug = '' THEN v_slug := 'ORGA'; END IF;

  v_base := 'YUNO-TBL-' || left(v_slug, 5) || '-' || to_char(now(), 'DDMM');

  v_ref := v_base;
  WHILE EXISTS (SELECT 1 FROM collab_table_settlements WHERE transfer_reference = v_ref) LOOP
    v_try := v_try + 1;
    IF v_try > 25 THEN
      v_ref := v_base || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
      EXIT;
    END IF;
    v_ref := v_base || '-' || chr(64 + v_try);
  END LOOP;

  RETURN v_ref;
END;
$fn$;

-- ── 4. Les lignes du calcul (interne) ────────────────────────────────────────
-- Une ligne par réservation PAYÉE (jamais les remboursées : le remboursement a
-- déjà repris l'argent des deux côtés).
CREATE OR REPLACE FUNCTION public.collab_table_settlement_lines(p_event_id uuid)
RETURNS TABLE (reservation_id uuid, night_revenue numeric, organizer_prepaid numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    tr.id,
    ROUND(
      (CASE
         WHEN tr.checked_in_at IS NOT NULL
           OR COALESCE(tr.entry_scanned, false)
           OR COALESCE(tr.purchase_source, '') ILIKE 'manual%'
           OR COALESCE(cons.consumed, 0) > 0
         THEN tr.total_price
         ELSE COALESCE(tr.deposit, 0)
       END)
      + GREATEST(COALESCE(cons.consumed, 0) - tr.total_price, 0)
    , 2) AS night_revenue,
    ROUND(COALESCE(rd.org_cents, 0) / 100.0, 2) AS organizer_prepaid
  FROM public.table_reservations tr
  LEFT JOIN LATERAL (
    SELECT SUM(vc.total_price) AS consumed
    FROM public.vip_consumptions vc
    WHERE vc.table_reservation_id = tr.id
  ) cons ON true
  LEFT JOIN LATERAL (
    SELECT SUM(
      (CASE WHEN d.primary_recipient_kind = 'organizer' THEN d.primary_amount_cents ELSE 0 END)
      + (CASE WHEN d.secondary_recipient_kind = 'organizer' THEN d.secondary_amount_cents ELSE 0 END)
    ) AS org_cents
    FROM public.revenue_distributions d
    WHERE d.table_reservation_id = tr.id AND d.item_type = 'table'
  ) rd ON true
  WHERE tr.event_id = p_event_id
    AND tr.status = 'paid';
$fn$;

-- ── 5. Aperçu du calcul (les deux parties) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_collab_table_settlement(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_venue_id text;
  v_org_id   uuid;
  v_rules    jsonb;
  v_basis    text;
  v_pct      numeric;
  v_ended    boolean;
  v_count    int;
  v_revenue  numeric;
  v_theory   numeric;
  v_prepaid  numeric;
  v_has_iban boolean;
  v_open     jsonb;
  v_settled  numeric;
BEGIN
  SELECT venue_id, organizer_user_id INTO v_venue_id, v_org_id
  FROM public.collab_event_parties(p_event_id);
  IF v_venue_id IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'not_a_collab');
  END IF;

  IF NOT (
    public.is_super_admin()
    OR auth.uid() = v_org_id
    OR public.is_venue_owner(auth.uid(), v_venue_id)
    OR public.can_manage_venue(auth.uid(), v_venue_id)
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT revenue_split_rules, COALESCE(end_at, start_at) < now()
    INTO v_rules, v_ended
  FROM public.events WHERE id = p_event_id;

  IF v_rules IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'no_contract');
  END IF;
  v_basis := COALESCE(v_rules->'tables'->>'basis', 'deposit');
  IF v_basis <> 'total_spend' THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'deposit_basis');
  END IF;
  IF NOT public.split_pillar_enabled(v_rules, 'tables') THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'tables_pillar_disabled');
  END IF;
  v_pct := COALESCE(NULLIF(v_rules->'tables'->>'organizer_pct', '')::numeric, 0);
  IF v_pct <= 0 THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'no_organizer_share');
  END IF;

  -- Uniquement les réservations pas encore réglées par un lot antérieur.
  SELECT COUNT(*),
         COALESCE(SUM(l.night_revenue), 0),
         COALESCE(SUM(ROUND(l.night_revenue * v_pct / 100.0, 2)), 0),
         COALESCE(SUM(l.organizer_prepaid), 0)
    INTO v_count, v_revenue, v_theory, v_prepaid
  FROM public.collab_table_settlement_lines(p_event_id) l
  WHERE NOT EXISTS (
    SELECT 1 FROM public.collab_table_settlement_items i
    WHERE i.table_reservation_id = l.reservation_id
  );

  SELECT COALESCE(SUM(amount), 0) INTO v_settled
  FROM public.collab_table_settlements
  WHERE event_id = p_event_id AND status = 'paid';

  SELECT to_jsonb(x) INTO v_open FROM (
    SELECT id, status, amount, transfer_reference, confirm_due_at,
           approved_at, disputed_at, dispute_reason, created_at
    FROM public.collab_table_settlements
    WHERE event_id = p_event_id AND status IN ('pending', 'approved', 'disputed')
    LIMIT 1
  ) x;

  SELECT (iban IS NOT NULL AND length(trim(iban)) >= 8) INTO v_has_iban
  FROM public.organizer_payout_details WHERE user_id = v_org_id;

  RETURN jsonb_build_object(
    'eligible', true,
    'event_ended', v_ended,
    'basis', v_basis,
    'organizer_pct', v_pct,
    'reservations', v_count,
    'night_revenue', v_revenue,
    'organizer_theoretical', v_theory,
    'organizer_prepaid', v_prepaid,
    'amount_due', ROUND(v_theory - v_prepaid, 2),
    'already_settled', v_settled,
    'organizer_has_iban', COALESCE(v_has_iban, false),
    'open_settlement', v_open
  );
END;
$fn$;

-- ── 6. Étape 1 — le club PRÉPARE le lot ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prepare_collab_table_settlement(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_venue_id     text;
  v_org_id       uuid;
  v_rules        jsonb;
  v_ended        boolean;
  v_pct          numeric;
  v_iban         text;
  v_bic          text;
  v_iban_changed timestamptz;
  v_contract_id  uuid;
  v_id           uuid;
  v_ref          text;
  v_count        int;
  v_revenue      numeric;
  v_theory       numeric;
  v_prepaid      numeric;
  v_amount       numeric;
BEGIN
  SELECT venue_id, organizer_user_id INTO v_venue_id, v_org_id
  FROM public.collab_event_parties(p_event_id);
  IF v_venue_id IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'not_a_collab';
  END IF;

  -- Le règlement est une dette du CLUB : lui seul prépare.
  IF NOT (public.is_venue_owner(auth.uid(), v_venue_id) OR public.can_manage_venue(auth.uid(), v_venue_id)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT revenue_split_rules, COALESCE(end_at, start_at) < now()
    INTO v_rules, v_ended
  FROM public.events WHERE id = p_event_id;

  IF v_rules IS NULL THEN RAISE EXCEPTION 'no_contract'; END IF;
  IF COALESCE(v_rules->'tables'->>'basis', 'deposit') <> 'total_spend' THEN
    RAISE EXCEPTION 'deposit_basis';
  END IF;
  IF NOT public.split_pillar_enabled(v_rules, 'tables') THEN
    RAISE EXCEPTION 'tables_pillar_disabled';
  END IF;
  v_pct := COALESCE(NULLIF(v_rules->'tables'->>'organizer_pct', '')::numeric, 0);
  IF v_pct <= 0 THEN RAISE EXCEPTION 'no_organizer_share'; END IF;

  -- On règle une soirée FINIE : le total dépensé n'existe pas avant.
  IF NOT v_ended THEN RAISE EXCEPTION 'event_not_ended'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.collab_table_settlements
    WHERE event_id = p_event_id AND status IN ('pending', 'approved', 'disputed')
  ) THEN
    RAISE EXCEPTION 'settlement_already_open';
  END IF;

  SELECT iban, bic, iban_changed_at INTO v_iban, v_bic, v_iban_changed
  FROM public.organizer_payout_details WHERE user_id = v_org_id;
  IF v_iban IS NULL OR length(trim(v_iban)) < 8 THEN
    RAISE EXCEPTION 'organizer_iban_missing';
  END IF;
  IF v_iban_changed IS NOT NULL AND v_iban_changed > now() - interval '24 hours' THEN
    RAISE EXCEPTION 'iban_recently_changed';
  END IF;

  SELECT id INTO v_contract_id
  FROM public.event_collab_contracts
  WHERE event_id = p_event_id AND status IN ('active', 'locked', 'closed')
  ORDER BY created_at DESC LIMIT 1;

  v_ref := public.build_collab_settlement_reference(v_org_id);

  INSERT INTO public.collab_table_settlements (
    event_id, contract_id, venue_id, organizer_user_id,
    amount, organizer_pct_applied, status, transfer_reference, created_by
  ) VALUES (
    p_event_id, v_contract_id, v_venue_id, v_org_id,
    0, v_pct, 'pending', v_ref, auth.uid()
  )
  RETURNING id INTO v_id;

  -- Rattachement atomique des réservations pas encore réglées. L'index UNIQUE
  -- sur table_reservation_id garantit qu'aucune ne peut l'être deux fois.
  WITH claimed AS (
    INSERT INTO public.collab_table_settlement_items (
      settlement_id, table_reservation_id, night_revenue, organizer_share, organizer_prepaid, amount
    )
    SELECT v_id, l.reservation_id, l.night_revenue,
           ROUND(l.night_revenue * v_pct / 100.0, 2),
           l.organizer_prepaid,
           ROUND(l.night_revenue * v_pct / 100.0, 2) - l.organizer_prepaid
    FROM public.collab_table_settlement_lines(p_event_id) l
    WHERE NOT EXISTS (
      SELECT 1 FROM public.collab_table_settlement_items i
      WHERE i.table_reservation_id = l.reservation_id
    )
    RETURNING night_revenue, organizer_share, organizer_prepaid, amount
  )
  SELECT COUNT(*), COALESCE(SUM(night_revenue), 0), COALESCE(SUM(organizer_share), 0),
         COALESCE(SUM(organizer_prepaid), 0), ROUND(COALESCE(SUM(amount), 0), 2)
    INTO v_count, v_revenue, v_theory, v_prepaid, v_amount
  FROM claimed;

  IF v_count = 0 OR v_amount <= 0 THEN
    DELETE FROM public.collab_table_settlements WHERE id = v_id;
    RETURN jsonb_build_object('prepared', false, 'reason', 'nothing_due');
  END IF;

  UPDATE public.collab_table_settlements
  SET amount = v_amount,
      night_revenue = v_revenue,
      organizer_theoretical = v_theory,
      organizer_prepaid = v_prepaid,
      breakdown = jsonb_build_object(
        'reservations', v_count,
        'night_revenue', v_revenue,
        'organizer_pct', v_pct,
        'organizer_theoretical', v_theory,
        'organizer_prepaid', v_prepaid,
        'computed_at', now()
      )
  WHERE id = v_id;

  RETURN jsonb_build_object(
    'prepared', true, 'settlement_id', v_id,
    'amount', v_amount, 'count', v_count,
    'iban', v_iban, 'bic', v_bic, 'reference', v_ref
  );
END;
$fn$;

-- ── 7. Étape 2 — le club DÉCLARE avoir viré ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.declare_collab_settlement_sent(
  p_settlement_id uuid,
  p_confirm_days  int DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_venue_id text;
  v_status   text;
  v_due      timestamptz;
  v_days     int;
BEGIN
  SELECT venue_id, status INTO v_venue_id, v_status
  FROM public.collab_table_settlements WHERE id = p_settlement_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'settlement_not_prepared'; END IF;

  IF NOT (public.is_venue_owner(auth.uid(), v_venue_id) OR public.can_manage_venue(auth.uid(), v_venue_id)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_days := LEAST(GREATEST(COALESCE(p_confirm_days, 5), 2), 30);
  v_due := now() + make_interval(days => v_days);

  UPDATE public.collab_table_settlements
  SET status = 'approved', approved_at = now(), approved_by = auth.uid(), confirm_due_at = v_due
  WHERE id = p_settlement_id;

  RETURN jsonb_build_object('declared', true, 'settlement_id', p_settlement_id, 'confirm_due_at', v_due);
END;
$fn$;

-- ── 8. Étape 3 — l'ORGANISATEUR accuse réception (lui seul solde) ────────────
CREATE OR REPLACE FUNCTION public.confirm_collab_settlement_received(p_settlement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org_id uuid;
  v_status text;
  v_amount numeric;
BEGIN
  SELECT organizer_user_id, status, amount INTO v_org_id, v_status, v_amount
  FROM public.collab_table_settlements WHERE id = p_settlement_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
  -- Un lot en litige reste confirmable : l'argent a pu arriver en retard.
  IF v_status NOT IN ('approved', 'disputed') THEN RAISE EXCEPTION 'settlement_not_declared'; END IF;
  IF v_org_id <> auth.uid() THEN RAISE EXCEPTION 'only_organizer_can_confirm'; END IF;

  UPDATE public.collab_table_settlements
  SET status = 'paid', paid_at = now(), paid_by = auth.uid(),
      disputed_at = NULL, dispute_reason = NULL
  WHERE id = p_settlement_id;

  RETURN jsonb_build_object('confirmed', true, 'amount', v_amount);
END;
$fn$;

-- ── 9. Litige — l'organisateur conteste n'avoir rien reçu ────────────────────
CREATE OR REPLACE FUNCTION public.dispute_collab_settlement(
  p_settlement_id uuid,
  p_reason        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org_id uuid;
  v_status text;
BEGIN
  SELECT organizer_user_id, status INTO v_org_id, v_status
  FROM public.collab_table_settlements WHERE id = p_settlement_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
  IF v_status <> 'approved' THEN RAISE EXCEPTION 'settlement_not_declared'; END IF;
  IF v_org_id <> auth.uid() THEN RAISE EXCEPTION 'only_organizer_can_dispute'; END IF;

  UPDATE public.collab_table_settlements
  SET status = 'disputed', disputed_at = now(), dispute_reason = left(COALESCE(p_reason, ''), 500)
  WHERE id = p_settlement_id;

  RETURN jsonb_build_object('disputed', true, 'settlement_id', p_settlement_id);
END;
$fn$;

-- ── 10. Sortie de litige côté club : redéclarer ou annuler, jamais solder ────
CREATE OR REPLACE FUNCTION public.resolve_collab_settlement_dispute(
  p_settlement_id uuid,
  p_action        text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_venue_id text;
  v_status   text;
  v_due      timestamptz;
BEGIN
  SELECT venue_id, status INTO v_venue_id, v_status
  FROM public.collab_table_settlements WHERE id = p_settlement_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
  IF v_status <> 'disputed' THEN RAISE EXCEPTION 'settlement_not_disputed'; END IF;

  IF NOT (public.is_venue_owner(auth.uid(), v_venue_id) OR public.can_manage_venue(auth.uid(), v_venue_id)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_action = 'redeclare' THEN
    v_due := now() + interval '5 days';
    UPDATE public.collab_table_settlements
    SET status = 'approved', disputed_at = NULL, dispute_reason = NULL, confirm_due_at = v_due
    WHERE id = p_settlement_id;
    RETURN jsonb_build_object('resolved', true, 'action', 'redeclare', 'confirm_due_at', v_due);

  ELSIF p_action = 'cancel' THEN
    -- Les lignes partent en cascade : les réservations redeviennent réglables.
    DELETE FROM public.collab_table_settlements WHERE id = p_settlement_id;
    RETURN jsonb_build_object('resolved', true, 'action', 'cancel');
  END IF;

  RAISE EXCEPTION 'unknown_action';
END;
$fn$;

-- ── 11. Annulation d'un lot préparé (avant déclaration du virement) ──────────
CREATE OR REPLACE FUNCTION public.cancel_collab_table_settlement(p_settlement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_venue_id text;
  v_status   text;
BEGIN
  SELECT venue_id, status INTO v_venue_id, v_status
  FROM public.collab_table_settlements WHERE id = p_settlement_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'settlement_not_cancellable'; END IF;

  IF NOT (public.is_venue_owner(auth.uid(), v_venue_id) OR public.can_manage_venue(auth.uid(), v_venue_id)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  DELETE FROM public.collab_table_settlements WHERE id = p_settlement_id;
  RETURN jsonb_build_object('cancelled', true);
END;
$fn$;

-- ── 12. Coordonnées bancaires servies au club, via RPC uniquement ────────────
-- Le club n'a AUCUN accès direct à organizer_payout_details : il ne voit l'IBAN
-- que via le lot qu'il doit régler, tant que ce lot est ouvert.
CREATE OR REPLACE FUNCTION public.get_collab_settlement_bank_details(p_settlement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_venue_id text;
  v_org_id   uuid;
  v_status   text;
  v_ref      text;
  v_amount   numeric;
  v_iban     text;
  v_bic      text;
BEGIN
  SELECT venue_id, organizer_user_id, status, transfer_reference, amount
    INTO v_venue_id, v_org_id, v_status, v_ref, v_amount
  FROM public.collab_table_settlements WHERE id = p_settlement_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
  IF NOT (public.is_venue_owner(auth.uid(), v_venue_id) OR public.can_manage_venue(auth.uid(), v_venue_id)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_status NOT IN ('pending', 'approved', 'disputed') THEN
    RAISE EXCEPTION 'settlement_closed';
  END IF;

  SELECT iban, bic INTO v_iban, v_bic
  FROM public.organizer_payout_details WHERE user_id = v_org_id;

  RETURN jsonb_build_object('iban', v_iban, 'bic', v_bic, 'reference', v_ref, 'amount', v_amount);
END;
$fn$;

-- ── 13. Watchdog : pas d'accusé de réception dans les temps → litige ─────────
CREATE OR REPLACE FUNCTION public.auto_dispute_stale_collab_settlements()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_count int;
BEGIN
  WITH stale AS (
    UPDATE collab_table_settlements
    SET status = 'disputed', disputed_at = now(),
        dispute_reason = 'auto:no_acknowledgement'
    WHERE status = 'approved'
      AND confirm_due_at IS NOT NULL
      AND confirm_due_at < now()
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM stale;

  RETURN jsonb_build_object('disputed', v_count);
END;
$fn$;

-- ── 14. Droits ───────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.compute_collab_table_settlement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_collab_table_settlement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.declare_collab_settlement_sent(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_collab_settlement_received(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dispute_collab_settlement(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_collab_settlement_dispute(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_collab_table_settlement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_collab_settlement_bank_details(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.collab_table_settlement_lines(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.build_collab_settlement_reference(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.auto_dispute_stale_collab_settlements() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_collab_settlement_write() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.stamp_organizer_iban_change() FROM public, anon, authenticated;

-- ── 15. Planification quotidienne du watchdog ────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('collab-settlement-watchdog')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'collab-settlement-watchdog');

    PERFORM cron.schedule(
      'collab-settlement-watchdog',
      '35 5 * * *',
      $cron$ SELECT public.auto_dispute_stale_collab_settlements(); $cron$
    );
  END IF;
END $$;
