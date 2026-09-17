-- ============================================================================
-- L'écran Audience en UN aller-retour — 2026-09-17
-- ============================================================================
--
-- L'écran Audience de l'Email Studio montrait la segmentation intelligente de
-- la base (les segments enregistrés) et les préréglages Yuno en SIX appels
-- lancés ensemble : `get_contact_intelligence_overview` (segments) plus un
-- `count_contact_segment_def` par préréglage, plus le seuil de panier.
--
-- Chacun de ces appels reconstruit la MÊME table temporaire `_cr` — la base
-- vivante, fichier importé ∪ clients venus par Yuno. Sur une base de 12 000
-- contacts cette construction coûte ~2,5 s à elle seule (les comptages qui
-- suivent coûtent 0,17 s pour 24 segments) : l'écran demandait donc ~15 s de
-- travail à la base pour afficher une liste, en parallèle, alors que le rôle
-- `authenticated` est coupé à 8 s par requête. Quand la vue d'ensemble perdait
-- la course, elle était annulée, le front n'a jamais lu l'erreur et la section
-- « Segments intelligents » DISPARAISSAIT — un segment déjà ciblé par la
-- campagne affichait alors 0 destinataire.
--
-- D'où cette fonction : une construction de `_cr`, tous les comptages dessus.
-- Elle rend ce que l'écran Audience affiche, et rien d'autre (pas les listes,
-- pas l'engagement, pas les bilans de campagne, pas l'analyse) — la vue
-- d'ensemble complète reste pour la page Base de contacts.
--
-- Les préréglages Yuno arrivent du front (`yunoSegmentPresets`), avec leur
-- seuil de panier déjà appliqué : `[{ "key": "...", "definition": {...} }]`.
-- La portée plateforme n'en a pas et passe un tableau vide.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_contact_segment_panel(
  p_venue_id          text,
  p_organizer_user_id uuid,
  p_presets           jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_contacts integer := 0;
  v_segments jsonb := '[]'::jsonb;
  v_presets  jsonb := '[]'::jsonb;
  v_seg      record;
  v_preset   jsonb;
  v_n integer; v_e integer; v_p integer;
BEGIN
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- La base vivante, construite UNE fois pour tous les comptages ci-dessous.
  v_contacts := public.contact_build_rows(p_venue_id, p_organizer_user_id);

  -- 1. Les segments enregistrés de la portée (même forme que la vue
  --    d'ensemble : le front lit `counts.emails`, le nombre réellement
  --    joignable, qui est celui que le pro obtiendra à l'envoi).
  FOR v_seg IN
    SELECT cs.* FROM public.contact_segments cs
     WHERE public.marketing_scope_match(cs.venue_id, cs.organizer_user_id, p_venue_id, p_organizer_user_id)
     ORDER BY cs.created_at DESC
  LOOP
    EXECUTE format(
      'SELECT count(*), count(*) FILTER (WHERE c.email_ok), count(*) FILTER (WHERE c.phone_ok) FROM _cr c WHERE %s',
      public.contact_definition_predicate(v_seg.definition, 'c'))
      INTO v_n, v_e, v_p;
    v_segments := v_segments || jsonb_build_object(
      'id', v_seg.id, 'name', v_seg.name, 'description', v_seg.description,
      'definition', v_seg.definition, 'origin', v_seg.origin,
      'suggestion_key', v_seg.suggestion_key, 'created_at', v_seg.created_at,
      'counts', jsonb_build_object('contacts', COALESCE(v_n, 0), 'emails', COALESCE(v_e, 0), 'phones', COALESCE(v_p, 0)));
  END LOOP;

  -- 2. Les préréglages Yuno, comptés sur la même table.
  FOR v_preset IN SELECT value FROM jsonb_array_elements(COALESCE(p_presets, '[]'::jsonb))
  LOOP
    CONTINUE WHEN COALESCE(v_preset->>'key', '') = '' OR v_preset->'definition' IS NULL;
    EXECUTE format(
      'SELECT count(*), count(*) FILTER (WHERE c.email_ok), count(*) FILTER (WHERE c.phone_ok) FROM _cr c WHERE %s',
      public.contact_definition_predicate(v_preset->'definition', 'c'))
      INTO v_n, v_e, v_p;
    v_presets := v_presets || jsonb_build_object(
      'key', v_preset->>'key',
      'counts', jsonb_build_object('contacts', COALESCE(v_n, 0), 'emails', COALESCE(v_e, 0), 'phones', COALESCE(v_p, 0)));
  END LOOP;

  DROP TABLE IF EXISTS _cr;

  RETURN jsonb_build_object(
    'contacts', COALESCE(v_contacts, 0),
    'segments', v_segments,
    'presets', v_presets);
END;
$$;

REVOKE ALL ON FUNCTION public.get_contact_segment_panel(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contact_segment_panel(text, uuid, jsonb) TO authenticated, service_role;
