-- Admin CRM › Vente › Comptes cibles : les clubs et organisateurs à approcher,
-- dans les villes où Yuno CRM a déjà au moins un compte.
--
-- Source : venues (non décommissionnés) et organizer_profiles SANS espace CRM
-- (produit ≠ 'crm'), démo exclue (demo_venue_ids, is_demo_email). Une cible est
-- « approchée » si un prospect du pipeline porte le même nom dans la même ville
-- (comparaison sans accents ni casse). « Ajouter au pipeline » crée UNE ligne
-- crm_prospects (source « Comptes cibles ») : c'est le seul endroit où un contact
-- est écrit ; rien n'est envoyé à personne.

CREATE OR REPLACE FUNCTION public._crm_norm(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(regexp_replace(lower(translate(COALESCE(p, ''),
    'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñ', 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')), '[^a-z0-9]+', ' ', 'g'), ' ');
$$;

CREATE OR REPLACE FUNCTION public._crm_admin_target_rows(p_include_demo boolean)
RETURNS TABLE (key text, name text, city text, city_n text, kind text, email text, phone text, contact text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH d AS MATERIALIZED (SELECT public.demo_venue_ids() AS dv)
  SELECT 'venue:' || v.id, v.name::text, v.city::text, trim(public._crm_norm(v.city)), 'club',
         pr.email, pr.phone, NULLIF(trim(concat_ws(' ', pr.first_name, pr.last_name)), '')
    FROM public.venues v CROSS JOIN d
    LEFT JOIN public.profiles pr ON pr.id = v.owner_id
   WHERE COALESCE(v.product, 'suite') <> 'crm' AND v.decommissioned_at IS NULL
     AND COALESCE(trim(v.city), '') <> ''
     AND (p_include_demo OR (NOT (v.id = ANY(d.dv)) AND NOT COALESCE(public.is_demo_email(pr.email), false)))
  UNION ALL
  SELECT 'org:' || o.user_id, COALESCE(NULLIF(o.display_name, ''), p.organization_name, 'Organisation')::text, o.city::text,
         trim(public._crm_norm(o.city)), CASE WHEN COALESCE(o.bde_verified, false) THEN 'association' ELSE 'organizer' END,
         p.email, p.phone, NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), '')
    FROM public.organizer_profiles o
    JOIN public.profiles p ON p.id = o.user_id
   WHERE COALESCE(o.product, 'suite') <> 'crm' AND COALESCE(trim(o.city), '') <> ''
     AND (p_include_demo OR NOT COALESCE(public.is_demo_email(p.email), false));
$$;
REVOKE ALL ON FUNCTION public._crm_admin_target_rows(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_admin_target_rows(boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_admin_targets(p_include_demo boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
  v_out jsonb;
BEGIN
  PERFORM public._crm_admin_gate();
  v_rows := public._crm_admin_rows(p_include_demo);
  WITH acc AS (
    SELECT trim(public._crm_norm(r->>'city')) AS cn, r->>'city' AS city, r->>'state' AS state FROM jsonb_array_elements(v_rows) r
     WHERE COALESCE(trim(r->>'city'), '') <> ''
  ), cities AS (
    SELECT cn, min(city) AS city, count(*) AS clients FROM acc GROUP BY cn
  ), pros AS (
    SELECT trim(public._crm_norm(p.name)) AS nn, trim(public._crm_norm(p.city)) AS cn, p.stage, p.id FROM public.crm_prospects p
  ), t AS (
    SELECT tr.*, (SELECT x.stage FROM pros x WHERE x.nn = trim(public._crm_norm(tr.name)) AND x.cn = tr.city_n LIMIT 1) AS stage
      FROM public._crm_admin_target_rows(p_include_demo) tr
     WHERE tr.city_n IN (SELECT cn FROM cities)
  )
  SELECT jsonb_build_object('at', now(),
    'cities', COALESCE((SELECT jsonb_agg(jsonb_build_object('city', c.city, 'clients', c.clients,
                 'total', (SELECT count(*) FROM t WHERE t.city_n = c.cn),
                 'approached', (SELECT count(*) FROM t WHERE t.city_n = c.cn AND t.stage IS NOT NULL),
                 'pipe', (SELECT count(*) FROM pros p WHERE p.cn = c.cn AND p.stage IN ('prospect', 'contacted', 'demo')))
               ORDER BY (SELECT count(*) FROM t WHERE t.city_n = c.cn) DESC, c.city) FROM cities c), '[]'::jsonb),
    'targets', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', t.key, 'name', t.name, 'city', t.city, 'kind', t.kind,
                 'has_email', t.email IS NOT NULL, 'has_phone', t.phone IS NOT NULL, 'stage', t.stage) ORDER BY t.stage NULLS FIRST, t.city, t.name)
               FROM (SELECT * FROM t ORDER BY t.stage NULLS FIRST, t.city, t.name LIMIT 600) t), '[]'::jsonb))
    INTO v_out;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_targets(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_targets(boolean) TO authenticated, service_role;

-- Ajouter une cible au pipeline : une ligne crm_prospects, refusée si un
-- prospect du même nom existe déjà dans la même ville.
CREATE OR REPLACE FUNCTION public.crm_admin_target_add(p_key text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_id uuid;
BEGIN
  PERFORM public._crm_admin_gate();
  SELECT * INTO r FROM public._crm_admin_target_rows(true) WHERE key = p_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.crm_prospects p
              WHERE trim(public._crm_norm(p.name)) = trim(public._crm_norm(r.name)) AND trim(public._crm_norm(p.city)) = r.city_n) THEN
    RAISE EXCEPTION 'already_in_pipeline' USING ERRCODE = '23505';
  END IF;
  v_id := public.crm_admin_prospect_save(NULL, jsonb_build_object(
    'name', r.name, 'city', r.city, 'kind', r.kind, 'source', 'Comptes cibles', 'stage', 'prospect',
    'contact', r.contact, 'email', r.email, 'phone', r.phone, 'next_action', NULL));
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_target_add(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_target_add(text) TO authenticated, service_role;
