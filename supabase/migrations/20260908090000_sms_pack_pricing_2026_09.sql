-- Grille des packs SMS (2026-09-08) : prix coûtant France + matelas dégressif.
--
-- Coût réel constaté : Twilio 0,0798 $ ≈ 0,073 € par segment vers la France
-- (0,08 € vers l'Espagne), Stripe 1,5 % + 0,25 € par achat. L'ancienne grille
-- était plate à 0,115 € quel que soit le volume. La nouvelle descend jusqu'à
-- 0,078 € sur le gros pack (sous le tarif public Twilio) tout en restant
-- sans perte, même avec un tiers de numéros étrangers. Les petits packs
-- gardent une marge qui paie Stripe, le support et l'aléa de destination.
UPDATE public.sms_packs SET price_eur = 9.90,  unit_cost_eur = 0.073, unit_margin_eur = 0.026, updated_at = now() WHERE name = 'Starter'  AND credits_amount = 100;
UPDATE public.sms_packs SET price_eur = 45.00, unit_cost_eur = 0.073, unit_margin_eur = 0.017, updated_at = now() WHERE name = 'Standard' AND credits_amount = 500;
UPDATE public.sms_packs SET price_eur = 165.00, unit_cost_eur = 0.073, unit_margin_eur = 0.0095, updated_at = now() WHERE name = 'Pro'   AND credits_amount = 2000;
UPDATE public.sms_packs SET price_eur = 390.00, unit_cost_eur = 0.073, unit_margin_eur = 0.005, updated_at = now() WHERE name = 'Scale' AND credits_amount = 5000;
