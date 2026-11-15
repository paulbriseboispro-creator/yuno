-- Liens suivis : « restés 3 s ou plus » à côté des clics (2026-11-15).
--
-- Constat (lien ad#1 de House Of Love, pub Instagram) : 125 clics chez Yuno,
-- 53 « visites du site » chez Meta. Les deux sont justes : Yuno compte chaque
-- ouverture du lien, Meta seulement la page chargée et vue par son pixel.
-- Sur les 140 visites venues de la pub, 70 étaient parties en moins de 3 s.
-- Le pro a donc besoin des deux chiffres côte à côte.
--
-- engaged_visits = personnes (visitor_id, sinon session) arrivées sur la page
-- de la soirée par CE lien et restées 3 s ou plus. Rapprochement visite → lien
-- par la règle de sale_link_from_visit : même soirée, même utm_source /
-- utm_medium (et utm_campaign quand le lien en porte un), visite postérieure à
-- la création du lien. NULL pour un lien sans soirée (page du club, profil,
-- guest list) : sa page d'arrivée ne se mesure pas ainsi, l'écran se tait.
--
-- Colonne AJOUTÉE en fin de table : un ancien bundle l'ignore. Le type de
-- retour change, d'où DROP + CREATE et les droits rétablis à l'identique.

DROP FUNCTION IF EXISTS public.get_tracked_link_stats(text, text, uuid, uuid, uuid, uuid, text, uuid);

CREATE FUNCTION public.get_tracked_link_stats(p_owner_kind text, p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_promoter_id uuid DEFAULT NULL::uuid, p_dj_id uuid DEFAULT NULL::uuid, p_event_id uuid DEFAULT NULL::uuid, p_target_kind text DEFAULT NULL::text, p_guest_list_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, code text, label text, target_kind text, event_id uuid, is_active boolean, created_at timestamp with time zone, clicks integer, conversions bigint, revenue numeric, engaged_visits integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_money boolean := true;
BEGIN
  IF p_owner_kind = 'venue' THEN
    -- Toute l'équipe du club (owner, managers) : chacun voit les liens du club.
    IF NOT public.tracked_link_team_can_read('venue', p_venue_id, NULL) THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
    v_money := public.tracked_link_team_sees_money('venue', p_venue_id, NULL);
  ELSIF p_owner_kind = 'organizer' THEN
    -- Le fondateur ET son équipe (admin, éditeur) : le scope est l'ORGANISATION.
    IF NOT public.tracked_link_team_can_read('organizer', NULL, p_organizer_user_id) THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
    v_money := public.tracked_link_team_sees_money('organizer', NULL, p_organizer_user_id);
  ELSIF p_owner_kind = 'promoter' THEN
    IF NOT EXISTS (SELECT 1 FROM public.promoters p WHERE p.id = p_promoter_id AND p.user_id = auth.uid()) THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
  ELSIF p_owner_kind = 'dj' THEN
    IF NOT EXISTS (SELECT 1 FROM public.djs d WHERE d.id = p_dj_id AND d.user_id = auth.uid()) THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid owner_kind';
  END IF;

  RETURN QUERY
  WITH links AS (
    SELECT tl.* FROM public.tracked_links tl
    WHERE tl.owner_kind = p_owner_kind
      AND ( (p_owner_kind = 'venue'     AND tl.venue_id = p_venue_id)
         OR (p_owner_kind = 'organizer' AND tl.organizer_user_id = p_organizer_user_id)
         OR (p_owner_kind = 'promoter'  AND tl.promoter_id = p_promoter_id)
         OR (p_owner_kind = 'dj'        AND tl.dj_id = p_dj_id) )
      AND (p_event_id IS NULL OR tl.event_id = p_event_id)
      AND (p_target_kind IS NULL OR tl.target_kind = p_target_kind)
      AND (p_guest_list_id IS NULL OR tl.guest_list_id = p_guest_list_id)
      AND NOT EXISTS (SELECT 1 FROM public.events ev WHERE ev.id = tl.event_id AND ev.external_source IS NOT NULL)
  ),
  conv AS (
    SELECT tracked_link_id, count(*)::bigint AS c, coalesce(sum(amt), 0) AS rev
    FROM (
      SELECT t.tracked_link_id, (greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0) - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))) AS amt
        FROM public.tickets t WHERE t.tracked_link_id IS NOT NULL AND t.status IN ('paid','used')
      UNION ALL
      SELECT r.tracked_link_id, (greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0) - least(greatest(coalesce(r.refund_amount, 0), 0), greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))) AS amt
        FROM public.table_reservations r WHERE r.tracked_link_id IS NOT NULL AND r.status IN ('paid','confirmed')
      UNION ALL
      SELECT o.tracked_link_id, (greatest(o.total - coalesce(o.service_fee, 0), 0) - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))) AS amt
        FROM public.orders o WHERE o.tracked_link_id IS NOT NULL AND o.status IN ('paid','served')
      UNION ALL
      -- Une inscription guest list est gratuite : elle compte comme conversion,
      -- jamais comme chiffre d'affaires.
      SELECT tracked_link_id, 0::numeric   AS amt FROM public.guest_list_entries WHERE tracked_link_id IS NOT NULL AND status <> 'cancelled'
    ) all_conv
    GROUP BY tracked_link_id
  ),
  -- Personnes arrivées sur la page de la soirée par le lien et restées ≥ 3 s.
  engaged AS (
    SELECT l.id AS link_id,
           count(DISTINCT COALESCE(NULLIF(s.visitor_id, ''), s.session_id))::integer AS n
      FROM links l
      JOIN public.visitor_sessions s
        ON s.event_id = l.event_id
       AND s.visited_at >= l.created_at
       AND COALESCE(s.duration_seconds, 0) >= 3
       AND lower(btrim(COALESCE(s.utm_source, ''))) = lower(btrim(COALESCE(l.utm_source, '')))
       AND lower(btrim(COALESCE(s.utm_medium, ''))) = lower(btrim(COALESCE(l.utm_medium, '')))
       AND (NULLIF(btrim(COALESCE(l.utm_campaign, '')), '') IS NULL
            OR lower(btrim(COALESCE(s.utm_campaign, ''))) = lower(btrim(l.utm_campaign)))
     WHERE l.event_id IS NOT NULL
       AND l.target_kind = 'event'
       AND NULLIF(btrim(COALESCE(l.utm_source, '')), '') IS NOT NULL
     GROUP BY l.id
  )
  SELECT l.id, l.code, l.label, l.target_kind, l.event_id, l.is_active, l.created_at,
         l.clicks_count, coalesce(conv.c, 0),
         -- Le CA ne part qu'à qui voit l'argent ; les autres voient clics et ventes.
         CASE WHEN v_money THEN coalesce(conv.rev, 0) END,
         CASE WHEN l.target_kind = 'event' AND l.event_id IS NOT NULL
                   AND NULLIF(btrim(COALESCE(l.utm_source, '')), '') IS NOT NULL
              THEN coalesce(engaged.n, 0) END
  FROM links l
  LEFT JOIN conv ON conv.tracked_link_id = l.id
  LEFT JOIN engaged ON engaged.link_id = l.id
  ORDER BY l.created_at DESC;
END; $function$;

REVOKE ALL ON FUNCTION public.get_tracked_link_stats(text, text, uuid, uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tracked_link_stats(text, text, uuid, uuid, uuid, uuid, text, uuid) TO authenticated, service_role;
