-- Yuno CRM « Vos clients » : les soirées CO-ORGANISÉES entrent dans la base (décision
-- de Paul du 02/11, sans attendre l'avocat : question (c) du plan tranchée par lui).
-- Une soirée de la billetterie où l'espace est co-organisateur (rôle Shotgun
-- `editor` / `viewer`, `_ticketing_role_is_cohosted`) compte désormais comme une
-- soirée de l'espace, au même titre que celles qu'il vend seul :
--   - ses acheteurs entrent dans la base (`_crm_customer_eligible_rows`) ;
--   - un bloc Soirée ou un lien Shotgun vers elle passe le contrôle de contenu
--     (`_crm_customer_own_event`, `_crm_customer_link_issue`).
-- Une soirée co-organisée n'est lue que si la connexion l'importe (« Inclure les
-- soirées que je co-organise », DATA-05) : la case éteinte, rien ne change.
-- La déclaration change (engagement « vendeur ou co-organisateur ») : sa version
-- monte, personne ne l'avait encore signée.

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public._crm_customer_eligible_rows(text, uuid)'::regprocedure);
  v_new := replace(v_def,
    '(ee.id IS NOT NULL AND NOT public._ticketing_role_is_cohosted(ee.external_role)) AS own',
    '(ee.id IS NOT NULL) AS own');
  IF v_new = v_def THEN
    RAISE EXCEPTION '_crm_customer_eligible_rows : repère « own » introuvable';
  END IF;
  EXECUTE v_new;

  v_def := pg_get_functiondef('public._crm_customer_own_event(text, uuid, uuid)'::regprocedure);
  v_new := replace(v_def,
    E'AND public.marketing_scope_match(ee.venue_id, ee.organizer_user_id, p_venue_id, p_organizer_user_id)\n       AND NOT public._ticketing_role_is_cohosted(ee.external_role));',
    'AND public.marketing_scope_match(ee.venue_id, ee.organizer_user_id, p_venue_id, p_organizer_user_id));');
  IF v_new = v_def THEN
    RAISE EXCEPTION '_crm_customer_own_event : repère « cohosted » introuvable';
  END IF;
  EXECUTE v_new;

  v_def := pg_get_functiondef('public._crm_customer_link_issue(text, text, uuid)'::regprocedure);
  v_new := replace(v_def,
    E'\n            AND NOT public._ticketing_role_is_cohosted(ee.external_role)', '');
  IF v_new = v_def THEN
    RAISE EXCEPTION '_crm_customer_link_issue : repère « cohosted » introuvable';
  END IF;
  EXECUTE v_new;
END $$;

UPDATE public.crm_customer_basis_settings
   SET declaration_version = '2026-11-02', updated_at = now()
 WHERE id = 1;

-- CREATE OR REPLACE garde les droits : rien à reposer.
