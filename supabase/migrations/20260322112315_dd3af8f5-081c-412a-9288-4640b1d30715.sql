CREATE TABLE public.owner_ai_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  venue_id text NOT NULL,
  tool_name text NOT NULL,
  tool_args jsonb DEFAULT '{}'::jsonb,
  result text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.owner_ai_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their venue audit logs"
ON public.owner_ai_audit_log FOR SELECT TO authenticated
USING (public.is_venue_owner(auth.uid(), venue_id));