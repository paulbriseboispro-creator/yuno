-- Destinataires d'un e-mail : chaque ligne dit aussi « a acheté » (bought).
--
-- L'écran déduisait l'achat du montant (revenue > 0). Pour un éditeur ou un
-- lecteur, _crm_money_gate met ce montant à null : l'acheteur s'affichait
-- « a cliqué ». Un booléen n'est pas un montant, le filtre d'argent le laisse
-- passer ; la ligne garde son montant pour qui voit l'argent.
-- Corps repris de pg_get_functiondef (base liée) ; seule la clé 'bought' change.

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
   WHERE c.id = p_campaign_id AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  PERFORM public._crm_email_recipients_build(p_venue_id, p_organizer_user_id, p_campaign_id);

  SELECT count(*) INTO v_total FROM _crr x
   WHERE public._crm_recipient_match(p_filter, x.opened, x.clicked, x.revenue, x.status)
     AND (v_q IS NULL OR x.email LIKE '%' || v_q || '%' OR lower(COALESCE(x.first_name, '') || ' ' || COALESCE(x.last_name, '')) LIKE '%' || v_q || '%');
  SELECT COALESCE(jsonb_agg(jsonb_build_object('email', email, 'first_name', first_name, 'last_name', last_name, 'status', status,
           'lifecycle', lifecycle, 'opened', opened, 'clicked', clicked, 'bought', revenue > 0, 'revenue', round(revenue, 2))), '[]'::jsonb)
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
$function$
;
REVOKE ALL ON FUNCTION public.crm_email_recipients__core(text, uuid, uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_email_recipients__core(text, uuid, uuid, text, text, integer) TO service_role;
