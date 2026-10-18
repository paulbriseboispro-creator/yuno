-- ============================================================================
-- SEC-06 — Règlement promoteur : les deux gardes du cycle, enfin ceux du dépôt.
--
-- Constaté sur la prod le 18/10 (lecture seule, audit CRM) :
--
--   1. `trg_guard_promoter_conversion_settlement` N'EXISTE PAS, alors que
--      20260721090000 est marquée appliquée : la prod a reçu une version
--      antérieure de ce fichier. Les policies UPDATE de promoter_conversions
--      (« Owners can update conversions status », « Managers can update… »,
--      « Organizer admin can update org conversions », super admin) laissent
--      donc un owner, un manager « promoteurs », un admin promoteurs d'un
--      organisateur passer une commission en `paid` ou la mettre à 0 par un
--      simple PATCH PostgREST, sans que le promoteur n'ait rien confirmé.
--
--   2. `guard_promoter_payout_write` est la version « drapeau » de ce brouillon
--      (SECURITY DEFINER, laisse passer `auth.role() = 'service_role'` ou
--      `yuno.payout_rpc = 'on'`). Seules dispute_promoter_payout et
--      auto_dispute_stale_promoter_payouts posent ce drapeau. prepare, declare,
--      confirm, cancel et resolve ont été réécrites ensuite (20260728150000,
--      20260803140000, 20261005212000) depuis le dépôt, SANS drapeau : appelées
--      par un client, leur UPDATE / DELETE de promoter_payouts lève
--      `payout_direct_write_forbidden` et toute la RPC est annulée. Le cycle en
--      trois temps ne marche donc plus en prod : aucun lot réglé depuis le
--      28/07 ; les 15 commissions en attente au 18/10 sont toutes au club démo
--      (promoteurs d'agence), aucun vrai client n'est encore touché. Prouvé au
--      banc (scripts/crm-bench/sec06.mjs).
--
-- Ce que fait cette migration, et rien d'autre :
--   • réaffirme `is_direct_client_write()` (corps identique à la prod,
--     20260921130000 : `current_user IN ('authenticated', 'anon')`) ;
--   • remet `guard_promoter_payout_write` à la version du dépôt : SECURITY
--     INVOKER, fondée sur `is_direct_client_write()`. Un appel PostgREST
--     direct tourne sous `authenticated` et reste verrouillé ; une RPC
--     SECURITY DEFINER (propriétaire `postgres`), un cron, une fonction edge
--     en service_role passent. Le drapeau `yuno.payout_rpc` devient inerte :
--     dispute et auto_dispute le posent encore, sans effet, et ne sont PAS
--     réécrites (OPS-04 : on ne réécrit une fonction de la prod que si c'est
--     nécessaire) ;
--   • crée `guard_promoter_conversion_settlement` + son trigger : aucune
--     écriture DIRECTE d'un client ne modifie ni ne supprime une commission.
--     Plus large que la version du dépôt (status, paid_at, commission) :
--     toute colonne, parce qu'aucun chemin client légitime n'écrit dans cette
--     table (front, app Pro, edge : lectures seulement, vérifié le 18/10) et
--     qu'un owner pouvait aussi déplacer une commission d'un promoteur à
--     l'autre (`promoter_id`). Les écritures légitimes sont toutes des
--     fonctions SECURITY DEFINER de `postgres` : record_promoter_conversion
--     (porte, part du chef d'équipe), confirm_promoter_payout_received
--     (solde), cancel_promoter_conversions_for_refund (remboursement), et le
--     service_role ; une suppression en cascade (promoteur supprimé) tourne
--     sous le propriétaire de la table et passe aussi. Conséquence à trancher
--     AVANT d'appliquer (SEC-08, BACKLOG 16g) : supprimer un promoteur qui a
--     un lot de règlement redevient possible et emporte ses lots, comme le
--     prévoit le dépôt ; le garde « drapeau » l'empêchait par accident.
--
-- Les deux gardes DOIVENT rester SECURITY INVOKER : en DEFINER, `current_user`
-- vaudrait toujours `postgres` et le verrou se désactiverait lui-même
-- (CLAUDE.md, « Règlement promoteur »). Un trigger ne demande pas le droit
-- EXECUTE à son déclenchement : le REVOKE ci-dessous ne gêne rien (banc).
--
-- Répéter avant d'appliquer : node scripts/crm-bench/sec06.mjs run (banc),
-- puis sur la prod, en transaction annulée :
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/sec06.sql \
--     20261024100000_promoter_settlement_guards.sql
--
-- ── RETOUR ARRIÈRE ───────────────────────────────────────────────────────────
-- Remet l'état de la prod du 18/10 (et donc le cycle cassé et la faille) :
--
--   DROP TRIGGER IF EXISTS trg_guard_promoter_conversion_settlement ON public.promoter_conversions;
--   DROP FUNCTION IF EXISTS public.guard_promoter_conversion_settlement();
--   CREATE OR REPLACE FUNCTION public.guard_promoter_payout_write()
--    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
--   AS $function$
--   BEGIN
--     IF COALESCE(auth.role(), '') = 'service_role' THEN RETURN COALESCE(NEW, OLD); END IF;
--     IF COALESCE(current_setting('yuno.payout_rpc', true), '') = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
--     IF TG_OP = 'DELETE' THEN
--       RAISE EXCEPTION 'payout_direct_write_forbidden' USING HINT = 'Annulez le lot via cancel_promoter_payout.';
--     END IF;
--     IF NEW.status IS DISTINCT FROM OLD.status OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
--        OR NEW.paid_at IS DISTINCT FROM OLD.paid_at OR NEW.disputed_at IS DISTINCT FROM OLD.disputed_at
--        OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.transfer_reference IS DISTINCT FROM OLD.transfer_reference THEN
--       RAISE EXCEPTION 'payout_direct_write_forbidden'
--         USING HINT = 'Le cycle de reglement passe par declare_promoter_payout_sent / confirm_promoter_payout_received.';
--     END IF;
--     RETURN NEW;
--   END;
--   $function$;
--   REVOKE ALL ON FUNCTION public.guard_promoter_payout_write() FROM PUBLIC, anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.guard_promoter_payout_write() TO service_role;
--   DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261024100000';
--
-- (is_direct_client_write n'a pas changé : rien à défaire.)
-- ============================================================================

-- ── 1. La porte « écriture directe d'un client ? » ──────────────────────────
-- Identique à la prod (20260921130000). Réaffirmée pour que ce fichier ne
-- dépende pas de son existence : elle a déjà disparu une fois de la base.
CREATE OR REPLACE FUNCTION public.is_direct_client_write()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT current_user IN ('authenticated', 'anon');
$function$;

-- Le garde, INVOKER, l'appelle sous `authenticated` / `anon` : ils doivent
-- pouvoir l'exécuter (c'est déjà le cas en prod, PUBLIC).
GRANT EXECUTE ON FUNCTION public.is_direct_client_write() TO anon, authenticated, service_role;

-- ── 2. Lots de règlement : la version du dépôt ──────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_promoter_payout_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_direct_client_write() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payout_direct_write_forbidden'
      USING HINT = 'Annulez le lot via cancel_promoter_payout.';
  END IF;

  -- On ne verrouille QUE le cycle : un club doit pouvoir corriger une note ou
  -- un libelle de periode librement.
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
     OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
     OR NEW.disputed_at IS DISTINCT FROM OLD.disputed_at
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.transfer_reference IS DISTINCT FROM OLD.transfer_reference THEN
    RAISE EXCEPTION 'payout_direct_write_forbidden'
      USING HINT = 'Le cycle de reglement passe par declare_promoter_payout_sent / confirm_promoter_payout_received.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_promoter_payout_write() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_promoter_payout_write() TO service_role;

-- Le trigger `trg_guard_promoter_payout_write` (BEFORE UPDATE OR DELETE) existe
-- en prod et pointe sur cette fonction : CREATE OR REPLACE garde son oid, il
-- n'y a rien à recréer (20260721090000 le pose sur une base vierge).

-- ── 3. Commissions : aucune écriture directe d'un client ────────────────────
-- C'est promoter_conversions.status qui porte la dette réelle ; son solde
-- n'appartient qu'à confirm_promoter_payout_received, donc au promoteur.
CREATE OR REPLACE FUNCTION public.guard_promoter_conversion_settlement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_direct_client_write() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'conversion_direct_write_forbidden'
      USING HINT = 'Une commission ne se supprime pas depuis le client.';
  END IF;

  -- Une mise à jour qui ne change rien reste permise ; tout le reste passe
  -- par les RPC (solde, porte, remboursement).
  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'conversion_direct_write_forbidden'
      USING HINT = 'Une commission se solde par l''accuse de reception du promoteur.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_promoter_conversion_settlement() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_promoter_conversion_settlement() TO service_role;

DROP TRIGGER IF EXISTS trg_guard_promoter_conversion_settlement ON public.promoter_conversions;
CREATE TRIGGER trg_guard_promoter_conversion_settlement
  BEFORE UPDATE OR DELETE ON public.promoter_conversions
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_promoter_conversion_settlement();
