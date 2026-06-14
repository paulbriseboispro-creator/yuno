-- Add Stripe Connect columns to venues table
ALTER TABLE public.venues 
ADD COLUMN IF NOT EXISTS stripe_account_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_onboarding_complete BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS stripe_charges_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS stripe_payouts_enabled BOOLEAN DEFAULT false;

-- Create venue_subscriptions table for 99€/month subscriptions
CREATE TABLE IF NOT EXISTS public.venue_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id TEXT NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT,
  stripe_customer_id TEXT,
  status TEXT DEFAULT 'inactive',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(venue_id)
);

-- Enable RLS on venue_subscriptions
ALTER TABLE public.venue_subscriptions ENABLE ROW LEVEL SECURITY;

-- Owners can view their own venue subscriptions
CREATE POLICY "Owners can view their venue subscriptions"
ON public.venue_subscriptions
FOR SELECT
USING (
  has_role(auth.uid(), 'owner'::app_role) AND 
  is_venue_owner(auth.uid(), venue_id)
);

-- Super admins can manage all subscriptions
CREATE POLICY "Super admins can manage all subscriptions"
ON public.venue_subscriptions
FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- Create trigger for updated_at
CREATE TRIGGER update_venue_subscriptions_updated_at
BEFORE UPDATE ON public.venue_subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();