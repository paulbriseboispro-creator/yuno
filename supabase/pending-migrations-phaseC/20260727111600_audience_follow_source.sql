-- ─────────────────────────────────────────────────────────────────────────────
-- Phase C / item C3 — capture de la SOURCE d'acquisition d'un abonné.
--
-- « D'où viennent mes abonnés ? » Chaque follow porte désormais sa surface d'origine
-- (page club, page event, carte Explore, post-achat…). Motif calqué sur
-- yuno.skip_follow_ledger : un GUC transaction-local `yuno.follow_source` est posé par
-- une RPC qui enveloppe l'INSERT (même transaction), et les triggers de journal le
-- lisent. Piège évité : un `set_config` client dans une requête séparée ne survit pas à
-- l'INSERT suivant (pooling PostgREST) → l'INSERT DOIT se faire dans la même transaction
-- que le set_config, d'où les RPC follow_subject / follow_organizer.
--
-- Backward-compatible : si aucune source n'est posée, les triggers gardent 'trigger'
-- (comportement actuel). Les surfaces non instrumentées continuent en insert direct.
-- On ne touche QUE les triggers de FOLLOW (l'unfollow n'a pas de source d'acquisition),
-- et on PRÉSERVE le garde skip_follow_ledger tel quel.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Triggers de follow : source depuis le GUC (fallback 'trigger').
CREATE OR REPLACE FUNCTION public.audience_log_favorite_follow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_person uuid;
  v_source text := COALESCE(NULLIF(current_setting('yuno.follow_source', true), ''), 'trigger');
BEGIN
  IF current_setting('yuno.skip_follow_ledger', true) = '1' THEN
    RETURN NEW;                       -- no-op de dédup : ne rien journaliser
  END IF;

  IF NEW.favorite_type = 'club' AND NEW.venue_id IS NOT NULL THEN
    INSERT INTO public.audience_follow_events
      (subject_type, subject_id, follower_user_id, action, source)
      VALUES ('venue', NEW.venue_id, NEW.user_id, 'follow', v_source);

  ELSIF NEW.favorite_type = 'dj' AND NEW.dj_id IS NOT NULL THEN
    SELECT d.user_id INTO v_person FROM public.djs d WHERE d.id = NEW.dj_id;
    IF v_person IS NOT NULL THEN
      INSERT INTO public.audience_follow_events
        (subject_type, subject_id, follower_user_id, action, source)
        VALUES ('dj', v_person::text, NEW.user_id, 'follow', v_source);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.audience_log_org_follow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source text := COALESCE(NULLIF(current_setting('yuno.follow_source', true), ''), 'trigger');
BEGIN
  INSERT INTO public.audience_follow_events
    (subject_type, subject_id, follower_user_id, action, source)
    VALUES ('organizer', NEW.organizer_user_id::text, NEW.user_id, 'follow', v_source);
  RETURN NEW;
END;
$$;

-- 2. RPC d'insert qui pose la source dans la MÊME transaction que l'INSERT.
--    SECURITY INVOKER → la RLS de favorites (auth.uid() = user_id) s'applique.
CREATE OR REPLACE FUNCTION public.follow_subject(
  p_favorite_type text,
  p_target_id     text,
  p_source        text DEFAULT NULL
)
RETURNS SETOF public.favorites
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_favorite_type NOT IN ('club', 'dj') THEN
    RAISE EXCEPTION 'follow_subject: type % non supporté', p_favorite_type;
  END IF;
  PERFORM set_config('yuno.follow_source', COALESCE(NULLIF(btrim(p_source), ''), 'trigger'), true);
  RETURN QUERY
    INSERT INTO public.favorites (user_id, favorite_type, venue_id, dj_id)
    VALUES (
      auth.uid(), p_favorite_type,
      CASE WHEN p_favorite_type = 'club' THEN p_target_id END,
      CASE WHEN p_favorite_type = 'dj'   THEN p_target_id::uuid END
    )
    RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION public.follow_organizer(
  p_organizer_user_id uuid,
  p_source            text DEFAULT NULL
)
RETURNS SETOF public.organizer_profile_followers
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('yuno.follow_source', COALESCE(NULLIF(btrim(p_source), ''), 'trigger'), true);
  RETURN QUERY
    INSERT INTO public.organizer_profile_followers (organizer_user_id, user_id)
    VALUES (p_organizer_user_id, auth.uid())
    RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.follow_subject(text, text, text)   FROM public, anon;
REVOKE ALL ON FUNCTION public.follow_organizer(uuid, text)       FROM public, anon;
GRANT EXECUTE ON FUNCTION public.follow_subject(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.follow_organizer(uuid, text)     TO authenticated;

-- 3. Reporting : rendement par surface d'acquisition (exclut la reconstruction backfill).
CREATE OR REPLACE FUNCTION public.get_audience_sources(p_subject_type text, p_subject_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.can_read_audience(p_subject_type, p_subject_id) THEN
    RETURN jsonb_build_object('ok', false,
             'reason', CASE WHEN auth.uid() IS NULL THEN 'not_authenticated' ELSE 'forbidden' END);
  END IF;

  SELECT jsonb_build_object(
    'ok', true,
    'sources', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('source', src, 'count', c) ORDER BY c DESC)
      FROM (
        SELECT COALESCE(NULLIF(source, ''), 'trigger') AS src, count(*) c
          FROM public.audience_follow_events
         WHERE subject_type = p_subject_type AND subject_id = p_subject_id
           AND action = 'follow'
           AND source IS DISTINCT FROM 'backfill'
         GROUP BY 1
      ) s
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_audience_sources(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_audience_sources(text, text) TO authenticated;
