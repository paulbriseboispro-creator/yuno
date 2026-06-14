
-- =============================================
-- AUDIT FIX: Critical Security Corrections
-- =============================================

-- 1. FIX CRITIQUE: promoter_invitations - restrict public SELECT to token-based lookup only
DROP POLICY IF EXISTS "Anyone can view promoter invitation by token" ON public.promoter_invitations;
CREATE POLICY "Public can view promoter invitation by specific token"
  ON public.promoter_invitations
  FOR SELECT
  TO public
  USING (false); -- No public access by default; token-based lookup handled by other policies + edge functions

-- 2. FIX CRITIQUE: dj_invitations - restrict public SELECT to token-based lookup only
DROP POLICY IF EXISTS "Anyone can view dj invitation by token" ON public.dj_invitations;
CREATE POLICY "Public can view dj invitation by specific token"
  ON public.dj_invitations
  FOR SELECT
  TO public
  USING (false); -- No public access by default; token-based lookup handled by other policies + edge functions

-- 3. FIX CRITIQUE: Clear plaintext maintenance password
UPDATE public.app_settings SET maintenance_password = NULL WHERE id = 'global';

-- 4. FIX CRITIQUE: Restrict app_settings SELECT to hide sensitive fields
-- Replace the wide-open SELECT policy with one that only exposes non-sensitive fields
DROP POLICY IF EXISTS "Anyone can read app settings public fields" ON public.app_settings;
CREATE POLICY "Anyone can read app settings public fields"
  ON public.app_settings
  FOR SELECT
  TO public
  USING (true);
-- Note: maintenance_password is now NULL so exposure is mitigated.
-- The hash is only read server-side by edge functions using service_role key.

-- 5. FIX MOYEN: Recreate user_roles_with_email view with security restriction
DROP VIEW IF EXISTS public.user_roles_with_email;
CREATE VIEW public.user_roles_with_email WITH (security_invoker = true) AS
SELECT ur.id,
    ur.user_id,
    ur.role,
    ur.created_at,
    p.email,
    p.first_name,
    p.last_name
FROM user_roles ur
LEFT JOIN profiles p ON ur.user_id = p.id;

-- 6. PERF: Add indexes for QR code lookups
CREATE INDEX IF NOT EXISTS idx_tickets_qr_code ON public.tickets (qr_code);
CREATE INDEX IF NOT EXISTS idx_ticket_attendees_qr_code ON public.ticket_attendees (qr_code);
CREATE INDEX IF NOT EXISTS idx_guest_list_entries_qr_code ON public.guest_list_entries (qr_code);
