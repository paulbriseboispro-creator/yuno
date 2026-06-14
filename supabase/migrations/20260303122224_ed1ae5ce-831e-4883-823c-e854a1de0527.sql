CREATE TABLE public.cgv_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  cgv_version TEXT NOT NULL DEFAULT '2025-03-01',
  order_type TEXT NOT NULL,
  reference_id TEXT,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address TEXT
);

ALTER TABLE public.cgv_acceptances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own acceptances" ON public.cgv_acceptances
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can insert own acceptances" ON public.cgv_acceptances
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Anon can insert acceptances" ON public.cgv_acceptances
  FOR INSERT TO anon WITH CHECK (user_id IS NULL);

CREATE POLICY "Admins can view all acceptances" ON public.cgv_acceptances
  FOR SELECT TO authenticated USING (public.is_super_admin());