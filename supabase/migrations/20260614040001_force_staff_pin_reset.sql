-- Force staff to redefine their PIN under the new self-set model.
-- Previously PINs were chosen by the owner/organizer; we invalidate them so every
-- staff member sets their OWN PIN on next login (redirected to /setup-pin).
-- A user who is also a promoter/dj re-sets their single shared PIN once.

UPDATE public.profiles
SET employee_pin = NULL
WHERE id IN (
  SELECT user_id FROM public.user_roles
  WHERE role IN ('barman', 'bouncer', 'cloakroom', 'vip_host', 'manager')
);

-- Organizer staff PINs (org_staff mirrors profiles.employee_pin).
UPDATE public.org_staff
SET pin_hash = NULL, pin_set_at = NULL;
