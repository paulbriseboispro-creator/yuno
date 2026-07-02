-- search_venues_for_agency: recherche de venue par nom ou ville.
-- Remplace la saisie de slug brut dans l'interface de proposition de contrat.

CREATE OR REPLACE FUNCTION public.search_venues_for_agency(
  p_query text,
  p_limit int DEFAULT 10
)
RETURNS TABLE(id text, name text, city text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT v.id, v.name, v.city
    FROM public.venues v
   WHERE v.name ILIKE '%' || p_query || '%'
      OR v.city ILIKE '%' || p_query || '%'
   ORDER BY
     CASE
       WHEN lower(v.name) = lower(p_query)           THEN 0
       WHEN lower(v.name) LIKE lower(p_query) || '%' THEN 1
       ELSE 2
     END,
     v.name
   LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.search_venues_for_agency(text, int) TO authenticated;
