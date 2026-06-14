-- =============================================
-- LOYALTY & CRM SYSTEM FOR YUNO NIGHTCLUBS
-- =============================================

-- 1. LOYALTY SETTINGS - Per-venue loyalty configuration
CREATE TABLE public.loyalty_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text REFERENCES venues(id) ON DELETE CASCADE NOT NULL UNIQUE,
  is_enabled boolean DEFAULT false,
  points_per_euro numeric DEFAULT 1,
  welcome_bonus integer DEFAULT 0,
  post_visit_notification boolean DEFAULT true,
  post_visit_message text DEFAULT 'Thanks for visiting! You earned {{points}} points.',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. LOYALTY REWARDS - Rewards catalog per venue
CREATE TABLE public.loyalty_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text REFERENCES venues(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  description text,
  points_required integer NOT NULL,
  reward_type text NOT NULL CHECK (reward_type IN ('free_drink', 'discount', 'priority_access', 'vip_perk', 'custom')),
  reward_value jsonb DEFAULT '{}',
  is_active boolean DEFAULT true,
  max_redemptions integer,
  redemption_count integer DEFAULT 0,
  position integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 3. CUSTOMER LOYALTY - Points balance per customer per venue
CREATE TABLE public.customer_loyalty (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_customer_id uuid REFERENCES venue_customers(id) ON DELETE CASCADE NOT NULL,
  venue_id text REFERENCES venues(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  total_points_earned integer DEFAULT 0,
  total_points_spent integer DEFAULT 0,
  current_balance integer DEFAULT 0,
  tier text DEFAULT 'bronze' CHECK (tier IN ('bronze', 'silver', 'gold', 'platinum')),
  last_points_earned_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(venue_id, user_id)
);

-- 4. LOYALTY TRANSACTIONS - Points history
CREATE TABLE public.loyalty_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_loyalty_id uuid REFERENCES customer_loyalty(id) ON DELETE CASCADE NOT NULL,
  venue_id text REFERENCES venues(id) ON DELETE CASCADE NOT NULL,
  transaction_type text NOT NULL CHECK (transaction_type IN ('earn', 'redeem', 'bonus', 'expire', 'adjustment')),
  points integer NOT NULL,
  description text,
  reference_type text,
  reference_id text,
  created_at timestamptz DEFAULT now()
);

-- 5. REWARD REDEMPTIONS - Track redeemed rewards
CREATE TABLE public.reward_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_loyalty_id uuid REFERENCES customer_loyalty(id) ON DELETE CASCADE NOT NULL,
  reward_id uuid REFERENCES loyalty_rewards(id) ON DELETE CASCADE NOT NULL,
  venue_id text REFERENCES venues(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  points_spent integer NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'expired', 'cancelled')),
  qr_code text UNIQUE,
  expires_at timestamptz,
  used_at timestamptz,
  validated_by uuid,
  created_at timestamptz DEFAULT now()
);

-- 6. CRM CAMPAIGNS - Simple notification campaigns
CREATE TABLE public.crm_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text REFERENCES venues(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  target_segment text NOT NULL CHECK (target_segment IN ('all', 'loyal', 'inactive', 'big_spenders', 'new', 'vip', 'custom')),
  segment_config jsonb DEFAULT '{}',
  message text NOT NULL,
  trigger_type text NOT NULL CHECK (trigger_type IN ('manual', 'post_visit', 'inactivity', 'scheduled')),
  trigger_config jsonb DEFAULT '{}',
  is_active boolean DEFAULT true,
  sent_count integer DEFAULT 0,
  last_sent_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 7. CRM NOTIFICATIONS - Sent notifications log
CREATE TABLE public.crm_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text REFERENCES venues(id) ON DELETE CASCADE NOT NULL,
  campaign_id uuid REFERENCES crm_campaigns(id) ON DELETE SET NULL,
  venue_customer_id uuid REFERENCES venue_customers(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  message text NOT NULL,
  title text,
  notification_type text NOT NULL CHECK (notification_type IN ('thank_you', 'loyalty', 'promo', 'reward', 'custom')),
  sent_at timestamptz DEFAULT now(),
  read_at timestamptz,
  metadata jsonb DEFAULT '{}'
);

-- 8. Add columns to venue_customers for CRM enrichment
ALTER TABLE venue_customers 
ADD COLUMN IF NOT EXISTS favorite_drink_category text,
ADD COLUMN IF NOT EXISTS average_spend numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS customer_segment text DEFAULT 'new';

-- =============================================
-- ENABLE RLS ON ALL TABLES
-- =============================================

ALTER TABLE public.loyalty_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_loyalty ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_notifications ENABLE ROW LEVEL SECURITY;

-- =============================================
-- RLS POLICIES - LOYALTY SETTINGS
-- =============================================

CREATE POLICY "Venue owners can manage their loyalty settings"
ON public.loyalty_settings FOR ALL
USING (public.is_venue_owner(auth.uid(), venue_id) OR public.can_manage_venue(auth.uid(), venue_id));

CREATE POLICY "Anyone can read active loyalty settings"
ON public.loyalty_settings FOR SELECT
USING (is_enabled = true);

-- =============================================
-- RLS POLICIES - LOYALTY REWARDS
-- =============================================

CREATE POLICY "Venue owners can manage rewards"
ON public.loyalty_rewards FOR ALL
USING (public.is_venue_owner(auth.uid(), venue_id) OR public.can_manage_venue(auth.uid(), venue_id));

CREATE POLICY "Users can view active rewards for venues"
ON public.loyalty_rewards FOR SELECT
USING (is_active = true);

-- =============================================
-- RLS POLICIES - CUSTOMER LOYALTY
-- =============================================

CREATE POLICY "Users can view their own loyalty"
ON public.customer_loyalty FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Venue owners can view all customer loyalty"
ON public.customer_loyalty FOR SELECT
USING (public.is_venue_owner(auth.uid(), venue_id) OR public.can_manage_venue(auth.uid(), venue_id));

CREATE POLICY "Service role can manage customer loyalty"
ON public.customer_loyalty FOR ALL
USING (true)
WITH CHECK (true);

-- =============================================
-- RLS POLICIES - LOYALTY TRANSACTIONS
-- =============================================

CREATE POLICY "Users can view their own transactions"
ON public.loyalty_transactions FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM customer_loyalty cl
    WHERE cl.id = customer_loyalty_id AND cl.user_id = auth.uid()
  )
);

CREATE POLICY "Venue owners can view venue transactions"
ON public.loyalty_transactions FOR SELECT
USING (public.is_venue_owner(auth.uid(), venue_id) OR public.can_manage_venue(auth.uid(), venue_id));

CREATE POLICY "Service role can insert transactions"
ON public.loyalty_transactions FOR INSERT
WITH CHECK (true);

-- =============================================
-- RLS POLICIES - REWARD REDEMPTIONS
-- =============================================

CREATE POLICY "Users can view and create their own redemptions"
ON public.reward_redemptions FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can redeem rewards"
ON public.reward_redemptions FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Venue staff can view and validate redemptions"
ON public.reward_redemptions FOR ALL
USING (public.is_venue_owner(auth.uid(), venue_id) OR public.can_manage_venue(auth.uid(), venue_id));

-- =============================================
-- RLS POLICIES - CRM CAMPAIGNS
-- =============================================

CREATE POLICY "Venue owners can manage campaigns"
ON public.crm_campaigns FOR ALL
USING (public.is_venue_owner(auth.uid(), venue_id) OR public.can_manage_venue(auth.uid(), venue_id));

-- =============================================
-- RLS POLICIES - CRM NOTIFICATIONS
-- =============================================

CREATE POLICY "Users can view their own notifications"
ON public.crm_notifications FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can mark their notifications as read"
ON public.crm_notifications FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Venue owners can view and send notifications"
ON public.crm_notifications FOR ALL
USING (public.is_venue_owner(auth.uid(), venue_id) OR public.can_manage_venue(auth.uid(), venue_id));

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Function to calculate customer tier based on total spent
CREATE OR REPLACE FUNCTION public.calculate_customer_tier(total_spent numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN total_spent >= 1000 THEN 'platinum'
    WHEN total_spent >= 500 THEN 'gold'
    WHEN total_spent >= 200 THEN 'silver'
    ELSE 'bronze'
  END;
$$;

-- Function to get or create customer loyalty record
CREATE OR REPLACE FUNCTION public.get_or_create_customer_loyalty(
  p_venue_id text,
  p_user_id uuid,
  p_venue_customer_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_loyalty_id UUID;
BEGIN
  -- Try to find existing loyalty record
  SELECT id INTO v_loyalty_id
  FROM customer_loyalty
  WHERE venue_id = p_venue_id AND user_id = p_user_id;
  
  -- If not found, create new
  IF v_loyalty_id IS NULL THEN
    INSERT INTO customer_loyalty (venue_id, user_id, venue_customer_id)
    VALUES (p_venue_id, p_user_id, p_venue_customer_id)
    RETURNING id INTO v_loyalty_id;
  END IF;
  
  RETURN v_loyalty_id;
END;
$$;

-- Function to award loyalty points
CREATE OR REPLACE FUNCTION public.award_loyalty_points(
  p_venue_id text,
  p_user_id uuid,
  p_amount numeric,
  p_reference_type text,
  p_reference_id text,
  p_description text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_loyalty_id UUID;
  v_venue_customer_id UUID;
  v_points_per_euro numeric;
  v_welcome_bonus integer;
  v_is_first_purchase boolean;
  v_points_earned integer;
  v_total_points integer;
  v_is_enabled boolean;
BEGIN
  -- Check if loyalty is enabled for this venue
  SELECT is_enabled, points_per_euro, welcome_bonus INTO v_is_enabled, v_points_per_euro, v_welcome_bonus
  FROM loyalty_settings
  WHERE venue_id = p_venue_id;
  
  -- If not enabled or no settings, return 0
  IF v_is_enabled IS NULL OR v_is_enabled = false THEN
    RETURN 0;
  END IF;
  
  -- Get venue customer id
  SELECT id INTO v_venue_customer_id
  FROM venue_customers
  WHERE venue_id = p_venue_id AND user_id = p_user_id;
  
  IF v_venue_customer_id IS NULL THEN
    RETURN 0;
  END IF;
  
  -- Get or create loyalty record
  SELECT id INTO v_loyalty_id
  FROM customer_loyalty
  WHERE venue_id = p_venue_id AND user_id = p_user_id;
  
  v_is_first_purchase := v_loyalty_id IS NULL;
  
  IF v_loyalty_id IS NULL THEN
    INSERT INTO customer_loyalty (venue_id, user_id, venue_customer_id)
    VALUES (p_venue_id, p_user_id, v_venue_customer_id)
    RETURNING id INTO v_loyalty_id;
  END IF;
  
  -- Calculate points
  v_points_earned := FLOOR(p_amount * COALESCE(v_points_per_euro, 1));
  v_total_points := v_points_earned;
  
  -- Add welcome bonus if first purchase
  IF v_is_first_purchase AND COALESCE(v_welcome_bonus, 0) > 0 THEN
    v_total_points := v_total_points + v_welcome_bonus;
    
    -- Record welcome bonus transaction
    INSERT INTO loyalty_transactions (
      customer_loyalty_id, venue_id, transaction_type, points, description, reference_type, reference_id
    ) VALUES (
      v_loyalty_id, p_venue_id, 'bonus', v_welcome_bonus, 'Welcome bonus', 'welcome', NULL
    );
  END IF;
  
  -- Record earned points transaction
  IF v_points_earned > 0 THEN
    INSERT INTO loyalty_transactions (
      customer_loyalty_id, venue_id, transaction_type, points, description, reference_type, reference_id
    ) VALUES (
      v_loyalty_id, p_venue_id, 'earn', v_points_earned, COALESCE(p_description, 'Purchase'), p_reference_type, p_reference_id
    );
  END IF;
  
  -- Update loyalty balance
  UPDATE customer_loyalty
  SET 
    total_points_earned = total_points_earned + v_total_points,
    current_balance = current_balance + v_total_points,
    last_points_earned_at = now(),
    updated_at = now()
  WHERE id = v_loyalty_id;
  
  -- Update tier based on total spent
  UPDATE customer_loyalty cl
  SET tier = calculate_customer_tier(vc.total_spent)
  FROM venue_customers vc
  WHERE cl.id = v_loyalty_id AND cl.venue_customer_id = vc.id;
  
  RETURN v_total_points;
END;
$$;

-- Trigger to update timestamps
CREATE TRIGGER update_loyalty_settings_updated_at
  BEFORE UPDATE ON public.loyalty_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_customer_loyalty_updated_at
  BEFORE UPDATE ON public.customer_loyalty
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_crm_campaigns_updated_at
  BEFORE UPDATE ON public.crm_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for performance
CREATE INDEX idx_customer_loyalty_venue ON customer_loyalty(venue_id);
CREATE INDEX idx_customer_loyalty_user ON customer_loyalty(user_id);
CREATE INDEX idx_loyalty_transactions_loyalty ON loyalty_transactions(customer_loyalty_id);
CREATE INDEX idx_loyalty_transactions_venue ON loyalty_transactions(venue_id);
CREATE INDEX idx_reward_redemptions_venue ON reward_redemptions(venue_id);
CREATE INDEX idx_reward_redemptions_qr ON reward_redemptions(qr_code);
CREATE INDEX idx_crm_notifications_user ON crm_notifications(user_id);
CREATE INDEX idx_crm_notifications_venue ON crm_notifications(venue_id);