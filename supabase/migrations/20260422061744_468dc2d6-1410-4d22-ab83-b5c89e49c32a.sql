-- ============================================================
-- 1. event_recap_sent: restrict to service_role only
-- ============================================================
DROP POLICY IF EXISTS "Service role can manage event recap sent" ON public.event_recap_sent;
DROP POLICY IF EXISTS "System can insert recap sent" ON public.event_recap_sent;

CREATE POLICY "Service role can manage event recap sent"
ON public.event_recap_sent
AS PERMISSIVE
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Admin SELECT policy already exists ("Admins can view recap sent")

-- ============================================================
-- 2. notification_log: drop public policy (service_role one already exists)
-- ============================================================
DROP POLICY IF EXISTS "Service role can manage notification_log" ON public.notification_log;
-- "Service role full access notification_log" remains and is correctly scoped to service_role

-- ============================================================
-- 3. org_members: drop overly permissive public SELECT policy
-- Token-based invitation lookup happens via edge functions using service_role
-- ============================================================
DROP POLICY IF EXISTS "Public can verify org member invitation by token" ON public.org_members;

-- ============================================================
-- 4. security_logs: scope owner read access to their venue users
-- ============================================================
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

-- ============================================================
-- 5. storage: profile-photos ownership check on UPDATE/DELETE
-- Convention: files stored under <auth.uid()>/...
-- ============================================================
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

-- Also tighten the INSERT policy with same ownership check
DROP POLICY IF EXISTS "Authenticated users can upload their own profile photos" ON storage.objects;

CREATE POLICY "Authenticated users can upload their own profile photos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'profile-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);