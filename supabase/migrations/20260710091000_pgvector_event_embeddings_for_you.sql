-- Fondation pgvector + recommandations « Pour toi » (Explore).
-- 1. Extension vector (schema extensions, convention Supabase).
-- 2. event_embeddings : un embedding par event public (text-embedding-3-small,
--    1536 dims), rafraîchi par le cron de process-scheduled-campaigns quand le
--    content_hash change. RLS deny-all : lecture client uniquement via la RPC.
-- 3. profiles.personalization_opt_out : opt-out RGPD des recommandations
--    personnalisées, respecté par la RPC.
-- 4. RPC get_for_you_events : vecteur de goût = moyenne des embeddings des
--    events achetés / favoris / venues suivies (12 mois), ranking cosine sur
--    les events publics à venir avec léger boost de proximité temporelle.

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE public.event_embeddings (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  embedding extensions.vector(1536) NOT NULL,
  content_hash text NOT NULL,
  model text NOT NULL DEFAULT 'text-embedding-3-small',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX event_embeddings_hnsw_idx
  ON public.event_embeddings
  USING hnsw (embedding extensions.vector_cosine_ops);

-- Deny-all : aucune policy → seul le service role (edge functions) lit/écrit.
ALTER TABLE public.event_embeddings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles
  ADD COLUMN personalization_opt_out boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.get_for_you_events(p_limit int DEFAULT 12)
RETURNS TABLE (event_id uuid, similarity double precision)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_taste extensions.vector(1536);
  v_opt_out boolean;
BEGIN
  IF v_user IS NULL THEN
    RETURN;
  END IF;

  SELECT p.personalization_opt_out INTO v_opt_out
  FROM public.profiles p WHERE p.id = v_user;
  IF COALESCE(v_opt_out, false) THEN
    RETURN;
  END IF;

  -- Vecteur de goût : moyenne des embeddings des events avec signal (12 mois).
  SELECT avg(e.embedding)::extensions.vector(1536) INTO v_taste
  FROM (
    SELECT t.event_id AS eid
    FROM public.tickets t
    WHERE t.user_id = v_user AND t.status = 'paid'
      AND t.created_at > now() - interval '12 months'
    UNION
    SELECT f.event_id
    FROM public.favorites f
    WHERE f.user_id = v_user AND f.event_id IS NOT NULL
      AND f.created_at > now() - interval '12 months'
    UNION
    SELECT ev.id
    FROM public.favorites f
    JOIN public.events ev ON ev.venue_id = f.venue_id
    WHERE f.user_id = v_user AND f.venue_id IS NOT NULL
      AND ev.start_at > now() - interval '12 months'
  ) sig
  JOIN public.event_embeddings e ON e.event_id = sig.eid;

  -- Aucun signal → aucune reco (cold-start propre : le front masque la section).
  IF v_taste IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT ev.id,
         1 - (emb.embedding OPERATOR(extensions.<=>) v_taste) AS similarity
  FROM public.events ev
  JOIN public.event_embeddings emb ON emb.event_id = ev.id
  WHERE ev.is_active = true
    AND ev.visibility = 'public'
    AND ev.is_discoverable = true
    AND ev.cancelled_at IS NULL
    AND ev.start_at > now()
    AND NOT EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.user_id = v_user AND t.event_id = ev.id AND t.status = 'paid'
    )
  -- Distance cosine + pénalité de 0.005 par jour d'éloignement : à similarité
  -- égale, la soirée la plus proche dans le temps remonte.
  ORDER BY (emb.embedding OPERATOR(extensions.<=>) v_taste)
    + (extract(epoch FROM (ev.start_at - now())) / 86400.0) * 0.005
  LIMIT greatest(1, least(p_limit, 30));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_for_you_events(int) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_for_you_events(int) TO authenticated;
