-- Tracked links — intégration promoteur additive.
-- Quand un lien tracké appartient à un promoteur, la RPC de clic renvoie aussi
-- le promo_code du promoteur. La page de redirection l'ajoute en `?ref=<code>`
-- sur l'URL cible, ce qui réactive le flux de commission existant
-- (record_promoter_conversion) SANS toucher au système de commissions.

CREATE OR REPLACE FUNCTION public.record_tracked_link_click(
  p_code        text,
  p_visitor_id  text DEFAULT NULL,
  p_device_type text DEFAULT NULL,
  p_referrer    text DEFAULT NULL,
  p_user_agent  text DEFAULT NULL,
  p_ip_hash     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_link        public.tracked_links%ROWTYPE;
  v_event_venue text;
  v_org_slug    text;
  v_promo_code  text;
  v_recent      boolean := false;
BEGIN
  SELECT * INTO v_link FROM public.tracked_links WHERE code = p_code AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  IF p_visitor_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.tracked_link_clicks
      WHERE tracked_link_id = v_link.id AND visitor_id = p_visitor_id
        AND clicked_at > now() - interval '30 minutes'
    ) INTO v_recent;
  END IF;

  INSERT INTO public.tracked_link_clicks (tracked_link_id, ip_hash, user_agent, referrer, visitor_id, device_type)
  VALUES (v_link.id, p_ip_hash, p_user_agent, p_referrer, p_visitor_id, p_device_type);

  IF NOT v_recent THEN
    UPDATE public.tracked_links SET clicks_count = clicks_count + 1 WHERE id = v_link.id;
  END IF;

  IF v_link.target_kind = 'event' THEN
    SELECT venue_id INTO v_event_venue FROM public.events WHERE id = v_link.event_id;
  END IF;
  IF v_link.target_kind = 'organizer' THEN
    SELECT slug INTO v_org_slug FROM public.organizer_profiles WHERE user_id = v_link.organizer_user_id;
  END IF;
  IF v_link.owner_kind = 'promoter' THEN
    SELECT promo_code INTO v_promo_code FROM public.promoters WHERE id = v_link.promoter_id;
  END IF;

  RETURN jsonb_build_object(
    'found',           true,
    'tracked_link_id', v_link.id,
    'target_kind',     v_link.target_kind,
    'event_id',        v_link.event_id,
    'event_venue_id',  v_event_venue,
    'target_venue_id', v_link.target_venue_id,
    'organizer_slug',  v_org_slug,
    'promo_code',      v_promo_code
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.record_tracked_link_click(text,text,text,text,text,text) TO anon, authenticated;
