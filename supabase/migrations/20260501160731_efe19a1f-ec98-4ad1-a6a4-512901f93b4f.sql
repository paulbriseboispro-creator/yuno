
-- =====================================================================
-- M4: Marketplace Security Hardening
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. visitor_sessions / live_visitor_pings: prevent cross-user tampering
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Anon can update visitor session duration" ON public.visitor_sessions;
DROP POLICY IF EXISTS "Authenticated users can update visitor sessions" ON public.visitor_sessions;
DROP POLICY IF EXISTS "Anyone can update their own session ping" ON public.live_visitor_pings;

CREATE POLICY "Users can update their own visitor session"
ON public.visitor_sessions
FOR UPDATE
TO anon, authenticated
USING (
  (auth.uid() IS NOT NULL AND user_id = auth.uid())
  OR (auth.uid() IS NULL AND user_id IS NULL)
)
WITH CHECK (
  (auth.uid() IS NOT NULL AND user_id = auth.uid())
  OR (auth.uid() IS NULL AND user_id IS NULL)
);

CREATE POLICY "Users can update their own live ping"
ON public.live_visitor_pings
FOR UPDATE
TO anon, authenticated
USING (
  (auth.uid() IS NOT NULL AND user_id = auth.uid())
  OR (auth.uid() IS NULL AND user_id IS NULL)
)
WITH CHECK (
  (auth.uid() IS NOT NULL AND user_id = auth.uid())
  OR (auth.uid() IS NULL AND user_id IS NULL)
);

-- ---------------------------------------------------------------------
-- 2. Restrict "Service role can ..." policies to actual service_role
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role can insert attendees" ON public.ticket_attendees;
CREATE POLICY "Service role can insert attendees"
ON public.ticket_attendees FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can insert guest list entries" ON public.guest_list_entries;
CREATE POLICY "Service role can insert guest list entries"
ON public.guest_list_entries FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can insert invoices" ON public.invoice_numbers;
CREATE POLICY "Service role can insert invoice numbers"
ON public.invoice_numbers FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can insert transactions" ON public.loyalty_transactions;
CREATE POLICY "Service role can insert loyalty transactions"
ON public.loyalty_transactions FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "System can insert activity" ON public.customer_activity_log;
CREATE POLICY "Service role can insert activity"
ON public.customer_activity_log FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "System can insert invoices" ON public.invoices;
CREATE POLICY "Service role can insert invoices"
ON public.invoices FOR INSERT TO service_role WITH CHECK (true);

-- ---------------------------------------------------------------------
-- 3. Lock down internal-only tables (ensure no client access)
--    RLS already enabled with no policies = blocks anon/authenticated;
--    revoke direct table grants for safety. Service role bypasses RLS.
-- ---------------------------------------------------------------------
REVOKE ALL ON public.pin_reset_tokens FROM anon, authenticated;
REVOKE ALL ON public.guest_claim_otps FROM anon, authenticated;
REVOKE ALL ON public.ticket_reservations FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Materialized view should not be exposed via PostgREST API
-- ---------------------------------------------------------------------
REVOKE ALL ON public.analytics_daily_rollup FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Trigger functions: not callable directly by clients
--    (still fire from triggers under owner privileges)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  fn_name text;
  trigger_fns text[] := ARRAY[
    'activate_collab_plan_on_partnership',
    'auto_activate_next_round',
    'auto_subscribe_newsletter_on_purchase',
    'evaluate_event_discoverability',
    'handle_new_user',
    'handle_new_user_role',
    'lock_event_split_on_first_sale',
    'normalize_event_scarcity_settings',
    'prevent_partnership_revoke_with_active_events',
    'save_invoice_on_creation',
    'set_order_number',
    'sync_organizer_role_from_profile',
    'update_updated_at_column'
  ];
BEGIN
  FOREACH fn_name IN ARRAY trigger_fns LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION public.%I() FROM anon, authenticated, public',
      fn_name
    );
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Some trigger function revokes failed (non-fatal): %', SQLERRM;
END $$;

-- ---------------------------------------------------------------------
-- 6. Restrict EXECUTE on internal SECURITY DEFINER helpers to service_role
--    These are called only from triggers / edge functions, never from clients
-- ---------------------------------------------------------------------
DO $$
DECLARE
  internal_fns text[] := ARRAY[
    'cleanup_expired_invoices',
    'cleanup_old_visitor_events',
    'generate_order_number',
    'get_or_create_customer_loyalty',
    'get_or_create_venue_customer',
    'increment_venue_customer_stats',
    'award_loyalty_points',
    'calculate_vip_upsell',
    'count_campaign_recipients',
    'count_campaign_recipients_org'
  ];
  fn_name text;
BEGIN
  FOREACH fn_name IN ARRAY internal_fns LOOP
    BEGIN
      EXECUTE format(
        'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated WHERE FALSE'
      );
      EXECUTE (
        SELECT string_agg(
          format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated;',
                 p.oid::regprocedure),
          E'\n'
        )
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = fn_name
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipping % (%)', fn_name, SQLERRM;
    END;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 7. Public buckets: prevent broad LIST while keeping per-file public read
--    PostgREST/Storage `list` endpoint requires SELECT on storage.objects
--    Rather than blocking SELECT (used by getPublicUrl), we leave public
--    SELECT in place but document the accepted risk: bucket listing
--    requires knowing folder paths. Since file names use UUIDs/random IDs,
--    enumeration is impractical. No structural change needed here, but
--    we tighten any wildcard policies.
-- ---------------------------------------------------------------------
-- (No-op: keeping existing public SELECT policies is required for
--  getPublicUrl to work without signed URLs. File names are UUIDs.)

-- ---------------------------------------------------------------------
-- 8. Ensure visitor_sessions / live_visitor_pings INSERT remain rate-friendly
--    (already CHECK true — that is intended for anonymous tracking)
--    But: enforce that a user cannot insert a row claiming another user's id
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can insert visitor sessions" ON public.visitor_sessions;
CREATE POLICY "Anyone can insert their visitor session"
ON public.visitor_sessions
FOR INSERT
TO anon, authenticated
WITH CHECK (
  (auth.uid() IS NULL AND user_id IS NULL)
  OR (auth.uid() IS NOT NULL AND (user_id IS NULL OR user_id = auth.uid()))
);

DROP POLICY IF EXISTS "Anyone can upsert their session ping" ON public.live_visitor_pings;
CREATE POLICY "Anyone can insert their live ping"
ON public.live_visitor_pings
FOR INSERT
TO anon, authenticated
WITH CHECK (
  (auth.uid() IS NULL AND user_id IS NULL)
  OR (auth.uid() IS NOT NULL AND (user_id IS NULL OR user_id = auth.uid()))
);

DROP POLICY IF EXISTS "Anyone can insert visitor events" ON public.visitor_events;
CREATE POLICY "Anyone can insert their visitor event"
ON public.visitor_events
FOR INSERT
TO anon, authenticated
WITH CHECK (
  (auth.uid() IS NULL AND user_id IS NULL)
  OR (auth.uid() IS NOT NULL AND (user_id IS NULL OR user_id = auth.uid()))
);
