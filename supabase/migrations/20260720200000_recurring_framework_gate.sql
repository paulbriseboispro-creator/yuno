-- =============================================================================
-- Contrat-cadre récurrent : réparer les trois fuites du flux « signe une fois ».
--
-- 1. RLS — l'organisateur partenaire ne pouvait PAS lire le template de la série
--    qu'on lui proposait. La policy de 20260613050000 ne connaît que
--    `organizer_user_id = auth.uid()` (série menée par l'orga) et le propriétaire
--    du club ; rien pour `partner_organizer_id`. Dans une résidence menée par un
--    club, le template porte venue_id + partner_organizer_id, donc l'organisateur
--    invité lisait zéro ligne : sa carte de proposition tombait sur les valeurs de
--    repli (« Soirée récurrente », vendredi, 23:00, aucune affiche). Il devait
--    signer un engagement récurrent sans voir ce qu'il signait. Lecture seule —
--    les écritures restent au club.
--
-- 2. generate_recurring_events — un cadre PROPOSÉ mais pas encore signé ne
--    bloquait rien : chaque date naissait quand même en contrat d'occurrence
--    'pending_signatures', déclenchant une notification « nouvelle proposition »
--    PAR DATE. L'organisateur se retrouvait à valider chaque semaine la série
--    même dont on venait de lui envoyer le contrat unique. La génération attend
--    désormais la signature du cadre.
--
-- 3. sign_event_collab_series_contract — conséquence du garde ci-dessus : à la
--    signature, la fonction balayait les occurrences déjà créées mais ne créait
--    pas celles que le garde avait retenues. Elle appelle maintenant la
--    génération, donc les dates apparaissent immédiatement, déjà actives.
--
-- Rien n'est rétroactif sur l'argent : le balayage existant garde ses exclusions
-- (occurrence vendue, split verrouillé, contrat déjà signé individuellement).
-- =============================================================================

-- 1. RLS : lecture du template pour l'organisateur partenaire ------------------
DROP POLICY IF EXISTS "Partner organizers read co-hosted recurring templates" ON public.owner_recurring_templates;
CREATE POLICY "Partner organizers read co-hosted recurring templates"
  ON public.owner_recurring_templates
  FOR SELECT TO authenticated
  USING (partner_organizer_id = auth.uid());

-- 2. Génération gelée tant que le contrat-cadre n'est pas signé ----------------
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
  v_series_pending boolean;
BEGIN
  IF p_template_id IS NOT NULL AND auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.owner_recurring_templates t
      WHERE t.id = p_template_id AND (
        t.organizer_user_id = auth.uid()
        -- L'organisateur partenaire est partie à la série : sans lui ici, la
        -- génération relancée par sa signature du contrat-cadre lèverait
        -- « Not authorized » et annulerait la signature entière.
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
    v_venue_owner := NULL; v_partnership := NULL; v_rules := NULL;
    v_series_active := false; v_series_pending := false;
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
      IF v_series_active THEN
        v_rules := v_series.split_rules;
      ELSE
        -- Un cadre proposé mais pas encore signé GÈLE la génération de la série.
        -- Sans ce garde, chaque date naîtrait en contrat d'occurrence
        -- 'pending_signatures' et notifierait l'organisateur une fois PAR DATE —
        -- exactement ce que le contrat-cadre existe pour supprimer. Les dates
        -- naîtront à la signature, qui rappelle cette fonction.
        SELECT EXISTS (
          SELECT 1 FROM public.event_collab_series_contracts s2
           WHERE s2.template_id = tpl.id
             AND s2.status IN ('draft','pending_signatures')
        ) INTO v_series_pending;
      END IF;
    END IF;
    IF v_series_pending THEN CONTINUE; END IF;
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
GRANT EXECUTE ON FUNCTION public.generate_recurring_events(uuid) TO authenticated;

-- 3. La signature du cadre génère les dates retenues ---------------------------
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

  -- Le cadre est actif : générer les dates que le garde de
  -- generate_recurring_events retenait tant qu'il n'était pas signé. Elles
  -- naissent directement actives, sans repasser par une proposition par date.
  PERFORM public.generate_recurring_events(c.template_id);

  RETURN 'active';
END; $$;

GRANT EXECUTE ON FUNCTION public.sign_event_collab_series_contract(uuid, text, text, text) TO authenticated;
