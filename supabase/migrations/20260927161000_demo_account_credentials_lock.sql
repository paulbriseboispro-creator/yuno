-- Comptes démo : identifiants GELÉS (2026-09-27).
--
-- Les comptes @womber.fr sont partagés : Paul, l'agent, le reviewer Apple et
-- chaque prospect d'un lien d'aperçu y ont une session. GoTrue laisse toute
-- session récente (< 24 h) changer le mot de passe SANS réauthentification :
-- un prospect pouvait donc, avec le jeton de son lien, poser SON mot de passe
-- sur owner@womber.fr — tous les liens démo et demo-login tombaient
-- (signInWithPassword sur DEMO_LOGIN_PASSWORD), et il repartait avec une
-- session propre, non marquée « aperçu », donc en écriture. Idem pour
-- l'activation d'une 2FA TOTP, qui verrouillait le compte à sa place.
--
-- Ces écritures passent par GoTrue (rôle supabase_auth_admin, sans claims
-- JWT) : impossible de distinguer une session d'une autre. La règle est donc
-- posée sur le COMPTE (@womber.fr seulement — les comptes vitrine d'un
-- prospect et les comptes supprimés ne sont pas partagés), pour tout le monde :
--   • auth.users : email, mot de passe, téléphone et demandes de changement
--     sont RÉTABLIS en silence (pas d'exception : une réécriture technique de
--     GoTrue — rehash au login — ne doit jamais faire échouer une connexion ;
--     le mot de passe inchangé se vérifie toujours) ;
--   • auth.mfa_factors : aucun nouveau facteur sur un compte démo (les comptes
--     démo passent par le contournement MFA de demoSession.ts, jamais par un
--     facteur).
-- Rotation volontaire du mot de passe démo (déconseillée, cf. CLAUDE.md) :
-- dans une session SQL, `SET LOCAL yuno.demo_credentials_unlock = 'on'` puis
-- l'UPDATE — l'API admin GoTrue ne peut pas poser ce réglage.

CREATE OR REPLACE FUNCTION public.freeze_demo_account_credentials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(coalesce(OLD.email, '')) NOT LIKE '%@womber.fr' THEN
    RETURN NEW;
  END IF;
  IF coalesce(current_setting('yuno.demo_credentials_unlock', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  NEW.email              := OLD.email;
  NEW.encrypted_password := OLD.encrypted_password;
  NEW.phone              := OLD.phone;
  NEW.email_change       := OLD.email_change;
  NEW.email_change_token_new     := OLD.email_change_token_new;
  NEW.email_change_token_current := OLD.email_change_token_current;
  NEW.phone_change       := OLD.phone_change;
  NEW.phone_change_token := OLD.phone_change_token;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Une garde ne fait jamais échouer une connexion.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS freeze_demo_account_credentials ON auth.users;
CREATE TRIGGER freeze_demo_account_credentials
  BEFORE UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.freeze_demo_account_credentials();

CREATE OR REPLACE FUNCTION public.block_demo_account_mfa_factor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = NEW.user_id;
  IF lower(coalesce(v_email, '')) LIKE '%@womber.fr'
     AND coalesce(current_setting('yuno.demo_credentials_unlock', true), '') <> 'on' THEN
    RAISE EXCEPTION 'demo_account_locked' USING ERRCODE = '42501',
      HINT = 'Les comptes démo sont partagés : aucune double authentification ne s''y active.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS block_demo_account_mfa_factor ON auth.mfa_factors;
CREATE TRIGGER block_demo_account_mfa_factor
  BEFORE INSERT ON auth.mfa_factors
  FOR EACH ROW
  EXECUTE FUNCTION public.block_demo_account_mfa_factor();
