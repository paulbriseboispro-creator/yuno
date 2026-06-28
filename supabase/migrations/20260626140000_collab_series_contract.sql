-- =============================================================================
-- Contrat-cadre RÉCURRENT pour co-soirées (résidences club ↔ organisateur).
--
-- PROBLÈME : une co-soirée récurrente génère UNE occurrence par date, et CHAQUE
-- occurrence crée son propre event_collab_contracts que l'organisateur doit signer
-- une par une. Chaque vendredi arrive en « proposition à valider » et bloque la
-- billetterie (CONTRACT GUARD) tant qu'elle n'est pas signée. Le commentaire de
-- 20260623150000 annonçait déjà ce P1 : « un consentement permanent au niveau du
-- partenariat ».
--
-- SOLUTION : un CONTRAT-CADRE (framework agreement) signé UNE FOIS au niveau du
-- template récurrent. La signature électronique (eIDAS simple) engage les deux
-- parties sur les mêmes conditions de partage pour TOUTES les occurrences de la
-- série, présentes et à venir. Chaque occurrence reçoit un event_collab_contracts
-- « actif » dérivé du cadre (snapshot des termes + métadonnées de signature du
-- cadre + pointeur via_series), donc chaque soirée porte une preuve autonome.
-- Résiliable pour l'AVENIR ; les occurrences déjà ouvertes à la vente / tenues
-- restent régies par le cadre (cohérent avec l'immuabilité-à-la-vente existante).
--
-- Sécurité : toutes les ÉCRITURES passent par des RPC SECURITY DEFINER. RLS = LECTURE.
-- Aucune création rétroactive : opt-in only, on ne lie jamais deux parties sans
-- signature. Les séries en cours continuent par-occurrence jusqu'à la signature d'un
-- cadre.
-- =============================================================================

-- =============================================================================
-- 1. Table event_collab_series_contracts (1:1 avec un template récurrent co-event)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.event_collab_series_contracts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id        uuid NOT NULL UNIQUE REFERENCES public.owner_recurring_templates(id) ON DELETE CASCADE,
  partnership_id     uuid REFERENCES public.venue_organizer_partnerships(id) ON DELETE SET NULL,

  venue_id           text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by         uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,

  status             text NOT NULL DEFAULT 'pending_signatures' CHECK (status IN (
                       'draft','pending_signatures','active','terminated','cancelled')),
  currency           text NOT NULL DEFAULT 'eur',

  -- Le % convenu pour TOUTE la série { tickets:{organizer_pct,venue_pct}, tables, drinks }.
  split_rules        jsonb NOT NULL,
  cancellation_policy text NOT NULL DEFAULT 'pro_rata_refund'
                       CHECK (cancellation_policy IN ('pro_rata_refund','no_refund_after_event')),
  terms_snapshot     jsonb,                 -- figé à la signature complète (immuable)
  contract_pdf_url   text,

  -- signatures électroniques du contrat-cadre (clic + horodatage + IP + user-agent)
  venue_signed_at    timestamptz, venue_signed_by uuid, venue_signed_ip text, venue_signed_user_agent text,
  org_signed_at      timestamptz, org_signed_by  uuid, org_signed_ip  text, org_signed_user_agent  text,

  terminated_at      timestamptz, terminated_by uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_collab_series_contracts_venue_idx ON public.event_collab_series_contracts (venue_id, status);
CREATE INDEX IF NOT EXISTS event_collab_series_contracts_org_idx   ON public.event_collab_series_contracts (organizer_user_id, status);

ALTER TABLE public.event_collab_series_contracts ENABLE ROW LEVEL SECURITY;

-- 2 parties : LECTURE seulement (club owner + orga + créateur + admin). Écritures via RPC.
DROP POLICY IF EXISTS event_collab_series_party_select ON public.event_collab_series_contracts;
CREATE POLICY event_collab_series_party_select ON public.event_collab_series_contracts
  FOR SELECT TO authenticated USING (
    created_by = auth.uid()
    OR organizer_user_id = auth.uid()
    OR public.is_venue_owner(auth.uid(), venue_id)
  );
DROP POLICY IF EXISTS event_collab_series_admin_all ON public.event_collab_series_contracts;
CREATE POLICY event_collab_series_admin_all ON public.event_collab_series_contracts
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP TRIGGER IF EXISTS update_event_collab_series_contracts_updated_at ON public.event_collab_series_contracts;
CREATE TRIGGER update_event_collab_series_contracts_updated_at
  BEFORE UPDATE ON public.event_collab_series_contracts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- 2. RPC — création du contrat-cadre (club OU orga propose le %).
--    Le template récurrent co-event est club-led (venue_id + partner_organizer_id).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_event_collab_series_contract(
  p_template_id        uuid,
  p_split_rules        jsonb DEFAULT NULL,
  p_cancellation_policy text DEFAULT 'pro_rata_refund'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  tpl          public.owner_recurring_templates%ROWTYPE;
  v_venue_id   text;
  v_org_id     uuid;
  v_is_venue   boolean;
  v_is_org     boolean;
  v_rules      jsonb;
  v_partnership uuid;
  v_org_alcohol boolean;
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

  -- Un seul contrat-cadre vivant à la fois (un cadre résilié/annulé peut être re-proposé).
  IF EXISTS (SELECT 1 FROM public.event_collab_series_contracts s
              WHERE s.template_id = p_template_id AND s.status NOT IN ('cancelled','terminated')) THEN
    RAISE EXCEPTION 'Un contrat-cadre existe déjà pour cette série';
  END IF;

  -- Règles : payload OU règles du template OU défaut partenariat OU 50/50.
  SELECT id, default_split_rules INTO v_partnership, v_rules
  FROM public.venue_organizer_partnerships
  WHERE venue_id = v_venue_id AND organizer_user_id = v_org_id AND status = 'active'
  LIMIT 1;

  v_rules := COALESCE(p_split_rules, tpl.revenue_split_rules, v_rules, jsonb_build_object(
    'tickets', jsonb_build_object('organizer_pct', 50, 'venue_pct', 50),
    'tables',  jsonb_build_object('organizer_pct', 0,  'venue_pct', 100),
    'drinks',  jsonb_build_object('organizer_pct', 0,  'venue_pct', 100)
  ));

  -- Boissons : 100% club par défaut. Honorées telles que proposées UNIQUEMENT si
  -- l'orga a attesté ses documents légaux de vente d'alcool (cf. 20260623230000).
  SELECT COALESCE(can_sell_alcohol, false) INTO v_org_alcohol
  FROM public.organizer_profiles WHERE user_id = v_org_id;
  IF NOT COALESCE(v_org_alcohol, false) OR NOT (v_rules ? 'drinks') THEN
    v_rules := jsonb_set(v_rules, '{drinks}', jsonb_build_object('organizer_pct', 0, 'venue_pct', 100));
  END IF;

  INSERT INTO public.event_collab_series_contracts (
    template_id, partnership_id, venue_id, organizer_user_id, created_by,
    status, split_rules, cancellation_policy,
    venue_signed_at, venue_signed_by, org_signed_at, org_signed_by
  ) VALUES (
    p_template_id, v_partnership, v_venue_id, v_org_id, auth.uid(),
    'pending_signatures', v_rules, p_cancellation_policy,
    CASE WHEN v_is_venue THEN now() END, CASE WHEN v_is_venue THEN auth.uid() END,
    CASE WHEN v_is_org   THEN now() END, CASE WHEN v_is_org   THEN auth.uid() END
  ) RETURNING id INTO v_id;

  RETURN v_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.create_event_collab_series_contract(uuid, jsonb, text) TO authenticated;

-- =============================================================================
-- 3. RPC — signature du contrat-cadre (club OU orga ; rôle déduit de auth.uid()).
--    À la double signature → statut 'active', termes figés, ET BALAYAGE des
--    occurrences en attente (non vendues) pour les activer d'un coup.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.sign_event_collab_series_contract(
  p_contract_id   uuid,
  p_ip            text DEFAULT NULL,
  p_user_agent    text DEFAULT NULL,
  p_terms_version text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  c          public.event_collab_series_contracts%ROWTYPE;
  tpl        public.owner_recurring_templates%ROWTYPE;
  v_is_venue boolean;
  v_is_org   boolean;
  v_both     boolean;
BEGIN
  SELECT * INTO c FROM public.event_collab_series_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contract not found'; END IF;
  IF c.status <> 'pending_signatures' THEN
    RAISE EXCEPTION 'Le contrat-cadre n''attend pas de signature (statut=%)', c.status;
  END IF;

  v_is_venue := public.is_venue_owner(auth.uid(), c.venue_id);
  v_is_org   := (c.organizer_user_id = auth.uid());
  IF NOT (v_is_venue OR v_is_org) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF v_is_venue THEN
    UPDATE public.event_collab_series_contracts
       SET venue_signed_at = COALESCE(venue_signed_at, now()),
           venue_signed_by = COALESCE(venue_signed_by, auth.uid()),
           venue_signed_ip = COALESCE(venue_signed_ip, p_ip),
           venue_signed_user_agent = COALESCE(venue_signed_user_agent, p_user_agent)
     WHERE id = p_contract_id;
  ELSE
    UPDATE public.event_collab_series_contracts
       SET org_signed_at = COALESCE(org_signed_at, now()),
           org_signed_by = COALESCE(org_signed_by, auth.uid()),
           org_signed_ip = COALESCE(org_signed_ip, p_ip),
           org_signed_user_agent = COALESCE(org_signed_user_agent, p_user_agent)
     WHERE id = p_contract_id;
  END IF;

  SELECT * INTO c FROM public.event_collab_series_contracts WHERE id = p_contract_id;
  v_both := c.venue_signed_at IS NOT NULL AND c.org_signed_at IS NOT NULL;
  IF NOT v_both THEN RETURN 'pending_signatures'; END IF;

  SELECT * INTO tpl FROM public.owner_recurring_templates WHERE id = c.template_id;

  -- Geler les termes du contrat-cadre (identifie la série : jour + heure).
  UPDATE public.event_collab_series_contracts
     SET status = 'active',
         terms_snapshot = jsonb_build_object(
           'split_rules', c.split_rules,
           'cancellation_policy', c.cancellation_policy,
           'currency', c.currency,
           'venue_id', c.venue_id,
           'organizer_user_id', c.organizer_user_id,
           'template_id', c.template_id,
           'recurring', true,
           'day_of_week', tpl.day_of_week,
           'start_time', tpl.start_time,
           'venue_signed_at', c.venue_signed_at,
           'org_signed_at', c.org_signed_at,
           'terms_version', p_terms_version,
           'frozen_at', now()
         )
   WHERE id = p_contract_id;
  SELECT * INTO c FROM public.event_collab_series_contracts WHERE id = p_contract_id;

  -- BALAYAGE : activer les contrats d'occurrence ENCORE en attente et SANS vente.
  -- Les occurrences déjà active/locked/closed (signées individuellement ou vendues)
  -- gardent leurs termes figés et sont exclues. terms_snapshot porte via_series →
  -- le trigger notify_collab_contract_signed les ignore (pas de spam).
  UPDATE public.event_collab_contracts oc
     SET status = 'active',
         venue_signed_at = COALESCE(oc.venue_signed_at, c.venue_signed_at),
         venue_signed_by = COALESCE(oc.venue_signed_by, c.venue_signed_by),
         org_signed_at   = COALESCE(oc.org_signed_at,   c.org_signed_at),
         org_signed_by   = COALESCE(oc.org_signed_by,   c.org_signed_by),
         split_rules     = c.split_rules,
         terms_snapshot  = COALESCE(c.terms_snapshot, '{}'::jsonb)
                            || jsonb_build_object('via_series', true, 'series_contract_id', c.id)
    FROM public.events e
   WHERE oc.event_id = e.id
     AND e.recurring_template_id = c.template_id
     AND e.partner_organizer_id = c.organizer_user_id
     AND oc.status = 'pending_signatures'
     AND e.split_locked_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.revenue_distributions rd WHERE rd.event_id = e.id);

  -- Ouvrir le GUARD sur les events balayés : règles en vigueur + purge de la proposition.
  UPDATE public.events e
     SET revenue_split_rules = c.split_rules,
         revenue_split_proposal = NULL,
         split_proposed_by = NULL,
         split_proposed_at = NULL,
         split_approved_by_venue = false,
         split_approved_by_organizer = false
   WHERE e.recurring_template_id = c.template_id
     AND e.partner_organizer_id = c.organizer_user_id
     AND e.split_locked_at IS NULL
     AND e.revenue_split_rules IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.revenue_distributions rd WHERE rd.event_id = e.id);

  RETURN 'active';
END; $$;

GRANT EXECUTE ON FUNCTION public.sign_event_collab_series_contract(uuid, text, text, text) TO authenticated;

-- =============================================================================
-- 4. RPC — résiliation du contrat-cadre (pour l'AVENIR).
--    N'affecte PAS les occurrences déjà active/locked (validement convenues) :
--    on ne « dé-convient » pas une soirée déjà ouverte. Effet : generate_recurring_events
--    cesse d'auto-accepter les NOUVELLES occurrences.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.terminate_event_collab_series_contract(p_contract_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c public.event_collab_series_contracts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.event_collab_series_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contract not found'; END IF;
  IF NOT (c.created_by = auth.uid() OR c.organizer_user_id = auth.uid()
          OR public.is_venue_owner(auth.uid(), c.venue_id)) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF c.status NOT IN ('draft','pending_signatures','active') THEN
    RAISE EXCEPTION 'Le contrat-cadre est déjà clos (statut=%)', c.status;
  END IF;
  UPDATE public.event_collab_series_contracts
     SET status = CASE WHEN c.status = 'active' THEN 'terminated' ELSE 'cancelled' END,
         terminated_at = now(), terminated_by = auth.uid()
   WHERE id = p_contract_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.terminate_event_collab_series_contract(uuid) TO authenticated;

-- =============================================================================
-- 5. Garde anti-spam : ignorer les occurrences activées VIA le contrat-cadre dans
--    le trigger « contrat signé » (sinon N notifs « accepté » au balayage).
--    On remplace les deux fonctions de 20260624161000 en ajoutant le skip via_series.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.notify_collab_contract_created()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_event_title text;
  v_club_name   text;
  v_org_name    text;
BEGIN
  -- Occurrence née/activée via le contrat-cadre récurrent → pas de demande individuelle.
  IF COALESCE(NEW.terms_snapshot->>'via_series', '') = 'true' THEN RETURN NEW; END IF;

  SELECT title INTO v_event_title FROM public.events WHERE id = NEW.event_id;
  SELECT name  INTO v_club_name  FROM public.venues WHERE id = NEW.venue_id;
  SELECT display_name INTO v_org_name
    FROM public.organizer_profiles WHERE user_id = NEW.organizer_user_id;
  v_event_title := COALESCE(v_event_title, 'une soirée');

  IF NEW.org_signed_at IS NULL AND NEW.venue_signed_at IS NOT NULL THEN
    PERFORM public.notify_collab_party(
      'organizer', NEW.venue_id, NEW.organizer_user_id, NEW.event_id,
      'collab_request', 'Nouvelle proposition de soirée',
      COALESCE(v_club_name, 'Un club') || ' te propose de co-organiser « ' || v_event_title || ' ». À toi de valider.',
      'high', 'event_collab_contract', NEW.id,
      jsonb_build_object('venue_id', NEW.venue_id, 'club_name', v_club_name, 'event_id', NEW.event_id)
    );
  ELSIF NEW.venue_signed_at IS NULL AND NEW.org_signed_at IS NOT NULL THEN
    PERFORM public.notify_collab_party(
      'venue', NEW.venue_id, NEW.organizer_user_id, NEW.event_id,
      'collab_request', 'Nouvelle proposition de soirée',
      COALESCE(v_org_name, 'Un organisateur') || ' te propose de co-organiser « ' || v_event_title || ' ». À toi de valider.',
      'high', 'event_collab_contract', NEW.id,
      jsonb_build_object('organizer_user_id', NEW.organizer_user_id, 'organizer_name', v_org_name, 'event_id', NEW.event_id)
    );
  END IF;

  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.notify_collab_contract_signed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_event_title text;
  v_club_name   text;
  v_org_name    text;
BEGIN
  IF NEW.status <> 'active' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  -- Activation via le contrat-cadre récurrent → une seule notif série, pas N notifs.
  IF COALESCE(NEW.terms_snapshot->>'via_series', '') = 'true' THEN RETURN NEW; END IF;

  SELECT title INTO v_event_title FROM public.events WHERE id = NEW.event_id;
  SELECT name  INTO v_club_name  FROM public.venues WHERE id = NEW.venue_id;
  SELECT display_name INTO v_org_name
    FROM public.organizer_profiles WHERE user_id = NEW.organizer_user_id;
  v_event_title := COALESCE(v_event_title, 'une soirée');

  IF NEW.created_by = NEW.organizer_user_id THEN
    PERFORM public.notify_collab_party(
      'organizer', NEW.venue_id, NEW.organizer_user_id, NEW.event_id,
      'collab_accepted', 'Collaboration confirmée',
      COALESCE(v_club_name, 'Le club') || ' a accepté de co-organiser « ' || v_event_title || ' ». La billetterie peut ouvrir.',
      'high', 'event_collab_contract', NEW.id,
      jsonb_build_object('venue_id', NEW.venue_id, 'club_name', v_club_name, 'event_id', NEW.event_id)
    );
  ELSE
    PERFORM public.notify_collab_party(
      'venue', NEW.venue_id, NEW.organizer_user_id, NEW.event_id,
      'collab_accepted', 'Collaboration confirmée',
      COALESCE(v_org_name, 'L''organisateur') || ' a accepté de co-organiser « ' || v_event_title || ' ». La billetterie peut ouvrir.',
      'high', 'event_collab_contract', NEW.id,
      jsonb_build_object('organizer_user_id', NEW.organizer_user_id, 'organizer_name', v_org_name, 'event_id', NEW.event_id)
    );
  END IF;

  RETURN NEW;
END; $$;

-- =============================================================================
-- 6. Notifications du contrat-CADRE lui-même (proposé / confirmé / résilié).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.notify_collab_series_created()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_club_name text;
  v_org_name  text;
BEGIN
  SELECT name INTO v_club_name FROM public.venues WHERE id = NEW.venue_id;
  SELECT display_name INTO v_org_name FROM public.organizer_profiles WHERE user_id = NEW.organizer_user_id;

  IF NEW.org_signed_at IS NULL AND NEW.venue_signed_at IS NOT NULL THEN
    PERFORM public.notify_collab_party(
      'organizer', NEW.venue_id, NEW.organizer_user_id, NULL,
      'collab_request', 'Collaboration récurrente proposée',
      COALESCE(v_club_name, 'Un club') || ' te propose un contrat-cadre récurrent : signe une fois pour co-organiser toutes les soirées de la série.',
      'high', 'event_collab_series_contract', NEW.id,
      jsonb_build_object('venue_id', NEW.venue_id, 'club_name', v_club_name, 'template_id', NEW.template_id, 'recurring', true)
    );
  ELSIF NEW.venue_signed_at IS NULL AND NEW.org_signed_at IS NOT NULL THEN
    PERFORM public.notify_collab_party(
      'venue', NEW.venue_id, NEW.organizer_user_id, NULL,
      'collab_request', 'Collaboration récurrente proposée',
      COALESCE(v_org_name, 'Un organisateur') || ' te propose un contrat-cadre récurrent : signe une fois pour co-organiser toutes les soirées de la série.',
      'high', 'event_collab_series_contract', NEW.id,
      jsonb_build_object('organizer_user_id', NEW.organizer_user_id, 'organizer_name', v_org_name, 'template_id', NEW.template_id, 'recurring', true)
    );
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_notify_collab_series_created ON public.event_collab_series_contracts;
CREATE TRIGGER trg_notify_collab_series_created
  AFTER INSERT ON public.event_collab_series_contracts
  FOR EACH ROW EXECUTE FUNCTION public.notify_collab_series_created();

CREATE OR REPLACE FUNCTION public.notify_collab_series_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_club_name text;
  v_org_name  text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  SELECT name INTO v_club_name FROM public.venues WHERE id = NEW.venue_id;
  SELECT display_name INTO v_org_name FROM public.organizer_profiles WHERE user_id = NEW.organizer_user_id;

  IF NEW.status = 'active' THEN
    -- Notifier le proposeur que sa collab récurrente est confirmée.
    IF NEW.created_by = NEW.organizer_user_id THEN
      PERFORM public.notify_collab_party(
        'organizer', NEW.venue_id, NEW.organizer_user_id, NULL,
        'collab_accepted', 'Collaboration récurrente confirmée',
        COALESCE(v_club_name, 'Le club') || ' a signé le contrat-cadre. Toutes les soirées de la série sont désormais auto-acceptées.',
        'high', 'event_collab_series_contract', NEW.id,
        jsonb_build_object('venue_id', NEW.venue_id, 'template_id', NEW.template_id, 'recurring', true)
      );
    ELSE
      PERFORM public.notify_collab_party(
        'venue', NEW.venue_id, NEW.organizer_user_id, NULL,
        'collab_accepted', 'Collaboration récurrente confirmée',
        COALESCE(v_org_name, 'L''organisateur') || ' a signé le contrat-cadre. Toutes les soirées de la série sont désormais auto-acceptées.',
        'high', 'event_collab_series_contract', NEW.id,
        jsonb_build_object('organizer_user_id', NEW.organizer_user_id, 'template_id', NEW.template_id, 'recurring', true)
      );
    END IF;
  ELSIF NEW.status = 'terminated' THEN
    -- Notifier l'AUTRE partie (pas celle qui a résilié).
    IF NEW.terminated_by IS NOT DISTINCT FROM NEW.organizer_user_id THEN
      PERFORM public.notify_collab_party(
        'venue', NEW.venue_id, NEW.organizer_user_id, NULL,
        'collab_terminated', 'Collaboration récurrente résiliée',
        COALESCE(v_org_name, 'L''organisateur') || ' a résilié le contrat-cadre. Les prochaines soirées ne sont plus auto-acceptées (les soirées en cours restent inchangées).',
        'normal', 'event_collab_series_contract', NEW.id,
        jsonb_build_object('organizer_user_id', NEW.organizer_user_id, 'template_id', NEW.template_id, 'recurring', true)
      );
    ELSE
      PERFORM public.notify_collab_party(
        'organizer', NEW.venue_id, NEW.organizer_user_id, NULL,
        'collab_terminated', 'Collaboration récurrente résiliée',
        COALESCE(v_club_name, 'Le club') || ' a résilié le contrat-cadre. Les prochaines soirées ne sont plus auto-acceptées (les soirées en cours restent inchangées).',
        'normal', 'event_collab_series_contract', NEW.id,
        jsonb_build_object('venue_id', NEW.venue_id, 'template_id', NEW.template_id, 'recurring', true)
      );
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_notify_collab_series_status ON public.event_collab_series_contracts;
CREATE TRIGGER trg_notify_collab_series_status
  AFTER UPDATE OF status ON public.event_collab_series_contracts
  FOR EACH ROW EXECUTE FUNCTION public.notify_collab_series_status();

-- =============================================================================
-- 7. generate_recurring_events — chemin AUTO-ACCEPT quand un contrat-cadre est actif.
--    Reprend la fonction de 20260623150000 ; SEULE différence : si la série a un
--    contrat-cadre 'active', chaque NOUVELLE occurrence co-event naît directement
--    'active' (signatures héritées du cadre, GUARD ouvert). Sinon : comportement
--    inchangé (occurrence en attente de signature par-occurrence).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.generate_recurring_events(p_template_id uuid DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tpl public.owner_recurring_templates%ROWTYPE;
  d date;
  v_close_next_day boolean;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_event_id uuid;
  v_ticket_preset public.ticket_presets%ROWTYPE;
  v_vip_preset public.ticket_presets%ROWTYPE;
  v_will_enable_ticketing boolean;
  v_selling_mode text;
  v_max_tickets int;
  v_position int;
  v_generated int := 0;
  -- co-event
  v_venue_owner uuid;
  v_partnership uuid;
  v_rules jsonb;
  v_is_co boolean;
  -- contrat-cadre récurrent
  v_series public.event_collab_series_contracts%ROWTYPE;
  v_series_active boolean;
BEGIN
  IF p_template_id IS NOT NULL AND auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.owner_recurring_templates t
      WHERE t.id = p_template_id AND (
        t.organizer_user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.venues v WHERE v.id = t.venue_id AND v.owner_id = auth.uid())
      )
    ) THEN
      RAISE EXCEPTION 'Not authorized for template %', p_template_id;
    END IF;
  END IF;

  FOR tpl IN
    SELECT * FROM public.owner_recurring_templates
    WHERE is_active = true
      AND (p_template_id IS NULL OR id = p_template_id)
  LOOP
    v_venue_owner := NULL; v_partnership := NULL; v_rules := NULL;
    v_series_active := false;
    IF tpl.partner_organizer_id IS NOT NULL THEN
      SELECT owner_id INTO v_venue_owner FROM public.venues WHERE id = tpl.venue_id;
      SELECT id INTO v_partnership FROM public.venue_organizer_partnerships
        WHERE venue_id = tpl.venue_id AND organizer_user_id = tpl.partner_organizer_id
          AND status = 'active' LIMIT 1;
      v_rules := COALESCE(tpl.revenue_split_rules, jsonb_build_object(
        'tickets', jsonb_build_object('organizer_pct', 50, 'venue_pct', 50),
        'tables',  jsonb_build_object('organizer_pct', 0,  'venue_pct', 100),
        'drinks',  jsonb_build_object('organizer_pct', 0,  'venue_pct', 100)));
      v_rules := jsonb_set(v_rules, '{drinks}', jsonb_build_object('organizer_pct', 0, 'venue_pct', 100));
      -- Contrat-cadre récurrent actif ? → auto-accept. Sinon → flux par-occurrence.
      SELECT * INTO v_series FROM public.event_collab_series_contracts
        WHERE template_id = tpl.id AND status = 'active' LIMIT 1;
      v_series_active := (v_series.id IS NOT NULL);
      IF v_series_active THEN v_rules := v_series.split_rules; END IF;
    END IF;
    v_is_co := (tpl.partner_organizer_id IS NOT NULL AND v_venue_owner IS NOT NULL);

    FOR d IN
      SELECT gd::date
      FROM generate_series(
        (now() AT TIME ZONE 'Europe/Paris')::date,
        (now() AT TIME ZONE 'Europe/Paris')::date + tpl.advance_days,
        interval '1 day'
      ) gd
      WHERE EXTRACT(DOW FROM gd) = tpl.day_of_week
    LOOP
      BEGIN
        IF EXISTS (
          SELECT 1 FROM public.events e
          WHERE e.recurring_template_id = tpl.id
            AND (e.start_at AT TIME ZONE 'Europe/Paris')::date = d
        ) THEN
          CONTINUE;
        END IF;

        v_close_next_day := tpl.end_time <= tpl.start_time;
        v_start_at := (d + tpl.start_time) AT TIME ZONE 'Europe/Paris';
        v_end_at := ((d + (CASE WHEN v_close_next_day THEN 1 ELSE 0 END)::int) + tpl.end_time) AT TIME ZONE 'Europe/Paris';

        v_ticket_preset := NULL;
        v_vip_preset := NULL;
        IF tpl.ticket_preset_id IS NOT NULL THEN
          SELECT * INTO v_ticket_preset FROM public.ticket_presets WHERE id = tpl.ticket_preset_id;
        END IF;
        IF tpl.vip_preset_id IS NOT NULL THEN
          SELECT * INTO v_vip_preset FROM public.ticket_presets WHERE id = tpl.vip_preset_id;
        END IF;

        v_will_enable_ticketing := (v_ticket_preset.id IS NOT NULL OR v_vip_preset.id IS NOT NULL);
        v_selling_mode := COALESCE(v_ticket_preset.selling_mode, 'rounds');
        v_max_tickets := CASE WHEN v_ticket_preset.id IS NOT NULL AND v_ticket_preset.selling_mode = 'simple'
                              THEN v_ticket_preset.total_capacity ELSE NULL END;

        INSERT INTO public.events (
          venue_id, organizer_user_id, title, description, poster_url, poster_position,
          music_genres, music_genre, event_type, start_at, end_at, is_active,
          recurring_template_id, ticketing_enabled, ticket_selling_mode, max_tickets, tables_enabled,
          partner_organizer_id, event_mode,
          revenue_split_rules, revenue_split_proposal, split_proposed_by, split_proposed_at,
          split_approved_by_venue, split_approved_by_organizer, split_locked_at
        ) VALUES (
          tpl.venue_id, tpl.organizer_user_id, tpl.name, tpl.description, tpl.poster_url, tpl.poster_position,
          tpl.music_genres, COALESCE(tpl.music_genres[1], 'Open Format'), tpl.event_type, v_start_at, v_end_at, true,
          tpl.id, v_will_enable_ticketing, v_selling_mode, v_max_tickets, COALESCE(tpl.auto_enable_tables, false),
          tpl.partner_organizer_id,
          CASE WHEN tpl.partner_organizer_id IS NOT NULL THEN 'co_event'::public.event_mode
               WHEN tpl.venue_id IS NOT NULL THEN 'solo_venue'::public.event_mode
               ELSE 'solo_organizer'::public.event_mode END,
          -- revenue_split_rules : posé d'emblée si contrat-cadre actif (ventes ouvertes), sinon NULL.
          CASE WHEN v_series_active THEN v_rules END,
          -- revenue_split_proposal / proposer / approbation : flux par-occurrence seulement.
          CASE WHEN v_is_co AND NOT v_series_active THEN v_rules END,
          CASE WHEN v_is_co AND NOT v_series_active THEN v_venue_owner END,
          CASE WHEN v_is_co AND NOT v_series_active THEN now() END,
          (v_is_co AND NOT v_series_active),                     -- split_approved_by_venue (club pré-signe le template)
          false,                                                 -- split_approved_by_organizer
          NULL                                                   -- split_locked_at (verrou à la 1re vente)
        )
        RETURNING id INTO v_event_id;

        -- Contrat d'occurrence : 'active' hérité du cadre, sinon 'pending_signatures'.
        IF v_is_co THEN
          IF v_series_active THEN
            INSERT INTO public.event_collab_contracts (
              event_id, partnership_id, venue_id, organizer_user_id, created_by,
              status, split_rules, cancellation_policy, auto_release_at,
              venue_signed_at, venue_signed_by, org_signed_at, org_signed_by, terms_snapshot
            ) VALUES (
              v_event_id, v_partnership, tpl.venue_id, tpl.partner_organizer_id, v_venue_owner,
              'active', v_rules, COALESCE(v_series.cancellation_policy, 'pro_rata_refund'), v_end_at + interval '2 days',
              COALESCE(v_series.venue_signed_at, now()), COALESCE(v_series.venue_signed_by, v_venue_owner),
              COALESCE(v_series.org_signed_at, now()), COALESCE(v_series.org_signed_by, tpl.partner_organizer_id),
              COALESCE(v_series.terms_snapshot, '{}'::jsonb)
                || jsonb_build_object('via_series', true, 'series_contract_id', v_series.id)
            ) ON CONFLICT (event_id) DO NOTHING;
          ELSE
            INSERT INTO public.event_collab_contracts (
              event_id, partnership_id, venue_id, organizer_user_id, created_by,
              status, split_rules, cancellation_policy, auto_release_at,
              venue_signed_at, venue_signed_by
            ) VALUES (
              v_event_id, v_partnership, tpl.venue_id, tpl.partner_organizer_id, v_venue_owner,
              'pending_signatures', v_rules, 'pro_rata_refund', v_end_at + interval '2 days',
              now(), v_venue_owner
            ) ON CONFLICT (event_id) DO NOTHING;
          END IF;
        END IF;

        v_position := 0;
        IF v_ticket_preset.id IS NOT NULL THEN
          v_position := v_position + public._insert_recurring_rounds(v_event_id, v_ticket_preset.id, v_position);
        END IF;
        IF v_vip_preset.id IS NOT NULL THEN
          PERFORM public._insert_recurring_rounds(v_event_id, v_vip_preset.id, v_position);
        END IF;

        v_generated := v_generated + 1;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'generate_recurring_events: template % / date %: %', tpl.id, d, SQLERRM;
      END;
    END LOOP;
  END LOOP;

  RETURN v_generated;
END;
$$;
