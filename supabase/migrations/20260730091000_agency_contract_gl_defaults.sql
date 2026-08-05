-- =====================================================================
-- Enveloppe guest list STANDING au niveau du contrat agence↔club.
--
-- « Les deux » voies d'octroi (décision produit) :
--   1. STANDING (ici) : le club fixe une fois « N places / soirée » sur le
--      contrat ; l'enveloppe se matérialise automatiquement à chaque soirée
--      du club (voir create_agency_guestlist_part, 092000).
--   2. PAR SOIRÉE : le club écrase l'enveloppe d'un soir précis
--      (grant_agency_guestlist_allocation, 093000).
--
-- Le club est propriétaire de la capacité de sa porte : c'est lui (et lui seul)
-- qui fixe ces défauts, via l'RPC set_agency_contract_gl_default (093000, gardée
-- can_manage_venue / can_manage_organizer). L'agence les LIT (RLS de lecture du
-- contrat déjà en place) mais ne les écrit pas.
--
-- Seuls les contrats à venue_id (= clubs Yuno) ou organizer_user_id portent une
-- enveloppe ⇒ le bras externe/affilié (sans contrat) en est nativement exclu.
-- =====================================================================

ALTER TABLE public.agency_venue_contracts
  -- NULL = aucune enveloppe standing (le club doit octroyer par soirée) ;
  -- 0 = illimité ; N = places / soirée. Même sémantique que guest_lists.quota.
  ADD COLUMN IF NOT EXISTS gl_default_quota integer,
  ADD COLUMN IF NOT EXISTS gl_default_normal integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gl_default_drink integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gl_default_table integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gl_default_female integer,
  ADD COLUMN IF NOT EXISTS gl_default_male integer,
  ADD COLUMN IF NOT EXISTS gl_default_free_before time,
  ADD COLUMN IF NOT EXISTS gl_default_mode text NOT NULL DEFAULT 'partition'
    CHECK (gl_default_mode IN ('partition', 'pool'));

COMMENT ON COLUMN public.agency_venue_contracts.gl_default_quota IS
  'Enveloppe guest list standing accordée à l''agence par soirée. NULL = aucune (octroi par soirée uniquement) ; 0 = illimité ; N = places.';
COMMENT ON COLUMN public.agency_venue_contracts.gl_default_mode IS
  'Mode de répartition par défaut appliqué à l''enveloppe matérialisée : partition (sous-quotas fixes) ou pool (libre jusqu''à épuisement). L''agence peut basculer soirée par soirée.';
