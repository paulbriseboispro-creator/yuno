-- « Suis-je déjà sur la guest list de cette soirée ? » — à l'échelle de
-- l'ÉVÉNEMENT, toutes parts confondues (club / DJ / promoteur / organisateur).
--
-- Un client ne peut pas lire en direct une part déléguée non publique (la part
-- d'un DJ a visible_on_club_page=false) : une jointure côté front sur
-- guest_lists renverrait 0 pour sa propre inscription sur cette part, et la
-- page proposerait de se réinscrire ailleurs. SECURITY DEFINER contourne le
-- RLS et ne révèle qu'un booléen sur SA propre identité (auth.uid()).
CREATE OR REPLACE FUNCTION public.is_on_event_guest_list(_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.guest_list_entries e
    JOIN public.guest_lists gl ON gl.id = e.guest_list_id
    WHERE gl.event_id = _event_id
      AND e.user_id = auth.uid()
      AND e.status <> 'cancelled'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_on_event_guest_list(uuid) TO authenticated;
