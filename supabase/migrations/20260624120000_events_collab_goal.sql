-- Objectif commun d'une soirée collab (« shared goal »).
--
-- Permet au club menant la soirée de fixer une cible que le partenaire peut
-- viser ensemble : un nombre de billets, un CA, ou un nombre de participants.
-- Transforme le dashboard collab d'un simple relevé solo en un objectif partagé
-- que les deux parties suivent — renforce le sentiment « espace à deux ».
--
-- Additif + nullable : les co-événements existants n'ont simplement aucun
-- objectif tant qu'on n'en définit pas un. Aucune nouvelle policy RLS requise :
-- l'écriture est gouvernée par les policies UPDATE existantes de `events`
-- (seul le propriétaire/lead de l'event peut modifier la ligne).

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS collab_goal_type text,
  ADD COLUMN IF NOT EXISTS collab_goal_value numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_collab_goal_type_check'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_collab_goal_type_check
      CHECK (collab_goal_type IS NULL OR collab_goal_type IN ('tickets', 'revenue', 'attendees'));
  END IF;
END $$;

COMMENT ON COLUMN public.events.collab_goal_type IS 'Type d''objectif commun collab : tickets | revenue | attendees (NULL = aucun objectif).';
COMMENT ON COLUMN public.events.collab_goal_value IS 'Valeur cible de l''objectif commun collab (billets, euros, ou participants selon collab_goal_type).';
