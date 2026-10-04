-- ============================================================================
-- Console Yuno CRM — écran Envoi : les options rendent aussi les règles des
-- cycles de vie de la portée (« venus 3 fois sur 6 mois »), pour que chaque
-- segment automatique affiche sa vraie définition.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.crm_email_send_options(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auto jsonb;
  v_saved jsonb := '[]'::jsonb;
  s record;
  r record;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);

  -- Joignables : la même porte que l'envoi (opt-in newsletter de la portée).
  DROP TABLE IF EXISTS _cso;
  CREATE TEMP TABLE _cso ON COMMIT DROP AS
  SELECT p.*, 0::integer AS open_n FROM _cp p
   WHERE p.email_ok AND EXISTS (
     SELECT 1 FROM public.newsletter_subscriptions ns
      WHERE lower(ns.email) = p.email AND ns.opted_in
        AND ns.venue_id IS NOT DISTINCT FROM p_venue_id
        AND ns.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id);

  WITH c AS (
    SELECT ec.id FROM public.email_campaigns ec
     WHERE ec.status IN ('sent', 'sending') AND ec.sent_at > now() - interval '12 months'
       AND ec.venue_id IS NOT DISTINCT FROM p_venue_id
       AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
  ), o AS (
    SELECT lower(ev.recipient_email) AS em, count(DISTINCT ev.campaign_id)::integer AS n
      FROM public.email_campaign_events ev JOIN c ON c.id = ev.campaign_id
     WHERE ev.event_type = 'opened' AND ev.recipient_email IS NOT NULL
     GROUP BY 1
  )
  UPDATE _cso p SET open_n = o.n FROM o WHERE o.em = p.email;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', k.key, 'reach', COALESCE(a.reach, 0),
           'open_pct', CASE WHEN COALESCE(a.rec, 0) >= 20 THEN round(100.0 * a.op / a.rec) END,
           'click_pct', CASE WHEN COALESCE(a.rec, 0) >= 20 THEN round(100.0 * a.cl / a.rec) END)
         ORDER BY k.ord), '[]'::jsonb)
    INTO v_auto
    FROM (VALUES ('hab', 1), ('occ', 2), ('nou', 3), ('end', 4), ('none', 5)) k(key, ord)
    LEFT JOIN (
      SELECT lifecycle, count(*)::integer AS reach, sum(msg_n) AS rec, sum(LEAST(open_n, msg_n)) AS op, sum(LEAST(click_n, msg_n)) AS cl
        FROM _cso GROUP BY lifecycle
    ) a ON a.lifecycle = k.key;

  FOR s IN
    SELECT id, name, description, definition FROM public.crm_segments
     WHERE venue_id IS NOT DISTINCT FROM p_venue_id AND organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     ORDER BY created_at DESC LIMIT 40
  LOOP
    EXECUTE format('SELECT count(*)::integer AS reach, sum(msg_n) AS rec, sum(LEAST(open_n, msg_n)) AS op, sum(LEAST(click_n, msg_n)) AS cl FROM _cso p WHERE (%s)',
                   public._crm_filter_sql(s.definition, 'p'))
      INTO r;
    v_saved := v_saved || jsonb_build_array(jsonb_build_object(
      'id', s.id, 'name', s.name, 'description', s.description, 'reach', COALESCE(r.reach, 0),
      'open_pct', CASE WHEN COALESCE(r.rec, 0) >= 20 THEN round(100.0 * r.op / r.rec) END,
      'click_pct', CASE WHEN COALESCE(r.rec, 0) >= 20 THEN round(100.0 * r.cl / r.rec) END));
  END LOOP;

  RETURN jsonb_build_object('auto', v_auto, 'saved', v_saved,
    'rules', (SELECT to_jsonb(r) FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id) r));
END;
$$;

REVOKE ALL ON FUNCTION public.crm_email_send_options(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_send_options(text, uuid) TO authenticated, service_role;
