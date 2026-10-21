-- Yuno CRM ⇄ Billetterie : un SMS a un produit.
--
-- Constaté le 19-20/10 : sms_campaigns n'a pas de colonne produit ; la marque CRM est
-- segment_filters->>'type' = 'crm'. La Console CRM listait, comptait, dupliquait, programmait et
-- supprimait les SMS de la Billetterie d'un compte à deux produits (et réservait des Yunits pour
-- un SMS Billetterie programmé) ; la liste Billetterie montrait, et laissait réécrire, les SMS du
-- CRM (enfants automatiques des scénarios compris : ouvrir puis enregistrer un brouillon CRM dans
-- l'éditeur Billetterie détruisait son audience). Même principe que email_campaigns.product :
-- NULL = Billetterie / plateforme, 'crm' = Yuno CRM, dérivé par un trigger (jamais choisi par le client).
--
-- À appliquer APRÈS 20261107120000 (contacts : crm_home__core, _crm_admin_rows et _mcp_tool y sont
-- déjà réécrites ; cette migration part de leur texte) et AVANT le front (qui filtre sur la colonne).

DO $guard$
DECLARE r record;
BEGIN
  -- La migration des contacts doit être passée : ces trois fonctions portent son marqueur.
  IF position($m$'crm')$m$ IN (SELECT prosrc FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'crm_home__core')) = 0
     OR position($m$'crm')$m$ IN (SELECT prosrc FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = '_crm_admin_rows')) = 0 THEN
    RAISE EXCEPTION 'appliquer d''abord 20261107120000_crm_billetterie_isolation_contacts.sql';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('_crm_sms_stats', '413e117f60c3162e37c7c8906a674b07'),
    ('crm_sms_campaigns__core', 'cd7c0b8d29cae6a6b46917f131430004'),
    ('crm_sms_overview__core', '424fe0b5b855ac0992f25d93a91e1740'),
    ('crm_sms_result__core', '343608007f0d225b09beba9530c7a992'),
    ('crm_sms_draft_sizes', '4e0c20228c73e02329f499752ff90482'),
    ('crm_sms_duplicate', 'eed64f2443bc32b63c1d6d8ff0dedd32'),
    ('crm_sms_delete', '51dd9bc6f087f91bdcf83283236625e0'),
    ('crm_sms_save', '037ae40fa876f88df1d86bdb85813d58'),
    ('crm_sms_schedule', '296e4a92e23673e4900032f65afeb4d0'),
    ('crm_sms_unschedule', 'f17a0b3310efd1e2130c97c24bb59365'),
    ('sms_campaign_is_crm', 'a48d532c8ad8549f9a6bb89eaf0032d5'),
    ('_crm_ana_sends', 'ed01c76b413ba48274fb4270f4791832'),
    ('_crm_msg_build', '881508ddc1c362d7718de1fdd3b502fc'),
    ('_crm_night_msgs', '359007cd507929cbae17a6d5b1fa1c30'),
    ('crm_weekly_review', '34d144d29e3657c3f30da07dbd69a6f2'),
    ('get_crm_shell', '0135983dcb8ed157fa67cf010e6e54ad'),
    ('get_crm_wallet', 'd200bc6f2145ec39ca2c89faf512be83'),
    ('crm_night_plan', 'dc866c8ed553c19646558eb3ed3d9e9d'),
    ('_crm_admin_daily_core', '0295388464949ba5558791a300d04cc5'),
    ('get_sms_campaign_report', 'b7d095d2d411d87340d28ad2dce3a0da'),
    ('get_sms_contacts_overview', '6828e39f9d001d1a647ffad0869c5830'),
    ('get_sms_sender_readiness', '0427768e5bf1d626a9632c2014e75309')
  ) AS v(name, md5) LOOP
    IF (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.name) IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'public.% a changé depuis l''audit du 20/10 : régénérer la migration depuis pg_get_functiondef', r.name;
    END IF;
  END LOOP;
END $guard$;

-- 1. La colonne ───────────────────────────────────────────────────────────────
ALTER TABLE public.sms_campaigns ADD COLUMN IF NOT EXISTS product text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sms_campaigns_product_check') THEN
    ALTER TABLE public.sms_campaigns ADD CONSTRAINT sms_campaigns_product_check CHECK (product IS NULL OR product = 'crm');
  END IF;
END $$;
COMMENT ON COLUMN public.sms_campaigns.product IS
  'Produit qui a créé le SMS : ''crm'' (Console CRM, scénarios, « Faire revenir ») ou NULL (Billetterie / plateforme). Dérivé par trg_0_sms_campaign_product, jamais choisi par le client.';

-- 2. Le trigger ───────────────────────────────────────────────────────────────
-- Dérivé, jamais saisi : 'crm' si segment_filters->>'type' = 'crm' (tous les écrivains CRM le posent) OU si la
-- portée est un compte CRM PUR (même règle que sms_campaign_is_crm) ; une fois 'crm', toujours 'crm'.
-- SECURITY DEFINER : il appelle crm_scope_is_crm (service_role seul) ; il ne teste PAS current_user,
-- donc il ne peut pas se désactiver lui-même. « trg_0_ » : il passe avant trg_guard_crm_send_frozen
-- et trg_sms_campaigns_updated_at (ordre alphabétique).
CREATE OR REPLACE FUNCTION public.sms_campaign_set_product()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.product = 'crm')
     OR NEW.segment_filters->>'type' = 'crm'
     OR public.crm_scope_is_crm(public.crm_scope_key(NEW.venue_id, NEW.organizer_id)) THEN
    NEW.product := 'crm';
  ELSE
    NEW.product := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.sms_campaign_set_product() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_0_sms_campaign_product ON public.sms_campaigns;
CREATE TRIGGER trg_0_sms_campaign_product
  BEFORE INSERT OR UPDATE OF segment_filters, product ON public.sms_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.sms_campaign_set_product();

-- 3. Le rattrapage ────────────────────────────────────────────────────────────
-- trg_sms_campaigns_updated_at réécrirait updated_at (pastille « brouillons » du CRM, tris) : coupé le temps du rattrapage.
ALTER TABLE public.sms_campaigns DISABLE TRIGGER trg_sms_campaigns_updated_at;
UPDATE public.sms_campaigns
   SET product = 'crm'
 WHERE product IS DISTINCT FROM 'crm'
   AND (segment_filters->>'type' = 'crm'
        OR public.crm_scope_is_crm(public.crm_scope_key(venue_id, organizer_id)));
ALTER TABLE public.sms_campaigns ENABLE TRIGGER trg_sms_campaigns_updated_at;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.sms_campaigns WHERE segment_filters->>'type' = 'crm' AND product IS DISTINCT FROM 'crm';
  IF n > 0 THEN RAISE EXCEPTION '% SMS CRM sans product', n; END IF;
END $$;

-- 4. Les lecteurs et écrivains du CRM ne voient que les SMS du CRM ; get_sms_campaign_report ne rend plus un SMS CRM ────

CREATE OR REPLACE FUNCTION public._crm_sms_stats(p_venue_id text, p_organizer_user_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
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
     AND c.status IN ('sent', 'sending') AND c.sent_at IS NOT NULL
     AND c.product = 'crm';

  DROP TABLE IF EXISTS _csr;
  CREATE TEMP TABLE _csr ON COMMIT DROP AS
  SELECT r.campaign_id, r.phone_e164 AS phone, r.status, r.sent_at, m.email
    FROM public.sms_campaign_recipients r
    JOIN _csc c ON c.id = r.campaign_id
    LEFT JOIN LATERAL (
      SELECT lower(vc.email) AS email FROM public.venue_sms_contacts vc
       WHERE vc.phone_e164 = r.phone_e164 AND vc.email IS NOT NULL
         AND vc.product = 'crm'
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
     AND vc.product = 'crm'
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
           COALESCE((SELECT min(COALESCE(c2.send_started_at, c2.sent_at)) FROM public.sms_campaigns c2
                      WHERE c2.tracked_link_id = c.tracked_link_id AND c2.status IN ('sent', 'sending') AND c2.sent_at IS NOT NULL
                        AND COALESCE(c2.send_started_at, c2.sent_at) > c.start_at), 'infinity'::timestamptz))
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
$function$;
REVOKE ALL ON FUNCTION public._crm_sms_stats(p_venue_id text, p_organizer_user_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_sms_stats(p_venue_id text, p_organizer_user_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_sms_campaigns__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     AND c.status <> 'cancelled' AND c.product = 'crm';
  RETURN jsonb_build_object('campaigns', v);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_sms_campaigns__core(p_venue_id text, p_organizer_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_sms_campaigns__core(p_venue_id text, p_organizer_user_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_sms_overview__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_days integer DEFAULT 30)
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
     AND c.product = 'crm'
     AND (c.status = 'draft' OR (c.status = 'scheduled' AND c.scheduled_at > now() - interval '1 hour'));

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'sent_at') DESC), '[]'::jsonb) INTO v_last FROM (
    SELECT jsonb_build_object('id', id, 'name', name, 'body', body, 'sender_name', sender_name, 'sent_at', sent_at,
             'event_title', (SELECT e.title FROM public.events e WHERE e.id = _css.event_id),
             'n', n, 'delivered', delivered, 'clicked', clicked, 'purchases', purchases, 'revenue', round(revenue, 2)) AS x
      FROM _css ORDER BY sent_at DESC LIMIT 3) z;

  RETURN jsonb_build_object('days', v_days, 'from', v_from, 'to', v_to, 'current', v_cur, 'previous', v_prev,
    'campaigns', v_list, 'upcoming', v_up, 'last', v_last, 'ever_sent', EXISTS (SELECT 1 FROM _css));
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_sms_overview__core(p_venue_id text, p_organizer_user_id uuid, p_days integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_sms_overview__core(p_venue_id text, p_organizer_user_id uuid, p_days integer) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_sms_result__core(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.sms_campaigns%ROWTYPE;
  v_stats jsonb; v_avg jsonb; v_tl jsonb; v_others jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.sms_campaigns x
   WHERE x.id = p_campaign_id AND x.venue_id IS NOT DISTINCT FROM p_venue_id AND x.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
     AND x.product = 'crm';
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
$function$;
REVOKE ALL ON FUNCTION public.crm_sms_result__core(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_sms_result__core(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_sms_draft_sizes(p_venue_id text, p_organizer_user_id uuid, p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.sms_campaigns%ROWTYPE;
  v jsonb := '{}'::jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  FOR c IN
    SELECT * FROM public.sms_campaigns x
     WHERE x.id = ANY (COALESCE(p_ids, '{}'::uuid[]))
       AND x.venue_id IS NOT DISTINCT FROM p_venue_id AND x.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
     AND x.product = 'crm'
     LIMIT 40
  LOOP
    v := v || jsonb_build_object(c.id::text, COALESCE((public.crm_sms_audience_preview(
      p_venue_id, p_organizer_user_id, COALESCE(c.segment_filters->'audiences', '[]'::jsonb), c.event_id,
      NULLIF(c.segment_filters->>'recent_days', '')::integer,
      COALESCE((c.segment_filters->>'exclude_buyers')::boolean, false), c.id)->>'net')::integer, 0));
  END LOOP;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_sms_draft_sizes(p_venue_id text, p_organizer_user_id uuid, p_ids uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_sms_draft_sizes(p_venue_id text, p_organizer_user_id uuid, p_ids uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_sms_duplicate(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.sms_campaigns%ROWTYPE;
  v_id uuid;
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.sms_campaigns x
   WHERE x.id = p_id AND x.venue_id IS NOT DISTINCT FROM p_venue_id AND x.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
     AND x.product = 'crm';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.sms_campaigns (venue_id, organizer_id, created_by, name, body_template, segment_filters, status,
                                    event_id, sender_name, quiet_hours, estimated_recipients, segments_per_message)
  VALUES (c.venue_id, c.organizer_id, auth.uid(), left(COALESCE(NULLIF(btrim(p_name), ''), c.name), 120), c.body_template,
          (COALESCE(c.segment_filters, '{}'::jsonb) - 'segment_id' - 'segment_ids' - 'import_id') || jsonb_build_object('type', 'crm'),
          'draft', c.event_id, c.sender_name, c.quiet_hours, c.estimated_recipients, c.segments_per_message)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_sms_duplicate(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_name text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_sms_duplicate(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_name text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_sms_delete(p_venue_id text, p_organizer_user_id uuid, p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.sms_campaigns x
   WHERE x.id = ANY (COALESCE(p_ids, '{}'::uuid[])) AND x.status = 'draft'
     AND x.venue_id IS NOT DISTINCT FROM p_venue_id AND x.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
     AND x.product = 'crm';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('deleted', v_n);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_sms_delete(p_venue_id text, p_organizer_user_id uuid, p_ids uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_sms_delete(p_venue_id text, p_organizer_user_id uuid, p_ids uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_sms_save(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     WHERE x.id = v_id AND x.venue_id IS NOT DISTINCT FROM p_venue_id AND x.organizer_id IS NOT DISTINCT FROM p_organizer_user_id AND x.product = 'crm'
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
    IF c.status <> 'draft' THEN RAISE EXCEPTION 'not_draft' USING ERRCODE = '22023'; END IF;
  END IF;

  IF p_patch ? 'event_id' AND NULLIF(p_patch->>'event_id', '') IS NOT NULL THEN
    SELECT e.id INTO v_event FROM public.events e
     WHERE e.id = (p_patch->>'event_id')::uuid AND e.external_source IS NOT NULL
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
  -- Le modèle d'origine (« Vos envois » de l'écran Modèles).
  IF p_patch ? 'tpl' THEN
    v_filters := v_filters || jsonb_build_object('tpl', CASE WHEN p_patch->>'tpl' ~ '^[a-z]{2,20}$' THEN p_patch->>'tpl' END);
  END IF;

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
$function$;
REVOKE ALL ON FUNCTION public.crm_sms_save(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_patch jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_sms_save(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_patch jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_sms_schedule(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.sms_campaigns%ROWTYPE;
  v_ready jsonb;
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_at IS NULL OR p_at < now() - interval '1 minute' OR p_at > now() + interval '365 days' THEN
    RAISE EXCEPTION 'bad_date' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public.sms_campaigns x
   WHERE x.id = p_id AND x.venue_id IS NOT DISTINCT FROM p_venue_id AND x.organizer_id IS NOT DISTINCT FROM p_organizer_user_id AND x.product = 'crm'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF c.status <> 'draft' THEN RAISE EXCEPTION 'not_draft' USING ERRCODE = '22023'; END IF;
  IF btrim(COALESCE(c.body_template, '')) = '' THEN RAISE EXCEPTION 'empty_body' USING ERRCODE = '22023'; END IF;
  v_ready := public.get_sms_sender_readiness(p_venue_id, p_organizer_user_id);
  IF NOT COALESCE((v_ready->>'identity_ok')::boolean, false) THEN
    RAISE EXCEPTION 'sms_identity_required' USING ERRCODE = 'P0001';
  END IF;
  IF public.crm_effective_plan(public.crm_scope_key(p_venue_id, p_organizer_user_id)) = 'paused' THEN
    RAISE EXCEPTION 'crm_paused' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.sms_campaigns SET status = 'scheduled', scheduled_at = p_at, error_message = NULL WHERE id = p_id;
  RETURN jsonb_build_object('id', p_id, 'scheduled_at', p_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_sms_schedule(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_at timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_sms_schedule(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_at timestamp with time zone) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_sms_unschedule(p_venue_id text, p_organizer_user_id uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.sms_campaigns SET status = 'draft'
   WHERE id = p_id AND status = 'scheduled'
     AND venue_id IS NOT DISTINCT FROM p_venue_id AND organizer_id IS NOT DISTINCT FROM p_organizer_user_id
     AND product = 'crm';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_n > 0);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_sms_unschedule(p_venue_id text, p_organizer_user_id uuid, p_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_sms_unschedule(p_venue_id text, p_organizer_user_id uuid, p_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sms_campaign_is_crm(p_campaign_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT c.product = 'crm' OR c.segment_filters->>'type' = 'crm'
        OR public.crm_scope_is_crm(public.crm_scope_key(c.venue_id, c.organizer_id))
      FROM public.sms_campaigns c WHERE c.id = p_campaign_id), false);
$function$;
REVOKE ALL ON FUNCTION public.sms_campaign_is_crm(p_campaign_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sms_campaign_is_crm(p_campaign_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._crm_ana_sends(p_venue_id text, p_organizer_user_id uuid, p_meta jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('i', public._crm_ana_bucket(p_meta, c.sent_at), 'at', c.sent_at, 'name', c.name, 'channel', 'email', 'id', c.id) AS x
      FROM public.email_campaigns c
     WHERE c.sent_at IS NOT NULL AND c.status IN ('sent', 'sending')
       AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND public.crm_campaign_is_crm(c.id)
       AND c.sent_at > now() - interval '13 months'
       AND public._crm_ana_bucket(p_meta, c.sent_at) IS NOT NULL
       AND (p_meta->>'mode' <> 'event' OR c.event_id IS NULL OR c.event_id = (p_meta->'event'->>'id')::uuid)
    UNION ALL
    SELECT jsonb_build_object('i', public._crm_ana_bucket(p_meta, s.sent_at), 'at', s.sent_at, 'name', s.name, 'channel', 'sms', 'id', s.id)
      FROM public.sms_campaigns s
     WHERE s.sent_at IS NOT NULL AND s.status IN ('sent', 'sending')
       AND s.venue_id IS NOT DISTINCT FROM p_venue_id AND s.organizer_id IS NOT DISTINCT FROM p_organizer_user_id AND s.product = 'crm'
       AND s.sent_at > now() - interval '13 months'
       AND public._crm_ana_bucket(p_meta, s.sent_at) IS NOT NULL
  ) q;
$function$;
REVOKE ALL ON FUNCTION public._crm_ana_sends(p_venue_id text, p_organizer_user_id uuid, p_meta jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_ana_sends(p_venue_id text, p_organizer_user_id uuid, p_meta jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public._crm_msg_build(p_venue_id text, p_organizer_user_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_hosts text[];
  v_n integer;
BEGIN
  SELECT array_agg(DISTINCT lower(substring(e.external_ticket_url FROM '^https?://([^/:?#]+)')))
    INTO v_hosts
    FROM public.events e
   WHERE e.external_ticket_url IS NOT NULL AND e.external_source IS NOT NULL
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id));

  DROP TABLE IF EXISTS _cmc;
  CREATE TEMP TABLE _cmc ON COMMIT DROP AS
    SELECT c.id, c.name, c.sent_at, c.audiences_json
      FROM public.email_campaigns c
     WHERE c.status IN ('sent', 'sending') AND c.sent_at IS NOT NULL
       AND public.crm_campaign_is_crm(c.id)
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id
       AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;

  -- Clics e-mail de la portée (toutes dates : un clic d'avant la période
  -- peut porter un achat de la période, il reste rattaché à SON envoi).
  DROP TABLE IF EXISTS _cmk;
  CREATE TEMP TABLE _cmk ON COMMIT DROP AS
    SELECT ev.campaign_id, lower(ev.recipient_email) AS email, ev.created_at AS at,
           public._crm_is_ticketing_link(ev.metadata->'click'->>'link', v_hosts) AS ticketing
      FROM public.email_campaign_events ev
      JOIN _cmc c ON c.id = ev.campaign_id
     WHERE ev.event_type = 'clicked' AND ev.recipient_email IS NOT NULL;
  CREATE INDEX ON _cmk (campaign_id, email);
  CREATE INDEX ON _cmk (email, at);

  -- Billets attribués : dernier clic dans les 7 jours avant l'achat.
  DROP TABLE IF EXISTS _cma;
  CREATE TEMP TABLE _cma ON COMMIT DROP AS
    SELECT DISTINCT ON (t.id) t.id, t.email, t.amount, t.bought_at, k.campaign_id
      FROM public._crm_tickets(p_venue_id, p_organizer_user_id) t
      JOIN _cmk k ON k.email = t.email AND k.at <= t.bought_at AND k.at > t.bought_at - interval '7 days'
     ORDER BY t.id, k.at DESC;
  CREATE INDEX ON _cma (campaign_id, email);

  DROP TABLE IF EXISTS _cm0;
  CREATE TEMP TABLE _cm0 ON COMMIT DROP AS
    SELECT r.campaign_id, 'email'::text AS channel, lower(r.email) AS email, c.sent_at,
           EXISTS (SELECT 1 FROM _cmk k WHERE k.campaign_id = r.campaign_id AND k.email = lower(r.email)) AS clicked,
           EXISTS (SELECT 1 FROM _cmk k WHERE k.campaign_id = r.campaign_id AND k.email = lower(r.email) AND k.ticketing) AS ticketing,
           COALESCE((SELECT sum(a.amount) FROM _cma a WHERE a.campaign_id = r.campaign_id AND a.email = lower(r.email)), 0) AS revenue
      FROM public.email_campaign_recipients r
      JOIN _cmc c ON c.id = r.campaign_id
     WHERE r.status IN ('sent', 'complained')
       AND c.sent_at >= p_from AND c.sent_at < p_to;

  -- SMS reçus, rattachés à la personne par son numéro.
  INSERT INTO _cm0 (campaign_id, channel, email, sent_at, clicked, ticketing, revenue)
  SELECT r.campaign_id, 'sms', p.email, COALESCE(s.sent_at, r.sent_at), false, false, 0
    FROM public.sms_campaign_recipients r
    JOIN public.sms_campaigns s ON s.id = r.campaign_id
    JOIN _cp p ON p.phone IS NOT NULL
             AND regexp_replace(p.phone, '\D', '', 'g') = regexp_replace(r.phone_e164, '\D', '', 'g')
   WHERE r.status::text IN ('sent', 'delivered')
     AND s.venue_id IS NOT DISTINCT FROM p_venue_id
     AND s.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
     AND s.product = 'crm'
     AND COALESCE(s.sent_at, r.sent_at) >= p_from AND COALESCE(s.sent_at, r.sent_at) < p_to;

  DROP TABLE IF EXISTS _cm;
  CREATE TEMP TABLE _cm ON COMMIT DROP AS SELECT m.*, m.revenue > 0 AS bought FROM _cm0 m;
  CREATE INDEX ON _cm (email);
  SELECT count(*) INTO v_n FROM _cm;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_msg_build(p_venue_id text, p_organizer_user_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_msg_build(p_venue_id text, p_organizer_user_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) TO service_role;

CREATE OR REPLACE FUNCTION public._crm_night_msgs(p_venue_id text, p_organizer_user_id uuid, p_events uuid[])
 RETURNS TABLE(event_id uuid, id uuid, channel text, name text, state text, at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT c.event_id, c.id, 'email'::text, COALESCE(NULLIF(btrim(c.name), ''), c.subject),
         CASE WHEN c.status = 'draft' THEN 'draft' WHEN c.status = 'scheduled' THEN 'plan' ELSE 'sent' END,
         CASE WHEN c.status = 'draft' THEN c.updated_at WHEN c.status = 'scheduled' THEN c.scheduled_at
              ELSE COALESCE(c.sent_at, c.send_started_at, c.updated_at) END
    FROM public.email_campaigns c
   WHERE c.event_id = ANY (p_events)
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
     AND public.crm_campaign_is_crm(c.id)
     AND c.status IN ('draft', 'scheduled', 'sending', 'sent', 'paused')
  UNION ALL
  SELECT s.event_id, s.id, 'sms', s.name,
         CASE WHEN s.status = 'draft' THEN 'draft' WHEN s.status = 'scheduled' THEN 'plan' ELSE 'sent' END,
         CASE WHEN s.status = 'draft' THEN s.updated_at WHEN s.status = 'scheduled' THEN s.scheduled_at
              ELSE COALESCE(s.sent_at, s.send_started_at, s.updated_at) END
    FROM public.sms_campaigns s
   WHERE s.event_id = ANY (p_events)
     AND s.venue_id IS NOT DISTINCT FROM p_venue_id
     AND s.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
     AND s.product = 'crm'
     AND s.status IN ('draft', 'scheduled', 'sending', 'sent', 'paused');
$function$;
REVOKE ALL ON FUNCTION public._crm_night_msgs(p_venue_id text, p_organizer_user_id uuid, p_events uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_night_msgs(p_venue_id text, p_organizer_user_id uuid, p_events uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_home__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_tz text := 'Europe/Paris';
  v_now timestamptz := now();
  v_hourly boolean := p_period IN ('24h', '48h');
  v_n integer := CASE p_period WHEN '24h' THEN 24 WHEN '48h' THEN 48 WHEN '7d' THEN 7 WHEN '90d' THEN 90 ELSE 30 END;
  v_step interval;
  v_end timestamptz;
  v_start timestamptz;
  v_pstart timestamptz;
  v_rules record;
  cfg jsonb := public.crm_pricing_config();
  v_series jsonb;
  v_sends jsonb;
  v_tot numeric; v_ptot numeric; v_tickets integer; v_ptickets integer;
  v_paid integer; v_ppaid integer; v_free integer; v_pfree integer;
  v_clients jsonb;
  v_regulars jsonb;
  v_conv jsonb;
  v_reach jsonb;
  v_mission jsonb;
  v_next jsonb;
  v_todo jsonb := '[]'::jsonb;
  v_conn record;
  v_has_conn boolean;
  v_ev record;
  v_prev record;
  v_balance integer;
  v_reserved integer;
  v_n_contacts integer;
  v_today_start timestamptz := date_trunc('day', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris';
  v_relaunch integer;
  v_unreach integer;
  v_row record;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);

  SELECT c.* INTO v_conn FROM public.ticketing_connections c
   WHERE (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
      OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id)
   ORDER BY c.created_at LIMIT 1;
  v_has_conn := FOUND;

  -- ── Ventes par heure / par jour ──────────────────────────────────────────
  IF v_hourly THEN
    v_step := interval '1 hour';
    v_end := date_trunc('hour', v_now) + interval '1 hour';
  ELSE
    v_step := interval '1 day';
    v_end := (date_trunc('day', v_now AT TIME ZONE v_tz) + interval '1 day') AT TIME ZONE v_tz;
  END IF;
  v_start := v_end - v_n * v_step;
  v_pstart := v_start - v_n * v_step;

  DROP TABLE IF EXISTS _ht;
  CREATE TEMP TABLE _ht ON COMMIT DROP AS SELECT * FROM public._crm_tickets(p_venue_id, p_organizer_user_id);
  -- Les recherches par personne, par soirée et par période plus bas passent
  -- par un index : sans lui, chaque acheteur relisait tous les billets.
  CREATE INDEX ON _ht (email);
  CREATE INDEX ON _ht (event_id);
  CREATE INDEX ON _ht (bought_at);
  ANALYZE _ht;
  -- Soirées faites (DATA-02) : habitués et historique des acheteurs comptent
  -- comme la liste Clients ; une entrée gratuite non scannée sur une porte
  -- mesurée n'est pas une soirée faite. Les ventes restent lues dans _ht.
  DROP TABLE IF EXISTS _hta;
  CREATE TEMP TABLE _hta ON COMMIT DROP AS
    SELECT x.email, x.event_id, x.event_start
      FROM _ht x
      LEFT JOIN public._crm_measured_doors(p_venue_id, p_organizer_user_id, v_now) d ON d.event_id = x.event_id
     WHERE x.email IS NOT NULL
       AND public._crm_sale_counts_as_night(x.price, x.scanned_at IS NOT NULL, d.event_id IS NOT NULL);
  CREATE INDEX ON _hta (email);
  ANALYZE _hta;

  WITH b AS (
    SELECT g AS i,
           CASE WHEN v_hourly THEN v_start + g * v_step
                ELSE ((v_start AT TIME ZONE v_tz) + g * v_step) AT TIME ZONE v_tz END AS s,
           CASE WHEN v_hourly THEN v_start + (g + 1) * v_step
                ELSE ((v_start AT TIME ZONE v_tz) + (g + 1) * v_step) AT TIME ZONE v_tz END AS e
      FROM generate_series(0, v_n - 1) g
  ), pb AS (
    SELECT i, s - v_n * v_step AS s, e - v_n * v_step AS e FROM b
  )
  SELECT jsonb_agg(jsonb_build_object(
           't', b.s,
           'cur', COALESCE((SELECT round(sum(x.amount), 2) FROM _ht x WHERE x.bought_at >= b.s AND x.bought_at < b.e), 0),
           'prev', COALESCE((SELECT round(sum(x.amount), 2) FROM _ht x WHERE x.bought_at >= pb.s AND x.bought_at < pb.e), 0),
           'tickets', COALESCE((SELECT sum(x.qty) FROM _ht x WHERE x.bought_at >= b.s AND x.bought_at < b.e), 0),
           'paid', COALESCE((SELECT sum(x.qty) FROM _ht x WHERE x.bought_at >= b.s AND x.bought_at < b.e AND COALESCE(x.price, 0) > 0), 0)
         ) ORDER BY b.i)
    INTO v_series
    FROM b JOIN pb ON pb.i = b.i;

  SELECT COALESCE(round(sum(amount) FILTER (WHERE bought_at >= v_start AND bought_at < v_end), 2), 0),
         COALESCE(round(sum(amount) FILTER (WHERE bought_at >= v_pstart AND bought_at < v_start), 2), 0),
         COALESCE(sum(qty) FILTER (WHERE bought_at >= v_start AND bought_at < v_end), 0),
         COALESCE(sum(qty) FILTER (WHERE bought_at >= v_pstart AND bought_at < v_start), 0),
         COALESCE(sum(qty) FILTER (WHERE bought_at >= v_start AND bought_at < v_end AND COALESCE(price, 0) > 0), 0),
         COALESCE(sum(qty) FILTER (WHERE bought_at >= v_pstart AND bought_at < v_start AND COALESCE(price, 0) > 0), 0),
         COALESCE(sum(qty) FILTER (WHERE bought_at >= v_start AND bought_at < v_end AND price = 0), 0),
         COALESCE(sum(qty) FILTER (WHERE bought_at >= v_pstart AND bought_at < v_start AND price = 0), 0)
    INTO v_tot, v_ptot, v_tickets, v_ptickets, v_paid, v_ppaid, v_free, v_pfree
    FROM _ht;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at'), '[]'::jsonb) INTO v_sends FROM (
    SELECT jsonb_build_object('at', c.sent_at, 'name', c.name, 'channel', 'email', 'id', c.id) AS x
      FROM public.email_campaigns c
     WHERE c.sent_at >= v_start AND c.sent_at < v_end AND c.status IN ('sent', 'sending')
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND c.automation_id IS NULL
       AND public.crm_campaign_is_crm(c.id)
    UNION ALL
    SELECT jsonb_build_object('at', s.sent_at, 'name', s.name, 'channel', 'sms', 'id', s.id)
      FROM public.sms_campaigns s
     WHERE s.sent_at >= v_start AND s.sent_at < v_end AND s.status IN ('sent', 'sending')
       AND s.venue_id IS NOT DISTINCT FROM p_venue_id AND s.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
       AND s.product = 'crm'
  ) q;

  -- ── Base vivante : clients et joignables ─────────────────────────────────
  v_n_contacts := public.contact_build_rows(p_venue_id, p_organizer_user_id, 'crm');

  SELECT jsonb_build_object(
           'total', count(*),
           'today', count(*) FILTER (WHERE COALESCE(added_at, created_at) >= v_today_start),
           'spark', (SELECT jsonb_agg(c ORDER BY d) FROM (
              SELECT d, (SELECT count(*) FROM _cr x
                          WHERE COALESCE(x.added_at, x.created_at) < ((date_trunc('day', v_now AT TIME ZONE v_tz) - (13 - d) * interval '1 day' + interval '1 day') AT TIME ZONE v_tz)) AS c
                FROM generate_series(0, 13) d) s)
         ),
         jsonb_build_object(
           'total', count(*),
           'reachable', count(*) FILTER (WHERE email_ok OR phone_ok),
           'both', count(*) FILTER (WHERE email_ok AND phone_ok),
           'email_only', count(*) FILTER (WHERE email_ok AND NOT phone_ok),
           'sms_only', count(*) FILTER (WHERE phone_ok AND NOT email_ok),
           'none', count(*) FILTER (WHERE NOT email_ok AND NOT phone_ok)
         ),
         count(*) FILTER (WHERE eng_status = 'unreachable' OR bounced)
    INTO v_clients, v_reach, v_unreach
    FROM _cr;

  -- ── Habitués : N soirées sur M mois (règle de l'espace) ─────────────────
  WITH snap AS (
    SELECT k,
           CASE WHEN k = 0 THEN v_now
                ELSE (date_trunc('month', v_now AT TIME ZONE v_tz) - (k - 1) * interval '1 month') AT TIME ZONE v_tz END AS at
      FROM generate_series(0, 6) k
  ), cnt AS (
    SELECT s.k, (
      SELECT count(*) FROM (
        SELECT x.email FROM _hta x
         WHERE x.email IS NOT NULL AND x.event_start IS NOT NULL
           AND x.event_start <= s.at AND x.event_start > s.at - make_interval(months => v_rules.regular_window_months)
         GROUP BY x.email HAVING count(DISTINCT x.event_id) >= v_rules.regular_min_nights) q) AS n
      FROM snap s
  )
  SELECT jsonb_build_object(
           'total', (SELECT n FROM cnt WHERE k = 0),
           'month_delta', (SELECT n FROM cnt WHERE k = 0) - (SELECT n FROM cnt WHERE k = 1),
           'bars', (SELECT jsonb_agg(n ORDER BY k DESC) FROM cnt WHERE k BETWEEN 0 AND 5),
           'min_nights', v_rules.regular_min_nights,
           'window_months', v_rules.regular_window_months)
    INTO v_regulars;

  -- ── Conversion des deux derniers envois e-mail (achat < 48 h) ───────────
  WITH last_sends AS (
    SELECT c.id, c.name, c.sent_at
      FROM public.email_campaigns c
     WHERE c.status = 'sent' AND c.sent_at IS NOT NULL AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND public.crm_campaign_is_crm(c.id)
     ORDER BY c.sent_at DESC LIMIT 2
  ), conv AS (
    SELECT l.id, l.name, l.sent_at,
           (SELECT count(*) FROM public.email_campaign_recipients r WHERE r.campaign_id = l.id AND r.status = 'sent') AS recipients,
           (SELECT count(DISTINCT x.email) FROM _ht x
             WHERE x.bought_at >= l.sent_at AND x.bought_at < l.sent_at + interval '48 hours'
               AND x.email IN (SELECT lower(r.email) FROM public.email_campaign_recipients r WHERE r.campaign_id = l.id AND r.status = 'sent')) AS buyers
      FROM last_sends l
  )
  SELECT CASE WHEN count(*) = 0 THEN NULL ELSE jsonb_agg(jsonb_build_object(
           'id', id, 'name', name, 'sent_at', sent_at, 'recipients', recipients, 'buyers', buyers,
           'pct', CASE WHEN recipients > 0 THEN round(buyers::numeric * 100 / recipients, 1) END) ORDER BY sent_at DESC) END
    INTO v_conv
    FROM conv;

  -- ── Bilan du dernier envoi (14 jours) ────────────────────────────────────
  -- Acheteurs et CA = même règle que Résultats, Parcours et Segments
  -- (_crm_email_attrib : un clic dans les 7 jours avant l'achat, le dernier
  -- clic gagne), jamais une fenêtre à part.
  PERFORM public._crm_email_attrib(p_venue_id, p_organizer_user_id);
  SELECT jsonb_build_object(
           'id', c.id, 'name', c.name, 'sent_at', c.sent_at, 'channel', 'email',
           'recipients', (SELECT count(*) FROM public.email_campaign_recipients r WHERE r.campaign_id = c.id AND r.status = 'sent'),
           'clickers', (SELECT count(DISTINCT lower(ev.recipient_email)) FROM public.email_campaign_events ev
                         WHERE ev.campaign_id = c.id AND ev.event_type = 'clicked'),
           'buyers', (SELECT count(DISTINCT a.email) FROM _cma a WHERE a.campaign_id = c.id),
           'revenue', (SELECT COALESCE(round(sum(a.amount), 2), 0) FROM _cma a WHERE a.campaign_id = c.id),
           'yunits', COALESCE((SELECT -sum(m.delta) FROM public.crm_yunit_moves m
                                WHERE m.scope_key = v_scope AND m.kind = 'debit' AND m.ref_type = 'email_campaign' AND m.ref_id = c.id::text),
                              (SELECT count(*) FROM public.email_campaign_recipients r WHERE r.campaign_id = c.id AND r.status = 'sent') * (cfg->'rates'->>'email')::int))
    INTO v_mission
    FROM public.email_campaigns c
   WHERE c.status = 'sent' AND c.sent_at > v_now - interval '14 days' AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND public.crm_campaign_is_crm(c.id)
   ORDER BY c.sent_at DESC LIMIT 1;

  -- ── Prochaine soirée ─────────────────────────────────────────────────────
  SELECT e.id, e.title, e.start_at, e.end_at, COALESCE(NULLIF(e.timezone, ''), v_tz) AS tz,
         x.left_tickets, x.city, x.cancelled_at
    INTO v_ev
    FROM public.events e
    LEFT JOIN public.external_events x ON x.event_id = e.id
   WHERE ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
     AND e.external_source IS NOT NULL
     AND COALESCE(e.end_at, e.start_at + interval '8 hours') > v_now
     AND x.cancelled_at IS NULL
   ORDER BY e.start_at ASC LIMIT 1;

  IF v_ev.id IS NOT NULL THEN
    SELECT e.id, e.title, e.start_at INTO v_prev
      FROM public.events e
     WHERE ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.external_source IS NOT NULL
       AND e.start_at < v_ev.start_at
       AND COALESCE(e.end_at, e.start_at + interval '8 hours') <= v_now
       AND EXISTS (SELECT 1 FROM _ht x WHERE x.event_id = e.id)
     -- Même règle que le volet d'une soirée : la même série d'abord.
     ORDER BY (lower(COALESCE(public._crm_night_series(e.title), e.title))
               = lower(COALESCE(public._crm_night_series(v_ev.title), v_ev.title))) DESC,
              e.start_at DESC LIMIT 1;

    WITH ev_day AS (
      SELECT (v_ev.start_at AT TIME ZONE v_ev.tz)::date AS d0,
             (v_now AT TIME ZONE v_ev.tz)::date AS today
    ), pts AS (
      -- 8 points : de J-7 (par rapport à aujourd'hui) jusqu'à maintenant.
      SELECT k, ((SELECT today FROM ev_day) - (7 - k)) AS day
        FROM generate_series(0, 7) k
    ), cur AS (
      SELECT p.k, p.day,
             ((SELECT d0 FROM ev_day) - p.day) AS jn,
             (SELECT COALESCE(sum(x.qty), 0) FROM _ht x
               WHERE x.event_id = v_ev.id
                 AND x.bought_at < LEAST(v_now, ((p.day + 1)::timestamp AT TIME ZONE v_ev.tz))) AS sold
        FROM pts p
    )
    SELECT jsonb_build_object(
             'id', v_ev.id, 'title', v_ev.title, 'start_at', v_ev.start_at, 'end_at', v_ev.end_at, 'tz', v_ev.tz,
             'city', v_ev.city,
             'sold', (SELECT COALESCE(sum(x.qty), 0) FROM _ht x WHERE x.event_id = v_ev.id),
             'paid', (SELECT COALESCE(sum(x.qty), 0) FROM _ht x WHERE x.event_id = v_ev.id AND COALESCE(x.price, 0) > 0),
             'free', (SELECT COALESCE(sum(x.qty), 0) FROM _ht x WHERE x.event_id = v_ev.id AND x.price = 0),
             'today', (SELECT COALESCE(sum(x.qty), 0) FROM _ht x WHERE x.event_id = v_ev.id
                        AND x.bought_at >= (date_trunc('day', v_now AT TIME ZONE v_ev.tz) AT TIME ZONE v_ev.tz)),
             'left', v_ev.left_tickets,
             'days_to', (SELECT d0 - today FROM ev_day),
             'curve', (SELECT jsonb_agg(jsonb_build_object(
                        'day', c.day, 'jn', c.jn, 'cur', c.sold,
                        'prev', CASE WHEN v_prev.id IS NULL THEN NULL ELSE
                          (SELECT COALESCE(sum(x.qty), 0) FROM _ht x
                            WHERE x.event_id = v_prev.id
                              AND x.bought_at < ((((v_prev.start_at AT TIME ZONE v_ev.tz)::date - c.jn) + 1)::timestamp AT TIME ZONE v_ev.tz)) END
                       ) ORDER BY c.k) FROM cur c),
             'prev', CASE WHEN v_prev.id IS NULL THEN NULL ELSE jsonb_build_object(
                        'id', v_prev.id, 'title', v_prev.title, 'start_at', v_prev.start_at,
                        'final', (SELECT COALESCE(sum(x.qty), 0) FROM _ht x WHERE x.event_id = v_prev.id)) END,
             'buyers', (
               WITH bb AS (
                 SELECT b.email,
                        (SELECT count(DISTINCT y.event_id) FROM _hta y
                          WHERE y.email = b.email AND y.event_start < v_ev.start_at
                            AND y.event_start > v_ev.start_at - make_interval(months => v_rules.regular_window_months)) AS prior_window,
                        (SELECT count(DISTINCT y.event_id) FROM _hta y WHERE y.email = b.email AND y.event_start < v_ev.start_at) AS prior_all,
                        -- Venu avant Shotgun d'après un fichier importé (même règle que _crm_people_build).
                        (f.email IS NOT NULL AND f.f_asof < (SELECT min(y.bought_at) FROM _ht y WHERE y.email = b.email) - interval '2 days') AS file_prior
                   FROM (SELECT DISTINCT x.email FROM _ht x WHERE x.event_id = v_ev.id AND x.email IS NOT NULL) b
                   LEFT JOIN public._crm_file_history(p_venue_id, p_organizer_user_id, NULL) f ON f.email = b.email
               )
               SELECT jsonb_build_object(
                        'total', count(*),
                        'regulars', count(*) FILTER (WHERE prior_window + 1 >= v_rules.regular_min_nights),
                        'new', count(*) FILTER (WHERE prior_all = 0 AND NOT file_prior),
                        'occasional', count(*) FILTER (WHERE (prior_all > 0 OR file_prior) AND prior_window + 1 < v_rules.regular_min_nights))
                 FROM bb)
           )
      INTO v_next;

    -- Habitués joignables qui n'ont pas encore leur place.
    SELECT count(*) INTO v_relaunch FROM (
      SELECT x.email FROM _hta x
       WHERE x.email IS NOT NULL AND x.event_start <= v_now
         AND x.event_start > v_now - make_interval(months => v_rules.regular_window_months)
       GROUP BY x.email HAVING count(DISTINCT x.event_id) >= v_rules.regular_min_nights
    ) reg
    WHERE NOT EXISTS (SELECT 1 FROM _ht y WHERE y.event_id = v_ev.id AND y.email = reg.email)
      AND EXISTS (SELECT 1 FROM _cr c WHERE c.email = reg.email AND c.email_ok);
  END IF;

  -- ── Que faut-il faire aujourd'hui ? ──────────────────────────────────────
  v_balance := public.crm_yunits_balance(v_scope);
  SELECT COALESCE(sum(GREATEST(COALESCE(c.total_recipients, c.recipients_count, 0), 0)), 0)::int
    INTO v_reserved
    FROM public.email_campaigns c
   WHERE c.status = 'scheduled' AND c.scheduled_at > v_now
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND public.crm_campaign_is_crm(c.id);

  IF NOT v_has_conn AND (SELECT count(*) FROM _cr) = 0 THEN
    v_todo := jsonb_build_array(
      jsonb_build_object('id', 'connect', 'kind', 'connect', 'tone', 'todo', 'params', '{}'::jsonb),
      jsonb_build_object('id', 'check', 'kind', 'check', 'tone', 'wait', 'params', '{}'::jsonb),
      jsonb_build_object('id', 'first_send', 'kind', 'first_send', 'tone', 'wait',
                         'params', jsonb_build_object('yunits', v_balance)));
  ELSE
    IF v_ev.id IS NOT NULL AND COALESCE(v_relaunch, 0) > 0 AND (v_next->>'days_to')::int BETWEEN 0 AND 3 THEN
      v_todo := v_todo || jsonb_build_object('id', 'relaunch:' || v_ev.id, 'kind', 'relaunch',
        'tone', CASE WHEN (v_next->>'days_to')::int <= 1 THEN 'todo' ELSE 'warn' END,
        'params', jsonb_build_object('n', v_relaunch, 'event_id', v_ev.id, 'title', v_ev.title,
                                     'days_to', (v_next->>'days_to')::int, 'start_at', v_ev.start_at));
    END IF;

    FOR v_row IN SELECT c.id, c.name, c.scheduled_at, COALESCE(c.total_recipients, c.recipients_count, 0) AS n
               FROM public.email_campaigns c
              WHERE c.status = 'scheduled' AND c.scheduled_at > v_now AND c.scheduled_at < v_now + interval '24 hours'
                AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
                AND public.crm_campaign_is_crm(c.id)
              ORDER BY c.scheduled_at LIMIT 2 LOOP
      v_todo := v_todo || jsonb_build_object('id', 'validate:' || v_row.id, 'kind', 'validate', 'tone', 'todo',
        'params', jsonb_build_object('campaign_id', v_row.id, 'name', v_row.name, 'at', v_row.scheduled_at, 'recipients', v_row.n));
    END LOOP;

    FOR v_row IN SELECT c.id, c.name, c.updated_at
               FROM public.email_campaigns c
              WHERE c.status = 'draft' AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
                AND c.updated_at > v_now - interval '14 days'
                AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
                AND public.crm_campaign_is_crm(c.id)
              ORDER BY c.updated_at DESC LIMIT 1 LOOP
      v_todo := v_todo || jsonb_build_object('id', 'draft:' || v_row.id, 'kind', 'draft', 'tone', 'wait',
        'params', jsonb_build_object('campaign_id', v_row.id, 'name', v_row.name, 'updated_at', v_row.updated_at));
    END LOOP;

    IF v_balance - v_reserved < (cfg->>'low_balance')::int THEN
      v_todo := v_todo || jsonb_build_object('id', 'yunits', 'kind', 'yunits', 'tone', 'warn',
        'params', jsonb_build_object('after', GREATEST(v_balance - v_reserved, 0), 'balance', v_balance,
                                     'reserved', v_reserved, 'sms_rate', (cfg->'rates'->>'sms')::int));
    END IF;

    IF COALESCE(v_unreach, 0) > 0 THEN
      v_todo := v_todo || jsonb_build_object('id', 'contacts', 'kind', 'contacts', 'tone', 'wait',
        'params', jsonb_build_object('n', v_unreach));
    END IF;

    -- Catalogue de segments (20261008200000) : une base d'au moins 10 personnes
    -- et aucun segment à soi → « Choisir vos segments » (la fenêtre du catalogue).
    IF NOT EXISTS (SELECT 1 FROM public.crm_segments s WHERE s.scope_key = v_scope)
       AND COALESCE(v_n_contacts, 0) >= 10 THEN
      v_todo := v_todo || jsonb_build_object('id', 'segments', 'kind', 'segments', 'tone', 'wait', 'params', '{}'::jsonb);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'now', v_now,
    'tz', v_tz,
    'connection', CASE WHEN v_has_conn THEN jsonb_build_object(
        'provider', v_conn.provider, 'status', v_conn.status, 'last_ok_at', v_conn.last_ok_at,
        'last_error_at', v_conn.last_error_at,
        'broken', v_conn.status = 'token_invalid'
                  OR (v_conn.last_error_at IS NOT NULL AND (v_conn.last_ok_at IS NULL OR v_conn.last_error_at > v_conn.last_ok_at) AND v_conn.fail_count >= 3),
        'broken_since', COALESCE(v_conn.last_ok_at, v_conn.last_error_at)) END,
    'sales', jsonb_build_object(
        'period', p_period, 'hourly', v_hourly, 'n', v_n, 'start', v_start, 'end', v_end,
        'series', COALESCE(v_series, '[]'::jsonb), 'total', v_tot, 'prev_total', v_ptot,
        'tickets', v_tickets, 'prev_tickets', v_ptickets,
        'paid_tickets', v_paid, 'prev_paid_tickets', v_ppaid,
        'free_tickets', v_free, 'prev_free_tickets', v_pfree, 'sends', v_sends,
        'has_any', EXISTS (SELECT 1 FROM _ht)),
    'kpi', jsonb_build_object('clients', v_clients, 'regulars', v_regulars, 'conversion', v_conv, 'reach', v_reach),
    'mission', v_mission,
    'next', v_next,
    'todo', v_todo,
    'wallet', jsonb_build_object('balance', v_balance, 'reserved', v_reserved)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_home__core(p_venue_id text, p_organizer_user_id uuid, p_period text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_home__core(p_venue_id text, p_organizer_user_id uuid, p_period text) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_weekly_review(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key      text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_to       timestamptz := (date_trunc('week', now() AT TIME ZONE 'Europe/Paris')) AT TIME ZONE 'Europe/Paris';
  v_from     timestamptz := v_to - interval '7 days';
  v_mail     record;
  v_sms      record;
  v_scn_msgs integer;
  v_recipes  integer;
  v_hold     jsonb;
  v_measured jsonb;
  v_scns     jsonb;
  v_drift    jsonb := '[]'::jsonb;
  v_actions  jsonb := '[]'::jsonb;
  v_next     record;
  v_prev     record;
  v_sold     integer;
  v_same     integer;
  v_j        record;
  v_active   integer;
  v_recipes_on integer;
  v_loss     jsonb;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- ── Activité de la semaine ────────────────────────────────────────────────
  SELECT count(*)::int AS campaigns,
         COALESCE(sum(COALESCE(c.recipients_count, c.total_recipients, 0)), 0)::int AS sent,
         COALESCE(sum(COALESCE(c.bounced_count, 0)), 0)::int AS bounced,
         COALESCE(sum(COALESCE(c.complained_count, 0)), 0)::int AS complained,
         COALESCE(sum(COALESCE(c.policy_skipped_count, 0)), 0)::int AS protected
    INTO v_mail
    FROM public.email_campaigns c
   WHERE c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND (p_venue_id IS NOT NULL OR c.organizer_user_id = p_organizer_user_id)
     AND c.sent_at >= v_from AND c.sent_at < v_to AND c.status IN ('sent', 'sending')
     AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL AND c.child_kind IS NULL
     AND public.crm_campaign_is_crm(c.id);
  SELECT count(*)::int AS campaigns, COALESCE(sum(COALESCE(c.sent_count, 0)), 0)::int AS sent
    INTO v_sms
    FROM public.sms_campaigns c
   WHERE c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND (p_venue_id IS NOT NULL OR c.organizer_id = p_organizer_user_id)
     AND c.product = 'crm'
     AND c.sent_at >= v_from AND c.sent_at < v_to;
  SELECT count(*)::int INTO v_scn_msgs
    FROM public.crm_scenario_steps st JOIN public.crm_scenarios s ON s.id = st.scenario_id
   WHERE s.scope_key = v_key AND st.status = 'sent' AND st.done_at >= v_from AND st.done_at < v_to;
  SELECT count(*)::int INTO v_recipes
    FROM public.email_automation_sends l
   WHERE l.venue_id IS NOT DISTINCT FROM p_venue_id
     AND (p_venue_id IS NOT NULL OR l.organizer_user_id = p_organizer_user_id)
     AND l.status = 'queued' AND l.created_at >= v_from AND l.created_at < v_to
     AND EXISTS (SELECT 1 FROM public.email_automations a WHERE a.id = l.automation_id AND a.product = 'crm');

  -- ── Mesuré par le témoin ──────────────────────────────────────────────────
  -- Les envois dont la soirée a eu lieu cette semaine, avec une mesure (10
  -- personnes au moins de chaque côté).
  v_hold := public.crm_holdout_overview(p_venue_id, p_organizer_user_id, 60);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'channel', x->>'channel', 'id', x->>'id', 'label', x->>'label', 'event_id', x->>'event_id', 'event', e.title,
           'contacted', x->'contacted', 'control', x->'control', 'extra', x->'extra', 'z', x->'z',
           'verdict', CASE WHEN (x->>'z')::numeric >= 2 THEN 'gain' WHEN (x->>'z')::numeric <= -2 THEN 'loss' ELSE 'none' END)
           ORDER BY COALESCE((x->>'z')::numeric, 0) DESC), '[]'::jsonb)
    INTO v_measured
    FROM jsonb_array_elements(v_hold->'sends') x
    JOIN public.events e ON e.id = (x->>'event_id')::uuid
   WHERE x->>'event_id' IS NOT NULL AND x->'extra' IS NOT NULL AND jsonb_typeof(x->'extra') = 'number'
     AND e.start_at >= v_from AND e.start_at < v_to;
  -- Les scénarios en ligne ou en pause au verdict net (mesure cumulée).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'status', s.status, 'measure', m.j,
           'verdict', CASE WHEN (m.j->>'z')::numeric >= 2 THEN 'gain' ELSE 'loss' END)
           ORDER BY (m.j->>'z')::numeric DESC), '[]'::jsonb)
    INTO v_scns
    FROM public.crm_scenarios s
    CROSS JOIN LATERAL (SELECT public._crm_scenario_holdout(s.id) AS j) m
   WHERE s.scope_key = v_key AND s.status IN ('active', 'paused')
     AND COALESCE((m.j->>'done')::boolean, false) AND jsonb_typeof(m.j->'z') = 'number'
     AND abs((m.j->>'z')::numeric) >= 2;

  -- ── Ce qui dérive ─────────────────────────────────────────────────────────
  -- Rythme : la prochaine soirée (21 jours) contre l'édition précédente au même moment.
  SELECT ev.id, ev.title, ev.start_at INTO v_next FROM public.events ev
   WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL AND ev.start_at > now() AND ev.start_at < now() + interval '21 days'
     AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id) OR (p_venue_id IS NULL AND ev.organizer_user_id = p_organizer_user_id))
   ORDER BY ev.start_at LIMIT 1;
  IF v_next.id IS NOT NULL THEN
    SELECT ev.id, ev.title, ev.start_at INTO v_prev FROM public.events ev
     WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL AND ev.id <> v_next.id AND ev.start_at < now()
       AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id) OR (p_venue_id IS NULL AND ev.organizer_user_id = p_organizer_user_id))
     ORDER BY (lower(public._crm_night_series(ev.title)) = lower(public._crm_night_series(v_next.title))) DESC, ev.start_at DESC
     LIMIT 1;
    SELECT COALESCE(sum(COALESCE(t.quantity, 1)), 0)::int INTO v_sold FROM public.external_tickets t
     WHERE t.event_id = v_next.id AND public._crm_ticket_is_sale(t.status, t.deal_channel);
    IF v_prev.id IS NOT NULL THEN
      SELECT COALESCE(sum(COALESCE(t.quantity, 1)), 0)::int INTO v_same FROM public.external_tickets t
       WHERE t.event_id = v_prev.id AND public._crm_ticket_is_sale(t.status, t.deal_channel)
         AND COALESCE(t.purchased_at, t.first_seen_at) <= v_prev.start_at - (v_next.start_at - now());
      IF v_same >= 20 AND v_sold < 0.85 * v_same THEN
        v_drift := v_drift || jsonb_build_object('kind', 'pace', 'event_id', v_next.id, 'title', v_next.title, 'start_at', v_next.start_at,
          'sold', v_sold, 'prev_title', v_prev.title, 'prev_sold', v_same);
      END IF;
    END IF;
  END IF;
  -- Délivrabilité de la semaine (200 envois au moins pour juger).
  IF v_mail.sent >= 200 AND (v_mail.bounced > 0.03 * v_mail.sent OR v_mail.complained > 0.001 * v_mail.sent) THEN
    v_drift := v_drift || jsonb_build_object('kind', 'deliverability', 'sent', v_mail.sent, 'bounced', v_mail.bounced, 'complained', v_mail.complained);
  END IF;
  -- Une part grandissante de la base protégée par les règles d'envoi (fatigue, pression).
  IF v_mail.sent + v_mail.protected >= 200 AND v_mail.protected > 0.15 * (v_mail.sent + v_mail.protected) THEN
    v_drift := v_drift || jsonb_build_object('kind', 'protected', 'protected', v_mail.protected, 'reached', v_mail.sent);
  END IF;
  -- Journal prévu / réel : la dernière soirée réglée cette semaine, écart > 15 %.
  SELECT r.title, r.start_at, (r.metrics->'projection'->>'predicted')::numeric AS predicted,
         (r.metrics->'projection'->>'actual')::numeric AS actual, (r.metrics->'projection'->>'err')::numeric AS err
    INTO v_j
    FROM public.crm_prediction_results r
   WHERE r.scope_key = v_key AND r.horizon = 'd7' AND r.settled_at >= v_from AND r.settled_at < v_to
     AND r.metrics->'projection'->>'err' IS NOT NULL
   ORDER BY r.start_at DESC LIMIT 1;
  IF v_j.title IS NOT NULL AND v_j.err > 0.15 THEN
    v_drift := v_drift || jsonb_build_object('kind', 'journal', 'title', v_j.title, 'start_at', v_j.start_at,
      'predicted', round(v_j.predicted), 'actual', round(v_j.actual), 'err_pct', round(v_j.err * 100));
  END IF;

  -- ── 1 à 3 actions, chacune avec l'écran qui la prépare ───────────────────
  SELECT count(*) FILTER (WHERE s.status = 'active')::int INTO v_active FROM public.crm_scenarios s WHERE s.scope_key = v_key;
  SELECT count(*)::int INTO v_recipes_on FROM public.email_automations a
   WHERE a.enabled AND a.product = 'crm' AND a.venue_id IS NOT DISTINCT FROM p_venue_id AND (p_venue_id IS NOT NULL OR a.organizer_user_id = p_organizer_user_id);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_drift) d WHERE d->>'kind' = 'pace') THEN
    v_actions := v_actions || jsonb_build_object('kind', 'targets', 'event_id', v_next.id, 'title', v_next.title, 'start_at', v_next.start_at);
  END IF;
  IF v_next.id IS NOT NULL AND v_next.start_at < now() + interval '14 days' THEN
    v_actions := v_actions || jsonb_build_object('kind', 'plan', 'event_id', v_next.id, 'title', v_next.title, 'start_at', v_next.start_at);
  END IF;
  SELECT x INTO v_loss FROM jsonb_array_elements(v_scns) x WHERE x->>'verdict' = 'loss' LIMIT 1;
  IF v_loss IS NOT NULL THEN
    v_actions := v_actions || jsonb_build_object('kind', 'scenario', 'id', v_loss->>'id', 'name', v_loss->>'name');
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_drift) d WHERE d->>'kind' IN ('deliverability', 'protected')) THEN
    v_actions := v_actions || jsonb_build_object('kind', 'base');
  END IF;
  IF v_active = 0 AND v_recipes_on = 0 THEN
    v_actions := v_actions || jsonb_build_object('kind', 'automate');
  END IF;
  SELECT COALESCE(jsonb_agg(a ORDER BY o), '[]'::jsonb) INTO v_actions
    FROM jsonb_array_elements(v_actions) WITH ORDINALITY AS z(a, o) WHERE o <= 3;

  RETURN jsonb_build_object(
    'ok', true,
    'from', v_from, 'to', v_to - interval '1 second',
    'activity', jsonb_build_object('emails', v_mail.sent, 'email_campaigns', v_mail.campaigns, 'sms', v_sms.sent, 'sms_campaigns', v_sms.campaigns,
                                   'scenario_messages', v_scn_msgs, 'recipe_messages', v_recipes, 'protected', v_mail.protected),
    'measured', v_measured,
    'scenarios', v_scns,
    'drift', v_drift,
    'actions', v_actions,
    'holdout_pct', v_hold->'pct',
    'quiet', v_mail.sent + v_sms.sent + v_scn_msgs + v_recipes = 0 AND jsonb_array_length(v_measured) = 0 AND v_next.id IS NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_weekly_review(p_venue_id text, p_organizer_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_weekly_review(p_venue_id text, p_organizer_user_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_crm_shell(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
             AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
             AND public.crm_campaign_is_crm(c.id))
       + (SELECT count(*) FROM public.sms_campaigns s
           WHERE s.status = 'draft' AND s.updated_at > now() - interval '30 days'
             AND s.venue_id IS NOT DISTINCT FROM p_venue_id
             AND s.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
             AND s.product = 'crm')
    INTO v_drafts;

  -- Contacts à corriger : adresse qui rebondit ou injoignable.
  SELECT count(*) INTO v_unreachable
    FROM public.contact_engagement e
   WHERE e.scope_key = public.contact_base_scope_key(p_venue_id, p_organizer_user_id) || '|crm' AND e.status = 'unreachable';

  -- Notifications CRM de la personne : à faire non reportées + non lues.
  SELECT count(*) INTO v_unread
    FROM jsonb_array_elements(public._crm_notif_list(p_venue_id, p_organizer_user_id, auth.uid(), false)) x
   WHERE NOT (x->>'archived')::boolean AND x->>'snoozed_until' IS NULL
     AND ((x->>'need')::boolean OR NOT (x->>'read')::boolean);

  v_balance := public.crm_yunits_balance(v_scope);
  SELECT COALESCE(sum(public._crm_campaign_estimate(c.id)), 0)::int * (cfg->'rates'->>'email')::int
    INTO v_reserved
    FROM public.email_campaigns c
   WHERE c.status = 'scheduled' AND c.scheduled_at > now() AND public.crm_campaign_is_crm(c.id)
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
$function$;
REVOKE ALL ON FUNCTION public.get_crm_shell(p_venue_id text, p_organizer_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_crm_shell(p_venue_id text, p_organizer_user_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_crm_wallet(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  cfg jsonb := public.crm_pricing_config();
  v_balance integer;
  v_lots jsonb;
  v_moves jsonb;
  v_credits jsonb;
  v_reserved jsonb;
  v_reserved_total integer;
  v_spent_month integer;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_balance := public.crm_yunits_balance(v_scope);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', k, 'remaining', rem, 'expires_at', exp) ORDER BY exp NULLS LAST), '[]'::jsonb)
    INTO v_lots
    FROM (
      SELECT CASE WHEN kind IN ('purchase', 'refund') THEN 'purchase'
                  WHEN kind IN ('grant', 'annual_bonus') THEN 'bonus'
                  ELSE kind END AS k,
             sum(remaining)::int AS rem, min(expires_at) AS exp
        FROM public.crm_yunit_lots
       WHERE scope_key = v_scope AND remaining > 0 AND (expires_at IS NULL OR expires_at > now())
       GROUP BY 1
    ) q;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('at', at, 'delta', delta, 'kind', kind, 'lot_kind', lot_kind,
                                               'channel', channel, 'label', label, 'ref_type', ref_type, 'ref_id', ref_id,
                                               'meta', meta) ORDER BY at DESC), '[]'::jsonb)
    INTO v_moves
    FROM (SELECT * FROM public.crm_yunit_moves WHERE scope_key = v_scope ORDER BY at DESC LIMIT 30) m;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('at', at, 'delta', delta, 'lot_kind', lot_kind, 'label', label, 'meta', meta)
                            ORDER BY at DESC), '[]'::jsonb)
    INTO v_credits
    FROM (SELECT * FROM public.crm_yunit_moves
           WHERE scope_key = v_scope AND kind = 'credit' ORDER BY at DESC LIMIT 20) c;

  WITH sched AS (
    SELECT c.id::text AS id, c.name, 'email'::text AS channel, c.scheduled_at AS at,
           public._crm_campaign_estimate(c.id) * (cfg->'rates'->>'email')::int AS cost
      FROM public.email_campaigns c
     WHERE c.status = 'scheduled' AND c.scheduled_at > now()
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND public.crm_campaign_is_crm(c.id)
    UNION ALL
    SELECT s.id::text, s.name, 'sms', s.scheduled_at,
           GREATEST(COALESCE(s.estimated_recipients, 0), 0) * GREATEST(COALESCE(s.segments_per_message, 1), 1) * (cfg->'rates'->>'sms')::int
      FROM public.sms_campaigns s
     WHERE s.status = 'scheduled' AND s.scheduled_at > now()
       AND s.venue_id IS NOT DISTINCT FROM p_venue_id AND s.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
       AND s.product = 'crm'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'channel', channel, 'at', at, 'cost', cost) ORDER BY at), '[]'::jsonb),
         COALESCE(sum(cost), 0)::int
    INTO v_reserved, v_reserved_total
    FROM sched;

  SELECT COALESCE(-sum(delta), 0)::int INTO v_spent_month
    FROM public.crm_yunit_moves
   WHERE scope_key = v_scope AND kind = 'debit'
     AND at >= date_trunc('month', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris';

  RETURN jsonb_build_object(
    'balance', v_balance, 'lots', v_lots, 'moves', v_moves, 'credits', v_credits,
    'reserved', v_reserved, 'reserved_total', v_reserved_total, 'spent_month', v_spent_month,
    'low_balance', (cfg->>'low_balance')::int, 'rates', cfg->'rates', 'channels_live', cfg->'channels_live');
END;
$function$;
REVOKE ALL ON FUNCTION public.get_crm_wallet(p_venue_id text, p_organizer_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_crm_wallet(p_venue_id text, p_organizer_user_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_night_plan(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key     text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_ev      uuid := p_event_id;
  v_t       jsonb;
  v_rates   jsonb := COALESCE(public.crm_pricing_config()->'rates', '{}'::jsonb);
  v_re      integer;
  v_rs      integer;
  v_sms_ok  boolean;
  v_steps   jsonb;
  v_tot     jsonb;
  v_bal     integer;
  e         record;
  v_prev    record;
  v_pace    jsonb;
  v_sold    integer;
  v_planned jsonb;
  v_fams    jsonb;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Sans soirée désignée : la prochaine du compte.
  IF v_ev IS NULL THEN
    SELECT ev.id INTO v_ev FROM public.events ev
     WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
         OR (p_venue_id IS NULL AND p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
       AND COALESCE(ev.end_at, ev.start_at + interval '6 hours') > now()
     ORDER BY ev.start_at LIMIT 1;
    IF v_ev IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_upcoming'); END IF;
  END IF;

  -- « Qui cibler » : même porte, mêmes audiences, mêmes moments.
  v_t := public.crm_night_targets(p_venue_id, p_organizer_user_id, v_ev);
  IF NOT COALESCE((v_t->>'ok')::boolean, false) THEN RETURN v_t; END IF;

  v_re := GREATEST(1, COALESCE((v_rates->>'email')::integer, 1));
  v_rs := GREATEST(1, COALESCE((v_rates->>'sms')::integer, 35));
  -- Un SMS ne part qu'avec l'identité légale de l'expéditeur : sinon, e-mail.
  v_sms_ok := COALESCE((public.get_sms_sender_readiness(p_venue_id, p_organizer_user_id)->>'identity_ok')::boolean, false);

  -- Les étapes : chaque personne compte UNE fois, dans la première audience
  -- (ordre conseillé) qui la contient ; groupées par moment.
  WITH r AS (
    SELECT a.aud, a.rk, a.moment, a.mord FROM _nta a WHERE a.rk IS NOT NULL
  ), f AS (
    SELECT DISTINCT ON (g.email) g.email, r.aud FROM _ntg g JOIN r ON r.aud = g.aud ORDER BY g.email, r.rk
  ), c AS (
    SELECT f.aud, count(*)::int AS n, count(*) FILTER (WHERE p.email_ok)::int AS ne, count(*) FILTER (WHERE p.phone_ok)::int AS ns
      FROM f LEFT JOIN _cp p ON p.email = f.email GROUP BY f.aud
  ), a AS (
    SELECT r.aud, r.rk, r.moment, r.mord, COALESCE(c.n, 0) AS n, COALESCE(c.ne, 0) AS ne, COALESCE(c.ns, 0) AS ns, x.j
      FROM r LEFT JOIN c ON c.aud = r.aud
      CROSS JOIN LATERAL (SELECT j FROM jsonb_array_elements(v_t->'audiences') j WHERE j->>'key' = r.aud LIMIT 1) x
  ), st AS (
    SELECT a.moment, min(a.mord) AS mord, min((a.j->>'send_at')::timestamptz) AS send_at,
           sum(a.n)::int AS people, sum(a.ne)::int AS email, sum(a.ns)::int AS sms,
           jsonb_agg(a.j || jsonb_build_object('first_n', a.n, 'first_email', a.ne, 'first_sms', a.ns,
                                               'audience_id', 'target:' || v_ev::text || ':' || a.aud) ORDER BY a.rk) AS auds
      FROM a GROUP BY a.moment
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'moment', st.moment, 'send_at', st.send_at, 'people', st.people, 'email', st.email, 'sms', st.sms,
           -- La veille : SMS si l'identité est prête et que l'étape a des numéros ; sinon e-mail.
           'channel', CASE WHEN st.moment = 'eve' AND v_sms_ok AND st.sms > 0 THEN 'sms' ELSE 'email' END,
           'cost_email', st.email * v_re, 'cost_sms', st.sms * v_rs,
           'audiences', st.auds) ORDER BY st.mord), '[]'::jsonb)
    INTO v_steps FROM st;

  v_bal := COALESCE(public.crm_yunits_balance(v_key), 0);
  SELECT jsonb_build_object(
           'people', COALESCE(sum((s->>'people')::int), 0),
           'email', COALESCE(sum((s->>'email')::int), 0),
           'sms', COALESCE(sum((s->>'sms')::int), 0),
           'cost', COALESCE(sum(CASE WHEN s->>'channel' = 'sms' THEN (s->>'cost_sms')::int ELSE (s->>'cost_email')::int END), 0),
           'balance', v_bal)
    INTO v_tot FROM jsonb_array_elements(v_steps) s;
  v_tot := v_tot || jsonb_build_object('enough', v_bal >= (v_tot->>'cost')::int);

  -- Le rythme : billets vendus maintenant contre l'édition précédente au même
  -- moment avant sa soirée (même série d'abord, sinon la soirée d'avant).
  SELECT ev.id, ev.title, ev.start_at INTO e FROM public.events ev WHERE ev.id = v_ev;
  SELECT COALESCE(sum(COALESCE(t.quantity, 1)), 0)::int INTO v_sold
    FROM public.external_tickets t WHERE t.event_id = v_ev AND public._crm_ticket_is_sale(t.status, t.deal_channel);
  SELECT ev.id, ev.title, ev.start_at,
         lower(public._crm_night_series(ev.title)) = lower(public._crm_night_series(e.title)) AS same_series
    INTO v_prev
    FROM public.events ev
   WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL AND ev.id <> v_ev
     AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
       OR (p_venue_id IS NULL AND p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
     AND ev.start_at < now()
   ORDER BY (lower(public._crm_night_series(ev.title)) = lower(public._crm_night_series(e.title))) DESC, ev.start_at DESC
   LIMIT 1;
  v_pace := jsonb_build_object('sold', v_sold);
  IF v_prev.id IS NOT NULL THEN
    v_pace := v_pace || jsonb_build_object('prev', jsonb_build_object(
      'id', v_prev.id, 'title', v_prev.title, 'start_at', v_prev.start_at, 'same_series', v_prev.same_series,
      'sold_same', (SELECT COALESCE(sum(COALESCE(t.quantity, 1)), 0)::int FROM public.external_tickets t
                     WHERE t.event_id = v_prev.id AND public._crm_ticket_is_sale(t.status, t.deal_channel)
                       AND COALESCE(t.purchased_at, t.first_seen_at) <= v_prev.start_at - (e.start_at - now())),
      'total', (SELECT COALESCE(sum(COALESCE(t.quantity, 1)), 0)::int FROM public.external_tickets t
                 WHERE t.event_id = v_prev.id AND public._crm_ticket_is_sale(t.status, t.deal_channel))));
  END IF;

  -- Ce qui est déjà prévu pour cette soirée (campagnes faites à la main ;
  -- les envois des automatisations et des scénarios ont leurs propres écrans).
  SELECT jsonb_build_object(
    'emails', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status,
                                 'at', COALESCE(c.sent_at, c.scheduled_at, c.updated_at),
                                 'recipients', COALESCE(c.total_recipients, c.recipients_count)) ORDER BY COALESCE(c.sent_at, c.scheduled_at, c.updated_at))
                          FROM public.email_campaigns c
                         WHERE c.event_id = v_ev AND c.automation_id IS NULL AND c.child_kind IS NULL AND c.parent_campaign_id IS NULL
                           AND c.status IN ('draft', 'scheduled', 'sending', 'paused', 'sent')
                           AND public.crm_campaign_is_crm(c.id)
                           AND c.venue_id IS NOT DISTINCT FROM p_venue_id
                           AND (p_venue_id IS NOT NULL OR c.organizer_user_id = p_organizer_user_id)), '[]'::jsonb),
    'sms', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status,
                              'at', COALESCE(c.sent_at, c.scheduled_at, c.updated_at),
                              'recipients', COALESCE(c.total_recipients, c.estimated_recipients)) ORDER BY COALESCE(c.sent_at, c.scheduled_at, c.updated_at))
                       FROM public.sms_campaigns c
                      WHERE c.event_id = v_ev
                        AND c.status IN ('draft', 'scheduled', 'sending', 'paused', 'sent')
                        AND c.venue_id IS NOT DISTINCT FROM p_venue_id
                        AND (p_venue_id IS NOT NULL OR c.organizer_id = p_organizer_user_id)
                        AND c.product = 'crm'), '[]'::jsonb))
    INTO v_planned;

  -- Familles d'hypothèses CONFIRMÉES sur le compte (même règle que les scénarios).
  SELECT COALESCE(jsonb_agg(f.fam ORDER BY f.o), '[]'::jsonb) INTO v_fams
    FROM unnest(ARRAY['artist', 'genre', 'format', 'slot', 'weekday', 'place', 'series', 'early', 'launch', 'last_minute',
                      'door', 'group', 'table', 'discovery', 'passing', 'invited', 'group_first', 'brought', 'channel'])
         WITH ORDINALITY AS f(fam, o)
   WHERE public._crm_family_confirmed(v_key, f.fam);

  RETURN jsonb_build_object(
    'ok', true,
    'event', v_t->'event', 'days_left', v_t->'days_left', 'computed', v_t->'computed',
    'has_ticket', v_t->'has_ticket', 'score', v_t->'score', 'union', v_t->'union',
    'steps', v_steps, 'totals', v_tot, 'pace', v_pace, 'planned', v_planned,
    'holdout_pct', public.crm_holdout_pct(v_key),
    'families', v_fams,
    'rates', jsonb_build_object('email', v_re, 'sms', v_rs),
    'sms_ready', v_sms_ok);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_night_plan(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_night_plan(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._crm_admin_rows(p_include_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg jsonb := public.crm_pricing_config();
  v_demo_v text[] := public.demo_venue_ids();
  v_out jsonb;
BEGIN
  WITH sc AS MATERIALIZED (
    SELECT 'venue:' || v.id AS scope_key, 'venue'::text AS kind, v.id AS venue_id, NULL::uuid AS org_id,
           v.name::text AS name, v.city::text AS city, v.owner_id AS owner_id, v.created_at,
           false AS association
      FROM public.venues v
     WHERE (v.product = 'crm' OR 'crm' = ANY(COALESCE(v.extra_products, '{}'::text[]))) AND v.decommissioned_at IS NULL
    UNION ALL
    SELECT 'org:' || o.user_id, 'org', NULL, o.user_id,
           COALESCE(NULLIF(o.display_name, ''), p.organization_name, 'Organisation')::text, o.city::text, o.user_id,
           o.created_at, COALESCE(o.bde_verified, false)
      FROM public.organizer_profiles o
      JOIN public.profiles p ON p.id = o.user_id
     WHERE (o.product = 'crm' OR 'crm' = ANY(COALESCE(o.extra_products, '{}'::text[])))
  ), base AS MATERIALIZED (
    SELECT sc.*, pr.email AS owner_email, NULLIF(trim(concat_ws(' ', pr.first_name, pr.last_name)), '') AS owner_name,
           pr.phone AS owner_phone, u.last_sign_in_at,
           (public.is_demo_email(pr.email) OR (sc.venue_id IS NOT NULL AND sc.venue_id = ANY(v_demo_v))) AS is_demo
      FROM sc
      LEFT JOIN public.profiles pr ON pr.id = sc.owner_id
      LEFT JOIN auth.users u ON u.id = sc.owner_id
  ), rows AS (
    SELECT b.*,
           s.status AS sub_status, s.billing_interval, COALESCE(s.founder, false) AS founder, s.trial_ends_at,
           s.current_period_end, COALESCE(s.cancel_at_period_end, false) AS cancel_at_end,
           s.stripe_subscription_id, s.created_at AS sub_created,
           st.business_type, st.sending_frozen_at, st.sending_frozen_reason, st.deletion_requested_at,
           cn.provider AS conn_provider, cn.status AS conn_status, cn.last_ok_at, cn.last_error_at, cn.last_error,
           cn.initial_import_done_at, cn.fail_count, (cn.id IS NOT NULL) AS has_conn,
           public.crm_yunits_balance(b.scope_key) AS balance,
           ct.n AS contacts, ct.reach,
           se.sends30, se.last_send_at,
           pu.n AS buys, pu.eur AS buys_eur, pu.last_at AS last_buy_at,
           ob.imports, ob.send_settings, ob.recipes, ob.team,
           ps.source AS signup_source, ps.utm_source, ps.created_at AS signup_at
      FROM base b
      LEFT JOIN public.crm_subscriptions s ON s.scope_key = b.scope_key
      LEFT JOIN public.crm_settings st ON st.scope_key = b.scope_key
      LEFT JOIN LATERAL (
        SELECT c.* FROM public.ticketing_connections c
         WHERE (b.venue_id IS NOT NULL AND c.venue_id = b.venue_id) OR (b.org_id IS NOT NULL AND c.organizer_user_id = b.org_id)
         ORDER BY c.created_at LIMIT 1) cn ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS n, count(*) FILTER (WHERE r.subscribed AND r.email IS NOT NULL AND NOT COALESCE(r.bounced, false))::int AS reach
          FROM public.contact_rows(b.venue_id, b.org_id, 'crm') r) ct ON true
      LEFT JOIN LATERAL (
        SELECT (SELECT count(*) FROM public.email_campaigns c
                 WHERE c.automation_id IS NULL AND c.status IN ('sent', 'sending')
                   AND COALESCE(c.sent_at, c.send_started_at) >= now() - interval '30 days'
                   AND ((b.venue_id IS NOT NULL AND c.venue_id = b.venue_id) OR (b.org_id IS NOT NULL AND c.organizer_user_id = b.org_id))
                   AND public.crm_campaign_is_crm(c.id))::int
             + (SELECT count(*) FROM public.sms_campaigns c
                 WHERE c.status IN ('sent', 'sending') AND COALESCE(c.sent_at, c.send_started_at) >= now() - interval '30 days'
                   AND ((b.venue_id IS NOT NULL AND c.venue_id = b.venue_id) OR (b.org_id IS NOT NULL AND c.organizer_id = b.org_id)) AND c.product = 'crm')::int AS sends30,
               (SELECT max(COALESCE(c.sent_at, c.send_started_at)) FROM public.email_campaigns c
                 WHERE c.automation_id IS NULL AND c.status IN ('sent', 'sending')
                   AND ((b.venue_id IS NOT NULL AND c.venue_id = b.venue_id) OR (b.org_id IS NOT NULL AND c.organizer_user_id = b.org_id))
                   AND public.crm_campaign_is_crm(c.id)) AS last_send_at) se ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS n,
               COALESCE(sum(CASE WHEN (m.meta->>'amount_total') ~ '^[0-9]+$'
                                 THEN (m.meta->>'amount_total')::numeric / 100 / (1 + COALESCE((cfg->>'vat_rate')::numeric, 20) / 100)
                                 ELSE l.amount::numeric / NULLIF((cfg->>'yunits_per_euro')::numeric, 0) END), 0) AS eur,
               max(l.created_at) AS last_at
          FROM public.crm_yunit_lots l
          LEFT JOIN public.crm_yunit_moves m ON m.ref_type = 'lot' AND m.ref_id = l.id::text AND m.kind = 'credit'
         WHERE l.scope_key = b.scope_key AND l.kind = 'purchase') pu ON true
      LEFT JOIN LATERAL (
        SELECT EXISTS (SELECT 1 FROM public.crm_imports i WHERE i.scope_key = b.scope_key AND i.status <> 'undone' AND i.undone_at IS NULL) AS imports,
               EXISTS (SELECT 1 FROM public.crm_email_settings e WHERE e.scope_key = b.scope_key
                          AND COALESCE(e.sender_name, '') <> '' AND COALESCE(e.postal_address, '') <> '') AS send_settings,
               (SELECT count(*) FROM public.email_automations a WHERE a.enabled AND a.product = 'crm'
                   AND ((b.venue_id IS NOT NULL AND a.venue_id = b.venue_id) OR (b.org_id IS NOT NULL AND a.organizer_user_id = b.org_id)))::int AS recipes,
               CASE WHEN b.org_id IS NOT NULL
                    THEN (SELECT count(*) FROM public.org_members m WHERE m.organizer_user_id = b.org_id AND m.invitation_status = 'accepted')::int
                    ELSE (SELECT count(*) FROM public.manager_permissions mp WHERE mp.venue_id = b.venue_id)::int END AS team) ob ON true
      LEFT JOIN LATERAL (
        SELECT p.source, p.utm_source, p.created_at FROM public.pro_signups p
         WHERE p.user_id = b.owner_id AND p.product = 'crm' ORDER BY p.created_at DESC LIMIT 1) ps ON true
     WHERE p_include_demo OR NOT b.is_demo
  ), calc AS (
    SELECT r.*,
           CASE
             WHEN r.sub_status IS NULL THEN 'paused'
             WHEN r.sub_status = 'trialing' AND r.trial_ends_at IS NOT NULL AND r.trial_ends_at > now() THEN 'trial'
             WHEN r.sub_status = 'active' AND (r.stripe_subscription_id IS NOT NULL OR r.current_period_end IS NULL OR r.current_period_end >= now()) THEN 'paid'
             WHEN r.sub_status = 'past_due' THEN 'late'
             WHEN r.sub_status IN ('canceled', 'cancelled', 'incomplete_expired') THEN 'churned'
             ELSE 'paused' END AS state,
           (r.has_conn AND r.last_ok_at IS NOT NULL AND r.last_ok_at > now() - interval '24 hours'
              AND (r.last_error_at IS NULL OR r.last_error_at < r.last_ok_at)) AS sync_ok
      FROM rows r
  ), scored AS (
    SELECT c.*,
           (c.has_conn)::int + (c.initial_import_done_at IS NOT NULL)::int + c.imports::int + c.send_settings::int
             + (c.sends30 > 0 OR c.last_send_at IS NOT NULL)::int + (c.recipes > 0)::int + (c.team > 0)::int AS ob_done,
           CASE WHEN c.sends30 >= 3 THEN 30 WHEN c.sends30 = 2 THEN 21 WHEN c.sends30 = 1 THEN 12 ELSE 0 END AS h_activity,
           CASE WHEN c.last_sign_in_at IS NULL THEN 0
                WHEN c.last_sign_in_at > now() - interval '3 days' THEN 15
                WHEN c.last_sign_in_at > now() - interval '7 days' THEN 11
                WHEN c.last_sign_in_at > now() - interval '14 days' THEN 6
                WHEN c.last_sign_in_at > now() - interval '30 days' THEN 2 ELSE 0 END AS h_presence,
           CASE WHEN c.sync_ok THEN 15 WHEN c.has_conn THEN 5 ELSE 0 END AS h_sync
      FROM calc c
  ), fin AS (
    SELECT s.*, round(40.0 * s.ob_done / 7)::int AS h_onboarding,
           CASE WHEN s.state = 'churned' THEN 0
                ELSE LEAST(100, round(40.0 * s.ob_done / 7)::int + s.h_activity + s.h_presence + s.h_sync) END AS health
      FROM scored s
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', f.scope_key, 'kind', f.kind, 'venue_id', f.venue_id, 'organizer_user_id', f.org_id,
      'name', f.name, 'city', f.city,
      'type', CASE WHEN f.business_type IN ('club', 'organizer', 'association') THEN f.business_type
                   WHEN f.association THEN 'association' WHEN f.kind = 'venue' THEN 'club' ELSE 'organizer' END,
      'contact', f.owner_name, 'email', f.owner_email, 'phone', f.owner_phone,
      'state', f.state, 'sub_status', f.sub_status, 'interval', f.billing_interval, 'founder', f.founder,
      'trial_ends_at', f.trial_ends_at,
      'trial_left', CASE WHEN f.state = 'trial' THEN GREATEST(0, ceil(extract(epoch FROM f.trial_ends_at - now()) / 86400))::int END,
      'period_end', f.current_period_end, 'cancel_at_end', f.cancel_at_end,
      'paid', f.stripe_subscription_id IS NOT NULL, 'granted', f.state = 'paid' AND f.stripe_subscription_id IS NULL,
      'signup_at', COALESCE(f.signup_at, f.created_at), 'sub_created', f.sub_created,
      'mrr', CASE WHEN f.state IN ('paid', 'late') AND f.stripe_subscription_id IS NOT NULL
                  THEN CASE WHEN f.billing_interval = 'year' THEN round((cfg->>'price_year')::numeric / 12, 2)
                            WHEN f.founder THEN (cfg->>'price_month')::numeric
                            ELSE (cfg->>'price_month_next')::numeric END
                  ELSE 0 END,
      'provider', f.conn_provider, 'conn_status', f.conn_status,
      'sync', CASE WHEN NOT f.has_conn THEN 'none' WHEN f.sync_ok THEN 'ok' ELSE 'error' END,
      'sync_at', f.last_ok_at, 'sync_error', f.last_error, 'sync_error_at', f.last_error_at,
      'contacts', f.contacts, 'reach', f.reach,
      'sends30', f.sends30, 'last_send_at', f.last_send_at,
      'balance', f.balance, 'buys', f.buys, 'buys_eur', round(f.buys_eur, 2), 'last_buy_at', f.last_buy_at,
      'last_login', f.last_sign_in_at,
      'source', COALESCE(NULLIF(f.signup_source, ''), NULLIF(f.utm_source, '')),
      'ob', jsonb_build_array(f.has_conn, f.initial_import_done_at IS NOT NULL, f.imports, f.send_settings,
                              (f.sends30 > 0 OR f.last_send_at IS NOT NULL), f.recipes > 0, f.team > 0),
      'recipes', f.recipes, 'team', f.team,
      'health', f.health,
      'h', jsonb_build_array(f.h_onboarding, f.h_activity, f.h_presence, f.h_sync),
      'frozen_at', f.sending_frozen_at, 'frozen_reason', f.sending_frozen_reason,
      'deletion_requested_at', f.deletion_requested_at,
      'is_demo', f.is_demo
    ) ORDER BY f.health, f.name), '[]'::jsonb)
    INTO v_out
    FROM fin f;
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_admin_rows(p_include_demo boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_admin_rows(p_include_demo boolean) TO service_role;

CREATE OR REPLACE FUNCTION public._crm_admin_daily_core(p_include_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb := public._crm_admin_rows(p_include_demo);
  v_sync jsonb; v_deliv jsonb; v_trials jsonb; v_silent jsonb; v_forecast jsonb; v_audits jsonb;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _cad (id text PRIMARY KEY, name text, state text, venue_id text, org uuid,
                                        sync text, sync_error text, trial_ends_at timestamptz) ON COMMIT DROP;
  TRUNCATE _cad;
  INSERT INTO _cad
  SELECT r->>'id', r->>'name', r->>'state', r->>'venue_id', NULLIF(r->>'organizer_user_id', '')::uuid,
         r->>'sync', r->>'sync_error', NULLIF(r->>'trial_ends_at', '')::timestamptz
    FROM jsonb_array_elements(v_rows) r
  ON CONFLICT DO NOTHING;

  -- Synchros en erreur.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'error', a.sync_error) ORDER BY a.name), '[]'::jsonb)
    INTO v_sync FROM _cad a WHERE a.sync = 'error';

  -- Délivrabilité des 7 derniers jours (200 e-mails au moins pour juger).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'sent', x.sent, 'bounced', x.bounced, 'complained', x.complained)
           ORDER BY x.bounced::numeric / x.sent DESC), '[]'::jsonb)
    INTO v_deliv
    FROM (SELECT a.id, a.name, sum(COALESCE(c.recipients_count, c.total_recipients, 0))::int AS sent,
                 sum(COALESCE(c.bounced_count, 0))::int AS bounced, sum(COALESCE(c.complained_count, 0))::int AS complained
            FROM _cad a
            JOIN public.email_campaigns c ON c.venue_id IS NOT DISTINCT FROM a.venue_id
                                         AND (a.venue_id IS NOT NULL OR c.organizer_user_id = a.org)
           WHERE c.sent_at > now() - interval '7 days' AND c.status IN ('sent', 'sending')
           GROUP BY a.id, a.name) x
   WHERE x.sent >= 200 AND (x.bounced > 0.03 * x.sent OR x.complained > 0.001 * x.sent);

  -- Essais qui finissent dans les 3 jours.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'trial_ends_at', a.trial_ends_at) ORDER BY a.trial_ends_at), '[]'::jsonb)
    INTO v_trials FROM _cad a
   WHERE a.state = 'trial' AND a.trial_ends_at > now() AND a.trial_ends_at <= now() + interval '3 days';

  -- Comptes (essai ou payants) qui n'ont rien envoyé depuis 14 jours.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'state', a.state, 'last_send_at', l.at) ORDER BY l.at NULLS FIRST, a.name), '[]'::jsonb)
    INTO v_silent
    FROM _cad a
    CROSS JOIN LATERAL (
      SELECT GREATEST(
        (SELECT max(c.sent_at) FROM public.email_campaigns c
          WHERE c.venue_id IS NOT DISTINCT FROM a.venue_id AND (a.venue_id IS NOT NULL OR c.organizer_user_id = a.org) AND c.sent_at IS NOT NULL
            AND public.crm_campaign_is_crm(c.id)),
        (SELECT max(c.sent_at) FROM public.sms_campaigns c
          WHERE c.venue_id IS NOT DISTINCT FROM a.venue_id AND (a.venue_id IS NOT NULL OR c.organizer_id = a.org) AND c.sent_at IS NOT NULL AND c.product = 'crm'),
        (SELECT max(st.done_at) FROM public.crm_scenario_steps st JOIN public.crm_scenarios s ON s.id = st.scenario_id
          WHERE s.scope_key = a.id AND st.status = 'sent'),
        (SELECT max(l.created_at) FROM public.email_automation_sends l
          WHERE l.venue_id IS NOT DISTINCT FROM a.venue_id AND (a.venue_id IS NOT NULL OR l.organizer_user_id = a.org) AND l.status = 'queued')) AS at) l
   WHERE a.state IN ('trial', 'paid') AND (l.at IS NULL OR l.at < now() - interval '14 days');

  -- Prévisions d'acheteurs écartées de plus de 15 % (soirées réglées cette semaine).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'title', r.title, 'start_at', r.start_at,
           'err_pct', round(100 * (r.metrics->'projection'->>'err')::numeric)) ORDER BY r.start_at DESC), '[]'::jsonb)
    INTO v_forecast
    FROM _cad a JOIN public.crm_prediction_results r ON r.scope_key = a.id
   WHERE r.horizon = 'd7' AND r.settled_at > now() - interval '7 days'
     AND (r.metrics->'projection'->>'err')::numeric > 0.15;

  -- Audits de prospects prêts : essai, premier import fait, analyse calculée,
  -- une soirée dans les 3 semaines (son plan de soirée se lit dans l'Admin).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'trial_ends_at', a.trial_ends_at,
           'event_id', e.id, 'title', e.title, 'start_at', e.start_at) ORDER BY e.start_at), '[]'::jsonb)
    INTO v_audits
    FROM _cad a
    JOIN public.crm_analysis_state an ON an.scope_key = a.id AND an.computed_at IS NOT NULL
    CROSS JOIN LATERAL (SELECT ev.id, ev.title, ev.start_at FROM public.events ev
                         WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL
                           AND ev.start_at > now() AND ev.start_at < now() + interval '21 days'
                           AND ((a.venue_id IS NOT NULL AND ev.venue_id = a.venue_id) OR (a.venue_id IS NULL AND ev.organizer_user_id = a.org))
                         ORDER BY ev.start_at LIMIT 1) e
   WHERE a.state = 'trial'
     AND EXISTS (SELECT 1 FROM public.ticketing_connections c
                  WHERE c.initial_import_done_at IS NOT NULL
                    AND c.venue_id IS NOT DISTINCT FROM a.venue_id AND (a.venue_id IS NOT NULL OR c.organizer_user_id = a.org));

  RETURN jsonb_build_object('at', now(),
    'sync_errors', v_sync, 'deliverability', v_deliv, 'trials_ending', v_trials, 'silent', v_silent,
    'forecast', v_forecast, 'audits', v_audits,
    'counts', jsonb_build_object('sync_errors', jsonb_array_length(v_sync), 'deliverability', jsonb_array_length(v_deliv),
                                 'trials_ending', jsonb_array_length(v_trials), 'silent', jsonb_array_length(v_silent),
                                 'forecast', jsonb_array_length(v_forecast), 'audits', jsonb_array_length(v_audits)));
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_admin_daily_core(p_include_demo boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_admin_daily_core(p_include_demo boolean) TO service_role;

CREATE OR REPLACE FUNCTION public._mcp_tool(p_tool text, p_kind text, p_space_id text, p_product text, p_tz text, p_args jsonb, p_level text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue  text := CASE WHEN p_kind = 'venue' THEN p_space_id END;
  v_org    uuid := CASE WHEN p_kind = 'organizer' THEN p_space_id::uuid END;
  v_crm    boolean := p_product = 'crm';
  gate     record;
  w        record;
  v_event  uuid;
  v_ref    text;
  v_limit  integer;
  v_offset integer;
  v        jsonb;
  v2       jsonb;
  v3       jsonb;
  v_when   text;
  v_search text;
  v_topic  text;
  v_ids    uuid[];
  v_out    jsonb;
  r        record;
BEGIN
  SELECT * INTO gate FROM public.analytics_scope_gate(v_venue, v_org);
  IF NOT coalesce(gate.ok, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden', 'reason', gate.reason);
  END IF;
  -- Compte Yuno CRM : ses soirées sont des soirées MIROIR, qu'analytics_scope_gate
  -- écarte depuis le 07/10 (la Billetterie ne doit pas les compter). Sans elles,
  -- l'IA d'un compte CRM voyait « 0 soirée » et ne trouvait aucun rapport.
  IF v_crm THEN
    gate.scope_ids := public._mcp_email_scope_events(v_venue, v_org);
  END IF;

  CASE p_tool

  -- ── Contexte ──────────────────────────────────────────────────────────────
  WHEN 'get_account_overview' THEN
    SELECT jsonb_build_object(
      'past_events', count(*) FILTER (WHERE coalesce(e.end_at, e.start_at + interval '8 hours') < now()),
      'upcoming_events', count(*) FILTER (WHERE coalesce(e.end_at, e.start_at + interval '8 hours') >= now()),
      'first_event_at', min(e.start_at), 'last_event_at', max(e.start_at) FILTER (WHERE e.start_at < now()))
      INTO v
      FROM public.events e
     WHERE e.id = ANY (gate.scope_ids) AND e.cancelled_at IS NULL
       AND (e.is_active OR e.external_source IS NOT NULL);
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'start_at', x.start_at,
             'external', x.external_source IS NOT NULL) ORDER BY x.start_at), '[]'::jsonb)
      INTO v2
      FROM (SELECT e.* FROM public.events e
             WHERE e.id = ANY (gate.scope_ids) AND e.cancelled_at IS NULL
               AND (e.is_active OR e.external_source IS NOT NULL)
               AND coalesce(e.end_at, e.start_at + interval '8 hours') >= now()
             ORDER BY e.start_at LIMIT 5) x;
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'start_at', x.start_at,
             'external', x.external_source IS NOT NULL) ORDER BY x.start_at DESC), '[]'::jsonb)
      INTO v3
      FROM (SELECT e.* FROM public.events e
             WHERE e.id = ANY (gate.scope_ids) AND e.cancelled_at IS NULL
               AND (e.is_active OR e.external_source IS NOT NULL)
               AND coalesce(e.end_at, e.start_at + interval '8 hours') < now()
             ORDER BY e.start_at DESC LIMIT 5) x;
    v_out := jsonb_build_object(
      'ok', true, 'now', now(), 'timezone', coalesce(gate.tz, p_tz),
      'today_local', to_char(now() AT TIME ZONE coalesce(gate.tz, p_tz), 'YYYY-MM-DD (Dy)'),
      'currency', 'EUR', 'product', p_product, 'can_see_money', gate.money,
      'access_level', p_level, 'events', v, 'next_events', v2, 'last_events', v3);
    IF v_crm THEN
      -- Statut de la billetterie connectée, lu ici (la RPC de la Console est
      -- réservée au fondateur et rend l'indice du jeton et l'erreur brute).
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'provider', tc.provider, 'account', tc.external_org_name, 'status', tc.status,
               'last_sync_ok_at', tc.last_ok_at, 'first_import_done', tc.initial_import_done_at IS NOT NULL,
               'has_sync_error', tc.last_error_at IS NOT NULL AND (tc.last_ok_at IS NULL OR tc.last_error_at > tc.last_ok_at)))
             ORDER BY tc.created_at), '[]'::jsonb)
        INTO v
        FROM public.ticketing_connections tc
       WHERE (v_venue IS NOT NULL AND tc.venue_id = v_venue) OR (v_org IS NOT NULL AND tc.organizer_user_id = v_org);
      v_out := v_out || jsonb_build_object('ticketing', v);
    END IF;
    RETURN v_out;

  -- ── Soirées ───────────────────────────────────────────────────────────────
  WHEN 'list_events' THEN
    v_when := coalesce(nullif(p_args->>'when', ''), 'all');
    v_search := nullif(btrim(coalesce(p_args->>'search', '')), '');
    v_limit := greatest(1, least(coalesce(nullif(p_args->>'limit', '')::integer, 20), 60));
    IF v_crm THEN
      v := public.get_crm_nights(v_venue, v_org, 200, 0);
      SELECT coalesce(jsonb_agg(n ORDER BY CASE WHEN v_when = 'upcoming' THEN (n->>'start_at')::timestamptz END ASC,
                                           (n->>'start_at')::timestamptz DESC), '[]'::jsonb)
        INTO v2
        FROM (SELECT n FROM jsonb_array_elements(v->'nights') n
               WHERE (v_when = 'all' OR (v_when = 'upcoming') = coalesce((n->>'upcoming')::boolean, false))
                 AND (v_search IS NULL OR lower(n->>'title') LIKE '%' || lower(v_search) || '%')
               ORDER BY CASE WHEN v_when = 'upcoming' THEN (n->>'start_at')::timestamptz END ASC,
                        (n->>'start_at')::timestamptz DESC
               LIMIT v_limit) q;
      RETURN jsonb_build_object('ok', true, 'source', 'ticketing', 'total', v->'total', 'events', v2);
    END IF;
    v := public.get_analytics_event_rail(v_venue, v_org, 400);
    SELECT coalesce(jsonb_agg(q.e), '[]'::jsonb) INTO v2
      FROM (SELECT e FROM jsonb_array_elements(v->'events') e
             WHERE (v_when = 'all' OR (v_when = 'upcoming' AND e->>'phase' <> 'after')
                    OR (v_when = 'past' AND e->>'phase' = 'after'))
               AND (v_search IS NULL OR lower(e->>'title') LIKE '%' || lower(v_search) || '%')
               AND (nullif(p_args->>'from', '') IS NULL OR (e->>'startAt')::timestamptz >= (p_args->>'from')::date)
               AND (nullif(p_args->>'to', '') IS NULL OR (e->>'startAt')::timestamptz < (p_args->>'to')::date + 1)
             ORDER BY CASE WHEN v_when = 'upcoming' THEN (e->>'startAt')::timestamptz END ASC,
                      (e->>'startAt')::timestamptz DESC
             LIMIT v_limit) q;
    v_out := jsonb_build_object('ok', true, 'money', v->'money', 'events', v2);
    IF v_when IN ('upcoming', 'all') THEN
      -- Jauges et ventes du jour des prochaines soirées (même source que
      -- « Vos prochaines soirées » de l'accueil).
      v_out := v_out || jsonb_build_object('upcoming_pipeline', public.get_events_sales_summary(v_venue, v_org)->'events');
    END IF;
    RETURN v_out;

  WHEN 'get_event_report' THEN
    v_event := public._mcp_resolve_event(coalesce(p_args->>'event_id', p_args->>'event'), gate.scope_ids);
    IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    IF v_crm OR EXISTS (SELECT 1 FROM public.events WHERE id = v_event AND external_source IS NOT NULL) THEN
      RETURN jsonb_build_object('ok', true, 'source', 'ticketing', 'event_id', v_event, 'report', public.get_crm_night_report(v_event));
    END IF;
    RETURN public.get_event_report(v_event);

  WHEN 'get_event_details' THEN
    v_event := public._mcp_resolve_event(coalesce(p_args->>'event_id', p_args->>'event'), gate.scope_ids);
    IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    v_topic := coalesce(nullif(p_args->>'topic', ''), 'ticket_types');
    CASE v_topic
      WHEN 'ticket_types' THEN
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'name', tr.name, 'price', tr.price, 'capacity', tr.max_tickets, 'sold', tr.tickets_sold,
                 'fill_pct', CASE WHEN coalesce(tr.max_tickets, 0) > 0 THEN round(100.0 * tr.tickets_sold / tr.max_tickets, 1) END,
                 'open', tr.is_active, 'sold_out_by_hand', tr.manually_sold_out, 'hidden', tr.hidden,
                 'type', tr.ticket_type, 'group_size', CASE WHEN tr.is_group THEN tr.group_size END,
                 'sale_starts_at', tr.sale_starts_at, 'sale_ends_at', tr.sale_ends_at,
                 'entry_deadline', tr.entry_deadline, 'includes_free_drink', tr.includes_drink)
               ORDER BY tr.position, tr.price), '[]'::jsonb)
          INTO v
          FROM public.ticket_rounds tr WHERE tr.event_id = v_event;
        SELECT jsonb_build_object('title', e.title, 'start_at', e.start_at, 'selling_mode', e.ticket_selling_mode,
                 'ticketing_enabled', e.ticketing_enabled, 'tables_enabled', e.tables_enabled,
                 'guest_list_parts', (SELECT count(*) FROM public.guest_lists gl WHERE gl.event_id = e.id),
                 'tickets_sold_out', e.tickets_sold_out,
                 'tables_sold_out', e.tables_sold_out, 'guest_list_sold_out', e.guest_list_sold_out,
                 'entry_target', e.entry_target)
          INTO v2 FROM public.events e WHERE e.id = v_event;
        RETURN jsonb_build_object('ok', true, 'event', v2, 'ticket_types', v);
      WHEN 'tables' THEN
        RETURN public.get_vip_table_analytics(v_venue, v_event, NULL, NULL, coalesce(gate.tz, p_tz), v_org);
      WHEN 'guest_list' THEN
        RETURN public.get_guest_list_analytics(v_venue, v_event, NULL, NULL, coalesce(gate.tz, p_tz), v_org);
      WHEN 'traffic' THEN
        RETURN public.get_event_traffic(v_event);
      WHEN 'pacing' THEN
        RETURN public.get_analytics_pacing(v_event, 'previous', greatest(7, least(coalesce(nullif(p_args->>'days', '')::integer, 30), 90)));
      WHEN 'door' THEN
        RETURN public.get_analytics_door(v_venue, v_org, v_event, NULL, NULL);
      WHEN 'partners' THEN
        RETURN public.get_collab_party_breakdown(v_event);
      WHEN 'promoters' THEN
        RETURN public.get_analytics_promoters(v_venue, v_org, v_event, NULL, NULL);
      ELSE
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_args', 'message', 'unknown topic');
    END CASE;

  WHEN 'compare_events' THEN
    v_ids := '{}';
    IF jsonb_typeof(p_args->'events') = 'array' THEN
      FOR v_ref IN SELECT x FROM jsonb_array_elements_text(p_args->'events') x LIMIT 6 LOOP
        v_event := public._mcp_resolve_event(v_ref, gate.scope_ids);
        IF v_event IS NOT NULL AND NOT v_event = ANY (v_ids) THEN v_ids := v_ids || v_event; END IF;
      END LOOP;
    END IF;
    IF cardinality(v_ids) = 0 THEN
      SELECT coalesce(array_agg(x.id ORDER BY x.start_at DESC), '{}') INTO v_ids
        FROM (SELECT e.id, e.start_at FROM public.events e
               WHERE e.id = ANY (gate.scope_ids) AND e.cancelled_at IS NULL
                 AND (e.is_active OR e.external_source IS NOT NULL)
                 AND coalesce(e.end_at, e.start_at + interval '8 hours') < now()
               ORDER BY e.start_at DESC
               LIMIT greatest(2, least(coalesce(nullif(p_args->>'last', '')::integer, 4), 6))) x;
    END IF;
    v := '[]'::jsonb;
    FOREACH v_event IN ARRAY v_ids LOOP
      IF v_crm OR EXISTS (SELECT 1 FROM public.events WHERE id = v_event AND external_source IS NOT NULL) THEN
        v2 := public.get_crm_night_report(v_event);
        v := v || jsonb_build_array(jsonb_build_object('event_id', v_event, 'source', 'ticketing',
                 'report', v2 - 'curve' - 'buyers_list'));
      ELSE
        v2 := public.get_event_report(v_event);
        v := v || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                 'event', v2->'event', 'totals', v2->'totals', 'audience', v2->'audience',
                 'channels', v2->'channels', 'visit_sources', v2->'visitSources',
                 'takeaways', v2->'takeaways', 'money', v2->'money')));
      END IF;
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'events', v);

  -- ── Ventes ────────────────────────────────────────────────────────────────
  WHEN 'get_sales_overview' THEN
    IF v_crm THEN
      v_when := public._mcp_crm_period(p_args, 90);
      v := public.crm_ana_sales(v_venue, v_org, v_when, NULL, 'all');
      RETURN jsonb_build_object('ok', true, 'source', 'ticketing', 'period', v_when, 'window', v->'meta',
        'totals', v->'totals', 'fill', v->'fill', 'tariffs', v->'tariffs', 'from_yuno_messages', v->'msg',
        'events', v->'events', 'events_other', v->'events_other',
        'account', public.get_crm_overview(v_venue, v_org),
        'note', 'Yuno CRM account: sales reported by the connected ticketing over the period (24h, 48h, 7d, 30d, 90d or 12m ending today), compared with the period just before.');
    END IF;
    RETURN public.get_sales_takeaways(v_venue, v_org,
      CASE WHEN p_args->>'period' IN ('last', 'last4', 'month', 'year', 'all') THEN p_args->>'period' ELSE 'last4' END);

  WHEN 'get_sales_trends' THEN
    IF v_crm THEN
      v_when := public._mcp_crm_period(p_args, 90);
      v := public.crm_ana_sales(v_venue, v_org, v_when, NULL, 'all');
      v_out := jsonb_build_object('ok', true, 'source', 'ticketing', 'period', v_when, 'window', v->'meta',
        'series', v->'series', 'yuno_sends_on_the_series', v->'sends', 'pace_vs_reference_nights', v->'goal',
        'note', 'series[i] = tickets and revenue of slot i of the window (window.mode: hour, day or month from window.start), prev_* = same slot of the previous period.');
      BEGIN v_out := v_out || jsonb_build_object('traffic', public.crm_ana_traffic(v_venue, v_org, v_when, NULL));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('traffic', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      RETURN v_out;
    END IF;
    SELECT * INTO w FROM public._mcp_window(p_args, 90);
    v_out := jsonb_build_object('ok', true, 'from', w.w_from, 'to', w.w_to);
    BEGIN v_out := v_out || jsonb_build_object('curve', public.get_sales_period_curve(v_venue, v_org, w.w_from, w.w_to));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('curve', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('drivers', public.get_sales_period_drivers(v_venue, v_org, w.w_from, w.w_to));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('drivers', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('audience', public.get_sales_period_audience(v_venue, v_org, w.w_from, w.w_to));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('audience', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    RETURN v_out;

  WHEN 'get_purchase_behavior' THEN
    IF v_crm THEN
      v_when := public._mcp_crm_period(p_args, 90);
      v := public.crm_ana_sales(v_venue, v_org, v_when, NULL, 'all');
      v_out := jsonb_build_object('ok', true, 'source', 'ticketing', 'period', v_when,
        'purchases_by_weekday_and_hour', v->'heat', 'ticket_tiers', v->'tariffs', 'totals', v->'totals',
        'note', 'purchases_by_weekday_and_hour: cells[weekday][slot], weekday 0 = Monday, 8 two-hour slots starting at 10:00, 12:00, 14:00, 16:00, 18:00, 20:00, 22:00, 00:00 (local time), outside = purchases outside these slots; n = tickets, amount = revenue. '
             || 'buying_habits: tested hypotheses on how customers buy (see get_customer_analysis), never a certainty.');
      BEGIN
        v2 := public.crm_analysis_overview(v_venue, v_org);
        v_out := v_out || jsonb_build_object('buying_habits', (
          SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('family', f->>'family', 'status', f->>'status',
                   'availability', f->>'availability', 'matched', f->'o', 'expected_by_chance', f->'e', 'tested', f->'n', 'gain', f->'gain'))), '[]'::jsonb)
            FROM jsonb_array_elements(coalesce(v2->'families', '[]'::jsonb)) f
           WHERE f->>'family' IN ('launch', 'early', 'last_minute', 'door', 'group', 'table')));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('buying_habits', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      RETURN v_out;
    END IF;
    SELECT * INTO w FROM public._mcp_window(p_args, 180);
    RETURN public.get_purchase_behavior(v_venue, v_org, w.w_from, w.w_to);

  WHEN 'get_promoters_performance' THEN
    IF v_crm THEN RETURN jsonb_build_object('ok', false, 'error', 'not_available_in_crm'); END IF;
    SELECT * INTO w FROM public._mcp_window(p_args, 90);
    RETURN public.get_analytics_promoters(v_venue, v_org, NULL, w.w_from, w.w_to);

  WHEN 'get_live_now' THEN
    IF v_crm THEN RETURN jsonb_build_object('ok', false, 'error', 'not_available_in_crm'); END IF;
    RETURN public.get_live_view(v_venue, v_org);

  -- ── Public et trafic ──────────────────────────────────────────────────────
  WHEN 'get_audience_overview' THEN
    IF v_crm THEN
      v_out := jsonb_build_object('ok', true, 'source', 'ticketing');
      BEGIN v_out := v_out || jsonb_build_object('clients', public.crm_clients_overview(v_venue, v_org));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('clients', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN
        v := public.crm_ana_community(v_venue, v_org, public._mcp_crm_period(p_args, 365), NULL, 'all');
        v_out := v_out || jsonb_build_object('community', v - 'top' - 'spark' - 'series',
          'note', 'community: lifecycle (hab = regulars, occ = occasional, nou = new, end = lapsed, none = known contact without a night), '
               || 'hist = people by number of nights, reach = reachable by email / SMS, wake = people to bring back, cohort = return of each recent night''s buyers.');
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('community', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN
        v2 := public.crm_artists_analysis(v_venue, v_org, 10);
        v_out := v_out || jsonb_build_object('artists', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'name', x->>'name', 'nights', x->'nights', 'entries', x->'entries', 'newcomers', x->'new_brought',
                   'return_rate', x->'return_rate', 'resident', x->'resident'))), '[]'::jsonb)
                   FROM jsonb_array_elements(coalesce(v2->'artists', '[]'::jsonb)) x));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('artists', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      RETURN v_out;
    END IF;
    v_out := jsonb_build_object('ok', true);
    BEGIN v_out := v_out || jsonb_build_object('community', public.get_community_overview(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('community', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('tastes', public.get_community_tastes(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('tastes', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('cohorts', public.get_analytics_cohorts(v_venue, v_org, 6));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('cohorts', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    RETURN v_out;

  WHEN 'get_web_traffic' THEN
    IF v_crm THEN
      v_when := public._mcp_crm_period(p_args, 30);
      RETURN jsonb_build_object('ok', true, 'source', 'ticketing', 'period', v_when,
        'traffic', public.crm_ana_traffic(v_venue, v_org, v_when, NULL),
        'note', 'Yuno CRM account: where ticket buyers came from (utm_source reported by the ticketing, Yuno links /go/, signup pages). Page visits on the ticketing site are not reported by Shotgun.');
    END IF;
    SELECT * INTO w FROM public._mcp_window(p_args, 30);
    v_out := jsonb_build_object('ok', true);
    BEGIN v_out := v_out || jsonb_build_object('page', public.get_page_traffic(v_venue, v_org, least(w.w_days, 365)));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('page', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('sources', public.get_analytics_sources(v_venue, v_org, NULL, w.w_from, w.w_to));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('sources', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    RETURN v_out;

  WHEN 'count_contacts' THEN
    IF jsonb_typeof(p_args->'conditions') <> 'array' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_args', 'message', 'conditions[] required');
    END IF;
    RETURN jsonb_build_object('ok', true, 'definition', jsonb_build_object('conditions', p_args->'conditions'),
      'result', public.count_contact_segment_def(v_venue, v_org, jsonb_build_object('conditions', p_args->'conditions'), CASE WHEN v_crm THEN 'crm' ELSE 'suite' END));

  WHEN 'get_customer_segments' THEN
    IF v_crm THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description,
               'template', s.template, 'definition', s.definition) ORDER BY s.updated_at DESC), '[]'::jsonb)
        INTO v
        FROM (SELECT * FROM public.crm_segments cs
               WHERE (v_venue IS NOT NULL AND cs.venue_id = v_venue)
                  OR (v_org IS NOT NULL AND cs.organizer_user_id = v_org AND cs.venue_id IS NULL)
               ORDER BY cs.updated_at DESC LIMIT 40) s;
      v_out := jsonb_build_object('ok', true, 'source', 'ticketing', 'saved_segments', v);
      BEGIN
        v2 := public.crm_segments_overview(v_venue, v_org, public._mcp_crm_period(p_args, 90));
        v_out := v_out || jsonb_build_object('lifecycle_segments', v2->'segments', 'rules', v2->'rules', 'messages_totals', v2->'totals',
          'note', 'lifecycle keys: hab = regulars, occ = occasional, nou = new, end = lapsed, none = known contact without a night (rules: regulars = N nights over M months).');
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('lifecycle_segments', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      RETURN v_out;
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description,
             'definition', s.definition, 'origin', s.origin) ORDER BY s.updated_at DESC), '[]'::jsonb)
      INTO v
      FROM (SELECT * FROM public.contact_segments cs
             WHERE (v_venue IS NOT NULL AND cs.venue_id = v_venue)
                OR (v_org IS NOT NULL AND cs.organizer_user_id = v_org)
             ORDER BY cs.updated_at DESC LIMIT 30) s;
    v_out := jsonb_build_object('ok', true, 'saved_segments', v);
    BEGIN v_out := v_out || jsonb_build_object('rfm', public.get_analytics_rfm(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('rfm', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('imported_lists', public.get_email_lists_health(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('imported_lists', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('basket_threshold', public.suggest_basket_threshold(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('basket_threshold', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    RETURN v_out;

  -- ── Marketing ─────────────────────────────────────────────────────────────
  WHEN 'get_marketing_performance' THEN
    SELECT * INTO w FROM public._mcp_window(p_args, 90);
    v_topic := coalesce(nullif(p_args->>'channel', ''), 'all');
    v_out := jsonb_build_object('ok', true, 'from', w.w_from, 'to', w.w_to);
    IF v_topic IN ('all', 'email') THEN
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', c.id, 'name', c.name, 'subject', c.subject, 'type', c.type, 'status', c.status,
               'sent_at', c.sent_at, 'event_id', c.event_id,
               'recipients', coalesce(c.total_recipients, c.recipients_count), 'delivered', c.delivered_count,
               'opens', c.opens_count, 'clicks', c.clicks_count, 'clickers', c.clickers_count,
               'unsubscribes', c.unsubscribes_count, 'bounced', c.bounced_count, 'complaints', c.complained_count,
               'protected_by_yuno_rules', c.policy_skipped_count, 'ab_test', c.ab_enabled, 'ab_winner', c.ab_winner,
               'open_rate_pct', CASE WHEN coalesce(c.delivered_count, 0) > 0 THEN round(100.0 * c.opens_count / c.delivered_count, 1) END,
               'click_rate_pct', CASE WHEN coalesce(c.delivered_count, 0) > 0 THEN round(100.0 * coalesce(c.clickers_count, c.clicks_count) / c.delivered_count, 1) END))
             ORDER BY c.sent_at DESC), '[]'::jsonb)
        INTO v
        FROM (SELECT * FROM public.email_campaigns c
               WHERE ((v_venue IS NOT NULL AND c.venue_id = v_venue) OR (v_org IS NOT NULL AND c.organizer_user_id = v_org AND c.venue_id IS NULL))
                 AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
                 AND public.crm_campaign_is_crm(c.id) = v_crm
                 AND c.sent_at >= w.w_from AND c.sent_at < w.w_to
               ORDER BY c.sent_at DESC LIMIT 20) c;
      v_out := v_out || jsonb_build_object('email_campaigns', v);
      BEGIN
        v_out := v_out || jsonb_build_object('email_revenue_attribution', public.get_email_campaign_attribution(
            CASE WHEN v_venue IS NOT NULL THEN 'venue' ELSE 'organizer' END, coalesce(v_venue, v_org::text)));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('email_revenue_attribution', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN v_out := v_out || jsonb_build_object('best_send_time', public.get_email_send_time_insights(v_venue, v_org));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('best_send_time', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    END IF;
    IF v_topic IN ('all', 'automations') THEN
      BEGIN v_out := v_out || jsonb_build_object('email_automations', public.get_email_automation_stats(v_venue, v_org, least(w.w_days, 365), CASE WHEN v_crm THEN 'crm' END));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('email_automations', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN v_out := v_out || jsonb_build_object('automation_suggestions', CASE WHEN v_crm THEN '[]'::jsonb ELSE public.get_email_automation_suggestions(v_venue, v_org) END);
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('automation_suggestions', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    END IF;
    IF v_topic IN ('all', 'push') AND NOT v_crm THEN
      BEGIN v_out := v_out || jsonb_build_object('push_campaigns', public.get_push_campaigns(v_venue, v_org, 'all', NULL, 15, 0));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('push_campaigns', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN v_out := v_out || jsonb_build_object('push_automatic', public.get_push_center(v_venue, v_org, least(w.w_days, 365)));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('push_automatic', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    END IF;
    IF v_topic IN ('all', 'sms') THEN
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', s.id, 'name', s.name, 'status', s.status, 'sent_at', s.sent_at, 'event_id', s.event_id,
               'recipients', s.total_recipients, 'sent', s.sent_count, 'delivered', s.delivered_count,
               'failed', s.failed_count, 'credits_used', s.credits_consumed)) ORDER BY s.sent_at DESC), '[]'::jsonb)
        INTO v
        FROM (SELECT * FROM public.sms_campaigns s
               WHERE ((v_venue IS NOT NULL AND s.venue_id = v_venue) OR (v_org IS NOT NULL AND s.organizer_id = v_org))
                 AND (COALESCE(s.product, '') = 'crm') = v_crm
                 AND s.sent_at >= w.w_from AND s.sent_at < w.w_to
               ORDER BY s.sent_at DESC LIMIT 15) s;
      v_out := v_out || jsonb_build_object('sms_campaigns', v);
    END IF;
    RETURN v_out;

  WHEN 'get_campaign_report' THEN
    SELECT * INTO r FROM public.email_campaigns c
     WHERE c.id::text = coalesce(p_args->>'campaign_id', '')
       AND public.crm_campaign_is_crm(c.id) = v_crm
       AND ((v_venue IS NOT NULL AND c.venue_id = v_venue) OR (v_org IS NOT NULL AND c.organizer_user_id = v_org AND c.venue_id IS NULL));
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'campaign_not_found'); END IF;
    BEGIN
      SELECT x INTO v FROM jsonb_array_elements(public.get_email_campaign_attribution(
          CASE WHEN v_venue IS NOT NULL THEN 'venue' ELSE 'organizer' END, coalesce(v_venue, v_org::text))->'campaigns') x
       WHERE x->>'campaign_id' = r.id::text OR x->>'id' = r.id::text LIMIT 1;
    EXCEPTION WHEN others THEN v := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    BEGIN v2 := CASE WHEN r.ab_enabled THEN public.get_campaign_ab_stats(r.id) END;
    EXCEPTION WHEN others THEN v2 := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    BEGIN v3 := CASE WHEN r.resend_enabled THEN public.get_campaign_resend_stats(r.id) END;
    EXCEPTION WHEN others THEN v3 := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    BEGIN v_out := CASE WHEN r.followup_enabled THEN public.get_campaign_followup_stats(r.id) END;
    EXCEPTION WHEN others THEN v_out := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    RETURN jsonb_build_object('ok', true,
      'campaign', jsonb_strip_nulls(jsonb_build_object(
        'id', r.id, 'name', r.name, 'subject', r.subject, 'subject_b', r.subject_b, 'preheader', r.preheader,
        'status', r.status, 'sent_at', r.sent_at, 'event_id', r.event_id,
        'recipients', coalesce(r.total_recipients, r.recipients_count), 'delivered', r.delivered_count,
        'opens', r.opens_count, 'clicks', r.clicks_count, 'clickers', r.clickers_count,
        'unsubscribes', r.unsubscribes_count, 'bounced', r.bounced_count, 'complaints', r.complained_count,
        'failed', r.failed_count, 'suppressed', r.suppressed_count,
        'protected_by_yuno_rules', r.policy_skipped_count, 'paused_reason', r.paused_reason,
        'audiences', r.audiences_json, 'exclusions', r.exclusions_json, 'resend_enabled', r.resend_enabled,
        'followup_enabled', r.followup_enabled)),
      'revenue_attribution', v,
      'ab_test', v2,
      'resend_to_non_openers', v3,
      'click_followup', v_out);

  -- ── Conseils ──────────────────────────────────────────────────────────────
  WHEN 'get_recommendations' THEN
    v_out := jsonb_build_object('ok', true, 'product', p_product);
    IF v_crm THEN
      BEGIN v_out := v_out || jsonb_build_object('overview', public.get_crm_overview(v_venue, v_org));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('overview', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN
        v := public.crm_ana_community(v_venue, v_org, '90d', NULL, 'all');
        v_out := v_out || jsonb_build_object('people_to_bring_back', v->'wake', 'reachable', v->'reach', 'lifecycle', v->'lifecycle');
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('people_to_bring_back', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN
        v := public.crm_analysis_overview(v_venue, v_org);
        v_out := v_out || jsonb_build_object('supported_hypotheses', (
          SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('family', f->>'family', 'variant', nullif(f->>'variant', ''),
                   'gain', f->'gain', 'direction', f->'direction'))), '[]'::jsonb)
            FROM jsonb_array_elements(coalesce(v->'families', '[]'::jsonb)) f
           WHERE f->>'status' = 'supported' AND f->>'availability' IN ('ok', 'reduced')),
          'return_delay_days', v->'state'->'stats'->'median_days');
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('supported_hypotheses', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    ELSE
      BEGIN
        v := public.get_sales_takeaways(v_venue, v_org, 'last4');
        v_out := v_out || jsonb_build_object(
          'sales_takeaways', v->'takeaways',
          'sales_last4_vs_previous4', jsonb_build_object('current', v->'current', 'previous', v->'previous'));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('sales_takeaways', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN v_out := v_out || jsonb_build_object('upcoming_pipeline', public.get_events_sales_summary(v_venue, v_org)->'events');
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('upcoming_pipeline', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN
        v_out := v_out || jsonb_build_object('signals_30d',
          public.get_analytics_insights(v_venue, v_org, NULL, now() - interval '30 days', now(), 'previous'));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('signals_30d', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    END IF;
    IF NOT v_crm THEN
      BEGIN v_out := v_out || jsonb_build_object('rfm', public.get_analytics_rfm(v_venue, v_org));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('rfm', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    END IF;
    BEGIN v_out := v_out || jsonb_build_object('automation_suggestions', CASE WHEN v_crm THEN '[]'::jsonb ELSE public.get_email_automation_suggestions(v_venue, v_org) END);
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('automation_suggestions', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN
      v_out := v_out || jsonb_build_object('automations',
        (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', a->>'kind', 'enabled', a->'enabled', 'sent', a->'sent')), '[]'::jsonb)
           FROM jsonb_array_elements(coalesce(public.get_email_automation_stats(v_venue, v_org, 30, CASE WHEN v_crm THEN 'crm' END), '[]'::jsonb)) a));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('automations', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    RETURN v_out;

  -- ── Analyse client (« ce qui fait venir », 20261010150000) ────────────────
  -- Agrégats seulement (niveau analytics) : statut de chaque famille
  -- d'hypothèses testée sur le compte, hypothèses des nouveaux venus, venus
  -- une fois, délai de retour, couverture, artistes. Aucune identité.
  -- « Qui cibler » (20261011110000) : audiences sans place d'une soirée à venir.
  WHEN 'get_event_targets' THEN
    IF NOT v_crm THEN RETURN jsonb_build_object('ok', false, 'error', 'not_available_outside_crm'); END IF;
    v_event := public._mcp_resolve_event(coalesce(p_args->>'event_id', p_args->>'event'), gate.scope_ids);
    IF v_event IS NULL AND nullif(coalesce(p_args->>'event_id', p_args->>'event'), '') IS NULL THEN
      SELECT e.id INTO v_event FROM public.events e
       WHERE e.id = ANY (gate.scope_ids) AND e.external_source IS NOT NULL AND e.cancelled_at IS NULL
         AND coalesce(e.end_at, e.start_at + interval '6 hours') > now()
       ORDER BY e.start_at LIMIT 1;
    END IF;
    IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    v := public.crm_night_targets(v_venue, v_org, v_event);
    RETURN v || jsonb_build_object('note',
      'Audiences are people WITHOUT a ticket for this event; one person can be in several. status = what the account data says about the hypothesis family '
      || '(supported, not_supported, untested, inconclusive), never a certainty about a person. send_at = suggested moment.');

  WHEN 'get_customer_analysis' THEN
    BEGIN
      v := public.crm_analysis_overview(v_venue, v_org);
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'error', 'analysis_unavailable', 'detail', public._mcp_unavailable(SQLSTATE, SQLERRM));
    END;
    IF v->'state' IS NULL OR jsonb_typeof(v->'state') = 'null' THEN
      RETURN jsonb_build_object('ok', true, 'computed', false,
        'note', 'No customer analysis yet: it needs a connected ticketing (Shotgun) and runs the night after the first import.');
    END IF;
    BEGIN
      v2 := public.crm_artists_analysis(v_venue, v_org, 15);
    EXCEPTION WHEN others THEN v2 := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    RETURN jsonb_build_object('ok', true, 'computed', true,
      'computed_at', v->'state'->'full_at', 'rules_version', v->'rules_version', 'min_sample', v->'min_sample',
      'families', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                     'family', f->>'family', 'variant', nullif(f->>'variant', ''), 'kind', f->>'kind',
                     'availability', f->>'availability', 'status', f->>'status',
                     'matched', f->'o', 'expected_by_chance', f->'e', 'tested', f->'n', 'gain', f->'gain', 'z', f->'z',
                     'direction', f->'direction', 'return_rate_group', f->'detail'->'r1', 'return_rate_others', f->'detail'->'r0',
                     'confirmed_since', CASE WHEN f->>'status' = 'supported' THEN f->'since' END,
                     'seen_on_other_accounts', f->'prior'))), '[]'::jsonb)
                     FROM jsonb_array_elements(coalesce(v->'families', '[]'::jsonb)) f),
      'newcomers_12_months', v->'newcomers',
      'came_once', v->'once',
      'return_delay_days', jsonb_build_object('median', v->'state'->'stats'->'median_days', 'p25', v->'state'->'stats'->'p25_days',
                                              'p75', v->'state'->'stats'->'p75_days', 'returners', v->'state'->'stats'->'returners'),
      'newcomers_returned_6_months', jsonb_build_object('eligible', v->'state'->'stats'->'eligible', 'returned', v->'state'->'stats'->'returned'),
      'coverage', v->'state'->'coverage',
      'artists', CASE WHEN jsonb_typeof(v2) = 'object' AND v2 ? 'artists' THEN jsonb_build_object(
                   'baseline_return_rate', v2->'baseline'->'rate',
                   'top', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                             'name', x->>'name', 'nights', x->'nights', 'entries', x->'entries', 'newcomers', x->'new_brought',
                             'newcomers_returned_6_months', x->'new_returned', 'newcomers_eligible', x->'new_eligible',
                             'return_rate', x->'return_rate', 'seen_twice_or_more', x->'fans', 'resident', x->'resident'))), '[]'::jsonb)
                             FROM jsonb_array_elements(v2->'artists') x)) ELSE v2 END);

  -- ── Fiches clients (niveau 'customers' seulement) ─────────────────────────
  WHEN 'list_customers' THEN
    v_limit := greatest(1, least(coalesce(nullif(p_args->>'limit', '')::integer, 25), 50));
    v_offset := greatest(0, least(coalesce(nullif(p_args->>'offset', '')::integer, 0), 500));
    -- Filtre de l'analyse client : clients qui portent une hypothèse (moyenne ou
    -- forte), ou « de passage » / habitant à proximité. Liste Clients du CRM.
    IF nullif(p_args->>'hypothesis', '') IS NOT NULL OR nullif(p_args->>'passing', '') IS NOT NULL THEN
      v := public.crm_clients_list(v_venue, v_org,
             jsonb_build_object('seg', 'all', 'f', jsonb_strip_nulls(jsonb_build_object(
               'hyp', CASE WHEN p_args->>'hypothesis' ~ '^[a-z_]{2,24}$' THEN jsonb_build_array(p_args->>'hypothesis') END,
               'pass', CASE WHEN p_args->>'passing' = 'true' THEN 'yes' WHEN p_args->>'passing' = 'false' THEN 'no' END))),
             CASE WHEN p_args->>'sort' = 'name' THEN 'name' WHEN p_args->>'sort' = 'events' THEN 'n'
                  WHEN p_args->>'sort' = 'spent' THEN 'sp' ELSE 'last' END, 1, v_limit, v_offset);
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'first_name', x->>'first_name', 'last_name', x->>'last_name', 'email', x->>'email',
               'lifecycle', x->>'lifecycle', 'events', x->'nights', 'last_seen_at', x->>'last_night',
               'total_spent', x->'spent', 'email_ok', x->'email_ok', 'sms_ok', x->'phone_ok'))), '[]'::jsonb)
        INTO v2
        FROM jsonb_array_elements(coalesce(v->'rows', '[]'::jsonb)) x;
      RETURN jsonb_build_object('ok', true, 'total', v->'total', 'offset', v_offset, 'limit', v_limit,
                                'filter', jsonb_strip_nulls(jsonb_build_object('hypothesis', p_args->>'hypothesis', 'passing', p_args->'passing')),
                                'customers', v2);
    END IF;
    v := public.list_contact_base(v_venue, v_org,
           nullif(btrim(coalesce(p_args->>'search', '')), ''),
           CASE WHEN p_args->>'segment_id' ~* '^[0-9a-f-]{36}$' THEN (p_args->>'segment_id')::uuid END,
           CASE WHEN p_args->>'status' IN ('active', 'passive', 'silent', 'new', 'unsubscribed', 'unreachable') THEN p_args->>'status' END,
           CASE WHEN p_args->>'origin' IN ('import', 'yuno', 'both') THEN p_args->>'origin' END,
           NULL,
           CASE WHEN p_args->>'sort' IN ('recent', 'engaged', 'spent', 'events', 'name') THEN p_args->>'sort' ELSE 'spent' END,
           v_limit, v_offset);
    SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'first_name', x->>'first_name', 'last_name', x->>'last_name', 'email', x->>'email',
             'phone', CASE WHEN coalesce((p_args->>'include_phone')::boolean, false) THEN x->>'phone_e164' END,
             'city', x->>'city', 'age', x->'age', 'gender', x->>'gender', 'status', x->>'status',
             'origin', x->>'origin', 'total_spent', x->'total_spent', 'events', x->'event_count',
             'tables', x->'table_count', 'tickets', x->'ticket_count', 'guest_lists', x->'guest_list_count',
             'last_seen_at', x->>'last_seen_at', 'emails_received', x->'emails_sent', 'opens', x->'opens',
             'clicks', x->'clicks', 'email_ok', x->'email_ok', 'sms_ok', x->'phone_ok'))), '[]'::jsonb)
      INTO v2
      FROM jsonb_array_elements(coalesce(v->'rows', '[]'::jsonb)) x;
    RETURN jsonb_build_object('ok', true, 'total', v->'total', 'offset', v_offset, 'limit', v_limit, 'customers', v2);

  WHEN 'list_customers_by_segment' THEN
    v_limit := greatest(1, least(coalesce(nullif(p_args->>'limit', '')::integer, 25), 50));
    v_topic := nullif(p_args->>'segment', '');
    IF v_crm THEN
      v_ref := CASE WHEN v_topic IN ('champions', 'loyal') THEN 'hab' WHEN v_topic = 'promising' THEN 'occ'
                    WHEN v_topic = 'new' THEN 'nou' WHEN v_topic IN ('at_risk', 'dormant', 'lost', 'churn_risk') THEN 'end' END;
      v := public.crm_clients_list(v_venue, v_org, jsonb_build_object('seg', coalesce(v_ref, 'all'), 'f', '{}'::jsonb),
             'sp', 1, v_limit, 0);
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'first_name', x->>'first_name', 'last_name', x->>'last_name', 'email', x->>'email',
               'lifecycle', x->>'lifecycle', 'events', x->'nights', 'last_seen_at', x->>'last_night',
               'total_spent', x->'spent', 'email_ok', x->'email_ok', 'sms_ok', x->'phone_ok'))), '[]'::jsonb)
        INTO v2
        FROM jsonb_array_elements(coalesce(v->'rows', '[]'::jsonb)) x;
      RETURN jsonb_build_object('ok', true, 'segment', v_topic, 'lifecycle', v_ref, 'total', v->'total', 'customers', v2,
        'note', 'Yuno CRM account: segment mapped to the CRM lifecycle (champions/loyal = regulars, promising = occasional, new = new, at_risk/dormant/lost/churn_risk = lapsed).');
    END IF;
    IF v_venue IS NOT NULL THEN
      SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO v FROM (
        SELECT s.first_name, s.last_name, s.email, s.total_spent, s.visit_nights AS nights, s.ticket_count AS tickets,
               s.table_count AS tables, s.avg_basket, s.recency_days, s.last_visit_at, s.rfm_segment, s.rfm_tier,
               s.churn_risk, s.preferred_event_title
          FROM public.get_venue_customer_segments(v_venue) s
         WHERE NOT coalesce(s.is_banned, false)
           AND (v_topic IS NULL OR s.rfm_segment = v_topic OR (v_topic = 'churn_risk' AND s.churn_risk))
         ORDER BY s.total_spent DESC NULLS LAST LIMIT v_limit) q;
    ELSE
      SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO v FROM (
        SELECT s.first_name, s.last_name, s.email, s.total_spent, s.visit_nights AS nights, s.ticket_count AS tickets,
               s.table_count AS tables, s.avg_basket, s.recency_days, s.last_visit_at, s.rfm_segment, s.rfm_tier,
               s.churn_risk, s.preferred_event_title
          FROM public.get_organizer_customer_segments(v_org) s
         WHERE NOT coalesce(s.is_banned, false)
           AND (v_topic IS NULL OR s.rfm_segment = v_topic OR (v_topic = 'churn_risk' AND s.churn_risk))
         ORDER BY s.total_spent DESC NULLS LAST LIMIT v_limit) q;
    END IF;
    RETURN jsonb_build_object('ok', true, 'segment', v_topic, 'customers', v);

  WHEN 'get_customer_profile' THEN
    v_ref := lower(btrim(coalesce(p_args->>'email', '')));
    IF v_ref !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_args', 'message', 'email required');
    END IF;
    -- La base de contacts filtrée par l'adresse (350 ms), pas contact_rows()
    -- entier (jusqu'à 20 s sur un compte CRM : la fiche ne répondait jamais).
    v2 := public.list_contact_base(v_venue, v_org, v_ref, NULL, NULL, NULL, NULL, 'recent', 10, 0);
    SELECT x - 'id' - 'list_import_id' INTO v
      FROM jsonb_array_elements(coalesce(v2->'rows', '[]'::jsonb)) x
     WHERE lower(x->>'email') = v_ref LIMIT 1;
    IF v IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'customer_not_found'); END IF;
    BEGIN v2 := public.get_customer_automation_emails(v_venue, v_org, v_ref);
    EXCEPTION WHEN others THEN v2 := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    -- Analyse client : ses hypothèses (des FAITS + le statut de leur famille
    -- sur le compte), jamais une affirmation de motif.
    BEGIN
      v3 := public.crm_client_analysis(v_venue, v_org, v_ref);
      v3 := CASE WHEN coalesce((v3->>'profile')::boolean, false) THEN jsonb_build_object(
              'excluded_from_profiling', v3->'excluded', 'nights', v3->'nights', 'distance_km', v3->'dist_km',
              'passing_through', v3->'passing',
              'hypotheses', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                               'family', h->>'f', 'strength', h->>'s', 'evidence_key', h->>'k', 'evidence', h->'p',
                               'family_status_on_account', h->>'status', 'family_availability', h->>'availability',
                               'direction', h->>'direction'))), '[]'::jsonb)
                               FROM jsonb_array_elements(coalesce(v3->'hyps', '[]'::jsonb)) h),
              'chances_to_come', CASE WHEN v3->>'score_status' = 'ok' THEN v3->'chances' END,
              'first_night', jsonb_strip_nulls(jsonb_build_object(
                'title', v3->'first'->>'title', 'date', v3->'first'->>'start_at', 'days_before', v3->'first'->'lead_days',
                'source', v3->'first'->>'src', 'order_size', v3->'first'->'order_size',
                'with_existing_customer', v3->'first'->'with_returning', 'invitation', v3->'first'->'invitation')))
            ELSE jsonb_build_object('excluded_from_profiling', v3->'excluded', 'hypotheses', '[]'::jsonb,
                                    'note', 'No analysis profile: no Shotgun ticket for this contact, or excluded at their request.') END;
    EXCEPTION WHEN others THEN v3 := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    RETURN jsonb_build_object('ok', true, 'customer', v, 'automation_emails', v2, 'analysis', v3);

  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
  END CASE;
END;
$function$;
REVOKE ALL ON FUNCTION public._mcp_tool(p_tool text, p_kind text, p_space_id text, p_product text, p_tz text, p_args jsonb, p_level text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._mcp_tool(p_tool text, p_kind text, p_space_id text, p_product text, p_tz text, p_args jsonb, p_level text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_sms_campaign_report(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.sms_campaigns%ROWTYPE;
  v jsonb;
BEGIN
  SELECT * INTO c FROM public.sms_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND OR c.product = 'crm' THEN RETURN NULL; END IF;
  IF NOT public.sms_scope_allowed(c.venue_id, c.organizer_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  WITH r AS (
    SELECT * FROM public.sms_campaign_recipients WHERE campaign_id = p_campaign_id
  ),
  counts AS (
    SELECT
      count(*)                                                    AS total,
      count(*) FILTER (WHERE status = 'pending')                  AS pending,
      count(*) FILTER (WHERE status = 'sending')                  AS sending,
      count(*) FILTER (WHERE status IN ('sent','delivered','undelivered')) AS sent,
      count(*) FILTER (WHERE status = 'delivered')                AS delivered,
      count(*) FILTER (WHERE status = 'undelivered')              AS undelivered,
      count(*) FILTER (WHERE status = 'failed')                   AS failed,
      count(*) FILTER (WHERE status = 'skipped')                  AS skipped,
      COALESCE(sum(credits) FILTER (WHERE status IN ('sent','delivered','undelivered','failed')), 0) AS credits
    FROM r
  ),
  clicks AS (
    SELECT count(*) AS n, count(DISTINCT COALESCE(visitor_id, ip_hash, id::text)) AS uniq
      FROM public.tracked_link_clicks tc
     WHERE c.tracked_link_id IS NOT NULL
       AND tc.tracked_link_id = c.tracked_link_id
       AND tc.clicked_at >= COALESCE(c.send_started_at, c.created_at)
  ),
  sales AS (
    SELECT
      (SELECT count(*) FROM public.tickets t
        WHERE c.tracked_link_id IS NOT NULL AND t.tracked_link_id = c.tracked_link_id
          AND t.status = 'paid' AND t.created_at >= COALESCE(c.send_started_at, c.created_at)) AS tickets,
      (SELECT COALESCE(sum((greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0) - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)))), 0) FROM public.tickets t
        WHERE c.tracked_link_id IS NOT NULL AND t.tracked_link_id = c.tracked_link_id
          AND t.status = 'paid' AND t.created_at >= COALESCE(c.send_started_at, c.created_at)) AS tickets_revenue,
      (SELECT count(*) FROM public.table_reservations tr
        WHERE c.tracked_link_id IS NOT NULL AND tr.tracked_link_id = c.tracked_link_id
          AND tr.status = 'paid' AND tr.created_at >= COALESCE(c.send_started_at, c.created_at)) AS tables,
      (SELECT COALESCE(sum((greatest(tr.total_price - coalesce(tr.service_fee, 0) - (CASE WHEN coalesce(tr.fee_absorbed, false) THEN coalesce(tr.management_fee, 0) ELSE 0 END), 0) - least(greatest(coalesce(tr.refund_amount, 0), 0), greatest(tr.total_price - coalesce(tr.service_fee, 0) - (CASE WHEN coalesce(tr.fee_absorbed, false) THEN coalesce(tr.management_fee, 0) ELSE 0 END), 0)))), 0) FROM public.table_reservations tr
        WHERE c.tracked_link_id IS NOT NULL AND tr.tracked_link_id = c.tracked_link_id
          AND tr.status = 'paid' AND tr.created_at >= COALESCE(c.send_started_at, c.created_at)) AS tables_revenue
  ),
  timeline AS (
    SELECT date_trunc('hour', delivered_at) AS h, count(*) AS n
      FROM r WHERE delivered_at IS NOT NULL
     GROUP BY 1 ORDER BY 1
     LIMIT 72
  )
  SELECT jsonb_build_object(
    'id', c.id, 'name', c.name, 'status', c.status::text, 'paused_reason', c.paused_reason,
    'error_message', c.error_message, 'body_template', c.body_template, 'sender_name', c.sender_name,
    'segment_filters', c.segment_filters, 'event_id', c.event_id,
    'scheduled_at', c.scheduled_at, 'send_started_at', c.send_started_at, 'sent_at', c.sent_at,
    'created_at', c.created_at, 'quiet_hours', c.quiet_hours,
    'segments_per_message', c.segments_per_message,
    'credits_consumed', c.credits_consumed, 'credits_refunded', c.credits_refunded,
    'tracked_link_code', (SELECT code FROM public.tracked_links WHERE tracked_links.id = c.tracked_link_id),
    'counts', (SELECT to_jsonb(counts) FROM counts),
    'clicks', (SELECT to_jsonb(clicks) FROM clicks),
    'sales',  (SELECT to_jsonb(sales) FROM sales),
    'timeline', COALESCE((SELECT jsonb_agg(jsonb_build_object('hour', h, 'delivered', n)) FROM timeline), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_sms_campaign_report(p_campaign_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sms_campaign_report(p_campaign_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_sms_contacts_overview(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT public.sms_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  WITH base AS (
    SELECT c.*
      FROM public.venue_sms_contacts c
     WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND c.product IS NULL
  ),
  live AS (
    SELECT * FROM base
     WHERE NOT unsubscribed AND sms_consent_at > now() - interval '36 months'
  ),
  per_event AS (
    SELECT l.source_event_id AS event_id, e.title, e.start_at, count(DISTINCT l.phone_e164) AS n
      FROM live l JOIN public.events e ON e.id = l.source_event_id AND e.external_source IS NULL
     GROUP BY l.source_event_id, e.title, e.start_at
     ORDER BY e.start_at DESC
     LIMIT 12
  ),
  imports AS (
    SELECT li.id, li.list_name, li.filename, li.created_at,
           (SELECT count(DISTINCT l.phone_e164) FROM live l WHERE l.import_id = li.id) AS n
      FROM public.sms_list_imports li
     WHERE public.marketing_scope_match(li.venue_id, li.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND li.product IS NULL
       AND li.superseded_by IS NULL
     ORDER BY li.created_at DESC
     LIMIT 24
  )
  SELECT jsonb_build_object(
    'active',       (SELECT count(DISTINCT phone_e164) FROM live),
    'vip',          (SELECT count(DISTINCT phone_e164) FROM live WHERE is_vip),
    'last_30d',     (SELECT count(DISTINCT phone_e164) FROM live WHERE sms_consent_at > now() - interval '30 days'),
    'imported',     (SELECT count(DISTINCT phone_e164) FROM live WHERE import_id IS NOT NULL),
    'unsubscribed', (SELECT count(*) FROM base WHERE unsubscribed),
    'events',       COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'event_id', event_id, 'title', title, 'start_at', start_at, 'contacts', n
                      )) FROM per_event), '[]'::jsonb),
    'imports',      COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'id', id, 'list_name', list_name, 'filename', filename, 'created_at', created_at, 'contacts', n
                      )) FROM imports), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_sms_contacts_overview(p_venue_id text, p_organizer_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sms_contacts_overview(p_venue_id text, p_organizer_user_id uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.get_sms_sender_readiness(text, uuid);
CREATE OR REPLACE FUNCTION public.get_sms_sender_readiness(p_venue_id text, p_organizer_user_id uuid, p_product text DEFAULT 'crm'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_legal   text;
  v_siret   text;
  v_rna     text;
  v_vat     text;
  v_has_id  boolean;
  v_missing text[] := ARRAY[]::text[];
  v_last    text;
  -- 'crm' (défaut : tous les appelants SQL sont des fonctions CRM) = identité d'annonceur du CRM ;
  -- tout autre produit ('suite') = fiche légale de la Billetterie (appelant : send-sms-campaign).
  v_crm     boolean := COALESCE(p_product = 'crm', false);
  v_sug     jsonb := NULL;
BEGIN
  -- Lecture : la porte du produit demandé (Console CRM ou SMS de la Billetterie).
  IF NOT COALESCE(CASE WHEN v_crm THEN public.crm_scope_allowed(p_venue_id, p_organizer_user_id)
                       ELSE public.sms_scope_allowed(p_venue_id, p_organizer_user_id) END, false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_venue_id IS NULL AND p_organizer_user_id IS NULL THEN
    RETURN jsonb_build_object('identity_ok', true, 'missing', '[]'::jsonb, 'last_sender_id', 'YUNO');
  END IF;

  IF v_crm THEN
    -- Yuno CRM : SA propre identité d'annonceur (crm_sms_settings). La fiche légale du compte
    -- (vendeur des reçus de la Billetterie) n'est qu'une suggestion, jamais lue comme identité du CRM.
    SELECT s.legal_name, s.siret, s.rna_number, s.vat_number
      INTO v_legal, v_siret, v_rna, v_vat
      FROM public.crm_sms_settings s WHERE s.scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id);
    IF p_venue_id IS NOT NULL THEN
      SELECT jsonb_strip_nulls(jsonb_build_object('legal_name', NULLIF(btrim(v.legal_name), ''),
               'registration', COALESCE(NULLIF(btrim(v.siret), ''), NULLIF(btrim(v.vat_number), ''))))
        INTO v_sug FROM public.venues v WHERE v.id = p_venue_id;
    ELSE
      SELECT jsonb_strip_nulls(jsonb_build_object('legal_name', NULLIF(btrim(o.legal_name), ''),
               'registration', COALESCE(NULLIF(btrim(o.siret), ''), NULLIF(btrim(o.rna_number), ''), NULLIF(btrim(o.vat_number), ''))))
        INTO v_sug FROM public.organizer_profiles o WHERE o.user_id = p_organizer_user_id;
    END IF;
  ELSIF p_venue_id IS NOT NULL THEN
    SELECT v.legal_name, v.siret, NULL::text, v.vat_number
      INTO v_legal, v_siret, v_rna, v_vat
      FROM public.venues v WHERE v.id = p_venue_id;
  ELSE
    SELECT o.legal_name, o.siret, o.rna_number, o.vat_number
      INTO v_legal, v_siret, v_rna, v_vat
      FROM public.organizer_profiles o WHERE o.user_id = p_organizer_user_id;
  END IF;

  v_has_id := length(regexp_replace(COALESCE(v_siret, ''), '[^0-9]', '', 'g')) = 14
           OR upper(regexp_replace(COALESCE(v_rna, ''), '\s', '', 'g')) ~ '^W[0-9]{9}$'
           OR length(btrim(COALESCE(v_vat, ''))) >= 6;

  IF length(btrim(COALESCE(v_legal, ''))) < 2 THEN v_missing := array_append(v_missing, 'legal_name'); END IF;
  IF NOT v_has_id THEN v_missing := array_append(v_missing, 'registration'); END IF;

  -- Nom d'expéditeur à proposer : celui des Réglages SMS de la Console, sinon
  -- le dernier utilisé par la portée (colonne , ou 
  -- quand il suit déjà les règles, comme dans la Console CRM).
  SELECT s.sender_name INTO v_last FROM public.crm_sms_settings s
   WHERE v_crm AND s.scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id)
     AND s.sender_name ~ '^[A-Za-z0-9]{3,11}$';
  IF v_last IS NULL THEN
    SELECT COALESCE(c.sender_id, c.sender_name) INTO v_last
      FROM public.sms_campaigns c
     WHERE c.product IS NOT DISTINCT FROM (CASE WHEN v_crm THEN 'crm' END)
       AND (c.sender_id IS NOT NULL OR c.sender_name ~ '^[A-Za-z0-9]{3,11}$')
       AND ((p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
         OR (p_venue_id IS NULL AND c.organizer_id = p_organizer_user_id))
     ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC
     LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'identity_ok', cardinality(v_missing) = 0,
    'missing', to_jsonb(v_missing),
    'last_sender_id', v_last,
    -- Proposition « Utiliser … » (fiche légale du compte) quand l'identité CRM est incomplète ; jamais recopiée d'office.
    'suggest', CASE WHEN cardinality(v_missing) > 0 THEN v_sug END
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_sms_sender_readiness(text, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sms_sender_readiness(text, uuid, text) TO authenticated, service_role;
