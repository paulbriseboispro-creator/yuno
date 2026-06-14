-- Create a secure function to verify invitation tokens
-- This returns only the necessary data without exposing all invitation details
CREATE OR REPLACE FUNCTION public.verify_invitation_token(_token text, _email text)
RETURNS TABLE (
  is_valid boolean,
  venue_id text,
  invitation_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    true AS is_valid,
    oi.venue_id,
    oi.id AS invitation_id
  FROM public.owner_invitations oi
  WHERE oi.token = _token
    AND oi.email = LOWER(_email)
    AND oi.accepted_at IS NULL
    AND oi.expires_at > now()
  LIMIT 1;
  
  -- If no matching row, return false with nulls
  IF NOT FOUND THEN
    RETURN QUERY SELECT false AS is_valid, NULL::text AS venue_id, NULL::uuid AS invitation_id;
  END IF;
END;
$$;

-- Remove the overly permissive public SELECT policy
DROP POLICY IF EXISTS "Anyone can verify invitation by token" ON public.owner_invitations;

-- Super admins already have access via existing policy, but let's ensure it covers SELECT
-- The existing policy "Super admins can manage invitations" with command ALL already covers this