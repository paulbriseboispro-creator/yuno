-- ============================================================================
-- Rapport Club partageable — l'arme de négociation de l'agence.
--
-- L'agence génère un lien public en lecture seule par club partenaire
-- (/r/:token) : audience 30 jours vs 30 précédents, clics billetterie et
-- réservation, top soirées, sources, appareils, part Yuno. Le club lit un
-- rapport « powered by Yuno » — la donnée qu'il n'a pas, signée Yuno.
--
-- Sécurité : le token (64 hex) est la seule clé ; la RPC SECURITY DEFINER ne
-- renvoie que des AGRÉGATS du club concerné, jamais de lignes brutes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.affiliate_report_links (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id       uuid NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  affiliate_venue_id uuid NOT NULL UNIQUE REFERENCES affiliate_venues(id) ON DELETE CASCADE,
  token              text NOT NULL UNIQUE
    DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aff_report_links_affiliate ON affiliate_report_links(affiliate_id);

ALTER TABLE affiliate_report_links ENABLE ROW LEVEL SECURITY;

-- Le chef d'agence gère les liens de ses clubs. Pas de policy anon : le
-- public ne passe QUE par la RPC.
CREATE POLICY "aff_report_links_owner" ON affiliate_report_links
  FOR ALL USING (
    affiliate_id IN (SELECT id FROM affiliates WHERE user_id = auth.uid())
  )
  WITH CHECK (
    affiliate_id IN (SELECT id FROM affiliates WHERE user_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- Le rapport agrégé. Un seul appel anonyme par token actif.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_affiliate_venue_report(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link RECORD;
  v_now timestamptz := now();
  v_30 timestamptz := now() - interval '30 days';
  v_60 timestamptz := now() - interval '60 days';
  v_result jsonb;
BEGIN
  SELECT rl.id, rl.affiliate_id, rl.affiliate_venue_id,
         av.name AS venue_name, av.city AS venue_city, av.neighborhood,
         av.cover_image_url,
         a.name AS agency_name, a.city AS agency_city, a.avatar_url AS agency_logo,
         a.linktree_slug AS agency_slug
  INTO v_link
  FROM affiliate_report_links rl
  JOIN affiliate_venues av ON av.id = rl.affiliate_venue_id
  JOIN affiliates a ON a.id = rl.affiliate_id
  WHERE rl.token = p_token AND rl.is_active = true;

  IF NOT FOUND THEN RETURN NULL; END IF;

  WITH sess AS (
    SELECT * FROM affiliate_visitor_sessions
    WHERE affiliate_venue_id = v_link.affiliate_venue_id
      AND is_internal = false
      AND visited_at >= v_60
  ),
  cur AS (SELECT * FROM sess WHERE visited_at >= v_30),
  prev AS (SELECT * FROM sess WHERE visited_at < v_30),
  clk AS (
    SELECT * FROM affiliate_clicks
    WHERE affiliate_venue_id = v_link.affiliate_venue_id
      AND is_internal = false
      AND clicked_at >= v_60
  ),
  clk_cur AS (SELECT * FROM clk WHERE clicked_at >= v_30),
  clk_prev AS (SELECT * FROM clk WHERE clicked_at < v_30),
  top_events AS (
    SELECT ae.name, ae.event_date,
           count(c.*) FILTER (WHERE c.visited_at IS NOT NULL) AS views,
           COALESCE(k.clicks, 0) AS clicks
    FROM affiliate_events ae
    LEFT JOIN cur c ON c.affiliate_event_id = ae.id
    LEFT JOIN (
      SELECT affiliate_event_id, count(*) AS clicks
      FROM clk_cur WHERE affiliate_event_id IS NOT NULL
      GROUP BY affiliate_event_id
    ) k ON k.affiliate_event_id = ae.id
    WHERE ae.affiliate_venue_id = v_link.affiliate_venue_id
    GROUP BY ae.id, ae.name, ae.event_date, k.clicks
    HAVING count(c.*) FILTER (WHERE c.visited_at IS NOT NULL) > 0 OR COALESCE(k.clicks, 0) > 0
    ORDER BY 3 DESC, 4 DESC
    LIMIT 6
  ),
  sources AS (
    SELECT COALESCE(referrer_category, 'direct') AS category, count(*) AS views
    FROM cur GROUP BY 1 ORDER BY 2 DESC LIMIT 8
  ),
  devices AS (
    SELECT COALESCE(device_type, 'desktop') AS device, count(*) AS views
    FROM cur GROUP BY 1 ORDER BY 2 DESC
  )
  SELECT jsonb_build_object(
    'venue', jsonb_build_object(
      'name', v_link.venue_name, 'city', v_link.venue_city,
      'neighborhood', v_link.neighborhood, 'cover', v_link.cover_image_url),
    'agency', jsonb_build_object(
      'name', v_link.agency_name, 'city', v_link.agency_city,
      'logo', v_link.agency_logo, 'slug', v_link.agency_slug),
    'generated_at', v_now,
    'current', jsonb_build_object(
      'views', (SELECT count(*) FROM cur),
      'unique_visitors', (SELECT count(DISTINCT visitor_id) FROM cur WHERE visitor_id IS NOT NULL),
      'ticket_clicks', (SELECT count(*) FROM clk_cur WHERE click_type = 'ticket'),
      'booking_clicks', (SELECT count(*) FROM clk_cur WHERE click_type = 'booking'),
      'yuno_share', CASE WHEN (SELECT count(*) FROM cur) > 0
        THEN round((SELECT count(*) FROM cur WHERE referrer_category = 'internal')::numeric
             / (SELECT count(*) FROM cur) * 100, 1) ELSE 0 END),
    'previous', jsonb_build_object(
      'views', (SELECT count(*) FROM prev),
      'unique_visitors', (SELECT count(DISTINCT visitor_id) FROM prev WHERE visitor_id IS NOT NULL),
      'ticket_clicks', (SELECT count(*) FROM clk_prev WHERE click_type = 'ticket'),
      'booking_clicks', (SELECT count(*) FROM clk_prev WHERE click_type = 'booking')),
    'top_events', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'name', name, 'date', event_date, 'views', views, 'clicks', clicks)) FROM top_events), '[]'::jsonb),
    'sources', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'category', category, 'views', views)) FROM sources), '[]'::jsonb),
    'devices', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'device', device, 'views', views)) FROM devices), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_affiliate_venue_report(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_affiliate_venue_report(text) TO anon, authenticated;
