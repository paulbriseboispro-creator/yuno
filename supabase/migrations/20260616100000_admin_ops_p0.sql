-- ============================================================================
-- Admin Ops P0 — journal d'audit, suspension de compte, reset MFA, modération
-- d'événements (cf. AUDIT_SUPERADMIN.md).
--
-- Principe : toute action admin sensible passe par une RPC SECURITY DEFINER
-- gardée par is_super_admin() et journalisée dans admin_audit_log. Ces RPC
-- se déploient via `supabase db push` (PAS via `functions deploy`) → elles ne
-- sont PAS bloquées par le cap edge 402.
-- ============================================================================

-- 1. Journal d'audit des actions admin ----------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    uuid NOT NULL DEFAULT auth.uid(),
  action      text NOT NULL,
  entity_type text,
  entity_id   text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at ON public.admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_entity     ON public.admin_audit_log (entity_type, entity_id);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Lecture réservée au super admin ; aucune écriture client : seules les RPC
-- SECURITY DEFINER ci-dessous insèrent (via log_admin_action).
DROP POLICY IF EXISTS "Super admins can read audit log" ON public.admin_audit_log;
CREATE POLICY "Super admins can read audit log"
  ON public.admin_audit_log FOR SELECT
  USING (public.is_super_admin());

-- Helper interne de journalisation (appelé par les RPC admin) ------------------
CREATE OR REPLACE FUNCTION public.log_admin_action(
  _action      text,
  _entity_type text DEFAULT NULL,
  _entity_id   text DEFAULT NULL,
  _metadata    jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), _action, _entity_type, _entity_id, COALESCE(_metadata, '{}'::jsonb));
END;
$$;

-- 2. Suspension de compte (niveau plateforme) ---------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_suspended      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspended_at      timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_by      uuid,
  ADD COLUMN IF NOT EXISTS suspension_reason text;

-- Lecture du statut (utilisable côté front pour le gating + RLS futur P1)
CREATE OR REPLACE FUNCTION public.is_account_suspended(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT is_suspended FROM public.profiles WHERE id = _user_id), false);
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_suspended(
  _user_id   uuid,
  _suspended boolean,
  _reason    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;
  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot suspend your own account';
  END IF;
  -- Garde-fou : on ne suspend pas un autre admin
  IF _suspended AND EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin'::app_role
  ) THEN
    RAISE EXCEPTION 'Cannot suspend an admin account';
  END IF;

  UPDATE public.profiles
  SET is_suspended      = _suspended,
      suspended_at      = CASE WHEN _suspended THEN now()        ELSE NULL END,
      suspended_by      = CASE WHEN _suspended THEN auth.uid()   ELSE NULL END,
      suspension_reason = CASE WHEN _suspended THEN _reason      ELSE NULL END
  WHERE id = _user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', _user_id;
  END IF;

  PERFORM public.log_admin_action(
    CASE WHEN _suspended THEN 'user_suspended' ELSE 'user_unsuspended' END,
    'profile', _user_id::text,
    jsonb_build_object('reason', _reason)
  );
END;
$$;

-- 3. Reset MFA (recovery pro) — débloque un compte verrouillé ------------------
-- Réplique le bloc éprouvé de admin_delete_venue (mais conserve mfa_enforced :
-- un owner sera reforcé à ré-enrôler une nouvelle app à la prochaine connexion).
CREATE OR REPLACE FUNCTION public.admin_reset_user_mfa(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  UPDATE public.profiles
  SET mfa_enabled     = false,
      mfa_verified_at = NULL
  WHERE id = _user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', _user_id;
  END IF;

  DELETE FROM public.mfa_pending          WHERE user_id = _user_id;
  DELETE FROM public.mfa_recovery_codes   WHERE user_id = _user_id;
  DELETE FROM public.mfa_disable_requests WHERE user_id = _user_id;
  DELETE FROM public.mfa_secrets          WHERE user_id = _user_id;

  PERFORM public.log_admin_action('user_mfa_reset', 'profile', _user_id::text, '{}'::jsonb);
END;
$$;

-- 4. Modération / annulation d'événements -------------------------------------
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled', 'postponed')),
  ADD COLUMN IF NOT EXISTS cancelled_at        timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

-- Dépublier / republier (retire de la découverte publique — réversible) -------
-- Le public (Explore) filtre visibility='public' AND is_discoverable=true.
CREATE OR REPLACE FUNCTION public.admin_set_event_published(
  _event_id  uuid,
  _published boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  UPDATE public.events
  SET is_discoverable = _published
  WHERE id = _event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found: %', _event_id;
  END IF;

  PERFORM public.log_admin_action(
    CASE WHEN _published THEN 'event_published' ELSE 'event_depublished' END,
    'event', _event_id::text, '{}'::jsonb
  );
END;
$$;

-- Annuler un événement (kill-switch) — retire du public + marque cancelled.
-- NB : le remboursement de masse des billets/tables se fait via owner-refund
-- (ouvert au rôle admin) une fois le cap edge levé — cf. AUDIT_SUPERADMIN.md.
CREATE OR REPLACE FUNCTION public.admin_cancel_event(
  _event_id uuid,
  _reason   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  UPDATE public.events
  SET status              = 'cancelled',
      cancelled_at        = now(),
      cancellation_reason = _reason,
      is_discoverable     = false,
      is_active           = false
  WHERE id = _event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found: %', _event_id;
  END IF;

  PERFORM public.log_admin_action('event_cancelled', 'event', _event_id::text,
    jsonb_build_object('reason', _reason));
END;
$$;

-- 5. Droits d'exécution -------------------------------------------------------
-- log_admin_action : interne uniquement (les RPC SECURITY DEFINER l'appellent
-- en tant que propriétaire ; on bloque l'appel direct par un client).
REVOKE EXECUTE ON FUNCTION public.log_admin_action(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- RPC admin : appelables par un client authentifié, mais self-gated par
-- is_super_admin() en interne (un non-admin reçoit une exception).
GRANT EXECUTE ON FUNCTION public.admin_set_user_suspended(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_user_mfa(uuid)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_event_published(uuid, boolean)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_event(uuid, text)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_account_suspended(uuid)                     TO authenticated;
