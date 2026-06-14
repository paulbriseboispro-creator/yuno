-- 1. Table org_staff
CREATE TABLE IF NOT EXISTS public.org_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('barman', 'bouncer', 'cloakroom')),
  pin_hash TEXT,
  pin_set_at TIMESTAMPTZ,
  invitation_status TEXT NOT NULL DEFAULT 'pending' CHECK (invitation_status IN ('pending', 'accepted', 'revoked')),
  invitation_token TEXT,
  invitation_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organizer_user_id, email, role)
);

CREATE INDEX IF NOT EXISTS idx_org_staff_organizer ON public.org_staff(organizer_user_id);
CREATE INDEX IF NOT EXISTS idx_org_staff_user ON public.org_staff(user_id);
CREATE INDEX IF NOT EXISTS idx_org_staff_token ON public.org_staff(invitation_token) WHERE invitation_token IS NOT NULL;

ALTER TABLE public.org_staff ENABLE ROW LEVEL SECURITY;

-- 2. Helper: is_org_staff
CREATE OR REPLACE FUNCTION public.is_org_staff(_user_id uuid, _organizer_user_id uuid, _role text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_staff
    WHERE organizer_user_id = _organizer_user_id
      AND user_id = _user_id
      AND invitation_status = 'accepted'
      AND (_role IS NULL OR role = _role)
  )
$$;

-- 3. Helper: get organizer_user_id for a staff member
CREATE OR REPLACE FUNCTION public.get_org_staff_organizer(_user_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organizer_user_id FROM public.org_staff
  WHERE user_id = _user_id AND invitation_status = 'accepted'
  LIMIT 1
$$;

-- 4. Updated event-access helper: org staff can access any event of their organizer
CREATE OR REPLACE FUNCTION public.is_org_staff_for_event(_user_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = _event_id
      AND (
        EXISTS (
          SELECT 1 FROM public.org_members om
          WHERE om.organizer_user_id = COALESCE(e.organizer_user_id, e.partner_organizer_id)
            AND om.member_user_id = _user_id
            AND om.invitation_status = 'accepted'
        )
        OR EXISTS (
          SELECT 1 FROM public.org_staff os
          WHERE os.organizer_user_id = COALESCE(e.organizer_user_id, e.partner_organizer_id)
            AND os.user_id = _user_id
            AND os.invitation_status = 'accepted'
        )
      )
  )
$$;

-- 5. RLS policies for org_staff
CREATE POLICY "Organizer manages own staff" ON public.org_staff
  FOR ALL TO authenticated
  USING (organizer_user_id = auth.uid() OR public.is_super_admin())
  WITH CHECK (organizer_user_id = auth.uid() OR public.is_super_admin());

CREATE POLICY "Org admins manage staff" ON public.org_staff
  FOR ALL TO authenticated
  USING (public.org_member_has_permission(auth.uid(), organizer_user_id, 'manage_team'))
  WITH CHECK (public.org_member_has_permission(auth.uid(), organizer_user_id, 'manage_team'));

CREATE POLICY "Staff can read own row" ON public.org_staff
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 6. updated_at trigger
CREATE TRIGGER trg_org_staff_updated_at
  BEFORE UPDATE ON public.org_staff
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7. Cleanup: remove bar_scanner and cloakroom_op from org_members
-- Drop existing CHECK constraint on role
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.org_members'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%role%';
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.org_members DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

-- Migrate any existing bar_scanner/cloakroom_op rows away (they were never used in production)
DELETE FROM public.org_members WHERE role IN ('bar_scanner', 'cloakroom_op');

ALTER TABLE public.org_members
  ADD CONSTRAINT org_members_role_check
  CHECK (role IN ('admin', 'editor', 'scanner'));

-- Restore is_org_team_member without bar_scanner/cloakroom_op
CREATE OR REPLACE FUNCTION public.is_org_team_member(_user_id uuid, _organizer_user_id uuid, _min_role text DEFAULT 'scanner')
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE organizer_user_id = _organizer_user_id
      AND member_user_id = _user_id
      AND invitation_status = 'accepted'
      AND CASE _min_role
        WHEN 'admin' THEN role = 'admin'
        WHEN 'editor' THEN role IN ('admin', 'editor')
        WHEN 'scanner' THEN role IN ('admin', 'editor', 'scanner')
        ELSE TRUE
      END
  )
$$;