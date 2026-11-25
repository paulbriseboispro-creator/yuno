-- Tables VIP, vague A — P2.3 (D5) : la facture d'une table est une FACTURE D'ACOMPTE.
--
-- Constat (audit 2) : la facture d'une table portait `total_price` (le prix de la table, que le client ne paie qu'en partie en ligne,
-- frais de service NON compris) alors que Stripe encaisse « acompte + frais de service » (create-table-checkout : une ligne
-- « <formule> - <soirée> » = l'acompte remisé, une ligne « Frais de service » = frais de gestion, ou l'estimation des frais Stripe quand
-- le club les absorbe). La facture et le relevé de carte ne disaient pas la même chose.
--
-- Désormais, pour une table : montant = acompte + ligne de frais (exactement ce que la session Stripe porte), TVA sur ce montant (taux du
-- vendeur sur l'acompte — règle existante : club 20 %, organisateur organizer_vat_rate — ; frais de service toujours à 20 %), items =
-- « Acompte table <formule> » + « Frais de service ». Quand il reste un solde (total − acompte > 0), la facture porte
-- invoice_kind = 'deposit' et remaining_on_site = ce solde, HORS total (le PDF le montre en ligne d'information). Paiement intégral :
-- items « Table VIP <formule> », invoice_kind NULL, remaining_on_site NULL. Billets et commandes : inchangés.
-- Mesuré le 24/11 : 131 factures de table, toutes démo (rien à rattraper).
-- Colonnes ajoutées à `invoices` (nullables, sans valeur par défaut) : invoice_kind text, remaining_on_site numeric.

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS invoice_kind text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS remaining_on_site numeric;

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
  v_invoice_kind TEXT;
  v_remaining_on_site NUMERIC;
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
           COALESCE(deposit, 0), COALESCE(fee_absorbed, false), pack_id
    INTO v_tbl_total, v_customer_email, v_customer_name, v_customer_phone, v_event_id, v_service_fee, v_management_fee, v_qr_code, v_split,
         v_tbl_deposit, v_tbl_fee_absorbed, v_tbl_pack_id
    FROM public.table_reservations WHERE id = NEW.table_reservation_id;
    SELECT name INTO v_tbl_pack_name FROM public.table_packs WHERE id = v_tbl_pack_id;
    -- Ligne « Frais de service » de la session Stripe (create-table-checkout) : les frais de gestion, ou — quand le club les
    -- absorbe — l'estimation des frais Stripe que le client prend à sa charge (estimateStripeFeeEur : (acompte × 1,5 % + 0,25 €) / (1 − 1,5 %)).
    v_tbl_fee_line := CASE
      WHEN v_tbl_fee_absorbed THEN
        CASE WHEN v_tbl_deposit > 0 THEN round((v_tbl_deposit * 0.015 + 0.25) / (1 - 0.015), 2) ELSE 0 END
      ELSE COALESCE(v_management_fee, 0)
    END;
    v_amount := round(v_tbl_deposit + v_tbl_fee_line, 2);
    v_tbl_remaining := GREATEST(round(COALESCE(v_tbl_total, 0) - v_tbl_deposit, 2), 0);
    IF v_tbl_remaining > 0 THEN
      v_invoice_kind := 'deposit';
      v_remaining_on_site := v_tbl_remaining;
    END IF;
    v_items := '[]'::jsonb;
    IF v_tbl_deposit > 0 THEN
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'description', CASE WHEN v_tbl_remaining > 0 THEN 'Acompte table ' ELSE 'Table VIP ' END || COALESCE(NULLIF(btrim(v_tbl_pack_name), ''), 'VIP'),
        'quantity', 1,
        'unitPrice', v_tbl_deposit,
        'total', v_tbl_deposit
      ));
    END IF;
    IF v_tbl_fee_line > 0 THEN
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'description', 'Frais de service',
        'quantity', 1,
        'unitPrice', v_tbl_fee_line,
        'total', v_tbl_fee_line
      ));
    END IF;
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
    -- Acompte au taux du vendeur, frais de service à 20 % (comme les frais Yuno des billets et des commandes).
    v_total_ht := v_tbl_deposit / (1 + v_rate / 100) + v_tbl_fee_line / 1.2;
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
    items, qr_code, invoice_kind, remaining_on_site
  ) VALUES (
    v_resolved_venue_id, v_resolved_organizer_id, NEW.invoice_number, v_type, v_seller,
    v_amount,
    v_total_ht,
    v_amount - v_total_ht,
    v_service_fee, v_management_fee, v_insurance_fee,
    COALESCE(v_customer_email, ''), v_customer_name, v_customer_phone,
    v_event_id, v_event_title, v_event_start_at, v_event_poster_url,
    NEW.ticket_id, NEW.table_reservation_id, NEW.order_id,
    v_items, v_qr_code, v_invoice_kind, v_remaining_on_site
  );

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_invoice_on_creation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_invoice_on_creation() TO service_role;
