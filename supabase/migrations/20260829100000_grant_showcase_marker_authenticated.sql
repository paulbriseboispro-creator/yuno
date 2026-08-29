-- ============================================================================
-- Correctif : GRANT manquant sur venues.showcase_shadow_owner_id.
--
-- venues est en GRANT par colonne pour `authenticated` depuis 20260823180003,
-- dont l'en-tête prévenait : « toute NOUVELLE colonne de venues doit être
-- explicitement GRANTée ». 20260826100000 a ajouté le marqueur vitrine sans le
-- faire → depuis le 26/08, AdminVenues (qui le sélectionne) prenait un refus
-- de permission sur TOUTE sa requête (« Error loading data »), et le sélecteur
-- de clubs vitrine d'AdminDemoAccess (filtre sur la colonne) rendait une liste
-- vide en silence.
--
-- authenticated seulement, pas anon : aucun chemin anonyme ne lit le marqueur
-- (le redeem et les gardes passent par service role / SECURITY DEFINER), et
-- l'exposer à anon révélerait qu'un club caché est une vitrine. Pour les
-- authenticated non-admin, la RLS ne montre les venues cachées qu'à leur
-- owner : l'exposition effective est nulle.
-- ============================================================================

GRANT SELECT (showcase_shadow_owner_id) ON public.venues TO authenticated;
