-- ============================================================================
-- Titre et affiche posés à la main sur UNE occurrence récurrente = ils priment.
--
-- Contexte (2026-09-28) : le RP ouvre une soirée depuis « Cette semaine » ou
-- la page Soirées (crayon → /affiliate/events/:id/edit), change son titre ou
-- son affiche pour CETTE date seulement… et le générateur
-- (create-affiliate-recurring-events, cron quotidien + chaque enregistrement
-- de modèle) recopiait l'affiche du modèle par-dessus au passage suivant. Le
-- titre, lui, se faisait écraser par le report « appliquer à toutes les
-- soirées » du formulaire de modèle.
--
-- Même modèle que ticket_url_overridden : un drapeau par champ, posé par
-- trigger, respecté par le générateur (affiche) et par le report (titre).
-- La règle est une COMPARAISON au modèle, pas un test de rôle : une valeur
-- égale à celle du modèle rend la main au modèle, une valeur différente la
-- garde. Donc le générateur (qui écrit la valeur du modèle) et le report
-- (idem) ne marquent jamais rien, et vider l'affiche d'une occurrence la
-- remet sur celle du modèle.
-- ============================================================================

ALTER TABLE public.affiliate_events
  ADD COLUMN IF NOT EXISTS name_overridden  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flyer_overridden boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.affiliate_events.name_overridden IS
  'true = titre de cette occurrence différent de celui de son modèle récurrent : le report des changements du modèle ne le touche plus.';
COMMENT ON COLUMN public.affiliate_events.flyer_overridden IS
  'true = affiche posée à la main sur cette occurrence : le générateur des modèles récurrents ne la resynchronise plus. Vider l''affiche rend la main au modèle.';

-- Ce n'est PAS un trigger de garde (il ne discrimine sur aucun rôle) : il
-- dérive un drapeau d'une comparaison. SECURITY DEFINER pour lire le modèle
-- quelle que soit la RLS de l'écrivain.
CREATE OR REPLACE FUNCTION public.mark_affiliate_event_template_overrides()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tpl_name  text;
  v_tpl_flyer text;
BEGIN
  IF NEW.recurring_template_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.name IS NOT DISTINCT FROM OLD.name
     AND NEW.flyer_url IS NOT DISTINCT FROM OLD.flyer_url THEN
    RETURN NEW;
  END IF;

  SELECT t.name, t.flyer_url INTO v_tpl_name, v_tpl_flyer
  FROM public.affiliate_recurring_templates t
  WHERE t.id = NEW.recurring_template_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.name IS DISTINCT FROM OLD.name THEN
    NEW.name_overridden := NEW.name IS DISTINCT FROM v_tpl_name;
  END IF;
  IF NEW.flyer_url IS DISTINCT FROM OLD.flyer_url THEN
    NEW.flyer_overridden := NEW.flyer_url IS NOT NULL
                            AND NEW.flyer_url IS DISTINCT FROM v_tpl_flyer;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Un drapeau de confort ne doit jamais faire échouer l'enregistrement.
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_affiliate_event_template_overrides() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_affiliate_events_template_overrides ON public.affiliate_events;
CREATE TRIGGER trg_affiliate_events_template_overrides
  BEFORE UPDATE OF name, flyer_url ON public.affiliate_events
  FOR EACH ROW EXECUTE FUNCTION public.mark_affiliate_event_template_overrides();

-- Rattrapage : les occurrences à venir qui portent DÉJÀ un titre ou une
-- affiche différents de leur modèle (personnalisées depuis le dernier passage
-- du générateur) sont protégées dès maintenant.
UPDATE public.affiliate_events e
SET name_overridden  = (e.name IS DISTINCT FROM t.name),
    flyer_overridden = (e.flyer_url IS NOT NULL AND e.flyer_url IS DISTINCT FROM t.flyer_url)
FROM public.affiliate_recurring_templates t
WHERE e.recurring_template_id = t.id
  AND e.event_date >= (now() AT TIME ZONE 'Europe/Paris')::date - 1
  AND (e.name IS DISTINCT FROM t.name
       OR (e.flyer_url IS NOT NULL AND e.flyer_url IS DISTINCT FROM t.flyer_url));
