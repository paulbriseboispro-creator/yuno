-- Vue d'ensemble des e-mails : « a regardé la soirée » (lien des billets, clics de personnes) et
-- « réservé ensuite » s'ajoutent aux totaux et aux trois dernières campagnes. Rien n'est retiré.
SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.crm_email_overview__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_days integer := CASE WHEN p_days IN (30, 90) THEN p_days ELSE 30 END;
  v_to timestamptz := now();
  v_from timestamptz := now() - make_interval(days => v_days);
  v_pfrom timestamptz := now() - make_interval(days => 2 * v_days);
  v_cur jsonb; v_prev jsonb; v_list jsonb; v_up jsonb; v_last jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM public._crm_email_stats(p_venue_id, p_organizer_user_id, v_pfrom, v_to);

  SELECT jsonb_build_object('campaigns', count(*), 'sent', COALESCE(sum(n), 0), 'received', COALESCE(sum(received), 0),
           'opened', COALESCE(sum(opened), 0), 'clicked', COALESCE(sum(clicked), 0), 'ticketing', COALESCE(sum(ticketing), 0),
           'purchases', COALESCE(sum(purchases), 0), 'later', COALESCE(sum(later), 0), 'revenue', COALESCE(round(sum(revenue), 2), 0))
    INTO v_cur FROM _ces WHERE sent_at >= v_from;
  SELECT jsonb_build_object('campaigns', count(*), 'sent', COALESCE(sum(n), 0), 'received', COALESCE(sum(received), 0),
           'opened', COALESCE(sum(opened), 0), 'clicked', COALESCE(sum(clicked), 0), 'ticketing', COALESCE(sum(ticketing), 0),
           'purchases', COALESCE(sum(purchases), 0), 'later', COALESCE(sum(later), 0), 'revenue', COALESCE(round(sum(revenue), 2), 0))
    INTO v_prev FROM _ces WHERE sent_at < v_from;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sent_at', sent_at, 'n', n,
           'purchases', purchases, 'revenue', round(revenue, 2)) ORDER BY sent_at), '[]'::jsonb)
    INTO v_list FROM _ces WHERE sent_at >= v_from;

  -- Prochains envois et brouillons.
  SELECT COALESCE(jsonb_agg(public._crm_email_row(ec) ORDER BY ec.status = 'draft', COALESCE(ec.scheduled_at, ec.updated_at)), '[]'::jsonb)
    INTO v_up
    FROM public.email_campaigns ec
   WHERE ec.venue_id IS NOT DISTINCT FROM p_venue_id AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
     AND public.crm_campaign_is_crm(ec.id)
     AND (ec.status = 'draft' OR (ec.status = 'scheduled' AND ec.scheduled_at > now() - interval '1 hour'));

  -- Les dernières campagnes envoyées.
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'sent_at') DESC), '[]'::jsonb) INTO v_last FROM (
    SELECT jsonb_build_object('id', id, 'name', name, 'subject', subject, 'sent_at', sent_at, 'n', n, 'received', received,
             'opened', opened, 'clicked', clicked, 'ticketing', ticketing, 'later', later, 'purchases', purchases, 'revenue', round(revenue, 2)) AS x
      FROM _ces ORDER BY sent_at DESC LIMIT 3) z;
  -- Assez d'historique : les 3 dernières tout temps, pas seulement la période.
  IF jsonb_array_length(v_last) < 3 THEN
    PERFORM public._crm_email_stats(p_venue_id, p_organizer_user_id, now() - interval '25 months', v_to);
    SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'sent_at') DESC), '[]'::jsonb) INTO v_last FROM (
      SELECT jsonb_build_object('id', id, 'name', name, 'subject', subject, 'sent_at', sent_at, 'n', n, 'received', received,
               'opened', opened, 'clicked', clicked, 'ticketing', ticketing, 'later', later, 'purchases', purchases, 'revenue', round(revenue, 2)) AS x
        FROM _ces ORDER BY sent_at DESC LIMIT 3) z;
  END IF;

  RETURN jsonb_build_object('days', v_days, 'from', v_from, 'to', v_to, 'current', v_cur, 'previous', v_prev,
    'campaigns', v_list, 'upcoming', v_up, 'last', v_last,
    'ever_sent', EXISTS (SELECT 1 FROM public.email_campaigns ec
                          WHERE ec.venue_id IS NOT DISTINCT FROM p_venue_id AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
                            AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL AND ec.status IN ('sent', 'sending')
                            AND public.crm_campaign_is_crm(ec.id)));
END;
$function$;
