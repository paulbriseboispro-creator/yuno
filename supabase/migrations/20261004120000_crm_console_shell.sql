-- ============================================================================
-- Yuno CRM — la coquille de la Console (/crm) : menu et barre du haut.
--
-- get_crm_shell : en UN aller-retour, ce que la coquille affiche sur chaque
--   écran — le profil de la personne, l'état de la synchro billetterie, le
--   solde de Yunits, l'abonnement (essai, actif, en pause), les pastilles du
--   menu (campagnes à valider, contacts à corriger) et les notifications non
--   lues. Même porte que toute la Console (crm_scope_allowed).
-- crm_search : la recherche ⌘K (clients, campagnes, soirées), bornée à 4
--   résultats par famille ; sans texte, les « récents ».
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_crm_shell(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_profile jsonb;
  v_conn jsonb;
  v_sub jsonb;
  v_drafts integer;
  v_unreachable integer;
  v_unread integer;
  v_balance integer;
  v_reserved integer;
  cfg jsonb := public.crm_pricing_config();
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object('first_name', p.first_name, 'last_name', p.last_name, 'email', p.email,
                            'avatar_url', p.avatar_url, 'language', p.preferred_language)
    INTO v_profile
    FROM public.profiles p WHERE p.id = auth.uid();

  SELECT jsonb_build_object(
           'provider', c.provider, 'status', c.status, 'external_org_name', c.external_org_name,
           'last_ok_at', c.last_ok_at, 'last_error_at', c.last_error_at, 'last_error', c.last_error,
           'fail_count', c.fail_count, 'initial_import_done_at', c.initial_import_done_at,
           'running', c.locked_until IS NOT NULL AND c.locked_until > now(),
           'state', CASE
             WHEN c.status = 'token_invalid' THEN 'broken'
             WHEN c.last_error_at IS NOT NULL AND (c.last_ok_at IS NULL OR c.last_error_at > c.last_ok_at) AND c.fail_count >= 3 THEN 'broken'
             WHEN c.locked_until IS NOT NULL AND c.locked_until > now() THEN 'running'
             WHEN c.status = 'paused' THEN 'paused'
             ELSE 'ok' END,
           'broken_since', CASE WHEN c.status = 'token_invalid' OR (c.last_error_at IS NOT NULL AND (c.last_ok_at IS NULL OR c.last_error_at > c.last_ok_at))
                                THEN COALESCE(c.last_ok_at, c.last_error_at) END)
    INTO v_conn
    FROM public.ticketing_connections c
   WHERE (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
      OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id)
   ORDER BY c.created_at LIMIT 1;

  SELECT jsonb_build_object(
           'status', s.status,
           'state', CASE
             WHEN s.status = 'trialing' AND s.trial_ends_at > now() THEN 'trial'
             WHEN s.status IN ('active', 'past_due')
                  AND NOT (s.stripe_subscription_id IS NULL AND s.current_period_end IS NOT NULL AND s.current_period_end < now())
               THEN s.status
             ELSE 'paused' END,
           'trial_ends_at', s.trial_ends_at, 'current_period_end', s.current_period_end,
           'cancel_at_period_end', s.cancel_at_period_end, 'interval', s.billing_interval,
           'has_stripe', s.stripe_subscription_id IS NOT NULL)
    INTO v_sub
    FROM public.crm_subscriptions s WHERE s.scope_key = v_scope;

  -- Campagnes à traiter : brouillons manuels touchés depuis 30 jours (e-mail
  -- hors automatisations et renvois, SMS).
  SELECT (SELECT count(*) FROM public.email_campaigns c
           WHERE c.status = 'draft' AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
             AND c.updated_at > now() - interval '30 days'
             AND c.venue_id IS NOT DISTINCT FROM p_venue_id
             AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id)
       + (SELECT count(*) FROM public.sms_campaigns s
           WHERE s.status = 'draft' AND s.updated_at > now() - interval '30 days'
             AND s.venue_id IS NOT DISTINCT FROM p_venue_id
             AND s.organizer_id IS NOT DISTINCT FROM p_organizer_user_id)
    INTO v_drafts;

  -- Contacts à corriger : adresse qui rebondit ou injoignable.
  SELECT count(*) INTO v_unreachable
    FROM public.contact_engagement e
   WHERE e.scope_key = v_scope AND e.status = 'unreachable';

  IF p_organizer_user_id IS NOT NULL THEN
    SELECT count(*) INTO v_unread FROM public.organizer_notifications n
     WHERE n.organizer_user_id = p_organizer_user_id AND n.read_at IS NULL
       AND n.created_at > now() - interval '30 days';
  ELSE
    SELECT count(*) INTO v_unread FROM public.staff_notifications n
     WHERE n.venue_id = p_venue_id AND n.target_role = 'owner' AND n.read_at IS NULL
       AND n.created_at > now() - interval '30 days';
  END IF;

  v_balance := public.crm_yunits_balance(v_scope);
  SELECT COALESCE(sum(GREATEST(COALESCE(c.total_recipients, c.recipients_count, 0), 0)), 0)::int * (cfg->'rates'->>'email')::int
    INTO v_reserved
    FROM public.email_campaigns c
   WHERE c.status = 'scheduled' AND c.scheduled_at > now()
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;

  RETURN jsonb_build_object(
    'profile', v_profile,
    'connection', v_conn,
    'subscription', v_sub,
    'wallet', jsonb_build_object('balance', v_balance, 'reserved', v_reserved, 'low_balance', (cfg->>'low_balance')::int,
                                 'rates', cfg->'rates'),
    'badges', jsonb_build_object('campaigns', COALESCE(v_drafts, 0), 'clients', COALESCE(v_unreachable, 0)),
    'notifications_unread', COALESCE(v_unread, 0),
    'is_super_admin', public.is_super_admin()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_crm_shell(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_shell(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_search(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_q text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q text := btrim(COALESCE(p_q, ''));
  v_like text;
  v_clients jsonb;
  v_campaigns jsonb;
  v_nights jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_like := '%' || replace(replace(lower(public.unaccent_safe(v_q)), '%', ''), '_', '') || '%';

  IF v_q <> '' THEN
    WITH people AS (
      SELECT lower(t.buyer_email) AS em,
             max(t.buyer_first_name) AS fn, max(t.buyer_last_name) AS ln,
             count(DISTINCT t.event_id) FILTER (WHERE t.status IN ('valid', 'transferred')) AS nights,
             max(COALESCE(t.purchased_at, t.first_seen_at)) AS last_at
        FROM public.external_tickets t
       WHERE t.buyer_email IS NOT NULL
         AND ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
       GROUP BY 1
      UNION ALL
      SELECT lower(s.email), max(s.first_name), max(s.last_name), 0, max(s.created_at)
        FROM public.newsletter_subscriptions s
       WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
       GROUP BY 1
    ), merged AS (
      SELECT em, max(fn) AS fn, max(ln) AS ln, max(nights) AS nights, max(last_at) AS last_at
        FROM people GROUP BY em
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('email', em, 'first_name', fn, 'last_name', ln, 'nights', nights, 'last_at', last_at)), '[]'::jsonb)
      INTO v_clients
      FROM (
        SELECT * FROM merged
         WHERE lower(public.unaccent_safe(COALESCE(fn, '') || ' ' || COALESCE(ln, '') || ' ' || em)) LIKE v_like
         ORDER BY nights DESC, last_at DESC NULLS LAST
         LIMIT 4
      ) q;
  ELSE
    v_clients := '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'at') DESC NULLS LAST), '[]'::jsonb) INTO v_campaigns FROM (
    SELECT jsonb_build_object('id', c.id, 'name', c.name, 'channel', 'email', 'status', c.status,
                              'at', COALESCE(c.sent_at, c.scheduled_at, c.updated_at),
                              'recipients', COALESCE(c.total_recipients, c.recipients_count)) AS x
      FROM public.email_campaigns c
     WHERE c.automation_id IS NULL AND c.parent_campaign_id IS NULL
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND (v_q = '' OR lower(public.unaccent_safe(COALESCE(c.name, '') || ' ' || COALESCE(c.subject, ''))) LIKE v_like)
     ORDER BY COALESCE(c.sent_at, c.scheduled_at, c.updated_at) DESC NULLS LAST
     LIMIT CASE WHEN v_q = '' THEN 1 ELSE 4 END
  ) q;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'rank')::int, (x->>'start_at')), '[]'::jsonb) INTO v_nights FROM (
    SELECT jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'end_at', e.end_at,
                              'rank', CASE WHEN e.end_at > now() THEN 0 ELSE 1 END,
                              'sold', (SELECT COALESCE(sum(GREATEST(t.quantity, 1)), 0) FROM public.external_tickets t
                                        WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred'))) AS x
      FROM public.events e
     WHERE ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND (e.is_active OR e.external_source IS NOT NULL)
       AND (v_q = '' OR lower(public.unaccent_safe(COALESCE(e.title, ''))) LIKE v_like)
       AND (v_q <> '' OR e.end_at > now())
     ORDER BY CASE WHEN e.end_at > now() THEN 0 ELSE 1 END, abs(extract(epoch FROM e.start_at - now()))
     LIMIT CASE WHEN v_q = '' THEN 1 ELSE 4 END
  ) q;

  RETURN jsonb_build_object('clients', v_clients, 'campaigns', v_campaigns, 'nights', v_nights);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_search(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_search(text, uuid, text) TO authenticated;
