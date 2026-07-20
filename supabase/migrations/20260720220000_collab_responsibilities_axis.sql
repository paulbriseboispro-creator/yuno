-- =============================================================================
-- Collab : séparer l'axe ARGENT (event_mode) de l'axe RESPONSABILITÉS.
--
-- CONSTAT — `event_mode` porte aujourd'hui deux sens à la fois :
--   • qui touche l'argent (coEventSplit.ts, payment-split.ts) ;
--   • qui a le droit d'ÉDITER quoi — mais seulement en pointillé, réinventé à
--     trois endroits qui testent tous « est-ce org_hosted ? » à la main :
--       - can_manage_event_tables       (20260625140000)
--       - policy « Partner organizer can manage co-event » (20260625130000)
--       - les panneaux front (OrgEventTablesPanel, CollabEventDetail).
--
-- Il n'existe donc que deux postures possibles : « le partenaire co-gère tout »
-- ou « le partenaire ne gère rien ». Impossible d'exprimer la configuration la
-- plus courante en vrai : LE CLUB TIENT LA LOGISTIQUE ET L'OPÉRATIONNEL,
-- L'ORGANISATEUR TIENT LE DESIGN ET LA PROMO. Le mode qui s'en approche
-- (org_hosted) fait exactement l'inverse de ce qu'on veut : il met l'orga en
-- lecture seule ET lui donne 100 % des billets.
--
-- SOLUTION — un axe explicite `collab_responsibilities`, quatre domaines :
--   creative    visuel, titre, description, genres      (le design)
--   ticketing   billetterie, prix, ouverture des ventes
--   operations  tables VIP, plan de salle, accès, lieu  (la logistique)
--   promotion   visibilité, découverte, référencement
-- Chaque domaine appartient à 'venue', 'organizer' ou 'both'.
--
-- SUPERSET STRICT, AUCUN BACKFILL — `collab_responsibilities` NULL retombe sur
-- le préréglage du mode, et les préréglages reproduisent EXACTEMENT les droits
-- d'aujourd'hui. Une soirée existante ne change donc pas de comportement tant que
-- personne n'a explicitement réparti les domaines. On n'ouvre aucun droit dans le
-- dos des deux parties : c'est un ajout opt-in, comme le contrat-cadre.
-- =============================================================================

-- 1. Colonnes -----------------------------------------------------------------
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS collab_responsibilities jsonb;

COMMENT ON COLUMN public.events.collab_responsibilities IS
  'Répartition des domaines entre les deux parties : {"creative":"organizer","ticketing":"venue","operations":"venue","promotion":"both"}. NULL = préréglage du event_mode (voir default_collab_responsibilities).';

-- Le contrat porte la répartition SIGNÉE — c'est elle qui fait foi entre les
-- parties ; events.collab_responsibilities n'en est que la copie applicable.
ALTER TABLE public.event_collab_contracts
  ADD COLUMN IF NOT EXISTS responsibilities jsonb;
ALTER TABLE public.event_collab_series_contracts
  ADD COLUMN IF NOT EXISTS responsibilities jsonb;

-- Une série récurrente porte son mode ET sa répartition : chaque occurrence en
-- hérite à la génération. Jusqu'ici le récurrent forçait co_event en dur.
ALTER TABLE public.owner_recurring_templates
  ADD COLUMN IF NOT EXISTS collab_mode public.event_mode,
  ADD COLUMN IF NOT EXISTS collab_responsibilities jsonb;

-- 2. Préréglages par mode -----------------------------------------------------
-- Reproduisent les droits actuels À L'IDENTIQUE :
--   co_event / venue_rental → le partenaire co-gère tout (policy UPDATE ouverte,
--     can_manage_event_tables l'autorise) ;
--   org_hosted             → le partenaire ne gère rien (aucune policy UPDATE,
--     can_manage_event_tables l'exclut).
-- Le cas « club = opérations, orga = design » ne s'obtient donc PAS via un mode :
-- il s'obtient en répartissant explicitement les domaines, ce qui est le but.
CREATE OR REPLACE FUNCTION public.default_collab_responsibilities(p_mode public.event_mode)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_mode = 'org_hosted' THEN jsonb_build_object(
      'creative', 'venue', 'ticketing', 'venue', 'operations', 'venue', 'promotion', 'venue')
    ELSE jsonb_build_object(
      'creative', 'both', 'ticketing', 'both', 'operations', 'both', 'promotion', 'both')
  END;
$$;

-- 3. Détenteur d'un domaine ---------------------------------------------------
-- Une valeur inconnue ou absente retombe sur le préréglage du mode : un jsonb
-- partiel ({"creative":"organizer"}) est donc légal et ne troue pas les droits.
CREATE OR REPLACE FUNCTION public.collab_domain_holder(
  p_resp   jsonb,
  p_mode   public.event_mode,
  p_domain text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    NULLIF(
      CASE WHEN p_resp ->> p_domain IN ('venue','organizer','both')
           THEN p_resp ->> p_domain END, ''),
    public.default_collab_responsibilities(p_mode) ->> p_domain,
    'both'
  );
$$;

-- 4. Le partenaire tient-il ce domaine sur cette soirée ? ---------------------
CREATE OR REPLACE FUNCTION public.event_domain_allows_partner(p_event_id uuid, p_domain text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.collab_domain_holder(e.collab_responsibilities, e.event_mode, p_domain)
         IN ('organizer','both')
  FROM public.events e WHERE e.id = p_event_id;
$$;

-- Le club tient-il ce domaine ? (symétrique : un domaine confié EXCLUSIVEMENT à
-- l'organisateur retire aussi la main au club — c'est ce qui rend la séparation
-- réelle et pas seulement décorative.)
CREATE OR REPLACE FUNCTION public.event_domain_allows_venue(p_event_id uuid, p_domain text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.collab_domain_holder(e.collab_responsibilities, e.event_mode, p_domain)
         IN ('venue','both')
  FROM public.events e WHERE e.id = p_event_id;
$$;

-- 5. Opérations : lire l'axe au lieu de tester org_hosted en dur --------------
-- Gate l'édition des ticket_rounds ET des table_zones / table_packs /
-- venue_floor_plans event-scopés (cf. 20260625140000).
CREATE OR REPLACE FUNCTION public.can_manage_event_tables(_user_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    LEFT JOIN public.venues v ON v.id = e.venue_id OR v.id = e.partner_venue_id
    WHERE e.id = _event_id
      AND (
        e.organizer_user_id = _user_id
        -- Le partenaire ne gère les opérations que s'il tient le domaine.
        OR (e.partner_organizer_id = _user_id
            AND public.collab_domain_holder(e.collab_responsibilities, e.event_mode, 'operations')
                IN ('organizer','both'))
        OR e.tables_owner_user_id = _user_id
        -- Le club garde la main sauf si les opérations sont confiées à l'orga seul.
        OR (v.owner_id = _user_id
            AND public.collab_domain_holder(e.collab_responsibilities, e.event_mode, 'operations')
                IN ('venue','both'))
        OR public.is_super_admin()
      )
  )
$$;

-- 6. Policy UPDATE du partenaire : dès qu'il tient AU MOINS un domaine --------
-- Le détail colonne par colonne est appliqué par le trigger ci-dessous ; la
-- policy ne fait qu'ouvrir la porte.
DROP POLICY IF EXISTS "Partner organizer can manage co-event" ON public.events;
CREATE POLICY "Partner organizer can manage co-event"
ON public.events
FOR UPDATE
TO authenticated
USING (
  public.is_event_partner_organizer(auth.uid(), id)
  AND (
    public.collab_domain_holder(collab_responsibilities, event_mode, 'creative')   IN ('organizer','both')
    OR public.collab_domain_holder(collab_responsibilities, event_mode, 'ticketing')  IN ('organizer','both')
    OR public.collab_domain_holder(collab_responsibilities, event_mode, 'operations') IN ('organizer','both')
    OR public.collab_domain_holder(collab_responsibilities, event_mode, 'promotion')  IN ('organizer','both')
  )
)
WITH CHECK (
  public.is_event_partner_organizer(auth.uid(), id)
  AND (
    public.collab_domain_holder(collab_responsibilities, event_mode, 'creative')   IN ('organizer','both')
    OR public.collab_domain_holder(collab_responsibilities, event_mode, 'ticketing')  IN ('organizer','both')
    OR public.collab_domain_holder(collab_responsibilities, event_mode, 'operations') IN ('organizer','both')
    OR public.collab_domain_holder(collab_responsibilities, event_mode, 'promotion')  IN ('organizer','both')
  )
);

-- 7. Garde-fou colonne par colonne, désormais par DOMAINE ---------------------
-- Remplace le garde-fou binaire de 20260625130000 (lead = tout permis,
-- partenaire = tout sauf les colonnes sensibles). Désormais les DEUX côtés sont
-- tenus par la répartition, et une poignée de colonnes reste structurelle :
-- l'argent, l'identité des parties, le mode, la répartition elle-même, les dates
-- et le cycle de vie. Celles-là n'appartiennent à aucun domaine — elles se
-- renégocient par contrat, pas par un champ de formulaire.
CREATE OR REPLACE FUNCTION public.protect_event_columns_from_partner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_venue_side boolean;
  v_is_org_side   boolean;
  v_is_lead       boolean;
  v_side          text;
  v_touched       text;
BEGIN
  -- CRITIQUE : ne garder QUE les UPDATE clients directs (PostgREST = rôle
  -- `authenticated`). Les RPC SECURITY DEFINER (signature de contrat qui écrit
  -- revenue_split_*, crons, service_role…) tournent sous le rôle propriétaire et
  -- sont de confiance — sinon ce garde-fou casserait la signature de contrat.
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF public.is_super_admin() THEN RETURN NEW; END IF;

  -- Hors co-soirée (solo), aucune répartition à faire respecter.
  IF OLD.partner_organizer_id IS NULL AND OLD.partner_venue_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_is_venue_side := EXISTS (
    SELECT 1 FROM public.venues v WHERE v.id = OLD.venue_id AND v.owner_id = auth.uid());
  v_is_org_side   := (OLD.organizer_user_id = auth.uid() OR OLD.partner_organizer_id = auth.uid());

  -- Ni club ni orga (manager, staff…) : on ne durcit rien ici, les policies ont
  -- déjà tranché qui peut écrire.
  IF NOT (v_is_venue_side OR v_is_org_side) THEN RETURN NEW; END IF;
  -- Une même personne des deux côtés (club qui est aussi l'orga) : rien à séparer.
  IF v_is_venue_side AND v_is_org_side THEN RETURN NEW; END IF;
  v_side := CASE WHEN v_is_venue_side THEN 'venue' ELSE 'organizer' END;

  -- LEAD = celui qui porte la soirée. Une co-soirée peut être menée par le club
  -- (venue_id + partner_organizer_id) OU par l'organisateur (organizer_user_id +
  -- partner_venue_id) — 20260625130000 traitait les deux comme lead, et il faut
  -- garder ça : sinon un organisateur qui mène sa propre co-soirée perdrait le
  -- droit d'en changer la structure.
  v_is_lead := v_is_venue_side OR (OLD.organizer_user_id = auth.uid());

  -- 7a. Colonnes STRUCTURELLES : aucun des deux côtés ne les change à la main.
  --     (L'argent et l'identité des parties passent par les RPC de contrat, qui
  --     sortent par le early-return `current_user <> 'authenticated'` ci-dessus.)
  IF NEW.revenue_split_rules      IS DISTINCT FROM OLD.revenue_split_rules
   OR NEW.revenue_split_proposal  IS DISTINCT FROM OLD.revenue_split_proposal
   OR NEW.is_bde                  IS DISTINCT FROM OLD.is_bde
   OR NEW.venue_id                IS DISTINCT FROM OLD.venue_id
   OR NEW.partner_venue_id        IS DISTINCT FROM OLD.partner_venue_id
   OR NEW.organizer_user_id       IS DISTINCT FROM OLD.organizer_user_id
   OR NEW.partner_organizer_id    IS DISTINCT FROM OLD.partner_organizer_id
   OR NEW.event_mode              IS DISTINCT FROM OLD.event_mode
   OR NEW.collab_responsibilities IS DISTINCT FROM OLD.collab_responsibilities
  THEN
    -- Le lead garde la main sur la structure de SA soirée ; le partenaire non.
    -- C'est le comportement de 20260625130000, conservé tel quel.
    IF NOT v_is_lead THEN
      RAISE EXCEPTION 'Le partenaire ne peut pas modifier le partage, le mode ni la structure de la soirée';
    END IF;
  END IF;

  -- 7b. Domaine CREATIVE ------------------------------------------------------
  IF (NEW.title           IS DISTINCT FROM OLD.title
   OR NEW.description     IS DISTINCT FROM OLD.description
   OR NEW.poster_url      IS DISTINCT FROM OLD.poster_url
   OR NEW.poster_position IS DISTINCT FROM OLD.poster_position
   OR NEW.image_url       IS DISTINCT FROM OLD.image_url
   OR NEW.banner_position IS DISTINCT FROM OLD.banner_position
   OR NEW.music_genres    IS DISTINCT FROM OLD.music_genres
   OR NEW.music_genre     IS DISTINCT FROM OLD.music_genre
   OR NEW.event_type      IS DISTINCT FROM OLD.event_type)
   AND public.collab_domain_holder(OLD.collab_responsibilities, OLD.event_mode, 'creative')
       NOT IN (v_side, 'both')
  THEN
    v_touched := 'creative';
  END IF;

  -- 7c. Domaine TICKETING -----------------------------------------------------
  IF v_touched IS NULL
   AND (NEW.ticketing_enabled      IS DISTINCT FROM OLD.ticketing_enabled
     OR NEW.ticket_selling_mode    IS DISTINCT FROM OLD.ticket_selling_mode
     OR NEW.max_tickets            IS DISTINCT FROM OLD.max_tickets
     OR NEW.max_tickets_per_person IS DISTINCT FROM OLD.max_tickets_per_person
     OR NEW.presale_start_at       IS DISTINCT FROM OLD.presale_start_at
     OR NEW.public_sale_start_at   IS DISTINCT FROM OLD.public_sale_start_at
     OR NEW.rounds_visibility      IS DISTINCT FROM OLD.rounds_visibility
     OR NEW.sale_password_enabled  IS DISTINCT FROM OLD.sale_password_enabled
     OR NEW.waitlist_enabled       IS DISTINCT FROM OLD.waitlist_enabled)
   AND public.collab_domain_holder(OLD.collab_responsibilities, OLD.event_mode, 'ticketing')
       NOT IN (v_side, 'both')
  THEN
    v_touched := 'ticketing';
  END IF;

  -- 7d. Domaine OPERATIONS ----------------------------------------------------
  IF v_touched IS NULL
   AND (NEW.tables_enabled          IS DISTINCT FROM OLD.tables_enabled
     OR NEW.tables_mode             IS DISTINCT FROM OLD.tables_mode
     OR NEW.tables_locked_to_venue  IS DISTINCT FROM OLD.tables_locked_to_venue
     OR NEW.tables_owner_user_id    IS DISTINCT FROM OLD.tables_owner_user_id
     OR NEW.minors_disabled         IS DISTINCT FROM OLD.minors_disabled
     OR NEW.alcohol_free            IS DISTINCT FROM OLD.alcohol_free
     OR NEW.location_name           IS DISTINCT FROM OLD.location_name
     OR NEW.location_address        IS DISTINCT FROM OLD.location_address
     OR NEW.location_city           IS DISTINCT FROM OLD.location_city
     OR NEW.location_is_secret      IS DISTINCT FROM OLD.location_is_secret
     OR NEW.reveal_address_in_email IS DISTINCT FROM OLD.reveal_address_in_email
     OR NEW.access_code             IS DISTINCT FROM OLD.access_code
     OR NEW.requires_access_code    IS DISTINCT FROM OLD.requires_access_code)
   AND public.collab_domain_holder(OLD.collab_responsibilities, OLD.event_mode, 'operations')
       NOT IN (v_side, 'both')
  THEN
    v_touched := 'operations';
  END IF;

  -- 7e. Domaine PROMOTION -----------------------------------------------------
  IF v_touched IS NULL
   AND (NEW.visibility            IS DISTINCT FROM OLD.visibility
     OR NEW.is_discoverable       IS DISTINCT FROM OLD.is_discoverable
     OR NEW.discovery_status      IS DISTINCT FROM OLD.discovery_status
     OR NEW.hide_yuno_navigation  IS DISTINCT FROM OLD.hide_yuno_navigation
     OR NEW.search_title          IS DISTINCT FROM OLD.search_title)
   AND public.collab_domain_holder(OLD.collab_responsibilities, OLD.event_mode, 'promotion')
       NOT IN (v_side, 'both')
  THEN
    v_touched := 'promotion';
  END IF;

  IF v_touched IS NOT NULL THEN
    RAISE EXCEPTION 'Ce domaine (%) est confié à l''autre partie sur cette soirée', v_touched
      USING HINT = 'Modifiez la répartition des responsabilités dans le contrat de collaboration.';
  END IF;

  RETURN NEW;
END;
$$;

-- 8. Série récurrente : le partenaire peut éditer les domaines qu'il tient -----
-- Jusqu'ici il n'avait qu'un SELECT (20260720200000) : sur une résidence, le club
-- pouvait tout changer et l'organisateur ne pouvait pas toucher l'affiche de sa
-- propre soirée. Sur une soirée UNIQUE il le pouvait déjà (20260625130000) —
-- c'était une incohérence, pas une décision.
DROP POLICY IF EXISTS "Partner organizers update co-hosted recurring templates" ON public.owner_recurring_templates;
CREATE POLICY "Partner organizers update co-hosted recurring templates"
  ON public.owner_recurring_templates
  FOR UPDATE TO authenticated
  USING (
    partner_organizer_id = auth.uid()
    AND public.collab_domain_holder(collab_responsibilities, COALESCE(collab_mode, 'co_event'), 'creative')
        IN ('organizer','both')
  )
  WITH CHECK (
    partner_organizer_id = auth.uid()
    AND public.collab_domain_holder(collab_responsibilities, COALESCE(collab_mode, 'co_event'), 'creative')
        IN ('organizer','both')
  );

-- Garde-fou : le partenaire ne touche QUE le créatif de la série. Le jour, les
-- horaires, l'avance de publication, les presets, le partenaire et le mode
-- restent au club — ce sont les termes de la résidence, pas de la décoration.
CREATE OR REPLACE FUNCTION public.protect_recurring_template_from_partner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF public.is_super_admin() THEN RETURN NEW; END IF;
  -- Le club propriétaire de la série n'est pas concerné par ce garde-fou.
  IF EXISTS (SELECT 1 FROM public.venues v WHERE v.id = OLD.venue_id AND v.owner_id = auth.uid())
     OR OLD.organizer_user_id = auth.uid() THEN
    RETURN NEW;
  END IF;
  IF OLD.partner_organizer_id IS DISTINCT FROM auth.uid() THEN RETURN NEW; END IF;

  IF NEW.venue_id                IS DISTINCT FROM OLD.venue_id
   OR NEW.organizer_user_id      IS DISTINCT FROM OLD.organizer_user_id
   OR NEW.partner_organizer_id   IS DISTINCT FROM OLD.partner_organizer_id
   OR NEW.collab_mode            IS DISTINCT FROM OLD.collab_mode
   OR NEW.collab_responsibilities IS DISTINCT FROM OLD.collab_responsibilities
   OR NEW.revenue_split_rules    IS DISTINCT FROM OLD.revenue_split_rules
   OR NEW.day_of_week            IS DISTINCT FROM OLD.day_of_week
   OR NEW.start_time             IS DISTINCT FROM OLD.start_time
   OR NEW.end_time               IS DISTINCT FROM OLD.end_time
   OR NEW.advance_days           IS DISTINCT FROM OLD.advance_days
   OR NEW.ticket_preset_id       IS DISTINCT FROM OLD.ticket_preset_id
   OR NEW.vip_preset_id          IS DISTINCT FROM OLD.vip_preset_id
   OR NEW.table_preset_id        IS DISTINCT FROM OLD.table_preset_id
   OR NEW.guest_list_template_id IS DISTINCT FROM OLD.guest_list_template_id
   OR NEW.auto_enable_tables     IS DISTINCT FROM OLD.auto_enable_tables
   OR NEW.is_active              IS DISTINCT FROM OLD.is_active
  THEN
    RAISE EXCEPTION 'Le partenaire ne peut modifier que le visuel et le texte de la série'
      USING HINT = 'Le jour, les horaires, la billetterie et les termes de la résidence restent au club.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_recurring_template_from_partner ON public.owner_recurring_templates;
CREATE TRIGGER trg_protect_recurring_template_from_partner
  BEFORE UPDATE ON public.owner_recurring_templates
  FOR EACH ROW EXECUTE FUNCTION public.protect_recurring_template_from_partner();

-- 9. Le contrat-cadre porte la répartition, et la série la transmet ------------
-- Ajout d'un paramètre optionnel : un cadre sans répartition explicite reste
-- exactement le cadre d'avant (préréglage du mode).
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
  v_resp       jsonb;
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

  -- Un seul contrat-cadre VIVANT à la fois. Un cadre résilié/annulé reste en
  -- historique et n'empêche pas d'en re-proposer un (cf. 20260720210000, où
  -- l'unicité est devenue partielle pour tenir cette promesse).
  IF EXISTS (SELECT 1 FROM public.event_collab_series_contracts s
              WHERE s.template_id = p_template_id AND s.status NOT IN ('cancelled','terminated')) THEN
    RAISE EXCEPTION 'Un contrat-cadre existe déjà pour cette série';
  END IF;

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

  v_resp := COALESCE(p_responsibilities, tpl.collab_responsibilities);

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

-- 10. Génération : chaque occurrence hérite du mode ET de la répartition -------
-- Seules deux choses changent par rapport à 20260720200000 : `event_mode` lit
-- désormais tpl.collab_mode (le récurrent forçait co_event en dur, donc un club
-- ne pouvait proposer QUE de la co-organisation sur une résidence), et
-- `collab_responsibilities` descend du contrat-cadre ou du template.
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
  v_venue_owner uuid;
  v_partnership uuid;
  v_rules jsonb;
  v_is_co boolean;
  v_mode public.event_mode;
  v_resp jsonb;
  v_series public.event_collab_series_contracts%ROWTYPE;
  v_series_active boolean;
  v_series_pending boolean;
BEGIN
  IF p_template_id IS NOT NULL AND auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.owner_recurring_templates t
      WHERE t.id = p_template_id AND (
        t.organizer_user_id = auth.uid()
        OR t.partner_organizer_id = auth.uid()
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
    v_venue_owner := NULL; v_partnership := NULL; v_rules := NULL; v_resp := NULL;
    v_series_active := false; v_series_pending := false;
    v_series := NULL;
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
      SELECT * INTO v_series FROM public.event_collab_series_contracts
        WHERE template_id = tpl.id AND status = 'active' LIMIT 1;
      v_series_active := (v_series.id IS NOT NULL);
      IF v_series_active THEN
        v_rules := v_series.split_rules;
      ELSE
        SELECT EXISTS (
          SELECT 1 FROM public.event_collab_series_contracts s2
           WHERE s2.template_id = tpl.id
             AND s2.status IN ('draft','pending_signatures')
        ) INTO v_series_pending;
      END IF;
      -- La répartition applicable : celle du cadre signé d'abord, sinon celle
      -- posée sur la série. NULL = préréglage du mode, comme partout ailleurs.
      v_resp := COALESCE(v_series.responsibilities, tpl.collab_responsibilities);
    END IF;
    IF v_series_pending THEN CONTINUE; END IF;
    v_is_co := (tpl.partner_organizer_id IS NOT NULL AND v_venue_owner IS NOT NULL);
    v_mode := CASE
      WHEN tpl.partner_organizer_id IS NOT NULL THEN COALESCE(tpl.collab_mode, 'co_event'::public.event_mode)
      WHEN tpl.venue_id IS NOT NULL THEN 'solo_venue'::public.event_mode
      ELSE 'solo_organizer'::public.event_mode END;

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
          partner_organizer_id, event_mode, collab_responsibilities,
          revenue_split_rules, revenue_split_proposal, split_proposed_by, split_proposed_at,
          split_approved_by_venue, split_approved_by_organizer, split_locked_at
        ) VALUES (
          tpl.venue_id, tpl.organizer_user_id, tpl.name, tpl.description, tpl.poster_url, tpl.poster_position,
          tpl.music_genres, COALESCE(tpl.music_genres[1], 'Open Format'), tpl.event_type, v_start_at, v_end_at, true,
          tpl.id, v_will_enable_ticketing, v_selling_mode, v_max_tickets, COALESCE(tpl.auto_enable_tables, false),
          tpl.partner_organizer_id, v_mode, v_resp,
          CASE WHEN v_series_active THEN v_rules END,
          CASE WHEN v_is_co AND NOT v_series_active THEN v_rules END,
          CASE WHEN v_is_co AND NOT v_series_active THEN v_venue_owner END,
          CASE WHEN v_is_co AND NOT v_series_active THEN now() END,
          (v_is_co AND NOT v_series_active),
          false,
          NULL
        )
        RETURNING id INTO v_event_id;

        IF v_is_co THEN
          IF v_series_active THEN
            INSERT INTO public.event_collab_contracts (
              event_id, partnership_id, venue_id, organizer_user_id, created_by,
              status, split_rules, cancellation_policy, auto_release_at, responsibilities,
              venue_signed_at, venue_signed_by, org_signed_at, org_signed_by, terms_snapshot
            ) VALUES (
              v_event_id, v_partnership, tpl.venue_id, tpl.partner_organizer_id, v_venue_owner,
              'active', v_rules, COALESCE(v_series.cancellation_policy, 'pro_rata_refund'), v_end_at + interval '2 days', v_resp,
              COALESCE(v_series.venue_signed_at, now()), COALESCE(v_series.venue_signed_by, v_venue_owner),
              COALESCE(v_series.org_signed_at, now()), COALESCE(v_series.org_signed_by, tpl.partner_organizer_id),
              COALESCE(v_series.terms_snapshot, '{}'::jsonb)
                || jsonb_build_object('via_series', true, 'series_contract_id', v_series.id)
            ) ON CONFLICT (event_id) DO NOTHING;
          ELSE
            INSERT INTO public.event_collab_contracts (
              event_id, partnership_id, venue_id, organizer_user_id, created_by,
              status, split_rules, cancellation_policy, auto_release_at, responsibilities,
              venue_signed_at, venue_signed_by
            ) VALUES (
              v_event_id, v_partnership, tpl.venue_id, tpl.partner_organizer_id, v_venue_owner,
              'pending_signatures', v_rules, 'pro_rata_refund', v_end_at + interval '2 days', v_resp,
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
GRANT EXECUTE ON FUNCTION public.generate_recurring_events(uuid) TO authenticated;

-- 11. Signature du cadre : appliquer aussi la répartition aux occurrences ------
-- Le balayage de 20260720200000 activait les contrats en attente et posait les %.
-- Il pose désormais la répartition des responsabilités dans le même mouvement,
-- sinon les occurrences déjà créées resteraient sur le préréglage du mode alors
-- que les deux parties viennent de signer autre chose.
CREATE OR REPLACE FUNCTION public.apply_series_responsibilities(p_contract_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE c public.event_collab_series_contracts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.event_collab_series_contracts WHERE id = p_contract_id;
  IF NOT FOUND OR c.responsibilities IS NULL THEN RETURN; END IF;

  UPDATE public.events e
     SET collab_responsibilities = c.responsibilities
   WHERE e.recurring_template_id = c.template_id
     AND e.partner_organizer_id = c.organizer_user_id
     AND e.start_at > now();

  UPDATE public.event_collab_contracts oc
     SET responsibilities = c.responsibilities
    FROM public.events e
   WHERE oc.event_id = e.id
     AND e.recurring_template_id = c.template_id
     AND e.partner_organizer_id = c.organizer_user_id
     AND e.start_at > now();
END; $$;

-- Déclenché à l'activation du cadre plutôt qu'inséré dans
-- sign_event_collab_series_contract : la répartition suit alors TOUTES les voies
-- d'activation (signature des deux parties, reprise, correction admin) sans
-- réécrire une fonction de 150 lignes pour un appel.
CREATE OR REPLACE FUNCTION public.trg_apply_series_responsibilities()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
    PERFORM public.apply_series_responsibilities(NEW.id);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_series_contract_apply_responsibilities ON public.event_collab_series_contracts;
CREATE TRIGGER trg_series_contract_apply_responsibilities
  AFTER UPDATE OF status ON public.event_collab_series_contracts
  FOR EACH ROW EXECUTE FUNCTION public.trg_apply_series_responsibilities();
