-- ============================================================================
-- Yuno CRM — lot 2b : les automatisations et l'attribution lisent la
-- billetterie connectée. Plan : docs/designs/YUNO_CRM_PLAN.md §5.4 / §5.5.
--
-- Corps repris de l'état LIVE (pg_get_functiondef, 02/10/2026), seules les
-- branches « billetterie externe » sont ajoutées :
--   • un acheteur Shotgun d'une soirée est « bought » : jamais de dernier
--     appel ni d'annonce pour une soirée qu'il a déjà payée (étape 5b) ;
--   • une soirée externe (miroir, privée par construction) peut être
--     annoncée / relancée aux abonnés de SA portée : elle « vend » tant
--     qu'elle a une URL de billetterie et n'est pas complète ;
--   • un scan Shotgun vaut une venue (merci / on t'a manqué), un achat
--     Shotgun vaut une activité (reconquête, habitué qui décroche, rang
--     d'engagement) ;
--   • un accord newsletter versé par le connecteur (source 'connector:%')
--     ne déclenche JAMAIS « bienvenue » ;
--   • l'attribution clic → achat sous 72 h compte les achats Shotgun.
-- ============================================================================

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
                WHEN 'abandoned_checkout' THEN 0 WHEN 'tier_closing' THEN 1
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
    IF v_platform AND a.kind IN ('last_call', 'new_event', 'tier_closing', 'table_upsell', 'regular_lapse') THEN CONTINUE; END IF;
    v_automations := v_automations + 1;
    v_delay := make_interval(hours => a.delay_hours);
    v_next := CASE WHEN v_platform THEN NULL ELSE public._email_automation_next_event(a.venue_id, a.organizer_user_id) END;
    TRUNCATE _auto_cand;

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
      -- base opt-in (imports compris), les plus engagés d'abord.
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT lower(s.email), e.id::text, e.id, e.id, now(), true, s.user_id, s.first_name, s.last_name, e.start_at
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
      ORDER BY e.start_at ASC, public._email_engagement_rank(lower(s.email), a.venue_id, a.organizer_user_id) ASC, s.created_at DESC
       LIMIT 5000;

    ELSIF a.kind = 'new_event' THEN
      -- Annonce d'une soirée PUBLIÉE (published_at, jamais created_at, jamais
      -- une re-génération de modèle récurrent), N h après la mise en ligne, à
      -- toute la base opt-in — c'est LA recette qui met un fichier importé au
      -- travail. Le jugement écarte la rafale (une seule annonce par
      -- publication groupée sous 24 h) puis applique le cooldown.
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT lower(s.email), e.id::text, e.id, e.id, e.published_at + v_delay, true, s.user_id, s.first_name, s.last_name, e.start_at
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
      ORDER BY e.start_at ASC, public._email_engagement_rank(lower(s.email), a.venue_id, a.organizer_user_id) ASC, s.created_at DESC
       LIMIT 5000;

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
       ORDER BY lower(t.user_email), e.id, t.created_at DESC
       LIMIT 5000;

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
       ORDER BY p.em, p.event_id
       LIMIT 5000;

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
             WHERE r.user_email IS NOT NULL AND r.status IN ('paid', 'used')
            UNION
            SELECT xt.event_id, lower(xt.buyer_email) FROM public.external_tickets xt JOIN ev ON ev.id = xt.event_id
             WHERE xt.buyer_email IS NOT NULL AND xt.status IN ('valid', 'transferred')
          ),
          scanned_events AS (SELECT DISTINCT event_id FROM came)
          SELECT c.event_id, c.em, ev.end_at FROM came c JOIN ev ON ev.id = c.event_id WHERE a.kind = 'post_event_thanks'
          UNION ALL
          SELECT h.event_id, h.em, ev.end_at FROM holders h
            JOIN ev ON ev.id = h.event_id
            JOIN scanned_events se ON se.event_id = h.event_id
           WHERE a.kind = 'post_event_missed'
             AND NOT EXISTS (SELECT 1 FROM came c WHERE c.event_id = h.event_id AND c.em = h.em)
        ) p
       ORDER BY lower(p.em), p.event_id
       LIMIT 5000;

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
             WHERE lower(r.user_email) = lower(s.email) AND r.status IN ('paid', 'used')
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
    judged0 AS (
      SELECT c.*,
             CASE
               WHEN c.trigger_event_id IS NOT NULL
                    AND a.kind IN ('last_call', 'abandoned_checkout', 'table_upsell', 'tier_closing', 'new_event')
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
               WHEN a.kind = 'new_event' AND EXISTS (
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
                  WHERE e.id = c.trigger_event_id
               ) THEN 'already_event'
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
               WHEN a.kind IN ('last_call', 'abandoned_checkout', 'tier_closing', 'new_event') AND (
                 EXISTS (SELECT 1 FROM public.tickets t
                          WHERE t.event_id = c.trigger_event_id AND t.status IN ('paid', 'used') AND lower(t.user_email) = c.em)
                 OR EXISTS (SELECT 1 FROM public.table_reservations r
                             WHERE r.event_id = c.trigger_event_id AND r.status IN ('paid', 'used') AND lower(r.user_email) = c.em)
                 -- Yuno CRM : déjà acheté sur la billetterie connectée.
                 OR EXISTS (SELECT 1 FROM public.external_tickets xt
                             WHERE xt.event_id = c.trigger_event_id AND xt.status IN ('valid', 'transferred') AND lower(xt.buyer_email) = c.em)
               ) THEN 'bought'
               WHEN a.kind IN ('last_call', 'abandoned_checkout', 'tier_closing', 'new_event') AND EXISTS (
                 SELECT 1 FROM public.guest_list_entries ge
                   JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
                  WHERE gl.event_id = c.trigger_event_id AND lower(ge.email) = c.em
                    AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected')
               ) THEN 'guest_list'
               -- Une automatisation par 48 h et par portée ; les deux recettes
               -- URGENTES (panier abandonné, tarif qui monte) font exception.
               WHEN a.kind NOT IN ('abandoned_checkout', 'tier_closing') AND EXISTS (
                 SELECT 1 FROM public.email_automation_sends l
                  WHERE l.status = 'queued' AND lower(l.email) = c.em
                    AND l.created_at > now() - interval '48 hours'
                    AND ((a.venue_id IS NOT NULL AND l.venue_id = a.venue_id)
                      OR (a.organizer_user_id IS NOT NULL AND l.organizer_user_id = a.organizer_user_id)
                      OR (v_platform AND l.venue_id IS NULL AND l.organizer_user_id IS NULL))
               ) THEN 'cooldown'
               -- Règles Yuno (pression, fatigue, aversion), tous expéditeurs.
               ELSE public.email_send_policy(c.em, a.kind)
             END AS reason
        FROM cand c
    ),
    -- Cooldown INTRA-passage : plusieurs soirées dues en même temps pour un
    -- même contact (trois dates à J-3, six publications d'un coup) ne font
    -- qu'UN email — la plus proche ; les autres sont tracées « cooldown ».
    -- Les lignes insérées par une même instruction sont invisibles aux
    -- sous-requêtes du CASE ci-dessus, d'où ce second temps.
    judged AS (
      SELECT j.em, j.trigger_key, j.trigger_event_id, j.bind_event_id, j.due_at,
             CASE
               WHEN j.reason IS NULL AND a.kind NOT IN ('abandoned_checkout', 'tier_closing')
                    AND row_number() OVER (PARTITION BY j.em, (j.reason IS NULL) ORDER BY j.ord NULLS LAST, j.trigger_key) > 1
                 THEN 'cooldown'
               ELSE j.reason
             END AS reason
        FROM judged0 j
    ),
    ins AS (
      INSERT INTO public.email_automation_sends
        (automation_id, venue_id, organizer_user_id, kind, trigger_key, trigger_event_id, bind_event_id,
         email, status, skip_reason, due_at)
      SELECT a.id, a.venue_id, a.organizer_user_id, a.kind, j.trigger_key, j.trigger_event_id, j.bind_event_id,
             j.em, CASE WHEN j.reason IS NULL THEN 'queued' ELSE 'skipped' END, j.reason, j.due_at
        FROM judged j
      ON CONFLICT DO NOTHING
      RETURNING status
    )
    SELECT v_queued + count(*) FILTER (WHERE status = 'queued'), v_skipped + count(*) FILTER (WHERE status = 'skipped')
      INTO v_queued, v_skipped FROM ins;

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
    'enqueued', v_enqueued, 'children', to_jsonb(v_children)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.preview_email_automation(p_venue_id text, p_organizer_user_id uuid, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a RECORD;
  v_delay interval;
  v_threshold integer;
  v_enabled_at timestamptz;
  v_eligible integer := 0;
  v_base integer := 0;
  v_event_id uuid;
  v_event_title text;
  v_due timestamptz;
  v_start timestamptz;
  v_pub timestamptz;
  v_next uuid;
BEGIN
  PERFORM public._email_scope_guard(p_venue_id, p_organizer_user_id);
  IF (p_venue_id IS NULL AND p_organizer_user_id IS NULL) OR p_kind IS NULL THEN
    RETURN jsonb_build_object('eligible', 0, 'base', 0, 'next_event_id', NULL, 'next_event_title', NULL, 'next_due_at', NULL);
  END IF;

  SELECT x.* INTO a FROM public.email_automations x
   WHERE x.kind = p_kind
     AND ((p_venue_id IS NOT NULL AND x.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND x.organizer_user_id = p_organizer_user_id))
   LIMIT 1;
  v_delay := make_interval(hours => COALESCE(a.delay_hours, CASE p_kind
    WHEN 'abandoned_checkout' THEN 2 WHEN 'last_call' THEN 24 WHEN 'post_event_thanks' THEN 12
    WHEN 'post_event_missed' THEN 24 WHEN 'welcome' THEN 24 WHEN 'win_back' THEN 2160
    WHEN 'table_upsell' THEN 72 WHEN 'new_event' THEN 6 WHEN 'regular_lapse' THEN 1008 ELSE 24 END));
  v_threshold := COALESCE(a.threshold_pct, 85);
  v_enabled_at := COALESCE(a.enabled_at, now());
  v_next := public._email_automation_next_event(p_venue_id, p_organizer_user_id);

  SELECT count(*) INTO v_base
    FROM public.newsletter_subscriptions s
   WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND s.opted_in AND s.opted_out_at IS NULL;

  IF p_kind IN ('last_call', 'new_event') THEN
    SELECT e.id, e.title, e.start_at, e.published_at INTO v_event_id, v_event_title, v_start, v_pub
      FROM public.events e
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.start_at > now() + interval '2 hours'
       AND (p_kind = 'last_call' OR (
             (e.visibility = 'public' OR e.external_source IS NOT NULL) AND NOT COALESCE(e.requires_access_code, false)
             AND e.published_at IS NOT NULL AND e.start_at > now() + interval '48 hours'))
       AND (
         ((e.ticketing_enabled OR e.external_ticket_url IS NOT NULL) AND NOT e.tickets_sold_out)
         OR (e.tables_enabled AND NOT e.tables_sold_out)
         OR (NOT e.guest_list_sold_out AND EXISTS (
               SELECT 1 FROM public.guest_lists gl
                WHERE gl.event_id = e.id AND gl.is_active AND gl.visible_on_club_page AND NOT gl.manually_sold_out))
       )
     ORDER BY (CASE WHEN p_kind = 'new_event' THEN e.published_at END) DESC NULLS LAST, e.start_at ASC
     LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      v_due := CASE WHEN p_kind = 'last_call' THEN v_start - v_delay ELSE v_pub + v_delay END;
      SELECT count(*) INTO v_eligible
        FROM public.newsletter_subscriptions s
       WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
         AND s.opted_in AND s.opted_out_at IS NULL
         AND NOT public._email_event_holder(v_event_id, s.email)
         AND (a.id IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = v_event_id::text AND lower(l.email) = lower(s.email)));
    ELSE
      v_eligible := CASE WHEN p_kind = 'new_event' THEN v_base ELSE 0 END;
    END IF;

  ELSIF p_kind = 'table_upsell' THEN
    SELECT e.id, e.title, e.start_at INTO v_event_id, v_event_title, v_start
      FROM public.events e
      JOIN LATERAL (SELECT public._event_tables_left(e.id) AS n) tl ON true
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.tables_enabled AND NOT e.tables_sold_out AND COALESCE(tl.n, 0) > 0
       AND e.start_at > now() + interval '2 hours'
     ORDER BY e.start_at ASC
     LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      v_due := v_start - v_delay;
      SELECT count(DISTINCT lower(t.user_email)) INTO v_eligible
        FROM public.tickets t
       WHERE t.event_id = v_event_id AND t.status IN ('paid', 'used') AND t.user_email IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.table_reservations r
                          WHERE r.event_id = v_event_id AND lower(r.user_email) = lower(t.user_email)
                            AND r.status IN ('paid', 'used', 'confirmed', 'pending'))
         AND EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                      WHERE lower(s.email) = lower(t.user_email) AND s.opted_in AND s.opted_out_at IS NULL
                        AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id))
         AND (a.id IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = v_event_id::text AND lower(l.email) = lower(t.user_email)));
    END IF;

  ELSIF p_kind = 'tier_closing' THEN
    SELECT e.id, e.title INTO v_event_id, v_event_title
      FROM public.events e
      JOIN LATERAL (
        SELECT r.position, r.price
          FROM public.ticket_rounds r
         WHERE r.event_id = e.id AND r.is_active AND NOT r.manually_sold_out
           AND r.max_tickets > 0 AND r.tickets_sold < r.max_tickets
           AND r.tickets_sold * 100 >= r.max_tickets * v_threshold
         ORDER BY r.position LIMIT 1
      ) cur ON true
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND COALESCE(e.ticket_selling_mode, 'rounds') = 'rounds'
       AND e.ticketing_enabled AND NOT e.tickets_sold_out
       AND e.start_at > now() + interval '2 hours'
       AND EXISTS (SELECT 1 FROM public.ticket_rounds n
                    WHERE n.event_id = e.id AND n.position > cur.position AND n.price > cur.price
                      AND NOT n.manually_sold_out AND n.tickets_sold < n.max_tickets)
     ORDER BY e.start_at ASC
     LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      SELECT count(*) INTO v_eligible FROM (
        SELECT lower(x.recipient_email) AS em
          FROM public.email_campaigns c
          JOIN public.email_campaign_events x ON x.campaign_id = c.id AND x.event_type = 'clicked'
         WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
           AND x.created_at > now() - interval '60 days' AND x.recipient_email IS NOT NULL
           AND (c.event_id = v_event_id
                OR COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '') LIKE '%/event/' || v_event_id::text || '%')
        UNION
        SELECT lower(w.email) FROM public.event_waitlist w WHERE w.event_id = v_event_id AND w.email IS NOT NULL
      ) i
      WHERE NOT public._email_event_holder(v_event_id, i.em)
        AND EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                     WHERE lower(s.email) = i.em AND s.opted_in AND s.opted_out_at IS NULL
                       AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id))
        AND (a.id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.email_automation_sends l
           WHERE l.automation_id = a.id AND l.trigger_key = v_event_id::text AND lower(l.email) = i.em));
    END IF;

  ELSIF p_kind = 'abandoned_checkout' THEN
    WITH pend AS (
      SELECT DISTINCT ON (lower(x.em), x.event_id) lower(x.em) AS em, x.event_id, x.created_at
        FROM (
          SELECT t.user_email AS em, t.event_id, t.created_at
            FROM public.tickets t JOIN public.events e ON e.id = t.event_id
           WHERE t.status = 'pending' AND t.user_email IS NOT NULL
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
             AND t.created_at >= now() - interval '48 hours' AND e.start_at > now() + interval '1 hour'
          UNION ALL
          SELECT r.user_email, r.event_id, r.created_at
            FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
           WHERE r.status = 'pending' AND r.user_email IS NOT NULL
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
             AND r.created_at >= now() - interval '48 hours' AND e.start_at > now() + interval '1 hour'
        ) x
       ORDER BY lower(x.em), x.event_id, x.created_at DESC
    ),
    open AS (
      SELECT p.* FROM pend p
       WHERE NOT public._email_event_holder(p.event_id, p.em)
         AND (a.id IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = p.event_id::text AND lower(l.email) = p.em))
    )
    SELECT count(*),
           min(o.created_at + v_delay) FILTER (WHERE o.created_at + v_delay > now()),
           (SELECT o2.event_id FROM open o2 WHERE o2.created_at + v_delay > now() ORDER BY o2.created_at LIMIT 1)
      INTO v_eligible, v_due, v_event_id
      FROM open o;
    IF v_event_id IS NOT NULL THEN
      SELECT e.title INTO v_event_title FROM public.events e WHERE e.id = v_event_id;
    END IF;

  ELSIF p_kind = 'welcome' THEN
    SELECT count(*), min(s.created_at + v_delay) FILTER (WHERE s.created_at + v_delay > now())
      INTO v_eligible, v_due
      FROM public.newsletter_subscriptions s
     WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND s.opted_in AND s.opted_out_at IS NULL
       AND s.import_id IS NULL
       AND COALESCE(s.source, '') NOT LIKE 'import%'
       AND COALESCE(s.source, '') NOT LIKE 'platform%'
       AND COALESCE(s.source, '') NOT LIKE 'checkout%'
       AND COALESCE(s.source, '') NOT LIKE 'connector%'
       AND s.created_at >= LEAST(v_enabled_at, now())
       AND s.created_at >= now() - interval '14 days'
       AND (a.id IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND l.trigger_key = 'once' AND lower(l.email) = lower(s.email)));
    v_event_id := v_next;

  ELSIF p_kind IN ('post_event_thanks', 'post_event_missed') THEN
    -- Éligibles = la dernière soirée finie et scannée (5 j) ; prochain départ
    -- = la fin de la prochaine soirée + délai.
    SELECT e.id INTO v_event_id
      FROM public.events e
     WHERE e.status = 'active' AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.end_at <= now() AND e.end_at >= now() - interval '5 days'
       AND (EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id = e.id AND (t.status = 'used' OR t.used OR COALESCE(t.entry_scanned, false)))
         OR EXISTS (SELECT 1 FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id WHERE gl.event_id = e.id AND ge.entry_scanned)
         OR EXISTS (SELECT 1 FROM public.table_reservations r WHERE r.event_id = e.id AND (COALESCE(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL))
         OR EXISTS (SELECT 1 FROM public.external_tickets xt WHERE xt.event_id = e.id AND xt.scanned_at IS NOT NULL AND xt.status IN ('valid', 'transferred')))
     ORDER BY e.end_at DESC
     LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      WITH came AS (
        SELECT lower(t.user_email) AS em FROM public.tickets t
         WHERE t.event_id = v_event_id AND t.user_email IS NOT NULL AND (t.status = 'used' OR t.used OR COALESCE(t.entry_scanned, false))
        UNION
        SELECT lower(ge.email) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
         WHERE gl.event_id = v_event_id AND ge.email IS NOT NULL AND ge.entry_scanned
        UNION
        SELECT lower(r.user_email) FROM public.table_reservations r
         WHERE r.event_id = v_event_id AND r.user_email IS NOT NULL AND (COALESCE(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL)
        UNION
        SELECT lower(xt.buyer_email) FROM public.external_tickets xt
         WHERE xt.event_id = v_event_id AND xt.buyer_email IS NOT NULL AND xt.scanned_at IS NOT NULL AND xt.status IN ('valid', 'transferred')
      ),
      holders AS (
        SELECT lower(t.user_email) AS em FROM public.tickets t
         WHERE t.event_id = v_event_id AND t.user_email IS NOT NULL AND t.status IN ('paid', 'used')
        UNION
        SELECT lower(ge.email) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
         WHERE gl.event_id = v_event_id AND ge.email IS NOT NULL AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected')
        UNION
        SELECT lower(r.user_email) FROM public.table_reservations r
         WHERE r.event_id = v_event_id AND r.user_email IS NOT NULL AND r.status IN ('paid', 'used')
        UNION
        SELECT lower(xt.buyer_email) FROM public.external_tickets xt
         WHERE xt.event_id = v_event_id AND xt.buyer_email IS NOT NULL AND xt.status IN ('valid', 'transferred')
      ),
      pop AS (
        SELECT em FROM came WHERE p_kind = 'post_event_thanks'
        UNION ALL
        SELECT h.em FROM holders h WHERE p_kind = 'post_event_missed' AND NOT EXISTS (SELECT 1 FROM came c WHERE c.em = h.em)
      )
      SELECT count(*) INTO v_eligible
        FROM pop
       WHERE EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                      WHERE lower(s.email) = pop.em AND s.opted_in AND s.opted_out_at IS NULL
                        AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id))
         AND (a.id IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = v_event_id::text AND lower(l.email) = pop.em));
    END IF;
    SELECT e.id, e.title, e.end_at + v_delay INTO v_event_id, v_event_title, v_due
      FROM public.events e
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.start_at > now()
     ORDER BY e.start_at ASC
     LIMIT 1;

  ELSIF p_kind = 'win_back' THEN
    SELECT count(*) INTO v_eligible
      FROM public.newsletter_subscriptions s
      JOIN LATERAL (
        SELECT max(x.at) AS last_at FROM (
          SELECT t.created_at AS at FROM public.tickets t JOIN public.events e ON e.id = t.event_id
           WHERE lower(t.user_email) = lower(s.email) AND t.status IN ('paid', 'used')
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
          UNION ALL
          SELECT r.created_at FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
           WHERE lower(r.user_email) = lower(s.email) AND r.status IN ('paid', 'used')
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
          UNION ALL
          SELECT ge.entry_scanned_at FROM public.guest_list_entries ge
            JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN public.events e ON e.id = gl.event_id
           WHERE lower(ge.email) = lower(s.email) AND ge.entry_scanned AND ge.entry_scanned_at IS NOT NULL
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
          UNION ALL
          SELECT COALESCE(xt.purchased_at, xt.first_seen_at) FROM public.external_tickets xt
           WHERE lower(xt.buyer_email) = lower(s.email) AND xt.status IN ('valid', 'transferred')
             AND ((p_venue_id IS NOT NULL AND xt.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND xt.organizer_user_id = p_organizer_user_id))
        ) x
      ) act ON true
     WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND s.opted_in AND s.opted_out_at IS NULL
       AND act.last_at IS NOT NULL
       AND act.last_at <= now() - v_delay
       AND act.last_at > now() - v_delay - interval '120 days'
       AND (a.id IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND lower(l.email) = lower(s.email)
            AND l.created_at > now() - interval '180 days'));
    v_event_id := v_next;

  ELSIF p_kind = 'regular_lapse' THEN
    -- Même porte que le moteur. La soirée affichée est celle que Yuno a
    -- choisie pour le plus récent d'entre eux (chacun reçoit la sienne).
    SELECT count(*), (array_agg(r.pick_event_id ORDER BY r.last_at DESC) FILTER (WHERE r.pick_event_id IS NOT NULL))[1]
      INTO v_eligible, v_event_id
      FROM public._regular_lapse_candidates(p_venue_id, p_organizer_user_id, v_delay) r
     WHERE EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                    WHERE lower(s.email) = r.em AND s.opted_in AND s.opted_out_at IS NULL
                      AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id))
       AND (a.id IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND lower(l.email) = r.em
            AND l.created_at > now() - interval '120 days'));
    v_event_id := COALESCE(v_event_id, v_next);
  END IF;

  IF v_event_id IS NOT NULL AND v_event_title IS NULL THEN
    SELECT e.title INTO v_event_title FROM public.events e WHERE e.id = v_event_id;
  END IF;

  RETURN jsonb_build_object(
    'eligible', COALESCE(v_eligible, 0),
    'base', COALESCE(v_base, 0),
    'next_event_id', v_event_id,
    'next_event_title', v_event_title,
    'next_due_at', CASE WHEN v_due > now() THEN v_due END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._email_automation_suggestions(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  out jsonb := '[]'::jsonb;
  v_base integer := 0;
  n integer;
  v_event_id uuid;
  v_title text;
  v_start timestamptz;
  v_pct integer;
BEGIN
  IF p_venue_id IS NULL AND p_organizer_user_id IS NULL THEN RETURN out; END IF;
  -- La démo n'est pas un chiffre.
  IF p_venue_id IS NOT NULL AND p_venue_id = ANY (public.demo_venue_ids()) THEN RETURN out; END IF;
  IF p_organizer_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = p_organizer_user_id AND public.is_demo_email(p.email)
  ) THEN RETURN out; END IF;

  SELECT count(*) INTO v_base
    FROM public.newsletter_subscriptions s
   WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND s.opted_in AND s.opted_out_at IS NULL;

  -- Panier abandonné : ≥ 3 paiements commencés et jamais finis sur 30 j.
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'abandoned_checkout') THEN
    SELECT count(*) INTO n FROM (
      SELECT DISTINCT lower(x.em), x.event_id FROM (
        SELECT t.user_email AS em, t.event_id FROM public.tickets t JOIN public.events e ON e.id = t.event_id
         WHERE t.status = 'pending' AND t.user_email IS NOT NULL AND t.created_at >= now() - interval '30 days'
           AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
        UNION ALL
        SELECT r.user_email, r.event_id FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
         WHERE r.status = 'pending' AND r.user_email IS NOT NULL AND r.created_at >= now() - interval '30 days'
           AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
      ) x
      WHERE NOT public._email_event_holder(x.event_id, x.em)
    ) y;
    IF n >= 3 THEN
      out := out || jsonb_build_object('kind', 'abandoned_checkout', 'reason_key', 'em.auto.sug.abandoned',
               'reason_vars', jsonb_build_object('n', n), 'reach', n);
    END IF;
  END IF;

  -- Dernier appel : prochaine soirée sous 10 j qui vend encore, base ≥ 50.
  IF v_base >= 50 AND NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'last_call') THEN
    SELECT e.id, e.title, e.start_at INTO v_event_id, v_title, v_start
      FROM public.events e
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.start_at > now() + interval '2 hours' AND e.start_at <= now() + interval '10 days'
       AND (((e.ticketing_enabled OR e.external_ticket_url IS NOT NULL) AND NOT e.tickets_sold_out) OR (e.tables_enabled AND NOT e.tables_sold_out)
            OR (NOT e.guest_list_sold_out AND EXISTS (SELECT 1 FROM public.guest_lists gl WHERE gl.event_id = e.id AND gl.is_active AND gl.visible_on_club_page AND NOT gl.manually_sold_out)))
     ORDER BY e.start_at LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      SELECT count(*) INTO n FROM public.newsletter_subscriptions s
       WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
         AND s.opted_in AND s.opted_out_at IS NULL AND NOT public._email_event_holder(v_event_id, s.email);
      out := out || jsonb_build_object('kind', 'last_call', 'reason_key', 'em.auto.sug.lastCall',
               'reason_vars', jsonb_build_object('event', v_title, 'd', GREATEST(0, floor(extract(epoch FROM (v_start - now())) / 86400))::integer, 'n', n),
               'reach', n, 'event_id', v_event_id);
    END IF;
  END IF;

  -- Passe en table : prochaine soirée avec tables libres et ≥ 20 billets vendus.
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'table_upsell') THEN
    v_event_id := NULL;
    SELECT e.id, e.title INTO v_event_id, v_title
      FROM public.events e
      JOIN LATERAL (SELECT public._event_tables_left(e.id) AS n) tl ON true
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.tables_enabled AND NOT e.tables_sold_out AND COALESCE(tl.n, 0) > 0
       AND e.start_at > now() + interval '2 hours'
       AND (SELECT count(DISTINCT lower(t.user_email)) FROM public.tickets t WHERE t.event_id = e.id AND t.status IN ('paid', 'used')) >= 20
     ORDER BY e.start_at LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      SELECT count(DISTINCT lower(t.user_email)) INTO n FROM public.tickets t
       WHERE t.event_id = v_event_id AND t.status IN ('paid', 'used') AND t.user_email IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.table_reservations r WHERE r.event_id = v_event_id AND lower(r.user_email) = lower(t.user_email) AND r.status IN ('paid', 'used', 'confirmed', 'pending'));
      out := out || jsonb_build_object('kind', 'table_upsell', 'reason_key', 'em.auto.sug.tableUpsell',
               'reason_vars', jsonb_build_object('event', v_title, 'n', n), 'reach', n, 'event_id', v_event_id);
    END IF;
  END IF;

  -- Nouvelle soirée : ≥ 1 soirée publiée sur 30 j sans aucune campagne reliée.
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'new_event') THEN
    SELECT count(*) INTO n FROM public.events e
     WHERE e.status = 'active' AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.published_at >= now() - interval '30 days'
       AND NOT EXISTS (SELECT 1 FROM public.email_campaigns c WHERE c.event_id = e.id
                         AND public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id));
    IF n >= 1 THEN
      out := out || jsonb_build_object('kind', 'new_event', 'reason_key', 'em.auto.sug.newEvent',
               'reason_vars', jsonb_build_object('n', n), 'reach', v_base);
    END IF;
  END IF;

  -- Merci / On t'a manqué : ≥ 1 soirée passée avec scans sur 30 j.
  SELECT count(*) INTO n FROM public.events e
   WHERE e.status = 'active' AND e.cancelled_at IS NULL
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
     AND e.end_at <= now() AND e.end_at >= now() - interval '30 days'
     AND (EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id = e.id AND (t.status = 'used' OR t.used OR COALESCE(t.entry_scanned, false)))
       OR EXISTS (SELECT 1 FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id WHERE gl.event_id = e.id AND ge.entry_scanned)
       OR EXISTS (SELECT 1 FROM public.table_reservations r WHERE r.event_id = e.id AND (COALESCE(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL))
         OR EXISTS (SELECT 1 FROM public.external_tickets xt WHERE xt.event_id = e.id AND xt.scanned_at IS NOT NULL AND xt.status IN ('valid', 'transferred')));
  IF n >= 1 THEN
    IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'post_event_thanks') THEN
      out := out || jsonb_build_object('kind', 'post_event_thanks', 'reason_key', 'em.auto.sug.thanks',
               'reason_vars', jsonb_build_object('n', n), 'reach', (
                 SELECT count(DISTINCT em) FROM (
                   SELECT lower(t.user_email) AS em FROM public.tickets t JOIN public.events e ON e.id = t.event_id
                    WHERE (t.status = 'used' OR t.used OR COALESCE(t.entry_scanned, false)) AND t.user_email IS NOT NULL
                      AND e.end_at <= now() AND e.end_at >= now() - interval '30 days'
                      AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
                   UNION
                   SELECT lower(ge.email) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN public.events e ON e.id = gl.event_id
                    WHERE ge.entry_scanned AND ge.email IS NOT NULL
                      AND e.end_at <= now() AND e.end_at >= now() - interval '30 days'
                      AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
                   UNION
                   SELECT lower(xt.buyer_email) FROM public.external_tickets xt JOIN public.events e ON e.id = xt.event_id
                    WHERE xt.scanned_at IS NOT NULL AND xt.buyer_email IS NOT NULL AND xt.status IN ('valid', 'transferred')
                      AND e.end_at <= now() AND e.end_at >= now() - interval '30 days'
                      AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
                 ) c));
    END IF;
    IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'post_event_missed') THEN
      out := out || jsonb_build_object('kind', 'post_event_missed', 'reason_key', 'em.auto.sug.missed',
               'reason_vars', jsonb_build_object('n', n), 'reach', (
                 SELECT count(DISTINCT lower(t.user_email)) FROM public.tickets t JOIN public.events e ON e.id = t.event_id
                  WHERE t.status = 'paid' AND NOT t.used AND NOT COALESCE(t.entry_scanned, false) AND t.user_email IS NOT NULL
                    AND e.end_at <= now() AND e.end_at >= now() - interval '30 days'
                    AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))));
    END IF;
  END IF;

  -- L'habitué décroche : ≥ 3 habitués (deux sorties par mois) silencieux
  -- depuis six semaines, que personne n'a encore relancés.
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'regular_lapse') THEN
    SELECT count(*) INTO n
      FROM public._regular_lapse_candidates(p_venue_id, p_organizer_user_id, interval '42 days') r
     WHERE EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                    WHERE lower(s.email) = r.em AND s.opted_in AND s.opted_out_at IS NULL
                      AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id));
    IF n >= 3 THEN
      out := out || jsonb_build_object('kind', 'regular_lapse', 'reason_key', 'em.auto.sug.regularLapse',
               'reason_vars', jsonb_build_object('n', n), 'reach', n);
    END IF;
  END IF;

  -- Reconquête : ≥ 30 clients silencieux depuis 60 j (dernière venue entre 60 et 240 j).
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'win_back') THEN
    SELECT count(*) INTO n
      FROM public.newsletter_subscriptions s
      JOIN LATERAL (
        SELECT max(x.at) AS last_at FROM (
          SELECT t.created_at AS at FROM public.tickets t JOIN public.events e ON e.id = t.event_id
           WHERE lower(t.user_email) = lower(s.email) AND t.status IN ('paid', 'used')
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
          UNION ALL
          SELECT r.created_at FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
           WHERE lower(r.user_email) = lower(s.email) AND r.status IN ('paid', 'used')
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
          UNION ALL
          SELECT ge.entry_scanned_at FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN public.events e ON e.id = gl.event_id
           WHERE lower(ge.email) = lower(s.email) AND ge.entry_scanned AND ge.entry_scanned_at IS NOT NULL
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
          UNION ALL
          SELECT COALESCE(xt.purchased_at, xt.first_seen_at) FROM public.external_tickets xt
           WHERE lower(xt.buyer_email) = lower(s.email) AND xt.status IN ('valid', 'transferred')
             AND ((p_venue_id IS NOT NULL AND xt.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND xt.organizer_user_id = p_organizer_user_id))
        ) x
      ) act ON true
     WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND s.opted_in AND s.opted_out_at IS NULL
       AND act.last_at IS NOT NULL
       AND act.last_at <= now() - interval '60 days'
       AND act.last_at > now() - interval '240 days';
    IF n >= 30 THEN
      out := out || jsonb_build_object('kind', 'win_back', 'reason_key', 'em.auto.sug.winBack',
               'reason_vars', jsonb_build_object('n', n), 'reach', n);
    END IF;
  END IF;

  -- Bienvenue : ≥ 10 nouvelles inscriptions sur 30 j (hors imports, checkout, plateforme).
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'welcome') THEN
    SELECT count(*) INTO n FROM public.newsletter_subscriptions s
     WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND s.opted_in AND s.opted_out_at IS NULL AND s.import_id IS NULL
       AND COALESCE(s.source, '') NOT LIKE 'import%' AND COALESCE(s.source, '') NOT LIKE 'platform%' AND COALESCE(s.source, '') NOT LIKE 'checkout%' AND COALESCE(s.source, '') NOT LIKE 'connector%'
       AND s.created_at >= now() - interval '30 days';
    IF n >= 10 THEN
      out := out || jsonb_build_object('kind', 'welcome', 'reason_key', 'em.auto.sug.welcome',
               'reason_vars', jsonb_build_object('n', n), 'reach', n);
    END IF;
  END IF;

  -- Le tarif monte : une soirée en paliers dont le palier ouvert dépasse 70 %, avec un palier plus cher ensuite.
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'tier_closing') THEN
    v_event_id := NULL;
    SELECT e.id, e.title, cur.pct INTO v_event_id, v_title, v_pct
      FROM public.events e
      JOIN LATERAL (
        SELECT r.position, r.price, (r.tickets_sold * 100 / r.max_tickets)::integer AS pct
          FROM public.ticket_rounds r
         WHERE r.event_id = e.id AND r.is_active AND NOT r.manually_sold_out
           AND r.max_tickets > 0 AND r.tickets_sold < r.max_tickets
           AND r.tickets_sold * 100 >= r.max_tickets * 70
         ORDER BY r.position LIMIT 1
      ) cur ON true
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND COALESCE(e.ticket_selling_mode, 'rounds') = 'rounds'
       AND e.ticketing_enabled AND NOT e.tickets_sold_out
       AND e.start_at > now() + interval '2 hours'
       AND EXISTS (SELECT 1 FROM public.ticket_rounds nx WHERE nx.event_id = e.id AND nx.position > cur.position AND nx.price > cur.price AND NOT nx.manually_sold_out AND nx.tickets_sold < nx.max_tickets)
     ORDER BY e.start_at LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      SELECT count(*) INTO n FROM (
        SELECT lower(x.recipient_email) AS em
          FROM public.email_campaigns c JOIN public.email_campaign_events x ON x.campaign_id = c.id AND x.event_type = 'clicked'
         WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
           AND x.created_at > now() - interval '60 days' AND x.recipient_email IS NOT NULL
           AND (c.event_id = v_event_id OR COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '') LIKE '%/event/' || v_event_id::text || '%')
        UNION
        SELECT lower(w.email) FROM public.event_waitlist w WHERE w.event_id = v_event_id AND w.email IS NOT NULL
      ) i WHERE NOT public._email_event_holder(v_event_id, i.em);
      out := out || jsonb_build_object('kind', 'tier_closing', 'reason_key', 'em.auto.sug.tier',
               'reason_vars', jsonb_build_object('event', v_title, 'p', v_pct), 'reach', n, 'event_id', v_event_id);
    END IF;
  END IF;

  -- Les plus larges d'abord.
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'reach')::integer DESC), '[]'::jsonb) INTO out
    FROM jsonb_array_elements(out) x;
  RETURN out;
END;
$function$;

CREATE OR REPLACE FUNCTION public._email_event_holder(p_event_id uuid, p_email text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.tickets t
                  WHERE t.event_id = p_event_id AND t.status IN ('paid', 'used') AND lower(t.user_email) = lower(p_email))
      OR EXISTS (SELECT 1 FROM public.table_reservations r
                  WHERE r.event_id = p_event_id AND r.status IN ('paid', 'used') AND lower(r.user_email) = lower(p_email))
      OR EXISTS (SELECT 1 FROM public.guest_list_entries ge
                   JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
                  WHERE gl.event_id = p_event_id AND lower(ge.email) = lower(p_email)
                    AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected'))
      OR EXISTS (SELECT 1 FROM public.external_tickets xt
                  WHERE xt.event_id = p_event_id AND xt.status IN ('valid', 'transferred') AND lower(xt.buyer_email) = lower(p_email));
$function$;

CREATE OR REPLACE FUNCTION public._email_engagement_rank(p_email text, p_venue_id text, p_organizer_user_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    -- (a) a ouvert ou cliqué un email marketing sous 90 j (tous expéditeurs).
    WHEN EXISTS (
      SELECT 1 FROM public.email_campaign_events ev
       WHERE lower(ev.recipient_email) = lower(p_email)
         AND ev.event_type IN ('opened', 'clicked')
         AND ev.created_at > now() - interval '90 days'
    ) THEN 0
    -- (b) est venu sous 180 j : billet payé, table payée ou scan de liste invités, dans la portée.
    WHEN EXISTS (
      SELECT 1 FROM public.tickets t JOIN public.events e ON e.id = t.event_id
       WHERE lower(t.user_email) = lower(p_email) AND t.status IN ('paid', 'used')
         AND t.created_at > now() - interval '180 days'
         AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
    ) OR EXISTS (
      SELECT 1 FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
       WHERE lower(r.user_email) = lower(p_email) AND r.status IN ('paid', 'used')
         AND r.created_at > now() - interval '180 days'
         AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
    ) OR EXISTS (
      SELECT 1 FROM public.guest_list_entries ge
        JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
        JOIN public.events e ON e.id = gl.event_id
       WHERE lower(ge.email) = lower(p_email) AND ge.entry_scanned
         AND ge.entry_scanned_at > now() - interval '180 days'
         AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
    ) OR EXISTS (
      SELECT 1 FROM public.external_tickets xt
       WHERE lower(xt.buyer_email) = lower(p_email) AND xt.status IN ('valid', 'transferred')
         AND COALESCE(xt.purchased_at, xt.first_seen_at) > now() - interval '180 days'
         AND ((p_venue_id IS NOT NULL AND xt.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND xt.organizer_user_id = p_organizer_user_id))
    ) THEN 1
    -- (c) inscrit au registre de la portée sous 30 j.
    WHEN EXISTS (
      SELECT 1 FROM public.newsletter_subscriptions s
       WHERE lower(s.email) = lower(p_email)
         AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
         AND s.created_at > now() - interval '30 days'
    ) THEN 2
    ELSE 3
  END;
$function$;

CREATE OR REPLACE FUNCTION public._email_automation_next_event(p_venue_id text, p_organizer_user_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT e.id
    FROM public.events e
   WHERE e.status = 'active'
     AND (e.is_active OR e.external_source IS NOT NULL)
     AND e.cancelled_at IS NULL
     AND e.start_at > now()
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
   ORDER BY e.start_at ASC
   LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public._regular_lapse_candidates(p_venue_id text, p_organizer_user_id uuid, p_gap interval)
 RETURNS TABLE(em text, user_id uuid, last_at timestamp with time zone, nights integer, pick_event_id uuid, pick_reason text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH scope_ev AS (
    SELECT e.id, e.start_at, e.recurring_template_id,
           ((e.start_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris')) - interval '8 hours')::date AS night,
           ARRAY(
             SELECT DISTINCT lower(btrim(g))
               FROM unnest(COALESCE(e.music_genres, '{}'::text[]) || ARRAY[e.music_genre]) g
              WHERE g IS NOT NULL AND btrim(g) <> ''
           ) AS genres
      FROM public.events e
     WHERE e.cancelled_at IS NULL
       AND e.start_at < now()
       AND e.start_at > now() - p_gap - interval '120 days'
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
  ),
  visits AS (
    SELECT lower(t.user_email) AS em, t.user_id, t.event_id
      FROM public.tickets t JOIN scope_ev ev ON ev.id = t.event_id
     WHERE t.user_email IS NOT NULL AND t.status IN ('paid', 'used')
    UNION
    SELECT lower(r.user_email), r.user_id, r.event_id
      FROM public.table_reservations r JOIN scope_ev ev ON ev.id = r.event_id
     WHERE r.user_email IS NOT NULL AND r.status IN ('paid', 'used', 'confirmed')
    UNION
    SELECT lower(ge.email), ge.user_id, gl.event_id
      FROM public.guest_list_entries ge
      JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
      JOIN scope_ev ev ON ev.id = gl.event_id
     WHERE ge.email IS NOT NULL AND ge.entry_scanned
    UNION
    -- Yuno CRM : billets de la billetterie connectée.
    SELECT lower(xt.buyer_email), NULL::uuid, xt.event_id
      FROM public.external_tickets xt JOIN scope_ev ev ON ev.id = xt.event_id
     WHERE xt.buyer_email IS NOT NULL AND xt.status IN ('valid', 'transferred')
  ),
  v AS (
    SELECT x.em, x.user_id, ev.id AS event_id, ev.start_at, ev.night, ev.recurring_template_id, ev.genres
      FROM visits x JOIN scope_ev ev ON ev.id = x.event_id
     WHERE position('@' in x.em) > 1
  ),
  last_v AS (
    SELECT v.em, max(v.start_at) AS last_at,
           (array_agg(v.user_id) FILTER (WHERE v.user_id IS NOT NULL))[1] AS user_id
      FROM v GROUP BY v.em
  ),
  lapsed AS (
    SELECT l.em, l.user_id, l.last_at,
           count(DISTINCT v.night)::integer AS nights,
           array_agg(DISTINCT v.recurring_template_id) FILTER (WHERE v.recurring_template_id IS NOT NULL) AS series,
           mode() WITHIN GROUP (ORDER BY extract(isodow FROM v.night)) AS dow
      FROM last_v l
      JOIN v ON v.em = l.em AND v.start_at > l.last_at - interval '60 days' AND v.start_at <= l.last_at
     WHERE l.last_at <= now() - p_gap
       AND l.last_at > now() - p_gap - interval '30 days'
     GROUP BY l.em, l.user_id, l.last_at
    HAVING count(DISTINCT v.night) >= 4
  ),
  -- Ses goûts : les genres des soirées où il est venu (toute la fenêtre),
  -- plus ceux de son quiz Yuno s'il a un compte.
  tastes AS (
    SELECT p.em,
           ARRAY(
             SELECT DISTINCT g FROM (
               SELECT unnest(v.genres) AS g FROM v WHERE v.em = p.em
               UNION ALL
               SELECT lower(btrim(tg)) FROM public.user_taste_profiles tp, unnest(COALESCE(tp.genres, '{}'::text[])) tg
                WHERE p.user_id IS NOT NULL AND tp.user_id = p.user_id
             ) z WHERE g IS NOT NULL AND g <> ''
           ) AS genres
      FROM lapsed p
  ),
  upcoming AS (
    SELECT e.id, e.start_at, e.recurring_template_id,
           extract(isodow FROM ((e.start_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris')) - interval '8 hours')) AS dow,
           ARRAY(
             SELECT DISTINCT lower(btrim(g))
               FROM unnest(COALESCE(e.music_genres, '{}'::text[]) || ARRAY[e.music_genre]) g
              WHERE g IS NOT NULL AND btrim(g) <> ''
           ) AS genres
      FROM public.events e
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
       AND (e.visibility = 'public' OR e.external_source IS NOT NULL) AND NOT COALESCE(e.requires_access_code, false)
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.start_at > now() + interval '24 hours'
       AND e.start_at <= now() + interval '35 days'
       AND (
         ((e.ticketing_enabled OR e.external_ticket_url IS NOT NULL) AND NOT e.tickets_sold_out)
         OR (e.tables_enabled AND NOT e.tables_sold_out)
         OR (NOT e.guest_list_sold_out AND EXISTS (
               SELECT 1 FROM public.guest_lists gl
                WHERE gl.event_id = e.id AND gl.is_active AND gl.visible_on_club_page AND NOT gl.manually_sold_out))
       )
  )
  SELECT p.em, p.user_id, p.last_at, p.nights, pick.id, pick.reason
    FROM lapsed p
    JOIN tastes ts ON ts.em = p.em
    LEFT JOIN LATERAL (
      SELECT u.id,
             CASE WHEN u.series_hit THEN 'series' WHEN u.genre_hits > 0 THEN 'genre'
                  WHEN u.dow_hit THEN 'weekday' ELSE 'next' END AS reason
        FROM (
          SELECT up.id, up.start_at,
                 (up.recurring_template_id IS NOT NULL AND up.recurring_template_id = ANY (COALESCE(p.series, '{}'::uuid[]))) AS series_hit,
                 (SELECT count(*) FROM unnest(up.genres) g WHERE g = ANY (ts.genres))::integer AS genre_hits,
                 (up.dow = p.dow) AS dow_hit
            FROM upcoming up
        ) u
       ORDER BY (CASE WHEN u.series_hit THEN 4 ELSE 0 END) + 2 * LEAST(2, u.genre_hits) + (CASE WHEN u.dow_hit THEN 1 ELSE 0 END) DESC,
                u.start_at ASC
       LIMIT 1
    ) pick ON true
   -- Il revient déjà : une place pour une soirée à venir de la portée.
   WHERE NOT EXISTS (
     SELECT 1 FROM public.events e
      WHERE e.start_at > now() AND e.cancelled_at IS NULL
        AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
          OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
        AND public._email_event_holder(e.id, p.em)
   )
$function$;

CREATE OR REPLACE FUNCTION public.get_email_campaign_attribution(p_subject_type text, p_subject_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.can_read_audience(p_subject_type, p_subject_id) THEN
    RETURN jsonb_build_object('ok', false,
             'reason', CASE WHEN auth.uid() IS NULL THEN 'not_authenticated' ELSE 'forbidden' END);
  END IF;

  IF p_subject_type NOT IN ('venue', 'organizer') THEN
    RETURN jsonb_build_object('ok', true, 'supported', false);
  END IF;

  WITH scoped_events AS (
    SELECT e.id FROM public.events e
     WHERE CASE WHEN p_subject_type = 'venue'
                THEN (e.venue_id = p_subject_id OR e.partner_venue_id = p_subject_id OR e.id in (select public.cohost_event_ids_venue(p_subject_id)))
                ELSE (e.organizer_user_id::text = p_subject_id OR e.partner_organizer_id::text = p_subject_id OR e.id in (select public.cohost_event_ids_subject(p_subject_id)))
           END
  ),
  -- 1er clic par (campagne, email) sur les campagnes email du sujet (90 j)
  clicks AS (
    SELECT ece.campaign_id, lower(ece.recipient_email) AS em, min(ece.created_at) AS click_at
      FROM public.email_campaign_events ece
      JOIN public.email_campaigns ec ON ec.id = ece.campaign_id
     WHERE ece.event_type = 'clicked'
       AND ece.recipient_email IS NOT NULL
       AND ec.created_at >= now() - interval '90 days'
       AND CASE WHEN p_subject_type = 'venue'
                THEN ec.venue_id = p_subject_id
                ELSE ec.organizer_user_id::text = p_subject_id
           END
     GROUP BY ece.campaign_id, lower(ece.recipient_email)
  ),
  -- Actions du sujet avec NET (fees.ts), matchées par email. `units` = ce que
  -- le pilier compte vraiment : billets vendus, convives attablés, 1 inscrit.
  sales AS (
    SELECT 'ticket:' || t.id::text AS sale_key, 'ticket'::text AS kind,
           lower(t.user_email) AS em, t.created_at,
           (greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0) - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))) AS net,
           GREATEST(coalesce(t.quantity, 1), 1)::int AS units
      FROM public.tickets t
     WHERE t.event_id IN (SELECT id FROM scoped_events) AND t.status = 'paid' AND t.user_email IS NOT NULL
       AND t.created_at >= now() - interval '90 days'
    UNION ALL
    SELECT 'table:' || r.id::text, 'table', lower(r.user_email), r.created_at,
           (greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0) - least(greatest(coalesce(r.refund_amount, 0), 0), greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))),
           GREATEST(coalesce(r.guest_count, 0), 0)::int
      FROM public.table_reservations r
     WHERE r.event_id IN (SELECT id FROM scoped_events) AND r.status = 'paid' AND r.user_email IS NOT NULL
       AND r.created_at >= now() - interval '90 days'
    UNION ALL
    -- Boissons : périmètre venue = tout le bar du club ; périmètre organizer =
    -- les commandes rattachées à ses soirées.
    SELECT 'order:' || o.id::text, 'order', lower(o.user_email), o.created_at,
           (greatest(o.total - coalesce(o.service_fee, 0), 0) - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))),
           0
      FROM public.orders o
     WHERE o.status IN ('paid', 'served') AND o.user_email IS NOT NULL
       AND o.created_at >= now() - interval '90 days'
       AND CASE WHEN p_subject_type = 'venue'
                THEN o.venue_id = p_subject_id
                ELSE o.event_id IN (SELECT id FROM scoped_events)
           END
    UNION ALL
    -- Liste invités : zéro euro, mais c'est une entrée gagnée. Sur une soirée
    -- sans billetterie c'est la SEULE chose que l'email peut produire — la
    -- taire revenait à afficher « 0 € » sur une campagne qui a rempli la porte.
    SELECT 'guestlist:' || gle.id::text, 'guestlist', lower(gle.email), gle.created_at,
           0::numeric, 1
      FROM public.guest_list_entries gle
      JOIN public.guest_lists gl ON gl.id = gle.guest_list_id
     WHERE gl.event_id IN (SELECT id FROM scoped_events)
       AND gle.status <> 'cancelled'
       AND gle.email IS NOT NULL AND btrim(gle.email) <> ''
       AND gle.created_at >= now() - interval '90 days'
    UNION ALL
    -- Yuno CRM : achat sur la billetterie connectée (valeur faciale, hors frais).
    SELECT 'external:' || xt.id::text, 'ticket', lower(xt.buyer_email), COALESCE(xt.purchased_at, xt.first_seen_at),
           (COALESCE(xt.price, 0) * GREATEST(xt.quantity, 1))::numeric, GREATEST(xt.quantity, 1)
      FROM public.external_tickets xt
     WHERE xt.event_id IN (SELECT id FROM scoped_events) AND xt.status IN ('valid', 'transferred') AND xt.buyer_email IS NOT NULL
       AND COALESCE(xt.purchased_at, xt.first_seen_at) >= now() - interval '90 days'
  ),
  attributed AS (
    SELECT c.campaign_id, s.sale_key, s.kind, s.em, s.net, s.units
      FROM clicks c
      JOIN sales s
        ON s.em = c.em
       AND s.created_at >= c.click_at
       AND s.created_at <  c.click_at + interval '72 hours'
  ),
  per_campaign AS (
    SELECT campaign_id,
           round(sum(net)::numeric, 2)                                   AS revenue,
           count(DISTINCT em) FILTER (WHERE kind <> 'guestlist')         AS buyers,
           count(*)           FILTER (WHERE kind = 'ticket')             AS ticket_orders,
           coalesce(sum(units) FILTER (WHERE kind = 'ticket'), 0)        AS ticket_units,
           round(coalesce(sum(net) FILTER (WHERE kind = 'ticket'), 0)::numeric, 2)    AS ticket_revenue,
           count(*)           FILTER (WHERE kind = 'table')              AS table_orders,
           coalesce(sum(units) FILTER (WHERE kind = 'table'), 0)         AS table_guests,
           round(coalesce(sum(net) FILTER (WHERE kind = 'table'), 0)::numeric, 2)     AS table_revenue,
           count(*)           FILTER (WHERE kind = 'guestlist')          AS gl_entries,
           count(DISTINCT em) FILTER (WHERE kind = 'guestlist')          AS gl_people,
           count(*)           FILTER (WHERE kind = 'order')              AS drink_orders,
           round(coalesce(sum(net) FILTER (WHERE kind = 'order'), 0)::numeric, 2)     AS drink_revenue
      FROM attributed
     GROUP BY campaign_id
  )
  SELECT jsonb_build_object(
    'ok', true, 'supported', true,
    'campaigns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', campaign_id,
        'revenue', revenue,
        'buyers', buyers,
        'tickets',   jsonb_build_object('orders', ticket_orders, 'units', ticket_units, 'revenue', ticket_revenue),
        'tables',    jsonb_build_object('orders', table_orders,  'guests', table_guests, 'revenue', table_revenue),
        'guestlist', jsonb_build_object('entries', gl_entries,   'people', gl_people),
        'drinks',    jsonb_build_object('orders', drink_orders,  'revenue', drink_revenue)
      ))
      FROM per_campaign
    ), '[]'::jsonb),
    'total_90d', COALESCE((
      SELECT round(sum(net)::numeric, 2)
      FROM (SELECT DISTINCT sale_key, net FROM attributed) d
    ), 0)
  ) INTO result;

  RETURN result;
END;
$function$;

NOTIFY pgrst, 'reload schema';
