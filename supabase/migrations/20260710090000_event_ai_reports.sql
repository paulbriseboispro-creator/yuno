-- Night Report narratif IA : cache des rapports générés par owner-assistant
-- (action generate_night_report). Un rapport par event × langue, invalidé par
-- stats_hash quand les chiffres de la soirée changent. Écriture service-role
-- uniquement (l'edge function), lecture par l'owner du club.

CREATE TABLE public.event_ai_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  venue_id text NOT NULL,
  language text NOT NULL CHECK (language IN ('en', 'fr', 'es')),
  report jsonb NOT NULL,
  model text NOT NULL,
  stats_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, language)
);

ALTER TABLE public.event_ai_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their venue AI reports"
ON public.event_ai_reports FOR SELECT TO authenticated
USING (public.is_venue_owner(auth.uid(), venue_id));

-- Pas de policy INSERT/UPDATE/DELETE : seules les edge functions (service
-- role, bypass RLS) écrivent — le contenu vient toujours du serveur.
