
-- Table: push_campaigns (admin push notification campaigns)
CREATE TABLE public.push_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT DEFAULT '/',
  segment TEXT NOT NULL DEFAULT 'all',
  sent_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID NOT NULL
);

ALTER TABLE public.push_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can manage push campaigns"
  ON public.push_campaigns FOR ALL
  USING (public.is_super_admin());

-- Table: notification_log (anti-spam tracking)
CREATE TABLE public.notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  notification_type TEXT NOT NULL, -- 'transactional', 'marketing', 'campaign', 'reminder'
  title TEXT,
  sent_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage notification_log"
  ON public.notification_log FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create index for anti-spam queries
CREATE INDEX idx_notification_log_user_sent ON public.notification_log(user_id, sent_at DESC);
CREATE INDEX idx_notification_log_type ON public.notification_log(user_id, notification_type, sent_at DESC);

-- Table: cart_snapshots (track cart for abandonment detection)
CREATE TABLE public.cart_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  cart_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  venue_id UUID,
  event_id UUID,
  snapshot_type TEXT NOT NULL DEFAULT 'drink', -- 'drink' or 'ticket'
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  notified_at TIMESTAMPTZ, -- null = not yet notified
  converted BOOLEAN DEFAULT false
);

ALTER TABLE public.cart_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own cart snapshots"
  ON public.cart_snapshots FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access cart_snapshots"
  ON public.cart_snapshots FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_cart_snapshots_user ON public.cart_snapshots(user_id, updated_at DESC);
CREATE INDEX idx_cart_snapshots_abandonment ON public.cart_snapshots(notified_at, converted, updated_at);
