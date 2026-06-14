-- Backfill technical organizer role for existing organizer profiles.
INSERT INTO public.user_roles (user_id, role, email)
SELECT p.id, 'organizer'::public.app_role, p.email
FROM public.profiles p
WHERE p.profile_type = 'organizer'
ON CONFLICT (user_id, role) DO NOTHING;

-- Keep user_roles synchronized when a profile becomes an organizer.
CREATE OR REPLACE FUNCTION public.sync_organizer_role_from_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.profile_type = 'organizer' THEN
    INSERT INTO public.user_roles (user_id, role, email)
    VALUES (NEW.id, 'organizer'::public.app_role, NEW.email)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_organizer_role_from_profile ON public.profiles;
CREATE TRIGGER trg_sync_organizer_role_from_profile
AFTER INSERT OR UPDATE OF profile_type, email ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_organizer_role_from_profile();

-- Helper used by RLS/storage policies so profile_type and role stay compatible.
CREATE OR REPLACE FUNCTION public.is_organizer_profile(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = _user_id
      AND p.profile_type = 'organizer'
  )
  OR public.has_role(_user_id, 'organizer'::public.app_role)
$$;

-- Make event creation robust for organizer profiles.
DROP POLICY IF EXISTS "Organizer profiles can create own events" ON public.events;
CREATE POLICY "Organizer profiles can create own events"
ON public.events
FOR INSERT
TO authenticated
WITH CHECK (
  organizer_user_id = auth.uid()
  AND venue_id IS NULL
  AND public.is_organizer_profile(auth.uid())
);

DROP POLICY IF EXISTS "Organizer profiles can manage own events" ON public.events;
CREATE POLICY "Organizer profiles can manage own events"
ON public.events
FOR ALL
TO authenticated
USING (
  organizer_user_id = auth.uid()
  AND public.is_organizer_profile(auth.uid())
)
WITH CHECK (
  organizer_user_id = auth.uid()
  AND public.is_organizer_profile(auth.uid())
);

-- Allow organizer profiles to manage their own event images in event-images bucket.
DROP POLICY IF EXISTS "Organizer profiles upload own event images" ON storage.objects;
CREATE POLICY "Organizer profiles upload own event images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'event-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND public.is_organizer_profile(auth.uid())
);

DROP POLICY IF EXISTS "Organizer profiles update own event images" ON storage.objects;
CREATE POLICY "Organizer profiles update own event images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'event-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND public.is_organizer_profile(auth.uid())
)
WITH CHECK (
  bucket_id = 'event-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND public.is_organizer_profile(auth.uid())
);

DROP POLICY IF EXISTS "Organizer profiles delete own event images" ON storage.objects;
CREATE POLICY "Organizer profiles delete own event images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'event-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND public.is_organizer_profile(auth.uid())
);