-- Yuno CRM « Vos clients » : un acheteur qui a répondu NON à la communication chez
-- la billetterie n'entre jamais dans la base (décision de Paul du 02/11).
-- Shotgun rend `contact_newsletter_optin` à true, false ou absent (NULL). Jusqu'ici,
-- seul « oui puis non » (provider_withdrawn) écartait la personne ; « non » sans
-- « oui » avant restait éligible. Désormais : le DERNIER signal connu de la personne
-- (billet le plus récemment mis à jour, NULL ignoré) vaut non ⇒ `provider_declined`,
-- opposition durable comme les autres. Un « oui » donné plus tard la remet dans la
-- base à l'accord (registre de consentement), jamais dans celle-ci ; un champ absent
-- (NULL) n'est toujours pas une réponse.

ALTER TABLE public.crm_customer_contacts
  DROP CONSTRAINT crm_customer_contacts_objected_source_check;
ALTER TABLE public.crm_customer_contacts
  ADD CONSTRAINT crm_customer_contacts_objected_source_check CHECK (
    objected_source IS NULL OR objected_source = ANY (ARRAY[
      'unsubscribe', 'provider_withdrawn', 'provider_declined', 'pro_reported', 'complaint', 'suppressed']));

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public._crm_customer_eligible_rows(text, uuid)'::regprocedure);
  v_new := replace(v_def,
    E'WHEN o.ever_yes AND o.last_optin = false THEN ''provider_withdrawn''',
    E'WHEN o.ever_yes AND o.last_optin = false THEN ''provider_withdrawn''\n           WHEN o.last_optin = false THEN ''provider_declined''');
  IF v_new = v_def THEN
    RAISE EXCEPTION '_crm_customer_eligible_rows : repère « provider_withdrawn » introuvable';
  END IF;
  EXECUTE v_new;

  v_def := pg_get_functiondef('public._crm_customer_basis_counts(text, uuid)'::regprocedure);
  v_new := replace(v_def,
    E'''provider_withdrawn'', (SELECT count(*) FROM rows WHERE objected_source = ''provider_withdrawn''),',
    E'''provider_withdrawn'', (SELECT count(*) FROM rows WHERE objected_source = ''provider_withdrawn''),\n      ''provider_declined'', (SELECT count(*) FROM rows WHERE objected_source = ''provider_declined''),');
  IF v_new = v_def THEN
    RAISE EXCEPTION '_crm_customer_basis_counts : repère « provider_withdrawn » introuvable';
  END IF;
  EXECUTE v_new;
END $$;

-- CREATE OR REPLACE garde les droits : rien à reposer.
