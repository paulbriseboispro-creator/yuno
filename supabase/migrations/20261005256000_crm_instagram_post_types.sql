-- Instagram : une réponse automatique vaut pour TOUS les formats de publication
-- (décision de Paul, 05/10 : « pas seulement les réels, aussi les carrousels »).
-- `post_types` = réel, carrousel, photo ; les trois par défaut, jamais vide.

ALTER TABLE public.crm_instagram_rules ADD COLUMN IF NOT EXISTS post_types text[] NOT NULL DEFAULT '{carousel,photo,reel}';
ALTER TABLE public.crm_instagram_rules DROP CONSTRAINT IF EXISTS crm_instagram_rules_post_types_check;
ALTER TABLE public.crm_instagram_rules ADD CONSTRAINT crm_instagram_rules_post_types_check
  CHECK (cardinality(post_types) >= 1 AND post_types <@ ARRAY['reel', 'carousel', 'photo']::text[]);

CREATE OR REPLACE FUNCTION public.crm_instagram_rule_save(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_patch jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := p_id;
  v_kw text;
  k text;
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN RAISE EXCEPTION 'one scope' USING ERRCODE = '22023'; END IF;
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'bad_patch' USING ERRCODE = '22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k NOT IN ('name', 'trigger', 'post_ref', 'keyword', 'also_dm', 'also_story', 'dm_text', 'button_label', 'public_reply', 'reply_variants', 'destination', 'signup_page_id', 'event_id', 'enabled', 'post_types') THEN
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
    post_types = CASE WHEN p_patch ? 'post_types' AND jsonb_typeof(p_patch->'post_types') = 'array'
                 THEN COALESCE(NULLIF((SELECT array_agg(DISTINCT x ORDER BY x) FROM jsonb_array_elements_text(p_patch->'post_types') x WHERE x IN ('reel', 'carousel', 'photo')), '{}'), post_types) ELSE post_types END,
    enabled = CASE WHEN p_patch ? 'enabled' THEN COALESCE((p_patch->>'enabled')::boolean, false) ELSE enabled END,
    updated_at = now()
   WHERE id = v_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_instagram_rule_save(text, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_instagram_rule_save(text, uuid, uuid, jsonb) TO authenticated, service_role;
