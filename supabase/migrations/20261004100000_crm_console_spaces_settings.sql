-- ============================================================================
-- Yuno CRM — nouvelle Console (/crm), lot « fondations ».
--
-- 1. get_my_crm_spaces() : les espaces CRM qu'une personne peut ouvrir
--    (club au produit `crm` qu'elle gère, organisation `crm` qu'elle a fondée
--    ou dont elle est membre éditeur+). Même porte que crm_scope_allowed : la
--    liste ne promet jamais un espace que les lectures refuseraient.
-- 2. crm_settings : les règles de l'espace (Réglages › « Comment Yuno classe
--    vos clients ? », conservation des données). Une ligne par portée, lue par
--    get_crm_settings, écrite par la seule RPC save_crm_settings.
-- 3. crm_scope_rules() : la règle « habitué » et le seuil « à réactiver »
--    d'une portée, avec leurs défauts (3 soirées sur 6 mois, 4 mois) — porte
--    unique de toutes les lectures de la Console qui classent un client.
-- ============================================================================

-- ── 1. Espaces ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_crm_spaces()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT auth.uid() AS uid)
  SELECT COALESCE(jsonb_agg(s ORDER BY s->>'sort', s->>'name'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
             'kind', 'venue',
             'key', 'venue:' || v.id,
             'venue_id', v.id,
             'organizer_user_id', NULL,
             'name', v.name,
             'city', v.city,
             'logo_url', v.logo_url,
             'role', CASE WHEN v.owner_id = me.uid THEN 'owner' ELSE 'manager' END,
             'sort', CASE WHEN v.owner_id = me.uid THEN '0' ELSE '2' END
           ) AS s
      FROM public.venues v, me
     WHERE me.uid IS NOT NULL
       AND v.product = 'crm'
       AND public.can_manage_venue(me.uid, v.id)
    UNION ALL
    SELECT jsonb_build_object(
             'kind', 'org',
             'key', 'org:' || o.user_id,
             'venue_id', NULL,
             'organizer_user_id', o.user_id,
             'name', COALESCE(NULLIF(o.display_name, ''), p.organization_name, 'Organisation'),
             'city', o.city,
             'logo_url', COALESCE(o.avatar_url, p.organization_logo_url),
             'role', CASE WHEN o.user_id = me.uid THEN 'owner'
                          ELSE COALESCE((SELECT m.role FROM public.org_members m
                                          WHERE m.organizer_user_id = o.user_id
                                            AND m.member_user_id = me.uid
                                            AND m.invitation_status = 'accepted'
                                          LIMIT 1), 'editor') END,
             'sort', CASE WHEN o.user_id = me.uid THEN '0' ELSE '1' END
           )
      FROM public.organizer_profiles o
      JOIN public.profiles p ON p.id = o.user_id, me
     WHERE me.uid IS NOT NULL
       AND o.product = 'crm'
       AND (o.user_id = me.uid OR public.is_org_team_member(me.uid, o.user_id, 'editor'))
  ) q;
$$;

REVOKE ALL ON FUNCTION public.get_my_crm_spaces() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_crm_spaces() TO authenticated;

-- ── 2. Réglages de l'espace ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.crm_settings (
  scope_key text PRIMARY KEY,
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  -- « Qui est un habitué ? » : venu au moins N soirées sur les M derniers mois.
  regular_min_nights smallint NOT NULL DEFAULT 3 CHECK (regular_min_nights BETWEEN 1 AND 6),
  regular_window_months smallint NOT NULL DEFAULT 6 CHECK (regular_window_months IN (6, 12, 24)),
  -- « Quand un client est-il à réactiver ? » : pas revenu depuis N mois.
  lapse_months smallint NOT NULL DEFAULT 4 CHECK (lapse_months BETWEEN 2 AND 12),
  -- « À quelle heure une nuit se termine-t-elle ? » (heure locale, 0-23).
  night_end_hour smallint NOT NULL DEFAULT 6 CHECK (night_end_hour BETWEEN 0 AND 23),
  -- « Garder les clients qui ne viennent plus » : NULL = jamais effacés.
  retention_months smallint CHECK (retention_months IS NULL OR retention_months IN (24, 36, 60)),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((venue_id IS NULL) <> (organizer_user_id IS NULL))
);

ALTER TABLE public.crm_settings ENABLE ROW LEVEL SECURITY;
-- Aucune policy : lecture par get_crm_settings, écriture par save_crm_settings.

CREATE OR REPLACE FUNCTION public.crm_scope_rules(p_venue_id text, p_organizer_user_id uuid)
RETURNS TABLE(regular_min_nights int, regular_window_months int, lapse_months int, night_end_hour int, retention_months int)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(s.regular_min_nights, 3)::int,
         COALESCE(s.regular_window_months, 6)::int,
         COALESCE(s.lapse_months, 4)::int,
         COALESCE(s.night_end_hour, 6)::int,
         s.retention_months::int
    FROM (SELECT 1) one
    LEFT JOIN public.crm_settings s
      ON s.scope_key = CASE WHEN p_venue_id IS NOT NULL THEN 'venue:' || p_venue_id
                            ELSE 'org:' || p_organizer_user_id::text END;
$$;

REVOKE ALL ON FUNCTION public.crm_scope_rules(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_scope_rules(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_crm_settings(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);
  RETURN jsonb_build_object(
    'regular_min_nights', r.regular_min_nights,
    'regular_window_months', r.regular_window_months,
    'lapse_months', r.lapse_months,
    'night_end_hour', r.night_end_hour,
    'retention_months', r.retention_months
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_crm_settings(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_settings(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_crm_settings(
  p_venue_id text, p_organizer_user_id uuid, p_settings jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'support_session_forbidden' USING ERRCODE = '42501';
  END IF;
  v_key := CASE WHEN p_venue_id IS NOT NULL THEN 'venue:' || p_venue_id ELSE 'org:' || p_organizer_user_id::text END;

  INSERT INTO public.crm_settings AS s (scope_key, venue_id, organizer_user_id, regular_min_nights,
                                        regular_window_months, lapse_months, night_end_hour,
                                        retention_months, updated_by)
  VALUES (
    v_key, p_venue_id, p_organizer_user_id,
    COALESCE((p_settings->>'regular_min_nights')::smallint, 3),
    COALESCE((p_settings->>'regular_window_months')::smallint, 6),
    COALESCE((p_settings->>'lapse_months')::smallint, 4),
    COALESCE((p_settings->>'night_end_hour')::smallint, 6),
    NULLIF(p_settings->>'retention_months', '')::smallint,
    auth.uid()
  )
  ON CONFLICT (scope_key) DO UPDATE SET
    regular_min_nights = COALESCE((p_settings->>'regular_min_nights')::smallint, s.regular_min_nights),
    regular_window_months = COALESCE((p_settings->>'regular_window_months')::smallint, s.regular_window_months),
    lapse_months = COALESCE((p_settings->>'lapse_months')::smallint, s.lapse_months),
    night_end_hour = COALESCE((p_settings->>'night_end_hour')::smallint, s.night_end_hour),
    retention_months = CASE WHEN p_settings ? 'retention_months'
                            THEN NULLIF(p_settings->>'retention_months', '')::smallint
                            ELSE s.retention_months END,
    updated_by = auth.uid(),
    updated_at = now();

  RETURN public.get_crm_settings(p_venue_id, p_organizer_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.save_crm_settings(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_crm_settings(text, uuid, jsonb) TO authenticated;
