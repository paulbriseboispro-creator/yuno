-- ============================================================================
-- P0-2 — Réparer les soirées CO-EVENT récurrentes.
--
-- BUG : generate_recurring_events insérait chaque occurrence co-event avec
--   split_approved_by_venue = true, split_approved_by_organizer = true,
--   split_locked_at = now()
-- … MAIS sans jamais créer de event_collab_contracts et sans revenue_split_proposal.
-- Conséquences :
--   - l'event naissait « verrouillé » avant toute vente (split_locked_at) ;
--   - le cycle de vie du contrat (pending → active → locked) était court-circuité :
--     create/sign_event_collab_contract refusaient l'event (déjà approuvé / pas
--     d'état pending), donc impossible de signer un vrai contrat ;
--   - le CONTRACT GUARD se comportait de façon incohérente.
--
-- FIX (forward) : pour une occurrence co-event, on respecte le cycle de vie :
--   - revenue_split_rules = NULL (activé à la double signature seulement) ;
--   - revenue_split_proposal = règles du template (boissons forcées 100% club) ;
--   - split_approved_by_venue = true (le club a pré-signé en créant le template) ;
--   - split_approved_by_organizer = false (l'orga signe chaque occurrence) ;
--   - split_locked_at = NULL (verrou uniquement à la 1re vente) ;
--   - création d'un event_collab_contracts en 'pending_signatures', club pré-signé.
-- Les ventes restent bloquées par le GUARD jusqu'à la signature de l'orga.
--
-- NB : signer chaque occurrence d'une résidence est volontairement explicite (P0).
-- Un futur P1 pourra ajouter un « consentement permanent » au niveau du partenariat.
-- ============================================================================

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
    -- Résolution co-event (une fois par template) : owner du club (pour pré-signer),
    -- partenariat actif, et règles de partage (boissons forcées 100% club).
    v_venue_owner := NULL; v_partnership := NULL; v_rules := NULL;
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
    END IF;
    -- co-event exploitable seulement si on peut pré-signer côté club
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
          NULL,                                                  -- revenue_split_rules (activé à la double signature)
          CASE WHEN v_is_co THEN v_rules END,                    -- revenue_split_proposal
          CASE WHEN v_is_co THEN v_venue_owner END,              -- split_proposed_by
          CASE WHEN v_is_co THEN now() END,                      -- split_proposed_at
          v_is_co,                                               -- split_approved_by_venue (club pré-signe le template)
          false,                                                 -- split_approved_by_organizer (l'orga signe l'occurrence)
          NULL                                                   -- split_locked_at (verrou à la 1re vente)
        )
        RETURNING id INTO v_event_id;

        -- Contrat de collaboration en attente de signature (club pré-signé).
        IF v_is_co THEN
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

-- ============================================================================
-- Réparation conservatrice des occurrences DÉJÀ générées par l'ancienne logique.
-- Cible STRICTE : co-event récurrent, à venir (start_at > now()), SANS aucune vente
-- (aucune ligne revenue_distributions), et dont le contrat est soit absent soit le
-- contrat SYNTHÉTIQUE de backfill (terms_snapshot->>'backfilled' = 'true', jamais
-- réellement signé). On remet ces occurrences dans le cycle pending → signature.
-- On ne touche JAMAIS un event ayant vendu ni un contrat réellement signé.
-- ============================================================================
DO $$
DECLARE
  r record;
  v_owner uuid;
  v_rules jsonb;
  v_part uuid;
BEGIN
  FOR r IN
    SELECT e.id, e.venue_id, e.partner_organizer_id, e.revenue_split_rules, e.start_at, e.end_at
    FROM public.events e
    WHERE e.recurring_template_id IS NOT NULL
      AND e.partner_organizer_id IS NOT NULL
      AND e.venue_id IS NOT NULL
      AND e.start_at > now()
      AND e.split_locked_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.revenue_distributions rd WHERE rd.event_id = e.id)
      AND (
        NOT EXISTS (SELECT 1 FROM public.event_collab_contracts c WHERE c.event_id = e.id)
        OR EXISTS (
          SELECT 1 FROM public.event_collab_contracts c
          WHERE c.event_id = e.id AND c.terms_snapshot->>'backfilled' = 'true'
        )
      )
  LOOP
    SELECT owner_id INTO v_owner FROM public.venues WHERE id = r.venue_id;
    IF v_owner IS NULL THEN CONTINUE; END IF;

    v_rules := COALESCE(r.revenue_split_rules, jsonb_build_object(
      'tickets', jsonb_build_object('organizer_pct', 50, 'venue_pct', 50),
      'tables',  jsonb_build_object('organizer_pct', 0,  'venue_pct', 100),
      'drinks',  jsonb_build_object('organizer_pct', 0,  'venue_pct', 100)));
    v_rules := jsonb_set(v_rules, '{drinks}', jsonb_build_object('organizer_pct', 0, 'venue_pct', 100));

    SELECT id INTO v_part FROM public.venue_organizer_partnerships
      WHERE venue_id = r.venue_id AND organizer_user_id = r.partner_organizer_id
        AND status = 'active' LIMIT 1;

    -- Supprime le contrat synthétique de backfill (jamais réellement signé).
    DELETE FROM public.event_collab_contracts c
      WHERE c.event_id = r.id AND c.terms_snapshot->>'backfilled' = 'true';

    -- Recrée un contrat en attente de signature (club pré-signe les termes du template).
    INSERT INTO public.event_collab_contracts (
      event_id, partnership_id, venue_id, organizer_user_id, created_by,
      status, split_rules, cancellation_policy, auto_release_at,
      venue_signed_at, venue_signed_by
    ) VALUES (
      r.id, v_part, r.venue_id, r.partner_organizer_id, v_owner,
      'pending_signatures', v_rules, 'pro_rata_refund', COALESCE(r.end_at, r.start_at) + interval '2 days',
      now(), v_owner
    ) ON CONFLICT (event_id) DO NOTHING;

    -- Réinitialise les colonnes events pour le GUARD (ventes bloquées jusqu'à signature orga).
    UPDATE public.events SET
      revenue_split_rules = NULL,
      revenue_split_proposal = v_rules,
      split_proposed_by = v_owner,
      split_proposed_at = now(),
      split_approved_by_venue = true,
      split_approved_by_organizer = false,
      split_locked_at = NULL
    WHERE id = r.id;
  END LOOP;
END $$;
