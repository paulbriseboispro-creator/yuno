-- Tables VIP, vague A bis — B1 / M1 / I4 : ce que le client a RÉELLEMENT payé, une seule source pour les lignes de la facture,
-- et un secret de reçu pour la page de retour de paiement.
--
-- M1 (relecture) : la facture et l'e-mail « Payé en ligne » RECALCULAIENT la ligne de frais (SQL numeric contre JS flottant, ±1 centime,
-- et toute évolution de la formule TS désalignait la facture). create-table-checkout écrit désormais, AVANT la session Stripe, ce que la
-- session va prélever : `charged_lines` = [{"kind":"deposit"|"fee","cents":N}, …] (les `unit_amount` envoyés à Stripe, en centimes) et
-- `charged_total` = leur somme en euros. Facture, e-mail et repli d'annulation les LISENT ; une réservation sans ces colonnes (démo,
-- ancienne, sur place) garde le comportement d'avant (estimation).
--
-- B1 (relecture) : pour une table, le trigger écrivait items = [Acompte, Frais de service] ET recopiait `management_fee` dans
-- invoices.management_fee ; le PDF dessinait chaque item PUIS une ligne « Frais de gestion » : frais comptés deux fois, et des frais de
-- gestion que le client n'a pas payés en mode « frais absorbés ». Désormais les lignes d'une facture de table vivent TOUTES dans `items`
-- (chaque item porte un `kind` : deposit | table | fee) et invoices.service_fee / management_fee valent 0 pour une table : aucune lecture
-- ne peut les compter une seconde fois. total_ht / tva restent calculés ici (taux du vendeur sur l'acompte, 20 % sur la ligne de frais).
--
-- I4 (relecture) : verify-table-payment rendait le QR de la table à quiconque détenait session_id + reservation_id (tous deux dans l'URL
-- de retour de Stripe, donc dans les journaux des outils de mesure). `receipt_token_hash` = SHA-256 d'un jeton aléatoire que
-- create-table-checkout renvoie au navigateur de l'acheteur (jamais dans une URL) ; verify-table-payment ne rend le QR qu'avec ce jeton.
--
-- Les trois colonnes sont protégées contre l'écriture client (protect_table_reservation_immutable_fields, définition de 20261225180000 + 3 lignes).

ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS charged_lines jsonb;
ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS charged_total numeric;
ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS receipt_token_hash text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'table_reservations_charged_lines_check') THEN
    ALTER TABLE public.table_reservations
      ADD CONSTRAINT table_reservations_charged_lines_check
      CHECK (charged_lines IS NULL OR jsonb_typeof(charged_lines) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'table_reservations_charged_total_check') THEN
    ALTER TABLE public.table_reservations
      ADD CONSTRAINT table_reservations_charged_total_check
      CHECK (charged_total IS NULL OR charged_total >= 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.protect_table_reservation_immutable_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.status                      IS DISTINCT FROM OLD.status
       OR NEW.total_price              IS DISTINCT FROM OLD.total_price
       OR NEW.service_fee              IS DISTINCT FROM OLD.service_fee
       OR NEW.deposit                  IS DISTINCT FROM OLD.deposit
       OR NEW.management_fee           IS DISTINCT FROM OLD.management_fee
       OR NEW.fee_absorbed             IS DISTINCT FROM OLD.fee_absorbed
       OR NEW.paid_at                  IS DISTINCT FROM OLD.paid_at
       OR NEW.stripe_session_id        IS DISTINCT FROM OLD.stripe_session_id
       OR NEW.stripe_payment_intent_id IS DISTINCT FROM OLD.stripe_payment_intent_id
       OR NEW.stripe_connected_account_id IS DISTINCT FROM OLD.stripe_connected_account_id
       OR NEW.refund_amount            IS DISTINCT FROM OLD.refund_amount
       OR NEW.refund_reason            IS DISTINCT FROM OLD.refund_reason
       OR NEW.refunded_at              IS DISTINCT FROM OLD.refunded_at
       OR NEW.refunded_by              IS DISTINCT FROM OLD.refunded_by
       OR NEW.user_id                  IS DISTINCT FROM OLD.user_id
       OR NEW.user_email               IS DISTINCT FROM OLD.user_email
       OR NEW.event_id                 IS DISTINCT FROM OLD.event_id
       OR NEW.zone_id                  IS DISTINCT FROM OLD.zone_id
       OR NEW.pack_id                  IS DISTINCT FROM OLD.pack_id
       OR NEW.table_id                 IS DISTINCT FROM OLD.table_id
       OR NEW.is_guest                 IS DISTINCT FROM OLD.is_guest
       OR NEW.claimed_at               IS DISTINCT FROM OLD.claimed_at
       OR NEW.claimed_by_user_id       IS DISTINCT FROM OLD.claimed_by_user_id
       OR NEW.qr_code                  IS DISTINCT FROM OLD.qr_code
       OR NEW.reference_code           IS DISTINCT FROM OLD.reference_code
       OR NEW.tracked_link_id          IS DISTINCT FROM OLD.tracked_link_id
       OR NEW.purchase_source          IS DISTINCT FROM OLD.purchase_source
       -- Surclassement / différence à régler sur place : posés par vip_set_table_placement seulement.
       OR NEW.placement_adjustment        IS DISTINCT FROM OLD.placement_adjustment
       OR NEW.placement_adjustment_amount IS DISTINCT FROM OLD.placement_adjustment_amount
       -- Montants réellement prélevés et secret de reçu : posés par create-table-checkout (clé service) seulement.
       OR NEW.charged_lines            IS DISTINCT FROM OLD.charged_lines
       OR NEW.charged_total            IS DISTINCT FROM OLD.charged_total
       OR NEW.receipt_token_hash       IS DISTINCT FROM OLD.receipt_token_hash THEN
      RAISE EXCEPTION 'table_reservations: financial and identity fields are immutable for non-service roles'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- Un scan d'entrée consommé ne se ré-ouvre jamais (même règle que
    -- orders.token_used) : pas de double entrée sur le même QR.
    IF OLD.entry_scanned = true AND NEW.entry_scanned = false THEN
      RAISE EXCEPTION 'table_reservations: entry_scanned cannot be reset'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── Facture : une seule source pour les lignes d'une table ─────────────────────────────────────────────────────────────
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
