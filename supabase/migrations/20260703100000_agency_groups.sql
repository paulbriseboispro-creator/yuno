-- agency_promoter_groups: groupes nommés/colorés pour organiser le roster de l'agence.
-- agency_group_id ajouté sur promoters (nullable, SET NULL au delete de groupe).

CREATE TABLE public.agency_promoter_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id   uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       text NOT NULL DEFAULT '#E8192C',
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agency_promoter_groups_agency
  ON public.agency_promoter_groups(agency_id);

ALTER TABLE public.promoters
  ADD COLUMN IF NOT EXISTS agency_group_id uuid
  REFERENCES public.agency_promoter_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_promoters_agency_group
  ON public.promoters(agency_group_id)
  WHERE agency_group_id IS NOT NULL;

ALTER TABLE public.agency_promoter_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agency group owner manages"
  ON public.agency_promoter_groups FOR ALL TO authenticated
  USING  (public.is_agency_owner(auth.uid(), agency_id))
  WITH CHECK (public.is_agency_owner(auth.uid(), agency_id));

CREATE POLICY "Super admin manages agency groups"
  ON public.agency_promoter_groups FOR ALL TO authenticated
  USING  (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.set_agency_group_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_agency_group_updated_at
  BEFORE UPDATE ON public.agency_promoter_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_agency_group_updated_at();

-- RPC bulk-assign: assigne un tableau de promoter_ids à un groupe.
-- Retire d'abord les membres actuels du groupe, puis affecte les nouveaux.
CREATE OR REPLACE FUNCTION public.assign_promoters_to_group(
  p_group_id    uuid,
  p_promoter_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_agency_id uuid;
BEGIN
  SELECT agency_id INTO v_agency_id
    FROM public.agency_promoter_groups
   WHERE id = p_group_id;

  IF v_agency_id IS NULL THEN
    RAISE EXCEPTION 'group not found';
  END IF;

  IF NOT public.is_agency_owner(auth.uid(), v_agency_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- Retirer tous les membres actuels du groupe
  UPDATE public.promoters
     SET agency_group_id = NULL
   WHERE agency_id = v_agency_id
     AND agency_group_id = p_group_id;

  -- Affecter les nouveaux membres
  IF array_length(p_promoter_ids, 1) > 0 THEN
    UPDATE public.promoters
       SET agency_group_id = p_group_id
     WHERE id = ANY(p_promoter_ids)
       AND agency_id = v_agency_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_promoters_to_group(uuid, uuid[]) TO authenticated;
