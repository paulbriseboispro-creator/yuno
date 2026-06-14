
-- Table to store MFA disable requests with verification tokens
CREATE TABLE public.mfa_disable_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  token TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '15 minutes'),
  used_at TIMESTAMP WITH TIME ZONE,
  used BOOLEAN NOT NULL DEFAULT false
);

-- Enable RLS
ALTER TABLE public.mfa_disable_requests ENABLE ROW LEVEL SECURITY;

-- Only authenticated users can see their own requests
CREATE POLICY "Users can view their own mfa disable requests"
ON public.mfa_disable_requests FOR SELECT
USING (auth.uid() = user_id);

-- Service role handles inserts/updates (via edge functions)
-- No direct insert/update/delete policies for regular users

-- Index for token lookups
CREATE INDEX idx_mfa_disable_requests_token ON public.mfa_disable_requests(token);
CREATE INDEX idx_mfa_disable_requests_user ON public.mfa_disable_requests(user_id);
