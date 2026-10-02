-- Pilier boissons EN PAUSE (décision de Paul, 2026-10-01). Voir docs/DRINKS_PILLAR_PAUSED.md.
--
-- Le front est gaté par DRINKS_PILLAR_LIVE ; la base suit pour que les anciens bundles
-- (app installée, OTA pas encore appliquée) ne vendent pas non plus :
--   1. la boisson offerte d'un billet / d'une guest list se gère à la PORTE (le videur
--      la voit au scan), plus jamais par crédit à montrer au bar : free_drink_mode =
--      'bouncer_notify' partout, et par défaut pour tout nouveau club ;
--   2. la carte du bar, le Mode Live, l'upsell post-achat et le Click & Collect sont
--      éteints sur tous les clubs, et éteints par défaut pour un nouveau club.
-- Aucune table, colonne, RPC ni fonction n'est supprimée : le relancement remet les
-- défauts et rallume club par club.

ALTER TABLE public.venues ALTER COLUMN free_drink_mode SET DEFAULT 'bouncer_notify';
ALTER TABLE public.venues ALTER COLUMN menu_enabled SET DEFAULT false;
ALTER TABLE public.venues ALTER COLUMN live_mode_enabled SET DEFAULT false;
ALTER TABLE public.venues ALTER COLUMN post_checkout_upsell_enabled SET DEFAULT false;

UPDATE public.venues
SET free_drink_mode = 'bouncer_notify',
    menu_enabled = false,
    live_mode_enabled = false,
    post_checkout_upsell_enabled = false,
    click_collect_mode = false
WHERE free_drink_mode IS DISTINCT FROM 'bouncer_notify'
   OR menu_enabled IS DISTINCT FROM false
   OR live_mode_enabled IS DISTINCT FROM false
   OR post_checkout_upsell_enabled IS DISTINCT FROM false
   OR click_collect_mode IS DISTINCT FROM false;

-- L'inscription pro ne crée plus un club « bar allumé » même si la landing envoie
-- encore le pilier 'drinks' : la fonction continue de poser menu_enabled d'après les
-- piliers, on la laisse (elle écrit menu_enabled = true seulement pour 'drinks', que
-- la landing retirera) — le front ignore de toute façon la carte tant que le pilier dort.
