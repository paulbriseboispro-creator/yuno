-- ============================================================================
-- RLS hardening — re-apply the ghost April batch + two newer RLS holes.
--
-- Root cause: migration 20260422061744 is recorded in schema_migrations as
-- applied but NONE of its effects exist on the live DB (same ghost-migration
-- pattern as the "12 mai" batch). Because that version is already marked
-- applied, `supabase db push` would skip it — so this NEW migration re-applies
-- the same hardening idempotently, and adds two RLS holes found later that the
-- April batch never covered (vip_consumption_facts view + dj_lineup_notifications).
--
-- Everything here is idempotent (DROP POLICY IF EXISTS + CREATE). Safe to run
-- against a DB where some of these already exist.
-- ============================================================================

-- ── 1. event_recap_sent: restrict to service_role only (PII: recipient email) ──
DROP POLICY IF EXISTS "Service role can manage event recap sent" ON public.event_recap_sent;
DROP POLICY IF EXISTS "System can insert recap sent" ON public.event_recap_sent;

CREATE POLICY "Service role can manage event recap sent"
ON public.event_recap_sent
AS PERMISSIVE
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
-- Admin SELECT policy ("Admins can view recap sent") already exists.

-- ── 2. notification_log: drop the world-open policy (mislabelled "Service role") ──
-- service_role already bypasses RLS; TO public granted the whole world CRUD.
DROP POLICY IF EXISTS "Service role can manage notification_log" ON public.notification_log;
-- "Service role full access notification_log" remains, correctly scoped to service_role.

-- ── 3. org_members: drop the public token-lookup policy ──────────────────────
-- Exposed member_email, invitation_token and scanner_pin_hash to anon → account
-- takeover vector. Token verification must go through an edge function (service_role).
DROP POLICY IF EXISTS "Public can verify org member invitation by token" ON public.org_members;

-- ── 4. security_logs: scope owner read access to their own venue's users ─────
DROP POLICY IF EXISTS "Owners can view all security logs" ON public.security_logs;

CREATE POLICY "Owners can view security logs of their venue users"
ON public.security_logs
FOR SELECT
TO authenticated
USING (
  is_super_admin()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.venues v ON v.id = p.venue_id
    WHERE p.id = security_logs.user_id
      AND v.owner_id = auth.uid()
  )
);

-- ── 5. storage: profile-photos ownership check (files stored under <auth.uid()>/…) ──
DROP POLICY IF EXISTS "Users can delete their own profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own profile photos" ON storage.objects;

CREATE POLICY "Users can delete their own profile photos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'profile-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can update their own profile photos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'profile-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'profile-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Authenticated users can upload their own profile photos" ON storage.objects;

CREATE POLICY "Authenticated users can upload their own profile photos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'profile-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- ── 6. vip_consumption_facts: stop leaking every club's bottle-service revenue ──
-- The view was created without security_invoker and owned by a rolbypassrls role,
-- so it bypassed the RLS of vip_consumptions / vip_table_orders / vip_table_order_items
-- and was GRANTed to anon → any anonymous PostgREST caller could read cross-tenant
-- VIP revenue + staff user_ids. security_invoker=on makes the view honour the
-- caller's RLS (owners see only their venue); anon loses direct access entirely.
-- Internal analytics RPCs that are SECURITY DEFINER are unaffected.
ALTER VIEW public.vip_consumption_facts SET (security_invoker = on);
REVOKE SELECT ON public.vip_consumption_facts FROM anon;

-- ── 7. dj_lineup_notifications: drop world-open policy, scope to service_role ──
-- Same TO public / USING(true) mistake as notification_log, but introduced later
-- (20260620110000) so the April batch never covered it.
DROP POLICY IF EXISTS "dj_lineup_notifications_service" ON public.dj_lineup_notifications;

CREATE POLICY "dj_lineup_notifications_service"
ON public.dj_lineup_notifications
AS PERMISSIVE
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
