-- Tables VIP, vague A — P3.2 : on ne retire jamais du plan une table vendue.
--
-- Constat (audit 4) : le plan se sauvegarde en bloc (upsert_event_floor_plan pour une soirée, UPDATE direct pour le plan d'un
-- club). Retirer une table qui porte déjà une réservation faisait disparaître la table du plan sans rien dire : la réservation
-- gardait un requested_table_id / assigned_table_id qui ne pointait plus sur rien, le client ne pouvait plus être placé.
-- Le trigger existant (prevent_floor_plan_table_removal) ne protégeait que les clients INSTALLÉS (vip_status placed / active).
--
-- On étend ce trigger au lieu d'en créer un second. Une table retirée du registre `layout->'tables'` est refusée quand elle
-- est tenue par une réservation ACTIVE d'une soirée pas encore terminée :
--   • statut paid / confirmed, ou pending de moins de 31 min (la durée de la session Stripe — plus vieille, elle ne retient rien) ;
--   • assigned_table_id = la table, OU requested_table_id = la table tant que la demande vit (placement_status requested / approved,
--     même règle que reserve_table_slot et la page publique : une demande « rejected » ou « modified » ne tient plus rien).
-- Soirée « pas encore terminée » = end_at (sinon début + 8 h) dans le futur : un client installé ce soir est protégé.
-- Portée : le plan d'une soirée → les réservations de CETTE soirée ; le plan d'un club (event_id NULL) → les réservations des soirées
-- du club (hôte ou partenaire) qui n'ont PAS leur propre plan (les autres lisent le leur).
--
-- Erreur : SQLSTATE YU003, message `table_has_reservation:<id de la table>` (le front la traduit). Le garde « installé » d'avant reste
-- derrière (check_violation), pour une réservation installée dont le statut ne serait plus paid / confirmed.
-- Le garde « installé » d'avant lisait aussi les clients de soirées TERMINÉES (vip_status reste active) : un club ne pouvait plus
-- jamais retirer la table où quelqu'un s'était assis un soir passé. Il ne regarde plus que les soirées pas terminées.
-- Pas de garde DELETE : supprimer un club cascade ses plans (_purge_venue) et ne doit jamais être bloqué par une vente à venir.

CREATE OR REPLACE FUNCTION public.prevent_floor_plan_table_removal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_removed text[];
  v_sold    text;
BEGIN
  SELECT array_agg(old_id) INTO v_removed
  FROM (
    SELECT e->>'id' AS old_id
    FROM jsonb_array_elements(COALESCE(OLD.layout->'tables', '[]'::jsonb)) AS e
    EXCEPT
    SELECT e->>'id'
    FROM jsonb_array_elements(COALESCE(NEW.layout->'tables', '[]'::jsonb)) AS e
  ) sub;

  IF v_removed IS NULL OR array_length(v_removed, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  -- P3.2 : une table vendue (réservation active, soirée pas terminée) ne quitte pas le plan.
  SELECT x.tid INTO v_sold
  FROM (
    SELECT t.tid
      FROM unnest(v_removed) AS t(tid)
     WHERE EXISTS (
       SELECT 1
         FROM public.table_reservations tr
         JOIN public.events e ON e.id = tr.event_id
        WHERE (
                (NEW.event_id IS NOT NULL AND tr.event_id = NEW.event_id)
                OR (NEW.event_id IS NULL AND NEW.venue_id IS NOT NULL
                    AND (e.venue_id = NEW.venue_id OR e.partner_venue_id = NEW.venue_id)
                    AND NOT EXISTS (SELECT 1 FROM public.venue_floor_plans f2 WHERE f2.event_id = e.id))
              )
          AND COALESCE(e.end_at, e.start_at + interval '8 hours') > now()
          AND (
                tr.status IN ('paid', 'confirmed')
                OR (tr.status = 'pending' AND tr.created_at > now() - interval '31 minutes')
              )
          AND (
                tr.assigned_table_id::text = t.tid
                OR (tr.requested_table_id::text = t.tid AND tr.placement_status IN ('requested', 'approved'))
              )
     )
     ORDER BY t.tid
     LIMIT 1
  ) x;

  IF v_sold IS NOT NULL THEN
    RAISE EXCEPTION 'table_has_reservation:%', v_sold
      USING ERRCODE = 'YU003';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.table_reservations tr
    LEFT JOIN public.table_zones tz ON tz.id = tr.zone_id
    WHERE (
        (NEW.event_id IS NOT NULL AND tr.event_id = NEW.event_id)
        OR (NEW.event_id IS NULL AND NEW.venue_id IS NOT NULL AND tz.venue_id = NEW.venue_id)
      )
      AND tr.assigned_table_id::text = ANY(v_removed)
      AND tr.vip_status IN ('placed', 'active')
      AND tr.status NOT IN ('cancelled', 'refunded')
      -- Une soirée terminée garde ses clients « installés » à jamais : elle ne retient plus rien.
      AND EXISTS (SELECT 1 FROM public.events e2 WHERE e2.id = tr.event_id
                   AND COALESCE(e2.end_at, e2.start_at + interval '8 hours') > now())
  ) THEN
    RAISE EXCEPTION
      'Cannot remove a table that currently has a seated VIP reservation. Finish service or reassign those tables first.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- Fonction de trigger : jamais appelée à la main par un visiteur.
REVOKE ALL ON FUNCTION public.prevent_floor_plan_table_removal() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prevent_floor_plan_table_removal() TO authenticated, service_role;
