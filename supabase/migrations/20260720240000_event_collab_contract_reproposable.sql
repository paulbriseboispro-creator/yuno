-- =============================================================================
-- Une proposition de collab REFUSÉE doit pouvoir être renvoyée.
--
-- Même contradiction que celle corrigée pour les séries dans
-- 20260720210000, jamais reportée sur la soirée ponctuelle :
--
--   • le schéma dit UN contrat par soirée, À VIE
--       event_id uuid NOT NULL UNIQUE   (20260622220000)
--   • la RPC dit un contrat VIVANT à la fois
--       IF EXISTS (… WHERE c.event_id = p_event_id AND c.status <> 'cancelled')
--         RAISE 'Un contrat existe déjà pour cette soirée'
--
-- `cancel_event_collab_contract` passe le contrat à 'cancelled' et laisse la
-- ligne en base. Au deuxième essai, le garde métier laisse donc passer (il
-- exclut 'cancelled') et l'INSERT tape la contrainte UNIQUE : l'utilisateur
-- reçoit « duplicate key value violates unique constraint
-- "event_collab_contracts_event_id_key" » en pleine figure, sur une action qui
-- devrait simplement marcher.
--
-- L'unicité devient PARTIELLE, comme pour les séries : un seul contrat vivant à
-- la fois, autant de contrats annulés dans l'historique qu'il y a eu de
-- tentatives. C'est l'intention déjà écrite dans la RPC, et ça garde la trace
-- des propositions passées (une proposition refusée est une preuve, pas un
-- déchet à écraser).
--
-- Aucune donnée n'est touchée : on remplace une contrainte par un index qui
-- couvre les mêmes lignes, moins les annulées.
-- =============================================================================

ALTER TABLE public.event_collab_contracts
  DROP CONSTRAINT IF EXISTS event_collab_contracts_event_id_key;

DROP INDEX IF EXISTS public.event_collab_contracts_live_event_idx;
CREATE UNIQUE INDEX event_collab_contracts_live_event_idx
  ON public.event_collab_contracts (event_id)
  WHERE status <> 'cancelled';

COMMENT ON INDEX public.event_collab_contracts_live_event_idx IS
  'Un seul contrat vivant par soirée. Les contrats annulés restent en historique et n''empêchent pas d''en re-proposer un.';
