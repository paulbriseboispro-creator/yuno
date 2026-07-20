-- =============================================================================
-- Partenariat club ↔ organisateur : une répartition des responsabilités par
-- défaut, calquée sur `default_split_rules`.
--
-- CONSTAT (Paul) : le partenariat porte déjà les conditions FINANCIÈRES par
-- défaut (default_split_rules), pré-remplies à chaque nouvelle collaboration.
-- Le symétrique manquait pour les responsabilités : un club qui travaille
-- toujours de la même façon avec un organisateur — « lui le design, moi
-- l'opérationnel » — devait refaire le réglage à CHAQUE soirée et à CHAQUE
-- série. La question se règle désormais une fois, au niveau de la relation.
--
-- CE QUE CE DÉFAUT N'EST PAS : un engagement. Comme default_split_rules, il ne
-- lie personne — il alimente la proposition, et c'est la SIGNATURE du contrat
-- qui engage. C'est pourquoi il se modifie directement, sans le flux de
-- proposition/acceptation que l'argent impose : changer une préférence de
-- pré-remplissage ne change aucun contrat déjà signé.
--
-- Chaîne de résolution, du plus précis au plus général :
--   1. ce que le formulaire envoie (p_responsibilities)
--   2. ce que porte la série (owner_recurring_templates.collab_responsibilities)
--   3. le défaut du partenariat  ← nouveau
--   4. le préréglage du mode (default_collab_responsibilities), via NULL
-- =============================================================================

ALTER TABLE public.venue_organizer_partnerships
  ADD COLUMN IF NOT EXISTS default_responsibilities jsonb;

COMMENT ON COLUMN public.venue_organizer_partnerships.default_responsibilities IS
  'Répartition par défaut des domaines pour ce partenariat : {"design":"organizer","operations":"venue"}. Pré-remplit les nouvelles collaborations ; n''engage rien tant qu''un contrat n''est pas signé. NULL = préréglage du mode.';

-- 1. Soirée unique : le défaut du partenariat complète le payload -------------
CREATE OR REPLACE FUNCTION public.create_event_collab_contract(
  p_event_id           uuid,
  p_split_rules        jsonb DEFAULT NULL,
  p_cancellation_policy text DEFAULT 'pro_rata_refund',
  p_responsibilities   jsonb DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_venue_id   text;
  v_org_id     uuid;
  v_is_venue   boolean;
  v_is_org     boolean;
  v_rules      jsonb;
  v_partnership uuid;
  v_part_resp  jsonb;
  v_resp       jsonb;
  v_id         uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_cancellation_policy NOT IN ('pro_rata_refund','no_refund_after_event') THEN
    RAISE EXCEPTION 'Invalid cancellation policy';
  END IF;

  SELECT venue_id, organizer_user_id INTO v_venue_id, v_org_id
  FROM public.collab_event_parties(p_event_id);
  IF v_venue_id IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'Cet évènement n''est pas une collaboration club ↔ organisateur';
  END IF;

  v_is_venue := public.is_venue_owner(auth.uid(), v_venue_id);
  v_is_org   := (v_org_id = auth.uid());
  IF NOT (v_is_venue OR v_is_org) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF EXISTS (SELECT 1 FROM public.event_collab_contracts c
              WHERE c.event_id = p_event_id AND c.status <> 'cancelled') THEN
    RAISE EXCEPTION 'Un contrat existe déjà pour cette soirée';
  END IF;

  SELECT id, default_split_rules, default_responsibilities
    INTO v_partnership, v_rules, v_part_resp
  FROM public.venue_organizer_partnerships
  WHERE venue_id = v_venue_id AND organizer_user_id = v_org_id AND status = 'active'
  LIMIT 1;

  v_rules := COALESCE(p_split_rules, v_rules, jsonb_build_object(
    'tickets', jsonb_build_object('organizer_pct', 50, 'venue_pct', 50),
    'tables',  jsonb_build_object('organizer_pct', 0,  'venue_pct', 100),
    'drinks',  jsonb_build_object('organizer_pct', 0,  'venue_pct', 100)
  ));
  v_rules := public.enforce_drinks_alcohol_gate(v_rules, v_org_id);

  -- Le payload d'abord, le défaut du partenariat ensuite. NULL reste légal :
  -- c'est le préréglage du mode qui s'applique alors.
  v_resp := COALESCE(p_responsibilities, v_part_resp);

  INSERT INTO public.event_collab_contracts (
    event_id, partnership_id, venue_id, organizer_user_id, created_by,
    status, split_rules, cancellation_policy, auto_release_at, responsibilities,
    venue_signed_at, venue_signed_by, org_signed_at, org_signed_by
  ) VALUES (
    p_event_id, v_partnership, v_venue_id, v_org_id, auth.uid(),
    'pending_signatures', v_rules, p_cancellation_policy,
    (SELECT COALESCE(end_at, start_at) + interval '2 days' FROM public.events WHERE id = p_event_id),
    v_resp,
    CASE WHEN v_is_venue THEN now() END, CASE WHEN v_is_venue THEN auth.uid() END,
    CASE WHEN v_is_org   THEN now() END, CASE WHEN v_is_org   THEN auth.uid() END
  ) RETURNING id INTO v_id;

  UPDATE public.events
     SET revenue_split_proposal = v_rules,
         split_proposed_by = auth.uid(),
         split_proposed_at = now(),
         split_approved_by_venue = v_is_venue,
         split_approved_by_organizer = v_is_org,
         collab_responsibilities = COALESCE(v_resp, collab_responsibilities)
   WHERE id = p_event_id;

  RETURN v_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.create_event_collab_contract(uuid, jsonb, text, jsonb) TO authenticated;

-- 2. Série récurrente : même chaîne, avec la série au milieu -------------------
CREATE OR REPLACE FUNCTION public.create_event_collab_series_contract(
  p_template_id        uuid,
  p_split_rules        jsonb DEFAULT NULL,
  p_cancellation_policy text DEFAULT 'pro_rata_refund',
  p_responsibilities   jsonb DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  tpl          public.owner_recurring_templates%ROWTYPE;
  v_venue_id   text;
  v_org_id     uuid;
  v_is_venue   boolean;
  v_is_org     boolean;
  v_rules      jsonb;
  v_part_resp  jsonb;
  v_resp       jsonb;
  v_partnership uuid;
  v_id         uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_cancellation_policy NOT IN ('pro_rata_refund','no_refund_after_event') THEN
    RAISE EXCEPTION 'Invalid cancellation policy';
  END IF;

  SELECT * INTO tpl FROM public.owner_recurring_templates WHERE id = p_template_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Template introuvable'; END IF;

  v_venue_id := tpl.venue_id;
  v_org_id   := tpl.partner_organizer_id;
  IF v_venue_id IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'Ce template n''est pas une collaboration récurrente club ↔ organisateur';
  END IF;

  v_is_venue := public.is_venue_owner(auth.uid(), v_venue_id);
  v_is_org   := (v_org_id = auth.uid());
  IF NOT (v_is_venue OR v_is_org) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF EXISTS (SELECT 1 FROM public.event_collab_series_contracts s
              WHERE s.template_id = p_template_id AND s.status NOT IN ('cancelled','terminated')) THEN
    RAISE EXCEPTION 'Un contrat-cadre existe déjà pour cette série';
  END IF;

  SELECT id, default_split_rules, default_responsibilities
    INTO v_partnership, v_rules, v_part_resp
  FROM public.venue_organizer_partnerships
  WHERE venue_id = v_venue_id AND organizer_user_id = v_org_id AND status = 'active'
  LIMIT 1;

  v_rules := COALESCE(p_split_rules, tpl.revenue_split_rules, v_rules, jsonb_build_object(
    'tickets', jsonb_build_object('organizer_pct', 50, 'venue_pct', 50),
    'tables',  jsonb_build_object('organizer_pct', 0,  'venue_pct', 100),
    'drinks',  jsonb_build_object('organizer_pct', 0,  'venue_pct', 100)
  ));
  v_rules := public.enforce_drinks_alcohol_gate(v_rules, v_org_id);

  v_resp := COALESCE(p_responsibilities, tpl.collab_responsibilities, v_part_resp);

  INSERT INTO public.event_collab_series_contracts (
    template_id, partnership_id, venue_id, organizer_user_id, created_by,
    status, split_rules, cancellation_policy, responsibilities,
    venue_signed_at, venue_signed_by, org_signed_at, org_signed_by
  ) VALUES (
    p_template_id, v_partnership, v_venue_id, v_org_id, auth.uid(),
    'pending_signatures', v_rules, p_cancellation_policy, v_resp,
    CASE WHEN v_is_venue THEN now() END, CASE WHEN v_is_venue THEN auth.uid() END,
    CASE WHEN v_is_org   THEN now() END, CASE WHEN v_is_org   THEN auth.uid() END
  ) RETURNING id INTO v_id;

  RETURN v_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.create_event_collab_series_contract(uuid, jsonb, text, jsonb) TO authenticated;
