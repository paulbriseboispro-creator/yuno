-- ============================================================================
-- Nettoyage orphelins VIP + typage table_reservations + drop colonne legacy.
--
-- Suite de l'audit data-architecture (voir docs/DATA_ARCHITECTURE.md §5).
-- Vérifié live 2026-07-04 : 9 orphelins assigned_table_id, 4 requested_table_id
-- (résas pointant des vip_tables supprimées) ; toutes les valeurs restantes sont
-- des UUID valides ; aucune vue ne référence ces colonnes (vip_consumption_facts
-- lit table_reservations mais pas ces colonnes) ; event_collab_invitations est
-- vide (0 ligne) et sa colonne organizer_id pointe l'ancienne table `organizers`
-- supprimée + n'est utilisée nulle part (front ni edge).
-- ============================================================================

-- ── 1. Délier les tables VIP mortes (garde la réservation, annule l'attribution) ──
UPDATE public.table_reservations SET assigned_table_id = NULL
 WHERE assigned_table_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.vip_tables t WHERE t.id::text = assigned_table_id);

UPDATE public.table_reservations SET requested_table_id = NULL
 WHERE requested_table_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.vip_tables t WHERE t.id::text = requested_table_id);

-- ── 2. Corriger la dérive de typage TEXT → UUID (contenu déjà 100 % UUID) ──
ALTER TABLE public.table_reservations
  ALTER COLUMN assigned_table_id  TYPE uuid USING assigned_table_id::uuid,
  ALTER COLUMN requested_table_id TYPE uuid USING requested_table_id::uuid;

-- ── 3. FK vers vip_tables (SET NULL : une résa survit à la suppression d'une table) ──
ALTER TABLE public.table_reservations
  ADD CONSTRAINT table_reservations_assigned_table_id_fkey
    FOREIGN KEY (assigned_table_id)  REFERENCES public.vip_tables(id) ON DELETE SET NULL;
ALTER TABLE public.table_reservations
  ADD CONSTRAINT table_reservations_requested_table_id_fkey
    FOREIGN KEY (requested_table_id) REFERENCES public.vip_tables(id) ON DELETE SET NULL;

-- ── 4. Supprimer la colonne legacy morte (référence la table `organizers` disparue) ──
ALTER TABLE public.event_collab_invitations DROP COLUMN IF EXISTS organizer_id;
