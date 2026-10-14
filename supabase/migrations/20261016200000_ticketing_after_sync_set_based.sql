-- Connecteur Shotgun : post-traitement d'une passe ensembliste.
--
-- ticketing_after_sync (étape 3c, accords newsletter → registre) faisait une
-- sous-requête corrélée par billet pour lire le « dernier signal » de son
-- acheteur : coût quadratique. Mesuré le 14/10 en prod (transaction annulée,
-- ~32 000 billets simulés sur le compte d'un organisateur) : > 2 min, alors
-- que le service_role est coupé à 30 s. La fonction entière était alors
-- annulée à chaque passe : aucune soirée miroir, aucun billet relié, aucun
-- contact versé, Console CRM vide. Règle inchangée, calcul en une passe.
--
-- Et pendant l'import initial, un ANALYZE de external_tickets (au plus une
-- fois par 3 min) : la table grossit plus vite que l'autoanalyse, et une
-- passe sans changement prenait 14 s au lieu de 0,3 s sur des statistiques
-- périmées.

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
  v_an jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'ticketing_after_sync: service_role only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.ticketing_connections WHERE id = p_connection_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'unknown_connection'); END IF;

  -- Import initial : la table grossit de ~3 500 billets par passe, plus vite
  -- que l'autoanalyse. Sur des statistiques périmées, la même passe prenait
  -- 14 s au lieu de 0,3 s (mesuré le 14/10). Au plus une fois par 3 minutes.
  IF c.initial_import_done_at IS NULL
     AND COALESCE((SELECT GREATEST(st.last_analyze, st.last_autoanalyze)
                     FROM pg_stat_user_tables st
                    WHERE st.relid = 'public.external_tickets'::regclass), '-infinity'::timestamptz)
         < now() - interval '3 minutes' THEN
    ANALYZE public.external_tickets;
  END IF;

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
  --     Ensembliste depuis 20261016200000 : le dernier signal de chaque
  --     adresse se calcule UNE fois (DISTINCT ON), plus par billet. La
  --     sous-requête corrélée d'avant coûtait n² : vers 30 000 billets, la
  --     passe dépassait les 30 s du service_role et toute la fonction était
  --     annulée (ni soirées miroirs, ni billets reliés, ni contacts). Même
  --     règle qu'avant, mot pour mot.
  IF c.venue_id IS NOT NULL THEN
    WITH last_sig AS (
      -- Dernier signal newsletter de chaque adresse, calculé UNE fois.
      SELECT DISTINCT ON (lower(t.buyer_email))
             lower(t.buyer_email) AS em, t.newsletter_optin AS opt
        FROM public.external_tickets t
       WHERE t.connection_id = p_connection_id
         AND t.buyer_email IS NOT NULL
         AND t.newsletter_optin IS NOT NULL
       ORDER BY lower(t.buyer_email), COALESCE(t.source_updated_at, t.purchased_at, t.first_seen_at) DESC NULLS LAST
    ),
    cand AS (
      SELECT DISTINCT ON (lower(t.buyer_email))
             lower(t.buyer_email) AS em, COALESCE(t.purchased_at, t.first_seen_at) AS at,
             t.buyer_first_name AS fn, t.buyer_last_name AS ln
        FROM public.external_tickets t
       WHERE t.connection_id = p_connection_id
         AND t.newsletter_optin IS TRUE
         AND t.buyer_email IS NOT NULL
         AND t.status IN ('valid', 'transferred')
       ORDER BY lower(t.buyer_email), t.purchased_at DESC NULLS LAST
    )
    INSERT INTO public.newsletter_subscriptions
      (venue_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
    SELECT c.venue_id, cd.em, true, 'connector:' || c.provider, 'ticketing', cd.at, cd.fn, cd.ln
      FROM cand cd
      JOIN last_sig l ON l.em = cd.em AND l.opt IS TRUE
     WHERE NOT EXISTS (SELECT 1 FROM public.email_suppressions s WHERE lower(s.email) = cd.em)
       AND NOT EXISTS (SELECT 1 FROM public.email_opt_outs o
                        WHERE o.venue_id = c.venue_id AND lower(o.email) = cd.em)
    ON CONFLICT (lower(email), venue_id) WHERE venue_id IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_consent = ROW_COUNT;
  ELSIF c.organizer_user_id IS NOT NULL THEN
    WITH last_sig AS (
      -- Dernier signal newsletter de chaque adresse, calculé UNE fois.
      SELECT DISTINCT ON (lower(t.buyer_email))
             lower(t.buyer_email) AS em, t.newsletter_optin AS opt
        FROM public.external_tickets t
       WHERE t.connection_id = p_connection_id
         AND t.buyer_email IS NOT NULL
         AND t.newsletter_optin IS NOT NULL
       ORDER BY lower(t.buyer_email), COALESCE(t.source_updated_at, t.purchased_at, t.first_seen_at) DESC NULLS LAST
    ),
    cand AS (
      SELECT DISTINCT ON (lower(t.buyer_email))
             lower(t.buyer_email) AS em, COALESCE(t.purchased_at, t.first_seen_at) AS at,
             t.buyer_first_name AS fn, t.buyer_last_name AS ln
        FROM public.external_tickets t
       WHERE t.connection_id = p_connection_id
         AND t.newsletter_optin IS TRUE
         AND t.buyer_email IS NOT NULL
         AND t.status IN ('valid', 'transferred')
       ORDER BY lower(t.buyer_email), t.purchased_at DESC NULLS LAST
    )
    INSERT INTO public.newsletter_subscriptions
      (organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
    SELECT c.organizer_user_id, cd.em, true, 'connector:' || c.provider, 'ticketing', cd.at, cd.fn, cd.ln
      FROM cand cd
      JOIN last_sig l ON l.em = cd.em AND l.opt IS TRUE
     WHERE NOT EXISTS (SELECT 1 FROM public.email_suppressions s WHERE lower(s.email) = cd.em)
       AND NOT EXISTS (SELECT 1 FROM public.email_opt_outs o
                        WHERE o.organizer_user_id = c.organizer_user_id AND lower(o.email) = cd.em)
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

  -- 3e. Analyse client (20261010110000) : mémoire des annonces de line-up et
  --     e-mails à recalculer. Jamais bloquant pour la synchro.
  BEGIN
    v_an := public._crm_analysis_mark_sync(p_connection_id);
  EXCEPTION WHEN others THEN
    v_an := jsonb_build_object('error', SQLSTATE);
  END;

  RETURN jsonb_build_object('events_created', v_created, 'events_updated', v_updated,
                            'tickets_linked', v_linked, 'consents_added', v_consent,
                            'consents_withdrawn', v_withdrawn, 'analysis', v_an);
END;
$function$
;

REVOKE ALL ON FUNCTION public.ticketing_after_sync(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_after_sync(uuid) TO service_role;
