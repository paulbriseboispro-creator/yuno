-- ============================================================================
-- Synchronisation d'identité : `agencies` est le profil MAÎTRE de l'entité
-- fusionnée. Quand le chef d'agence modifie son profil, le bras externe
-- (ligne `affiliates` liée) suit — le linktree public /p/:slug et les pages
-- soirées/clubs externes affichent donc toujours la même identité.
--
-- Sens unique agencies → affiliates : pas de trigger inverse (pas de
-- ping-pong possible). Les champs propres au bras externe (linktree_slug,
-- tracking_prefix, commission_rate, réglages linktree) ne sont pas touchés.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_affiliate_identity_from_agency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE affiliates SET
    name       = NEW.name,
    city       = NEW.city,
    avatar_url = NEW.logo_url,
    bio        = NEW.bio,
    website    = NEW.website_url,
    whatsapp   = NEW.whatsapp_number,
    is_active  = NEW.is_active
  WHERE agency_id = NEW.id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- La synchro d'identité ne doit jamais faire échouer la mise à jour du profil.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agencies_sync_affiliate_identity ON public.agencies;
CREATE TRIGGER trg_agencies_sync_affiliate_identity
  AFTER UPDATE OF name, city, logo_url, bio, website_url, whatsapp_number, is_active
  ON public.agencies
  FOR EACH ROW EXECUTE FUNCTION public.sync_affiliate_identity_from_agency();
