-- Yuno CRM : la provenance « Pages d'inscription » devient réelle.
--
-- La fiche d'une personne porte une seule provenance (source). Jusqu'ici, un
-- fan inscrit par une page d'inscription (/j/<slug>) tombait dans « Import de
-- fichier » : sa ligne vit dans le groupe de la page (imported_contacts).
-- Désormais : « page » quand sa PREMIÈRE inscription confirmée par une page de
-- la portée précède son premier achat (ou qu'il n'a rien acheté) ; s'il avait
-- déjà acheté avant, sa provenance reste celle de son premier achat.
-- Le filtre Clients (`src`) et le modèle de segment « Inscrits via vos pages »
-- lisent cette colonne ; `_crm_filter_sql` accepte déjà 'page'.
--
-- Corps repris de l'état LIVE (pg_get_functiondef), seule la provenance change.

CREATE OR REPLACE FUNCTION public._crm_people_build(p_venue_id text, p_organizer_user_id uuid, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_at timestamptz := COALESCE(p_at, now());
  v_rules record;
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_tonight uuid;
  v_n integer;
BEGIN
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);
  PERFORM public.contact_build_rows(p_venue_id, p_organizer_user_id);

  DROP TABLE IF EXISTS _cpt;
  CREATE TEMP TABLE _cpt ON COMMIT DROP AS
    SELECT * FROM public._crm_tickets(p_venue_id, p_organizer_user_id) x
     WHERE x.bought_at <= v_at;

  -- « Ce soir » : la prochaine soirée si elle a lieu aujourd'hui (ou est en cours).
  SELECT e.id INTO v_tonight
    FROM public.events e
   WHERE ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
     AND (e.is_active OR e.external_source IS NOT NULL)
     AND COALESCE(e.end_at, e.start_at + interval '8 hours') > v_at
     AND (e.start_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'))::date
         <= (v_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'))::date
   ORDER BY e.start_at LIMIT 1;

  DROP TABLE IF EXISTS _cp;
  CREATE TEMP TABLE _cp ON COMMIT DROP AS
  WITH agg AS (
    SELECT t.email,
           count(DISTINCT t.event_id) FILTER (WHERE t.event_start <= v_at) AS nights,
           count(DISTINCT t.event_id) FILTER (WHERE t.event_start <= v_at
                 AND t.event_start > v_at - make_interval(months => v_rules.regular_window_months)) AS nights_win,
           min(t.event_start) FILTER (WHERE t.event_start <= v_at) AS first_night,
           max(t.event_start) FILTER (WHERE t.event_start <= v_at) AS last_night,
           COALESCE(sum(t.amount), 0) AS spent,
           array_agg(DISTINCT t.event_id) FILTER (WHERE t.event_id IS NOT NULL) AS events,
           bool_or(t.event_id = v_tonight) AS tonight,
           min(t.bought_at) AS first_buy
      FROM _cpt t
     WHERE t.email IS NOT NULL
     GROUP BY t.email
  ), first_utm AS (
    SELECT DISTINCT ON (lower(et.buyer_email)) lower(et.buyer_email) AS email,
           et.utm->>'utm_source' AS utm_source, et.utm->>'utm_medium' AS utm_medium
      FROM public.external_tickets et
     WHERE et.buyer_email IS NOT NULL
       AND ((p_venue_id IS NOT NULL AND et.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND et.organizer_user_id = p_organizer_user_id))
     ORDER BY lower(et.buyer_email), COALESCE(et.purchased_at, et.first_seen_at)
  ), page_first AS (
    -- Première inscription CONFIRMÉE par une page d'inscription de la portée.
    SELECT lower(e.email) AS email, min(e.created_at) AS at
      FROM public.crm_signup_entries e
      JOIN public.crm_signup_pages pg ON pg.id = e.page_id
     WHERE e.email IS NOT NULL AND e.confirmed_at IS NOT NULL AND e.created_at <= v_at
       AND pg.venue_id IS NOT DISTINCT FROM p_venue_id
       AND pg.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     GROUP BY 1
  ), base AS (
    SELECT lower(c.email) AS email, c.first_name, c.last_name, c.phone_e164, c.email_ok, c.phone_ok,
           c.origin, COALESCE(c.added_at, c.created_at) AS added_at, c.eng_status, c.bounced,
           c.list_import_id
      FROM _cr c
     WHERE c.email IS NOT NULL
       AND COALESCE(c.added_at, c.created_at, '-infinity'::timestamptz) <= v_at
  )
  SELECT b.email, b.first_name, b.last_name, b.phone_e164 AS phone, b.email_ok, b.phone_ok, b.origin,
         b.added_at, b.eng_status, COALESCE(b.bounced, false) AS bounced, b.list_import_id,
         COALESCE(a.nights, 0)::int AS nights, COALESCE(a.nights_win, 0)::int AS nights_win,
         a.first_night, a.last_night, round(COALESCE(a.spent, 0), 2) AS spent,
         COALESCE(a.events, '{}'::uuid[]) AS events, COALESCE(a.tonight, false) AS tonight,
         CASE WHEN pf.at IS NOT NULL AND (a.first_buy IS NULL OR pf.at < a.first_buy) THEN 'page'
              WHEN COALESCE(a.nights, 0) > 0 AND lower(u.utm_source) LIKE 'yuno%' THEN 'utm'
              WHEN COALESCE(a.nights, 0) > 0 THEN 'shotgun'
              WHEN b.origin IN ('import', 'both') THEN 'import'
              ELSE 'other' END AS source,
         u.utm_source, u.utm_medium,
         CASE
           WHEN COALESCE(a.nights, 0) = 0 THEN 'none'
           WHEN a.last_night < v_at - make_interval(months => v_rules.lapse_months) THEN 'end'
           WHEN a.nights_win >= v_rules.regular_min_nights THEN 'hab'
           WHEN a.first_night >= v_at - interval '90 days' THEN 'nou'
           ELSE 'occ' END AS lifecycle,
         n.tags, n.note
    FROM base b
    LEFT JOIN agg a ON a.email = b.email
    LEFT JOIN first_utm u ON u.email = b.email
    LEFT JOIN page_first pf ON pf.email = b.email
    LEFT JOIN public.crm_contact_notes n ON n.scope_key = v_scope AND n.email = b.email;

  -- Comportement face aux messages (12 mois avant la date) : reçus, envois
  -- cliqués, et « a cliqué sans acheter » (dernier clic des 90 jours sans
  -- billet acheté dans les 7 jours qui suivent).
  ALTER TABLE _cp ADD COLUMN msg_n integer NOT NULL DEFAULT 0,
                  ADD COLUMN click_n integer NOT NULL DEFAULT 0,
                  ADD COLUMN last_click timestamptz,
                  ADD COLUMN click_nobuy boolean NOT NULL DEFAULT false;
  WITH c AS (
    SELECT ec.id FROM public.email_campaigns ec
     WHERE ec.status IN ('sent', 'sending') AND ec.sent_at IS NOT NULL
       AND ec.sent_at <= v_at AND ec.sent_at > v_at - interval '12 months'
       AND ec.venue_id IS NOT DISTINCT FROM p_venue_id
       AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
  ), r AS (
    SELECT lower(x.email) AS em, count(*) AS n
      FROM public.email_campaign_recipients x JOIN c ON c.id = x.campaign_id
     WHERE x.status IN ('sent', 'complained')
     GROUP BY 1
  ), k AS (
    SELECT lower(ev.recipient_email) AS em, count(DISTINCT ev.campaign_id) AS n, max(ev.created_at) AS last
      FROM public.email_campaign_events ev JOIN c ON c.id = ev.campaign_id
     WHERE ev.event_type = 'clicked' AND ev.created_at <= v_at AND ev.recipient_email IS NOT NULL
     GROUP BY 1
  )
  UPDATE _cp p
     SET msg_n = COALESCE(r.n, 0), click_n = COALESCE(k.n, 0), last_click = k.last
    FROM (SELECT DISTINCT em FROM (SELECT em FROM r UNION SELECT em FROM k) u) e
    LEFT JOIN r ON r.em = e.em
    LEFT JOIN k ON k.em = e.em
   WHERE p.email = e.em;
  UPDATE _cp p
     SET click_nobuy = true
   WHERE p.last_click > v_at - interval '90 days'
     AND NOT EXISTS (SELECT 1 FROM _cpt t
                      WHERE t.email = p.email AND t.bought_at > p.last_click
                        AND t.bought_at <= LEAST(p.last_click + interval '7 days', v_at));

  SELECT count(*) INTO v_n FROM _cp;
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public._crm_people_build(text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_people_build(text, uuid, timestamptz) TO service_role;
