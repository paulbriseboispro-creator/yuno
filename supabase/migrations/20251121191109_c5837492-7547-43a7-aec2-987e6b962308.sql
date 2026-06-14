-- Allow MFA edge functions (using service_role key) to manage MFA tables and write security logs

-- 1) mfa_pending: remove "No client access" restrictive policy and allow service_role full access
DROP POLICY IF EXISTS "No client access to mfa_pending" ON public.mfa_pending;

CREATE POLICY "Service role can manage mfa_pending"
ON public.mfa_pending
AS PERMISSIVE
FOR ALL
TO service_role
USING (true);

-- 2) mfa_recovery_codes: remove "No client access" restrictive policy and allow service_role full access
DROP POLICY IF EXISTS "No client access to mfa_recovery_codes" ON public.mfa_recovery_codes;

CREATE POLICY "Service role can manage mfa_recovery_codes"
ON public.mfa_recovery_codes
AS PERMISSIVE
FOR ALL
TO service_role
USING (true);

-- 3) mfa_secrets: remove "No client access" restrictive policy and allow service_role full access
DROP POLICY IF EXISTS "No client access to mfa_secrets" ON public.mfa_secrets;

CREATE POLICY "Service role can manage mfa_secrets"
ON public.mfa_secrets
AS PERMISSIVE
FOR ALL
TO service_role
USING (true);

-- 4) security_logs: allow service_role (edge functions) to insert log rows while keeping SELECT restricted
CREATE POLICY "Service role can insert security_logs"
ON public.security_logs
AS PERMISSIVE
FOR INSERT
TO service_role
WITH CHECK (true);