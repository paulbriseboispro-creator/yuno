-- Effectifs par segment de la portée plateforme.
--
-- L'écran Audience du Studio affiche un effectif par case. Côté club il vient
-- de `count_campaign_recipients` (venue-scopée) ; côté plateforme il n'existait
-- rien, et une case sans chiffre est une case qu'on ne coche pas. Une seule
-- RPC rend TOUS les effectifs d'un coup : huit sous-requêtes sur un registre
-- de quelques milliers de lignes, pas huit allers-retours.
CREATE OR REPLACE FUNCTION public.count_platform_audience_kinds()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  WITH subs AS (
    SELECT lower(ns.email) AS addr, ns.user_id, COALESCE(ns.source, '') AS src
      FROM public.newsletter_subscriptions ns
     WHERE ns.venue_id IS NULL AND ns.organizer_user_id IS NULL AND ns.opted_in = true
  ), enriched AS (
    SELECT s.*,
           EXISTS (SELECT 1 FROM public.tickets t
                    WHERE lower(t.user_email) = s.addr AND t.status = 'paid') AS bought
      FROM subs s
  )
  SELECT jsonb_build_object(
    'all_subscribers', count(*),
    'clients',    count(*) FILTER (WHERE src = 'platform:clients'),
    'pros',       count(*) FILTER (WHERE src = 'platform:pros'),
    'waitlist',   count(*) FILTER (WHERE src = 'platform:waitlist'),
    'leads',      count(*) FILTER (WHERE src = 'platform:leads'),
    'app_users',  count(*) FILTER (WHERE user_id IS NOT NULL),
    'no_account', count(*) FILTER (WHERE user_id IS NULL),
    'buyers',     count(*) FILTER (WHERE bought)
  ) INTO v FROM enriched;

  RETURN COALESCE(v, '{}'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.count_platform_audience_kinds() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_platform_audience_kinds() TO authenticated;
