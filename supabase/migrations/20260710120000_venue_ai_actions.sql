-- Next-best-action owner : cache journalier des « 3 actions à faire
-- aujourd'hui » générées par owner-assistant (action generate_next_best_actions).
-- Une entrée par venue × jour × langue — le dashboard ne paie l'IA qu'une fois
-- par jour. Écriture service-role uniquement, lecture owner du club.

CREATE TABLE public.venue_ai_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text NOT NULL,
  day date NOT NULL,
  language text NOT NULL CHECK (language IN ('en', 'fr', 'es')),
  actions jsonb NOT NULL,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, day, language)
);

ALTER TABLE public.venue_ai_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their venue AI actions"
ON public.venue_ai_actions FOR SELECT TO authenticated
USING (public.is_venue_owner(auth.uid(), venue_id));

-- Pas de policy INSERT/UPDATE/DELETE : seule l'edge function (service role)
-- écrit — le contenu vient toujours du serveur.
