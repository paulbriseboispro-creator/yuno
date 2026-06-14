
-- Add cloakroom role to enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'cloakroom';

-- Add cloakroom_price to venues
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS cloakroom_price NUMERIC DEFAULT 4;

-- Table: ticket upsell offers (owner configures these)
CREATE TABLE public.ticket_upsell_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id TEXT NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  offer_type TEXT NOT NULL CHECK (offer_type IN ('drink_pack', 'single_drink_discount', 'cloakroom', 'drink_combo')),
  name TEXT NOT NULL,
  description TEXT,
  drink_count INTEGER,
  pack_price NUMERIC,
  original_price NUMERIC,
  discounted_price NUMERIC,
  regular_price NUMERIC,
  cloakroom_price NUMERIC,
  cloakroom_regular_price NUMERIC,
  combo_qty INTEGER,
  combo_discount_percent NUMERIC,
  allowed_collections TEXT[],
  is_active BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ticket_upsell_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can manage their venue ticket upsell offers"
ON public.ticket_upsell_offers FOR ALL
USING (public.is_venue_owner(auth.uid(), venue_id))
WITH CHECK (public.is_venue_owner(auth.uid(), venue_id));

CREATE POLICY "Managers can manage ticket upsell offers"
ON public.ticket_upsell_offers FOR ALL
USING (public.can_manage_venue(auth.uid(), venue_id))
WITH CHECK (public.can_manage_venue(auth.uid(), venue_id));

CREATE POLICY "Active offers are readable by authenticated users"
ON public.ticket_upsell_offers FOR SELECT
TO authenticated
USING (is_active = true);

-- Table: ticket upsell selections (what client purchased)
CREATE TABLE public.ticket_upsell_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  offer_id UUID NOT NULL REFERENCES public.ticket_upsell_offers(id),
  offer_type TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  total_price NUMERIC NOT NULL DEFAULT 0,
  cloakroom_number TEXT,
  cloakroom_deposited BOOLEAN NOT NULL DEFAULT false,
  cloakroom_retrieved BOOLEAN NOT NULL DEFAULT false,
  cloakroom_deposited_at TIMESTAMPTZ,
  cloakroom_retrieved_at TIMESTAMPTZ,
  credits_remaining INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ticket_upsell_selections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own upsell selections"
ON public.ticket_upsell_selections FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t WHERE t.id = ticket_id AND t.user_id = auth.uid()
  )
);

CREATE POLICY "Venue staff can view and update upsell selections"
ON public.ticket_upsell_selections FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.id = ticket_id
    AND public.is_venue_staff(auth.uid(), e.venue_id)
  )
);

CREATE POLICY "Venue owners can manage upsell selections"
ON public.ticket_upsell_selections FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.id = ticket_id
    AND public.is_venue_owner(auth.uid(), e.venue_id)
  )
);

-- Table: cloakroom transactions (on-site payments)
CREATE TABLE public.cloakroom_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id TEXT NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id),
  ticket_id UUID REFERENCES public.tickets(id),
  attendee_qr TEXT,
  customer_name TEXT,
  cloakroom_number TEXT NOT NULL,
  items_count INTEGER NOT NULL DEFAULT 1,
  price NUMERIC NOT NULL DEFAULT 0,
  paid_on_site BOOLEAN NOT NULL DEFAULT false,
  payment_confirmed BOOLEAN NOT NULL DEFAULT false,
  deposited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retrieved BOOLEAN NOT NULL DEFAULT false,
  retrieved_at TIMESTAMPTZ,
  staff_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cloakroom_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Venue staff can manage cloakroom transactions"
ON public.cloakroom_transactions FOR ALL
TO authenticated
USING (public.is_venue_staff(auth.uid(), venue_id) OR public.is_venue_owner(auth.uid(), venue_id))
WITH CHECK (public.is_venue_staff(auth.uid(), venue_id) OR public.is_venue_owner(auth.uid(), venue_id));

CREATE POLICY "Venue owners can view cloakroom transactions"
ON public.cloakroom_transactions FOR SELECT
TO authenticated
USING (public.is_venue_owner(auth.uid(), venue_id));
