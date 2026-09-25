-- Trois fonctions SQL cassées, trouvées le 2026-09-25 par plpgsql_check
-- (rejoué dans une transaction annulée : `db lint` n'atteint pas la base
-- depuis le cloud). plpgsql ne résout les appels qu'à l'exécution : aucune ne
-- levait à la création, toutes levaient au premier appel.

-- 1. is_organizer_profile a disparu de la base (même histoire que
--    is_direct_client_write, restaurée en 20260921130000). Le trigger
--    guard_organizer_profile_insert (20260924140000) l'appelle : toute
--    création de page publique d'organisateur côté client levait 42883,
--    y compris l'étape « Page publique » de l'onboarding organisateur.
--    Corps repris de 20260421150210.
CREATE OR REPLACE FUNCTION public.is_organizer_profile(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = _user_id
      AND p.profile_type = 'organizer'
  )
  OR public.has_role(_user_id, 'organizer'::public.app_role)
$$;

REVOKE ALL ON FUNCTION public.is_organizer_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_organizer_profile(uuid) TO authenticated, service_role;

-- 2. generate_invoice_number existait en deux versions : (text) et
--    (text DEFAULT NULL, uuid DEFAULT NULL). Tout appel à un seul argument
--    était ambigu (PGRST203 / 42725) : le reçu d'une commande de boissons
--    (OrderConfirmation) tombait sur un numéro de repli, et
--    backfill_missing_invoices levait. La version à deux arguments fait
--    exactement la même chose pour un club : on garde celle-là.
DROP FUNCTION IF EXISTS public.generate_invoice_number(text);

-- 3. Mot de passe de maintenance : pgcrypto vit dans le schéma `extensions`,
--    hors du search_path de ces fonctions — digest(), crypt() et gen_salt()
--    étaient introuvables. Le mot de passe ne pouvait être ni posé ni
--    vérifié. Le hachage passe en bcrypt (le format que la vérification
--    attend déjà) ; l'ancien SHA-256 reste lu puis converti.
CREATE OR REPLACE FUNCTION public.hash_maintenance_password(password text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN extensions.crypt(password, extensions.gen_salt('bf', 10));
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_maintenance_password(plain text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  stored text;
  legacy_hex text;
BEGIN
  IF plain IS NULL OR length(plain) = 0 OR length(plain) > 200 THEN
    RETURN false;
  END IF;

  SELECT maintenance_password_hash INTO stored
  FROM public.app_settings
  WHERE id = 'global';

  IF stored IS NULL OR length(stored) = 0 THEN
    RETURN false;
  END IF;

  -- bcrypt : $2a$, $2b$ ou $2y$
  IF stored LIKE '$2_$%' THEN
    RETURN extensions.crypt(plain, stored) = stored;
  END IF;

  -- Ancien SHA-256 hex non salé : vérifié, puis converti en bcrypt.
  legacy_hex := encode(extensions.digest(plain, 'sha256'), 'hex');
  IF legacy_hex = stored THEN
    UPDATE public.app_settings
    SET maintenance_password_hash = extensions.crypt(plain, extensions.gen_salt('bf', 10)),
        updated_at = now()
    WHERE id = 'global';
    RETURN true;
  END IF;

  RETURN false;
END;
$$;
