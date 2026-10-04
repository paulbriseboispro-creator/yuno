-- Résultats d'un e-mail (Console CRM) : « Qui a cliqué sans acheter ? ».
--
-- Le filtre `hot` (a cliqué, n'a rien acheté) rejoint ceux de la liste des
-- destinataires, et `crm_email_recipient_emails` rend TOUTES les adresses
-- d'un filtre (la liste n'en rend que 50 par page) : « Leur écrire » vise
-- tout le monde, pas la première page. Les deux lectures partagent la même
-- table des destinataires (`_crm_email_recipients_build`) et le même
-- prédicat (`_crm_recipient_match`) : un filtre ne peut pas compter autre
-- chose que ce que la liste montre.

CREATE OR REPLACE FUNCTION public._crm_recipient_match(
  p_filter text, p_opened boolean, p_clicked boolean, p_revenue numeric, p_status text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE COALESCE(p_filter, 'all')
    WHEN 'all' THEN true
    WHEN 'opened' THEN p_opened
    WHEN 'clicked' THEN p_clicked
    WHEN 'bought' THEN p_revenue > 0
    WHEN 'hot' THEN p_clicked AND p_revenue <= 0
    WHEN 'unopened' THEN NOT p_opened AND p_status = 'sent'
    WHEN 'bounced' THEN p_status = 'bounced'
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public._crm_recipient_match(text, boolean, boolean, numeric, text) FROM PUBLIC, anon, authenticated;

-- Construit _crr (une ligne par destinataire de la campagne). Sans porte :
-- appelée seulement par des fonctions qui ont vérifié la portée.
CREATE OR REPLACE FUNCTION public._crm_email_recipients_build(
  p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  PERFORM public._crm_email_attrib(p_venue_id, p_organizer_user_id);

  DROP TABLE IF EXISTS _crr;
  CREATE TEMP TABLE _crr ON COMMIT DROP AS
  SELECT lower(r.email) AS email, COALESCE(r.first_name, p.first_name) AS first_name, COALESCE(r.last_name, p.last_name) AS last_name,
         r.status, p.lifecycle,
         EXISTS (SELECT 1 FROM public.email_campaign_events e WHERE e.campaign_id = r.campaign_id AND e.event_type = 'opened' AND lower(e.recipient_email) = lower(r.email)) AS opened,
         EXISTS (SELECT 1 FROM _cmk k WHERE k.campaign_id = r.campaign_id AND k.email = lower(r.email)) AS clicked,
         COALESCE((SELECT sum(a.amount) FROM _cma a WHERE a.campaign_id = r.campaign_id AND a.email = lower(r.email)), 0) AS revenue
    FROM public.email_campaign_recipients r
    LEFT JOIN _cp p ON p.email = lower(r.email)
   WHERE r.campaign_id = p_campaign_id AND r.status IN ('sent', 'complained', 'bounced');
END;
$$;

REVOKE ALL ON FUNCTION public._crm_email_recipients_build(text, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_email_recipients(
  p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid,
  p_filter text DEFAULT 'all', p_q text DEFAULT NULL, p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer; v jsonb;
  v_q text := NULLIF(lower(btrim(COALESCE(p_q, ''))), '');
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.email_campaigns c
   WHERE c.id = p_campaign_id AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  PERFORM public._crm_email_recipients_build(p_venue_id, p_organizer_user_id, p_campaign_id);

  SELECT count(*) INTO v_total FROM _crr x
   WHERE public._crm_recipient_match(p_filter, x.opened, x.clicked, x.revenue, x.status)
     AND (v_q IS NULL OR x.email LIKE '%' || v_q || '%' OR lower(COALESCE(x.first_name, '') || ' ' || COALESCE(x.last_name, '')) LIKE '%' || v_q || '%');
  SELECT COALESCE(jsonb_agg(jsonb_build_object('email', email, 'first_name', first_name, 'last_name', last_name, 'status', status,
           'lifecycle', lifecycle, 'opened', opened, 'clicked', clicked, 'revenue', round(revenue, 2))), '[]'::jsonb)
    INTO v FROM (
      SELECT * FROM _crr x
       WHERE public._crm_recipient_match(p_filter, x.opened, x.clicked, x.revenue, x.status)
         AND (v_q IS NULL OR x.email LIKE '%' || v_q || '%' OR lower(COALESCE(x.first_name, '') || ' ' || COALESCE(x.last_name, '')) LIKE '%' || v_q || '%')
       ORDER BY x.revenue DESC, x.clicked DESC, x.opened DESC, x.email
       LIMIT 50 OFFSET GREATEST(p_offset, 0)) z;
  RETURN jsonb_build_object('total', v_total, 'rows', v,
    'counts', (SELECT jsonb_build_object('all', count(*), 'opened', count(*) FILTER (WHERE opened), 'clicked', count(*) FILTER (WHERE clicked),
                 'bought', count(*) FILTER (WHERE revenue > 0), 'hot', count(*) FILTER (WHERE clicked AND revenue <= 0),
                 'unopened', count(*) FILTER (WHERE NOT opened AND status = 'sent'),
                 'bounced', count(*) FILTER (WHERE status = 'bounced')) FROM _crr));
END;
$$;

-- Toutes les adresses d'un filtre (5 000 au plus), pour « Leur écrire ».
CREATE OR REPLACE FUNCTION public.crm_email_recipient_emails(
  p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid, p_filter text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.email_campaigns c
   WHERE c.id = p_campaign_id AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  PERFORM public._crm_email_recipients_build(p_venue_id, p_organizer_user_id, p_campaign_id);
  SELECT COALESCE(jsonb_agg(z.email), '[]'::jsonb) INTO v FROM (
    SELECT x.email FROM _crr x
     WHERE public._crm_recipient_match(p_filter, x.opened, x.clicked, x.revenue, x.status)
     ORDER BY x.email LIMIT 5000) z;
  RETURN jsonb_build_object('emails', v);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_email_recipient_emails(text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_recipient_emails(text, uuid, uuid, text) TO authenticated, service_role;
