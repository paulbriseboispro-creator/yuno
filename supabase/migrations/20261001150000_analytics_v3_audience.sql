-- Analytics v3 — onglet Audience (phase 1 : la base).
--
-- Nouveaux vs habitués par soirée, taux de retour 90 j, top clients (portée
-- club / orga seulement : un client est « à toi » parce qu'il est venu chez
-- toi), âge par tranches, genre s'il est collecté, villes. Toute cellule
-- démographique de moins de 10 personnes est MASQUÉE (« < 10 », valeur NULL).

CREATE OR REPLACE FUNCTION public.get_analytics_audience(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL,
  p_event_id uuid DEFAULT NULL, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g          record;
  v_ids      uuid[];
  v_now      timestamptz := now();
  v_k        constant integer := 10;
  v_nights   jsonb;
  v_return   jsonb;
  v_top      jsonb;
  v_age      jsonb;
  v_gender   jsonb;
  v_cities   jsonb;
  v_totals   jsonb;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;
  v_ids := public._an3_subject_ids(g.scope_ids, g.tz, p_event_id, p_from, p_to);
  IF p_event_id IS NOT NULL AND cardinality(v_ids) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  WITH pp AS MATERIALIZED (
    SELECT p.* FROM public._an3_people(g.scope_ids, g.scope_venue) p
  ),
  subj AS (
    SELECT pp.* FROM pp WHERE pp.event_id = ANY(v_ids)
  ),
  ev AS (
    SELECT e.id, e.title, e.start_at FROM public.events e WHERE e.id = ANY(v_ids)
  ),
  per_night AS (
    SELECT ev.id, ev.title, ev.start_at,
           count(DISTINCT s.email)::int AS customers,
           count(DISTINCT s.email) FILTER (WHERE s.first_event = ev.id)::int AS new_customers
      FROM ev LEFT JOIN subj s ON s.event_id = ev.id
     GROUP BY ev.id, ev.title, ev.start_at
  ),
  -- Taux de retour : sur les 90 derniers jours de la portée, qui est venu 2 fois ou plus.
  last90 AS (
    SELECT pp.email, count(DISTINCT pp.event_id) AS nights
      FROM pp JOIN public.events e ON e.id = pp.event_id
     WHERE e.start_at >= v_now - interval '90 days' AND e.start_at <= v_now
     GROUP BY pp.email
  ),
  top AS (
    SELECT s.email, s.user_id, count(DISTINCT s.event_id)::int AS nights, round(sum(s.amount), 2) AS spend, max(s.at_ts) AS last_at,
           count(*) FILTER (WHERE s.pillar = 'tables')::int AS tables
      FROM subj s GROUP BY s.email, s.user_id
  ),
  -- Âge : profil (date de naissance) sinon déclaration d'âge d'une commande / table.
  ages AS (
    SELECT DISTINCT ON (s.email) s.email,
           coalesce(pr.birth_date, o.age_declaration_birth_date, r.age_declaration_birth_date) AS birth
      FROM subj s
      LEFT JOIN public.profiles pr ON pr.id = s.user_id
      LEFT JOIN LATERAL (SELECT o.age_declaration_birth_date FROM public.orders o WHERE o.event_id = s.event_id AND lower(o.user_email) = s.email AND o.age_declaration_birth_date IS NOT NULL LIMIT 1) o ON true
      LEFT JOIN LATERAL (SELECT r.age_declaration_birth_date FROM public.table_reservations r WHERE r.event_id = s.event_id AND lower(r.user_email) = s.email AND r.age_declaration_birth_date IS NOT NULL LIMIT 1) r ON true
  ),
  age_bands AS (
    SELECT CASE WHEN a.age < 18 THEN 'u18' WHEN a.age <= 20 THEN '18_20' WHEN a.age <= 24 THEN '21_24' WHEN a.age <= 29 THEN '25_29' WHEN a.age <= 34 THEN '30_34' ELSE '35p' END AS band,
           count(*)::int AS n
      FROM (SELECT extract(year FROM age(v_now, birth))::int AS age FROM ages WHERE birth IS NOT NULL) a
     GROUP BY 1
  ),
  genders AS (
    SELECT lower(coalesce(pr.gender, gl.gender)) AS gender, count(DISTINCT s.email)::int AS n
      FROM subj s
      LEFT JOIN public.profiles pr ON pr.id = s.user_id
      LEFT JOIN LATERAL (SELECT x.gender FROM public.guest_list_entries x JOIN public.guest_lists g2 ON g2.id = x.guest_list_id WHERE g2.event_id = s.event_id AND lower(x.email) = s.email AND x.gender IS NOT NULL LIMIT 1) gl ON true
     WHERE coalesce(pr.gender, gl.gender) IS NOT NULL
     GROUP BY 1
  ),
  cities AS (
    SELECT initcap(trim(pr.city)) AS city, count(DISTINCT s.email)::int AS n
      FROM subj s JOIN public.profiles pr ON pr.id = s.user_id
     WHERE nullif(trim(pr.city), '') IS NOT NULL
     GROUP BY 1
  )
  SELECT
    coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'title', title, 'start_at', start_at, 'customers', customers,
               'new_customers', new_customers, 'returning', customers - new_customers) ORDER BY start_at) FROM per_night), '[]'::jsonb),
    jsonb_build_object(
      'customers', (SELECT count(*) FROM last90),
      'returning', (SELECT count(*) FROM last90 WHERE nights >= 2),
      'rate', (SELECT CASE WHEN count(*) >= v_k THEN round(100.0 * count(*) FILTER (WHERE nights >= 2) / count(*), 1) END FROM last90)),
    CASE WHEN g.money THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'email', t.email, 'name', nullif(trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), ''),
        'nights', t.nights, 'tables', t.tables, 'spend', t.spend, 'last_at', t.last_at) ORDER BY t.spend DESC, t.nights DESC)
      FROM (SELECT * FROM top ORDER BY spend DESC, nights DESC LIMIT 10) t
      LEFT JOIN public.profiles pr ON pr.id = t.user_id), '[]'::jsonb) ELSE '[]'::jsonb END,
    jsonb_build_object(
      'known', (SELECT coalesce(sum(n), 0) FROM age_bands),
      'bands', (SELECT jsonb_agg(jsonb_build_object('band', b.band, 'n', CASE WHEN ab.n >= v_k THEN ab.n END, 'masked', ab.n IS NOT NULL AND ab.n < v_k) ORDER BY b.ord)
                  FROM (VALUES ('18_20', 1), ('21_24', 2), ('25_29', 3), ('30_34', 4), ('35p', 5)) b(band, ord)
                  LEFT JOIN age_bands ab ON ab.band = b.band)),
    jsonb_build_object(
      'known', (SELECT coalesce(sum(n), 0) FROM genders),
      'rows', coalesce((SELECT jsonb_agg(jsonb_build_object('gender', gender, 'n', CASE WHEN n >= v_k THEN n END, 'masked', n < v_k) ORDER BY n DESC) FROM genders), '[]'::jsonb)),
    jsonb_build_object(
      'known', (SELECT coalesce(sum(n), 0) FROM cities),
      'rows', coalesce((SELECT jsonb_agg(jsonb_build_object('city', city, 'n', n) ORDER BY n DESC) FROM (SELECT * FROM cities WHERE n >= v_k ORDER BY n DESC LIMIT 10) c), '[]'::jsonb),
      'masked', (SELECT count(*) FROM cities WHERE n < v_k)),
    jsonb_build_object(
      'customers', (SELECT count(DISTINCT email) FROM subj),
      'new_customers', (SELECT count(DISTINCT email) FROM subj WHERE first_event = ANY(v_ids)),
      'buyers', (SELECT count(DISTINCT email) FROM subj WHERE pillar <> 'guest_list'))
    INTO v_nights, v_return, v_top, v_age, v_gender, v_cities, v_totals;

  RETURN jsonb_build_object('ok', true, 'money', g.money, 'nights', cardinality(v_ids), 'k', v_k,
    'per_night', v_nights, 'return_90d', v_return, 'top_customers', v_top,
    'age', v_age, 'gender', v_gender, 'cities', v_cities, 'totals', v_totals);
END;
$$;
REVOKE ALL ON FUNCTION public.get_analytics_audience(text, uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_audience(text, uuid, uuid, timestamptz, timestamptz) TO authenticated;
