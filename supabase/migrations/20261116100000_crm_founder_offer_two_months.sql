-- Offre fondateurs : les trois dernières places (WOH / Kevin et les deux suivants)
-- passent à 2 mois offerts au lieu de 6 (décision de Paul, 01/11). Les Yunits offerts
-- ne changent pas (15 000, valables 12 mois).
--
-- La durée est COPIÉE sur chaque invitation à sa création (crm_offer_invites.free_months) :
-- 3 AM (réclamée) et Le Light (en attente) gardent leurs 6 mois, seules les invitations
-- créées après cette migration portent 2 mois. Les 5 places étant 2 + 3, la config
-- n'a pas besoin de palier ; si une 6e place s'ouvre un jour, la durée se redécide ici.
CREATE OR REPLACE FUNCTION public.crm_founder_offer_config()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT jsonb_build_object('seats', 5, 'free_months', 2, 'yunits', 15000, 'link_days', 30, 'yunits_valid_months', 12);
$function$;
REVOKE ALL ON FUNCTION public.crm_founder_offer_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_founder_offer_config() TO authenticated, service_role;
