-- ───────────────────────────────────────────────────────────────────────────
-- Plafond plateforme aligné sur le plan Resend PRO.
--
-- Le plafond était semé à 90/jour en 20260829150100 : c'était le plan GRATUIT
-- (100 emails/jour partagés avec TOUT le transactionnel, 10 gardés en marge
-- pour que les confirmations de billets passent toujours avant une campagne).
-- Le plan Pro est souscrit depuis le 2026-09-01 : plus de limite journalière
-- côté fournisseur, 50 000 emails par mois.
--
-- On passe donc à 25 000/jour. Ce chiffre n'est PAS un objectif d'envoi, c'est
-- un garde-fou anti-emballement : il borne les dégâts d'une campagne partie de
-- travers sans jamais gêner un envoi légitime.
--
-- ⚠️ CE QUI DEVIENT LA VRAIE LIMITE : le quota MENSUEL du plan (50 000, tout
--    transactionnel compris). `email_send_quota` ne compte qu'à la journée —
--    rien dans le gouverneur ne surveille le mois. À 25 000/jour, deux
--    journées pleines vident le plan, et un dépassement chez Resend ne
--    ralentit pas l'envoi : il renvoie des 429, les destinataires épuisent
--    leurs tentatives et finissent en `failed`. On PERD des gens.
--    Un plafond mensuel reste à écrire ; d'ici là, la surveillance est
--    manuelle (tableau de bord Resend) avant chaque grosse campagne.
--
-- La rampe de warm-up par expéditeur (300 → 25 000 en 6 jours) n'est pas
-- touchée : elle protège la réputation, pas le portefeuille. C'est toujours le
-- plus petit des deux plafonds qui s'applique.
-- ───────────────────────────────────────────────────────────────────────────

UPDATE public.email_sender_state
   SET daily_cap_override = 25000,
       updated_at = now()
 WHERE scope_key = 'platform';

-- Si la ligne n'existe pas (base neuve où le seed n'a pas tourné), la créer
-- directement au bon niveau plutôt que de laisser le défaut du plan gratuit.
INSERT INTO public.email_sender_state (scope_key, trust_level, daily_cap_override)
VALUES ('platform', 'trusted', 25000)
ON CONFLICT (scope_key) DO NOTHING;
