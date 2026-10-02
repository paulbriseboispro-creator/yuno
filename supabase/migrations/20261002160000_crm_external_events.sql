-- ============================================================================
-- Yuno CRM — lot 2a : les soirées et les acheteurs Shotgun entrent dans le CRM.
-- Plan : docs/designs/YUNO_CRM_PLAN.md §5.3 / §5.4.
--
-- 1. Soirée MIROIR. Chaque soirée Shotgun a une ligne `events` (Studio,
--    automatisations, segments, rapport : tout est indexé sur events.id), avec
--    `external_source = 'shotgun'`. Une soirée externe n'est JAMAIS publique :
--    le trigger `zw_force_external_event` la force inactive, privée, sans
--    billetterie / tables / liste d'attente Yuno, hors découverte — quoi que
--    tente un client. Toute la lecture publique (RLS `is_active`, Explore,
--    annonces push `_push_marketable_events`, get_new_events_to_announce,
--    moteur de découverte) l'ignore donc par construction.
-- 2. `external_tickets.event_id` : le billet pointe sur la soirée miroir, pour
--    que toutes les requêtes du CRM joignent comme pour un billet Yuno.
-- 3. Consentement : un acheteur Shotgun n'entre dans le registre
--    (`newsletter_subscriptions`) QUE si Shotgun rapporte son accord à la
--    newsletter (`source = 'connector:shotgun'`, `consent_source = 'ticketing'`).
--    Jamais de réabonnement d'un désabonné, jamais une adresse purgée ou
--    supprimée. Les autres acheteurs sont visibles et analysables, pas joignables.
-- 4. `contact_scope_customers` (porte de la base vivante) lit les billets
--    externes valides : base, segments, export, engagement, audiences en
--    héritent sans autre changement.
-- ============================================================================

-- ── 1. Colonnes ─────────────────────────────────────────────────────────────

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS external_source text,
  ADD COLUMN IF NOT EXISTS external_ticket_url text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_external_source_check') THEN
    ALTER TABLE public.events ADD CONSTRAINT events_external_source_check
      CHECK (external_source IS NULL OR external_source IN ('shotgun'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_external_ticket_url_check') THEN
    ALTER TABLE public.events ADD CONSTRAINT events_external_ticket_url_check
      CHECK (external_ticket_url IS NULL OR external_ticket_url ~ '^https://');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS events_external_source_idx
  ON public.events (external_source) WHERE external_source IS NOT NULL;

ALTER TABLE public.external_tickets
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS external_tickets_event_id_idx
  ON public.external_tickets (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS external_tickets_buyer_idx
  ON public.external_tickets (lower(buyer_email)) WHERE buyer_email IS NOT NULL;

-- ── 2. Une soirée externe n'est jamais publique ─────────────────────────────
-- SECURITY INVOKER (lit le rôle de l'appelant). Nommé « zw_ » : passe après
-- l'évaluation de découvrabilité et avant les gardes partenaires « zy_ / zz_ ».

CREATE OR REPLACE FUNCTION public.force_external_event_private()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    IF TG_OP = 'INSERT' AND NEW.external_source IS NOT NULL THEN
      RAISE EXCEPTION 'external events are created by the ticketing connector only' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.external_source IS DISTINCT FROM OLD.external_source
                          OR NEW.external_ticket_url IS DISTINCT FROM OLD.external_ticket_url) THEN
      RAISE EXCEPTION 'external_source / external_ticket_url are managed by the ticketing connector' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.external_source IS NOT NULL THEN
    NEW.is_active := false;
    NEW.visibility := 'private';
    NEW.is_discoverable := false;
    NEW.ticketing_enabled := false;
    NEW.tables_enabled := false;
    NEW.waitlist_enabled := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zw_force_external_event_private ON public.events;
CREATE TRIGGER zw_force_external_event_private
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.force_external_event_private();

-- Les promoteurs ne vendent pas une soirée Shotgun depuis Yuno.
CREATE OR REPLACE FUNCTION public.auto_assign_promoters_to_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Soirée miroir d'une billetterie externe (Yuno CRM) : rien à assigner.
  IF NEW.external_source IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- Guestlist/tables ouverts par défaut : sans assignation, le fallback
  -- "Smart Mixed" donnait déjà les deux accès — l'auto-assignation ne doit
  -- pas être une régression de droits.
  INSERT INTO public.promoter_event_assignments
    (promoter_id, event_id, commission_template_id, status, can_access_guestlist, can_access_tables)
  SELECT p.id, NEW.id, p.default_commission_template_id, 'active', true, true
  FROM public.promoters p
  WHERE p.is_active
    AND p.auto_assign_events
    AND (
      (p.venue_id IS NOT NULL
        AND (p.venue_id = NEW.venue_id OR p.venue_id = NEW.partner_venue_id))
      OR
      (p.organizer_user_id IS NOT NULL
        AND (p.organizer_user_id = NEW.organizer_user_id
          OR p.organizer_user_id = NEW.partner_organizer_id))
    )
  ON CONFLICT (promoter_id, event_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- Les liens suivis d'une soirée pointent sur SA page Yuno : une soirée
-- externe n'en a pas (les liens vers la billetterie viendront avec la collecte).
CREATE OR REPLACE FUNCTION public.trg_seed_event_tracked_links()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.external_source IS NOT NULL THEN
    RETURN NEW;
  END IF;
  BEGIN
    PERFORM public.seed_event_tracked_links(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    -- Best-effort : on log et on continue, la soirée se crée quoi qu'il arrive.
    RAISE WARNING 'seed_event_tracked_links failed for event %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END; $function$;

-- ── 3. Miroir, liens billet → soirée, consentement ──────────────────────────

CREATE OR REPLACE FUNCTION public.ticketing_after_sync(p_connection_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.ticketing_connections%ROWTYPE;
  x RECORD;
  v_event uuid;
  v_end timestamptz;
  v_created integer := 0;
  v_updated integer := 0;
  v_linked integer := 0;
  v_consent integer := 0;
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
  --     adresse purgée (email_opt_outs) ni supprimée (bounce, plainte).
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
     ORDER BY lower(t.buyer_email), t.purchased_at DESC NULLS LAST
    ON CONFLICT (lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_consent = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('events_created', v_created, 'events_updated', v_updated,
                            'tickets_linked', v_linked, 'consents_added', v_consent);
END;
$$;
REVOKE ALL ON FUNCTION public.ticketing_after_sync(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_after_sync(uuid) TO service_role;

-- Supprimer les données importées : les soirées miroir partent avec (les
-- billets et soirées externes partent en cascade avec la connexion).
CREATE OR REPLACE FUNCTION public.ticketing_connections_drop_mirrors()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT ee.event_id FROM public.external_events ee
      JOIN public.events e ON e.id = ee.event_id AND e.external_source IS NOT NULL
     WHERE ee.connection_id = OLD.id
  LOOP
    BEGIN
      DELETE FROM public.events WHERE id = v_id;
    EXCEPTION WHEN OTHERS THEN
      -- Une campagne envoyée peut encore citer la soirée : elle reste,
      -- inactive et privée (le trigger zw_ l'y maintient), la purge continue.
      RAISE WARNING 'mirror event % kept: %', v_id, SQLERRM;
    END;
  END LOOP;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_ticketing_connections_drop_mirrors ON public.ticketing_connections;
CREATE TRIGGER trg_ticketing_connections_drop_mirrors
  BEFORE DELETE ON public.ticketing_connections
  FOR EACH ROW EXECUTE FUNCTION public.ticketing_connections_drop_mirrors();

-- ── 4. Base vivante : les billets externes comptent ─────────────────────────

CREATE OR REPLACE FUNCTION public.contact_scope_customers(p_venue_id text, p_organizer_user_id uuid)
 RETURNS TABLE(email text, user_id uuid, first_name text, last_name text, phone text, spent numeric, event_count integer, paid_count integer, ticket_count integer, table_count integer, order_count integer, guest_list_count integer, first_at timestamp with time zone, last_at timestamp with time zone, last_paid_at timestamp with time zone, city text, age integer, gender text, subscribed boolean, sub_source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ev AS (
    SELECT e.id
      FROM public.events e
     WHERE (p_venue_id IS NOT NULL AND (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id))
        OR (p_organizer_user_id IS NOT NULL AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id))
  ), act AS (
    SELECT lower(btrim(t.user_email)) AS em,
           (t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0))::numeric AS amount,
           t.created_at, t.event_id, 'ticket'::text AS kind, t.user_id,
           COALESCE(t.guest_first_name, NULLIF(split_part(btrim(COALESCE(t.full_name, '')), ' ', 1), '')) AS fn,
           COALESCE(t.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(t.full_name, ''), '^\S+\s*', '')), '')) AS ln,
           NULLIF(btrim(COALESCE(t.phone, t.guest_phone, '')), '') AS ph
      FROM public.tickets t JOIN ev ON ev.id = t.event_id
     WHERE t.user_email IS NOT NULL AND btrim(t.user_email) <> '' AND t.paid_at IS NOT NULL
    UNION ALL
    SELECT lower(btrim(tr.user_email)),
           (tr.total_price - COALESCE(tr.service_fee, 0) - (CASE WHEN coalesce(tr.fee_absorbed, false) THEN coalesce(tr.management_fee, 0) ELSE 0 END))::numeric,
           tr.created_at, tr.event_id, 'table', tr.user_id,
           COALESCE(tr.guest_first_name, NULLIF(split_part(btrim(COALESCE(tr.full_name, '')), ' ', 1), '')),
           COALESCE(tr.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(tr.full_name, ''), '^\S+\s*', '')), '')),
           NULLIF(btrim(COALESCE(tr.phone, tr.guest_phone, '')), '')
      FROM public.table_reservations tr JOIN ev ON ev.id = tr.event_id
     WHERE tr.user_email IS NOT NULL AND btrim(tr.user_email) <> ''
       AND (tr.paid_at IS NOT NULL OR tr.status IN ('paid', 'confirmed'))
    UNION ALL
    SELECT lower(btrim(o.user_email)),
           (o.total - COALESCE(o.service_fee, 0))::numeric,
           o.created_at, o.event_id, 'order', o.user_id,
           o.guest_first_name, o.guest_last_name,
           NULLIF(btrim(COALESCE(o.guest_phone, '')), '')
      FROM public.orders o
     WHERE p_venue_id IS NOT NULL AND o.venue_id = p_venue_id
       AND o.user_email IS NOT NULL AND btrim(o.user_email) <> '' AND o.status = 'paid'
    UNION ALL
    SELECT lower(btrim(gle.email)),
           0::numeric,
           gle.created_at, gl.event_id, 'guestlist', gle.user_id,
           NULLIF(split_part(btrim(COALESCE(gle.full_name, '')), ' ', 1), ''),
           NULLIF(btrim(regexp_replace(COALESCE(gle.full_name, ''), '^\S+\s*', '')), ''),
           NULLIF(btrim(COALESCE(gle.phone, '')), '')
      FROM public.guest_list_entries gle
      JOIN public.guest_lists gl ON gl.id = gle.guest_list_id
      JOIN ev ON ev.id = gl.event_id
     WHERE gle.email IS NOT NULL AND btrim(gle.email) <> '' AND gle.status <> 'cancelled'
    UNION ALL
    -- Yuno CRM : billets d'une billetterie connectée (Shotgun), comptés comme
    -- des billets. Valeur faciale hors frais ; remboursés / annulés exclus.
    SELECT xt.buyer_email,
           (COALESCE(xt.price, 0) * GREATEST(xt.quantity, 1))::numeric,
           COALESCE(xt.purchased_at, xt.first_seen_at), xt.event_id, 'ticket', NULL::uuid,
           xt.buyer_first_name, xt.buyer_last_name, xt.buyer_phone
      FROM public.external_tickets xt
     WHERE ((p_venue_id IS NOT NULL AND xt.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND xt.organizer_user_id = p_organizer_user_id))
       AND xt.buyer_email IS NOT NULL
       AND xt.status IN ('valid', 'transferred')
  ), agg AS (
    SELECT a.em,
           COALESCE(sum(a.amount), 0) AS spent,
           count(DISTINCT a.event_id) AS event_count,
           count(*) FILTER (WHERE a.kind <> 'guestlist') AS paid_count,
           count(*) FILTER (WHERE a.kind = 'ticket') AS ticket_count,
           count(*) FILTER (WHERE a.kind = 'table') AS table_count,
           count(*) FILTER (WHERE a.kind = 'order') AS order_count,
           count(*) FILTER (WHERE a.kind = 'guestlist') AS guest_list_count,
           min(a.created_at) AS first_at,
           max(a.created_at) AS last_at,
           max(a.created_at) FILTER (WHERE a.kind <> 'guestlist') AS last_paid_at,
           (array_agg(a.user_id ORDER BY a.created_at DESC) FILTER (WHERE a.user_id IS NOT NULL))[1] AS uid,
           (array_agg(a.fn ORDER BY a.created_at DESC) FILTER (WHERE a.fn IS NOT NULL))[1] AS fn,
           (array_agg(a.ln ORDER BY a.created_at DESC) FILTER (WHERE a.ln IS NOT NULL))[1] AS ln,
           (array_agg(a.ph ORDER BY a.created_at DESC) FILTER (WHERE a.ph IS NOT NULL))[1] AS ph
      FROM act a
     GROUP BY a.em
  ), subs AS (
    -- Abonnés entrés par une surface Yuno (jamais par un fichier importé).
    SELECT lower(ns.email) AS em,
           bool_or(ns.opted_in AND ns.opted_out_at IS NULL) AS subscribed,
           max(ns.source) AS src,
           (array_agg(ns.user_id) FILTER (WHERE ns.user_id IS NOT NULL))[1] AS uid,
           max(ns.first_name) AS fn, max(ns.last_name) AS ln
      FROM public.newsletter_subscriptions ns
     WHERE public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND ns.import_id IS NULL
       AND COALESCE(ns.source, '') NOT LIKE '%import%'
     GROUP BY lower(ns.email)
  ), merged AS (
    SELECT COALESCE(a.em, s.em) AS em,
           COALESCE(a.uid, s.uid) AS uid,
           a.spent, a.event_count, a.paid_count, a.ticket_count, a.table_count, a.order_count, a.guest_list_count,
           a.first_at, a.last_at, a.last_paid_at,
           COALESCE(a.fn, s.fn) AS fn, COALESCE(a.ln, s.ln) AS ln, a.ph,
           COALESCE(s.subscribed, false) AS subscribed, s.src
      FROM agg a
      FULL OUTER JOIN subs s ON s.em = a.em
  )
  SELECT m.em::text AS email,
         COALESCE(m.uid, p.id) AS user_id,
         COALESCE(p.first_name, m.fn)::text AS first_name,
         COALESCE(p.last_name, m.ln)::text AS last_name,
         COALESCE(m.ph, p.phone)::text AS phone,
         m.spent, m.event_count::int, m.paid_count::int, m.ticket_count::int, m.table_count::int,
         m.order_count::int, m.guest_list_count::int, m.first_at, m.last_at, m.last_paid_at,
         NULLIF(btrim(COALESCE(p.city, '')), '')::text AS city,
         CASE WHEN p.birth_date IS NOT NULL THEN date_part('year', age(p.birth_date))::int END AS age,
         CASE
           WHEN lower(COALESCE(p.gender, '')) IN ('female', 'f', 'femme', 'woman', 'mujer') THEN 'female'
           WHEN lower(COALESCE(p.gender, '')) IN ('male', 'm', 'homme', 'man', 'hombre') THEN 'male'
           WHEN lower(COALESCE(p.gender, '')) IN ('other', 'autre', 'otro', 'non-binary', 'nb') THEN 'other'
         END::text AS gender,
         m.subscribed, m.src::text AS sub_source
    FROM merged m
    LEFT JOIN public.profiles p ON p.id = m.uid AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.uid AND u.deleted_at IS NULL)
   WHERE m.em IS NOT NULL AND position('@' in m.em) > 1;
$function$;

NOTIFY pgrst, 'reload schema';
