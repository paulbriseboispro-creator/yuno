-- Yuno CRM : une série reconnaît aussi « ACT II / IGNITION », « Chapitre 3 », « Part IV ».
--
-- Constaté le 22/10/2026 sur 3AM : « 3AM - UNIQUE PARTY EXPERIENCE »,
-- « … ACT II / IGNITION » et « … ACT III / AFTER DARK » étaient trois séries
-- différentes. « Qui cibler » rendait 0 fidèle du concept pour Act III, et la
-- soirée de comparaison n'était jamais « de la même série ».
--
-- Nouvelle étape, après les dates et les numéros : un suffixe « act / acte /
-- chapter / chapitre / part / partie / vol / volume / episode / ep / saison /
-- season » suivi d'un numéro (chiffres ou romains I à XX), et d'un sous-titre
-- éventuel après « / », « - », « : », « | »…, est retiré. Le chiffre romain est
-- une liste fermée : « Part Time », « Act Civil » ne bougent pas. Vérifié le
-- 22/10 sur toutes les soirées miroir de la prod : seules les deux soirées de
-- 3AM changent de série. Aucun index ni colonne ne dépend de cette fonction.

CREATE OR REPLACE FUNCTION public._crm_night_series(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT NULLIF(btrim(regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(COALESCE(p_name, ''),
                 '\s*[-–—:|·,]?\s*\(?\d{1,2}[./]\d{1,2}([./]\d{2,4})?\)?\s*$', ''),
               '\s*[-–—:|·,]?\s*([#№]\s*\d+|(vol|n°|no|ep|episode|chapitre|chapter|part|partie|edition|édition)\.?\s*\d+)\s*$', '', 'i'),
             '\s*[-–—:|·,]?\s*\m(act|acte|chapter|chapitre|part|partie|vol|volume|episode|épisode|ep|saison|season)\.?\s*(\d{1,3}|i{1,3}|iv|vi{0,3}|ix|xi{0,3}|xiv|xvi{0,3}|xix|xx)\M(\s*[-–—:|/·,]\s*.*)?$', '', 'i'),
           '\s+', ' ', 'g')), '');
$function$;
