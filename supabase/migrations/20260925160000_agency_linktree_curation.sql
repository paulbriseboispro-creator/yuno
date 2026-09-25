-- ============================================================================
-- Linktree d'agence : le chef d'agence CHOISIT les soirées de son /p/:slug
-- (2026-09-25).
--
-- Constaté sur Mad by Night : la Console Agence réglait le linktree de chaque
-- promoteur, mais pas celui de l'agence elle-même. La table de sélection
-- `affiliate_linktree_events` existait depuis juin, aucun écran ne l'écrivait :
-- le linktree affichait donc toujours les 8 prochaines soirées externes + TOUTES
-- les soirées Yuno des clubs sous contrat, sans que l'agence puisse rien y
-- changer.
--
-- 1. Une ligne de sélection vise SOIT une soirée externe (`affiliate_event_id`),
--    SOIT une soirée Yuno d'un club / orga sous contrat actif (`event_id`).
-- 2. Écriture par UNE porte : `set_agency_linktree_events` (remplace la
--    sélection entière, dans l'ordre donné, en revérifiant chaque soirée).
--    La policy d'écriture directe tombe : elle laissait épingler n'importe
--    quelle soirée externe d'un autre affilié.
-- 3. Lecture publique des soirées Yuno choisies par
--    `get_agency_linktree_curated_yuno` (anon, mêmes gardes que
--    `get_agency_linktree_yuno_events` : public, actif, non annulé, à venir,
--    contrat actif). Une soirée qui sort du périmètre disparaît d'elle-même.
-- 4. Sélection vide = linktree automatique, comme avant : rien ne change pour
--    une agence qui ne touche à rien.
-- ============================================================================

ALTER TABLE public.affiliate_linktree_events
  ALTER COLUMN affiliate_event_id DROP NOT NULL;

ALTER TABLE public.affiliate_linktree_events
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE public.affiliate_linktree_events
  DROP CONSTRAINT IF EXISTS affiliate_linktree_events_one_target;
ALTER TABLE public.affiliate_linktree_events
  ADD CONSTRAINT affiliate_linktree_events_one_target
  CHECK (num_nonnulls(affiliate_event_id, event_id) = 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_affiliate_linktree_yuno_event
  ON public.affiliate_linktree_events (affiliate_id, event_id)
  WHERE event_id IS NOT NULL;

-- L'écriture passe par la RPC, qui valide chaque soirée.
DROP POLICY IF EXISTS "Affiliate manages linktree events" ON public.affiliate_linktree_events;
REVOKE INSERT, UPDATE, DELETE ON public.affiliate_linktree_events FROM anon, authenticated;

-- ─── Qui gère le linktree de l'agence ─────────────────────────────────────
-- Le titulaire du bras affilié (= le chef d'agence) ou un manager actif :
-- exactement ceux qui réglaient déjà adresse et tri.
CREATE OR REPLACE FUNCTION public.can_manage_affiliate_linktree(p_affiliate_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.affiliates a
            WHERE a.id = p_affiliate_id AND a.user_id = auth.uid())
    OR public.is_affiliate_manager(auth.uid(), p_affiliate_id)
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_affiliate_linktree(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_affiliate_linktree(uuid) TO authenticated;

-- ─── Périmètre Yuno de l'agence (sans plafond) ────────────────────────────
-- Même jointure et mêmes gardes que get_agency_linktree_yuno_events, qui reste
-- la source du mode automatique (plafonnée à 24).
CREATE OR REPLACE FUNCTION public._agency_linktree_yuno_scope(p_affiliate_id uuid)
RETURNS TABLE(
  event_id     uuid,
  title        text,
  start_at     timestamptz,
  venue_id     text,
  venue_name   text,
  venue_city   text,
  poster_url   text,
  music_genres text[],
  price_from   numeric,
  is_free      boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id,
    e.title,
    e.start_at,
    e.venue_id,
    v.name,
    v.city,
    COALESCE(e.poster_url, e.image_url),
    COALESCE(e.music_genres, ARRAY[e.music_genre]),
    MIN(tr.price) FILTER (WHERE tr.is_active),
    COALESCE(MIN(tr.price) FILTER (WHERE tr.is_active), 0) <= 0
  FROM affiliates a
  JOIN agency_venue_contracts avc
    ON avc.agency_id = a.agency_id AND avc.status = 'active'
  JOIN events e
    ON (avc.venue_id IS NOT NULL AND e.venue_id = avc.venue_id)
    OR (avc.organizer_user_id IS NOT NULL AND e.organizer_user_id = avc.organizer_user_id)
  LEFT JOIN venues v ON v.id = e.venue_id
  LEFT JOIN ticket_rounds tr ON tr.event_id = e.id
  WHERE a.id = p_affiliate_id
    AND a.is_active = true
    AND a.agency_id IS NOT NULL
    AND e.is_active = true
    AND e.visibility = 'public'
    AND e.cancelled_at IS NULL
    AND e.end_at >= now()
  GROUP BY e.id, e.title, e.start_at, e.venue_id, v.name, v.city,
           e.poster_url, e.image_url, e.music_genres, e.music_genre;
$$;

REVOKE ALL ON FUNCTION public._agency_linktree_yuno_scope(uuid) FROM PUBLIC, anon, authenticated;

-- ─── Lecture publique : les soirées Yuno CHOISIES ─────────────────────────
CREATE OR REPLACE FUNCTION public.get_agency_linktree_curated_yuno(p_affiliate_id uuid)
RETURNS TABLE(
  event_id     uuid,
  title        text,
  start_at     timestamptz,
  venue_id     text,
  venue_name   text,
  venue_city   text,
  poster_url   text,
  music_genres text[],
  price_from   numeric,
  is_free      boolean,
  sort_order   int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.event_id, s.title, s.start_at, s.venue_id, s.venue_name, s.venue_city,
         s.poster_url, s.music_genres, s.price_from, s.is_free, l.sort_order
  FROM public.affiliate_linktree_events l
  JOIN public._agency_linktree_yuno_scope(p_affiliate_id) s ON s.event_id = l.event_id
  WHERE l.affiliate_id = p_affiliate_id
    AND l.event_id IS NOT NULL
  ORDER BY l.sort_order, s.start_at
  LIMIT 60;
$$;

GRANT EXECUTE ON FUNCTION public.get_agency_linktree_curated_yuno(uuid) TO anon, authenticated;

-- ─── Éditeur : sélection + catalogue Yuno ─────────────────────────────────
-- Le catalogue externe se lit directement (affiliate_events, RLS du titulaire).
CREATE OR REPLACE FUNCTION public.get_agency_linktree_editor(p_affiliate_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_selection jsonb;
  v_yuno      jsonb;
BEGIN
  IF NOT public.can_manage_affiliate_linktree(p_affiliate_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'kind', CASE WHEN l.event_id IS NOT NULL THEN 'yuno' ELSE 'external' END,
           'id', COALESCE(l.event_id, l.affiliate_event_id),
           'sort_order', l.sort_order
         ) ORDER BY l.sort_order, l.created_at), '[]'::jsonb)
    INTO v_selection
  FROM public.affiliate_linktree_events l
  WHERE l.affiliate_id = p_affiliate_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.start_at), '[]'::jsonb)
    INTO v_yuno
  FROM (
    SELECT * FROM public._agency_linktree_yuno_scope(p_affiliate_id)
    ORDER BY start_at
    LIMIT 300
  ) s;

  RETURN jsonb_build_object('selection', v_selection, 'yuno', v_yuno);
END;
$$;

REVOKE ALL ON FUNCTION public.get_agency_linktree_editor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_agency_linktree_editor(uuid) TO authenticated;

-- ─── Écriture : la sélection entière, dans l'ordre ────────────────────────
-- p_items = [{"kind":"external"|"yuno","id":"<uuid>"}, …] ; l'ordre du tableau
-- devient sort_order. Une soirée hors périmètre (autre affilié, club sans
-- contrat, privée, passée) est ignorée, jamais épinglée. Tableau vide =
-- retour au linktree automatique. Rend le nombre de soirées retenues.
CREATE OR REPLACE FUNCTION public.set_agency_linktree_events(p_affiliate_id uuid, p_items jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT public.can_manage_affiliate_linktree(p_affiliate_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_items) > 60 THEN
    RAISE EXCEPTION 'too_many_items' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.affiliate_linktree_events WHERE affiliate_id = p_affiliate_id;

  WITH raw AS (
    SELECT it->>'kind' AS kind, it->>'id' AS id_txt, ord
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS x(it, ord)
    WHERE it->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  ext AS (
    SELECT DISTINCT ON (ae.id) ae.id, r.ord
    FROM raw r
    JOIN public.affiliate_events ae ON ae.id = r.id_txt::uuid
    WHERE r.kind = 'external'
      AND ae.affiliate_id = p_affiliate_id
      AND ae.event_date >= (now() AT TIME ZONE 'Europe/Paris')::date
    ORDER BY ae.id, r.ord
  ),
  yun AS (
    SELECT DISTINCT ON (s.event_id) s.event_id AS id, r.ord
    FROM raw r
    JOIN public._agency_linktree_yuno_scope(p_affiliate_id) s ON s.event_id = r.id_txt::uuid
    WHERE r.kind = 'yuno'
    ORDER BY s.event_id, r.ord
  ),
  ins AS (
    INSERT INTO public.affiliate_linktree_events (affiliate_id, affiliate_event_id, event_id, sort_order)
    SELECT p_affiliate_id, id, NULL, ord::int FROM ext
    UNION ALL
    SELECT p_affiliate_id, NULL, id, ord::int FROM yun
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.set_agency_linktree_events(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_agency_linktree_events(uuid, jsonb) TO authenticated;
