-- Admin CRM › Pilotage › Activité en direct : UN flux daté, lu en base.
--
-- Sources (rien d'inventé) : parcours d'inscription (pro_signups, produit crm),
-- comptes créés, achats de Yunits (crm_yunit_lots), premiers envois (premier
-- envoi e-mail non automatique d'un compte), échecs de synchro
-- (ticketing_sync_runs), gestes admin (admin_audit_log, crm_account).
-- Fenêtre 14 jours ; e-mail d'un prospect masqué ; démo exclue sauf interrupteur.

CREATE OR REPLACE FUNCTION public.crm_admin_activity(p_include_demo boolean DEFAULT false, p_limit integer DEFAULT 120)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lim integer := LEAST(GREATEST(COALESCE(p_limit, 120), 1), 300);
  v_since timestamptz := now() - interval '14 days';
  v_rows jsonb;
  v_demo_u uuid[];
  v_ev jsonb;
  v_live integer;
  cfg jsonb := public.crm_pricing_config();
BEGIN
  PERFORM public._crm_admin_gate();
  v_rows := public._crm_admin_rows(p_include_demo);
  SELECT COALESCE(array_agg(id), '{}') INTO v_demo_u FROM public.profiles WHERE public.is_demo_email(email);

  WITH names AS (
    SELECT r->>'id' AS id, r->>'name' AS name FROM jsonb_array_elements(v_rows) r
  ), su AS (
    SELECT p.* FROM public.pro_signups p
     WHERE p.product = 'crm' AND p.updated_at >= v_since
       AND (p_include_demo OR (p.user_id IS NULL OR NOT (p.user_id = ANY(v_demo_u)))
             AND (p.email IS NULL OR NOT public.is_demo_email(p.email)))
  ), ev AS (
    -- Parcours d'inscription (en cours, abandonné) et comptes créés.
    SELECT CASE WHEN s.account_created_at IS NOT NULL THEN s.account_created_at ELSE s.updated_at END AS at,
           CASE WHEN s.account_created_at IS NOT NULL THEN 'account' ELSE 'signup' END AS k,
           COALESCE(NULLIF(s.org_name, ''), CASE WHEN s.email IS NULL OR s.email = '' THEN NULL
                      ELSE left(split_part(s.email, '@', 1), 2) || '•••@' || split_part(s.email, '@', 2) END) AS who,
           CASE WHEN s.account_created_at IS NOT NULL THEN 'created'
                WHEN s.updated_at > now() - interval '1 hour' THEN 'live' ELSE 'dropped' END AS tag,
           jsonb_build_object('step', s.last_step, 'source', COALESCE(NULLIF(s.source, ''), NULLIF(s.utm_source, '')), 'city', s.city,
                              'secs', CASE WHEN s.account_created_at IS NOT NULL THEN extract(epoch FROM s.account_created_at - s.created_at) END) AS meta,
           CASE WHEN s.account_created_at IS NOT NULL THEN COALESCE(public.crm_scope_key(s.venue_id, s.user_id), NULL) END AS id
      FROM su s
    UNION ALL
    -- Achats de Yunits.
    SELECT l.created_at, 'buy', n.name, 'paid',
           jsonb_build_object('yunits', l.amount,
             'eur', round(CASE WHEN (m.meta->>'amount_total') ~ '^[0-9]+$'
                               THEN (m.meta->>'amount_total')::numeric / 100 / (1 + COALESCE((cfg->>'vat_rate')::numeric, 20) / 100)
                               ELSE l.amount::numeric / NULLIF((cfg->>'yunits_per_euro')::numeric, 0) END, 2)),
           l.scope_key
      FROM public.crm_yunit_lots l
      JOIN names n ON n.id = l.scope_key
      LEFT JOIN public.crm_yunit_moves m ON m.ref_type = 'lot' AND m.ref_id = l.id::text AND m.kind = 'credit'
     WHERE l.kind = 'purchase' AND l.created_at >= v_since
    UNION ALL
    -- Premier envoi e-mail (non automatique) d'un compte.
    SELECT f.at, 'send', n.name, 'first_send',
           jsonb_build_object('name', f.cname, 'recipients', f.recipients), f.id
      FROM (
        SELECT DISTINCT ON (public.crm_scope_key(c.venue_id, c.organizer_user_id))
               public.crm_scope_key(c.venue_id, c.organizer_user_id) AS id,
               COALESCE(c.sent_at, c.send_started_at) AS at, c.name AS cname, c.total_recipients AS recipients
          FROM public.email_campaigns c
         WHERE c.automation_id IS NULL AND COALESCE(c.sent_at, c.send_started_at) IS NOT NULL
         ORDER BY public.crm_scope_key(c.venue_id, c.organizer_user_id), COALESCE(c.sent_at, c.send_started_at)
      ) f JOIN names n ON n.id = f.id
     WHERE f.at >= v_since
    UNION ALL
    -- Échecs de synchro.
    SELECT r.started_at, 'fail', n.name, r.status,
           jsonb_build_object('error', left(r.error, 160)), n.id
      FROM public.ticketing_sync_runs r
      JOIN public.ticketing_connections c ON c.id = r.connection_id
      JOIN names n ON n.id = public.crm_scope_key(c.venue_id, c.organizer_user_id)
     WHERE r.status IN ('error', 'abandoned') AND r.started_at >= v_since
    UNION ALL
    -- Gestes admin.
    SELECT a.created_at, 'admin', COALESCE(n.name, a.entity_id), a.action,
           jsonb_build_object('reason', a.metadata->>'reason'), a.entity_id
      FROM public.admin_audit_log a
      LEFT JOIN names n ON n.id = a.entity_id
     WHERE a.entity_type = 'crm_account' AND a.created_at >= v_since
       AND (p_include_demo OR n.id IS NOT NULL)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('at', e.at, 'k', e.k, 'who', e.who, 'tag', e.tag, 'meta', e.meta, 'id', e.id) ORDER BY e.at DESC), '[]'::jsonb)
    INTO v_ev FROM (SELECT * FROM ev WHERE at IS NOT NULL ORDER BY at DESC LIMIT v_lim) e;

  SELECT count(*) INTO v_live FROM public.pro_signups p
   WHERE p.product = 'crm' AND p.account_created_at IS NULL AND p.updated_at > now() - interval '1 hour'
     AND (p_include_demo OR (p.user_id IS NULL OR NOT (p.user_id = ANY(v_demo_u))) AND (p.email IS NULL OR NOT public.is_demo_email(p.email)));

  RETURN jsonb_build_object('at', now(), 'live', v_live, 'events', v_ev);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_activity(boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_activity(boolean, integer) TO authenticated, service_role;

-- Pastille du menu : les inscriptions en cours (touchées il y a moins d'une heure).
CREATE OR REPLACE FUNCTION public.crm_admin_live_signups(p_include_demo boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_demo_u uuid[]; v_n integer;
BEGIN
  PERFORM public._crm_admin_gate();
  SELECT COALESCE(array_agg(id), '{}') INTO v_demo_u FROM public.profiles WHERE public.is_demo_email(email);
  SELECT count(*) INTO v_n FROM public.pro_signups p
   WHERE p.product = 'crm' AND p.account_created_at IS NULL AND p.updated_at > now() - interval '1 hour'
     AND (p_include_demo OR (p.user_id IS NULL OR NOT (p.user_id = ANY(v_demo_u))) AND (p.email IS NULL OR NOT public.is_demo_email(p.email)));
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_live_signups(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_live_signups(boolean) TO authenticated, service_role;
