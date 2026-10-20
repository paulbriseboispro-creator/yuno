-- Numérotation des factures : une suite continue PAR VENDEUR, attribuée par la
-- base au moment où la facture naît (2026-10-20).
--
-- Le défaut (constaté en lecture sur la prod le 20/10) : generate_invoice_number
-- fabriquait `<préfixe>-<année>-<nombre de factures du vendeur + essai>` alors
-- que invoice_numbers.invoice_number était UNIQUE sur toute la base. Deux
-- vendeurs au même préfixe (FAC par défaut pour un club, ORG pour un
-- organisateur) se disputaient donc les mêmes numéros : Amoris tient
-- ORG-2026-00001 → 00046, tout autre organisateur aurait vu ses dix essais
-- tomber sur des numéros pris, l'exception était avalée par le try/catch des
-- verify-*, et la vente restait SANS facture (aucune ligne invoices, rien dans
-- la Compta). Côté club, le club démo tient FAC-2026-00010 → 00022 : la
-- 10e facture de Poupée, Goya, Babouchka ou Dakiti serait tombée, puis toutes
-- les suivantes. Aucune vente réelle n'a été perdue (Amoris est le seul vendeur
-- réel au 20/10, ses 45 billets ont leur facture), mais la prochaine l'aurait été.
--
-- Règle française (CGI art. 242 nonies A, BOI-TVA-DECLA-30-20-20) : un numéro
-- unique, fondé sur une séquence chronologique et continue, PAR ÉMETTEUR ; deux
-- vendeurs peuvent porter le même numéro. D'où :
--
--   • le vendeur d'une facture (`seller_kind` = venue | organizer) suit la règle
--     du reçu et de la TVA (`get_event_seller`, `save_invoice_on_creation`) :
--     l'organisateur s'il vend seul ou encaisse un contrat collab réglé par
--     virement, sinon le club ; une commande du bar est au club ;
--   • le numéro est attribué par un trigger BEFORE INSERT, sous un verrou par
--     vendeur et par année : max(invoice_seq) + 1, dans la même transaction que
--     la ligne, donc sans trou ni doublon même à deux ventes simultanées. Le
--     numéro fourni par l'appelant est ignoré (les fonctions déjà déployées
--     passent encore celui de generate_invoice_number : la base le remplace) ;
--   • l'unicité devient (vendeur, numéro) et (vendeur, année, rang), plus une
--     facture par vente ; un numéro émis ne change plus jamais (trigger) ;
--   • issue_sale_invoice(vente) est la porte des edge functions (idempotente),
--     et issue_missing_invoices() rattrape toutes les heures une vente payée
--     restée sans facture, avec une alerte super admin si elle échoue encore.

-- ── 1. Colonnes ─────────────────────────────────────────────────────────────
ALTER TABLE public.invoice_numbers
  ADD COLUMN IF NOT EXISTS seller_kind text,
  ADD COLUMN IF NOT EXISTS invoice_year int,
  ADD COLUMN IF NOT EXISTS invoice_seq int;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS seller_kind text;

-- ── 2. Qui vend : une règle, la même que le reçu et la TVA ─────────────────
CREATE OR REPLACE FUNCTION public._invoice_seller_kind(
  p_venue_id text, p_organizer_user_id uuid, p_split jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_organizer_user_id IS NOT NULL
         AND (p_venue_id IS NULL
              OR (p_split->>'mode' = 'transfer' AND p_split->>'collector' = 'organizer'))
      THEN 'organizer'
    WHEN p_venue_id IS NOT NULL THEN 'venue'
  END
$$;

REVOKE ALL ON FUNCTION public._invoice_seller_kind(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._invoice_seller_kind(text, uuid, jsonb) TO service_role;

-- ── 3. Rattrapage des lignes existantes ─────────────────────────────────────
UPDATE public.invoice_numbers n
   SET invoice_year = substring(n.invoice_number FROM '-([0-9]{4})-[0-9]+$')::int,
       invoice_seq  = substring(n.invoice_number FROM '-([0-9]+)$')::int,
       seller_kind  = CASE
         WHEN n.order_id IS NOT NULL AND n.venue_id IS NOT NULL THEN 'venue'
         ELSE public._invoice_seller_kind(n.venue_id, n.organizer_user_id,
                COALESCE((SELECT t.collab_split FROM public.tickets t WHERE t.id = n.ticket_id),
                         (SELECT r.collab_split FROM public.table_reservations r WHERE r.id = n.table_reservation_id)))
       END
 WHERE n.seller_kind IS NULL;

UPDATE public.invoices i
   SET seller_kind = n.seller_kind
  FROM public.invoice_numbers n
 WHERE i.seller_kind IS NULL
   AND i.invoice_number = n.invoice_number
   AND (i.venue_id IS NOT DISTINCT FROM n.venue_id
        OR i.organizer_user_id IS NOT DISTINCT FROM n.organizer_user_id);

ALTER TABLE public.invoice_numbers
  ALTER COLUMN seller_kind SET NOT NULL,
  ALTER COLUMN invoice_year SET NOT NULL,
  ALTER COLUMN invoice_seq SET NOT NULL;

ALTER TABLE public.invoice_numbers
  DROP CONSTRAINT IF EXISTS invoice_numbers_seller_chk;
ALTER TABLE public.invoice_numbers
  ADD CONSTRAINT invoice_numbers_seller_chk CHECK (
    (seller_kind = 'venue' AND venue_id IS NOT NULL)
    OR (seller_kind = 'organizer' AND organizer_user_id IS NOT NULL)
  );

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_seller_kind_chk;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_seller_kind_chk CHECK (seller_kind IS NULL OR seller_kind IN ('venue', 'organizer'));

-- ── 4. Unicité par vendeur, une facture par vente ───────────────────────────
ALTER TABLE public.invoice_numbers
  DROP CONSTRAINT IF EXISTS invoice_numbers_invoice_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS invoice_numbers_venue_seq_uidx
  ON public.invoice_numbers (venue_id, invoice_year, invoice_seq) WHERE seller_kind = 'venue';
CREATE UNIQUE INDEX IF NOT EXISTS invoice_numbers_org_seq_uidx
  ON public.invoice_numbers (organizer_user_id, invoice_year, invoice_seq) WHERE seller_kind = 'organizer';
CREATE UNIQUE INDEX IF NOT EXISTS invoice_numbers_venue_number_uidx
  ON public.invoice_numbers (venue_id, invoice_number) WHERE seller_kind = 'venue';
CREATE UNIQUE INDEX IF NOT EXISTS invoice_numbers_org_number_uidx
  ON public.invoice_numbers (organizer_user_id, invoice_number) WHERE seller_kind = 'organizer';
CREATE UNIQUE INDEX IF NOT EXISTS invoice_numbers_ticket_uidx
  ON public.invoice_numbers (ticket_id) WHERE ticket_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoice_numbers_table_uidx
  ON public.invoice_numbers (table_reservation_id) WHERE table_reservation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoice_numbers_order_uidx
  ON public.invoice_numbers (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_numbers_number
  ON public.invoice_numbers (invoice_number);

-- invoices : la même clé. Les lignes sans vendeur (les factures `YUNO-…` que
-- les semis démo écrivent directement) gardent l'unicité d'avant, restreinte à
-- elles. Sans ce changement, deux organisateurs au préfixe ORG encaissant
-- chacun une co-soirée dans le même club produiraient deux lignes
-- (club, ORG-2026-00003) : la seconde serait refusée.
DROP INDEX IF EXISTS public.invoices_venue_invoicenum_uidx;
DROP INDEX IF EXISTS public.invoices_organizer_invoicenum_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_seller_venue_number_uidx
  ON public.invoices (venue_id, invoice_number) WHERE seller_kind = 'venue';
CREATE UNIQUE INDEX IF NOT EXISTS invoices_seller_org_number_uidx
  ON public.invoices (organizer_user_id, invoice_number) WHERE seller_kind = 'organizer';
CREATE UNIQUE INDEX IF NOT EXISTS invoices_legacy_venue_number_uidx
  ON public.invoices (venue_id, invoice_number) WHERE seller_kind IS NULL AND venue_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_legacy_org_number_uidx
  ON public.invoices (organizer_user_id, invoice_number)
  WHERE seller_kind IS NULL AND organizer_user_id IS NOT NULL AND venue_id IS NULL;

-- ── 5. Le numéro, attribué par la base ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_split jsonb;
  v_order_venue text;
  v_ev_venue text;
  v_ev_partner_venue text;
  v_ev_org uuid;
  v_ev_partner_org uuid;
  v_prefix text;
  v_year int;
  v_seq int;
BEGIN
  IF NEW.ticket_id IS NOT NULL THEN
    SELECT t.event_id, t.collab_split INTO v_event_id, v_split
      FROM public.tickets t WHERE t.id = NEW.ticket_id;
  ELSIF NEW.table_reservation_id IS NOT NULL THEN
    SELECT r.event_id, r.collab_split INTO v_event_id, v_split
      FROM public.table_reservations r WHERE r.id = NEW.table_reservation_id;
  ELSIF NEW.order_id IS NOT NULL THEN
    SELECT o.event_id, o.venue_id INTO v_event_id, v_order_venue
      FROM public.orders o WHERE o.id = NEW.order_id;
  END IF;

  IF v_event_id IS NOT NULL THEN
    SELECT e.venue_id, e.partner_venue_id, e.organizer_user_id, e.partner_organizer_id
      INTO v_ev_venue, v_ev_partner_venue, v_ev_org, v_ev_partner_org
      FROM public.events e WHERE e.id = v_event_id;
  END IF;

  NEW.venue_id := COALESCE(NEW.venue_id, v_order_venue, v_ev_venue, v_ev_partner_venue);
  NEW.organizer_user_id := COALESCE(NEW.organizer_user_id, v_ev_org, v_ev_partner_org);

  IF NEW.order_id IS NOT NULL AND NEW.venue_id IS NOT NULL THEN
    NEW.seller_kind := 'venue';          -- une commande du bar est au club
  ELSE
    NEW.seller_kind := public._invoice_seller_kind(NEW.venue_id, NEW.organizer_user_id, v_split);
  END IF;
  IF NEW.seller_kind IS NULL THEN
    RAISE EXCEPTION 'invoice_seller_unknown' USING ERRCODE = 'P0001';
  END IF;

  -- Année civile de Paris : une vente du 31/12 à 23 h 30 est de cette année.
  v_year := extract(year FROM (now() AT TIME ZONE 'Europe/Paris'))::int;

  -- Un vendeur, une année, une file : deux ventes simultanées attendent leur
  -- tour, et la seconde lit le rang de la première (READ COMMITTED : chaque
  -- instruction prend un instantané neuf, après le verrou).
  IF NEW.seller_kind = 'venue' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('yuno_invoice:venue:' || NEW.venue_id || ':' || v_year, 0));
    SELECT COALESCE(max(n.invoice_seq), 0) + 1 INTO v_seq
      FROM public.invoice_numbers n
     WHERE n.seller_kind = 'venue' AND n.venue_id = NEW.venue_id AND n.invoice_year = v_year;
    SELECT NULLIF(btrim(v.invoice_prefix), '') INTO v_prefix
      FROM public.venues v WHERE v.id = NEW.venue_id;
    v_prefix := COALESCE(v_prefix, 'FAC');
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended('yuno_invoice:org:' || NEW.organizer_user_id::text || ':' || v_year, 0));
    SELECT COALESCE(max(n.invoice_seq), 0) + 1 INTO v_seq
      FROM public.invoice_numbers n
     WHERE n.seller_kind = 'organizer' AND n.organizer_user_id = NEW.organizer_user_id AND n.invoice_year = v_year;
    SELECT NULLIF(btrim(p.invoice_prefix), '') INTO v_prefix
      FROM public.profiles p WHERE p.id = NEW.organizer_user_id;
    v_prefix := COALESCE(v_prefix, 'ORG');
  END IF;

  NEW.invoice_year := v_year;
  NEW.invoice_seq := v_seq;
  -- lpad tronque au-delà de 5 chiffres : la 100 000e facture garde son rang.
  NEW.invoice_number := v_prefix || '-' || v_year::text || '-'
    || CASE WHEN v_seq < 100000 THEN lpad(v_seq::text, 5, '0') ELSE v_seq::text END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_invoice_number() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS assign_invoice_number_trigger ON public.invoice_numbers;
CREATE TRIGGER assign_invoice_number_trigger
  BEFORE INSERT ON public.invoice_numbers
  FOR EACH ROW EXECUTE FUNCTION public.assign_invoice_number();

-- Un numéro émis ne change jamais (ni son vendeur, ni son rang). La mise à NULL
-- d'une vente supprimée et le transfert d'un organisateur vitrine
-- (handoff_showcase_organizer) restent possibles.
CREATE OR REPLACE FUNCTION public.guard_invoice_number_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.invoice_number, NEW.invoice_year, NEW.invoice_seq, NEW.seller_kind)
       IS DISTINCT FROM (OLD.invoice_number, OLD.invoice_year, OLD.invoice_seq, OLD.seller_kind)
     AND COALESCE(current_setting('yuno.invoice_renumber_unlock', true), '') <> 'on' THEN
    RAISE EXCEPTION 'invoice_number_immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_invoice_number_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_invoice_number_immutable_trigger ON public.invoice_numbers;
CREATE TRIGGER guard_invoice_number_immutable_trigger
  BEFORE UPDATE ON public.invoice_numbers
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_number_immutable();

-- ── 6. La ligne invoices : le vendeur posé, plus aucun refus silencieux ─────
-- Reprise de la définition de la prod au 20/10 ; seuls changent le vendeur
-- (seller_kind, qui décide aussi du taux de TVA, même règle qu'avant) et la
-- fin de l'INSERT : sans `ON CONFLICT DO NOTHING`, une facture qui ne peut pas
-- s'écrire fait échouer l'émission, qui le signale, au lieu d'un numéro sans
-- facture que la Compta ne verrait jamais.
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
  -- Posé par assign_invoice_number ; la règle d'avant reste le repli.
  v_seller := COALESCE(NEW.seller_kind,
                       public._invoice_seller_kind(v_resolved_venue_id, v_resolved_organizer_id, v_split));
  IF v_seller = 'organizer' AND v_resolved_organizer_id IS NOT NULL THEN
    v_rate := public.organizer_vat_rate(v_resolved_organizer_id);
  END IF;
  IF v_rate = 20 THEN
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
    items, qr_code
  ) VALUES (
    v_resolved_venue_id, v_resolved_organizer_id, NEW.invoice_number, v_type, v_seller,
    v_amount,
    v_total_ht,
    v_amount - v_total_ht,
    v_service_fee, v_management_fee, v_insurance_fee,
    COALESCE(v_customer_email, ''), v_customer_name, v_customer_phone,
    v_event_id, v_event_title, v_event_start_at, v_event_poster_url,
    NEW.ticket_id, NEW.table_reservation_id, NEW.order_id,
    v_items, v_qr_code
  );

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_invoice_on_creation() FROM PUBLIC, anon, authenticated;

-- ── 7. generate_invoice_number : un aperçu, plus jamais une attribution ─────
-- Gardée pour les fonctions déjà déployées (elles l'appellent puis insèrent :
-- le trigger remplace le numéro). Elle n'est plus exposée au navigateur : le
-- reçu de la page de confirmation inventait un numéro jamais enregistré.
CREATE OR REPLACE FUNCTION public.generate_invoice_number(
  p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text := CASE WHEN p_venue_id IS NOT NULL THEN 'venue'
                      WHEN p_organizer_user_id IS NOT NULL THEN 'organizer' END;
  v_year int := extract(year FROM (now() AT TIME ZONE 'Europe/Paris'))::int;
  v_prefix text;
  v_seq int;
BEGIN
  IF v_kind IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_kind = 'venue' THEN
    SELECT NULLIF(btrim(v.invoice_prefix), '') INTO v_prefix FROM public.venues v WHERE v.id = p_venue_id;
    SELECT COALESCE(max(n.invoice_seq), 0) + 1 INTO v_seq FROM public.invoice_numbers n
     WHERE n.seller_kind = 'venue' AND n.venue_id = p_venue_id AND n.invoice_year = v_year;
    v_prefix := COALESCE(v_prefix, 'FAC');
  ELSE
    SELECT NULLIF(btrim(p.invoice_prefix), '') INTO v_prefix FROM public.profiles p WHERE p.id = p_organizer_user_id;
    SELECT COALESCE(max(n.invoice_seq), 0) + 1 INTO v_seq FROM public.invoice_numbers n
     WHERE n.seller_kind = 'organizer' AND n.organizer_user_id = p_organizer_user_id AND n.invoice_year = v_year;
    v_prefix := COALESCE(v_prefix, 'ORG');
  END IF;
  RETURN v_prefix || '-' || v_year::text || '-'
    || CASE WHEN v_seq < 100000 THEN lpad(v_seq::text, 5, '0') ELSE v_seq::text END;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_invoice_number(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_invoice_number(text, uuid) TO service_role;

-- ── 8. issue_sale_invoice : la porte des edge functions ─────────────────────
-- Une vente (billet, table ou commande), une facture. Idempotente : rend le
-- numéro existant si la vente en a déjà un. Lève si la vente n'existe pas, n'est
-- pas payée, ou n'a pas été encaissée par Yuno (table réglée sur place).
CREATE OR REPLACE FUNCTION public.issue_sale_invoice(
  p_ticket_id uuid DEFAULT NULL,
  p_table_reservation_id uuid DEFAULT NULL,
  p_order_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_number text;
  v_status text;
  v_mode text;
BEGIN
  IF num_nonnulls(p_ticket_id, p_table_reservation_id, p_order_id) <> 1 THEN
    RAISE EXCEPTION 'invoice_one_sale_required' USING ERRCODE = 'P0001';
  END IF;

  -- Deux appels pour la même vente (webhook + retour navigateur) attendent
  -- leur tour ; le second rend le numéro du premier.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'yuno_invoice_sale:' || COALESCE(p_ticket_id, p_table_reservation_id, p_order_id)::text, 0));

  SELECT n.invoice_number INTO v_number
    FROM public.invoice_numbers n
   WHERE (p_ticket_id IS NOT NULL AND n.ticket_id = p_ticket_id)
      OR (p_table_reservation_id IS NOT NULL AND n.table_reservation_id = p_table_reservation_id)
      OR (p_order_id IS NOT NULL AND n.order_id = p_order_id)
   LIMIT 1;
  IF v_number IS NOT NULL THEN
    RETURN v_number;
  END IF;

  IF p_ticket_id IS NOT NULL THEN
    SELECT t.status INTO v_status FROM public.tickets t WHERE t.id = p_ticket_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'invoice_sale_not_found' USING ERRCODE = 'P0001'; END IF;
    IF v_status NOT IN ('paid', 'used', 'refunded') THEN
      RAISE EXCEPTION 'invoice_sale_not_paid' USING ERRCODE = 'P0001';
    END IF;
  ELSIF p_table_reservation_id IS NOT NULL THEN
    SELECT r.status, r.payment_mode INTO v_status, v_mode
      FROM public.table_reservations r WHERE r.id = p_table_reservation_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'invoice_sale_not_found' USING ERRCODE = 'P0001'; END IF;
    IF v_status IN ('pending', 'cancelled', 'expired', 'failed') THEN
      RAISE EXCEPTION 'invoice_sale_not_paid' USING ERRCODE = 'P0001';
    END IF;
    IF v_mode = 'on_site' THEN
      RAISE EXCEPTION 'invoice_on_site_sale' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT o.status INTO v_status FROM public.orders o WHERE o.id = p_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'invoice_sale_not_found' USING ERRCODE = 'P0001'; END IF;
    IF v_status IN ('pending', 'cancelled', 'expired', 'failed') THEN
      RAISE EXCEPTION 'invoice_sale_not_paid' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Le numéro et le vendeur sont posés par assign_invoice_number.
  INSERT INTO public.invoice_numbers (ticket_id, table_reservation_id, order_id, invoice_number)
  VALUES (p_ticket_id, p_table_reservation_id, p_order_id, '')
  RETURNING invoice_number INTO v_number;

  RETURN v_number;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_sale_invoice(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_sale_invoice(uuid, uuid, uuid) TO service_role;

-- ── 9. Le filet : une vente payée sans facture est rattrapée, ou signalée ───
-- Ventes réelles (démo exclue) payées par Stripe depuis 90 jours, depuis plus
-- de 10 minutes (le verify-* a eu le temps de faire son travail). Chaque vente
-- dans sa propre sous-transaction : une vente qui échoue n'arrête pas les autres,
-- et lève une alerte super admin (une par vente, `invoice_failed:<vente>`,
-- la même clé que l'alerte des edge functions).
CREATE OR REPLACE FUNCTION public.issue_missing_invoices()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  v_issued int := 0;
  v_failed int := 0;
  v_number text;
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

  RETURN jsonb_build_object('issued', v_issued, 'failed', v_failed);
END;
$$;

REVOKE ALL ON FUNCTION public.issue_missing_invoices() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_missing_invoices() TO service_role;

-- L'ancien rattrapage passait par ON CONFLICT (invoice_number), qui n'existe
-- plus : il délègue au nouveau.
CREATE OR REPLACE FUNCTION public.backfill_missing_invoices()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (public.issue_missing_invoices()->>'issued')::int;
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_missing_invoices() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_missing_invoices() TO service_role;

DO $cron$
BEGIN
  PERFORM cron.unschedule('issue-missing-invoices')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'issue-missing-invoices');
  PERFORM cron.schedule('issue-missing-invoices', '23 * * * *',
                        'SELECT public.issue_missing_invoices()');
END
$cron$;

-- Rattrapage immédiat (aucune vente réelle concernée au 20/10 : Amoris a
-- toutes ses factures ; rejoué ici pour le cas où une vente tombe entre-temps).
SELECT public.issue_missing_invoices();
