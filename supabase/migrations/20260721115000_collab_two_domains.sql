-- =============================================================================
-- Collab : ramener l'axe responsabilités de QUATRE domaines à DEUX.
--
-- CONSTAT D'USAGE (Paul) : « il y a beaucoup d'options, ce n'est pas vraiment
-- clair ». Quatre domaines à trois valeurs, c'est 81 combinaisons, alors que le
-- partage réel dans la nuit n'en a que deux faces : QUI HABILLE la soirée, et
-- QUI LA FAIT TOURNER. Neuf combinaisons suffisent, et la grille se lit d'un
-- coup d'œil au lieu de demander un mode d'emploi.
--
--   design      titre, description, affiche, genres, LINE-UP DJ, et la façon
--               dont la soirée est montrée (visibilité, découverte, recherche)
--   operations  billetterie complète (prix, paliers, jauges, ouverture des
--               ventes), tables VIP et plan de salle, lieu et accès, HORAIRES
--
-- CE QUE LA FUSION RÉPARE AU PASSAGE — les paliers de billets (ticket_rounds,
-- donc les PRIX) sont protégés par can_manage_event_tables, un helper d'origine
-- « tables ». En quatre domaines il tombait sous `operations` alors que
-- l'interrupteur billetterie tombait sous `ticketing` : une partie pouvait
-- allumer la billetterie sans pouvoir fixer ses prix, et l'autre l'inverse.
-- Billetterie et tables dans le même domaine, l'incohérence disparaît.
--
-- LES HORAIRES CHANGENT DE STATUT. start_at / end_at étaient STRUCTURELS
-- (réservés au porteur de la soirée). Ils entrent dans `operations` : celui qui
-- fait tourner la soirée en fixe les heures. Sur une RÉSIDENCE en revanche, le
-- jour et l'heure restent au club — ils sont gelés dans le contrat-cadre comme
-- identité de la série (protect_recurring_template_from_partner, inchangé).
--
-- COMPATIBILITÉ : collab_domain_holder lit d'abord les deux nouvelles clés,
-- puis retombe sur l'ancien vocabulaire à quatre clés (creative/promotion →
-- design, ticketing/operations → operations). Les répartitions déjà posées
-- pendant les essais restent donc lisibles et gardent leur sens.
-- =============================================================================

-- 1. Préréglages, en deux domaines ---------------------------------------------
CREATE OR REPLACE FUNCTION public.default_collab_responsibilities(p_mode public.event_mode)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_mode = 'org_hosted'
      THEN jsonb_build_object('design', 'venue', 'operations', 'venue')
    ELSE jsonb_build_object('design', 'both', 'operations', 'both')
  END;
$$;

-- 2. Détenteur d'un domaine, avec repli sur l'ancien vocabulaire ----------------
CREATE OR REPLACE FUNCTION public.collab_domain_holder(
  p_resp   jsonb,
  p_mode   public.event_mode,
  p_domain text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    -- a) le nouveau vocabulaire
    CASE WHEN p_resp ->> p_domain IN ('venue','organizer','both')
         THEN p_resp ->> p_domain END,
    -- b) l'ancien, à quatre clés. Deux anciennes clés par nouveau domaine : on
    --    ne retient la valeur que si les DEUX concordent, sinon la répartition
    --    héritée était plus fine que ce que deux domaines savent exprimer et on
    --    retombe sur « les deux » plutôt que d'inventer un arbitrage.
    CASE
      WHEN p_domain = 'design' AND p_resp ->> 'creative' IS NOT NULL
           AND p_resp ->> 'creative' = COALESCE(p_resp ->> 'promotion', p_resp ->> 'creative')
        THEN p_resp ->> 'creative'
      WHEN p_domain = 'operations' AND p_resp ->> 'ticketing' IS NOT NULL
           AND p_resp ->> 'ticketing' = COALESCE(p_resp ->> 'operations', p_resp ->> 'ticketing')
        THEN p_resp ->> 'ticketing'
    END,
    -- c) le préréglage du mode
    public.default_collab_responsibilities(p_mode) ->> p_domain,
    'both'
  );
$$;

-- 3. Opérations : billetterie ET tables sous le même domaine --------------------
-- Gate ticket_rounds (prix, paliers) ET table_zones / table_packs /
-- venue_floor_plans event-scopés. Les deux relèvent désormais d'`operations`,
-- ce qui est exactement le point de la fusion.
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
        OR (e.partner_organizer_id = _user_id
            AND public.collab_domain_holder(e.collab_responsibilities, e.event_mode, 'operations')
                IN ('organizer','both'))
        OR e.tables_owner_user_id = _user_id
        OR (v.owner_id = _user_id
            AND public.collab_domain_holder(e.collab_responsibilities, e.event_mode, 'operations')
                IN ('venue','both'))
        OR public.is_super_admin()
      )
  )
$$;

-- 4. Policy UPDATE du partenaire : au moins un des deux domaines ---------------
DROP POLICY IF EXISTS "Partner organizer can manage co-event" ON public.events;
CREATE POLICY "Partner organizer can manage co-event"
ON public.events
FOR UPDATE
TO authenticated
USING (
  public.is_event_partner_organizer(auth.uid(), id)
  AND (
    public.collab_domain_holder(collab_responsibilities, event_mode, 'design')     IN ('organizer','both')
    OR public.collab_domain_holder(collab_responsibilities, event_mode, 'operations') IN ('organizer','both')
  )
)
WITH CHECK (
  public.is_event_partner_organizer(auth.uid(), id)
  AND (
    public.collab_domain_holder(collab_responsibilities, event_mode, 'design')     IN ('organizer','both')
    OR public.collab_domain_holder(collab_responsibilities, event_mode, 'operations') IN ('organizer','both')
  )
);

-- 5. Garde-fou colonne par colonne, en deux domaines ---------------------------
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
  -- Ne garder QUE les UPDATE clients directs (PostgREST = rôle `authenticated`).
  -- Les RPC SECURITY DEFINER (signature de contrat, avenants, crons) tournent
  -- sous le rôle propriétaire et sont de confiance.
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF public.is_super_admin() THEN RETURN NEW; END IF;

  IF OLD.partner_organizer_id IS NULL AND OLD.partner_venue_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_is_venue_side := EXISTS (
    SELECT 1 FROM public.venues v WHERE v.id = OLD.venue_id AND v.owner_id = auth.uid());
  v_is_org_side   := (OLD.organizer_user_id = auth.uid() OR OLD.partner_organizer_id = auth.uid());

  IF NOT (v_is_venue_side OR v_is_org_side) THEN RETURN NEW; END IF;
  IF v_is_venue_side AND v_is_org_side THEN RETURN NEW; END IF;
  v_side := CASE WHEN v_is_venue_side THEN 'venue' ELSE 'organizer' END;
  v_is_lead := v_is_venue_side OR (OLD.organizer_user_id = auth.uid());

  -- 5a. STRUCTUREL : l'argent, l'identité des parties, le mode, la répartition
  -- elle-même, le cycle de vie. Ne relève d'aucun domaine — ça se renégocie par
  -- contrat ou par avenant, pas dans un champ de formulaire.
  -- (start_at / end_at ont QUITTÉ cette liste : voir 5c.)
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
    IF NOT v_is_lead THEN
      RAISE EXCEPTION 'Le partenaire ne peut pas modifier le partage, le mode ni la structure de la soirée';
    END IF;
  END IF;

  -- 5b. DESIGN — ce qui habille la soirée et la façon dont elle est montrée.
  IF (NEW.title              IS DISTINCT FROM OLD.title
   OR NEW.description        IS DISTINCT FROM OLD.description
   OR NEW.poster_url         IS DISTINCT FROM OLD.poster_url
   OR NEW.poster_position    IS DISTINCT FROM OLD.poster_position
   OR NEW.image_url          IS DISTINCT FROM OLD.image_url
   OR NEW.banner_position    IS DISTINCT FROM OLD.banner_position
   OR NEW.music_genres       IS DISTINCT FROM OLD.music_genres
   OR NEW.music_genre        IS DISTINCT FROM OLD.music_genre
   OR NEW.event_type         IS DISTINCT FROM OLD.event_type
   OR NEW.visibility         IS DISTINCT FROM OLD.visibility
   OR NEW.is_discoverable    IS DISTINCT FROM OLD.is_discoverable
   OR NEW.discovery_status   IS DISTINCT FROM OLD.discovery_status
   OR NEW.hide_yuno_navigation IS DISTINCT FROM OLD.hide_yuno_navigation
   OR NEW.search_title       IS DISTINCT FROM OLD.search_title)
   AND public.collab_domain_holder(OLD.collab_responsibilities, OLD.event_mode, 'design')
       NOT IN (v_side, 'both')
  THEN
    v_touched := 'design';
  END IF;

  -- 5c. OPÉRATIONS — ce qui fait tourner la soirée. Billetterie, tables, lieu,
  -- accès, ET horaires : celui qui fait tourner la nuit en fixe les heures.
  IF v_touched IS NULL
   AND (NEW.ticketing_enabled      IS DISTINCT FROM OLD.ticketing_enabled
     OR NEW.ticket_selling_mode    IS DISTINCT FROM OLD.ticket_selling_mode
     OR NEW.max_tickets            IS DISTINCT FROM OLD.max_tickets
     OR NEW.max_tickets_per_person IS DISTINCT FROM OLD.max_tickets_per_person
     OR NEW.presale_start_at       IS DISTINCT FROM OLD.presale_start_at
     OR NEW.public_sale_start_at   IS DISTINCT FROM OLD.public_sale_start_at
     OR NEW.rounds_visibility      IS DISTINCT FROM OLD.rounds_visibility
     OR NEW.sale_password_enabled  IS DISTINCT FROM OLD.sale_password_enabled
     OR NEW.waitlist_enabled       IS DISTINCT FROM OLD.waitlist_enabled
     OR NEW.tables_enabled         IS DISTINCT FROM OLD.tables_enabled
     OR NEW.tables_mode            IS DISTINCT FROM OLD.tables_mode
     OR NEW.tables_locked_to_venue IS DISTINCT FROM OLD.tables_locked_to_venue
     OR NEW.tables_owner_user_id   IS DISTINCT FROM OLD.tables_owner_user_id
     OR NEW.minors_disabled        IS DISTINCT FROM OLD.minors_disabled
     OR NEW.alcohol_free           IS DISTINCT FROM OLD.alcohol_free
     OR NEW.location_name          IS DISTINCT FROM OLD.location_name
     OR NEW.location_address       IS DISTINCT FROM OLD.location_address
     OR NEW.location_city          IS DISTINCT FROM OLD.location_city
     OR NEW.location_is_secret     IS DISTINCT FROM OLD.location_is_secret
     OR NEW.reveal_address_in_email IS DISTINCT FROM OLD.reveal_address_in_email
     OR NEW.access_code            IS DISTINCT FROM OLD.access_code
     OR NEW.requires_access_code   IS DISTINCT FROM OLD.requires_access_code
     OR NEW.start_at               IS DISTINCT FROM OLD.start_at
     OR NEW.end_at                 IS DISTINCT FROM OLD.end_at)
   AND public.collab_domain_holder(OLD.collab_responsibilities, OLD.event_mode, 'operations')
       NOT IN (v_side, 'both')
  THEN
    v_touched := 'operations';
  END IF;

  IF v_touched IS NOT NULL THEN
    RAISE EXCEPTION 'Ce domaine (%) est confié à l''autre partie sur cette soirée', v_touched
      USING HINT = 'Proposez un avenant pour déplacer ce domaine.';
  END IF;

  RETURN NEW;
END;
$$;

-- 6. Line-up DJ : gouverné par le DESIGN --------------------------------------
-- Le line-up n'était gouverné par rien : deux jeux de policies indépendants
-- (club d'un côté, organisateur de l'autre) laissaient les deux écrire quoi
-- qu'il arrive. Ajouter un DJ fait partie de l'habillage de la soirée au même
-- titre que l'affiche ou les genres — il suit donc le domaine `design`.
-- Sur une soirée SOLO, collab_domain_holder renvoie 'both' : rien ne change.
DROP POLICY IF EXISTS "Owners can insert event_djs" ON public.event_djs;
DROP POLICY IF EXISTS "Owners can delete event_djs" ON public.event_djs;
DROP POLICY IF EXISTS "Owners can update event_djs" ON public.event_djs;
DROP POLICY IF EXISTS "Organizers can insert event_djs" ON public.event_djs;
DROP POLICY IF EXISTS "Organizers can delete event_djs" ON public.event_djs;
DROP POLICY IF EXISTS "Organizers can update event_djs" ON public.event_djs;

DROP POLICY IF EXISTS "Event design holders manage event_djs" ON public.event_djs;
CREATE POLICY "Event design holders manage event_djs"
ON public.event_djs
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    LEFT JOIN public.venues v ON v.id = e.venue_id OR v.id = e.partner_venue_id
    WHERE e.id = event_djs.event_id
      AND (
        public.is_super_admin()
        OR (v.owner_id = auth.uid()
            AND public.collab_domain_holder(e.collab_responsibilities, e.event_mode, 'design') IN ('venue','both'))
        OR ((e.organizer_user_id = auth.uid() OR e.partner_organizer_id = auth.uid())
            AND public.collab_domain_holder(e.collab_responsibilities, e.event_mode, 'design') IN ('organizer','both'))
        OR public.is_org_team_member(auth.uid(), COALESCE(e.organizer_user_id, e.partner_organizer_id), 'editor')
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.events e
    LEFT JOIN public.venues v ON v.id = e.venue_id OR v.id = e.partner_venue_id
    WHERE e.id = event_djs.event_id
      AND (
        public.is_super_admin()
        OR (v.owner_id = auth.uid()
            AND public.collab_domain_holder(e.collab_responsibilities, e.event_mode, 'design') IN ('venue','both'))
        OR ((e.organizer_user_id = auth.uid() OR e.partner_organizer_id = auth.uid())
            AND public.collab_domain_holder(e.collab_responsibilities, e.event_mode, 'design') IN ('organizer','both'))
        OR public.is_org_team_member(auth.uid(), COALESCE(e.organizer_user_id, e.partner_organizer_id), 'editor')
      )
  )
);

-- 7. Série récurrente : le partenaire édite le design ---------------------------
-- Même policy qu'en 20260720220000, au vocabulaire près. Le jour, les horaires
-- et les termes de la résidence restent au club via
-- protect_recurring_template_from_partner, inchangé : sur une série, les heures
-- sont l'identité du contrat-cadre, pas un réglage opérationnel.
DROP POLICY IF EXISTS "Partner organizers update co-hosted recurring templates" ON public.owner_recurring_templates;
CREATE POLICY "Partner organizers update co-hosted recurring templates"
  ON public.owner_recurring_templates
  FOR UPDATE TO authenticated
  USING (
    partner_organizer_id = auth.uid()
    AND public.collab_domain_holder(collab_responsibilities, COALESCE(collab_mode, 'co_event'), 'design')
        IN ('organizer','both')
  )
  WITH CHECK (
    partner_organizer_id = auth.uid()
    AND public.collab_domain_holder(collab_responsibilities, COALESCE(collab_mode, 'co_event'), 'design')
        IN ('organizer','both')
  );

COMMENT ON COLUMN public.events.collab_responsibilities IS
  'Répartition des domaines entre les deux parties : {"design":"organizer","operations":"venue"}. NULL = préréglage du event_mode (voir default_collab_responsibilities). L''ancien vocabulaire à quatre clés reste lu par collab_domain_holder.';
