-- Tables VIP, vague C bis — I4 : un avoir ne naît JAMAIS d'un remboursement que Stripe n'a pas fait.
--
-- `refund_amount` est RÉSERVÉ avant l'appel Stripe (verrou anti-double-remboursement) puis rendu si Stripe refuse. Une réservation
-- orpheline (edge morte entre la réservation et la libération) ne prouve donc rien. La preuve que l'argent est parti est une TRACE
-- écrite par les edge functions APRÈS le succès Stripe (ou par le webhook `charge.refunded`, dont le cumul vient de Stripe) :
-- `sale_refund_confirmations` (vente, cumul confirmé en centimes). Le filet horaire n'émet que jusqu'au cumul CONFIRMÉ ; une
-- réservation plus grosse que la trace depuis plus de 24 h lève une alerte super admin au lieu d'un avoir.
--
-- Rattrapage unique : les remboursements déjà faits avant cette migration (refunded_at de plus d'une heure) sur une vente facturée
-- sont posés comme confirmés (ce sont des remboursements d'avant le verrou posé en vague C ; seul Amoris en a en prod, 2 billets de 4 €).
-- Les remboursements réservés après le déploiement de la migration mais avant celui des edge functions restent sans
-- trace : le filet ne les avoire pas et l'alerte de 24 h les signale.

CREATE TABLE IF NOT EXISTS public.sale_refund_confirmations (
  kind text NOT NULL CHECK (kind IN ('ticket', 'table', 'order')),
  sale_id uuid NOT NULL,
  cumulative_cents int NOT NULL CHECK (cumulative_cents > 0),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, sale_id, cumulative_cents)
);
ALTER TABLE public.sale_refund_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_refund_confirmations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.sale_refund_confirmations TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_sale_refund(p_kind text, p_sale_id uuid, p_cumulative_cents int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_kind NOT IN ('ticket', 'table', 'order') OR p_sale_id IS NULL OR COALESCE(p_cumulative_cents, 0) <= 0 THEN
    RAISE EXCEPTION 'confirm_refund_invalid' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.sale_refund_confirmations (kind, sale_id, cumulative_cents)
  VALUES (p_kind, p_sale_id, p_cumulative_cents)
  ON CONFLICT DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_sale_refund(text, uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_sale_refund(text, uuid, int) TO service_role;

-- Rattrapage des remboursements d'avant.
INSERT INTO public.sale_refund_confirmations (kind, sale_id, cumulative_cents)
SELECT 'ticket', t.id, round(t.refund_amount * 100)::int
  FROM public.tickets t JOIN public.invoices i ON i.ticket_id = t.id
 WHERE COALESCE(t.refund_amount, 0) > 0 AND COALESCE(t.refunded_at, i.created_at) < now() - interval '1 hour'
ON CONFLICT DO NOTHING;
INSERT INTO public.sale_refund_confirmations (kind, sale_id, cumulative_cents)
SELECT 'table', r.id, round(r.refund_amount * 100)::int
  FROM public.table_reservations r JOIN public.invoices i ON i.table_reservation_id = r.id
 WHERE COALESCE(r.refund_amount, 0) > 0 AND COALESCE(r.refunded_at, i.created_at) < now() - interval '1 hour'
ON CONFLICT DO NOTHING;
INSERT INTO public.sale_refund_confirmations (kind, sale_id, cumulative_cents)
SELECT 'order', o.id, round(o.refund_amount * 100)::int
  FROM public.orders o JOIN public.invoices i ON i.order_id = o.id
 WHERE COALESCE(o.refund_amount, 0) > 0 AND COALESCE(o.refunded_at, i.created_at) < now() - interval '1 hour'
ON CONFLICT DO NOTHING;

-- Le filet : jusqu'au cumul confirmé, jamais au-delà.
CREATE OR REPLACE FUNCTION public.issue_missing_credit_notes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  v_issued int := 0;
  v_failed int := 0;
  v_unconfirmed int := 0;
  v_res jsonb;
BEGIN
  FOR rec IN
    WITH d AS MATERIALIZED (SELECT public.demo_event_ids() AS de, public.demo_venue_ids() AS dv),
    s AS (
      SELECT 'ticket'::text AS kind, i.ticket_id AS sale_id, i.id AS invoice_id, i.event_id, i.venue_id, i.amount AS inv_amount,
             t.refund_amount AS reserved, COALESCE(t.refunded_at, i.created_at) AS at
        FROM public.invoices i JOIN public.tickets t ON t.id = i.ticket_id
      UNION ALL
      SELECT 'table', i.table_reservation_id, i.id, i.event_id, i.venue_id, i.amount, r.refund_amount, COALESCE(r.refunded_at, i.created_at)
        FROM public.invoices i JOIN public.table_reservations r ON r.id = i.table_reservation_id
      UNION ALL
      SELECT 'order', i.order_id, i.id, i.event_id, i.venue_id, i.amount, o.refund_amount, COALESCE(o.refunded_at, i.created_at)
        FROM public.invoices i JOIN public.orders o ON o.id = i.order_id
    )
    SELECT s.kind, s.sale_id, s.event_id,
           COALESCE((SELECT max(c.cumulative_cents) FROM public.sale_refund_confirmations c
                      WHERE c.kind = s.kind AND c.sale_id = s.sale_id), 0) AS confirmed,
           round(s.reserved * 100)::int AS reserved_cents,
           COALESCE((SELECT sum(round(n.amount * 100)) FROM public.credit_notes n WHERE n.invoice_id = s.invoice_id), 0)::int AS avoired,
           round(s.inv_amount * 100)::int AS inv_cents, s.at
      FROM s CROSS JOIN d
     WHERE COALESCE(s.reserved, 0) > 0
       AND s.at BETWEEN now() - interval '90 days' AND now() - interval '15 minutes'
       AND (s.event_id IS NULL OR NOT (s.event_id = ANY (d.de))) AND NOT (COALESCE(s.venue_id, '') = ANY (d.dv))
  LOOP
    IF rec.confirmed > rec.avoired AND rec.inv_cents > rec.avoired THEN
      BEGIN
        v_res := public.issue_credit_note(
          CASE WHEN rec.kind = 'ticket' THEN rec.sale_id END,
          CASE WHEN rec.kind = 'table' THEN rec.sale_id END,
          CASE WHEN rec.kind = 'order' THEN rec.sale_id END,
          rec.confirmed, 'sweep');
        IF v_res IS NOT NULL THEN v_issued := v_issued + 1; END IF;
      EXCEPTION WHEN OTHERS THEN
        v_failed := v_failed + 1;
        PERFORM public.emit_admin_notification(
          'admin_credit_note_failed',
          'Remboursement sans avoir',
          left(format('L''avoir du remboursement de la vente %s %s n''a pas pu être émis : %s. Le rattrapage horaire réessaie ; à vérifier si l''alerte reste.',
                      rec.kind, rec.sale_id, SQLERRM), 480),
          'high', rec.kind, rec.sale_id::text,
          jsonb_build_object('kind', rec.kind, 'sale_id', rec.sale_id, 'error', SQLERRM, 'source', 'sweep'),
          'credit_note_failed:' || rec.kind || ':' || rec.sale_id::text,
          rec.event_id);
      END;
    ELSIF rec.reserved_cents > rec.confirmed AND rec.at < now() - interval '24 hours' THEN
      -- Remboursement réservé que Stripe n'a jamais confirmé : aucun avoir. Un humain vérifie chez Stripe.
      v_unconfirmed := v_unconfirmed + 1;
      BEGIN
        PERFORM public.emit_admin_notification(
          'admin_credit_note_failed',
          'Remboursement non confirmé par Stripe',
          left(format('La vente %s %s porte un remboursement de %s € réservé depuis plus de 24 h, sans confirmation de Stripe : aucun avoir émis. À vérifier dans Stripe ; si l''argent est parti, le webhook charge.refunded ou un nouveau remboursement le confirme.',
                      rec.kind, rec.sale_id, to_char(rec.reserved_cents / 100.0, 'FM999990.00')), 480),
          'high', rec.kind, rec.sale_id::text,
          jsonb_build_object('kind', rec.kind, 'sale_id', rec.sale_id, 'reserved_cents', rec.reserved_cents, 'confirmed_cents', rec.confirmed, 'source', 'sweep'),
          'refund_unconfirmed:' || rec.kind || ':' || rec.sale_id::text,
          rec.event_id);
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('issued', v_issued, 'failed', v_failed, 'unconfirmed', v_unconfirmed);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_missing_credit_notes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_missing_credit_notes() TO service_role;
