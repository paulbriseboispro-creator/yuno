-- 3AM Act III (04/11) : objet et pré-en-tête sans « gratuit » (décision de Paul pour
-- 3AM, reprise Gmail). Le corps de l'e-mail ne change pas.
SET lock_timeout = '3s';
UPDATE public.email_campaigns
   SET subject = '3AM Act III : ta place sur la guest list, samedi 14',
       preheader = 'Entrée avant 00:30 au Club La Nuit. Azul b2b Kanam, Giammo, Amato…'
 WHERE id = 'ec6daa79-91b3-4c79-ad08-b8c58c7704db' AND status = 'scheduled';
