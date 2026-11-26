-- Tables VIP, vague C2 — D15 : filet horaire des avoirs, avoirs lisibles dans la Compta, alerte d'échec.
--
--  • issue_missing_credit_notes() : toute vente AVEC facture dont le cumul remboursé dépasse ce qui est avoiré, remboursée depuis plus de
--    15 minutes (un remboursement réserve refund_amount avant Stripe puis le rend si Stripe refuse : ce délai laisse l'éventuel rollback
--    se faire avant qu'un avoir immuable ne soit émis), sur 90 jours. Chaque vente dans sa sous-transaction ; un échec lève une alerte
--    super admin dédupliquée (`credit_note_failed:<vente>`) et n'arrête pas les autres. Jamais bloquant pour un remboursement.
--  • issue_missing_invoices() l'appelle en fin de passage (même cron `issue-missing-invoices`, pas de nouveau job).
--  • get_accounting_credit_notes() : les avoirs de la portée (même périmètre de soirées que get_accounting_invoices), pour la Compta.

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
  v_res jsonb;
BEGIN
  FOR rec IN
    WITH d AS MATERIALIZED (SELECT public.demo_event_ids() AS de, public.demo_venue_ids() AS dv)
    SELECT 'ticket'::text AS kind, i.ticket_id AS sale_id, i.event_id
      FROM public.invoices i JOIN public.tickets t ON t.id = i.ticket_id CROSS JOIN d
     WHERE COALESCE(t.refund_amount, 0) > 0
       AND round(t.refund_amount * 100) > (SELECT COALESCE(sum(round(c.amount * 100)), 0) FROM public.credit_notes c WHERE c.invoice_id = i.id)
       AND round(i.amount * 100) > (SELECT COALESCE(sum(round(c.amount * 100)), 0) FROM public.credit_notes c WHERE c.invoice_id = i.id)
       AND COALESCE(t.refunded_at, i.created_at) BETWEEN now() - interval '90 days' AND now() - interval '15 minutes'
       AND NOT (i.event_id = ANY (d.de)) AND NOT (COALESCE(i.venue_id, '') = ANY (d.dv))
    UNION ALL
    SELECT 'table', i.table_reservation_id, i.event_id
      FROM public.invoices i JOIN public.table_reservations r ON r.id = i.table_reservation_id CROSS JOIN d
     WHERE COALESCE(r.refund_amount, 0) > 0
       AND round(r.refund_amount * 100) > (SELECT COALESCE(sum(round(c.amount * 100)), 0) FROM public.credit_notes c WHERE c.invoice_id = i.id)
       AND round(i.amount * 100) > (SELECT COALESCE(sum(round(c.amount * 100)), 0) FROM public.credit_notes c WHERE c.invoice_id = i.id)
       AND COALESCE(r.refunded_at, i.created_at) BETWEEN now() - interval '90 days' AND now() - interval '15 minutes'
       AND (i.event_id IS NULL OR NOT (i.event_id = ANY (d.de))) AND NOT (COALESCE(i.venue_id, '') = ANY (d.dv))
    UNION ALL
    SELECT 'order', i.order_id, i.event_id
      FROM public.invoices i JOIN public.orders o ON o.id = i.order_id CROSS JOIN d
     WHERE COALESCE(o.refund_amount, 0) > 0
       AND round(o.refund_amount * 100) > (SELECT COALESCE(sum(round(c.amount * 100)), 0) FROM public.credit_notes c WHERE c.invoice_id = i.id)
       AND round(i.amount * 100) > (SELECT COALESCE(sum(round(c.amount * 100)), 0) FROM public.credit_notes c WHERE c.invoice_id = i.id)
       AND COALESCE(o.refunded_at, i.created_at) BETWEEN now() - interval '90 days' AND now() - interval '15 minutes'
       AND (i.event_id IS NULL OR NOT (i.event_id = ANY (d.de))) AND NOT (COALESCE(i.venue_id, '') = ANY (d.dv))
  LOOP
    BEGIN
      v_res := public.issue_credit_note(
        CASE WHEN rec.kind = 'ticket' THEN rec.sale_id END,
        CASE WHEN rec.kind = 'table' THEN rec.sale_id END,
        CASE WHEN rec.kind = 'order' THEN rec.sale_id END,
        NULL, 'sweep');
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
  END LOOP;
  RETURN jsonb_build_object('issued', v_issued, 'failed', v_failed);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_missing_credit_notes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_missing_credit_notes() TO service_role;

-- Reprise de la définition vivante de la prod ; seule la fin de passage change.
CREATE OR REPLACE FUNCTION public.issue_missing_invoices()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec record;
  v_issued int := 0;
  v_failed int := 0;
  v_number text;
  v_credit jsonb;
BEGIN
  FOR rec IN
    WITH d AS MATERIALIZED (SELECT public.demo_event_ids() AS de, public.demo_venue_ids() AS dv)
    SELECT 'ticket'::text AS kind, t.id, t.event_id
      FROM public.tickets t CROSS JOIN d
     WHERE t.status IN ('paid', 'used')
       AND t.stripe_session_id IS NOT NULL
       AND COALESCE(t.total_price, 0) > 0
       AND COALESCE(t.paid_at, t.created_at) BETWEEN now() - interval '90 days' AND now() - interval '10 minutes'
       AND NOT (t.event_id = ANY (d.de))
       AND NOT EXISTS (SELECT 1 FROM public.invoice_numbers n WHERE n.ticket_id = t.id)
    UNION ALL
    SELECT 'table', r.id, r.event_id
      FROM public.table_reservations r CROSS JOIN d
     WHERE r.status IN ('paid', 'confirmed')
       AND r.stripe_session_id IS NOT NULL
       AND COALESCE(r.payment_mode, '') <> 'on_site'
       AND COALESCE(r.paid_at, r.created_at) BETWEEN now() - interval '90 days' AND now() - interval '10 minutes'
       AND (r.event_id IS NULL OR NOT (r.event_id = ANY (d.de)))
       AND NOT EXISTS (SELECT 1 FROM public.invoice_numbers n WHERE n.table_reservation_id = r.id)
    UNION ALL
    SELECT 'order', o.id, o.event_id
      FROM public.orders o CROSS JOIN d
     WHERE o.status IN ('paid', 'served')
       AND o.stripe_session_id IS NOT NULL
       AND COALESCE(o.paid_at, o.created_at) BETWEEN now() - interval '90 days' AND now() - interval '10 minutes'
       AND NOT (COALESCE(o.venue_id, '') = ANY (d.dv))
       AND NOT EXISTS (SELECT 1 FROM public.invoice_numbers n WHERE n.order_id = o.id)
  LOOP
    BEGIN
      v_number := public.issue_sale_invoice(
        CASE WHEN rec.kind = 'ticket' THEN rec.id END,
        CASE WHEN rec.kind = 'table' THEN rec.id END,
        CASE WHEN rec.kind = 'order' THEN rec.id END);
      v_issued := v_issued + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      PERFORM public.emit_admin_notification(
        'admin_invoice_failed',
        'Vente payée sans facture',
        left(format('La facture de la vente %s %s n''a pas pu être émise : %s. Le rattrapage horaire réessaie ; à vérifier si l''alerte reste.',
                    rec.kind, rec.id, SQLERRM), 480),
        'high', rec.kind, rec.id::text,
        jsonb_build_object('kind', rec.kind, 'sale_id', rec.id, 'error', SQLERRM, 'source', 'sweep'),
        'invoice_failed:' || rec.kind || ':' || rec.id::text,
        rec.event_id);
    END;
  END LOOP;

  -- Filet des avoirs (D15) : mêmes passage et même cron. Ne lève jamais.
  BEGIN
    v_credit := public.issue_missing_credit_notes();
  EXCEPTION WHEN OTHERS THEN
    v_credit := jsonb_build_object('error', SQLERRM);
  END;

  RETURN jsonb_build_object('issued', v_issued, 'failed', v_failed, 'credit_notes', COALESCE(v_credit, '{}'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_missing_invoices() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_missing_invoices() TO service_role;

-- Compta : les avoirs de la portée. Même périmètre de soirées que get_accounting_invoices ; la RLS des avoirs s'applique (INVOKER).
CREATE OR REPLACE FUNCTION public.get_accounting_credit_notes(
  p_venue_id text DEFAULT NULL::text,
  p_organizer_user_id uuid DEFAULT NULL::uuid,
  p_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  WITH ev AS MATERIALIZED (
    SELECT e.id
    FROM events e
    WHERE (p_venue_id IS NOT NULL
           AND ((e.venue_id = p_venue_id AND e.external_source IS NULL) OR e.partner_venue_id = p_venue_id))
       OR (p_organizer_user_id IS NOT NULL
           AND ((e.organizer_user_id = p_organizer_user_id AND e.external_source IS NULL) OR e.partner_organizer_id = p_organizer_user_id))
  )
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', c.id, 'credit_number', c.credit_number, 'created_at', c.created_at,
      'type', c.kind, 'amount', c.amount, 'total_ht', c.total_ht, 'tva', c.tva,
      'event_id', c.event_id, 'event_name', c.event_name,
      'customer_name', c.customer_name, 'customer_email', c.customer_email,
      'invoice_id', c.invoice_id, 'invoice_number', i.invoice_number,
      'ticket_id', c.ticket_id, 'table_reservation_id', c.table_reservation_id, 'order_id', c.order_id,
      'reason', c.reason)) ORDER BY c.created_at DESC, c.id), '[]'::jsonb)
  FROM credit_notes c
  JOIN invoices i ON i.id = c.invoice_id
  WHERE c.event_id IN (SELECT ev.id FROM ev)
    AND (p_from IS NULL OR c.created_at >= p_from)
    AND (p_to IS NULL OR c.created_at <= p_to);
$fn$;
REVOKE ALL ON FUNCTION public.get_accounting_credit_notes(text, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_accounting_credit_notes(text, uuid, timestamptz, timestamptz) TO authenticated, service_role;
