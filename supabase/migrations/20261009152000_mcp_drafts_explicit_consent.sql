-- MCP : les brouillons d'e-mails ne s'accordent qu'avec un consentement qui
-- les ANNONCE (2026-10-06).
--
-- 20261009150000 accordait les brouillons par défaut (p_drafts DEFAULT true).
-- Tant que l'ancien écran /connect-ai (« ne modifie jamais rien ») est servi,
-- une connexion approuvée là-bas aurait reçu un droit qu'on ne lui a pas
-- annoncé. Désormais : false par défaut, le nouvel écran passe p_drafts = true.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.mcp_approve_authorization(p_request_id uuid, p_spaces text[], p_level text, p_drafts boolean DEFAULT false)
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

  -- Brouillons d'e-mails : accordés seulement quand l'écran de consentement
  -- les a annoncés (il passe p_drafts = true). Le droit d'écrire dans CHAQUE espace reste celui
  -- de la Console, revérifié à chaque écriture (mcp_write).
  INSERT INTO public.mcp_grants (user_id, client_id, client_name, spaces, level, can_draft)
  VALUES (v_uid, r.client_id, c.client_name, (SELECT array_agg(DISTINCT x) FROM unnest(p_spaces) x), p_level, coalesce(p_drafts, false))
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

REVOKE ALL ON FUNCTION public.mcp_approve_authorization(uuid, text[], text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_approve_authorization(uuid, text[], text, boolean) TO authenticated;
