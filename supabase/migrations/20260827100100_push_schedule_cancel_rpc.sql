-- ───────────────────────────────────────────────────────────────────────────
-- Annulation d'un push programmé (UI /owner/push).
--
-- L'infra de programmation existe déjà (push_campaigns.scheduled_at +
-- status='scheduled', drainé par process-scheduled-campaigns toutes les 5 min) ;
-- l'UI owner gagne un datetime + un bouton Annuler. Un push programmé annulé
-- n'a aucune valeur d'historique → DELETE, pas un status.
--
-- Garde alignée sur send-push-campaign : owner du club OU manager avec
-- can_manage_crm (manager_permissions n'a pas de clé 'crm' dans
-- manager_has_permission — on lit la colonne directement, comme l'edge fn).
-- Seules les campagnes ENCORE 'scheduled' sont supprimables : le cron marque
-- 'sending' avant d'envoyer, donc aucune course avec un envoi en cours.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cancel_scheduled_push_campaign(p_campaign_id UUID)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue_id text;
BEGIN
  SELECT pc.venue_id INTO v_venue_id
  FROM push_campaigns pc
  WHERE pc.id = p_campaign_id AND pc.status = 'scheduled';

  IF v_venue_id IS NULL THEN
    RETURN false; -- introuvable, déjà partie, ou campagne sans club (admin/agence : hors périmètre)
  END IF;

  IF NOT (is_super_admin()
          OR is_venue_owner(auth.uid(), v_venue_id)
          OR EXISTS (
            SELECT 1 FROM manager_permissions mp
            WHERE mp.user_id = auth.uid()
              AND mp.venue_id = v_venue_id
              AND mp.can_manage_crm = true
          )) THEN
    RAISE EXCEPTION 'Not authorized for venue %', v_venue_id USING ERRCODE = '42501';
  END IF;

  DELETE FROM push_campaigns pc
  WHERE pc.id = p_campaign_id AND pc.status = 'scheduled';

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_scheduled_push_campaign(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_scheduled_push_campaign(UUID) FROM anon;
