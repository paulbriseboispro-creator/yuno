-- L'identité doit rendre une ligne MÊME sans profil.
--
-- La version de `20260908190000` faisait `… FROM pick` : un email sans aucun
-- profil rendait ZÉRO ligne, donc `has_account`, `email_opt_in` et `sms_opt_in`
-- tombaient à NULL au lieu de false. Or c'est le cas MAJORITAIRE (7 clients sur
-- 9 au 08/09 n'ont pas de compte) — et ces gens-là peuvent parfaitement être
-- joignables : un opt-in newsletter ou un numéro consenti ne suppose aucun
-- compte. On perdait exactement l'information qui sert à les recontacter.
CREATE OR REPLACE FUNCTION public._admin_customer_identity(p_email text)
RETURNS TABLE(
  user_id uuid, first_name text, last_name text, city text, gender text,
  phone text, birth_date date, avatar_url text, preferred_language text,
  account_created_at timestamptz, is_suspended boolean,
  has_account boolean, profile_count integer,
  app_platforms text[], has_app boolean, push_on boolean,
  email_opt_in boolean, sms_opt_in boolean, email_suppressed boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH pick AS (
    SELECT p.*
    FROM public.profiles p
    WHERE lower(p.email) = lower(p_email)
    ORDER BY (EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)) DESC,
             p.created_at DESC
    LIMIT 1
  )
  -- CROSS JOIN sur une ligne fantôme + LEFT JOIN : la fonction rend toujours
  -- exactement une ligne, avec ou sans profil derrière.
  SELECT
    pick.id, pick.first_name, pick.last_name, pick.city, pick.gender,
    pick.phone, pick.birth_date, pick.avatar_url, pick.preferred_language,
    pick.created_at, COALESCE(pick.is_suspended, false),
    (pick.id IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = pick.id)),
    (SELECT count(*)::int FROM public.profiles p2 WHERE lower(p2.email) = lower(p_email)),
    -- L'app se déduit des abonnements push : c'est le seul rattachement
    -- appareil→personne qu'on ait (ota_devices n'a pas de custom_id).
    -- Sous-estime donc les gens qui ont l'app et ont refusé les notifications.
    COALESCE((SELECT array_agg(DISTINCT ps.platform)
              FROM public.push_subscriptions ps WHERE ps.user_id = pick.id), '{}'::text[]),
    EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = pick.id),
    EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = pick.id),
    -- Ces trois-là ne supposent AUCUN compte : ils se testent sur l'email.
    EXISTS (SELECT 1 FROM public.newsletter_subscriptions ns
             WHERE lower(ns.email) = lower(p_email) AND ns.opted_in),
    COALESCE(pick.phone_sms_opt_in, false)
      OR EXISTS (SELECT 1 FROM public.venue_sms_contacts sc
                  WHERE lower(sc.email) = lower(p_email) AND NOT COALESCE(sc.unsubscribed, false)),
    EXISTS (SELECT 1 FROM public.email_suppressions es WHERE lower(es.email) = lower(p_email))
  FROM (SELECT 1) AS one
  LEFT JOIN pick ON true;
$function$;
