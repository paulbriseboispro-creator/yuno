-- ─────────────────────────────────────────────────────────────────────────────
-- Porte « paiements prêts » — la sentinelle Stripe démo ne compte pas comme
-- un compte prêt.
--
-- Contexte : le club/profil démo (@womber.fr) porte un compte Stripe factice
-- `acct_demo_yuno` avec charges_enabled=true (seed-demo-womber.sql:124, posé
-- sur profiles.stripe_connect_account_id de l'organisateur démo). Les deux RPC
-- de la porte de vente (20260819130000) ne testent que « id non NULL +
-- charges_enabled » → elles renvoient TRUE pour les soirées org-led démo, et
-- le bouton acheter s'ouvre pour un VRAI utilisateur alors que les
-- create-*-checkout refusent désormais la sentinelle côté serveur (durcis en
-- parallèle). Attendu (notes Apple) : porte fermée → « Coming soon ».
--
-- Correctif : mêmes signatures, corps identiques à 20260819130000 (vérifié le
-- 2026-08-24 via pg_get_functiondef : la prod ne porte aucune version plus
-- récente), avec une seule condition ajoutée sur chaque branche : l'id de
-- compte ne doit pas commencer par `acct_demo`. Le `\_` échappe le wildcard
-- LIKE (underscore littéral), sinon `acct-demoX` matcherait aussi.
--
-- La session démo légitime, elle, ne voit jamais cette porte : le front
-- bypasse la RPC pour les comptes @womber.fr (src/lib/paymentsReady.ts,
-- « démo jamais gatée », fail-open) et côté serveur la branche simulate
-- bifurque avant le gate.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.venue_payments_ready(p_venue_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT v.stripe_account_id IS NOT NULL
       AND v.stripe_account_id NOT LIKE 'acct\_demo%'
       AND COALESCE(v.stripe_charges_enabled, false)
    FROM public.venues v
    WHERE v.id = p_venue_id
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.event_payments_ready(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN e.venue_id IS NOT NULL THEN (
        SELECT v.stripe_account_id IS NOT NULL
           AND v.stripe_account_id NOT LIKE 'acct\_demo%'
           AND COALESCE(v.stripe_charges_enabled, false)
        FROM public.venues v
        WHERE v.id = e.venue_id
      )
      ELSE (
        SELECT p.stripe_connect_account_id IS NOT NULL
           AND p.stripe_connect_account_id NOT LIKE 'acct\_demo%'
           AND COALESCE(p.stripe_connect_charges_enabled, false)
        FROM public.profiles p
        WHERE p.id = COALESCE(e.organizer_user_id, e.partner_organizer_id)
      )
    END
    FROM public.events e
    WHERE e.id = p_event_id
  ), false);
$$;

-- CREATE OR REPLACE préserve les ACL existantes ; ré-assertées par lisibilité.
REVOKE ALL ON FUNCTION public.venue_payments_ready(text) FROM public;
REVOKE ALL ON FUNCTION public.event_payments_ready(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_payments_ready(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_payments_ready(uuid) TO anon, authenticated;
