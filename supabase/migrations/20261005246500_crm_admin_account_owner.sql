-- Admin CRM › fiche d'un compte : le titulaire (pour la demande d'accès assisté,
-- jamais une session sans consentement) et le compteur de prolongations d'essai.

CREATE OR REPLACE FUNCTION public.crm_admin_account(p_scope_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row jsonb;
  v_conn uuid;
  v_parts record;
BEGIN
  PERFORM public._crm_admin_gate();
  SELECT r INTO v_row FROM jsonb_array_elements(public._crm_admin_rows(true)) r WHERE r->>'id' = p_scope_key LIMIT 1;
  IF v_row IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_parts FROM public.crm_scope_parts(p_scope_key);
  SELECT id INTO v_conn FROM public.ticketing_connections c
   WHERE (v_parts.venue_id IS NOT NULL AND c.venue_id = v_parts.venue_id)
      OR (v_parts.organizer_user_id IS NOT NULL AND c.organizer_user_id = v_parts.organizer_user_id)
   ORDER BY c.created_at LIMIT 1;
  RETURN jsonb_build_object(
    'account', v_row,
    -- Titulaire (accès assisté : la demande de consentement lui est adressée).
    'owner_id', COALESCE(v_parts.organizer_user_id, (SELECT v.owner_id FROM public.venues v WHERE v.id = v_parts.venue_id)),
    'trial_ext', jsonb_build_object(
      'used', COALESCE((SELECT s.trial_extensions_used FROM public.crm_subscriptions s WHERE s.scope_key = p_scope_key), 0),
      'free', COALESCE((public.crm_pricing_config()->>'trial_extensions')::int, 0)),
    'moves', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', m.at, 'delta', m.delta, 'kind', m.kind, 'lot_kind', m.lot_kind,
                         'channel', m.channel, 'label', m.label) ORDER BY m.at DESC)
                         FROM (SELECT * FROM public.crm_yunit_moves WHERE scope_key = p_scope_key ORDER BY at DESC LIMIT 40) m), '[]'::jsonb),
    'runs', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', r.started_at, 'trigger', r.trigger, 'status', r.status,
                         'requests', r.requests, 'tickets', r.tickets_upserted, 'error', r.error) ORDER BY r.started_at DESC)
                        FROM (SELECT * FROM public.ticketing_sync_runs WHERE connection_id = v_conn ORDER BY started_at DESC LIMIT 20) r), '[]'::jsonb),
    'sends', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (
                         SELECT jsonb_build_object('at', COALESCE(c.sent_at, c.send_started_at, c.created_at), 'name', c.name, 'status', c.status,
                                'recipients', c.total_recipients, 'bounced', c.bounced_count, 'complained', c.complained_count, 'channel', 'email') AS x
                           FROM public.email_campaigns c
                          WHERE c.automation_id IS NULL
                            AND ((v_parts.venue_id IS NOT NULL AND c.venue_id = v_parts.venue_id)
                              OR (v_parts.organizer_user_id IS NOT NULL AND c.organizer_user_id = v_parts.organizer_user_id))
                          ORDER BY COALESCE(c.sent_at, c.send_started_at, c.created_at) DESC LIMIT 10) q), '[]'::jsonb),
    'note', COALESCE((SELECT body FROM public.crm_admin_notes WHERE scope_key = p_scope_key), ''),
    'audit', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', a.created_at, 'action', a.action, 'meta', a.metadata) ORDER BY a.created_at DESC)
                         FROM (SELECT * FROM public.admin_audit_log WHERE entity_type = 'crm_account' AND entity_id = p_scope_key
                               ORDER BY created_at DESC LIMIT 30) a), '[]'::jsonb));
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_admin_account(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_account(text) TO authenticated, service_role;
