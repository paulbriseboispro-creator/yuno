
-- ============================================================
-- 1. email_campaigns
-- ============================================================
CREATE TABLE public.email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('promotional','informational')),
  subject text NOT NULL,
  preheader text,
  blocks_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  html_body text,
  audience_type text CHECK (audience_type IN ('all_subscribers','event_subscribers','event_buyers')),
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent','failed')),
  scheduled_at timestamptz,
  sent_at timestamptz,
  recipients_count integer NOT NULL DEFAULT 0,
  opens_count integer NOT NULL DEFAULT 0,
  clicks_count integer NOT NULL DEFAULT 0,
  unsubscribes_count integer NOT NULL DEFAULT 0,
  error_message text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_campaigns_venue ON public.email_campaigns(venue_id);
CREATE INDEX idx_email_campaigns_status_scheduled ON public.email_campaigns(status, scheduled_at) WHERE status = 'scheduled';

ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Venue owners manage email campaigns"
  ON public.email_campaigns FOR ALL
  USING (public.is_venue_owner(auth.uid(), venue_id) OR public.is_super_admin())
  WITH CHECK (public.is_venue_owner(auth.uid(), venue_id) OR public.is_super_admin());

CREATE TRIGGER trg_email_campaigns_updated_at
  BEFORE UPDATE ON public.email_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 2. newsletter_subscriptions
-- ============================================================
CREATE TABLE public.newsletter_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  venue_id text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  email text NOT NULL,
  opted_in boolean NOT NULL DEFAULT true,
  unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid(),
  opted_out_at timestamptz,
  source text DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(email, venue_id),
  UNIQUE(unsubscribe_token)
);

CREATE INDEX idx_newsletter_subs_venue_optin ON public.newsletter_subscriptions(venue_id, opted_in);
CREATE INDEX idx_newsletter_subs_email ON public.newsletter_subscriptions(email);

ALTER TABLE public.newsletter_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Venue owners view newsletter subs"
  ON public.newsletter_subscriptions FOR SELECT
  USING (public.is_venue_owner(auth.uid(), venue_id) OR public.is_super_admin());

CREATE POLICY "Users view own subs"
  ON public.newsletter_subscriptions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users update own subs"
  ON public.newsletter_subscriptions FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Venue owners manage subs"
  ON public.newsletter_subscriptions FOR ALL
  USING (public.is_venue_owner(auth.uid(), venue_id) OR public.is_super_admin())
  WITH CHECK (public.is_venue_owner(auth.uid(), venue_id) OR public.is_super_admin());

CREATE TRIGGER trg_newsletter_subs_updated_at
  BEFORE UPDATE ON public.newsletter_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 3. email_campaign_events
-- ============================================================
CREATE TABLE public.email_campaign_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('sent','delivered','opened','clicked','bounced','complained','failed')),
  resend_email_id text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaign_events_campaign ON public.email_campaign_events(campaign_id, event_type);
CREATE INDEX idx_campaign_events_created ON public.email_campaign_events(created_at);

ALTER TABLE public.email_campaign_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Venue owners view campaign events"
  ON public.email_campaign_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.email_campaigns c
      WHERE c.id = campaign_id
        AND (public.is_venue_owner(auth.uid(), c.venue_id) OR public.is_super_admin())
    )
  );

-- ============================================================
-- 4. Auto-subscribe trigger sur tickets et table_reservations
-- ============================================================
CREATE OR REPLACE FUNCTION public.auto_subscribe_newsletter_on_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue_id text;
  v_email text;
  v_user_id uuid;
  v_optin boolean;
BEGIN
  -- Determine venue, email, user, opt-in based on table
  IF TG_TABLE_NAME = 'tickets' THEN
    v_email := NEW.user_email;
    v_user_id := NEW.user_id;
    v_optin := COALESCE(NEW.newsletter_opt_in, false);
    SELECT venue_id INTO v_venue_id FROM public.events WHERE id = NEW.event_id;
  ELSIF TG_TABLE_NAME = 'table_reservations' THEN
    v_email := NEW.user_email;
    v_user_id := NEW.user_id;
    v_optin := COALESCE(NEW.newsletter_opt_in, false);
    SELECT tz.venue_id INTO v_venue_id
    FROM public.table_zones tz WHERE tz.id = NEW.zone_id;
  END IF;

  IF v_optin AND v_email IS NOT NULL AND v_venue_id IS NOT NULL THEN
    INSERT INTO public.newsletter_subscriptions (user_id, venue_id, email, opted_in, source)
    VALUES (v_user_id, v_venue_id, LOWER(v_email), true, 'ticket_purchase')
    ON CONFLICT (email, venue_id) DO UPDATE
      SET opted_in = true,
          opted_out_at = NULL,
          user_id = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
          updated_at = now()
      WHERE public.newsletter_subscriptions.opted_in = false;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tickets_auto_subscribe
  AFTER INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.auto_subscribe_newsletter_on_purchase();

CREATE TRIGGER trg_reservations_auto_subscribe
  AFTER INSERT ON public.table_reservations
  FOR EACH ROW EXECUTE FUNCTION public.auto_subscribe_newsletter_on_purchase();

-- ============================================================
-- 5. RPC : count_campaign_recipients
-- ============================================================
CREATE OR REPLACE FUNCTION public.count_campaign_recipients(
  p_venue_id text,
  p_type text,
  p_audience_type text,
  p_event_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF NOT (public.is_venue_owner(auth.uid(), p_venue_id) OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_type = 'promotional' AND p_audience_type = 'all_subscribers' THEN
    SELECT COUNT(*) INTO v_count FROM public.newsletter_subscriptions
    WHERE venue_id = p_venue_id AND opted_in = true;
  ELSIF p_type = 'promotional' AND p_audience_type = 'event_subscribers' AND p_event_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT LOWER(t.user_email)) INTO v_count
    FROM public.tickets t
    JOIN public.newsletter_subscriptions ns ON LOWER(ns.email) = LOWER(t.user_email) AND ns.venue_id = p_venue_id
    WHERE t.event_id = p_event_id AND t.status = 'paid' AND ns.opted_in = true;
  ELSIF p_type = 'informational' AND p_audience_type = 'event_buyers' AND p_event_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT LOWER(user_email)) INTO v_count
    FROM public.tickets
    WHERE event_id = p_event_id AND status = 'paid' AND user_email IS NOT NULL;
  END IF;

  RETURN v_count;
END;
$$;

-- ============================================================
-- 6. RPC : unsubscribe_by_token (public, security definer)
-- ============================================================
CREATE OR REPLACE FUNCTION public.unsubscribe_by_token(p_token uuid)
RETURNS TABLE(success boolean, venue_name text, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub_id uuid;
  v_email text;
  v_venue_name text;
BEGIN
  SELECT ns.id, ns.email, v.name
    INTO v_sub_id, v_email, v_venue_name
  FROM public.newsletter_subscriptions ns
  JOIN public.venues v ON v.id = ns.venue_id
  WHERE ns.unsubscribe_token = p_token
  LIMIT 1;

  IF v_sub_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;

  UPDATE public.newsletter_subscriptions
  SET opted_in = false, opted_out_at = now(), updated_at = now()
  WHERE id = v_sub_id;

  RETURN QUERY SELECT true, v_venue_name, v_email;
END;
$$;

-- ============================================================
-- 7. RPC : preview_unsubscribe (lecture seule)
-- ============================================================
CREATE OR REPLACE FUNCTION public.preview_unsubscribe(p_token uuid)
RETURNS TABLE(venue_name text, email text, already_unsubscribed boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.name, ns.email, NOT ns.opted_in
  FROM public.newsletter_subscriptions ns
  JOIN public.venues v ON v.id = ns.venue_id
  WHERE ns.unsubscribe_token = p_token
  LIMIT 1;
$$;

-- ============================================================
-- 8. Storage bucket for campaign assets
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('campaign-assets', 'campaign-assets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read campaign assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'campaign-assets');

CREATE POLICY "Venue owners upload campaign assets"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'campaign-assets'
    AND auth.uid() IS NOT NULL
  );

CREATE POLICY "Venue owners delete own campaign assets"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'campaign-assets'
    AND auth.uid() IS NOT NULL
  );

-- ============================================================
-- 9. Backfill : import existing newsletter opt-ins
-- ============================================================
INSERT INTO public.newsletter_subscriptions (user_id, venue_id, email, opted_in, source)
SELECT DISTINCT ON (LOWER(t.user_email), e.venue_id)
  t.user_id, e.venue_id, LOWER(t.user_email), true, 'ticket_purchase'
FROM public.tickets t
JOIN public.events e ON e.id = t.event_id
WHERE t.newsletter_opt_in = true
  AND t.user_email IS NOT NULL
  AND e.venue_id IS NOT NULL
ON CONFLICT (email, venue_id) DO NOTHING;

INSERT INTO public.newsletter_subscriptions (user_id, venue_id, email, opted_in, source)
SELECT DISTINCT ON (LOWER(tr.user_email), tz.venue_id)
  tr.user_id, tz.venue_id, LOWER(tr.user_email), true, 'ticket_purchase'
FROM public.table_reservations tr
JOIN public.table_zones tz ON tz.id = tr.zone_id
WHERE tr.newsletter_opt_in = true
  AND tr.user_email IS NOT NULL
ON CONFLICT (email, venue_id) DO NOTHING;
