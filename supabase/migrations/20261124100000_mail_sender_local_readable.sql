-- Adresse d'expédition lisible (décision de Paul, 03/11) : « woh@ », jamais
-- « woh-cac89a@ ». Un suffixe de six caractères hexadécimaux a l'air d'un
-- expéditeur de spam dans la boîte du client.
--
-- AVANT (20261023170000) : slug du nom ; s'il est réservé ou déjà pris par un
-- autre espace, slug + six caractères tirés de l'espace.
-- MAINTENANT :
--   · même slug, mais en cas de collision le suffixe est un petit numéro
--     lisible (`rex-club-2`), jamais un hachage ;
--   · une MÊME organisation qui a deux espaces (Yuno Tickets et Yuno CRM) peut
--     partager son adresse : `email_sender_locals.shared` marque les lignes
--     qui le font à dessein, posé par un humain, jamais par le moteur. L'unicité
--     reste la règle pour tout le reste (un compte ne peut pas écrire « depuis »
--     un autre).
-- Les adresses déjà attribuées ne bougent pas.

ALTER TABLE public.email_sender_locals ADD COLUMN IF NOT EXISTS shared boolean NOT NULL DEFAULT false;
ALTER TABLE public.email_sender_locals DROP CONSTRAINT IF EXISTS email_sender_locals_local_part_key;
CREATE UNIQUE INDEX IF NOT EXISTS email_sender_locals_local_part_unique
  ON public.email_sender_locals (local_part) WHERE NOT shared;
CREATE INDEX IF NOT EXISTS email_sender_locals_local_part_idx ON public.email_sender_locals (local_part);

CREATE OR REPLACE FUNCTION public.email_sender_local_preview(p_scope_key text, p_name text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_have text;
  v_slug text := left(public._email_local_slug(p_name), 56);
  v_try text;
  v_n int := 1;
  v_reserved text[] := ARRAY['abuse', 'admin', 'administrator', 'billing', 'club', 'contact', 'dpo', 'help', 'hello',
    'hostmaster', 'info', 'legal', 'mailer-daemon', 'marketing', 'news', 'newsletter', 'no-reply', 'noreply',
    'postmaster', 'privacy', 'root', 'sales', 'security', 'support', 'team', 'webmaster', 'yuno', 'yunoapp', 'yuno-crm'];
BEGIN
  SELECT l.local_part INTO v_have FROM public.email_sender_locals l WHERE l.scope_key = p_scope_key;
  IF v_have IS NOT NULL THEN RETURN v_have; END IF;
  LOOP
    v_try := CASE WHEN v_n = 1 THEN v_slug ELSE v_slug || '-' || v_n END;
    IF NOT (v_n = 1 AND v_try = ANY (v_reserved))
       AND NOT EXISTS (SELECT 1 FROM public.email_sender_locals l WHERE l.local_part = v_try) THEN
      RETURN v_try;
    END IF;
    v_n := v_n + 1;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.email_sender_local_claim(p_scope_key text, p_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_local text;
  v_attempt int := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'email_sender_local_claim: service_role only';
  END IF;
  IF p_scope_key IS NULL OR p_scope_key = '' THEN RAISE EXCEPTION 'email_sender_local_claim: scope required'; END IF;
  LOOP
    SELECT l.local_part INTO v_local FROM public.email_sender_locals l WHERE l.scope_key = p_scope_key;
    IF v_local IS NOT NULL THEN RETURN v_local; END IF;
    v_local := public.email_sender_local_preview(p_scope_key, p_name);
    BEGIN
      INSERT INTO public.email_sender_locals (scope_key, local_part) VALUES (p_scope_key, v_local);
      RETURN v_local;
    EXCEPTION WHEN unique_violation THEN
      -- Course : un autre espace vient de prendre ce nom, ou cet espace vient
      -- d'être servi par un autre worker. On relit puis on retente.
      v_attempt := v_attempt + 1;
      IF v_attempt > 5 THEN RAISE; END IF;
    END;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.email_sender_local_preview(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_sender_local_claim(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_sender_local_preview(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_sender_local_claim(text, text) TO service_role;

-- WOH : une seule organisation, deux espaces (Yuno Tickets = org:617d01cb…,
-- Yuno CRM = venue:woh). Les deux écrivent depuis woh@ (décision de Paul).
UPDATE public.email_sender_locals SET shared = true
 WHERE scope_key = 'org:617d01cb-6568-4a7a-9aea-4f25d9c29fc8' AND local_part = 'woh';
INSERT INTO public.email_sender_locals (scope_key, local_part, shared)
SELECT 'venue:woh', 'woh', true
 WHERE EXISTS (SELECT 1 FROM public.email_sender_locals WHERE scope_key = 'org:617d01cb-6568-4a7a-9aea-4f25d9c29fc8' AND local_part = 'woh')
ON CONFLICT (scope_key) DO NOTHING;
