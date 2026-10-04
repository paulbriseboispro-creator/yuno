-- ============================================================================
-- Yuno CRM — segments « à vous » (enregistrés depuis la liste Clients ou créés
-- à partir d'un modèle) et liste courte des soirées pour les filtres.
--
-- crm_segments : une ligne par segment, définition au format du filtre de la
--   liste Clients (`_crm_filter_sql`) — { seg, f: {ev, last, last_gt_days, nb,
--   sp, rc, src, tags}, q }. Recalculé à chaque lecture : la règle est stockée,
--   jamais la liste des personnes. Les quatre segments automatiques (habitués,
--   occasionnels, nouveaux, endormis) ne sont pas des lignes : ce sont les
--   cycles de vie de `_crm_people_build`.
-- crm_segments_brief : nom + effectif de chaque segment (pastilles de Clients).
-- crm_events_brief : soirées récentes et à venir (filtre « Soirée »).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.crm_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL,
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  description text,
  template text,
  definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((venue_id IS NULL) <> (organizer_user_id IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_crm_segments_scope ON public.crm_segments (scope_key, created_at);
ALTER TABLE public.crm_segments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.crm_segment_save(
  p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_name text, p_definition jsonb,
  p_template text DEFAULT NULL, p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_id uuid;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF btrim(COALESCE(p_name, '')) = '' THEN RAISE EXCEPTION 'name_required' USING ERRCODE = '22023'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.crm_segments (scope_key, venue_id, organizer_user_id, name, description, template, definition, created_by)
    VALUES (v_key, p_venue_id, p_organizer_user_id, left(btrim(p_name), 80), p_description, p_template, COALESCE(p_definition, '{}'::jsonb), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.crm_segments
       SET name = left(btrim(p_name), 80),
           description = COALESCE(p_description, description),
           definition = COALESCE(p_definition, definition),
           updated_at = now()
     WHERE id = p_id AND scope_key = v_key
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN jsonb_build_object('id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_segment_delete(p_venue_id text, p_organizer_user_id uuid, p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.crm_segments WHERE id = p_id AND scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id);
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_segments_brief(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_out jsonb := '[]'::jsonb;
  v_n integer;
  v_j integer;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_segments s WHERE s.scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id)) THEN
    RETURN v_out;
  END IF;
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  FOR r IN SELECT s.id, s.name, s.description, s.template, s.definition, s.created_at
             FROM public.crm_segments s
            WHERE s.scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id)
            ORDER BY s.created_at LOOP
    EXECUTE format('SELECT count(*), count(*) FILTER (WHERE p.email_ok OR p.phone_ok) FROM _cp p WHERE %s', public._crm_filter_sql(r.definition, 'p'))
      INTO v_n, v_j;
    v_out := v_out || jsonb_build_object('id', r.id, 'name', r.name, 'description', r.description, 'template', r.template,
                                         'definition', r.definition, 'n', v_n, 'reachable', v_j, 'created_at', r.created_at);
  END LOOP;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_events_brief(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_limit integer DEFAULT 12)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN NULL ELSE
    COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'start_at') DESC) FROM (
      SELECT jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at,
                                'upcoming', COALESCE(e.end_at, e.start_at + interval '8 hours') > now()) AS x
        FROM public.events e
       WHERE ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
         AND (e.is_active OR e.external_source IS NOT NULL)
       ORDER BY abs(extract(epoch FROM e.start_at - now()))
       LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 12), 60))
    ) q), '[]'::jsonb) END;
$$;

REVOKE ALL ON FUNCTION public.crm_segment_save(text, uuid, uuid, text, jsonb, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_segment_delete(text, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_segments_brief(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_events_brief(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_segment_save(text, uuid, uuid, text, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_segment_delete(text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_segments_brief(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_events_brief(text, uuid, integer) TO authenticated;
