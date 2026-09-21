-- ═══════════════════════════════════════════════════════════════════════════
-- Collab à BARÈME sur le CA de la soirée + DÉCOMPTE de fin de soirée
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Le contrat collab partageait chaque vente au moment de la vente, à un % fixe
-- par pilier. Un club peut rémunérer l'organisateur autrement : une fois, après
-- la soirée, à un taux qui dépend du TOTAL de la nuit (billets + tables + bar),
-- bar en caisse compris. Ce mode vit dans le même contrat :
--
--   revenue_split_rules.remuneration = {
--     mode: 'tiered_total',
--     tiers: [{ from: 0, pct: 0 }, { from: 3500, pct: 7 }, ...],   -- « à partir de »
--     tiers_mode: 'flat' | 'marginal'                              -- défaut 'flat'
--   }
--
-- Les trois blocs pilier restent présents à 0/100 (club) : tout le code qui lit
-- la forme canonique continue de voir une forme valide.
--
-- Pendant la vente, les billets et tables partent en charge sur la PLATEFORME
-- (payment-split.ts : splitMode 'separate', on_behalf_of = club) et leur
-- transfert est retenu SANS date (transfers_release_at NULL) : le cron de
-- libération ne prend que les lignes datées. Rien ne part avant le décompte.
--
-- Après la soirée : le club DÉCLARE (bar, porte, extras tables), l'organisateur
-- ACCEPTE ou CONTESTE. À l'acceptation, Yuno fige le total, applique le barème,
-- répartit le dû : d'abord sur les fonds RETENUS (jambe secondaire → organisateur,
-- prorata par ligne, libération immédiate), le reste par SEPA via le cycle
-- collab_table_settlements existant (kind 'night_closing').
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Lecture du barème ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_tiered_collab(p_rules jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT p_rules IS NOT NULL
     AND jsonb_typeof(p_rules->'remuneration') = 'object'
     AND p_rules->'remuneration'->>'mode' = 'tiered_total'
     AND jsonb_typeof(p_rules->'remuneration'->'tiers') = 'array'
     AND jsonb_array_length(p_rules->'remuneration'->'tiers') > 0;
$fn$;

COMMENT ON FUNCTION public.is_tiered_collab(jsonb) IS
  'Vrai quand le contrat collab rémunère l''organisateur par barème sur le CA total de la soirée (remuneration.mode = tiered_total).';

-- (pct, amount) pour un total donné. 'flat' : le taux du palier atteint
-- s''applique à tout le total. 'marginal' : chaque tranche à son taux ; pct
-- rendu = taux effectif. Miroir exact de tierFor() dans src/lib/splitRules.ts.
CREATE OR REPLACE FUNCTION public.collab_tier_pct(p_rules jsonb, p_total numeric)
RETURNS TABLE (pct numeric, amount numeric)
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  v_rem    jsonb := p_rules->'remuneration';
  v_mode   text;
  v_total  numeric := GREATEST(COALESCE(p_total, 0), 0);
  v_pct    numeric := 0;
  v_amount numeric := 0;
  r        record;
BEGIN
  IF NOT public.is_tiered_collab(p_rules) THEN
    pct := 0; amount := 0; RETURN NEXT; RETURN;
  END IF;
  v_mode := COALESCE(v_rem->>'tiers_mode', 'flat');

  IF v_mode = 'marginal' THEN
    FOR r IN
      SELECT f, p, LEAD(f) OVER (ORDER BY f) AS next_f
      FROM (
        SELECT GREATEST(COALESCE(NULLIF(t->>'from', '')::numeric, 0), 0) AS f,
               GREATEST(COALESCE(NULLIF(t->>'pct', '')::numeric, 0), 0)  AS p
        FROM jsonb_array_elements(v_rem->'tiers') t
      ) x
    LOOP
      IF v_total > r.f THEN
        v_amount := v_amount + (LEAST(v_total, COALESCE(r.next_f, v_total)) - r.f) * r.p / 100.0;
      END IF;
    END LOOP;
    v_pct := CASE WHEN v_total > 0 THEN ROUND(v_amount / v_total * 100.0, 2) ELSE 0 END;
  ELSE
    SELECT GREATEST(COALESCE(NULLIF(t->>'pct', '')::numeric, 0), 0) INTO v_pct
    FROM jsonb_array_elements(v_rem->'tiers') t
    WHERE GREATEST(COALESCE(NULLIF(t->>'from', '')::numeric, 0), 0) <= v_total
    ORDER BY GREATEST(COALESCE(NULLIF(t->>'from', '')::numeric, 0), 0) DESC
    LIMIT 1;
    v_pct := COALESCE(v_pct, 0);
    v_amount := v_total * v_pct / 100.0;
  END IF;

  pct := v_pct;
  amount := ROUND(v_amount, 2);
  RETURN NEXT;
END;
$fn$;

-- ── 2. La clôture de soirée ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.collab_night_closings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              uuid NOT NULL UNIQUE REFERENCES public.events(id) ON DELETE CASCADE,
  contract_id           uuid REFERENCES public.event_collab_contracts(id) ON DELETE SET NULL,
  venue_id              text NOT NULL,
  organizer_user_id     uuid NOT NULL,
  status                text NOT NULL DEFAULT 'declared'
                        CHECK (status IN ('declared', 'disputed', 'accepted')),
  -- Déclaré par le club (hors Yuno, TTC)
  declared_bar          numeric NOT NULL DEFAULT 0 CHECK (declared_bar >= 0),
  declared_door_count   integer NOT NULL DEFAULT 0 CHECK (declared_door_count >= 0),
  declared_door_tickets numeric NOT NULL DEFAULT 0 CHECK (declared_door_tickets >= 0),
  declared_tables_extra numeric NOT NULL DEFAULT 0 CHECK (declared_tables_extra >= 0),
  declared_other        numeric NOT NULL DEFAULT 0 CHECK (declared_other >= 0),
  declared_other_label  text,
  declared_note         text,
  declared_evidence     text,
  declared_at           timestamptz NOT NULL DEFAULT now(),
  declared_by           uuid,
  revision              integer NOT NULL DEFAULT 1,
  -- Chiffres Yuno (photo à la déclaration, refigés à l'acceptation)
  yuno_tickets          numeric NOT NULL DEFAULT 0,
  yuno_tables           numeric NOT NULL DEFAULT 0,
  yuno_drinks           numeric NOT NULL DEFAULT 0,
  -- Résultat figé à l'acceptation
  total_revenue         numeric,
  tier_pct              numeric,
  tiers_mode            text,
  organizer_due         numeric,
  held_amount           numeric,
  online_amount         numeric,
  sepa_amount           numeric,
  settlement_id         uuid REFERENCES public.collab_table_settlements(id) ON DELETE SET NULL,
  accepted_at           timestamptz,
  accepted_by           uuid,
  disputed_at           timestamptz,
  dispute_reason        text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.collab_night_closings IS
  'Décompte de fin de soirée d''une collab à barème : le club déclare le chiffre hors Yuno (bar, porte, extras tables), l''organisateur accepte, Yuno fige le total, applique le barème et répartit le dû (fonds retenus d''abord, SEPA pour le reste).';

CREATE INDEX IF NOT EXISTS idx_collab_night_closings_org
  ON public.collab_night_closings (organizer_user_id, status);
CREATE INDEX IF NOT EXISTS idx_collab_night_closings_venue
  ON public.collab_night_closings (venue_id, status);

DROP TRIGGER IF EXISTS trg_collab_night_closings_updated_at ON public.collab_night_closings;
CREATE TRIGGER trg_collab_night_closings_updated_at
  BEFORE UPDATE ON public.collab_night_closings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.collab_night_closings ENABLE ROW LEVEL SECURITY;

-- Lecture pour les deux parties ; AUCUNE policy d'écriture.
DROP POLICY IF EXISTS "Parties view their night closings" ON public.collab_night_closings;
CREATE POLICY "Parties view their night closings" ON public.collab_night_closings
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR organizer_user_id = auth.uid()
    OR public.is_venue_owner(auth.uid(), venue_id)
    OR public.can_manage_venue(auth.uid(), venue_id)
  );

-- Ceinture et bretelles : toute écriture cliente directe est refusée (SECURITY
-- INVOKER — un trigger DEFINER se désactiverait lui-même, cf. 20260721090000).
CREATE OR REPLACE FUNCTION public.guard_collab_night_closing_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF public.is_direct_client_write() THEN
    RAISE EXCEPTION 'night_closing_direct_write_forbidden'
      USING HINT = 'Passez par declare_collab_night_closing / accept_collab_night_closing.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

DROP TRIGGER IF EXISTS trg_guard_collab_night_closing_write ON public.collab_night_closings;
CREATE TRIGGER trg_guard_collab_night_closing_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.collab_night_closings
  FOR EACH ROW EXECUTE FUNCTION public.guard_collab_night_closing_write();

-- Argent : jamais depuis une session d'accès assisté (mode support).
DROP TRIGGER IF EXISTS trg_support_block_collab_night_closings ON public.collab_night_closings;
CREATE TRIGGER trg_support_block_collab_night_closings
  BEFORE INSERT OR UPDATE OR DELETE ON public.collab_night_closings
  FOR EACH ROW EXECUTE FUNCTION public.block_support_session_write();

-- Le lot SEPA du décompte réutilise le cycle des règlements tables.
ALTER TABLE public.collab_table_settlements
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'tables_topup';
ALTER TABLE public.collab_table_settlements
  DROP CONSTRAINT IF EXISTS collab_table_settlements_kind_check;
ALTER TABLE public.collab_table_settlements
  ADD CONSTRAINT collab_table_settlements_kind_check
  CHECK (kind IN ('tables_topup', 'night_closing'));
ALTER TABLE public.collab_table_settlements
  ADD COLUMN IF NOT EXISTS closing_id uuid REFERENCES public.collab_night_closings(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.collab_table_settlements.kind IS
  'tables_topup = complément tables (base total dépensé) ; night_closing = reste du barème d''un décompte de soirée non couvert par les fonds retenus.';

-- ── 3. Les chiffres Yuno de la soirée (formules de src/utils/fees.ts) ────────
-- gross = prix payé par le client − frais Yuno − remboursé. Les frais Yuno ne
-- sont jamais du revenu ; le remboursé est déjà exprimé côté club.
CREATE OR REPLACE FUNCTION public.collab_night_yuno_figures(p_event_id uuid)
RETURNS TABLE (
  tickets numeric, tickets_count integer,
  tables numeric, tables_count integer,
  drinks numeric, drinks_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    (SELECT ROUND(COALESCE(SUM(GREATEST(
        COALESCE(t.total_price, 0) - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0)
        - LEAST(COALESCE(t.refund_amount, 0), GREATEST(COALESCE(t.total_price, 0) - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0))
      , 0)), 0), 2)
     FROM public.tickets t WHERE t.event_id = p_event_id AND t.status = 'paid'),
    (SELECT COALESCE(SUM(COALESCE(t.quantity, 1)), 0)::integer
     FROM public.tickets t WHERE t.event_id = p_event_id AND t.status = 'paid'),
    (SELECT ROUND(COALESCE(SUM(GREATEST(
        COALESCE(r.total_price, 0) - COALESCE(r.service_fee, 0) - COALESCE(r.management_fee, 0)
        - LEAST(COALESCE(r.refund_amount, 0), GREATEST(COALESCE(r.total_price, 0) - COALESCE(r.service_fee, 0) - COALESCE(r.management_fee, 0), 0))
      , 0)), 0), 2)
     FROM public.table_reservations r WHERE r.event_id = p_event_id AND r.status = 'paid'),
    (SELECT COUNT(*)::integer
     FROM public.table_reservations r WHERE r.event_id = p_event_id AND r.status = 'paid'),
    (SELECT ROUND(COALESCE(SUM(GREATEST(
        COALESCE(o.total, 0) - COALESCE(o.service_fee, 0)
        - LEAST(COALESCE(o.refund_amount, 0), GREATEST(COALESCE(o.total, 0) - COALESCE(o.service_fee, 0), 0))
      , 0)), 0), 2)
     FROM public.orders o WHERE o.event_id = p_event_id AND o.status = 'paid'),
    (SELECT COUNT(*)::integer
     FROM public.orders o WHERE o.event_id = p_event_id AND o.status = 'paid');
$fn$;

-- Jambes retenues de la soirée : charges plateforme (mode 'separate') dont le
-- transfert n'a pas de date, jamais réparties, sur des ventes non remboursées.
CREATE OR REPLACE FUNCTION public.collab_night_held_rows(p_event_id uuid)
RETURNS TABLE (id uuid, primary_amount_cents integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT d.id, COALESCE(d.primary_amount_cents, 0)
  FROM public.revenue_distributions d
  WHERE d.event_id = p_event_id
    AND d.item_type IN ('ticket', 'table')
    AND d.split_mode = 'separate'
    AND d.transfers_release_at IS NULL
    AND d.primary_recipient_kind = 'venue'
    AND d.primary_transfer_status IN ('scheduled', 'failed')
    AND COALESCE(d.secondary_amount_cents, 0) = 0
    AND COALESCE(d.primary_amount_cents, 0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id = d.ticket_id AND t.status IN ('refunded', 'cancelled')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.table_reservations r
      WHERE r.id = d.table_reservation_id AND r.status IN ('refunded', 'cancelled')
    );
$fn$;

-- ── 4. Aperçu, pour les deux parties ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_collab_night_closing(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_venue_id   text;
  v_org_id     uuid;
  v_rules      jsonb;
  v_ended      boolean;
  v_end_at     timestamptz;
  v_fig        record;
  v_closing    public.collab_night_closings%ROWTYPE;
  v_has_row    boolean := false;
  v_held_cents bigint;
  v_org_acct   text;
  v_org_ready  boolean;
  v_has_iban   boolean;
  v_total      numeric;
  v_pct        numeric;
  v_due        numeric;
  v_online     numeric;
  v_sepa       numeric;
  v_settlement jsonb;
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

  SELECT revenue_split_rules, COALESCE(end_at, start_at), COALESCE(end_at, start_at) < now()
    INTO v_rules, v_end_at, v_ended
  FROM public.events WHERE id = p_event_id;

  IF v_rules IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'no_contract');
  END IF;
  IF NOT public.is_tiered_collab(v_rules) THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'not_tiered');
  END IF;

  SELECT * INTO v_fig FROM public.collab_night_yuno_figures(p_event_id);

  SELECT * INTO v_closing FROM public.collab_night_closings WHERE event_id = p_event_id;
  v_has_row := FOUND;

  SELECT COALESCE(SUM(h.primary_amount_cents), 0) INTO v_held_cents
  FROM public.collab_night_held_rows(p_event_id) h;

  SELECT p.stripe_connect_account_id, COALESCE(p.stripe_connect_charges_enabled, false)
    INTO v_org_acct, v_org_ready
  FROM public.profiles p WHERE p.id = v_org_id;

  SELECT (iban IS NOT NULL AND length(trim(iban)) >= 8) INTO v_has_iban
  FROM public.organizer_payout_details WHERE user_id = v_org_id;

  -- Projection : chiffres figés si accepté, sinon Yuno live + déclaration courante.
  IF v_has_row AND v_closing.status = 'accepted' THEN
    v_total  := v_closing.total_revenue;
    v_pct    := v_closing.tier_pct;
    v_due    := v_closing.organizer_due;
    v_online := v_closing.online_amount;
    v_sepa   := v_closing.sepa_amount;
  ELSE
    v_total := v_fig.tickets + v_fig.tables + v_fig.drinks
      + CASE WHEN v_has_row THEN v_closing.declared_bar + v_closing.declared_door_tickets
                                 + v_closing.declared_tables_extra + v_closing.declared_other
             ELSE 0 END;
    SELECT tp.pct, tp.amount INTO v_pct, v_due FROM public.collab_tier_pct(v_rules, v_total) tp;
    v_online := CASE WHEN v_org_acct IS NOT NULL AND v_org_ready
                     THEN LEAST(v_due, ROUND(v_held_cents / 100.0, 2)) ELSE 0 END;
    v_sepa := ROUND(v_due - v_online, 2);
  END IF;

  IF v_has_row AND v_closing.settlement_id IS NOT NULL THEN
    SELECT to_jsonb(x) INTO v_settlement FROM (
      SELECT id, status, amount, transfer_reference, confirm_due_at,
             approved_at, paid_at, disputed_at, dispute_reason, created_at
      FROM public.collab_table_settlements
      WHERE id = v_closing.settlement_id
    ) x;
  END IF;

  RETURN jsonb_build_object(
    'eligible', true,
    'event_ended', v_ended,
    'end_at', v_end_at,
    'tiers', v_rules->'remuneration'->'tiers',
    'tiers_mode', COALESCE(v_rules->'remuneration'->>'tiers_mode', 'flat'),
    'yuno', jsonb_build_object(
      'tickets', v_fig.tickets, 'tickets_count', v_fig.tickets_count,
      'tables', v_fig.tables, 'tables_count', v_fig.tables_count,
      'drinks', v_fig.drinks, 'drinks_count', v_fig.drinks_count
    ),
    'held_amount', ROUND(v_held_cents / 100.0, 2),
    'organizer_stripe_ready', COALESCE(v_org_acct IS NOT NULL AND v_org_ready, false),
    'organizer_has_iban', COALESCE(v_has_iban, false),
    'projection', jsonb_build_object(
      'total', ROUND(v_total, 2), 'pct', v_pct, 'due', v_due,
      'online', v_online, 'sepa', v_sepa
    ),
    'closing', CASE WHEN v_has_row THEN jsonb_build_object(
      'id', v_closing.id, 'status', v_closing.status, 'revision', v_closing.revision,
      'declared_bar', v_closing.declared_bar,
      'declared_door_count', v_closing.declared_door_count,
      'declared_door_tickets', v_closing.declared_door_tickets,
      'declared_tables_extra', v_closing.declared_tables_extra,
      'declared_other', v_closing.declared_other,
      'declared_other_label', v_closing.declared_other_label,
      'declared_note', v_closing.declared_note,
      'declared_evidence', v_closing.declared_evidence,
      'declared_at', v_closing.declared_at,
      'yuno_tickets', v_closing.yuno_tickets, 'yuno_tables', v_closing.yuno_tables,
      'yuno_drinks', v_closing.yuno_drinks,
      'total_revenue', v_closing.total_revenue, 'tier_pct', v_closing.tier_pct,
      'organizer_due', v_closing.organizer_due, 'held_amount', v_closing.held_amount,
      'online_amount', v_closing.online_amount, 'sepa_amount', v_closing.sepa_amount,
      'accepted_at', v_closing.accepted_at, 'disputed_at', v_closing.disputed_at,
      'dispute_reason', v_closing.dispute_reason,
      'settlement_id', v_closing.settlement_id
    ) END,
    'settlement', v_settlement
  );
END;
$fn$;

-- ── 5. Le club DÉCLARE (ou redéclare) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.declare_collab_night_closing(
  p_event_id      uuid,
  p_bar           numeric DEFAULT 0,
  p_door_count    integer DEFAULT 0,
  p_door_tickets  numeric DEFAULT 0,
  p_tables_extra  numeric DEFAULT 0,
  p_other         numeric DEFAULT 0,
  p_other_label   text DEFAULT NULL,
  p_note          text DEFAULT NULL,
  p_evidence      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_venue_id    text;
  v_org_id      uuid;
  v_rules       jsonb;
  v_ended       boolean;
  v_contract_id uuid;
  v_fig         record;
  v_status      text;
  v_id          uuid;
  v_title       text;
  v_club        text;
  v_total       numeric;
  v_pct         numeric;
  v_due         numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT venue_id, organizer_user_id INTO v_venue_id, v_org_id
  FROM public.collab_event_parties(p_event_id);
  IF v_venue_id IS NULL OR v_org_id IS NULL THEN RAISE EXCEPTION 'not_a_collab'; END IF;

  -- La déclaration est celle du CLUB : c'est lui qui tient la caisse.
  IF NOT (public.is_venue_owner(auth.uid(), v_venue_id) OR public.can_manage_venue(auth.uid(), v_venue_id)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT revenue_split_rules, COALESCE(end_at, start_at) < now()
    INTO v_rules, v_ended
  FROM public.events WHERE id = p_event_id;
  IF v_rules IS NULL THEN RAISE EXCEPTION 'no_contract'; END IF;
  IF NOT public.is_tiered_collab(v_rules) THEN RAISE EXCEPTION 'not_tiered'; END IF;
  -- On clôture une soirée FINIE : le bar n'a pas de chiffre avant.
  IF NOT v_ended THEN RAISE EXCEPTION 'event_not_ended'; END IF;

  IF COALESCE(p_bar, 0) < 0 OR COALESCE(p_door_count, 0) < 0 OR COALESCE(p_door_tickets, 0) < 0
     OR COALESCE(p_tables_extra, 0) < 0 OR COALESCE(p_other, 0) < 0 THEN
    RAISE EXCEPTION 'negative_amount';
  END IF;

  SELECT status, id INTO v_status, v_id
  FROM public.collab_night_closings WHERE event_id = p_event_id FOR UPDATE;
  IF v_status = 'accepted' THEN RAISE EXCEPTION 'closing_already_accepted'; END IF;

  SELECT id INTO v_contract_id
  FROM public.event_collab_contracts
  WHERE event_id = p_event_id AND status IN ('active', 'locked', 'closed')
  ORDER BY created_at DESC LIMIT 1;

  SELECT * INTO v_fig FROM public.collab_night_yuno_figures(p_event_id);

  IF v_id IS NULL THEN
    INSERT INTO public.collab_night_closings (
      event_id, contract_id, venue_id, organizer_user_id, status,
      declared_bar, declared_door_count, declared_door_tickets, declared_tables_extra,
      declared_other, declared_other_label, declared_note, declared_evidence,
      declared_at, declared_by, revision,
      yuno_tickets, yuno_tables, yuno_drinks
    ) VALUES (
      p_event_id, v_contract_id, v_venue_id, v_org_id, 'declared',
      ROUND(COALESCE(p_bar, 0), 2), COALESCE(p_door_count, 0), ROUND(COALESCE(p_door_tickets, 0), 2),
      ROUND(COALESCE(p_tables_extra, 0), 2), ROUND(COALESCE(p_other, 0), 2),
      NULLIF(left(trim(COALESCE(p_other_label, '')), 80), ''),
      NULLIF(left(trim(COALESCE(p_note, '')), 1000), ''),
      NULLIF(left(trim(COALESCE(p_evidence, '')), 300), ''),
      now(), auth.uid(), 1,
      v_fig.tickets, v_fig.tables, v_fig.drinks
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.collab_night_closings SET
      status = 'declared',
      declared_bar = ROUND(COALESCE(p_bar, 0), 2),
      declared_door_count = COALESCE(p_door_count, 0),
      declared_door_tickets = ROUND(COALESCE(p_door_tickets, 0), 2),
      declared_tables_extra = ROUND(COALESCE(p_tables_extra, 0), 2),
      declared_other = ROUND(COALESCE(p_other, 0), 2),
      declared_other_label = NULLIF(left(trim(COALESCE(p_other_label, '')), 80), ''),
      declared_note = NULLIF(left(trim(COALESCE(p_note, '')), 1000), ''),
      declared_evidence = NULLIF(left(trim(COALESCE(p_evidence, '')), 300), ''),
      declared_at = now(), declared_by = auth.uid(), revision = revision + 1,
      disputed_at = NULL, dispute_reason = NULL,
      yuno_tickets = v_fig.tickets, yuno_tables = v_fig.tables, yuno_drinks = v_fig.drinks
    WHERE id = v_id;
  END IF;

  v_total := v_fig.tickets + v_fig.tables + v_fig.drinks
    + COALESCE(p_bar, 0) + COALESCE(p_door_tickets, 0) + COALESCE(p_tables_extra, 0) + COALESCE(p_other, 0);
  SELECT tp.pct, tp.amount INTO v_pct, v_due FROM public.collab_tier_pct(v_rules, v_total) tp;

  -- Prévenir l'organisateur : c'est à lui de valider.
  SELECT title INTO v_title FROM public.events WHERE id = p_event_id;
  SELECT name INTO v_club FROM public.venues WHERE id = v_venue_id;
  BEGIN
    PERFORM public.notify_collab_party('organizer', v_venue_id, v_org_id, p_event_id,
      'collab_request',
      CASE WHEN v_status IS NULL THEN 'Décompte de soirée à valider' ELSE 'Décompte de soirée mis à jour' END,
      COALESCE(v_club, 'Le club') || ' a déclaré le chiffre de « ' || COALESCE(v_title, 'la soirée') || ' » : '
        || to_char(ROUND(v_total, 2), 'FM999G999G990D00') || ' € au total, palier ' || v_pct || ' %, '
        || to_char(ROUND(v_due, 2), 'FM999G999G990D00') || ' € pour toi. Vérifie et accepte pour déclencher le paiement.',
      'high', 'collab_night_closing', v_id,
      jsonb_build_object('event_id', p_event_id, 'closing_id', v_id));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('declared', true, 'closing_id', v_id,
    'total', ROUND(v_total, 2), 'pct', v_pct, 'due', v_due);
END;
$fn$;

-- ── 6. L'organisateur CONTESTE ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dispute_collab_night_closing(
  p_closing_id uuid,
  p_reason     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  c       public.collab_night_closings%ROWTYPE;
  v_title text;
  v_org   text;
BEGIN
  SELECT * INTO c FROM public.collab_night_closings WHERE id = p_closing_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'closing_not_found'; END IF;
  IF c.organizer_user_id <> auth.uid() THEN RAISE EXCEPTION 'only_organizer_can_dispute'; END IF;
  IF c.status <> 'declared' THEN RAISE EXCEPTION 'closing_not_declared'; END IF;

  UPDATE public.collab_night_closings
  SET status = 'disputed', disputed_at = now(), dispute_reason = NULLIF(left(trim(COALESCE(p_reason, '')), 500), '')
  WHERE id = p_closing_id;

  SELECT title INTO v_title FROM public.events WHERE id = c.event_id;
  SELECT display_name INTO v_org FROM public.organizer_profiles WHERE user_id = c.organizer_user_id;
  BEGIN
    PERFORM public.notify_collab_party('venue', c.venue_id, c.organizer_user_id, c.event_id,
      'collab_request', 'Décompte de soirée contesté',
      COALESCE(v_org, 'L''organisateur') || ' conteste le décompte de « ' || COALESCE(v_title, 'la soirée') || ' »'
        || CASE WHEN p_reason IS NOT NULL AND trim(p_reason) <> '' THEN ' : ' || left(trim(p_reason), 200) ELSE '.' END
        || ' Corrige la déclaration pour relancer la validation.',
      'high', 'collab_night_closing', c.id,
      jsonb_build_object('event_id', c.event_id, 'closing_id', c.id));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('disputed', true, 'closing_id', c.id);
END;
$fn$;

-- ── 7. Le club ANNULE sa déclaration (jamais un décompte accepté) ────────────
CREATE OR REPLACE FUNCTION public.cancel_collab_night_closing(p_closing_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  c public.collab_night_closings%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.collab_night_closings WHERE id = p_closing_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'closing_not_found'; END IF;
  IF NOT (public.is_venue_owner(auth.uid(), c.venue_id) OR public.can_manage_venue(auth.uid(), c.venue_id)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF c.status = 'accepted' THEN RAISE EXCEPTION 'closing_already_accepted'; END IF;

  DELETE FROM public.collab_night_closings WHERE id = p_closing_id;
  RETURN jsonb_build_object('cancelled', true);
END;
$fn$;

-- ── 8. L'organisateur ACCEPTE : Yuno fige, applique le barème, répartit ──────
CREATE OR REPLACE FUNCTION public.accept_collab_night_closing(p_closing_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  c             public.collab_night_closings%ROWTYPE;
  v_rules       jsonb;
  v_ended       boolean;
  v_fig         record;
  v_total       numeric;
  v_pct         numeric;
  v_due         numeric;
  v_due_cents   bigint;
  v_held_cents  bigint := 0;
  v_online      bigint := 0;
  v_sepa_cents  bigint := 0;
  v_org_acct    text;
  v_org_ready   boolean;
  v_iban        text;
  v_iban_chg    timestamptz;
  v_settle_id   uuid;
  v_ref         text;
  v_rows        int := 0;
  v_sum_base    bigint := 0;
  v_remainder   bigint;
  v_idx         int := 0;
  v_org_cents   bigint;
  r             record;
  v_title       text;
  v_org_name    text;
BEGIN
  SELECT * INTO c FROM public.collab_night_closings WHERE id = p_closing_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'closing_not_found'; END IF;
  -- Le décompte est une créance de l'ORGANISATEUR : lui seul l'accepte.
  IF c.organizer_user_id <> auth.uid() THEN RAISE EXCEPTION 'only_organizer_can_accept'; END IF;
  IF c.status <> 'declared' THEN RAISE EXCEPTION 'closing_not_declared'; END IF;

  SELECT revenue_split_rules, COALESCE(end_at, start_at) < now()
    INTO v_rules, v_ended
  FROM public.events WHERE id = c.event_id;
  IF v_rules IS NULL OR NOT public.is_tiered_collab(v_rules) THEN RAISE EXCEPTION 'not_tiered'; END IF;
  IF NOT v_ended THEN RAISE EXCEPTION 'event_not_ended'; END IF;

  -- Refiger les chiffres Yuno à l'instant de l'acceptation.
  SELECT * INTO v_fig FROM public.collab_night_yuno_figures(c.event_id);
  v_total := v_fig.tickets + v_fig.tables + v_fig.drinks
    + c.declared_bar + c.declared_door_tickets + c.declared_tables_extra + c.declared_other;
  SELECT tp.pct, tp.amount INTO v_pct, v_due FROM public.collab_tier_pct(v_rules, v_total) tp;
  v_due_cents := ROUND(v_due * 100)::bigint;

  -- Fonds retenus, verrouillés le temps de la répartition.
  SELECT COALESCE(SUM(h.primary_amount_cents), 0), COUNT(*) INTO v_held_cents, v_rows
  FROM public.collab_night_held_rows(c.event_id) h;
  IF v_rows > 0 THEN
    PERFORM 1 FROM public.revenue_distributions d
    WHERE d.id IN (SELECT h.id FROM public.collab_night_held_rows(c.event_id) h) FOR UPDATE;
  END IF;

  SELECT p.stripe_connect_account_id, COALESCE(p.stripe_connect_charges_enabled, false)
    INTO v_org_acct, v_org_ready
  FROM public.profiles p WHERE p.id = c.organizer_user_id;

  IF v_org_acct IS NOT NULL AND v_org_ready THEN
    v_online := LEAST(v_due_cents, v_held_cents);
  END IF;
  v_sepa_cents := v_due_cents - v_online;

  -- Le reste passe par SEPA : il faut un IBAN organisateur, posé depuis > 24 h.
  IF v_sepa_cents > 0 THEN
    SELECT iban, iban_changed_at INTO v_iban, v_iban_chg
    FROM public.organizer_payout_details WHERE user_id = c.organizer_user_id;
    IF v_iban IS NULL OR length(trim(v_iban)) < 8 THEN RAISE EXCEPTION 'organizer_iban_missing'; END IF;
    IF v_iban_chg IS NOT NULL AND v_iban_chg > now() - interval '24 hours' THEN
      RAISE EXCEPTION 'iban_recently_changed';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.collab_table_settlements
      WHERE event_id = c.event_id AND status IN ('pending', 'approved', 'disputed')
    ) THEN
      RAISE EXCEPTION 'settlement_already_open';
    END IF;
  END IF;

  -- Répartition du montant en ligne au PRORATA de chaque jambe retenue. On
  -- distribue d'abord la part entière de chaque ligne, puis les centimes de
  -- reste aux plus grosses lignes : la somme des jambes organisateur vaut
  -- exactement v_online, et aucune ligne ne dépasse ce qu'elle porte.
  IF v_online > 0 THEN
    FOR r IN
      SELECT h.id, h.primary_amount_cents AS p
      FROM public.collab_night_held_rows(c.event_id) h
      ORDER BY h.primary_amount_cents DESC, h.id
    LOOP
      v_sum_base := v_sum_base + FLOOR(r.p::numeric * v_online / v_held_cents)::bigint;
    END LOOP;
    v_remainder := v_online - v_sum_base;

    FOR r IN
      SELECT h.id, h.primary_amount_cents AS p
      FROM public.collab_night_held_rows(c.event_id) h
      ORDER BY h.primary_amount_cents DESC, h.id
    LOOP
      v_idx := v_idx + 1;
      v_org_cents := FLOOR(r.p::numeric * v_online / v_held_cents)::bigint
        + CASE WHEN v_idx <= v_remainder THEN 1 ELSE 0 END;
      v_org_cents := LEAST(v_org_cents, r.p);

      UPDATE public.revenue_distributions SET
        primary_amount_cents = (r.p - v_org_cents)::integer,
        primary_transfer_status = CASE WHEN r.p - v_org_cents > 0 THEN 'scheduled' ELSE 'not_required' END,
        primary_transfer_error = NULL,
        secondary_account_id = CASE WHEN v_org_cents > 0 THEN v_org_acct ELSE secondary_account_id END,
        secondary_amount_cents = v_org_cents::integer,
        secondary_recipient_kind = CASE WHEN v_org_cents > 0 THEN 'organizer' ELSE secondary_recipient_kind END,
        secondary_recipient_organizer_id = CASE WHEN v_org_cents > 0 THEN c.organizer_user_id ELSE secondary_recipient_organizer_id END,
        secondary_transfer_status = CASE WHEN v_org_cents > 0 THEN 'scheduled' ELSE 'not_required' END,
        secondary_transfer_error = NULL,
        transfers_release_at = now(),
        metadata = COALESCE(metadata, '{}'::jsonb)
          || jsonb_build_object('night_closing_id', c.id, 'night_closing_organizer_cents', v_org_cents),
        updated_at = now()
      WHERE id = r.id;
    END LOOP;
  END IF;

  -- Tout ce qui reste retenu sur cette soirée (part club, lignes sans part
  -- organisateur) est libéré maintenant : le décompte est le seul verrou.
  UPDATE public.revenue_distributions SET
    transfers_release_at = now(),
    primary_transfer_status = CASE WHEN primary_transfer_status = 'failed' THEN 'scheduled' ELSE primary_transfer_status END,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('night_closing_id', c.id),
    updated_at = now()
  WHERE event_id = c.event_id
    AND item_type IN ('ticket', 'table')
    AND split_mode = 'separate'
    AND transfers_release_at IS NULL;

  -- Le reste dû par virement : un lot du cycle existant, à déclarer par le club.
  IF v_sepa_cents > 0 THEN
    v_ref := public.build_collab_settlement_reference(c.organizer_user_id);
    INSERT INTO public.collab_table_settlements (
      event_id, contract_id, venue_id, organizer_user_id,
      amount, organizer_pct_applied, night_revenue, organizer_theoretical, organizer_prepaid,
      breakdown, status, transfer_reference, created_by, kind, closing_id
    ) VALUES (
      c.event_id, c.contract_id, c.venue_id, c.organizer_user_id,
      ROUND(v_sepa_cents / 100.0, 2), v_pct, ROUND(v_total, 2), v_due, ROUND(v_online / 100.0, 2),
      jsonb_build_object(
        'kind', 'night_closing', 'closing_id', c.id,
        'yuno_tickets', v_fig.tickets, 'yuno_tables', v_fig.tables, 'yuno_drinks', v_fig.drinks,
        'declared_bar', c.declared_bar, 'declared_door_tickets', c.declared_door_tickets,
        'declared_door_count', c.declared_door_count,
        'declared_tables_extra', c.declared_tables_extra, 'declared_other', c.declared_other,
        'total', ROUND(v_total, 2), 'pct', v_pct, 'due', v_due,
        'held', ROUND(v_held_cents / 100.0, 2), 'online', ROUND(v_online / 100.0, 2),
        'computed_at', now()
      ),
      'pending', v_ref, auth.uid(), 'night_closing', c.id
    ) RETURNING id INTO v_settle_id;
  END IF;

  UPDATE public.collab_night_closings SET
    status = 'accepted', accepted_at = now(), accepted_by = auth.uid(),
    disputed_at = NULL, dispute_reason = NULL,
    yuno_tickets = v_fig.tickets, yuno_tables = v_fig.tables, yuno_drinks = v_fig.drinks,
    total_revenue = ROUND(v_total, 2), tier_pct = v_pct,
    tiers_mode = COALESCE(v_rules->'remuneration'->>'tiers_mode', 'flat'),
    organizer_due = v_due,
    held_amount = ROUND(v_held_cents / 100.0, 2),
    online_amount = ROUND(v_online / 100.0, 2),
    sepa_amount = ROUND(v_sepa_cents / 100.0, 2),
    settlement_id = v_settle_id
  WHERE id = c.id;

  -- Libération immédiate des transferts Stripe (même appel que le cron horaire).
  -- Best-effort : le cron repasse de toute façon à H+07.
  BEGIN
    PERFORM net.http_post(
      url := 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/stripe-webhook',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', private.get_cron_secret()
      ),
      body := jsonb_build_object('task', 'release_held_transfers')
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  SELECT title INTO v_title FROM public.events WHERE id = c.event_id;
  SELECT display_name INTO v_org_name FROM public.organizer_profiles WHERE user_id = c.organizer_user_id;
  BEGIN
    PERFORM public.notify_collab_party('venue', c.venue_id, c.organizer_user_id, c.event_id,
      'collab_request', 'Décompte de soirée accepté',
      COALESCE(v_org_name, 'L''organisateur') || ' a accepté le décompte de « ' || COALESCE(v_title, 'la soirée') || ' » : '
        || to_char(ROUND(v_total, 2), 'FM999G999G990D00') || ' € au total, palier ' || v_pct || ' %. '
        || CASE WHEN v_online > 0 THEN to_char(ROUND(v_online / 100.0, 2), 'FM999G999G990D00') || ' € partent des ventes Yuno retenues. ' ELSE '' END
        || CASE WHEN v_sepa_cents > 0 THEN 'Reste ' || to_char(ROUND(v_sepa_cents / 100.0, 2), 'FM999G999G990D00') || ' € à virer (référence dans la carte Décompte).' ELSE 'Rien à virer.' END,
      'high', 'collab_night_closing', c.id,
      jsonb_build_object('event_id', c.event_id, 'closing_id', c.id, 'settlement_id', v_settle_id));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'accepted', true, 'closing_id', c.id,
    'total', ROUND(v_total, 2), 'pct', v_pct, 'due', v_due,
    'held', ROUND(v_held_cents / 100.0, 2),
    'online', ROUND(v_online / 100.0, 2),
    'sepa', ROUND(v_sepa_cents / 100.0, 2),
    'settlement_id', v_settle_id
  );
END;
$fn$;

-- ── 9. Droits ────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.is_tiered_collab(jsonb) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.collab_tier_pct(jsonb, numeric) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.compute_collab_night_closing(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.declare_collab_night_closing(uuid, numeric, integer, numeric, numeric, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dispute_collab_night_closing(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_collab_night_closing(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_collab_night_closing(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.collab_night_yuno_figures(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.collab_night_held_rows(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_collab_night_closing_write() FROM public, anon, authenticated;
