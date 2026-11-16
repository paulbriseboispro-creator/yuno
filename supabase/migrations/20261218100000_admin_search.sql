-- Recherche globale ⌘K de l'admin unique (refonte, lot 0,
-- docs/designs/ADMIN_REBUILD_PLAN.md). Une passe, sans table temporaire,
-- au plus 6 résultats par famille : clubs, organisateurs, agences, comptes
-- Yuno CRM, personnes (comptes), soirées, commandes (référence billet / table).
--
-- Super admin seul (is_super_admin, sinon erreur 42501). La démo est retirée
-- par défaut ; la porte démo est évaluée UNE fois (CTE matérialisé), jamais
-- ligne à ligne (règle « Tracking super admin » de CLAUDE.md).
--
-- Une personne = un profil VIVANT (avec sa ligne auth.users) : un profil
-- orphelin n'est plus un compte (docs/ORPHAN_PROFILES.md).

CREATE OR REPLACE FUNCTION public.admin_search(p_q text, p_include_demo boolean DEFAULT false)
RETURNS TABLE (kind text, id text, label text, sub text, ref text, at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_raw  text := btrim(coalesce(p_q, ''));
  v_like text;
  v_exact text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF length(v_raw) < 2 THEN
    RETURN;
  END IF;
  v_raw   := left(v_raw, 120);
  v_like  := '%' || replace(replace(replace(v_raw, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_exact := lower(v_raw);

  RETURN QUERY
  WITH d AS MATERIALIZED (
    SELECT CASE WHEN p_include_demo THEN '{}'::text[] ELSE public.demo_venue_ids() END AS dv,
           CASE WHEN p_include_demo THEN '{}'::uuid[] ELSE public.demo_event_ids() END AS de
  ),
  v AS (
    SELECT 'venue'::text AS kind, ve.id::text AS id, ve.name::text AS label,
           concat_ws(' · ', ve.city, CASE WHEN ve.decommissioned_at IS NOT NULL THEN 'decommissioned' END) AS sub,
           ve.id::text AS ref, ve.created_at AS at
      FROM public.venues ve CROSS JOIN d
     WHERE (ve.name ILIKE v_like OR ve.slug ILIKE v_like OR ve.city ILIKE v_like OR ve.id = v_raw)
       AND NOT (ve.id = ANY(d.dv))
     ORDER BY (lower(ve.name) = v_exact) DESC, (ve.decommissioned_at IS NULL) DESC, ve.created_at DESC
     LIMIT 6
  ),
  o AS (
    SELECT 'organizer'::text, op.user_id::text, coalesce(nullif(op.display_name, ''), pr.email)::text,
           concat_ws(' · ', op.city, CASE WHEN op.bde_verified THEN 'association' END),
           op.user_id::text, op.created_at
      FROM public.organizer_profiles op
      LEFT JOIN public.profiles pr ON pr.id = op.user_id
     WHERE (op.display_name ILIKE v_like OR op.slug ILIKE v_like OR pr.email ILIKE v_like)
       AND (p_include_demo OR NOT public.is_demo_email(pr.email))
     ORDER BY (lower(op.display_name) = v_exact) DESC, op.created_at DESC
     LIMIT 6
  ),
  ag AS (
    SELECT 'agency'::text, a.id::text, a.name::text, a.city::text, a.slug::text, a.created_at
      FROM public.agencies a
      LEFT JOIN public.profiles pr ON pr.id = a.owner_user_id
     WHERE (a.name ILIKE v_like OR a.slug ILIKE v_like)
       AND (p_include_demo OR NOT public.is_demo_email(pr.email))
     ORDER BY (lower(a.name) = v_exact) DESC, a.created_at DESC
     LIMIT 6
  ),
  crm AS (
    SELECT * FROM (
      SELECT 'crm'::text AS kind, ('venue:' || ve.id)::text AS id, ve.name::text AS label, ve.city::text AS sub,
             ve.id::text AS ref, ve.created_at AS at
        FROM public.venues ve CROSS JOIN d
       WHERE (ve.product = 'crm' OR 'crm' = ANY(coalesce(ve.extra_products, '{}'::text[])))
         AND ve.decommissioned_at IS NULL
         AND ve.name ILIKE v_like
         AND NOT (ve.id = ANY(d.dv))
      UNION ALL
      SELECT 'crm'::text, ('org:' || op.user_id)::text, op.display_name::text, op.city::text,
             op.user_id::text, op.created_at
        FROM public.organizer_profiles op
        LEFT JOIN public.profiles pr ON pr.id = op.user_id
       WHERE (op.product = 'crm' OR 'crm' = ANY(coalesce(op.extra_products, '{}'::text[])))
         AND op.display_name ILIKE v_like
         AND (p_include_demo OR NOT public.is_demo_email(pr.email))
    ) c
    ORDER BY c.at DESC
    LIMIT 6
  ),
  pe AS (
    SELECT 'person'::text, pr.id::text,
           coalesce(nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.email)::text,
           concat_ws(' · ', pr.email, pr.city), pr.email::text, pr.created_at
      FROM public.profiles pr
     WHERE (pr.email ILIKE v_like OR pr.first_name ILIKE v_like OR pr.last_name ILIKE v_like
            OR concat_ws(' ', pr.first_name, pr.last_name) ILIKE v_like OR pr.phone ILIKE v_like)
       AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = pr.id)
       AND (p_include_demo OR NOT public.is_demo_email(pr.email))
     ORDER BY (lower(pr.email) = v_exact) DESC, pr.created_at DESC
     LIMIT 6
  ),
  ev AS (
    SELECT 'event'::text, e.id::text, e.title::text,
           concat_ws(' · ', to_char(e.start_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD'), vv.name), e.id::text, e.start_at
      FROM public.events e CROSS JOIN d
      LEFT JOIN public.venues vv ON vv.id = e.venue_id
     WHERE (e.title ILIKE v_like OR e.slug ILIKE v_like OR e.id::text = v_exact)
       AND NOT (e.id = ANY(d.de))
     ORDER BY (lower(e.title) = v_exact) DESC, e.start_at DESC NULLS LAST
     LIMIT 6
  ),
  ord AS (
    SELECT * FROM (
      SELECT 'ticket'::text AS kind, t.id::text AS id, coalesce(t.reference_code, t.qr_code)::text AS label,
             concat_ws(' · ', nullif(t.full_name, ''), t.user_email, t.status) AS sub,
             coalesce(t.reference_code, t.qr_code)::text AS ref, t.created_at AS at
        FROM public.tickets t CROSS JOIN d
       WHERE length(v_raw) >= 4
         AND (upper(t.reference_code) = upper(v_raw) OR t.qr_code = v_raw OR lower(t.user_email) = v_exact)
         AND (t.event_id IS NULL OR NOT (t.event_id = ANY(d.de)))
      UNION ALL
      SELECT 'table'::text, r.id::text, coalesce(r.reference_code, r.qr_code)::text,
             concat_ws(' · ', nullif(r.full_name, ''), r.user_email, r.status),
             coalesce(r.reference_code, r.qr_code)::text, r.created_at
        FROM public.table_reservations r CROSS JOIN d
       WHERE length(v_raw) >= 4
         AND (upper(r.reference_code) = upper(v_raw) OR r.qr_code = v_raw OR lower(r.user_email) = v_exact)
         AND (r.event_id IS NULL OR NOT (r.event_id = ANY(d.de)))
    ) x
    ORDER BY x.at DESC
    LIMIT 6
  )
  SELECT * FROM v
  UNION ALL SELECT * FROM o
  UNION ALL SELECT * FROM ag
  UNION ALL SELECT * FROM crm
  UNION ALL SELECT * FROM pe
  UNION ALL SELECT * FROM ev
  UNION ALL SELECT * FROM ord;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_search(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search(text, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_search(text, boolean) IS
  'Recherche ⌘K du super admin : clubs, organisateurs, agences, comptes CRM, personnes, soirées, commandes (6 par famille). Démo exclue par défaut.';
