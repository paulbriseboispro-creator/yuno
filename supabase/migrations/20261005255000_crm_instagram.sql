-- Yuno CRM : Instagram — réponse automatique aux commentaires (design
-- « Instagram ») : un fan écrit un mot-clé sous un post (ou en message privé, ou
-- en réponse à une story) et reçoit le lien en message privé.
--
-- L'intégration réelle dépend de l'App Review Meta (non accordée) : AUCUN appel
-- à l'API Meta n'est fait ici. Ce qui existe :
--   • crm_instagram_rules : les réponses automatiques, préparées en brouillon ;
--     les ALLUMER est refusé par le serveur tant que l'ouverture n'est pas
--     décidée (`crm_instagram_not_open`, miroir du drapeau front
--     CRM_INSTAGRAM_LIVE) ;
--   • crm_instagram_events : le journal que le moteur écrira (commentaire reçu,
--     message parti, clic, inscription, achat), pseudo Instagram SEULEMENT.
--     Vide aujourd'hui : l'écran lit ce journal et ne montre jamais un chiffre
--     inventé ;
--   • crm_instagram_overview : la connexion (meta_connections : compte
--     Instagram relié à la Page), les règles, l'entonnoir, les derniers fans.
-- RLS sans policy : tout passe par les RPC.

CREATE TABLE IF NOT EXISTS public.crm_instagram_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id         text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name             text NOT NULL DEFAULT '' CHECK (char_length(name) <= 60),
  trigger          text NOT NULL DEFAULT 'next_post' CHECK (trigger IN ('next_post', 'post')),
  post_ref         text,
  keyword          text NOT NULL CHECK (keyword ~ '^[a-z0-9]{3,30}$'),
  also_dm          boolean NOT NULL DEFAULT true,
  also_story       boolean NOT NULL DEFAULT true,
  dm_text          text NOT NULL DEFAULT '' CHECK (char_length(dm_text) <= 600),
  button_label     text NOT NULL DEFAULT '' CHECK (char_length(button_label) <= 20),
  public_reply     boolean NOT NULL DEFAULT true,
  reply_variants   text[] NOT NULL DEFAULT '{}',
  destination      text NOT NULL DEFAULT 'signup_page' CHECK (destination IN ('signup_page', 'guest_list', 'tickets')),
  signup_page_id   uuid REFERENCES public.crm_signup_pages(id) ON DELETE SET NULL,
  event_id         uuid REFERENCES public.events(id) ON DELETE SET NULL,
  enabled          boolean NOT NULL DEFAULT false,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((venue_id IS NULL) <> (organizer_user_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_instagram_rules_kw_uidx ON public.crm_instagram_rules (COALESCE(venue_id, organizer_user_id::text), keyword);
ALTER TABLE public.crm_instagram_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_instagram_rules FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.crm_instagram_events (
  id            bigserial PRIMARY KEY,
  rule_id       uuid NOT NULL REFERENCES public.crm_instagram_rules(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('comment', 'dm_sent', 'click', 'signup', 'purchase')),
  ig_username   text,
  channel       text CHECK (channel IN ('comment', 'dm', 'story')),
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_instagram_events_rule_idx ON public.crm_instagram_events (rule_id, at DESC);
ALTER TABLE public.crm_instagram_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_instagram_events FROM anon, authenticated;

-- Miroir serveur du drapeau front CRM_INSTAGRAM_LIVE (src/crm/lib/instagram.ts).
-- Ouvrir = remplacer ce corps par `SELECT true` le jour où l'App Review est
-- accordée ET le moteur branché.
CREATE OR REPLACE FUNCTION public.crm_instagram_open()
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$ SELECT false; $$;

CREATE OR REPLACE FUNCTION public.crm_instagram_overview(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := CASE WHEN p_days IN (30, 90) THEN p_days ELSE 30 END;
  v_since timestamptz := now() - v_days * interval '1 day';
  v_conn public.meta_connections%ROWTYPE;
  v_rate numeric := COALESCE((public.crm_pricing_config()->'rates'->>'instagram')::numeric, 10);
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN RAISE EXCEPTION 'one scope' USING ERRCODE = '22023'; END IF;
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_conn FROM public.meta_connections mc
   WHERE mc.venue_id IS NOT DISTINCT FROM p_venue_id AND mc.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id LIMIT 1;
  RETURN jsonb_build_object(
    'at', now(), 'days', v_days, 'open', public.crm_instagram_open(), 'rate', v_rate,
    'account', CASE WHEN v_conn.id IS NOT NULL AND v_conn.ig_user_id IS NOT NULL THEN jsonb_build_object(
        'status', v_conn.status,
        'username', (SELECT x->>'username' FROM jsonb_array_elements(COALESCE(v_conn.assets->'instagram', '[]'::jsonb)) x WHERE x->>'id' = v_conn.ig_user_id LIMIT 1)) END,
    'rules', COALESCE((SELECT jsonb_agg(to_jsonb(r) || jsonb_build_object(
        'comments', (SELECT count(*) FROM public.crm_instagram_events e WHERE e.rule_id = r.id AND e.kind = 'comment' AND e.at >= v_since),
        'dms', (SELECT count(*) FROM public.crm_instagram_events e WHERE e.rule_id = r.id AND e.kind = 'dm_sent' AND e.at >= v_since),
        'clicks', (SELECT count(*) FROM public.crm_instagram_events e WHERE e.rule_id = r.id AND e.kind = 'click' AND e.at >= v_since),
        'signups', (SELECT count(*) FROM public.crm_instagram_events e WHERE e.rule_id = r.id AND e.kind = 'signup' AND e.at >= v_since),
        'buyers', (SELECT count(*) FROM public.crm_instagram_events e WHERE e.rule_id = r.id AND e.kind = 'purchase' AND e.at >= v_since),
        'page_title', (SELECT p.title FROM public.crm_signup_pages p WHERE p.id = r.signup_page_id),
        'event_title', (SELECT ev.title FROM public.events ev WHERE ev.id = r.event_id)) ORDER BY r.created_at DESC)
      FROM public.crm_instagram_rules r
     WHERE r.venue_id IS NOT DISTINCT FROM p_venue_id AND r.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id), '[]'::jsonb),
    'funnel', (SELECT jsonb_build_object(
        'comments', count(*) FILTER (WHERE e.kind = 'comment'), 'dms', count(*) FILTER (WHERE e.kind = 'dm_sent'),
        'clicks', count(*) FILTER (WHERE e.kind = 'click'), 'signups', count(*) FILTER (WHERE e.kind = 'signup'),
        'buyers', count(*) FILTER (WHERE e.kind = 'purchase'))
      FROM public.crm_instagram_events e JOIN public.crm_instagram_rules r ON r.id = e.rule_id
     WHERE e.at >= v_since AND r.venue_id IS NOT DISTINCT FROM p_venue_id AND r.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id),
    'recent', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', x.at, 'kind', x.kind, 'username', x.ig_username, 'channel', x.channel, 'keyword', x.keyword) ORDER BY x.at DESC) FROM (
        SELECT e.at, e.kind, e.ig_username, e.channel, r.keyword FROM public.crm_instagram_events e JOIN public.crm_instagram_rules r ON r.id = e.rule_id
         WHERE r.venue_id IS NOT DISTINCT FROM p_venue_id AND r.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
         ORDER BY e.at DESC LIMIT 20) x), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_instagram_overview(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_instagram_overview(text, uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_instagram_rule_save(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_patch jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := p_id;
  v_kw text;
  k text;
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN RAISE EXCEPTION 'one scope' USING ERRCODE = '22023'; END IF;
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'bad_patch' USING ERRCODE = '22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k NOT IN ('name', 'trigger', 'post_ref', 'keyword', 'also_dm', 'also_story', 'dm_text', 'button_label', 'public_reply', 'reply_variants', 'destination', 'signup_page_id', 'event_id', 'enabled') THEN
      RAISE EXCEPTION 'unknown_key' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  -- Allumer est refusé tant que l'ouverture n'est pas décidée.
  IF COALESCE((p_patch->>'enabled')::boolean, false) AND NOT public.crm_instagram_open() THEN
    RAISE EXCEPTION 'crm_instagram_not_open' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'keyword' THEN
    v_kw := regexp_replace(lower(translate(COALESCE(p_patch->>'keyword', ''),
      'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñ', 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')), '[^a-z0-9]', '', 'g');
    IF length(v_kw) < 3 OR length(v_kw) > 30 THEN RAISE EXCEPTION 'bad_keyword' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.crm_instagram_rules r WHERE r.keyword = v_kw AND r.id IS DISTINCT FROM v_id
                AND r.venue_id IS NOT DISTINCT FROM p_venue_id AND r.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id) THEN
      RAISE EXCEPTION 'keyword_taken' USING ERRCODE = '23505';
    END IF;
  END IF;
  IF p_patch ? 'signup_page_id' AND NULLIF(p_patch->>'signup_page_id', '') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.crm_signup_pages p WHERE p.id = (p_patch->>'signup_page_id')::uuid
          AND p.venue_id IS NOT DISTINCT FROM p_venue_id AND p.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id) THEN
    RAISE EXCEPTION 'bad_page' USING ERRCODE = '22023';
  END IF;
  IF v_id IS NULL THEN
    IF v_kw IS NULL THEN RAISE EXCEPTION 'bad_keyword' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.crm_instagram_rules (venue_id, organizer_user_id, keyword, created_by) VALUES (p_venue_id, p_organizer_user_id, v_kw, auth.uid()) RETURNING id INTO v_id;
  ELSIF NOT EXISTS (SELECT 1 FROM public.crm_instagram_rules WHERE id = v_id AND venue_id IS NOT DISTINCT FROM p_venue_id AND organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.crm_instagram_rules SET
    name = CASE WHEN p_patch ? 'name' THEN left(trim(p_patch->>'name'), 60) ELSE name END,
    trigger = CASE WHEN p_patch->>'trigger' IN ('next_post', 'post') THEN p_patch->>'trigger' ELSE trigger END,
    post_ref = CASE WHEN p_patch ? 'post_ref' THEN NULLIF(left(p_patch->>'post_ref', 120), '') ELSE post_ref END,
    keyword = COALESCE(v_kw, keyword),
    also_dm = CASE WHEN p_patch ? 'also_dm' THEN COALESCE((p_patch->>'also_dm')::boolean, true) ELSE also_dm END,
    also_story = CASE WHEN p_patch ? 'also_story' THEN COALESCE((p_patch->>'also_story')::boolean, true) ELSE also_story END,
    dm_text = CASE WHEN p_patch ? 'dm_text' THEN left(p_patch->>'dm_text', 600) ELSE dm_text END,
    button_label = CASE WHEN p_patch ? 'button_label' THEN left(trim(p_patch->>'button_label'), 20) ELSE button_label END,
    public_reply = CASE WHEN p_patch ? 'public_reply' THEN COALESCE((p_patch->>'public_reply')::boolean, true) ELSE public_reply END,
    reply_variants = CASE WHEN p_patch ? 'reply_variants' AND jsonb_typeof(p_patch->'reply_variants') = 'array'
                     THEN COALESCE((SELECT array_agg(left(trim(x), 120)) FROM (SELECT x FROM jsonb_array_elements_text(p_patch->'reply_variants') x WHERE length(trim(x)) > 0 LIMIT 5) y), '{}') ELSE reply_variants END,
    destination = CASE WHEN p_patch->>'destination' IN ('signup_page', 'guest_list', 'tickets') THEN p_patch->>'destination' ELSE destination END,
    signup_page_id = CASE WHEN p_patch ? 'signup_page_id' THEN NULLIF(p_patch->>'signup_page_id', '')::uuid ELSE signup_page_id END,
    event_id = CASE WHEN p_patch ? 'event_id' THEN NULLIF(p_patch->>'event_id', '')::uuid ELSE event_id END,
    enabled = CASE WHEN p_patch ? 'enabled' THEN COALESCE((p_patch->>'enabled')::boolean, false) ELSE enabled END,
    updated_at = now()
   WHERE id = v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_instagram_rule_save(text, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_instagram_rule_save(text, uuid, uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_instagram_rule_delete(p_venue_id text, p_organizer_user_id uuid, p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.crm_instagram_rules WHERE id = p_id AND venue_id IS NOT DISTINCT FROM p_venue_id AND organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_instagram_rule_delete(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_instagram_rule_delete(text, uuid, uuid) TO authenticated, service_role;
