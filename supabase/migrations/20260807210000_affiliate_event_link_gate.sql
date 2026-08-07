-- ============================================================================
-- Verrou plateforme : une soirée affiliée SANS lien billetterie n'est JAMAIS
-- publiée. Sur Yuno (explore, linktree, page RP, agenda, recherche, carte),
-- il n'y a que des soirées avec un vrai lien.
--
-- Règles, appliquées en base pour être incontournables (formulaire, admin,
-- générateur récurrent, scripts — tous les chemins d'écriture) :
--   1. Lien absent  -> statut forcé à 'draft' (insert comme update).
--   2. Lien ajouté ou remplacé -> publication immédiate ('published' ;
--      une soirée déjà 'featured' garde sa mise à la une).
--   3. Lien inchangé -> le statut demandé est respecté (dépublier à la main
--      une soirée qui garde son lien reste possible ; épingler aussi).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_affiliate_event_link_gate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Pas de lien => jamais en ligne.
  IF NEW.external_ticket_url IS NULL THEN
    IF NEW.status IN ('published', 'featured') THEN
      NEW.status := 'draft';
    END IF;
    RETURN NEW;
  END IF;

  -- Lien ajouté ou remplacé => publication immédiate.
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('published', 'featured') THEN
      NEW.status := 'published';
    END IF;
  ELSIF NEW.external_ticket_url IS DISTINCT FROM OLD.external_ticket_url THEN
    IF NEW.status <> 'featured' THEN
      NEW.status := 'published';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_affiliate_event_link_gate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_affiliate_events_link_gate ON public.affiliate_events;
CREATE TRIGGER trg_affiliate_events_link_gate
  BEFORE INSERT OR UPDATE ON public.affiliate_events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_affiliate_event_link_gate();
