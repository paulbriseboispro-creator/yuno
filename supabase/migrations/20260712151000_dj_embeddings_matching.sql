-- DJ matching sémantique : réutilise la fondation pgvector des recommandations
-- « Pour toi » (20260710091000). Un embedding par profil DJ (nom de scène,
-- genres, bio, ville), rafraîchi par le même cron que les events. La RPC
-- match_djs_for_event classe les DJs par proximité sémantique avec une soirée
-- (genres + identité de la nuit), pas par complétude de profil.

CREATE TABLE public.dj_embeddings (
  dj_id uuid PRIMARY KEY REFERENCES public.djs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  embedding extensions.vector(1536) NOT NULL,
  content_hash text NOT NULL,
  model text NOT NULL DEFAULT 'text-embedding-3-small',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dj_embeddings_hnsw_idx
  ON public.dj_embeddings
  USING hnsw (embedding extensions.vector_cosine_ops);

CREATE INDEX dj_embeddings_user_idx ON public.dj_embeddings (user_id);

-- Deny-all : aucune policy → seul le service role (edge functions) lit/écrit.
-- Les bookers passent par la RPC ci-dessous.
ALTER TABLE public.dj_embeddings ENABLE ROW LEVEL SECURITY;

-- match_djs_for_event — les DJs dont l'univers colle le mieux à la soirée.
-- Réservée aux bookers de la soirée (owner du club OU organisateur), comme
-- toutes les surfaces booking. Dédupliquée par personne (un DJ peut avoir
-- plusieurs fiches) : on garde sa meilleure similarité.
CREATE OR REPLACE FUNCTION public.match_djs_for_event(
  p_event_id uuid,
  p_limit    int DEFAULT 6
) RETURNS TABLE (
  user_id           uuid,
  dj_id             uuid,
  handle            text,
  slug              text,
  stage_name        text,
  city              text,
  profile_image_url text,
  music_genres      text[],
  is_verified       boolean,
  similarity        double precision
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_event RECORD;
  v_emb   extensions.vector(1536);
BEGIN
  IF v_user IS NULL THEN
    RETURN;
  END IF;

  SELECT e.id, e.venue_id, e.organizer_user_id, e.partner_organizer_id
    INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Le caller doit être un booker de CETTE soirée.
  IF NOT (
    (v_event.venue_id IS NOT NULL AND public.is_venue_owner(v_user, v_event.venue_id))
    OR v_event.organizer_user_id = v_user
    OR v_event.partner_organizer_id = v_user
  ) THEN
    RETURN;
  END IF;

  SELECT ee.embedding INTO v_emb
  FROM public.event_embeddings ee
  WHERE ee.event_id = p_event_id;

  -- Pas encore d'embedding pour cette soirée (cron pas passé) → aucun match,
  -- le front masque la section.
  IF v_emb IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH best AS (
    SELECT DISTINCT ON (de.user_id)
      de.user_id,
      de.dj_id,
      1 - (de.embedding OPERATOR(extensions.<=>) v_emb) AS similarity
    FROM public.dj_embeddings de
    JOIN public.djs d ON d.id = de.dj_id
    WHERE d.is_active = true
    ORDER BY de.user_id, (de.embedding OPERATOR(extensions.<=>) v_emb) ASC
  )
  SELECT
    b.user_id,
    b.dj_id,
    h.handle,
    d.slug,
    COALESCE(NULLIF(btrim(d.stage_name), ''),
             btrim(COALESCE(d.first_name, '') || ' ' || COALESCE(d.last_name, ''))) AS stage_name,
    d.city,
    d.profile_image_url,
    COALESCE(d.music_genres, '{}') AS music_genres,
    COALESCE(d.is_verified, false) AS is_verified,
    b.similarity
  FROM best b
  JOIN public.djs d ON d.id = b.dj_id
  LEFT JOIN public.dj_handles h ON h.user_id = b.user_id
  -- Sous 0.15 de similarité cosine, le « match » n'en est plus un : mieux vaut
  -- ne rien proposer que du bruit.
  WHERE b.similarity > 0.15
  ORDER BY b.similarity DESC
  LIMIT greatest(1, least(p_limit, 20));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.match_djs_for_event(uuid, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.match_djs_for_event(uuid, int) TO authenticated;
