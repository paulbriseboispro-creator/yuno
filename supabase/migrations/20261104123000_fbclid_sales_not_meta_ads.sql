-- ============================================================================
-- Ventes classées « Meta Ads » sur la seule foi d'un `fbclid` (19/10).
--
-- `categorizeReferrer` tenait tout `fbclid` pour de la publicité : Instagram et
-- Facebook l'ajoutent pourtant à TOUT lien cliqué (bio, stories, messages).
-- Une vente arrivée ainsi recevait `purchase_source = 'paid_social'`, figée en
-- `attribution_source = 'meta_ads'`. La règle est corrigée côté navigateur
-- (20261104120000) ; ici, les ventes déjà classées ainsi SANS aucune
-- campagne Meta pilotée par Yuno sur leur soirée, ni lien suivi, reviennent à
-- « réseaux sociaux » (la plateforme exacte n'est pas connue : pas de
-- référent). Le 20/10 : un billet (House Of Masquerade), aucune table.
-- Hors démo.
-- ============================================================================

WITH d AS MATERIALIZED (SELECT public.demo_event_ids() AS de)
UPDATE public.tickets t
   SET attribution_source = 'social',
       attribution_ref = 'fbclid',
       purchase_source = 'social'
  FROM d
 WHERE t.attribution_source = 'meta_ads'
   AND t.attribution_ref = 'paid_social'
   AND t.purchase_source = 'paid_social'
   AND t.tracked_link_id IS NULL
   AND NOT (t.event_id = ANY (d.de))
   AND NOT EXISTS (SELECT 1 FROM public.meta_campaigns c WHERE c.event_id = t.event_id);

WITH d AS MATERIALIZED (SELECT public.demo_event_ids() AS de)
UPDATE public.table_reservations r
   SET attribution_source = 'social',
       attribution_ref = 'fbclid',
       purchase_source = 'social'
  FROM d
 WHERE r.attribution_source = 'meta_ads'
   AND r.attribution_ref = 'paid_social'
   AND r.purchase_source = 'paid_social'
   AND r.tracked_link_id IS NULL
   AND NOT (r.event_id = ANY (d.de))
   AND NOT EXISTS (SELECT 1 FROM public.meta_campaigns c WHERE c.event_id = r.event_id);
