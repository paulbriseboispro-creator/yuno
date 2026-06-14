-- 1) Realtime Channel authorization: replace blanket deny with scoped topic policies
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname = 'Deny broadcast/presence by default'
  ) THEN
    DROP POLICY "Deny broadcast/presence by default" ON realtime.messages;
  END IF;
END $$;

DROP POLICY IF EXISTS "Authenticated users can subscribe to scoped realtime topics" ON realtime.messages;
DROP POLICY IF EXISTS "Authenticated users can publish to scoped realtime topics" ON realtime.messages;

CREATE POLICY "Authenticated users can subscribe to scoped realtime topics"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  -- User-owned private topics: user:<uuid> or user:<uuid>:...
  topic = ('user:' || auth.uid()::text)
  OR topic LIKE ('user:' || auth.uid()::text || ':%')
  OR topic = ('users:' || auth.uid()::text)
  OR topic LIKE ('users:' || auth.uid()::text || ':%')

  -- Venue-scoped topics: venue:<venue_id> or venue:<venue_id>:...
  OR (
    topic LIKE 'venue:%'
    AND (
      public.can_manage_venue(auth.uid(), split_part(topic, ':', 2))
      OR public.is_venue_staff(auth.uid(), split_part(topic, ':', 2))
      OR public.is_super_admin()
    )
  )

  -- Event-scoped topics: event:<event_uuid> or event:<event_uuid>:...
  OR (
    topic LIKE 'event:%'
    AND (
      public.is_event_partner_organizer(auth.uid(), split_part(topic, ':', 2)::uuid)
      OR public.can_manage_event_tables(auth.uid(), split_part(topic, ':', 2)::uuid)
      OR public.is_super_admin()
    )
  )

  -- VIP order tracking topic used by the app: vip_order_tracking_<reservation_uuid>
  OR (
    topic LIKE 'vip_order_tracking_%'
    AND EXISTS (
      SELECT 1
      FROM public.table_reservations tr
      LEFT JOIN public.table_zones tz ON tz.id = tr.zone_id
      LEFT JOIN public.events e ON e.id = tr.event_id
      WHERE tr.id = replace(topic, 'vip_order_tracking_', '')::uuid
        AND (
          tr.user_id = auth.uid()
          OR public.can_manage_venue(auth.uid(), COALESCE(tz.venue_id, e.venue_id, e.partner_venue_id))
          OR public.is_venue_staff(auth.uid(), COALESCE(tz.venue_id, e.venue_id, e.partner_venue_id))
          OR public.is_super_admin()
        )
    )
  )
);

CREATE POLICY "Authenticated users can publish to scoped realtime topics"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  topic = ('user:' || auth.uid()::text)
  OR topic LIKE ('user:' || auth.uid()::text || ':%')
  OR topic = ('users:' || auth.uid()::text)
  OR topic LIKE ('users:' || auth.uid()::text || ':%')
  OR (
    topic LIKE 'venue:%'
    AND (
      public.can_manage_venue(auth.uid(), split_part(topic, ':', 2))
      OR public.is_venue_staff(auth.uid(), split_part(topic, ':', 2))
      OR public.is_super_admin()
    )
  )
  OR (
    topic LIKE 'event:%'
    AND (
      public.is_event_partner_organizer(auth.uid(), split_part(topic, ':', 2)::uuid)
      OR public.can_manage_event_tables(auth.uid(), split_part(topic, ':', 2)::uuid)
      OR public.is_super_admin()
    )
  )
);

-- 2) Stop public bucket listing while preserving direct public object URLs.
DROP POLICY IF EXISTS "Public read campaign assets" ON storage.objects;
DROP POLICY IF EXISTS "Drink images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Email assets public read" ON storage.objects;
DROP POLICY IF EXISTS "Event images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Public read event posters" ON storage.objects;
DROP POLICY IF EXISTS "Floor plans are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Organization assets are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Managers can view venue assets" ON storage.objects;
DROP POLICY IF EXISTS "Venue assets are publicly accessible" ON storage.objects;

-- 3) Explicit deny policies for client access to internal tables with RLS but no policies.
DROP POLICY IF EXISTS "No client access to guest claim OTPs" ON public.guest_claim_otps;
CREATE POLICY "No client access to guest claim OTPs"
ON public.guest_claim_otps
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "No client access to pin reset tokens" ON public.pin_reset_tokens;
CREATE POLICY "No client access to pin reset tokens"
ON public.pin_reset_tokens
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "No direct client access to ticket reservations" ON public.ticket_reservations;
CREATE POLICY "No direct client access to ticket reservations"
ON public.ticket_reservations
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

-- 4) Reduce exposed SECURITY DEFINER surface area.
-- Anonymous users should not directly execute privileged helpers/RPCs.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- Keep only intentionally public token flows callable from the anonymous API.
-- These functions validate opaque tokens and do not expose broad listings.
GRANT EXECUTE ON FUNCTION public.get_guest_list_by_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public.preview_unsubscribe(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.unsubscribe_by_token(uuid) TO anon;

-- Server-only mutation helpers used by backend functions should not be directly callable by clients.
REVOKE EXECUTE ON FUNCTION public.add_sms_credits(uuid, integer, public.sms_credit_tx_type, uuid, text, text, text, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_sms_credits(uuid, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_sms_credits(uuid, integer, uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_or_create_sms_balance(text, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.award_loyalty_points(text, uuid, numeric, text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_promoter_conversion(uuid, text, numeric, uuid, uuid, uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_analytics_daily_rollup() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_analytics_rollup() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_invoices() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_visitor_events() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_mfa_pending() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_stale_live_pings() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.archive_expired_event_orders() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_stale_ticket_reservations() FROM anon, authenticated;

-- Harden direct authenticated RPCs with in-function authorization where they are used by the UI.
CREATE OR REPLACE FUNCTION public.get_visitor_stats(
  p_venue_id text,
  p_start timestamp with time zone,
  p_end timestamp with time zone,
  p_compare_start timestamp with time zone,
  p_compare_end timestamp with time zone
)
RETURNS TABLE(current_visits bigint, current_converted bigint, previous_visits bigint, previous_converted bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.can_manage_venue(auth.uid(), p_venue_id) OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.visitor_sessions WHERE venue_id = p_venue_id AND visited_at >= p_start AND visited_at < p_end),
    (SELECT COUNT(*) FROM public.visitor_sessions WHERE venue_id = p_venue_id AND visited_at >= p_start AND visited_at < p_end AND completed_order = true),
    (SELECT COUNT(*) FROM public.visitor_sessions WHERE venue_id = p_venue_id AND visited_at >= p_compare_start AND visited_at < p_compare_end),
    (SELECT COUNT(*) FROM public.visitor_sessions WHERE venue_id = p_venue_id AND visited_at >= p_compare_start AND visited_at < p_compare_end AND completed_order = true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_maintenance_password(new_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF new_password IS NULL OR length(new_password) < 8 OR length(new_password) > 200 THEN
    RAISE EXCEPTION 'Invalid password length';
  END IF;

  UPDATE public.app_settings
  SET maintenance_password_hash = public.hash_maintenance_password(new_password),
      maintenance_password = NULL,
      updated_at = now()
  WHERE id = 'global';
END;
$function$;

CREATE OR REPLACE FUNCTION public.calculate_client_scores(p_venue_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_spend_weight numeric;
  v_visit_weight numeric;
  v_vip_weight numeric;
  v_event_weight numeric;
  v_recency_enabled boolean;
  v_recency_days integer;
BEGIN
  IF NOT (public.can_manage_venue(auth.uid(), p_venue_id) OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT COALESCE(spend_weight, 1.0), COALESCE(visit_weight, 0.5), COALESCE(vip_weight, 2.0), COALESCE(event_weight, 0.3), COALESCE(recency_enabled, true), COALESCE(recency_days, 30)
  INTO v_spend_weight, v_visit_weight, v_vip_weight, v_event_weight, v_recency_enabled, v_recency_days
  FROM public.leaderboard_settings
  WHERE venue_id = p_venue_id;

  IF NOT FOUND THEN
    v_spend_weight := 1.0;
    v_visit_weight := 0.5;
    v_vip_weight := 2.0;
    v_event_weight := 0.3;
    v_recency_enabled := true;
    v_recency_days := 30;
  END IF;

  INSERT INTO public.client_scores (user_id, venue_id, spend_score, visit_score, vip_score, event_score, recency_boost, total_score, monthly_score, yearly_score, last_activity_at, updated_at)
  SELECT vc.user_id, vc.venue_id,
         COALESCE(vc.total_spent, 0) * v_spend_weight,
         (COALESCE(vc.order_count, 0) + COALESCE(vc.ticket_count, 0)) * v_visit_weight,
         COALESCE(vc.table_count, 0) * v_vip_weight * 100,
         COALESCE(vc.ticket_count, 0) * v_event_weight * 10,
         CASE WHEN v_recency_enabled AND vc.last_visit_at > now() - (v_recency_days || ' days')::interval THEN (COALESCE(vc.total_spent, 0) * v_spend_weight) * 0.2 ELSE 0 END,
         (COALESCE(vc.total_spent, 0) * v_spend_weight) + ((COALESCE(vc.order_count, 0) + COALESCE(vc.ticket_count, 0)) * v_visit_weight) + (COALESCE(vc.table_count, 0) * v_vip_weight * 100) + (COALESCE(vc.ticket_count, 0) * v_event_weight * 10) + CASE WHEN v_recency_enabled AND vc.last_visit_at > now() - (v_recency_days || ' days')::interval THEN (COALESCE(vc.total_spent, 0) * v_spend_weight) * 0.2 ELSE 0 END,
         CASE WHEN vc.last_visit_at >= date_trunc('month', now()) THEN (COALESCE(vc.total_spent, 0) * v_spend_weight) * 0.5 ELSE 0 END,
         CASE WHEN vc.last_visit_at >= date_trunc('year', now()) THEN (COALESCE(vc.total_spent, 0) * v_spend_weight) * 0.8 ELSE 0 END,
         vc.last_visit_at,
         now()
  FROM public.venue_customers vc
  WHERE vc.venue_id = p_venue_id AND vc.user_id IS NOT NULL
  ON CONFLICT (user_id, venue_id) DO UPDATE SET
    spend_score = EXCLUDED.spend_score,
    visit_score = EXCLUDED.visit_score,
    vip_score = EXCLUDED.vip_score,
    event_score = EXCLUDED.event_score,
    recency_boost = EXCLUDED.recency_boost,
    total_score = EXCLUDED.total_score,
    monthly_score = EXCLUDED.monthly_score,
    yearly_score = EXCLUDED.yearly_score,
    last_activity_at = EXCLUDED.last_activity_at,
    updated_at = now();

  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY total_score DESC) as new_rank
    FROM public.client_scores WHERE venue_id = p_venue_id
  )
  UPDATE public.client_scores cs SET rank = r.new_rank FROM ranked r WHERE cs.id = r.id;

  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY monthly_score DESC) as new_rank
    FROM public.client_scores WHERE venue_id = p_venue_id AND monthly_score > 0
  )
  UPDATE public.client_scores cs SET monthly_rank = r.new_rank FROM ranked r WHERE cs.id = r.id;

  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY yearly_score DESC) as new_rank
    FROM public.client_scores WHERE venue_id = p_venue_id AND yearly_score > 0
  )
  UPDATE public.client_scores cs SET yearly_rank = r.new_rank FROM ranked r WHERE cs.id = r.id;
END;
$function$;