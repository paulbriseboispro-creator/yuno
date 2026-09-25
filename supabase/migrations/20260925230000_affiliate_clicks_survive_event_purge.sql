-- ============================================================================
-- Les clics d'une agence survivent à la suppression de la soirée.
--
-- Constaté le 2026-09-25 sur Mad by Night : les visites remontent au 6 juin,
-- le plus vieux clic au 6 août. affiliate_clicks.affiliate_event_id était en
-- ON DELETE CASCADE, et « Purger les soirées passées » (AffiliateEvents.tsx)
-- supprime les soirées : chaque purge effaçait l'historique des clics
-- billetterie — le chiffre même que l'agence montre aux clubs. Les visites,
-- elles, étaient déjà en SET NULL (144 sessions « page soirée » orphelines).
--
-- Désormais :
--   1. la FK passe en ON DELETE SET NULL (comme les visites) ;
--   2. avant la suppression, le club de la soirée est recopié sur ses clics qui
--      n'en portaient pas : le clic reste attribué au club (Rapport club,
--      analytics par club) ;
--   3. la règle « un clic vise une soirée OU un club » ne vaut plus qu'à
--      l'INSERTION (trigger) : un clic historique dont la soirée ET le club ont
--      disparu reste un clic compté, pas une suppression refusée.
-- Les clics déjà perdus ne se récupèrent pas.
-- ============================================================================

ALTER TABLE public.affiliate_clicks DROP CONSTRAINT IF EXISTS affiliate_clicks_target_check;

CREATE OR REPLACE FUNCTION public.affiliate_clicks_require_target()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.affiliate_event_id IS NULL AND NEW.affiliate_venue_id IS NULL THEN
    RAISE EXCEPTION 'affiliate click needs an event or a venue' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.affiliate_clicks_require_target() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_affiliate_clicks_require_target ON public.affiliate_clicks;
CREATE TRIGGER trg_affiliate_clicks_require_target
  BEFORE INSERT ON public.affiliate_clicks
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_clicks_require_target();

-- SECURITY DEFINER : affiliate_clicks n'a aucune policy UPDATE (écritures
-- anonymes en INSERT seulement) ; sous le rôle de l'agence qui supprime sa
-- soirée, la recopie ne toucherait aucune ligne. Portée : les clics de CETTE
-- soirée, rien d'autre.
CREATE OR REPLACE FUNCTION public.affiliate_event_keep_clicks_venue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.affiliate_venue_id IS NOT NULL THEN
    UPDATE public.affiliate_clicks
       SET affiliate_venue_id = OLD.affiliate_venue_id
     WHERE affiliate_event_id = OLD.id
       AND affiliate_venue_id IS NULL;
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.affiliate_event_keep_clicks_venue() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_affiliate_event_keep_clicks_venue ON public.affiliate_events;
CREATE TRIGGER trg_affiliate_event_keep_clicks_venue
  BEFORE DELETE ON public.affiliate_events
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_event_keep_clicks_venue();

ALTER TABLE public.affiliate_clicks DROP CONSTRAINT IF EXISTS affiliate_clicks_affiliate_event_id_fkey;
ALTER TABLE public.affiliate_clicks
  ADD CONSTRAINT affiliate_clicks_affiliate_event_id_fkey
  FOREIGN KEY (affiliate_event_id) REFERENCES public.affiliate_events(id) ON DELETE SET NULL;
