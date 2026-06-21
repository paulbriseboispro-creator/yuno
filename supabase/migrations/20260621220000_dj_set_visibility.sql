-- DJ set visibility toggle: let a DJ hide a specific gig from their public profile.
--
-- Adds show_on_profile (default true) to dj_sets. When set to false for a given set,
-- that event is excluded from the DJ's public page even if they're still in the
-- event_djs line-up (e.g. a private party they don't want to advertise).
--
-- The get_dj_public_events RPC is updated to LEFT JOIN dj_sets and apply the filter:
-- no dj_sets row = visible (default); dj_sets.show_on_profile = false = hidden.

ALTER TABLE public.dj_sets
  ADD COLUMN IF NOT EXISTS show_on_profile boolean NOT NULL DEFAULT true;

-- Allow DJs to flip this flag on their own sets. Owners already have full UPDATE
-- access via their existing policy; this additive policy targets the DJ role only.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'dj_sets'
      AND policyname = 'dj_sets_self_update_visibility'
  ) THEN
    CREATE POLICY dj_sets_self_update_visibility ON public.dj_sets
      FOR UPDATE TO authenticated
      USING (
        dj_id IN (SELECT id FROM public.djs WHERE user_id = auth.uid())
      )
      WITH CHECK (
        dj_id IN (SELECT id FROM public.djs WHERE user_id = auth.uid())
      );
  END IF;
END $$;

-- Update the public events RPC to respect show_on_profile.
-- If no dj_sets row exists for this (dj_id, event_id) pair → show (default on).
-- If a dj_sets row exists with show_on_profile = false → hide.
CREATE OR REPLACE FUNCTION public.get_dj_public_events(p_slug text)
RETURNS TABLE (
  id         uuid,
  title      text,
  start_at   timestamptz,
  end_at     timestamptz,
  poster_url text,
  venue_id   text,
  venue_name text,
  venue_city text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_user uuid;
BEGIN
  v_user := public.dj_user_from_slug(p_slug);
  IF v_user IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT DISTINCT e.id, e.title, e.start_at, e.end_at, e.poster_url,
         e.venue_id, v.name, v.city
  FROM public.event_djs ed
  JOIN public.djs d    ON d.id = ed.dj_id AND d.user_id = v_user
  JOIN public.events e ON e.id = ed.event_id AND e.is_active = true AND e.visibility = 'public'
  LEFT JOIN public.venues v  ON v.id = e.venue_id
  -- A DJ can hide an event from their profile by setting show_on_profile=false on their set.
  LEFT JOIN public.dj_sets ds ON ds.dj_id = ed.dj_id AND ds.event_id = e.id
  WHERE (ds.id IS NULL OR ds.show_on_profile = true)
  ORDER BY e.start_at ASC;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_dj_public_events(text) TO anon, authenticated;
