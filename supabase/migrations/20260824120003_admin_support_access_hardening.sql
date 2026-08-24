-- Durcissement de l'accès assisté — corrections issues de la revue adversariale.
--
-- Cinq trous, tous du même genre : le verrou reposait sur « cette session EST
-- une session support ACTIVE », et il existait plusieurs façons de ne plus
-- l'être tout en gardant les clés.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. is_support_session() échoue FERMÉ : une session mintée pour du support le
--    reste à vie.
--
-- Avant, la fonction exigeait `status = 'active' AND expires_at > now()`. Deux
-- conséquences absurdes, et graves :
--   • Le pro coupe l'accès → la ligne passe à 'ended' → le JWT que l'admin a
--     encore en main cesse d'être RECONNU comme session support → tous les
--     verrous s'ouvrent. Révoquer promouvait l'admin au lieu de l'évincer.
--   • Idem au passage de expires_at : la session devenait plus puissante en
--     expirant.
-- La bonne question pour un garde n'est pas « cette session est-elle encore
-- valable ? » mais « ce jeton a-t-il été fabriqué par le support ? ». La
-- validité, elle, ne pilote que l'affichage (get_my_support_session) et la
-- révocation effective du jeton (point 2).
-- ─────────────────────────────────────────────────────────────────────────────
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
  );
$$;

-- L'index partiel ne couvrait que les sessions actives : il ne sert plus la
-- sonde ci-dessus, qui interroge toutes les lignes.
DROP INDEX IF EXISTS idx_support_sessions_auth;
CREATE INDEX idx_support_sessions_auth
  ON public.admin_support_sessions (auth_session_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Couper l'accès révoque VRAIMENT le jeton.
--
-- Marquer la ligne 'ended' ne touchait pas GoTrue : l'access token restait bon
-- jusqu'à son expiration et le refresh token indéfiniment. On supprime la
-- session GoTrue elle-même — c'est ce que fait un « sign out » côté serveur.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revoke_auth_session(_auth_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
BEGIN
  IF _auth_session_id IS NULL THEN RETURN; END IF;
  DELETE FROM auth.sessions WHERE id = _auth_session_id;
EXCEPTION WHEN OTHERS THEN
  -- Le schéma auth peut évoluer : ne jamais faire échouer une révocation
  -- métier parce que le nettoyage du jeton a raté. La garde du point 1 tient
  -- de toute façon (le jeton reste marqué « support »).
  NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_auth_session(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.revoke_support_grant(_grant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g public.admin_support_grants%ROWTYPE;
  s RECORD;
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
$$;

REVOKE ALL ON FUNCTION public.revoke_support_grant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_support_grant(uuid) TO authenticated;

-- Clôture propre appelée par l'edge function (service_role) quand l'admin
-- quitte lui-même la session.
CREATE OR REPLACE FUNCTION public.end_support_session(_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.admin_support_sessions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.admin_support_sessions WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  PERFORM public.revoke_auth_session(s.auth_session_id);

  UPDATE public.admin_support_sessions
     SET status = 'ended', ended_at = now()
   WHERE id = _session_id AND status IN ('pending', 'active');
END;
$$;

REVOKE ALL ON FUNCTION public.end_support_session(uuid) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. venues : le compte Stripe du CLUB était grand ouvert.
--
-- La migration 180003 ne retirait que le SELECT de ces colonnes ; l'UPDATE
-- table-level de `authenticated` n'a jamais été retiré, et la policy RLS
-- (owner_id = auth.uid()) est satisfaite par une session support. Un simple
-- PATCH sur stripe_account_id détournait la destination de TOUS les paiements
-- du club. C'est le trou le plus cher de la revue.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.block_support_sensitive_venue_write()
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
    RAISE EXCEPTION 'support_session_forbidden: suppression de club interdite en mode support'
      USING ERRCODE = 'P0403';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Créer le club fait PARTIE du service : un patron qui demande « montez-moi
    -- tout » part souvent d'une page blanche. Ce qu'on n'accepte pas, c'est de
    -- le créer déjà branché sur un compte d'encaissement ou avec une identité
    -- légale pré-remplie — ces deux-là restent des actes du titulaire.
    IF NEW.stripe_account_id IS NOT NULL
       OR COALESCE(NEW.stripe_onboarding_complete, false)
       OR COALESCE(NEW.stripe_charges_enabled, false)
       OR COALESCE(NEW.stripe_payouts_enabled, false)
       OR NEW.siret IS NOT NULL
       OR NEW.vat_number IS NOT NULL
       OR NEW.legal_name IS NOT NULL
       OR NEW.legal_address IS NOT NULL
    THEN
      RAISE EXCEPTION 'support_session_forbidden: champs argent/identité légale à la création en mode support'
        USING ERRCODE = 'P0403';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.owner_id                  IS DISTINCT FROM OLD.owner_id
     OR NEW.stripe_account_id      IS DISTINCT FROM OLD.stripe_account_id
     OR NEW.stripe_onboarding_complete IS DISTINCT FROM OLD.stripe_onboarding_complete
     OR NEW.stripe_charges_enabled IS DISTINCT FROM OLD.stripe_charges_enabled
     OR NEW.stripe_payouts_enabled IS DISTINCT FROM OLD.stripe_payouts_enabled
     OR NEW.invoice_prefix         IS DISTINCT FROM OLD.invoice_prefix
     OR NEW.siret                  IS DISTINCT FROM OLD.siret
     OR NEW.vat_number             IS DISTINCT FROM OLD.vat_number
     OR NEW.legal_name             IS DISTINCT FROM OLD.legal_name
     OR NEW.legal_address          IS DISTINCT FROM OLD.legal_address
  THEN
    RAISE EXCEPTION 'support_session_forbidden: colonne argent/identité de venues en mode support'
      USING ERRCODE = 'P0403';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_block_venue_sensitive ON public.venues;
CREATE TRIGGER trg_support_block_venue_sensitive
  BEFORE INSERT OR UPDATE OR DELETE ON public.venues
  FOR EACH ROW EXECUTE FUNCTION public.block_support_sensitive_venue_write();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Escalade de rôle : user_roles, profile_type, venue_id.
--
-- `sync_organizer_role_from_profile` dérive un rôle de `profiles.profile_type`,
-- que rien n'empêchait d'écrire. Et `user_roles` n'avait aucune garde, alors
-- que plusieurs RPC SECURITY DEFINER y écrivent.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_support_block_user_roles ON public.user_roles;
CREATE TRIGGER trg_support_block_user_roles
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.block_support_session_write();

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
     -- profile_type alimente sync_organizer_role_from_profile : l'écrire, c'est
     -- se donner un rôle. venue_id rattache un compte à un club.
     OR NEW.profile_type                IS DISTINCT FROM OLD.profile_type
     OR NEW.venue_id                    IS DISTINCT FROM OLD.venue_id
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Règlement des tables en co-soirée : même nature d'argent que le cycle
--    promoteur, aucune garde jusqu'ici.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_support_block_collab_settlements ON public.collab_table_settlements;
CREATE TRIGGER trg_support_block_collab_settlements
  BEFORE INSERT OR UPDATE OR DELETE ON public.collab_table_settlements
  FOR EACH ROW EXECUTE FUNCTION public.block_support_session_write();

DROP TRIGGER IF EXISTS trg_support_block_collab_settlement_items ON public.collab_table_settlement_items;
CREATE TRIGGER trg_support_block_collab_settlement_items
  BEFORE INSERT OR UPDATE OR DELETE ON public.collab_table_settlement_items
  FOR EACH ROW EXECUTE FUNCTION public.block_support_session_write();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. email_change_requests : faille PRÉEXISTANTE, indépendante du support.
--
-- La policy INSERT client laissait n'importe quel utilisateur créer sa propre
-- demande avec `status = 'pending_new_verification'` et le `new_email` de son
-- choix, lire le `token` via la policy SELECT, puis appeler l'action `verify`
-- (verify_jwt = false) qui applique le changement en service_role. Autrement
-- dit : changer son email de connexion sans AUCUNE vérification, ce que le
-- flux en deux temps est précisément censé empêcher — et une porte de sortie
-- toute trouvée pour une session support.
--
-- L'edge function `email-change` insère elle-même en service_role (action
-- `request`) : la policy client est du code mort. Le front ne lit jamais cette
-- table (vérifié : aucune référence hors types générés).
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can create their own email change requests" ON public.email_change_requests;
DROP POLICY IF EXISTS "Users can view their own email change requests" ON public.email_change_requests;

REVOKE INSERT, UPDATE, DELETE ON public.email_change_requests FROM authenticated, anon;
