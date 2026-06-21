-- A3 — Attribution DJ : un lien tracké par DJ et par soirée.
-- Étend le système tracked_links existant avec un 4e propriétaire ('dj'), sans
-- dupliquer la logique d'attribution. Un DJ ajouté à un line-up reçoit
-- automatiquement un lien /l/:code qu'il partage ; clics + billets/tables/boissons
-- achetés via ce lien lui sont attribués (clics + conversions + revenu).
-- Pas de commission ici : c'est de la VISIBILITÉ d'audience, pas un payout
-- (le payout viendra plus tard, branché sur dj_payments).

-- =============================================================================
-- 1. Colonne propriétaire DJ + contraintes
-- =============================================================================
ALTER TABLE public.tracked_links
  ADD COLUMN IF NOT EXISTS dj_id uuid REFERENCES public.djs(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tracked_links_dj ON public.tracked_links(dj_id) WHERE dj_id IS NOT NULL;

-- Autoriser 'dj' dans owner_kind (la check inline de colonne s'appelle <table>_<col>_check).
ALTER TABLE public.tracked_links DROP CONSTRAINT IF EXISTS tracked_links_owner_kind_check;
ALTER TABLE public.tracked_links
  ADD CONSTRAINT tracked_links_owner_kind_check CHECK (owner_kind IN ('venue','organizer','promoter','dj'));

-- Intégrité du propriétaire : on garde les 3 branches existantes à l'identique
-- (juste + dj_id IS NULL, vrai pour toutes les lignes existantes) et on ajoute 'dj'.
ALTER TABLE public.tracked_links DROP CONSTRAINT IF EXISTS tracked_links_owner_chk;
ALTER TABLE public.tracked_links ADD CONSTRAINT tracked_links_owner_chk CHECK (
  (owner_kind = 'venue'     AND venue_id IS NOT NULL          AND promoter_id IS NULL AND dj_id IS NULL) OR
  (owner_kind = 'organizer' AND organizer_user_id IS NOT NULL AND promoter_id IS NULL AND dj_id IS NULL) OR
  (owner_kind = 'promoter'  AND promoter_id IS NOT NULL                                AND dj_id IS NULL) OR
  (owner_kind = 'dj'        AND dj_id IS NOT NULL AND promoter_id IS NULL AND venue_id IS NULL AND organizer_user_id IS NULL)
);

-- =============================================================================
-- 2. RLS — le DJ gère et lit ses propres liens (en plus des 3 propriétaires existants)
-- =============================================================================
DROP POLICY IF EXISTS tracked_links_owner_all ON public.tracked_links;
CREATE POLICY tracked_links_owner_all ON public.tracked_links
  FOR ALL TO authenticated
  USING (
    (owner_kind = 'venue'     AND EXISTS (SELECT 1 FROM public.venues v    WHERE v.id = tracked_links.venue_id   AND v.owner_id = auth.uid())) OR
    (owner_kind = 'organizer' AND organizer_user_id = auth.uid()) OR
    (owner_kind = 'promoter'  AND EXISTS (SELECT 1 FROM public.promoters p WHERE p.id = tracked_links.promoter_id AND p.user_id = auth.uid())) OR
    (owner_kind = 'dj'        AND EXISTS (SELECT 1 FROM public.djs d        WHERE d.id = tracked_links.dj_id       AND d.user_id = auth.uid()))
  )
  WITH CHECK (
    (owner_kind = 'venue'     AND EXISTS (SELECT 1 FROM public.venues v    WHERE v.id = tracked_links.venue_id   AND v.owner_id = auth.uid())) OR
    (owner_kind = 'organizer' AND organizer_user_id = auth.uid()) OR
    (owner_kind = 'promoter'  AND EXISTS (SELECT 1 FROM public.promoters p WHERE p.id = tracked_links.promoter_id AND p.user_id = auth.uid())) OR
    (owner_kind = 'dj'        AND EXISTS (SELECT 1 FROM public.djs d        WHERE d.id = tracked_links.dj_id       AND d.user_id = auth.uid()))
  );

DROP POLICY IF EXISTS tracked_link_clicks_owner_select ON public.tracked_link_clicks;
CREATE POLICY tracked_link_clicks_owner_select ON public.tracked_link_clicks
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tracked_links tl
    WHERE tl.id = tracked_link_clicks.tracked_link_id AND (
      (tl.owner_kind = 'venue'     AND EXISTS (SELECT 1 FROM public.venues v    WHERE v.id = tl.venue_id   AND v.owner_id = auth.uid())) OR
      (tl.owner_kind = 'organizer' AND tl.organizer_user_id = auth.uid()) OR
      (tl.owner_kind = 'promoter'  AND EXISTS (SELECT 1 FROM public.promoters p WHERE p.id = tl.promoter_id AND p.user_id = auth.uid())) OR
      (tl.owner_kind = 'dj'        AND EXISTS (SELECT 1 FROM public.djs d        WHERE d.id = tl.dj_id       AND d.user_id = auth.uid()))
    )
  ));

-- =============================================================================
-- 3. Auto-seed : un lien DJ par soirée dès qu'un DJ entre dans un line-up
-- =============================================================================
CREATE OR REPLACE FUNCTION public.seed_dj_event_tracked_link(p_event_id uuid, p_dj_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_dj_user uuid;
  v_label   text;
BEGIN
  SELECT user_id,
         COALESCE(NULLIF(trim(stage_name), ''),
                  NULLIF(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), ''),
                  'DJ')
    INTO v_dj_user, v_label
  FROM public.djs WHERE id = p_dj_id;

  IF v_dj_user IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id) THEN RETURN; END IF;

  -- Idempotent : un seul lien DJ par (soirée, DJ).
  IF NOT EXISTS (
    SELECT 1 FROM public.tracked_links
    WHERE event_id = p_event_id AND owner_kind = 'dj' AND dj_id = p_dj_id
  ) THEN
    INSERT INTO public.tracked_links
      (code, label, owner_kind, dj_id, created_by, target_kind, event_id, utm_source, utm_medium)
    VALUES
      (public.gen_tracked_link_code(), v_label, 'dj', p_dj_id, v_dj_user, 'event', p_event_id, 'dj', 'dj_link');
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_seed_dj_event_tracked_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.seed_dj_event_tracked_link(NEW.event_id, NEW.dj_id);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS seed_dj_tracked_link_on_lineup ON public.event_djs;
CREATE TRIGGER seed_dj_tracked_link_on_lineup
  AFTER INSERT ON public.event_djs
  FOR EACH ROW EXECUTE FUNCTION public.trg_seed_dj_event_tracked_link();

-- Backfill : line-ups existants sur les soirées à venir et actives.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT ed.event_id, ed.dj_id
    FROM public.event_djs ed
    JOIN public.events e ON e.id = ed.event_id
    WHERE e.is_active = true AND e.end_at >= now()
  LOOP
    PERFORM public.seed_dj_event_tracked_link(r.event_id, r.dj_id);
  END LOOP;
END $$;

-- =============================================================================
-- 4. Stats : étendre get_tracked_link_stats avec le scope 'dj'
--    (DROP + CREATE car on ajoute un paramètre : la signature change)
-- =============================================================================
DROP FUNCTION IF EXISTS public.get_tracked_link_stats(text,text,uuid,uuid,uuid);

CREATE OR REPLACE FUNCTION public.get_tracked_link_stats(
  p_owner_kind        text,
  p_venue_id          text  DEFAULT NULL,
  p_organizer_user_id uuid  DEFAULT NULL,
  p_promoter_id       uuid  DEFAULT NULL,
  p_dj_id             uuid  DEFAULT NULL,
  p_event_id          uuid  DEFAULT NULL
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

GRANT EXECUTE ON FUNCTION public.get_tracked_link_stats(text,text,uuid,uuid,uuid,uuid) TO authenticated;
