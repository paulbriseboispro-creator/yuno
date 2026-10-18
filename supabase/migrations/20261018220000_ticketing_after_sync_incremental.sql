-- Connecteur de billetterie : une passe sans billet neuf ne recalcule rien.
--
-- Mesuré le 17/10 (Amoris, 48 388 billets) : chaque passe horaire coûtait
-- ~10 s de base à froid même sans aucun billet (post-traitement complet :
-- trois tris de tous les billets pour les accords newsletter, liaison de tous
-- les billets, statistiques). À 15 min de cadence, 16 min de base par jour
-- pour un seul compte.
--
-- ticketing_after_sync ne retraite plus que les billets synchronisés depuis
-- sa dernière passe (post_synced_at, marge de 10 min sur l'horloge du
-- connecteur) et les adresses qu'ils portent, plus les adresses qu'un billet
-- a quittées (ticketing_email_moves). Les règles ne changent pas, mot pour
-- mot : pour une adresse revue, le calcul lit TOUS ses billets comme avant ;
-- une adresse sans billet touché donnerait le même résultat qu'à la passe
-- précédente. Ce qui peut changer sans billet (une suppression d'adresse levée
-- à la main) est rattrapé par une passe complète au moins toutes les 24 h.
-- Toute règle changée ici doit remettre post_full_at à NULL.
--
-- ticketing_refresh_stats : recalcul des chiffres de billets seulement si un
-- billet a bougé depuis (stats_at), sinon les seuls comptes de soirées.

ALTER TABLE public.ticketing_connections
  ADD COLUMN IF NOT EXISTS post_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS post_full_at timestamptz,
  ADD COLUMN IF NOT EXISTS stats_at timestamptz;

COMMENT ON COLUMN public.ticketing_connections.post_synced_at IS
  'Début de la dernière passe de ticketing_after_sync réussie : la suivante ne retraite que les billets synchronisés depuis (marge 10 min).';
COMMENT ON COLUMN public.ticketing_connections.post_full_at IS
  'Dernière passe complète de ticketing_after_sync (au moins une par 24 h). NULL = la prochaine passe est complète.';

-- Billets touchés depuis une date, par connexion : la passe sans billet neuf
-- ne lit plus la table (et l'analyse client, _crm_analysis_mark_sync, non plus).
CREATE INDEX IF NOT EXISTS external_tickets_conn_synced_idx
  ON public.external_tickets (connection_id, synced_at);
-- Billets pas encore reliés à leur soirée miroir.
CREATE INDEX IF NOT EXISTS external_tickets_conn_unlinked_idx
  ON public.external_tickets (connection_id) WHERE event_id IS NULL;

-- Adresse quittée par un billet (changée chez la billetterie) : à revoir à la
-- passe suivante, puis effacée. RLS sans policy : écrite par le trigger,
-- lue et vidée par ticketing_after_sync (SECURITY DEFINER).
CREATE TABLE IF NOT EXISTS public.ticketing_email_moves (
  connection_id uuid NOT NULL REFERENCES public.ticketing_connections(id) ON DELETE CASCADE,
  email text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticketing_email_moves_conn_idx ON public.ticketing_email_moves (connection_id);
ALTER TABLE public.ticketing_email_moves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ticketing_email_moves FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.external_tickets_note_email_move()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.ticketing_email_moves (connection_id, email) VALUES (OLD.connection_id, lower(OLD.buyer_email));
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.external_tickets_note_email_move() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_external_tickets_email_move ON public.external_tickets;
CREATE TRIGGER trg_external_tickets_email_move
  AFTER UPDATE OF buyer_email ON public.external_tickets
  FOR EACH ROW
  WHEN (OLD.buyer_email IS NOT NULL AND lower(OLD.buyer_email) IS DISTINCT FROM lower(NEW.buyer_email))
  EXECUTE FUNCTION public.external_tickets_note_email_move();

CREATE OR REPLACE FUNCTION public.ticketing_after_sync(p_connection_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
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
  -- Passe incrémentale (20261018220000) : seuls les billets synchronisés
  -- depuis la dernière passe (marge de 10 min sur l'horloge du connecteur) et
  -- les adresses qu'ils portent sont retraités. Une passe complète au moins
  -- toutes les 24 h, pendant l'import initial, et quand post_full_at est remis
  -- à NULL (TOUTE règle changée ici doit le remettre à NULL, sinon elle ne vaut
  -- que pour les billets qui bougent).
  v_t0 timestamptz := clock_timestamp();
  v_full boolean;
  v_since timestamptz;
  v_emails text[];
  v_new_ext text[] := '{}';
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'ticketing_after_sync: service_role only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.ticketing_connections WHERE id = p_connection_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'unknown_connection'); END IF;

  v_full := c.post_synced_at IS NULL OR c.post_full_at IS NULL
            OR c.post_full_at < now() - interval '24 hours'
            OR c.initial_import_done_at IS NULL;
  v_since := c.post_synced_at - interval '10 minutes';
  IF NOT v_full THEN
    -- Adresses à revoir : celles des billets touchés, et celles qu'un billet a
    -- quittées (adresse changée chez la billetterie, ticketing_email_moves) —
    -- sans elles, un retrait d'accord porté par l'ancienne adresse attendrait
    -- la passe complète.
    SELECT COALESCE(array_agg(DISTINCT tch.em), '{}') INTO v_emails FROM (
      SELECT lower(t.buyer_email) AS em FROM public.external_tickets t
       WHERE t.connection_id = p_connection_id AND t.synced_at > v_since AND t.buyer_email IS NOT NULL
      UNION
      SELECT m.email FROM public.ticketing_email_moves m WHERE m.connection_id = p_connection_id
    ) tch;
  END IF;

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
      v_new_ext := v_new_ext || x.external_id;
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
     AND t.event_id IS DISTINCT FROM ee.event_id
     -- Un billet ne change jamais de soirée chez la billetterie, et une soirée
     -- miroir supprimée remet ses billets à NULL (clé SET NULL) : hors passe
     -- complète, seuls les billets sans soirée, touchés, ou d'une soirée
     -- miroir créée à l'instant peuvent avoir à être reliés.
     AND (v_full OR t.event_id IS NULL OR t.synced_at > v_since OR t.external_event_id = ANY (v_new_ext));
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
  IF NOT v_full AND cardinality(v_emails) = 0 THEN
    NULL;  -- aucun billet touché : rien à verser au registre
  ELSIF c.venue_id IS NOT NULL THEN
    WITH last_sig AS (
      -- Dernier signal newsletter de chaque adresse, calculé UNE fois.
      SELECT DISTINCT ON (lower(t.buyer_email))
             lower(t.buyer_email) AS em, t.newsletter_optin AS opt
        FROM public.external_tickets t
       WHERE t.connection_id = p_connection_id
         AND t.buyer_email IS NOT NULL
         AND t.newsletter_optin IS NOT NULL
         AND (v_full OR lower(t.buyer_email) = ANY (v_emails))
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
         AND (v_full OR lower(t.buyer_email) = ANY (v_emails))
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
         AND (v_full OR lower(t.buyer_email) = ANY (v_emails))
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
         AND (v_full OR lower(t.buyer_email) = ANY (v_emails))
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
  IF v_full OR cardinality(v_emails) > 0 THEN
  WITH g AS (
    SELECT DISTINCT ON (lower(t.buyer_email))
           lower(t.buyer_email) AS em, t.newsletter_optin AS opt,
           COALESCE(t.source_updated_at, t.purchased_at, t.first_seen_at) AS at
      FROM public.external_tickets t
     WHERE t.connection_id = p_connection_id
       AND t.buyer_email IS NOT NULL
       AND t.newsletter_optin IS NOT NULL
       AND (v_full OR lower(t.buyer_email) = ANY (v_emails))
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
  END IF;

  -- 3e. Analyse client (20261010110000) : mémoire des annonces de line-up et
  --     e-mails à recalculer. Jamais bloquant pour la synchro.
  BEGIN
    v_an := public._crm_analysis_mark_sync(p_connection_id);
  EXCEPTION WHEN others THEN
    v_an := jsonb_build_object('error', SQLSTATE);
  END;

  -- La base de contacts de la portée suit les billets (cache relu par la
  -- Console, contact_base_cache_refresh) : marquée dès qu'un billet a bougé.
  IF v_full OR cardinality(v_emails) > 0 OR v_linked > 0 OR v_created > 0 THEN
    UPDATE public.contact_base_cache_state s SET dirty_at = clock_timestamp()
     WHERE s.scope_key = public.contact_base_scope_key(c.venue_id, c.organizer_user_id);
  END IF;

  DELETE FROM public.ticketing_email_moves m WHERE m.connection_id = p_connection_id AND m.at <= v_t0;
  UPDATE public.ticketing_connections
     SET post_synced_at = v_t0,
         post_full_at = CASE WHEN v_full THEN v_t0 ELSE post_full_at END
   WHERE id = p_connection_id;

  RETURN jsonb_build_object('events_created', v_created, 'events_updated', v_updated,
                            'tickets_linked', v_linked, 'consents_added', v_consent,
                            'consents_withdrawn', v_withdrawn, 'analysis', v_an,
                            'mode', CASE WHEN v_full THEN 'full' ELSE 'incremental' END,
                            'emails_reviewed', CASE WHEN v_full THEN NULL ELSE cardinality(v_emails) END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ticketing_refresh_stats(p_connection_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
  c record;
  v_t0 timestamptz := clock_timestamp();
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'ticketing_refresh_stats: service_role only' USING ERRCODE = '42501';
  END IF;
  -- Rien n'a bougé depuis le dernier calcul (20261018220000) : seuls les
  -- comptes de soirées, qui dépendent de l'heure, sont refaits. Le reste se
  -- recalcule dès qu'un billet est synchronisé, et au moins une fois par jour.
  SELECT tc.stats, tc.stats_at INTO c FROM public.ticketing_connections tc WHERE tc.id = p_connection_id;
  IF c.stats_at IS NOT NULL AND c.stats_at > now() - interval '24 hours' AND c.stats ? 'tickets'
     AND NOT EXISTS (SELECT 1 FROM public.external_tickets t
                      WHERE t.connection_id = p_connection_id AND t.synced_at > c.stats_at - interval '10 minutes') THEN
    v := c.stats || jsonb_build_object(
      'events',          (SELECT count(*) FROM public.external_events e WHERE e.connection_id = p_connection_id),
      'upcoming_events', (SELECT count(*) FROM public.external_events e
                           WHERE e.connection_id = p_connection_id AND e.cancelled_at IS NULL
                             AND COALESCE(e.end_at, e.start_at + interval '8 hours') > now()));
    UPDATE public.ticketing_connections SET stats = v WHERE id = p_connection_id AND stats IS DISTINCT FROM v;
    RETURN v;
  END IF;

  -- `buyers` = clients au sens de la base (au moins un billet valide ou
  -- transféré, règle de contact_scope_customers) : le même nombre que la part
  -- Shotgun de l'Accueil et de Clients. Le reste se dit à part.
  WITH t AS (
    SELECT lower(t.buyer_email) AS em, t.status, t.newsletter_optin, t.scanned_at, t.purchased_at
      FROM public.external_tickets t
     WHERE t.connection_id = p_connection_id
  ), p AS (
    SELECT em, bool_or(status IN ('valid', 'transferred')) AS client, bool_or(newsletter_optin IS TRUE) AS optin
      FROM t WHERE em IS NOT NULL GROUP BY em
  )
  SELECT jsonb_build_object(
    'events',          (SELECT count(*) FROM public.external_events e WHERE e.connection_id = p_connection_id),
    'upcoming_events', (SELECT count(*) FROM public.external_events e
                         WHERE e.connection_id = p_connection_id AND e.cancelled_at IS NULL
                           AND COALESCE(e.end_at, e.start_at + interval '8 hours') > now()),
    'tickets',         (SELECT count(*) FROM t),
    'valid_tickets',   (SELECT count(*) FROM t WHERE status = 'valid'),
    'buyers',          (SELECT count(*) FROM p WHERE client),
    'buyers_inactive', (SELECT count(*) FROM p WHERE NOT client),
    'optin_buyers',    (SELECT count(*) FROM p WHERE optin),
    'no_email_tickets', (SELECT count(*) FROM t WHERE em IS NULL AND status IN ('valid', 'transferred')),
    'with_email_pct',  (SELECT CASE WHEN count(*) = 0 THEN NULL
                                    ELSE round(100.0 * count(*) FILTER (WHERE em IS NOT NULL) / count(*)) END FROM t),
    'scanned_tickets', (SELECT count(*) FROM t WHERE scanned_at IS NOT NULL),
    'first_purchase_at', (SELECT min(purchased_at) FROM t),
    'last_purchase_at',  (SELECT max(purchased_at) FROM t)
  ) INTO v;

  UPDATE public.ticketing_connections SET stats = v, stats_at = v_t0 WHERE id = p_connection_id;
  RETURN v;
END;
$function$;
