-- ============================================================================
-- Yuno CRM — liens de partage : seulement les emplacements où un lien se clique.
--
-- Instagram : le sticker lien d'une story ou le lien en bio (la légende d'un
-- post ou d'un reel n'est pas cliquable). TikTok : le lien en bio, rien d'autre.
-- Les liens d'e-mail, de SMS et de réponse Instagram ne se créent pas à la main :
-- Yuno les génère seul (`yuno-m-…`, `yuno-s-…`, `yuno-d-…`).
--
-- `_crm_link_kind_ok` (inchangée) reste la règle de LECTURE : un lien déjà
-- posé en post, reel, DM ou vidéo TikTok garde son rang dans la liste et ses
-- ventes. `_crm_link_creatable` est la règle de CRÉATION. Miroir front :
-- LINK_KINDS / LEGACY_KINDS (src/crm/lib/links.ts).
-- ============================================================================

CREATE OR REPLACE FUNCTION public._crm_link_creatable(p_platform text, p_placement text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (p_platform, p_placement) IN (
    ('instagram', 'story'), ('instagram', 'bio'),
    ('tiktok', 'bio'),
    ('whatsapp', 'group'), ('whatsapp', 'message'),
    ('facebook', 'post'), ('facebook', 'event'),
    ('snapchat', 'story'),
    ('other', 'flyer'), ('other', 'partner'), ('other', 'link')
  );
$$;

CREATE OR REPLACE FUNCTION public.crm_link_create(
  p_venue_id text,
  p_organizer_user_id uuid,
  p_event_id uuid,
  p_platform text,
  p_placement text,
  p_label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label text := NULLIF(left(btrim(COALESCE(p_label, '')), 60), '');
  v_n integer;
  v_row public.tracked_links%ROWTYPE;
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public._crm_link_event_ok(p_venue_id, p_organizer_user_id, p_event_id) THEN
    RAISE EXCEPTION 'event_not_found' USING ERRCODE = '22023';
  END IF;
  IF NOT public._crm_link_creatable(p_platform, p_placement) THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_n FROM public.tracked_links WHERE event_id = p_event_id;
  IF v_n >= 300 THEN RAISE EXCEPTION 'too_many_links' USING ERRCODE = '54000'; END IF;

  IF v_label IS NULL THEN
    SELECT count(*) + 1 INTO v_n FROM public.tracked_links
     WHERE event_id = p_event_id AND utm_source = p_platform AND utm_medium = p_placement;
    v_label := initcap(p_placement) || ' ' || v_n;
  END IF;

  INSERT INTO public.tracked_links (code, label, owner_kind, venue_id, organizer_user_id, created_by,
                                    target_kind, event_id, utm_source, utm_medium, utm_campaign)
  VALUES (public.gen_tracked_link_code(), v_label,
          CASE WHEN p_venue_id IS NOT NULL THEN 'venue' ELSE 'organizer' END,
          p_venue_id, CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END, auth.uid(),
          'event', p_event_id, p_platform, p_placement, 'yuno')
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('id', v_row.id, 'code', v_row.code, 'label', v_row.label,
    'platform', v_row.utm_source, 'placement', v_row.utm_medium, 'created_at', v_row.created_at);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_link_create(text, uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_link_create(text, uuid, uuid, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
