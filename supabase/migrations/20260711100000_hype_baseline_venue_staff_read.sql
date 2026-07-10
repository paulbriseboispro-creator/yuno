-- ────────────────────────────────────────────────────────────────────────────
--  venue_hype_baseline : lecture pour le staff du venue
--  La jauge de capacité du centre de commandement (/owner/live, /manager/live)
--  lit venue_hype_baseline.capacity. La table n'avait qu'une policy owner :
--  un manager voyait la jauge vide. On ajoute une policy SELECT pour les
--  profils rattachés au venue (profiles.venue_id) et les managers avec la
--  permission analytics. L'écriture reste owner-only.
-- ────────────────────────────────────────────────────────────────────────────

CREATE POLICY "venue staff can read venue_hype_baseline"
  ON public.venue_hype_baseline
  FOR SELECT
  USING (
    public.get_user_venue_id(auth.uid()) = venue_id
    OR public.manager_has_permission(auth.uid(), venue_id, 'analytics')
  );
