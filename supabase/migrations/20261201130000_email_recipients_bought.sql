-- Destinataires d'une campagne : « a acheté » vaut pour une entrée gratuite aussi.
--
-- `_crm_email_recipients_build` mesurait « acheté » par `revenue > 0` : une guest list ou une
-- entrée à 0 € n'était jamais « acheté », donc jamais comptée dans le filtre « Ont acheté » ni
-- sortie de « Chauds » (cliqué sans acheter). Constat du 07/11 : 6 places prises, 0 acheteur dans
-- les destinataires. La colonne `bought` vient de l'attribution (`_cma`), pas du montant.
SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public._crm_email_recipients_build(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  PERFORM public._crm_email_attrib(p_venue_id, p_organizer_user_id);

  DROP TABLE IF EXISTS _crr;
  CREATE TEMP TABLE _crr ON COMMIT DROP AS
  SELECT lower(r.email) AS email, COALESCE(r.first_name, p.first_name) AS first_name, COALESCE(r.last_name, p.last_name) AS last_name,
         r.status, p.lifecycle,
         EXISTS (SELECT 1 FROM public.email_campaign_events e WHERE e.campaign_id = r.campaign_id AND e.event_type = 'opened' AND lower(e.recipient_email) = lower(r.email)) AS opened,
         EXISTS (SELECT 1 FROM _cmk k WHERE k.campaign_id = r.campaign_id AND k.email = lower(r.email)) AS clicked,
         COALESCE((SELECT sum(a.amount) FROM _cma a WHERE a.campaign_id = r.campaign_id AND a.email = lower(r.email)), 0) AS revenue,
         EXISTS (SELECT 1 FROM _cma a WHERE a.campaign_id = r.campaign_id AND a.email = lower(r.email)) AS bought
    FROM public.email_campaign_recipients r
    LEFT JOIN _cp p ON p.email = lower(r.email)
   WHERE r.campaign_id = p_campaign_id AND r.status IN ('sent', 'complained', 'bounced');
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_email_recipients__core(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid, p_filter text DEFAULT 'all'::text, p_q text DEFAULT NULL::text, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total integer; v jsonb;
  v_q text := NULLIF(lower(btrim(COALESCE(p_q, ''))), '');
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.email_campaigns c
   WHERE c.id = p_campaign_id AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
      AND public.crm_campaign_is_crm(c.id);
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  PERFORM public._crm_email_recipients_build(p_venue_id, p_organizer_user_id, p_campaign_id);

  -- Le filtre juge le montant ; une place gratuite compte comme achetée (`bought`).
  SELECT count(*) INTO v_total FROM _crr x
   WHERE public._crm_recipient_match(p_filter, x.opened, x.clicked, CASE WHEN x.bought THEN GREATEST(x.revenue, 0.01) ELSE x.revenue END, x.status)
     AND (v_q IS NULL OR x.email LIKE '%' || v_q || '%' OR lower(COALESCE(x.first_name, '') || ' ' || COALESCE(x.last_name, '')) LIKE '%' || v_q || '%');
  SELECT COALESCE(jsonb_agg(jsonb_build_object('email', email, 'first_name', first_name, 'last_name', last_name, 'status', status,
           'lifecycle', lifecycle, 'opened', opened, 'clicked', clicked, 'bought', bought, 'revenue', round(revenue, 2))), '[]'::jsonb)
    INTO v FROM (
      SELECT * FROM _crr x
       WHERE public._crm_recipient_match(p_filter, x.opened, x.clicked, CASE WHEN x.bought THEN GREATEST(x.revenue, 0.01) ELSE x.revenue END, x.status)
         AND (v_q IS NULL OR x.email LIKE '%' || v_q || '%' OR lower(COALESCE(x.first_name, '') || ' ' || COALESCE(x.last_name, '')) LIKE '%' || v_q || '%')
       ORDER BY x.bought DESC, x.revenue DESC, x.clicked DESC, x.opened DESC, x.email
       LIMIT 50 OFFSET GREATEST(p_offset, 0)) z;
  RETURN jsonb_build_object('total', v_total, 'rows', v,
    'counts', (SELECT jsonb_build_object('all', count(*), 'opened', count(*) FILTER (WHERE opened), 'clicked', count(*) FILTER (WHERE clicked),
                 'bought', count(*) FILTER (WHERE bought), 'hot', count(*) FILTER (WHERE clicked AND NOT bought),
                 'unopened', count(*) FILTER (WHERE NOT opened AND status = 'sent'),
                 'bounced', count(*) FILTER (WHERE status = 'bounced')) FROM _crr));
END;
$function$;
