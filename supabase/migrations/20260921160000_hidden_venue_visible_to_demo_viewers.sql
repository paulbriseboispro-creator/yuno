-- Un club masqué (is_hidden = true, « pas encore en ligne » ou démo) est
-- invisible pour tout le monde sauf son propriétaire : la fiche d'une de ses
-- soirées rend « Event not found » à qui n'est pas le patron. Or le club démo
-- `womber` est masqué depuis septembre (il ne doit pas entrer dans les
-- classements ni les stats plateforme), et ses SOIRÉES sont précisément ce
-- que le reviewer Apple (`apple-review@womber.fr`), les clients démo et
-- l'organisateur démo partenaire doivent pouvoir ouvrir. Constaté le
-- 2026-09-21 : aucun compte client démo n'ouvrait plus une seule fiche
-- soirée, et l'organisateur démo voyait « Un club » à la place du nom du
-- club dans ses propositions et son contrat.
--
-- On n'élargit la lecture QUE pour les comptes démo (`is_demo_email`, la
-- porte unique du super admin) : un club réel masqué reste masqué pour tout
-- visiteur réel. Explore / Links / découverte filtrent déjà `is_hidden`
-- explicitement, cette policy ne les alimente pas.

DROP POLICY IF EXISTS "Everyone can view visible venues" ON public.venues;
CREATE POLICY "Everyone can view visible venues" ON public.venues
  FOR SELECT USING (
    is_hidden = false
    OR public.is_super_admin()
    OR owner_id = auth.uid()
    OR public.can_manage_venue(auth.uid(), id)
    OR (is_hidden = true AND public.is_demo_email(auth.email()))
  );
