-- Create owner invitations table to track pending invitations
CREATE TABLE public.owner_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  email text NOT NULL,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  accepted_at timestamp with time zone,
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.owner_invitations ENABLE ROW LEVEL SECURITY;

-- Only super admins can manage invitations
CREATE POLICY "Super admins can manage invitations" 
ON public.owner_invitations 
FOR ALL 
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- Public can verify their own invitation token
CREATE POLICY "Anyone can verify invitation by token" 
ON public.owner_invitations 
FOR SELECT 
USING (true);