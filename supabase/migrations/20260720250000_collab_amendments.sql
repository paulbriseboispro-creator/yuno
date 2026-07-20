-- =============================================================================
-- AVENANTS aux contrats de collaboration — renégocier sans casser la preuve.
--
-- BESOIN (Paul) : la répartition des tâches doit figurer sur le contrat signé,
-- et rester modifiable par LES DEUX parties, avec une nouvelle signature.
-- « Sécurisé, avec de la souplesse opérationnelle. »
--
-- Aujourd'hui, changer quoi que ce soit à un contrat vivant impose de le
-- RÉSILIER et d'en proposer un neuf. Sur une résidence c'est brutal : on jette
-- le contrat-cadre, donc l'historique d'engagement, pour déplacer un domaine.
--
-- PRINCIPE — on ne réécrit JAMAIS un contrat signé. L'avenant est une ligne
-- séparée qui s'empile dessus : il porte l'état AVANT (prev_*), l'état APRÈS,
-- qui l'a proposé, et les deux signatures électroniques avec horodatage, IP et
-- user-agent — les mêmes preuves que le contrat d'origine (eIDAS simple).
-- Tant qu'il n'est pas contresigné, RIEN ne change : l'ancienne répartition
-- reste en vigueur. Pas d'état intermédiaire flou.
--
-- L'ARGENT — un avenant peut aussi déplacer le partage des revenus. Deux
-- garde-fous repris de l'existant, pas inventés ici :
--   • Les boissons restent 100 % club tant que l'organisateur n'a pas attesté
--     sa licence d'alcool (même règle que create_event_collab_contract).
--   • Une soirée DÉJÀ VENDUE garde son partage. Le balayage du contrat-cadre
--     (20260626140000) exclut déjà les occurrences verrouillées « gardent leurs
--     termes figés » ; on suit cette convention plutôt que de laisser une même
--     soirée vendre à deux partages différents. Les responsabilités, elles, ne
--     touchent pas à l'argent : elles s'appliquent à toutes les dates à venir.
-- =============================================================================

-- 1. Table ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_collab_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Exactement UNE cible : un contrat d'occurrence OU un contrat-cadre.
  contract_id        uuid REFERENCES public.event_collab_contracts(id) ON DELETE CASCADE,
  series_contract_id uuid REFERENCES public.event_collab_series_contracts(id) ON DELETE CASCADE,
  CONSTRAINT event_collab_amendments_one_target
    CHECK ((contract_id IS NOT NULL) <> (series_contract_id IS NOT NULL)),

  venue_id          text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  status text NOT NULL DEFAULT 'pending_signatures'
    CHECK (status IN ('pending_signatures','active','cancelled')),

  -- Contenu de l'avenant. NULL = ce volet reste inchangé.
  responsibilities jsonb,
  split_rules      jsonb,
  CONSTRAINT event_collab_amendments_not_empty
    CHECK (responsibilities IS NOT NULL OR split_rules IS NOT NULL),

  -- État AVANT, figé à la proposition : c'est ce qui rend le delta opposable
  -- même si le contrat bouge par ailleurs.
  prev_responsibilities jsonb,
  prev_split_rules      jsonb,

  reason       text,
  proposed_by  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  terms_snapshot jsonb,          -- figé à la double signature
  effective_at   timestamptz,    -- posé à la double signature

  venue_signed_at timestamptz, venue_signed_by uuid,
  venue_signed_ip text, venue_signed_user_agent text,
  org_signed_at   timestamptz, org_signed_by uuid,
  org_signed_ip   text, org_signed_user_agent text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Un seul avenant EN ATTENTE par contrat. Index PARTIEL, jamais une contrainte
-- UNIQUE de colonne : c'est très exactement le piège qui a fait exploser
-- « duplicate key ... template_id_key » sur les contrats-cadres résiliés
-- (cf. 20260720210000). L'historique des avenants signés doit pouvoir s'empiler.
CREATE UNIQUE INDEX IF NOT EXISTS event_collab_amendments_live_contract_idx
  ON public.event_collab_amendments (contract_id)
  WHERE contract_id IS NOT NULL AND status = 'pending_signatures';
CREATE UNIQUE INDEX IF NOT EXISTS event_collab_amendments_live_series_idx
  ON public.event_collab_amendments (series_contract_id)
  WHERE series_contract_id IS NOT NULL AND status = 'pending_signatures';

CREATE INDEX IF NOT EXISTS event_collab_amendments_venue_idx
  ON public.event_collab_amendments (venue_id, status);
CREATE INDEX IF NOT EXISTS event_collab_amendments_org_idx
  ON public.event_collab_amendments (organizer_user_id, status);

ALTER TABLE public.event_collab_amendments ENABLE ROW LEVEL SECURITY;

-- Les deux parties LISENT. Toutes les écritures passent par les RPC ci-dessous :
-- une signature qu'un client pourrait poser lui-même ne vaut rien comme preuve.
DROP POLICY IF EXISTS event_collab_amendments_party_select ON public.event_collab_amendments;
CREATE POLICY event_collab_amendments_party_select ON public.event_collab_amendments
  FOR SELECT TO authenticated USING (
    organizer_user_id = auth.uid()
    OR proposed_by = auth.uid()
    OR public.is_venue_owner(auth.uid(), venue_id)
  );
DROP POLICY IF EXISTS event_collab_amendments_admin_all ON public.event_collab_amendments;
CREATE POLICY event_collab_amendments_admin_all ON public.event_collab_amendments
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP TRIGGER IF EXISTS trg_event_collab_amendments_updated_at ON public.event_collab_amendments;
CREATE TRIGGER trg_event_collab_amendments_updated_at
  BEFORE UPDATE ON public.event_collab_amendments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Boissons : la licence d'alcool prime, ici comme ailleurs -------------------
-- Extrait en fonction pour que l'avenant applique EXACTEMENT la même règle que
-- create_event_collab_contract et create_event_collab_series_contract. Trois
-- copies de la règle finissent toujours par diverger.
CREATE OR REPLACE FUNCTION public.enforce_drinks_alcohol_gate(p_rules jsonb, p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_alcohol boolean;
BEGIN
  IF p_rules IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(can_sell_alcohol, false) INTO v_alcohol
  FROM public.organizer_profiles WHERE user_id = p_org_id;
  IF NOT COALESCE(v_alcohol, false) OR NOT (p_rules ? 'drinks') THEN
    RETURN jsonb_set(p_rules, '{drinks}', jsonb_build_object('organizer_pct', 0, 'venue_pct', 100));
  END IF;
  RETURN p_rules;
END; $$;

-- 3. Proposer un avenant -------------------------------------------------------
-- Symétrique : le club comme l'organisateur peuvent proposer. Le proposant
-- pré-signe (même mécanique que les contrats), l'autre partie contresigne.
CREATE OR REPLACE FUNCTION public.propose_collab_amendment(
  p_contract_id        uuid DEFAULT NULL,
  p_series_contract_id uuid DEFAULT NULL,
  p_responsibilities   jsonb DEFAULT NULL,
  p_split_rules        jsonb DEFAULT NULL,
  p_reason             text DEFAULT NULL,
  p_ip                 text DEFAULT NULL,
  p_user_agent         text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_venue_id  text;
  v_org_id    uuid;
  v_status    text;
  v_prev_resp jsonb;
  v_prev_split jsonb;
  v_is_venue  boolean;
  v_is_org    boolean;
  v_split     jsonb;
  v_id        uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF (p_contract_id IS NOT NULL) = (p_series_contract_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Cible invalide : un contrat d''occurrence OU un contrat-cadre';
  END IF;
  IF p_responsibilities IS NULL AND p_split_rules IS NULL THEN
    RAISE EXCEPTION 'Un avenant doit changer au moins une chose';
  END IF;

  IF p_contract_id IS NOT NULL THEN
    SELECT venue_id, organizer_user_id, status, responsibilities, split_rules
      INTO v_venue_id, v_org_id, v_status, v_prev_resp, v_prev_split
      FROM public.event_collab_contracts WHERE id = p_contract_id;
  ELSE
    SELECT venue_id, organizer_user_id, status, responsibilities, split_rules
      INTO v_venue_id, v_org_id, v_status, v_prev_resp, v_prev_split
      FROM public.event_collab_series_contracts WHERE id = p_series_contract_id;
  END IF;
  IF v_venue_id IS NULL THEN RAISE EXCEPTION 'Contrat introuvable'; END IF;

  -- On n'amende que ce qui EXISTE et ENGAGE. Un contrat encore en attente de
  -- signature se modifie en le refusant et en le re-proposant ; un contrat
  -- résilié ou clos ne lie plus personne.
  --
  -- 'locked' est ACCEPTÉ : c'est le statut d'une occurrence dont les ventes ont
  -- commencé (trigger de 20260622220000). Y interdire l'avenant reviendrait à
  -- geler les responsabilités dès le premier billet vendu — or déplacer la main
  -- sur l'affiche d'une soirée qui vend est précisément le cas où la souplesse
  -- sert. Le partage, lui, ne bougera pas sur cette soirée : apply_ ne réécrit
  -- revenue_split_rules que si split_locked_at IS NULL.
  IF v_status NOT IN ('active','locked') THEN
    RAISE EXCEPTION 'Seul un contrat en vigueur peut recevoir un avenant (statut=%)', v_status;
  END IF;

  v_is_venue := public.is_venue_owner(auth.uid(), v_venue_id);
  v_is_org   := (v_org_id = auth.uid());
  IF NOT (v_is_venue OR v_is_org) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.event_collab_amendments a
     WHERE a.status = 'pending_signatures'
       AND (a.contract_id = p_contract_id OR a.series_contract_id = p_series_contract_id)
  ) THEN
    RAISE EXCEPTION 'Un avenant est déjà en attente de signature sur ce contrat';
  END IF;

  -- Un avenant sur l'ARGENT visant une soirée unique déjà vendue ne s'appliquerait
  -- à rien (apply_ respecte split_locked_at). Le refuser ici plutôt que de le
  -- laisser signer dans le vide : faire contresigner un document sans effet est
  -- pire que de refuser, ça donne aux deux parties une preuve de rien.
  IF p_split_rules IS NOT NULL AND p_contract_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.event_collab_contracts c
      JOIN public.events e ON e.id = c.event_id
      WHERE c.id = p_contract_id AND e.split_locked_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Les ventes de cette soirée ont commencé : le partage des revenus ne peut plus changer'
        USING HINT = 'Un avenant sur la répartition des responsabilités reste possible.';
    END IF;
  END IF;

  v_split := public.enforce_drinks_alcohol_gate(p_split_rules, v_org_id);

  INSERT INTO public.event_collab_amendments (
    contract_id, series_contract_id, venue_id, organizer_user_id,
    status, responsibilities, split_rules,
    prev_responsibilities, prev_split_rules, reason, proposed_by,
    venue_signed_at, venue_signed_by, venue_signed_ip, venue_signed_user_agent,
    org_signed_at, org_signed_by, org_signed_ip, org_signed_user_agent
  ) VALUES (
    p_contract_id, p_series_contract_id, v_venue_id, v_org_id,
    'pending_signatures', p_responsibilities, v_split,
    v_prev_resp, v_prev_split, p_reason, auth.uid(),
    CASE WHEN v_is_venue THEN now() END, CASE WHEN v_is_venue THEN auth.uid() END,
    CASE WHEN v_is_venue THEN p_ip END, CASE WHEN v_is_venue THEN p_user_agent END,
    CASE WHEN v_is_org THEN now() END, CASE WHEN v_is_org THEN auth.uid() END,
    CASE WHEN v_is_org THEN p_ip END, CASE WHEN v_is_org THEN p_user_agent END
  ) RETURNING id INTO v_id;

  RETURN v_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.propose_collab_amendment(uuid, uuid, jsonb, jsonb, text, text, text) TO authenticated;

-- 4. Signer un avenant ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sign_collab_amendment(
  p_amendment_id  uuid,
  p_ip            text DEFAULT NULL,
  p_user_agent    text DEFAULT NULL,
  p_terms_version text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  a          public.event_collab_amendments%ROWTYPE;
  v_is_venue boolean;
  v_is_org   boolean;
BEGIN
  SELECT * INTO a FROM public.event_collab_amendments WHERE id = p_amendment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Avenant introuvable'; END IF;
  IF a.status <> 'pending_signatures' THEN
    RAISE EXCEPTION 'Cet avenant n''attend pas de signature (statut=%)', a.status;
  END IF;

  v_is_venue := public.is_venue_owner(auth.uid(), a.venue_id);
  v_is_org   := (a.organizer_user_id = auth.uid());
  IF NOT (v_is_venue OR v_is_org) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF v_is_venue THEN
    UPDATE public.event_collab_amendments
       SET venue_signed_at = COALESCE(venue_signed_at, now()),
           venue_signed_by = COALESCE(venue_signed_by, auth.uid()),
           venue_signed_ip = COALESCE(venue_signed_ip, p_ip),
           venue_signed_user_agent = COALESCE(venue_signed_user_agent, p_user_agent)
     WHERE id = p_amendment_id;
  ELSE
    UPDATE public.event_collab_amendments
       SET org_signed_at = COALESCE(org_signed_at, now()),
           org_signed_by = COALESCE(org_signed_by, auth.uid()),
           org_signed_ip = COALESCE(org_signed_ip, p_ip),
           org_signed_user_agent = COALESCE(org_signed_user_agent, p_user_agent)
     WHERE id = p_amendment_id;
  END IF;

  SELECT * INTO a FROM public.event_collab_amendments WHERE id = p_amendment_id;
  IF a.venue_signed_at IS NULL OR a.org_signed_at IS NULL THEN
    RETURN 'pending_signatures';
  END IF;

  -- Double signature → l'avenant prend effet et se fige.
  UPDATE public.event_collab_amendments
     SET status = 'active',
         effective_at = now(),
         terms_snapshot = jsonb_build_object(
           'responsibilities', a.responsibilities,
           'split_rules', a.split_rules,
           'prev_responsibilities', a.prev_responsibilities,
           'prev_split_rules', a.prev_split_rules,
           'reason', a.reason,
           'proposed_by', a.proposed_by,
           'venue_signed_at', a.venue_signed_at,
           'org_signed_at', a.org_signed_at,
           'terms_version', p_terms_version,
           'frozen_at', now()
         )
   WHERE id = p_amendment_id;

  PERFORM public.apply_collab_amendment(p_amendment_id);
  RETURN 'active';
END; $$;

GRANT EXECUTE ON FUNCTION public.sign_collab_amendment(uuid, text, text, text) TO authenticated;

-- 5. Application ---------------------------------------------------------------
-- Séparée de la signature pour rester relisable : c'est ici que vivent les deux
-- règles de portée (soirée vendue, dates à venir), pas noyées dans la mécanique
-- de signature.
CREATE OR REPLACE FUNCTION public.apply_collab_amendment(p_amendment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a         public.event_collab_amendments%ROWTYPE;
  v_event   uuid;
  v_template uuid;
BEGIN
  SELECT * INTO a FROM public.event_collab_amendments WHERE id = p_amendment_id;
  IF NOT FOUND OR a.status <> 'active' THEN RETURN; END IF;

  -- ── Cas 1 : avenant sur une soirée unique ──────────────────────────────────
  IF a.contract_id IS NOT NULL THEN
    UPDATE public.event_collab_contracts
       SET responsibilities = COALESCE(a.responsibilities, responsibilities),
           split_rules      = COALESCE(a.split_rules, split_rules)
     WHERE id = a.contract_id
     RETURNING event_id INTO v_event;

    IF v_event IS NULL THEN RETURN; END IF;

    -- Responsabilités : aucun impact sur l'argent déjà encaissé, on applique.
    IF a.responsibilities IS NOT NULL THEN
      UPDATE public.events SET collab_responsibilities = a.responsibilities WHERE id = v_event;
    END IF;

    -- Partage : seulement si la soirée n'a pas encore vendu. Une soirée
    -- verrouillée garde les termes sous lesquels le public a acheté.
    IF a.split_rules IS NOT NULL THEN
      UPDATE public.events SET revenue_split_rules = a.split_rules
       WHERE id = v_event AND split_locked_at IS NULL;
    END IF;
    RETURN;
  END IF;

  -- ── Cas 2 : avenant sur un contrat-cadre (résidence) ───────────────────────
  UPDATE public.event_collab_series_contracts
     SET responsibilities = COALESCE(a.responsibilities, responsibilities),
         split_rules      = COALESCE(a.split_rules, split_rules)
   WHERE id = a.series_contract_id
   RETURNING template_id INTO v_template;

  IF v_template IS NULL THEN RETURN; END IF;

  -- La série elle-même, pour que les dates PAS ENCORE générées naissent aux
  -- nouvelles conditions (generate_recurring_events lit le template).
  UPDATE public.owner_recurring_templates
     SET collab_responsibilities = COALESCE(a.responsibilities, collab_responsibilities),
         revenue_split_rules     = COALESCE(a.split_rules, revenue_split_rules)
   WHERE id = v_template;

  IF a.responsibilities IS NOT NULL THEN
    UPDATE public.events
       SET collab_responsibilities = a.responsibilities
     WHERE recurring_template_id = v_template
       AND partner_organizer_id = a.organizer_user_id
       AND start_at > now();

    UPDATE public.event_collab_contracts oc
       SET responsibilities = a.responsibilities
      FROM public.events e
     WHERE oc.event_id = e.id
       AND e.recurring_template_id = v_template
       AND e.partner_organizer_id = a.organizer_user_id
       AND e.start_at > now();
  END IF;

  IF a.split_rules IS NOT NULL THEN
    UPDATE public.events
       SET revenue_split_rules = a.split_rules
     WHERE recurring_template_id = v_template
       AND partner_organizer_id = a.organizer_user_id
       AND start_at > now()
       AND split_locked_at IS NULL;

    UPDATE public.event_collab_contracts oc
       SET split_rules = a.split_rules
      FROM public.events e
     WHERE oc.event_id = e.id
       AND e.recurring_template_id = v_template
       AND e.partner_organizer_id = a.organizer_user_id
       AND e.start_at > now()
       AND e.split_locked_at IS NULL;
  END IF;
END; $$;

-- 6. Retirer un avenant non contresigné ----------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_collab_amendment(p_amendment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a public.event_collab_amendments%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.event_collab_amendments WHERE id = p_amendment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Avenant introuvable'; END IF;
  IF a.status <> 'pending_signatures' THEN
    RAISE EXCEPTION 'Un avenant déjà en vigueur ne s''annule pas : proposez-en un nouveau';
  END IF;
  IF NOT (public.is_venue_owner(auth.uid(), a.venue_id) OR a.organizer_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  UPDATE public.event_collab_amendments SET status = 'cancelled' WHERE id = p_amendment_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.cancel_collab_amendment(uuid) TO authenticated;
