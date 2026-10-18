-- ============================================================================
-- SEC-07 — Un promoteur n'écrit plus que ses coordonnées dans sa fiche.
--
-- Constaté sur la prod le 18/10 (lecture seule, audit CRM) : deux policies
-- UPDATE de `promoters` s'ouvrent au promoteur lui-même, sans liste de
-- colonnes, et `authenticated` a le droit UPDATE sur les 50 colonnes :
--   • « Promoters can update their own IBAN »       USING / CHECK auth.uid() = user_id
--   • « Promoter can update own organizer profile » USING / CHECK organizer_user_id
--                                                    IS NOT NULL AND user_id = auth.uid()
-- Un promoteur pouvait donc, par un simple PATCH PostgREST sur sa ligne :
--   • relever ses taux de commission (ticket_/table_commission_type|value, lus
--     par record_promoter_conversion à chaque vente suivante) ;
--   • offrir des remises sur la caisse du club (ticket_/table_/customer_/
--     drink_discount_*, lus par create-ticket-checkout et create-table-checkout :
--     100 % = billets gratuits et acompte de table nul avec son code) ;
--   • se rouvrir la porte (can_scan_entries) ou se réactiver (is_active) ;
--   • se rattacher à un autre club, organisateur, agence ou équipe (venue_id,
--     organizer_user_id, agency_id, team_id…) avec ses propres taux ;
--   • réécrire son dû et son payé (pending_amount, total_paid) ;
--   • antidater iban_changed_at juste après avoir changé d'IBAN, ce qui annule
--     le gel anti-détournement de 24 h de prepare_promoter_payout.
-- Prouvé au banc sur les définitions de la prod (scripts/crm-bench/sec07.mjs).
--
-- Inventaire des écritures du promoteur sur sa propre fiche (front + app Pro,
-- même bundle, 18/10) — PromoterProfileTab et PromoterProfilePage :
--   iban, bic (dialogue IBAN), instagram_url, whatsapp_number, promo_code
--   (régénéré depuis le prénom / nom), profile_image_url. Le prénom et le nom
--   vont dans `profiles`, pas ici. Les fonctions edge écrivent en service_role
--   (accept-promoter-invitation, accept-staff-invitation), les RPC qui touchent
--   `promoters` sont toutes SECURITY DEFINER de `postgres` (lecture de la prod).
--
-- Ce que fait cette migration, et rien d'autre :
--   • réaffirme `is_direct_client_write()` (corps identique à la prod et à
--     20261024100000 ; ce fichier ne dépend pas de SEC-06) ;
--   • crée `guard_promoter_self_update()` + le trigger
--     `trg_a_guard_promoter_self_update` (BEFORE UPDATE). Pour une écriture
--     DIRECTE d'un client (`authenticated` / `anon`) faite par le promoteur
--     de la ligne (auth.uid() = OLD.user_id), qui n'a par ailleurs AUCUN droit
--     de gestion sur cette ligne, seules changent les colonnes de la liste :
--     iban, bic, instagram_url, whatsapp_number, profile_image_url, promo_code,
--     first_name, last_name, phone (son identité, aucun lien avec l'argent ni
--     le périmètre) et updated_at (posé par son trigger). Toute autre colonne
--     modifiée lève `promoter_self_update_forbidden` (42501, 403 côté API) en
--     nommant les colonnes refusées. Une colonne ajoutée plus tard à la table
--     est refusée au promoteur tant qu'elle n'entre pas dans la liste.
--   • Droits de gestion = le miroir EXACT des autres policies UPDATE de la
--     table, évalué sur l'ancienne ligne : owner du club ou manager
--     « promoteurs » (is_venue_owner / manager_has_permission), organisateur
--     ou admin promoteurs (is_organizer_promoter_admin), chef de l'agence
--     (is_agency_owner), super admin. Un owner qui est aussi son propre
--     promoteur garde donc tous ses droits, et ni les owners, ni les
--     managers, ni les organisateurs, ni les agences ne perdent rien.
--
-- Le trigger s'appelle `trg_a_…` pour passer AVANT les autres triggers BEFORE
-- de la table (ordre alphabétique) : il voit la ligne telle que le client l'a
-- envoyée. Après lui, `trg_stamp_promoter_iban_change` pose iban_changed_at
-- quand l'IBAN change (le gel de 24 h tient), `update_promoters_updated_at`
-- pose updated_at. Un iban_changed_at envoyé par le promoteur est refusé.
--
-- Le garde DOIT rester SECURITY INVOKER : en DEFINER, `current_user` vaudrait
-- `postgres` et le verrou se désactiverait lui-même (CLAUDE.md, « Règlement
-- promoteur »). Les fonctions de droits qu'il appelle sont celles des
-- policies : `authenticated` les exécute déjà.
--
-- Répéter avant d'appliquer : node scripts/crm-bench/sec07.mjs run (banc),
-- puis sur la prod, en transaction annulée :
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/sec07.sql \
--     20261025100000_promoter_self_update_guard.sql
--
-- ── RETOUR ARRIÈRE ───────────────────────────────────────────────────────────
-- Remet l'état de la prod du 18/10 (et donc la faille) :
--
--   DROP TRIGGER IF EXISTS trg_a_guard_promoter_self_update ON public.promoters;
--   DROP FUNCTION IF EXISTS public.guard_promoter_self_update();
--   DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261025100000';
--
-- (is_direct_client_write n'a pas changé : rien à défaire.)
-- ============================================================================

-- ── 1. La porte « écriture directe d'un client ? » ──────────────────────────
-- Identique à la prod (20260921130000) et à 20261024100000.
CREATE OR REPLACE FUNCTION public.is_direct_client_write()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT current_user IN ('authenticated', 'anon');
$function$;

GRANT EXECUTE ON FUNCTION public.is_direct_client_write() TO anon, authenticated, service_role;

-- ── 2. Le garde des colonnes du promoteur ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_promoter_self_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  -- Ce que le promoteur écrit lui-même : ses coordonnées, rien d'autre.
  v_self_columns constant text[] := ARRAY[
    'iban', 'bic', 'instagram_url', 'whatsapp_number', 'profile_image_url',
    'promo_code', 'first_name', 'last_name', 'phone', 'updated_at'
  ];
  v_refused text[];
BEGIN
  -- RPC SECURITY DEFINER, cron, fonction edge en service_role, cascade : libres.
  IF NOT public.is_direct_client_write() THEN
    RETURN NEW;
  END IF;

  -- Seul le promoteur de la ligne est concerné ; les autres écrivains sont
  -- passés par une policy de gestion.
  IF v_uid IS NULL OR v_uid IS DISTINCT FROM OLD.user_id THEN
    RETURN NEW;
  END IF;

  -- Le promoteur qui a AUSSI un droit de gestion sur cette ligne le garde :
  -- miroir des autres policies UPDATE de `promoters`, sur l'ancienne ligne.
  IF public.is_super_admin()
     OR (OLD.venue_id IS NOT NULL
         AND (public.is_venue_owner(v_uid, OLD.venue_id)
              OR public.manager_has_permission(v_uid, OLD.venue_id, 'promoters')))
     OR (OLD.organizer_user_id IS NOT NULL
         AND COALESCE(public.is_organizer_promoter_admin(v_uid, OLD.organizer_user_id), false))
     OR (OLD.agency_id IS NOT NULL
         AND public.is_agency_owner(v_uid, OLD.agency_id))
  THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(n.key ORDER BY n.key)
    INTO v_refused
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o USING (key)
   WHERE n.value IS DISTINCT FROM o.value
     AND NOT (n.key = ANY (v_self_columns));

  IF v_refused IS NOT NULL THEN
    RAISE EXCEPTION 'promoter_self_update_forbidden: %', array_to_string(v_refused, ', ')
      USING ERRCODE = '42501',
            HINT = 'Un promoteur ne modifie que ses coordonnées (IBAN, BIC, profil) ; le reste se règle par son club, son organisateur ou son agence.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_promoter_self_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_promoter_self_update() TO service_role;

DROP TRIGGER IF EXISTS trg_a_guard_promoter_self_update ON public.promoters;
CREATE TRIGGER trg_a_guard_promoter_self_update
  BEFORE UPDATE ON public.promoters
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_promoter_self_update();
