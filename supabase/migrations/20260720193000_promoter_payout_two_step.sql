-- ============================================================================
-- Reglement promoteur en DEUX TEMPS, avec accuse de reception.
--
-- Aujourd'hui : un seul clic solde tout, aucune table ne relie une ligne de
-- paiement aux commissions qu'elle couvre, et le club peut marquer « paye »
-- sans avoir rien verse. Impossible de prouver quoi que ce soit d'un cote
-- comme de l'autre.
--
-- Principe retenu : Yuno securise l'ACCORD, pas les fonds. L'argent continue
-- de partir du compte du club (virement SEPA), donc aucune activite de
-- transfert de fonds cote Yuno — pas d'agrement, pas de detention.
--
-- Le cycle utilise les TROIS STATUTS DEJA EXISTANTS de promoter_payouts, donc
-- aucune contrainte a modifier :
--   'pending'  = lot PREPARE   : perimetre fige, annulable, rien n'est solde
--   'approved' = virement DECLARE par le club
--   'paid'     = reception CONFIRMEE par le promoteur → commissions soldees
--
-- La table de liaison est la brique manquante : sans elle, « valider ce
-- paiement » n'a aucun sens, puisque le montant bouge entre les deux clics.
-- ============================================================================

-- ── 1. Le lien manquant : une ligne de paiement ↔ ses commissions ───────────
CREATE TABLE IF NOT EXISTS public.promoter_payout_items (
  payout_id     uuid NOT NULL REFERENCES public.promoter_payouts(id) ON DELETE CASCADE,
  conversion_id uuid NOT NULL REFERENCES public.promoter_conversions(id) ON DELETE CASCADE,
  commission    numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (payout_id, conversion_id)
);

-- Une commission ne peut appartenir qu'a UN SEUL lot : c'est ce qui rend
-- impossible de la payer deux fois, ou de la voir disparaitre entre deux lots.
CREATE UNIQUE INDEX IF NOT EXISTS promoter_payout_items_conversion_uniq
  ON public.promoter_payout_items (conversion_id);

CREATE INDEX IF NOT EXISTS idx_promoter_payout_items_payout
  ON public.promoter_payout_items (payout_id);

ALTER TABLE public.promoter_payout_items ENABLE ROW LEVEL SECURITY;

-- Lecture : les deux parties concernees (le club/organisateur qui paie, et le
-- promoteur paye). Aucune ecriture directe : tout passe par les RPC ci-dessous.
DROP POLICY IF EXISTS "Payout items readable by both parties" ON public.promoter_payout_items;
CREATE POLICY "Payout items readable by both parties"
ON public.promoter_payout_items FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.promoter_payouts pp
    JOIN public.promoters p ON p.id = pp.promoter_id
    WHERE pp.id = promoter_payout_items.payout_id
      AND (
        p.user_id = auth.uid()
        OR public.is_venue_owner(auth.uid(), pp.venue_id)
        OR public.can_manage_venue(auth.uid(), pp.venue_id)
        OR (pp.organizer_user_id IS NOT NULL AND (
              auth.uid() = pp.organizer_user_id
              OR public.is_organizer_promoter_admin(auth.uid(), pp.organizer_user_id)))
      )
  )
);

-- ── 2. Anti-fraude au changement d'IBAN ────────────────────────────────────
-- Vecteur d'attaque principal sur ce type de flux : modifier l'IBAN juste
-- avant un reglement pour detourner le virement. On horodate tout changement
-- et on gele la preparation d'un lot pendant 24 h.
ALTER TABLE public.promoters
  ADD COLUMN IF NOT EXISTS iban_changed_at timestamptz;

CREATE OR REPLACE FUNCTION public.stamp_promoter_iban_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.iban IS DISTINCT FROM OLD.iban THEN
    NEW.iban_changed_at := now();
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_stamp_promoter_iban_change ON public.promoters;
CREATE TRIGGER trg_stamp_promoter_iban_change
  BEFORE UPDATE OF iban ON public.promoters
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_promoter_iban_change();

-- ── 3. Etape 1 — PREPARER le lot ───────────────────────────────────────────
-- Fige le perimetre. Les conversions restent 'pending' (donc encore dues) mais
-- deviennent rattachees a ce lot, et l'index unique interdit qu'un second lot
-- les reprenne. Rien n'est solde : le lot reste annulable.
CREATE OR REPLACE FUNCTION public.prepare_promoter_payout(
  p_promoter_id uuid,
  p_period_label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_venue_id text;
  v_org_id uuid;
  v_agency_id uuid;
  v_iban text;
  v_iban_changed timestamptz;
  v_amount numeric;
  v_count int;
  v_payout_id uuid;
BEGIN
  SELECT venue_id, organizer_user_id, agency_id, iban, iban_changed_at
    INTO v_venue_id, v_org_id, v_agency_id, v_iban, v_iban_changed
  FROM promoters WHERE id = p_promoter_id;

  IF v_agency_id IS NOT NULL THEN
    RAISE EXCEPTION 'agency-managed promoter must be settled by the agency';
  END IF;

  IF v_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), v_venue_id) OR public.can_manage_venue(auth.uid(), v_venue_id)) THEN
      RAISE EXCEPTION 'not authorized to settle this promoter';
    END IF;
  ELSIF v_org_id IS NOT NULL THEN
    IF auth.uid() <> v_org_id AND NOT public.is_organizer_promoter_admin(auth.uid(), v_org_id) THEN
      RAISE EXCEPTION 'not authorized to settle this promoter';
    END IF;
  ELSE
    RAISE EXCEPTION 'promoter not found';
  END IF;

  -- Gel anti-detournement.
  IF v_iban_changed IS NOT NULL AND v_iban_changed > now() - interval '24 hours' THEN
    RAISE EXCEPTION 'iban_recently_changed';
  END IF;

  -- Un seul lot ouvert a la fois : sinon deux preparations concurrentes
  -- affichent deux montants et le club vire deux fois.
  IF EXISTS (
    SELECT 1 FROM promoter_payouts
    WHERE promoter_id = p_promoter_id AND status IN ('pending', 'approved')
  ) THEN
    RAISE EXCEPTION 'payout_already_open';
  END IF;

  INSERT INTO promoter_payouts (
    promoter_id, venue_id, organizer_user_id, amount, status, period_label
  ) VALUES (
    p_promoter_id, v_venue_id, v_org_id, 0, 'pending',
    COALESCE(p_period_label, 'Reglement ' || to_char(now(), 'DD/MM/YYYY'))
  )
  RETURNING id INTO v_payout_id;

  -- Rattachement atomique des commissions dues et non deja rattachees.
  WITH claimed AS (
    INSERT INTO promoter_payout_items (payout_id, conversion_id, commission)
    SELECT v_payout_id, pc.id, COALESCE(pc.commission, 0)
    FROM promoter_conversions pc
    WHERE pc.promoter_id = p_promoter_id
      AND pc.status = 'pending'
      AND NOT EXISTS (SELECT 1 FROM promoter_payout_items i WHERE i.conversion_id = pc.id)
    RETURNING commission
  )
  SELECT COALESCE(SUM(commission), 0), COUNT(*) INTO v_amount, v_count FROM claimed;

  IF v_count = 0 OR v_amount <= 0 THEN
    DELETE FROM promoter_payouts WHERE id = v_payout_id;
    RETURN jsonb_build_object('prepared', false, 'reason', 'nothing_pending');
  END IF;

  UPDATE promoter_payouts SET amount = v_amount WHERE id = v_payout_id;

  RETURN jsonb_build_object(
    'prepared', true, 'payout_id', v_payout_id,
    'amount', v_amount, 'count', v_count, 'iban', v_iban
  );
END;
$fn$;

-- ── 4. Etape 2 — le club DECLARE avoir vire ────────────────────────────────
CREATE OR REPLACE FUNCTION public.declare_promoter_payout_sent(p_payout_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_venue_id text;
  v_org_id uuid;
  v_status text;
BEGIN
  SELECT venue_id, organizer_user_id, status
    INTO v_venue_id, v_org_id, v_status
  FROM promoter_payouts WHERE id = p_payout_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'payout not found'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'payout not in prepared state'; END IF;

  IF v_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), v_venue_id) OR public.can_manage_venue(auth.uid(), v_venue_id)) THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
  ELSIF v_org_id IS NOT NULL THEN
    IF auth.uid() <> v_org_id AND NOT public.is_organizer_promoter_admin(auth.uid(), v_org_id) THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
  END IF;

  UPDATE promoter_payouts
  SET status = 'approved', approved_at = now(), approved_by = auth.uid()
  WHERE id = p_payout_id;

  RETURN jsonb_build_object('declared', true, 'payout_id', p_payout_id);
END;
$fn$;

-- ── 5. Etape 3 — le PROMOTEUR confirme la reception ────────────────────────
-- C'est SEULEMENT ici que les commissions sont soldees : un club ne peut plus
-- effacer une dette unilateralement.
CREATE OR REPLACE FUNCTION public.confirm_promoter_payout_received(p_payout_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_promoter_id uuid;
  v_status text;
  v_amount numeric;
BEGIN
  SELECT pp.promoter_id, pp.status, pp.amount
    INTO v_promoter_id, v_status, v_amount
  FROM promoter_payouts pp WHERE pp.id = p_payout_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'payout not found'; END IF;
  IF v_status <> 'approved' THEN RAISE EXCEPTION 'payout not declared sent'; END IF;

  -- Seul le promoteur concerne peut accuser reception.
  IF NOT EXISTS (
    SELECT 1 FROM promoters p WHERE p.id = v_promoter_id AND p.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'only the promoter can confirm receipt';
  END IF;

  -- Solde EXACTEMENT les commissions du lot, pas « toutes celles en attente ».
  UPDATE promoter_conversions pc
  SET status = 'paid', paid_at = now()
  FROM promoter_payout_items i
  WHERE i.payout_id = p_payout_id
    AND pc.id = i.conversion_id
    AND pc.status = 'pending';

  UPDATE promoter_payouts
  SET status = 'paid', paid_at = now(), paid_by = auth.uid()
  WHERE id = p_payout_id;

  UPDATE promoters
  SET pending_amount = GREATEST(COALESCE(pending_amount, 0) - v_amount, 0),
      total_paid = COALESCE(total_paid, 0) + v_amount,
      updated_at = now()
  WHERE id = v_promoter_id;

  RETURN jsonb_build_object('confirmed', true, 'amount', v_amount);
END;
$fn$;

-- ── 6. Annulation d'un lot prepare (avant declaration du virement) ─────────
CREATE OR REPLACE FUNCTION public.cancel_promoter_payout(p_payout_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_venue_id text;
  v_org_id uuid;
  v_status text;
BEGIN
  SELECT venue_id, organizer_user_id, status
    INTO v_venue_id, v_org_id, v_status
  FROM promoter_payouts WHERE id = p_payout_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'payout not found'; END IF;
  IF v_status = 'paid' THEN RAISE EXCEPTION 'a confirmed payout cannot be cancelled'; END IF;

  IF v_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), v_venue_id) OR public.can_manage_venue(auth.uid(), v_venue_id)) THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
  ELSIF v_org_id IS NOT NULL THEN
    IF auth.uid() <> v_org_id AND NOT public.is_organizer_promoter_admin(auth.uid(), v_org_id) THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
  END IF;

  -- Les items partent en cascade : les commissions redeviennent rattachables.
  DELETE FROM promoter_payouts WHERE id = p_payout_id;
  RETURN jsonb_build_object('cancelled', true);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.prepare_promoter_payout(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.declare_promoter_payout_sent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_promoter_payout_received(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_promoter_payout(uuid) TO authenticated;
