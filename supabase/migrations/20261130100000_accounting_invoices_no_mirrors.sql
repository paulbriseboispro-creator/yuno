-- Compta : la lecture unique des factures (get_accounting_invoices, migration
-- 20261106100000) écarte les soirées MIROIR du CRM (Shotgun), comme le faisait
-- la page avant elle (orgOwnEventsOr / venueOwnEventsOr, commit 33013c03) :
-- une soirée menée ne compte que si external_source IS NULL. Branche partenaire
-- inchangée. Corps repris de la définition en prod ; rien d'autre ne change.

CREATE OR REPLACE FUNCTION public.get_accounting_invoices(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH ev AS MATERIALIZED (
    SELECT e.id, e.title, e.start_at, e.event_mode, e.revenue_split_rules,
           e.venue_id, e.partner_venue_id, e.organizer_user_id,
           e.partner_organizer_id, e.is_bde
    FROM events e
    WHERE (p_venue_id IS NOT NULL
           AND ((e.venue_id = p_venue_id AND e.external_source IS NULL)
                OR e.partner_venue_id = p_venue_id))
       OR (p_organizer_user_id IS NOT NULL
           AND ((e.organizer_user_id = p_organizer_user_id AND e.external_source IS NULL)
                OR e.partner_organizer_id = p_organizer_user_id))
  ),
  inv AS MATERIALIZED (
    SELECT i.id, i.type, i.amount, i.event_id, i.event_name, i.customer_name,
           i.customer_email, i.invoice_number, i.created_at, i.items,
           i.ticket_id, i.table_reservation_id, i.order_id
    FROM invoices i
    WHERE i.event_id IN (SELECT ev.id FROM ev)
      AND (p_from IS NULL OR i.created_at >= p_from)
      AND (p_to IS NULL OR i.created_at <= p_to)
  ),
  rows AS (
    -- Clés nulles retirées : la page lit une clé absente comme null.
    SELECT i.created_at, i.id,
      jsonb_strip_nulls(jsonb_build_object(
        'id', i.id,
        'type', i.type,
        'amount', i.amount,
        'event_id', i.event_id,
        'event_name', i.event_name,
        'customer_name', i.customer_name,
        'customer_email', i.customer_email,
        'invoice_number', i.invoice_number,
        'created_at', i.created_at,
        -- Seule une commande garde le détail de ses lignes (une boisson par
        -- ligne) ; billets et tables se rangent sous le nom du tarif.
        'items', CASE WHEN i.type = 'order' THEN i.items END,
        'ticket_id', i.ticket_id,
        'table_reservation_id', i.table_reservation_id,
        'order_id', i.order_id,
        -- La vente facturée, dans l'ordre billet › table › commande (même
        -- ordre que txnId côté front). NULL quand la RLS de l'appelant ne la
        -- montre pas : le front retombe alors sur l'estimation, comme avant.
        'sale', CASE
          WHEN t.id IS NOT NULL THEN jsonb_build_object(
            'refund_amount', t.refund_amount,
            'service_fee', t.service_fee,
            'insurance_fee', t.insurance_fee,
            'label', COALESCE(NULLIF(r.name, ''), NULLIF(t.ticket_type, '')),
            'qty', t.quantity)
          WHEN tr.id IS NOT NULL THEN jsonb_build_object(
            'refund_amount', tr.refund_amount,
            'service_fee', tr.service_fee,
            'management_fee', tr.management_fee,
            'fee_absorbed', tr.fee_absorbed,
            'label', NULLIF(tp.name, ''),
            'qty', 1)
          WHEN o.id IS NOT NULL THEN jsonb_build_object(
            'refund_amount', o.refund_amount,
            'service_fee', o.service_fee)
        END
      )) AS j
    FROM inv i
    LEFT JOIN tickets t ON t.id = i.ticket_id
    LEFT JOIN ticket_rounds r ON r.id = t.ticket_round_id
    LEFT JOIN table_reservations tr ON tr.id = i.table_reservation_id
    LEFT JOIN table_packs tp ON tp.id = tr.pack_id
    LEFT JOIN orders o ON o.id = i.order_id
  )
  SELECT jsonb_build_object(
    'events', COALESCE((
      SELECT jsonb_agg(to_jsonb(ev) ORDER BY ev.start_at DESC NULLS LAST)
      FROM ev
      WHERE ev.id IN (SELECT inv.event_id FROM inv)
    ), '[]'::jsonb),
    'invoices', COALESCE((
      SELECT jsonb_agg(rows.j ORDER BY rows.created_at DESC, rows.id)
      FROM rows
    ), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.get_accounting_invoices(text, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_accounting_invoices(text, uuid, timestamptz, timestamptz) TO authenticated;
