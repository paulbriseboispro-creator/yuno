-- Comprehensive per-promoter stats for agency analytics dashboard
CREATE OR REPLACE FUNCTION public.get_agency_promoter_full_stats(
  p_agency_id  uuid,
  p_date_from  timestamptz DEFAULT NULL,
  p_date_to    timestamptz DEFAULT NULL
)
RETURNS TABLE (
  promoter_id          uuid,
  first_name           text,
  last_name            text,
  profile_image_url    text,
  promo_code           text,
  agency_group_id      uuid,
  venue_id             text,
  venue_name           text,
  organizer_user_id    uuid,
  total_gross          numeric,
  total_margin         numeric,
  total_net            numeric,
  ticket_count         bigint,
  ticket_gross         numeric,
  ticket_commission    numeric,
  table_count          bigint,
  table_gross          numeric,
  table_commission     numeric,
  guest_list_count     bigint,
  events_covered       bigint,
  first_conversion_at  timestamptz,
  last_conversion_at   timestamptz,
  pending_amount       numeric,
  total_paid           numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    p.id                              AS promoter_id,
    p.first_name,
    p.last_name,
    p.profile_image_url,
    p.promo_code,
    p.agency_group_id,
    p.venue_id,
    v.name                            AS venue_name,
    p.organizer_user_id,

    COALESCE(SUM(ac.gross_amount),  0) AS total_gross,
    COALESCE(SUM(ac.margin_amount), 0) AS total_margin,
    COALESCE(SUM(ac.net_amount),    0) AS total_net,

    COUNT(pc.id) FILTER (WHERE pc.conversion_type = 'ticket')                           AS ticket_count,
    COALESCE(SUM(pc.amount)     FILTER (WHERE pc.conversion_type = 'ticket'), 0)        AS ticket_gross,
    COALESCE(SUM(pc.commission) FILTER (WHERE pc.conversion_type = 'ticket'), 0)        AS ticket_commission,

    COUNT(pc.id) FILTER (WHERE pc.conversion_type = 'table')                            AS table_count,
    COALESCE(SUM(pc.amount)     FILTER (WHERE pc.conversion_type = 'table'), 0)         AS table_gross,
    COALESCE(SUM(pc.commission) FILTER (WHERE pc.conversion_type = 'table'), 0)         AS table_commission,

    COUNT(pc.id) FILTER (WHERE pc.guest_list_entry_id IS NOT NULL)                      AS guest_list_count,

    COUNT(DISTINCT ac.event_id)       AS events_covered,
    MIN(ac.created_at)                AS first_conversion_at,
    MAX(ac.created_at)                AS last_conversion_at,

    p.pending_amount,
    p.total_paid

  FROM public.promoters p
  LEFT JOIN public.venues v
    ON v.id = p.venue_id
  LEFT JOIN public.agency_conversions ac
    ON  ac.promoter_id = p.id
    AND ac.agency_id   = p_agency_id
    AND (p_date_from IS NULL OR ac.created_at >= p_date_from)
    AND (p_date_to   IS NULL OR ac.created_at <= p_date_to)
  LEFT JOIN public.promoter_conversions pc
    ON pc.id = ac.source_conversion_id

  WHERE p.agency_id = p_agency_id
    AND public.is_agency_owner(auth.uid(), p_agency_id)

  GROUP BY
    p.id, p.first_name, p.last_name, p.profile_image_url, p.promo_code,
    p.agency_group_id, p.venue_id, v.name, p.organizer_user_id,
    p.pending_amount, p.total_paid

  ORDER BY total_gross DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_agency_promoter_full_stats(uuid, timestamptz, timestamptz) TO authenticated;


-- Comprehensive per-event stats with conversion breakdown
CREATE OR REPLACE FUNCTION public.get_agency_event_full_stats(
  p_agency_id  uuid,
  p_date_from  timestamptz DEFAULT NULL,
  p_date_to    timestamptz DEFAULT NULL
)
RETURNS TABLE (
  event_id          uuid,
  event_title       text,
  event_start_at    timestamptz,
  venue_id          text,
  venue_name        text,
  total_gross       numeric,
  total_margin      numeric,
  promoter_count    bigint,
  ticket_count      bigint,
  ticket_gross      numeric,
  table_count       bigint,
  table_gross       numeric,
  guest_list_count  bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    e.id                                                                    AS event_id,
    e.title                                                                 AS event_title,
    e.start_at                                                              AS event_start_at,
    COALESCE(e.venue_id, '')                                                AS venue_id,
    COALESCE(v.name, 'Organisateur')                                        AS venue_name,

    COALESCE(SUM(ac.gross_amount),  0)                                      AS total_gross,
    COALESCE(SUM(ac.margin_amount), 0)                                      AS total_margin,
    COUNT(DISTINCT ac.promoter_id)                                          AS promoter_count,

    COUNT(pc.id) FILTER (WHERE pc.conversion_type = 'ticket')               AS ticket_count,
    COALESCE(SUM(pc.amount) FILTER (WHERE pc.conversion_type = 'ticket'), 0) AS ticket_gross,
    COUNT(pc.id) FILTER (WHERE pc.conversion_type = 'table')                AS table_count,
    COALESCE(SUM(pc.amount) FILTER (WHERE pc.conversion_type = 'table'), 0) AS table_gross,
    COUNT(pc.id) FILTER (WHERE pc.guest_list_entry_id IS NOT NULL)          AS guest_list_count

  FROM public.agency_conversions ac
  JOIN  public.events e   ON e.id  = ac.event_id
  LEFT JOIN public.venues v ON v.id = e.venue_id
  LEFT JOIN public.promoter_conversions pc ON pc.id = ac.source_conversion_id

  WHERE ac.agency_id   = p_agency_id
    AND ac.event_id IS NOT NULL
    AND public.is_agency_owner(auth.uid(), p_agency_id)
    AND (p_date_from IS NULL OR ac.created_at >= p_date_from)
    AND (p_date_to   IS NULL OR ac.created_at <= p_date_to)

  GROUP BY e.id, e.title, e.start_at, e.venue_id, v.name
  ORDER BY total_gross DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_agency_event_full_stats(uuid, timestamptz, timestamptz) TO authenticated;
