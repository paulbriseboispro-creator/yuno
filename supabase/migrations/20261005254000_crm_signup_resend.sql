-- Pages d'inscription : un fan déjà inscrit mais pas encore confirmé (e-mail
-- perdu, lien expiré) qui se réinscrit reçoit un NOUVEAU lien de confirmation
-- (au plus une fois toutes les 10 minutes) ; la réponse reste « déjà inscrit ».

CREATE OR REPLACE FUNCTION public.submit_crm_signup(p_slug text, p_first_name text, p_email text, p_phone text DEFAULT NULL::text, p_answers jsonb DEFAULT '{}'::jsonb, p_consent boolean DEFAULT false, p_consent_text text DEFAULT NULL::text, p_lang text DEFAULT 'fr'::text, p_src text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p public.crm_signup_pages;
  v_ctx record;
  v_email text := lower(trim(COALESCE(p_email, '')));
  v_domain text;
BEGIN
  SELECT * INTO p FROM public.crm_signup_pages WHERE slug = lower(p_slug);
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  IF NOT public._crm_signup_open(p) THEN RETURN 'closed'; END IF;
  IF public._crm_signup_is_demo(p) THEN RETURN 'demo'; END IF;
  IF NOT COALESCE(p_consent, false) OR length(trim(COALESCE(p_consent_text, ''))) < 10 THEN RETURN 'consent_required'; END IF;
  IF length(trim(COALESCE(p_first_name, ''))) = 0 THEN RETURN 'invalid'; END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' OR length(v_email) > 200 THEN RETURN 'invalid_email'; END IF;
  v_domain := split_part(v_email, '@', 2);
  IF EXISTS (SELECT 1 FROM public.crm_disposable_domains WHERE domain = v_domain) THEN RETURN 'disposable'; END IF;
  IF public.is_demo_email(v_email) THEN RETURN 'demo'; END IF;
  SELECT * INTO v_ctx FROM public.links_visitor_context();
  IF (SELECT count(*) FROM public.crm_signup_entries WHERE visitor_hash = v_ctx.o_hash AND created_at > now() - interval '1 hour') >= 10
     OR (SELECT count(*) FROM public.crm_signup_entries WHERE page_id = p.id AND created_at > now() - interval '1 hour') >= 300 THEN
    RETURN 'rate_limited';
  END IF;
  IF EXISTS (SELECT 1 FROM public.crm_signup_entries WHERE page_id = p.id AND lower(email) = v_email) THEN
    -- Déjà inscrit sans avoir confirmé (e-mail perdu, lien expiré) : un nouveau
    -- lien repart, au plus une fois toutes les 10 minutes. Rien d'autre ne change.
    UPDATE public.crm_signup_entries SET confirm_sent_at = NULL, confirm_hash = NULL, created_at = GREATEST(created_at, now() - interval '2 days')
     WHERE page_id = p.id AND lower(email) = v_email AND confirmed_at IS NULL
       AND (confirm_sent_at IS NULL OR confirm_sent_at < now() - interval '10 minutes');
    RETURN 'already';
  END IF;
  INSERT INTO public.crm_signup_entries (page_id, first_name, email, phone, answers, src, lang, consent_text, visitor_hash)
  VALUES (p.id, left(trim(p_first_name), 60), v_email,
          CASE WHEN p.fields->>'contact' = 'email_phone' THEN NULLIF(left(regexp_replace(COALESCE(p_phone, ''), '[^0-9+ ]', '', 'g'), 24), '') END,
          CASE WHEN jsonb_typeof(p_answers) = 'object' AND length(p_answers::text) <= 2000 THEN p_answers ELSE '{}'::jsonb END,
          CASE WHEN lower(p_src) ~ '^[a-z0-9_-]{1,30}$' THEN lower(p_src) END,
          CASE WHEN p_lang IN ('fr', 'en', 'es') THEN p_lang ELSE 'fr' END,
          left(trim(p_consent_text), 600), v_ctx.o_hash)
  ON CONFLICT (page_id, lower(email)) DO NOTHING;
  RETURN 'ok';
END;
$function$;
REVOKE ALL ON FUNCTION public.submit_crm_signup(text, text, text, text, jsonb, boolean, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_crm_signup(text, text, text, text, jsonb, boolean, text, text, text) TO anon, authenticated, service_role;
