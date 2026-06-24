-- =====================================================================
-- Offre BDE (Bureaux Des Étudiants) — étape 1/3 : flag de vérification
-- =====================================================================
-- Un BDE n'est PAS un nouveau rôle : c'est un compte `organizer` standard
-- auquel un super admin attribue manuellement le flag `bde_verified`. Le flag
-- débloque deux leviers (gérés dans les migrations 2 et 3) :
--   • plancher de commission réduit (0,49€ au lieu de 0,99€ sur billets/tables) ;
--   • soirées privées par défaut + validation super admin avant publication publique.
-- Tant qu'aucun organisateur n'est `bde_verified`, ce lot est dormant : rien ne
-- change pour les comptes existants.

ALTER TABLE public.organizer_profiles
  ADD COLUMN IF NOT EXISTS bde_verified    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bde_verified_at timestamptz;

COMMENT ON COLUMN public.organizer_profiles.bde_verified IS
  'Compte BDE (Bureau Des Étudiants) validé manuellement par un super admin. Débloque le plancher de commission réduit (0,49€) et la confidentialité par défaut des soirées.';

-- ---------------------------------------------------------------------
-- RPC admin : attribuer / retirer le statut BDE (calqué sur admin_set_dj_verified)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_organizer_bde_verified(
  p_organizer_user_id uuid,
  p_verified          boolean,
  p_reason            text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  UPDATE public.organizer_profiles
  SET bde_verified    = p_verified,
      bde_verified_at = CASE WHEN p_verified THEN now() ELSE NULL END
  WHERE user_id = p_organizer_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organizer not found: %', p_organizer_user_id;
  END IF;

  PERFORM public.log_admin_action(
    CASE WHEN p_verified THEN 'organizer_bde_verified' ELSE 'organizer_bde_unverified' END,
    'organizer', p_organizer_user_id::text, jsonb_build_object('reason', p_reason)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_organizer_bde_verified(uuid, boolean, text) TO authenticated;
