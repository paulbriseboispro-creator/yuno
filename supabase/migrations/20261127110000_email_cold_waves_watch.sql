-- Envoi progressif des adresses froides + surveillance de la délivrabilité (03/11).
--
-- Pourquoi : les trois incidents Gmail (01/09, 09/09, 08/10) viennent du même
-- geste, un fichier importé envoyé d'un coup à des milliers de personnes qui
-- n'avaient jamais reçu un e-mail de Yuno. Le pro doit pouvoir écrire à toute
-- sa base ; Yuno doit seulement le faire PAR ÉTAPES, et s'arrêter tout seul si
-- une étape tourne mal. Rien ici n'empêche une campagne de partir : la partie
-- « chaude » de l'audience part tout de suite, la partie froide est testée.
--
-- 1. Chaleur d'une adresse, à la mise en file d'une campagne marketing :
--    chaude  = a ouvert ou cliqué un e-mail Yuno sous 180 jours, ou vient de
--              s'inscrire elle-même (_email_fresh_optins) ;
--    connue  = a déjà reçu un e-mail marketing Yuno sous 365 jours ;
--    froide  = rien de tout ça (typiquement : un fichier importé, une base
--              recopiée d'une billetterie, « Vos clients » jamais écrits).
-- 2. Vagues : chaudes et connues partent tout de suite. Les froides partent en
--    vagues (100, 200, 400… jusqu'à 1 600), la première tout de suite, chacune
--    jugée 3 h après son dernier envoi sur TOUT le froid déjà parti :
--    rebonds > 3 %, plaintes > 1 ‰, ouvertures < 4 % (dès 100 envois), ou
--    Gmail < 2 % d'ouvertures ou moitié moins que les autres messageries (dès
--    50 envois Gmail et 50 autres) ⇒ ARRÊT : le reste du froid
--    n'est pas envoyé (Yunits rendus), le compte passe 21 jours « à l'écart »
--    (plus aucun froid), alerte super admin. Sinon la vague suivante part.
--    Une base froide de 50 adresses ou moins part en une fois.
-- 3. Plafond : 1 000 adresses froides par jour et par compte, dont 200 Gmail au
--    plus, toutes campagnes confondues ; le reste part le lendemain. Gmail a
--    son plafond et sa règle à lui parce qu'il ne transmet AUCUNE plainte : le
--    08/10, 6 % des Gmail avaient ouvert en 2 h, un seuil fixe ne voyait rien ;
--    seul le volume et l'écart avec les autres messageries le trahissent.
-- 4. Soirée : plus aucune vague dans les 3 heures avant le début de la soirée
--    de la campagne (le froid restant est noté « trop tard »).
-- 4 bis. Envoi réparti OBLIGATOIRE (demande de Paul, 03/11) : une campagne
--    marketing de 100 personnes ou plus ne part jamais d'un coup. Sans
--    répartition choisie, Yuno impose 250 e-mails par heure ; une répartition
--    choisie est ramenée à 400 par heure au plus. Pendant la reprise Gmail,
--    chaque compte envoie au plus 1 500 e-mails de campagne par jour, tous
--    envois confondus (email_sender_daily_cap) ; les adresses engagées partent
--    en premier (une adresse « connue » sans ouverture attend 90 minutes), et
--    plus rien de marketing ne part une fois la soirée de la campagne commencée. Seuls les comptes que le
--    super admin autorise (« a fait ses preuves », email_sender_health.
--    burst_allowed, geste audité) gardent l'envoi « tout d'un coup ».
-- 5. Surveillance (toutes les heures) : un compte dont les 7 derniers jours
--    dépassent 3 % de rebonds ou 1 ‰ de plaintes passe à l'écart ; une chute
--    des ouvertures Gmail sur toute la plateforme rallume le mode reprise Gmail
--    et alerte le super admin.
--
-- Mécanique : celle de la montée progressive de « Vos clients ». Une ligne en
-- attente de vague garde `status = 'pending'` avec `next_attempt_at =
-- 'infinity'` : claim_campaign_recipients ne la prend pas, la campagne reste
-- « en cours » et le balayage existant la reprend dès qu'elle est libérée.
-- Aucun code d'envoi n'est modifié.

ALTER TABLE public.email_deliverability_settings
  ADD COLUMN IF NOT EXISTS waves_on boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cold_small_max integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS wave_first integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS wave_max integer NOT NULL DEFAULT 1600,
  ADD COLUMN IF NOT EXISTS wave_wait_minutes integer NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS cold_daily_cap integer NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS cold_gmail_daily_cap integer NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS halt_gmail_relative numeric NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS halt_bounce_pct numeric NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS halt_complaint_permille numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS halt_open_pct numeric NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS halt_gmail_open_pct numeric NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS probation_days integer NOT NULL DEFAULT 21,
  ADD COLUMN IF NOT EXISTS gmail_auto_recovery boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS force_spread boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS spread_min_audience integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS spread_per_hour integer NOT NULL DEFAULT 250,
  ADD COLUMN IF NOT EXISTS spread_max_per_hour integer NOT NULL DEFAULT 400,
  ADD COLUMN IF NOT EXISTS recovery_daily_cap integer NOT NULL DEFAULT 1500;

ALTER TABLE public.email_campaign_recipients
  ADD COLUMN IF NOT EXISTS wave smallint,
  ADD COLUMN IF NOT EXISTS wave_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS wave_released_at timestamptz;

ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS wave_total smallint,
  ADD COLUMN IF NOT EXISTS wave_released smallint,
  ADD COLUMN IF NOT EXISTS wave_state text,
  ADD COLUMN IF NOT EXISTS wave_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS wave_note jsonb,
  ADD COLUMN IF NOT EXISTS spread_forced boolean;
ALTER TABLE public.email_campaigns DROP CONSTRAINT IF EXISTS email_campaigns_wave_state_check;
ALTER TABLE public.email_campaigns ADD CONSTRAINT email_campaigns_wave_state_check
  CHECK (wave_state IS NULL OR wave_state IN ('testing', 'done', 'halted'));

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_wave_held
  ON public.email_campaign_recipients (campaign_id, wave)
  WHERE status = 'pending' AND wave IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_wave_released
  ON public.email_campaign_recipients (wave_released_at)
  WHERE wave IS NOT NULL AND wave_released_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_campaigns_wave_testing
  ON public.email_campaigns (id) WHERE wave_state = 'testing';

-- Santé d'un compte expéditeur (même clé que le quota : venue:… / org:… / yuno).
CREATE TABLE IF NOT EXISTS public.email_sender_health (
  scope_key text PRIMARY KEY,
  cold_frozen_until timestamptz,
  reason text,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  burst_allowed boolean NOT NULL DEFAULT false,
  burst_set_by uuid,
  burst_set_at timestamptz,
  burst_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.email_sender_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_sender_health FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._email_sender_key(p_venue_id text, p_organizer_user_id uuid)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT CASE WHEN p_venue_id IS NOT NULL THEN 'venue:' || p_venue_id
                  WHEN p_organizer_user_id IS NOT NULL THEN 'org:' || p_organizer_user_id::text
                  ELSE 'yuno' END $$;
REVOKE ALL ON FUNCTION public._email_sender_key(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._email_sender_key(text, uuid) TO service_role;

-- Écarte des lignes en attente (froid arrêté, trop tard, compte à l'écart) :
-- statut, compteurs de la campagne, Yunits rendus pour une campagne CRM.
CREATE OR REPLACE FUNCTION public._email_skip_rows(p_campaign_id uuid, p_ids uuid[], p_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  n integer := 0;
  c record;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN 0; END IF;
  UPDATE public.email_campaign_recipients r
     SET status = 'skipped', error_message = 'policy:' || p_reason, next_attempt_at = NULL
   WHERE r.id = ANY (p_ids) AND r.campaign_id = p_campaign_id AND r.status = 'pending';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN 0; END IF;
  SELECT ec.venue_id, ec.organizer_user_id, ec.name INTO c FROM public.email_campaigns ec WHERE ec.id = p_campaign_id;
  UPDATE public.email_campaigns
     SET policy_skipped_count = COALESCE(policy_skipped_count, 0) + n,
         total_recipients = GREATEST(0, COALESCE(total_recipients, 0) - n)
   WHERE id = p_campaign_id;
  IF COALESCE(public.crm_campaign_is_crm(p_campaign_id), false)
     AND public.crm_scope_key(c.venue_id, c.organizer_user_id) IS NOT NULL THEN
    PERFORM public.crm_yunits_refund(public.crm_scope_key(c.venue_id, c.organizer_user_id), n,
                                     'email', 'email_campaign', p_campaign_id::text, c.name);
  END IF;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public._email_skip_rows(uuid, uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._email_skip_rows(uuid, uuid[], text) TO service_role;

-- Libère ce que le plafond du jour permet parmi les vagues déjà ouvertes.
CREATE OR REPLACE FUNCTION public._email_release_waves(p_campaign_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  s public.email_deliverability_settings;
  c record;
  v_key text;
  v_used integer;
  v_gused integer;
  v_room integer;
  v_groom integer;
  n integer := 0;
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
BEGIN
  SELECT * INTO s FROM public.email_deliverability_settings WHERE id;
  SELECT ec.venue_id, ec.organizer_user_id, ec.wave_released INTO c FROM public.email_campaigns ec WHERE ec.id = p_campaign_id;
  v_key := public._email_sender_key(c.venue_id, c.organizer_user_id);
  SELECT count(*), count(*) FILTER (WHERE public._email_is_gmail(r.email)) INTO v_used, v_gused
    FROM public.email_campaign_recipients r
    JOIN public.email_campaigns ec ON ec.id = r.campaign_id
   WHERE r.wave >= 1 AND r.wave_released_at IS NOT NULL
     AND (r.wave_released_at AT TIME ZONE 'Europe/Paris')::date = v_today
     AND public._email_sender_key(ec.venue_id, ec.organizer_user_id) = v_key
     AND ec.wave_state IS NOT NULL;
  v_room := GREATEST(0, s.cold_daily_cap - v_used);
  v_groom := GREATEST(0, s.cold_gmail_daily_cap - v_gused);
  IF v_room = 0 THEN RETURN 0; END IF;
  WITH cand AS (
    SELECT r.id, r.wave, public._email_is_gmail(r.email) AS gm,
           row_number() OVER (PARTITION BY public._email_is_gmail(r.email) ORDER BY r.wave, r.id) AS rk
      FROM public.email_campaign_recipients r
     WHERE r.campaign_id = p_campaign_id AND r.status = 'pending'
       AND r.wave BETWEEN 1 AND COALESCE(c.wave_released, 0)
       AND r.wave_released_at IS NULL
  ), pick AS (
    SELECT cand.id FROM cand
     WHERE NOT cand.gm OR cand.rk <= v_groom
     ORDER BY cand.wave, cand.id
     LIMIT v_room
  )
  UPDATE public.email_campaign_recipients r
     SET next_attempt_at = GREATEST(now(), COALESCE(r.wave_due_at, now())),
         wave_released_at = now()
    FROM pick WHERE r.id = pick.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public._email_release_waves(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._email_release_waves(uuid) TO service_role;

-- Envoi réparti obligatoire (compte non autorisé « tout d'un coup »).
CREATE OR REPLACE FUNCTION public._email_enforce_spread(p_campaign_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  s public.email_deliverability_settings;
  c record;
  v_win integer;
  v_cap integer;
BEGIN
  SELECT * INTO s FROM public.email_deliverability_settings WHERE id;
  IF NOT FOUND OR NOT s.force_spread THEN RETURN false; END IF;
  SELECT ec.venue_id, ec.organizer_user_id, ec.total_recipients, ec.throttle_per_hour, ec.throttle_window_minutes
    INTO c FROM public.email_campaigns ec WHERE ec.id = p_campaign_id;
  IF NOT FOUND OR COALESCE(c.total_recipients, 0) < s.spread_min_audience THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.email_sender_health h
              WHERE h.scope_key = public._email_sender_key(c.venue_id, c.organizer_user_id) AND h.burst_allowed) THEN
    RETURN false;
  END IF;
  v_win := COALESCE(c.throttle_window_minutes, 60);
  IF c.throttle_per_hour IS NULL THEN
    UPDATE public.email_campaigns
       SET throttle_per_hour = s.spread_per_hour, throttle_window_minutes = 60, spread_forced = true
     WHERE id = p_campaign_id;
    RETURN true;
  END IF;
  v_cap := GREATEST(10, floor(s.spread_max_per_hour * v_win / 60.0)::int);
  IF c.throttle_per_hour > v_cap THEN
    UPDATE public.email_campaigns SET throttle_per_hour = v_cap, spread_forced = true WHERE id = p_campaign_id;
    RETURN true;
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public._email_enforce_spread(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._email_enforce_spread(uuid) TO service_role;

-- À la mise en file : chaleur, vagues, compte à l'écart. Fusionne dans le
-- résultat de enqueue_campaign_recipients comme le fait « Vos clients ».
CREATE OR REPLACE FUNCTION public._email_assign_waves(p_campaign_id uuid, p_res jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  s public.email_deliverability_settings;
  c record;
  v_key text;
  v_cold integer := 0;
  v_frozen integer := 0;
  v_bounds integer[] := '{}';
  v_size integer;
  v_sum integer := 0;
  v_waves integer := 0;
  v_ids uuid[];
  v_released integer := 0;
BEGIN
  SELECT * INTO s FROM public.email_deliverability_settings WHERE id;
  IF NOT FOUND THEN RETURN p_res; END IF;
  SELECT ec.venue_id, ec.organizer_user_id, ec.type, ec.practical, ec.wave_state INTO c
    FROM public.email_campaigns ec WHERE ec.id = p_campaign_id;
  IF NOT FOUND OR COALESCE(c.type, 'promotional') = 'informational' OR COALESCE(c.practical, false)
     OR c.wave_state IS NOT NULL THEN
    RETURN p_res;
  END IF;
  -- Envoi réparti obligatoire, avant tout : il vaut pour l'audience entière.
  IF public._email_enforce_spread(p_campaign_id) THEN
    p_res := p_res || jsonb_build_object('spread_forced', true);
  END IF;
  IF NOT s.waves_on THEN RETURN p_res; END IF;
  v_key := public._email_sender_key(c.venue_id, c.organizer_user_id);

  -- Les adresses froides de la file, rangées dans un ordre stable.
  WITH p AS (
    SELECT r.id, lower(r.email) AS em
      FROM public.email_campaign_recipients r
     WHERE r.campaign_id = p_campaign_id AND r.status = 'pending' AND r.wave IS NULL
  ),
  eng AS (
    SELECT DISTINCT lower(ev.recipient_email) AS em
      FROM public.email_campaign_events ev
     WHERE ev.event_type IN ('opened', 'clicked') AND ev.created_at > now() - interval '180 days'
       AND lower(ev.recipient_email) IN (SELECT em FROM p)
  ),
  known AS (
    SELECT DISTINCT lower(x.email) AS em
      FROM public.email_campaign_recipients x
     WHERE x.status = 'sent' AND x.sent_at > now() - interval '365 days'
       AND x.campaign_id <> p_campaign_id
       AND lower(x.email) IN (SELECT em FROM p)
    UNION
    SELECT DISTINCT lower(l.email)
      FROM public.marketing_email_log l
     WHERE l.sent_at > now() - interval '365 days'
       AND lower(l.email) IN (SELECT em FROM p)
  ),
  fr AS (SELECT f.em FROM public._email_fresh_optins(ARRAY(SELECT em FROM p)) f)
  SELECT array_agg(p.id ORDER BY md5(p.em), p.id) INTO v_ids
    FROM p
   WHERE NOT EXISTS (SELECT 1 FROM eng WHERE eng.em = p.em)
     AND NOT EXISTS (SELECT 1 FROM known WHERE known.em = p.em)
     AND NOT EXISTS (SELECT 1 FROM fr WHERE fr.em = p.em);
  v_cold := COALESCE(cardinality(v_ids), 0);

  -- Les engagés d'abord : une adresse déjà écrite mais sans ouverture ni clic
  -- récent attend 90 minutes, pour que les premières places du plafond du jour
  -- aillent à ceux qui ouvrent (c'est ce que Gmail regarde).
  UPDATE public.email_campaign_recipients r
     SET next_attempt_at = GREATEST(COALESCE(r.next_attempt_at, now()), now() + interval '90 minutes')
   WHERE r.campaign_id = p_campaign_id AND r.status = 'pending' AND r.wave IS NULL
     AND NOT (r.id = ANY (COALESCE(v_ids, '{}'::uuid[])))
     AND NOT EXISTS (SELECT 1 FROM public.email_campaign_events ev
                      WHERE ev.event_type IN ('opened', 'clicked') AND ev.created_at > now() - interval '180 days'
                        AND lower(ev.recipient_email) = lower(r.email))
     AND NOT EXISTS (SELECT 1 FROM public._email_fresh_optins(ARRAY[lower(r.email)]));

  IF v_cold = 0 THEN RETURN p_res; END IF;

  -- Compte à l'écart : aucun froid.
  IF EXISTS (SELECT 1 FROM public.email_sender_health h WHERE h.scope_key = v_key AND h.cold_frozen_until > now()) THEN
    v_frozen := public._email_skip_rows(p_campaign_id, v_ids, 'cold_frozen');
    RETURN p_res || jsonb_build_object('cold', v_cold, 'cold_frozen', v_frozen,
      'queued', GREATEST(0, COALESCE((p_res->>'queued')::int, 0) - v_frozen),
      'total', GREATEST(0, COALESCE((p_res->>'total')::int, 0) - v_frozen),
      'remaining', GREATEST(0, COALESCE((p_res->>'remaining')::int, 0) - v_frozen));
  END IF;

  -- Petite base froide : une seule vague (elle reste comptée au plafond du jour).
  IF v_cold <= s.cold_small_max THEN
    v_bounds := ARRAY[v_cold];
  ELSE
    v_size := s.wave_first;
    WHILE v_sum < v_cold LOOP
      v_sum := v_sum + v_size;
      v_bounds := v_bounds || LEAST(v_sum, v_cold);
      v_size := LEAST(v_size * 2, s.wave_max);
    END LOOP;
  END IF;
  v_waves := cardinality(v_bounds);

  UPDATE public.email_campaign_recipients r
     SET wave = (SELECT 1 + count(*) FROM unnest(v_bounds) b WHERE b < q.rk)::smallint,
         wave_due_at = r.next_attempt_at,
         next_attempt_at = 'infinity'
    FROM (SELECT x.id, x.rk FROM unnest(v_ids) WITH ORDINALITY AS x(id, rk)) q
   WHERE r.id = q.id;

  UPDATE public.email_campaigns
     SET wave_total = v_waves, wave_released = 1, wave_state = 'testing', wave_checked_at = now(),
         wave_note = jsonb_build_object('cold', v_cold, 'bounds', to_jsonb(v_bounds))
   WHERE id = p_campaign_id;

  v_released := public._email_release_waves(p_campaign_id);
  RETURN p_res || jsonb_build_object('cold', v_cold, 'waves', v_waves, 'wave1_released', v_released);
END $$;
REVOKE ALL ON FUNCTION public._email_assign_waves(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._email_assign_waves(uuid, jsonb) TO service_role;

-- Branchement dans la mise en file (définition vivante, deux points d'ancrage).
DO $do$
DECLARE
  v_def text := pg_get_functiondef('public.enqueue_campaign_recipients(uuid)'::regprocedure);
  a1 text := E'  IF v_scope IS NULL OR NOT v_crm THEN\n    RETURN v_res;\n  END IF;';
  a2 text := E'  v_res := public._crm_customer_after_enqueue(p_campaign_id, v_res);';
BEGIN
  IF position('_email_assign_waves' in v_def) > 0 THEN RETURN; END IF;
  IF position(a1 in v_def) = 0 OR position(a2 in v_def) = 0 THEN
    RAISE EXCEPTION 'enqueue_campaign_recipients: points d''ancrage introuvables';
  END IF;
  v_def := replace(v_def, a1, E'  IF v_scope IS NULL OR NOT v_crm THEN\n    RETURN public._email_assign_waves(p_campaign_id, v_res);\n  END IF;');
  v_def := replace(v_def, a2, a2 || E'\n  -- Envoi progressif des adresses froides (20261127110000), APRÈS la montée de « Vos clients ».\n  v_res := public._email_assign_waves(p_campaign_id, v_res);');
  EXECUTE v_def;
END $do$;

-- Juge et ouvre les vagues. Appelée par le cron toutes les 15 minutes.
CREATE OR REPLACE FUNCTION public.email_waves_tick()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  s public.email_deliverability_settings;
  c record;
  st record;
  v_key text;
  v_reason text;
  v_ids uuid[];
  v_skipped integer;
  v_out jsonb := '[]'::jsonb;
  v_start timestamptz;
  v_rel smallint;
BEGIN
  SELECT * INTO s FROM public.email_deliverability_settings WHERE id;
  FOR c IN
    SELECT ec.id, ec.name, ec.status, ec.venue_id, ec.organizer_user_id, ec.event_id,
           ec.wave_total, ec.wave_released
      FROM public.email_campaigns ec
     WHERE ec.wave_state = 'testing'
     ORDER BY ec.wave_checked_at NULLS FIRST
     LIMIT 50
  LOOP
    BEGIN
      IF c.status NOT IN ('sending') THEN
        IF c.status IN ('sent', 'failed', 'cancelled') THEN
          UPDATE public.email_campaigns SET wave_state = 'done', wave_checked_at = now() WHERE id = c.id;
        END IF;
        CONTINUE;
      END IF;
      v_key := public._email_sender_key(c.venue_id, c.organizer_user_id);

      -- La soirée approche : le froid restant ne part plus.
      IF c.event_id IS NOT NULL THEN
        SELECT e.start_at INTO v_start FROM public.events e WHERE e.id = c.event_id;
        IF v_start IS NOT NULL AND v_start < now() + interval '3 hours' THEN
          SELECT array_agg(r.id) INTO v_ids FROM public.email_campaign_recipients r
           WHERE r.campaign_id = c.id AND r.status = 'pending' AND r.wave >= 1 AND r.wave_released_at IS NULL;
          v_skipped := public._email_skip_rows(c.id, v_ids, 'cold_wave_late');
          UPDATE public.email_campaigns SET wave_state = 'done', wave_checked_at = now(),
                 wave_note = COALESCE(wave_note, '{}'::jsonb) || jsonb_build_object('late', v_skipped)
           WHERE id = c.id;
          v_out := v_out || jsonb_build_object('campaign', c.id, 'late', v_skipped);
          CONTINUE;
        END IF;
      END IF;

      -- Le compte vient de passer à l'écart : le froid restant ne part plus.
      IF EXISTS (SELECT 1 FROM public.email_sender_health h WHERE h.scope_key = v_key AND h.cold_frozen_until > now()) THEN
        SELECT array_agg(r.id) INTO v_ids FROM public.email_campaign_recipients r
         WHERE r.campaign_id = c.id AND r.status = 'pending' AND r.wave >= 1 AND r.wave_released_at IS NULL;
        v_skipped := public._email_skip_rows(c.id, v_ids, 'cold_frozen');
        UPDATE public.email_campaigns SET wave_state = 'halted', wave_checked_at = now(),
               wave_note = COALESCE(wave_note, '{}'::jsonb) || jsonb_build_object('reason', 'sender_frozen', 'skipped', v_skipped)
         WHERE id = c.id;
        CONTINUE;
      END IF;

      -- Des vagues ouvertes attendent le plafond du jour : on libère ce qu'on peut.
      PERFORM public._email_release_waves(c.id);

      -- Ce qui est parti du froid, jugé sur tout le froid parti.
      SELECT count(*) FILTER (WHERE r.status IN ('sent', 'bounced', 'complained')) AS n,
             count(*) FILTER (WHERE r.status = 'bounced') AS bounced,
             count(*) FILTER (WHERE r.status = 'complained') AS complained,
             count(*) FILTER (WHERE r.status IN ('sent', 'bounced', 'complained')
                                AND EXISTS (SELECT 1 FROM public.email_campaign_events ev
                                             WHERE ev.campaign_id = c.id AND ev.event_type IN ('opened', 'clicked')
                                               AND lower(ev.recipient_email) = lower(r.email))) AS opened,
             count(*) FILTER (WHERE r.status IN ('sent', 'bounced', 'complained') AND public._email_is_gmail(r.email)) AS g_n,
             count(*) FILTER (WHERE r.status IN ('sent', 'bounced', 'complained') AND public._email_is_gmail(r.email)
                                AND EXISTS (SELECT 1 FROM public.email_campaign_events ev
                                             WHERE ev.campaign_id = c.id AND ev.event_type IN ('opened', 'clicked')
                                               AND lower(ev.recipient_email) = lower(r.email))) AS g_open,
             count(*) FILTER (WHERE r.status IN ('sent', 'bounced', 'complained') AND NOT public._email_is_gmail(r.email)) AS o_n,
             count(*) FILTER (WHERE r.status IN ('sent', 'bounced', 'complained') AND NOT public._email_is_gmail(r.email)
                                AND EXISTS (SELECT 1 FROM public.email_campaign_events ev
                                             WHERE ev.campaign_id = c.id AND ev.event_type IN ('opened', 'clicked')
                                               AND lower(ev.recipient_email) = lower(r.email))) AS o_open,
             count(*) FILTER (WHERE r.status IN ('pending', 'sending') AND r.wave_released_at IS NOT NULL) AS in_flight,
             count(*) FILTER (WHERE r.status = 'pending' AND r.wave_released_at IS NULL
                                AND r.wave <= COALESCE(c.wave_released, 0)) AS waiting_cap,
             count(*) FILTER (WHERE r.status = 'pending' AND r.wave > COALESCE(c.wave_released, 0)) AS held,
             max(r.sent_at) AS last_sent
        INTO st
        FROM public.email_campaign_recipients r
       WHERE r.campaign_id = c.id AND r.wave >= 1;

      UPDATE public.email_campaigns SET wave_checked_at = now(),
             wave_note = COALESCE(wave_note, '{}'::jsonb) || jsonb_build_object(
               'sent', st.n, 'bounced', st.bounced, 'complained', st.complained, 'opened', st.opened,
               'gmail_sent', st.g_n, 'gmail_opened', st.g_open)
       WHERE id = c.id;

      -- Vague encore en vol, ou froid en attente du plafond : on attend.
      IF st.in_flight > 0 OR st.waiting_cap > 0 THEN CONTINUE; END IF;
      IF st.held = 0 THEN
        UPDATE public.email_campaigns SET wave_state = 'done' WHERE id = c.id;
        CONTINUE;
      END IF;
      -- On laisse aux rebonds, plaintes et ouvertures le temps d'arriver.
      IF st.last_sent IS NOT NULL AND st.last_sent > now() - make_interval(mins => s.wave_wait_minutes) THEN CONTINUE; END IF;

      v_reason := NULL;
      IF st.n >= 50 THEN
        IF st.bounced * 100.0 / st.n > s.halt_bounce_pct THEN v_reason := 'bounces';
        ELSIF st.complained * 1000.0 / st.n > s.halt_complaint_permille THEN v_reason := 'complaints';
        ELSIF st.n >= 100 AND st.opened * 100.0 / st.n < s.halt_open_pct THEN v_reason := 'no_opens';
        ELSIF st.g_n >= 50 AND st.g_open * 100.0 / st.g_n < s.halt_gmail_open_pct THEN v_reason := 'gmail_spam';
        ELSIF st.g_n >= 50 AND st.o_n >= 50 AND st.o_open > 0
              AND (st.g_open::numeric / st.g_n) < s.halt_gmail_relative * (st.o_open::numeric / st.o_n) THEN v_reason := 'gmail_spam';
        END IF;
      END IF;

      IF v_reason IS NULL THEN
        UPDATE public.email_campaigns SET wave_released = LEAST(wave_total, COALESCE(wave_released, 0) + 1) WHERE id = c.id
        RETURNING wave_released INTO v_rel;
        PERFORM public._email_release_waves(c.id);
        v_out := v_out || jsonb_build_object('campaign', c.id, 'released', v_rel);
      ELSE
        SELECT array_agg(r.id) INTO v_ids FROM public.email_campaign_recipients r
         WHERE r.campaign_id = c.id AND r.status = 'pending' AND r.wave >= 1 AND r.wave_released_at IS NULL;
        v_skipped := public._email_skip_rows(c.id, v_ids, 'cold_wave_halted');
        UPDATE public.email_campaigns SET wave_state = 'halted',
               wave_note = COALESCE(wave_note, '{}'::jsonb) || jsonb_build_object('reason', v_reason, 'skipped', v_skipped)
         WHERE id = c.id;
        INSERT INTO public.email_sender_health (scope_key, cold_frozen_until, reason, metrics, updated_at)
        VALUES (v_key, now() + make_interval(days => s.probation_days), 'wave:' || v_reason,
                jsonb_build_object('campaign_id', c.id, 'sent', st.n, 'bounced', st.bounced, 'complained', st.complained,
                                   'opened', st.opened, 'gmail_sent', st.g_n, 'gmail_opened', st.g_open), now())
        ON CONFLICT (scope_key) DO UPDATE
          SET cold_frozen_until = GREATEST(COALESCE(email_sender_health.cold_frozen_until, now()), EXCLUDED.cold_frozen_until),
              reason = EXCLUDED.reason, metrics = EXCLUDED.metrics, updated_at = now();
        PERFORM public.emit_admin_notification(
          'admin_email_cold_halted',
          'Envoi froid arrêté : ' || COALESCE(c.name, 'campagne'),
          format('La partie froide de « %s » (%s) est arrêtée (%s) : %s envois, %s rebonds, %s plaintes, %s ouvertures dont Gmail %s/%s. %s adresses froides non envoyées, compte à l''écart %s jours.',
                 c.name, v_key, v_reason, st.n, st.bounced, st.complained, st.opened, st.g_open, st.g_n, v_skipped, s.probation_days),
          'high', 'email_campaign', c.id::text,
          jsonb_build_object('campaign_id', c.id, 'scope_key', v_key, 'reason', v_reason),
          'email_cold_halted:' || c.id::text, NULL);
        v_out := v_out || jsonb_build_object('campaign', c.id, 'halted', v_reason, 'skipped', v_skipped);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Une campagne en erreur n'arrête jamais les autres.
      v_out := v_out || jsonb_build_object('campaign', c.id, 'error', SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('campaigns', v_out);
END $$;
REVOKE ALL ON FUNCTION public.email_waves_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_waves_tick() TO service_role;

-- Surveillance : comptes qui dérapent, chute de Gmail sur la plateforme.
CREATE OR REPLACE FUNCTION public.email_deliverability_watch()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  s public.email_deliverability_settings;
  r record;
  g record;
  v_flagged jsonb := '[]'::jsonb;
  v_reason text;
  v_auto boolean := false;
BEGIN
  SELECT * INTO s FROM public.email_deliverability_settings WHERE id;

  -- 1. Comptes : 7 derniers jours de marketing réel.
  FOR r IN
    SELECT public._email_sender_key(ec.venue_id, ec.organizer_user_id) AS k,
           count(*) AS n,
           count(*) FILTER (WHERE x.status = 'bounced') AS bounced,
           count(*) FILTER (WHERE x.status = 'complained') AS complained
      FROM public.email_campaign_recipients x
      JOIN public.email_campaigns ec ON ec.id = x.campaign_id
     WHERE x.status IN ('sent', 'bounced', 'complained') AND x.sent_at > now() - interval '7 days'
       AND COALESCE(ec.type, 'promotional') = 'promotional' AND NOT COALESCE(ec.practical, false)
       AND NOT public.is_demo_marketing_scope(ec.venue_id, ec.organizer_user_id)
     GROUP BY 1
    HAVING count(*) >= 200
  LOOP
    v_reason := CASE WHEN r.bounced * 100.0 / r.n > s.halt_bounce_pct THEN 'bounces_7d'
                     WHEN r.complained * 1000.0 / r.n > s.halt_complaint_permille THEN 'complaints_7d' END;
    IF v_reason IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.email_sender_health h WHERE h.scope_key = r.k AND h.cold_frozen_until > now()) THEN
      INSERT INTO public.email_sender_health (scope_key, cold_frozen_until, reason, metrics, updated_at)
      VALUES (r.k, now() + make_interval(days => s.probation_days), v_reason,
              jsonb_build_object('sent', r.n, 'bounced', r.bounced, 'complained', r.complained), now())
      ON CONFLICT (scope_key) DO UPDATE SET cold_frozen_until = EXCLUDED.cold_frozen_until,
        reason = EXCLUDED.reason, metrics = EXCLUDED.metrics, updated_at = now();
      PERFORM public.emit_admin_notification(
        'admin_email_sender_probation', 'Compte expéditeur mis à l''écart : ' || r.k,
        format('%s sur 7 jours : %s envois, %s rebonds, %s plaintes. Plus aucune adresse froide pendant %s jours.',
               v_reason, r.n, r.bounced, r.complained, s.probation_days),
        'high', 'email_sender', r.k, jsonb_build_object('scope_key', r.k, 'reason', v_reason),
        'email_sender_probation:' || r.k || ':' || to_char(now(), 'YYYY-MM-DD'), NULL);
      v_flagged := v_flagged || jsonb_build_object('scope', r.k, 'reason', v_reason);
    END IF;
  END LOOP;

  -- 2. Plateforme : Gmail ouvre-t-il encore ? (envois de 6 h à 3 jours, le
  --    temps que les ouvertures arrivent.)
  WITH x AS (
    SELECT lower(rr.email) AS em, rr.campaign_id, public._email_is_gmail(rr.email) AS gm
      FROM public.email_campaign_recipients rr
      JOIN public.email_campaigns ec ON ec.id = rr.campaign_id
     WHERE rr.status = 'sent' AND rr.sent_at BETWEEN now() - interval '3 days' AND now() - interval '6 hours'
       AND COALESCE(ec.type, 'promotional') = 'promotional'
       AND NOT public.is_demo_marketing_scope(ec.venue_id, ec.organizer_user_id)
  ), o AS (
    SELECT DISTINCT lower(ev.recipient_email) AS em, ev.campaign_id
      FROM public.email_campaign_events ev
     WHERE ev.event_type = 'opened' AND ev.created_at > now() - interval '4 days'
       AND ev.campaign_id IN (SELECT campaign_id FROM x)
  )
  SELECT count(*) FILTER (WHERE x.gm) AS gn, count(o.em) FILTER (WHERE x.gm) AS go,
         count(*) FILTER (WHERE NOT x.gm) AS on_, count(o.em) FILTER (WHERE NOT x.gm) AS oo
    INTO g
    FROM x LEFT JOIN o ON o.em = x.em AND o.campaign_id = x.campaign_id;

  IF g.gn >= 200 AND g.on_ >= 100 AND g.go * 100.0 / g.gn < 5 AND g.oo * 100.0 / g.on_ >= 15 THEN
    IF NOT s.gmail_recovery AND s.gmail_auto_recovery THEN
      UPDATE public.email_deliverability_settings
         SET gmail_recovery = true, started_at = now(), updated_at = now(), updated_by = NULL WHERE id;
      v_auto := true;
    END IF;
    PERFORM public.emit_admin_notification(
      'admin_email_gmail_drop', 'Gmail range nos e-mails en spam',
      format('Sur 3 jours : Gmail %s %% d''ouvertures (%s envois), autres messageries %s %% (%s envois).%s',
             round(g.go * 100.0 / g.gn, 1), g.gn, round(g.oo * 100.0 / g.on_, 1), g.on_,
             CASE WHEN v_auto THEN ' Le mode reprise Gmail vient d''être rallumé automatiquement.' ELSE '' END),
      'high', 'email_deliverability', 'gmail', jsonb_build_object('gmail_sent', g.gn, 'gmail_opened', g.go,
        'other_sent', g.on_, 'other_opened', g.oo, 'auto_recovery', v_auto),
      'email_gmail_drop:' || to_char(now(), 'IYYY-IW'), NULL);
  END IF;

  RETURN jsonb_build_object('flagged', v_flagged, 'gmail', to_jsonb(g), 'auto_recovery', v_auto);
END $$;
REVOKE ALL ON FUNCTION public.email_deliverability_watch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_deliverability_watch() TO service_role;

-- Marketing resté en file quand la soirée de la campagne a commencé : écarté
-- (Yunits rendus), jamais envoyé pour une nuit passée.
CREATE OR REPLACE FUNCTION public.email_skip_after_event_start()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  c record;
  v_ids uuid[];
  v_n integer;
  v_out jsonb := '[]'::jsonb;
BEGIN
  FOR c IN
    SELECT ec.id FROM public.email_campaigns ec JOIN public.events e ON e.id = ec.event_id
     WHERE ec.status IN ('sending', 'paused')
       AND COALESCE(ec.type, 'promotional') = 'promotional' AND NOT COALESCE(ec.practical, false)
       AND e.start_at IS NOT NULL AND e.start_at < now()
     LIMIT 50
  LOOP
    SELECT array_agg(r.id) INTO v_ids FROM public.email_campaign_recipients r
     WHERE r.campaign_id = c.id AND r.status = 'pending';
    v_n := public._email_skip_rows(c.id, v_ids, 'event_started');
    IF v_n > 0 THEN v_out := v_out || jsonb_build_object('campaign', c.id, 'skipped', v_n); END IF;
  END LOOP;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.email_skip_after_event_start() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_skip_after_event_start() TO service_role;

-- Plafond quotidien d'un compte pendant la reprise Gmail : la montée en charge
-- et les dérogations d'avant restent, la reprise ne fait que baisser le plafond.
CREATE OR REPLACE FUNCTION public.email_sender_daily_cap(p_scope_key text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v RECORD;
  v_days integer;
  v_cap integer;
  s public.email_deliverability_settings;
BEGIN
  SELECT * INTO v FROM public.email_sender_state WHERE scope_key = p_scope_key;

  -- Plateforme : plafond global, généreux mais fini.
  IF p_scope_key = 'platform' THEN
    RETURN COALESCE(v.daily_cap_override, 25000);
  END IF;

  IF v IS NULL THEN
    v_cap := 300;                       -- tout premier envoi
  ELSIF v.daily_cap_override IS NOT NULL THEN
    v_cap := GREATEST(0, v.daily_cap_override);
  ELSIF v.trust_level = 'restricted' THEN
    v_cap := 0;
  ELSIF v.trust_level = 'trusted' THEN
    v_cap := 50000;
  ELSIF v.first_send_at IS NULL THEN
    v_cap := 300;
  ELSE
    v_days := GREATEST(0, (public.paris_today() - (v.first_send_at AT TIME ZONE 'Europe/Paris')::date));
    v_cap := CASE
      WHEN v_days = 0 THEN 300
      WHEN v_days = 1 THEN 600
      WHEN v_days = 2 THEN 1200
      WHEN v_days = 3 THEN 2500
      WHEN v_days = 4 THEN 5000
      WHEN v_days = 5 THEN 10000
      ELSE 25000
    END;
  END IF;

  SELECT * INTO s FROM public.email_deliverability_settings WHERE id;
  IF FOUND AND s.gmail_recovery THEN
    v_cap := LEAST(v_cap, s.recovery_daily_cap);
  END IF;
  RETURN v_cap;
END;
$function$;

-- Un seul point d'entrée pour le cron : les vagues à chaque passage, la
-- surveillance une fois par heure.
CREATE OR REPLACE FUNCTION public.email_deliverability_tick()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_w jsonb;
  v_m jsonb := NULL;
  v_late jsonb := NULL;
BEGIN
  v_w := public.email_waves_tick();
  -- La soirée a commencé : le marketing qui reste en file ne part plus.
  BEGIN
    v_late := public.email_skip_after_event_start();
  EXCEPTION WHEN OTHERS THEN
    v_late := jsonb_build_object('error', SQLERRM);
  END;
  IF extract(minute FROM now()) < 15 THEN
    BEGIN
      v_m := public.email_deliverability_watch();
    EXCEPTION WHEN OTHERS THEN
      v_m := jsonb_build_object('error', SQLERRM);
    END;
  END IF;
  RETURN jsonb_build_object('waves', v_w, 'late', v_late, 'watch', v_m);
END $$;
REVOKE ALL ON FUNCTION public.email_deliverability_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_deliverability_tick() TO service_role;

DO $cron$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'email-deliverability-tick';
  PERFORM cron.schedule('email-deliverability-tick', '3,18,33,48 * * * *', 'SELECT public.email_deliverability_tick()');
END $cron$;

-- ── Lecture super admin : la reprise Gmail, les comptes à l'écart, les vagues en cours.
CREATE OR REPLACE FUNCTION public.admin_email_deliverability_watch()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_senders jsonb;
  v_waves jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'scope_key', h.scope_key, 'until', h.cold_frozen_until, 'reason', h.reason, 'metrics', h.metrics,
           'name', COALESCE(v.name, op.organization_name, CASE WHEN h.scope_key = 'yuno' THEN 'Yuno' END, h.scope_key))
         ORDER BY h.cold_frozen_until DESC), '[]'::jsonb)
    INTO v_senders
    FROM public.email_sender_health h
    LEFT JOIN public.venues v ON h.scope_key = 'venue:' || v.id
    LEFT JOIN public.profiles op ON h.scope_key = 'org:' || op.id::text
   WHERE h.cold_frozen_until > now() - interval '30 days';
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', ec.id, 'name', ec.name, 'state', ec.wave_state, 'released', ec.wave_released,
           'total', ec.wave_total, 'note', ec.wave_note, 'checked_at', ec.wave_checked_at)
         ORDER BY ec.wave_checked_at DESC NULLS LAST), '[]'::jsonb)
    INTO v_waves
    FROM public.email_campaigns ec
   WHERE ec.wave_state IS NOT NULL AND COALESCE(ec.wave_checked_at, ec.created_at) > now() - interval '14 days';
  RETURN jsonb_build_object('senders', v_senders, 'waves', v_waves);
END $$;
REVOKE ALL ON FUNCTION public.admin_email_deliverability_watch() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_email_deliverability_watch() TO authenticated;

-- ── Ce que le pro voit sur sa campagne : la partie froide, ses vagues, et ce
-- que les règles Yuno ont gardé de côté (par motif). Billetterie et CRM.
CREATE OR REPLACE FUNCTION public.email_campaign_send_rules(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  c record;
  s public.email_deliverability_settings;
  v_skips jsonb;
  v_last timestamptz;
BEGIN
  SELECT ec.id, ec.venue_id, ec.organizer_user_id, ec.wave_state, ec.wave_released, ec.wave_total, ec.wave_note,
         ec.spread_forced, ec.throttle_per_hour, ec.throttle_window_minutes
    INTO c FROM public.email_campaigns ec WHERE ec.id = p_campaign_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT (public.is_super_admin()
          OR (COALESCE(c.venue_id, c.organizer_user_id::text) IS NOT NULL
              AND (COALESCE(public.crm_scope_allowed(c.venue_id, c.organizer_user_id), false)
                   OR COALESCE(public.contact_scope_allowed(c.venue_id, c.organizer_user_id), false)))) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.email_deliverability_settings WHERE id;
  SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) INTO v_skips FROM (
    SELECT replace(r.error_message, 'policy:', '') AS k, count(*) AS n
      FROM public.email_campaign_recipients r
     WHERE r.campaign_id = p_campaign_id AND r.status = 'skipped' AND r.error_message LIKE 'policy:%'
     GROUP BY 1) x;
  SELECT max(r.sent_at) INTO v_last FROM public.email_campaign_recipients r
   WHERE r.campaign_id = p_campaign_id AND r.wave >= 1 AND r.status IN ('sent', 'bounced', 'complained');
  RETURN jsonb_build_object(
    'wave_state', c.wave_state, 'wave_released', c.wave_released, 'wave_total', c.wave_total,
    'cold', (c.wave_note->>'cold')::int, 'cold_sent', (c.wave_note->>'sent')::int,
    'halt_reason', c.wave_note->>'reason',
    'next_check_at', CASE WHEN c.wave_state = 'testing' AND v_last IS NOT NULL
                          THEN v_last + make_interval(mins => s.wave_wait_minutes) END,
    'skipped', v_skips,
    'spread_forced', COALESCE(c.spread_forced, false),
    'per_hour', CASE WHEN c.throttle_per_hour IS NOT NULL
                     THEN round(c.throttle_per_hour * 60.0 / COALESCE(c.throttle_window_minutes, 60)) END,
    'gmail_recovery', s.gmail_recovery);
END $$;
REVOKE ALL ON FUNCTION public.email_campaign_send_rules(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_campaign_send_rules(uuid) TO authenticated;

-- ── Écran de planification : le compte peut-il envoyer « tout d'un coup » ?
CREATE OR REPLACE FUNCTION public.email_sender_send_mode(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  s public.email_deliverability_settings;
  h public.email_sender_health;
BEGIN
  IF NOT (public.is_super_admin()
          OR (COALESCE(p_venue_id, p_organizer_user_id::text) IS NOT NULL
              AND (COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false)
                   OR COALESCE(public.contact_scope_allowed(p_venue_id, p_organizer_user_id), false)))) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.email_deliverability_settings WHERE id;
  SELECT * INTO h FROM public.email_sender_health WHERE scope_key = public._email_sender_key(p_venue_id, p_organizer_user_id);
  RETURN jsonb_build_object(
    'force_spread', COALESCE(s.force_spread, false) AND NOT COALESCE(h.burst_allowed, false),
    'burst_allowed', COALESCE(h.burst_allowed, false),
    'min_audience', s.spread_min_audience,
    'per_hour', s.spread_per_hour,
    'max_per_hour', s.spread_max_per_hour,
    'cold_frozen_until', CASE WHEN h.cold_frozen_until > now() THEN h.cold_frozen_until END);
END $$;
REVOKE ALL ON FUNCTION public.email_sender_send_mode(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_sender_send_mode(text, uuid) TO authenticated;

-- ── Super admin : la santé d'envoi de chaque compte (30 jours) et l'autorisation
-- « tout d'un coup ».
CREATE OR REPLACE FUNCTION public.admin_email_senders()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  WITH x AS (
    SELECT public._email_sender_key(ec.venue_id, ec.organizer_user_id) AS k, ec.id AS cid,
           lower(r.email) AS em, r.status, public._email_is_gmail(r.email) AS gm
      FROM public.email_campaign_recipients r
      JOIN public.email_campaigns ec ON ec.id = r.campaign_id
     WHERE r.status IN ('sent', 'bounced', 'complained') AND r.sent_at > now() - interval '30 days'
       AND NOT public.is_demo_marketing_scope(ec.venue_id, ec.organizer_user_id)
  ), o AS (
    SELECT DISTINCT ev.campaign_id, lower(ev.recipient_email) AS em
      FROM public.email_campaign_events ev
     WHERE ev.event_type IN ('opened', 'clicked') AND ev.created_at > now() - interval '31 days'
  ), agg AS (
    SELECT x.k, count(*) AS sent,
           count(*) FILTER (WHERE x.status = 'bounced') AS bounced,
           count(*) FILTER (WHERE x.status = 'complained') AS complained,
           count(o.em) AS opened,
           count(*) FILTER (WHERE x.gm) AS gmail_sent,
           count(o.em) FILTER (WHERE x.gm) AS gmail_opened
      FROM x LEFT JOIN o ON o.campaign_id = x.cid AND o.em = x.em
     GROUP BY x.k
  ), keys AS (
    SELECT k FROM agg UNION SELECT scope_key FROM public.email_sender_health
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'scope_key', keys.k,
           'name', COALESCE(v.name, op.organization_name, CASE WHEN keys.k = 'yuno' THEN 'Yuno' END, keys.k),
           'sent', COALESCE(a.sent, 0), 'bounced', COALESCE(a.bounced, 0), 'complained', COALESCE(a.complained, 0),
           'opened', COALESCE(a.opened, 0), 'gmail_sent', COALESCE(a.gmail_sent, 0), 'gmail_opened', COALESCE(a.gmail_opened, 0),
           'burst_allowed', COALESCE(h.burst_allowed, false), 'burst_set_at', h.burst_set_at,
           'cold_frozen_until', CASE WHEN h.cold_frozen_until > now() THEN h.cold_frozen_until END,
           'reason', h.reason)
         ORDER BY COALESCE(a.sent, 0) DESC), '[]'::jsonb)
    INTO v
    FROM keys
    LEFT JOIN agg a ON a.k = keys.k
    LEFT JOIN public.email_sender_health h ON h.scope_key = keys.k
    LEFT JOIN public.venues v ON keys.k = 'venue:' || v.id
    LEFT JOIN public.profiles op ON keys.k = 'org:' || op.id::text;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.admin_email_senders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_email_senders() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_sender_burst(p_scope_key text, p_allowed boolean, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_scope_key IS NULL OR p_scope_key !~ '^(venue:.+|org:[0-9a-f-]{36}|yuno)$' THEN RAISE EXCEPTION 'invalid_scope'; END IF;
  INSERT INTO public.email_sender_health (scope_key, burst_allowed, burst_set_by, burst_set_at, burst_reason, updated_at)
  VALUES (p_scope_key, p_allowed, auth.uid(), now(), trim(p_reason), now())
  ON CONFLICT (scope_key) DO UPDATE
    SET burst_allowed = EXCLUDED.burst_allowed, burst_set_by = EXCLUDED.burst_set_by,
        burst_set_at = EXCLUDED.burst_set_at, burst_reason = EXCLUDED.burst_reason, updated_at = now();
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'email_sender_burst_set', 'email_sender', p_scope_key,
          jsonb_build_object('allowed', p_allowed, 'reason', trim(p_reason)));
  RETURN public.admin_email_senders();
END $$;
REVOKE ALL ON FUNCTION public.admin_set_sender_burst(text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_sender_burst(text, boolean, text) TO authenticated;
