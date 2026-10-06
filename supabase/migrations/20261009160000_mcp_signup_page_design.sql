-- ════════════════════════════════════════════════════════════════════════════
-- MCP Yuno : l'IA du pro dessine ses PAGES D'INSCRIPTION (2026-10-06, plan :
-- docs/designs/MCP_SIGNUP_PAGE_DESIGN_PLAN.md). Suite des brouillons d'e-mails
-- (20261009150000 → 153000), même mécanique.
--
--   • Une page porte, à côté des dix gabarits, un DESIGN SUR MESURE
--     (crm_signup_pages.custom_design : thème + sections HTML/CSS + blocs Yuno,
--     le formulaire Yuno toujours dedans). NULL = gabarit, comme avant.
--   • Nouvelle permission de connexion : mcp_grants.can_pages (false par
--     défaut ; /connect-ai l'annonce et passe p_pages = true). Les connexions
--     existantes ne la reçoivent pas.
--   • Lectures (mcp_call) : get_signup_page_kit, get_signup_page.
--     Écritures (mcp_write) : create_signup_page (toujours un BROUILLON),
--     update_signup_page (brouillon modifié ; page publiée = PROPOSITION
--     ai_proposal, que le pro applique ou ignore : crm_signup_page_ai_proposal).
--     Les réglages passent par crm_signup_page_save, la fonction de la Console.
--     Rien ne publie : la mise en ligne reste un geste du titulaire.
--   • Itérer sans écraser : version = updated_at (µs), ai_updated_at posé par
--     chaque écriture de l'IA, et crm_signup_page_save refuse « ai_changed »
--     quand l'écran enregistre par-dessus une version de l'IA qu'il n'a pas vue.
--   • get_crm_signup_page (page publique) rend le design sur mesure et la
--     marque ; la page le rend dans un Shadow DOM, après DOMPurify.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Colonnes ────────────────────────────────────────────────────────────────

ALTER TABLE public.mcp_grants ADD COLUMN IF NOT EXISTS can_pages boolean NOT NULL DEFAULT false;

ALTER TABLE public.crm_signup_pages
  ADD COLUMN IF NOT EXISTS custom_design jsonb,
  ADD COLUMN IF NOT EXISTS ai_author     text,
  ADD COLUMN IF NOT EXISTS mcp_grant_id  uuid,
  ADD COLUMN IF NOT EXISTS ai_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_proposal   jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_signup_pages_mcp_grant_fk') THEN
    ALTER TABLE public.crm_signup_pages ADD CONSTRAINT crm_signup_pages_mcp_grant_fk
      FOREIGN KEY (mcp_grant_id) REFERENCES public.mcp_grants(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_signup_pages_custom_design_chk') THEN
    ALTER TABLE public.crm_signup_pages ADD CONSTRAINT crm_signup_pages_custom_design_chk
      CHECK (custom_design IS NULL OR (jsonb_typeof(custom_design) = 'object' AND length(custom_design::text) <= 200000));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_signup_pages_ai_proposal_chk') THEN
    ALTER TABLE public.crm_signup_pages ADD CONSTRAINT crm_signup_pages_ai_proposal_chk
      CHECK (ai_proposal IS NULL OR (jsonb_typeof(ai_proposal) = 'object' AND length(ai_proposal::text) <= 260000));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS crm_signup_pages_mcp_grant_idx ON public.crm_signup_pages (mcp_grant_id) WHERE mcp_grant_id IS NOT NULL;

-- ── Consentement : la connexion reçoit le droit aux pages ───────────────────
-- Un paramètre de plus = DROP + CREATE : une surcharge rendrait ambigu l'appel
-- à arguments nommés des bundles en cache (erreur 300). Les anciens bundles
-- (p_drafts seul) gardent p_pages = false.
DROP FUNCTION IF EXISTS public.mcp_approve_authorization(uuid, text[], text, boolean);

CREATE OR REPLACE FUNCTION public.mcp_approve_authorization(p_request_id uuid, p_spaces text[], p_level text, p_drafts boolean DEFAULT false, p_pages boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  r       public.mcp_authorization_requests%ROWTYPE;
  c       public.mcp_clients%ROWTYPE;
  v_grant uuid;
  v_code  text;
  v_bad   text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  -- Une IA ne se connecte jamais pendant un accès assisté : c'est au pro de
  -- décider qui lit ses chiffres, pas au support qui travaille dans son compte.
  IF public.is_support_session() THEN RETURN jsonb_build_object('ok', false, 'error', 'support_session'); END IF;
  IF p_level NOT IN ('analytics', 'customers') THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_level'); END IF;
  IF p_spaces IS NULL OR cardinality(p_spaces) NOT BETWEEN 1 AND 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_space');
  END IF;

  SELECT * INTO r FROM public.mcp_authorization_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'pending' OR r.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  SELECT x INTO v_bad FROM unnest(p_spaces) x
   WHERE NOT EXISTS (SELECT 1 FROM public._mcp_user_spaces(v_uid) s
                      WHERE s.space_key = x AND (p_level = 'analytics' OR s.customers))
   LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', CASE WHEN p_level = 'customers' THEN 'customers_not_allowed' ELSE 'forbidden_space' END, 'space', v_bad);
  END IF;

  SELECT * INTO c FROM public.mcp_clients WHERE id = r.client_id;

  -- Une nouvelle connexion de la MÊME IA remplace la précédente : jamais deux
  -- accès parallèles oubliés.
  UPDATE public.mcp_grants SET revoked_at = now(), revoked_by = v_uid, revoked_reason = 'replaced'
   WHERE user_id = v_uid AND client_id = r.client_id AND revoked_at IS NULL;
  UPDATE public.mcp_tokens t SET revoked_at = now()
    FROM public.mcp_grants g
   WHERE t.grant_id = g.id AND g.user_id = v_uid AND g.client_id = r.client_id
     AND g.revoked_reason = 'replaced' AND t.revoked_at IS NULL;

  -- Brouillons d'e-mails et pages d'inscription : accordés seulement quand
  -- l'écran de consentement les a annoncés (il passe p_drafts = true et
  -- p_pages = true). Le droit d'écrire dans CHAQUE espace reste celui de la
  -- Console, revérifié à chaque écriture (mcp_write).
  INSERT INTO public.mcp_grants (user_id, client_id, client_name, spaces, level, can_draft, can_pages)
  VALUES (v_uid, r.client_id, c.client_name, (SELECT array_agg(DISTINCT x) FROM unnest(p_spaces) x), p_level,
          coalesce(p_drafts, false), coalesce(p_pages, false))
  RETURNING id INTO v_grant;

  v_code := 'yuno_mcp_ac_' || public._mcp_random(32);
  INSERT INTO public.mcp_codes (code_hash, grant_id, client_id, redirect_uri, code_challenge, resource)
  VALUES (public._mcp_sha256(v_code), v_grant, r.client_id, r.redirect_uri, r.code_challenge, r.resource);

  UPDATE public.mcp_authorization_requests
     SET status = 'approved', user_id = v_uid, grant_id = v_grant, decided_at = now()
   WHERE id = r.id;

  RETURN jsonb_build_object('ok', true, 'grant_id', v_grant, 'redirect_uri', r.redirect_uri,
    'params', jsonb_strip_nulls(jsonb_build_object('code', v_code, 'state', r.state, 'iss', 'https://yunoapp.eu')));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mcp_session(p_access_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public._mcp_access(p_access_hash);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  RETURN jsonb_build_object(
    'ok', true, 'grant_id', a.grant_id, 'level', a.level, 'client_name', a.client_name,
    'drafts', coalesce((SELECT g.can_draft FROM public.mcp_grants g WHERE g.id = a.grant_id), false),
    'pages', coalesce((SELECT g.can_pages FROM public.mcp_grants g WHERE g.id = a.grant_id), false),
    'first_name', (SELECT nullif(btrim(first_name), '') FROM public.profiles WHERE id = a.user_id),
    'language', (SELECT preferred_language FROM public.profiles WHERE id = a.user_id),
    'spaces', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'key', s.space_key, 'kind', s.kind, 'name', s.name, 'product', s.product,
        'timezone', s.timezone, 'role', s.role, 'money', s.money,
        'customers', s.customers AND a.level = 'customers',
        'crm', coalesce(public.crm_scope_has_crm(public.crm_scope_key(
                 CASE WHEN s.kind = 'venue' THEN s.space_id END, CASE WHEN s.kind = 'organizer' THEN s.space_id::uuid END)), false)) ORDER BY array_position(a.spaces, s.space_key))
      FROM (SELECT DISTINCT ON (space_key) * FROM public._mcp_user_spaces(a.user_id) ORDER BY space_key, role) s
      WHERE s.space_key = ANY (a.spaces)), '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mcp_my_connections()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_owned text[];
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  SELECT coalesce(array_agg(space_key), '{}') INTO v_owned
    FROM public._mcp_user_spaces(v_uid) WHERE role IN ('owner', 'founder');
  RETURN jsonb_build_object('ok', true, 'connections', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', g.id, 'client_name', g.client_name, 'level', g.level, 'can_draft', g.can_draft, 'can_pages', g.can_pages,
      'created_at', g.created_at, 'last_used_at', g.last_used_at, 'calls_count', g.calls_count,
      'revoked_at', g.revoked_at, 'revoked_reason', g.revoked_reason,
      'mine', g.user_id = v_uid,
      'drafts_created', (SELECT count(*) FROM public.email_campaigns ec WHERE ec.mcp_grant_id = g.id),
      'pages_created', (SELECT count(*) FROM public.crm_signup_pages sp WHERE sp.mcp_grant_id = g.id),
      'person', CASE WHEN g.user_id = v_uid THEN NULL ELSE
                  (SELECT coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.email)
                     FROM public.profiles p WHERE p.id = g.user_id) END,
      'spaces', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', x,
                    'name', coalesce((SELECT v.name FROM public.venues v WHERE 'venue:' || v.id = x),
                                     (SELECT op.display_name FROM public.organizer_profiles op WHERE 'org:' || op.user_id = x), x))), '[]'::jsonb)
                   FROM unnest(g.spaces) x)
    ) ORDER BY g.revoked_at IS NOT NULL, coalesce(g.last_used_at, g.created_at) DESC)
    FROM public.mcp_grants g
    WHERE (g.user_id = v_uid OR g.spaces && v_owned)
      AND (g.revoked_at IS NULL OR g.revoked_at > now() - interval '30 days')), '[]'::jsonb));
END;
$function$;

-- ── Une page vue par l'IA (get_signup_page, résultat des écritures) ─────────
CREATE OR REPLACE FUNCTION public._mcp_signup_page_view(p public.crm_signup_pages)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'page_id', p.id, 'slug', p.slug, 'status', p.status, 'state', public._crm_signup_state(p),
    'kind', p.kind, 'lang', p.lang,
    'title', p.title, 'tagline', p.tagline, 'button_label', p.button_label, 'thanks_message', p.thanks_message,
    'poster_url', p.poster_url,
    'event', CASE WHEN p.event_id IS NOT NULL THEN (
        SELECT jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at,
                 'sales', CASE WHEN e.external_source IS NOT NULL THEN 'external' ELSE 'yuno' END)
          FROM public.events e WHERE e.id = p.event_id) END,
    'fields', p.fields, 'reward', p.reward, 'show_count', p.show_count, 'countdown', p.countdown,
    'opens_at', p.opens_at, 'sale_opens_at', p.sale_opens_at, 'closes_mode', p.closes_mode, 'closes_at', p.closes_at,
    'closes_effective', public._crm_signup_close_at(p),
    'design_mode', CASE WHEN p.custom_design IS NOT NULL THEN 'custom' ELSE 'template' END,
    'template', p.design - 'migrated',
    'custom_design', p.custom_design,
    'proposal', p.ai_proposal,
    'prepared_by', p.ai_author,
    'version', public._mcp_draft_version(p.updated_at),
    'edited_at', p.updated_at, 'ai_edited_at', p.ai_updated_at, 'published_at', p.published_at,
    'signups', (SELECT count(*) FROM public.crm_signup_entries x WHERE x.page_id = p.id),
    'visits', (SELECT count(*) FROM public.crm_signup_visits x WHERE x.page_id = p.id)))
$function$;

-- Une erreur de crm_signup_page_save (la fonction de la Console) → un code que l'IA sait corriger.
CREATE OR REPLACE FUNCTION public._mcp_signup_save_error(p_state text, p_msg text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT jsonb_build_object('ok', false, 'error', CASE
      WHEN p_msg = 'forbidden' THEN 'write_forbidden'
      WHEN p_msg = 'bad_event' THEN 'event_not_found'
      WHEN p_msg = 'bad_fields' THEN 'invalid_fields'
      WHEN p_msg IN ('bad_dates') OR p_state IN ('22007', '22008') THEN 'invalid_dates'
      WHEN p_msg = 'not_found' THEN 'page_not_found'
      WHEN p_msg IN ('bad_kind', 'bad_patch', 'unknown_key', 'one scope') OR p_state IN ('22P02', '22023') THEN 'invalid_args'
      ELSE 'internal' END,
    'detail', left(p_msg, 120))
$function$;

-- Les soirées où une page peut se brancher : celles de l'espace (comme
-- crm_signup_page_save), soirées miroir d'une billetterie connectée comprises.
CREATE OR REPLACE FUNCTION public._mcp_signup_events(p_venue_id text, p_organizer_user_id uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(e.id), '{}') FROM public.events e
   WHERE e.cancelled_at IS NULL
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
$function$;

-- ── Lecture : le kit de design et une page (appelés par mcp_call) ──────────
-- Tournent DANS mcp_call : claims de la personne posés, auth.uid() = elle.
CREATE OR REPLACE FUNCTION public._mcp_signup_tool(p_tool text, p_kind text, p_space_id text, p_product text, p_tz text, p_args jsonb, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue text := CASE WHEN p_kind = 'venue' THEN p_space_id END;
  v_org   uuid := CASE WHEN p_kind = 'organizer' THEN p_space_id::uuid END;
  v_ids   uuid[];
  v_event uuid;
  v_lang  text;
  p       public.crm_signup_pages%ROWTYPE;
BEGIN
  IF NOT coalesce(public.crm_scope_allowed(v_venue, v_org), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF NOT ('crm' = ANY (public._mcp_email_products(v_venue, v_org, p_product))) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'crm_not_active');
  END IF;
  SELECT CASE WHEN preferred_language IN ('fr', 'en', 'es') THEN preferred_language ELSE 'fr' END INTO v_lang FROM public.profiles WHERE id = p_uid;

  IF p_tool = 'get_signup_page_kit' THEN
    v_ids := public._mcp_signup_events(v_venue, v_org);
    IF nullif(btrim(coalesce(p_args->>'event', '')), '') IS NOT NULL THEN
      v_event := public._mcp_resolve_event(p_args->>'event', v_ids);
      IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'can_create', public._mcp_space_can_draft(p_uid, v_venue, v_org, 'crm'),
      'can_publish', public._crm_signup_owner(v_venue, v_org),
      'language_hint', coalesce(v_lang, 'fr'),
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
      'recent_email_themes', coalesce((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('campaign', x.name,
                   'background', x.theme_json->>'bg', 'card', x.theme_json->>'card', 'text', x.theme_json->>'text',
                   'accent', x.theme_json->>'accent', 'dark', x.theme_json->'dark')))
            FROM (SELECT ec.name, ec.theme_json FROM public.email_campaigns ec
                   WHERE ec.venue_id IS NOT DISTINCT FROM v_venue AND ec.organizer_user_id IS NOT DISTINCT FROM v_org
                     AND ec.blocks_version >= 2 AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
                     AND jsonb_typeof(ec.theme_json) = 'object'
                   ORDER BY ec.updated_at DESC LIMIT 3) x), '[]'::jsonb),
      'upcoming_events', coalesce((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', x.id, 'title', x.title, 'start_at', x.start_at,
                   'sales', CASE WHEN x.external_source IS NOT NULL THEN 'external' ELSE 'yuno' END,
                   'has_poster', coalesce(x.poster_url, x.image_url) IS NOT NULL OR EXISTS (
                      SELECT 1 FROM public.external_events xe WHERE xe.event_id = x.id AND xe.cover_url IS NOT NULL),
                   'sold_out', coalesce(x.tickets_sold_out, false))) ORDER BY x.start_at)
            FROM (SELECT e.* FROM public.events e
                   WHERE e.id = ANY (v_ids) AND coalesce(e.end_at, e.start_at + interval '8 hours') >= now()
                   ORDER BY e.start_at LIMIT 12) x), '[]'::jsonb),
      'event', CASE WHEN v_event IS NOT NULL THEN public._crm_signup_event(v_event) END,
      'pages', coalesce((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'page_id', x.id, 'title', nullif(x.title, ''), 'kind', x.kind, 'state', public._crm_signup_state(x),
                   'design', CASE WHEN x.custom_design IS NOT NULL THEN 'custom' ELSE x.design->>'tpl' END,
                   'prepared_by', x.ai_author, 'proposal_pending', CASE WHEN x.ai_proposal IS NOT NULL THEN true END,
                   'public_url', CASE WHEN x.status <> 'draft' THEN 'https://crm.yunoapp.eu/j/' || x.slug END,
                   'event', (SELECT e.title FROM public.events e WHERE e.id = x.event_id),
                   'signups', (SELECT count(*) FROM public.crm_signup_entries y WHERE y.page_id = x.id),
                   'edited', to_char(x.updated_at AT TIME ZONE coalesce(p_tz, 'Europe/Paris'), 'YYYY-MM-DD HH24:MI'))) ORDER BY x.updated_at DESC)
            FROM (SELECT * FROM public.crm_signup_pages sp
                   WHERE sp.venue_id IS NOT DISTINCT FROM v_venue AND sp.organizer_user_id IS NOT DISTINCT FROM v_org
                   ORDER BY sp.updated_at DESC LIMIT 20) x), '[]'::jsonb));
  ELSIF p_tool = 'get_signup_page' THEN
    IF coalesce(p_args->>'page_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'page_not_found');
    END IF;
    SELECT * INTO p FROM public.crm_signup_pages sp
     WHERE sp.id = (p_args->>'page_id')::uuid
       AND sp.venue_id IS NOT DISTINCT FROM v_venue AND sp.organizer_user_id IS NOT DISTINCT FROM v_org;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'page_not_found'); END IF;
    RETURN jsonb_build_object('ok', true,
        'can_publish', public._crm_signup_owner(v_venue, v_org),
        'event_facts', CASE WHEN p.event_id IS NOT NULL THEN public._crm_signup_event(p.event_id) END)
      || public._mcp_signup_page_view(p);
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
END;
$function$;

-- ── Écriture : créer une page (brouillon), la modifier, ou PROPOSER ─────────
-- Appelée par mcp_write (claims de la personne posés). Le contenu (sections,
-- thème) est déjà nettoyé et contrôlé par le Worker ; la base revérifie la
-- forme. Les réglages passent par crm_signup_page_save, la fonction de la
-- Console elle-même : mêmes droits, mêmes contrôles. Une page déjà publiée ne
-- change jamais ici : l'IA y dépose une proposition (ai_proposal) que le pro
-- applique ou ignore depuis la fiche de la page.
CREATE OR REPLACE FUNCTION public._mcp_signup_write(p_tool text, p_kind text, p_space_id text, p_space_product text, p_args jsonb, p_uid uuid, p_grant uuid, p_client text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue   text := CASE WHEN p_kind = 'venue' THEN p_space_id END;
  v_org     uuid := CASE WHEN p_kind = 'organizer' THEN p_space_id::uuid END;
  p         public.crm_signup_pages%ROWTYPE;
  v_patch   jsonb := '{}'::jsonb;
  v_key     text;
  v_event   uuid;
  v_id      uuid;
  v_has_c   boolean := p_args ? 'custom_design';
  v_custom  jsonb := p_args->'custom_design';
  v_author  text := left(coalesce(nullif(btrim(p_client), ''), 'AI'), 60);
  v_prop    jsonb;
  v_changes jsonb := CASE WHEN jsonb_typeof(p_args->'changes') = 'array' THEN p_args->'changes' ELSE '[]'::jsonb END;
  v_mode    text;
BEGIN
  IF NOT ('crm' = ANY (public._mcp_email_products(v_venue, v_org, p_space_product))) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'crm_not_active');
  END IF;
  IF NOT public._mcp_space_can_draft(p_uid, v_venue, v_org, 'crm') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'write_forbidden');
  END IF;

  -- Les réglages, dans la forme de la Console (crm_signup_page_save).
  FOREACH v_key IN ARRAY ARRAY['kind', 'title', 'tagline', 'button_label', 'thanks_message', 'poster_url', 'design', 'fields',
                                'show_count', 'reward', 'opens_at', 'sale_opens_at', 'closes_mode', 'closes_at', 'countdown', 'lang'] LOOP
    IF p_args ? v_key THEN v_patch := v_patch || jsonb_build_object(v_key, p_args->v_key); END IF;
  END LOOP;
  IF p_args ? 'event' THEN
    IF nullif(btrim(coalesce(p_args->>'event', '')), '') IS NULL OR lower(p_args->>'event') IN ('none', 'null') THEN
      v_patch := v_patch || jsonb_build_object('event_id', NULL);
    ELSE
      v_event := public._mcp_resolve_event(p_args->>'event', public._mcp_signup_events(v_venue, v_org));
      IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
      v_patch := v_patch || jsonb_build_object('event_id', v_event);
    END IF;
  END IF;

  -- Le design sur mesure : un objet v1 (thème + sections), ou null (retour au gabarit).
  IF v_has_c THEN
    IF jsonb_typeof(v_custom) NOT IN ('object', 'null') OR length(v_custom::text) > 200000 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_content');
    END IF;
    IF jsonb_typeof(v_custom) = 'object' AND (
         coalesce(v_custom->>'v', '') <> '1'
         OR jsonb_typeof(v_custom->'theme') IS DISTINCT FROM 'object'
         OR jsonb_typeof(v_custom->'sections') IS DISTINCT FROM 'array'
         OR jsonb_array_length(v_custom->'sections') NOT BETWEEN 1 AND 24
         OR (SELECT count(*) FROM jsonb_array_elements(v_custom->'sections') s WHERE s->>'type' = 'yuno' AND s->>'block' = 'form') <> 1
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_custom->'sections') s
                     WHERE jsonb_typeof(s) <> 'object' OR coalesce(s->>'type', '') NOT IN ('html', 'yuno') OR coalesce(s->>'id', '') = '')
         -- Défense en profondeur : le Worker a déjà nettoyé, la page publique repasse par DOMPurify.
         OR v_custom::text ~* '<\s*/?\s*(script|iframe|object|embed|form|input|textarea|base|meta|link)\M'
         OR v_custom::text ~* '<[^>]*\son[a-z]+\s*='
         OR v_custom::text ~* 'javascript\s*:') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_content');
    END IF;
  END IF;

  IF p_tool = 'create_signup_page' THEN
    IF NOT (v_patch ? 'kind') THEN v_patch := v_patch || '{"kind": "prevente"}'::jsonb; END IF;
    BEGIN
      v_id := public.crm_signup_page_save(v_venue, v_org, NULL, v_patch);
    EXCEPTION WHEN others THEN
      RETURN public._mcp_signup_save_error(SQLSTATE, SQLERRM);
    END;
    UPDATE public.crm_signup_pages SET
      custom_design = CASE WHEN v_has_c AND jsonb_typeof(v_custom) = 'object' THEN v_custom END,
      ai_author = v_author, mcp_grant_id = p_grant, ai_updated_at = now()
     WHERE id = v_id
    RETURNING * INTO p;
    v_mode := 'created';

  ELSIF p_tool = 'update_signup_page' THEN
    IF coalesce(p_args->>'page_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'page_not_found');
    END IF;
    SELECT * INTO p FROM public.crm_signup_pages sp
     WHERE sp.id = (p_args->>'page_id')::uuid
       AND sp.venue_id IS NOT DISTINCT FROM v_venue AND sp.organizer_user_id IS NOT DISTINCT FROM v_org
     FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'page_not_found'); END IF;
    -- L'IA modifie la version qu'elle a lue : si le pro a retouché la page
    -- entre-temps, rien n'est écrit.
    IF nullif(p_args->>'expected_version', '') IS NOT NULL
       AND p_args->>'expected_version' <> public._mcp_draft_version(p.updated_at) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'page_changed', 'version', public._mcp_draft_version(p.updated_at));
    END IF;
    IF v_patch = '{}'::jsonb AND NOT v_has_c THEN
      RETURN jsonb_build_object('ok', false, 'error', 'nothing_to_change');
    END IF;

    IF p.status = 'draft' THEN
      IF v_patch <> '{}'::jsonb THEN
        BEGIN
          PERFORM public.crm_signup_page_save(v_venue, v_org, p.id, v_patch);
        EXCEPTION WHEN others THEN
          RETURN public._mcp_signup_save_error(SQLSTATE, SQLERRM);
        END;
      END IF;
      UPDATE public.crm_signup_pages SET
        custom_design = CASE WHEN v_has_c THEN CASE WHEN jsonb_typeof(v_custom) = 'object' THEN v_custom END ELSE custom_design END,
        ai_author = coalesce(ai_author, v_author),
        mcp_grant_id = coalesce(mcp_grant_id, p_grant),
        ai_proposal = NULL,
        ai_updated_at = now(),
        updated_at = now()
       WHERE id = p.id
      RETURNING * INTO p;
      v_mode := 'updated';
    ELSE
      -- Page publiée : la proposition est contrôlée par la fonction de la
      -- Console (puis l'essai est annulé), et rien ne change pour les fans.
      IF v_patch <> '{}'::jsonb THEN
        BEGIN
          PERFORM public.crm_signup_page_save(v_venue, v_org, p.id, v_patch);
          RAISE EXCEPTION 'mcp_dry_run_ok';
        EXCEPTION WHEN others THEN
          IF SQLERRM <> 'mcp_dry_run_ok' THEN RETURN public._mcp_signup_save_error(SQLSTATE, SQLERRM); END IF;
        END;
      END IF;
      v_prop := coalesce(p.ai_proposal, '{}'::jsonb);
      v_prop := jsonb_build_object(
          'patch', coalesce(v_prop->'patch', '{}'::jsonb) || v_patch,
          'author', v_author, 'grant_id', p_grant, 'at', now(),
          'base_version', public._mcp_draft_version(p.updated_at),
          'changes', (SELECT coalesce(jsonb_agg(c ORDER BY n), '[]'::jsonb)
                        FROM (SELECT c, n FROM jsonb_array_elements(coalesce(v_prop->'changes', '[]'::jsonb) || v_changes) WITH ORDINALITY AS z(c, n)
                               ORDER BY n DESC LIMIT 20) y))
        || CASE WHEN v_has_c THEN jsonb_build_object('custom_design', v_custom)
                WHEN v_prop ? 'custom_design' THEN jsonb_build_object('custom_design', v_prop->'custom_design')
                ELSE '{}'::jsonb END;
      UPDATE public.crm_signup_pages SET
        ai_proposal = v_prop,
        ai_author = coalesce(ai_author, v_author),
        mcp_grant_id = coalesce(mcp_grant_id, p_grant)
       WHERE id = p.id
      RETURNING * INTO p;
      v_mode := 'proposed';
    END IF;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
  END IF;

  RETURN jsonb_build_object('ok', true, 'mode', v_mode, 'can_publish', public._crm_signup_owner(v_venue, v_org))
    || (public._mcp_signup_page_view(p) - 'custom_design' - 'proposal')
    || jsonb_build_object('sections', CASE
         WHEN v_mode = 'proposed' AND p.ai_proposal ? 'custom_design' THEN coalesce(jsonb_array_length(p.ai_proposal->'custom_design'->'sections'), 0)
         WHEN p.custom_design IS NOT NULL THEN jsonb_array_length(p.custom_design->'sections') END,
       'proposal_changes', CASE WHEN v_mode = 'proposed' THEN p.ai_proposal->'changes' END);
END;
$function$;

-- ── Console : appliquer ou ignorer la proposition de l'IA ──────────────────
-- Mêmes droits que modifier la page dans la Console (crm_scope_writable) :
-- l'application passe par crm_signup_page_save elle-même.
CREATE OR REPLACE FUNCTION public.crm_signup_page_ai_proposal(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_action text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p public.crm_signup_pages%ROWTYPE;
  v_patch jsonb;
BEGIN
  IF p_action NOT IN ('apply', 'discard') THEN RAISE EXCEPTION 'bad_action' USING ERRCODE = '22023'; END IF;
  IF NOT coalesce(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.crm_signup_pages
   WHERE id = p_id AND venue_id IS NOT DISTINCT FROM p_venue_id AND organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF p.ai_proposal IS NULL THEN RETURN 'none'; END IF;
  IF p_action = 'discard' THEN
    UPDATE public.crm_signup_pages SET ai_proposal = NULL WHERE id = p.id;
    RETURN 'discarded';
  END IF;
  v_patch := coalesce(p.ai_proposal->'patch', '{}'::jsonb);
  IF v_patch <> '{}'::jsonb THEN
    PERFORM public.crm_signup_page_save(p_venue_id, p_organizer_user_id, p.id, v_patch);
  END IF;
  UPDATE public.crm_signup_pages SET
    custom_design = CASE WHEN p.ai_proposal ? 'custom_design'
                         THEN CASE WHEN jsonb_typeof(p.ai_proposal->'custom_design') = 'object' THEN p.ai_proposal->'custom_design' END
                         ELSE custom_design END,
    ai_proposal = NULL,
    ai_updated_at = now(),
    updated_at = now()
   WHERE id = p.id;
  RETURN 'applied';
END;
$function$;

-- ── Lectures et écritures du MCP : les pages rejoignent les deux portes ─────

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
    ELSIF p_tool IN ('get_signup_page_kit', 'get_signup_page') THEN
      v_res := public._mcp_signup_tool(p_tool, s.kind, s.space_id, s.product, s.timezone, v_args, a.user_id);
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
  v_pages    boolean;
  v_page_creates integer;
  v_page_updates integer;
  v_is_page  boolean := p_tool IN ('create_signup_page', 'update_signup_page');
  v_has_space boolean;
  v_summary  jsonb;
BEGIN
  SELECT * INTO a FROM public._mcp_access(p_access_hash);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  IF p_tool NOT IN ('create_email_draft', 'update_email_draft', 'add_email_image', 'create_signup_page', 'update_signup_page') THEN
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
    'language', v_args->>'language', 'image', CASE WHEN p_tool = 'add_email_image' THEN left(coalesce(v_args->>'name', v_args->>'source'), 80) END,
    'page_id', v_args->>'page_id', 'kind', v_args->>'kind', 'title', left(v_args->>'title', 120),
    'design', CASE WHEN v_args ? 'custom_design' THEN coalesce(jsonb_typeof(v_args->'custom_design'), 'null') END,
    'page_sections', CASE WHEN jsonb_typeof(v_args->'custom_design'->'sections') = 'array' THEN jsonb_array_length(v_args->'custom_design'->'sections') END,
    'page_bytes', CASE WHEN v_args ? 'custom_design' THEN length((v_args->'custom_design')::text) END));

  -- Chaque famille d'écriture a SA permission, accordée par un écran de
  -- consentement qui l'annonce : brouillons d'e-mails (can_draft), pages
  -- d'inscription (can_pages). Une image sert aux deux.
  SELECT g.can_draft, g.can_pages INTO v_can, v_pages FROM public.mcp_grants g WHERE g.id = a.grant_id;
  IF v_is_page AND NOT coalesce(v_pages, false) THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_summary, 'denied', 'pages_not_allowed');
    RETURN jsonb_build_object('ok', false, 'error', 'pages_not_allowed');
  END IF;
  IF NOT v_is_page AND NOT (coalesce(v_can, false) OR (p_tool = 'add_email_image' AND coalesce(v_pages, false))) THEN
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
  -- brouillons créés et 200 modifications par jour et par connexion ; 20
  -- pages d'inscription créées et 200 modifications.
  SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute'),
         count(*),
         count(*) FILTER (WHERE tool = 'create_email_draft' AND status = 'ok'),
         count(*) FILTER (WHERE tool = 'update_email_draft' AND status = 'ok'),
         count(*) FILTER (WHERE tool = 'add_email_image' AND status = 'ok'),
         count(*) FILTER (WHERE tool = 'create_signup_page' AND status = 'ok'),
         count(*) FILTER (WHERE tool = 'update_signup_page' AND status = 'ok')
    INTO v_min, v_day, v_creates, v_updates, v_images, v_page_creates, v_page_updates
    FROM public.mcp_tool_calls
   WHERE grant_id = a.grant_id AND created_at > now() - interval '1 day';
  IF v_min >= 60 OR v_day >= 3000
     OR (p_tool = 'create_email_draft' AND v_creates >= 30)
     OR (p_tool = 'update_email_draft' AND v_updates >= 200)
     OR (p_tool = 'add_email_image' AND v_images >= 60)
     OR (p_tool = 'create_signup_page' AND v_page_creates >= 20)
     OR (p_tool = 'update_signup_page' AND v_page_updates >= 200) THEN
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
    v_res := CASE
      WHEN p_tool = 'add_email_image'
        THEN public._mcp_email_image_add(s.kind, s.space_id, s.product, v_args, a.user_id, a.grant_id)
      WHEN v_is_page
        THEN public._mcp_signup_write(p_tool, s.kind, s.space_id, s.product, v_args, a.user_id, a.grant_id, a.client_name)
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

-- ── Console : la sauvegarde de l'assistant (retour au gabarit, garde de l'IA) ──

CREATE OR REPLACE FUNCTION public.crm_signup_page_save(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_patch jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := p_id;
  v_base text;
  v_slug text;
  k text;
  v_q jsonb;
  v_o text;
  v_f jsonb;
  v_extra jsonb := '{}'::jsonb;
  v_rel jsonb := '{}'::jsonb;
  v_step jsonb;
  v_kind text;
  v_ai timestamptz;
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN RAISE EXCEPTION 'one scope' USING ERRCODE = '22023'; END IF;
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'bad_patch' USING ERRCODE = '22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k NOT IN ('kind', 'event_id', 'title', 'tagline', 'button_label', 'thanks_message', 'poster_url', 'design', 'fields', 'show_count',
                 'reward', 'opens_at', 'sale_opens_at', 'closes_mode', 'closes_at', 'countdown', 'relance', 'lang',
                 'occasion', 'theme', 'custom_design', '_seen_ai_at') THEN
      RAISE EXCEPTION 'unknown_key' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Le design sur mesure ne s'écrit que par le MCP (nettoyé par le Worker) ;
  -- la Console ne peut que l'enlever (retour à un gabarit).
  IF p_patch ? 'custom_design' AND jsonb_typeof(p_patch->'custom_design') <> 'null' THEN RAISE EXCEPTION 'bad_custom' USING ERRCODE = '22023'; END IF;
  -- L'écran qui enregistre a-t-il vu la dernière version de l'IA ? Sinon il
  -- l'écraserait avec un état d'avant : refusé, l'écran adopte et réessaie.
  IF p_patch ? '_seen_ai_at' AND v_id IS NOT NULL THEN
    SELECT ai_updated_at INTO v_ai FROM public.crm_signup_pages WHERE id = v_id;
    IF v_ai IS NOT NULL AND (nullif(p_patch->>'_seen_ai_at', '') IS NULL OR v_ai > (p_patch->>'_seen_ai_at')::timestamptz) THEN
      RAISE EXCEPTION 'ai_changed' USING ERRCODE = '40001';
    END IF;
  END IF;

  IF p_patch ? 'kind' AND p_patch->>'kind' NOT IN ('prevente', 'venue', 'attente', 'communaute') THEN RAISE EXCEPTION 'bad_kind' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'closes_mode' AND p_patch->>'closes_mode' NOT IN ('sale', 'eve', 'manual', 'never', 'date') THEN RAISE EXCEPTION 'bad_dates' USING ERRCODE = '22023'; END IF;

  -- Champs : contact, champs en plus (obligatoires ou non), deux questions au plus (2 à 6 réponses).
  IF p_patch ? 'fields' THEN
    v_f := p_patch->'fields';
    IF jsonb_typeof(v_f) <> 'object' OR COALESCE(v_f->>'contact', 'both') NOT IN ('both', 'email', 'phone', 'all') THEN RAISE EXCEPTION 'bad_fields' USING ERRCODE = '22023'; END IF;
    IF jsonb_typeof(COALESCE(v_f->'extra', '{}'::jsonb)) <> 'object' THEN RAISE EXCEPTION 'bad_fields' USING ERRCODE = '22023'; END IF;
    FOR k IN SELECT jsonb_object_keys(COALESCE(v_f->'extra', '{}'::jsonb)) LOOP
      IF k NOT IN ('nom', 'naissance', 'insta', 'ville') THEN RAISE EXCEPTION 'bad_fields' USING ERRCODE = '22023'; END IF;
      IF COALESCE((v_f->'extra'->k->>'on')::boolean, false) THEN
        v_extra := v_extra || jsonb_build_object(k, jsonb_build_object('on', true, 'req', COALESCE((v_f->'extra'->k->>'req')::boolean, false)));
      END IF;
    END LOOP;
    IF jsonb_typeof(COALESCE(v_f->'questions', '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(v_f->'questions', '[]'::jsonb)) > 2 THEN RAISE EXCEPTION 'bad_fields' USING ERRCODE = '22023'; END IF;
    FOR v_q IN SELECT * FROM jsonb_array_elements(COALESCE(v_f->'questions', '[]'::jsonb)) LOOP
      IF length(trim(COALESCE(v_q->>'label', ''))) = 0 OR length(v_q->>'label') > 60 OR jsonb_typeof(v_q->'options') <> 'array'
         OR jsonb_array_length(v_q->'options') < 2 OR jsonb_array_length(v_q->'options') > 6 THEN
        RAISE EXCEPTION 'bad_fields' USING ERRCODE = '22023';
      END IF;
      FOR v_o IN SELECT jsonb_array_elements_text(v_q->'options') LOOP
        IF length(trim(v_o)) = 0 OR length(v_o) > 40 THEN RAISE EXCEPTION 'bad_fields' USING ERRCODE = '22023'; END IF;
      END LOOP;
    END LOOP;
  END IF;

  IF p_patch ? 'event_id' AND NULLIF(p_patch->>'event_id', '') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.events e WHERE e.id = (p_patch->>'event_id')::uuid
          AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))) THEN
    RAISE EXCEPTION 'bad_event' USING ERRCODE = '22023';
  END IF;

  -- Relance : trois étapes au plus, le contenu de l'e-mail composé par la Console.
  IF p_patch ? 'relance' THEN
    IF jsonb_typeof(p_patch->'relance') <> 'object' THEN RAISE EXCEPTION 'bad_relance' USING ERRCODE = '22023'; END IF;
    FOR k IN SELECT jsonb_object_keys(p_patch->'relance') LOOP
      IF k NOT IN ('open', 'nudge', 'last') THEN RAISE EXCEPTION 'bad_relance' USING ERRCODE = '22023'; END IF;
      v_step := p_patch->'relance'->k;
      IF jsonb_typeof(v_step) <> 'object' THEN RAISE EXCEPTION 'bad_relance' USING ERRCODE = '22023'; END IF;
      IF length(COALESCE(v_step->>'msg', '')) > 480 OR length(COALESCE(v_step->>'subject', '')) > 150
         OR (v_step ? 'email_blocks' AND (jsonb_typeof(v_step->'email_blocks') <> 'array' OR length((v_step->'email_blocks')::text) > 40000))
         OR (v_step ? 'delay' AND COALESCE(v_step->>'delay', '') NOT IN ('', '24h', '48h', '3d', '2d', '1d', '0d'))
         OR (NULLIF(v_step->>'cta_url', '') IS NOT NULL AND v_step->>'cta_url' !~ '^https?://' ) THEN
        RAISE EXCEPTION 'bad_relance' USING ERRCODE = '22023';
      END IF;
      v_rel := v_rel || jsonb_build_object(k, jsonb_build_object(
        'on', COALESCE((v_step->>'on')::boolean, false), 'email', COALESCE((v_step->>'email')::boolean, false),
        'sms', COALESCE((v_step->>'sms')::boolean, false), 'delay', COALESCE(v_step->>'delay', ''),
        'msg', COALESCE(v_step->>'msg', ''), 'subject', left(COALESCE(v_step->>'subject', ''), 150),
        'preheader', left(COALESCE(v_step->>'preheader', ''), 200),
        'email_blocks', COALESCE(v_step->'email_blocks', '[]'::jsonb), 'email_theme', COALESCE(v_step->'email_theme', '{}'::jsonb),
        'email_logo', NULLIF(left(COALESCE(v_step->>'email_logo', ''), 600), ''), 'cta_url', NULLIF(left(COALESCE(v_step->>'cta_url', ''), 600), '')));
    END LOOP;
  END IF;

  IF v_id IS NULL THEN
    v_base := COALESCE(NULLIF(trim(both '-' from regexp_replace(lower(translate(COALESCE(p_patch->>'title', ''),
                'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñ', 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')), '[^a-z0-9]+', '-', 'g')), ''), 'page');
    v_base := left(v_base, 40);
    IF length(v_base) < 3 THEN v_base := v_base || '-page'; END IF;
    v_slug := v_base;
    WHILE EXISTS (SELECT 1 FROM public.crm_signup_pages WHERE slug = v_slug) LOOP
      v_slug := v_base || '-' || substr(md5(random()::text), 1, 4);
    END LOOP;
    INSERT INTO public.crm_signup_pages (venue_id, organizer_user_id, slug, created_by, design)
    VALUES (p_venue_id, p_organizer_user_id, v_slug, auth.uid(), '{"tpl":"soiree","pal":"red","bg":"","acc":"","font":"","migrated":true}'::jsonb)
    RETURNING id INTO v_id;
  ELSIF NOT EXISTS (SELECT 1 FROM public.crm_signup_pages WHERE id = v_id AND venue_id IS NOT DISTINCT FROM p_venue_id AND organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.crm_signup_pages SET
    kind = CASE WHEN p_patch ? 'kind' THEN p_patch->>'kind'
                WHEN p_patch ? 'occasion' AND p_patch->>'occasion' = 'community' THEN 'communaute' ELSE kind END,
    event_id = CASE WHEN p_patch ? 'event_id' THEN NULLIF(p_patch->>'event_id', '')::uuid ELSE event_id END,
    title = CASE WHEN p_patch ? 'title' THEN left(trim(p_patch->>'title'), 40) ELSE title END,
    tagline = CASE WHEN p_patch ? 'tagline' THEN left(trim(p_patch->>'tagline'), 140) ELSE tagline END,
    button_label = CASE WHEN p_patch ? 'button_label' THEN left(trim(p_patch->>'button_label'), 30) ELSE button_label END,
    thanks_message = CASE WHEN p_patch ? 'thanks_message' THEN left(trim(p_patch->>'thanks_message'), 200) ELSE thanks_message END,
    poster_url = CASE WHEN p_patch ? 'poster_url' THEN CASE WHEN COALESCE(p_patch->>'poster_url', '') ~ '^https://' THEN left(p_patch->>'poster_url', 600) END ELSE poster_url END,
    design = CASE WHEN p_patch ? 'design' AND jsonb_typeof(p_patch->'design') = 'object' THEN jsonb_build_object(
              'tpl', CASE WHEN p_patch->'design'->>'tpl' IN ('soiree', 'affiche', 'brutal', 'edito', 'ticket', 'affichage', 'verre', 'epure', 'flyer', 'terminal') THEN p_patch->'design'->>'tpl' ELSE 'soiree' END,
              'pal', CASE WHEN COALESCE(p_patch->'design'->>'pal', '') ~ '^(custom|red|lime|ice|rose|bone|p[0-4])$' THEN p_patch->'design'->>'pal' ELSE 'red' END,
              'bg', CASE WHEN COALESCE(p_patch->'design'->>'bg', '') ~ '^#[0-9A-Fa-f]{6}$' THEN p_patch->'design'->>'bg' ELSE '' END,
              'acc', CASE WHEN COALESCE(p_patch->'design'->>'acc', '') ~ '^#[0-9A-Fa-f]{6}$' THEN p_patch->'design'->>'acc' ELSE '' END,
              'font', CASE WHEN p_patch->'design'->>'font' IN ('brico', 'anton', 'serif', 'space', 'black', 'mono') THEN p_patch->'design'->>'font' ELSE '' END,
              'migrated', true) ELSE design END,
    fields = CASE WHEN p_patch ? 'fields' THEN jsonb_build_object(
              'contact', COALESCE(p_patch->'fields'->>'contact', 'both'),
              'extra', v_extra,
              'questions', COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'label', left(trim(q->>'label'), 60),
                   'multi', COALESCE((q->>'multi')::boolean, false),
                   'party', CASE WHEN COALESCE((q->>'party')::boolean, false) THEN true END,
                   'options', (SELECT jsonb_agg(left(trim(o), 40)) FROM jsonb_array_elements_text(q->'options') o))))
                 FROM jsonb_array_elements(COALESCE(p_patch->'fields'->'questions', '[]'::jsonb)) q), '[]'::jsonb)) ELSE fields END,
    show_count = CASE WHEN p_patch ? 'show_count' THEN COALESCE((p_patch->>'show_count')::boolean, false) ELSE show_count END,
    reward = CASE WHEN p_patch ? 'reward' THEN CASE WHEN jsonb_typeof(p_patch->'reward') = 'object' THEN jsonb_build_object(
                'on', COALESCE((p_patch->'reward'->>'on')::boolean, false),
                'preset', CASE WHEN p_patch->'reward'->>'preset' IN ('prio', 'drink', 'pre', 'custom') THEN p_patch->'reward'->>'preset' ELSE 'drink' END,
                'label', left(trim(COALESCE(p_patch->'reward'->>'label', '')), 40),
                'how', left(trim(COALESCE(p_patch->'reward'->>'how', '')), 70),
                'icon', CASE WHEN p_patch->'reward'->>'icon' IN ('gift', 'ticket', 'bolt', 'users', 'clock') THEN p_patch->'reward'->>'icon' ELSE 'gift' END) END ELSE reward END,
    opens_at = CASE WHEN p_patch ? 'opens_at' THEN NULLIF(p_patch->>'opens_at', '')::timestamptz ELSE opens_at END,
    sale_opens_at = CASE WHEN p_patch ? 'sale_opens_at' THEN NULLIF(p_patch->>'sale_opens_at', '')::timestamptz ELSE sale_opens_at END,
    closes_mode = CASE WHEN p_patch ? 'closes_mode' THEN p_patch->>'closes_mode' ELSE closes_mode END,
    closes_at = CASE WHEN p_patch ? 'closes_at' THEN NULLIF(p_patch->>'closes_at', '')::timestamptz ELSE closes_at END,
    countdown = CASE WHEN p_patch ? 'countdown' THEN COALESCE((p_patch->>'countdown')::boolean, true) ELSE countdown END,
    relance = CASE WHEN p_patch ? 'relance' THEN v_rel ELSE relance END,
    lang = CASE WHEN p_patch->>'lang' IN ('en', 'fr', 'es') THEN p_patch->>'lang' ELSE lang END,
    custom_design = CASE WHEN p_patch ? 'custom_design' THEN NULL ELSE custom_design END,
    updated_at = now()
   WHERE id = v_id
   RETURNING kind INTO v_kind;
  UPDATE public.crm_signup_pages SET occasion = CASE WHEN v_kind = 'communaute' THEN 'community' ELSE 'night' END WHERE id = v_id;
  RETURN v_id;
END;
$function$;

-- ── Page publique ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_crm_signup_page(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p public.crm_signup_pages;
  v_state text;
BEGIN
  SELECT * INTO p FROM public.crm_signup_pages WHERE slug = lower(p_slug) AND status IN ('live', 'closed');
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_state := public._crm_signup_state(p);
  RETURN jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'kind', p.kind, 'occasion', p.occasion, 'theme', p.theme, 'title', p.title, 'tagline', p.tagline, 'button_label', p.button_label,
    'thanks_message', p.thanks_message, 'poster_url', p.poster_url, 'design', p.design, 'custom_design', p.custom_design, 'fields', p.fields, 'reward', p.reward,
    'opens_at', p.opens_at, 'sale_opens_at', p.sale_opens_at, 'countdown', p.countdown, 'close_at', public._crm_signup_close_at(p),
    'state', CASE v_state WHEN 'scheduled' THEN 'soon' WHEN 'closed' THEN 'closed' ELSE 'open' END,
    'count', CASE WHEN p.show_count THEN (SELECT count(*) FROM public.crm_signup_entries e WHERE e.page_id = p.id) END,
    'demo', public._crm_signup_is_demo(p),
    'host', COALESCE((SELECT v.name FROM public.venues v WHERE v.id = p.venue_id),
                     (SELECT COALESCE(NULLIF(o.display_name, ''), 'Yuno') FROM public.organizer_profiles o WHERE o.user_id = p.organizer_user_id)),
    'event', public._crm_signup_event(p.event_id),
    -- La marque lue par les balises d'un design sur mesure ({{host.logo}}…) : publique déjà sur Yuno.
    'brand', CASE WHEN p.venue_id IS NOT NULL THEN (
        SELECT jsonb_strip_nulls(jsonb_build_object('logo', v.logo_url, 'city', v.city, 'instagram', v.instagram_url))
          FROM public.venues v WHERE v.id = p.venue_id)
      ELSE (
        SELECT jsonb_strip_nulls(jsonb_build_object('logo', o.avatar_url, 'city', o.city, 'instagram', o.instagram_url))
          FROM public.organizer_profiles o WHERE o.user_id = p.organizer_user_id) END);
END;
$function$;

-- ── Droits ──────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.mcp_approve_authorization(uuid, text[], text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_approve_authorization(uuid, text[], text, boolean, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.mcp_session(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_session(text) TO service_role;
REVOKE ALL ON FUNCTION public.mcp_my_connections() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_my_connections() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._mcp_signup_page_view(public.crm_signup_pages) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._mcp_signup_save_error(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._mcp_signup_events(text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._mcp_signup_tool(text, text, text, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._mcp_signup_write(text, text, text, text, jsonb, uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mcp_call(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_call(text, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.mcp_write(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_write(text, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.crm_signup_page_save(text, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_signup_page_save(text, uuid, uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_signup_page_ai_proposal(text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_signup_page_ai_proposal(text, uuid, uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_crm_signup_page(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_crm_signup_page(text) TO anon, authenticated, service_role;
