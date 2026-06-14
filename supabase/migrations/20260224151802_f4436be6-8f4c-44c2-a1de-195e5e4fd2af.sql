
-- Table for secure email change requests
CREATE TABLE public.email_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  old_email text NOT NULL,
  new_email text,
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending_old_verification',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes')
);

-- Enable RLS
ALTER TABLE public.email_change_requests ENABLE ROW LEVEL SECURITY;

-- Users can only read their own requests
CREATE POLICY "Users can view their own email change requests"
ON public.email_change_requests
FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own requests
CREATE POLICY "Users can create their own email change requests"
ON public.email_change_requests
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- No direct update/delete from client - handled by edge functions with service role
