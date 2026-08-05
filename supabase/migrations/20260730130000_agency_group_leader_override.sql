-- =====================================================================
-- Override de CHEF DE GROUPE pour les agences — parité owner (promoter_teams).
--
-- record_promoter_conversion applique déjà un override d'équipe : il lit
-- promoters.team_id → promoter_teams PAR CLÉ PRIMAIRE (aucun filtre de scope) et
-- crédite le chef d'une ligne conversion_type='override' portant seulement
-- event_id. Donc une équipe scopée AGENCE s'applique à l'identique — ZÉRO
-- changement du code argent.
--
-- Mécanique : un groupe d'agence qui reçoit un chef + un override matérialise une
-- « équipe-ombre » promoter_teams (scope agence). Les membres du groupe pointent
-- leur team_id dessus. Le moteur argent fait le reste.
-- =====================================================================

-- 1) promoter_teams : scope agence (XOR à 3, calqué sur commission_templates).
ALTER TABLE public.promoter_teams
  ADD COLUMN IF NOT EXISTS agency_id uuid REFERENCES public.agencies(id) ON DELETE CASCADE;

ALTER TABLE public.promoter_teams DROP CONSTRAINT IF EXISTS promoter_teams_context_check;
ALTER TABLE public.promoter_teams
  ADD CONSTRAINT promoter_teams_context_check
  CHECK ((venue_id IS NOT NULL)::int + (organizer_user_id IS NOT NULL)::int + (agency_id IS NOT NULL)::int = 1);

CREATE INDEX IF NOT EXISTS idx_promoter_teams_agency
  ON public.promoter_teams(agency_id) WHERE agency_id IS NOT NULL;

DROP POLICY IF EXISTS "Agency owner manages own teams" ON public.promoter_teams;
CREATE POLICY "Agency owner manages own teams"
  ON public.promoter_teams FOR ALL TO authenticated
  USING (agency_id IS NOT NULL AND public.is_agency_owner(auth.uid(), agency_id))
  WITH CHECK (agency_id IS NOT NULL AND public.is_agency_owner(auth.uid(), agency_id));

-- 2) agency_promoter_groups : porte le chef + l'override + le lien vers l'équipe-ombre.
ALTER TABLE public.agency_promoter_groups
  ADD COLUMN IF NOT EXISTS leader_promoter_id uuid REFERENCES public.promoters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS override_type text CHECK (override_type IN ('fixed', 'percentage')),
  ADD COLUMN IF NOT EXISTS override_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES public.promoter_teams(id) ON DELETE SET NULL;

-- 3) Le team_id d'un promoteur D'AGENCE suit l'équipe-ombre de SON groupe.
--    (BEFORE UPDATE OF agency_group_id : ne se déclenche que quand le groupe change,
--    jamais sur les UPDATE d'argent — qui ne touchent pas agency_group_id.)
CREATE OR REPLACE FUNCTION public.sync_agency_promoter_team()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.agency_id IS NOT NULL THEN
    IF NEW.agency_group_id IS NOT NULL THEN
      SELECT team_id INTO NEW.team_id FROM public.agency_promoter_groups WHERE id = NEW.agency_group_id;
    ELSE
      NEW.team_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_agency_promoter_team ON public.promoters;
CREATE TRIGGER trg_sync_agency_promoter_team
  BEFORE INSERT OR UPDATE OF agency_group_id ON public.promoters
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_agency_promoter_team();

-- 4) RPC : fixer (ou retirer) le chef + l'override d'un groupe.
CREATE OR REPLACE FUNCTION public.set_agency_group_override(
  p_group_id uuid,
  p_leader_promoter_id uuid,
  p_override_type text,
  p_override_value numeric
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group public.agency_promoter_groups%ROWTYPE;
  v_agency_id uuid;
  v_team_id uuid;
  v_clear boolean;
BEGIN
  SELECT * INTO v_group FROM public.agency_promoter_groups WHERE id = p_group_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Groupe introuvable'; END IF;
  v_agency_id := v_group.agency_id;
  IF NOT public.is_agency_owner(auth.uid(), v_agency_id) THEN RAISE EXCEPTION 'not authorized'; END IF;

  v_clear := (p_leader_promoter_id IS NULL OR COALESCE(p_override_value, 0) <= 0);

  IF v_clear THEN
    UPDATE public.promoters SET team_id = NULL, updated_at = now()
      WHERE agency_group_id = p_group_id AND agency_id = v_agency_id;
    UPDATE public.agency_promoter_groups
      SET leader_promoter_id = NULL, override_type = NULL, override_value = 0, team_id = NULL
      WHERE id = p_group_id;
    IF v_group.team_id IS NOT NULL THEN
      DELETE FROM public.promoter_teams WHERE id = v_group.team_id AND agency_id = v_agency_id;
    END IF;
    RETURN json_build_object('cleared', true);
  END IF;

  IF p_override_type NOT IN ('fixed', 'percentage') THEN RAISE EXCEPTION 'override_type invalide'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.promoters WHERE id = p_leader_promoter_id AND agency_id = v_agency_id) THEN
    RAISE EXCEPTION 'Le chef doit être un promoteur de l''agence';
  END IF;

  IF v_group.team_id IS NULL THEN
    INSERT INTO public.promoter_teams (agency_id, name, leader_promoter_id, override_type, override_value)
      VALUES (v_agency_id, v_group.name, p_leader_promoter_id, p_override_type, p_override_value)
      RETURNING id INTO v_team_id;
    UPDATE public.agency_promoter_groups SET team_id = v_team_id WHERE id = p_group_id;
  ELSE
    v_team_id := v_group.team_id;
    UPDATE public.promoter_teams
      SET name = v_group.name, leader_promoter_id = p_leader_promoter_id,
          override_type = p_override_type, override_value = p_override_value
      WHERE id = v_team_id;
  END IF;

  UPDATE public.agency_promoter_groups
    SET leader_promoter_id = p_leader_promoter_id, override_type = p_override_type, override_value = p_override_value
    WHERE id = p_group_id;

  -- Rattache tous les membres actuels à l'équipe-ombre (le trigger couvre les futurs).
  UPDATE public.promoters SET team_id = v_team_id, updated_at = now()
    WHERE agency_group_id = p_group_id AND agency_id = v_agency_id;

  RETURN json_build_object('team_id', v_team_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_agency_group_override(uuid, uuid, text, numeric) TO authenticated;
