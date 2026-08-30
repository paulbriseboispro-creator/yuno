-- ============================================================================
-- Garde support d'organizer_profiles : plus de faux positif sur l'UPSERT.
--
-- Vécu en session réelle (édition photo/ville/bio du profil d'un orga assisté) :
-- « support_session_forbidden: champs légaux/financiers ». Le pro n'avait rien
-- touché de légal. Cause : la page enregistre via UPSERT, et un
-- INSERT ... ON CONFLICT passe D'ABORD par le trigger BEFORE INSERT — dont la
-- branche INSERT exigeait des champs légaux VIDES. Dès que le profil existant
-- portait une valeur légale (ou une attestation alcool/mineurs déjà cochée par
-- le client), TOUTE sauvegarde mourait, même purement visuelle.
--
-- Correctifs, sans rien céder sur le fond :
--   1. Branche INSERT : si le profil existe déjà, cet INSERT est la première
--      moitié d'un upsert — on laisse passer, c'est la branche UPDATE
--      (déclenchée ensuite par ON CONFLICT DO UPDATE) qui juge le VRAI diff.
--      La création d'un profil neuf garde l'exigence de champs légaux vides.
--   2. Branche UPDATE : comparaisons normalisées (NULLIF/btrim pour les textes,
--      COALESCE(false) pour les booléens) — un aller-retour de formulaire
--      ('' vs NULL, espaces) n'est pas un « changement ».
--
-- Ce qui reste interdit en session support, comme avant : tout CHANGEMENT réel
-- de billing_email, siret, vat_number, legal_name, legal_address,
-- absorb_yuno_fees, attestation alcool, régime mineurs, statut BDE — et le
-- DELETE du profil.
-- ============================================================================

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
    -- Upsert sur un profil existant : ce n'est pas une création. Le diff réel
    -- sera jugé juste après par la branche UPDATE (ON CONFLICT DO UPDATE).
    IF EXISTS (SELECT 1 FROM public.organizer_profiles op WHERE op.user_id = NEW.user_id) THEN
      RETURN NEW;
    END IF;
    -- Création véritable : légitime en mode assisté tant que les champs
    -- légaux/financiers restent vides.
    IF NULLIF(btrim(COALESCE(NEW.billing_email, '')), '') IS NOT NULL
       OR NULLIF(btrim(COALESCE(NEW.siret, '')), '') IS NOT NULL
       OR NULLIF(btrim(COALESCE(NEW.vat_number, '')), '') IS NOT NULL
       OR NULLIF(btrim(COALESCE(NEW.legal_name, '')), '') IS NOT NULL
       OR NULLIF(btrim(COALESCE(NEW.legal_address, '')), '') IS NOT NULL
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

  -- UPDATE : seul un CHANGEMENT réel d'un champ légal/financier bloque.
  IF NULLIF(btrim(COALESCE(NEW.billing_email, '')), '') IS DISTINCT FROM NULLIF(btrim(COALESCE(OLD.billing_email, '')), '')
     OR NULLIF(btrim(COALESCE(NEW.siret, '')), '')       IS DISTINCT FROM NULLIF(btrim(COALESCE(OLD.siret, '')), '')
     OR NULLIF(btrim(COALESCE(NEW.vat_number, '')), '')  IS DISTINCT FROM NULLIF(btrim(COALESCE(OLD.vat_number, '')), '')
     OR NULLIF(btrim(COALESCE(NEW.legal_name, '')), '')  IS DISTINCT FROM NULLIF(btrim(COALESCE(OLD.legal_name, '')), '')
     OR NULLIF(btrim(COALESCE(NEW.legal_address, '')), '') IS DISTINCT FROM NULLIF(btrim(COALESCE(OLD.legal_address, '')), '')
     OR COALESCE(NEW.absorb_yuno_fees, false) IS DISTINCT FROM COALESCE(OLD.absorb_yuno_fees, false)
     OR COALESCE(NEW.can_sell_alcohol, false) IS DISTINCT FROM COALESCE(OLD.can_sell_alcohol, false)
     OR NEW.can_sell_alcohol_confirmed_at IS DISTINCT FROM OLD.can_sell_alcohol_confirmed_at
     OR COALESCE(NEW.minors_allowed, false) IS DISTINCT FROM COALESCE(OLD.minors_allowed, false)
     OR NULLIF(btrim(COALESCE(NEW.minor_auth_doc_url, '')), '')  IS DISTINCT FROM NULLIF(btrim(COALESCE(OLD.minor_auth_doc_url, '')), '')
     OR NULLIF(btrim(COALESCE(NEW.minor_auth_doc_name, '')), '') IS DISTINCT FROM NULLIF(btrim(COALESCE(OLD.minor_auth_doc_name, '')), '')
     OR COALESCE(NEW.bde_verified, false) IS DISTINCT FROM COALESCE(OLD.bde_verified, false)
     OR NEW.bde_verified_at IS DISTINCT FROM OLD.bde_verified_at
  THEN
    RAISE EXCEPTION 'support_session_forbidden: champs légaux/financiers d''organizer_profiles en mode support'
      USING ERRCODE = 'P0403';
  END IF;

  RETURN NEW;
END;
$$;
