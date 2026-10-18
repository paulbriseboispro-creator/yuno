-- Flyer 16:9 de la page soirée (2026-10-16).
--
-- La page d'une soirée Yuno s'ouvre sur une scène 16:9 (EventHeroStage). Le
-- reste de Yuno (cartes, Explore, emails, Wallet, partages) garde l'affiche
-- 1:1 : le flyer large est un visuel À PART, facultatif, qui remplace
-- l'affiche dans le cadre de la page soirée seulement. Sans lui, l'affiche
-- carrée s'y montre entière sur sa copie floutée. Une vidéo, si elle existe,
-- joue par-dessus l'un ou l'autre.
--
-- Même circuit que la vidéo (20260907200000 / 210000) :
--   1. colonne sur events ET sur owner_recurring_templates ;
--   2. recopiée sur chaque occurrence générée, propagée aux dates FUTURES non
--      personnalisées quand le modèle change (trigger : liste de colonnes) ;
--   3. colonne DESIGN des deux gardes de co-soirée (partenaire collab, co-hôte).
--
-- Fonctions réécrites depuis leur définition LIVE (pg_get_functiondef).
-- events a des GRANT de TABLE pour anon / authenticated : la colonne est
-- lisible sans GRANT de colonne.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS flyer_wide_url text;
COMMENT ON COLUMN public.events.flyer_wide_url IS
  'Flyer paysage 16:9 du haut de la page soirée uniquement (repli : poster_url 1:1).';

ALTER TABLE public.owner_recurring_templates
  ADD COLUMN IF NOT EXISTS flyer_wide_url text;
COMMENT ON COLUMN public.owner_recurring_templates.flyer_wide_url IS
  'Flyer 16:9 par défaut, recopié sur chaque occurrence générée (events.flyer_wide_url).';

CREATE OR REPLACE FUNCTION public.generate_recurring_events(p_template_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
            venue_id, organizer_user_id, title, description, poster_url, poster_position, video_url, flyer_wide_url,
            music_genres, music_genre, event_type, start_at, end_at, is_active,
            recurring_template_id, ticketing_enabled, ticket_selling_mode, max_tickets, tables_enabled,
            partner_organizer_id, event_mode, collab_responsibilities,
            revenue_split_rules, revenue_split_proposal, split_proposed_by, split_proposed_at,
            split_approved_by_venue, split_approved_by_organizer, split_locked_at
          ) VALUES (
            tpl.venue_id, tpl.organizer_user_id, tpl.name, tpl.description, tpl.poster_url, tpl.poster_position, tpl.video_url, tpl.flyer_wide_url,
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
            ) ON CONFLICT (event_id) WHERE status <> 'cancelled' DO NOTHING;
          ELSE
            INSERT INTO public.event_collab_contracts (
              event_id, partnership_id, venue_id, organizer_user_id, created_by,
              status, split_rules, cancellation_policy, auto_release_at, responsibilities,
              venue_signed_at, venue_signed_by
            ) VALUES (
              v_event_id, v_partnership, tpl.venue_id, tpl.partner_organizer_id, v_venue_owner,
              'pending_signatures', v_rules, 'pro_rata_refund', v_end_at + interval '2 days', v_resp,
              now(), v_venue_owner
            ) ON CONFLICT (event_id) WHERE status <> 'cancelled' DO NOTHING;
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
$function$;

CREATE OR REPLACE FUNCTION public.propagate_recurring_template_creative()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Rien de créatif n'a bougé → aucun balayage.
  IF NEW.name            IS NOT DISTINCT FROM OLD.name
 AND NEW.description      IS NOT DISTINCT FROM OLD.description
 AND NEW.poster_url       IS NOT DISTINCT FROM OLD.poster_url
 AND NEW.poster_position  IS NOT DISTINCT FROM OLD.poster_position
 AND NEW.video_url        IS NOT DISTINCT FROM OLD.video_url
 AND NEW.flyer_wide_url   IS NOT DISTINCT FROM OLD.flyer_wide_url
 AND NEW.music_genres     IS NOT DISTINCT FROM OLD.music_genres
 AND NEW.event_type       IS NOT DISTINCT FROM OLD.event_type
  THEN
    RETURN NEW;
  END IF;

  -- Occurrences FUTURES seulement : une soirée déjà commencée ou passée garde son
  -- affiche telle que le public l'a vue au moment d'acheter (cohérent avec
  -- l'immuabilité-à-la-vente du reste du modèle collab).
  --
  -- Chaque colonne n'est réécrite QUE si l'occurrence porte encore l'ANCIENNE
  -- valeur du template. Une date dont l'owner a personnalisé l'affiche ou le titre
  -- à la main n'est pas écrasée par une édition de la série.
  UPDATE public.events e
     SET title           = CASE WHEN e.title IS NOT DISTINCT FROM OLD.name
                                THEN NEW.name ELSE e.title END,
         description     = CASE WHEN e.description IS NOT DISTINCT FROM OLD.description
                                THEN NEW.description ELSE e.description END,
         poster_url      = CASE WHEN e.poster_url IS NOT DISTINCT FROM OLD.poster_url
                                THEN NEW.poster_url ELSE e.poster_url END,
         poster_position = CASE WHEN e.poster_position IS NOT DISTINCT FROM OLD.poster_position
                                THEN NEW.poster_position ELSE e.poster_position END,
         video_url       = CASE WHEN e.video_url IS NOT DISTINCT FROM OLD.video_url
                                THEN NEW.video_url ELSE e.video_url END,
         flyer_wide_url  = CASE WHEN e.flyer_wide_url IS NOT DISTINCT FROM OLD.flyer_wide_url
                                THEN NEW.flyer_wide_url ELSE e.flyer_wide_url END,
         music_genres    = CASE WHEN e.music_genres IS NOT DISTINCT FROM OLD.music_genres
                                THEN NEW.music_genres ELSE e.music_genres END,
         music_genre     = CASE WHEN e.music_genres IS NOT DISTINCT FROM OLD.music_genres
                                THEN COALESCE(NEW.music_genres[1], e.music_genre) ELSE e.music_genre END,
         event_type      = CASE WHEN e.event_type IS NOT DISTINCT FROM OLD.event_type
                                THEN NEW.event_type ELSE e.event_type END
   WHERE e.recurring_template_id = NEW.id
     AND e.start_at > now();

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_event_columns_from_cohost()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed text[] := ARRAY[
    -- design
    'title', 'description', 'poster_url', 'image_url', 'poster_position', 'banner_position',
    'music_genre', 'music_genres', 'video_url', 'flyer_wide_url', 'location_logo_url', 'event_type',
    -- ventes au quotidien
    'tickets_sold_out', 'tables_sold_out', 'guest_list_sold_out', 'sold_out_pack_ids',
    'entry_target', 'max_tickets_per_person', 'rounds_visibility', 'waitlist_enabled',
    'presale_start_at', 'public_sale_start_at',
    -- recalculés par d'autres triggers (contrôlés plus bas quand il le faut)
    'updated_at', 'slug', 'search_title', 'is_discoverable', 'discovery_status', 'published_at',
    'alcohol_free'
  ];
BEGIN
  IF current_user <> 'authenticated' OR v_uid IS NULL THEN RETURN NEW; END IF;
  IF public.is_super_admin() THEN RETURN NEW; END IF;
  IF (OLD.organizer_user_id IS NOT NULL
        AND (OLD.organizer_user_id = v_uid OR public.is_org_team_member(v_uid, OLD.organizer_user_id, 'editor')))
     OR (OLD.partner_organizer_id IS NOT NULL
        AND (OLD.partner_organizer_id = v_uid OR public.is_org_team_member(v_uid, OLD.partner_organizer_id, 'editor')))
     OR (OLD.venue_id IS NOT NULL AND public.can_manage_venue(v_uid, OLD.venue_id))
     OR (OLD.partner_venue_id IS NOT NULL AND public.can_manage_venue(v_uid, OLD.partner_venue_id))
     OR OLD.tables_owner_user_id = v_uid
  THEN
    RETURN NEW;
  END IF;
  IF NOT public.is_event_cohost(OLD.id, v_uid, 'editor') THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - v_allowed) IS DISTINCT FROM (to_jsonb(OLD) - v_allowed)
     -- event_mode : 'co_event' sur une soirée solo couperait toutes les ventes.
     -- published_at : rejouerait les annonces « nouvelle soirée ».
     OR (OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at)
     -- Un rejet de découverte est une décision de Yuno, jamais d'un co-hôte.
     OR (NEW.discovery_status = 'rejected' AND OLD.discovery_status IS DISTINCT FROM 'rejected')
  THEN
    RAISE EXCEPTION 'cohost_structural_change'
      USING HINT = 'Un co-hôte peut habiller la soirée et gérer ses ventes, pas en changer la structure.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_event_columns_from_partner()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

  -- COALESCE partout : sur une soirée menée par le club, organizer_user_id est
  -- NULL, et « NULL = uid » rendait v_is_lead NULL — le blocage structurel ne
  -- se déclenchait jamais (le partenaire réécrivait le partage).
  -- Le club = propriétaire OU manager ; l'orga = lui OU son équipe (éditeur+).
  -- Le club LEAD (venue_id) ou le club PARTENAIRE d'une soirée menée par
  -- l'organisateur (partner_venue_id) : les deux sont « côté club ».
  v_is_venue_side := (OLD.venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), OLD.venue_id))
                  OR (OLD.partner_venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), OLD.partner_venue_id));
  v_is_org_side   := COALESCE(OLD.organizer_user_id = auth.uid(), false)
                  OR COALESCE(OLD.partner_organizer_id = auth.uid(), false)
                  OR (COALESCE(OLD.organizer_user_id, OLD.partner_organizer_id) IS NOT NULL
                      AND public.is_org_team_member(auth.uid(), COALESCE(OLD.organizer_user_id, OLD.partner_organizer_id), 'editor'));

  IF NOT (v_is_venue_side OR v_is_org_side) THEN RETURN NEW; END IF;
  IF v_is_venue_side AND v_is_org_side THEN RETURN NEW; END IF;
  v_side := CASE WHEN v_is_venue_side THEN 'venue' ELSE 'organizer' END;
  -- Seul le club qui MÈNE (venue_id) est lead ; un club partenaire ne l'est jamais.
  v_is_lead := (OLD.venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), OLD.venue_id))
            OR COALESCE(OLD.organizer_user_id = auth.uid(), false)
            OR (OLD.organizer_user_id IS NOT NULL
                AND public.is_org_team_member(auth.uid(), OLD.organizer_user_id, 'editor'));

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
   OR NEW.video_url          IS DISTINCT FROM OLD.video_url
   OR NEW.flyer_wide_url     IS DISTINCT FROM OLD.flyer_wide_url
   OR NEW.image_url          IS DISTINCT FROM OLD.image_url
   OR NEW.banner_position    IS DISTINCT FROM OLD.banner_position
   OR NEW.music_genres       IS DISTINCT FROM OLD.music_genres
   OR NEW.music_genre        IS DISTINCT FROM OLD.music_genre
   OR NEW.event_type         IS DISTINCT FROM OLD.event_type
   OR NEW.visibility         IS DISTINCT FROM OLD.visibility
   OR NEW.hide_yuno_navigation IS DISTINCT FROM OLD.hide_yuno_navigation)
   -- is_discoverable / discovery_status sont recalculés par
   -- evaluate_event_discoverability (déclenché AVANT ce garde) à partir de
   -- `visibility`, qui reste dans la liste ; search_title est une colonne
   -- GÉNÉRÉE, indéfinie dans NEW en BEFORE. Les comparer bloquait toute
   -- modification de la partie qui ne tient pas le design.
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
$function$;

DROP TRIGGER IF EXISTS trg_propagate_recurring_template_creative ON public.owner_recurring_templates;
CREATE TRIGGER trg_propagate_recurring_template_creative
  AFTER UPDATE OF name, description, poster_url, poster_position, video_url, flyer_wide_url, music_genres, event_type
  ON public.owner_recurring_templates
  FOR EACH ROW EXECUTE FUNCTION public.propagate_recurring_template_creative();
