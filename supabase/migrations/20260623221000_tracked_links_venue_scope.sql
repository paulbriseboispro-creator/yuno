-- Liens trackés — cadrage de la page « Mon club ».
-- Bug : la page /owner/venue (TrackedLinksManager targetKind='venue') affichait
-- TOUS les liens du club, y compris les liens auto-seedés PAR SOIRÉE
-- (instagram/tiktok/newsletter/whatsapp × chaque event), car get_tracked_link_stats
-- ne filtrait jamais sur target_kind quand p_event_id était NULL. D'où la « multitude ».
--
-- Correctif :
--   1. get_tracked_link_stats accepte p_target_kind → la page club ne montre que
--      les liens permanents vers la page club (target_kind='venue').
--   2. seed_venue_tracked_links : un lien par canal vers la page club (un par origine).
--   3. Dédoublonnage des liens venue-target existants (un seul par canal).
--   4. Backfill de tous les clubs avec le jeu de canaux par défaut.

-- =============================================================================
-- 1. get_tracked_link_stats — ajout du filtre p_target_kind (DROP + CREATE : signature)
-- =============================================================================
DROP FUNCTION IF EXISTS public.get_tracked_link_stats(text,text,uuid,uuid,uuid,uuid);

CREATE OR REPLACE FUNCTION public.get_tracked_link_stats(
  p_owner_kind        text,
  p_venue_id          text  DEFAULT NULL,
  p_organizer_user_id uuid  DEFAULT NULL,
  p_promoter_id       uuid  DEFAULT NULL,
  p_dj_id             uuid  DEFAULT NULL,
  p_event_id          uuid  DEFAULT NULL,
  p_target_kind       text  DEFAULT NULL
) RETURNS TABLE (
  id          uuid,
  code        text,
  label       text,
  target_kind text,
  event_id    uuid,
  is_active   boolean,
  created_at  timestamptz,
  clicks      integer,
  conversions bigint,
  revenue     numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  -- Autorisation : le caller doit posséder le scope demandé.
  IF p_owner_kind = 'venue' THEN
    IF NOT EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.owner_id = auth.uid()) THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
  ELSIF p_owner_kind = 'organizer' THEN
    IF p_organizer_user_id IS NULL OR p_organizer_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
  ELSIF p_owner_kind = 'promoter' THEN
    IF NOT EXISTS (SELECT 1 FROM public.promoters p WHERE p.id = p_promoter_id AND p.user_id = auth.uid()) THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
  ELSIF p_owner_kind = 'dj' THEN
    IF NOT EXISTS (SELECT 1 FROM public.djs d WHERE d.id = p_dj_id AND d.user_id = auth.uid()) THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid owner_kind';
  END IF;

  RETURN QUERY
  WITH links AS (
    SELECT tl.* FROM public.tracked_links tl
    WHERE tl.owner_kind = p_owner_kind
      AND ( (p_owner_kind = 'venue'     AND tl.venue_id = p_venue_id)
         OR (p_owner_kind = 'organizer' AND tl.organizer_user_id = p_organizer_user_id)
         OR (p_owner_kind = 'promoter'  AND tl.promoter_id = p_promoter_id)
         OR (p_owner_kind = 'dj'        AND tl.dj_id = p_dj_id) )
      AND (p_event_id IS NULL OR tl.event_id = p_event_id)
      AND (p_target_kind IS NULL OR tl.target_kind = p_target_kind)
  ),
  conv AS (
    SELECT tracked_link_id, count(*)::bigint AS c, coalesce(sum(amt), 0) AS rev
    FROM (
      SELECT tracked_link_id, total_price AS amt FROM public.tickets            WHERE tracked_link_id IS NOT NULL AND status IN ('paid','served')
      UNION ALL
      SELECT tracked_link_id, total_price AS amt FROM public.table_reservations WHERE tracked_link_id IS NOT NULL AND status IN ('paid','served')
      UNION ALL
      SELECT tracked_link_id, total       AS amt FROM public.orders             WHERE tracked_link_id IS NOT NULL AND status IN ('paid','served')
    ) all_conv
    GROUP BY tracked_link_id
  )
  SELECT l.id, l.code, l.label, l.target_kind, l.event_id, l.is_active, l.created_at,
         l.clicks_count, coalesce(conv.c, 0), coalesce(conv.rev, 0)
  FROM links l
  LEFT JOIN conv ON conv.tracked_link_id = l.id
  ORDER BY l.created_at DESC;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_tracked_link_stats(text,text,uuid,uuid,uuid,uuid,text) TO authenticated;

-- =============================================================================
-- 2. seed_venue_tracked_links — un lien permanent par canal vers la page club
--    (un par origine, idempotent). Symétrique de seed_event_tracked_links.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.seed_venue_tracked_links(p_venue_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_owner_id uuid;
  v_channel  text;
  v_channels text[] := ARRAY['instagram','tiktok','newsletter','whatsapp'];
BEGIN
  SELECT owner_id INTO v_owner_id FROM public.venues WHERE id = p_venue_id;
  IF v_owner_id IS NULL THEN RETURN; END IF;

  -- Garde-fou : ne seed que le club du caller (la fonction est exposée aux clients).
  IF auth.uid() IS NOT NULL AND auth.uid() <> v_owner_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  FOREACH v_channel IN ARRAY v_channels LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.tracked_links
      WHERE venue_id = p_venue_id AND owner_kind = 'venue'
        AND target_kind = 'venue' AND lower(label) = v_channel
    ) THEN
      INSERT INTO public.tracked_links
        (code, label, owner_kind, venue_id, created_by, target_kind, target_venue_id, utm_source, utm_medium)
      VALUES
        (public.gen_tracked_link_code(), v_channel, 'venue', p_venue_id, v_owner_id, 'venue', p_venue_id, v_channel, 'profile_link');
    END IF;
  END LOOP;
END; $$;

GRANT EXECUTE ON FUNCTION public.seed_venue_tracked_links(text) TO authenticated;

-- =============================================================================
-- 3. Dédoublonnage des liens venue-target existants : un seul par (club, canal).
--    On garde le plus cliqué (puis le plus ancien).
-- =============================================================================
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY venue_id, lower(label)
           ORDER BY clicks_count DESC, created_at ASC
         ) AS rn
  FROM public.tracked_links
  WHERE owner_kind = 'venue' AND target_kind = 'venue'
)
DELETE FROM public.tracked_links
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- =============================================================================
-- 4. Backfill : doter chaque club du jeu de canaux permanents par défaut.
-- =============================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.venues LOOP
    PERFORM public.seed_venue_tracked_links(r.id);
  END LOOP;
END $$;
