-- « Aucune langue choisie » doit être représentable.
--
-- `profiles.preferred_language` portait DEFAULT 'fr' : toute ligne avait donc
-- une valeur, et rien ne distinguait « cette personne a choisi le français »
-- de « personne n'a jamais rien choisi ». Conséquences en chaîne :
--   • au montage, LanguageContext lisait 'fr' et écrasait la langue locale —
--     une interface en anglais basculait en français sans action de l'utilisateur ;
--   • les push étaient rendus dans cette même langue jamais choisie.
-- Yuno est anglais par défaut (cf. CLAUDE.md), donc ce 'fr' implicite était faux
-- des deux côtés.
--
-- Sans default, une nouvelle inscription reste NULL jusqu'à ce que l'app écrive
-- la langue réellement résolue sur l'appareil (LanguageContext). Les lignes
-- existantes ne sont pas touchées : on ne peut pas deviner rétroactivement qui
-- avait vraiment choisi le français, et réinitialiser tout le monde changerait
-- la langue d'utilisateurs francophones légitimes.
ALTER TABLE public.profiles
  ALTER COLUMN preferred_language DROP DEFAULT;

COMMENT ON COLUMN public.profiles.preferred_language IS
  'Langue choisie par la personne (en/es/fr). NULL = aucun choix explicite : l''app y écrit la langue résolue sur l''appareil au premier montage. Sert de source de vérité aux notifications push.';
