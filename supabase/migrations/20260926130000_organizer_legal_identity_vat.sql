-- =====================================================================
-- Identité légale d'un organisateur : RNA, régime de TVA, vendeur des reçus
-- =====================================================================
-- Constaté en préparant l'arrivée d'une association (Amiens, soirée dans un
-- club hors Yuno, billets + tables) :
--   • tous les reçus et factures portaient 20 % de TVA, sans réglage possible.
--     Une association non assujettie qui AFFICHE de la TVA la doit (CGI art.
--     283-3) ;
--   • le reçu téléchargé depuis la page de confirmation d'une soirée SANS club
--     nommait « Yuno » comme vendeur (il ne lisait que `venues`) ;
--   • aucun champ pour le n° RNA d'une association.
--
-- Règle (miroir front + edge : `resolveVatRegime` / `sellerVat`,
-- supabase/functions/_shared/pdf-documents.ts) :
--   vat_regime = 'subject'            → 20 %
--   vat_regime = 'franchise'          → 0 %, « TVA non applicable, art. 293 B du CGI »
--   vat_regime = 'exempt_association' → 0 %, « TVA non applicable, art. 261-7-1° du CGI »
--   vat_regime NULL                   → association (bde_verified) : exonérée ;
--                                       tout autre organisateur : 20 % (inchangé)
-- Les frais de service et l'assurance restent à 20 % : prestations de Yuno.
-- Un club (venues) n'est pas concerné : 20 % comme avant.

ALTER TABLE public.organizer_profiles
  ADD COLUMN IF NOT EXISTS rna_number text,
  ADD COLUMN IF NOT EXISTS vat_regime text;

ALTER TABLE public.organizer_profiles
  DROP CONSTRAINT IF EXISTS organizer_profiles_rna_number_format,
  ADD CONSTRAINT organizer_profiles_rna_number_format
    CHECK (rna_number IS NULL OR rna_number ~ '^W[0-9]{9}$');

ALTER TABLE public.organizer_profiles
  DROP CONSTRAINT IF EXISTS organizer_profiles_vat_regime_check,
  ADD CONSTRAINT organizer_profiles_vat_regime_check
    CHECK (vat_regime IS NULL OR vat_regime IN ('subject', 'franchise', 'exempt_association'));

COMMENT ON COLUMN public.organizer_profiles.rna_number IS
  'N° RNA d''une association loi 1901 (W + 9 chiffres). Imprimé sur les reçus et factures.';
COMMENT ON COLUMN public.organizer_profiles.vat_regime IS
  'Régime de TVA du vendeur : subject (20 %), franchise (293 B), exempt_association (261-7-1°). NULL = association exonérée, sinon 20 %.';

-- Comme les autres colonnes légales : jamais lisibles par anon.
REVOKE SELECT (rna_number, vat_regime) ON public.organizer_profiles FROM anon;

-- ── Taux applicable aux articles vendus par un organisateur ────────────────
CREATE OR REPLACE FUNCTION public.organizer_vat_rate(p_organizer_user_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN o.vat_regime = 'subject' THEN 20
      WHEN o.vat_regime IN ('franchise', 'exempt_association') THEN 0
      WHEN o.bde_verified THEN 0
      ELSE 20
    END
    FROM public.organizer_profiles o
    WHERE o.user_id = p_organizer_user_id
  ), 20)::numeric;
$$;

REVOKE ALL ON FUNCTION public.organizer_vat_rate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organizer_vat_rate(uuid) TO authenticated, service_role;

-- ── Vendeur d'une soirée sans club (pour le reçu) ──────────────────────────
-- L'identité du vendeur figure OBLIGATOIREMENT sur un reçu : elle est donc
-- rendue à tout acheteur, invité compris (anon), mais seulement pour une
-- soirée portée par un organisateur SANS club — un club reste lu dans `venues`
-- (même règle que send-ticket-confirmation). `sole_seller` = aucun club
-- partenaire non plus : seul ce cas applique le régime de TVA de l'orga, une
-- co-soirée étant encaissée côté club (20 %, comme la facture stockée).
CREATE OR REPLACE FUNCTION public.get_event_seller(p_event_id uuid)
RETURNS TABLE (
  name text, legal_address text, siret text, rna_number text,
  vat_number text, vat_regime text, bde_verified boolean, logo_url text,
  sole_seller boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(NULLIF(o.legal_name, ''), o.display_name),
         o.legal_address, o.siret, o.rna_number,
         o.vat_number, o.vat_regime, COALESCE(o.bde_verified, false), o.avatar_url,
         e.partner_venue_id IS NULL
    FROM public.events e
    JOIN public.organizer_profiles o ON o.user_id = e.organizer_user_id
   WHERE e.id = p_event_id
     AND e.venue_id IS NULL;
$$;

REVOKE ALL ON FUNCTION public.get_event_seller(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_seller(uuid) TO anon, authenticated, service_role;

-- ── Factures stockées : TVA selon le vendeur ───────────────────────────────
-- Corps repris de l'état LIVE ; seule différence : total_ht / tva. Une vente
-- d'un organisateur SANS club suit organizer_vat_rate() sur les articles, les
-- frais Yuno restent à 20 %. Toute autre vente garde le calcul d'avant.
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
BEGIN
  IF NEW.ticket_id IS NOT NULL THEN
    v_type := 'ticket';
    SELECT total_price, user_email, full_name, phone, event_id, service_fee, insurance_fee, qr_code,
           jsonb_build_array(jsonb_build_object(
             'description', 'Billet',
             'quantity', COALESCE(quantity, 1),
             'unitPrice', COALESCE(unit_price, 0),
             'total', COALESCE(quantity, 1) * COALESCE(unit_price, 0)
           ))
    INTO v_amount, v_customer_email, v_customer_name, v_customer_phone, v_event_id, v_service_fee, v_insurance_fee, v_qr_code, v_items
    FROM public.tickets WHERE id = NEW.ticket_id;
  ELSIF NEW.table_reservation_id IS NOT NULL THEN
    v_type := 'table';
    SELECT total_price, user_email, full_name, phone, event_id, service_fee, management_fee, qr_code,
           jsonb_build_array(jsonb_build_object(
             'description', 'Table VIP',
             'quantity', 1,
             'unitPrice', COALESCE(deposit, 0),
             'total', COALESCE(deposit, 0)
           ))
    INTO v_amount, v_customer_email, v_customer_name, v_customer_phone, v_event_id, v_service_fee, v_management_fee, v_qr_code, v_items
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
  IF v_resolved_venue_id IS NULL AND v_resolved_organizer_id IS NOT NULL THEN
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
