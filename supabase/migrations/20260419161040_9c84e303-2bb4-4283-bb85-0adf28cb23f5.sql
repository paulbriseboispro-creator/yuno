-- Grant 'owner' role to any venue owner who is missing it (fixes invited collab clubs)
INSERT INTO public.user_roles (user_id, role, email)
SELECT DISTINCT v.owner_id, 'owner'::app_role, p.email
FROM public.venues v
JOIN public.profiles p ON p.id = v.owner_id
WHERE v.owner_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v.owner_id AND ur.role = 'owner'::app_role
  )
ON CONFLICT (user_id, role) DO NOTHING;

-- Link venue_id on profile so owner/staff gating works
UPDATE public.profiles p
SET venue_id = v.id
FROM public.venues v
WHERE v.owner_id = p.id
  AND p.venue_id IS NULL;