-- Un sous-domaine d'envoi par compte : contact@<nom>.news.yunoapp.eu.
--
-- Pourquoi : Gmail ne dit jamais qui a cliqué « spam », et Resend (Amazon SES) pose
-- son propre Feedback-ID : impossible de savoir par compte depuis news.yunoapp.eu.
-- Google Postmaster publie en revanche ses chiffres PAR DOMAINE : un sous-domaine
-- par compte donne les signalements, refus et réputation de CE compte, et un compte
-- qui dérape abîme d'abord son sous-domaine (décision de Paul du 03/11).
--
-- Le nom vient du registre des adresses (email_sender_locals : « woh », « 3-am »,
-- « amoris »). Deux espaces d'une même marque (WOH Billetterie et WOH CRM, `shared`)
-- partagent le même sous-domaine.
--
-- Cycle : `pending` (créé chez Resend, DNS posés, pas encore vérifié) → `verified`
-- (Resend l'a vérifié) → `active` (send-campaign l'utilise) → `paused` (retour à
-- news.yunoapp.eu). Vérifier et activer sont DÉCORRÉLÉS : un domaine non vérifié qui
-- serait utilisé ferait échouer 100 % des envois. Création et vérification :
-- scripts/email-domains/setup.mjs ; activation : super admin seul.

CREATE TABLE IF NOT EXISTS public.email_sending_domains (
  scope_key text PRIMARY KEY,
  domain text NOT NULL CHECK (domain ~ '^[a-z0-9-]+\.news\.yunoapp\.eu$'),
  local_part text NOT NULL DEFAULT 'contact' CHECK (local_part ~ '^[a-z0-9._-]{1,40}$'),
  resend_domain_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'active', 'paused')),
  records jsonb,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  activated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.email_sending_domains ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS email_sending_domains_domain_idx ON public.email_sending_domains (domain);

-- L'adresse d'envoi d'un compte quand son sous-domaine est ACTIF, sinon NULL
-- (send-campaign retombe alors sur news.yunoapp.eu, comme avant).
CREATE OR REPLACE FUNCTION public.email_sending_address_for(p_scope_key text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT d.local_part || '@' || d.domain FROM public.email_sending_domains d
   WHERE d.scope_key = p_scope_key AND d.status = 'active';
$$;
REVOKE ALL ON FUNCTION public.email_sending_address_for(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_sending_address_for(text) TO service_role;

-- Les sous-domaines actifs, pour la lecture Google Postmaster.
CREATE OR REPLACE FUNCTION public.email_sending_domains_active()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT COALESCE(array_agg(DISTINCT domain ORDER BY domain), '{}') FROM public.email_sending_domains WHERE status IN ('verified', 'active'); $$;
REVOKE ALL ON FUNCTION public.email_sending_domains_active() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_sending_domains_active() TO service_role;

-- Super admin : la liste, avec le nom du compte et son volume récent.
CREATE OR REPLACE FUNCTION public.admin_email_sending_domains()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'scope_key', d.scope_key, 'domain', d.domain, 'address', d.local_part || '@' || d.domain,
    'status', d.status, 'note', d.note, 'verified_at', d.verified_at, 'activated_at', d.activated_at,
    'name', COALESCE(public.crm_space_display_name(
      CASE WHEN d.scope_key LIKE 'venue:%' THEN substr(d.scope_key, 7) END,
      CASE WHEN d.scope_key LIKE 'org:%' THEN substr(d.scope_key, 5)::uuid END), d.scope_key))
    ORDER BY d.domain, d.scope_key) FROM public.email_sending_domains d), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.admin_email_sending_domains() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_email_sending_domains() TO authenticated;

-- Super admin : activer (un domaine VÉRIFIÉ), mettre en pause, reprendre. Motif obligatoire.
CREATE OR REPLACE FUNCTION public.admin_set_email_sending_domain(p_scope_key text, p_status text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE d public.email_sending_domains;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_status NOT IN ('active', 'paused') THEN RAISE EXCEPTION 'bad_status'; END IF;
  SELECT * INTO d FROM public.email_sending_domains WHERE scope_key = p_scope_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF p_status = 'active' AND d.verified_at IS NULL THEN RAISE EXCEPTION 'not_verified'; END IF;
  UPDATE public.email_sending_domains
     SET status = p_status, note = trim(p_reason), updated_at = now(),
         activated_at = CASE WHEN p_status = 'active' THEN now() ELSE activated_at END
   WHERE scope_key = p_scope_key;
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'email_sending_domain_' || p_status, 'email_sending_domain', p_scope_key,
          jsonb_build_object('domain', d.domain, 'from', d.status, 'reason', trim(p_reason)));
  RETURN public.admin_email_sending_domains();
END $$;
REVOKE ALL ON FUNCTION public.admin_set_email_sending_domain(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_email_sending_domain(text, text, text) TO authenticated;
