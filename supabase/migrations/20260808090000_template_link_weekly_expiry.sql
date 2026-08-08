-- ============================================================================
-- Expiration hebdomadaire des liens billetterie de modèles récurrents.
--
-- Contexte (bug prod 2026-08-08) : Fourvenues & co créent une page PAR
-- ÉDITION — un lien de billetterie posé sur un modèle récurrent est donc
-- périssable par construction. Le générateur le recopiait indéfiniment sur
-- chaque nouvelle occurrence : des soirées d'août en ligne renvoyaient vers
-- des éditions de juin « déjà terminées ». La vérification HTTP est
-- impossible (Fourvenues répond 403 aux requêtes serveur), donc la règle est
-- déterministe :
--   - un lien de modèle ne vaut que pour la première occurrence qui suit sa
--     pose (fenêtre d'un cycle hebdomadaire), puis il expire — l'occurrence
--     suivante reste en brouillon jusqu'au nouveau lien ;
--   - sauf si le RP coche « lien permanent » (page récurrente stable).
--
-- Les liens déjà en base n'ont pas de date de pose (set_at NULL) : ils sont
-- considérés périmés — le prochain passage du générateur dépublie et nettoie
-- les occurrences qui les portent (via la porte « pas de lien = brouillon »).
-- ============================================================================

ALTER TABLE public.affiliate_recurring_templates
  ADD COLUMN IF NOT EXISTS publication_url_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS publication_url_is_permanent boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.affiliate_recurring_templates.publication_url_set_at IS
  'Horodatage de la dernière pose du lien billetterie. NULL = lien hérité, considéré périmé. Posé automatiquement par trigger à chaque changement de publication_url.';
COMMENT ON COLUMN public.affiliate_recurring_templates.publication_url_is_permanent IS
  'true = page billetterie permanente (valable toutes les semaines) : le lien n''expire jamais. false (défaut) = lien d''édition, valable un seul cycle hebdomadaire.';

CREATE OR REPLACE FUNCTION public.stamp_template_publication_url()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.publication_url IS NOT NULL THEN
      NEW.publication_url_set_at := now();
    END IF;
  ELSIF NEW.publication_url IS DISTINCT FROM OLD.publication_url THEN
    NEW.publication_url_set_at := CASE WHEN NEW.publication_url IS NULL THEN NULL ELSE now() END;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_template_publication_url() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_templates_stamp_publication_url ON public.affiliate_recurring_templates;
CREATE TRIGGER trg_templates_stamp_publication_url
  BEFORE INSERT OR UPDATE ON public.affiliate_recurring_templates
  FOR EACH ROW EXECUTE FUNCTION public.stamp_template_publication_url();
