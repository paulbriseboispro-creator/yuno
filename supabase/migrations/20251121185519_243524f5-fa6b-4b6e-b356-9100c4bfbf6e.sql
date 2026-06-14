-- Ajouter les colonnes MFA à la table profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS mfa_enabled boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS mfa_enforced boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS mfa_verified_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS mfa_recovery_codes text[];

-- Table pour stocker temporairement les secrets TOTP en cours de setup (TTL 15 min)
CREATE TABLE IF NOT EXISTS public.mfa_pending (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  secret text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Index pour nettoyer automatiquement les secrets expirés
CREATE INDEX IF NOT EXISTS idx_mfa_pending_created_at ON public.mfa_pending(created_at);

-- Table pour stocker les secrets TOTP chiffrés (production)
CREATE TABLE IF NOT EXISTS public.mfa_secrets (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  secret_encrypted text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table pour les codes de récupération (hashés)
CREATE TABLE IF NOT EXISTS public.mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  code_hash text NOT NULL,
  used boolean DEFAULT false NOT NULL,
  used_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mfa_recovery_codes_user_id ON public.mfa_recovery_codes(user_id);

-- Table pour les logs de sécurité
CREATE TABLE IF NOT EXISTS public.security_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  ip_address text,
  user_agent text,
  success boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_security_logs_user_id ON public.security_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_security_logs_created_at ON public.security_logs(created_at);

-- Activer RLS sur toutes les nouvelles tables
ALTER TABLE public.mfa_pending ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfa_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies pour mfa_pending (jamais accessible depuis le client)
CREATE POLICY "No client access to mfa_pending" ON public.mfa_pending FOR ALL USING (false);

-- RLS Policies pour mfa_secrets (jamais accessible depuis le client)
CREATE POLICY "No client access to mfa_secrets" ON public.mfa_secrets FOR ALL USING (false);

-- RLS Policies pour mfa_recovery_codes (jamais accessible depuis le client)
CREATE POLICY "No client access to mfa_recovery_codes" ON public.mfa_recovery_codes FOR ALL USING (false);

-- RLS Policies pour security_logs (lecture seule pour l'utilisateur concerné)
CREATE POLICY "Users can view their own security logs" ON public.security_logs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Owners can view all security logs" ON public.security_logs
  FOR SELECT USING (has_role(auth.uid(), 'owner'::app_role));

-- Trigger pour forcer mfa_enforced=true pour les owners
CREATE OR REPLACE FUNCTION public.enforce_mfa_for_owners()
RETURNS TRIGGER AS $$
BEGIN
  -- Si l'utilisateur a le rôle owner, forcer mfa_enforced=true
  IF EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = NEW.id AND role = 'owner'::app_role
  ) THEN
    UPDATE public.profiles 
    SET mfa_enforced = true 
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER enforce_owner_mfa
  AFTER INSERT ON public.user_roles
  FOR EACH ROW
  WHEN (NEW.role = 'owner'::app_role)
  EXECUTE FUNCTION public.enforce_mfa_for_owners();

-- Fonction pour nettoyer les secrets MFA pending expirés (>15 min)
CREATE OR REPLACE FUNCTION public.cleanup_expired_mfa_pending()
RETURNS void AS $$
BEGIN
  DELETE FROM public.mfa_pending
  WHERE created_at < now() - interval '15 minutes';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;