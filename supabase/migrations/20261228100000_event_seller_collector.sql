-- Tables VIP, vague C3b — le VENDEUR d'un reçu / d'une facture est celui qui a ENCAISSÉ cette vente (D9, constat de la vague C1).
--
-- Constat : sur une soirée d'organisateur chez un club partenaire (événement sans venue_id, partner_venue_id posé), un pilier encaissé par
-- l'ORGANISATEUR en charge directe (« réglé entre vous », tables ou billets 100 % organisateur, hors virement) avait un reçu au nom du CLUB :
-- `get_event_seller` ne regardait que le contrat en virement, puis tombait sur le club partenaire. La facture stockée (`assign_invoice_number`)
-- suivait la même règle incomplète (club, sauf virement vers l'organisateur).
--
-- Règle unique, `_sale_collector_kind(event, compte Stripe de la vente, collab_split)` : 'organizer' | 'venue' | NULL (inconnu : démo, règlement sur place,
-- gratuit → la règle d'avant s'applique).
--   1. contrat en virement (collab_split.mode = 'transfer') : le collecteur du contrat ;
--   2. sinon le compte Stripe sur lequel la charge directe est née (`stripe_connected_account_id`) : celui d'un organisateur de la soirée
--      (profiles.stripe_connect_account_id, organizer_user_id ou partner_organizer_id) → 'organizer' ; celui d'un club de la soirée
--      (venues.stripe_account_id, venue_id ou partner_venue_id) → 'venue'.
-- Lue par `get_event_seller` (reçu : l'écran prouve par le QR de la vente) ET par `assign_invoice_number` (facture, donc l'avoir et la TVA) :
-- le reçu et la facture disent la même partie. Les factures déjà émises ne changent pas (un numéro émis est immuable).

CREATE OR REPLACE FUNCTION public._sale_collector_kind(p_event_id uuid, p_connected_account text, p_split jsonb)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_split->>'mode' = 'transfer' AND p_split->>'collector' IN ('organizer', 'venue') THEN p_split->>'collector'
    WHEN NULLIF(btrim(COALESCE(p_connected_account, '')), '') IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM public.events e JOIN public.profiles p ON p.id IN (e.organizer_user_id, e.partner_organizer_id)
                  WHERE e.id = p_event_id AND p.stripe_connect_account_id = p_connected_account) THEN 'organizer'
    WHEN EXISTS (SELECT 1 FROM public.events e JOIN public.venues v ON v.id IN (e.venue_id, e.partner_venue_id)
                  WHERE e.id = p_event_id AND v.stripe_account_id = p_connected_account) THEN 'venue'
  END
$$;
REVOKE ALL ON FUNCTION public._sale_collector_kind(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sale_collector_kind(uuid, text, jsonb) TO service_role;

-- ── Reçu : reprise de la définition VIVANTE de la prod au 26/11 ; seul change le calcul du collecteur ────────────────────
CREATE OR REPLACE FUNCTION public.get_event_seller(p_event_id uuid, p_qr_code text)
 RETURNS TABLE(name text, legal_address text, siret text, rna_number text, vat_number text, vat_regime text, bde_verified boolean, logo_url text, sole_seller boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ev record;
  v_split jsonb;
  v_acct text;
  v_collector text;
  v_org uuid;
BEGIN
  IF p_event_id IS NULL OR NULLIF(btrim(COALESCE(p_qr_code, '')), '') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tickets t WHERE t.qr_code = p_qr_code AND t.event_id = p_event_id)
     AND NOT EXISTS (SELECT 1 FROM public.table_reservations r WHERE r.qr_code = p_qr_code AND r.event_id = p_event_id) THEN
    RETURN;
  END IF;

  SELECT e.venue_id, e.partner_venue_id, e.organizer_user_id, e.partner_organizer_id INTO v_ev
    FROM public.events e WHERE e.id = p_event_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Qui a encaissé CETTE vente : le contrat en virement, sinon le compte Stripe de la charge directe (voir _sale_collector_kind).
  SELECT x.collab_split, x.stripe_connected_account_id INTO v_split, v_acct FROM (
    SELECT t.collab_split, t.stripe_connected_account_id FROM public.tickets t WHERE t.qr_code = p_qr_code AND t.event_id = p_event_id
    UNION ALL
    SELECT r.collab_split, r.stripe_connected_account_id FROM public.table_reservations r WHERE r.qr_code = p_qr_code AND r.event_id = p_event_id
  ) x LIMIT 1;
  v_collector := public._sale_collector_kind(p_event_id, v_acct, v_split);

  -- Encaissé par l'organisateur (virement, ou charge directe sur son compte) : c'est lui le vendeur du reçu (son régime de TVA),
  -- que la soirée soit menée par le club ou par lui. Avec deux organisateurs, celui dont le compte a encaissé.
  IF v_collector = 'organizer' THEN
    SELECT p.id INTO v_org FROM public.profiles p
     WHERE p.id IN (v_ev.organizer_user_id, v_ev.partner_organizer_id) AND v_acct IS NOT NULL AND p.stripe_connect_account_id = v_acct
     LIMIT 1;
    v_org := COALESCE(v_org, v_ev.organizer_user_id, v_ev.partner_organizer_id);
    RETURN QUERY
    SELECT COALESCE(NULLIF(o.legal_name, ''), o.display_name),
           o.legal_address, o.siret, o.rna_number,
           o.vat_number, o.vat_regime, COALESCE(o.bde_verified, false), o.avatar_url,
           true
      FROM public.organizer_profiles o
     WHERE o.user_id = v_org;
    RETURN;
  END IF;

  IF v_ev.venue_id IS NOT NULL THEN
    RETURN;
  END IF;

  IF v_ev.partner_venue_id IS NOT NULL THEN
    RETURN QUERY
    SELECT COALESCE(NULLIF(v.legal_name, ''), v.name), COALESCE(v.legal_address, v.address), v.siret, NULL::text,
           v.vat_number, 'subject'::text, false, v.logo_url, false
      FROM public.venues v WHERE v.id = v_ev.partner_venue_id;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT COALESCE(NULLIF(o.legal_name, ''), o.display_name),
         o.legal_address, o.siret, o.rna_number,
         o.vat_number, o.vat_regime, COALESCE(o.bde_verified, false), o.avatar_url,
         true
    FROM public.organizer_profiles o
   WHERE o.user_id = v_ev.organizer_user_id;
END;
$function$;

-- ── Facture : la même règle, posée par le déclencheur de numérotation (la facture, l'avoir et la TVA en héritent) ─────────
DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public.assign_invoice_number()'::regprocedure);
  v_new text := v_def;
BEGIN
  v_new := replace(v_new, E'  v_seq int;\nBEGIN', E'  v_seq int;\n  v_acct text;\n  v_collector text;\nBEGIN');
  v_new := replace(v_new, 'SELECT t.event_id, t.collab_split INTO v_event_id, v_split', 'SELECT t.event_id, t.collab_split, t.stripe_connected_account_id INTO v_event_id, v_split, v_acct');
  v_new := replace(v_new, 'SELECT r.event_id, r.collab_split INTO v_event_id, v_split', 'SELECT r.event_id, r.collab_split, r.stripe_connected_account_id INTO v_event_id, v_split, v_acct');
  v_new := replace(v_new,
    E'    NEW.seller_kind := public._invoice_seller_kind(NEW.venue_id, NEW.organizer_user_id, v_split);',
    E'    -- Vendeur = qui a ENCAISSÉ cette vente (virement, ou compte Stripe de la charge directe) ; à défaut la règle d\'avant.\n'
    || E'    v_collector := public._sale_collector_kind(v_event_id, v_acct, v_split);\n'
    || E'    NEW.seller_kind := COALESCE(\n'
    || E'      CASE v_collector\n'
    || E'        WHEN ''organizer'' THEN CASE WHEN NEW.organizer_user_id IS NOT NULL THEN ''organizer'' END\n'
    || E'        WHEN ''venue'' THEN CASE WHEN NEW.venue_id IS NOT NULL THEN ''venue'' END\n'
    || E'      END,\n'
    || E'      public._invoice_seller_kind(NEW.venue_id, NEW.organizer_user_id, v_split));');
  IF v_new = v_def OR position('_sale_collector_kind' IN v_new) = 0 OR position('v_acct text' IN v_new) = 0
     OR position('t.stripe_connected_account_id INTO' IN v_new) = 0 OR position('r.stripe_connected_account_id INTO' IN v_new) = 0 THEN
    RAISE EXCEPTION 'assign_invoice_number : la définition de la base ne ressemble plus à celle attendue (patch refusé)';
  END IF;
  EXECUTE v_new;
END
$patch$;
