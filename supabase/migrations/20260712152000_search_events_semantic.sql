-- Recherche sémantique Explore : quand la recherche par mots-clés (ILIKE sur
-- titre + genre) ne trouve rien, on repêche par le SENS de la requête
-- (« soirée chill pour danser sans techno », « anniversaire entre potes »).
-- Réutilise event_embeddings (fondation pgvector, 20260710091000).
--
-- Le vecteur est calculé côté serveur par yuno-assistant (utilisateurs
-- authentifiés uniquement — pas d'endpoint d'embedding ouvert à l'anonyme,
-- qui serait un vecteur d'abus de coût OpenAI). Il arrive ici en texte et est
-- casté : c'est la façon portable de passer un vector via PostgREST.

CREATE OR REPLACE FUNCTION public.search_events_semantic(
  p_embedding text,
  p_limit     int DEFAULT 10
) RETURNS TABLE (
  event_id   uuid,
  similarity double precision
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_vec extensions.vector(1536);
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    v_vec := p_embedding::extensions.vector(1536);
  EXCEPTION WHEN OTHERS THEN
    -- Vecteur malformé → aucun résultat plutôt qu'une erreur 500 côté client.
    RETURN;
  END;

  RETURN QUERY
  SELECT
    e.id,
    1 - (emb.embedding OPERATOR(extensions.<=>) v_vec) AS similarity
  FROM public.events e
  JOIN public.event_embeddings emb ON emb.event_id = e.id
  WHERE e.is_active = true
    AND e.visibility = 'public'
    AND e.is_discoverable = true
    AND e.cancelled_at IS NULL
    AND e.end_at > now()
  -- Sous 0.20, ce n'est plus un repêchage mais du bruit : mieux vaut
  -- assumer « aucun résultat » que proposer n'importe quoi.
  AND (1 - (emb.embedding OPERATOR(extensions.<=>) v_vec)) > 0.20
  ORDER BY (emb.embedding OPERATOR(extensions.<=>) v_vec) ASC
  LIMIT greatest(1, least(p_limit, 20));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.search_events_semantic(text, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_events_semantic(text, int) TO authenticated;
