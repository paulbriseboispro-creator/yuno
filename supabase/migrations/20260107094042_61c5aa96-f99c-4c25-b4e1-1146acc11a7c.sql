-- Add 'promoter' to the app_role enum
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'promoter';

-- Create promoters table
CREATE TABLE public.promoters (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  venue_id text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  promo_code text NOT NULL,
  instagram_url text,
  whatsapp_number text,
  iban text,
  bic text,
  ticket_commission_type text NOT NULL DEFAULT 'percentage' CHECK (ticket_commission_type IN ('fixed', 'percentage')),
  ticket_commission_value numeric NOT NULL DEFAULT 0,
  table_commission_type text NOT NULL DEFAULT 'percentage' CHECK (table_commission_type IN ('fixed', 'percentage')),
  table_commission_value numeric NOT NULL DEFAULT 0,
  pending_amount numeric NOT NULL DEFAULT 0,
  total_paid numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(venue_id, promo_code),
  UNIQUE(user_id, venue_id)
);

-- Create promoter_clicks table for tracking link clicks
CREATE TABLE public.promoter_clicks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  promoter_id uuid NOT NULL REFERENCES public.promoters(id) ON DELETE CASCADE,
  ip_hash text,
  user_agent text,
  referrer text,
  clicked_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create promoter_conversions table for tracking sales
CREATE TABLE public.promoter_conversions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  promoter_id uuid NOT NULL REFERENCES public.promoters(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  table_reservation_id uuid REFERENCES public.table_reservations(id) ON DELETE SET NULL,
  conversion_type text NOT NULL CHECK (conversion_type IN ('order', 'ticket', 'table')),
  amount numeric NOT NULL DEFAULT 0,
  commission numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create promoter_announcements table for club announcements
CREATE TABLE public.promoter_announcements (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  venue_id text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  title text NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create promoter_messages table for direct messaging
CREATE TABLE public.promoter_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  promoter_id uuid NOT NULL REFERENCES public.promoters(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  is_from_club boolean NOT NULL DEFAULT false,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.promoters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promoter_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promoter_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promoter_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promoter_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for promoters table
CREATE POLICY "Owners can manage their venue promoters"
ON public.promoters FOR ALL
USING (
  has_role(auth.uid(), 'owner'::app_role) AND is_venue_owner(auth.uid(), venue_id)
)
WITH CHECK (
  has_role(auth.uid(), 'owner'::app_role) AND is_venue_owner(auth.uid(), venue_id)
);

CREATE POLICY "Promoters can view their own profile"
ON public.promoters FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Promoters can update their own IBAN"
ON public.promoters FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Super admins can manage all promoters"
ON public.promoters FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- RLS Policies for promoter_clicks table
CREATE POLICY "Anyone can insert clicks"
ON public.promoter_clicks FOR INSERT
WITH CHECK (true);

CREATE POLICY "Owners can view their promoters clicks"
ON public.promoter_clicks FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.promoters p
    WHERE p.id = promoter_clicks.promoter_id
    AND is_venue_owner(auth.uid(), p.venue_id)
  )
);

CREATE POLICY "Promoters can view their own clicks"
ON public.promoter_clicks FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.promoters p
    WHERE p.id = promoter_clicks.promoter_id
    AND p.user_id = auth.uid()
  )
);

CREATE POLICY "Super admins can manage all clicks"
ON public.promoter_clicks FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- RLS Policies for promoter_conversions table
CREATE POLICY "Owners can view their promoters conversions"
ON public.promoter_conversions FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.promoters p
    WHERE p.id = promoter_conversions.promoter_id
    AND is_venue_owner(auth.uid(), p.venue_id)
  )
);

CREATE POLICY "Owners can update conversions status"
ON public.promoter_conversions FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.promoters p
    WHERE p.id = promoter_conversions.promoter_id
    AND is_venue_owner(auth.uid(), p.venue_id)
  )
);

CREATE POLICY "Promoters can view their own conversions"
ON public.promoter_conversions FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.promoters p
    WHERE p.id = promoter_conversions.promoter_id
    AND p.user_id = auth.uid()
  )
);

CREATE POLICY "Super admins can manage all conversions"
ON public.promoter_conversions FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- RLS Policies for promoter_announcements table
CREATE POLICY "Owners can manage their venue announcements"
ON public.promoter_announcements FOR ALL
USING (
  has_role(auth.uid(), 'owner'::app_role) AND is_venue_owner(auth.uid(), venue_id)
)
WITH CHECK (
  has_role(auth.uid(), 'owner'::app_role) AND is_venue_owner(auth.uid(), venue_id)
);

CREATE POLICY "Promoters can view their venue announcements"
ON public.promoter_announcements FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.promoters p
    WHERE p.venue_id = promoter_announcements.venue_id
    AND p.user_id = auth.uid()
  )
);

CREATE POLICY "Super admins can manage all announcements"
ON public.promoter_announcements FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- RLS Policies for promoter_messages table
CREATE POLICY "Owners can manage messages with their promoters"
ON public.promoter_messages FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.promoters p
    WHERE p.id = promoter_messages.promoter_id
    AND is_venue_owner(auth.uid(), p.venue_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.promoters p
    WHERE p.id = promoter_messages.promoter_id
    AND is_venue_owner(auth.uid(), p.venue_id)
  )
);

CREATE POLICY "Promoters can view and send their own messages"
ON public.promoter_messages FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.promoters p
    WHERE p.id = promoter_messages.promoter_id
    AND p.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.promoters p
    WHERE p.id = promoter_messages.promoter_id
    AND p.user_id = auth.uid()
  )
);

CREATE POLICY "Super admins can manage all messages"
ON public.promoter_messages FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- Create indexes for performance
CREATE INDEX idx_promoters_venue_id ON public.promoters(venue_id);
CREATE INDEX idx_promoters_user_id ON public.promoters(user_id);
CREATE INDEX idx_promoters_promo_code ON public.promoters(promo_code);
CREATE INDEX idx_promoter_clicks_promoter_id ON public.promoter_clicks(promoter_id);
CREATE INDEX idx_promoter_clicks_clicked_at ON public.promoter_clicks(clicked_at);
CREATE INDEX idx_promoter_conversions_promoter_id ON public.promoter_conversions(promoter_id);
CREATE INDEX idx_promoter_conversions_status ON public.promoter_conversions(status);
CREATE INDEX idx_promoter_messages_promoter_id ON public.promoter_messages(promoter_id);
CREATE INDEX idx_promoter_announcements_venue_id ON public.promoter_announcements(venue_id);

-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.promoter_messages;

-- Create trigger for updated_at
CREATE TRIGGER update_promoters_updated_at
BEFORE UPDATE ON public.promoters
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_promoter_announcements_updated_at
BEFORE UPDATE ON public.promoter_announcements
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();