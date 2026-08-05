-- =====================================================================
-- Assigner un modèle de commission AGENCE à un promoteur / un groupe.
--
-- Pose promoters.default_commission_template_id sur le modèle agence choisi :
-- c'est ce que record_promoter_conversion résout ensuite (paliers/bonus/fenêtres/
-- ticket/table + commission GL par tête). Le modèle SUPERSÈDE les colonnes de
-- commission plates du promoteur (le moteur préfère le template résolu). La
-- couche plafonds agence (agency_rule_templates) continue de s'appliquer par-dessus.
--
-- Pas d'appel à sync_promoter_guestlist_parts : un promoteur d'agence reçoit ses
-- PLACES guest list via l'enveloppe (garde 20260730092000), pas via le modèle ;
-- seule la commission PAR TÊTE du modèle est lue à la porte.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.assign_agency_commission_template(
  p_template_id uuid,
  p_target_type text,   -- 'promoter' | 'group'
  p_target_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_agency_id uuid;
  v_count integer := 0;
BEGIN
  -- Le modèle DOIT être scopé à une agence dont l'appelant est le chef.
  SELECT agency_id INTO v_agency_id FROM public.commission_templates WHERE id = p_template_id;
  IF v_agency_id IS NULL THEN
    RAISE EXCEPTION 'Modèle de commission agence introuvable';
  END IF;
  IF NOT public.is_agency_owner(auth.uid(), v_agency_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_target_type = 'promoter' THEN
    UPDATE public.promoters SET default_commission_template_id = p_template_id
      WHERE id = p_target_id AND agency_id = v_agency_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSIF p_target_type = 'group' THEN
    UPDATE public.promoters SET default_commission_template_id = p_template_id
      WHERE agency_group_id = p_target_id AND agency_id = v_agency_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'Invalid target_type: %', p_target_type;
  END IF;

  RETURN json_build_object('applied_to', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_agency_commission_template(uuid, text, uuid) TO authenticated;

-- Retirer le modèle (revenir aux colonnes plates). Ne touche QUE si le modèle
-- courant est bien un modèle de CETTE agence (jamais un template club).
CREATE OR REPLACE FUNCTION public.clear_agency_commission_template(
  p_agency_id uuid,
  p_target_type text,
  p_target_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF NOT public.is_agency_owner(auth.uid(), p_agency_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_target_type = 'promoter' THEN
    UPDATE public.promoters SET default_commission_template_id = NULL
      WHERE id = p_target_id AND agency_id = p_agency_id
        AND default_commission_template_id IN (
          SELECT id FROM public.commission_templates WHERE agency_id = p_agency_id);
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSIF p_target_type = 'group' THEN
    UPDATE public.promoters SET default_commission_template_id = NULL
      WHERE agency_group_id = p_target_id AND agency_id = p_agency_id
        AND default_commission_template_id IN (
          SELECT id FROM public.commission_templates WHERE agency_id = p_agency_id);
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'Invalid target_type: %', p_target_type;
  END IF;

  RETURN json_build_object('cleared', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_agency_commission_template(uuid, text, uuid) TO authenticated;
