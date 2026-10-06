-- Yuno CRM × Shotgun : deux trous trouvés avant le premier branchement réel
-- (2026-10-06, audit du message à Osmoz). Aucun compte Shotgun réel n'a encore
-- été connecté : ticketing_sync_runs est vide, la démo est semée en SQL.
--
-- 1. Une désinscription faite CHEZ SHOTGUN n'était jamais lue : le connecteur
--    versait l'accord (contact_newsletter_optin = true) mais ignorait le
--    retrait (false = désinscrit, null = jamais demandé, d'après la référence
--    de l'API). Règle : ce que la billetterie a donné, elle peut le reprendre.
--    Le signal le PLUS RÉCENT de chaque acheteur gagne (billet le plus
--    récemment mis à jour) ; un retrait postérieur à l'accord retire du
--    registre un abonné dont l'accord venait du connecteur
--    (source « connector:% ») et le trace dans marketing_consent_events.
--    Un accord donné ailleurs (page d'inscription Yuno, fichier attesté) n'est
--    jamais effacé par une case décochée au checkout : la personne garde le
--    lien de désinscription de chaque e-mail. Un acheteur dont le dernier
--    signal est un retrait n'entre plus au registre.
--
-- 2. Les envois automatiques d'un compte CRM sont payés en Yunits par LOT
--    (trigger _crm_yunits_debit_child_recipients) : un solde plus petit que le
--    lot écartait TOUT le lot (« yunits »), et le registre interdisait de le
--    rejouer : ces personnes ne recevaient jamais l'e-mail, même après une
--    recharge. Le moteur ne prend désormais dans un lot que ce que le solde
--    couvre (compte en pause = 0) ; le reste n'est pas inscrit au registre et
--    revient au passage suivant. Le trigger reste le filet.

-- ── 1. Accord ET retrait rapportés par la billetterie ─────────────────────
CREATE OR REPLACE FUNCTION public.ticketing_after_sync(p_connection_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.ticketing_connections%ROWTYPE;
  x RECORD;
  v_event uuid;
  v_end timestamptz;
  v_created integer := 0;
  v_updated integer := 0;
  v_linked integer := 0;
  v_consent integer := 0;
  v_withdrawn integer := 0;
  v_n integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'ticketing_after_sync: service_role only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.ticketing_connections WHERE id = p_connection_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'unknown_connection'); END IF;

  -- 3a. Soirées miroir (création ou mise à jour de ce qui a changé).
  FOR x IN
    SELECT ee.*, ev.id AS mirror_id
      FROM public.external_events ee
      LEFT JOIN public.events ev ON ev.id = ee.event_id
     WHERE ee.connection_id = p_connection_id
       AND ee.start_at IS NOT NULL
  LOOP
    v_end := CASE WHEN x.end_at IS NOT NULL AND x.end_at > x.start_at THEN x.end_at
                  ELSE x.start_at + interval '6 hours' END;
    IF x.mirror_id IS NULL THEN
      INSERT INTO public.events (
        venue_id, organizer_user_id, title, start_at, end_at, description, image_url, poster_url,
        music_genres, music_genre, location_address, location_city, timezone, published_at,
        status, cancelled_at, tickets_sold_out, event_kind, external_source, external_ticket_url,
        is_active, visibility, ticketing_enabled, tables_enabled
      ) VALUES (
        c.venue_id, c.organizer_user_id, COALESCE(NULLIF(btrim(x.name), ''), 'Soirée'), x.start_at, v_end,
        x.description, x.cover_url, x.cover_url,
        x.genres, COALESCE(x.genres[1], 'Open Format'), x.street, x.city, x.timezone, x.published_at,
        CASE WHEN x.cancelled_at IS NOT NULL THEN 'cancelled' ELSE 'active' END, x.cancelled_at,
        COALESCE(x.left_tickets = 0, false),
        (CASE WHEN c.venue_id IS NOT NULL THEN 'club_event' ELSE 'organizer_event' END)::public.event_kind,
        x.provider, x.url, false, 'private', false, false
      ) RETURNING id INTO v_event;
      UPDATE public.external_events SET event_id = v_event WHERE id = x.id;
      -- Line-up : artistes sans compte Yuno, posés une fois (modèle invité).
      INSERT INTO public.event_guest_artists (event_id, name, photo_url, position)
      SELECT v_event, left(a->>'name', 120), NULLIF(a->>'avatar', ''), (ord - 1)::integer
        FROM jsonb_array_elements(COALESCE(x.artists, '[]'::jsonb)) WITH ORDINALITY AS t(a, ord)
       WHERE NULLIF(btrim(a->>'name'), '') IS NOT NULL
       LIMIT 40;
      v_created := v_created + 1;
    ELSE
      UPDATE public.events e SET
        title = COALESCE(NULLIF(btrim(x.name), ''), e.title),
        start_at = x.start_at,
        end_at = v_end,
        description = COALESCE(x.description, e.description),
        image_url = COALESCE(x.cover_url, e.image_url),
        poster_url = COALESCE(x.cover_url, e.poster_url),
        music_genres = CASE WHEN cardinality(x.genres) > 0 THEN x.genres ELSE e.music_genres END,
        location_address = COALESCE(x.street, e.location_address),
        location_city = COALESCE(x.city, e.location_city),
        timezone = COALESCE(x.timezone, e.timezone),
        published_at = COALESCE(x.published_at, e.published_at),
        status = CASE WHEN x.cancelled_at IS NOT NULL THEN 'cancelled' ELSE 'active' END,
        cancelled_at = x.cancelled_at,
        tickets_sold_out = COALESCE(x.left_tickets = 0, false),
        external_ticket_url = COALESCE(x.url, e.external_ticket_url)
      WHERE e.id = x.mirror_id
        AND (e.title IS DISTINCT FROM COALESCE(NULLIF(btrim(x.name), ''), e.title)
          OR e.start_at IS DISTINCT FROM x.start_at OR e.end_at IS DISTINCT FROM v_end
          OR e.cancelled_at IS DISTINCT FROM x.cancelled_at
          OR e.tickets_sold_out IS DISTINCT FROM COALESCE(x.left_tickets = 0, false)
          OR e.published_at IS DISTINCT FROM COALESCE(x.published_at, e.published_at)
          OR e.image_url IS DISTINCT FROM COALESCE(x.cover_url, e.image_url)
          OR e.external_ticket_url IS DISTINCT FROM COALESCE(x.url, e.external_ticket_url));
          -- Les genres ne déclenchent pas de mise à jour : trg_canonical_genres
          -- les réécrit au vocabulaire Yuno, ils ne seraient jamais « égaux ».
          -- Ils suivent quand un autre champ change.
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_updated := v_updated + v_n;
    END IF;
  END LOOP;

  -- 3b. Billets → soirée miroir.
  UPDATE public.external_tickets t
     SET event_id = ee.event_id
    FROM public.external_events ee
   WHERE t.connection_id = p_connection_id
     AND ee.connection_id = p_connection_id
     AND ee.external_id = t.external_event_id
     AND ee.event_id IS NOT NULL
     AND t.event_id IS DISTINCT FROM ee.event_id;
  GET DIAGNOSTICS v_linked = ROW_COUNT;

  -- 3c. Accord newsletter rapporté par la billetterie → registre de la portée.
  --     Jamais un désabonné (la ligne existe : on n'y touche pas), jamais une
  --     adresse purgée (email_opt_outs) ni supprimée (bounce, plainte), jamais
  --     un acheteur dont le DERNIER signal chez la billetterie est un retrait.
  IF c.venue_id IS NOT NULL THEN
    INSERT INTO public.newsletter_subscriptions
      (venue_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
    SELECT DISTINCT ON (lower(t.buyer_email))
           c.venue_id, lower(t.buyer_email), true, 'connector:' || c.provider, 'ticketing',
           COALESCE(t.purchased_at, t.first_seen_at), t.buyer_first_name, t.buyer_last_name
      FROM public.external_tickets t
     WHERE t.connection_id = p_connection_id
       AND t.newsletter_optin IS TRUE
       AND t.buyer_email IS NOT NULL
       AND t.status IN ('valid', 'transferred')
       AND NOT public.is_email_suppressed(t.buyer_email)
       AND NOT EXISTS (SELECT 1 FROM public.email_opt_outs o
                        WHERE o.venue_id = c.venue_id AND lower(o.email) = lower(t.buyer_email))
       AND NOT EXISTS (
         SELECT 1 FROM (
           SELECT t2.newsletter_optin FROM public.external_tickets t2
            WHERE t2.connection_id = p_connection_id AND lower(t2.buyer_email) = lower(t.buyer_email)
              AND t2.newsletter_optin IS NOT NULL
            ORDER BY COALESCE(t2.source_updated_at, t2.purchased_at, t2.first_seen_at) DESC NULLS LAST
            LIMIT 1) z
          WHERE z.newsletter_optin IS FALSE)
     ORDER BY lower(t.buyer_email), t.purchased_at DESC NULLS LAST
    ON CONFLICT (lower(email), venue_id) WHERE venue_id IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_consent = ROW_COUNT;
  ELSIF c.organizer_user_id IS NOT NULL THEN
    INSERT INTO public.newsletter_subscriptions
      (organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
    SELECT DISTINCT ON (lower(t.buyer_email))
           c.organizer_user_id, lower(t.buyer_email), true, 'connector:' || c.provider, 'ticketing',
           COALESCE(t.purchased_at, t.first_seen_at), t.buyer_first_name, t.buyer_last_name
      FROM public.external_tickets t
     WHERE t.connection_id = p_connection_id
       AND t.newsletter_optin IS TRUE
       AND t.buyer_email IS NOT NULL
       AND t.status IN ('valid', 'transferred')
       AND NOT public.is_email_suppressed(t.buyer_email)
       AND NOT EXISTS (SELECT 1 FROM public.email_opt_outs o
                        WHERE o.organizer_user_id = c.organizer_user_id AND lower(o.email) = lower(t.buyer_email))
       AND NOT EXISTS (
         SELECT 1 FROM (
           SELECT t2.newsletter_optin FROM public.external_tickets t2
            WHERE t2.connection_id = p_connection_id AND lower(t2.buyer_email) = lower(t.buyer_email)
              AND t2.newsletter_optin IS NOT NULL
            ORDER BY COALESCE(t2.source_updated_at, t2.purchased_at, t2.first_seen_at) DESC NULLS LAST
            LIMIT 1) z
          WHERE z.newsletter_optin IS FALSE)
     ORDER BY lower(t.buyer_email), t.purchased_at DESC NULLS LAST
    ON CONFLICT (lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_consent = ROW_COUNT;
  END IF;

  -- 3d. Désinscription rapportée par la billetterie : l'accord qu'ELLE avait
  --     donné (source connector:%) est retiré quand son DERNIER signal pour
  --     cette personne est un retrait postérieur à l'accord. Tracé.
  WITH g AS (
    SELECT DISTINCT ON (lower(t.buyer_email))
           lower(t.buyer_email) AS em, t.newsletter_optin AS opt,
           COALESCE(t.source_updated_at, t.purchased_at, t.first_seen_at) AS at
      FROM public.external_tickets t
     WHERE t.connection_id = p_connection_id
       AND t.buyer_email IS NOT NULL
       AND t.newsletter_optin IS NOT NULL
     ORDER BY lower(t.buyer_email), COALESCE(t.source_updated_at, t.purchased_at, t.first_seen_at) DESC NULLS LAST
  ),
  off AS (
    UPDATE public.newsletter_subscriptions s
       SET opted_in = false, opted_out_at = now()
      FROM g
     WHERE g.opt IS FALSE
       AND lower(s.email) = g.em
       AND ((c.venue_id IS NOT NULL AND s.venue_id = c.venue_id)
         OR (c.venue_id IS NULL AND c.organizer_user_id IS NOT NULL AND s.organizer_user_id = c.organizer_user_id))
       AND s.opted_in AND s.opted_out_at IS NULL
       AND COALESCE(s.source, '') LIKE 'connector:%'
       AND (s.consent_recorded_at IS NULL OR g.at IS NULL OR g.at > s.consent_recorded_at)
    RETURNING s.email, s.user_id
  ),
  logged AS (
    INSERT INTO public.marketing_consent_events
      (user_id, email, channel, venue_id, organizer_user_id, action, wording_key, wording_text, source)
    SELECT o.user_id, lower(o.email), 'email', c.venue_id, CASE WHEN c.venue_id IS NULL THEN c.organizer_user_id END,
           'withdrawn', 'connector_newsletter_optout',
           'Désinscription de la newsletter rapportée par la billetterie (' || c.provider || ')',
           'connector:' || c.provider
      FROM off o
    RETURNING 1
  )
  SELECT count(*) INTO v_withdrawn FROM logged;

  RETURN jsonb_build_object('events_created', v_created, 'events_updated', v_updated,
                            'tickets_linked', v_linked, 'consents_added', v_consent,
                            'consents_withdrawn', v_withdrawn);
END;
$function$;

-- ── 2. Moteur : un lot n'excède jamais le solde de Yunits ────────────────
CREATE OR REPLACE FUNCTION public.collect_email_automations()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a RECORD;
  tpl RECORD;
  grp RECORD;
  v_delay interval;
  v_next uuid;
  v_child uuid;
  v_new integer;
  v_queued integer := 0;
  v_skipped integer := 0;
  v_enqueued integer := 0;
  v_automations integer := 0;
  v_children uuid[] := '{}';
  v_blocks jsonb;
  v_name text;
  v_label text;
  v_platform boolean;
  -- Une recette « à toute la base » travaille par LOTS : une personne déjà
  -- inscrite au registre pour ce déclencheur n'est plus candidate, le passage
  -- suivant (5 min plus tard) prend le lot suivant. Avant, le LIMIT tombait
  -- AVANT ce filtre : les 5 000 premiers revenaient à chaque passage et le
  -- reste de la base ne recevait jamais rien.
  v_batch constant integer := 3000;
  -- L'appel passe par l'API (plafond de 8 s) : au-delà de ce budget, les
  -- recettes restantes attendent le passage suivant plutôt que de faire
  -- tomber TOUT le passage (et les recettes de tous les comptes avec lui).
  v_started timestamptz := clock_timestamp();
  v_budget_hit boolean := false;
  -- Compte Yuno CRM pur : les e-mails automatiques se paient en Yunits. Ce que
  -- le solde ne couvre pas n'est pas inscrit au registre (il reviendra).
  v_scope text;
  v_rate integer;
  v_room integer;
  v_held integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'collect_email_automations: service_role only';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _auto_cand (
    em text,
    trigger_key text,
    trigger_event_id uuid,
    bind_event_id uuid,
    due_at timestamptz,
    optin boolean,
    user_id uuid,
    first_name text,
    last_name text,
    -- Ordre de priorité entre plusieurs soirées d'un même contact dans un
    -- même passage (la plus proche d'abord) : voir le cooldown intra-passage.
    ord timestamptz
  ) ON COMMIT DROP;

  -- Les pros d'abord, Yuno en dernier : à soirée égale, le pro passe avant (R5).
  -- Puis par PRIORITÉ de recette : un contact ne reçoit qu'une automatisation
  -- par passage (cooldown), c'est donc l'ordre ci-dessous qui décide laquelle —
  -- l'urgent (panier, tarif) avant la relation (merci, on t'a manqué), la vente
  -- (table, dernier appel, annonce) avant l'accueil (bienvenue, reconquête).
  FOR a IN
    SELECT x.*, (x.venue_id IS NULL AND x.organizer_user_id IS NULL) AS is_platform
      FROM public.email_automations x
     WHERE x.enabled AND x.template_id IS NOT NULL AND x.enabled_at IS NOT NULL
       -- Démo : une recette allumée s'affiche, elle n'envoie JAMAIS.
       AND NOT public.is_demo_marketing_scope(x.venue_id, x.organizer_user_id)
     ORDER BY (x.venue_id IS NULL AND x.organizer_user_id IS NULL),
              CASE x.kind
                WHEN 'abandoned_checkout' THEN 0 WHEN 'tier_closing' THEN 1 WHEN 'click_no_buy' THEN 1
                WHEN 'post_event_thanks' THEN 2 WHEN 'post_event_missed' THEN 3
                WHEN 'table_upsell' THEN 4 WHEN 'last_call' THEN 5 WHEN 'new_event' THEN 6
                WHEN 'regular_lapse' THEN 7 WHEN 'welcome' THEN 8 ELSE 9 END,
              x.created_at
  LOOP
    v_platform := a.is_platform;
    -- Les recettes de SOIRÉE n'ont pas de sens à l'échelle de Yuno : pas de
    -- dernier appel, d'annonce, de palier ni d'upsell à toute la base pour
    -- chaque soirée de chaque club.
    -- « L'habitué décroche » non plus : un rythme de sortie se lit chez UN
    -- club ou UN organisateur, pas sur toute la plateforme.
    IF v_platform AND a.kind IN ('last_call', 'new_event', 'tier_closing', 'table_upsell', 'regular_lapse', 'click_no_buy') THEN CONTINUE; END IF;
    IF clock_timestamp() - v_started > interval '4 seconds' THEN
      v_budget_hit := true;
      EXIT;
    END IF;
    v_automations := v_automations + 1;
    v_delay := make_interval(hours => a.delay_hours);
    v_next := CASE WHEN v_platform THEN NULL ELSE public._email_automation_next_event(a.venue_id, a.organizer_user_id) END;
    TRUNCATE _auto_cand;
    v_room := NULL;
    IF NOT v_platform THEN
      v_scope := public.crm_scope_key(a.venue_id, a.organizer_user_id);
      IF v_scope IS NOT NULL AND public.crm_scope_is_crm(v_scope) THEN
        IF public.crm_effective_plan(v_scope) = 'paused' THEN
          v_room := 0;
        ELSE
          v_rate := GREATEST(1, COALESCE((public.crm_pricing_config()->'rates'->>'email')::integer, 1));
          v_room := GREATEST(0, COALESCE(public.crm_yunits_balance(v_scope), 0) / v_rate
                    - (SELECT count(*)::integer FROM public.email_automation_sends l
                        WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL));
        END IF;
      END IF;
    END IF;

    -- ── 5a. Candidats par recette ─────────────────────────────────────────
    IF a.kind = 'welcome' THEN
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT lower(s.email), 'once', NULL, v_next, s.created_at + v_delay, true, s.user_id, s.first_name, s.last_name, s.created_at + v_delay
        FROM public.newsletter_subscriptions s
       WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
         AND s.opted_in AND s.opted_out_at IS NULL
         AND s.import_id IS NULL
         AND COALESCE(s.source, '') NOT LIKE 'import%'
         AND (v_platform OR COALESCE(s.source, '') NOT LIKE 'platform%')
         AND COALESCE(s.source, '') NOT LIKE 'checkout%'
         -- Yuno CRM : un accord rapporté par une billetterie connectée n'est pas
         -- une inscription : jamais de « bienvenue » à tout un historique importé.
         AND COALESCE(s.source, '') NOT LIKE 'connector%'
         AND COALESCE(s.source, '') NOT LIKE 'platform:checkout%'
         AND s.created_at >= a.enabled_at
         AND s.created_at >= now() - interval '14 days'
         AND s.created_at + v_delay <= now()
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = 'once' AND lower(l.email) = lower(s.email))
       LIMIT 500;

    ELSIF a.kind = 'abandoned_checkout' THEN
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT DISTINCT ON (lower(x.em), x.event_id)
             lower(x.em), x.event_id::text, x.event_id, x.event_id, x.created_at + v_delay,
             x.optin, x.user_id, x.first_name, x.last_name, x.created_at + v_delay
        FROM (
          SELECT t.user_email AS em, t.event_id, t.created_at, COALESCE(t.newsletter_opt_in, false) AS optin, t.user_id,
                 COALESCE(t.guest_first_name, NULLIF(split_part(btrim(COALESCE(t.full_name, '')), ' ', 1), '')) AS first_name,
                 COALESCE(t.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(t.full_name, ''), '^\S+\s*', '')), '')) AS last_name
            FROM public.tickets t
            JOIN public.events e ON e.id = t.event_id
           WHERE t.status = 'pending' AND t.user_email IS NOT NULL
             AND (v_platform
               OR (a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
               OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
             AND (NOT v_platform OR NOT (e.id = ANY (public.demo_event_ids())))
             AND t.created_at >= a.enabled_at
             AND t.created_at BETWEEN now() - interval '48 hours' AND now() - v_delay
             AND e.start_at > now() + interval '1 hour'
          UNION ALL
          SELECT r.user_email, r.event_id, r.created_at, COALESCE(r.newsletter_opt_in, false), r.user_id,
                 COALESCE(r.guest_first_name, NULLIF(split_part(btrim(COALESCE(r.full_name, '')), ' ', 1), '')),
                 COALESCE(r.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(r.full_name, ''), '^\S+\s*', '')), ''))
            FROM public.table_reservations r
            JOIN public.events e ON e.id = r.event_id
           WHERE r.status = 'pending' AND r.user_email IS NOT NULL
             AND (v_platform
               OR (a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
               OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
             AND (NOT v_platform OR NOT (e.id = ANY (public.demo_event_ids())))
             AND r.created_at >= a.enabled_at
             AND r.created_at BETWEEN now() - interval '48 hours' AND now() - v_delay
             AND e.start_at > now() + interval '1 hour'
        ) x
       WHERE NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND l.trigger_key = x.event_id::text AND lower(l.email) = lower(x.em))
       ORDER BY lower(x.em), x.event_id, x.optin DESC, x.created_at DESC
       LIMIT 500;

      -- L'accord coché au checkout est versé dans le registre du CLUB ou de
      -- l'ORGANISATEUR (c'est leur case, pas celle de Yuno).
      IF a.venue_id IS NOT NULL THEN
        INSERT INTO public.newsletter_subscriptions
          (user_id, venue_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
        SELECT c.user_id, a.venue_id, c.em, true, 'checkout_started', 'ticketing', now(), c.first_name, c.last_name
          FROM _auto_cand c WHERE c.optin
        ON CONFLICT (lower(email), venue_id) WHERE venue_id IS NOT NULL DO UPDATE
          SET opted_in = true, opted_out_at = NULL,
              user_id    = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
              first_name = COALESCE(public.newsletter_subscriptions.first_name, EXCLUDED.first_name),
              last_name  = COALESCE(public.newsletter_subscriptions.last_name,  EXCLUDED.last_name),
              updated_at = now();
      ELSIF a.organizer_user_id IS NOT NULL THEN
        INSERT INTO public.newsletter_subscriptions
          (user_id, organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
        SELECT c.user_id, a.organizer_user_id, c.em, true, 'checkout_started', 'ticketing', now(), c.first_name, c.last_name
          FROM _auto_cand c WHERE c.optin
        ON CONFLICT (lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL DO UPDATE
          SET opted_in = true, opted_out_at = NULL,
              user_id    = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
              first_name = COALESCE(public.newsletter_subscriptions.first_name, EXCLUDED.first_name),
              last_name  = COALESCE(public.newsletter_subscriptions.last_name,  EXCLUDED.last_name),
              updated_at = now();
      END IF;

    ELSIF a.kind = 'last_call' THEN
      -- N h avant chaque soirée qui a encore quelque chose à vendre : toute la
      -- base opt-in (imports compris), les plus engagés d'abord, par lots
      -- (v_batch) : qui est déjà au registre pour cette soirée sort du lot.
      WITH pool AS (
        SELECT lower(s.email) AS em, e.id AS eid, e.start_at, s.user_id, s.first_name, s.last_name, s.created_at AS sub_at
          FROM public.events e
          JOIN public.newsletter_subscriptions s
            ON public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
           AND s.opted_in AND s.opted_out_at IS NULL
         WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
           AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
             OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id)
             -- Co-organisation : la portée annonce aussi les soirées qu'elle
             -- co-héberge (partenaire ou co-hôte qui partage son CRM).
             OR e.id IN (SELECT public.coorg_marketing_event_ids(a.venue_id, a.organizer_user_id)))
           AND e.start_at > a.enabled_at
           AND e.start_at - v_delay <= now()
           AND e.start_at > now() + interval '2 hours'
           AND (
             ((e.ticketing_enabled OR e.external_ticket_url IS NOT NULL) AND NOT e.tickets_sold_out)
             OR (e.tables_enabled AND NOT e.tables_sold_out)
             OR (NOT e.guest_list_sold_out AND EXISTS (
                   SELECT 1 FROM public.guest_lists gl
                    WHERE gl.event_id = e.id AND gl.is_active AND gl.visible_on_club_page AND NOT gl.manually_sold_out))
           )
           AND NOT EXISTS (
             SELECT 1 FROM public.email_automation_sends l
              WHERE l.automation_id = a.id AND l.trigger_key = e.id::text AND lower(l.email) = lower(s.email))
      ),
      rk AS (
        SELECT r.email, r.rnk
          FROM public._email_engagement_ranks(ARRAY(SELECT DISTINCT p.em FROM pool p), a.venue_id, a.organizer_user_id) r
      )
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT p.em, p.eid::text, p.eid, p.eid, now(), true, p.user_id, p.first_name, p.last_name, p.start_at
        FROM pool p LEFT JOIN rk ON rk.email = p.em
       ORDER BY p.start_at ASC, COALESCE(rk.rnk, 3) ASC, p.sub_at DESC
       LIMIT v_batch;

    ELSIF a.kind = 'new_event' THEN
      -- Annonce d'une soirée PUBLIÉE (published_at, jamais created_at, jamais
      -- une re-génération de modèle récurrent), N h après la mise en ligne, à
      -- toute la base opt-in — c'est LA recette qui met un fichier importé au
      -- travail. Le jugement écarte la rafale (une seule annonce par
      -- publication groupée sous 24 h) puis applique le cooldown.
      WITH pool AS (
        SELECT lower(s.email) AS em, e.id AS eid, e.start_at, e.published_at, s.user_id, s.first_name, s.last_name, s.created_at AS sub_at
          FROM public.events e
          JOIN public.newsletter_subscriptions s
            ON public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
           AND s.opted_in AND s.opted_out_at IS NULL
         WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
           AND (e.visibility = 'public' OR e.external_source IS NOT NULL) AND NOT COALESCE(e.requires_access_code, false)
           AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
             OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id)
             -- Co-organisation : la portée annonce aussi les soirées qu'elle
             -- co-héberge (partenaire ou co-hôte qui partage son CRM).
             OR e.id IN (SELECT public.coorg_marketing_event_ids(a.venue_id, a.organizer_user_id)))
           AND e.published_at IS NOT NULL
           AND e.published_at >= a.enabled_at
           AND e.published_at >= now() - interval '7 days'
           AND e.published_at + v_delay <= now()
           AND e.start_at > now() + interval '48 hours'
           AND (
             ((e.ticketing_enabled OR e.external_ticket_url IS NOT NULL) AND NOT e.tickets_sold_out)
             OR (e.tables_enabled AND NOT e.tables_sold_out)
             OR (NOT e.guest_list_sold_out AND EXISTS (
                   SELECT 1 FROM public.guest_lists gl
                    WHERE gl.event_id = e.id AND gl.is_active AND gl.visible_on_club_page AND NOT gl.manually_sold_out))
           )
           AND (e.recurring_template_id IS NULL OR NOT EXISTS (
                 SELECT 1 FROM public.events e2
                  WHERE e2.recurring_template_id = e.recurring_template_id
                    AND e2.id <> e.id AND e2.created_at < e.created_at))
           AND NOT EXISTS (
             SELECT 1 FROM public.email_automation_sends l
              WHERE l.automation_id = a.id AND l.trigger_key = e.id::text AND lower(l.email) = lower(s.email))
      ),
      rk AS (
        SELECT r.email, r.rnk
          FROM public._email_engagement_ranks(ARRAY(SELECT DISTINCT p.em FROM pool p), a.venue_id, a.organizer_user_id) r
      )
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT p.em, p.eid::text, p.eid, p.eid, p.published_at + v_delay, true, p.user_id, p.first_name, p.last_name, p.start_at
        FROM pool p LEFT JOIN rk ON rk.email = p.em
       ORDER BY p.start_at ASC, COALESCE(rk.rnk, 3) ASC, p.sub_at DESC
       LIMIT v_batch;

    ELSIF a.kind = 'table_upsell' THEN
      -- « Passe en table » : N h avant le début, aux détenteurs d'un billet
      -- payé, tant que la soirée ouvre des tables et qu'il en reste au moins
      -- une (même calcul que le bloc Table VIP de l'email : formules actives
      -- moins réservations, formules marquées complètes exclues).
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT DISTINCT ON (lower(t.user_email), e.id)
             lower(t.user_email), e.id::text, e.id, e.id, now(), true, t.user_id,
             COALESCE(t.guest_first_name, NULLIF(split_part(btrim(COALESCE(t.full_name, '')), ' ', 1), '')),
             COALESCE(t.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(t.full_name, ''), '^\S+\s*', '')), '')),
             e.start_at
        FROM public.events e
        JOIN LATERAL (SELECT public._event_tables_left(e.id) AS n) tl ON true
        JOIN public.tickets t ON t.event_id = e.id AND t.status IN ('paid', 'used') AND t.user_email IS NOT NULL
       WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
         AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
           OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
         AND e.tables_enabled AND NOT e.tables_sold_out
         AND COALESCE(tl.n, 0) > 0
         AND e.start_at > a.enabled_at
         AND e.start_at - v_delay <= now()
         AND e.start_at > now() + interval '2 hours'
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = e.id::text AND lower(l.email) = lower(t.user_email))
       ORDER BY lower(t.user_email), e.id, t.created_at DESC
       LIMIT v_batch;

    ELSIF a.kind = 'tier_closing' THEN
      -- « Le tarif monte » : le palier ouvert a dépassé le seuil, il reste au
      -- moins un billet et un palier suivant plus cher existe. Cible = ceux qui
      -- ont montré un intérêt sans acheter : clic sur la soirée dans un email
      -- de la portée, ou inscrit en liste d'attente. Un seul envoi par personne
      -- et par soirée, quel que soit le nombre de paliers.
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT DISTINCT ON (p.em, p.event_id)
             p.em, p.event_id::text, p.event_id, p.event_id, now(), true, NULL, NULL, NULL, p.start_at
        FROM (
          WITH ev AS (
            SELECT e.id, e.slug, e.start_at
              FROM public.events e
              JOIN LATERAL (
                SELECT r.position, r.price
                  FROM public.ticket_rounds r
                 WHERE r.event_id = e.id AND r.is_active AND NOT r.manually_sold_out
                   AND r.max_tickets > 0 AND r.tickets_sold < r.max_tickets
                   AND r.tickets_sold * 100 >= r.max_tickets * a.threshold_pct
                 ORDER BY r.position LIMIT 1
              ) cur ON true
             WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
               AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
               AND COALESCE(e.ticket_selling_mode, 'rounds') = 'rounds'
               AND e.ticketing_enabled AND NOT e.tickets_sold_out
               AND e.start_at > a.enabled_at
               AND e.start_at > now() + interval '2 hours'
               AND EXISTS (
                 SELECT 1 FROM public.ticket_rounds n
                  WHERE n.event_id = e.id AND n.position > cur.position AND n.price > cur.price
                    AND NOT n.manually_sold_out AND n.tickets_sold < n.max_tickets)
          )
          SELECT ev.id AS event_id, lower(x.recipient_email) AS em, ev.start_at
            FROM ev
            JOIN public.email_campaigns c
              ON public.marketing_scope_match(c.venue_id, c.organizer_user_id, a.venue_id, a.organizer_user_id)
            JOIN public.email_campaign_events x ON x.campaign_id = c.id AND x.event_type = 'clicked'
           WHERE x.created_at > now() - interval '60 days'
             AND x.recipient_email IS NOT NULL
             AND (
               (c.event_id = ev.id AND COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '')
                  ~ '^https?://(www\.)?yunoapp\.eu/(l/|events?/|affiliate-event/|guest-list)')
               OR COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '') LIKE '%/event/' || ev.id::text || '%'
               OR (ev.slug IS NOT NULL AND COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '') LIKE '%/events/%/' || ev.slug || '%')
             )
          UNION
          SELECT w.event_id, lower(w.email), ev.start_at
            FROM public.event_waitlist w JOIN ev ON ev.id = w.event_id
           WHERE w.email IS NOT NULL
        ) p
       WHERE p.em IS NOT NULL AND position('@' in p.em) > 1
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = p.event_id::text AND lower(l.email) = p.em)
       ORDER BY p.em, p.event_id
       LIMIT v_batch;

    ELSIF a.kind = 'click_no_buy' THEN
      -- « A cliqué sans acheter » : un clic NOMINATIF dans un e-mail de la
      -- portée vers la billetterie d'une soirée à venir, puis aucune place à
      -- la même adresse N h après le DERNIER clic (jugé plus bas, au moment
      -- où l'envoi est dû). Une visite venue d'ailleurs est anonyme : jamais
      -- ici. Une relance due depuis plus de 24 h ne part plus.
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT k.em, k.eid::text, k.eid, k.eid, k.last_click + v_delay, true, NULL, NULL, NULL, k.start_at
        FROM (
          SELECT lower(x.recipient_email) AS em, e.id AS eid, e.start_at, max(x.created_at) AS last_click
            FROM public.email_campaigns c
            JOIN public.email_campaign_events x ON x.campaign_id = c.id AND x.event_type = 'clicked'
            JOIN public.events e
              ON e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
             AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
               OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
             AND e.start_at > now() + interval '2 hours'
             AND NOT e.tickets_sold_out
             AND (
               -- Bouton d'un e-mail CRM : la page de CETTE soirée sur la billetterie connectée.
               (e.external_ticket_url IS NOT NULL
                AND public._link_base(COALESCE(x.metadata->'click'->>'link', x.metadata->>'link')) = public._link_base(e.external_ticket_url))
               -- Lien Yuno (suivi /l/, page soirée) d'une campagne reliée à cette soirée.
               OR (c.event_id = e.id
                   AND COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '') ~* '^https?://(www\.)?yunoapp\.eu/(l|event|events|e)/')
             )
           WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, a.venue_id, a.organizer_user_id)
             AND x.recipient_email IS NOT NULL
             AND x.created_at > now() - v_delay - interval '24 hours'
             -- Un vrai destinataire de la campagne : jamais l'envoi de test du pro.
             AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                          WHERE r.campaign_id = c.id AND lower(r.email) = lower(x.recipient_email))
           GROUP BY lower(x.recipient_email), e.id, e.start_at
        ) k
       WHERE k.last_click + v_delay <= now()
         AND k.last_click + v_delay > now() - interval '24 hours'
         AND position('@' in k.em) > 1
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = k.eid::text AND lower(l.email) = k.em)
       ORDER BY k.start_at, k.em
       LIMIT v_batch;

    ELSIF a.kind IN ('post_event_thanks', 'post_event_missed') THEN
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT DISTINCT ON (lower(p.em), p.event_id)
             lower(p.em), p.event_id::text, p.event_id, v_next, now(), true, NULL, NULL, NULL, p.end_at
        FROM (
          WITH ev AS (
            SELECT e.id, e.end_at
              FROM public.events e
             WHERE e.status = 'active' AND e.cancelled_at IS NULL
               AND (v_platform
                 OR (a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
               AND (NOT v_platform OR NOT (e.id = ANY (public.demo_event_ids())))
               AND e.end_at >= a.enabled_at
               AND e.end_at + v_delay <= now()
               AND e.end_at >= now() - interval '5 days'
          ),
          came AS (
            SELECT t.event_id, lower(t.user_email) AS em FROM public.tickets t JOIN ev ON ev.id = t.event_id
             WHERE t.user_email IS NOT NULL AND (t.status = 'used' OR t.used OR COALESCE(t.entry_scanned, false))
            UNION
            SELECT gl.event_id, lower(ge.email) FROM public.guest_list_entries ge
              JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN ev ON ev.id = gl.event_id
             WHERE ge.email IS NOT NULL AND ge.entry_scanned
            UNION
            SELECT r.event_id, lower(r.user_email) FROM public.table_reservations r JOIN ev ON ev.id = r.event_id
             WHERE r.user_email IS NOT NULL AND (COALESCE(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL)
            UNION
            SELECT xt.event_id, lower(xt.buyer_email) FROM public.external_tickets xt JOIN ev ON ev.id = xt.event_id
             WHERE xt.buyer_email IS NOT NULL AND xt.scanned_at IS NOT NULL AND xt.status IN ('valid', 'transferred')
          ),
          holders AS (
            SELECT t.event_id, lower(t.user_email) AS em FROM public.tickets t JOIN ev ON ev.id = t.event_id
             WHERE t.user_email IS NOT NULL AND t.status IN ('paid', 'used')
            UNION
            SELECT gl.event_id, lower(ge.email) FROM public.guest_list_entries ge
              JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN ev ON ev.id = gl.event_id
             WHERE ge.email IS NOT NULL AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected')
            UNION
            SELECT r.event_id, lower(r.user_email) FROM public.table_reservations r JOIN ev ON ev.id = r.event_id
             WHERE r.user_email IS NOT NULL AND r.status IN ('paid', 'confirmed', 'used')
            UNION
            SELECT xt.event_id, lower(xt.buyer_email) FROM public.external_tickets xt JOIN ev ON ev.id = xt.event_id
             WHERE xt.buyer_email IS NOT NULL AND xt.status IN ('valid', 'transferred')
          ),
          -- « On t'a manqué » seulement sur une soirée scannée pour de bon : au
          -- moins la moitié des détenteurs scannés. Shotgun laisse le scan vide
          -- quand un AUTRE prestataire a scanné, et une porte qui a arrêté de
          -- scanner ferait écrire « on t'a manqué » à des gens venus.
          scanned_events AS (
            SELECT hc.event_id FROM (SELECT event_id, count(*) AS n FROM holders GROUP BY event_id) hc
              JOIN (SELECT event_id, count(*) AS n FROM came GROUP BY event_id) cc ON cc.event_id = hc.event_id
             WHERE cc.n >= 0.5 * hc.n)
          SELECT c.event_id, c.em, ev.end_at FROM came c JOIN ev ON ev.id = c.event_id WHERE a.kind = 'post_event_thanks'
          UNION ALL
          SELECT h.event_id, h.em, ev.end_at FROM holders h
            JOIN ev ON ev.id = h.event_id
            JOIN scanned_events se ON se.event_id = h.event_id
           WHERE a.kind = 'post_event_missed'
             AND NOT EXISTS (SELECT 1 FROM came c WHERE c.event_id = h.event_id AND c.em = h.em)
        ) p
       WHERE NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND l.trigger_key = p.event_id::text AND lower(l.email) = lower(p.em))
       ORDER BY lower(p.em), p.event_id
       LIMIT v_batch;

    ELSIF a.kind = 'win_back' THEN
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT lower(s.email), 'wb-' || to_char(now(), 'YYYY-MM'), NULL, v_next, now(), true, s.user_id, s.first_name, s.last_name, now()
        FROM public.newsletter_subscriptions s
        JOIN LATERAL (
          SELECT max(x.at) AS last_at FROM (
            SELECT t.created_at AS at FROM public.tickets t JOIN public.events e ON e.id = t.event_id
             WHERE lower(t.user_email) = lower(s.email) AND t.status IN ('paid', 'used')
               AND (v_platform
                 OR (a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
            UNION ALL
            SELECT r.created_at FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
             WHERE lower(r.user_email) = lower(s.email) AND r.status IN ('paid', 'confirmed', 'used')
               AND (v_platform
                 OR (a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
            UNION ALL
            SELECT ge.entry_scanned_at FROM public.guest_list_entries ge
              JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN public.events e ON e.id = gl.event_id
             WHERE lower(ge.email) = lower(s.email) AND ge.entry_scanned AND ge.entry_scanned_at IS NOT NULL
               AND (v_platform
                 OR (a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
            UNION ALL
            SELECT COALESCE(xt.purchased_at, xt.first_seen_at) FROM public.external_tickets xt
             WHERE lower(xt.buyer_email) = lower(s.email) AND xt.status IN ('valid', 'transferred')
               AND (v_platform
                 OR (a.venue_id IS NOT NULL AND xt.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND xt.organizer_user_id = a.organizer_user_id))
          ) x
        ) act ON true
       WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
         AND s.opted_in AND s.opted_out_at IS NULL
         AND act.last_at IS NOT NULL
         AND act.last_at <= now() - v_delay
         AND act.last_at > now() - v_delay - interval '120 days'
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND lower(l.email) = lower(s.email)
              AND l.created_at > now() - interval '180 days'
         )
         -- L'habitué relancé par « il décroche » n'est pas reconquis trois
         -- semaines plus tard : la même personne, le même silence, un seul email.
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.kind = 'regular_lapse' AND l.status = 'queued' AND lower(l.email) = lower(s.email)
              AND l.created_at > now() - interval '60 days'
              AND l.venue_id IS NOT DISTINCT FROM a.venue_id
              AND l.organizer_user_id IS NOT DISTINCT FROM a.organizer_user_id
         )
      ORDER BY public._email_engagement_rank(lower(s.email), a.venue_id, a.organizer_user_id) ASC, act.last_at DESC
       LIMIT 300;

    ELSIF a.kind = 'regular_lapse' THEN
      -- « L'habitué décroche » : deux sorties par mois puis plus rien depuis
      -- N jours (six semaines par défaut). Détection et choix de la soirée
      -- par personne dans _regular_lapse_candidates (ses goûts : la série qu'il
      -- fréquentait, ses genres, son jour de sortie). Un épisode de silence =
      -- un email (trigger_key = date de la dernière venue), et pas plus d'un
      -- tous les 120 jours. Sans aucune soirée à venir, personne : une
      -- invitation sans soirée n'invite à rien — le prochain passage le reprend.
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT r.em, 'rl-' || to_char(r.last_at, 'YYYY-MM-DD'), NULL, COALESCE(r.pick_event_id, v_next), now(), true,
             COALESCE(s.user_id, r.user_id), s.first_name, s.last_name, now()
        FROM public._regular_lapse_candidates(a.venue_id, a.organizer_user_id, v_delay) r
        JOIN LATERAL (
          SELECT s.user_id, s.first_name, s.last_name
            FROM public.newsletter_subscriptions s
           WHERE lower(s.email) = r.em AND s.opted_in AND s.opted_out_at IS NULL
             AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
           LIMIT 1
        ) s ON true
       WHERE COALESCE(r.pick_event_id, v_next) IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND lower(l.email) = r.em
              AND l.created_at > now() - interval '120 days'
         )
       ORDER BY public._email_engagement_rank(r.em, a.venue_id, a.organizer_user_id) ASC, r.last_at DESC
       LIMIT 300;
    END IF;

    -- ── 5b. Jugement, au moment où l'envoi est dû ─────────────────────────
    WITH cand AS (
      SELECT DISTINCT ON (c.em, c.trigger_key) c.*
        FROM _auto_cand c
       WHERE NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND l.trigger_key = c.trigger_key AND lower(l.email) = c.em
       )
       ORDER BY c.em, c.trigger_key, c.optin DESC
    ),
    -- Règles Yuno (pression, fatigue, aversion) calculées en UNE passe sur
    -- tout le lot : appelées ligne à ligne, elles coûtaient ~1 ms par contact
    -- (14 s pour une base de 12 000), au-delà du plafond de l'API.
    pol AS (
      SELECT p.email, p.reason
        FROM public._email_send_policy_many(ARRAY(SELECT DISTINCT c.em FROM cand c), a.kind) p
    ),
    -- Rafale de publications : jugée une fois par SOIRÉE, pas par contact.
    burst AS (
      SELECT x.eid FROM (SELECT DISTINCT c.trigger_event_id AS eid FROM cand c
                          WHERE a.kind = 'new_event' AND c.trigger_event_id IS NOT NULL) x
       WHERE EXISTS (
         SELECT 1 FROM public.events e
           JOIN public.events e2 ON e2.id <> e.id
            AND e2.status = 'active' AND (e2.is_active OR e2.external_source IS NOT NULL) AND e2.cancelled_at IS NULL
            AND (e2.visibility = 'public' OR e2.external_source IS NOT NULL)
            AND e2.venue_id IS NOT DISTINCT FROM e.venue_id
            AND e2.organizer_user_id IS NOT DISTINCT FROM e.organizer_user_id
            AND e2.published_at IS NOT NULL AND e2.published_at >= a.enabled_at
            AND abs(extract(epoch FROM (e2.published_at - e.published_at))) <= 86400
            AND e2.start_at > now() + interval '48 hours'
            AND (e2.start_at < e.start_at OR (e2.start_at = e.start_at AND e2.id < e.id))
          WHERE e.id = x.eid)
    ),
    judged0 AS (
      SELECT c.*,
             CASE
               WHEN c.trigger_event_id IS NOT NULL
                    AND a.kind IN ('last_call', 'abandoned_checkout', 'table_upsell', 'tier_closing', 'new_event', 'click_no_buy')
                    AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = c.trigger_event_id AND e.start_at <= now())
                 THEN 'event_over'
               -- R5 : quelqu'un d'autre (club, orga du co-event, Yuno) l'a déjà
               -- écrit pour cette soirée et cette recette.
               WHEN c.trigger_event_id IS NOT NULL AND EXISTS (
                 SELECT 1 FROM public.email_automation_sends l
                  WHERE l.kind = a.kind AND l.trigger_event_id = c.trigger_event_id
                    AND lower(l.email) = c.em AND l.status = 'queued'
               ) THEN 'already_event'
               -- Rafale de publications : un club qui met 6 dates en ligne
               -- d'un coup n'annonce que la plus proche ; les autres sont
               -- tracées ici pour que le bilan l'explique.
               WHEN a.kind = 'new_event' AND c.trigger_event_id IN (SELECT b.eid FROM burst b) THEN 'already_event'
               WHEN public.is_email_suppressed(c.em) THEN 'suppressed'
               WHEN NOT EXISTS (
                 SELECT 1 FROM public.newsletter_subscriptions s
                  WHERE lower(s.email) = c.em AND s.opted_in AND s.opted_out_at IS NULL
                    AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
               ) THEN CASE WHEN a.kind = 'abandoned_checkout' THEN 'no_consent' ELSE 'unsubscribed' END
               WHEN a.kind = 'table_upsell' AND EXISTS (
                 SELECT 1 FROM public.table_reservations r
                  WHERE r.event_id = c.trigger_event_id AND lower(r.user_email) = c.em
                    AND r.status IN ('paid', 'used', 'confirmed', 'pending')
               ) THEN 'has_table'
               WHEN a.kind IN ('last_call', 'abandoned_checkout', 'tier_closing', 'new_event', 'click_no_buy') AND (
                 EXISTS (SELECT 1 FROM public.tickets t
                          WHERE t.event_id = c.trigger_event_id AND t.status IN ('paid', 'used') AND lower(t.user_email) = c.em)
                 OR EXISTS (SELECT 1 FROM public.table_reservations r
                             WHERE r.event_id = c.trigger_event_id AND r.status IN ('paid', 'confirmed', 'used') AND lower(r.user_email) = c.em)
                 -- Yuno CRM : déjà acheté sur la billetterie connectée.
                 OR EXISTS (SELECT 1 FROM public.external_tickets xt
                             WHERE xt.event_id = c.trigger_event_id AND xt.status IN ('valid', 'transferred')
                               AND (lower(xt.buyer_email) = c.em OR lower(xt.holder_email) = c.em))
               ) THEN 'bought'
               WHEN a.kind IN ('last_call', 'abandoned_checkout', 'tier_closing', 'new_event', 'click_no_buy') AND EXISTS (
                 SELECT 1 FROM public.guest_list_entries ge
                   JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
                  WHERE gl.event_id = c.trigger_event_id AND lower(ge.email) = c.em
                    AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected')
               ) THEN 'guest_list'
               -- Une automatisation par 48 h et par portée ; les trois recettes
               -- URGENTES (panier abandonné, tarif qui monte, clic sans achat)
               -- font exception : elles répondent à un geste du client.
               WHEN a.kind NOT IN ('abandoned_checkout', 'tier_closing', 'click_no_buy') AND EXISTS (
                 SELECT 1 FROM public.email_automation_sends l
                  WHERE l.status = 'queued' AND lower(l.email) = c.em
                    AND l.created_at > now() - interval '48 hours'
                    AND ((a.venue_id IS NOT NULL AND l.venue_id = a.venue_id)
                      OR (a.organizer_user_id IS NOT NULL AND l.organizer_user_id = a.organizer_user_id)
                      OR (v_platform AND l.venue_id IS NULL AND l.organizer_user_id IS NULL))
               ) THEN 'cooldown'
               -- Règles Yuno (pression, fatigue, aversion), tous expéditeurs.
               ELSE pol.reason
             END AS reason
        FROM cand c
        LEFT JOIN pol ON pol.email = c.em
    ),
    -- Cooldown INTRA-passage : plusieurs soirées dues en même temps pour un
    -- même contact (trois dates à J-3, six publications d'un coup) ne font
    -- qu'UN email — la plus proche ; les autres sont tracées « cooldown ».
    -- Les lignes insérées par une même instruction sont invisibles aux
    -- sous-requêtes du CASE ci-dessus, d'où ce second temps.
    judged AS (
      SELECT j.em, j.trigger_key, j.trigger_event_id, j.bind_event_id, j.due_at,
             CASE
               WHEN j.reason IS NULL AND a.kind NOT IN ('abandoned_checkout', 'tier_closing', 'click_no_buy')
                    AND row_number() OVER (PARTITION BY j.em, (j.reason IS NULL) ORDER BY j.ord NULLS LAST, j.trigger_key) > 1
                 THEN 'cooldown'
               ELSE j.reason
             END AS reason
        FROM judged0 j
    ),
    -- Yunits : seuls les v_room premiers envois dus entrent au registre ; les
    -- autres reviennent au passage suivant (après une recharge).
    judged2 AS (
      SELECT j.*,
             CASE WHEN j.reason IS NULL
                  THEN row_number() OVER (PARTITION BY (j.reason IS NULL) ORDER BY j.due_at, j.em, j.trigger_key) END AS qn
        FROM judged j
    ),
    held AS (
      SELECT count(*)::integer AS n FROM judged2 j
       WHERE j.reason IS NULL AND v_room IS NOT NULL AND j.qn > v_room
    ),
    ins AS (
      INSERT INTO public.email_automation_sends
        (automation_id, venue_id, organizer_user_id, kind, trigger_key, trigger_event_id, bind_event_id,
         email, status, skip_reason, due_at)
      SELECT a.id, a.venue_id, a.organizer_user_id, a.kind, j.trigger_key, j.trigger_event_id, j.bind_event_id,
             j.em, CASE WHEN j.reason IS NULL THEN 'queued' ELSE 'skipped' END, j.reason, j.due_at
        FROM judged2 j
       WHERE j.reason IS NOT NULL OR v_room IS NULL OR j.qn <= v_room
      ON CONFLICT DO NOTHING
      RETURNING status
    )
    SELECT v_queued + count(*) FILTER (WHERE status = 'queued'), v_skipped + count(*) FILTER (WHERE status = 'skipped'),
           v_held + (SELECT h.n FROM held h)
      INTO v_queued, v_skipped, v_held FROM ins;

    -- ── 5c. Campagnes enfants ─────────────────────────────────────────────
    SELECT * INTO tpl FROM public.email_campaign_templates WHERE id = a.template_id;
    IF tpl.id IS NULL THEN CONTINUE; END IF;

    FOR grp IN
      SELECT l.bind_event_id, l.trigger_event_id, count(*) AS n
        FROM public.email_automation_sends l
       WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL
       GROUP BY l.bind_event_id, l.trigger_event_id
    LOOP
      SELECT c.id INTO v_child
        FROM public.email_campaigns c
       WHERE c.automation_id = a.id
         AND c.event_id IS NOT DISTINCT FROM grp.bind_event_id
         AND c.automation_trigger_event_id IS NOT DISTINCT FROM grp.trigger_event_id
         AND (grp.bind_event_id IS NOT NULL OR grp.trigger_event_id IS NOT NULL
              OR c.created_at >= date_trunc('month', now()))
         AND c.status NOT IN ('cancelled', 'failed')
       ORDER BY c.created_at DESC
       LIMIT 1;

      IF v_child IS NULL THEN
        SELECT COALESCE(e.title, '') INTO v_label
          FROM public.events e WHERE e.id = COALESCE(grp.trigger_event_id, grp.bind_event_id);
        IF v_label IS NULL OR v_label = '' THEN v_label := to_char(now(), 'YYYY-MM'); END IF;
        v_name := left(COALESCE(NULLIF(tpl.name, ''), a.kind) || ' · ' || v_label, 80);
        v_blocks := CASE WHEN grp.bind_event_id IS NULL
                         THEN public._email_blocks_without_live(tpl.blocks_json)
                         ELSE COALESCE(tpl.blocks_json, '[]'::jsonb) END;
        INSERT INTO public.email_campaigns
          (venue_id, organizer_user_id, name, type, subject, preheader, blocks_json, blocks_version,
           theme_json, social_links_json, logo_url, event_id, status, audiences_json, exclusions_json,
           quiet_hours, automation_id, automation_trigger_event_id, child_kind, total_recipients, created_by)
        VALUES
          (a.venue_id, a.organizer_user_id, v_name, 'promotional',
           COALESCE(NULLIF(a.subject, ''), NULLIF(tpl.subject, ''), tpl.name), COALESCE(tpl.preheader, ''),
           v_blocks, 2,
           COALESCE(tpl.theme_json, '{}'::jsonb), COALESCE(tpl.social_links_json, '{}'::jsonb), tpl.logo_url,
           grp.bind_event_id, 'sending', '[]'::jsonb, '{}'::jsonb,
           true, a.id, grp.trigger_event_id, 'automation', 0, COALESCE(a.created_by, tpl.created_by))
        RETURNING id INTO v_child;
      END IF;

      WITH todo AS (
        SELECT l.id, lower(l.email) AS em
          FROM public.email_automation_sends l
         WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL
           AND l.bind_event_id IS NOT DISTINCT FROM grp.bind_event_id
           AND l.trigger_event_id IS NOT DISTINCT FROM grp.trigger_event_id
      ),
      ins AS (
        INSERT INTO public.email_campaign_recipients
          (campaign_id, email, first_name, last_name, unsubscribe_token, status)
        SELECT v_child, t.em, s.first_name, s.last_name, s.unsubscribe_token, 'pending'
          FROM todo t
          LEFT JOIN LATERAL (
            SELECT s.first_name, s.last_name, s.unsubscribe_token
              FROM public.newsletter_subscriptions s
             WHERE lower(s.email) = t.em
               AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
             LIMIT 1
          ) s ON true
        ON CONFLICT (campaign_id, lower(email)) DO NOTHING
        RETURNING 1
      )
      SELECT count(*) INTO v_new FROM ins;

      UPDATE public.email_automation_sends l
         SET campaign_id = v_child
       WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL
         AND l.bind_event_id IS NOT DISTINCT FROM grp.bind_event_id
         AND l.trigger_event_id IS NOT DISTINCT FROM grp.trigger_event_id;

      UPDATE public.email_campaigns
         SET status = 'sending', paused_reason = NULL, error_message = NULL,
             total_recipients = COALESCE(total_recipients, 0) + v_new
       WHERE id = v_child AND status IN ('sent', 'sending', 'draft');

      v_enqueued := v_enqueued + v_new;
      v_children := array_append(v_children, v_child);
      v_child := NULL;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'automations', v_automations, 'queued', v_queued, 'skipped', v_skipped,
    'enqueued', v_enqueued, 'children', to_jsonb(v_children),
    'budget_hit', v_budget_hit,
    'yunits_held', v_held
  );
END;
$function$;
