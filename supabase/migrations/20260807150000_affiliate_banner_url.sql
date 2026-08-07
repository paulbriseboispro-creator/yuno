-- Bannière de la page RP publique (/rp/:slug) : photo choisie par l'agence,
-- affichée en format carré 1:1 en tête de page. Sans bannière, la page garde
-- son comportement actuel (affiche de la prochaine soirée, sinon avatar).
--
-- La colonne vit sur le bras externe (affiliates) et N'ENTRE PAS dans la
-- synchro d'identité agencies→affiliates : un enregistrement du profil maître
-- ne l'écrase jamais. Elle s'édite depuis le profil agence (le chef est
-- affiliates.user_id → policy UPDATE existante).
ALTER TABLE public.affiliates ADD COLUMN IF NOT EXISTS banner_url text;
