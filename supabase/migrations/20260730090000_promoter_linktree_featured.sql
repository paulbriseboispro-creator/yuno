-- Curation du linktree promoteur natif.
--
-- Le linktree public (/promoteur/:code) met en avant une sélection ; l'agenda
-- (/promoteur/:code/agenda) montre tout. Jusqu'ici la sélection était « les 8
-- prochaines » ; ce flag laisse le promoteur ÉPINGLER ses meilleures soirées :
-- s'il en épingle au moins une, le linktree ne montre que les épinglées, sinon
-- il retombe sur les 8 prochaines.
--
-- Écriture UNIQUEMENT via la RPC SECURITY DEFINER ci-dessous : la policy ALL de
-- promoter_event_assignments est réservée au club/orga (can_manage_venue), le
-- promoteur n'a qu'un SELECT sur ses propres lignes. On ne touche à rien
-- d'autre (commission_template_id & co restent hors de portée du promoteur).

ALTER TABLE public.promoter_event_assignments
  ADD COLUMN IF NOT EXISTS featured_on_linktree boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.set_promoter_linktree_featured(
  p_event_id uuid,
  p_featured boolean
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Le promoteur ne pilote que SES assignations actives ; un même user peut
  -- avoir plusieurs profils promoters (multi-clubs), on aligne toutes ses
  -- lignes pour cette soirée pour que le linktree (une page par code) soit
  -- cohérent quel que soit le scope qui a servi à résoudre la soirée.
  UPDATE public.promoter_event_assignments a
  SET featured_on_linktree = p_featured
  FROM public.promoters p
  WHERE a.promoter_id = p.id
    AND p.user_id = auth.uid()
    AND a.event_id = p_event_id
    AND a.status = 'active';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'assignment_not_found';
  END IF;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.set_promoter_linktree_featured(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_promoter_linktree_featured(uuid, boolean) TO authenticated;
