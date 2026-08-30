-- Fichier client organisateur : compter les inscriptions guest list.
--
-- `get_organizer_customer_segments` ne lisait que `tickets` et
-- `table_reservations` PAYÉS. Une soirée d'organisateur en entrée libre n'a ni
-- billet ni table : son fichier client restait donc vide, et les personnes
-- venues ce soir-là étaient perdues (aucun segment, aucune relance possible).
--
-- On ajoute la guest list comme troisième source d'activité, à 0 €. Les
-- compteurs de revenu sont donc inchangés ; `avg_basket` est explicitement
-- filtré pour rester un panier PAYÉ. La signature de la fonction ne bouge pas.
--
-- Ce que ça NE fait PAS : rendre ces personnes joignables par campagne email.
-- L'audience d'une campagne reste adossée à `newsletter_subscriptions`
-- (consentement) — une inscription guest list n'est pas un opt-in marketing.

CREATE OR REPLACE FUNCTION public.get_organizer_customer_segments(p_organizer_user_id uuid)
 RETURNS TABLE(id text, user_id uuid, email text, first_name text, last_name text, phone text, first_visit_at timestamp with time zone, last_visit_at timestamp with time zone, total_spent numeric, ticket_count integer, order_count integer, table_count integer, is_banned boolean, banned_at timestamp with time zone, ban_reason text, notes text, revenue_30d numeric, revenue_90d numeric, revenue_prev_90d numeric, avg_basket numeric, visit_nights integer, visits_per_month numeric, last_activity_at timestamp with time zone, preferred_dow integer, preferred_event_title text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT can_manage_organizer(p_organizer_user_id) THEN
    RAISE EXCEPTION 'Not authorized for organizer %', p_organizer_user_id USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH organizer_events AS (
    SELECT e.id, e.start_at, e.title
    FROM events e
    WHERE e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id
  ),
  -- Club revenue = amount charged − Yuno fees (tickets + tables only).
  activity AS (
    SELECT lower(t.user_email) AS em,
           (t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0))::numeric AS amount,
           t.created_at, t.event_id, 'ticket'::text AS kind,
           t.user_id, t.full_name, t.guest_first_name, t.guest_last_name,
           COALESCE(t.phone, t.guest_phone) AS phone
    FROM tickets t JOIN organizer_events oe ON oe.id = t.event_id
    WHERE t.user_email IS NOT NULL AND t.paid_at IS NOT NULL
    UNION ALL
    SELECT lower(tr.user_email),
           (tr.total_price - COALESCE(tr.service_fee, 0) - COALESCE(tr.management_fee, 0))::numeric,
           tr.created_at, tr.event_id, 'table'::text,
           tr.user_id, tr.full_name, tr.guest_first_name, tr.guest_last_name,
           COALESCE(tr.phone, tr.guest_phone)
    FROM table_reservations tr JOIN organizer_events oe ON oe.id = tr.event_id
    WHERE tr.user_email IS NOT NULL AND tr.paid_at IS NOT NULL
    UNION ALL
    -- Guest list : montant 0, mais c'est une PERSONNE de plus dans le fichier
    -- client. Sur une soirée en entrée libre (aucune billetterie, aucune table)
    -- c'est la SEULE activité qui existe : sans cette branche, l'organisateur
    -- terminait sa soirée avec un fichier client vide.
    SELECT lower(gle.email),
           0::numeric,
           gle.created_at, gl.event_id, 'guestlist'::text,
           gle.user_id, gle.full_name, NULL::text, NULL::text,
           NULLIF(btrim(COALESCE(gle.phone, '')), '')
    FROM guest_list_entries gle
    JOIN guest_lists gl ON gl.id = gle.guest_list_id
    JOIN organizer_events oe ON oe.id = gl.event_id
    WHERE gle.email IS NOT NULL
      AND btrim(gle.email) <> ''
      AND gle.status <> 'cancelled'
  ),
  agg AS (
    SELECT a.em,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '30 days'), 0) AS revenue_30d,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '90 days'), 0) AS revenue_90d,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '180 days'
                                       AND a.created_at < now() - interval '90 days'), 0) AS revenue_prev_90d,
      COALESCE(sum(a.amount), 0) AS total_spent,
      COALESCE(avg(a.amount) FILTER (WHERE a.kind <> 'guestlist'), 0) AS avg_basket,
      count(*) FILTER (WHERE a.kind = 'ticket') AS ticket_count,
      count(*) FILTER (WHERE a.kind = 'table') AS table_count,
      count(DISTINCT date(a.created_at)) AS visit_nights,
      max(a.created_at) AS last_activity_at,
      min(a.created_at) AS first_activity_at
    FROM activity a GROUP BY a.em
  ),
  ident AS (
    SELECT DISTINCT ON (a.em) a.em, a.user_id, a.full_name, a.guest_first_name, a.guest_last_name, a.phone
    FROM activity a ORDER BY a.em, a.created_at DESC
  ),
  event_activity AS (
    SELECT a.em, a.event_id, oe.start_at, oe.title, count(*) AS cnt
    FROM activity a JOIN organizer_events oe ON oe.id = a.event_id
    WHERE a.event_id IS NOT NULL
    GROUP BY a.em, a.event_id, oe.start_at, oe.title
  ),
  pref_event AS (
    SELECT DISTINCT ON (ea.em) ea.em, ea.title AS preferred_event_title
    FROM event_activity ea ORDER BY ea.em, ea.cnt DESC, ea.start_at DESC
  ),
  pref_dow AS (
    SELECT s.em, s.dow FROM (
      SELECT ea.em, extract(dow FROM ea.start_at)::int AS dow,
             row_number() OVER (PARTITION BY ea.em ORDER BY sum(ea.cnt) DESC) AS rn
      FROM event_activity ea GROUP BY ea.em, extract(dow FROM ea.start_at)
    ) s WHERE s.rn = 1
  )
  SELECT
    ag.em AS id,
    COALESCE(id_.user_id, p.id) AS user_id,
    ag.em AS email,
    COALESCE(p.first_name, id_.guest_first_name,
             NULLIF(split_part(COALESCE(id_.full_name, ''), ' ', 1), '')) AS first_name,
    COALESCE(p.last_name, id_.guest_last_name,
             NULLIF(substr(COALESCE(id_.full_name, ''), strpos(COALESCE(id_.full_name, '') || ' ', ' ') + 1), '')) AS last_name,
    COALESCE(p.phone, id_.phone) AS phone,
    ag.first_activity_at AS first_visit_at,
    ag.last_activity_at AS last_visit_at,
    round(ag.total_spent, 2) AS total_spent,
    ag.ticket_count::int, 0 AS order_count, ag.table_count::int,
    (b.email IS NOT NULL) AS is_banned, b.banned_at, b.ban_reason, n.notes,
    ag.revenue_30d, ag.revenue_90d, ag.revenue_prev_90d, ag.avg_basket,
    COALESCE(ag.visit_nights, 0)::int AS visit_nights,
    CASE
      WHEN ag.first_activity_at IS NULL THEN 0
      ELSE round(
        ag.visit_nights::numeric /
        greatest(1, extract(epoch FROM (ag.last_activity_at - ag.first_activity_at)) / 2592000.0),
        2)
    END AS visits_per_month,
    ag.last_activity_at, pd.dow AS preferred_dow, pe.preferred_event_title
  FROM agg ag
  LEFT JOIN ident id_ ON id_.em = ag.em
  LEFT JOIN profiles p ON lower(p.email) = ag.em
  LEFT JOIN organizer_banned_emails b ON b.organizer_user_id = p_organizer_user_id AND b.email = ag.em
  LEFT JOIN organizer_customer_notes n ON n.organizer_user_id = p_organizer_user_id AND n.email = ag.em
  LEFT JOIN pref_event pe ON pe.em = ag.em
  LEFT JOIN pref_dow pd ON pd.em = ag.em
  ORDER BY ag.last_activity_at DESC NULLS LAST;
END;
$function$
