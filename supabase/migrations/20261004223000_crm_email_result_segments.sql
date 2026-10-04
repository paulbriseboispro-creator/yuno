-- ============================================================================
-- Console Yuno CRM — Résultats d'un e-mail, onglet Destinataires : « Quel
-- groupe a le mieux répondu ? ». Pour chaque cycle de vie (tel qu'il était
-- le jour de l'envoi) : destinataires, ouvreurs, cliqueurs, achats et CA
-- attribués (clic → achat sous 7 jours, remboursements déduits : mêmes
-- règles que _crm_email_stats).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.crm_email_result_segments(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_at timestamptz;
  v jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT c.sent_at INTO v_at FROM public.email_campaigns c
   WHERE c.id = p_campaign_id
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;
  IF v_at IS NULL THEN RETURN '[]'::jsonb; END IF;

  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, v_at);
  PERFORM public._crm_email_attrib(p_venue_id, p_organizer_user_id);

  WITH r AS (
    SELECT DISTINCT lower(x.email) AS em FROM public.email_campaign_recipients x
     WHERE x.campaign_id = p_campaign_id AND x.status IN ('sent', 'complained', 'bounced')
  ), o AS (
    SELECT DISTINCT lower(e.recipient_email) AS em FROM public.email_campaign_events e
     WHERE e.campaign_id = p_campaign_id AND e.event_type = 'opened' AND e.recipient_email IS NOT NULL
  ), k AS (
    SELECT DISTINCT email AS em FROM _cmk WHERE campaign_id = p_campaign_id
  ), b AS (
    SELECT email AS em, count(*) AS n, sum(amount) AS rev FROM _cma WHERE campaign_id = p_campaign_id GROUP BY 1
  ), z AS (
    SELECT COALESCE(cp.lifecycle, 'none') AS lc, count(*) AS n, count(o.em) AS opened, count(k.em) AS clicked,
           COALESCE(sum(b.n), 0) AS purchases, COALESCE(sum(b.rev), 0) AS revenue
      FROM r
      LEFT JOIN _cp cp ON cp.email = r.em
      LEFT JOIN o ON o.em = r.em
      LEFT JOIN k ON k.em = r.em
      LEFT JOIN b ON b.em = r.em
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('lifecycle', lc, 'n', n, 'opened', opened, 'clicked', clicked,
           'purchases', purchases, 'revenue', round(revenue, 2)) ORDER BY n DESC), '[]'::jsonb)
    INTO v FROM z;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_email_result_segments(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_result_segments(text, uuid, uuid) TO authenticated, service_role;
