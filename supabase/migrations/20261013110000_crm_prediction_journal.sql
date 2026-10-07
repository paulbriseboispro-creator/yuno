-- ============================================================================
-- Yuno CRM — « Chances de venir » : le journal prévu / réel (2026-10-13)
-- Plan : docs/designs/CRM_ANALYSIS_OPTIMIZE_PLAN.md (lot 1).
--
-- Le score est validé chaque nuit sur 4 soirées passées tenues à l'écart. Ce
-- journal le juge sur ce qui s'est VRAIMENT passé ensuite :
--   • crm_prediction_nights  (gardé) : chaque nuit, par soirée à venir, la
--     projection (billets vendus, acheteurs déjà là, acheteurs connus
--     attendus ± bande, nouveaux attendus) et, par audience « Qui cibler »,
--     la taille et les acheteurs attendus ;
--   • crm_prediction_people  (effacé au règlement) : la chance donnée à chaque
--     personne à deux moments, sa première chance (`first`) et celle de J-7
--     (`d7`), avec ses audiences ;
--   • crm_prediction_results (gardé) : 48 h après la soirée, par moment, la
--     comparaison à la réalité (a acheté APRÈS le moment de la prédiction) :
--     AUC, perte logarithmique, Brier, calibration par tranche et par
--     étiquette, acheteurs attendus contre réels par audience, écart de la
--     projection (acheteurs prévus contre acheteurs finaux).
-- Puis :
--   • alerte super admin `admin_crm_score_drift` quand la calibration des 8
--     dernières soirées dérive (dédoublonnée par semaine) ;
--   • _crm_projection_gate : la projection s'ouvre au pro quand son écart
--     moyen à J-7 est sous 15 % sur ses 8 dernières soirées (décision de Paul,
--     07/10) ;
--   • crm_admin_analysis rend le journal (courbe prévu / réel).
-- Effacement : contact effacé, compte purgé, opposition au profilage = ses
-- lignes par personne partent (elles ne sortent jamais dans un export).
-- Corps repris du dépôt (= prod, vérifié par scripts/crm-bench/same-as-prod.mjs).
-- ============================================================================

SET lock_timeout = '5s';

-- ── 1. Tables (aucune policy : lues par des RPC gardées) ─────────────────────
CREATE TABLE IF NOT EXISTS public.crm_prediction_nights (
  scope_key         text NOT NULL,
  venue_id          text,
  organizer_user_id uuid,
  event_id          uuid NOT NULL,
  snapshot_on       date NOT NULL,
  snapshot_at       timestamptz NOT NULL,
  days_left         integer NOT NULL,
  sold              integer NOT NULL,       -- billets vendus à ce moment
  buyers            integer NOT NULL,       -- acheteurs distincts à ce moment
  scored            integer NOT NULL,       -- personnes connues sans place, notées
  expected_known    real NOT NULL,          -- somme des chances
  band              real NOT NULL,          -- 2 écarts-types
  remaining_share   real,
  newcomers_est     real,
  audiences         jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (scope_key, event_id, snapshot_on)
);
CREATE TABLE IF NOT EXISTS public.crm_prediction_people (
  scope_key   text NOT NULL,
  event_id    uuid NOT NULL,
  horizon     text NOT NULL CHECK (horizon IN ('first', 'd7')),
  email       text NOT NULL,
  snapshot_at timestamptz NOT NULL,
  p           real NOT NULL,
  label       text NOT NULL,
  auds        text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (scope_key, event_id, horizon, email)
);
CREATE INDEX IF NOT EXISTS crm_prediction_people_email ON public.crm_prediction_people (scope_key, email);
CREATE TABLE IF NOT EXISTS public.crm_prediction_results (
  scope_key         text NOT NULL,
  venue_id          text,
  organizer_user_id uuid,
  event_id          uuid NOT NULL,
  horizon           text NOT NULL CHECK (horizon IN ('first', 'd7')),
  start_at          timestamptz NOT NULL,
  title             text,
  settled_at        timestamptz NOT NULL DEFAULT now(),
  metrics           jsonb NOT NULL,
  PRIMARY KEY (scope_key, event_id, horizon)
);
CREATE INDEX IF NOT EXISTS crm_prediction_results_recent ON public.crm_prediction_results (scope_key, horizon, start_at DESC);
ALTER TABLE public.crm_prediction_nights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_prediction_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_prediction_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_prediction_nights, public.crm_prediction_people, public.crm_prediction_results
  FROM PUBLIC, anon, authenticated;

-- ── 2. Le relevé de la nuit (après le score) ────────────────────────────────
CREATE OR REPLACE FUNCTION public._crm_score_journal(p_scope text, p_venue_id text, p_organizer_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  -- Les soirées notées cette nuit, et leur nombre de jours restants
  -- (calendrier du fuseau de la soirée).
  DROP TABLE IF EXISTS _jev;
  CREATE TEMP TABLE _jev ON COMMIT DROP AS
  SELECT e.id AS event_id,
         ((e.start_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'))::date
           - (now() AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'))::date) AS days_left
    FROM public.events e
   WHERE e.id IN (SELECT DISTINCT s.event_id FROM public.crm_person_night_score s WHERE s.scope_key = p_scope);

  -- Les audiences « Qui cibler » de chaque soirée : la même porte que l'écran.
  DROP TABLE IF EXISTS _jaud;
  CREATE TEMP TABLE _jaud ON COMMIT DROP AS
  SELECT j.event_id, t.email, a.aud
    FROM _jev j
   CROSS JOIN unnest(ARRAY['likely', 'concept', 'lineup', 'genre', 'early', 'last_minute', 'once_local']) a(aud)
   CROSS JOIN LATERAL public._crm_night_target_set(p_scope, j.event_id, a.aud) t;
  CREATE INDEX ON _jaud (event_id, email);

  INSERT INTO public.crm_prediction_nights AS n (scope_key, venue_id, organizer_user_id, event_id, snapshot_on, snapshot_at,
    days_left, sold, buyers, scored, expected_known, band, remaining_share, newcomers_est, audiences)
  SELECT p_scope, p_venue_id, p_organizer_user_id, j.event_id, current_date, now(), j.days_left,
         (SELECT count(*) FROM public.external_tickets t WHERE t.event_id = j.event_id AND public._crm_ticket_is_sale(t.status, t.raw)),
         (SELECT count(DISTINCT lower(t.buyer_email)) FROM public.external_tickets t
           WHERE t.event_id = j.event_id AND public._crm_ticket_is_sale(t.status, t.raw) AND t.buyer_email IS NOT NULL),
         sc.n, sc.p, 2 * sqrt(sc.v), sn.remaining_share,
         -- Même règle que la projection de l'Admin CRM : la moyenne des
         -- nouveaux des 8 dernières soirées × la part des achats encore à venir.
         (SELECT avg(np.new_people) * COALESCE(sn.remaining_share, 1) FROM (
            SELECT x.new_people FROM public.crm_night_profile x
             WHERE x.scope_key = p_scope AND x.starts_at < now() ORDER BY x.starts_at DESC LIMIT 8) np),
         COALESCE((SELECT jsonb_object_agg(z.aud, jsonb_build_object('n', z.n, 'expected', round(z.p::numeric, 2)))
                     FROM (SELECT g.aud, count(*) AS n, COALESCE(sum(s.p), 0) AS p
                             FROM _jaud g
                             LEFT JOIN public.crm_person_night_score s ON s.scope_key = p_scope AND s.event_id = g.event_id AND s.email = g.email
                            WHERE g.event_id = j.event_id GROUP BY g.aud) z), '{}'::jsonb)
    FROM _jev j
    CROSS JOIN LATERAL (SELECT count(*) AS n, COALESCE(sum(s.p), 0) AS p, COALESCE(sum(s.p * (1 - s.p)), 0) AS v
                          FROM public.crm_person_night_score s WHERE s.scope_key = p_scope AND s.event_id = j.event_id) sc
    LEFT JOIN public.crm_score_night sn ON sn.scope_key = p_scope AND sn.event_id = j.event_id
  ON CONFLICT (scope_key, event_id, snapshot_on) DO UPDATE SET
    snapshot_at = EXCLUDED.snapshot_at, days_left = EXCLUDED.days_left, sold = EXCLUDED.sold, buyers = EXCLUDED.buyers,
    scored = EXCLUDED.scored, expected_known = EXCLUDED.expected_known, band = EXCLUDED.band,
    remaining_share = EXCLUDED.remaining_share, newcomers_est = EXCLUDED.newcomers_est, audiences = EXCLUDED.audiences;

  -- Par personne : sa première chance, puis celle de J-7 ; une seule fois
  -- chacune (une ligne déjà là n'est jamais réécrite).
  INSERT INTO public.crm_prediction_people (scope_key, event_id, horizon, email, snapshot_at, p, label, auds)
  SELECT p_scope, s.event_id, h.h, s.email, now(), s.p, s.label,
         COALESCE((SELECT array_agg(g.aud ORDER BY g.aud) FROM _jaud g WHERE g.event_id = s.event_id AND g.email = s.email), '{}')
    FROM public.crm_person_night_score s
    JOIN _jev j ON j.event_id = s.event_id
   CROSS JOIN (VALUES ('first'), ('d7')) h(h)
   WHERE s.scope_key = p_scope AND (h.h = 'first' OR j.days_left <= 7)
  ON CONFLICT (scope_key, event_id, horizon, email) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_score_journal(text, text, uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. Le règlement (48 h après la soirée) ──────────────────────────────────
-- p_now : l'instant du règlement (le banc le fait avancer ; la prod passe now()).
CREATE OR REPLACE FUNCTION public._crm_score_settle(p_scope text, p_venue_id text, p_organizer_user_id uuid,
                                                    p_now timestamptz DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg    jsonb := COALESCE(public.crm_analysis_config()->'score', '{}'::jsonb);
  ev       record;
  h        text;
  v_m      jsonb;
  v_night  record;
  v_done   integer := 0;
  v_pool   record;
BEGIN
  FOR ev IN
    SELECT e.id, e.start_at, e.title
      FROM public.events e
     WHERE e.id IN (SELECT DISTINCT pp.event_id FROM public.crm_prediction_people pp WHERE pp.scope_key = p_scope)
       AND COALESCE(e.end_at, e.start_at + interval '6 hours')
           < p_now - make_interval(hours => COALESCE((v_cfg->>'settle_hours')::int, 48))
  LOOP
    -- Qui a acheté, et quand (ventes seulement, au sens de _crm_ticket_is_sale).
    DROP TABLE IF EXISTS _sbuy;
    CREATE TEMP TABLE _sbuy ON COMMIT DROP AS
    SELECT lower(t.buyer_email) AS em, min(COALESCE(t.purchased_at, t.first_seen_at)) AS first_buy
      FROM public.external_tickets t
     WHERE t.event_id = ev.id AND t.buyer_email IS NOT NULL AND public._crm_ticket_is_sale(t.status, t.raw)
     GROUP BY 1;
    CREATE INDEX ON _sbuy (em);

    FOREACH h IN ARRAY ARRAY['first', 'd7'] LOOP
      DROP TABLE IF EXISTS _sy;
      CREATE TEMP TABLE _sy ON COMMIT DROP AS
      SELECT pp.email, LEAST(GREATEST(pp.p::float8, 1e-6), 1 - 1e-6) AS p, pp.label, pp.auds, pp.snapshot_at,
             CASE WHEN b.first_buy > pp.snapshot_at THEN 1 ELSE 0 END AS y
        FROM public.crm_prediction_people pp
        LEFT JOIN _sbuy b ON b.em = pp.email
       WHERE pp.scope_key = p_scope AND pp.event_id = ev.id AND pp.horizon = h;
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM _sy);

      -- La projection de ce moment-là : premier relevé (`first`) ou premier
      -- relevé à J-7 ou moins (`d7`).
      SELECT n.* INTO v_night FROM public.crm_prediction_nights n
       WHERE n.scope_key = p_scope AND n.event_id = ev.id AND (h = 'first' OR n.days_left <= 7)
       ORDER BY n.snapshot_on LIMIT 1;

      WITH r AS (
        SELECT p, y, rank() OVER (ORDER BY p) + (count(*) OVER (PARTITION BY p) - 1) / 2.0 AS rk FROM _sy
      ), s AS (
        SELECT count(*) AS n, sum(y) AS pos, sum(p) AS sp,
               -avg(y * ln(p) + (1 - y) * ln(1 - p)) AS logloss, avg((p - y) ^ 2) AS brier,
               count(*) FILTER (WHERE y = 1) AS n1, count(*) FILTER (WHERE y = 0) AS n0,
               sum(rk) FILTER (WHERE y = 1) AS r1
          FROM r
      ), b AS (
        SELECT width_bucket(p, 0, 1.0000001, 10) AS k, count(*) AS n, sum(p) AS sp, sum(y) AS sy FROM _sy GROUP BY 1
      )
      SELECT jsonb_build_object(
        'n', s.n, 'buyers', s.pos, 'expected', round(s.sp::numeric, 2),
        'logloss', round(s.logloss::numeric, 5), 'brier', round(s.brier::numeric, 5),
        'auc', CASE WHEN s.n1 > 0 AND s.n0 > 0 THEN round(((s.r1 - s.n1 * (s.n1 + 1) / 2.0) / (s.n1 * s.n0))::numeric, 4) END,
        'ece', (SELECT round((sum(abs(b.sp - b.sy)) / NULLIF(sum(b.n), 0))::numeric, 4) FROM b),
        'buckets', (SELECT jsonb_agg(jsonb_build_object('k', b.k, 'n', b.n, 'p', round(b.sp::numeric, 2), 'y', b.sy) ORDER BY b.k) FROM b),
        'labels', (SELECT jsonb_object_agg(l.label, jsonb_build_object('n', l.n, 'p', round(l.sp::numeric, 2), 'y', l.sy))
                     FROM (SELECT label, count(*) AS n, sum(p) AS sp, sum(y) AS sy FROM _sy GROUP BY 1) l),
        'audiences', (SELECT jsonb_object_agg(a.aud, jsonb_build_object('n', a.n, 'p', round(a.sp::numeric, 2), 'y', a.sy))
                        FROM (SELECT x.aud, count(*) AS n, sum(y.p) AS sp, sum(y.y) AS sy
                                FROM _sy y CROSS JOIN LATERAL unnest(y.auds) x(aud) GROUP BY 1) a),
        'projection', CASE WHEN v_night.event_id IS NOT NULL THEN (
          SELECT jsonb_build_object(
            'snapshot_on', v_night.snapshot_on, 'days_left', v_night.days_left,
            'buyers_at', v_night.buyers, 'expected_known', round(v_night.expected_known::numeric, 1),
            'newcomers_est', round(COALESCE(v_night.newcomers_est, 0)::numeric, 1),
            'predicted', round((v_night.buyers + v_night.expected_known + COALESCE(v_night.newcomers_est, 0))::numeric, 1),
            'actual', t.total, 'actual_known', s.pos,
            -- Nouveaux réels : acheteurs après le relevé qui n'étaient ni notés ni déjà acheteurs.
            'actual_new', (SELECT count(*) FROM _sbuy b2 WHERE b2.first_buy > v_night.snapshot_at
                             AND NOT EXISTS (SELECT 1 FROM public.crm_prediction_people q
                                              WHERE q.scope_key = p_scope AND q.event_id = ev.id AND q.horizon = h AND q.email = b2.em)),
            'err', CASE WHEN t.total > 0 THEN round((abs(v_night.buyers + v_night.expected_known + COALESCE(v_night.newcomers_est, 0) - t.total)
                                                     / t.total)::numeric, 4) END)
            FROM (SELECT count(*) AS total FROM _sbuy) t) END)
        INTO v_m FROM s;

      INSERT INTO public.crm_prediction_results AS x (scope_key, venue_id, organizer_user_id, event_id, horizon, start_at, title, settled_at, metrics)
      VALUES (p_scope, p_venue_id, p_organizer_user_id, ev.id, h, ev.start_at, ev.title, p_now, jsonb_strip_nulls(v_m))
      ON CONFLICT (scope_key, event_id, horizon) DO UPDATE SET metrics = EXCLUDED.metrics, settled_at = EXCLUDED.settled_at;
    END LOOP;

    -- Les chances par personne ne vivent que jusqu'à la comparaison.
    DELETE FROM public.crm_prediction_people WHERE scope_key = p_scope AND event_id = ev.id;
    v_done := v_done + 1;
  END LOOP;

  -- Dérive : calibration des 8 dernières soirées réglées, à J-7, tranches
  -- mises en commun ; au-delà du seuil, une alerte par compte et par semaine.
  IF v_done > 0 THEN
    SELECT sum((b->>'n')::int) AS n, sum(abs((b->>'p')::numeric - (b->>'y')::numeric)) AS gap
      INTO v_pool
      FROM (SELECT r.metrics FROM public.crm_prediction_results r
             WHERE r.scope_key = p_scope AND r.horizon = 'd7' ORDER BY r.start_at DESC LIMIT 8) z
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(z.metrics->'buckets', '[]'::jsonb)) b;
    IF COALESCE(v_pool.n, 0) >= COALESCE((v_cfg->>'drift_min_n')::int, 200)
       AND v_pool.gap / v_pool.n > COALESCE((v_cfg->>'drift_ece')::numeric, 0.08) THEN
      BEGIN
        PERFORM public.emit_admin_notification(
          'admin_crm_score_drift', 'Yuno CRM : « Chances de venir » se décale',
          format('Calibration des 8 dernières soirées à J-7 : %s points d''écart (seuil %s).',
                 round(100 * v_pool.gap / v_pool.n, 1), round(100 * COALESCE((v_cfg->>'drift_ece')::numeric, 0.08), 1)),
          'normal', 'crm_scope', p_scope,
          jsonb_build_object('ece', round(v_pool.gap / v_pool.n, 4), 'n', v_pool.n),
          'crm_score_drift:' || p_scope || ':' || to_char(p_now, 'IYYY-IW'), NULL);
      EXCEPTION WHEN others THEN NULL;  -- une alerte ne fait jamais échouer le calcul
      END;
    END IF;
  END IF;
  RETURN v_done;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_score_settle(text, text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_score_settle(text, text, uuid, timestamptz) TO service_role;

-- ── 4. La projection s'ouvre au pro quand elle tient ────────────────────────
-- Décision de Paul (07/10) : écart moyen à la réalité sous 15 % sur les 8
-- dernières soirées du compte, mesuré à J-7. Une seule règle, lue partout.
CREATE OR REPLACE FUNCTION public._crm_projection_gate(p_scope text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT COALESCE((public.crm_analysis_config()->'score'->>'projection_nights')::int, 8) AS k,
           COALESCE((public.crm_analysis_config()->'score'->>'projection_err_max')::numeric, 0.15) AS mx
  ), last AS (
    SELECT (r.metrics->'projection'->>'err')::numeric AS err
      FROM public.crm_prediction_results r, cfg
     WHERE r.scope_key = p_scope AND r.horizon = 'd7' AND r.metrics->'projection'->>'err' IS NOT NULL
     ORDER BY r.start_at DESC LIMIT (SELECT k FROM cfg)
  )
  SELECT jsonb_build_object(
    'open', count(*) >= (SELECT k FROM cfg) AND avg(err) < (SELECT mx FROM cfg),
    'nights', count(*), 'needed', (SELECT k FROM cfg),
    'err', round(avg(err), 4), 'max', (SELECT mx FROM cfg))
    FROM last;
$function$;
REVOKE ALL ON FUNCTION public._crm_projection_gate(text) FROM PUBLIC, anon, authenticated;

-- ── 5. Effacement : compte, opposition, contact ─────────────────────────────
CREATE OR REPLACE FUNCTION public._crm_analysis_purge_scope(p_scope_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.crm_person_profile WHERE scope_key = p_scope_key;
  DELETE FROM public.crm_night_profile WHERE scope_key = p_scope_key;
  DELETE FROM public.crm_artist_stats WHERE scope_key = p_scope_key;
  DELETE FROM public.crm_person_night_score WHERE scope_key = p_scope_key;
  DELETE FROM public.crm_score_night WHERE scope_key = p_scope_key;
  DELETE FROM public.crm_score_model WHERE scope_key = p_scope_key;
  DELETE FROM public.crm_prediction_people WHERE scope_key = p_scope_key;
  DELETE FROM public.crm_prediction_nights WHERE scope_key = p_scope_key;
  DELETE FROM public.crm_prediction_results WHERE scope_key = p_scope_key;
  DELETE FROM public.crm_analysis_state WHERE scope_key = p_scope_key;  -- et crm_analysis_dirty (cascade)
END;
$$;
REVOKE ALL ON FUNCTION public._crm_analysis_purge_scope(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_analysis_purge_scope(text) TO service_role;

CREATE OR REPLACE FUNCTION public._crm_score_on_optout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.crm_person_night_score WHERE scope_key = NEW.scope_key AND email = NEW.email;
  DELETE FROM public.crm_prediction_people WHERE scope_key = NEW.scope_key AND email = NEW.email;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._crm_score_on_optout() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._crm_erase_contacts(p_venue_id text, p_organizer_user_id uuid, p_emails text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emails text[];
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'scope_required' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT lower(btrim(e))), '{}') INTO v_emails
    FROM unnest(p_emails) e WHERE e IS NOT NULL AND btrim(e) <> '';
  IF cardinality(v_emails) = 0 THEN RETURN 0; END IF;

  DELETE FROM public.crm_contact_notes WHERE scope_key = v_key AND lower(email) = ANY (v_emails);

  -- Analyse client (20261010110000) : profil et file de recalcul. L'exclusion
  -- du profilage (crm_profile_optouts), mémoire d'un refus, reste.
  DELETE FROM public.crm_person_profile WHERE scope_key = v_key AND email = ANY (v_emails);
  DELETE FROM public.crm_analysis_dirty WHERE scope_key = v_key AND email = ANY (v_emails);
  -- « Chances de venir » (20261012100000, 20261013110000) : ses chances et
  -- leur journal partent avec lui.
  DELETE FROM public.crm_person_night_score WHERE scope_key = v_key AND email = ANY (v_emails);
  DELETE FROM public.crm_prediction_people WHERE scope_key = v_key AND email = ANY (v_emails);

  DELETE FROM public.crm_import_journal j
   USING public.crm_imports i
   WHERE i.list_import_id = j.list_import_id AND i.scope_key = v_key AND lower(j.email) = ANY (v_emails);

  DELETE FROM public.imported_contacts c
   WHERE ((p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id))
     AND lower(c.email) = ANY (v_emails);

  -- Un désabonnement reste : c'est la mémoire du refus.
  DELETE FROM public.newsletter_subscriptions ns
   WHERE ((p_venue_id IS NOT NULL AND ns.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND ns.organizer_user_id = p_organizer_user_id))
     AND lower(ns.email) = ANY (v_emails)
     AND ns.opted_in;

  DELETE FROM public.venue_sms_contacts vc
   WHERE ((p_venue_id IS NOT NULL AND vc.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND vc.organizer_user_id = p_organizer_user_id))
     AND lower(vc.email) = ANY (v_emails)
     AND NOT vc.unsubscribed;

  -- Les ventes de la billetterie connectée gardent leur montant, sans identité.
  UPDATE public.external_tickets t
     SET buyer_email = NULL, buyer_first_name = NULL, buyer_last_name = NULL, buyer_phone = NULL,
         buyer_ref = NULL, holder_email = NULL, holder_first_name = NULL, holder_last_name = NULL,
         raw = '{}'::jsonb
   WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
     AND lower(t.buyer_email) = ANY (v_emails);

  DELETE FROM public.contact_engagement ce
   WHERE ((p_venue_id IS NOT NULL AND ce.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND ce.organizer_user_id = p_organizer_user_id))
     AND lower(ce.email) = ANY (v_emails);

  -- Les envois passés restent comptés, sous une adresse qui ne désigne plus personne.
  UPDATE public.email_campaign_recipients r
     SET email = 'erased-' || md5(lower(r.email)) || '@erased.invalid',
         first_name = NULL, last_name = NULL, user_id = NULL
    FROM public.email_campaigns c
   WHERE c.id = r.campaign_id
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND r.status NOT IN ('pending', 'sending')
     AND lower(r.email) = ANY (v_emails);

  UPDATE public.email_campaign_events ev
     SET recipient_email = 'erased-' || md5(lower(ev.recipient_email)) || '@erased.invalid',
         metadata = ((COALESCE(ev.metadata, '{}'::jsonb) - 'to' - 'headers')
                     #- '{open,ipAddress}' #- '{open,userAgent}'
                     #- '{click,ipAddress}' #- '{click,userAgent}')
    FROM public.email_campaigns c
   WHERE c.id = ev.campaign_id
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND lower(ev.recipient_email) = ANY (v_emails);

  DELETE FROM public.contact_base_cache cb
   WHERE cb.scope_key = public.contact_base_scope_key(p_venue_id, p_organizer_user_id)
     AND lower(cb.email) = ANY (v_emails);
  UPDATE public.contact_base_cache_state
     SET dirty_at = now()
   WHERE scope_key = public.contact_base_scope_key(p_venue_id, p_organizer_user_id);

  RETURN cardinality(v_emails);
END;
$$;

-- ── 6. Le score note puis relève ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_score_compute(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_key   text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_cfg   jsonb := public.crm_analysis_config();
  sc      jsonb;
  v_t0    timestamptz := clock_timestamp();
  v_feat  text[] := public._crm_score_features();
  v_all   integer[] := ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  v_base  integer[] := ARRAY[1, 2];
  v_idx   integer[];
  v_cut   timestamptz;
  v_ntr   integer; v_nva integer;
  v_mean  float8[]; v_sd float8[]; v_beta float8[]; v_start float8[];
  b_mean  float8[]; b_sd float8[]; b_beta float8[];
  v_tr    jsonb; v_va jsonb; v_vb jsonb;
  v_pos   integer;
  v_neg   float8;
  v_status text;
  v_scored integer := 0;
  v_journal jsonb := '{}'::jsonb;
  i integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'crm_score_compute: service only' USING ERRCODE = '42501';
  END IF;
  IF v_key IS NULL OR (p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'scope_required' USING ERRCODE = '22023';
  END IF;
  sc := COALESCE(v_cfg->'score', '{}'::jsonb);

  -- Journal prévu / réel (20261013110000) : les soirées finies se comparent à
  -- la réalité avant tout. Une panne du journal ne coûte jamais le score.
  BEGIN
    v_journal := jsonb_build_object('settled', public._crm_score_settle(v_key, p_venue_id, p_organizer_user_id, now()));
  EXCEPTION WHEN others THEN
    v_journal := jsonb_build_object('settle_error', left(SQLERRM, 200));
  END;
  v_neg := LEAST(1, GREATEST(0.01, COALESCE((sc->>'neg_sample')::float8, 0.2)));

  PERFORM public._crm_an_load(p_venue_id, p_organizer_user_id, now(), v_cfg);
  PERFORM public._crm_score_targets(v_key, p_venue_id, p_organizer_user_id, v_cfg, false);

  -- Les soirées des N derniers mois ; les dernières sont tenues à l'écart.
  DELETE FROM _scx WHERE start_at < now() - make_interval(months => COALESCE((sc->>'months')::int, 12));
  SELECT start_at INTO v_cut FROM _scx ORDER BY start_at DESC
   OFFSET GREATEST(COALESCE((sc->>'holdout_nights')::int, 4) - 1, 0) LIMIT 1;
  SELECT count(*) FILTER (WHERE start_at < v_cut), count(*) FILTER (WHERE start_at >= v_cut) INTO v_ntr, v_nva FROM _scx;

  IF v_cut IS NULL OR v_ntr < COALESCE((sc->>'min_train_nights')::int, 8) THEN
    v_status := 'insufficient';
    v_tr := jsonb_build_object('nights', COALESCE(v_ntr, 0));
  ELSE
    -- Paires : toute personne déjà venue avant l'ouverture de la vente ;
    -- achats gardés, non-achats échantillonnés et repondérés.
    DROP TABLE IF EXISTS _scp;
    CREATE TEMP TABLE _scp ON COMMIT DROP AS
    WITH known AS (
      SELECT x.xid, a.em
        FROM _scx x JOIN _ana a ON a.start_at < x.cutoff
       GROUP BY x.xid, a.em
    ), bought AS (
      SELECT a.em, a.nid FROM _ana a WHERE a.has_sale
    )
    SELECT k.xid, k.em, CASE WHEN b.em IS NOT NULL THEN 1 ELSE 0 END AS y,
           CASE WHEN b.em IS NOT NULL OR x.start_at >= v_cut THEN 1.0 ELSE 1.0 / v_neg END AS w,
           x.start_at >= v_cut AS valid
      FROM known k
      JOIN _scx x ON x.xid = k.xid
      LEFT JOIN bought b ON b.em = k.em AND b.nid = k.xid
     WHERE b.em IS NOT NULL OR x.start_at >= v_cut
        OR (abs(hashtext(k.em || ':' || k.xid::text)) % 1000) < v_neg * 1000;

    PERFORM public._crm_score_build(v_cfg);
    ALTER TABLE _scf ADD COLUMN valid boolean;
    UPDATE _scf f SET valid = p.valid FROM _scp p WHERE p.xid = f.xid AND p.em = f.em;

    SELECT count(*) FILTER (WHERE y = 1 AND NOT valid) INTO v_pos FROM _scf;
    v_tr := jsonb_build_object('nights', v_ntr, 'rows', (SELECT count(*) FROM _scf WHERE NOT valid), 'pos', v_pos);

    IF v_pos < COALESCE((sc->>'min_pos_train')::int, 200) THEN
      v_status := 'insufficient';
    ELSE
      -- Apprentissage sur les soirées d'avant la coupure.
      ALTER TABLE _scf RENAME TO _scf_all;
      CREATE TEMP TABLE _scf ON COMMIT DROP AS SELECT * FROM _scf_all WHERE NOT valid;
      -- Facteurs constants sur ce compte (toutes les soirées pareilles) : retirés.
      v_idx := '{}';
      FOR i IN 1..12 LOOP
        IF (SELECT stddev_pop(f[i]) FROM _scf) > 1e-6 THEN v_idx := v_idx || i; END IF;
      END LOOP;
      SELECT * INTO v_mean, v_sd FROM public._crm_score_design(v_idx);
          -- Départ à chaud : les poids d'hier si les facteurs retenus sont les mêmes.
      SELECT CASE WHEN m.features = ARRAY(SELECT v_feat[j] FROM unnest(v_idx) j) THEN m.beta END
        INTO v_start FROM public.crm_score_model m WHERE m.scope_key = v_key AND m.status IN ('ok', 'weak');
      v_beta := public._crm_logit_fit(cardinality(v_idx), COALESCE((sc->>'l2')::float8, 1.0), COALESCE((sc->>'iterations')::int, 12),
                                      v_start, COALESCE((sc->>'tol')::float8, 1e-4));
      SELECT * INTO b_mean, b_sd FROM public._crm_score_design(v_base);
      b_beta := public._crm_logit_fit(2, COALESCE((sc->>'l2')::float8, 1.0), COALESCE((sc->>'iterations')::int, 12),
                                      NULL, COALESCE((sc->>'tol')::float8, 1e-4));

      -- Validation sur les soirées tenues à l'écart (population complète).
      DROP TABLE _scf;
      CREATE TEMP TABLE _scf ON COMMIT DROP AS SELECT * FROM _scf_all WHERE valid;
      IF v_beta IS NULL OR b_beta IS NULL THEN
        v_status := 'failed';
      ELSE
        PERFORM public._crm_score_apply(v_idx, v_mean, v_sd, v_beta);
        v_va := public._crm_score_eval();
        -- Valeur ajoutée mesurée sur les clients ACTIFS (dernière soirée il y
        -- a moins de 180 jours) : sur toute la base, la récence seule trie
        -- déjà presque parfaitement (ceux qui ne reviennent jamais).
        DELETE FROM _scv v USING _scf f WHERE f.xid = v.xid AND f.em = v.em AND f.f[1] > ln(181);
        v_va := v_va || jsonb_build_object('active', public._crm_score_eval());
        PERFORM public._crm_score_apply(v_base, b_mean, b_sd, b_beta);
        v_vb := public._crm_score_eval();
        DELETE FROM _scv v USING _scf f WHERE f.xid = v.xid AND f.em = v.em AND f.f[1] > ln(181);
        v_vb := v_vb || jsonb_build_object('active', public._crm_score_eval());
        v_status := CASE
          WHEN COALESCE((v_va->>'pos')::int, 0) < COALESCE((sc->>'min_pos_valid')::int, 50) THEN 'insufficient'
          WHEN COALESCE((v_va->>'auc')::float8, 0) >= COALESCE((sc->>'auc_min')::float8, 0.70)
           AND COALESCE((v_va->'active'->>'auc')::float8, 0) >= COALESCE((v_vb->'active'->>'auc')::float8, 0) + COALESCE((sc->>'auc_gain')::float8, 0.02)
           AND COALESCE((v_va->>'ece')::float8, 1) <= COALESCE((sc->>'ece_max')::float8, 0.05)
            THEN 'ok'
          ELSE 'weak' END;
      END IF;
      DROP TABLE _scf_all;
    END IF;
  END IF;

  INSERT INTO public.crm_score_model AS m (scope_key, venue_id, organizer_user_id, status, features, mean, sd, beta, metrics, trained_at)
  VALUES (v_key, p_venue_id, p_organizer_user_id, v_status,
          CASE WHEN v_idx IS NOT NULL THEN ARRAY(SELECT v_feat[j] FROM unnest(v_idx) j) END,
          v_mean, v_sd, v_beta,
          jsonb_strip_nulls(jsonb_build_object('train', v_tr, 'valid', v_va, 'baseline', v_vb,
            'valid_nights', v_nva, 'rules_version', (v_cfg->>'rules_version')::int,
            'ms', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000))),
          now())
  ON CONFLICT (scope_key) DO UPDATE SET status = EXCLUDED.status, features = EXCLUDED.features, mean = EXCLUDED.mean,
    sd = EXCLUDED.sd, beta = EXCLUDED.beta, metrics = EXCLUDED.metrics, trained_at = EXCLUDED.trained_at;

  -- Le score des soirées à venir (seulement avec un modèle validé).
  DELETE FROM public.crm_person_night_score WHERE scope_key = v_key;
  DELETE FROM public.crm_score_night WHERE scope_key = v_key;
  IF v_status = 'ok' THEN
    PERFORM public._crm_score_targets(v_key, p_venue_id, p_organizer_user_id, v_cfg, true);
    -- Part des achats encore à venir : ventes passées faites à moins de H
    -- heures de leur soirée, H = heures restantes avant celle-ci.
    ALTER TABLE _scx ADD COLUMN f float8;
    UPDATE _scx x SET f = COALESCE((
      SELECT avg(CASE WHEN a.lead_h <= GREATEST(0, extract(epoch FROM x.start_at - now()) / 3600.0) THEN 1 ELSE 0 END)
        FROM _ana a WHERE a.has_sale AND a.lead_h IS NOT NULL), 1);
    INSERT INTO public.crm_score_night (scope_key, event_id, remaining_share)
    SELECT v_key, x.event_id, x.f FROM _scx x WHERE x.event_id IS NOT NULL;
    DROP TABLE IF EXISTS _scp;
    CREATE TEMP TABLE _scp ON COMMIT DROP AS
    SELECT x.xid, p.em, 0 AS y, 1.0::float8 AS w
      FROM _scx x
      CROSS JOIN (SELECT DISTINCT em FROM _ana) p
     WHERE NOT EXISTS (
       SELECT 1 FROM public.external_tickets t
        WHERE t.event_id = x.event_id AND lower(t.buyer_email) = p.em AND t.status IN ('valid', 'transferred'));
    PERFORM public._crm_score_build(v_cfg);
    PERFORM public._crm_score_apply(v_idx, v_mean, v_sd, v_beta);
    -- Chance d'acheter D'ICI la soirée, sachant qu'il n'a pas encore acheté :
    -- p·f / (1 − p·(1 − f)), f = part des achats qui reste à venir.
    INSERT INTO public.crm_person_night_score (scope_key, event_id, email, p, label, reasons)
    SELECT v_key, x.event_id, v.em, q.pa,
           CASE WHEN q.pa >= COALESCE((sc->>'high')::float8, 0.30) THEN 'high'
                WHEN q.pa >= COALESCE((sc->>'medium')::float8, 0.10) THEN 'medium' ELSE 'low' END,
           -- Raisons : les facteurs qui poussent sa chance vers le haut ET qu'il
           -- possède vraiment (un trait à zéro n'est jamais une raison) ; « de
           -- passage » et « découverte Shotgun » décrivent un contexte, jamais
           -- une raison de venir.
           ARRAY(SELECT v_feat[v_idx[gi]] FROM generate_subscripts(v.c, 1) gi
                  WHERE v.c[gi] > 0.15 AND v_feat[v_idx[gi]] NOT IN ('far', 'disc')
                    AND (v_feat[v_idx[gi]] = 'rec' OR f.f[v_idx[gi]] > 0)
                  ORDER BY v.c[gi] DESC LIMIT 3)
      FROM _scv v JOIN _scx x ON x.xid = v.xid
      JOIN _scf f ON f.xid = v.xid AND f.em = v.em
      CROSS JOIN LATERAL (SELECT v.p * x.f / GREATEST(1e-9, 1 - v.p * (1 - x.f)) AS pa) q
     WHERE x.event_id IS NOT NULL;
    GET DIAGNOSTICS v_scored = ROW_COUNT;
    BEGIN
      v_journal := v_journal || jsonb_build_object('logged', public._crm_score_journal(v_key, p_venue_id, p_organizer_user_id));
    EXCEPTION WHEN others THEN
      v_journal := v_journal || jsonb_build_object('journal_error', left(SQLERRM, 200));
    END;
  END IF;
  IF v_journal ? 'settle_error' OR v_journal ? 'journal_error' THEN
    UPDATE public.crm_score_model SET metrics = metrics || jsonb_build_object('journal', v_journal) WHERE scope_key = v_key;
  END IF;

  RETURN jsonb_build_object('scope', v_key, 'status', v_status, 'scored', v_scored, 'journal', v_journal,
    'auc', v_va->'auc', 'auc_base', v_vb->'auc', 'ece', v_va->'ece',
    'auc_active', v_va->'active'->'auc', 'auc_active_base', v_vb->'active'->'auc',
    'ms', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000));
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_score_compute(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_score_compute(text, uuid) TO service_role;

-- ── 7. Admin CRM : le journal ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_admin_analysis(p_scope_key text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cfg jsonb := public.crm_analysis_config();
  v_venue text;
  v_org uuid;
BEGIN
  IF NOT COALESCE(public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_scope_key LIKE 'venue:%' THEN v_venue := substr(p_scope_key, 7);
  ELSIF p_scope_key ~ '^org:[0-9a-f-]{36}$' THEN v_org := substr(p_scope_key, 5)::uuid;
  ELSE RAISE EXCEPTION 'invalid_scope' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object(
    'state', (SELECT jsonb_build_object('computed_at', s.computed_at, 'full_at', s.full_at, 'rules_version', s.rules_version,
                                        'people', s.people, 'duration_ms', s.duration_ms, 'last_error', s.last_error,
                                        'last_error_at', s.last_error_at, 'stats', s.stats,
                                        'dirty', (SELECT count(*) FROM public.crm_analysis_dirty d WHERE d.scope_key = s.scope_key))
                FROM public.crm_analysis_state s WHERE s.scope_key = p_scope_key),
    'coverage', public._crm_signal_coverage(v_venue, v_org),
    'families', public._crm_an_families_json(p_scope_key, v_cfg),
    'learning', jsonb_build_object(
      'global_enabled', COALESCE((SELECT enabled FROM public.crm_learning_settings WHERE id), false),
      'account_contributes', COALESCE((SELECT learning_contrib FROM public.crm_settings WHERE scope_key = p_scope_key), true),
      'demo', COALESCE(public.is_demo_marketing_scope(v_venue, v_org), false),
      'cells', (SELECT count(*) FROM public.crm_learning_contrib c JOIN public.crm_learning_keys k ON k.contributor = c.contributor
                 WHERE k.scope_key = p_scope_key)),
    -- Score de prédiction : santé du modèle, et la projection de remplissage
    -- (super admin seulement au début, décision de Paul du 07/10).
    'score', (SELECT jsonb_build_object('status', m.status, 'trained_at', m.trained_at, 'features', m.features,
                                        'beta', m.beta, 'metrics', m.metrics)
                FROM public.crm_score_model m WHERE m.scope_key = p_scope_key),
    'projection', (SELECT COALESCE(jsonb_agg(z.j ORDER BY z.start_at), '[]'::jsonb) FROM (
      SELECT e.start_at, jsonb_build_object(
               'event_id', e.id, 'title', e.title, 'start_at', e.start_at,
               'sold', (SELECT count(*) FROM public.external_tickets t
                         WHERE t.event_id = e.id AND public._crm_ticket_is_sale(t.status, t.raw)),
               'expected_known', round(COALESCE(sum(s.p), 0)),
               'band', round(2 * sqrt(COALESCE(sum(s.p * (1 - s.p)), 0))),
               'remaining_share', (SELECT round(sn.remaining_share::numeric, 2) FROM public.crm_score_night sn
                                    WHERE sn.scope_key = p_scope_key AND sn.event_id = e.id),
               -- Nouveaux à venir : la moyenne des 8 dernières soirées × la part restante.
               'newcomers_est', (SELECT round(avg(np.new_people) * COALESCE((SELECT sn.remaining_share FROM public.crm_score_night sn
                                                                              WHERE sn.scope_key = p_scope_key AND sn.event_id = e.id), 1)) FROM (
                                   SELECT n.new_people FROM public.crm_night_profile n
                                    WHERE n.scope_key = p_scope_key AND n.starts_at < now()
                                    ORDER BY n.starts_at DESC LIMIT 8) np)) AS j
        FROM public.events e
        LEFT JOIN public.crm_person_night_score s ON s.scope_key = p_scope_key AND s.event_id = e.id
       WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL AND e.start_at > now()
         AND ((v_venue IS NOT NULL AND e.venue_id = v_venue) OR (v_org IS NOT NULL AND e.organizer_user_id = v_org))
         AND EXISTS (SELECT 1 FROM public.crm_score_model m WHERE m.scope_key = p_scope_key AND m.status = 'ok')
       GROUP BY e.id
       ORDER BY e.start_at LIMIT 6) z),
    -- Journal prévu / réel (20261013110000) : les 12 dernières soirées réglées,
    -- la règle d'ouverture de la projection au pro.
    'journal', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'event_id', r.event_id, 'title', r.title, 'start_at', r.start_at, 'horizon', r.horizon,
                   'n', r.metrics->'n', 'buyers', r.metrics->'buyers', 'expected', r.metrics->'expected',
                   'auc', r.metrics->'auc', 'ece', r.metrics->'ece', 'logloss', r.metrics->'logloss',
                   'labels', r.metrics->'labels', 'audiences', r.metrics->'audiences',
                   'projection', r.metrics->'projection') ORDER BY r.start_at, r.horizon), '[]'::jsonb)
                  FROM (SELECT * FROM public.crm_prediction_results x
                         WHERE x.scope_key = p_scope_key ORDER BY x.start_at DESC LIMIT 24) r),
    'projection_gate', public._crm_projection_gate(p_scope_key));
END;
$$;
