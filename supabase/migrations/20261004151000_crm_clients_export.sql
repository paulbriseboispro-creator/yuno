-- ============================================================================
-- Yuno CRM — export CSV de la liste Clients (filtre ou sélection cochée).
-- Même règle que export_contact_base : jamais en session d'accès assisté ;
-- pour un membre d'équipe d'organisation, le droit « exporter » est exigé.
-- Rend { columns, rows[][] } : le CSV est écrit côté navigateur.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.crm_clients_export(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_def jsonb DEFAULT '{}'::jsonb, p_emails text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pred text;
  v_rows jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'export_forbidden_support' USING ERRCODE = '42501';
  END IF;
  IF p_organizer_user_id IS NOT NULL AND p_organizer_user_id <> auth.uid() AND NOT public.is_super_admin()
     AND NOT public.org_member_has_permission(auth.uid(), p_organizer_user_id, 'export') THEN
    RAISE EXCEPTION 'export_forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  v_pred := CASE WHEN p_emails IS NOT NULL
                 THEN format('p.email = ANY (%L::text[])', (SELECT array_agg(lower(x)) FROM unnest(p_emails) x))
                 ELSE public._crm_filter_sql(COALESCE(p_def, '{}'::jsonb), 'p') END;

  EXECUTE format($q$
    SELECT COALESCE(jsonb_agg(jsonb_build_array(
             p.email, p.first_name, p.last_name, CASE WHEN p.phone_ok THEN p.phone END, p.lifecycle, p.nights,
             to_char(p.first_night AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD'),
             to_char(p.last_night AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD'),
             p.spent, p.email_ok, p.phone_ok, p.source, array_to_string(COALESCE(p.tags, '{}'), ' ; '))
             ORDER BY p.last_night DESC NULLS LAST, p.email), '[]'::jsonb)
      FROM _cp p WHERE %s
  $q$, v_pred) INTO v_rows;

  RETURN jsonb_build_object(
    'columns', '["email","first_name","last_name","phone","lifecycle","nights","first_night","last_night","spent","email_ok","phone_ok","source","tags"]'::jsonb,
    'rows', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_clients_export(text, uuid, jsonb, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_clients_export(text, uuid, jsonb, text[]) TO authenticated;
