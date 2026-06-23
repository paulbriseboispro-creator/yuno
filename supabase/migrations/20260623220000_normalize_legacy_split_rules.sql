-- =============================================================================
-- Normalisation des règles de partage co-event (split_rules) au schéma canonique.
--
-- PROBLÈME : deux schémas coexistaient en base.
--   - Canonique (attendu PARTOUT, front + back payment-split.ts) :
--       { tickets:{organizer_pct,venue_pct}, tables:{...}, drinks:{...} }
--   - Hérité « plat » (RecurringEventsManager / vieux défauts de partenariat) :
--       { organizer:30, venue:70 }            (drinks parfois ajouté imbriqué)
--
-- Le schéma plat n'a PAS de clés .tickets/.tables. SplitContractBanner lisait
-- `rules.tickets.organizer_pct` en direct → "Cannot read properties of undefined"
-- → tout le tableau de bord collab tombait en écran blanc (8 events concernés).
-- Et payment-split.ts (back) ne comprend que le schéma imbriqué : un split signé
-- au schéma plat retombait sur le défaut 50/50 au lieu du 70/30 convenu.
--
-- FIX : convertir toutes les lignes plates au schéma imbriqué. Le split plat global
-- s'applique aux billets ET aux tables ; les boissons restent 100% club (licence alcool).
-- Idempotent : ne touche que les lignes portant les clés plates `organizer`/`venue`.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.normalize_split_rules(rules jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $func$
DECLARE
  has_flat boolean;
  flat_o numeric;
  flat_v numeric;
  t_o numeric; t_v numeric;
  b_o numeric; b_v numeric;
BEGIN
  IF rules IS NULL OR jsonb_typeof(rules) <> 'object' THEN
    RETURN rules;
  END IF;

  -- Split global hérité { organizer, venue }
  has_flat := (rules ? 'organizer') OR (rules ? 'venue');
  IF has_flat THEN
    flat_o := NULLIF(rules->>'organizer','')::numeric;
    flat_v := NULLIF(rules->>'venue','')::numeric;
    flat_o := COALESCE(flat_o, CASE WHEN flat_v IS NOT NULL THEN 100 - flat_v ELSE 0 END);
    flat_v := COALESCE(flat_v, 100 - flat_o);
  END IF;

  -- Billets : un bloc imbriqué l'emporte ; sinon le split plat ; sinon 0/100 club.
  IF (rules->'tickets') ? 'organizer_pct' OR (rules->'tickets') ? 'venue_pct' THEN
    t_o := COALESCE(NULLIF(rules->'tickets'->>'organizer_pct','')::numeric, 0);
    t_v := COALESCE(NULLIF(rules->'tickets'->>'venue_pct','')::numeric, 100 - t_o);
  ELSIF has_flat THEN
    t_o := flat_o; t_v := flat_v;
  ELSE
    t_o := 0; t_v := 100;
  END IF;

  -- Tables : idem.
  IF (rules->'tables') ? 'organizer_pct' OR (rules->'tables') ? 'venue_pct' THEN
    b_o := COALESCE(NULLIF(rules->'tables'->>'organizer_pct','')::numeric, 0);
    b_v := COALESCE(NULLIF(rules->'tables'->>'venue_pct','')::numeric, 100 - b_o);
  ELSIF has_flat THEN
    b_o := flat_o; b_v := flat_v;
  ELSE
    b_o := 0; b_v := 100;
  END IF;

  RETURN jsonb_build_object(
    'tickets', jsonb_build_object('organizer_pct', t_o, 'venue_pct', t_v),
    'tables',  jsonb_build_object('organizer_pct', b_o, 'venue_pct', b_v),
    'drinks',  jsonb_build_object('organizer_pct', 0,   'venue_pct', 100)
  );
END;
$func$;

-- ── Backfill ────────────────────────────────────────────────────────────────

-- Défauts de partenariat (source des futurs contrats).
UPDATE public.venue_organizer_partnerships
   SET default_split_rules = public.normalize_split_rules(default_split_rules)
 WHERE default_split_rules ? 'organizer' OR default_split_rules ? 'venue';

-- Templates récurrents (copiés tels quels dans les contrats à chaque occurrence).
UPDATE public.owner_recurring_templates
   SET revenue_split_rules = public.normalize_split_rules(revenue_split_rules)
 WHERE revenue_split_rules IS NOT NULL
   AND (revenue_split_rules ? 'organizer' OR revenue_split_rules ? 'venue');

-- Events : règles appliquées (pilotent le partage Stripe) + proposition en attente.
UPDATE public.events
   SET revenue_split_rules = public.normalize_split_rules(revenue_split_rules)
 WHERE revenue_split_rules IS NOT NULL
   AND (revenue_split_rules ? 'organizer' OR revenue_split_rules ? 'venue');

UPDATE public.events
   SET revenue_split_proposal = public.normalize_split_rules(revenue_split_proposal)
 WHERE revenue_split_proposal IS NOT NULL
   AND (revenue_split_proposal ? 'organizer' OR revenue_split_proposal ? 'venue');

-- Contrats NON verrouillés (le trigger d'immuabilité interdit de toucher
-- 'locked'/'closed' ; pour ceux-là le partage économique est figé et inchangé,
-- la valeur reste plate sur la ligne contrat mais chaque lecteur la normalise,
-- et le partage Stripe lit events.revenue_split_rules déjà corrigé ci-dessus).
UPDATE public.event_collab_contracts
   SET split_rules = public.normalize_split_rules(split_rules)
 WHERE (split_rules ? 'organizer' OR split_rules ? 'venue')
   AND status NOT IN ('locked','closed');
