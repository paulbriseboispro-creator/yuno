-- =====================================================================
-- Commission templates scopés AGENCE — parité du moteur de rémunération owner.
--
-- Le cœur argent (record_promoter_conversion) résout le modèle par FK
-- (promoters.default_commission_template_id / assignment.commission_template_id)
-- SANS filtre de scope, puis applique la couche plafonds agence par-dessus.
-- Donner à un promoteur d'agence un commission_templates scopé AGENCE lui offre
-- donc paliers, bonus, fenêtres horaires et commission guest list PAR TÊTE
-- GRATUITEMENT — zéro ligne changée dans le code argent.
--
-- agency_rule_templates (plafonds/permissions) reste distinct : c'est la couche
-- agence-spécifique. Un modèle de commission riche est assigné via
-- assign_agency_commission_template (20260730121000) qui pose default_commission_template_id.
-- =====================================================================

ALTER TABLE public.commission_templates
  ADD COLUMN IF NOT EXISTS agency_id uuid REFERENCES public.agencies(id) ON DELETE CASCADE;

-- XOR à 3 : un modèle appartient à UN scope (club, organisateur OU agence).
-- Les lignes existantes ont déjà exactement un scope ⇒ aucune ne viole le nouveau XOR.
ALTER TABLE public.commission_templates DROP CONSTRAINT IF EXISTS commission_templates_context_check;
ALTER TABLE public.commission_templates
  ADD CONSTRAINT commission_templates_context_check
  CHECK ((venue_id IS NOT NULL)::int + (organizer_user_id IS NOT NULL)::int + (agency_id IS NOT NULL)::int = 1);

CREATE INDEX IF NOT EXISTS idx_commission_templates_agency
  ON public.commission_templates(agency_id) WHERE agency_id IS NOT NULL;

-- RLS additive : le chef d'agence gère ses modèles ; ses promoteurs les lisent.
-- (Le moteur argent lit en SECURITY DEFINER, indépendant de ces policies.)
DROP POLICY IF EXISTS "Agency owner manages own commission templates" ON public.commission_templates;
CREATE POLICY "Agency owner manages own commission templates"
  ON public.commission_templates FOR ALL TO authenticated
  USING (agency_id IS NOT NULL AND public.is_agency_owner(auth.uid(), agency_id))
  WITH CHECK (agency_id IS NOT NULL AND public.is_agency_owner(auth.uid(), agency_id));

DROP POLICY IF EXISTS "Agency promoters view agency commission templates" ON public.commission_templates;
CREATE POLICY "Agency promoters view agency commission templates"
  ON public.commission_templates FOR SELECT TO authenticated
  USING (agency_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.promoters p
    WHERE p.agency_id = commission_templates.agency_id AND p.user_id = auth.uid()
  ));

COMMENT ON COLUMN public.commission_templates.agency_id IS
  'Modèle de commission scopé agence (rémunération riche : paliers/bonus/fenêtres/commission GL par tête). Résolu tel quel par record_promoter_conversion via default_commission_template_id.';
