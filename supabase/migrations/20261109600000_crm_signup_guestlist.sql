-- Pages d'inscription du CRM : le type « Guest list » (décision de Paul, 22/10).
--
-- Le fan laisse son prénom et son e-mail, coche l'accord pour les e-mails, et la
-- page l'envoie aussitôt vers le lien choisi par le pro (le lien privé de la
-- guest list Shotgun). Pas de lien de confirmation : l'inscription vaut accord
-- tout de suite, avec la même preuve qu'une confirmation (texte exact de la
-- case, page, heure) dans marketing_consent_events et la même entrée au
-- registre CRM. Le lien n'est rendu qu'à l'inscription, jamais par la lecture
-- publique de la page.
--
--  - crm_signup_pages.after_url (https) et le type 'guestlist' ;
--  - _crm_signup_grant(entrée) : ce que faisait crm_signup_confirm après le clic
--    (preuve, groupe de la page, registre), partagé par la confirmation et par
--    l'inscription instantanée ;
--  - submit_crm_signup rend 'go:<lien>' sur une page Guest list ;
--  - get_crm_signup_page dit seulement `redirects` ;
--  - crm_signup_page_set_status refuse de publier une page Guest list sans lien ;
--  - le rappel de la veille marche comme pour « Confirmation de venue ».

ALTER TABLE public.crm_signup_pages ADD COLUMN IF NOT EXISTS after_url text;
ALTER TABLE public.crm_signup_pages DROP CONSTRAINT IF EXISTS crm_signup_pages_after_url_chk;
ALTER TABLE public.crm_signup_pages ADD CONSTRAINT crm_signup_pages_after_url_chk
  CHECK (after_url IS NULL OR (after_url ~ '^https://' AND char_length(after_url) <= 600));
ALTER TABLE public.crm_signup_pages DROP CONSTRAINT IF EXISTS crm_signup_pages_kind_chk;
ALTER TABLE public.crm_signup_pages ADD CONSTRAINT crm_signup_pages_kind_chk
  CHECK (kind IN ('prevente', 'venue', 'attente', 'communaute', 'guestlist'));

CREATE OR REPLACE FUNCTION public._crm_signup_grant(p_entry_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  e public.crm_signup_entries;
  p public.crm_signup_pages;
  v_blocked boolean;
  v_sub boolean := false;
BEGIN
  SELECT * INTO e FROM public.crm_signup_entries WHERE id = p_entry_id;
  IF NOT FOUND OR e.email IS NULL THEN RETURN false; END IF;
  SELECT * INTO p FROM public.crm_signup_pages WHERE id = e.page_id;
  INSERT INTO public.marketing_consent_events (email, channel, venue_id, organizer_user_id, action, wording_key, wording_text, locale, source)
  VALUES (e.email, 'email', p.venue_id, p.organizer_user_id, 'granted', 'crm_signup_page', e.consent_text, e.lang, 'signup_page:' || p.id);
  IF e.phone IS NOT NULL THEN
    INSERT INTO public.marketing_consent_events (email, phone_e164, channel, venue_id, organizer_user_id, action, wording_key, wording_text, locale, source)
    VALUES (e.email, e.phone, 'sms', p.venue_id, p.organizer_user_id, 'granted', 'crm_signup_page', e.consent_text, e.lang, 'signup_page:' || p.id);
  END IF;

  IF p.contact_import_id IS NOT NULL THEN
    INSERT INTO public.imported_contacts (list_import_id, venue_id, organizer_user_id, product, email, phone_e164, first_name, last_name, city, newsletter_opt_in, added_at, extra)
    VALUES (p.contact_import_id, p.venue_id, p.organizer_user_id, 'crm', e.email,
            CASE WHEN e.phone ~ '^\+[0-9]{8,15}$' THEN e.phone END, e.first_name, e.last_name, e.city, true, now(),
            jsonb_build_object('signup_page', p.id, 'src', e.src, 'answers', e.answers, 'instagram', e.instagram, 'birthdate', e.birthdate))
    ON CONFLICT DO NOTHING;
  END IF;

  v_blocked := public.is_email_suppressed(e.email)
    OR EXISTS (SELECT 1 FROM public.email_opt_outs o WHERE lower(o.email) = lower(e.email)
                AND o.venue_id IS NOT DISTINCT FROM p.venue_id AND o.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id
                AND o.product = 'crm')
    -- Désabonné : sa ligne CRM, OU un stop explicite (opted_out_at) donné dans la Billetterie du même pro (un stop vaut pour les deux outils).
    OR EXISTS (SELECT 1 FROM public.newsletter_subscriptions n WHERE lower(n.email) = lower(e.email)
                AND ((n.product = 'crm' AND NOT n.opted_in) OR (n.product IS NULL AND n.opted_out_at IS NOT NULL))
                AND n.venue_id IS NOT DISTINCT FROM p.venue_id AND n.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id);
  IF NOT v_blocked THEN
    IF p.venue_id IS NOT NULL THEN
      INSERT INTO public.newsletter_subscriptions (venue_id, email, opted_in, source, import_id, consent_source, consent_recorded_at, first_name, product)
      VALUES (p.venue_id, e.email, true, 'signup_page', p.email_import_id, 'website_form', now(), e.first_name, 'crm')
      ON CONFLICT (lower(email), venue_id, product) WHERE venue_id IS NOT NULL DO NOTHING;
    ELSE
      INSERT INTO public.newsletter_subscriptions (organizer_user_id, email, opted_in, source, import_id, consent_source, consent_recorded_at, first_name, product)
      VALUES (p.organizer_user_id, e.email, true, 'signup_page', p.email_import_id, 'website_form', now(), e.first_name, 'crm')
      ON CONFLICT (lower(email), organizer_user_id, product) WHERE organizer_user_id IS NOT NULL DO NOTHING;
    END IF;
    v_sub := true;
  END IF;
  RETURN v_sub;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_signup_confirm(p_slug text, p_token text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  e public.crm_signup_entries;
  p public.crm_signup_pages;
  v_sub boolean := false;
BEGIN
  IF length(COALESCE(p_token, '')) < 20 THEN RETURN 'invalid'; END IF;
  SELECT x.* INTO e FROM public.crm_signup_entries x JOIN public.crm_signup_pages pp ON pp.id = x.page_id
   WHERE pp.slug = lower(p_slug) AND x.confirm_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') FOR UPDATE OF x;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  IF e.confirmed_at IS NOT NULL THEN RETURN 'already'; END IF;
  SELECT * INTO p FROM public.crm_signup_pages WHERE id = e.page_id;
  IF public._crm_signup_is_demo(p) THEN RETURN 'demo'; END IF;

  v_sub := public._crm_signup_grant(e.id);
  UPDATE public.crm_signup_entries SET confirmed_at = now(), subscribed = v_sub WHERE id = e.id;
  RETURN 'ok';
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_crm_signup(p_slug text, p_first_name text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_answers jsonb DEFAULT '{}'::jsonb, p_consent boolean DEFAULT false, p_consent_text text DEFAULT NULL::text, p_lang text DEFAULT 'fr'::text, p_src text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_birthdate text DEFAULT NULL::text, p_instagram text DEFAULT NULL::text, p_city text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p public.crm_signup_pages;
  v_ctx record;
  v_email text := NULLIF(lower(trim(COALESCE(p_email, ''))), '');
  v_phone text := NULLIF(regexp_replace(COALESCE(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_contact text;
  v_domain text;
  v_answers jsonb := CASE WHEN jsonb_typeof(p_answers) = 'object' AND length(p_answers::text) <= 2000 THEN p_answers ELSE '{}'::jsonb END;
  v_party smallint;
  v_birth date;
  v_party_q text;
  v_id uuid;
  x text;
  v_lang text := CASE WHEN p_lang IN ('fr', 'en', 'es') THEN p_lang ELSE 'fr' END;
BEGIN
  SELECT * INTO p FROM public.crm_signup_pages WHERE slug = lower(p_slug);
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  IF NOT public._crm_signup_open(p) THEN RETURN 'closed'; END IF;
  IF public._crm_signup_is_demo(p) THEN RETURN 'demo'; END IF;
  IF NOT COALESCE(p_consent, false) OR length(trim(COALESCE(p_consent_text, ''))) < 10 THEN RETURN 'consent_required'; END IF;
  IF length(trim(COALESCE(p_first_name, ''))) = 0 THEN RETURN 'invalid'; END IF;

  -- Le contact demandé par la page.
  v_contact := COALESCE(p.fields->>'contact', 'both');
  IF v_contact = 'email' THEN v_phone := NULL; END IF;
  IF v_contact = 'phone' THEN v_email := NULL; END IF;
  IF v_contact IN ('email', 'all') AND v_email IS NULL THEN RETURN 'invalid_email'; END IF;
  IF v_contact IN ('phone', 'all') AND v_phone IS NULL THEN RETURN 'invalid_phone'; END IF;
  IF v_email IS NULL AND v_phone IS NULL THEN RETURN 'invalid'; END IF;
  IF v_email IS NOT NULL THEN
    IF v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' OR length(v_email) > 200 THEN RETURN 'invalid_email'; END IF;
    v_domain := split_part(v_email, '@', 2);
    IF EXISTS (SELECT 1 FROM public.crm_disposable_domains WHERE domain = v_domain) THEN RETURN 'disposable'; END IF;
    IF public.is_demo_email(v_email) THEN RETURN 'demo'; END IF;
  END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{7,14}$' THEN RETURN 'invalid_phone'; END IF;

  -- Champs obligatoires de la page.
  FOR x IN SELECT k FROM jsonb_each(COALESCE(p.fields->'extra', '{}'::jsonb)) AS j(k, v) WHERE COALESCE((v->>'req')::boolean, false) LOOP
    IF (x = 'nom' AND length(trim(COALESCE(p_last_name, ''))) = 0) OR (x = 'naissance' AND length(trim(COALESCE(p_birthdate, ''))) = 0)
       OR (x = 'insta' AND length(trim(COALESCE(p_instagram, ''))) = 0) OR (x = 'ville' AND length(trim(COALESCE(p_city, ''))) = 0) THEN
      RETURN 'invalid';
    END IF;
  END LOOP;
  BEGIN
    v_birth := NULLIF(trim(COALESCE(p_birthdate, '')), '')::date;
    IF v_birth IS NOT NULL AND (v_birth < date '1900-01-01' OR v_birth > current_date) THEN v_birth := NULL; END IF;
  EXCEPTION WHEN OTHERS THEN v_birth := NULL;
  END;
  -- « Tu viens à combien ? » : la taille du groupe (« 4+ » → 4).
  SELECT q->>'label' INTO v_party_q FROM jsonb_array_elements(COALESCE(p.fields->'questions', '[]'::jsonb)) q WHERE COALESCE((q->>'party')::boolean, false) LIMIT 1;
  IF v_party_q IS NOT NULL AND v_answers ? v_party_q THEN
    v_party := LEAST(20, GREATEST(1, NULLIF(substring(v_answers->>v_party_q FROM '^\s*(\d{1,2})'), '')::int))::smallint;
  END IF;

  SELECT * INTO v_ctx FROM public.links_visitor_context();
  IF (SELECT count(*) FROM public.crm_signup_entries WHERE visitor_hash = v_ctx.o_hash AND created_at > now() - interval '1 hour') >= 10
     OR (SELECT count(*) FROM public.crm_signup_entries WHERE page_id = p.id AND created_at > now() - interval '1 hour') >= 300 THEN
    RETURN 'rate_limited';
  END IF;

  IF v_email IS NOT NULL AND EXISTS (SELECT 1 FROM public.crm_signup_entries WHERE page_id = p.id AND lower(email) = v_email) THEN
    -- Déjà inscrit sans avoir confirmé : un nouveau lien repart (au plus toutes les 10 minutes).
    UPDATE public.crm_signup_entries SET confirm_sent_at = NULL, confirm_hash = NULL, created_at = GREATEST(created_at, now() - interval '2 days')
     WHERE page_id = p.id AND lower(email) = v_email AND confirmed_at IS NULL
       AND (confirm_sent_at IS NULL OR confirm_sent_at < now() - interval '10 minutes');
    RETURN CASE WHEN p.kind = 'guestlist' AND p.after_url IS NOT NULL THEN 'go:' || p.after_url ELSE 'already' END;
  END IF;
  IF v_email IS NULL AND EXISTS (SELECT 1 FROM public.crm_signup_entries WHERE page_id = p.id AND email IS NULL AND phone = v_phone) THEN
    RETURN CASE WHEN p.kind = 'guestlist' AND p.after_url IS NOT NULL THEN 'go:' || p.after_url ELSE 'already' END;
  END IF;

  INSERT INTO public.crm_signup_entries (page_id, first_name, last_name, email, phone, birthdate, instagram, city, answers, party_size,
                                         src, lang, consent_text, visitor_hash, was_known, confirmed_at, subscribed)
  VALUES (p.id, left(trim(p_first_name), 60), NULLIF(left(trim(COALESCE(p_last_name, '')), 60), ''), v_email, v_phone, v_birth,
          NULLIF(left(regexp_replace(trim(COALESCE(p_instagram, '')), '^@+', ''), 40), ''), NULLIF(left(trim(COALESCE(p_city, '')), 60), ''),
          v_answers, v_party,
          CASE WHEN lower(p_src) ~ '^[a-z0-9_-]{1,30}$' THEN lower(p_src) END, v_lang,
          left(trim(p_consent_text), 600), v_ctx.o_hash, public._crm_signup_known(p, v_email, v_phone),
          -- Sans e-mail, aucun lien de confirmation possible : la case cochée fait foi.
          -- Guest list : l'inscription vaut accord tout de suite, sans lien de confirmation.
          CASE WHEN v_email IS NULL OR p.kind = 'guestlist' THEN now() END, CASE WHEN v_email IS NULL THEN false END)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL AND v_email IS NOT NULL AND p.kind = 'guestlist' THEN
    UPDATE public.crm_signup_entries SET subscribed = public._crm_signup_grant(v_id) WHERE id = v_id;
  END IF;
  IF v_id IS NOT NULL AND v_email IS NULL THEN
    -- Preuve du consentement (téléphone) et place dans le groupe de la page. Le
    -- registre SMS reste fermé côté CRM : le numéro n'y entre pas.
    INSERT INTO public.marketing_consent_events (phone_e164, channel, venue_id, organizer_user_id, action, wording_key, wording_text, locale, source)
    VALUES (v_phone, 'sms', p.venue_id, p.organizer_user_id, 'granted', 'crm_signup_page', left(trim(p_consent_text), 600), v_lang, 'signup_page:' || p.id);
    IF p.contact_import_id IS NOT NULL THEN
      INSERT INTO public.imported_contacts (list_import_id, venue_id, organizer_user_id, product, phone_e164, first_name, last_name, city, newsletter_opt_in, added_at, extra)
      VALUES (p.contact_import_id, p.venue_id, p.organizer_user_id, 'crm', v_phone, left(trim(p_first_name), 60), NULLIF(left(trim(COALESCE(p_last_name, '')), 60), ''),
              NULLIF(left(trim(COALESCE(p_city, '')), 60), ''), false, now(),
              jsonb_build_object('signup_page', p.id, 'src', lower(p_src), 'answers', v_answers))
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN CASE WHEN p.kind = 'guestlist' AND p.after_url IS NOT NULL THEN 'go:' || p.after_url ELSE 'ok' END;
END;
$function$;

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
    -- Guest list : la page envoie le fan vers un lien après l'inscription. Le lien
    -- lui-même n'est rendu qu'à l'inscription (submit_crm_signup).
    'redirects', p.kind = 'guestlist' AND p.after_url IS NOT NULL,
    -- Le nom que le fan lit (case d'accord, pied de page) : celui des Réglages d'envoi.
    'host', COALESCE(public.crm_space_display_name(p.venue_id, p.organizer_user_id), 'Yuno'),
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
                 'occasion', 'theme', 'custom_design', '_seen_ai_at', 'after_url') THEN
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

  IF p_patch ? 'kind' AND p_patch->>'kind' NOT IN ('prevente', 'venue', 'attente', 'communaute', 'guestlist') THEN RAISE EXCEPTION 'bad_kind' USING ERRCODE = '22023'; END IF;
  -- Guest list : le lien vers lequel la page envoie le fan une fois inscrit (https seulement).
  IF p_patch ? 'after_url' AND NULLIF(trim(COALESCE(p_patch->>'after_url', '')), '') IS NOT NULL
     AND (trim(p_patch->>'after_url') !~ '^https://[^\s/]+\.[^\s]+$' OR length(trim(p_patch->>'after_url')) > 600) THEN
    RAISE EXCEPTION 'bad_after_url' USING ERRCODE = '22023';
  END IF;
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
       SELECT 1 FROM public.events e WHERE e.id = (p_patch->>'event_id')::uuid AND e.external_source IS NOT NULL
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
    after_url = CASE WHEN p_patch ? 'after_url' THEN NULLIF(trim(COALESCE(p_patch->>'after_url', '')), '') ELSE after_url END,
    updated_at = now()
   WHERE id = v_id
   RETURNING kind INTO v_kind;
  UPDATE public.crm_signup_pages SET occasion = CASE WHEN v_kind = 'communaute' THEN 'community' ELSE 'night' END WHERE id = v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_signup_relance_collect()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p public.crm_signup_pages;
  v_step text;
  s jsonb;
  v_due timestamptz;
  v_exp timestamptz;
  v_open_due timestamptz;
  v_ev jsonb;
  v_start timestamptz;
  v_camp uuid;
  v_new integer;
  v_total integer := 0;
  v_pages integer := 0;
  v_kind_policy text;
BEGIN
  FOR p IN
    SELECT * FROM public.crm_signup_pages
     WHERE status IN ('live', 'closed') AND relance <> '{}'::jsonb
       AND NOT public.is_demo_marketing_scope(venue_id, organizer_user_id)
  LOOP
    v_ev := public._crm_signup_event(p.event_id);
    v_start := NULLIF(v_ev->>'start_at', '')::timestamptz;
    v_open_due := CASE p.kind
      WHEN 'prevente' THEN p.sale_opens_at
      WHEN 'venue' THEN CASE WHEN p.event_id IS NOT NULL THEN public._crm_signup_night_at(p.event_id, 1, time '18:00') END
      WHEN 'guestlist' THEN CASE WHEN p.event_id IS NOT NULL THEN public._crm_signup_night_at(p.event_id, 1, time '18:00') END
      WHEN 'attente' THEN p.notified_at
      ELSE NULL END;

    FOREACH v_step IN ARRAY ARRAY['open', 'nudge', 'last'] LOOP
      s := p.relance->v_step;
      CONTINUE WHEN s IS NULL OR NOT COALESCE((s->>'on')::boolean, false) OR NOT COALESCE((s->>'email')::boolean, false);
      CONTINUE WHEN jsonb_typeof(s->'email_blocks') <> 'array' OR jsonb_array_length(s->'email_blocks') = 0;
      CONTINUE WHEN v_step <> 'open' AND p.kind NOT IN ('prevente', 'attente');

      IF v_step = 'open' AND p.kind = 'communaute' THEN
        v_due := now() - interval '2 days'; v_exp := now() + interval '1 minute';   -- par inscription, plus bas
      ELSIF v_step = 'open' THEN
        v_due := v_open_due; v_exp := LEAST(v_open_due + interval '2 days', COALESCE(v_start, 'infinity'::timestamptz));
      ELSIF v_step = 'nudge' THEN
        v_due := v_open_due + CASE s->>'delay' WHEN '24h' THEN interval '24 hours' WHEN '3d' THEN interval '3 days' ELSE interval '48 hours' END;
        v_exp := LEAST(v_due + interval '2 days', COALESCE(v_start, 'infinity'::timestamptz));
      ELSE
        CONTINUE WHEN p.event_id IS NULL;
        v_due := public._crm_signup_night_at(p.event_id, CASE s->>'delay' WHEN '1d' THEN 1 WHEN '0d' THEN 0 ELSE 2 END, time '12:00');
        v_exp := COALESCE(v_start, v_due + interval '1 day');
      END IF;
      CONTINUE WHEN v_due IS NULL OR now() < v_due OR now() > v_exp;
      v_kind_policy := CASE WHEN v_step = 'open' AND p.kind <> 'communaute' THEN 'tier_closing' ELSE 'automation' END;

      -- Les destinataires de ce passage (heures calmes : la campagne les respecte,
      -- sauf « C'est ouvert », attendu à l'heure dite).
      CREATE TEMP TABLE IF NOT EXISTS _sr (entry_id uuid, email text, first_name text, last_name text, token uuid) ON COMMIT DROP;
      TRUNCATE _sr;
      INSERT INTO _sr (entry_id, email, first_name, last_name, token)
      SELECT e.id, lower(e.email), e.first_name, e.last_name, ns.unsubscribe_token
        FROM public.crm_signup_entries e
        JOIN LATERAL (
          SELECT n.unsubscribe_token FROM public.newsletter_subscriptions n
           WHERE lower(n.email) = lower(e.email) AND n.opted_in AND n.opted_out_at IS NULL
             AND n.venue_id IS NOT DISTINCT FROM p.venue_id AND n.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id
             AND n.product = 'crm'
           LIMIT 1) ns ON true
       WHERE e.page_id = p.id AND e.email IS NOT NULL AND e.confirmed_at IS NOT NULL AND COALESCE(e.subscribed, false)
         AND NOT public.is_demo_email(e.email)
         AND NOT EXISTS (SELECT 1 FROM public.crm_signup_sends x WHERE x.entry_id = e.id AND x.step = v_step AND x.channel = 'email')
         AND (v_step <> 'open' OR p.kind <> 'communaute' OR e.confirmed_at > now() - interval '2 days')
         AND (v_step = 'open' OR e.id NOT IN (SELECT entry_id FROM public._crm_signup_buyer_ids(p.id)))
         AND public.email_send_policy(lower(e.email), v_kind_policy) IS NULL;
      SELECT count(*) INTO v_new FROM _sr;
      CONTINUE WHEN v_new = 0;

      -- La campagne enfant de (page, étape), créée au premier envoi, remplie ensuite.
      SELECT campaign_id INTO v_camp FROM public.crm_signup_relance_campaigns WHERE page_id = p.id AND step = v_step;
      IF v_camp IS NULL THEN
        INSERT INTO public.email_campaigns
          (venue_id, organizer_user_id, name, type, subject, preheader, blocks_json, blocks_version, theme_json, social_links_json,
           logo_url, event_id, status, audiences_json, exclusions_json, quiet_hours, child_kind, total_recipients, product)
        VALUES
          (p.venue_id, p.organizer_user_id, left('Page d’inscription · ' || p.title || ' · ' || v_step, 200), 'promotional',
           COALESCE(NULLIF(s->>'subject', ''), p.title), COALESCE(s->>'preheader', ''), s->'email_blocks', 2,
           COALESCE(s->'email_theme', '{}'::jsonb), '{}'::jsonb, NULLIF(s->>'email_logo', ''), p.event_id, 'sending',
           '[]'::jsonb, '{}'::jsonb, NOT (v_step = 'open' AND p.kind <> 'communaute'), 'signup', 0, 'crm')
        RETURNING id INTO v_camp;
        -- Elle est sa propre mère : hors des listes, sans accusé « campagne envoyée ».
        UPDATE public.email_campaigns SET parent_campaign_id = v_camp WHERE id = v_camp;
        INSERT INTO public.crm_signup_relance_campaigns (page_id, step, campaign_id) VALUES (p.id, v_step, v_camp);
      ELSE
        -- Le contenu suit la dernière version enregistrée par le pro.
        UPDATE public.email_campaigns SET subject = COALESCE(NULLIF(s->>'subject', ''), subject), preheader = COALESCE(s->>'preheader', preheader),
               blocks_json = s->'email_blocks', theme_json = COALESCE(s->'email_theme', theme_json), logo_url = COALESCE(NULLIF(s->>'email_logo', ''), logo_url)
         WHERE id = v_camp;
      END IF;

      INSERT INTO public.email_campaign_recipients (campaign_id, email, first_name, last_name, unsubscribe_token, status)
      SELECT v_camp, r.email, r.first_name, r.last_name, r.token, 'pending' FROM _sr r
      ON CONFLICT (campaign_id, lower(email)) DO NOTHING;
      INSERT INTO public.crm_signup_sends (page_id, entry_id, step, channel, campaign_id)
      SELECT p.id, r.entry_id, v_step, 'email', v_camp FROM _sr r
      ON CONFLICT (entry_id, step, channel) DO NOTHING;
      UPDATE public.email_campaigns
         SET status = 'sending', paused_reason = NULL, error_message = NULL,
             total_recipients = COALESCE(total_recipients, 0) + v_new
       WHERE id = v_camp AND status IN ('sent', 'sending', 'draft');
      v_total := v_total + v_new;
      v_pages := v_pages + 1;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('enqueued', v_total, 'steps', v_pages);
END;
$function$;


CREATE OR REPLACE FUNCTION public.crm_signup_page_set_status(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_status text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p public.crm_signup_pages;
  v_close timestamptz;
BEGIN
  IF p_status NOT IN ('live', 'closed', 'draft', 'open') THEN RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023'; END IF;
  IF NOT public._crm_signup_owner(p_venue_id, p_organizer_user_id) THEN RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.crm_signup_pages WHERE id = p_id AND venue_id IS NOT DISTINCT FROM p_venue_id AND organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_status IN ('live', 'open') THEN
    IF length(trim(p.title)) = 0 OR length(trim(p.button_label)) = 0 THEN RAISE EXCEPTION 'incomplete' USING ERRCODE = '22023'; END IF;
    -- Une page Guest list sans lien n'envoie personne nulle part : pas de mise en ligne.
    IF p.kind = 'guestlist' AND p.after_url IS NULL THEN RAISE EXCEPTION 'no_after_url' USING ERRCODE = '22023'; END IF;
    v_close := public._crm_signup_close_at(p);
    IF p.status = 'draft' AND v_close IS NOT NULL AND v_close <= now() THEN RAISE EXCEPTION 'closes_in_past' USING ERRCODE = '22023'; END IF;
    PERFORM public._crm_signup_ensure_group(p.id, auth.uid());
    UPDATE public.crm_signup_pages SET
      status = 'live',
      published_at = COALESCE(published_at, now()),
      opens_at = CASE WHEN p_status = 'open' OR (p.status = 'closed' AND opens_at > now()) THEN now() ELSE opens_at END,
      -- Rouvrir une page fermée par ses dates : elle reste ouverte jusqu'à ce qu'on la ferme.
      closes_mode = CASE WHEN p.status <> 'draft' AND v_close IS NOT NULL AND v_close <= now() THEN 'never' ELSE closes_mode END,
      updated_at = now()
     WHERE id = p.id;
    RETURN 'live';
  END IF;
  UPDATE public.crm_signup_pages SET status = p_status, updated_at = now() WHERE id = p.id;
  RETURN p_status;
END;
$function$;

REVOKE ALL ON FUNCTION public._crm_signup_grant(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_signup_grant(uuid) TO service_role;
