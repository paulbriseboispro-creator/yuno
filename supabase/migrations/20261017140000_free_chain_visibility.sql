-- Billetterie libre : ce que voit l'acheteur d'un billet qui attend qu'un
-- autre soit complet (« après un billet », ticket_rounds.opens_after_round_id).
-- Réglage de la SOIRÉE, lu par ticketPhase (src/lib/freeTicketing.ts ⇄
-- _shared/free-ticketing.ts) sur la page publique ET au checkout :
--   preview (défaut, le comportement d'avant) : affiché « Bientôt », pas achetable ;
--   hidden : absent tant que le billet attendu n'est pas complet ;
--   open   : achetable tout de suite, la file ne ferme rien.
-- Distinct de rounds_visibility (mode Rounds, défaut « sequential ») : le
-- réutiliser aurait masqué d'un coup les rounds de toutes les soirées libres.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS free_chain_visibility text NOT NULL DEFAULT 'preview';

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_free_chain_visibility_check;
ALTER TABLE public.events ADD CONSTRAINT events_free_chain_visibility_check
  CHECK (free_chain_visibility IN ('preview', 'hidden', 'open'));

COMMENT ON COLUMN public.events.free_chain_visibility IS
  'Billetterie libre, billets « après un billet » : preview (Bientôt, défaut), hidden (masqué avant le complet du précédent), open (achetable tout de suite).';
