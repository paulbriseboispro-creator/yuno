
-- Add terms_version and terms_url to app_settings
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS terms_version text NOT NULL DEFAULT 'v1.0.0';
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS terms_url text DEFAULT '/legal/cgv-utilisateurs';

-- Create terms_acceptances table
CREATE TABLE IF NOT EXISTS terms_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_email text,
  terms_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  context text,
  order_id uuid,
  venue_id text REFERENCES venues(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE terms_acceptances ENABLE ROW LEVEL SECURITY;

-- Partial unique indexes for deduplication
CREATE UNIQUE INDEX IF NOT EXISTS idx_terms_user_version 
  ON terms_acceptances (user_id, terms_version) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_terms_guest_version 
  ON terms_acceptances (guest_email, terms_version) WHERE guest_email IS NOT NULL;

-- RLS policies
CREATE POLICY "Users can view own terms acceptances" ON terms_acceptances 
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can insert own terms acceptances" ON terms_acceptances 
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Allow anon to insert (for edge function with service role, and guest inserts)
CREATE POLICY "Anon can insert terms acceptances" ON terms_acceptances 
  FOR INSERT TO anon WITH CHECK (user_id IS NULL AND guest_email IS NOT NULL);
