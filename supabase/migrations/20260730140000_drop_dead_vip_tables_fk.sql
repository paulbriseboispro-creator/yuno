-- ============================================================================
-- Débloquer TOUT placement de table VIP : retirer les FK vers la table morte
-- `vip_tables`.
-- ============================================================================
-- Le registre RÉEL des tables est `venue_floor_plans.layout.tables` (chaque
-- table y a son id, sa zone, son nom, sa capacité — c'est ce que lit tout le
-- front : éditeur owner, plan du serveur, checkout client). `vip_tables` est une
-- table LEGACY que plus RIEN n'écrit ni ne lit pour des données de table.
--
-- La migration C (20260704130000_table_reservation_fk_and_legacy_cleanup) a pris
-- `vip_tables` pour ce registre : elle a mis à NULL toutes les attributions
-- basées sur le plan (les traitant comme « orphelines ») puis ajouté une FK
-- assigned_table_id/requested_table_id → vip_tables. Résultat : depuis le
-- 2026-07-04, TOUTE écriture d'un id de table du plan échoue en 23503
-- (« Cette table n'est plus sur le plan »). Ça bloque le placement d'un invité
-- (seatGuest), le walk-in placé à l'entrée, ET un checkout client sur une table
-- précise.
--
-- Vérifié en prod le 2026-07-30 : 0 des 17 tables du plan Womber (et 0/13 Irish)
-- ne sont dans `vip_tables` ; 0 réservation n'a d'assigned_table_id depuis le
-- 04-07. La FK ne protège donc rien — elle ne fait que rejeter des ids de plan
-- valides. On la retire : assigned_table_id/requested_table_id restent des uuid
-- portant l'id de la table du plan (ce que tout le code suppose déjà). Le plan
-- affiche une résa sur sa table en comparant assigned_table_id = layout.table.id.
--
-- `ON DELETE SET NULL` disparaît avec la FK : si l'owner supprime une table du
-- plan, l'ancien id devient « pendouillant » — inoffensif (le front résout le
-- nom via la layout et retombe sur undefined, aucune casse).
-- ============================================================================

ALTER TABLE public.table_reservations
  DROP CONSTRAINT IF EXISTS table_reservations_assigned_table_id_fkey;

ALTER TABLE public.table_reservations
  DROP CONSTRAINT IF EXISTS table_reservations_requested_table_id_fkey;
