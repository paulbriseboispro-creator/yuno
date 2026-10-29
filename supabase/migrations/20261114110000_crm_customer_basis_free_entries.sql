-- Yuno CRM « Vos clients » : les entrées gratuites entrent dans la base (décision de
-- Paul du 29/10). L'exception de l'article L34-5 vise une adresse recueillie « à
-- l'occasion d'une vente ou d'une prestation de services » : une entrée gratuite à
-- une soirée est lue comme une prestation de services. À confirmer par l'avocat
-- (question (b) du plan) ; l'invitation (canal Shotgun `invitation`, la personne n'a
-- rien demandé) et le duplicata restent dehors (_crm_ticket_is_sale).
-- Et le nom de l'écran devient « Vos clients » dans l'alerte super admin.

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public._crm_customer_eligible_rows(text, uuid)'::regprocedure);
  v_new := replace(v_def,
    'public._crm_ticket_is_paid(t.status, t.price, t.deal_channel) AS paid',
    'public._crm_ticket_is_sale(t.status, t.deal_channel) AS paid');
  IF v_new = v_def THEN
    RAISE EXCEPTION '_crm_customer_eligible_rows : repère « _crm_ticket_is_paid » introuvable';
  END IF;
  EXECUTE v_new;

  v_def := pg_get_functiondef('public.crm_customer_basis_declare(text, uuid, text, text, text, text, jsonb, text, jsonb)'::regprocedure);
  v_new := replace(replace(v_def,
    '''Vos acheteurs : base ouverte''', '''Vos clients : base ouverte'''),
    'la déclaration « Vos acheteurs »', 'la déclaration « Vos clients »');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'crm_customer_basis_declare : libellé « Vos acheteurs » introuvable';
  END IF;
  EXECUTE v_new;
END $$;

-- CREATE OR REPLACE garde les droits : rien à reposer.
