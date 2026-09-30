-- Salles VIP d'un organisateur : le plan se modifie sur la salle elle-même, et
-- une soirée sait de quelle salle elle vient.
--
--   • update_vip_room_plan(room, layout, fond) : écrit le plan d'une salle (tables,
--     positions, image de fond) sans passer par une soirée. Même porte que le
--     reste des salles (`can_manage_organizer_rooms`).
--   • events.vip_room_id : la salle rejouée ou enregistrée depuis cette soirée.
--     « Enregistrer comme salle VIP » met à jour CETTE salle par défaut ; posé par
--     le front après apply / save. SET NULL si la salle est supprimée.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS vip_room_id uuid REFERENCES public.organizer_vip_rooms(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.update_vip_room_plan(
  p_room_id uuid,
  p_layout jsonb,
  p_background_image_url text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_layout IS NULL OR jsonb_typeof(p_layout) <> 'object' THEN
    RAISE EXCEPTION 'Invalid layout' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.organizer_vip_rooms
     SET layout = p_layout,
         background_image_url = p_background_image_url,
         updated_at = now()
   WHERE id = p_room_id
     AND public.can_manage_organizer_rooms(v_uid, organizer_user_id)
  RETURNING id INTO v_id;

  RETURN v_id;  -- NULL = salle introuvable ou pas les droits (l'éditeur le traite en erreur)
END;
$$;

REVOKE ALL ON FUNCTION public.update_vip_room_plan(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_vip_room_plan(uuid, jsonb, text) TO authenticated;
