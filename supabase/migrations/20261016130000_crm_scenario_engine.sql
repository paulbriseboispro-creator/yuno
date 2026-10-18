-- ============================================================================
-- Yuno CRM — Scénarios, lot J3 : le moteur (2026-10-16).
-- Plan : docs/designs/CRM_JOURNEYS_PLAN.md (§ 5). Décision 3 de Paul : l'ENTRÉE
-- respecte les 48 h avec les autres automatisations du compte ; les étapes en
-- sont exemptées, restent à 20 h l'une de l'autre et comptent dans les
-- plafonds globaux (1 / 24 h, 3 / 7 j, fatigue) : un message trop tôt est
-- REPORTÉ, jamais perdu en silence.
--
-- crm_scenario_tick() — cron toutes les 10 minutes, budget de 4 s, une portée
-- à la fois (verrou consultatif), une portée en erreur n'arrête pas les
-- autres. Pour une portée :
--   1. ENTRÉES : chaque scénario actif lit son déclencheur (soirée publiée,
--      J-N, J+N, billet acheté, segment rejoint, absence, clic sans achat,
--      inscription confirmée, chances élevées, inscription manuelle). Les
--      billets neufs et les inscriptions confirmées se lisent depuis un
--      repère (crm_scenario_scope_state) : la synchro Shotgun n'est jamais
--      touchée, donc jamais bloquée. Filtre d'entrée, règle de retour, 48 h
--      (sinon EN ATTENTE jusqu'à la fin de la fenêtre du déclencheur, puis
--      compté « non entré »), témoin (_crm_holdout_pick).
--   2. AVANCE : les inscriptions dues, par paquets (version, nœud), en
--      ensembles (jamais une requête par personne). Sorties forcées
--      (désinscription, STOP, adresse supprimée, exclusion du profilage,
--      soirée annulée), objectif, puis le nœud.
--   3. MESSAGES par les chemins existants : e-mail = une campagne enfant
--      (child_kind 'scenario') par (version, nœud, soirée), remplie contact
--      par contact et drainée par send-campaign (heures calmes, politique,
--      Yunits débités à la mise en file par _crm_yunits_debit_child_recipients) ;
--      SMS = une campagne CRM programmée (identité légale, heures, Yunits, lien
--      court : send-sms-campaign). Démo : « aurait envoyé », rien ne part.
-- `_cp` n'est construit qu'au besoin, une fois par portée et par passage.
-- ============================================================================

SET lock_timeout = '5s';

-- ── 1. Tables du moteur ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_scenario_scope_state (
  scope_key         text PRIMARY KEY,
  last_tick_at      timestamptz,
  -- Repères : billets vus (achats), inscriptions confirmées.
  ticket_mark       timestamptz,
  signup_mark       timestamptz,
  last_result       jsonb,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_scenario_scope_state ENABLE ROW LEVEL SECURITY;

-- Base d'un déclencheur « segment rejoint » : les membres au moment de la
-- publication n'entrent pas, seuls les NOUVEAUX membres entrent.
CREATE TABLE IF NOT EXISTS public.crm_scenario_seen (
  scenario_id uuid NOT NULL REFERENCES public.crm_scenarios(id) ON DELETE CASCADE,
  email       text NOT NULL,
  seen_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scenario_id, email)
);
ALTER TABLE public.crm_scenario_seen ENABLE ROW LEVEL SECURITY;

-- Entrées EN ATTENTE (48 h avec une autre automatisation) : reprises à chaque
-- passage jusqu'à la fin de la fenêtre du déclencheur, puis comptées.
CREATE TABLE IF NOT EXISTS public.crm_scenario_pending (
  scenario_id uuid NOT NULL REFERENCES public.crm_scenarios(id) ON DELETE CASCADE,
  email       text NOT NULL,
  trigger_key text NOT NULL,
  event_id    uuid,
  window_end  timestamptz NOT NULL,
  reason      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scenario_id, email, trigger_key)
);
ALTER TABLE public.crm_scenario_pending ENABLE ROW LEVEL SECURITY;

-- Ce qui n'est pas entré, compté par jour et par raison (« rien ne se perd en silence »).
CREATE TABLE IF NOT EXISTS public.crm_scenario_skips (
  scenario_id uuid NOT NULL REFERENCES public.crm_scenarios(id) ON DELETE CASCADE,
  day         date NOT NULL,
  reason      text NOT NULL,
  n           integer NOT NULL DEFAULT 0,
  PRIMARY KEY (scenario_id, day, reason)
);
ALTER TABLE public.crm_scenario_skips ENABLE ROW LEVEL SECURITY;

-- Nœud « notification à l'équipe » : un compteur par jour, jamais une alerte par personne.
CREATE TABLE IF NOT EXISTS public.crm_scenario_notify_daily (
  scenario_id uuid NOT NULL REFERENCES public.crm_scenarios(id) ON DELETE CASCADE,
  node_id     text NOT NULL,
  day         date NOT NULL,
  n           integer NOT NULL DEFAULT 0,
  PRIMARY KEY (scenario_id, node_id, day)
);
ALTER TABLE public.crm_scenario_notify_daily ENABLE ROW LEVEL SECURITY;

-- Journal prévu / réel : la personne a-t-elle été contactée pour cette soirée ?
-- Sans ce fait, le journal comparerait des contactés à des non-contactés.
ALTER TABLE public.crm_prediction_people ADD COLUMN IF NOT EXISTS contacted_at timestamptz;

-- ── 2. Petites règles ───────────────────────────────────────────────────────
-- L'heure d'une attente relative à la soirée. Une attente accrochée au DÉBUT
-- ne le dépasse jamais.
CREATE OR REPLACE FUNCTION public._crm_scenario_event_time(p_event uuid, p_node jsonb)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH e AS (
    SELECT ev.start_at, COALESCE(ev.end_at, ev.start_at + interval '6 hours') AS end_at,
           COALESCE(NULLIF(ev.timezone, ''), 'Europe/Paris') AS tz,
           (SELECT x.launched_at FROM public.external_events x WHERE x.event_id = ev.id ORDER BY x.synced_at DESC LIMIT 1) AS sale_at
      FROM public.events ev WHERE ev.id = p_event
  ), b AS (
    SELECT e.*, CASE p_node->>'anchor' WHEN 'start' THEN e.start_at WHEN 'end' THEN e.end_at ELSE e.sale_at END AS base FROM e
  )
  SELECT CASE WHEN b.base IS NULL THEN NULL
              WHEN p_node->>'anchor' = 'start' THEN LEAST(b.start_at, t.at)
              ELSE t.at END
    FROM b
    CROSS JOIN LATERAL (
      SELECT CASE WHEN public._crm_scn_int(p_node->'hours', -720, 720)
                  THEN b.base + make_interval(hours => (p_node->>'hours')::integer)
                  ELSE (((b.base AT TIME ZONE b.tz)::date + (p_node->>'days')::integer) + (p_node->>'at')::time) AT TIME ZONE b.tz END AS at
    ) t;
$function$;

-- Segments d'un SMS (estimation pour réserver les Yunits ; send-sms-campaign
-- compte au plus juste) : texte + mention STOP, variables à leur taille utile.
CREATE OR REPLACE FUNCTION public._crm_sms_segments_estimate(p_body text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  WITH t AS (
    SELECT replace(replace(replace(replace(COALESCE(p_body, ''), '{{lien}}', 'yunoapp.eu/go/XXXXXXXX'),
             '{{prénom}}', 'Prénomxxxxx'), '{{soirée}}', 'Soirée xxxxxxxxxxxxx'), '{{nom_club}}', 'Nom xxxxxxxx')
           || ' STOP au 30101' AS s
  )
  SELECT CASE WHEN t.s ~ '^[A-Za-z0-9 @£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&''()*+,./:;<=>?¡ÄÖÑÜ§¿äöñüà\n\r-]*$'
              THEN CASE WHEN char_length(t.s) <= 160 THEN 1 ELSE ceil(char_length(t.s) / 153.0)::integer END
              ELSE CASE WHEN char_length(t.s) <= 70 THEN 1 ELSE ceil(char_length(t.s) / 67.0)::integer END END
    FROM t;
$function$;

-- La soirée choisie POUR la personne (règle de « Faire revenir après la 1re
-- soirée ») : soirées à venir de la portée, en vente, de 24 h à 35 jours ;
-- artiste invité déjà vu +4, même concept +4, genre +2 (deux au plus), puis la
-- plus proche. Une personne sans profil prend la plus proche.
CREATE OR REPLACE FUNCTION public._crm_scenario_pick_events(p_venue_id text, p_organizer_user_id uuid, p_emails text[])
 RETURNS TABLE(email text, event_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH sc AS (
    SELECT public.crm_scope_key(p_venue_id, p_organizer_user_id) AS k,
           COALESCE((public.crm_analysis_config()->'rarity'->>'resident_share')::numeric, 0.2) AS res
  ), upcoming AS (
    SELECT e.id, e.start_at,
           's:' || lower(public._crm_night_series(e.title)) AS series,
           ARRAY(SELECT DISTINCT 'g:' || lower(btrim(g))
                   FROM unnest(COALESCE(e.music_genres, '{}'::text[]) || ARRAY[e.music_genre]) g
                  WHERE g IS NOT NULL AND btrim(g) <> '') AS genres,
           ARRAY(SELECT DISTINCT 'a:' || z.k
                   FROM public.external_events x
                   CROSS JOIN LATERAL jsonb_array_elements(COALESCE(x.artists, '[]'::jsonb)) a
                   CROSS JOIN LATERAL (SELECT public._crm_artist_key(a) AS k) z
                  WHERE x.event_id = e.id AND z.k IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM public.crm_artist_stats st, sc
                                     WHERE st.scope_key = sc.k AND st.artist_key = z.k AND st.share > sc.res)) AS arts
      FROM public.events e
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.start_at > now() + interval '24 hours' AND e.start_at <= now() + interval '35 days'
       AND ((e.ticketing_enabled OR e.external_ticket_url IS NOT NULL) AND NOT e.tickets_sold_out)
  ), people AS (
    SELECT DISTINCT lower(x) AS em FROM unnest(p_emails) x WHERE x IS NOT NULL
  )
  SELECT pe.em, pick.id
    FROM people pe
    LEFT JOIN sc ON true
    LEFT JOIN public.crm_person_profile pp ON pp.scope_key = sc.k AND pp.email = pe.em
    CROSS JOIN LATERAL (
      SELECT u.id FROM upcoming u
       ORDER BY (CASE WHEN COALESCE(pp.tags, '{}') && u.arts THEN 4 ELSE 0 END)
                + (CASE WHEN u.series = ANY (COALESCE(pp.tags, '{}')) THEN 4 ELSE 0 END)
                + 2 * LEAST(2, (SELECT count(*) FROM unnest(u.genres) g WHERE g = ANY (COALESCE(pp.tags, '{}'))))::integer DESC,
                u.start_at ASC
       LIMIT 1
    ) pick;
$function$;

-- Le compte peut-il envoyer ? (gel d'envoi, compte en pause).
CREATE OR REPLACE FUNCTION public._crm_scenario_hold_reason(p_scope text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.crm_settings cs WHERE cs.scope_key = p_scope AND cs.sending_frozen_at IS NOT NULL) THEN 'frozen'
    WHEN public.crm_effective_plan(p_scope) = 'paused' THEN 'plan_paused'
  END;
$function$;

-- Construit `_cp` une fois par portée et par transaction.
CREATE OR REPLACE FUNCTION public._crm_scenario_need_cp(p_venue_id text, p_organizer_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
BEGIN
  IF COALESCE(current_setting('yuno.scn_cp', true), '') = v_key AND to_regclass('pg_temp._cp') IS NOT NULL THEN RETURN; END IF;
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  PERFORM set_config('yuno.scn_cp', v_key, true);
END;
$function$;

-- ── 3. Les candidats d'un déclencheur ───────────────────────────────────────
-- Remplit _scn_cand (email, event_id, window_end) pour un scénario.
-- p_dry : l'aperçu « Avant de publier » ; rien n'est écrit (ni base d'un
-- segment, ni repère d'inscription manuelle).
CREATE OR REPLACE FUNCTION public._crm_scenario_candidates(p_s public.crm_scenarios, p_graph jsonb, p_published timestamptz,
                                                            p_ticket_mark timestamptz, p_signup_mark timestamptz,
                                                            p_dry boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t       jsonb := p_graph->'trigger';
  tt      text := p_graph->'trigger'->>'type';
  v_venue text := p_s.venue_id;
  v_org   uuid := p_s.organizer_user_id;
  v_key   text := p_s.scope_key;
  v_n     integer := 0;
  v_def   jsonb;
  v_evs   uuid[];
BEGIN
  TRUNCATE _scn_cand;

  IF tt IN ('event_published', 'before_event') THEN
    -- Les soirées dues aujourd'hui ; la base entière en est l'audience.
    SELECT array_agg(e.id) INTO v_evs
      FROM public.events e
      LEFT JOIN LATERAL (SELECT x.published_at FROM public.external_events x WHERE x.event_id = e.id ORDER BY x.synced_at DESC LIMIT 1) x ON true
     WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL AND e.status = 'active'
       AND ((v_venue IS NOT NULL AND e.venue_id = v_venue) OR (v_org IS NOT NULL AND e.organizer_user_id = v_org))
       AND e.start_at > now()
       -- Une soirée dont la base a déjà été lue en entier n'est pas relue.
       AND NOT (COALESCE(p_s.trigger_state->'done', '[]'::jsonb) ? e.id::text)
       AND CASE tt
             -- Publiée depuis la mise en ligne du scénario, il y a moins de 48 h.
             WHEN 'event_published' THEN COALESCE(x.published_at, e.created_at) >= p_published
                                     AND COALESCE(x.published_at, e.created_at) > now() - interval '48 hours'
                                     AND e.start_at > now() + interval '24 hours'
             -- Le jour J-N, heure de la soirée.
             ELSE ((e.start_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'))::date - (t->>'days')::integer)
                  = (now() AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'))::date
                  AND (t->>'series' IS NULL OR lower(public._crm_night_series(e.title)) = lower(t->>'series'))
                  AND (t->>'genre' IS NULL OR lower(t->>'genre') = ANY (
                        SELECT lower(btrim(g)) FROM unnest(COALESCE(e.music_genres, '{}'::text[]) || ARRAY[e.music_genre]) g WHERE g IS NOT NULL))
           END;
    IF v_evs IS NOT NULL THEN
      PERFORM public._crm_scenario_need_cp(v_venue, v_org);
      INSERT INTO _scn_cand (email, event_id, window_end)
      SELECT p.email, e.id,
             CASE WHEN tt = 'event_published' THEN LEAST(e.start_at, now() + interval '48 hours') ELSE e.start_at END
        FROM _cp p CROSS JOIN public.events e WHERE e.id = ANY (v_evs)
      ON CONFLICT DO NOTHING;
    END IF;

  ELSIF tt = 'after_event' THEN
    INSERT INTO _scn_cand (email, event_id, window_end)
    SELECT DISTINCT lower(tk.buyer_email), e.id,
           COALESCE(e.end_at, e.start_at + interval '6 hours') + make_interval(hours => (t->>'hours')::integer) + interval '24 hours'
      FROM public.events e
      JOIN public.external_tickets tk ON tk.event_id = e.id AND tk.buyer_email IS NOT NULL
     WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL
       AND ((v_venue IS NOT NULL AND e.venue_id = v_venue) OR (v_org IS NOT NULL AND e.organizer_user_id = v_org))
       AND COALESCE(e.end_at, e.start_at + interval '6 hours') + make_interval(hours => (t->>'hours')::integer) <= now()
       AND COALESCE(e.end_at, e.start_at + interval '6 hours') + make_interval(hours => (t->>'hours')::integer) > now() - interval '24 hours'
       AND COALESCE(e.end_at, e.start_at + interval '6 hours') >= p_published - interval '24 hours'
       AND NOT (COALESCE(p_s.trigger_state->'done', '[]'::jsonb) ? e.id::text)
       AND CASE t->>'who'
             WHEN 'entered' THEN tk.scanned_at IS NOT NULL
             -- Absents : seulement si la porte a scanné (sinon « pas scanné » ne veut pas dire « pas venu »).
             WHEN 'absent_buyers' THEN tk.scanned_at IS NULL AND public._crm_ticket_is_sale(tk.status, tk.raw)
                                       AND public._crm_event_scan_known(e.id)
                                       AND NOT EXISTS (SELECT 1 FROM public.external_tickets t2
                                                        WHERE t2.event_id = e.id AND lower(t2.buyer_email) = lower(tk.buyer_email)
                                                          AND t2.scanned_at IS NOT NULL)
             ELSE tk.status IN ('valid', 'transferred')
           END
    ON CONFLICT DO NOTHING;

  ELSIF tt = 'ticket_bought' THEN
    INSERT INTO _scn_cand (email, event_id, window_end)
    SELECT DISTINCT ON (lower(tk.buyer_email), tk.event_id) lower(tk.buyer_email), tk.event_id,
           COALESCE(tk.purchased_at, tk.first_seen_at) + interval '48 hours'
      FROM public.external_tickets tk
      JOIN public.events e ON e.id = tk.event_id
     WHERE ((v_venue IS NOT NULL AND tk.venue_id = v_venue) OR (v_org IS NOT NULL AND tk.organizer_user_id = v_org))
       AND tk.buyer_email IS NOT NULL AND public._crm_ticket_is_sale(tk.status, tk.raw)
       -- Vu par la synchro depuis le dernier passage (l'heure d'achat peut précéder la synchro).
       AND tk.first_seen_at > GREATEST(COALESCE(p_ticket_mark, p_published), p_published)
       AND COALESCE(tk.purchased_at, tk.first_seen_at) > now() - interval '48 hours'
       AND (t->>'series' IS NULL OR lower(public._crm_night_series(e.title)) = lower(t->>'series'))
       AND (NOT COALESCE((t->>'first')::boolean, false) OR NOT EXISTS (
              SELECT 1 FROM public.external_tickets t0
               WHERE ((v_venue IS NOT NULL AND t0.venue_id = v_venue) OR (v_org IS NOT NULL AND t0.organizer_user_id = v_org))
                 AND lower(t0.buyer_email) = lower(tk.buyer_email) AND public._crm_ticket_is_sale(t0.status, t0.raw)
                 AND COALESCE(t0.purchased_at, t0.first_seen_at) < COALESCE(tk.purchased_at, tk.first_seen_at)
                 AND t0.event_id IS DISTINCT FROM tk.event_id))
     ORDER BY lower(tk.buyer_email), tk.event_id, COALESCE(tk.purchased_at, tk.first_seen_at)
    ON CONFLICT DO NOTHING;

  ELSIF tt = 'signup_confirmed' THEN
    INSERT INTO _scn_cand (email, event_id, window_end)
    SELECT DISTINCT lower(en.email), pg.event_id, en.confirmed_at + interval '48 hours'
      FROM public.crm_signup_entries en
      JOIN public.crm_signup_pages pg ON pg.id = en.page_id
     WHERE pg.id = (t->>'page_id')::uuid
       AND pg.venue_id IS NOT DISTINCT FROM v_venue AND pg.organizer_user_id IS NOT DISTINCT FROM v_org
       AND en.email IS NOT NULL AND en.confirmed_at IS NOT NULL
       AND en.confirmed_at > GREATEST(COALESCE(p_signup_mark, p_published), p_published)
       AND en.confirmed_at > now() - interval '48 hours'
    ON CONFLICT DO NOTHING;

  ELSIF tt = 'chance_high' THEN
    INSERT INTO _scn_cand (email, event_id, window_end)
    SELECT sc.email, sc.event_id, e.start_at - interval '2 hours'
      FROM public.crm_person_night_score sc
      JOIN public.events e ON e.id = sc.event_id
     WHERE sc.scope_key = v_key AND sc.label = 'high'
       AND e.start_at > now() + interval '24 hours' AND e.cancelled_at IS NULL
       -- Les chances changent la nuit : une lecture par soirée et par jour.
       AND NOT (COALESCE(p_s.trigger_state->'done', '[]'::jsonb)
                ? (e.id::text || ':' || to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')))
       AND NOT public._email_event_holder(e.id, sc.email)
    ON CONFLICT DO NOTHING;

  ELSIF tt = 'click_no_buy' THEN
    -- Un clic NOMINATIF dans un e-mail de la portée vers la billetterie d'une
    -- soirée à venir, il y a N heures (fenêtre de 24 h), puis aucune place.
    INSERT INTO _scn_cand (email, event_id, window_end)
    SELECT k.em, k.event_id, LEAST(k.last_click + make_interval(hours => (t->>'hours')::integer) + interval '24 hours',
                                   e.start_at - interval '2 hours')
      FROM (
        SELECT lower(ev.recipient_email) AS em, c.event_id, max(ev.created_at) AS last_click
          FROM public.email_campaign_events ev
          JOIN public.email_campaigns c ON c.id = ev.campaign_id
          JOIN public.events e2 ON e2.id = c.event_id
         WHERE ev.event_type = 'clicked' AND ev.recipient_email IS NOT NULL
           AND c.venue_id IS NOT DISTINCT FROM v_venue AND c.organizer_user_id IS NOT DISTINCT FROM v_org
           AND e2.external_ticket_url IS NOT NULL
           AND public._link_base(ev.metadata->'click'->>'link') = public._link_base(e2.external_ticket_url)
           AND ev.created_at > now() - make_interval(hours => (t->>'hours')::integer) - interval '24 hours'
         GROUP BY 1, 2
      ) k
      JOIN public.events e ON e.id = k.event_id
     WHERE k.last_click <= now() - make_interval(hours => (t->>'hours')::integer)
       AND k.last_click >= p_published
       AND e.start_at > now() + interval '2 hours' AND e.cancelled_at IS NULL
       AND NOT public._email_event_holder(e.id, k.em)
    ON CONFLICT DO NOTHING;

  ELSIF tt IN ('segment_joined', 'manual_segment', 'absence') THEN
    IF tt = 'manual_segment' AND COALESCE((p_s.trigger_state->>'manual_done')::boolean, false) THEN RETURN 0; END IF;
    IF tt = 'absence' AND COALESCE(p_s.trigger_state->'done', '[]'::jsonb)
                          ? ('day:' || to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')) THEN RETURN 0; END IF;
    IF tt = 'segment_joined' AND COALESCE(p_s.trigger_state->>'day', '') = to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')
       AND COALESCE((p_s.trigger_state->>'baseline')::boolean, false) THEN RETURN 0; END IF;
    PERFORM public._crm_scenario_need_cp(v_venue, v_org);
    IF tt = 'absence' THEN
      INSERT INTO _scn_cand (email, event_id, window_end)
      SELECT p.email, NULL, now() + interval '24 hours'
        FROM _cp p
       WHERE p.last_night < now() - make_interval(days => (t->>'days')::integer)
         AND p.last_night >= now() - make_interval(days => (t->>'days')::integer) - interval '1 day'
         AND NOT p.upcoming
      ON CONFLICT DO NOTHING;
    ELSE
      SELECT s.definition INTO v_def FROM public.crm_segments s
       WHERE s.id = (t->>'segment_id')::uuid AND s.scope_key = v_key;
      IF v_def IS NULL THEN RETURN 0; END IF;
      EXECUTE format('INSERT INTO _scn_cand (email, event_id, window_end) SELECT p.email, NULL, now() + interval ''7 days'' FROM _cp p WHERE %s ON CONFLICT DO NOTHING',
                     public._crm_filter_sql(v_def, 'p'));
      IF tt = 'segment_joined' THEN
        IF NOT COALESCE((p_s.trigger_state->>'baseline')::boolean, false) THEN
          -- Première lecture : la base est posée, personne n'entre.
          IF p_dry THEN TRUNCATE _scn_cand; RETURN 0; END IF;
          INSERT INTO public.crm_scenario_seen (scenario_id, email) SELECT p_s.id, c.email FROM _scn_cand c ON CONFLICT DO NOTHING;
          TRUNCATE _scn_cand;
          UPDATE public.crm_scenarios SET trigger_state = trigger_state || jsonb_build_object('baseline', true, 'day',
                   to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')) WHERE id = p_s.id;
          RETURN 0;
        END IF;
        -- Les nouveaux membres seulement ; ils rejoignent la base.
        DELETE FROM _scn_cand c USING public.crm_scenario_seen sn WHERE sn.scenario_id = p_s.id AND sn.email = c.email;
        IF p_dry THEN SELECT count(*) INTO v_n FROM _scn_cand; RETURN v_n; END IF;
        INSERT INTO public.crm_scenario_seen (scenario_id, email) SELECT p_s.id, c.email FROM _scn_cand c ON CONFLICT DO NOTHING;
        UPDATE public.crm_scenarios SET trigger_state = trigger_state || jsonb_build_object('day',
                 to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')) WHERE id = p_s.id;
      ELSIF NOT p_dry THEN
        UPDATE public.crm_scenarios SET trigger_state = trigger_state || '{"manual_done": true}'::jsonb WHERE id = p_s.id;
      END IF;
    END IF;
  END IF;

  SELECT count(*) INTO v_n FROM _scn_cand;
  RETURN v_n;
END;
$function$;

-- Les soirées (ou le jour) dont le déclencheur a été lu en entier : jamais
-- relues (sinon `_cp` serait reconstruit à chaque passage pendant 24 h).
-- Les soirées passées sortent de la liste.
CREATE OR REPLACE FUNCTION public._crm_scenario_mark_done(p_s public.crm_scenarios, p_graph jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  tt text := p_graph->'trigger'->>'type';
  v_day text := to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD');
  v_new jsonb;
BEGIN
  IF tt NOT IN ('event_published', 'before_event', 'after_event', 'chance_high', 'absence') THEN RETURN; END IF;
  SELECT COALESCE(jsonb_agg(DISTINCT k), '[]'::jsonb) INTO v_new FROM (
    -- On garde ce qui vaut encore (soirées à venir ou de moins de 3 jours, jour courant).
    SELECT d #>> '{}' AS k FROM jsonb_array_elements(COALESCE(p_s.trigger_state->'done', '[]'::jsonb)) d
     WHERE (d #>> '{}') LIKE ('%' || v_day)
        OR EXISTS (SELECT 1 FROM public.events e
                    WHERE e.id::text = split_part(d #>> '{}', ':', 1) AND e.start_at > now() - interval '3 days')
    UNION
    SELECT CASE WHEN tt = 'chance_high' THEN c.event_id::text || ':' || v_day ELSE c.event_id::text END
      FROM _scn_cand_all c WHERE c.event_id IS NOT NULL AND tt <> 'absence'
    UNION
    SELECT 'day:' || v_day WHERE tt = 'absence'
  ) z;
  UPDATE public.crm_scenarios SET trigger_state = jsonb_set(trigger_state, '{done}', v_new) WHERE id = p_s.id;
END;
$function$;

-- ── 4. Les entrées d'un scénario ────────────────────────────────────────────
-- p_dry : compter ceux qui entreraient maintenant, sans rien écrire (aperçu).
CREATE OR REPLACE FUNCTION public._crm_scenario_enter(p_s public.crm_scenarios, p_v public.crm_scenario_versions,
                                                       p_ticket_mark timestamptz, p_signup_mark timestamptz,
                                                       p_dry boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g        jsonb := p_v.graph;
  v_key    text := p_s.scope_key;
  v_mode   text := COALESCE(p_v.graph->'entry'->'reentry'->>'mode', 'once');
  v_days   integer := COALESCE((p_v.graph->'entry'->'reentry'->>'days')::integer, 30);
  v_hold   integer := CASE WHEN COALESCE((p_v.graph->'entry'->>'holdout')::boolean, false)
                           THEN public.crm_holdout_pct(p_s.scope_key) ELSE 0 END;
  v_filter jsonb := p_v.graph->'entry'->'filter';
  v_ev     record;
  v_sql    text;
  v_cand   integer;
  v_in     integer := 0;
  v_wait   integer := 0;
  v_lost   integer := 0;
BEGIN
  v_cand := public._crm_scenario_candidates(p_s, g, p_v.published_at, p_ticket_mark, p_signup_mark, p_dry);
  TRUNCATE _scn_cand_all;
  INSERT INTO _scn_cand_all (event_id) SELECT DISTINCT c.event_id FROM _scn_cand c;
  -- Les entrées en attente (48 h) reviennent tant que leur fenêtre est ouverte.
  IF NOT p_dry THEN
  WITH gone AS (
    DELETE FROM public.crm_scenario_pending pd
     WHERE pd.scenario_id = p_s.id AND pd.window_end <= now()
    RETURNING pd.reason
  ), counted AS (
    INSERT INTO public.crm_scenario_skips (scenario_id, day, reason, n)
    SELECT p_s.id, current_date, gone.reason, count(*) FROM gone GROUP BY gone.reason
    ON CONFLICT (scenario_id, day, reason) DO UPDATE SET n = crm_scenario_skips.n + EXCLUDED.n
    RETURNING 1
  )
  SELECT count(*) INTO v_lost FROM gone;
  INSERT INTO _scn_cand (email, event_id, window_end, tk)
  SELECT pd.email, pd.event_id, pd.window_end, pd.trigger_key FROM public.crm_scenario_pending pd
   WHERE pd.scenario_id = p_s.id
  ON CONFLICT DO NOTHING;
  END IF;
  -- Clé de retour.
  UPDATE _scn_cand c SET tk = CASE v_mode
      WHEN 'per_event' THEN COALESCE(c.event_id::text, 'once')
      WHEN 'every_days' THEN 'p:' || floor(extract(epoch FROM now()) / (86400.0 * v_days))::bigint
      ELSE 'once' END
   WHERE c.tk IS NULL;
  -- Déjà inscrits (même clé, ou en route) : écartés AVANT de construire `_cp`.
  DELETE FROM _scn_cand c USING public.crm_scenario_runs x
   WHERE x.scenario_id = p_s.id AND x.email = c.email AND (x.trigger_key = c.tk OR x.status = 'active');
  IF NOT EXISTS (SELECT 1 FROM _scn_cand) THEN
    IF NOT p_dry THEN PERFORM public._crm_scenario_mark_done(p_s, g); END IF;
    RETURN jsonb_build_object('candidates', v_cand, 'entered', 0, 'lost', v_lost);
  END IF;
  PERFORM public._crm_scenario_need_cp(p_s.venue_id, p_s.organizer_user_id);

  TRUNCATE _scn_ok;
  -- Le filtre d'entrée dépend de la soirée (« $event ») : une passe par soirée.
  FOR v_ev IN SELECT DISTINCT c.event_id FROM _scn_cand c LOOP
    v_sql := public._crm_cond_sql(public._crm_cond_resolve(v_key, v_filter, v_ev.event_id), 'p', 'r');
    EXECUTE format($q$
      INSERT INTO _scn_ok (email, event_id, tk, window_end)
      SELECT c.email, c.event_id, c.tk, c.window_end
        FROM _scn_cand c
        JOIN _cp p ON p.email = c.email
        CROSS JOIN LATERAL (SELECT NULL::uuid AS id, %1$L::text AS scope_key, c.event_id, c.email,
                                   now() AS entered_at, NULL::uuid AS version_id) r
       WHERE c.event_id IS NOT DISTINCT FROM %2$L::uuid
         AND (p.email_ok OR p.phone_ok)
         AND NOT EXISTS (SELECT 1 FROM public.crm_profile_optouts o WHERE o.scope_key = %1$L AND o.email = c.email)
         AND NOT EXISTS (SELECT 1 FROM public.crm_scenario_runs x
                          WHERE x.scenario_id = %3$L::uuid AND x.email = c.email
                            AND (x.trigger_key = c.tk OR x.status = 'active'
                                 OR (%4$L = 'every_days' AND x.entered_at > now() - make_interval(days => %5$L::integer))))
         AND (%6$s)
      ON CONFLICT DO NOTHING
    $q$, v_key, v_ev.event_id, p_s.id, v_mode, v_days, v_sql);
  END LOOP;

  IF p_dry THEN
    RETURN jsonb_build_object('candidates', v_cand, 'entered', (SELECT count(*) FROM _scn_ok),
                              'holdout_pct', v_hold);
  END IF;
  -- 48 h avec les autres automatisations du compte (recettes, autres scénarios) :
  -- EN ATTENTE jusqu'à la fin de la fenêtre du déclencheur.
  WITH busy AS (
    DELETE FROM _scn_ok o
     WHERE o.email IN (
             SELECT lower(l.email) FROM public.email_automation_sends l
              WHERE l.status = 'queued' AND l.created_at > now() - interval '48 hours'
                AND l.venue_id IS NOT DISTINCT FROM p_s.venue_id AND l.organizer_user_id IS NOT DISTINCT FROM p_s.organizer_user_id)
        OR o.email IN (
             SELECT r.email FROM public.crm_scenario_steps st JOIN public.crm_scenario_runs r ON r.id = st.run_id
              WHERE r.scope_key = v_key AND r.scenario_id <> p_s.id
                AND st.status = 'sent' AND st.done_at > now() - interval '48 hours')
    RETURNING o.*
  ), held AS (
    INSERT INTO public.crm_scenario_pending (scenario_id, email, trigger_key, event_id, window_end, reason)
    SELECT p_s.id, b.email, b.tk, b.event_id, b.window_end, 'cooldown' FROM busy b
    ON CONFLICT (scenario_id, email, trigger_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_wait FROM busy;

  WITH ins AS (
    INSERT INTO public.crm_scenario_runs (scenario_id, version_id, scope_key, email, event_id, trigger_key,
                                          node_id, holdout, due_at)
    SELECT p_s.id, p_v.id, v_key, o.email, o.event_id, o.tk, g->>'start',
           v_hold > 0 AND public._crm_holdout_pick('scn:' || p_s.id::text || ':' || o.tk, o.email, v_hold),
           now()
      FROM (SELECT * FROM _scn_ok ORDER BY window_end, email LIMIT 3000) o
    ON CONFLICT (scenario_id, email, trigger_key) DO NOTHING
    RETURNING email, trigger_key
  ), cleared AS (
    DELETE FROM public.crm_scenario_pending pd USING ins
     WHERE pd.scenario_id = p_s.id AND pd.email = ins.email AND pd.trigger_key = ins.trigger_key
    RETURNING 1
  )
  SELECT count(*) INTO v_in FROM ins;

  -- Tout ce que le déclencheur proposait est jugé : la soirée (ou le jour)
  -- n'est plus relue. Le plafond atteint, on reprend au passage suivant.
  IF v_in < 3000 THEN PERFORM public._crm_scenario_mark_done(p_s, g); END IF;
  RETURN jsonb_build_object('candidates', v_cand, 'entered', v_in, 'waiting', v_wait, 'lost', v_lost);
END;
$function$;

-- ── 5. Les messages ─────────────────────────────────────────────────────────
-- Traite les inscriptions de _scn_grp arrivées sur un nœud e-mail ou SMS.
-- Chaque ligne : envoyée, « aurait envoyé » (démo), témoin, reportée (raison)
-- ou expirée (raison). Celles qui passent avancent au nœud suivant.
CREATE OR REPLACE FUNCTION public._crm_scenario_message(p_s public.crm_scenarios, p_v public.crm_scenario_versions,
                                                         p_node_id text, p_node jsonb, p_demo boolean, p_hold text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key    text := p_s.scope_key;
  v_ch     text := p_node->>'type';
  v_rates  jsonb := public.crm_sms_rates();
  v_rate   integer;
  v_room   bigint;
  v_tpl    public.email_campaign_templates%ROWTYPE;
  v_grp    record;
  v_child  uuid;
  v_blocks jsonb;
  v_label  text;
  v_seg    integer := public._crm_sms_segments_estimate(p_node->>'body');
  v_sent   integer := 0;
  v_cap    integer;
BEGIN
  -- La soirée du message, et la fenêtre (48 h après l'arrivée, jamais après
  -- « 2 h avant la soirée » quand le message en parle).
  UPDATE _scn_grp g SET msg_event = CASE p_node->>'event'
      WHEN 'scenario' THEN g.event_id
      WHEN 'fixed' THEN (p_node->>'event_id')::uuid
      ELSE NULL END;
  IF p_node->>'event' = 'for_person' THEN
    UPDATE _scn_grp g SET msg_event = pk.event_id
      FROM public._crm_scenario_pick_events(p_s.venue_id, p_s.organizer_user_id, ARRAY(SELECT email FROM _scn_grp)) pk
     WHERE pk.email = g.email;
  END IF;
  INSERT INTO public.crm_scenario_steps (run_id, node_id, scenario_id, version_id, status, reason, due_at, window_end)
  SELECT g.id, p_node_id, p_s.id, p_v.id, 'held', 'queued', now(),
         LEAST(now() + interval '48 hours', COALESCE((SELECT e.start_at - interval '2 hours' FROM public.events e WHERE e.id = g.msg_event), 'infinity'::timestamptz))
    FROM _scn_grp g
  ON CONFLICT (run_id, node_id, pass) DO NOTHING;
  UPDATE _scn_grp g SET window_end = st.window_end, reason = NULL
    FROM public.crm_scenario_steps st WHERE st.run_id = g.id AND st.node_id = p_node_id AND st.pass = 1;

  -- Le témoin ne reçoit rien ; il suit le chemin.
  UPDATE _scn_grp g SET outcome = 'holdout' WHERE g.holdout;
  -- Plus de soirée à vendre, ou fenêtre passée : expiré (le dernier report dit pourquoi).
  UPDATE _scn_grp g SET outcome = 'expired', reason = COALESCE(
           (SELECT st.reason FROM public.crm_scenario_steps st WHERE st.run_id = g.id AND st.node_id = p_node_id AND st.pass = 1 AND st.reason <> 'queued'),
           'late')
   WHERE g.outcome IS NULL AND (now() > g.window_end OR (p_node->>'event' IN ('scenario', 'fixed', 'for_person') AND g.msg_event IS NULL));
  UPDATE _scn_grp g SET reason = 'no_event' WHERE g.outcome = 'expired' AND g.msg_event IS NULL AND p_node->>'event' <> 'none' AND g.reason = 'late';

  IF v_ch = 'email' THEN
    -- L'accord e-mail de la portée (le registre de consentement), sinon expiré.
    UPDATE _scn_grp g SET outcome = 'expired', reason = 'no_consent'
     WHERE g.outcome IS NULL AND NOT EXISTS (
       SELECT 1 FROM public.newsletter_subscriptions s
        WHERE lower(s.email) = g.email AND s.opted_in AND s.opted_out_at IS NULL
          AND s.venue_id IS NOT DISTINCT FROM p_s.venue_id AND s.organizer_user_id IS NOT DISTINCT FROM p_s.organizer_user_id);
  ELSE
    UPDATE _scn_grp g SET phone = ph.phone_e164
      FROM (
        SELECT DISTINCT ON (lower(vc.email)) lower(vc.email) AS em, vc.phone_e164
          FROM public.venue_sms_contacts vc
         WHERE lower(vc.email) IN (SELECT x.email FROM _scn_grp x)
           AND vc.venue_id IS NOT DISTINCT FROM p_s.venue_id
           AND (p_s.venue_id IS NOT NULL OR vc.organizer_user_id = p_s.organizer_user_id)
           AND NOT COALESCE(vc.unsubscribed, false) AND vc.sms_consent_at > now() - interval '36 months'
           AND vc.phone_e164 ~ '^\+[1-9][0-9]{6,14}$'
         ORDER BY lower(vc.email), vc.sms_consent_at DESC) ph
     WHERE ph.em = g.email AND g.outcome IS NULL;
    UPDATE _scn_grp g SET outcome = 'expired', reason = 'no_consent'
     WHERE g.outcome IS NULL AND (g.phone IS NULL
       OR EXISTS (SELECT 1 FROM public.sms_stop_list st WHERE st.phone_e164 = g.phone AND (st.scope_key IS NULL OR st.scope_key = v_key))
       OR public.sms_tariff_zone(g.phone) = 'blocked');
  END IF;

  -- Le compte ne peut pas envoyer : reporté.
  IF p_hold IS NOT NULL THEN
    UPDATE _scn_grp g SET reason = p_hold WHERE g.outcome IS NULL;
    UPDATE _scn_grp g SET outcome = 'held' WHERE g.outcome IS NULL;
  END IF;

  -- 20 h depuis le message précédent de CETTE personne (tous scénarios du compte).
  -- (« aurait envoyé » compte aussi : un passage de démo ne fait pas deux messages.)
  UPDATE _scn_grp g SET outcome = 'held', reason = 'spacing', retry_at = x.last + interval '20 hours'
    FROM (
      SELECT r.email, max(st.done_at) AS last FROM public.crm_scenario_steps st JOIN public.crm_scenario_runs r ON r.id = st.run_id
       WHERE r.scope_key = v_key AND r.email IN (SELECT y.email FROM _scn_grp y)
         AND st.status IN ('sent', 'would_send') AND st.done_at > now() - interval '20 hours'
       GROUP BY r.email
    ) x
   WHERE x.email = g.email AND g.outcome IS NULL;

  -- Plafonds globaux (décision 3) : la politique d'envoi Yuno.
  IF v_ch = 'email' THEN
    UPDATE _scn_grp g SET outcome = CASE WHEN pol.reason = 'suppressed' THEN 'expired' ELSE 'held' END, reason = pol.reason
      FROM public._email_send_policy_many(ARRAY(SELECT email FROM _scn_grp WHERE outcome IS NULL), 'automation') pol
     WHERE pol.email = g.email AND g.outcome IS NULL AND pol.reason IS NOT NULL;
  ELSE
    SELECT COALESCE(s.weekly_cap, 1) INTO v_cap FROM public.crm_sms_settings s WHERE s.scope_key = v_key;
    UPDATE _scn_grp g SET outcome = 'held', reason = 'pressure_sms'
      FROM (
        SELECT r.phone_e164, count(*) AS n FROM public.sms_campaign_recipients r JOIN public.sms_campaigns c2 ON c2.id = r.campaign_id
         WHERE r.phone_e164 IN (SELECT y.phone FROM _scn_grp y WHERE y.phone IS NOT NULL)
           AND r.status IN ('sent', 'delivered') AND r.sent_at > now() - interval '7 days'
           AND c2.venue_id IS NOT DISTINCT FROM p_s.venue_id
           AND c2.organizer_id IS NOT DISTINCT FROM CASE WHEN p_s.venue_id IS NULL THEN p_s.organizer_user_id END
         GROUP BY r.phone_e164
      ) k
     WHERE k.phone_e164 = g.phone AND g.outcome IS NULL AND k.n >= COALESCE(v_cap, 1);
  END IF;

  -- Démo : rien ne part.
  IF p_demo THEN
    UPDATE _scn_grp g SET outcome = 'would_send' WHERE g.outcome IS NULL;
  END IF;

  -- Yunits : seuls ceux que le solde couvre partent ; les autres attendent.
  IF EXISTS (SELECT 1 FROM _scn_grp WHERE outcome IS NULL) THEN
    v_rate := CASE WHEN v_ch = 'email' THEN GREATEST(1, COALESCE((public.crm_pricing_config()->'rates'->>'email')::integer, 1))
                   ELSE GREATEST(1, (v_rates->>'intl')::integer) * v_seg END;
    v_room := GREATEST(0, COALESCE(public.crm_yunits_balance(v_key), 0)) / v_rate;
    UPDATE _scn_grp g SET outcome = 'held', reason = 'yunits'
      FROM (SELECT x.id, row_number() OVER (ORDER BY x.window_end, x.email) AS rn FROM _scn_grp x WHERE x.outcome IS NULL) q
     WHERE q.id = g.id AND q.rn > v_room;
  END IF;

  -- Envoi : par la campagne enfant (e-mail) ou une campagne SMS programmée.
  IF v_ch = 'email' AND EXISTS (SELECT 1 FROM _scn_grp WHERE outcome IS NULL) THEN
    SELECT * INTO v_tpl FROM public.email_campaign_templates tp
     WHERE tp.id = (p_node->>'template_id')::uuid
       AND tp.venue_id IS NOT DISTINCT FROM p_s.venue_id AND tp.organizer_user_id IS NOT DISTINCT FROM p_s.organizer_user_id;
    IF v_tpl.id IS NULL THEN
      UPDATE _scn_grp g SET outcome = 'expired', reason = 'no_template' WHERE g.outcome IS NULL;
    END IF;
    FOR v_grp IN SELECT DISTINCT g.msg_event FROM _scn_grp g WHERE g.outcome IS NULL LOOP
      SELECT m.campaign_id INTO v_child FROM public.crm_scenario_messages m
       WHERE m.version_id = p_v.id AND m.node_id = p_node_id AND m.channel = 'email'
         AND m.event_key = COALESCE(v_grp.msg_event, '00000000-0000-0000-0000-000000000000'::uuid)
         AND m.campaign_id IS NOT NULL;
      IF v_child IS NULL THEN
        SELECT COALESCE(NULLIF(e.title, ''), to_char(now(), 'YYYY-MM')) INTO v_label FROM public.events e WHERE e.id = v_grp.msg_event;
        v_blocks := CASE WHEN v_grp.msg_event IS NULL THEN public._email_blocks_without_live(v_tpl.blocks_json)
                         ELSE COALESCE(v_tpl.blocks_json, '[]'::jsonb) END;
        INSERT INTO public.email_campaigns
          (venue_id, organizer_user_id, name, type, subject, preheader, blocks_json, blocks_version,
           theme_json, social_links_json, logo_url, event_id, status, audiences_json, exclusions_json,
           quiet_hours, child_kind, total_recipients, created_by, product)
        VALUES
          (p_s.venue_id, p_s.organizer_user_id,
           left(p_s.name || ' · ' || COALESCE(v_label, to_char(now(), 'YYYY-MM')), 80), 'promotional',
           COALESCE(NULLIF(btrim(p_node->>'subject'), ''), NULLIF(v_tpl.subject, ''), v_tpl.name), COALESCE(v_tpl.preheader, ''),
           v_blocks, 2, COALESCE(v_tpl.theme_json, '{}'::jsonb), COALESCE(v_tpl.social_links_json, '{}'::jsonb), v_tpl.logo_url,
           v_grp.msg_event, 'sending', '[]'::jsonb, '{}'::jsonb, true, 'scenario', 0,
           COALESCE(p_s.created_by, v_tpl.created_by, p_s.organizer_user_id, (SELECT v.owner_id FROM public.venues v WHERE v.id = p_s.venue_id)),
           'crm')
        RETURNING id INTO v_child;
        -- Elle est sa propre mère (comme les relances des pages d'inscription) :
        -- hors des listes Campagnes et des bilans d'e-mails, sans accusé « campagne
        -- envoyée » ; ses chiffres vivent dans le rapport du scénario.
        UPDATE public.email_campaigns SET parent_campaign_id = v_child WHERE id = v_child;
        INSERT INTO public.crm_scenario_messages (version_id, node_id, channel, event_key, campaign_id)
        VALUES (p_v.id, p_node_id, 'email', COALESCE(v_grp.msg_event, '00000000-0000-0000-0000-000000000000'::uuid), v_child);
      END IF;
      -- Déjà destinataire de cette campagne (un retour sur la même soirée) : pas deux fois.
      UPDATE _scn_grp g SET outcome = 'expired', reason = 'already_sent'
        FROM public.email_campaign_recipients q
       WHERE q.campaign_id = v_child AND lower(q.email) = g.email AND g.outcome IS NULL
         AND g.msg_event IS NOT DISTINCT FROM v_grp.msg_event;
      -- Le débit des Yunits se fait ici (déclencheur des campagnes enfants) ;
      -- une ligne qu'il refuse revient en attente, sa place libérée.
      INSERT INTO public.email_campaign_recipients (campaign_id, email, first_name, last_name, unsubscribe_token, status)
      SELECT v_child, g.email, s.first_name, s.last_name, s.unsubscribe_token, 'pending'
        FROM _scn_grp g
        LEFT JOIN LATERAL (
          SELECT s.first_name, s.last_name, s.unsubscribe_token FROM public.newsletter_subscriptions s
           WHERE lower(s.email) = g.email
             AND s.venue_id IS NOT DISTINCT FROM p_s.venue_id AND s.organizer_user_id IS NOT DISTINCT FROM p_s.organizer_user_id
           LIMIT 1) s ON true
       WHERE g.outcome IS NULL AND g.msg_event IS NOT DISTINCT FROM v_grp.msg_event
      ON CONFLICT (campaign_id, lower(email)) DO NOTHING;
      UPDATE _scn_grp g SET outcome = 'held', reason = CASE q.error_message WHEN 'paused' THEN 'plan_paused' ELSE 'yunits' END
        FROM public.email_campaign_recipients q
       WHERE q.campaign_id = v_child AND lower(q.email) = g.email AND q.status = 'skipped'
         AND q.error_message IN ('yunits', 'paused') AND g.outcome IS NULL;
      DELETE FROM public.email_campaign_recipients q USING _scn_grp g
       WHERE q.campaign_id = v_child AND lower(q.email) = g.email AND q.status = 'skipped'
         AND q.error_message IN ('yunits', 'paused') AND g.outcome = 'held';
      UPDATE _scn_grp g SET outcome = 'sent', campaign_id = v_child
       WHERE g.outcome IS NULL AND g.msg_event IS NOT DISTINCT FROM v_grp.msg_event;
      UPDATE public.email_campaigns c
         SET status = 'sending', paused_reason = NULL, error_message = NULL,
             total_recipients = (SELECT count(*) FROM public.email_campaign_recipients q WHERE q.campaign_id = c.id)
       WHERE c.id = v_child AND c.status IN ('sent', 'sending', 'draft');
      v_child := NULL;
    END LOOP;
  ELSIF v_ch = 'sms' AND EXISTS (SELECT 1 FROM _scn_grp WHERE outcome IS NULL) THEN
    FOR v_grp IN SELECT DISTINCT g.msg_event FROM _scn_grp g WHERE g.outcome IS NULL LOOP
      INSERT INTO public.sms_campaigns (venue_id, organizer_id, created_by, name, body_template, segment_filters, status,
                                        event_id, quiet_hours, estimated_recipients, segments_per_message, estimated_credits)
      VALUES (p_s.venue_id, CASE WHEN p_s.venue_id IS NULL THEN p_s.organizer_user_id END,
              COALESCE(p_s.created_by, p_s.organizer_user_id, (SELECT v.owner_id FROM public.venues v WHERE v.id = p_s.venue_id)),
              left(p_s.name || ' · SMS', 120), p_node->>'body',
              jsonb_build_object('type', 'crm', 'automation', 'scenario', 'scenario_id', p_s.id, 'node', p_node_id),
              'draft', v_grp.msg_event, true, 0, v_seg, 0)
      RETURNING id INTO v_child;
      INSERT INTO public.sms_campaign_recipients (campaign_id, phone_e164, full_name, first_name, email)
      SELECT DISTINCT ON (g.phone) v_child, g.phone,
             NULLIF(btrim(concat_ws(' ', s.first_name, s.last_name)), ''), NULLIF(btrim(COALESCE(s.first_name, '')), ''), g.email
        FROM _scn_grp g
        LEFT JOIN LATERAL (SELECT s.first_name, s.last_name FROM public.newsletter_subscriptions s
                            WHERE lower(s.email) = g.email
                              AND s.venue_id IS NOT DISTINCT FROM p_s.venue_id AND s.organizer_user_id IS NOT DISTINCT FROM p_s.organizer_user_id
                            LIMIT 1) s ON true
       WHERE g.outcome IS NULL AND g.msg_event IS NOT DISTINCT FROM v_grp.msg_event
       ORDER BY g.phone, g.email
      ON CONFLICT (campaign_id, phone_e164) DO NOTHING;
      UPDATE public.sms_campaigns c SET status = 'scheduled', scheduled_at = now(),
             total_recipients = (SELECT count(*) FROM public.sms_campaign_recipients r WHERE r.campaign_id = c.id),
             estimated_recipients = (SELECT count(*) FROM public.sms_campaign_recipients r WHERE r.campaign_id = c.id),
             estimated_credits = (SELECT count(*) FROM public.sms_campaign_recipients r WHERE r.campaign_id = c.id)
       WHERE c.id = v_child;
      INSERT INTO public.crm_scenario_messages (version_id, node_id, channel, event_key, sms_campaign_id)
      VALUES (p_v.id, p_node_id, 'sms', COALESCE(v_grp.msg_event, '00000000-0000-0000-0000-000000000000'::uuid), v_child);
      UPDATE _scn_grp g SET outcome = 'sent', sms_campaign_id = v_child
       WHERE g.outcome IS NULL AND g.msg_event IS NOT DISTINCT FROM v_grp.msg_event;
      v_child := NULL;
    END LOOP;
  END IF;

  -- Filet : rien ne reste sans issue.
  UPDATE _scn_grp g SET outcome = 'held', reason = 'retry' WHERE g.outcome IS NULL;
  -- Registre de l'étape, puis le suivant.
  UPDATE public.crm_scenario_steps st
     SET status = CASE g.outcome WHEN 'held' THEN 'held' ELSE g.outcome END,
         reason = CASE WHEN g.outcome IN ('held', 'expired') THEN g.reason END,
         campaign_id = COALESCE(g.campaign_id, st.campaign_id), sms_campaign_id = COALESCE(g.sms_campaign_id, st.sms_campaign_id),
         done_at = CASE WHEN g.outcome <> 'held' THEN now() END
    FROM _scn_grp g
   WHERE st.run_id = g.id AND st.node_id = p_node_id AND st.pass = 1 AND g.outcome IS NOT NULL;
  -- Les reportés reviennent : à l'heure dite (espacement), sinon dans une heure.
  UPDATE public.crm_scenario_runs r
     SET due_at = LEAST(COALESCE(g.retry_at, now() + interval '1 hour'), g.window_end + interval '1 minute'), updated_at = now()
    FROM _scn_grp g WHERE r.id = g.id AND g.outcome = 'held';
  UPDATE public.crm_scenario_runs r SET last_message_at = now()
    FROM _scn_grp g WHERE r.id = g.id AND g.outcome IN ('sent', 'would_send');
  -- Journal prévu / réel : contacté pour cette soirée.
  UPDATE public.crm_prediction_people pp SET contacted_at = COALESCE(pp.contacted_at, now())
    FROM _scn_grp g
   WHERE g.outcome = 'sent' AND g.msg_event IS NOT NULL
     AND pp.scope_key = v_key AND pp.event_id = g.msg_event AND pp.email = g.email;
  SELECT count(*) INTO v_sent FROM _scn_grp WHERE outcome IN ('sent', 'would_send');
  UPDATE _scn_grp g SET go_next = true WHERE g.outcome IN ('sent', 'would_send', 'holdout', 'expired');
  RETURN jsonb_build_object('sent', v_sent);
END;
$function$;

-- Un SMS de scénario retombé en brouillon (send-sms-campaign : Yunits
-- insuffisants, identité légale, compte en pause) n'est pas perdu : ses
-- destinataires attendent (« reporté »), la campagne repart seule quand le
-- solde couvre ceux qui restent ; une fenêtre passée les marque « expiré ».
-- Même mécanique que la recette « Faire revenir après la 1re soirée ».
CREATE OR REPLACE FUNCTION public._crm_scenario_sms_retry(p_scope text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  w record;
  v_left integer;
  v_fr integer;
  v_rates jsonb := public.crm_sms_rates();
  v_n integer := 0;
  v_reason text;
BEGIN
  FOR w IN
    SELECT c.id, c.error_message, c.segments_per_message
      FROM public.crm_scenario_messages m
      JOIN public.crm_scenario_versions v ON v.id = m.version_id AND v.scope_key = p_scope
      JOIN public.sms_campaigns c ON c.id = m.sms_campaign_id
     WHERE m.channel = 'sms' AND c.status = 'draft'
       AND c.error_message IN ('crm_yunits_insufficient', 'sms_identity_required', 'crm_paused')
  LOOP
    v_reason := CASE w.error_message WHEN 'crm_yunits_insufficient' THEN 'yunits'
                                     WHEN 'sms_identity_required' THEN 'sms_identity' ELSE 'plan_paused' END;
    -- Fenêtre passée : expiré, retiré de la file.
    UPDATE public.crm_scenario_steps st SET status = 'expired', reason = v_reason, done_at = now()
     WHERE st.sms_campaign_id = w.id AND st.status IN ('sent', 'held') AND st.window_end <= now();
    DELETE FROM public.sms_campaign_recipients q
     WHERE q.campaign_id = w.id AND q.status = 'pending'
       AND NOT EXISTS (SELECT 1 FROM public.crm_scenario_steps st JOIN public.crm_scenario_runs r ON r.id = st.run_id
                        WHERE st.sms_campaign_id = w.id AND st.status IN ('sent', 'held') AND r.email = lower(q.email));
    -- Les autres attendent.
    UPDATE public.crm_scenario_steps st SET status = 'held', reason = v_reason, done_at = NULL
     WHERE st.sms_campaign_id = w.id AND st.status = 'sent';
    SELECT count(*), count(*) FILTER (WHERE q.phone_e164 LIKE '+33%') INTO v_left, v_fr
      FROM public.sms_campaign_recipients q WHERE q.campaign_id = w.id AND q.status = 'pending';
    IF v_left = 0 THEN
      UPDATE public.sms_campaigns SET status = 'cancelled', error_message = 'scenario_window_closed' WHERE id = w.id AND status = 'draft';
    ELSIF v_reason = 'yunits' AND public.crm_yunits_balance(p_scope) >= GREATEST(1, COALESCE(w.segments_per_message, 1))
              * (v_fr * (v_rates->>'fr')::integer + (v_left - v_fr) * (v_rates->>'intl')::integer) THEN
      UPDATE public.sms_campaigns SET status = 'scheduled', scheduled_at = now(), error_message = NULL,
             total_recipients = v_left, estimated_recipients = v_left, estimated_credits = v_left
       WHERE id = w.id AND status = 'draft';
      UPDATE public.crm_scenario_steps st SET status = 'sent', reason = NULL, done_at = now()
       WHERE st.sms_campaign_id = w.id AND st.status = 'held';
      v_n := v_n + v_left;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$function$;

-- ── 6. L'avance d'une portée ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._crm_scenario_advance(p_scope text, p_venue_id text, p_organizer_user_id uuid,
                                                         p_started timestamptz, p_demo boolean, p_hold text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_round  integer;
  v_pair   record;
  s        public.crm_scenarios%ROWTYPE;
  v        public.crm_scenario_versions%ROWTYPE;
  n        jsonb;
  v_t      text;
  v_sql    text;
  v_ev     record;
  v_moved  integer := 0;
  v_exits  integer := 0;
  v_sent   integer := 0;
  v_k      integer;
  v_res    jsonb;
BEGIN
  FOR v_round IN 1..32 LOOP
    EXIT WHEN clock_timestamp() - p_started > interval '4 seconds';
    TRUNCATE _scn_due;
    INSERT INTO _scn_due (id)
    SELECT r.id FROM public.crm_scenario_runs r
      JOIN public.crm_scenarios sc ON sc.id = r.scenario_id AND sc.status = 'active'
     WHERE r.scope_key = p_scope AND r.status = 'active' AND r.due_at <= now()
     ORDER BY r.due_at LIMIT 2000
     FOR UPDATE OF r SKIP LOCKED;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM _scn_due);

    -- Sorties forcées (non réglables).
    WITH x AS (
      SELECT r.id, CASE
               WHEN EXISTS (SELECT 1 FROM public.crm_profile_optouts o WHERE o.scope_key = p_scope AND o.email = r.email) THEN 'optout'
               WHEN public.is_email_suppressed(r.email) THEN 'suppressed'
               WHEN EXISTS (SELECT 1 FROM public.newsletter_subscriptions ns
                             WHERE lower(ns.email) = r.email AND ns.opted_out_at IS NOT NULL AND NOT COALESCE(ns.opted_in, false)
                               AND ns.venue_id IS NOT DISTINCT FROM p_venue_id AND ns.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id) THEN 'unsubscribed'
               WHEN EXISTS (SELECT 1 FROM public.venue_sms_contacts vc JOIN public.sms_stop_list st ON st.phone_e164 = vc.phone_e164
                             WHERE lower(vc.email) = r.email AND (st.scope_key IS NULL OR st.scope_key = p_scope)
                               AND vc.venue_id IS NOT DISTINCT FROM p_venue_id
                               AND (p_venue_id IS NOT NULL OR vc.organizer_user_id = p_organizer_user_id)) THEN 'stop'
               WHEN r.event_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = r.event_id AND e.cancelled_at IS NOT NULL) THEN 'event_cancelled'
             END AS why
        FROM public.crm_scenario_runs r JOIN _scn_due d ON d.id = r.id
    ), done AS (
      UPDATE public.crm_scenario_runs r SET status = 'exited', exit_reason = x.why, updated_at = now()
        FROM x WHERE r.id = x.id AND x.why IS NOT NULL
      RETURNING r.id
    )
    DELETE FROM _scn_due d USING done WHERE d.id = done.id;
    GET DIAGNOSTICS v_k = ROW_COUNT;
    v_exits := v_exits + v_k;

    -- Objectif atteint : sortie, comptée (l'heure de l'achat ou du scan fait foi).
    -- En ensembles : une jointure, jamais une sous-requête par personne.
    WITH rr AS (
      SELECT r.id, r.email, r.event_id, r.entered_at, vv.graph->'goal'->>'type' AS gt
        FROM public.crm_scenario_runs r
        JOIN _scn_due d ON d.id = r.id
        JOIN public.crm_scenario_versions vv ON vv.id = r.version_id
       WHERE jsonb_typeof(vv.graph->'goal') = 'object'
    ), gl AS (
      SELECT rr.id,
             min(CASE WHEN rr.gt IN ('bought_event', 'bought_any') AND public._crm_ticket_is_sale(t.status, t.raw)
                           AND COALESCE(t.purchased_at, t.first_seen_at) >= rr.entered_at
                           AND (rr.gt = 'bought_any' OR t.event_id = rr.event_id)
                      THEN COALESCE(t.purchased_at, t.first_seen_at)
                      WHEN rr.gt = 'entered' AND t.event_id = rr.event_id AND t.scanned_at IS NOT NULL
                      THEN t.scanned_at END) AS at
        FROM rr
        JOIN public.external_tickets t ON lower(t.buyer_email) = rr.email
         AND ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
       GROUP BY rr.id
    ), done AS (
      UPDATE public.crm_scenario_runs r SET status = 'exited', exit_reason = 'goal', goal_at = gl.at, updated_at = now()
        FROM gl WHERE r.id = gl.id AND gl.at IS NOT NULL
      RETURNING r.id
    )
    DELETE FROM _scn_due d USING done WHERE d.id = done.id;
    GET DIAGNOSTICS v_k = ROW_COUNT;
    v_exits := v_exits + v_k;

    -- Les nœuds, par paquet (version, nœud).
    FOR v_pair IN
      SELECT r.version_id, r.node_id, count(*) AS k
        FROM public.crm_scenario_runs r JOIN _scn_due d ON d.id = r.id
       GROUP BY r.version_id, r.node_id
    LOOP
      EXIT WHEN clock_timestamp() - p_started > interval '4 seconds';
      SELECT * INTO v FROM public.crm_scenario_versions WHERE id = v_pair.version_id;
      SELECT * INTO s FROM public.crm_scenarios WHERE id = v.scenario_id;
      n := v.graph->'nodes'->v_pair.node_id;
      v_t := n->>'type';
      TRUNCATE _scn_grp;
      INSERT INTO _scn_grp (id, email, event_id, entered_at, node_since, holdout, last_message_at, version_id, scope_key)
      SELECT r.id, r.email, r.event_id, r.entered_at, r.node_since, r.holdout, r.last_message_at, r.version_id, r.scope_key
        FROM public.crm_scenario_runs r JOIN _scn_due d ON d.id = r.id
       WHERE r.version_id = v_pair.version_id AND r.node_id = v_pair.node_id;

      IF n IS NULL OR v_t = 'end' THEN
        UPDATE _scn_grp SET next_id = NULL, go_next = true;
      ELSIF v_t = 'wait' AND n->>'mode' = 'duration' THEN
        UPDATE _scn_grp g SET go_next = true, next_id = n->>'next'
         WHERE g.node_since + make_interval(hours => (n->>'hours')::integer) <= now();
        UPDATE public.crm_scenario_runs r SET due_at = g.node_since + make_interval(hours => (n->>'hours')::integer)
          FROM _scn_grp g WHERE r.id = g.id AND NOT g.go_next;
      ELSIF v_t = 'wait' AND n->>'mode' = 'until_event' THEN
        -- Une heure par soirée (pas par personne).
        UPDATE _scn_grp g SET retry_at = et.at
          FROM (SELECT x.event_id, public._crm_scenario_event_time(x.event_id, n) AS at
                  FROM (SELECT DISTINCT y.event_id FROM _scn_grp y) x) et
         WHERE et.event_id IS NOT DISTINCT FROM g.event_id;
        UPDATE _scn_grp g SET go_next = true, next_id = n->>'next' WHERE g.retry_at IS NULL OR g.retry_at <= now();
        UPDATE public.crm_scenario_runs r SET due_at = g.retry_at FROM _scn_grp g WHERE r.id = g.id AND NOT g.go_next;
      ELSIF v_t IN ('branch', 'wait') THEN
        -- Une condition : la même compilation que le filtre (le chiffre = l'envoi).
        PERFORM public._crm_scenario_need_cp(p_venue_id, p_organizer_user_id);
        FOR v_ev IN SELECT DISTINCT g.event_id FROM _scn_grp g LOOP
          v_sql := public._crm_cond_sql(public._crm_cond_resolve(p_scope, n->'cond', v_ev.event_id), 'p', 'r');
          EXECUTE format('UPDATE _scn_grp g SET cond_ok = true FROM _cp p, public.crm_scenario_runs r
                           WHERE p.email = g.email AND r.id = g.id AND g.event_id IS NOT DISTINCT FROM %L::uuid AND (%s)',
                         v_ev.event_id, v_sql);
        END LOOP;
        IF v_t = 'branch' THEN
          UPDATE _scn_grp g SET go_next = true, next_id = CASE WHEN g.cond_ok THEN n->>'yes' ELSE n->>'no' END;
        ELSE
          UPDATE _scn_grp g SET go_next = true, next_id = n->>'next' WHERE g.cond_ok;
          UPDATE _scn_grp g SET go_next = true, next_id = n->>'timeout'
           WHERE NOT g.go_next AND g.node_since + make_interval(hours => (n->>'max_hours')::integer) <= now();
          UPDATE public.crm_scenario_runs r
             SET due_at = LEAST(g.node_since + make_interval(hours => (n->>'max_hours')::integer), now() + interval '1 hour')
            FROM _scn_grp g WHERE r.id = g.id AND NOT g.go_next;
        END IF;
      ELSIF v_t = 'split' THEN
        -- Test A/B déterministe : la même personne prend toujours le même chemin.
        UPDATE _scn_grp g SET go_next = true, next_id = pth.nxt
          FROM (SELECT y.id, (SELECT pa.value->>'next'
                                FROM (SELECT z.value, sum((z.value->>'pct')::integer) OVER (ORDER BY z.o) AS cum
                                        FROM jsonb_array_elements(n->'paths') WITH ORDINALITY AS z(value, o)) pa
                               WHERE (abs(hashtext(y.id::text || ':' || v_pair.node_id)) % 100) < pa.cum
                               ORDER BY pa.cum LIMIT 1) AS nxt
                  FROM _scn_grp y) pth
         WHERE pth.id = g.id;
      ELSIF v_t IN ('email', 'sms') THEN
        v_res := public._crm_scenario_message(s, v, v_pair.node_id, n, p_demo, p_hold);
        v_sent := v_sent + COALESCE((v_res->>'sent')::integer, 0);
        UPDATE _scn_grp g SET next_id = n->>'next' WHERE g.go_next;
      ELSIF v_t = 'tag' THEN
        IF NOT p_demo THEN
          INSERT INTO public.crm_contact_notes (scope_key, email, venue_id, organizer_user_id, tags, updated_at)
          SELECT p_scope, g.email, p_venue_id, p_organizer_user_id,
                 CASE WHEN n->>'op' = 'add' THEN ARRAY[btrim(n->>'tag')] ELSE '{}'::text[] END, now()
            FROM _scn_grp g WHERE NOT g.holdout
          ON CONFLICT (scope_key, email) DO UPDATE
            SET tags = CASE WHEN n->>'op' = 'add'
                            THEN (SELECT array_agg(DISTINCT x) FROM unnest(COALESCE(crm_contact_notes.tags, '{}') || ARRAY[btrim(n->>'tag')]) x)
                            ELSE array_remove(COALESCE(crm_contact_notes.tags, '{}'), btrim(n->>'tag')) END,
                updated_at = now();
        END IF;
        UPDATE _scn_grp g SET go_next = true, next_id = n->>'next';
      ELSIF v_t = 'notify' THEN
        INSERT INTO public.crm_scenario_notify_daily (scenario_id, node_id, day, n)
        SELECT s.id, v_pair.node_id, current_date, count(*) FROM _scn_grp
        ON CONFLICT (scenario_id, node_id, day) DO UPDATE SET n = crm_scenario_notify_daily.n + EXCLUDED.n;
        UPDATE _scn_grp g SET go_next = true, next_id = n->>'next';
      ELSE
        -- Nœud inconnu (version ancienne) : la personne sort proprement.
        UPDATE _scn_grp g SET go_next = true, next_id = NULL;
      END IF;

      -- Registre (nœuds non-messages) et passage au suivant.
      IF v_t IS NULL OR v_t NOT IN ('email', 'sms') THEN
        INSERT INTO public.crm_scenario_steps (run_id, node_id, scenario_id, version_id, status, done_at)
        SELECT g.id, v_pair.node_id, s.id, v.id, 'passed', now() FROM _scn_grp g WHERE g.go_next
        ON CONFLICT (run_id, node_id, pass) DO NOTHING;
      END IF;
      UPDATE public.crm_scenario_runs r
         SET node_id = g.next_id, node_since = now(), due_at = now(), updated_at = now(),
             status = CASE WHEN g.next_id IS NULL OR v_t = 'end' THEN 'done' ELSE r.status END,
             exit_reason = CASE WHEN g.next_id IS NULL OR v_t = 'end' THEN 'end' ELSE r.exit_reason END
        FROM _scn_grp g WHERE r.id = g.id AND g.go_next;
      GET DIAGNOSTICS v_k = ROW_COUNT;
      v_moved := v_moved + v_k;
      -- Ce paquet est traité pour ce tour.
      DELETE FROM _scn_due d USING _scn_grp g WHERE d.id = g.id;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('moved', v_moved, 'exits', v_exits, 'sent', v_sent);
END;
$function$;

-- ── 7. Le passage du moteur ─────────────────────────────────────────────────
-- Les tables de travail des entrées (le passage et l'aperçu).
CREATE OR REPLACE FUNCTION public._crm_scenario_temp()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _scn_cand (email text, event_id uuid, window_end timestamptz, tk text,
                                             UNIQUE NULLS NOT DISTINCT (email, event_id)) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _scn_cand_all (event_id uuid) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _scn_ok (email text, event_id uuid, tk text, window_end timestamptz,
                                           UNIQUE (email, tk)) ON COMMIT DROP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_scenario_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_scope   record;
  s         public.crm_scenarios%ROWTYPE;
  v         public.crm_scenario_versions%ROWTYPE;
  st        public.crm_scenario_scope_state%ROWTYPE;
  v_demo    boolean;
  v_hold    text;
  v_enter   jsonb;
  v_adv     jsonb;
  v_out     jsonb := '[]'::jsonb;
  v_now     timestamptz := now();
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM public._crm_scenario_temp();
  CREATE TEMP TABLE IF NOT EXISTS _scn_due (id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _scn_grp (id uuid PRIMARY KEY, email text, event_id uuid, entered_at timestamptz,
                                            node_since timestamptz, holdout boolean, last_message_at timestamptz,
                                            version_id uuid, scope_key text, msg_event uuid, window_end timestamptz,
                                            outcome text, reason text, retry_at timestamptz, phone text,
                                            campaign_id uuid, sms_campaign_id uuid, cond_ok boolean NOT NULL DEFAULT false,
                                            go_next boolean NOT NULL DEFAULT false, next_id text) ON COMMIT DROP;

  FOR v_scope IN
    SELECT x.scope_key, min(x.venue_id) AS venue_id, (array_agg(x.organizer_user_id))[1] AS organizer_user_id
      FROM public.crm_scenarios x
     WHERE x.status = 'active'
     GROUP BY x.scope_key
     ORDER BY (SELECT y.last_tick_at FROM public.crm_scenario_scope_state y WHERE y.scope_key = x.scope_key) NULLS FIRST
  LOOP
    EXIT WHEN clock_timestamp() - v_started > interval '4 seconds';
    CONTINUE WHEN NOT pg_try_advisory_xact_lock(hashtext('crm_scenario:' || v_scope.scope_key));
    BEGIN
      INSERT INTO public.crm_scenario_scope_state (scope_key) VALUES (v_scope.scope_key) ON CONFLICT DO NOTHING;
      SELECT * INTO st FROM public.crm_scenario_scope_state WHERE scope_key = v_scope.scope_key;
      v_demo := public.is_demo_marketing_scope(v_scope.venue_id, v_scope.organizer_user_id);
      v_hold := public._crm_scenario_hold_reason(v_scope.scope_key);
      v_enter := '[]'::jsonb;
      -- Entrées : jamais quand le compte ne peut pas envoyer (gel, pause).
      IF v_hold IS NULL THEN
        FOR s IN SELECT * FROM public.crm_scenarios x WHERE x.scope_key = v_scope.scope_key AND x.status = 'active' ORDER BY x.created_at LOOP
          EXIT WHEN clock_timestamp() - v_started > interval '4 seconds';
          SELECT * INTO v FROM public.crm_scenario_versions WHERE id = s.live_version_id;
          CONTINUE WHEN v.id IS NULL;
          v_enter := v_enter || jsonb_build_object('scenario', s.id) || public._crm_scenario_enter(s, v, st.ticket_mark, st.signup_mark);
        END LOOP;
      END IF;
      v_adv := public._crm_scenario_advance(v_scope.scope_key, v_scope.venue_id, v_scope.organizer_user_id, v_started, v_demo, v_hold);
      v_adv := v_adv || jsonb_build_object('sms_retried', public._crm_scenario_sms_retry(v_scope.scope_key));
      UPDATE public.crm_scenario_scope_state
         -- Repères avec une heure de marge : la clé unique des inscriptions empêche tout doublon.
         SET last_tick_at = v_now, ticket_mark = v_now - interval '1 hour', signup_mark = v_now - interval '1 hour',
             last_result = jsonb_build_object('enter', v_enter, 'advance', v_adv, 'hold', v_hold, 'demo', v_demo), updated_at = now()
       WHERE scope_key = v_scope.scope_key;
      v_out := v_out || jsonb_build_object('scope', v_scope.scope_key, 'advance', v_adv);
    EXCEPTION WHEN others THEN
      -- Une portée en erreur ne fait jamais tomber les autres.
      RAISE WARNING 'crm_scenario_tick (%): %', v_scope.scope_key, SQLERRM;
      v_out := v_out || jsonb_build_object('scope', v_scope.scope_key, 'error', SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('scopes', v_out, 'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000));
END;
$function$;

-- ── 7 bis. Effacer un contact : ses scénarios aussi ─────────────────────────
-- Corps repris du dépôt (= prod, vérifié par scripts/crm-bench/same-as-prod.mjs
-- --before 20261016100000), seul le bloc « Scénarios » est ajouté.
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

  -- Scénarios (20261016130000) : les inscriptions passées restent comptées
  -- (chiffres du scénario, témoin), sous une adresse qui ne désigne plus
  -- personne ; une inscription en route sort (« contact effacé ») ; ses
  -- entrées en attente et la base d'un déclencheur « segment » partent.
  UPDATE public.crm_scenario_runs r
     SET email = 'erased-' || md5(r.email) || '@erased.invalid',
         status = CASE WHEN r.status = 'active' THEN 'exited' ELSE r.status END,
         exit_reason = CASE WHEN r.status = 'active' THEN 'erased' ELSE r.exit_reason END,
         updated_at = now()
   WHERE r.scope_key = v_key AND r.email = ANY (v_emails);
  DELETE FROM public.crm_scenario_pending pd USING public.crm_scenarios s
   WHERE s.id = pd.scenario_id AND s.scope_key = v_key AND pd.email = ANY (v_emails);
  DELETE FROM public.crm_scenario_seen sn USING public.crm_scenarios s
   WHERE s.id = sn.scenario_id AND s.scope_key = v_key AND sn.email = ANY (v_emails);

  -- L'adresse portée par un destinataire SMS (20261013120000) part aussi.
  UPDATE public.sms_campaign_recipients r
     SET email = NULL
    FROM public.sms_campaigns c
   WHERE c.id = r.campaign_id
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND c.organizer_id IS NOT DISTINCT FROM CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END
     AND lower(r.email) = ANY (v_emails);

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
REVOKE ALL ON FUNCTION public._crm_erase_contacts(text, uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_erase_contacts(text, uuid, text[]) TO service_role;

-- ── 8. Droits et cron ───────────────────────────────────────────────────────
DO $grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    '_crm_scenario_event_time(uuid, jsonb)', '_crm_sms_segments_estimate(text)', '_crm_scenario_temp()',
    '_crm_scenario_pick_events(text, uuid, text[])', '_crm_scenario_hold_reason(text)',
    '_crm_scenario_need_cp(text, uuid)', '_crm_scenario_mark_done(public.crm_scenarios, jsonb)',
    '_crm_scenario_candidates(public.crm_scenarios, jsonb, timestamptz, timestamptz, timestamptz, boolean)',
    '_crm_scenario_enter(public.crm_scenarios, public.crm_scenario_versions, timestamptz, timestamptz, boolean)',
    '_crm_scenario_message(public.crm_scenarios, public.crm_scenario_versions, text, jsonb, boolean, text)',
    '_crm_scenario_advance(text, text, uuid, timestamptz, boolean, text)', '_crm_scenario_sms_retry(text)',
    'crm_scenario_tick()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END
$grants$;

DO $cron$
BEGIN
  PERFORM cron.unschedule('crm-scenario-tick') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crm-scenario-tick');
  -- Toutes les 10 minutes, hors des minutes des autres crons CRM.
  PERFORM cron.schedule('crm-scenario-tick', '2,12,22,32,42,52 * * * *', $job$SELECT public.crm_scenario_tick()$job$);
END
$cron$;
