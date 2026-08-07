-- ============================================================================
-- Lien billetterie posé à la main sur une occurrence récurrente = il prime.
--
-- Contexte (bug prod 2026-08-07) : le générateur d'occurrences récurrentes
-- (create-affiliate-recurring-events) resynchronise à chaque passage le lien
-- de chaque occurrence depuis publication_url du modèle. Conséquence : un RP
-- qui corrigeait le lien SUR la soirée (et pas sur le modèle) voyait sa
-- correction silencieusement re-écrasée par le cron — des soirées d'août
-- sont restées en ligne avec des liens Fourvenues d'éditions de juin finies.
--
-- Correctif : ticket_url_overridden marque qu'un humain a posé le lien de
-- cette occurrence. Le trigger le pose automatiquement quand un client
-- authentifié (cockpit) modifie external_ticket_url d'une occurrence liée à
-- un modèle ; vider le lien rend la main au modèle. Le générateur (service
-- role) ne déclenche pas le marquage et respecte le flag côté Deno.
-- ============================================================================

ALTER TABLE public.affiliate_events
  ADD COLUMN IF NOT EXISTS ticket_url_overridden boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.affiliate_events.ticket_url_overridden IS
  'true = lien billetterie posé à la main sur cette occurrence : le cron de synchro des modèles récurrents ne touche plus ni son lien ni son statut.';

-- SECURITY INVOKER (défaut) obligatoire : le trigger discrimine sur
-- current_user ; en SECURITY DEFINER il tournerait sous son propriétaire et
-- ne verrait jamais le rôle réel du writer (cf. gardes promoteur).
CREATE OR REPLACE FUNCTION public.mark_affiliate_event_ticket_override()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.recurring_template_id IS NOT NULL
     AND NEW.external_ticket_url IS DISTINCT FROM OLD.external_ticket_url
     AND current_user = 'authenticated' THEN
    -- Lien posé à la main → l'occurrence sort du pilotage du modèle.
    -- Lien vidé à la main → l'occurrence rend la main au modèle.
    NEW.ticket_url_overridden := (NEW.external_ticket_url IS NOT NULL);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_affiliate_event_ticket_override() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_affiliate_events_ticket_override ON public.affiliate_events;
CREATE TRIGGER trg_affiliate_events_ticket_override
  BEFORE UPDATE OF external_ticket_url ON public.affiliate_events
  FOR EACH ROW EXECUTE FUNCTION public.mark_affiliate_event_ticket_override();
