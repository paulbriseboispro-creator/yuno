-- Yuno CRM : grille décidée par Paul le 04/10 : 24 € HT / mois au lancement,
-- 34 € ensuite pour les nouveaux comptes, 288 € l'an (12 mois). Les prix Stripe
-- live (yuno_crm_base_*) sont déjà à ces montants ; seule la config lue par la
-- Console et la page Tarifs restait à 29 / 39 / 348.
UPDATE public.crm_pricing
SET config = config
      || jsonb_build_object('price_month', 24, 'price_month_next', 34, 'price_year', 288),
    updated_at = now()
WHERE id;
