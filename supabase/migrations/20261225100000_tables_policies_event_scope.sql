-- Tables VIP, vague A — P6.1 : une ligne event-scopée ne s'écrit que par qui gère CETTE soirée.
--
-- Constat (audit 6, relu sur la prod le 24/11) : les policies « propriétaire de club » de table_packs, table_zones
-- et venue_floor_plans ne testent que `venue_id`. Une ligne (venue_id = mon club, event_id = la soirée d'un
-- autre) passait donc : le propriétaire du club B pouvait poser une formule, une zone ou un plan sur la soirée du
-- club A (les policies sont permissives : une seule suffit, et le WITH CHECK d'INSERT / UPDATE ne regardait pas
-- event_id). Les policies « soirée » (can_manage_event_tables) acceptaient, elles, n'importe quel venue_id.
--
-- Règle posée, pour INSERT et UPDATE (WITH CHECK) et pour la cible d'un UPDATE / DELETE (USING) :
--   • ligne de club (event_id NULL)  → la règle existante du club (propriétaire, ou manager 'tables') ;
--   • ligne de soirée (event_id posé) → can_manage_event_tables(auth.uid(), event_id) ET un venue_id cohérent avec la
--     soirée (NULL, son club hôte ou son club partenaire) — jamais le club d'un autre.
--
-- Aucune fonction nouvelle : les policies s'évaluent aussi pour `anon` en lecture (la policy ALL s'applique au
-- SELECT), donc elles ne citent que des fonctions déjà exécutables par anon (can_manage_event_tables).
-- Les lignes existantes ne sont pas touchées (une policy ne juge que ce qu'on écrit).

-- ── table_packs ──────────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Event-scoped packs manageable by event managers" ON public.table_packs;
CREATE POLICY "Event-scoped packs manageable by event managers"
  ON public.table_packs FOR ALL TO authenticated
  USING (event_id IS NOT NULL AND public.can_manage_event_tables(auth.uid(), event_id))
  WITH CHECK (
    event_id IS NOT NULL
    AND public.can_manage_event_tables(auth.uid(), event_id)
    AND (venue_id IS NULL OR EXISTS (
      SELECT 1 FROM public.events e
       WHERE e.id = table_packs.event_id
         AND table_packs.venue_id IN (e.venue_id, e.partner_venue_id)))
  );

DROP POLICY IF EXISTS "Owners can manage their venue table packs" ON public.table_packs;
CREATE POLICY "Owners can manage their venue table packs"
  ON public.table_packs FOR ALL TO public
  USING (
    has_role(auth.uid(), 'owner'::app_role)
    AND (is_venue_owner(auth.uid(), venue_id)
         OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.venue_id = table_packs.venue_id))
    AND (event_id IS NULL OR public.can_manage_event_tables(auth.uid(), event_id))
  )
  WITH CHECK (
    has_role(auth.uid(), 'owner'::app_role)
    AND (is_venue_owner(auth.uid(), venue_id)
         OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.venue_id = table_packs.venue_id))
    AND (event_id IS NULL OR (
      public.can_manage_event_tables(auth.uid(), event_id)
      AND EXISTS (SELECT 1 FROM public.events e
                   WHERE e.id = table_packs.event_id
                     AND table_packs.venue_id IN (e.venue_id, e.partner_venue_id))))
  );

DROP POLICY IF EXISTS "Owners and managers can insert table packs" ON public.table_packs;
CREATE POLICY "Owners and managers can insert table packs"
  ON public.table_packs FOR INSERT TO public
  WITH CHECK (
    (is_venue_owner(auth.uid(), venue_id) OR manager_has_permission(auth.uid(), venue_id, 'tables'::text))
    AND (event_id IS NULL OR (
      public.can_manage_event_tables(auth.uid(), event_id)
      AND EXISTS (SELECT 1 FROM public.events e
                   WHERE e.id = table_packs.event_id
                     AND table_packs.venue_id IN (e.venue_id, e.partner_venue_id))))
  );

DROP POLICY IF EXISTS "Owners and managers can update table packs" ON public.table_packs;
CREATE POLICY "Owners and managers can update table packs"
  ON public.table_packs FOR UPDATE TO public
  USING (
    (is_venue_owner(auth.uid(), venue_id) OR manager_has_permission(auth.uid(), venue_id, 'tables'::text))
    AND (event_id IS NULL OR public.can_manage_event_tables(auth.uid(), event_id))
  )
  WITH CHECK (
    (is_venue_owner(auth.uid(), venue_id) OR manager_has_permission(auth.uid(), venue_id, 'tables'::text))
    AND (event_id IS NULL OR (
      public.can_manage_event_tables(auth.uid(), event_id)
      AND EXISTS (SELECT 1 FROM public.events e
                   WHERE e.id = table_packs.event_id
                     AND table_packs.venue_id IN (e.venue_id, e.partner_venue_id))))
  );

DROP POLICY IF EXISTS "Owners and managers can delete table packs" ON public.table_packs;
CREATE POLICY "Owners and managers can delete table packs"
  ON public.table_packs FOR DELETE TO public
  USING (
    (is_venue_owner(auth.uid(), venue_id) OR manager_has_permission(auth.uid(), venue_id, 'tables'::text))
    AND (event_id IS NULL OR public.can_manage_event_tables(auth.uid(), event_id))
  );

-- ── table_zones ──────────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Event-scoped zones manageable by event managers" ON public.table_zones;
CREATE POLICY "Event-scoped zones manageable by event managers"
  ON public.table_zones FOR ALL TO authenticated
  USING (event_id IS NOT NULL AND public.can_manage_event_tables(auth.uid(), event_id))
  WITH CHECK (
    event_id IS NOT NULL
    AND public.can_manage_event_tables(auth.uid(), event_id)
    AND (venue_id IS NULL OR EXISTS (
      SELECT 1 FROM public.events e
       WHERE e.id = table_zones.event_id
         AND table_zones.venue_id IN (e.venue_id, e.partner_venue_id)))
  );

DROP POLICY IF EXISTS "Owners can manage their venue table zones" ON public.table_zones;
CREATE POLICY "Owners can manage their venue table zones"
  ON public.table_zones FOR ALL TO public
  USING (
    has_role(auth.uid(), 'owner'::app_role)
    AND (is_venue_owner(auth.uid(), venue_id)
         OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.venue_id = table_zones.venue_id))
    AND (event_id IS NULL OR public.can_manage_event_tables(auth.uid(), event_id))
  )
  WITH CHECK (
    has_role(auth.uid(), 'owner'::app_role)
    AND (is_venue_owner(auth.uid(), venue_id)
         OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.venue_id = table_zones.venue_id))
    AND (event_id IS NULL OR (
      public.can_manage_event_tables(auth.uid(), event_id)
      AND EXISTS (SELECT 1 FROM public.events e
                   WHERE e.id = table_zones.event_id
                     AND table_zones.venue_id IN (e.venue_id, e.partner_venue_id))))
  );

DROP POLICY IF EXISTS "Owners and managers can insert table zones" ON public.table_zones;
CREATE POLICY "Owners and managers can insert table zones"
  ON public.table_zones FOR INSERT TO public
  WITH CHECK (
    (is_venue_owner(auth.uid(), venue_id) OR manager_has_permission(auth.uid(), venue_id, 'tables'::text))
    AND (event_id IS NULL OR (
      public.can_manage_event_tables(auth.uid(), event_id)
      AND EXISTS (SELECT 1 FROM public.events e
                   WHERE e.id = table_zones.event_id
                     AND table_zones.venue_id IN (e.venue_id, e.partner_venue_id))))
  );

DROP POLICY IF EXISTS "Owners and managers can update table zones" ON public.table_zones;
CREATE POLICY "Owners and managers can update table zones"
  ON public.table_zones FOR UPDATE TO public
  USING (
    (is_venue_owner(auth.uid(), venue_id) OR manager_has_permission(auth.uid(), venue_id, 'tables'::text))
    AND (event_id IS NULL OR public.can_manage_event_tables(auth.uid(), event_id))
  )
  WITH CHECK (
    (is_venue_owner(auth.uid(), venue_id) OR manager_has_permission(auth.uid(), venue_id, 'tables'::text))
    AND (event_id IS NULL OR (
      public.can_manage_event_tables(auth.uid(), event_id)
      AND EXISTS (SELECT 1 FROM public.events e
                   WHERE e.id = table_zones.event_id
                     AND table_zones.venue_id IN (e.venue_id, e.partner_venue_id))))
  );

DROP POLICY IF EXISTS "Owners and managers can delete table zones" ON public.table_zones;
CREATE POLICY "Owners and managers can delete table zones"
  ON public.table_zones FOR DELETE TO public
  USING (
    (is_venue_owner(auth.uid(), venue_id) OR manager_has_permission(auth.uid(), venue_id, 'tables'::text))
    AND (event_id IS NULL OR public.can_manage_event_tables(auth.uid(), event_id))
  );

-- ── venue_floor_plans ────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Event-scoped floor plans manageable by event managers" ON public.venue_floor_plans;
CREATE POLICY "Event-scoped floor plans manageable by event managers"
  ON public.venue_floor_plans FOR ALL TO authenticated
  USING (event_id IS NOT NULL AND public.can_manage_event_tables(auth.uid(), event_id))
  WITH CHECK (
    event_id IS NOT NULL
    AND public.can_manage_event_tables(auth.uid(), event_id)
    AND (venue_id IS NULL OR EXISTS (
      SELECT 1 FROM public.events e
       WHERE e.id = venue_floor_plans.event_id
         AND venue_floor_plans.venue_id IN (e.venue_id, e.partner_venue_id)))
  );

DROP POLICY IF EXISTS "Owners can manage their venue floor plan" ON public.venue_floor_plans;
CREATE POLICY "Owners can manage their venue floor plan"
  ON public.venue_floor_plans FOR ALL TO public
  USING (
    is_venue_owner(auth.uid(), venue_id)
    AND (event_id IS NULL OR public.can_manage_event_tables(auth.uid(), event_id))
  )
  WITH CHECK (
    is_venue_owner(auth.uid(), venue_id)
    AND (event_id IS NULL OR (
      public.can_manage_event_tables(auth.uid(), event_id)
      AND EXISTS (SELECT 1 FROM public.events e
                   WHERE e.id = venue_floor_plans.event_id
                     AND venue_floor_plans.venue_id IN (e.venue_id, e.partner_venue_id))))
  );
