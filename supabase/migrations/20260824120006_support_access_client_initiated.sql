-- Accès assisté : le pro peut DEMANDER l'aide de Yuno lui-même.
--
-- Le cycle d'origine partait toujours de l'admin (« Yuno demande l'accès ») et
-- le pro répondait. Mais le cas le plus fréquent est l'inverse : le client
-- ouvre son compte, ne sait pas par où commencer, et veut qu'on lui monte sa
-- soirée. L'obliger à attendre qu'on le sollicite ajoute un aller-retour pour
-- rien — et donne le sentiment que c'est Yuno qui pousse la porte, alors que
-- c'est lui qui l'ouvre.
--
-- `request_support_help()` crée un grant DÉJÀ approuvé : le consentement est
-- l'acte même de cliquer, il ne se redemande pas. La trace est identique
-- (journal, expiration, révocation), seule l'initiative change — d'où
-- `initiated_by`, qui permet à l'app comme au journal de dire honnêtement qui a
-- ouvert la porte.

ALTER TABLE public.admin_support_grants
  ADD COLUMN IF NOT EXISTS initiated_by text NOT NULL DEFAULT 'admin'
    CHECK (initiated_by IN ('admin', 'client'));

CREATE OR REPLACE FUNCTION public.request_support_help(_reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_admin uuid;
  v_id    uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  -- Une session support ne peut pas se prolonger toute seule en « demandant de
  -- l'aide » au nom du pro.
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'support_session_forbidden';
  END IF;

  -- Déjà un accès ouvert : ne pas empiler les grants.
  SELECT id INTO v_id
    FROM public.admin_support_grants
   WHERE target_user_id = v_uid
     AND status IN ('pending', 'active')
     AND expires_at > now()
   LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  -- `requested_by` est NOT NULL : on l'attribue au super admin. En pratique il
  -- n'y en a qu'un (Paul) ; le champ dit « qui pourra ouvrir la session », pas
  -- « qui a demandé » — c'est `initiated_by` qui porte cette nuance.
  SELECT ur.user_id INTO v_admin
    FROM public.user_roles ur
   WHERE ur.role = 'admin'
   ORDER BY ur.created_at
   LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'no_support_contact'; END IF;

  INSERT INTO public.admin_support_grants
    (target_user_id, requested_by, status, reason, approved_at, initiated_by)
  VALUES
    (v_uid, v_admin, 'active', NULLIF(btrim(coalesce(_reason, '')), ''), now(), 'client')
  RETURNING id INTO v_id;

  INSERT INTO public.admin_support_audit (grant_id, target_user_id, actor_id, action)
  VALUES (v_id, v_uid, v_uid, 'help_requested');

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_support_help(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_support_help(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Prévenir l'admin : sans ça, un client qui demande de l'aide attend qu'on
-- pense à regarder. Le flux plateforme (`/admin/alerts`) est fait pour ça.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_admin_support_grant_ready()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  -- Seul le passage à 'active' compte : c'est le moment où une session devient
  -- ouvrable, que l'accord vienne d'une acceptation ou d'une demande directe.
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' THEN RETURN NEW; END IF;

  SELECT COALESCE(
           NULLIF(btrim(p.organization_name), ''),
           NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
           p.email
         )
    INTO v_name
    FROM public.profiles p
   WHERE p.id = NEW.target_user_id;

  PERFORM emit_admin_notification(
    'admin_support_access_ready',
    CASE WHEN NEW.initiated_by = 'client'
         THEN 'Un pro demande de l''aide'
         ELSE 'Accès assisté accordé' END,
    COALESCE(v_name, 'Un pro') ||
      CASE WHEN NEW.initiated_by = 'client'
           THEN ' demande que Yuno configure son compte.'
           ELSE ' a accordé l''accès assisté.' END,
    'high',
    'support_grant',
    NEW.id::text,
    jsonb_build_object('grant_id', NEW.id, 'target_user_id', NEW.target_user_id,
                       'initiated_by', NEW.initiated_by),
    'support_grant_ready:' || NEW.id::text
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_admin_support_grant_ready ON public.admin_support_grants;
CREATE TRIGGER trg_notify_admin_support_grant_ready
  AFTER INSERT OR UPDATE OF status ON public.admin_support_grants
  FOR EACH ROW EXECUTE FUNCTION public.notify_admin_support_grant_ready();
