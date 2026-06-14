-- 1. Ajout des champs de workflow proposition split sur partnership
ALTER TABLE public.venue_organizer_partnerships
  ADD COLUMN IF NOT EXISTS split_proposal jsonb,
  ADD COLUMN IF NOT EXISTS split_proposed_by uuid,
  ADD COLUMN IF NOT EXISTS split_proposed_at timestamptz,
  ADD COLUMN IF NOT EXISTS split_approved_by_venue boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS split_approved_by_organizer boolean NOT NULL DEFAULT false;

-- 2. Mise à jour de la contrainte de rôle sur org_members pour inclure les nouveaux rôles
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name='org_members' AND constraint_name='org_members_role_check'
  ) THEN
    ALTER TABLE public.org_members DROP CONSTRAINT org_members_role_check;
  END IF;
END$$;

ALTER TABLE public.org_members
  ADD CONSTRAINT org_members_role_check
  CHECK (role IN ('admin', 'editor', 'scanner', 'bar_scanner', 'cloakroom_op'));

-- 3. Mise à jour de la fonction is_org_team_member pour les nouveaux rôles
CREATE OR REPLACE FUNCTION public.is_org_team_member(_user_id uuid, _organizer_user_id uuid, _min_role text DEFAULT 'scanner'::text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE organizer_user_id = _organizer_user_id
      AND member_user_id = _user_id
      AND invitation_status = 'accepted'
      AND CASE _min_role
        WHEN 'admin' THEN role = 'admin'
        WHEN 'editor' THEN role IN ('admin', 'editor')
        WHEN 'scanner' THEN role IN ('admin', 'editor', 'scanner')
        WHEN 'bar_scanner' THEN role IN ('admin', 'bar_scanner')
        WHEN 'cloakroom_op' THEN role IN ('admin', 'cloakroom_op')
        ELSE TRUE
      END
  )
$function$;

-- 4. Helper pour vérifier qu'un user est staff orga (n'importe quel rôle opérationnel) sur un événement
CREATE OR REPLACE FUNCTION public.is_org_staff_for_event(_user_id uuid, _event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    JOIN public.org_members om ON om.organizer_user_id = COALESCE(e.organizer_user_id, e.partner_organizer_id)
    WHERE e.id = _event_id
      AND om.member_user_id = _user_id
      AND om.invitation_status = 'accepted'
  )
$function$;