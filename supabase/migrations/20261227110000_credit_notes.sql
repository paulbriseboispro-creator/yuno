-- Tables VIP, vague C2 — D15 : un AVOIR automatique pour tout remboursement d'une vente qui a une facture (tables ET billets, commandes aussi).
--
-- Modèle (journal docs/audit/2026-11-24-tables-vip/vague-C2.md) :
--  • `credit_notes` : une ligne par avoir, montants POSITIFS (le document et les totaux nets les portent en négatif), reliée à la facture
--    d'origine (`invoice_id`), même vendeur, taux de TVA figés de la facture (`invoices.vat_rate` / `fee_vat_rate`).
--  • Numérotation : suite d'avoirs SÉPARÉE par vendeur et par année, `<préfixe>-AV-<année>-<rang>`, attribuée par un trigger sous un verrou par
--    (vendeur, année) — même mécanisme que assign_invoice_number, la suite des factures reste intacte. Un avoir émis ne change plus jamais.
--  • `issue_credit_note(vente, plafond)` : lit le CUMUL remboursé (`refund_amount`), le plafonne au TTC facturé, retranche ce qui est déjà
--    avoiré et émet UN avoir pour la différence. Idempotente (unicité facture × cumul). Rejouable sans risque.
--  • Aucun trigger d'émission : les remboursements réservent `refund_amount` AVANT Stripe puis le rendent si Stripe refuse ; un avoir émis à la
--    réservation serait faux et immuable. L'émission part des edge functions APRÈS confirmation de l'argent, et du filet horaire
--    (migration suivante).

CREATE TABLE IF NOT EXISTS public.credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  credit_number text NOT NULL,
  credit_year int,
  credit_seq int,
  seller_kind text NOT NULL,
  venue_id text,
  organizer_user_id uuid,
  kind text NOT NULL,
  ticket_id uuid,
  table_reservation_id uuid,
  order_id uuid,
  event_id uuid,
  event_name text,
  event_date timestamptz,
  customer_email text NOT NULL DEFAULT '',
  customer_name text,
  amount numeric(12,2) NOT NULL,
  total_ht numeric(12,2) NOT NULL,
  tva numeric(12,2) NOT NULL,
  base_cents int NOT NULL,
  fee_cents int NOT NULL,
  vat_rate numeric NOT NULL,
  fee_vat_rate numeric NOT NULL,
  refunded_cumulative_cents int NOT NULL,
  reason text,
  public_token text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  source text NOT NULL DEFAULT 'edge',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_notes_seller_chk CHECK (
    (seller_kind = 'venue' AND venue_id IS NOT NULL) OR (seller_kind = 'organizer' AND organizer_user_id IS NOT NULL)),
  CONSTRAINT credit_notes_kind_chk CHECK (kind IN ('ticket', 'table', 'order')),
  CONSTRAINT credit_notes_amount_chk CHECK (amount > 0 AND base_cents >= 0 AND fee_cents >= 0
                                            AND base_cents + fee_cents = round(amount * 100)::int)
);

CREATE UNIQUE INDEX IF NOT EXISTS credit_notes_venue_seq_uidx
  ON public.credit_notes (venue_id, credit_year, credit_seq) WHERE seller_kind = 'venue';
CREATE UNIQUE INDEX IF NOT EXISTS credit_notes_org_seq_uidx
  ON public.credit_notes (organizer_user_id, credit_year, credit_seq) WHERE seller_kind = 'organizer';
CREATE UNIQUE INDEX IF NOT EXISTS credit_notes_venue_number_uidx
  ON public.credit_notes (venue_id, credit_number) WHERE seller_kind = 'venue';
CREATE UNIQUE INDEX IF NOT EXISTS credit_notes_org_number_uidx
  ON public.credit_notes (organizer_user_id, credit_number) WHERE seller_kind = 'organizer';
CREATE UNIQUE INDEX IF NOT EXISTS credit_notes_invoice_cumulative_uidx
  ON public.credit_notes (invoice_id, refunded_cumulative_cents);
CREATE UNIQUE INDEX IF NOT EXISTS credit_notes_token_uidx ON public.credit_notes (public_token);
CREATE INDEX IF NOT EXISTS credit_notes_event_idx ON public.credit_notes (event_id);
CREATE INDEX IF NOT EXISTS credit_notes_venue_idx ON public.credit_notes (venue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS credit_notes_org_idx ON public.credit_notes (organizer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS credit_notes_ticket_idx ON public.credit_notes (ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_notes_table_idx ON public.credit_notes (table_reservation_id) WHERE table_reservation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_notes_order_idx ON public.credit_notes (order_id) WHERE order_id IS NOT NULL;

-- ── Numéro : une suite d'avoirs par vendeur et par année, attribuée par la base ─────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_credit_note_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_year int := extract(year FROM (now() AT TIME ZONE 'Europe/Paris'))::int;
  v_seq int;
BEGIN
  IF NEW.seller_kind = 'venue' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('yuno_credit:venue:' || NEW.venue_id || ':' || v_year, 0));
    SELECT COALESCE(max(c.credit_seq), 0) + 1 INTO v_seq
      FROM public.credit_notes c
     WHERE c.seller_kind = 'venue' AND c.venue_id = NEW.venue_id AND c.credit_year = v_year;
    SELECT NULLIF(btrim(v.invoice_prefix), '') INTO v_prefix FROM public.venues v WHERE v.id = NEW.venue_id;
    v_prefix := COALESCE(v_prefix, 'FAC');
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended('yuno_credit:org:' || NEW.organizer_user_id::text || ':' || v_year, 0));
    SELECT COALESCE(max(c.credit_seq), 0) + 1 INTO v_seq
      FROM public.credit_notes c
     WHERE c.seller_kind = 'organizer' AND c.organizer_user_id = NEW.organizer_user_id AND c.credit_year = v_year;
    SELECT NULLIF(btrim(p.invoice_prefix), '') INTO v_prefix FROM public.profiles p WHERE p.id = NEW.organizer_user_id;
    v_prefix := COALESCE(v_prefix, 'ORG');
  END IF;
  NEW.credit_year := v_year;
  NEW.credit_seq := v_seq;
  NEW.credit_number := v_prefix || '-AV-' || v_year::text || '-'
    || CASE WHEN v_seq < 100000 THEN lpad(v_seq::text, 5, '0') ELSE v_seq::text END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.assign_credit_note_number() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS assign_credit_note_number_trigger ON public.credit_notes;
CREATE TRIGGER assign_credit_note_number_trigger
  BEFORE INSERT ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.assign_credit_note_number();

-- Un avoir émis ne change jamais (montants, numéro, facture). Un client ne le supprime pas ; les cascades serveur
-- (suppression d'un club, d'un compte) passent.
CREATE OR REPLACE FUNCTION public.guard_credit_note_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_user IN ('authenticated', 'anon') THEN
      RAISE EXCEPTION 'credit_note_immutable' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW.credit_number, NEW.credit_year, NEW.credit_seq, NEW.seller_kind, NEW.amount, NEW.total_ht, NEW.tva,
      NEW.base_cents, NEW.fee_cents, NEW.invoice_id, NEW.refunded_cumulative_cents, NEW.public_token)
     IS DISTINCT FROM
     (OLD.credit_number, OLD.credit_year, OLD.credit_seq, OLD.seller_kind, OLD.amount, OLD.total_ht, OLD.tva,
      OLD.base_cents, OLD.fee_cents, OLD.invoice_id, OLD.refunded_cumulative_cents, OLD.public_token)
     AND COALESCE(current_setting('yuno.invoice_renumber_unlock', true), '') <> 'on' THEN
    RAISE EXCEPTION 'credit_note_immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_credit_note_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_credit_note_immutable_trigger ON public.credit_notes;
CREATE TRIGGER guard_credit_note_immutable_trigger
  BEFORE UPDATE OR DELETE ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.guard_credit_note_immutable();

-- ── Lecture : mêmes personnes que la facture d'origine + le client de la vente ──────────────────────────────
CREATE OR REPLACE FUNCTION public._credit_note_visible_to(p_id uuid, p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_uid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.credit_notes c
     WHERE c.id = p_id
       AND (
         (c.venue_id IS NOT NULL AND (public.is_venue_owner(p_uid, c.venue_id) OR public.can_manage_venue(p_uid, c.venue_id)))
         OR c.organizer_user_id = p_uid
         OR (c.event_id IS NOT NULL AND (public.is_event_partner_organizer(p_uid, c.event_id)
                                         OR public.is_event_partner_venue_owner(p_uid, c.event_id)))
         OR (c.ticket_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = c.ticket_id AND t.user_id = p_uid))
         OR (c.table_reservation_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.table_reservations r WHERE r.id = c.table_reservation_id AND r.user_id = p_uid))
         OR (c.order_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = c.order_id AND o.user_id = p_uid))
       )
  );
$$;
REVOKE ALL ON FUNCTION public._credit_note_visible_to(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._credit_note_visible_to(uuid, uuid) TO service_role;

-- Porte publique : la session de l'APPELANT seule (jamais un uid fourni : pas d'oracle « tel compte voit tel avoir »). Lue par la policy RLS.
CREATE OR REPLACE FUNCTION public.credit_note_visible(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT public._credit_note_visible_to(p_id, auth.uid()) $$;
REVOKE ALL ON FUNCTION public.credit_note_visible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credit_note_visible(uuid) TO authenticated, service_role;

ALTER TABLE public.credit_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Credit notes visible to their parties" ON public.credit_notes;
CREATE POLICY "Credit notes visible to their parties" ON public.credit_notes
  FOR SELECT TO authenticated
  USING (public.credit_note_visible(id));
REVOKE ALL ON public.credit_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.credit_notes TO authenticated;
GRANT ALL ON public.credit_notes TO service_role;

-- ── Émission ───────────────────────────────────────────────────────────────────────────────────────────────
-- p_up_to_cents : cumul remboursé CONFIRMÉ par l'appelant (borne haute) ; absent = le cumul de la vente (filet horaire).
-- Rend NULL quand il n'y a rien à avoirer (pas de facture, démo, déjà avoiré), sinon {id, credit_number, amount, public_token}.
CREATE OR REPLACE FUNCTION public.issue_credit_note(
  p_ticket_id uuid DEFAULT NULL,
  p_table_reservation_id uuid DEFAULT NULL,
  p_order_id uuid DEFAULT NULL,
  p_up_to_cents int DEFAULT NULL,
  p_source text DEFAULT 'edge')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.invoices%ROWTYPE;
  v_kind text;
  v_refund numeric;
  v_reason text;
  v_r int;            -- cumul à avoirer
  v_total int;        -- TTC facturé, en centimes
  v_fees int;         -- part « frais » du TTC facturé
  v_base int;
  v_prev int;
  v_prev_base int;
  v_prev_fee int;
  v_prev_ht numeric;
  v_delta int;
  v_n_base int;
  v_n_fee int;
  v_rb numeric;
  v_rf numeric;
  v_ht numeric;
  v_amount numeric;
  v_row public.credit_notes%ROWTYPE;
  v_demo boolean;
BEGIN
  IF num_nonnulls(p_ticket_id, p_table_reservation_id, p_order_id) <> 1 THEN
    RAISE EXCEPTION 'credit_one_sale_required' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'yuno_credit_sale:' || COALESCE(p_ticket_id, p_table_reservation_id, p_order_id)::text, 0));

  SELECT i.* INTO v_inv FROM public.invoices i
   WHERE (p_ticket_id IS NOT NULL AND i.ticket_id = p_ticket_id)
      OR (p_table_reservation_id IS NOT NULL AND i.table_reservation_id = p_table_reservation_id)
      OR (p_order_id IS NOT NULL AND i.order_id = p_order_id)
   ORDER BY i.created_at LIMIT 1;
  IF NOT FOUND OR v_inv.seller_kind IS NULL THEN
    RETURN NULL;          -- vente sans facture (démo, table sur place) : pas d'avoir
  END IF;

  v_demo := (v_inv.event_id IS NOT NULL AND v_inv.event_id = ANY (public.demo_event_ids()))
         OR (v_inv.venue_id IS NOT NULL AND v_inv.venue_id = ANY (public.demo_venue_ids()));
  IF v_demo THEN
    RETURN NULL;
  END IF;

  IF p_ticket_id IS NOT NULL THEN
    v_kind := 'ticket';
    SELECT t.refund_amount, t.refund_reason INTO v_refund, v_reason FROM public.tickets t WHERE t.id = p_ticket_id;
  ELSIF p_table_reservation_id IS NOT NULL THEN
    v_kind := 'table';
    SELECT r.refund_amount, r.refund_reason INTO v_refund, v_reason FROM public.table_reservations r WHERE r.id = p_table_reservation_id;
  ELSE
    v_kind := 'order';
    SELECT o.refund_amount, o.refund_reason INTO v_refund, v_reason FROM public.orders o WHERE o.id = p_order_id;
  END IF;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_total := round(v_inv.amount * 100)::int;
  v_r := round(COALESCE(v_refund, 0) * 100)::int;
  IF p_up_to_cents IS NOT NULL THEN v_r := LEAST(v_r, p_up_to_cents); END IF;
  v_r := LEAST(v_r, v_total);
  IF v_r <= 0 THEN RETURN NULL; END IF;

  SELECT COALESCE(sum(round(c.amount * 100)::int), 0), COALESCE(sum(c.base_cents), 0),
         COALESCE(sum(c.fee_cents), 0), COALESCE(sum(c.total_ht), 0)
    INTO v_prev, v_prev_base, v_prev_fee, v_prev_ht
    FROM public.credit_notes c WHERE c.invoice_id = v_inv.id;
  v_delta := v_r - v_prev;
  IF v_delta <= 0 THEN RETURN NULL; END IF;

  -- Part « frais » de la facture : lignes `fee` d'une facture de table « A bis », sinon les colonnes de frais.
  IF v_inv.type = 'table' AND jsonb_typeof(v_inv.items) = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_inv.items) l WHERE l->>'kind' = 'fee') THEN
    SELECT COALESCE(sum(round((l->>'total')::numeric * 100)::int), 0) INTO v_fees
      FROM jsonb_array_elements(v_inv.items) l WHERE l->>'kind' = 'fee';
  ELSE
    v_fees := round((COALESCE(v_inv.service_fee, 0) + COALESCE(v_inv.management_fee, 0) + COALESCE(v_inv.insurance_fee, 0)) * 100)::int;
  END IF;
  v_fees := LEAST(GREATEST(v_fees, 0), v_total);
  v_base := v_total - v_fees;

  -- Le remboursement porte d'abord sur la base (billet, acompte), puis sur les frais.
  v_n_base := LEAST(GREATEST(LEAST(v_r, v_base) - v_prev_base, 0), v_delta);
  v_n_fee := LEAST(v_delta - v_n_base, GREATEST(v_fees - v_prev_fee, 0));
  v_n_base := v_delta - v_n_fee;

  v_rb := COALESCE(v_inv.vat_rate,
                   CASE WHEN v_inv.seller_kind = 'organizer' AND v_inv.organizer_user_id IS NOT NULL
                        THEN public.organizer_vat_rate(v_inv.organizer_user_id) ELSE 20 END);
  v_rf := COALESCE(v_inv.fee_vat_rate, 20);
  v_amount := v_delta / 100.0;
  IF v_r >= v_total THEN
    -- Dernier avoir : le HT cumulé des avoirs retombe exactement sur le HT de la facture.
    v_ht := round(v_inv.total_ht - v_prev_ht, 2);
  ELSE
    v_ht := round(v_n_base / 100.0 / (1 + v_rb / 100), 2) + round(v_n_fee / 100.0 / (1 + v_rf / 100), 2);
  END IF;
  v_ht := LEAST(GREATEST(v_ht, 0), v_amount);

  BEGIN
    INSERT INTO public.credit_notes (
      invoice_id, credit_number, seller_kind, venue_id, organizer_user_id, kind,
      ticket_id, table_reservation_id, order_id, event_id, event_name, event_date,
      customer_email, customer_name, amount, total_ht, tva, base_cents, fee_cents,
      vat_rate, fee_vat_rate, refunded_cumulative_cents, reason, source)
    VALUES (
      v_inv.id, '', v_inv.seller_kind, v_inv.venue_id, v_inv.organizer_user_id, v_kind,
      v_inv.ticket_id, v_inv.table_reservation_id, v_inv.order_id, v_inv.event_id, v_inv.event_name, v_inv.event_date,
      COALESCE(v_inv.customer_email, ''), v_inv.customer_name, v_amount, v_ht, v_amount - v_ht, v_n_base, v_n_fee,
      v_rb, v_rf, v_r, NULLIF(btrim(COALESCE(v_reason, '')), ''), COALESCE(p_source, 'edge'))
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RETURN NULL;          -- un appel jumeau a déjà émis cet avoir
  END;

  RETURN jsonb_build_object('id', v_row.id, 'credit_number', v_row.credit_number,
                            'amount', v_row.amount, 'public_token', v_row.public_token);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_credit_note(uuid, uuid, uuid, int, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_credit_note(uuid, uuid, uuid, int, text) TO service_role;

-- ── Le document : une lecture pour le PDF (client connecté, ou lien public) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public._credit_note_doc(p_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', c.id,
    'credit_number', c.credit_number,
    'created_at', c.created_at,
    'kind', c.kind,
    'amount', c.amount, 'total_ht', c.total_ht, 'tva', c.tva,
    'base', c.base_cents / 100.0, 'fees', c.fee_cents / 100.0,
    'vat_rate', c.vat_rate, 'fee_vat_rate', c.fee_vat_rate,
    'reason', c.reason,
    'invoice_number', i.invoice_number, 'invoice_date', i.created_at,
    'event_name', c.event_name, 'event_date', c.event_date,
    'customer_name', c.customer_name, 'customer_email', c.customer_email,
    'seller', CASE
      WHEN c.seller_kind = 'venue' THEN (
        SELECT jsonb_build_object(
          'name', COALESCE(NULLIF(v.legal_name, ''), v.name),
          'address', COALESCE(v.legal_address, v.address),
          'siret', v.siret, 'vat_number', v.vat_number, 'logo_url', v.logo_url,
          'vat_regime', 'subject', 'bde_verified', false)
        FROM public.venues v WHERE v.id = c.venue_id)
      ELSE (
        SELECT jsonb_build_object(
          'name', COALESCE(NULLIF(o.legal_name, ''), o.display_name),
          'address', o.legal_address,
          'siret', o.siret, 'rna', o.rna_number, 'vat_number', o.vat_number, 'logo_url', o.avatar_url,
          'vat_regime', o.vat_regime, 'bde_verified', COALESCE(o.bde_verified, false))
        FROM public.organizer_profiles o WHERE o.user_id = c.organizer_user_id)
    END
  )
  FROM public.credit_notes c JOIN public.invoices i ON i.id = c.invoice_id
  WHERE c.id = p_id;
$$;
REVOKE ALL ON FUNCTION public._credit_note_doc(uuid) FROM PUBLIC, anon, authenticated;

-- Connecté : seulement un avoir qu'il a le droit de lire (même règle que la RLS).
CREATE OR REPLACE FUNCTION public.get_credit_note_doc(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.credit_note_visible(p_id) THEN
    RETURN NULL;
  END IF;
  RETURN public._credit_note_doc(p_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_credit_note_doc(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_credit_note_doc(uuid) TO authenticated, service_role;

-- Lien public de l'e-mail de remboursement : le jeton (32 hex aléatoires) est la preuve.
CREATE OR REPLACE FUNCTION public.get_credit_note_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN RETURN NULL; END IF;
  SELECT c.id INTO v_id FROM public.credit_notes c WHERE c.public_token = p_token;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  RETURN public._credit_note_doc(v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_credit_note_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_credit_note_by_token(text) TO anon, authenticated, service_role;

-- Avoirs d'une vente, pour la page de confirmation / Mes commandes (le client connecté prouve avec sa session ; un invité sans compte a le lien /avoir/<jeton> de l'e-mail de remboursement).
CREATE OR REPLACE FUNCTION public.get_sale_credit_notes(p_ticket_id uuid DEFAULT NULL, p_table_reservation_id uuid DEFAULT NULL, p_order_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id, 'credit_number', c.credit_number, 'amount', c.amount, 'created_at', c.created_at,
           'invoice_number', i.invoice_number) ORDER BY c.created_at), '[]'::jsonb)
    FROM public.credit_notes c JOIN public.invoices i ON i.id = c.invoice_id
   WHERE num_nonnulls(p_ticket_id, p_table_reservation_id, p_order_id) = 1
     AND ((p_ticket_id IS NOT NULL AND c.ticket_id = p_ticket_id)
       OR (p_table_reservation_id IS NOT NULL AND c.table_reservation_id = p_table_reservation_id)
       OR (p_order_id IS NOT NULL AND c.order_id = p_order_id))
     AND public.credit_note_visible(c.id);
$$;
REVOKE ALL ON FUNCTION public.get_sale_credit_notes(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sale_credit_notes(uuid, uuid, uuid) TO authenticated, service_role;
