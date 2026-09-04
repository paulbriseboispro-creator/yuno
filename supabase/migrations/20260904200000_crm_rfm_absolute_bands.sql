-- ─────────────────────────────────────────────────────────────────────────────
-- CRM : un client vu il y a 3 jours ne peut plus être « Perdu ».
--
-- Le scoring RFM était 100 % RELATIF (quintiles sur la population du fichier
-- client). Sur une base minuscule — les premières soirées d'un club ou d'un
-- organisateur — la personne la MOINS récente des deux tombe mécaniquement à
-- R = 1/5, même si elle s'est inscrite avant-hier, et `segmentOf` la range en
-- « Perdus ». Un organisateur qui ouvre son fichier le lendemain de sa première
-- guest list y lit donc un client perdu qui n'est jamais venu : le segment ment,
-- et tout ce qui s'appuie dessus (push, relances, automations win_back) ment
-- avec lui.
--
-- Correctif : la RÉCENCE devient un fait de calendrier (14 / 30 / 60 / 90 jours)
-- et ne se compare plus à personne. La FRÉQUENCE garde une part relative, mais
-- encadrée à ±1 autour de sa bande absolue en nuits — un club qui tourne chaque
-- semaine n'a pas le rythme d'une soirée mensuelle, sans pour autant pouvoir
-- fabriquer un champion avec une seule visite.
--
-- Les bornes suivent la promesse du mode d'emploi (`ohelp.pg.customers.s3b`) :
-- au-delà de 90 jours sans activité on peut être « Perdu », entre 61 et 90 on
-- est « Dormant », en deçà jamais.
--
-- Le montant (M) reste purement relatif : « beaucoup dépensé » n'a de sens que
-- par rapport aux autres clients du même lieu (un club à bouteilles et une
-- soirée à 10 € n'ont pas la même échelle).
--
-- Deuxième correctif, même passe : le fichier client doit porter les
-- COORDONNÉES de la personne. `venue_customers` / la dernière activité ne
-- portent pas toujours le téléphone (une inscription guest list sans numéro
-- écrasait celui d'un achat précédent). On retient désormais la dernière valeur
-- NON NULLE de chaque champ, avec repli sur le profil du compte.
--
-- Troisième : `get_organizer_customer_segments` renvoie enfin les colonnes RFM.
-- Le front organisateur les recalculait en TypeScript — la duplication que
-- CLAUDE.md interdit explicitement depuis la v2 du CRM club. Une seule règle,
-- en SQL, pour les deux surfaces.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._venue_customer_rfm(p_venue_id TEXT)
RETURNS TABLE (
  id UUID, user_id UUID, email TEXT, first_name TEXT, last_name TEXT, phone TEXT,
  first_visit_at TIMESTAMPTZ, last_visit_at TIMESTAMPTZ, total_spent NUMERIC,
  ticket_count INTEGER, order_count INTEGER, table_count INTEGER,
  is_banned BOOLEAN, banned_at TIMESTAMPTZ, ban_reason TEXT, notes TEXT,
  revenue_30d NUMERIC, revenue_90d NUMERIC, revenue_prev_90d NUMERIC,
  avg_basket NUMERIC, visit_nights INTEGER, visits_per_month NUMERIC,
  last_activity_at TIMESTAMPTZ, preferred_dow INTEGER, preferred_event_title TEXT,
  recency_days INTEGER, rfm_r INTEGER, rfm_f INTEGER, rfm_m INTEGER,
  rfm_segment TEXT, rfm_tier TEXT, churn_risk BOOLEAN, is_guest BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Fonction INTERNE : aucune garde ici, droits révoqués plus bas.
  RETURN QUERY
  WITH venue_events AS (
    SELECT e.id, e.start_at, e.title
    FROM events e
    WHERE e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id
  ),
  -- Revenu club = montant facturé − frais Yuno. La part Yuno n'est jamais comptée.
  activity AS (
    SELECT lower(t.user_email) AS em,
           (t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0))::numeric AS amount,
           t.created_at, t.event_id
    FROM tickets t JOIN venue_events ve ON ve.id = t.event_id
    WHERE t.user_email IS NOT NULL AND t.paid_at IS NOT NULL
    UNION ALL
    SELECT lower(o.user_email),
           (o.total - COALESCE(o.service_fee, 0))::numeric,
           o.created_at, o.event_id
    FROM orders o
    WHERE o.venue_id = p_venue_id AND o.user_email IS NOT NULL AND o.status = 'paid'
    UNION ALL
    SELECT lower(tr.user_email),
           (tr.total_price - COALESCE(tr.service_fee, 0) - COALESCE(tr.management_fee, 0))::numeric,
           tr.created_at, tr.event_id
    FROM table_reservations tr JOIN venue_events ve ON ve.id = tr.event_id
    WHERE tr.user_email IS NOT NULL AND tr.paid_at IS NOT NULL
  ),
  agg AS (
    SELECT a.em,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '30 days'), 0) AS revenue_30d,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '90 days'), 0) AS revenue_90d,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '180 days'
                                       AND a.created_at < now() - interval '90 days'), 0) AS revenue_prev_90d,
      COALESCE(avg(a.amount), 0) AS avg_basket,
      count(DISTINCT date(a.created_at)) AS visit_nights,
      max(a.created_at) AS last_activity_at,
      min(a.created_at) AS first_activity_at
    FROM activity a GROUP BY a.em
  ),
  event_activity AS (
    SELECT a.em, a.event_id, ve.start_at, ve.title, count(*) AS cnt
    FROM activity a JOIN venue_events ve ON ve.id = a.event_id
    WHERE a.event_id IS NOT NULL
    GROUP BY a.em, a.event_id, ve.start_at, ve.title
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
  ),
  -- Ventes brutes par email : sémantique gross (= increment_venue_customer_stats),
  -- identité (nom/tél du dernier achat qui en porte), compteurs par pilier.
  guest_sales AS (
    SELECT lower(t.user_email) AS em, t.total_price::numeric AS gross, t.created_at,
           'ticket'::text AS kind, t.full_name, t.phone AS ph
    FROM tickets t JOIN venue_events ve ON ve.id = t.event_id
    WHERE t.user_email IS NOT NULL AND t.paid_at IS NOT NULL
    UNION ALL
    SELECT lower(o.user_email), o.total::numeric, o.created_at, 'order', NULL, NULL
    FROM orders o
    WHERE o.venue_id = p_venue_id AND o.user_email IS NOT NULL AND o.status = 'paid'
    UNION ALL
    SELECT lower(tr.user_email), tr.total_price::numeric, tr.created_at, 'table', tr.full_name, tr.phone
    FROM table_reservations tr JOIN venue_events ve ON ve.id = tr.event_id
    WHERE tr.user_email IS NOT NULL AND tr.paid_at IS NOT NULL
  ),
  -- Dernière valeur NON NULLE de chaque champ (et non la dernière ligne) : un
  -- achat sans numéro ne doit pas effacer le numéro laissé la fois d'avant.
  guest_identity AS (
    SELECT gs.em,
      (array_agg(gs.full_name ORDER BY gs.created_at DESC) FILTER (WHERE gs.full_name IS NOT NULL))[1] AS full_name,
      (array_agg(gs.ph ORDER BY gs.created_at DESC) FILTER (WHERE gs.ph IS NOT NULL))[1] AS ph
    FROM guest_sales gs GROUP BY gs.em
  ),
  guest_agg AS (
    SELECT gs.em,
      sum(gs.gross) AS total_spent,
      count(*) FILTER (WHERE gs.kind = 'ticket') AS ticket_count,
      count(*) FILTER (WHERE gs.kind = 'order')  AS order_count,
      count(*) FILTER (WHERE gs.kind = 'table')  AS table_count,
      min(gs.created_at) AS first_at,
      max(gs.created_at) AS last_at
    FROM guest_sales gs
    -- Anti-jointure : seuls les emails SANS ligne venue_customers deviennent invités.
    WHERE NOT EXISTS (
      SELECT 1 FROM venue_customers vc
      WHERE vc.venue_id = p_venue_id AND lower(vc.email) = gs.em
    )
    GROUP BY gs.em
  ),
  base AS (
    -- Clients à compte (lignes venue_customers)
    SELECT
      vc.id, vc.user_id, vc.email,
      COALESCE(vc.first_name, pr.first_name) AS first_name,
      COALESCE(vc.last_name, pr.last_name) AS last_name,
      COALESCE(NULLIF(btrim(COALESCE(vc.phone, '')), ''), pr.phone) AS phone,
      vc.first_visit_at, vc.last_visit_at, vc.total_spent,
      vc.ticket_count, vc.order_count, vc.table_count,
      vc.is_banned, vc.banned_at, vc.ban_reason, vc.notes,
      ag.revenue_30d, ag.revenue_90d, ag.revenue_prev_90d, ag.avg_basket,
      COALESCE(ag.visit_nights, 0)::int AS visit_nights,
      CASE
        WHEN ag.first_activity_at IS NULL THEN 0
        ELSE round(
          ag.visit_nights::numeric /
          greatest(1, extract(epoch FROM (ag.last_activity_at - ag.first_activity_at)) / 2592000.0),
          2)
      END AS visits_per_month,
      ag.last_activity_at, pd.dow AS preferred_dow, pe.preferred_event_title,
      floor(extract(epoch FROM (now() - COALESCE(ag.last_activity_at, vc.last_visit_at, vc.first_visit_at, now()))) / 86400)::int AS recency_days,
      CASE WHEN COALESCE(ag.visit_nights, 0) > 0 THEN ag.visit_nights::int
           ELSE COALESCE(vc.ticket_count, 0) + COALESCE(vc.order_count, 0) + COALESCE(vc.table_count, 0)
      END AS rfm_freq,
      COALESCE(vc.total_spent, 0)::numeric AS rfm_money,
      false AS is_guest
    FROM venue_customers vc
    LEFT JOIN agg ag ON ag.em = lower(vc.email)
    LEFT JOIN pref_event pe ON pe.em = lower(vc.email)
    LEFT JOIN pref_dow pd ON pd.em = lower(vc.email)
    -- Repli sur le profil du compte : le fichier client doit porter le
    -- téléphone du client, même quand l'achat qui l'a créé n'en portait pas.
    LEFT JOIN LATERAL (
      SELECT p.first_name, p.last_name, NULLIF(btrim(COALESCE(p.phone, '')), '') AS phone
      FROM profiles p WHERE p.id = vc.user_id LIMIT 1
    ) pr ON true
    WHERE vc.venue_id = p_venue_id

    UNION ALL

    -- Invités (lignes synthétiques par email)
    SELECT
      md5('guest:' || ga.em)::uuid AS id,
      -- user_id reste NULL : un invité n'est pas un compte, et c'est ce NULL
      -- qui l'exclut d'office du ciblage push de resolve_venue_segment.
      NULL::uuid AS user_id,
      ga.em AS email,
      NULLIF(split_part(COALESCE(gi.full_name, ''), ' ', 1), '') AS first_name,
      NULLIF(regexp_replace(COALESCE(gi.full_name, ''), '^\S+\s*', ''), '') AS last_name,
      NULLIF(btrim(COALESCE(gi.ph, '')), '') AS phone,
      ga.first_at AS first_visit_at,
      ga.last_at AS last_visit_at,
      COALESCE(ga.total_spent, 0) AS total_spent,
      ga.ticket_count::int, ga.order_count::int, ga.table_count::int,
      (vbe.email IS NOT NULL) AS is_banned,
      vbe.banned_at,
      vbe.ban_reason,
      NULL::text AS notes,
      ag.revenue_30d, ag.revenue_90d, ag.revenue_prev_90d, ag.avg_basket,
      COALESCE(ag.visit_nights, 0)::int AS visit_nights,
      CASE
        WHEN ag.first_activity_at IS NULL THEN 0
        ELSE round(
          ag.visit_nights::numeric /
          greatest(1, extract(epoch FROM (ag.last_activity_at - ag.first_activity_at)) / 2592000.0),
          2)
      END AS visits_per_month,
      ag.last_activity_at, pd.dow AS preferred_dow, pe.preferred_event_title,
      floor(extract(epoch FROM (now() - COALESCE(ag.last_activity_at, ga.last_at, ga.first_at, now()))) / 86400)::int AS recency_days,
      CASE WHEN COALESCE(ag.visit_nights, 0) > 0 THEN ag.visit_nights::int
           ELSE (ga.ticket_count + ga.order_count + ga.table_count)::int
      END AS rfm_freq,
      COALESCE(ga.total_spent, 0)::numeric AS rfm_money,
      true AS is_guest
    FROM guest_agg ga
    LEFT JOIN guest_identity gi ON gi.em = ga.em
    LEFT JOIN agg ag ON ag.em = ga.em
    LEFT JOIN pref_event pe ON pe.em = ga.em
    LEFT JOIN pref_dow pd ON pd.em = ga.em
    LEFT JOIN venue_banned_emails vbe ON vbe.venue_id = p_venue_id AND lower(vbe.email) = ga.em
  ),
  ranked AS (
    SELECT b.*,
      count(*) OVER () AS n_total,
      (rank() OVER (ORDER BY b.rfm_freq) - 1)::numeric  AS freq_below,
      (rank() OVER (ORDER BY b.rfm_money) - 1)::numeric AS mon_below
    FROM base b
  ),
  scored AS (
    SELECT rk.*,
      -- R n'est PLUS relatif : la récence est un fait de calendrier, pas une
      -- opinion sur la population. C'est là qu'était le mensonge — sur un
      -- fichier de deux personnes, la moins récente des deux tombait à 1/5 et
      -- passait « Perdue » alors qu'elle s'était inscrite l'avant-veille. Les
      -- paliers sont ceux annoncés au client dans le mode d'emploi.
      CASE WHEN rk.recency_days <= 14 THEN 5
           WHEN rk.recency_days <= 30 THEN 4
           WHEN rk.recency_days <= 60 THEN 3
           WHEN rk.recency_days <= 90 THEN 2
           ELSE 1 END AS s_r,
      -- F : bande absolue en nuits, affinée ±1 par la position dans le fichier
      -- (un club qui tourne chaque semaine n'a pas le rythme d'une soirée
      -- mensuelle). M reste purement relatif : « gros dépensier » ne veut rien
      -- dire hors du contexte du lieu.
      CASE WHEN rk.n_total <= 1 THEN 3
           ELSE least(5, greatest(1, floor((rk.freq_below / (rk.n_total - 1)) * 5)::int + 1))
      END AS rel_f,
      CASE WHEN rk.n_total <= 1 THEN 3
           ELSE least(5, greatest(1, floor((rk.mon_below / (rk.n_total - 1)) * 5)::int + 1))
      END AS s_m,
      CASE WHEN rk.rfm_freq >= 10 THEN 5
           WHEN rk.rfm_freq >= 6 THEN 4
           WHEN rk.rfm_freq >= 3 THEN 3
           WHEN rk.rfm_freq >= 2 THEN 2
           ELSE 1 END AS abs_f
    FROM ranked rk
  ),
  blended AS (
    SELECT s.*,
      least(5, greatest(1, least(greatest(s.rel_f, s.abs_f - 1), s.abs_f + 1))) AS s_f
    FROM scored s
  )
  SELECT
    s.id, s.user_id, s.email, s.first_name, s.last_name, s.phone,
    s.first_visit_at, s.last_visit_at, s.total_spent,
    s.ticket_count, s.order_count, s.table_count,
    s.is_banned, s.banned_at, s.ban_reason, s.notes,
    s.revenue_30d, s.revenue_90d, s.revenue_prev_90d, s.avg_basket,
    s.visit_nights, s.visits_per_month,
    s.last_activity_at, s.preferred_dow, s.preferred_event_title,
    s.recency_days,
    s.s_r::int AS rfm_r, s.s_f::int AS rfm_f, s.s_m::int AS rfm_m,
    (CASE
      WHEN s.s_r >= 4 AND s.s_f >= 4 THEN 'champions'
      -- « Était régulier, se met en silence » passe AVANT « fidèle » : un
      -- habitué muet depuis trois mois est le client à rappeler ce soir, pas
      -- une ligne rassurante dans le camembert. L'ordre inverse le rangeait en
      -- « Fidèles » et le club ne le voyait jamais partir.
      WHEN s.s_r <= 2 AND s.s_f >= 3 THEN 'at_risk'
      WHEN s.s_f >= 4 THEN 'loyal'
      WHEN s.s_r >= 4 AND s.s_f <= 2 THEN CASE WHEN s.s_m >= 3 THEN 'promising' ELSE 'new' END
      WHEN s.s_r >= 3 THEN 'loyal'
      WHEN s.s_r = 2 THEN 'dormant'
      ELSE 'lost'
    END)::text AS rfm_segment,
    (CASE
      WHEN s.s_m >= 5 THEN 'platinum'
      WHEN s.s_m >= 4 THEN 'gold'
      WHEN s.s_m >= 2 THEN 'silver'
      ELSE 'bronze'
    END)::text AS rfm_tier,
    (s.s_f >= 3 AND s.recency_days > 45 AND s.recency_days <= 180) AS churn_risk,
    s.is_guest
  FROM blended s
  ORDER BY s.last_visit_at DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public._venue_customer_rfm(TEXT) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Fichier client ORGANISATEUR : mêmes colonnes RFM, même règle, servies par le
-- serveur. Le front recalculait ses quintiles en TypeScript ; deux moteurs de
-- segmentation pour un même produit finissent toujours par diverger (le club
-- l'a déjà payé une fois : un push ciblé sur zéro personne).
-- Changement de signature → DROP + CREATE (le front est le seul appelant).
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_organizer_customer_segments(uuid);

CREATE FUNCTION public.get_organizer_customer_segments(p_organizer_user_id uuid)
 RETURNS TABLE(
   id text, user_id uuid, email text, first_name text, last_name text, phone text,
   first_visit_at timestamptz, last_visit_at timestamptz, total_spent numeric,
   ticket_count integer, order_count integer, table_count integer,
   is_banned boolean, banned_at timestamptz, ban_reason text, notes text,
   revenue_30d numeric, revenue_90d numeric, revenue_prev_90d numeric,
   avg_basket numeric, visit_nights integer, visits_per_month numeric,
   last_activity_at timestamptz, preferred_dow integer, preferred_event_title text,
   recency_days integer, rfm_r integer, rfm_f integer, rfm_m integer,
   rfm_segment text, rfm_tier text, churn_risk boolean, guest_list_count integer)
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
  -- Revenu organisateur = montant facturé − frais Yuno (billets + tables).
  activity AS (
    SELECT lower(t.user_email) AS em,
           (t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0))::numeric AS amount,
           t.created_at, t.event_id, 'ticket'::text AS kind,
           t.user_id, t.full_name, t.guest_first_name, t.guest_last_name,
           NULLIF(btrim(COALESCE(t.phone, t.guest_phone, '')), '') AS phone
    FROM tickets t JOIN organizer_events oe ON oe.id = t.event_id
    WHERE t.user_email IS NOT NULL AND t.paid_at IS NOT NULL
    UNION ALL
    SELECT lower(tr.user_email),
           (tr.total_price - COALESCE(tr.service_fee, 0) - COALESCE(tr.management_fee, 0))::numeric,
           tr.created_at, tr.event_id, 'table'::text,
           tr.user_id, tr.full_name, tr.guest_first_name, tr.guest_last_name,
           NULLIF(btrim(COALESCE(tr.phone, tr.guest_phone, '')), '')
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
      count(*) FILTER (WHERE a.kind = 'guestlist') AS guest_list_count,
      count(DISTINCT date(a.created_at)) AS visit_nights,
      max(a.created_at) AS last_activity_at,
      min(a.created_at) AS first_activity_at
    FROM activity a GROUP BY a.em
  ),
  -- Dernière valeur NON NULLE de chaque champ, jamais « la dernière ligne » :
  -- une inscription guest list sans numéro effaçait le téléphone laissé lors
  -- d'un achat précédent, et la fiche client s'ouvrait sans coordonnées.
  ident AS (
    SELECT a.em,
      (array_agg(a.user_id ORDER BY a.created_at DESC) FILTER (WHERE a.user_id IS NOT NULL))[1] AS user_id,
      (array_agg(a.full_name ORDER BY a.created_at DESC) FILTER (WHERE a.full_name IS NOT NULL))[1] AS full_name,
      (array_agg(a.guest_first_name ORDER BY a.created_at DESC) FILTER (WHERE a.guest_first_name IS NOT NULL))[1] AS guest_first_name,
      (array_agg(a.guest_last_name ORDER BY a.created_at DESC) FILTER (WHERE a.guest_last_name IS NOT NULL))[1] AS guest_last_name,
      (array_agg(a.phone ORDER BY a.created_at DESC) FILTER (WHERE a.phone IS NOT NULL))[1] AS phone
    FROM activity a GROUP BY a.em
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
  ),
  base AS (
    SELECT
      ag.em AS c_id,
      COALESCE(id_.user_id, p.id) AS c_user_id,
      ag.em AS c_email,
      COALESCE(p.first_name, id_.guest_first_name,
               NULLIF(split_part(COALESCE(id_.full_name, ''), ' ', 1), '')) AS c_first_name,
      COALESCE(p.last_name, id_.guest_last_name,
               NULLIF(substr(COALESCE(id_.full_name, ''), strpos(COALESCE(id_.full_name, '') || ' ', ' ') + 1), '')) AS c_last_name,
      COALESCE(id_.phone, p.phone) AS c_phone,
      ag.first_activity_at AS c_first_visit_at,
      ag.last_activity_at AS c_last_visit_at,
      round(ag.total_spent, 2) AS c_total_spent,
      ag.ticket_count::int AS c_ticket_count,
      ag.table_count::int AS c_table_count,
      ag.guest_list_count::int AS c_guest_list_count,
      (b.email IS NOT NULL) AS c_is_banned, b.banned_at AS c_banned_at, b.ban_reason AS c_ban_reason,
      n.notes AS c_notes,
      ag.revenue_30d AS c_revenue_30d, ag.revenue_90d AS c_revenue_90d,
      ag.revenue_prev_90d AS c_revenue_prev_90d, ag.avg_basket AS c_avg_basket,
      COALESCE(ag.visit_nights, 0)::int AS c_visit_nights,
      CASE
        WHEN ag.first_activity_at IS NULL THEN 0
        ELSE round(
          ag.visit_nights::numeric /
          greatest(1, extract(epoch FROM (ag.last_activity_at - ag.first_activity_at)) / 2592000.0),
          2)
      END AS c_visits_per_month,
      ag.last_activity_at AS c_last_activity_at,
      pd.dow AS c_preferred_dow, pe.preferred_event_title AS c_preferred_event_title,
      floor(extract(epoch FROM (now() - COALESCE(ag.last_activity_at, ag.first_activity_at, now()))) / 86400)::int AS c_recency_days,
      CASE WHEN COALESCE(ag.visit_nights, 0) > 0 THEN ag.visit_nights::int
           ELSE (ag.ticket_count + ag.table_count + ag.guest_list_count)::int
      END AS c_rfm_freq,
      round(ag.total_spent, 2) AS c_rfm_money
    FROM agg ag
    LEFT JOIN ident id_ ON id_.em = ag.em
    -- Un email peut porter PLUSIEURS profils (comptes orphelins, comptes
    -- vitrine). Un LEFT JOIN direct dupliquait alors la ligne client. On n'en
    -- retient qu'un : celui qui a réellement fait l'activité, sinon le plus récent.
    LEFT JOIN LATERAL (
      SELECT pr.id, pr.first_name, pr.last_name, NULLIF(btrim(COALESCE(pr.phone, '')), '') AS phone
      FROM profiles pr
      WHERE lower(pr.email) = ag.em
      ORDER BY (pr.id = id_.user_id) DESC NULLS LAST, pr.created_at DESC
      LIMIT 1
    ) p ON true
    LEFT JOIN organizer_banned_emails b ON b.organizer_user_id = p_organizer_user_id AND b.email = ag.em
    LEFT JOIN organizer_customer_notes n ON n.organizer_user_id = p_organizer_user_id AND n.email = ag.em
    LEFT JOIN pref_event pe ON pe.em = ag.em
    LEFT JOIN pref_dow pd ON pd.em = ag.em
  ),
  ranked AS (
    SELECT b.*,
      count(*) OVER () AS n_total,
      (rank() OVER (ORDER BY b.c_rfm_freq) - 1)::numeric  AS freq_below,
      (rank() OVER (ORDER BY b.c_rfm_money) - 1)::numeric AS mon_below
    FROM base b
  ),
  scored AS (
    -- Règle identique au club, au mot près (cf. _venue_customer_rfm).
    SELECT rk.*,
      CASE WHEN rk.c_recency_days <= 14 THEN 5
           WHEN rk.c_recency_days <= 30 THEN 4
           WHEN rk.c_recency_days <= 60 THEN 3
           WHEN rk.c_recency_days <= 90 THEN 2
           ELSE 1 END AS s_r,
      CASE WHEN rk.n_total <= 1 THEN 3
           ELSE least(5, greatest(1, floor((rk.freq_below / (rk.n_total - 1)) * 5)::int + 1))
      END AS rel_f,
      CASE WHEN rk.n_total <= 1 THEN 3
           ELSE least(5, greatest(1, floor((rk.mon_below / (rk.n_total - 1)) * 5)::int + 1))
      END AS s_m,
      CASE WHEN rk.c_rfm_freq >= 10 THEN 5
           WHEN rk.c_rfm_freq >= 6 THEN 4
           WHEN rk.c_rfm_freq >= 3 THEN 3
           WHEN rk.c_rfm_freq >= 2 THEN 2
           ELSE 1 END AS abs_f
    FROM ranked rk
  ),
  blended AS (
    SELECT s.*,
      least(5, greatest(1, least(greatest(s.rel_f, s.abs_f - 1), s.abs_f + 1))) AS s_f
    FROM scored s
  )
  SELECT
    s.c_id, s.c_user_id, s.c_email, s.c_first_name, s.c_last_name, s.c_phone,
    s.c_first_visit_at, s.c_last_visit_at, s.c_total_spent,
    s.c_ticket_count, 0 AS order_count, s.c_table_count,
    s.c_is_banned, s.c_banned_at, s.c_ban_reason, s.c_notes,
    s.c_revenue_30d, s.c_revenue_90d, s.c_revenue_prev_90d, s.c_avg_basket,
    s.c_visit_nights, s.c_visits_per_month,
    s.c_last_activity_at, s.c_preferred_dow, s.c_preferred_event_title,
    s.c_recency_days,
    s.s_r::int, s.s_f::int, s.s_m::int,
    (CASE
      WHEN s.s_r >= 4 AND s.s_f >= 4 THEN 'champions'
      -- « Était régulier, se met en silence » passe AVANT « fidèle » : un
      -- habitué muet depuis trois mois est le client à rappeler ce soir, pas
      -- une ligne rassurante dans le camembert. L'ordre inverse le rangeait en
      -- « Fidèles » et le club ne le voyait jamais partir.
      WHEN s.s_r <= 2 AND s.s_f >= 3 THEN 'at_risk'
      WHEN s.s_f >= 4 THEN 'loyal'
      WHEN s.s_r >= 4 AND s.s_f <= 2 THEN CASE WHEN s.s_m >= 3 THEN 'promising' ELSE 'new' END
      WHEN s.s_r >= 3 THEN 'loyal'
      WHEN s.s_r = 2 THEN 'dormant'
      ELSE 'lost'
    END)::text,
    (CASE
      WHEN s.s_m >= 5 THEN 'platinum'
      WHEN s.s_m >= 4 THEN 'gold'
      WHEN s.s_m >= 2 THEN 'silver'
      ELSE 'bronze'
    END)::text,
    (s.s_f >= 3 AND s.c_recency_days > 45 AND s.c_recency_days <= 180),
    s.c_guest_list_count
  FROM blended s
  ORDER BY s.c_last_visit_at DESC NULLS LAST;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_organizer_customer_segments(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_organizer_customer_segments(uuid) FROM anon;
