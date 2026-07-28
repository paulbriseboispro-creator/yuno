-- ============================================================================
-- « Ce club veut vendre sur Yuno » — le flywheel branché au flux plateforme.
--
-- L'agence signale qu'un de ses clubs externes est prêt à passer à la vente
-- in-app. Le super admin reçoit l'alerte (admin_notifications) avec le
-- contexte : club, ville, agence, trafic 30 jours — un lead B2B chaud,
-- pré-qualifié par la donnée.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.request_club_yuno_lead(p_affiliate_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v RECORD;
  v_views bigint;
  v_clicks bigint;
BEGIN
  -- Le demandeur doit être le chef de l'agence propriétaire du club.
  SELECT av.id, av.name, av.city, a.id AS affiliate_id, a.name AS agency_name
  INTO v
  FROM affiliate_venues av
  JOIN affiliates a ON a.id = av.affiliate_id
  WHERE av.id = p_affiliate_venue_id AND a.user_id = auth.uid();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  SELECT count(*) INTO v_views FROM affiliate_visitor_sessions
  WHERE affiliate_venue_id = v.id AND is_internal = false
    AND visited_at >= now() - interval '30 days';
  SELECT count(*) INTO v_clicks FROM affiliate_clicks
  WHERE affiliate_venue_id = v.id AND is_internal = false
    AND clicked_at >= now() - interval '30 days';

  PERFORM emit_admin_notification(
    'admin_agency_club_lead',
    'Lead club : ' || v.name,
    v.agency_name || ' signale que ' || v.name
      || COALESCE(' (' || v.city || ')', '')
      || ' est prêt à vendre sur Yuno. Trafic 30 j : '
      || v_views || ' vues, ' || v_clicks || ' clics.',
    'high',
    'affiliate_venue',
    v.id::text,
    jsonb_build_object('affiliate_id', v.affiliate_id, 'views_30d', v_views, 'clicks_30d', v_clicks),
    -- Un lead par club par semaine : pas de spam admin si double clic.
    'agency_club_lead:' || v.id || ':' || to_char(now(), 'IYYY-IW')
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.request_club_yuno_lead(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_club_yuno_lead(uuid) TO authenticated;
