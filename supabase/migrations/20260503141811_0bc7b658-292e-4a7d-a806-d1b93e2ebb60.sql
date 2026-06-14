-- Security hardening: replace public base-table reads with safe public views

-- 1) App settings: expose only public maintenance/terms fields through a view
DROP VIEW IF EXISTS public.app_settings_public;
CREATE VIEW public.app_settings_public AS
SELECT
  id,
  maintenance_mode,
  maintenance_message,
  terms_version,
  terms_url,
  updated_at
FROM public.app_settings
WHERE id = 'global';

REVOKE ALL ON public.app_settings_public FROM PUBLIC;
GRANT SELECT ON public.app_settings_public TO anon, authenticated;

DROP POLICY IF EXISTS "Anyone can read app settings public fields" ON public.app_settings;
DROP POLICY IF EXISTS "Super admins can view app settings" ON public.app_settings;
CREATE POLICY "Super admins can view app settings"
ON public.app_settings
FOR SELECT
TO authenticated
USING (public.is_super_admin());

REVOKE ALL ON public.app_settings FROM anon;
REVOKE SELECT ON public.app_settings FROM authenticated;
GRANT SELECT, UPDATE ON public.app_settings TO authenticated;

-- 2) Favorites: remove public row access and expose aggregate counts only
DROP VIEW IF EXISTS public.favorite_counts;
CREATE VIEW public.favorite_counts AS
SELECT
  favorite_type,
  venue_id,
  event_id,
  drink_id,
  dj_id,
  count(*)::integer AS total_count
FROM public.favorites
GROUP BY favorite_type, venue_id, event_id, drink_id, dj_id;

REVOKE ALL ON public.favorite_counts FROM PUBLIC;
GRANT SELECT ON public.favorite_counts TO anon, authenticated;

DROP POLICY IF EXISTS "Anyone can count venue favorites" ON public.favorites;
DROP POLICY IF EXISTS "Users can view their own favorites" ON public.favorites;
DROP POLICY IF EXISTS "Users can insert their own favorites" ON public.favorites;
DROP POLICY IF EXISTS "Users can delete their own favorites" ON public.favorites;

CREATE POLICY "Users can view their own favorites"
ON public.favorites
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own favorites"
ON public.favorites
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own favorites"
ON public.favorites
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

REVOKE ALL ON public.favorites FROM anon;
REVOKE SELECT ON public.favorites FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.favorites TO authenticated;

-- 3) DJs: public pages read from a safe view that excludes WhatsApp and finance fields
DROP VIEW IF EXISTS public.djs_public;
CREATE VIEW public.djs_public AS
SELECT
  id,
  venue_id,
  first_name,
  last_name,
  stage_name,
  instagram_url,
  tiktok_url,
  music_genres,
  bio,
  description,
  profile_image_url,
  cover_image_url,
  soundcloud_url,
  spotify_url,
  youtube_url,
  country,
  city,
  is_verified,
  is_active,
  slug
FROM public.djs
WHERE is_active = true;

REVOKE ALL ON public.djs_public FROM PUBLIC;
GRANT SELECT ON public.djs_public TO anon, authenticated;

DROP POLICY IF EXISTS "Anyone can view dj profiles" ON public.djs;
REVOKE ALL ON public.djs FROM anon;
REVOKE SELECT ON public.djs FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.djs TO authenticated;

-- 4) Venue subscriptions: expose only public plan/status fields through a view
DROP VIEW IF EXISTS public.venue_subscription_public;
CREATE VIEW public.venue_subscription_public AS
SELECT
  venue_id,
  subscription_plan,
  status
FROM public.venue_subscriptions
WHERE status IN ('active', 'trialing');

REVOKE ALL ON public.venue_subscription_public FROM PUBLIC;
GRANT SELECT ON public.venue_subscription_public TO anon, authenticated;

DROP POLICY IF EXISTS "Public can view active venue subscription plan" ON public.venue_subscriptions;
REVOKE ALL ON public.venue_subscriptions FROM anon;
REVOKE SELECT ON public.venue_subscriptions FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_subscriptions TO authenticated;