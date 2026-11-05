-- Relance après clic : le registre accepte TOUS les motifs que le collecteur écrit.
--
-- Constat (05/11) : la relance de « Guest list Act III » de 3 AM n'est jamais partie.
-- `collect_campaign_followups` écrit, depuis les migrations du 03/11 (relance du CRM,
-- « Vos clients »), les motifs `too_late`, `not_sent`, `customer_closed`,
-- `customer_content` et `customer_pressure_30d`, mais la contrainte
-- `email_campaign_followups_skip_reason_check` n'en connaissait que six. Une seule ligne
-- refusée fait échouer TOUT le passage (une transaction), donc aucune relance de
-- aucune campagne n'était créée, sans autre trace qu'une ligne de journal.
--
-- La contrainte reprend maintenant la liste complète. Elle est la DERNIÈRE défense :
-- tout motif nouveau écrit par le collecteur s'ajoute ICI en même temps.
-- Aucun envoi, aucune donnée touchée ; les relances en retard partent au prochain
-- passage du cron (5 min).

SET lock_timeout = '3s';

ALTER TABLE public.email_campaign_followups
  DROP CONSTRAINT IF EXISTS email_campaign_followups_skip_reason_check;

ALTER TABLE public.email_campaign_followups
  ADD CONSTRAINT email_campaign_followups_skip_reason_check
  CHECK (skip_reason IS NULL OR skip_reason = ANY (ARRAY[
    'bought', 'guest_list', 'unsubscribed', 'suppressed', 'event_over', 'already_event',
    'too_late', 'not_sent', 'customer_closed', 'customer_content', 'customer_pressure_30d'
  ]));

-- Une relance ne part jamais après le début de la soirée, même si son échéance
-- (clic + délai) tombait avant : elle est mise en file maintenant, donc jugée à
-- l'heure où elle partirait. Sans ça, une fois le collecteur réparé, les clics du
-- jour d'une soirée finie auraient reçu « dernière minute » le lendemain.
DO $$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.collect_campaign_followups()'::regprocedure);
  IF position('GREATEST(d.due_at, now()) >= p.start_at' IN v_def) > 0 THEN RETURN; END IF;  -- déjà posé
  v_new := replace(v_def, 'WHEN d.due_at >= p.start_at THEN ''event_over''',
                          'WHEN GREATEST(d.due_at, now()) >= p.start_at THEN ''event_over''');
  v_new := replace(v_new, 'WHEN v_crm AND d.due_at >= p.start_at - interval ''2 hours'' THEN ''too_late''',
                          'WHEN v_crm AND GREATEST(d.due_at, now()) >= p.start_at - interval ''2 hours'' THEN ''too_late''');
  IF position('GREATEST(d.due_at, now()) >= p.start_at -' IN v_new) = 0
     OR position('GREATEST(d.due_at, now()) >= p.start_at THEN' IN v_new) = 0 THEN
    RAISE EXCEPTION 'collect_campaign_followups : repères introuvables';
  END IF;
  EXECUTE v_new;
END $$;
-- CREATE OR REPLACE garde les droits (service_role seul).
