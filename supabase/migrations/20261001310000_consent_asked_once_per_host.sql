-- ============================================================================
-- Un accord marketing se demande UNE fois par destinataire (2026-10-01)
--
-- Décision de Paul : une personne qui a déjà accepté les actus d'un club, d'un
-- organisateur ou de Yuno ne revoit plus la case à chaque checkout. Une fois
-- pour Yuno sur toute la plateforme, une fois par club / organisateur.
--
-- Côté soirée à plusieurs hôtes, la case email nommait TOUS les hôtes qui
-- partagent le CRM et se représentait dès qu'il y en avait un, même si la
-- personne avait déjà dit oui à chacun. Pour ne nommer que ceux à qui il
-- reste à demander, le checkout doit savoir, hôte par hôte, si l'appelant
-- est déjà abonné : `get_event_marketing_hosts` rend désormais
-- `email_opted_in` par hôte (même règle que get_my_marketing_consent : ligne
-- newsletter_subscriptions de la portée, opt-in, moins de 36 mois ; toujours
-- false pour un visiteur anonyme — une adresse tapée ne sert jamais à tester
-- si elle est cliente d'un hôte).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_event_marketing_hosts(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH d AS MATERIALIZED (SELECT (p_event_id = ANY (public.demo_event_ids())) AS ev_demo),
  me AS MATERIALIZED (
    SELECT u.id AS uid, lower(u.email) AS email
      FROM auth.users u
     WHERE u.id = auth.uid()
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', p.party_key, 'kind', p.kind, 'venue_id', p.venue_id,
           'organizer_user_id', p.organizer_user_id, 'name', p.display_name, 'role', p.role,
           'email_opted_in', COALESCE((
             SELECT ns.opted_in AND ns.updated_at > now() - interval '36 months'
               FROM public.newsletter_subscriptions ns, me
              WHERE (ns.user_id = me.uid OR lower(ns.email) = me.email)
                AND ((p.kind = 'venue' AND ns.venue_id = p.venue_id)
                     OR (p.kind = 'org' AND ns.organizer_user_id = p.organizer_user_id))
              ORDER BY ns.updated_at DESC
              LIMIT 1
           ), false)
         ) ORDER BY p.ord, p.party_key), '[]'::jsonb)
    FROM public.event_parties(p_event_id) p, d
   WHERE p.share_crm AND COALESCE(btrim(p.display_name), '') <> ''
     -- Soirée réelle : aucun client réel ne s'abonne à un compte démo.
     AND (d.ev_demo OR NOT public.coorg_party_is_demo(p.kind, p.venue_id, p.organizer_user_id));
$function$;

REVOKE ALL ON FUNCTION public.get_event_marketing_hosts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_marketing_hosts(uuid) TO anon, authenticated;
