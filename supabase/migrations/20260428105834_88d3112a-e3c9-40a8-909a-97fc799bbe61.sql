
ALTER TABLE public.email_campaigns
  DROP CONSTRAINT IF EXISTS email_campaigns_audience_type_check;

ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_audience_type_check
  CHECK (audience_type IN (
    'all_subscribers','event_subscribers','event_buyers',
    'event_table_buyers','event_all_buyers',
    'vip','big_spenders','regulars','new_customers','dormant'
  ));

ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS theme_json jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS social_links_json jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS logo_url text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('email-assets', 'email-assets', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Email assets public read" ON storage.objects;
CREATE POLICY "Email assets public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'email-assets');

DROP POLICY IF EXISTS "Owners and organizers can upload email assets" ON storage.objects;
CREATE POLICY "Owners and organizers can upload email assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'email-assets'
    AND (
      public.is_owner_of_any_venue(auth.uid())
      OR public.has_role(auth.uid(), 'organizer'::app_role)
      OR public.is_super_admin()
    )
  );

DROP POLICY IF EXISTS "Owners and organizers can update email assets" ON storage.objects;
CREATE POLICY "Owners and organizers can update email assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'email-assets'
    AND (
      public.is_owner_of_any_venue(auth.uid())
      OR public.has_role(auth.uid(), 'organizer'::app_role)
      OR public.is_super_admin()
    )
  );

DROP POLICY IF EXISTS "Owners and organizers can delete email assets" ON storage.objects;
CREATE POLICY "Owners and organizers can delete email assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'email-assets'
    AND (
      public.is_owner_of_any_venue(auth.uid())
      OR public.has_role(auth.uid(), 'organizer'::app_role)
      OR public.is_super_admin()
    )
  );
