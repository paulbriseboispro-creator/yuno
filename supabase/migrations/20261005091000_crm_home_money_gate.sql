-- Yuno CRM — l'accueil ne montre le chiffre d'affaires qu'à qui peut le voir.
--
-- crm_home passait par _crm_money_gate, dont la liste de clés (revenue,
-- amount, spent…) ignore celles du bloc ventes de l'accueil : sales.total,
-- sales.prev_total et la courbe (cur, prev). Un éditeur ou un lecteur recevait
-- donc le chiffre d'affaires que l'écran est censé taire. Pour eux, le bloc
-- ventes garde ses volumes (billets) et perd ses montants.
--
-- Au passage, _crm_ana_bucket lit des instants depuis du texte : il est
-- STABLE (dépend du fuseau de la session), pas IMMUTABLE.

CREATE OR REPLACE FUNCTION public.crm_home(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r jsonb := public.crm_home__core(p_venue_id, p_organizer_user_id, p_period);
BEGIN
  IF public.crm_scope_sees_money(p_venue_id, p_organizer_user_id) THEN
    RETURN r;
  END IF;
  IF r ? 'sales' THEN
    r := jsonb_set(r, '{sales}', (r->'sales') || jsonb_build_object(
      'total', NULL, 'prev_total', NULL,
      'series', COALESCE((SELECT jsonb_agg(x.v || jsonb_build_object('cur', NULL, 'prev', NULL) ORDER BY x.o)
                            FROM jsonb_array_elements(r->'sales'->'series') WITH ORDINALITY x(v, o)), '[]'::jsonb)));
  END IF;
  RETURN public._crm_null_money(r);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_home(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_home(text, uuid, text) TO authenticated, service_role;

ALTER FUNCTION public._crm_ana_bucket(jsonb, timestamptz) STABLE;
