-- =============================================================================
-- Co-soirée récurrente : adopter les occurrences DÉJÀ générées quand une série
-- solo devient une collab.
--
-- LE BUG (constaté en prod sur la série « Amore Night » / womber) :
--   08:33:31.857  le club crée la série SANS partenaire.
--   08:33:32.007  RecurringEventsManager appelle generate_recurring_events →
--                 l'occurrence du mercredi suivant naît `solo_venue`,
--                 partner_organizer_id NULL, sans event_collab_contracts.
--   09:00:22      le club rouvre la série, attache l'organisateur et propose le
--                 contrat-cadre (flux « demander une collab APRÈS la création »).
--   11:45:07      l'organisateur signe → le cadre passe `active`.
--
--   Sauf que rien ne rattrape l'occurrence déjà née solo :
--     - generate_recurring_events fait CONTINUE sur toute date qui a déjà un
--       event, donc il ne la repeint jamais ;
--     - les trois balayages de sign_event_collab_series_contract sont tous
--       filtrés sur `e.partner_organizer_id = c.organizer_user_id`, et cette
--       colonne est justement restée NULL.
--
--   Résultat : cadre « Actif · auto-accepté » des deux côtés, et pourtant
--   CO-SOIRÉES (0) chez l'organisateur — la seule date de la fenêtre
--   (advance_days = 7) est invisible pour lui, sans aucun message d'erreur. La
--   série ne se répare toute seule qu'à la semaine suivante, quand une date
--   encore non générée naît enfin co_event.
--
-- LE CORRECTIF : generate_recurring_events ne fait plus un CONTINUE aveugle sur
-- une date déjà générée. Si la série est devenue une collab et que l'occurrence
-- est restée solo, il l'ADOPTE — mêmes branches, mêmes termes, même contrat que
-- s'il venait de la créer. C'est le seul point de passage commun à tous les flux
-- (sauvegarde d'une série dans l'UI, cron nocturne, signature du cadre), donc le
-- corriger là les couvre tous d'un coup.
--
-- GARDE-FOU VENTES : on n'adopte qu'une occurrence FUTURE et VIERGE. Le verrou
-- habituel (split_locked_at + revenue_distributions) ne suffit pas ici :
-- lock_event_split_on_first_sale ne verrouille que si revenue_split_rules IS NOT
-- NULL, or une occurrence solo n'en a pas. Une soirée solo déjà vendue passerait
-- donc le filtre et verrait sa recette rétroactivement partagée avec un
-- organisateur absent au moment de la vente. On teste donc explicitement les
-- billets et les tables payés.
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
  v_existing public.events%ROWTYPE;
  v_adopted boolean;
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
        v_close_next_day := tpl.end_time <= tpl.start_time;
        v_start_at := (d + tpl.start_time) AT TIME ZONE 'Europe/Paris';
        v_end_at := ((d + (CASE WHEN v_close_next_day THEN 1 ELSE 0 END)::int) + tpl.end_time) AT TIME ZONE 'Europe/Paris';

        v_existing := NULL;
        SELECT * INTO v_existing FROM public.events e
         WHERE e.recurring_template_id = tpl.id
           AND (e.start_at AT TIME ZONE 'Europe/Paris')::date = d
         LIMIT 1;

        IF v_existing.id IS NOT NULL THEN
          -- La date existe déjà. Le seul cas où on y retouche : la série est
          -- devenue une collab et cette occurrence est restée solo. Toute autre
          -- occurrence (déjà co, passée, verrouillée, vendue) garde ses termes.
          IF NOT (
            v_is_co
            AND v_existing.partner_organizer_id IS NULL
            AND v_existing.start_at > now()
            AND v_existing.split_locked_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM public.revenue_distributions rd WHERE rd.event_id = v_existing.id)
            AND NOT EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id = v_existing.id AND t.paid_at IS NOT NULL)
            AND NOT EXISTS (SELECT 1 FROM public.table_reservations tr WHERE tr.event_id = v_existing.id AND tr.paid_at IS NOT NULL)
          ) THEN
            CONTINUE;
          END IF;

          -- Adoption : exactement l'état que l'INSERT plus bas aurait produit.
          UPDATE public.events e
             SET partner_organizer_id        = tpl.partner_organizer_id,
                 event_mode                  = v_mode,
                 collab_responsibilities     = v_resp,
                 revenue_split_rules         = CASE WHEN v_series_active THEN v_rules END,
                 revenue_split_proposal      = CASE WHEN NOT v_series_active THEN v_rules END,
                 split_proposed_by           = CASE WHEN NOT v_series_active THEN v_venue_owner END,
                 split_proposed_at           = CASE WHEN NOT v_series_active THEN now() END,
                 split_approved_by_venue     = (NOT v_series_active),
                 split_approved_by_organizer = false
           WHERE e.id = v_existing.id;

          v_event_id := v_existing.id;
          v_adopted := true;
        ELSE
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

          v_adopted := false;
        END IF;

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

        -- Une occurrence adoptée a déjà ses rounds : on ne les recrée pas, et
        -- elle ne compte pas comme « générée » (le compteur reste le nombre de
        -- dates nouvellement ouvertes).
        IF NOT v_adopted THEN
          v_position := 0;
          IF v_ticket_preset.id IS NOT NULL THEN
            v_position := v_position + public._insert_recurring_rounds(v_event_id, v_ticket_preset.id, v_position);
          END IF;
          IF v_vip_preset.id IS NOT NULL THEN
            PERFORM public._insert_recurring_rounds(v_event_id, v_vip_preset.id, v_position);
          END IF;

          v_generated := v_generated + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'generate_recurring_events: template % / date %: %', tpl.id, d, SQLERRM;
      END;
    END LOOP;
  END LOOP;

  RETURN v_generated;
END;
$$;
GRANT EXECUTE ON FUNCTION public.generate_recurring_events(uuid) TO authenticated;

COMMENT ON FUNCTION public.generate_recurring_events(uuid) IS
  'Génère les occurrences d''une série récurrente sur la fenêtre advance_days. Une date déjà générée est ADOPTÉE (passage en co-soirée + contrat) si la série est devenue une collab depuis, tant que l''occurrence est future et n''a rien vendu ; sinon elle est laissée telle quelle.';

-- Rattrapage des séries déjà cassées en prod (dont « Amore Night » / womber) :
-- l'appel sans argument est exactement ce que le cron nocturne exécute.
SELECT public.generate_recurring_events();
