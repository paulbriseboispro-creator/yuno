-- Yuno Tickets › Analyses › Gratuits, lot 6 du plan combiné
-- (docs/designs/TICKETS_ANALYTICS_COMBINED_PLAN.md) : ce que la Billetterie
-- disait de ses guest lists et que la copie du CRM ne disait pas. Une lecture à
-- part, `tix_ana_free_detail`, avec les règles de l'onglet Gratuits
-- (tix_ana_guestlist) : « venu » = scanné sur une PORTE MESURÉE
-- (_crm_door_measured), aucun pourcentage sous 10.
--
--   1. Quotas et remplissage : chaque liste (part de guest list) des soirées
--      de la période et des soirées à venir, son quota, ses inscrits, « complet ».
--   2. Les détenteurs de liste (club, organisateur, promoteur, DJ, invité de la
--      soirée) : listes, inscrits, venus, absents, devenus clients payants.
--   3. Un invité vaut-il un client payant ? Sur les soirées à porte mesurée :
--      ce qu'un invité venu a dépensé sur place (tables VIP de la soirée) contre
--      un client payant entré (son billet + ses tables de la soirée), et ce que
--      les invités venus ont acheté dans les 90 jours suivants. Le bar est en
--      pause (DRINKS_PILLAR_LIVE) : il n'entre pas dans le calcul.
--   4. Le coût des absents : inscrits non venus sur une porte mesurée, dont ceux
--      qui tenaient une place d'une liste complète, et ce qu'ils auraient
--      dépensé au prix moyen d'un invité venu.
--
-- Montants sous `revenue` / `amount` : l'enveloppe de l'argent les efface.

CREATE OR REPLACE FUNCTION public.tix_ana_free_detail__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_tz text := 'Europe/Paris';
  v_eh integer;
  v_today date;
  v_n integer := CASE p_period WHEN '24h' THEN 1 WHEN '48h' THEN 2 WHEN '7d' THEN 7 WHEN '90d' THEN 90 WHEN '12m' THEN 365 ELSE 30 END;
  v_from date;
  v_out jsonb;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT r.night_end_hour INTO v_eh FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id) r;
  v_today := public._crm_night_date(now(), v_tz, COALESCE(v_eh, 6));
  v_from := v_today - (v_n - 1);

  -- Soirées : celles de la période (commencées) et celles à venir (pour les quotas).
  DROP TABLE IF EXISTS _fev;
  CREATE TEMP TABLE _fev ON COMMIT DROP AS
  SELECT ev.id, ev.title, ev.start_at, ev.end_at, ev.money,
         public._crm_night_date(ev.start_at, ev.tz, COALESCE(v_eh, 6)) AS night,
         ev.start_at <= now() AS started, ev.end_at <= now() AS over
    FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) ev
   WHERE CASE WHEN p_event IS NOT NULL THEN ev.id = p_event
              ELSE public._crm_night_date(ev.start_at, ev.tz, COALESCE(v_eh, 6)) >= v_from END;

  -- Ventes valides de la portée (billets, tables, guest list) : la porte mesurée
  -- se juge sur toutes les entrées valides de la soirée, comme l'onglet Gratuits.
  DROP TABLE IF EXISTS _fsale;
  CREATE TEMP TABLE _fsale ON COMMIT DROP AS
  SELECT t.id, t.event_id, t.pillar, t.email, t.amount, t.price, t.purchased_at AS at, t.scanned_at,
         public._crm_ticket_is_sale(t.status, t.deal_channel) AND COALESCE(t.price, 0) > 0 AS paid
    FROM public._tix_sales(p_venue_id, p_organizer_user_id) t
   WHERE t.status = 'valid';
  CREATE INDEX ON _fsale (email);
  CREATE INDEX ON _fsale (event_id);

  DROP TABLE IF EXISTS _fdoor;
  CREATE TEMP TABLE _fdoor ON COMMIT DROP AS
  SELECT e.id,
         e.over AND public._crm_door_measured(count(s.id), count(s.id) FILTER (WHERE s.scanned_at IS NOT NULL)) AS known
    FROM _fev e LEFT JOIN _fsale s ON s.event_id = e.id
   GROUP BY e.id, e.over;

  -- Les listes et leurs inscrits.
  DROP TABLE IF EXISTS _flist;
  CREATE TEMP TABLE _flist ON COMMIT DROP AS
  SELECT gl.id, gl.event_id, gl.quota, COALESCE(gl.manually_sold_out, false) AS closed,
         COALESCE('pr:' || gl.promoter_id::text, 'dj:' || gl.dj_id::text, 'gp:' || gl.guest_pass_id::text,
                  COALESCE(NULLIF(gl.holder_type, ''), 'club') || ':' || COALESCE(NULLIF(btrim(gl.holder_label), ''), '')) AS hkey,
         CASE WHEN gl.promoter_id IS NOT NULL THEN 'promoter' WHEN gl.dj_id IS NOT NULL THEN 'dj'
              WHEN gl.guest_pass_id IS NOT NULL THEN 'guest'
              WHEN gl.holder_type = 'organizer' THEN 'organizer'
              WHEN gl.holder_type IN ('club', 'venue') THEN 'club' ELSE 'custom' END AS htype,
         COALESCE(
           (SELECT NULLIF(btrim(concat_ws(' ', NULLIF(btrim(p.first_name), ''), NULLIF(btrim(p.last_name), ''))), '')
              FROM public.promoters p WHERE p.id = gl.promoter_id),
           (SELECT NULLIF(btrim(d.stage_name), '') FROM public.djs d WHERE d.id = gl.dj_id),
           (SELECT NULLIF(btrim(h.guest_name), '') FROM public.event_guest_passes h WHERE h.id = gl.guest_pass_id),
           NULLIF(btrim(gl.holder_label), '')) AS hlabel
    FROM public.guest_lists gl
    JOIN _fev e ON e.id = gl.event_id;

  DROP TABLE IF EXISTS _fent;
  CREATE TEMP TABLE _fent ON COMMIT DROP AS
  SELECT g.id, g.guest_list_id AS list_id, l.event_id, lower(NULLIF(btrim(g.email), '')) AS email,
         (COALESCE(g.entry_scanned, false) OR g.status = 'entered') AS came,
         e.start_at, e.started, e.over, e.night, COALESCE(d.known, false) AS known,
         l.hkey, l.quota, l.closed
    FROM public.guest_list_entries g
    JOIN _flist l ON l.id = g.guest_list_id
    JOIN _fev e ON e.id = l.event_id
    LEFT JOIN _fdoor d ON d.id = e.id
   WHERE g.status NOT IN ('cancelled', 'rejected', 'refused', 'declined');
  CREATE INDEX ON _fent (email);

  -- Remplissage de chaque liste, et « complète » (quota atteint ou fermée à la main).
  DROP TABLE IF EXISTS _ffill;
  CREATE TEMP TABLE _ffill ON COMMIT DROP AS
  SELECT l.id, l.event_id, l.hkey, l.quota, l.closed, count(f.id) AS entries,
         (l.closed OR (l.quota IS NOT NULL AND l.quota > 0 AND count(f.id) >= l.quota)) AS is_full
    FROM _flist l LEFT JOIN _fent f ON f.list_id = l.id
   GROUP BY l.id, l.event_id, l.hkey, l.quota, l.closed;

  -- Chaque invité d'une soirée passée de la période : payait-il avant, a-t-il payé après ?
  DROP TABLE IF EXISTS _fconv;
  CREATE TEMP TABLE _fconv ON COMMIT DROP AS
  SELECT f.id, f.email, f.hkey,
         EXISTS (SELECT 1 FROM _fsale s WHERE s.email = f.email AND s.paid AND s.at < f.start_at) AS paid_before,
         EXISTS (SELECT 1 FROM _fsale s WHERE s.email = f.email AND s.paid AND s.at > f.start_at) AS paid_after
    FROM _fent f
   WHERE f.over AND f.email IS NOT NULL;

  WITH
  -- 1. Quotas
  q AS (
    SELECT count(*) AS lists,
           count(*) FILTER (WHERE quota IS NOT NULL AND quota > 0) AS capped,
           COALESCE(sum(quota) FILTER (WHERE quota IS NOT NULL AND quota > 0), 0) AS quota,
           COALESCE(sum(LEAST(entries, quota)) FILTER (WHERE quota IS NOT NULL AND quota > 0), 0) AS filled,
           count(*) FILTER (WHERE is_full) AS full_lists
      FROM _ffill
  ),
  qev AS (
    SELECT e.id, e.title, e.start_at, NOT e.started AS upcoming,
           count(f.id) AS lists, COALESCE(sum(f.quota) FILTER (WHERE f.quota > 0), 0) AS quota,
           COALESCE(sum(f.entries), 0) AS entries, count(*) FILTER (WHERE f.is_full) AS full_lists
      FROM _fev e JOIN _ffill f ON f.event_id = e.id
     GROUP BY e.id, e.title, e.start_at, e.started
  ),
  -- 2. Détenteurs
  hl AS (
    SELECT l.hkey, min(l.htype) AS htype, min(l.hlabel) AS hlabel,
           count(DISTINCT l.id) AS lists, count(DISTINCT l.event_id) AS nights,
           COALESCE(sum(ff.quota) FILTER (WHERE ff.quota > 0), 0) AS quota
      FROM _flist l JOIN _ffill ff ON ff.id = l.id
     GROUP BY l.hkey
  ),
  he AS (
    SELECT hkey, count(*) AS entries,
           count(*) FILTER (WHERE known) AS k_entries,
           count(*) FILTER (WHERE known AND came) AS k_came,
           count(*) FILTER (WHERE known AND NOT came) AS k_noshow,
           count(*) FILTER (WHERE NOT started) AS upcoming
      FROM _fent GROUP BY hkey
  ),
  hc AS (
    SELECT hkey, count(DISTINCT email) FILTER (WHERE NOT paid_before) AS eligible,
           count(DISTINCT email) FILTER (WHERE NOT paid_before AND paid_after) AS converted
      FROM _fconv GROUP BY hkey
  ),
  -- 3. Un invité vaut-il un client payant ? (soirées à porte mesurée)
  came AS (
    SELECT DISTINCT f.event_id, f.email FROM _fent f WHERE f.known AND f.came AND f.email IS NOT NULL
  ),
  guest_night AS (
    SELECT (SELECT count(*) FROM came) AS n,
           COALESCE((SELECT sum(s.amount) FROM _fsale s JOIN came c ON c.event_id = s.event_id AND c.email = s.email
                      WHERE s.pillar = 'tables'), 0) AS spend
  ),
  payers AS (
    SELECT DISTINCT s.event_id, s.email
      FROM _fsale s JOIN _fdoor d ON d.id = s.event_id AND d.known
     WHERE s.paid AND s.pillar = 'tickets' AND s.scanned_at IS NOT NULL AND s.email IS NOT NULL
  ),
  paid_night AS (
    SELECT (SELECT count(*) FROM payers) AS n,
           COALESCE((SELECT sum(s.amount) FROM _fsale s JOIN payers p ON p.event_id = s.event_id AND p.email = s.email
                      WHERE s.pillar IN ('tickets', 'tables')), 0) AS spend
  ),
  guest_later AS (
    SELECT COALESCE(sum(s.amount), 0) AS spend
      FROM came c
      JOIN _fev e ON e.id = c.event_id
      JOIN _fsale s ON s.email = c.email AND s.paid AND s.at > e.start_at AND s.at <= e.start_at + interval '90 days'
  ),
  -- 4. Absents
  ns AS (
    SELECT count(*) FILTER (WHERE known AND NOT came) AS noshow,
           count(*) FILTER (WHERE known) AS k_entries,
           count(*) FILTER (WHERE known AND NOT came AND (closed OR (quota > 0 AND (SELECT ff.entries FROM _ffill ff WHERE ff.id = _fent.list_id) >= quota))) AS noshow_full,
           count(*) FILTER (WHERE over AND NOT known) AS unmeasured
      FROM _fent
  )
  SELECT jsonb_build_object(
    'meta', jsonb_build_object('period', p_period, 'days', v_n, 'from', v_from, 'to', v_today, 'event', p_event,
                               'money', public._tix_money(p_venue_id, p_organizer_user_id)),
    'quotas', (SELECT jsonb_build_object(
        'lists', q.lists, 'capped', q.capped, 'quota', q.quota, 'filled', q.filled, 'full_lists', q.full_lists,
        'fill', CASE WHEN q.quota >= 10 THEN round(100.0 * q.filled / q.quota, 1) END,
        'nights', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', x.id, 'title', x.title, 'start_at', x.start_at, 'upcoming', x.upcoming, 'lists', x.lists,
            'quota', x.quota, 'entries', x.entries, 'full_lists', x.full_lists,
            'fill', CASE WHEN x.quota >= 10 THEN round(100.0 * LEAST(x.entries, x.quota) / x.quota, 1) END)
            ORDER BY x.upcoming DESC, CASE WHEN x.upcoming THEN x.start_at END ASC, x.start_at DESC)
            FROM (SELECT * FROM qev ORDER BY upcoming DESC, start_at DESC LIMIT 16) x), '[]'::jsonb))
      FROM q),
    'holders', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'key', hl.hkey, 'type', hl.htype, 'label', hl.hlabel, 'lists', hl.lists, 'nights', hl.nights, 'quota', hl.quota,
        'entries', COALESCE(he.entries, 0), 'upcoming', COALESCE(he.upcoming, 0),
        'k_entries', COALESCE(he.k_entries, 0), 'came', COALESCE(he.k_came, 0), 'noshow', COALESCE(he.k_noshow, 0),
        'showup', CASE WHEN COALESCE(he.k_entries, 0) >= 10 THEN round(100.0 * he.k_came / he.k_entries, 1) END,
        'eligible', COALESCE(hc.eligible, 0), 'converted', COALESCE(hc.converted, 0),
        'conv_pct', CASE WHEN COALESCE(hc.eligible, 0) >= 10 THEN round(100.0 * hc.converted / hc.eligible, 1) END)
        ORDER BY COALESCE(he.entries, 0) DESC, hl.hlabel)
        FROM hl LEFT JOIN he ON he.hkey = hl.hkey LEFT JOIN hc ON hc.hkey = hl.hkey), '[]'::jsonb),
    'worth', (SELECT jsonb_build_object(
        'guests', g.n, 'payers', p.n,
        'guest_night', jsonb_build_object('amount', CASE WHEN g.n >= 10 THEN round(g.spend / g.n, 2) END),
        'paid_night', jsonb_build_object('amount', CASE WHEN p.n >= 10 THEN round(p.spend / p.n, 2) END),
        'guest_later', jsonb_build_object('amount', CASE WHEN g.n >= 10 THEN round(gl.spend / g.n, 2) END),
        'revenue', round(g.spend + gl.spend, 2))
        FROM guest_night g, paid_night p, guest_later gl),
    'noshow', (SELECT jsonb_build_object(
        'noshow', ns.noshow, 'k_entries', ns.k_entries, 'held_full', ns.noshow_full, 'unmeasured', ns.unmeasured,
        'rate', CASE WHEN ns.k_entries >= 10 THEN round(100.0 * ns.noshow / ns.k_entries, 1) END,
        'lost', jsonb_build_object('amount', CASE WHEN g.n >= 10 THEN round(ns.noshow * g.spend / g.n, 2) END))
        FROM ns, guest_night g)
  ) INTO v_out;
  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tix_ana_free_detail(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._tix_money_gate(public.tix_ana_free_detail__core(p_venue_id, p_organizer_user_id, p_period, p_event), p_venue_id, p_organizer_user_id);
$function$;

-- ── Droits ────────────────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('tix_ana_free_detail__core', 'tix_ana_free_detail') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    IF r.proname = 'tix_ana_free_detail' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
  END LOOP;
END $$;

-- ── Aperçu démo : la lecture crée des tables temporaires ───────────────────
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.demo_preview_writable_rpc(text)'::regprocedure);
  IF position('''tix_ana_free_detail''' IN v_def) = 0 THEN
    IF position('''tix_ana_sales''' IN v_def) = 0 THEN
      RAISE EXCEPTION 'demo_preview_writable_rpc: tix_ana_sales introuvable, insertion impossible';
    END IF;
    v_def := replace(v_def, '''tix_ana_sales''', '''tix_ana_sales'', ''tix_ana_free_detail''');
    EXECUTE v_def;
  END IF;
END $$;
