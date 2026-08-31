-- ─────────────────────────────────────────────────────────────────────────────
-- Rapport de campagne : stats du test A/B d'objet, par variante.
--
-- Le gagnant est déjà déclaré par resolve_campaign_ab_winner (cron, service
-- role) ; cette RPC expose la MÊME lecture (échantillons envoyés + ouvertures
-- distinctes par variante) au propriétaire de la campagne, pour la carte A/B
-- du rapport. Garde d'accès identique à get_campaign_send_progress.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_campaign_ab_stats(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
  v_auth boolean := false;
  v_sent_a integer := 0;
  v_sent_b integer := 0;
  v_opens_a integer := 0;
  v_opens_b integer := 0;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF c IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  IF c.venue_id IS NOT NULL THEN
    v_auth := public.is_venue_owner(auth.uid(), c.venue_id) OR public.is_super_admin();
  ELSIF c.organizer_user_id IS NOT NULL THEN
    v_auth := (c.organizer_user_id = auth.uid()) OR public.is_super_admin();
  END IF;
  IF COALESCE(auth.role(), '') = 'service_role' THEN v_auth := true; END IF;
  IF NOT v_auth THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF NOT c.ab_enabled OR COALESCE(c.subject_b, '') = '' THEN
    RETURN jsonb_build_object('supported', false);
  END IF;

  SELECT count(*) FILTER (WHERE ab_variant = 'a'),
         count(*) FILTER (WHERE ab_variant = 'b')
    INTO v_sent_a, v_sent_b
    FROM public.email_campaign_recipients
   WHERE campaign_id = p_campaign_id AND status = 'sent';

  SELECT count(DISTINCT lower(ev.recipient_email)) FILTER (WHERE r.ab_variant = 'a'),
         count(DISTINCT lower(ev.recipient_email)) FILTER (WHERE r.ab_variant = 'b')
    INTO v_opens_a, v_opens_b
    FROM public.email_campaign_events ev
    JOIN public.email_campaign_recipients r
      ON r.campaign_id = ev.campaign_id AND lower(r.email) = lower(ev.recipient_email)
   WHERE ev.campaign_id = p_campaign_id AND ev.event_type = 'opened';

  RETURN jsonb_build_object(
    'supported', true,
    'winner', c.ab_winner,
    'sent_a', v_sent_a, 'sent_b', v_sent_b,
    'opens_a', v_opens_a, 'opens_b', v_opens_b
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_campaign_ab_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_campaign_ab_stats(uuid) TO authenticated, service_role;
