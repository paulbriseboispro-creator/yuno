-- Analytics v3, phase 2 — l'attribution d'une vente est FIGÉE sur la vente
-- (spec §5 : last-touch avec priorité), jamais recalculée à la lecture.
--
--   attribution_source ∈ promoter · email · instagram · tiktok · facebook · whatsapp
--                        · meta_ads · partner · link · promo_code · marketplace
--                        · social · search · referral · direct
--   attribution_ref    = ce qui l'a décidée (id du promoteur, code du lien, id de
--                        campagne, id du code promo, purchase_source d'origine)
--
-- Priorité : promoteur (conversion ou lien de promoteur) > lien suivi / UTM
-- > code promo > campagne email (clic de la même adresse dans les 7 jours)
-- > source d'arrivée portée par le checkout (`purchase_source` : explore /
-- pages Yuno = marketplace, réseaux, recherche, référent) > direct.
--
-- Posée par trigger au passage « payé » (billets, tables, bar) et à
-- l'inscription (guest list) ; les ventes déjà payées sont rattrapées ici.

ALTER TABLE public.tickets            ADD COLUMN IF NOT EXISTS attribution_source text, ADD COLUMN IF NOT EXISTS attribution_ref text;
ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS attribution_source text, ADD COLUMN IF NOT EXISTS attribution_ref text;
ALTER TABLE public.orders             ADD COLUMN IF NOT EXISTS attribution_source text, ADD COLUMN IF NOT EXISTS attribution_ref text;
ALTER TABLE public.guest_list_entries ADD COLUMN IF NOT EXISTS attribution_source text, ADD COLUMN IF NOT EXISTS attribution_ref text;

CREATE INDEX IF NOT EXISTS idx_tickets_event_attribution ON public.tickets (event_id, attribution_source) WHERE attribution_source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_table_reservations_event_attribution ON public.table_reservations (event_id, attribution_source) WHERE attribution_source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_event_attribution ON public.orders (event_id, attribution_source) WHERE attribution_source IS NOT NULL;

-- Le clic d'une campagne par adresse : sans cet index, le rattrapage relit 117 k lignes par vente.
CREATE INDEX IF NOT EXISTS idx_email_campaign_events_click_by_email ON public.email_campaign_events (lower(recipient_email), created_at) WHERE event_type = 'clicked';

-- La source d'un lien suivi, dans le vocabulaire commun.
CREATE OR REPLACE FUNCTION public.attribution_from_tracked_link(p_link_id uuid)
RETURNS TABLE (source text, ref text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
           WHEN tl.promoter_id IS NOT NULL THEN 'promoter'
           WHEN lower(coalesce(tl.utm_medium, '')) = 'paid_social' OR lower(coalesce(tl.utm_source, '')) IN ('meta', 'meta_ads', 'facebook_ads') THEN 'meta_ads'
           WHEN lower(coalesce(tl.utm_medium, '')) IN ('party_link', 'coorg') OR lower(coalesce(tl.utm_source, '')) = 'coorg' THEN 'partner'
           WHEN lower(coalesce(tl.utm_source, '')) IN ('newsletter', 'email', 'mail') OR lower(coalesce(tl.utm_medium, '')) IN ('email', 'newsletter') THEN 'email'
           WHEN lower(coalesce(tl.utm_source, '')) IN ('instagram', 'tiktok', 'facebook', 'whatsapp') THEN lower(tl.utm_source)
           ELSE 'link' END,
         CASE WHEN tl.promoter_id IS NOT NULL THEN tl.promoter_id::text ELSE tl.code END
    FROM public.tracked_links tl WHERE tl.id = p_link_id
$$;
REVOKE ALL ON FUNCTION public.attribution_from_tracked_link(uuid) FROM PUBLIC, anon, authenticated;

-- La source d'arrivée portée par le checkout (`purchase_source`), dans le vocabulaire commun.
CREATE OR REPLACE FUNCTION public.attribution_from_purchase_source(p_source text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(p_source, ''))
           WHEN 'explore' THEN 'marketplace' WHEN 'venue_profile' THEN 'marketplace' WHEN 'organizer_profile' THEN 'marketplace' WHEN 'dj_profile' THEN 'marketplace'
           WHEN 'marketplace' THEN 'marketplace' WHEN 'internal' THEN 'marketplace'
           WHEN 'promoter' THEN 'promoter'
           WHEN 'instagram' THEN 'instagram' WHEN 'tiktok' THEN 'tiktok' WHEN 'facebook' THEN 'facebook' WHEN 'whatsapp' THEN 'whatsapp'
           WHEN 'social' THEN 'social' WHEN 'paid_social' THEN 'meta_ads' WHEN 'meta_ads' THEN 'meta_ads'
           WHEN 'search' THEN 'search' WHEN 'referral' THEN 'referral' WHEN 'email' THEN 'email'
           ELSE 'direct' END
$$;

-- Résout l'attribution d'une vente (billet, table, commande bar ou inscription).
CREATE OR REPLACE FUNCTION public.resolve_sale_attribution(
  p_kind text, p_id uuid, p_event_id uuid, p_email text, p_at timestamptz,
  p_tracked_link_id uuid, p_promo_code_id uuid, p_purchase_source text, p_promoter_id uuid DEFAULT NULL)
RETURNS TABLE (source text, ref text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_src text; v_ref text; v_pid uuid; v_camp uuid;
BEGIN
  -- 1. Promoteur : conversion enregistrée, promoteur porté par l'inscription, ou lien de promoteur.
  v_pid := p_promoter_id;
  IF v_pid IS NULL AND p_id IS NOT NULL THEN
    SELECT pc.promoter_id INTO v_pid FROM public.promoter_conversions pc
     WHERE pc.status IS DISTINCT FROM 'cancelled'
       AND ((p_kind = 'ticket' AND pc.ticket_id = p_id) OR (p_kind = 'table' AND pc.table_reservation_id = p_id)
            OR (p_kind = 'order' AND pc.order_id = p_id) OR (p_kind = 'guest_list' AND pc.guest_list_entry_id = p_id))
     ORDER BY pc.created_at LIMIT 1;
  END IF;
  IF v_pid IS NOT NULL THEN RETURN QUERY SELECT 'promoter'::text, v_pid::text; RETURN; END IF;

  -- 2. Lien suivi / UTM.
  IF p_tracked_link_id IS NOT NULL THEN
    SELECT a.source, a.ref INTO v_src, v_ref FROM public.attribution_from_tracked_link(p_tracked_link_id) a;
    IF v_src IS NOT NULL THEN RETURN QUERY SELECT v_src, v_ref; RETURN; END IF;
  END IF;

  -- 3. Code promo.
  IF p_promo_code_id IS NOT NULL THEN RETURN QUERY SELECT 'promo_code'::text, p_promo_code_id::text; RETURN; END IF;

  -- 4. Campagne email : un clic de la même adresse dans les 7 jours avant la vente.
  IF nullif(trim(p_email), '') IS NOT NULL AND p_at IS NOT NULL THEN
    SELECT ev.campaign_id INTO v_camp FROM public.email_campaign_events ev
     WHERE ev.event_type = 'clicked' AND lower(ev.recipient_email) = lower(trim(p_email))
       AND ev.created_at BETWEEN p_at - interval '7 days' AND p_at
     ORDER BY ev.created_at DESC LIMIT 1;
    IF v_camp IS NOT NULL THEN RETURN QUERY SELECT 'email'::text, v_camp::text; RETURN; END IF;
  END IF;

  -- 5. Source d'arrivée portée par le checkout, sinon direct.
  RETURN QUERY SELECT public.attribution_from_purchase_source(p_purchase_source),
                      CASE WHEN nullif(p_purchase_source, '') IS NOT NULL AND lower(p_purchase_source) NOT IN ('direct') THEN lower(p_purchase_source) END;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_sale_attribution(text, uuid, uuid, text, timestamptz, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- ── Triggers : figer au passage « payé » ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stamp_ticket_attribution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.attribution_source IS NULL AND NEW.status IN ('paid', 'used')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.attribution_source IS NULL) THEN
    SELECT a.source, a.ref INTO NEW.attribution_source, NEW.attribution_ref
      FROM public.resolve_sale_attribution('ticket', NEW.id, NEW.event_id, NEW.user_email, coalesce(NEW.paid_at, NEW.created_at, now()),
                                           NEW.tracked_link_id, NEW.promo_code_id, NEW.purchase_source) a;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- l'attribution n'empêche jamais une vente
END; $$;
DROP TRIGGER IF EXISTS trg_stamp_ticket_attribution ON public.tickets;
CREATE TRIGGER trg_stamp_ticket_attribution BEFORE INSERT OR UPDATE OF status ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.stamp_ticket_attribution();

CREATE OR REPLACE FUNCTION public.stamp_table_attribution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.attribution_source IS NULL AND NEW.status IN ('paid', 'confirmed')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.attribution_source IS NULL) THEN
    SELECT a.source, a.ref INTO NEW.attribution_source, NEW.attribution_ref
      FROM public.resolve_sale_attribution('table', NEW.id, NEW.event_id, NEW.user_email, coalesce(NEW.paid_at, NEW.created_at, now()),
                                           NEW.tracked_link_id, NEW.promo_code_id, NEW.purchase_source) a;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_stamp_table_attribution ON public.table_reservations;
CREATE TRIGGER trg_stamp_table_attribution BEFORE INSERT OR UPDATE OF status ON public.table_reservations
  FOR EACH ROW EXECUTE FUNCTION public.stamp_table_attribution();

CREATE OR REPLACE FUNCTION public.stamp_order_attribution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.attribution_source IS NULL AND NEW.status IN ('paid', 'served')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.attribution_source IS NULL) THEN
    SELECT a.source, a.ref INTO NEW.attribution_source, NEW.attribution_ref
      FROM public.resolve_sale_attribution('order', NEW.id, NEW.event_id, NEW.user_email, coalesce(NEW.paid_at, NEW.created_at, now()),
                                           NEW.tracked_link_id, NULL, NEW.purchase_source) a;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_stamp_order_attribution ON public.orders;
CREATE TRIGGER trg_stamp_order_attribution BEFORE INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.stamp_order_attribution();

CREATE OR REPLACE FUNCTION public.stamp_guest_list_attribution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event uuid;
BEGIN
  IF NEW.attribution_source IS NULL THEN
    SELECT gl.event_id INTO v_event FROM public.guest_lists gl WHERE gl.id = NEW.guest_list_id;
    SELECT a.source, a.ref INTO NEW.attribution_source, NEW.attribution_ref
      FROM public.resolve_sale_attribution('guest_list', NEW.id, v_event, NEW.email, coalesce(NEW.created_at, now()),
                                           NEW.tracked_link_id, NULL, NULL, NEW.promoter_id) a;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_stamp_guest_list_attribution ON public.guest_list_entries;
CREATE TRIGGER trg_stamp_guest_list_attribution BEFORE INSERT ON public.guest_list_entries
  FOR EACH ROW EXECUTE FUNCTION public.stamp_guest_list_attribution();

-- Une conversion promoteur enregistrée APRÈS le paiement (porte, guest list) corrige la vente.
CREATE OR REPLACE FUNCTION public.restamp_attribution_from_conversion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.ticket_id IS NOT NULL THEN
    UPDATE public.tickets SET attribution_source = 'promoter', attribution_ref = NEW.promoter_id::text
     WHERE id = NEW.ticket_id AND coalesce(attribution_source, '') <> 'promoter';
  ELSIF NEW.table_reservation_id IS NOT NULL THEN
    UPDATE public.table_reservations SET attribution_source = 'promoter', attribution_ref = NEW.promoter_id::text
     WHERE id = NEW.table_reservation_id AND coalesce(attribution_source, '') <> 'promoter';
  ELSIF NEW.order_id IS NOT NULL THEN
    UPDATE public.orders SET attribution_source = 'promoter', attribution_ref = NEW.promoter_id::text
     WHERE id = NEW.order_id AND coalesce(attribution_source, '') <> 'promoter';
  ELSIF NEW.guest_list_entry_id IS NOT NULL THEN
    UPDATE public.guest_list_entries SET attribution_source = 'promoter', attribution_ref = NEW.promoter_id::text
     WHERE id = NEW.guest_list_entry_id AND coalesce(attribution_source, '') <> 'promoter';
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_restamp_attribution_from_conversion ON public.promoter_conversions;
CREATE TRIGGER trg_restamp_attribution_from_conversion AFTER INSERT ON public.promoter_conversions
  FOR EACH ROW EXECUTE FUNCTION public.restamp_attribution_from_conversion();

-- ── Rattrapage des ventes déjà payées ────────────────────────────────────────
UPDATE public.tickets t SET (attribution_source, attribution_ref) =
  (SELECT a.source, a.ref FROM public.resolve_sale_attribution('ticket', t.id, t.event_id, t.user_email, coalesce(t.paid_at, t.created_at), t.tracked_link_id, t.promo_code_id, t.purchase_source) a)
 WHERE t.status IN ('paid', 'used') AND t.attribution_source IS NULL;
UPDATE public.table_reservations r SET (attribution_source, attribution_ref) =
  (SELECT a.source, a.ref FROM public.resolve_sale_attribution('table', r.id, r.event_id, r.user_email, coalesce(r.paid_at, r.created_at), r.tracked_link_id, r.promo_code_id, r.purchase_source) a)
 WHERE r.status IN ('paid', 'confirmed') AND r.attribution_source IS NULL;
UPDATE public.orders o SET (attribution_source, attribution_ref) =
  (SELECT a.source, a.ref FROM public.resolve_sale_attribution('order', o.id, o.event_id, o.user_email, coalesce(o.paid_at, o.created_at), o.tracked_link_id, NULL, o.purchase_source) a)
 WHERE o.status IN ('paid', 'served') AND o.attribution_source IS NULL;
UPDATE public.guest_list_entries x SET (attribution_source, attribution_ref) =
  (SELECT a.source, a.ref FROM public.resolve_sale_attribution('guest_list', x.id, (SELECT gl.event_id FROM public.guest_lists gl WHERE gl.id = x.guest_list_id), x.email, x.created_at, x.tracked_link_id, NULL, NULL, x.promoter_id) a)
 WHERE x.attribution_source IS NULL;
