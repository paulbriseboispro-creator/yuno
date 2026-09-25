-- ============================================================================
-- Page d'où vient un visiteur des pages d'agence.
--
-- Une vue de soirée ouverte depuis le linktree de l'agence créait une session
-- « page soirée » sans aucun lien avec le linktree qui l'avait amenée : Milo
-- (Mad by Night) voyait les vues du linktree et celles des soirées, jamais
-- combien de soirées son linktree avait fait ouvrir. previous_path garde la
-- page de l'app vue juste avant (ex. '/p/mad-by-night', '/explore'), posée
-- par useAffiliateVisitorTracking. Un chemin de l'app, jamais une URL tierce
-- ni un paramètre : aucune donnée personnelle.
-- ============================================================================

ALTER TABLE public.affiliate_visitor_sessions
  ADD COLUMN IF NOT EXISTS previous_path text;

COMMENT ON COLUMN public.affiliate_visitor_sessions.previous_path IS
  'Page de l''app vue juste avant (chemin seul, ex. /p/mad-by-night) — relie une vue de soirée au linktree ou à la page Yuno qui l''a amenée.';

ALTER TABLE public.affiliate_visitor_sessions
  DROP CONSTRAINT IF EXISTS affiliate_visitor_sessions_previous_path_len;
ALTER TABLE public.affiliate_visitor_sessions
  ADD CONSTRAINT affiliate_visitor_sessions_previous_path_len
  CHECK (previous_path IS NULL OR length(previous_path) <= 300);
