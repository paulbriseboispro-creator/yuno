-- ============================================================================
-- Yuno CRM : la suite SMS (vue d'ensemble, campagnes, résultats, analyse,
-- options et aperçu d'audience, brouillons, réglages d'envoi).
--
-- Le moteur SMS existant (send-sms-campaign) n'est PAS branché pour un compte
-- CRM : il débite les crédits de la Suite, ne connaît ni les Yunits ni le
-- prénom dans le message, et ses heures calmes sont écrites en dur. Tant que
-- ce travail (docs/designs/CRM_SMS_PLAN.md) n'est pas fait, un SMS CRM se
-- compose et s'enregistre en brouillon ; il ne se programme ni ne s'envoie, et
-- enqueue_sms_campaign_recipients le refuse (« crm_sms_not_open »).
--
-- Une seule définition des chiffres d'un SMS parti (_crm_sms_stats) :
--   envoyés  = destinataires partis (sent, delivered, undelivered, failed) ;
--   remis    = delivered ;
--   clics    = visiteurs distincts du lien suivi de la campagne, de son départ
--              au départ suivant sur le même lien (au plus 7 jours) — le lien
--              est partagé par soirée, il ne dit pas QUI a cliqué ;
--   achats   = billets achetés dans les 7 jours après le SMS par une personne
--              qui l'a reçu (téléphone → e-mail du registre SMS), rattachés au
--              dernier SMS reçu avant l'achat ;
--   STOP     = désinscriptions SMS dans les 7 jours après le SMS, rattachées au
--              dernier SMS reçu.
-- ============================================================================

-- ---------------------------------------------------------------- Réglages
CREATE TABLE IF NOT EXISTS public.crm_sms_settings (
  scope_key   text PRIMARY KEY,
  sender_name text CHECK (sender_name IS NULL OR sender_name ~ '^[A-Za-z0-9]{3,11}$'),
  quiet_from  smallint NOT NULL DEFAULT 20 CHECK (quiet_from BETWEEN 0 AND 23),
  quiet_to    smallint NOT NULL DEFAULT 8 CHECK (quiet_to BETWEEN 0 AND 23),
  no_sunday   boolean NOT NULL DEFAULT true,
  weekly_cap  smallint NOT NULL DEFAULT 1 CHECK (weekly_cap BETWEEN 1 AND 3),
  test_phone  text CHECK (test_phone IS NULL OR test_phone ~ '^\+[1-9][0-9]{6,14}$'),
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_sms_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_sms_settings FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_sms_settings_get(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.crm_sms_settings%ROWTYPE;
  v_people integer; v_ok integer;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.crm_sms_settings WHERE scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id);
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  SELECT count(*), count(*) FILTER (WHERE phone_ok) INTO v_people, v_ok FROM _cp;
  RETURN jsonb_build_object(
    'sender_name', s.sender_name,
    'quiet_from', COALESCE(s.quiet_from, 20), 'quiet_to', COALESCE(s.quiet_to, 8),
    'no_sunday', COALESCE(s.no_sunday, true), 'weekly_cap', COALESCE(s.weekly_cap, 1),
    'test_phone', s.test_phone, 'updated_at', s.updated_at,
    'people', v_people, 'sms_ok', v_ok);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_sms_settings_get(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_sms_settings_get(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_sms_settings_set(p_venue_id text, p_organizer_user_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_sender text; v_phone text;
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_patch ? 'sender_name' THEN
    v_sender := NULLIF(btrim(COALESCE(p_patch->>'sender_name', '')), '');
    IF v_sender IS NOT NULL AND v_sender !~ '^[A-Za-z0-9]{3,11}$' THEN
      RAISE EXCEPTION 'bad_sender' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_patch ? 'test_phone' THEN
    v_phone := NULLIF(regexp_replace(COALESCE(p_patch->>'test_phone', ''), '[^0-9+]', '', 'g'), '');
    IF v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{6,14}$' THEN
      RAISE EXCEPTION 'bad_phone' USING ERRCODE = '22023';
    END IF;
  END IF;
  INSERT INTO public.crm_sms_settings AS t (scope_key, updated_by) VALUES (v_key, auth.uid())
  ON CONFLICT (scope_key) DO NOTHING;
  UPDATE public.crm_sms_settings t SET
    sender_name = CASE WHEN p_patch ? 'sender_name' THEN v_sender ELSE t.sender_name END,
    quiet_from  = CASE WHEN p_patch ? 'quiet_from' THEN LEAST(GREATEST((p_patch->>'quiet_from')::int, 0), 23) ELSE t.quiet_from END,
    quiet_to    = CASE WHEN p_patch ? 'quiet_to' THEN LEAST(GREATEST((p_patch->>'quiet_to')::int, 0), 23) ELSE t.quiet_to END,
    no_sunday   = CASE WHEN p_patch ? 'no_sunday' THEN COALESCE((p_patch->>'no_sunday')::boolean, true) ELSE t.no_sunday END,
    weekly_cap  = CASE WHEN p_patch ? 'weekly_cap' THEN LEAST(GREATEST((p_patch->>'weekly_cap')::int, 1), 3) ELSE t.weekly_cap END,
    test_phone  = CASE WHEN p_patch ? 'test_phone' THEN v_phone ELSE t.test_phone END,
    updated_by = auth.uid(), updated_at = now()
   WHERE t.scope_key = v_key;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_sms_settings_set(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_sms_settings_set(text, uuid, jsonb) TO authenticated, service_role;

-- ------------------------------------------------- Chiffres des SMS partis
CREATE OR REPLACE FUNCTION public._crm_sms_stats(p_venue_id text, p_organizer_user_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  v_n integer;
BEGIN
  -- Tous les SMS partis de la portée : un achat ou un STOP se rattache au
  -- dernier SMS reçu, même hors de la période affichée.
  DROP TABLE IF EXISTS _csc;
  CREATE TEMP TABLE _csc ON COMMIT DROP AS
  SELECT c.id, c.tracked_link_id, COALESCE(c.send_started_at, c.sent_at) AS start_at, c.sent_at
    FROM public.sms_campaigns c
   WHERE c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
     AND c.status IN ('sent', 'sending') AND c.sent_at IS NOT NULL;

  DROP TABLE IF EXISTS _csr;
  CREATE TEMP TABLE _csr ON COMMIT DROP AS
  SELECT r.campaign_id, r.phone_e164 AS phone, r.status, r.sent_at, m.email
    FROM public.sms_campaign_recipients r
    JOIN _csc c ON c.id = r.campaign_id
    LEFT JOIN LATERAL (
      SELECT lower(vc.email) AS email FROM public.venue_sms_contacts vc
       WHERE vc.phone_e164 = r.phone_e164 AND vc.email IS NOT NULL
         AND vc.venue_id IS NOT DISTINCT FROM p_venue_id AND vc.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       LIMIT 1) m ON true
   WHERE r.status IN ('sent', 'delivered', 'undelivered', 'failed') AND r.sent_at IS NOT NULL;
  CREATE INDEX ON _csr (email, sent_at);
  CREATE INDEX ON _csr (phone, sent_at);

  -- Achats : billet acheté dans les 7 jours après un SMS reçu, au dernier SMS.
  DROP TABLE IF EXISTS _csa;
  CREATE TEMP TABLE _csa ON COMMIT DROP AS
  SELECT DISTINCT ON (t.id) t.id, t.email, t.amount, t.bought_at, r.campaign_id
    FROM public._crm_tickets(p_venue_id, p_organizer_user_id) t
    JOIN _csr r ON r.email = t.email AND r.status IN ('sent', 'delivered')
     AND t.bought_at > r.sent_at AND t.bought_at <= r.sent_at + interval '7 days'
   ORDER BY t.id, r.sent_at DESC;

  -- STOP : désinscription dans les 7 jours après un SMS reçu, au dernier SMS.
  DROP TABLE IF EXISTS _cst;
  CREATE TEMP TABLE _cst ON COMMIT DROP AS
  SELECT DISTINCT ON (vc.phone_e164) vc.phone_e164 AS phone, vc.unsubscribed_at AS at, r.campaign_id
    FROM public.venue_sms_contacts vc
    JOIN _csr r ON r.phone = vc.phone_e164
     AND vc.unsubscribed_at > r.sent_at AND vc.unsubscribed_at <= r.sent_at + interval '7 days'
   WHERE vc.unsubscribed AND vc.unsubscribed_at IS NOT NULL
     AND vc.venue_id IS NOT DISTINCT FROM p_venue_id AND vc.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
   ORDER BY vc.phone_e164, r.sent_at DESC;

  -- Clics : le lien suivi est partagé par soirée ; chaque campagne garde les
  -- clics de son départ au départ suivant sur le même lien (7 jours au plus).
  DROP TABLE IF EXISTS _csk;
  CREATE TEMP TABLE _csk ON COMMIT DROP AS
  SELECT c.id AS campaign_id, k.clicked_at,
         COALESCE(k.visitor_id, k.ip_hash, k.id::text) AS who,
         extract(epoch FROM k.clicked_at - c.start_at) / 60.0 AS mins
    FROM _csc c
    JOIN public.tracked_link_clicks k ON k.tracked_link_id = c.tracked_link_id
     AND k.clicked_at >= c.start_at
     AND k.clicked_at < LEAST(c.start_at + interval '7 days',
           COALESCE((SELECT min(c2.start_at) FROM _csc c2
                      WHERE c2.tracked_link_id = c.tracked_link_id AND c2.start_at > c.start_at), 'infinity'::timestamptz))
   WHERE c.tracked_link_id IS NOT NULL;

  DROP TABLE IF EXISTS _css;
  CREATE TEMP TABLE _css ON COMMIT DROP AS
  SELECT c.id, sc.name, sc.body_template AS body, sc.sender_name, sc.segment_filters, sc.event_id, c.sent_at,
         GREATEST(COALESCE(sc.segments_per_message, 1), 1) AS parts,
         r.n, r.delivered, r.failed,
         COALESCE(k.clicked, 0) AS clicked,
         COALESCE(b.purchases, 0) AS purchases, COALESCE(b.buyers, 0) AS buyers, COALESCE(b.revenue, 0) AS revenue,
         COALESCE(s.stop, 0) AS stop
    FROM _csc c
    JOIN public.sms_campaigns sc ON sc.id = c.id
    CROSS JOIN LATERAL (
      SELECT count(*) AS n, count(*) FILTER (WHERE rr.status = 'delivered') AS delivered,
             count(*) FILTER (WHERE rr.status IN ('failed', 'undelivered')) AS failed
        FROM _csr rr WHERE rr.campaign_id = c.id) r
    LEFT JOIN LATERAL (SELECT count(DISTINCT kk.who) AS clicked FROM _csk kk WHERE kk.campaign_id = c.id) k ON true
    LEFT JOIN LATERAL (SELECT count(*) AS purchases, count(DISTINCT aa.email) AS buyers, COALESCE(sum(aa.amount), 0) AS revenue
                         FROM _csa aa WHERE aa.campaign_id = c.id) b ON true
    LEFT JOIN LATERAL (SELECT count(*) AS stop FROM _cst ss WHERE ss.campaign_id = c.id) s ON true
   WHERE c.sent_at >= p_from AND c.sent_at < p_to;
  SELECT count(*) INTO v_n FROM _css;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public._crm_sms_stats(text, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_sms_stats(text, uuid, timestamptz, timestamptz) TO service_role;

-- Une ligne de campagne (brouillon, programmée ou partie).
CREATE OR REPLACE FUNCTION public._crm_sms_row(c public.sms_campaigns)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'name', c.name, 'body', c.body_template, 'sender_name', c.sender_name,
    'status', c.status, 'scheduled_at', c.scheduled_at, 'sent_at', c.sent_at,
    'updated_at', c.updated_at, 'created_at', c.created_at, 'event_id', c.event_id,
    'audiences', COALESCE(c.segment_filters->'audiences', '[]'::jsonb),
    'exclude_buyers', COALESCE((c.segment_filters->>'exclude_buyers')::boolean, false),
    'recent_days', NULLIF(c.segment_filters->>'recent_days', '')::integer,
    'waves', COALESCE((c.segment_filters->>'waves')::boolean, false),
    'quiet_hours', c.quiet_hours,
    'estimated', c.estimated_recipients, 'parts', GREATEST(COALESCE(c.segments_per_message, 1), 1),
    'paused_reason', c.paused_reason);
$$;
REVOKE ALL ON FUNCTION public._crm_sms_row(public.sms_campaigns) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_sms_row(public.sms_campaigns) TO service_role;

-- ------------------------------------------------------ Vue d'ensemble
CREATE OR REPLACE FUNCTION public.crm_sms_overview__core(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  PERFORM public._crm_sms_stats(p_venue_id, p_organizer_user_id, now() - interval '25 months', v_to);

  SELECT jsonb_build_object('campaigns', count(*), 'sent', COALESCE(sum(n), 0), 'delivered', COALESCE(sum(delivered), 0),
           'clicked', COALESCE(sum(clicked), 0), 'purchases', COALESCE(sum(purchases), 0), 'revenue', COALESCE(round(sum(revenue), 2), 0),
           'stop', COALESCE(sum(stop), 0), 'units', COALESCE(sum(n * parts), 0))
    INTO v_cur FROM _css WHERE sent_at >= v_from;
  SELECT jsonb_build_object('campaigns', count(*), 'sent', COALESCE(sum(n), 0), 'delivered', COALESCE(sum(delivered), 0),
           'clicked', COALESCE(sum(clicked), 0), 'purchases', COALESCE(sum(purchases), 0), 'revenue', COALESCE(round(sum(revenue), 2), 0),
           'stop', COALESCE(sum(stop), 0), 'units', COALESCE(sum(n * parts), 0))
    INTO v_prev FROM _css WHERE sent_at >= v_pfrom AND sent_at < v_from;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sent_at', sent_at, 'n', n,
           'purchases', purchases, 'revenue', round(revenue, 2)) ORDER BY sent_at), '[]'::jsonb)
    INTO v_list FROM _css WHERE sent_at >= v_from;

  -- Brouillons et envois programmés.
  SELECT COALESCE(jsonb_agg(public._crm_sms_row(c) ORDER BY c.status = 'draft', COALESCE(c.scheduled_at, c.updated_at)), '[]'::jsonb)
    INTO v_up
    FROM public.sms_campaigns c
   WHERE c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
     AND (c.status = 'draft' OR (c.status = 'scheduled' AND c.scheduled_at > now() - interval '1 hour'));

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'sent_at') DESC), '[]'::jsonb) INTO v_last FROM (
    SELECT jsonb_build_object('id', id, 'name', name, 'body', body, 'sender_name', sender_name, 'sent_at', sent_at,
             'n', n, 'delivered', delivered, 'clicked', clicked, 'purchases', purchases, 'revenue', round(revenue, 2)) AS x
      FROM _css ORDER BY sent_at DESC LIMIT 3) z;

  RETURN jsonb_build_object('days', v_days, 'from', v_from, 'to', v_to, 'current', v_cur, 'previous', v_prev,
    'campaigns', v_list, 'upcoming', v_up, 'last', v_last, 'ever_sent', EXISTS (SELECT 1 FROM _css));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_sms_overview__core(text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_sms_overview__core(text, uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_sms_overview(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._crm_money_gate(public.crm_sms_overview__core(p_venue_id, p_organizer_user_id, p_days), p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.crm_sms_overview(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_sms_overview(text, uuid, integer) TO authenticated, service_role;

-- -------------------------------------------------------------- Campagnes
CREATE OR REPLACE FUNCTION public.crm_sms_campaigns__core(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
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
  PERFORM public._crm_sms_stats(p_venue_id, p_organizer_user_id, '-infinity'::timestamptz, 'infinity'::timestamptz);
  SELECT COALESCE(jsonb_agg(public._crm_sms_row(c)
           || CASE WHEN s.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('stats', jsonb_build_object(
                'n', s.n, 'delivered', s.delivered, 'failed', s.failed, 'clicked', s.clicked, 'purchases', s.purchases,
                'buyers', s.buyers, 'revenue', round(s.revenue, 2), 'stop', s.stop, 'parts', s.parts)) END
           ORDER BY COALESCE(c.sent_at, c.scheduled_at, c.updated_at) DESC), '[]'::jsonb)
    INTO v
    FROM public.sms_campaigns c
    LEFT JOIN _css s ON s.id = c.id
   WHERE c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
     AND c.status <> 'cancelled';
  RETURN jsonb_build_object('campaigns', v);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_sms_campaigns__core(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_sms_campaigns__core(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_sms_campaigns(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._crm_money_gate(public.crm_sms_campaigns__core(p_venue_id, p_organizer_user_id), p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.crm_sms_campaigns(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_sms_campaigns(text, uuid) TO authenticated, service_role;

-- -------------------------------------------------------- Résultats d'un SMS
CREATE OR REPLACE FUNCTION public.crm_sms_result__core(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.sms_campaigns%ROWTYPE;
  v_stats jsonb; v_avg jsonb; v_tl jsonb; v_others jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.sms_campaigns x
   WHERE x.id = p_campaign_id AND x.venue_id IS NOT DISTINCT FROM p_venue_id AND x.organizer_id IS NOT DISTINCT FROM p_organizer_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  PERFORM public._crm_sms_stats(p_venue_id, p_organizer_user_id, '-infinity'::timestamptz, 'infinity'::timestamptz);

  SELECT jsonb_build_object('n', s.n, 'delivered', s.delivered, 'failed', s.failed, 'clicked', s.clicked,
           'purchases', s.purchases, 'buyers', s.buyers, 'revenue', round(s.revenue, 2), 'stop', s.stop, 'parts', s.parts,
           -- Ceux qui l'ont reçu et n'ont rien acheté dans les 7 jours (relance possible).
           'non_buyers', (SELECT count(DISTINCT r.phone) FROM _csr r WHERE r.campaign_id = s.id AND r.status = 'delivered'
                            AND (r.email IS NULL OR NOT EXISTS (SELECT 1 FROM _csa a WHERE a.campaign_id = s.id AND a.email = r.email))))
    INTO v_stats FROM _css s WHERE s.id = c.id;

  -- Les autres SMS partis de la portée : sommes, l'écran en tire les moyennes.
  SELECT jsonb_build_object('campaigns', count(*), 'n', COALESCE(sum(n), 0), 'delivered', COALESCE(sum(delivered), 0),
           'clicked', COALESCE(sum(clicked), 0), 'purchases', COALESCE(sum(purchases), 0), 'revenue', COALESCE(round(sum(revenue), 2), 0))
    INTO v_avg FROM _css WHERE id <> c.id;

  -- Quand ont-ils cliqué : tranches de temps après le départ.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('b', b.i, 'clicks', COALESCE(k.n, 0)) ORDER BY b.i), '[]'::jsonb)
    INTO v_tl
    FROM (VALUES (0, 0, 5), (1, 5, 15), (2, 15, 30), (3, 30, 60), (4, 60, 180), (5, 180, 1440), (6, 1440, 10080)) b(i, lo, hi)
    LEFT JOIN LATERAL (SELECT count(*) AS n FROM _csk k WHERE k.campaign_id = c.id AND k.mins >= b.lo AND k.mins < b.hi) k ON true;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sent_at', sent_at) ORDER BY sent_at DESC), '[]'::jsonb)
    INTO v_others FROM (SELECT id, name, sent_at FROM _css ORDER BY sent_at DESC LIMIT 12) o;

  RETURN public._crm_sms_row(c) || jsonb_build_object('stats', v_stats, 'avg', v_avg, 'timeline', v_tl, 'others', v_others);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_sms_result__core(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_sms_result__core(text, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_sms_result(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._crm_money_gate(public.crm_sms_result__core(p_venue_id, p_organizer_user_id, p_campaign_id), p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.crm_sms_result(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_sms_result(text, uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------- Analyse
CREATE OR REPLACE FUNCTION public.crm_sms_analysis__core(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
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
  PERFORM public._crm_sms_stats(p_venue_id, p_organizer_user_id, now() - interval '12 months', now());
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'name', name, 'sent_at', sent_at,
           'audiences', COALESCE(segment_filters->'audiences', '[]'::jsonb),
           -- Jour (1 = lundi) et heure d'envoi, à Paris.
           'dow', extract(isodow FROM sent_at AT TIME ZONE 'Europe/Paris')::int,
           'hour', extract(hour FROM sent_at AT TIME ZONE 'Europe/Paris')::int,
           'n', n, 'delivered', delivered, 'failed', failed, 'clicked', clicked, 'purchases', purchases,
           'revenue', round(revenue, 2), 'stop', stop, 'parts', parts) ORDER BY sent_at DESC), '[]'::jsonb)
    INTO v FROM _css;
  RETURN jsonb_build_object('campaigns', v);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_sms_analysis__core(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_sms_analysis__core(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_sms_analysis(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._crm_money_gate(public.crm_sms_analysis__core(p_venue_id, p_organizer_user_id), p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.crm_sms_analysis(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_sms_analysis(text, uuid) TO authenticated, service_role;

-- --------------------------------------------------- Audience d'un SMS
CREATE OR REPLACE FUNCTION public.crm_sms_send_options(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
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

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', k.key, 'people', COALESCE(a.people, 0), 'reach', COALESCE(a.reach, 0),
           'phone_pct', CASE WHEN COALESCE(a.people, 0) > 0 THEN round(100.0 * a.reach / a.people) END) ORDER BY k.ord), '[]'::jsonb)
    INTO v_auto
    FROM (VALUES ('hab', 1), ('occ', 2), ('nou', 3), ('end', 4), ('none', 5)) k(key, ord)
    LEFT JOIN (SELECT lifecycle, count(*)::integer AS people, count(*) FILTER (WHERE phone_ok)::integer AS reach
                 FROM _cp GROUP BY lifecycle) a ON a.lifecycle = k.key;

  FOR s IN
    SELECT id, name, description, definition FROM public.crm_segments
     WHERE venue_id IS NOT DISTINCT FROM p_venue_id AND organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     ORDER BY created_at DESC LIMIT 40
  LOOP
    EXECUTE format('SELECT count(*)::integer AS people, count(*) FILTER (WHERE p.phone_ok)::integer AS reach FROM _cp p WHERE (%s)',
                   public._crm_filter_sql(s.definition, 'p'))
      INTO r;
    v_saved := v_saved || jsonb_build_array(jsonb_build_object(
      'id', s.id, 'name', s.name, 'description', s.description, 'people', COALESCE(r.people, 0), 'reach', COALESCE(r.reach, 0),
      'phone_pct', CASE WHEN COALESCE(r.people, 0) > 0 THEN round(100.0 * r.reach / r.people) END));
  END LOOP;

  RETURN jsonb_build_object('auto', v_auto, 'saved', v_saved,
    'people', (SELECT count(*) FROM _cp), 'reach', (SELECT count(*) FROM _cp WHERE phone_ok),
    'rules', (SELECT to_jsonb(sr) FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id) sr));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_sms_send_options(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_sms_send_options(text, uuid) TO authenticated, service_role;

-- Qui recevrait ce SMS : joignables par SMS dans l'audience, moins ceux qui
-- ont déjà leur place (au choix), ceux qui ont reçu un message récemment (au
-- choix) et ceux qui ont atteint le plafond de SMS de la semaine (toujours).
CREATE OR REPLACE FUNCTION public.crm_sms_audience_preview(
  p_venue_id text, p_organizer_user_id uuid, p_audiences jsonb, p_event_id uuid DEFAULT NULL,
  p_recent_days integer DEFAULT NULL, p_exclude_buyers boolean DEFAULT false, p_campaign_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pred text;
  v_days integer := CASE WHEN p_recent_days BETWEEN 1 AND 90 THEN p_recent_days END;
  v_cap integer;
  v jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_pred := public._crm_audience_pred(p_audiences, p_venue_id, p_organizer_user_id);
  IF v_pred IS NULL THEN
    RETURN jsonb_build_object('reach', 0, 'x_buyers', 0, 'x_recent', 0, 'x_cap', 0, 'net', 0);
  END IF;
  SELECT COALESCE(s.weekly_cap, 1) INTO v_cap FROM public.crm_sms_settings s
   WHERE s.scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_cap := COALESCE(v_cap, 1);
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);

  EXECUTE format($q$
    WITH sel AS (
      SELECT p.email, p.phone, p.events FROM _cp p WHERE p.phone_ok AND (%3$s)
    ), sms7 AS (
      SELECT r.phone_e164 AS phone, count(*) AS n
        FROM public.sms_campaign_recipients r
        JOIN public.sms_campaigns c ON c.id = r.campaign_id
       WHERE c.venue_id IS NOT DISTINCT FROM %1$L::text AND c.organizer_id IS NOT DISTINCT FROM %2$L::uuid
         AND c.id IS DISTINCT FROM %6$L::uuid
         AND r.status IN ('sent', 'delivered') AND r.sent_at > now() - interval '7 days'
       GROUP BY 1
    ), f AS (
      SELECT s.email,
             (%4$L::uuid IS NOT NULL AND %4$L::uuid = ANY (s.events)) AS buyer,
             (%5$L::integer IS NOT NULL AND (
                EXISTS (SELECT 1 FROM public.sms_campaign_recipients r
                          JOIN public.sms_campaigns c ON c.id = r.campaign_id
                         WHERE c.venue_id IS NOT DISTINCT FROM %1$L::text AND c.organizer_id IS NOT DISTINCT FROM %2$L::uuid
                           AND c.id IS DISTINCT FROM %6$L::uuid AND r.phone_e164 = s.phone
                           AND r.status IN ('sent', 'delivered') AND r.sent_at > now() - make_interval(days => %5$L::integer))
                OR EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                             JOIN public.email_campaigns c ON c.id = r.campaign_id
                            WHERE c.venue_id IS NOT DISTINCT FROM %1$L::text AND c.organizer_user_id IS NOT DISTINCT FROM %2$L::uuid
                              AND r.status = 'sent' AND r.sent_at > now() - make_interval(days => %5$L::integer)
                              AND lower(r.email) = s.email))) AS recent,
             COALESCE((SELECT m.n FROM sms7 m WHERE m.phone = s.phone), 0) >= %8$L::integer AS capped
        FROM sel s
    )
    SELECT jsonb_build_object(
      'reach', count(*),
      'x_buyers', count(*) FILTER (WHERE buyer AND %7$L::boolean),
      'x_recent', count(*) FILTER (WHERE recent AND NOT (buyer AND %7$L::boolean)),
      'x_cap', count(*) FILTER (WHERE capped AND NOT recent AND NOT (buyer AND %7$L::boolean)),
      'net', count(*) FILTER (WHERE NOT (buyer AND %7$L::boolean) AND NOT recent AND NOT capped))
      FROM f
  $q$, p_venue_id, p_organizer_user_id, v_pred, p_event_id, v_days, p_campaign_id, COALESCE(p_exclude_buyers, false), v_cap)
  INTO v;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_sms_audience_preview(text, uuid, jsonb, uuid, integer, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_sms_audience_preview(text, uuid, jsonb, uuid, integer, boolean, uuid) TO authenticated, service_role;

-- -------------------------------------------------------------- Brouillons
-- Crée (p_id NULL) ou modifie un brouillon. Un SMS CRM reste en brouillon :
-- la date choisie est gardée (scheduled_at), le statut ne passe jamais à
-- « programmé » ici — le cron ne lance que les campagnes programmées.
CREATE OR REPLACE FUNCTION public.crm_sms_save(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.sms_campaigns%ROWTYPE;
  v_id uuid := p_id;
  v_filters jsonb;
  v_event uuid;
  v_sender text;
  v_rd integer;
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN p_patch := '{}'::jsonb; END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO c FROM public.sms_campaigns x
     WHERE x.id = v_id AND x.venue_id IS NOT DISTINCT FROM p_venue_id AND x.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
    IF c.status <> 'draft' THEN RAISE EXCEPTION 'not_draft' USING ERRCODE = '22023'; END IF;
  END IF;

  IF p_patch ? 'event_id' AND NULLIF(p_patch->>'event_id', '') IS NOT NULL THEN
    SELECT e.id INTO v_event FROM public.events e
     WHERE e.id = (p_patch->>'event_id')::uuid
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id));
    IF v_event IS NULL THEN RAISE EXCEPTION 'bad_event' USING ERRCODE = '22023'; END IF;
  END IF;
  IF p_patch ? 'sender_name' THEN
    v_sender := NULLIF(btrim(COALESCE(p_patch->>'sender_name', '')), '');
    IF v_sender IS NOT NULL AND v_sender !~ '^[A-Za-z0-9]{3,11}$' THEN
      RAISE EXCEPTION 'bad_sender' USING ERRCODE = '22023';
    END IF;
  END IF;
  v_rd := CASE WHEN (p_patch->>'recent_days') ~ '^[0-9]+$' AND (p_patch->>'recent_days')::int BETWEEN 1 AND 90
               THEN (p_patch->>'recent_days')::int END;

  -- Audience CRM : « type » = crm, que l'ancien moteur refuse de mettre en file.
  v_filters := COALESCE(c.segment_filters, '{}'::jsonb) || jsonb_build_object('type', 'crm');
  IF p_patch ? 'audiences' THEN
    v_filters := v_filters || jsonb_build_object('audiences',
      CASE WHEN jsonb_typeof(p_patch->'audiences') = 'array' THEN p_patch->'audiences' ELSE '[]'::jsonb END);
  END IF;
  IF p_patch ? 'exclude_buyers' THEN v_filters := v_filters || jsonb_build_object('exclude_buyers', COALESCE((p_patch->>'exclude_buyers')::boolean, false)); END IF;
  IF p_patch ? 'recent_days' THEN v_filters := v_filters || jsonb_build_object('recent_days', v_rd); END IF;
  IF p_patch ? 'waves' THEN v_filters := v_filters || jsonb_build_object('waves', COALESCE((p_patch->>'waves')::boolean, false)); END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.sms_campaigns (venue_id, organizer_id, created_by, name, body_template, segment_filters, status,
                                      event_id, sender_name, quiet_hours, scheduled_at, estimated_recipients, segments_per_message, estimated_credits)
    VALUES (p_venue_id, p_organizer_user_id, auth.uid(),
            left(COALESCE(NULLIF(btrim(p_patch->>'name'), ''), 'SMS'), 120),
            left(COALESCE(p_patch->>'body', ''), 1000),
            v_filters, 'draft', v_event, v_sender,
            COALESCE((p_patch->>'quiet_hours')::boolean, true),
            NULLIF(p_patch->>'scheduled_at', '')::timestamptz,
            GREATEST(COALESCE((p_patch->>'estimated')::int, 0), 0),
            LEAST(GREATEST(COALESCE((p_patch->>'parts')::int, 1), 1), 10),
            GREATEST(COALESCE((p_patch->>'estimated')::int, 0), 0) * LEAST(GREATEST(COALESCE((p_patch->>'parts')::int, 1), 1), 10))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.sms_campaigns x SET
      name = CASE WHEN p_patch ? 'name' THEN left(COALESCE(NULLIF(btrim(p_patch->>'name'), ''), x.name), 120) ELSE x.name END,
      body_template = CASE WHEN p_patch ? 'body' THEN left(COALESCE(p_patch->>'body', ''), 1000) ELSE x.body_template END,
      segment_filters = v_filters,
      event_id = CASE WHEN p_patch ? 'event_id' THEN v_event ELSE x.event_id END,
      sender_name = CASE WHEN p_patch ? 'sender_name' THEN v_sender ELSE x.sender_name END,
      quiet_hours = CASE WHEN p_patch ? 'quiet_hours' THEN COALESCE((p_patch->>'quiet_hours')::boolean, true) ELSE x.quiet_hours END,
      scheduled_at = CASE WHEN p_patch ? 'scheduled_at' THEN NULLIF(p_patch->>'scheduled_at', '')::timestamptz ELSE x.scheduled_at END,
      estimated_recipients = CASE WHEN p_patch ? 'estimated' THEN GREATEST(COALESCE((p_patch->>'estimated')::int, 0), 0) ELSE x.estimated_recipients END,
      segments_per_message = CASE WHEN p_patch ? 'parts' THEN LEAST(GREATEST(COALESCE((p_patch->>'parts')::int, 1), 1), 10) ELSE x.segments_per_message END
     WHERE x.id = v_id;
    UPDATE public.sms_campaigns x SET estimated_credits = x.estimated_recipients * x.segments_per_message WHERE x.id = v_id;
  END IF;
  RETURN jsonb_build_object('id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_sms_save(text, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_sms_save(text, uuid, uuid, jsonb) TO authenticated, service_role;

-- Supprime des brouillons (jamais un SMS parti : il garde ses chiffres).
CREATE OR REPLACE FUNCTION public.crm_sms_delete(p_venue_id text, p_organizer_user_id uuid, p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.sms_campaigns x
   WHERE x.id = ANY (COALESCE(p_ids, '{}'::uuid[])) AND x.status = 'draft'
     AND x.venue_id IS NOT DISTINCT FROM p_venue_id AND x.organizer_id IS NOT DISTINCT FROM p_organizer_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('deleted', v_n);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_sms_delete(text, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_sms_delete(text, uuid, uuid[]) TO authenticated, service_role;

-- Repart d'un SMS (brouillon ou parti) : un nouveau brouillon, sans date.
CREATE OR REPLACE FUNCTION public.crm_sms_duplicate(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_name text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.sms_campaigns%ROWTYPE;
  v_id uuid;
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.sms_campaigns x
   WHERE x.id = p_id AND x.venue_id IS NOT DISTINCT FROM p_venue_id AND x.organizer_id IS NOT DISTINCT FROM p_organizer_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.sms_campaigns (venue_id, organizer_id, created_by, name, body_template, segment_filters, status,
                                    event_id, sender_name, quiet_hours, estimated_recipients, segments_per_message)
  VALUES (c.venue_id, c.organizer_id, auth.uid(), left(COALESCE(NULLIF(btrim(p_name), ''), c.name), 120), c.body_template,
          (COALESCE(c.segment_filters, '{}'::jsonb) - 'segment_id' - 'segment_ids' - 'import_id') || jsonb_build_object('type', 'crm'),
          'draft', c.event_id, c.sender_name, c.quiet_hours, c.estimated_recipients, c.segments_per_message)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_sms_duplicate(text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_sms_duplicate(text, uuid, uuid, text) TO authenticated, service_role;

-- L'ancien moteur refuse un SMS de compte CRM (corps repris de la base).
CREATE OR REPLACE FUNCTION public.enqueue_sms_campaign_recipients(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c        public.sms_campaigns%ROWTYPE;
  v_seg    text;
  v_event  uuid;
  v_import uuid;
  v_segid  uuid;
  v_ids    uuid[];
  v_match  text;
  v_total  integer;
  v_pending integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'enqueue_sms_campaign_recipients: service_role only';
  END IF;
  SELECT * INTO c FROM public.sms_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign not found'; END IF;
  -- Yuno CRM : un SMS d'un compte CRM se compose dans la Console mais ne part
  -- pas par ce moteur tant que les Yunits, la personnalisation et les réglages
  -- d'envoi n'y sont pas branchés (docs/designs/CRM_SMS_PLAN.md). Son audience
  -- (type « crm ») serait lue ici comme « tous les contacts ».
  IF c.segment_filters->>'type' = 'crm'
     OR public.crm_scope_is_crm(public.crm_scope_key(c.venue_id, c.organizer_id)) THEN
    RAISE EXCEPTION 'crm_sms_not_open' USING ERRCODE = 'P0001';
  END IF;

  v_seg    := COALESCE(c.segment_filters->>'type', 'all');
  v_event  := COALESCE(c.event_id, NULLIF(c.segment_filters->>'event_id', '')::uuid);
  v_import := NULLIF(c.segment_filters->>'import_id', '')::uuid;
  v_segid  := CASE WHEN COALESCE(c.segment_filters->>'segment_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   THEN (c.segment_filters->>'segment_id')::uuid END;
  -- Plusieurs segments intelligents : liste + mode (réunir / croiser).
  v_ids := ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(c.segment_filters->'segment_ids') = 'array' THEN c.segment_filters->'segment_ids' ELSE '[]'::jsonb END) x
           WHERE x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  IF cardinality(v_ids) = 0 AND v_segid IS NOT NULL THEN v_ids := ARRAY[v_segid]; END IF;
  v_match := CASE WHEN c.segment_filters->>'match' = 'all' THEN 'all' ELSE 'any' END;

  INSERT INTO public.sms_campaign_recipients (campaign_id, contact_id, user_id, phone_e164, full_name, lang)
  SELECT p_campaign_id, r.contact_id, r.user_id, r.phone_e164, r.full_name,
         COALESCE(pr.preferred_language, 'fr')
    FROM public.resolve_sms_campaign_recipients(c.venue_id, c.organizer_id, v_seg, v_event, v_import, v_segid, v_ids, v_match) r
    LEFT JOIN public.profiles pr ON pr.id = r.user_id
  ON CONFLICT (campaign_id, phone_e164) DO NOTHING;

  SELECT count(*), count(*) FILTER (WHERE status = 'pending')
    INTO v_total, v_pending
    FROM public.sms_campaign_recipients WHERE campaign_id = p_campaign_id;

  UPDATE public.sms_campaigns
     SET total_recipients = v_total, estimated_recipients = v_total
   WHERE id = p_campaign_id;

  RETURN jsonb_build_object('total', v_total, 'pending', v_pending);
END;
$function$;
REVOKE ALL ON FUNCTION public.enqueue_sms_campaign_recipients(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_sms_campaign_recipients(uuid) TO service_role;

-- Aperçu démo : les lectures SMS du CRM créent des tables temporaires.
CREATE OR REPLACE FUNCTION public.demo_preview_writable_rpc(p_name text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT lower(coalesce(p_name, '')) = ANY (ARRAY[
    -- CTA « Activer mon compte » des sessions vitrine (seul canal d'écriture voulu)
    'request_showcase_claim',
    -- mesure d'audience / live view (battements, vues, clics)
    'ping_live_visitor', 'platform_heartbeat', 'track_platform_view',
    'track_links_event', 'ping_affiliate_live', 'flush_affiliate_session',
    'track_guest_artist_click',
    -- parcours client consultable depuis la démo (anti-flood, déverrouillage)
    'check_promo_code', 'unlock_event_sale', 'open_discovery_selection',
    -- écrans de lecture dont le calcul passe par une table temporaire / un cache
    'list_contact_base', 'count_contact_segment_def', 'analyze_contact_lists',
    'check_contact_import', 'get_contact_intelligence_overview',
    'get_contact_segment_panel', 'get_campaign_list_impact',
    'get_dj_audience', 'get_tracked_link_stats', 'get_user_nightlife_stats',
    'seed_event_tracked_links', 'seed_guest_list_tracked_links',
    'seed_venue_tracked_links', 'demo_is_live',
    -- composition d'un email (20260927162000) : rien de tout ça n'envoie
    'save_contact_segments', 'bump_email_template_usage',
    'refresh_contact_engagement', 'refresh_campaign_list_impacts',
    -- Console Yuno CRM : lectures calculées dans des tables temporaires
    'crm_home', 'crm_clients_overview', 'crm_clients_list', 'crm_client',
    'crm_audience_count', 'crm_audience_counts', 'crm_segments_brief',
    'crm_segments_overview', 'crm_segment_detail', 'crm_import_check',
    'crm_email_overview', 'crm_email_campaigns', 'crm_email_analysis',
    'crm_email_result', 'crm_email_result_segments', 'crm_email_recipients',
    'crm_email_recipient_emails', 'crm_email_send_options',
    'crm_email_audience_preview', 'crm_email_audience_sizes',
    'crm_night_detail', 'crm_rules_preview',
    'crm_ana_sales', 'crm_ana_traffic', 'crm_ana_community',
    'crm_journey', 'crm_automations',
    'crm_sms_overview', 'crm_sms_campaigns', 'crm_sms_result', 'crm_sms_analysis',
    'crm_sms_send_options', 'crm_sms_audience_preview', 'crm_sms_settings_get'
  ]::text[]);
$function$;
