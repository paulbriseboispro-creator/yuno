-- =============================================================================
-- SECURITY FIX: Protect profiles and djs tables from public access
-- =============================================================================

-- 1. First, drop duplicate policies on profiles table (cleanup)
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;

-- 2. Create clean, consolidated policies for profiles
-- Only authenticated users can access their own profile
CREATE POLICY "Users can view own profile"
ON profiles FOR SELECT
TO authenticated
USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
ON profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- 3. Create a public view for profiles that excludes sensitive data
-- This is for cases where managers/owners need to lookup staff names
DROP VIEW IF EXISTS profiles_public;
CREATE VIEW profiles_public
WITH (security_invoker=on) AS
SELECT 
  id,
  first_name,
  last_name,
  avatar_url,
  created_at
FROM profiles;

-- 4. Fix DJs table - remove overly permissive policies and add proper restrictions
-- First, drop the catch-all owner policy that might be too broad
DROP POLICY IF EXISTS "Owners can manage their venue DJs" ON djs;

-- 5. Ensure DJs table policies are properly scoped to authenticated users only
-- Drop and recreate policies with TO authenticated clause
DROP POLICY IF EXISTS "DJs can view their own profile" ON djs;
DROP POLICY IF EXISTS "DJs can update their own profile" ON djs;
DROP POLICY IF EXISTS "Managers can view djs" ON djs;
DROP POLICY IF EXISTS "Owners and managers can delete djs" ON djs;
DROP POLICY IF EXISTS "Owners and managers can insert djs" ON djs;
DROP POLICY IF EXISTS "Owners and managers can update djs" ON djs;

-- Recreate with proper TO authenticated restrictions
CREATE POLICY "DJs can view their own profile"
ON djs FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "DJs can update their own profile"
ON djs FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Venue owners can view djs"
ON djs FOR SELECT
TO authenticated
USING (is_venue_owner(auth.uid(), venue_id));

CREATE POLICY "Managers can view djs"
ON djs FOR SELECT
TO authenticated
USING (manager_has_permission(auth.uid(), venue_id, 'djs'));

CREATE POLICY "Owners and managers can insert djs"
ON djs FOR INSERT
TO authenticated
WITH CHECK (is_venue_owner(auth.uid(), venue_id) OR manager_has_permission(auth.uid(), venue_id, 'djs'));

CREATE POLICY "Owners and managers can update djs"
ON djs FOR UPDATE
TO authenticated
USING (is_venue_owner(auth.uid(), venue_id) OR manager_has_permission(auth.uid(), venue_id, 'djs'));

CREATE POLICY "Owners and managers can delete djs"
ON djs FOR DELETE
TO authenticated
USING (is_venue_owner(auth.uid(), venue_id) OR manager_has_permission(auth.uid(), venue_id, 'djs'));

-- 6. Create a public-safe view for DJs (for public event pages showing DJ info)
DROP VIEW IF EXISTS djs_public;
CREATE VIEW djs_public
WITH (security_invoker=on) AS
SELECT 
  id,
  venue_id,
  stage_name,
  first_name,
  last_name,
  music_genres,
  bio,
  profile_image_url,
  instagram_url,
  tiktok_url,
  is_active
FROM djs
WHERE is_active = true;