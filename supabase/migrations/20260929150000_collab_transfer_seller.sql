-- Reçus d'un contrat collab réglé SANS Stripe : le vendeur est celui qui a
-- ENCAISSÉ. Quand l'organisateur encaisse (charge directe sur son compte), le
-- reçu téléchargé (get_event_seller) et la facture stockée
-- (save_invoice_on_creation) le nomment avec SON régime de TVA — jamais le club,
-- qui n'a rien reçu de cette vente. La part de chacun se lit sur la vente
-- (collab_split), posée au checkout : un avenant ultérieur ne réécrit pas un
-- reçu déjà émis.

CREATE OR REPLACE FUNCTION public.get_event_seller(p_event_id uuid, p_qr_code text)
 RETURNS TABLE(name text, legal_address text, siret text, rna_number text, vat_number text, vat_regime text, bde_verified boolean, logo_url text, sole_seller boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ev record;
  v_split jsonb;
BEGIN
  IF p_event_id IS NULL OR NULLIF(btrim(COALESCE(p_qr_code, '')), '') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tickets t WHERE t.qr_code = p_qr_code AND t.event_id = p_event_id)
     AND NOT EXISTS (SELECT 1 FROM public.table_reservations r WHERE r.qr_code = p_qr_code AND r.event_id = p_event_id) THEN
    RETURN;
  END IF;

  SELECT e.venue_id, e.partner_venue_id, e.organizer_user_id, e.partner_organizer_id INTO v_ev
    FROM public.events e WHERE e.id = p_event_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Contrat collab réglé SANS Stripe, encaissé par l'organisateur : la vente a
  -- été payée sur SON compte, c'est lui le vendeur du reçu (son régime de TVA),
  -- que la soirée soit menée par le club ou par lui.
  SELECT x.collab_split INTO v_split FROM (
    SELECT t.collab_split FROM public.tickets t WHERE t.qr_code = p_qr_code AND t.event_id = p_event_id
    UNION ALL
    SELECT r.collab_split FROM public.table_reservations r WHERE r.qr_code = p_qr_code AND r.event_id = p_event_id
  ) x LIMIT 1;
  IF v_split->>'mode' = 'transfer' AND v_split->>'collector' = 'organizer' THEN
    RETURN QUERY
    SELECT COALESCE(NULLIF(o.legal_name, ''), o.display_name),
           o.legal_address, o.siret, o.rna_number,
           o.vat_number, o.vat_regime, COALESCE(o.bde_verified, false), o.avatar_url,
           true
      FROM public.organizer_profiles o
     WHERE o.user_id = COALESCE(v_ev.organizer_user_id, v_ev.partner_organizer_id);
    RETURN;
  END IF;

  IF v_ev.venue_id IS NOT NULL THEN
    RETURN;
  END IF;

  IF v_ev.partner_venue_id IS NOT NULL THEN
    RETURN QUERY
    SELECT COALESCE(NULLIF(v.legal_name, ''), v.name), COALESCE(v.legal_address, v.address), v.siret, NULL::text,
           v.vat_number, 'subject'::text, false, v.logo_url, false
      FROM public.venues v WHERE v.id = v_ev.partner_venue_id;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT COALESCE(NULLIF(o.legal_name, ''), o.display_name),
         o.legal_address, o.siret, o.rna_number,
         o.vat_number, o.vat_regime, COALESCE(o.bde_verified, false), o.avatar_url,
         true
    FROM public.organizer_profiles o
   WHERE o.user_id = v_ev.organizer_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_invoice_on_creation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_items JSONB;
  v_event_title TEXT;
  v_event_start_at TIMESTAMPTZ;
  v_event_poster_url TEXT;
  v_event_venue_id TEXT;
  v_event_partner_venue_id TEXT;
  v_event_organizer_user_id UUID;
  v_event_partner_organizer_id UUID;
  v_amount NUMERIC;
  v_service_fee NUMERIC := 0;
  v_management_fee NUMERIC := 0;
  v_insurance_fee NUMERIC := 0;
  v_customer_email TEXT;
  v_customer_name TEXT;
  v_customer_phone TEXT;
  v_event_id UUID;
  v_type TEXT;
  v_qr_code TEXT;
  v_resolved_venue_id TEXT;
  v_resolved_organizer_id UUID;
  v_rate NUMERIC := 20;
  v_fees NUMERIC;
  v_total_ht NUMERIC;
  v_split JSONB;
BEGIN
  IF NEW.ticket_id IS NOT NULL THEN
    v_type := 'ticket';
    SELECT total_price, user_email, full_name, phone, event_id, service_fee, insurance_fee, qr_code, collab_split,
           jsonb_build_array(jsonb_build_object(
             'description', 'Billet',
             'quantity', COALESCE(quantity, 1),
             'unitPrice', COALESCE(unit_price, 0),
             'total', COALESCE(quantity, 1) * COALESCE(unit_price, 0)
           ))
    INTO v_amount, v_customer_email, v_customer_name, v_customer_phone, v_event_id, v_service_fee, v_insurance_fee, v_qr_code, v_split, v_items
    FROM public.tickets WHERE id = NEW.ticket_id;
  ELSIF NEW.table_reservation_id IS NOT NULL THEN
    v_type := 'table';
    SELECT total_price, user_email, full_name, phone, event_id, service_fee, management_fee, qr_code, collab_split,
           jsonb_build_array(jsonb_build_object(
             'description', 'Table VIP',
             'quantity', 1,
             'unitPrice', COALESCE(deposit, 0),
             'total', COALESCE(deposit, 0)
           ))
    INTO v_amount, v_customer_email, v_customer_name, v_customer_phone, v_event_id, v_service_fee, v_management_fee, v_qr_code, v_split, v_items
    FROM public.table_reservations WHERE id = NEW.table_reservation_id;
  ELSIF NEW.order_id IS NOT NULL THEN
    v_type := 'order';
    SELECT total, user_email, event_id, token, items
    INTO v_amount, v_customer_email, v_event_id, v_qr_code, v_items
    FROM public.orders WHERE id = NEW.order_id;
  ELSE
    RETURN NEW;
  END IF;

  IF v_event_id IS NOT NULL THEN
    SELECT title, start_at, poster_url, venue_id, partner_venue_id, organizer_user_id, partner_organizer_id
    INTO v_event_title, v_event_start_at, v_event_poster_url,
         v_event_venue_id, v_event_partner_venue_id, v_event_organizer_user_id, v_event_partner_organizer_id
    FROM public.events WHERE id = v_event_id;
  END IF;

  v_resolved_venue_id := COALESCE(NEW.venue_id, v_event_venue_id, v_event_partner_venue_id);
  v_resolved_organizer_id := COALESCE(NEW.organizer_user_id, v_event_organizer_user_id, v_event_partner_organizer_id);

  v_amount := COALESCE(v_amount, 0);
  -- Vendeur = qui a ENCAISSÉ : l'organisateur seul, ou l'organisateur encaisseur
  -- d'un contrat collab réglé sans Stripe (collab_split posé au checkout).
  IF v_resolved_organizer_id IS NOT NULL AND (v_resolved_venue_id IS NULL
     OR (v_split->>'mode' = 'transfer' AND v_split->>'collector' = 'organizer')) THEN
    v_rate := public.organizer_vat_rate(v_resolved_organizer_id);
  END IF;
  IF v_rate = 20 THEN
    v_total_ht := v_amount / 1.2;
  ELSE
    v_fees := COALESCE(v_service_fee, 0) + COALESCE(v_management_fee, 0) + COALESCE(v_insurance_fee, 0);
    v_total_ht := GREATEST(0, v_amount - v_fees) / (1 + v_rate / 100) + v_fees / 1.2;
  END IF;

  INSERT INTO public.invoices (
    venue_id, organizer_user_id, invoice_number, type,
    amount, total_ht, tva,
    service_fee, management_fee, insurance_fee,
    customer_email, customer_name, customer_phone,
    event_id, event_name, event_date, event_poster,
    ticket_id, table_reservation_id, order_id,
    items, qr_code
  ) VALUES (
    v_resolved_venue_id, v_resolved_organizer_id, NEW.invoice_number, v_type,
    v_amount,
    v_total_ht,
    v_amount - v_total_ht,
    v_service_fee, v_management_fee, v_insurance_fee,
    COALESCE(v_customer_email, ''), v_customer_name, v_customer_phone,
    v_event_id, v_event_title, v_event_start_at, v_event_poster_url,
    NEW.ticket_id, NEW.table_reservation_id, NEW.order_id,
    v_items, v_qr_code
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;
