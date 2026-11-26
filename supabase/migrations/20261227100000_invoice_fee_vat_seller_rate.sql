-- Tables VIP, vague C2 — D14 : la TVA de la ligne « Frais de service » d'une facture d'acompte suit le vendeur quand il ABSORBE les frais.
--
-- Constat (vague-A-revue M2) : `20261225160000` / `220000` calculaient total_ht = acompte / (1 + taux du vendeur) + frais / 1,2. En mode « frais
-- absorbés » la ligne de frais est le remboursement, par le client, des frais Stripe que le VENDEUR a payés (la commission Yuno est prise à part en
-- application_fee) : elle n'est pas un frais Yuno. Pour un vendeur en franchise (293 B) ou une association exonérée, 20 % de TVA y était faux.
-- Décision de Paul (D14, 26/11) : taux du vendeur (20 % / 0 %), comme l'acompte. Hors frais absorbés, la ligne reste un frais Yuno à 20 %.
--
-- La facture porte désormais les taux qu'elle a appliqués (`vat_rate` : articles, `fee_vat_rate` : frais). Les avoirs (migration suivante) les
-- reprennent : un avoir garde le régime de la facture même si le vendeur change de régime ensuite. Les factures déjà émises ne changent pas (NULL :
-- l'avoir retombe sur le régime actuel du vendeur et 20 % pour les frais).
-- Reprise de la définition VIVANTE de la prod au 26/11 ; seuls changent v_fee_rate et les deux colonnes écrites.

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS vat_rate numeric;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS fee_vat_rate numeric;

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
  v_seller TEXT;
  -- Facture d'acompte d'une table : ce que Stripe a réellement encaissé en ligne.
  v_tbl_total NUMERIC := 0;
  v_tbl_deposit NUMERIC := 0;
  v_tbl_fee_absorbed BOOLEAN := false;
  v_tbl_pack_id UUID;
  v_tbl_pack_name TEXT;
  v_tbl_fee_line NUMERIC := 0;
  v_tbl_remaining NUMERIC := 0;
  v_tbl_charged_lines JSONB;
  v_tbl_charged_total NUMERIC;
  v_invoice_kind TEXT;
  v_remaining_on_site NUMERIC;
  v_fee_rate NUMERIC := 20;   -- taux de la ligne de frais (D14)
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
           COALESCE(deposit, 0), COALESCE(fee_absorbed, false), pack_id, charged_lines, charged_total
    INTO v_tbl_total, v_customer_email, v_customer_name, v_customer_phone, v_event_id, v_service_fee, v_management_fee, v_qr_code, v_split,
         v_tbl_deposit, v_tbl_fee_absorbed, v_tbl_pack_id, v_tbl_charged_lines, v_tbl_charged_total
    FROM public.table_reservations WHERE id = NEW.table_reservation_id;
    SELECT name INTO v_tbl_pack_name FROM public.table_packs WHERE id = v_tbl_pack_id;

    IF v_tbl_charged_lines IS NOT NULL AND v_tbl_charged_total IS NOT NULL THEN
      -- Source unique : les montants posés au checkout, ceux de la session Stripe (centimes). Jamais recalculés ici.
      SELECT COALESCE(sum((l->>'cents')::numeric) FILTER (WHERE l->>'kind' = 'deposit'), 0) / 100.0,
             COALESCE(sum((l->>'cents')::numeric) FILTER (WHERE l->>'kind' = 'fee'), 0) / 100.0
        INTO v_tbl_deposit, v_tbl_fee_line
        FROM jsonb_array_elements(v_tbl_charged_lines) l;
      v_amount := round(v_tbl_charged_total, 2);
    ELSE
      -- Réservation sans montants stockés (démo, ancienne) : estimation d'avant. Ligne « Frais de service » de la session Stripe =
      -- les frais de gestion, ou — quand le club les absorbe — l'estimation des frais Stripe que le client prend à sa charge.
      v_tbl_fee_line := CASE
        WHEN v_tbl_fee_absorbed THEN
          CASE WHEN v_tbl_deposit > 0 THEN round((v_tbl_deposit * 0.015 + 0.25) / (1 - 0.015), 2) ELSE 0 END
        ELSE COALESCE(v_management_fee, 0)
      END;
      v_amount := round(v_tbl_deposit + v_tbl_fee_line, 2);
    END IF;

    v_tbl_remaining := GREATEST(round(COALESCE(v_tbl_total, 0) - v_tbl_deposit, 2), 0);
    IF v_tbl_remaining > 0 THEN
      v_invoice_kind := 'deposit';
      v_remaining_on_site := v_tbl_remaining;
    END IF;
    v_items := '[]'::jsonb;
    IF v_tbl_deposit > 0 THEN
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'kind', CASE WHEN v_tbl_remaining > 0 THEN 'deposit' ELSE 'table' END,
        'description', CASE WHEN v_tbl_remaining > 0 THEN 'Acompte table ' ELSE 'Table VIP ' END || COALESCE(NULLIF(btrim(v_tbl_pack_name), ''), 'VIP'),
        'quantity', 1,
        'unitPrice', v_tbl_deposit,
        'total', v_tbl_deposit
      ));
    END IF;
    IF v_tbl_fee_line > 0 THEN
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'kind', 'fee',
        'description', 'Frais de service',
        'quantity', 1,
        'unitPrice', v_tbl_fee_line,
        'total', v_tbl_fee_line
      ));
    END IF;
    -- Les frais sont des lignes de `items` : les colonnes de frais de la facture restent à 0 pour une table (aucune lecture
    -- ne peut les compter une seconde fois).
    v_service_fee := 0;
    v_management_fee := 0;
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
  -- Posé par assign_invoice_number ; la règle d'avant reste le repli.
  v_seller := COALESCE(NEW.seller_kind,
                       public._invoice_seller_kind(v_resolved_venue_id, v_resolved_organizer_id, v_split));
  IF v_seller = 'organizer' AND v_resolved_organizer_id IS NOT NULL THEN
    v_rate := public.organizer_vat_rate(v_resolved_organizer_id);
  END IF;
  IF v_type = 'table' THEN
    -- Acompte au taux du vendeur. Ligne « Frais de service » : quand le vendeur ABSORBE les frais, elle lui rembourse les frais Stripe
    -- qu'il a payés (la commission Yuno est prise à part) : même taux que l'acompte (20 % / franchise 293 B 0 % / association 0 %,
    -- D14 du 26/11). Sinon ce sont des frais Yuno : 20 %, comme ceux des billets et des commandes.
    v_fee_rate := CASE WHEN v_tbl_fee_absorbed THEN v_rate ELSE 20 END;
    v_total_ht := v_tbl_deposit / (1 + v_rate / 100) + v_tbl_fee_line / (1 + v_fee_rate / 100);
  ELSIF v_rate = 20 THEN
    v_total_ht := v_amount / 1.2;
  ELSE
    v_fees := COALESCE(v_service_fee, 0) + COALESCE(v_management_fee, 0) + COALESCE(v_insurance_fee, 0);
    v_total_ht := GREATEST(0, v_amount - v_fees) / (1 + v_rate / 100) + v_fees / 1.2;
  END IF;

  INSERT INTO public.invoices (
    venue_id, organizer_user_id, invoice_number, type, seller_kind,
    amount, total_ht, tva,
    service_fee, management_fee, insurance_fee,
    customer_email, customer_name, customer_phone,
    event_id, event_name, event_date, event_poster,
    ticket_id, table_reservation_id, order_id,
    items, qr_code, invoice_kind, remaining_on_site, vat_rate, fee_vat_rate
  ) VALUES (
    v_resolved_venue_id, v_resolved_organizer_id, NEW.invoice_number, v_type, v_seller,
    v_amount,
    v_total_ht,
    v_amount - v_total_ht,
    v_service_fee, v_management_fee, v_insurance_fee,
    COALESCE(v_customer_email, ''), v_customer_name, v_customer_phone,
    v_event_id, v_event_title, v_event_start_at, v_event_poster_url,
    NEW.ticket_id, NEW.table_reservation_id, NEW.order_id,
    v_items, v_qr_code, v_invoice_kind, v_remaining_on_site, v_rate, v_fee_rate
  );

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_invoice_on_creation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_invoice_on_creation() TO service_role;
