
-- 1. Stripe Connect columns on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_connect_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS stripe_connect_charges_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_connect_payouts_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_connect_onboarded_at TIMESTAMPTZ;

-- Constraint on status values
DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_stripe_connect_status_check
    CHECK (stripe_connect_status IN ('none','pending','active','restricted'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_connect_account
  ON public.profiles(stripe_connect_account_id)
  WHERE stripe_connect_account_id IS NOT NULL;

-- 2. Storage bucket for event posters
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-posters', 'event-posters', true)
ON CONFLICT (id) DO NOTHING;

-- Public read
DO $$ BEGIN
  CREATE POLICY "Public read event posters"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'event-posters');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Owner-only write (folder = user id)
DO $$ BEGIN
  CREATE POLICY "Users upload own event posters"
    ON storage.objects FOR INSERT
    WITH CHECK (
      bucket_id = 'event-posters'
      AND auth.uid()::text = (storage.foldername(name))[1]
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users update own event posters"
    ON storage.objects FOR UPDATE
    USING (
      bucket_id = 'event-posters'
      AND auth.uid()::text = (storage.foldername(name))[1]
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users delete own event posters"
    ON storage.objects FOR DELETE
    USING (
      bucket_id = 'event-posters'
      AND auth.uid()::text = (storage.foldername(name))[1]
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
