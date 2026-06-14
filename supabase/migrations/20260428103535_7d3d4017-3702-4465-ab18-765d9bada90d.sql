-- 1. email_campaigns
ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.email_campaigns ALTER COLUMN venue_id DROP NOT NULL;
ALTER TABLE public.email_campaigns DROP CONSTRAINT IF EXISTS email_campaigns_owner_check;
ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_owner_check
  CHECK (
    (venue_id IS NOT NULL AND organizer_user_id IS NULL)
    OR (venue_id IS NULL AND organizer_user_id IS NOT NULL)
  );
CREATE INDEX IF NOT EXISTS idx_email_campaigns_organizer
  ON public.email_campaigns(organizer_user_id) WHERE organizer_user_id IS NOT NULL;

-- 2. newsletter_subscriptions
ALTER TABLE public.newsletter_subscriptions
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.newsletter_subscriptions ALTER COLUMN venue_id DROP NOT NULL;
ALTER TABLE public.newsletter_subscriptions DROP CONSTRAINT IF EXISTS newsletter_subscriptions_owner_check;
ALTER TABLE public.newsletter_subscriptions
  ADD CONSTRAINT newsletter_subscriptions_owner_check
  CHECK (
    (venue_id IS NOT NULL AND organizer_user_id IS NULL)
    OR (venue_id IS NULL AND organizer_user_id IS NOT NULL)
  );
ALTER TABLE public.newsletter_subscriptions
  DROP CONSTRAINT IF EXISTS newsletter_subscriptions_email_venue_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_newsletter_subs_email_venue
  ON public.newsletter_subscriptions(email, venue_id) WHERE venue_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_newsletter_subs_email_organizer
  ON public.newsletter_subscriptions(email, organizer_user_id) WHERE organizer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_newsletter_subs_organizer_optin
  ON public.newsletter_subscriptions(organizer_user_id, opted_in) WHERE organizer_user_id IS NOT NULL;

-- 3. RLS
DROP POLICY IF EXISTS "Venue owners manage email campaigns" ON public.email_campaigns;
DROP POLICY IF EXISTS "Owners manage email campaigns" ON public.email_campaigns;
CREATE POLICY "Owners manage email campaigns"
  ON public.email_campaigns FOR ALL
  USING (
    (venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
    OR public.is_super_admin()
  )
  WITH CHECK (
    (venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Venue owners view newsletter subs" ON public.newsletter_subscriptions;
DROP POLICY IF EXISTS "Venue owners manage subs" ON public.newsletter_subscriptions;
DROP POLICY IF EXISTS "Owners view newsletter subs" ON public.newsletter_subscriptions;
DROP POLICY IF EXISTS "Owners manage newsletter subs" ON public.newsletter_subscriptions;
CREATE POLICY "Owners view newsletter subs"
  ON public.newsletter_subscriptions FOR SELECT
  USING (
    (venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
    OR public.is_super_admin()
  );
CREATE POLICY "Owners manage newsletter subs"
  ON public.newsletter_subscriptions FOR ALL
  USING (
    (venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
    OR public.is_super_admin()
  )
  WITH CHECK (
    (venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Venue owners view campaign events" ON public.email_campaign_events;
DROP POLICY IF EXISTS "Owners view campaign events" ON public.email_campaign_events;
CREATE POLICY "Owners view campaign events"
  ON public.email_campaign_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.email_campaigns c
      WHERE c.id = campaign_id
        AND (
          (c.venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), c.venue_id))
          OR (c.organizer_user_id IS NOT NULL AND c.organizer_user_id = auth.uid())
          OR public.is_super_admin()
        )
    )
  );

-- 4. Auto-subscribe trigger
CREATE OR REPLACE FUNCTION public.auto_subscribe_newsletter_on_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue_id text;
  v_organizer_user_id uuid;
  v_email text;
  v_user_id uuid;
  v_optin boolean;
BEGIN
  IF TG_TABLE_NAME = 'tickets' THEN
    v_email := NEW.user_email;
    v_user_id := NEW.user_id;
    v_optin := COALESCE(NEW.newsletter_opt_in, false);
    SELECT venue_id, organizer_user_id INTO v_venue_id, v_organizer_user_id
      FROM public.events WHERE id = NEW.event_id;
  ELSIF TG_TABLE_NAME = 'table_reservations' THEN
    v_email := NEW.user_email;
    v_user_id := NEW.user_id;
    v_optin := COALESCE(NEW.newsletter_opt_in, false);
    SELECT tz.venue_id INTO v_venue_id
      FROM public.table_zones tz WHERE tz.id = NEW.zone_id;
  END IF;

  IF NOT v_optin OR v_email IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_venue_id IS NOT NULL THEN
    INSERT INTO public.newsletter_subscriptions (user_id, venue_id, email, opted_in, source)
    VALUES (v_user_id, v_venue_id, LOWER(v_email), true, 'ticket_purchase')
    ON CONFLICT (email, venue_id) DO UPDATE
      SET opted_in = true, opted_out_at = NULL,
          user_id = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
          updated_at = now()
      WHERE public.newsletter_subscriptions.opted_in = false;
  END IF;

  IF v_organizer_user_id IS NOT NULL AND v_venue_id IS NULL THEN
    INSERT INTO public.newsletter_subscriptions (user_id, organizer_user_id, email, opted_in, source)
    VALUES (v_user_id, v_organizer_user_id, LOWER(v_email), true, 'ticket_purchase')
    ON CONFLICT (email, organizer_user_id) DO UPDATE
      SET opted_in = true, opted_out_at = NULL,
          user_id = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
          updated_at = now()
      WHERE public.newsletter_subscriptions.opted_in = false;
  END IF;

  RETURN NEW;
END;
$$;

-- 5. RPC for organizers
CREATE OR REPLACE FUNCTION public.count_campaign_recipients_org(
  p_organizer_user_id uuid,
  p_type text,
  p_audience_type text,
  p_event_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer := 0;
BEGIN
  IF NOT (p_organizer_user_id = auth.uid() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_type = 'promotional' AND p_audience_type = 'all_subscribers' THEN
    SELECT COUNT(*) INTO v_count FROM public.newsletter_subscriptions
    WHERE organizer_user_id = p_organizer_user_id AND opted_in = true;
  ELSIF p_type = 'promotional' AND p_audience_type = 'event_subscribers' AND p_event_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT LOWER(t.user_email)) INTO v_count
    FROM public.tickets t
    JOIN public.newsletter_subscriptions ns
      ON LOWER(ns.email) = LOWER(t.user_email)
     AND ns.organizer_user_id = p_organizer_user_id
    JOIN public.events e ON e.id = t.event_id
    WHERE t.event_id = p_event_id AND t.status = 'paid' AND ns.opted_in = true
      AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id);
  ELSIF p_type = 'informational' AND p_audience_type = 'event_buyers' AND p_event_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT LOWER(t.user_email)) INTO v_count
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.event_id = p_event_id AND t.status = 'paid' AND t.user_email IS NOT NULL
      AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id);
  END IF;

  RETURN v_count;
END;
$$;

-- 6. preview_unsubscribe — drop & recreate to change return type
DROP FUNCTION IF EXISTS public.preview_unsubscribe(uuid);
CREATE OR REPLACE FUNCTION public.preview_unsubscribe(p_token uuid)
RETURNS TABLE(email text, scope_name text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT ns.email,
         COALESCE(v.name, p.organization_name, 'cet établissement')::text AS scope_name
  FROM public.newsletter_subscriptions ns
  LEFT JOIN public.venues v ON v.id = ns.venue_id
  LEFT JOIN public.profiles p ON p.id = ns.organizer_user_id
  WHERE ns.unsubscribe_token = p_token
  LIMIT 1;
END;
$$;