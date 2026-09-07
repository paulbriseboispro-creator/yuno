-- Rareté / FOMO pour l'organisateur.
--
-- `event_scarcity_settings` n'acceptait en écriture que le propriétaire du
-- club (JOIN venues.owner_id). Une soirée d'organisateur — solo ou en collab
-- côté opérations — n'avait donc aucun moyen d'afficher « Plus que quelques
-- places » ou un compteur plafonné : l'upsert tombait en silence sur la RLS.
--
-- La rareté raconte l'état des paliers de billets et des zones de tables,
-- c'est-à-dire le domaine OPÉRATIONS de la soirée. On s'aligne donc sur la
-- porte qui gate déjà `ticket_rounds`, `table_zones` et `table_packs` :
-- `can_manage_event_tables()` (organisateur de la soirée, partenaire qui tient
-- les opérations, club qui les tient, super admin). Policy permissive
-- SUPPLÉMENTAIRE : la policy owner historique reste en place, un club ne perd
-- rien.

DROP POLICY IF EXISTS "Event operators can manage scarcity settings" ON public.event_scarcity_settings;
CREATE POLICY "Event operators can manage scarcity settings"
ON public.event_scarcity_settings
FOR ALL TO authenticated
USING (public.can_manage_event_tables(auth.uid(), event_id))
WITH CHECK (public.can_manage_event_tables(auth.uid(), event_id));
