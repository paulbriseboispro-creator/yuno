-- ═══════════════════════════════════════════════════════════════════════════
-- Accès support Yuno (« mode assisté ») — consentement, sessions, verrous.
--
-- Besoin produit : un super admin (Paul) doit pouvoir aider un pro (organisateur
-- ou club) à configurer son compte — événements, guest lists, tables — SANS
-- connaître son mot de passe, SANS MFA, mais avec un cadre : consentement
-- explicite du client, durée limitée, données de paiement/identité verrouillées,
-- et journal d'audit lisible par le client.
--
-- Architecture :
--   1. admin_support_grants    — l'autorisation (demandée par l'admin, approuvée
--                                 par le client, révocable des deux côtés).
--   2. admin_support_sessions  — chaque session ouverte par l'admin. La session
--                                 GoTrue mintée (via l'edge admin-account-recovery)
--                                 est identifiée par son claim JWT `session_id` :
--                                 c'est la clé de TOUS les verrous ci-dessous.
--   3. admin_support_audit     — journal : cycle de vie du grant + toute écriture
--                                 faite pendant une session support sur les tables
--                                 métier scopées. SELECT ouvert au client ciblé.
--   4. is_support_session()    — la requête courante vient-elle d'une session
--                                 support active ? Lue par les triggers de garde,
--                                 le front (bannière) et les edge functions
--                                 sensibles (stripe-connect, email-change,
--                                 delete-account).
--   5. Verrous : écriture INTERDITE en session support sur les données d'argent
--      (organizer_payout_details, cycle promoteur, colonnes stripe_connect_*),
--      d'identité (email, PIN, suspension) et de MFA. Un « accès facilité »
--      ne doit jamais pouvoir détourner un centime ni verrouiller le compte.
--
-- NB : les triggers de garde discriminent sur auth.jwt() (GUC de requête), PAS
-- sur current_user — ils peuvent donc être SECURITY DEFINER sans se désactiver
-- eux-mêmes (contrairement aux gardes du cycle promoteur, voir CLAUDE.md).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Tables ────────────────────────────────────────────────────────────────

CREATE TABLE public.admin_support_grants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  requested_by    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'active', 'revoked', 'expired')),
  -- v1 : périmètre unique « configuration » (événements, guest lists, tables,
  -- profil public). Les paiements/identité sont exclus par construction.
  scope           text NOT NULL DEFAULT 'config',
  reason          text,
  approved_at     timestamptz,
  revoked_at      timestamptz,
  revoked_by      uuid,
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '7 days',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_support_grants_target ON public.admin_support_grants (target_user_id, status);

CREATE TABLE public.admin_support_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id         uuid NOT NULL REFERENCES public.admin_support_grants(id) ON DELETE CASCADE,
  admin_id         uuid NOT NULL,
  target_user_id   uuid NOT NULL,
  -- Claim `session_id` du JWT minté. Posé à l'enregistrement (support-register),
  -- NULL tant que la session n'a pas été consommée par l'admin.
  auth_session_id  uuid,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'active', 'ended', 'expired')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  registered_at    timestamptz,
  ended_at         timestamptz,
  expires_at       timestamptz NOT NULL DEFAULT now() + interval '12 hours'
);

-- Sonde chaude : is_support_session() fait un probe par écriture sur les tables
-- scopées — l'index partiel garde ce probe à coût constant.
CREATE INDEX idx_support_sessions_auth ON public.admin_support_sessions (auth_session_id)
  WHERE status = 'active';
CREATE INDEX idx_support_sessions_grant ON public.admin_support_sessions (grant_id);

CREATE TABLE public.admin_support_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id        uuid REFERENCES public.admin_support_grants(id) ON DELETE CASCADE,
  session_id      uuid REFERENCES public.admin_support_sessions(id) ON DELETE SET NULL,
  target_user_id  uuid NOT NULL,
  actor_id        uuid,
  action          text NOT NULL,
  table_name      text,
  row_pk          text,
  detail          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_support_audit_target ON public.admin_support_audit (target_user_id, created_at DESC);

-- ── 2. Détection de session support ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_support_session()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.admin_support_sessions s
     WHERE s.auth_session_id = NULLIF(auth.jwt() ->> 'session_id', '')::uuid
       AND s.status = 'active'
       AND s.expires_at > now()
  );
$$;

REVOKE ALL ON FUNCTION public.is_support_session() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_support_session() TO authenticated, service_role;

-- Détail de la session courante (bannière front : qui, jusqu'à quand).
CREATE OR REPLACE FUNCTION public.get_my_support_session()
RETURNS TABLE (session_id uuid, grant_id uuid, expires_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.grant_id, s.expires_at
    FROM public.admin_support_sessions s
   WHERE s.auth_session_id = NULLIF(auth.jwt() ->> 'session_id', '')::uuid
     AND s.status = 'active'
     AND s.expires_at > now()
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_my_support_session() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_support_session() TO authenticated, service_role;

-- ── 3. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.admin_support_grants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_support_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_support_audit   ENABLE ROW LEVEL SECURITY;

-- Grants : le client ciblé voit ses grants ; l'admin voit tout.
CREATE POLICY support_grants_select ON public.admin_support_grants
  FOR SELECT USING (
    target_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')
  );

-- Création : admin uniquement, jamais depuis une session support (une session
-- support est authentifiée COMME LE CLIENT — sans ce verrou elle pourrait
-- s'auto-accorder des grants).
CREATE POLICY support_grants_insert ON public.admin_support_grants
  FOR INSERT WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    AND requested_by = auth.uid()
    AND NOT public.is_support_session()
  );

-- Aucune policy UPDATE/DELETE : les transitions d'état passent par les RPC
-- approve_support_grant / revoke_support_grant (audit inclus).

-- Sessions : visibles par l'admin et par le client ciblé (transparence).
CREATE POLICY support_sessions_select ON public.admin_support_sessions
  FOR SELECT USING (
    target_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')
  );
-- Écritures : service_role uniquement (edge admin-account-recovery).

-- Audit : le client ciblé lit tout ce qui le concerne ; l'admin aussi.
CREATE POLICY support_audit_select ON public.admin_support_audit
  FOR SELECT USING (
    target_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')
  );
-- Écritures : triggers SECURITY DEFINER + service_role uniquement.

-- ── 4. Transitions de grant (RPC) ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.approve_support_grant(_grant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g public.admin_support_grants%ROWTYPE;
BEGIN
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'support_session_forbidden';
  END IF;

  SELECT * INTO g FROM public.admin_support_grants WHERE id = _grant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'grant_not_found'; END IF;
  IF g.target_user_id <> auth.uid() THEN RAISE EXCEPTION 'not_grant_target'; END IF;
  IF g.status <> 'pending' THEN RAISE EXCEPTION 'grant_not_pending'; END IF;
  IF g.expires_at <= now() THEN RAISE EXCEPTION 'grant_expired'; END IF;

  UPDATE public.admin_support_grants
     SET status = 'active', approved_at = now()
   WHERE id = _grant_id;

  INSERT INTO public.admin_support_audit (grant_id, target_user_id, actor_id, action)
  VALUES (_grant_id, g.target_user_id, auth.uid(), 'grant_approved');
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_support_grant(_grant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g public.admin_support_grants%ROWTYPE;
BEGIN
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'support_session_forbidden';
  END IF;

  SELECT * INTO g FROM public.admin_support_grants WHERE id = _grant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'grant_not_found'; END IF;
  IF g.target_user_id <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF g.status IN ('revoked', 'expired') THEN RETURN; END IF;

  UPDATE public.admin_support_grants
     SET status = 'revoked', revoked_at = now(), revoked_by = auth.uid()
   WHERE id = _grant_id;

  -- La révocation coupe toutes les sessions du grant (les triggers de garde et
  -- is_support_session() cessent immédiatement de reconnaître ces JWT).
  UPDATE public.admin_support_sessions
     SET status = 'ended', ended_at = now()
   WHERE grant_id = _grant_id
     AND status IN ('pending', 'active');

  INSERT INTO public.admin_support_audit (grant_id, target_user_id, actor_id, action)
  VALUES (_grant_id, g.target_user_id, auth.uid(), 'grant_revoked');
END;
$$;

REVOKE ALL ON FUNCTION public.approve_support_grant(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_support_grant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_support_grant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_support_grant(uuid) TO authenticated;

-- ── 5. Verrous d'écriture (session support) ──────────────────────────────────

-- Blocage total : argent, MFA, et les tables du système support lui-même.
CREATE OR REPLACE FUNCTION public.block_support_session_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'support_session_forbidden: écriture interdite sur % en mode support', TG_TABLE_NAME
      USING ERRCODE = 'P0403';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Argent : coordonnées de virement de l'organisateur.
CREATE TRIGGER trg_support_block_organizer_payout_details
  BEFORE INSERT OR UPDATE OR DELETE ON public.organizer_payout_details
  FOR EACH ROW EXECUTE FUNCTION public.block_support_session_write();

-- Argent : cycle de règlement promoteur (en plus des gardes existantes).
CREATE TRIGGER trg_support_block_promoter_payouts
  BEFORE INSERT OR UPDATE OR DELETE ON public.promoter_payouts
  FOR EACH ROW EXECUTE FUNCTION public.block_support_session_write();

-- promoter_conversions : UPDATE/DELETE seulement.
--
-- L'INSERT reste autorisé volontairement. Une conversion créée au scan
-- (`record_promoter_conversion`) constate un fait opérationnel — cette personne
-- est entrée grâce à ce promoteur — et non une décision d'argent ; le montant
-- et le statut de règlement sont gouvernés ailleurs (guard_promoter_conversion_settlement,
-- cycle prepare/declare/confirm). Si on bloquait l'INSERT, une entrée pointée
-- pendant une session d'assistance ferait perdre au promoteur sa commission,
-- **en silence** : les trois sites d'appel lancent la RPC en fire-and-forget,
-- donc l'échec n'apparaîtrait ni à la porte ni dans un toast.
CREATE TRIGGER trg_support_block_promoter_conversions
  BEFORE UPDATE OR DELETE ON public.promoter_conversions
  FOR EACH ROW EXECUTE FUNCTION public.block_support_session_write();

-- MFA : une session support ne peut ni enrôler, ni désactiver, ni lire-écrire
-- les codes de récupération.
CREATE TRIGGER trg_support_block_mfa_pending
  BEFORE INSERT OR UPDATE OR DELETE ON public.mfa_pending
  FOR EACH ROW EXECUTE FUNCTION public.block_support_session_write();
CREATE TRIGGER trg_support_block_mfa_secrets
  BEFORE INSERT OR UPDATE OR DELETE ON public.mfa_secrets
  FOR EACH ROW EXECUTE FUNCTION public.block_support_session_write();
CREATE TRIGGER trg_support_block_mfa_recovery_codes
  BEFORE INSERT OR UPDATE OR DELETE ON public.mfa_recovery_codes
  FOR EACH ROW EXECUTE FUNCTION public.block_support_session_write();
CREATE TRIGGER trg_support_block_mfa_disable_requests
  BEFORE INSERT OR UPDATE OR DELETE ON public.mfa_disable_requests
  FOR EACH ROW EXECUTE FUNCTION public.block_support_session_write();

-- Auto-protection du système : une session support ne doit pas pouvoir
-- s'accorder de droits ni réécrire son propre journal.
--
-- ⚠ Cette protection passe par la RLS, PAS par un trigger de blocage. Un
-- trigger `is_support_session() → RAISE` sur admin_support_audit se
-- bloquerait lui-même : la ligne d'audit est écrite PENDANT la session
-- support (par log_support_session_write ci-dessous), donc is_support_session()
-- y est vrai et chaque écriture métier partirait en erreur. Même piège sur
-- admin_support_sessions, que la clôture de session met à jour.
--
-- La RLS suffit et ne peut pas se retourner contre nous :
--   • admin_support_grants   : INSERT exige has_role('admin') ET
--                              NOT is_support_session() ; aucune policy
--                              UPDATE/DELETE (transitions via les RPC).
--   • admin_support_sessions : aucune policy d'écriture.
--   • admin_support_audit    : aucune policy d'écriture.
-- Les seuls écrivains restants sont le service_role (edge functions) et les
-- fonctions SECURITY DEFINER, qui contournent la RLS par construction — et
-- aucun des deux ne peut être piloté depuis une session support.
CREATE TRIGGER trg_support_block_support_grants
  BEFORE UPDATE OR DELETE ON public.admin_support_grants
  FOR EACH ROW EXECUTE FUNCTION public.block_support_session_write();

-- Argent : comptes Stripe des DJs et abonnement Stripe du club.
CREATE TRIGGER trg_support_block_dj_stripe_accounts
  BEFORE INSERT OR UPDATE OR DELETE ON public.dj_stripe_accounts
  FOR EACH ROW EXECUTE FUNCTION public.block_support_session_write();
CREATE TRIGGER trg_support_block_venue_subscriptions
  BEFORE INSERT OR UPDATE OR DELETE ON public.venue_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.block_support_session_write();

-- promoters : gestion d'équipe autorisée, coordonnées bancaires verrouillées.
CREATE OR REPLACE FUNCTION public.block_support_promoter_iban_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_support_session() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.iban IS NOT NULL OR NEW.bic IS NOT NULL THEN
      RAISE EXCEPTION 'support_session_forbidden: IBAN/BIC promoteur en mode support'
        USING ERRCODE = 'P0403';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF NEW.iban IS DISTINCT FROM OLD.iban
     OR NEW.bic IS DISTINCT FROM OLD.bic
     OR NEW.iban_changed_at IS DISTINCT FROM OLD.iban_changed_at
  THEN
    RAISE EXCEPTION 'support_session_forbidden: IBAN/BIC promoteur en mode support'
      USING ERRCODE = 'P0403';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_support_block_promoters_iban
  BEFORE INSERT OR UPDATE OR DELETE ON public.promoters
  FOR EACH ROW EXECUTE FUNCTION public.block_support_promoter_iban_write();

-- profiles : UPDATE autorisé (avatar, bio…) SAUF colonnes Stripe Connect,
-- MFA, identité de connexion et suspension. INSERT/DELETE interdits.
CREATE OR REPLACE FUNCTION public.block_support_sensitive_profile_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_support_session() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP IN ('INSERT', 'DELETE') THEN
    RAISE EXCEPTION 'support_session_forbidden: % interdit sur profiles en mode support', TG_OP
      USING ERRCODE = 'P0403';
  END IF;

  IF NEW.email                          IS DISTINCT FROM OLD.email
     OR NEW.employee_pin                IS DISTINCT FROM OLD.employee_pin
     OR NEW.invoice_prefix              IS DISTINCT FROM OLD.invoice_prefix
     OR NEW.is_suspended                IS DISTINCT FROM OLD.is_suspended
     OR NEW.suspended_at                IS DISTINCT FROM OLD.suspended_at
     OR NEW.suspended_by                IS DISTINCT FROM OLD.suspended_by
     OR NEW.suspension_reason           IS DISTINCT FROM OLD.suspension_reason
     OR NEW.mfa_enabled                 IS DISTINCT FROM OLD.mfa_enabled
     OR NEW.mfa_enforced                IS DISTINCT FROM OLD.mfa_enforced
     OR NEW.mfa_exempt                  IS DISTINCT FROM OLD.mfa_exempt
     OR NEW.mfa_recovery_codes          IS DISTINCT FROM OLD.mfa_recovery_codes
     OR NEW.mfa_verified_at             IS DISTINCT FROM OLD.mfa_verified_at
     OR NEW.stripe_connect_account_id   IS DISTINCT FROM OLD.stripe_connect_account_id
     OR NEW.stripe_connect_status       IS DISTINCT FROM OLD.stripe_connect_status
     OR NEW.stripe_connect_onboarded_at IS DISTINCT FROM OLD.stripe_connect_onboarded_at
     OR NEW.stripe_connect_charges_enabled  IS DISTINCT FROM OLD.stripe_connect_charges_enabled
     OR NEW.stripe_connect_payouts_enabled  IS DISTINCT FROM OLD.stripe_connect_payouts_enabled
  THEN
    RAISE EXCEPTION 'support_session_forbidden: colonne sensible de profiles en mode support'
      USING ERRCODE = 'P0403';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_support_block_profiles_sensitive
  BEFORE INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.block_support_sensitive_profile_write();

-- organizer_profiles : la config publique (bio, réseaux, visuels) est le cœur
-- du mode assisté — mais l'identité légale/financière reste au client.
CREATE OR REPLACE FUNCTION public.block_support_sensitive_orgprofile_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_support_session() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'support_session_forbidden: DELETE interdit sur organizer_profiles en mode support'
      USING ERRCODE = 'P0403';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Créer le profil organisateur pour le client est un usage légitime du mode
    -- assisté — tant que les champs légaux/financiers restent vides.
    IF NEW.billing_email IS NOT NULL
       OR NEW.siret IS NOT NULL
       OR NEW.vat_number IS NOT NULL
       OR NEW.legal_name IS NOT NULL
       OR NEW.legal_address IS NOT NULL
       OR COALESCE(NEW.absorb_yuno_fees, false)
       OR COALESCE(NEW.can_sell_alcohol, false)
       OR COALESCE(NEW.minors_allowed, false)
       OR NEW.minor_auth_doc_url IS NOT NULL
       OR COALESCE(NEW.bde_verified, false)
    THEN
      RAISE EXCEPTION 'support_session_forbidden: champs légaux/financiers en mode support'
        USING ERRCODE = 'P0403';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.billing_email        IS DISTINCT FROM OLD.billing_email
     OR NEW.siret             IS DISTINCT FROM OLD.siret
     OR NEW.vat_number        IS DISTINCT FROM OLD.vat_number
     OR NEW.legal_name        IS DISTINCT FROM OLD.legal_name
     OR NEW.legal_address     IS DISTINCT FROM OLD.legal_address
     OR NEW.absorb_yuno_fees  IS DISTINCT FROM OLD.absorb_yuno_fees
     OR NEW.can_sell_alcohol  IS DISTINCT FROM OLD.can_sell_alcohol
     OR NEW.can_sell_alcohol_confirmed_at IS DISTINCT FROM OLD.can_sell_alcohol_confirmed_at
     OR NEW.minors_allowed    IS DISTINCT FROM OLD.minors_allowed
     OR NEW.minor_auth_doc_url  IS DISTINCT FROM OLD.minor_auth_doc_url
     OR NEW.minor_auth_doc_name IS DISTINCT FROM OLD.minor_auth_doc_name
     OR NEW.bde_verified      IS DISTINCT FROM OLD.bde_verified
     OR NEW.bde_verified_at   IS DISTINCT FROM OLD.bde_verified_at
  THEN
    RAISE EXCEPTION 'support_session_forbidden: champs légaux/financiers d''organizer_profiles en mode support'
      USING ERRCODE = 'P0403';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_support_block_orgprofile_sensitive
  BEFORE INSERT OR UPDATE OR DELETE ON public.organizer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.block_support_sensitive_orgprofile_write();

-- ── 6. Journal des écritures en session support ──────────────────────────────
-- AFTER trigger : la ligne d'audit commit AVEC l'écriture qu'elle journalise.
-- Hors session support, court-circuit immédiat (un probe indexé par écriture).

CREATE OR REPLACE FUNCTION public.log_support_session_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.admin_support_sessions%ROWTYPE;
BEGIN
  SELECT * INTO s
    FROM public.admin_support_sessions
   WHERE auth_session_id = NULLIF(auth.jwt() ->> 'session_id', '')::uuid
     AND status = 'active'
     AND expires_at > now()
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  INSERT INTO public.admin_support_audit
    (grant_id, session_id, target_user_id, actor_id, action, table_name, row_pk)
  VALUES (
    s.grant_id, s.id, s.target_user_id, s.admin_id,
    lower(TG_OP), TG_TABLE_NAME,
    COALESCE(to_jsonb(NEW) ->> 'id', to_jsonb(OLD) ->> 'id')
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_support_log_events
  AFTER INSERT OR UPDATE OR DELETE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.log_support_session_write();
CREATE TRIGGER trg_support_log_guest_lists
  AFTER INSERT OR UPDATE OR DELETE ON public.guest_lists
  FOR EACH ROW EXECUTE FUNCTION public.log_support_session_write();
CREATE TRIGGER trg_support_log_guest_list_invites
  AFTER INSERT OR UPDATE OR DELETE ON public.guest_list_invites
  FOR EACH ROW EXECUTE FUNCTION public.log_support_session_write();
CREATE TRIGGER trg_support_log_guest_list_entries
  AFTER INSERT OR UPDATE OR DELETE ON public.guest_list_entries
  FOR EACH ROW EXECUTE FUNCTION public.log_support_session_write();
CREATE TRIGGER trg_support_log_guest_list_templates
  AFTER INSERT OR UPDATE OR DELETE ON public.guest_list_templates
  FOR EACH ROW EXECUTE FUNCTION public.log_support_session_write();
CREATE TRIGGER trg_support_log_table_packs
  AFTER INSERT OR UPDATE OR DELETE ON public.table_packs
  FOR EACH ROW EXECUTE FUNCTION public.log_support_session_write();
CREATE TRIGGER trg_support_log_venue_floor_plans
  AFTER INSERT OR UPDATE OR DELETE ON public.venue_floor_plans
  FOR EACH ROW EXECUTE FUNCTION public.log_support_session_write();
CREATE TRIGGER trg_support_log_organizer_profiles
  AFTER INSERT OR UPDATE OR DELETE ON public.organizer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.log_support_session_write();
CREATE TRIGGER trg_support_log_tracked_links
  AFTER INSERT OR UPDATE OR DELETE ON public.tracked_links
  FOR EACH ROW EXECUTE FUNCTION public.log_support_session_write();
