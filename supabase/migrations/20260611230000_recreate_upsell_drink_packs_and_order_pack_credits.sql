-- Recreate two tables lost in the Lovable -> Supabase migration.
-- They are referenced by code + edge functions (verify-ticket-payment, use-drink-credit,
-- owner-refund, cancel-ticket, ...) and by the UI (drink packs upsell + "crédit conso").
-- Schema reconstructed from edge-function INSERTs and the OwnerUpsellPacks admin CRUD.
-- Mirrors the RLS pattern of public.ticket_upsell_offers (same migration family).
-- NOTE: venue_id is TEXT because public.venues.id is TEXT.

-- =====================================================================
-- Table: upsell_drink_packs  (owner-defined drink packs sold as upsell)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.upsell_drink_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id TEXT NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  drink_count INTEGER NOT NULL DEFAULT 1,
  pack_price NUMERIC NOT NULL,
  original_price NUMERIC NOT NULL,
  allowed_collections TEXT[],
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_upsell_drink_packs_venue_id
  ON public.upsell_drink_packs (venue_id);

ALTER TABLE public.upsell_drink_packs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can manage their venue drink packs"
ON public.upsell_drink_packs FOR ALL
USING (public.is_venue_owner(auth.uid(), venue_id))
WITH CHECK (public.is_venue_owner(auth.uid(), venue_id));

CREATE POLICY "Managers can manage drink packs"
ON public.upsell_drink_packs FOR ALL
USING (public.can_manage_venue(auth.uid(), venue_id))
WITH CHECK (public.can_manage_venue(auth.uid(), venue_id));

CREATE POLICY "Active drink packs are readable by authenticated users"
ON public.upsell_drink_packs FOR SELECT
TO authenticated
USING (is_active = true);

-- =====================================================================
-- Table: order_pack_credits  (drink credits a user owns after a purchase)
-- pack_id intentionally has NO FK: it can point to either upsell_drink_packs
-- or ticket_upsell_offers, and uses a sentinel id for free-ticket drink credits.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.order_pack_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  venue_id TEXT NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  ticket_order_id UUID,
  pack_id UUID NOT NULL,
  total_credits INTEGER NOT NULL,
  used_credits INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_pack_credits_user_venue
  ON public.order_pack_credits (user_id, venue_id);
CREATE INDEX IF NOT EXISTS idx_order_pack_credits_ticket_order
  ON public.order_pack_credits (ticket_order_id);

ALTER TABLE public.order_pack_credits ENABLE ROW LEVEL SECURITY;

-- Clients read only their own credits (edge functions use the service role and bypass RLS).
CREATE POLICY "Users can view their own pack credits"
ON public.order_pack_credits FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Venue owners/managers can see credits issued for their venue (dashboards / refunds).
CREATE POLICY "Owners can view their venue pack credits"
ON public.order_pack_credits FOR SELECT
USING (public.is_venue_owner(auth.uid(), venue_id) OR public.can_manage_venue(auth.uid(), venue_id));

-- =====================================================================
-- RPC: get_guest_list_by_token  (used by the public GuestListSignup page)
-- SECURITY DEFINER so a share_token holder can read its guest list WITHOUT
-- a public SELECT policy on guest_lists (avoids share_token enumeration).
-- Mirrors the is_active filter used by the event_id lookup path in the UI.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_guest_list_by_token(_token text)
RETURNS SETOF public.guest_lists
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.guest_lists
  WHERE share_token = _token
    AND is_active = true
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_guest_list_by_token(text) TO anon, authenticated;
