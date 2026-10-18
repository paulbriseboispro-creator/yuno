-- MCP : itérer sur un brouillon avec son IA, et lui donner des images
-- (2026-10-06, suite de 20261009150000).
--
-- 1. Itérer sans écraser le pro : email_campaigns.ai_updated_at (posé par
--    chaque écriture de l'IA, lu par les deux Studios qui adoptent la version
--    de l'IA et refusent d'enregistrer par-dessus) ; get_email_draft rend une
--    `version` (updated_at en microsecondes) et _mcp_email_write refuse
--    `draft_changed` quand l'IA modifie une version qui n'est plus la bonne.
-- 2. Images : une image collée dans le chat (ChatGPT), une image d'un site,
--    ou une image que le pro dépose sur une page Yuno. L'IA ouvre un
--    EMPLACEMENT (add_email_image, mcp_write) : un code à usage unique, 30
--    minutes, rattaché à l'espace. Le fichier part dans le seau public
--    email-assets à `mcp/<code>/image.<ext>` par la clé PUBLIQUE (policy
--    `mcp_image_slot_open`) : le Worker n'y gagne aucun droit. Puis
--    mcp_image_finish vérifie que le fichier existe et rend l'image prête.

SET lock_timeout = '5s';

ALTER TABLE public.email_campaigns ADD COLUMN IF NOT EXISTS ai_updated_at timestamptz;
COMMENT ON COLUMN public.email_campaigns.ai_updated_at IS
  'Dernière écriture du brouillon par une IA (mcp_write). Le Studio adopte cette version et ne réécrit jamais par-dessus.';

CREATE OR REPLACE FUNCTION public._mcp_draft_version(p_at timestamptz)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT (floor(extract(epoch FROM p_at) * 1000000))::bigint::text $$;

-- ── Images ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.mcp_email_images (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text NOT NULL UNIQUE CHECK (code ~ '^[0-9a-f]{32}$'),
  grant_id          uuid REFERENCES public.mcp_grants(id) ON DELETE SET NULL,
  user_id           uuid NOT NULL,
  venue_id          text,
  organizer_user_id uuid,
  name              text,
  source            text NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'url', 'chat_file')),
  status            text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'ready')),
  storage_name      text,
  url               text,
  mime              text,
  bytes             integer,
  width             integer,
  height            integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  ready_at          timestamptz,
  CHECK ((venue_id IS NULL) <> (organizer_user_id IS NULL))
);
CREATE INDEX IF NOT EXISTS mcp_email_images_scope_idx
  ON public.mcp_email_images (venue_id, organizer_user_id, created_at DESC);
ALTER TABLE public.mcp_email_images ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mcp_email_images FROM PUBLIC, anon, authenticated;

-- Un emplacement : l'IA de la personne, dans un espace où elle écrit des e-mails.
CREATE OR REPLACE FUNCTION public._mcp_email_image_add(
  p_kind text, p_space_id text, p_space_product text, p_args jsonb, p_uid uuid, p_grant uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_venue text := CASE WHEN p_kind = 'venue' THEN p_space_id END;
  v_org   uuid := CASE WHEN p_kind = 'organizer' THEN p_space_id::uuid END;
  v_ok    boolean := false;
  v_p     text;
  v_code  text := replace(gen_random_uuid()::text, '-', '');
  v_id    uuid;
  v_exp   timestamptz := now() + interval '30 minutes';
BEGIN
  FOREACH v_p IN ARRAY public._mcp_email_products(v_venue, v_org, p_space_product) LOOP
    IF public._mcp_space_can_draft(p_uid, v_venue, v_org, v_p) THEN v_ok := true; END IF;
  END LOOP;
  IF NOT v_ok THEN RETURN jsonb_build_object('ok', false, 'error', 'write_forbidden'); END IF;
  INSERT INTO public.mcp_email_images (code, grant_id, user_id, venue_id, organizer_user_id, name, source, expires_at)
  VALUES (v_code, p_grant, p_uid, v_venue, v_org, left(nullif(btrim(coalesce(p_args->>'name', '')), ''), 80),
          CASE WHEN p_args->>'source' IN ('upload', 'url', 'chat_file') THEN p_args->>'source' ELSE 'upload' END, v_exp)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'image_id', v_id, 'code', v_code, 'expires_at', v_exp);
END;
$$;

-- Lue par la policy de stockage : un nom de fichier qui désigne un emplacement
-- ouvert. Connaître le code est la seule clé.
CREATE OR REPLACE FUNCTION public.mcp_image_slot_open(p_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text := substring(coalesce(p_name, '') FROM '^mcp/([0-9a-f]{32})/image\.(?:jpg|png|gif|webp)$');
BEGIN
  IF v_code IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.mcp_email_images m
                  WHERE m.code = v_code AND m.status = 'waiting' AND m.expires_at > now());
END;
$$;

-- L'état d'un emplacement (page d'envoi, Worker).
CREATE OR REPLACE FUNCTION public.mcp_image_slot(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  IF coalesce(p_code, '') !~ '^[0-9a-f]{32}$' THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  SELECT m.*, coalesce(v.name, op.display_name) AS space_name
    INTO r
    FROM public.mcp_email_images m
    LEFT JOIN public.venues v ON v.id = m.venue_id
    LEFT JOIN public.organizer_profiles op ON op.user_id = m.organizer_user_id
   WHERE m.code = p_code;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true,
    'status', CASE WHEN r.status = 'waiting' AND r.expires_at <= now() THEN 'expired' ELSE r.status END,
    'name', r.name, 'space_name', r.space_name, 'expires_at', r.expires_at,
    'url', r.url, 'width', r.width, 'height', r.height);
END;
$$;

-- Le fichier est arrivé : vérifié dans le stockage, l'image devient prête.
CREATE OR REPLACE FUNCTION public.mcp_image_finish(
  p_code text, p_name text, p_url text, p_mime text, p_bytes integer, p_width integer, p_height integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  IF coalesce(p_code, '') !~ '^[0-9a-f]{32}$' THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  SELECT * INTO r FROM public.mcp_email_images WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF r.status = 'ready' THEN RETURN jsonb_build_object('ok', false, 'error', 'already_used', 'url', r.url); END IF;
  IF r.expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'error', 'expired'); END IF;
  IF coalesce(p_name, '') !~ ('^mcp/' || p_code || '/image\.(jpg|png|gif|webp)$')
     OR coalesce(p_url, '') NOT LIKE ('https://%/storage/v1/object/public/email-assets/' || p_name)
     OR coalesce(p_mime, '') NOT IN ('image/jpeg', 'image/png', 'image/gif', 'image/webp') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'email-assets' AND o.name = p_name) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_uploaded');
  END IF;
  UPDATE public.mcp_email_images SET
    status = 'ready', storage_name = p_name, url = p_url, mime = p_mime,
    bytes = p_bytes, width = nullif(p_width, 0), height = nullif(p_height, 0), ready_at = now()
   WHERE id = r.id;
  RETURN jsonb_build_object('ok', true, 'image_id', r.id, 'url', p_url, 'width', nullif(p_width, 0), 'height', nullif(p_height, 0), 'name', r.name);
END;
$$;

DROP POLICY IF EXISTS "Email assets: AI image slot" ON storage.objects;
CREATE POLICY "Email assets: AI image slot" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'email-assets' AND public.mcp_image_slot_open(name));

-- ── Brouillons : version, horodatage IA ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public._mcp_email_write(p_tool text, p_kind text, p_space_id text, p_space_product text, p_args jsonb, p_uid uuid, p_grant uuid, p_client text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue    text := CASE WHEN p_kind = 'venue' THEN p_space_id END;
  v_org      uuid := CASE WHEN p_kind = 'organizer' THEN p_space_id::uuid END;
  v_products text[] := public._mcp_email_products(v_venue, v_org, p_space_product);
  v_product  text;
  v_lang     text;
  v_ids      uuid[];
  v_event    uuid;
  v_has_ev   boolean := p_args ? 'event';
  v_aud      jsonb;
  v_one      jsonb;
  v_id       text;
  v_blocks   jsonb;
  v_theme    jsonb;
  v_social   jsonb;
  v_logo     text;
  v_excl     jsonb;
  v_quiet    boolean := true;
  v_waves    boolean := false;
  v_audtype  text;
  v_segid    uuid;
  c          public.email_campaigns%ROWTYPE;
  v_new      uuid;
  v_net      integer;
  v_prev     jsonb;
BEGIN
  -- ── Le brouillon visé (modification) ou le produit choisi (création) ──
  IF p_tool = 'update_email_draft' THEN
    IF coalesce(p_args->>'draft_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'draft_not_found');
    END IF;
    SELECT * INTO c FROM public.email_campaigns ec
     WHERE ec.id = (p_args->>'draft_id')::uuid
       AND ec.venue_id IS NOT DISTINCT FROM v_venue AND ec.organizer_user_id IS NOT DISTINCT FROM v_org
       AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'draft_not_found'); END IF;
    IF c.status <> 'draft' THEN RETURN jsonb_build_object('ok', false, 'error', 'draft_not_editable', 'status', c.status); END IF;
    -- Contrôle de version : l'IA modifie la version qu'elle a lue. Si le pro
    -- l'a retouchée dans le Studio entre-temps, rien n'est écrit.
    IF nullif(p_args->>'expected_version', '') IS NOT NULL
       AND p_args->>'expected_version' <> public._mcp_draft_version(c.updated_at) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'draft_changed', 'version', public._mcp_draft_version(c.updated_at));
    END IF;
    v_product := coalesce(c.product, CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(c.audiences_json) a WHERE a->>'kind' = 'crm') THEN 'crm' ELSE 'suite' END);
  ELSIF p_tool = 'create_email_draft' THEN
    v_product := coalesce(nullif(p_args->>'product', ''), CASE WHEN p_space_product = 'crm' THEN 'crm' ELSE 'suite' END);
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
  END IF;
  IF NOT (v_product = ANY (v_products)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'product_not_available', 'products', to_jsonb(v_products));
  END IF;
  IF NOT public._mcp_space_can_draft(p_uid, v_venue, v_org, v_product) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'write_forbidden', 'product', v_product);
  END IF;

  v_lang := CASE WHEN p_args->>'language' IN ('fr', 'en', 'es') THEN p_args->>'language' END;

  -- ── Soirée ──
  IF v_has_ev THEN
    IF nullif(btrim(coalesce(p_args->>'event', '')), '') IS NULL OR lower(p_args->>'event') IN ('none', 'null') THEN
      v_event := NULL;
    ELSE
      v_ids := public._mcp_email_scope_events(v_venue, v_org);
      IF v_product = 'suite' THEN
        SELECT coalesce(array_agg(x), '{}') INTO v_ids FROM unnest(v_ids) x
         WHERE EXISTS (SELECT 1 FROM public.events e WHERE e.id = x AND e.external_source IS NULL);
      END IF;
      v_event := public._mcp_resolve_event(p_args->>'event', v_ids);
      IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    END IF;
  END IF;

  -- ── Audience ──
  IF p_args ? 'audience' THEN
    v_aud := '[]'::jsonb;
    FOR v_id IN SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_args->'audience') = 'array' THEN p_args->'audience' ELSE '[]'::jsonb END) LOOP
      v_one := public._mcp_email_audience(v_id, v_product, v_venue, v_org, coalesce(v_lang, 'fr'));
      IF v_one IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'audience_not_found', 'audience', v_id); END IF;
      v_aud := v_aud || v_one;
    END LOOP;
    -- Un nom posé par l'IA remplace le libellé d'une audience CRM définie par règle.
    IF v_product = 'crm' AND nullif(btrim(coalesce(p_args->>'audience_label', '')), '') IS NOT NULL
       AND jsonb_array_length(v_aud) = 1 AND NOT (v_aud->0 ? 'segmentId') THEN
      v_aud := jsonb_build_array((v_aud->0) || jsonb_build_object('label', left(btrim(p_args->>'audience_label'), 80)));
    END IF;
    IF v_product = 'crm' THEN
      v_audtype := CASE WHEN jsonb_array_length(v_aud) > 0 THEN 'imported_list' END;
    ELSIF jsonb_array_length(v_aud) = 1 THEN
      v_audtype := CASE v_aud->0->>'kind'
        WHEN 'segment' THEN 'custom_segment'
        WHEN 'import' THEN 'imported_list'
        WHEN 'contact_segment' THEN 'imported_list'
        ELSE v_aud->0->>'kind' END;
      v_segid := CASE WHEN v_aud->0->>'kind' = 'segment' AND v_venue IS NOT NULL THEN (v_aud->0->>'segmentId')::uuid END;
    ELSE
      v_audtype := CASE WHEN jsonb_array_length(v_aud) > 0 THEN 'all_subscribers' END;
    END IF;
  END IF;

  -- ── Contenu (déjà nettoyé et contrôlé par le Worker ; revérifié ici) ──
  IF p_args ? 'blocks' THEN
    v_blocks := p_args->'blocks';
    IF jsonb_typeof(v_blocks) <> 'array' OR jsonb_array_length(v_blocks) NOT BETWEEN 1 AND 40
       OR length(v_blocks::text) > 300000
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_blocks) b
                   WHERE jsonb_typeof(b) <> 'object'
                      OR coalesce(b->>'type', '') NOT IN ('html', 'header', 'image', 'text', 'cta', 'divider', 'spacer', 'social',
                                                          'event', 'tickets', 'guestlist', 'table', 'countdown', 'lineup')
                      OR coalesce(b->>'id', '') = '') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_content');
    END IF;
  END IF;
  IF p_args ? 'theme' THEN
    v_theme := p_args->'theme';
    IF jsonb_typeof(v_theme) <> 'object' OR length(v_theme::text) > 4000 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_content');
    END IF;
  END IF;
  IF p_args ? 'exclusions' AND jsonb_typeof(p_args->'exclusions') = 'object' THEN
    v_excl := jsonb_strip_nulls(jsonb_build_object(
      'recentDays', CASE WHEN (p_args->'exclusions'->>'recentDays') ~ '^[0-9]{1,2}$' AND (p_args->'exclusions'->>'recentDays')::integer BETWEEN 1 AND 30
                         THEN (p_args->'exclusions'->>'recentDays')::integer END,
      'excludeEventBuyers', CASE WHEN (p_args->'exclusions'->>'excludeEventBuyers') IN ('true', 'false') THEN (p_args->'exclusions'->>'excludeEventBuyers')::boolean END));
  END IF;

  -- ── Création ──
  IF p_tool = 'create_email_draft' THEN
    IF v_blocks IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_content'); END IF;
    IF v_venue IS NOT NULL THEN
      SELECT vv.logo_url, jsonb_strip_nulls(jsonb_build_object('instagram', vv.instagram_url, 'tiktok', vv.tiktok_url,
               'facebook', vv.facebook_url, 'x', vv.twitter_url))
        INTO v_logo, v_social FROM public.venues vv WHERE vv.id = v_venue;
    ELSE
      SELECT op.avatar_url, jsonb_strip_nulls(jsonb_build_object('instagram', op.instagram_url, 'website', op.website_url))
        INTO v_logo, v_social FROM public.organizer_profiles op WHERE op.user_id = v_org;
    END IF;
    SELECT coalesce(cs.quiet_hours, true), coalesce(cs.waves, false) INTO v_quiet, v_waves
      FROM public.crm_email_settings cs WHERE cs.scope_key = public.crm_scope_key(v_venue, v_org);
    v_quiet := coalesce(v_quiet, true);
    v_waves := coalesce(v_waves, false) AND v_product = 'crm';

    INSERT INTO public.email_campaigns (
      name, type, subject, subject_b, ab_enabled, preheader, blocks_json, blocks_version, theme_json, social_links_json,
      logo_url, event_id, audiences_json, audience_type, segment_id, exclusions_json, quiet_hours,
      throttle_per_hour, throttle_window_minutes, throttle_plan,
      status, venue_id, organizer_user_id, created_by, product, language, ai_author, mcp_grant_id, ai_updated_at)
    VALUES (
      left(coalesce(nullif(btrim(p_args->>'name'), ''), 'E-mail'), 200), 'promotional',
      left(coalesce(nullif(btrim(p_args->>'subject'), ''), '—'), 250),
      nullif(left(btrim(coalesce(p_args->>'subject_b', '')), 250), ''),
      nullif(btrim(coalesce(p_args->>'subject_b', '')), '') IS NOT NULL,
      left(coalesce(p_args->>'preheader', ''), 300),
      v_blocks, 2, coalesce(v_theme, '{}'::jsonb), coalesce(v_social, '{}'::jsonb),
      v_logo, v_event, coalesce(v_aud, '[]'::jsonb), v_audtype, v_segid,
      coalesce(v_excl, jsonb_build_object('recentDays', 3)), v_quiet,
      CASE WHEN v_waves THEN 500 END, 60, CASE WHEN v_waves THEN jsonb_build_object('mode', 'hour', 'days', 2, 'custom', true) END,
      'draft', v_venue, v_org, p_uid, v_product, v_lang, left(coalesce(nullif(btrim(p_client), ''), 'AI'), 60), p_grant, now())
    RETURNING * INTO c;
  ELSE
    UPDATE public.email_campaigns ec SET
      name = CASE WHEN nullif(btrim(coalesce(p_args->>'name', '')), '') IS NOT NULL THEN left(btrim(p_args->>'name'), 200) ELSE ec.name END,
      subject = CASE WHEN nullif(btrim(coalesce(p_args->>'subject', '')), '') IS NOT NULL THEN left(btrim(p_args->>'subject'), 250) ELSE ec.subject END,
      subject_b = CASE WHEN p_args ? 'subject_b' THEN nullif(left(btrim(coalesce(p_args->>'subject_b', '')), 250), '') ELSE ec.subject_b END,
      ab_enabled = CASE WHEN p_args ? 'subject_b' THEN nullif(btrim(coalesce(p_args->>'subject_b', '')), '') IS NOT NULL ELSE ec.ab_enabled END,
      preheader = CASE WHEN p_args ? 'preheader' THEN left(coalesce(p_args->>'preheader', ''), 300) ELSE ec.preheader END,
      language = CASE WHEN p_args ? 'language' THEN v_lang ELSE ec.language END,
      event_id = CASE WHEN v_has_ev THEN v_event ELSE ec.event_id END,
      audiences_json = coalesce(v_aud, ec.audiences_json),
      audience_type = CASE WHEN v_aud IS NOT NULL THEN v_audtype ELSE ec.audience_type END,
      segment_id = CASE WHEN v_aud IS NOT NULL THEN v_segid ELSE ec.segment_id END,
      exclusions_json = coalesce(v_excl, ec.exclusions_json),
      theme_json = coalesce(v_theme, ec.theme_json),
      blocks_json = coalesce(v_blocks, ec.blocks_json),
      blocks_version = 2,
      ai_author = coalesce(ec.ai_author, left(coalesce(nullif(btrim(p_client), ''), 'AI'), 60)),
      mcp_grant_id = coalesce(ec.mcp_grant_id, p_grant),
      ai_updated_at = now()
     WHERE ec.id = c.id AND ec.status = 'draft'
    RETURNING * INTO c;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'draft_not_editable'); END IF;
  END IF;

  -- ── Effectif net de l'audience (ne fait jamais échouer l'écriture) ──
  IF jsonb_array_length(coalesce(c.audiences_json, '[]'::jsonb)) > 0 THEN
    BEGIN
      IF v_product = 'crm' THEN
        v_prev := public.crm_email_audience_preview(v_venue, v_org, c.audiences_json, c.event_id,
                    CASE WHEN (c.exclusions_json->>'recentDays') ~ '^[0-9]+$' THEN (c.exclusions_json->>'recentDays')::integer END,
                    coalesce((c.exclusions_json->>'excludeEventBuyers')::boolean, false), c.id);
        v_net := (v_prev->>'net')::integer;
      ELSE
        v_net := (public.count_campaign_audience(c.id)->>'net')::integer;
      END IF;
    EXCEPTION WHEN others THEN v_net := NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'draft_id', c.id, 'created', p_tool = 'create_email_draft', 'name', c.name, 'status', c.status,
    'product', v_product, 'language', coalesce(c.language, 'fr'),
    'subject', nullif(c.subject, '—'), 'ab_test', c.ab_enabled,
    'event', CASE WHEN c.event_id IS NOT NULL THEN (SELECT jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at) FROM public.events e WHERE e.id = c.event_id) END,
    'audience', jsonb_build_object(
      'groups', (SELECT coalesce(jsonb_agg(coalesce(a->>'label', a->>'kind')), '[]'::jsonb) FROM jsonb_array_elements(coalesce(c.audiences_json, '[]'::jsonb)) a),
      'recipients_now', v_net,
      'exclusions', c.exclusions_json),
    'sections', jsonb_array_length(c.blocks_json),
    'version', public._mcp_draft_version(c.updated_at),
    'venue_id', c.venue_id, 'organizer_user_id', c.organizer_user_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public._mcp_email_tool(p_tool text, p_kind text, p_space_id text, p_product text, p_tz text, p_args jsonb, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue    text := CASE WHEN p_kind = 'venue' THEN p_space_id END;
  v_org      uuid := CASE WHEN p_kind = 'organizer' THEN p_space_id::uuid END;
  v_products text[] := public._mcp_email_products(v_venue, v_org, p_product);
  v_product  text;
  gate       record;
  v_ids      uuid[];
  v_event    uuid;
  v          jsonb;
  v_aud      jsonb := '[]'::jsonb;
  v_n        integer;
  v_all      integer := 0;
  r          record;
  v_lang     text;
BEGIN
  SELECT * INTO gate FROM public.analytics_scope_gate(v_venue, v_org);
  IF NOT coalesce(gate.ok, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden', 'reason', gate.reason);
  END IF;
  v_product := coalesce(nullif(p_args->>'product', ''), CASE WHEN p_product = 'crm' THEN 'crm' ELSE 'suite' END);
  IF NOT (v_product = ANY (v_products)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'product_not_available', 'products', to_jsonb(v_products));
  END IF;
  SELECT CASE WHEN preferred_language IN ('fr', 'en', 'es') THEN preferred_language ELSE 'fr' END INTO v_lang FROM public.profiles WHERE id = p_uid;
  v_lang := coalesce(v_lang, 'fr');

  CASE p_tool
  -- ── Kit de design ─────────────────────────────────────────────────────────
  WHEN 'get_email_design_kit' THEN
    v_ids := public._mcp_email_scope_events(v_venue, v_org);
    IF nullif(btrim(coalesce(p_args->>'event', '')), '') IS NOT NULL THEN
      v_event := public._mcp_resolve_event(p_args->>'event', v_ids);
      IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'product', v_product,
      'products_available', to_jsonb(v_products),
      'can_create_drafts', public._mcp_space_can_draft(p_uid, v_venue, v_org, v_product),
      'language_hint', v_lang,
      'brand', CASE WHEN v_venue IS NOT NULL THEN (
          SELECT jsonb_strip_nulls(jsonb_build_object('name', vv.name, 'logo_url', vv.logo_url, 'city', vv.city,
                   'cover_url', vv.cover_url,
                   'social', jsonb_strip_nulls(jsonb_build_object('instagram', vv.instagram_url, 'tiktok', vv.tiktok_url,
                                                'facebook', vv.facebook_url, 'x', vv.twitter_url))))
            FROM public.venues vv WHERE vv.id = v_venue)
        ELSE (
          SELECT jsonb_strip_nulls(jsonb_build_object('name', op.display_name, 'logo_url', op.avatar_url, 'city', op.city,
                   'cover_url', op.cover_url,
                   'social', jsonb_strip_nulls(jsonb_build_object('instagram', op.instagram_url, 'website', op.website_url))))
            FROM public.organizer_profiles op WHERE op.user_id = v_org) END,
      'sender', (SELECT jsonb_strip_nulls(jsonb_build_object('name', cs.sender_name, 'postal_address', cs.postal_address,
                          'quiet_hours', cs.quiet_hours))
                   FROM public.crm_email_settings cs WHERE cs.scope_key = public.crm_scope_key(v_venue, v_org)),
      'recent_email_themes', coalesce((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('campaign', x.name, 'status', x.status,
                   'background', x.theme_json->>'bg', 'card', x.theme_json->>'card', 'text', x.theme_json->>'text',
                   'accent', x.theme_json->>'accent', 'dark', x.theme_json->'dark', 'radius', x.theme_json->'radius')))
            FROM (SELECT ec.name, ec.status, ec.theme_json FROM public.email_campaigns ec
                   WHERE ec.venue_id IS NOT DISTINCT FROM v_venue AND ec.organizer_user_id IS NOT DISTINCT FROM v_org
                     AND ec.blocks_version >= 2 AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
                     AND jsonb_typeof(ec.theme_json) = 'object'
                   ORDER BY ec.updated_at DESC LIMIT 3) x), '[]'::jsonb),
      'upcoming_events', coalesce((
          SELECT jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'start_at', x.start_at,
                   'sales', CASE WHEN x.external_source IS NOT NULL THEN 'external' ELSE 'yuno' END,
                   'has_poster', coalesce(x.poster_url, x.image_url) IS NOT NULL) ORDER BY x.start_at)
            FROM (SELECT e.* FROM public.events e
                   WHERE e.id = ANY (v_ids)
                     AND coalesce(e.end_at, e.start_at + interval '8 hours') >= now()
                     AND (v_product = 'crm' OR e.external_source IS NULL)
                     AND (e.is_active OR e.external_source IS NOT NULL)
                   ORDER BY e.start_at LIMIT 12) x), '[]'::jsonb),
      'event', CASE WHEN v_event IS NOT NULL THEN public._mcp_email_event_facts(v_event) END,
      'recent_drafts', coalesce((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('draft_id', x.id, 'name', x.name, 'subject', nullif(x.subject, '—'),
                   'product', coalesce(x.product, 'suite'), 'prepared_by', x.ai_author, 'edited', to_char(x.updated_at, 'YYYY-MM-DD HH24:MI'))))
            FROM (SELECT ec.* FROM public.email_campaigns ec
                   WHERE ec.venue_id IS NOT DISTINCT FROM v_venue AND ec.organizer_user_id IS NOT DISTINCT FROM v_org
                     AND ec.status = 'draft' AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
                   ORDER BY ec.updated_at DESC LIMIT 8) x), '[]'::jsonb));

  -- ── Audiences ─────────────────────────────────────────────────────────────
  WHEN 'list_email_audiences' THEN
    IF v_product = 'crm' THEN
      v := public.crm_email_send_options(v_venue, v_org);   -- construit _cso (joignables)
      FOR r IN SELECT x FROM jsonb_array_elements(coalesce(v->'auto', '[]'::jsonb)) x LOOP
        v_all := v_all + coalesce((r.x->>'reach')::integer, 0);
        v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'id', 'lifecycle:' || (r.x->>'key'),
          'label', (public._mcp_email_audience('lifecycle:' || (r.x->>'key'), 'crm', v_venue, v_org, v_lang)->0->>'label'),
          'reachable', coalesce((r.x->>'reach')::integer, 0),
          'open_rate_pct', r.x->'open_pct', 'click_rate_pct', r.x->'click_pct',
          'rule', CASE r.x->>'key'
            WHEN 'hab' THEN 'Regulars: came to several nights recently (the account''s regular rule).'
            WHEN 'occ' THEN 'Occasional: came, but not often enough to be a regular.'
            WHEN 'nou' THEN 'New: first night recently, or a ticket for an upcoming night and no night yet.'
            WHEN 'end' THEN 'Dormant: used to come, has not come back for several months.'
            ELSE 'Known contacts who never came to a night (imports, signups).' END)));
      END LOOP;
      v_aud := jsonb_build_array(jsonb_build_object('id', 'all',
                 'label', CASE v_lang WHEN 'en' THEN 'Whole base' WHEN 'es' THEN 'Toda la base' ELSE 'Toute la base' END,
                 'reachable', v_all, 'rule', 'Every contact who accepted your emails (all lifecycle groups). Use it for a global announcement.'))
               || v_aud;
      FOR r IN SELECT x FROM jsonb_array_elements(coalesce(v->'saved', '[]'::jsonb)) x LOOP
        v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'id', 'segment:' || (r.x->>'id'), 'label', r.x->>'name', 'reachable', coalesce((r.x->>'reach')::integer, 0),
          'open_rate_pct', r.x->'open_pct', 'click_rate_pct', r.x->'click_pct',
          'rule', coalesce(nullif(r.x->>'description', ''), 'Saved segment of the account.'))));
      END LOOP;
      FOR r IN SELECT * FROM (VALUES
          ('preset:vip', 'Spent 200 € or more in total.'),
          ('preset:loyal', 'Came to 4 nights or more.'),
          ('preset:buyers', 'Bought at least one paid ticket.'),
          ('preset:recent', 'Came in the last 3 months.'),
          ('preset:lapsed', 'Last night 3 to 12 months ago.'),
          ('preset:has_upcoming', 'Already have a ticket or an invitation for an upcoming night.'),
          ('preset:no_upcoming', 'No ticket yet for an upcoming night.'),
          ('preset:clickers', 'Clicked an email link in the last 3 months.'),
          ('preset:gl_loyal', 'Came on the guest list 3 nights or more, never paid.')) p(k, rule)
      LOOP
        BEGIN
          EXECUTE format('SELECT count(*)::integer FROM _cso p WHERE (%s)',
                         public._crm_filter_sql(public._mcp_email_audience(r.k, 'crm', v_venue, v_org, v_lang)->0->'def', 'p'))
            INTO v_n;
        EXCEPTION WHEN others THEN v_n := NULL;
        END;
        v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'id', r.k, 'label', public._mcp_email_audience(r.k, 'crm', v_venue, v_org, v_lang)->0->>'label',
          'reachable', v_n, 'rule', r.rule, 'kind', 'yuno_preset')));
      END LOOP;
      RETURN jsonb_build_object('ok', true, 'product', 'crm', 'audiences', v_aud,
        'reachable_means', 'Contacts with an email who accepted your emails (newsletter opt-in) and are not suppressed. Yuno sending rules may still protect some at send time.',
        'exclusions', jsonb_build_object(
          'exclude_event_buyers', 'Skip people who already bought a ticket for the linked night (recommended for a last call, not for a first announcement).',
          'exclude_recent_days', 'Skip people who received an email from this account in the last N days (default 3).'));
    END IF;

    -- Billetterie
    IF v_venue IS NOT NULL THEN
      FOR r IN SELECT * FROM (VALUES
          ('all_subscribers', 'Every contact who accepted your emails.'),
          ('vip', 'Customers who spent 500 € or more.'),
          ('big_spenders', 'Customers who spent 1,000 € or more.'),
          ('regulars', 'Customers who came 2 to 4 times.'),
          ('new_customers', 'Customers who came once or never.'),
          ('dormant', 'Customers with no purchase for 90 days.')) k(kind, rule)
      LOOP
        BEGIN
          v_n := public.count_campaign_recipients(v_venue, 'promotional', r.kind, NULL, NULL);
        EXCEPTION WHEN others THEN v_n := NULL;
        END;
        v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'id', CASE WHEN r.kind = 'all_subscribers' THEN 'all' ELSE 'kind:' || r.kind END,
          'label', public._mcp_email_kind_label(r.kind, v_lang), 'reachable', v_n, 'rule', r.rule)));
      END LOOP;
      FOR r IN SELECT s.id, s.name FROM public.venue_segments s WHERE s.venue_id = v_venue ORDER BY s.created_at DESC LIMIT 20 LOOP
        BEGIN
          v_n := public.count_campaign_recipients(v_venue, 'promotional', 'custom_segment', NULL, r.id);
        EXCEPTION WHEN others THEN v_n := NULL;
        END;
        v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', 'segment:' || r.id, 'label', r.name, 'reachable', v_n, 'rule', 'Saved customer segment.')));
      END LOOP;
    ELSE
      BEGIN
        v := public.count_organizer_audience_kinds(v_org, NULL);
      EXCEPTION WHEN others THEN v := '{}'::jsonb;
      END;
      FOR r IN SELECT * FROM (VALUES
          ('all_subscribers', 'Every contact who accepted your emails.'),
          ('vip', 'Customers who spent 500 € or more.'),
          ('big_spenders', 'Customers who spent 1,000 € or more.'),
          ('regulars', 'Customers who came 2 to 4 times.'),
          ('new_customers', 'Customers who came once or never.'),
          ('dormant', 'Customers with no purchase for 90 days.')) k(kind, rule)
      LOOP
        v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'id', CASE WHEN r.kind = 'all_subscribers' THEN 'all' ELSE 'kind:' || r.kind END,
          'label', public._mcp_email_kind_label(r.kind, v_lang), 'reachable', (v->>r.kind)::integer, 'rule', r.rule)));
      END LOOP;
    END IF;
    FOR r IN SELECT s.id, s.name, s.description FROM public.contact_segments s
              WHERE s.venue_id IS NOT DISTINCT FROM v_venue AND s.organizer_user_id IS NOT DISTINCT FROM v_org
              ORDER BY s.created_at DESC LIMIT 20 LOOP
      v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', 'contact_segment:' || r.id, 'label', r.name,
                 'rule', coalesce(nullif(r.description, ''), 'Segment of the contact base (imports and Yuno customers).'))));
    END LOOP;
    FOR r IN SELECT i.id, coalesce(nullif(i.list_name, ''), i.filename) AS name, i.inserted_count FROM public.email_list_imports i
              WHERE i.venue_id IS NOT DISTINCT FROM v_venue AND i.organizer_user_id IS NOT DISTINCT FROM v_org AND i.superseded_at IS NULL
              ORDER BY i.created_at DESC LIMIT 20 LOOP
      v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', 'import:' || r.id, 'label', r.name,
                 'imported', r.inserted_count, 'rule', 'Imported contact list (only its opted-in contacts receive).')));
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'product', 'suite', 'audiences', v_aud,
      'reachable_means', 'Contacts who accepted your emails (newsletter opt-in) and are not suppressed.',
      'exclusions', jsonb_build_object(
        'exclude_event_buyers', 'Skip people who already bought a ticket for the linked night.',
        'exclude_recent_days', 'Skip people who received an email from this account in the last N days (default 3).'));

  -- ── Relire un brouillon ou une campagne ───────────────────────────────────
  WHEN 'get_email_draft' THEN
    IF coalesce(p_args->>'draft_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'draft_not_found');
    END IF;
    SELECT jsonb_build_object(
        'ok', true, 'draft_id', ec.id, 'name', ec.name, 'status', ec.status,
        'product', coalesce(ec.product, CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(ec.audiences_json) a WHERE a->>'kind' = 'crm') THEN 'crm' ELSE 'suite' END),
        'subject', nullif(ec.subject, '—'), 'subject_b', ec.subject_b, 'ab_test', ec.ab_enabled, 'preheader', ec.preheader,
        'language', coalesce(ec.language, 'fr'), 'prepared_by', ec.ai_author,
        'event', CASE WHEN ec.event_id IS NOT NULL THEN (SELECT jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at) FROM public.events e WHERE e.id = ec.event_id) END,
        'audience', ec.audiences_json, 'exclusions', ec.exclusions_json,
        'theme', ec.theme_json, 'social_links', ec.social_links_json,
        'blocks_version', ec.blocks_version, 'sections', ec.blocks_json,
        'version', public._mcp_draft_version(ec.updated_at), 'edited_at', ec.updated_at, 'ai_edited_at', ec.ai_updated_at,
        'sent_at', ec.sent_at, 'recipients', CASE WHEN ec.status IN ('sent', 'sending') THEN ec.recipients_count END,
        'venue_id', ec.venue_id, 'organizer_user_id', ec.organizer_user_id)
      INTO v
      FROM public.email_campaigns ec
     WHERE ec.id = (p_args->>'draft_id')::uuid
       AND ec.venue_id IS NOT DISTINCT FROM v_venue AND ec.organizer_user_id IS NOT DISTINCT FROM v_org
       AND ec.automation_id IS NULL;
    IF v IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'draft_not_found'); END IF;
    RETURN v;

  -- ── Images ajoutées par l'IA (emplacements d'envoi et images prêtes) ─────
  WHEN 'list_email_images' THEN
    RETURN jsonb_build_object('ok', true, 'images', coalesce((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'image_id', i.id, 'name', i.name,
               'status', CASE WHEN i.status = 'waiting' AND i.expires_at <= now() THEN 'expired' ELSE i.status END,
               'url', i.url, 'width', i.width, 'height', i.height, 'source', i.source,
               'upload_page', CASE WHEN i.status = 'waiting' AND i.expires_at > now() THEN 'https://yunoapp.eu/ai/image/' || i.code END,
               'added', to_char(i.created_at AT TIME ZONE coalesce(p_tz, 'Europe/Paris'), 'YYYY-MM-DD HH24:MI')))
             ORDER BY i.created_at DESC)
        FROM (SELECT m.* FROM public.mcp_email_images m
               WHERE m.venue_id IS NOT DISTINCT FROM v_venue AND m.organizer_user_id IS NOT DISTINCT FROM v_org
                 AND m.created_at > now() - interval '30 days'
                 AND (m.status = 'ready' OR (m.status = 'waiting' AND m.expires_at > now() - interval '1 hour'))
               ORDER BY m.created_at DESC LIMIT 20) i), '[]'::jsonb));

  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
  END CASE;
END;
$function$;

-- ── Lectures et écriture : la liste des images rejoint les outils ───────────

CREATE OR REPLACE FUNCTION public.mcp_call(p_access_hash text, p_tool text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a        record;
  s        record;
  v_args   jsonb := CASE WHEN jsonb_typeof(p_args) = 'object' THEN p_args ELSE '{}'::jsonb END;
  v_space  text;
  v_call   bigint;
  v_res    jsonb;
  v_min    integer;
  v_day    integer;
  v_cust   integer;
  v_has_space boolean;
BEGIN
  SELECT * INTO a FROM public._mcp_access(p_access_hash);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;

  IF p_tool IS NULL OR p_tool !~ '^[a-z_]{3,40}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
  END IF;

  -- Espace : celui demandé, sinon celui où la personne a le plus de droits
  -- (propriétaire / fondateur, puis admin, puis manager), Yuno Suite avant
  -- Yuno CRM, club avant organisation, puis par nom. `a.spaces` est trié par
  -- clé : son premier élément n'avait aucun sens pour la personne.
  v_space := nullif(btrim(coalesce(v_args->>'space', '')), '');
  -- Une IA passe parfois le NOM de l'espace (« Organisateur Démo ») au lieu de
  -- sa clé : on le reconnaît plutôt que de répondre « espace hors connexion ».
  IF v_space IS NOT NULL AND NOT (v_space = ANY (a.spaces)) THEN
    SELECT u.space_key INTO v_space
      FROM public._mcp_user_spaces(a.user_id) u
     WHERE u.space_key = ANY (a.spaces) AND lower(u.name) = lower(v_space)
     LIMIT 1;
    v_space := coalesce(v_space, nullif(btrim(v_args->>'space'), ''));
  END IF;
  IF v_space IS NULL THEN
    SELECT u.space_key INTO v_space
      FROM public._mcp_user_spaces(a.user_id) u
     WHERE u.space_key = ANY (a.spaces)
     ORDER BY CASE WHEN u.role IN ('owner', 'founder') THEN 0 WHEN u.role = 'admin' THEN 1 WHEN u.role = 'manager' THEN 2 ELSE 3 END,
              (u.product = 'crm'), (u.kind <> 'venue'), u.name
     LIMIT 1;
    v_space := coalesce(v_space, a.spaces[1]);
  END IF;
  SELECT * INTO s FROM public._mcp_user_spaces(a.user_id) u
   WHERE u.space_key = v_space AND v_space = ANY (a.spaces)
   ORDER BY (u.role = 'owner' OR u.role = 'founder') DESC LIMIT 1;
  v_has_space := FOUND;

  -- Débits : 60 appels / minute, 3 000 / jour, 100 lectures de fiches / jour.
  SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute'),
         count(*),
         count(*) FILTER (WHERE public._mcp_customer_tool(tool) AND status = 'ok')
    INTO v_min, v_day, v_cust
    FROM public.mcp_tool_calls
   WHERE grant_id = a.grant_id AND created_at > now() - interval '1 day';

  IF NOT v_has_space THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_args - 'space', 'denied', 'space_not_allowed');
    RETURN jsonb_build_object('ok', false, 'error', 'space_not_allowed',
      'spaces', to_jsonb(a.spaces));
  END IF;

  IF v_min >= 60 OR v_day >= 3000 OR (public._mcp_customer_tool(p_tool) AND v_cust >= 100) THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_args - 'space', 'rate_limited', NULL);
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  IF public._mcp_customer_tool(p_tool) AND NOT (a.level = 'customers' AND s.customers) THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_args - 'space', 'denied', 'customers_level_required');
    RETURN jsonb_build_object('ok', false, 'error', 'customers_level_required');
  END IF;

  INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args)
  VALUES (a.grant_id, a.user_id, p_tool, v_space,
          CASE WHEN length((v_args - 'space')::text) <= 2000 THEN v_args - 'space' ELSE jsonb_build_object('truncated', true) END)
  RETURNING id INTO v_call;
  UPDATE public.mcp_grants SET last_used_at = now(), calls_count = calls_count + 1 WHERE id = a.grant_id;

  BEGIN
    -- La personne, et elle seule : auth.uid(), auth.role(), auth.jwt() la
    -- désignent pour toutes les RPC appelées ensuite. Les deux formes de claims
    -- sont posées (la forme « claim.x » est lue en priorité par auth.uid()).
    PERFORM set_config('request.jwt.claims', jsonb_build_object(
      'sub', a.user_id, 'role', 'authenticated', 'aud', 'authenticated', 'yuno_mcp_grant', a.grant_id)::text, true);
    PERFORM set_config('request.jwt.claim.sub', a.user_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.session_id', '', true);
    IF NOT public._mcp_needs_temp(p_tool) THEN
      PERFORM set_config('transaction_read_only', 'on', true);
    END IF;

    IF p_tool IN ('get_email_design_kit', 'list_email_audiences', 'get_email_draft', 'list_email_images') THEN
      v_res := public._mcp_email_tool(p_tool, s.kind, s.space_id, s.product, s.timezone, v_args, a.user_id);
    ELSE
      v_res := public._mcp_tool(p_tool, s.kind, s.space_id, s.product, s.timezone, v_args, a.level);
    END IF;
    v_res := public._mcp_redact(v_res, NOT public._mcp_customer_tool(p_tool));
  EXCEPTION WHEN others THEN
    -- Sous-transaction annulée : claims et lecture seule tombent avec elle, on
    -- peut noter l'échec.
    UPDATE public.mcp_tool_calls SET status = 'error', error = left(SQLSTATE || ' ' || SQLERRM, 300) WHERE id = v_call;
    RETURN jsonb_build_object('ok', false, 'error', 'internal', 'call_id', v_call,
      'message', CASE WHEN SQLSTATE IN ('22P02', '22007', '22008', '22023') THEN 'invalid argument' ELSE 'query failed' END);
  END;

  RETURN jsonb_build_object('ok', coalesce((v_res->>'ok')::boolean, true), 'call_id', v_call,
    'space', jsonb_build_object('key', s.space_key, 'name', s.name, 'kind', s.kind, 'product', s.product),
    'result', v_res);
END;
$function$;

CREATE OR REPLACE FUNCTION public.mcp_write(p_access_hash text, p_tool text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a          record;
  s          record;
  v_args     jsonb := CASE WHEN jsonb_typeof(p_args) = 'object' THEN p_args ELSE '{}'::jsonb END;
  v_space    text;
  v_call     bigint;
  v_res      jsonb;
  v_min      integer;
  v_day      integer;
  v_creates  integer;
  v_updates  integer;
  v_images   integer;
  v_can      boolean;
  v_has_space boolean;
  v_summary  jsonb;
BEGIN
  SELECT * INTO a FROM public._mcp_access(p_access_hash);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  IF p_tool NOT IN ('create_email_draft', 'update_email_draft', 'add_email_image') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
  END IF;

  -- Même choix d'espace que mcp_call.
  v_space := nullif(btrim(coalesce(v_args->>'space', '')), '');
  IF v_space IS NOT NULL AND NOT (v_space = ANY (a.spaces)) THEN
    SELECT u.space_key INTO v_space FROM public._mcp_user_spaces(a.user_id) u
     WHERE u.space_key = ANY (a.spaces) AND lower(u.name) = lower(v_space) LIMIT 1;
    v_space := coalesce(v_space, nullif(btrim(v_args->>'space'), ''));
  END IF;
  IF v_space IS NULL THEN
    SELECT u.space_key INTO v_space FROM public._mcp_user_spaces(a.user_id) u
     WHERE u.space_key = ANY (a.spaces)
     ORDER BY CASE WHEN u.role IN ('owner', 'founder') THEN 0 WHEN u.role = 'admin' THEN 1 WHEN u.role = 'manager' THEN 2 ELSE 3 END,
              (u.product = 'crm'), (u.kind <> 'venue'), u.name
     LIMIT 1;
    v_space := coalesce(v_space, a.spaces[1]);
  END IF;
  SELECT * INTO s FROM public._mcp_user_spaces(a.user_id) u
   WHERE u.space_key = v_space AND v_space = ANY (a.spaces)
   ORDER BY (u.role = 'owner' OR u.role = 'founder') DESC LIMIT 1;
  v_has_space := FOUND;

  -- Journal : un résumé, jamais le HTML entier.
  v_summary := jsonb_strip_nulls(jsonb_build_object(
    'draft_id', v_args->>'draft_id', 'product', v_args->>'product', 'event', left(v_args->>'event', 120),
    'name', left(v_args->>'name', 120), 'subject', left(v_args->>'subject', 160),
    'audience', CASE WHEN jsonb_typeof(v_args->'audience') = 'array' THEN v_args->'audience' END,
    'sections', CASE WHEN jsonb_typeof(v_args->'blocks') = 'array' THEN jsonb_array_length(v_args->'blocks') END,
    'bytes', CASE WHEN v_args ? 'blocks' THEN length((v_args->'blocks')::text) END,
    'language', v_args->>'language', 'image', CASE WHEN p_tool = 'add_email_image' THEN left(coalesce(v_args->>'name', v_args->>'source'), 80) END));

  SELECT g.can_draft INTO v_can FROM public.mcp_grants g WHERE g.id = a.grant_id;
  IF NOT coalesce(v_can, false) THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_summary, 'denied', 'drafts_not_allowed');
    RETURN jsonb_build_object('ok', false, 'error', 'drafts_not_allowed');
  END IF;
  IF NOT v_has_space THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_summary, 'denied', 'space_not_allowed');
    RETURN jsonb_build_object('ok', false, 'error', 'space_not_allowed', 'spaces', to_jsonb(a.spaces));
  END IF;

  -- Débits : 60 appels / minute et 3 000 / jour (comme mcp_call), 30
  -- brouillons créés et 200 modifications par jour et par connexion.
  SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute'),
         count(*),
         count(*) FILTER (WHERE tool = 'create_email_draft' AND status = 'ok'),
         count(*) FILTER (WHERE tool = 'update_email_draft' AND status = 'ok'),
         count(*) FILTER (WHERE tool = 'add_email_image' AND status = 'ok')
    INTO v_min, v_day, v_creates, v_updates, v_images
    FROM public.mcp_tool_calls
   WHERE grant_id = a.grant_id AND created_at > now() - interval '1 day';
  IF v_min >= 60 OR v_day >= 3000
     OR (p_tool = 'create_email_draft' AND v_creates >= 30)
     OR (p_tool = 'update_email_draft' AND v_updates >= 200)
     OR (p_tool = 'add_email_image' AND v_images >= 60) THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_summary, 'rate_limited', NULL);
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args)
  VALUES (a.grant_id, a.user_id, p_tool, v_space, v_summary)
  RETURNING id INTO v_call;
  UPDATE public.mcp_grants SET last_used_at = now(), calls_count = calls_count + 1 WHERE id = a.grant_id;

  BEGIN
    PERFORM set_config('request.jwt.claims', jsonb_build_object(
      'sub', a.user_id, 'role', 'authenticated', 'aud', 'authenticated', 'yuno_mcp_grant', a.grant_id)::text, true);
    PERFORM set_config('request.jwt.claim.sub', a.user_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.session_id', '', true);
    v_res := CASE WHEN p_tool = 'add_email_image'
      THEN public._mcp_email_image_add(s.kind, s.space_id, s.product, v_args, a.user_id, a.grant_id)
      ELSE public._mcp_email_write(p_tool, s.kind, s.space_id, s.product, v_args, a.user_id, a.grant_id, a.client_name) END;
  EXCEPTION WHEN others THEN
    UPDATE public.mcp_tool_calls SET status = 'error', error = left(SQLSTATE || ' ' || SQLERRM, 300) WHERE id = v_call;
    RETURN jsonb_build_object('ok', false, 'error',
      CASE WHEN SQLERRM LIKE '%crm_plan_ab_resend%' THEN 'ab_not_in_plan'
           WHEN SQLERRM LIKE '%crm_send_frozen%' OR SQLERRM LIKE '%sending_frozen%' THEN 'sending_frozen'
           WHEN SQLSTATE IN ('22P02', '22007', '22008', '22023') THEN 'invalid_args'
           ELSE 'internal' END,
      'call_id', v_call);
  END;

  IF NOT coalesce((v_res->>'ok')::boolean, false) THEN
    UPDATE public.mcp_tool_calls SET status = 'error', error = left(coalesce(v_res->>'error', 'error'), 300) WHERE id = v_call;
  END IF;
  RETURN jsonb_build_object('ok', coalesce((v_res->>'ok')::boolean, false), 'call_id', v_call,
    'space', jsonb_build_object('key', s.space_key, 'name', s.name, 'kind', s.kind, 'product', s.product),
    'result', v_res);
END;
$function$;

-- ── Droits ──────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._mcp_draft_version(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mcp_email_image_add(text, text, text, jsonb, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mcp_image_slot_open(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mcp_image_slot_open(text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mcp_image_slot(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_image_slot(text) TO service_role;
REVOKE ALL ON FUNCTION public.mcp_image_finish(text, text, text, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_image_finish(text, text, text, text, integer, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public._mcp_email_tool(text, text, text, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._mcp_email_write(text, text, text, text, jsonb, uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mcp_call(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_call(text, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.mcp_write(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_write(text, text, jsonb) TO service_role;
