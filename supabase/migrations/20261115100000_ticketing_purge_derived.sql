-- « Supprimer les données importées » doit aussi emporter ce que le CRM a DÉRIVÉ des billets.
--
-- La suppression d'une connexion billetterie vidait en cascade les billets, soirées, journaux, accords et profils
-- d'analyse, mais pas ce qui est indexé par e-mail ou par portée sans lien avec la connexion : constaté le 30/10 sur
-- Amoris, 17 669 adresses d'acheteurs restaient dans contact_engagement (produit CRM) et 382 lignes d'historique
-- d'analyse dans crm_family_status / crm_family_status_history.
--
-- Après la suppression de la DERNIÈRE connexion d'une portée : l'historique des familles d'hypothèses est effacé et
-- l'état d'engagement du produit CRM est marqué périmé, ce qui fait rejouer refresh_contact_engagement par le balayage
-- (contact_engagement_sweep, 30 min) : il ne garde que les contacts encore connus du CRM (fichiers, registre, campagnes).
-- Une simple déconnexion (jeton effacé, données gardées) ne touche à rien.

CREATE OR REPLACE FUNCTION public.ticketing_connections_drop_derived()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := public.crm_scope_key(OLD.venue_id, OLD.organizer_user_id);
BEGIN
  IF EXISTS (SELECT 1 FROM public.ticketing_connections c
              WHERE c.id <> OLD.id
                AND public.crm_scope_key(c.venue_id, c.organizer_user_id) = v_key) THEN
    RETURN OLD;
  END IF;

  DELETE FROM public.crm_family_status_history WHERE scope_key = v_key;
  DELETE FROM public.crm_family_status WHERE scope_key = v_key;

  UPDATE public.contact_engagement_state
     SET refreshed_at = 'epoch'::timestamptz
   WHERE scope_key = COALESCE('v:' || OLD.venue_id, 'o:' || OLD.organizer_user_id::text) || '|crm';

  RETURN OLD;
EXCEPTION WHEN others THEN
  -- Un nettoyage dérivé ne doit jamais empêcher la suppression de la connexion elle-même.
  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.ticketing_connections_drop_derived() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ticketing_connections_drop_derived ON public.ticketing_connections;
CREATE TRIGGER trg_ticketing_connections_drop_derived
  AFTER DELETE ON public.ticketing_connections
  FOR EACH ROW EXECUTE FUNCTION public.ticketing_connections_drop_derived();
