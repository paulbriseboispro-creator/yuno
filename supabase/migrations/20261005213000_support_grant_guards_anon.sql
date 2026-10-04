-- ============================================================================
-- Accès assisté : seul le pro concerné approuve ou coupe sa propre autorisation.
--
-- `IF g.target_user_id <> auth.uid() THEN RAISE` laissait passer un visiteur
-- sans session (NULL). Prouvé le 04/10 en transaction annulée : avec la seule
-- clé publique et l'identifiant d'une demande, approve_support_grant passait
-- une autorisation « pending » à « active » (le consentement du pro, donné à
-- sa place), et revoke_support_grant la coupait.
-- Les tests deviennent `IS DISTINCT FROM`, et ces fonctions ne sont plus
-- exécutables par anon. Corps repris de la base liée (pg_get_functiondef, 04/10).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.approve_support_grant(_grant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g public.admin_support_grants%ROWTYPE;
BEGIN
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'support_session_forbidden';
  END IF;

  SELECT * INTO g FROM public.admin_support_grants WHERE id = _grant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'grant_not_found'; END IF;
  IF g.target_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'not_grant_target'; END IF;
  IF g.status <> 'pending' THEN RAISE EXCEPTION 'grant_not_pending'; END IF;
  IF g.expires_at IS NOT NULL AND g.expires_at <= now() THEN
    RAISE EXCEPTION 'grant_expired';
  END IF;

  UPDATE public.admin_support_grants
     SET status = 'active', approved_at = now()
   WHERE id = _grant_id;

  INSERT INTO public.admin_support_audit (grant_id, target_user_id, actor_id, action)
  VALUES (_grant_id, g.target_user_id, auth.uid(), 'grant_approved');
END;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_support_grant(_grant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g public.admin_support_grants%ROWTYPE;
  s RECORD;
BEGIN
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'support_session_forbidden';
  END IF;

  SELECT * INTO g FROM public.admin_support_grants WHERE id = _grant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'grant_not_found'; END IF;
  IF g.target_user_id IS DISTINCT FROM auth.uid() AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF g.status IN ('revoked', 'expired') THEN RETURN; END IF;

  UPDATE public.admin_support_grants
     SET status = 'revoked', revoked_at = now(), revoked_by = auth.uid()
   WHERE id = _grant_id;

  -- Tuer les jetons AVANT de marquer les sessions closes : si l'un des deux
  -- doit rater, mieux vaut une ligne encore 'active' qu'un jeton encore vivant.
  FOR s IN
    SELECT auth_session_id FROM public.admin_support_sessions
     WHERE grant_id = _grant_id AND status IN ('pending', 'active')
  LOOP
    PERFORM public.revoke_auth_session(s.auth_session_id);
  END LOOP;

  UPDATE public.admin_support_sessions
     SET status = 'ended', ended_at = now()
   WHERE grant_id = _grant_id
     AND status IN ('pending', 'active');

  INSERT INTO public.admin_support_audit (grant_id, target_user_id, actor_id, action)
  VALUES (_grant_id, g.target_user_id, auth.uid(), 'grant_revoked');
END;
$function$;


REVOKE ALL ON FUNCTION public.approve_support_grant(_grant_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_support_grant(_grant_id uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.revoke_support_grant(_grant_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_support_grant(_grant_id uuid) TO authenticated, service_role;
