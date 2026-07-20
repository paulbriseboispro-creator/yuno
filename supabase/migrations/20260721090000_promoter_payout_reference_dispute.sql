-- ============================================================================
-- Reglement promoteur : reference de virement, litige, et verrouillage du cycle.
--
-- La migration precedente (20260720193000) a pose le cycle en trois temps et la
-- table de liaison lot ↔ commissions. Il manquait trois choses pour que le
-- systeme tienne debout en vrai :
--
--   1. LA REFERENCE DE VIREMENT. Sans elle, personne ne peut rapprocher la ligne
--      Yuno du relevé bancaire. Le club voit « -237,74 € » sur son compte, le
--      promoteur voit « +237,74 € » sur le sien, et rien ne prouve que c'est le
--      meme virement. La reference (YUNO-PAULB-2607) est la seule chose qui
--      existe des DEUX cotes du systeme bancaire — c'est elle la preuve.
--
--   2. LE LITIGE. Un lot declare vire mais jamais confirme restait 'approved'
--      pour l'eternite : le club croit avoir paye, le promoteur attend toujours,
--      et personne n'est prevenu. Passe le delai, la ligne bascule en 'disputed'
--      et les deux parties sont alertees.
--
--   3. LE VERROU. Les policies RLS laissaient au club un UPDATE direct sur
--      promoter_payouts ET sur promoter_conversions. Un owner n'avait donc meme
--      pas besoin de l'interface : un seul PATCH PostgREST
--      (`promoter_conversions?status=eq.pending` → 'paid') effacait toute sa
--      dette, sans qu'aucun promoteur n'ait rien confirme. Le cycle en trois
--      temps ne protegeait personne tant que cette porte restait ouverte. On
--      bloque desormais toute ecriture de cycle qui ne passe pas par les RPC.
-- ============================================================================

-- ── 1. Colonnes du cycle ────────────────────────────────────────────────────
ALTER TABLE public.promoter_payouts
  ADD COLUMN IF NOT EXISTS transfer_reference text,
  ADD COLUMN IF NOT EXISTS confirm_due_at     timestamptz,
  ADD COLUMN IF NOT EXISTS disputed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS dispute_reason     text;

COMMENT ON COLUMN public.promoter_payouts.transfer_reference IS
  'Reference a reporter sur le virement SEPA (YUNO-XXXXX-DDMM). Seule cle de rapprochement bancaire commune aux deux parties.';
COMMENT ON COLUMN public.promoter_payouts.confirm_due_at IS
  'Date limite d''accuse de reception par le promoteur. Depassee, le lot bascule en litige.';

-- Une reference doit designer UN virement et un seul, sinon le rapprochement
-- bancaire est ambigu et l'arbitrage impossible.
CREATE UNIQUE INDEX IF NOT EXISTS promoter_payouts_transfer_reference_uniq
  ON public.promoter_payouts (transfer_reference)
  WHERE transfer_reference IS NOT NULL;

-- Retrouver les lots en retard d'accuse de reception (le watchdog quotidien).
CREATE INDEX IF NOT EXISTS idx_promoter_payouts_confirm_due
  ON public.promoter_payouts (confirm_due_at)
  WHERE status = 'approved';

-- Le statut n'avait aucune contrainte : n'importe quelle chaine passait. On
-- fige la machine a etats. NOT VALID : on n'audite pas l'historique (les lignes
-- existantes sont toutes dans ces valeurs), mais toute ecriture future est
-- verifiee.
ALTER TABLE public.promoter_payouts
  DROP CONSTRAINT IF EXISTS promoter_payouts_status_check;
ALTER TABLE public.promoter_payouts
  ADD CONSTRAINT promoter_payouts_status_check
  CHECK (status IN ('pending', 'approved', 'paid', 'disputed')) NOT VALID;

-- ── 2. Fabrique de reference de virement ────────────────────────────────────
-- Format : YUNO-PAULB-2607. Court (les libelles de virement bancaires sont
-- souvent tronques a ~35 caracteres), lisible a l'oeil sur un relevé, et
-- porteur du nom du promoteur pour que le club se repere sans ouvrir Yuno.
CREATE OR REPLACE FUNCTION public.build_payout_reference(p_promoter_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_first text;
  v_last  text;
  v_code  text;
  v_slug  text;
  v_base  text;
  v_ref   text;
  v_try   int := 0;
BEGIN
  SELECT pr.first_name, pr.last_name, p.promo_code
    INTO v_first, v_last, v_code
  FROM promoters p
  LEFT JOIN profiles pr ON pr.id = p.user_id
  WHERE p.id = p_promoter_id;

  -- Prenom + initiale du nom : « Paul Brisebois » → PAULB. On replie les
  -- accents AVANT de filtrer, sinon « Eric » devient « RIC » et « Zoe » « ZO ».
  v_slug := upper(
    translate(
      COALESCE(v_first, '') || COALESCE(left(v_last, 1), ''),
      'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
      'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY'
    )
  );
  v_slug := regexp_replace(v_slug, '[^A-Z0-9]', '', 'g');

  -- Pas de profil exploitable → on retombe sur le code promo, qui existe
  -- toujours (il est NOT NULL et unique par personne).
  IF v_slug = '' THEN
    v_slug := regexp_replace(upper(COALESCE(v_code, 'PROMO')), '[^A-Z0-9]', '', 'g');
  END IF;

  v_base := 'YUNO-' || left(v_slug, 5) || '-' || to_char(now(), 'DDMM');

  -- Deux reglements le meme jour au meme promoteur : on suffixe. La reference
  -- doit rester unique, c'est toute sa raison d'etre.
  v_ref := v_base;
  WHILE EXISTS (SELECT 1 FROM promoter_payouts WHERE transfer_reference = v_ref) LOOP
    v_try := v_try + 1;
    IF v_try > 25 THEN
      -- Ceinture et bretelles : on ne bloque jamais un reglement pour un
      -- probleme de nommage.
      v_ref := v_base || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
      EXIT;
    END IF;
    v_ref := v_base || '-' || chr(64 + v_try);
  END LOOP;

  RETURN v_ref;
END;
$fn$;

-- ── 3. Verrou : le cycle ne bouge que par les RPC ───────────────────────────
-- Le probleme, en clair : les policies RLS existantes donnent au club un UPDATE
-- direct sur promoter_payouts ET sur promoter_conversions. Un owner n'a donc
-- meme pas besoin de l'interface — un seul PATCH PostgREST
-- (`promoter_conversions?status=eq.pending` → 'paid') efface toute sa dette,
-- sans qu'aucun promoteur n'ait rien confirme. Le cycle en trois temps ne
-- protege personne tant que cette porte reste ouverte.
--
-- On discrimine sur `current_user`, pas sur un drapeau applicatif :
--   • un appel PostgREST direct s'execute sous le role `authenticated`/`anon` ;
--   • toutes les ecritures legitimes passent par des fonctions SECURITY DEFINER
--     (les RPC du cycle, le reglement agence, l'annulation sur remboursement,
--     les commissions d'equipe), qui s'executent sous le proprietaire.
-- Aucune fonction existante n'a donc besoin d'etre modifiee, et rien ne depend
-- d'un drapeau qu'on pourrait oublier de poser dans une future RPC.
CREATE OR REPLACE FUNCTION public.is_direct_client_write()
RETURNS boolean
LANGUAGE sql
STABLE
AS $fn$
  SELECT current_user IN ('authenticated', 'anon');
$fn$;

-- SECURITY INVOKER, et c'est le coeur du mecanisme : un trigger SECURITY
-- DEFINER s'executerait sous son proprietaire, `current_user` vaudrait
-- « postgres » y compris pour un PATCH client, et le verrou se desactiverait
-- lui-meme en laissant tout passer. En INVOKER, le trigger herite du role
-- reellement actif : `authenticated` pour un appel direct, le proprietaire
-- lorsqu'une RPC SECURITY DEFINER est aux commandes.
CREATE OR REPLACE FUNCTION public.guard_promoter_payout_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
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
$fn$;

DROP TRIGGER IF EXISTS trg_guard_promoter_payout_write ON public.promoter_payouts;
CREATE TRIGGER trg_guard_promoter_payout_write
  BEFORE UPDATE OR DELETE ON public.promoter_payouts
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_promoter_payout_write();

-- Meme verrou un cran plus bas : c'est promoter_conversions.status qui porte la
-- dette reelle. Le solde d'une commission n'appartient qu'a
-- confirm_promoter_payout_received — donc au promoteur.
-- SECURITY INVOKER pour la meme raison que le verrou ci-dessus.
CREATE OR REPLACE FUNCTION public.guard_promoter_conversion_settlement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF NOT public.is_direct_client_write() THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
     OR NEW.commission IS DISTINCT FROM OLD.commission THEN
    RAISE EXCEPTION 'conversion_direct_write_forbidden'
      USING HINT = 'Une commission se solde par l''accuse de reception du promoteur.';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_guard_promoter_conversion_settlement ON public.promoter_conversions;
CREATE TRIGGER trg_guard_promoter_conversion_settlement
  BEFORE UPDATE ON public.promoter_conversions
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_promoter_conversion_settlement();

-- ── 4. Etape 1 — PREPARER le lot (+ reference de virement) ──────────────────
CREATE OR REPLACE FUNCTION public.prepare_promoter_payout(
  p_promoter_id uuid,
  p_period_label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_venue_id text;
  v_org_id uuid;
  v_agency_id uuid;
  v_iban text;
  v_bic text;
  v_iban_changed timestamptz;
  v_amount numeric;
  v_count int;
  v_payout_id uuid;
  v_ref text;
BEGIN
  SELECT venue_id, organizer_user_id, agency_id, iban, bic, iban_changed_at
    INTO v_venue_id, v_org_id, v_agency_id, v_iban, v_bic, v_iban_changed
  FROM promoters WHERE id = p_promoter_id;

  IF v_agency_id IS NOT NULL THEN
    RAISE EXCEPTION 'agency_managed';
  END IF;

  IF v_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), v_venue_id) OR public.can_manage_venue(auth.uid(), v_venue_id)) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  ELSIF v_org_id IS NOT NULL THEN
    IF auth.uid() <> v_org_id AND NOT public.is_organizer_promoter_admin(auth.uid(), v_org_id) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  ELSE
    RAISE EXCEPTION 'promoter_not_found';
  END IF;

  -- Sans IBAN, le club n'a nulle part ou virer : preparer un lot n'aurait
  -- aucun sens et bloquerait les commissions dans un lot inutilisable.
  IF v_iban IS NULL OR length(trim(v_iban)) < 8 THEN
    RAISE EXCEPTION 'promoter_iban_missing';
  END IF;

  -- Gel anti-detournement.
  IF v_iban_changed IS NOT NULL AND v_iban_changed > now() - interval '24 hours' THEN
    RAISE EXCEPTION 'iban_recently_changed';
  END IF;

  -- Un seul lot ouvert a la fois. 'disputed' compte comme ouvert : on ne
  -- prepare pas un nouveau reglement tant qu'un litige n'est pas tranche.
  IF EXISTS (
    SELECT 1 FROM promoter_payouts
    WHERE promoter_id = p_promoter_id AND status IN ('pending', 'approved', 'disputed')
  ) THEN
    RAISE EXCEPTION 'payout_already_open';
  END IF;

  v_ref := public.build_payout_reference(p_promoter_id);

  INSERT INTO promoter_payouts (
    promoter_id, venue_id, organizer_user_id, amount, status, period_label, transfer_reference
  ) VALUES (
    p_promoter_id, v_venue_id, v_org_id, 0, 'pending',
    COALESCE(p_period_label, 'Reglement ' || to_char(now(), 'DD/MM/YYYY')),
    v_ref
  )
  RETURNING id INTO v_payout_id;

  -- Rattachement atomique des commissions dues et non deja rattachees.
  WITH claimed AS (
    INSERT INTO promoter_payout_items (payout_id, conversion_id, commission)
    SELECT v_payout_id, pc.id, COALESCE(pc.commission, 0)
    FROM promoter_conversions pc
    WHERE pc.promoter_id = p_promoter_id
      AND pc.status = 'pending'
      AND NOT EXISTS (SELECT 1 FROM promoter_payout_items i WHERE i.conversion_id = pc.id)
    RETURNING commission
  )
  SELECT COALESCE(SUM(commission), 0), COUNT(*) INTO v_amount, v_count FROM claimed;

  IF v_count = 0 OR v_amount <= 0 THEN
    DELETE FROM promoter_payouts WHERE id = v_payout_id;
    RETURN jsonb_build_object('prepared', false, 'reason', 'nothing_pending');
  END IF;

  UPDATE promoter_payouts SET amount = v_amount WHERE id = v_payout_id;

  RETURN jsonb_build_object(
    'prepared', true, 'payout_id', v_payout_id,
    'amount', v_amount, 'count', v_count,
    'iban', v_iban, 'bic', v_bic, 'reference', v_ref
  );
END;
$fn$;

-- ── 5. Etape 2 — le club DECLARE avoir vire ─────────────────────────────────
-- Le compte a rebours de l'accuse de reception demarre ICI, pas a la
-- preparation : c'est le virement qui engage le promoteur a repondre.
--
-- On DETRUIT la version a un seul argument avant de recreer : `CREATE OR
-- REPLACE` avec une signature elargie ne remplace rien, il cree une surcharge.
-- Les deux coexisteraient et PostgREST, appele avec le seul p_payout_id, ne
-- saurait plus laquelle choisir (PGRST203) — le bouton « J'ai effectue le
-- virement » tomberait en erreur sans rien changer en base.
DROP FUNCTION IF EXISTS public.declare_promoter_payout_sent(uuid);

CREATE OR REPLACE FUNCTION public.declare_promoter_payout_sent(
  p_payout_id uuid,
  p_confirm_days int DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_venue_id text;
  v_org_id uuid;
  v_status text;
  v_due timestamptz;
  v_days int;
BEGIN
  SELECT venue_id, organizer_user_id, status
    INTO v_venue_id, v_org_id, v_status
  FROM promoter_payouts WHERE id = p_payout_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'payout_not_found'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'payout_not_prepared'; END IF;

  IF v_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), v_venue_id) OR public.can_manage_venue(auth.uid(), v_venue_id)) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  ELSIF v_org_id IS NOT NULL THEN
    IF auth.uid() <> v_org_id AND NOT public.is_organizer_promoter_admin(auth.uid(), v_org_id) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  END IF;

  v_days := LEAST(GREATEST(COALESCE(p_confirm_days, 5), 2), 30);
  v_due := now() + make_interval(days => v_days);

  UPDATE promoter_payouts
  SET status = 'approved', approved_at = now(), approved_by = auth.uid(), confirm_due_at = v_due
  WHERE id = p_payout_id;

  RETURN jsonb_build_object('declared', true, 'payout_id', p_payout_id, 'confirm_due_at', v_due);
END;
$fn$;

-- ── 6. Etape 3 — le PROMOTEUR accuse reception ──────────────────────────────
-- C'est SEULEMENT ici que les commissions sont soldees.
CREATE OR REPLACE FUNCTION public.confirm_promoter_payout_received(p_payout_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_promoter_id uuid;
  v_status text;
  v_amount numeric;
BEGIN
  SELECT pp.promoter_id, pp.status, pp.amount
    INTO v_promoter_id, v_status, v_amount
  FROM promoter_payouts pp WHERE pp.id = p_payout_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'payout_not_found'; END IF;

  -- Un lot passe en litige (faute de reponse a temps, ou conteste) reste
  -- confirmable : l'argent a pu arriver en retard. C'est la sortie normale
  -- d'un litige, et elle appartient au promoteur.
  IF v_status NOT IN ('approved', 'disputed') THEN RAISE EXCEPTION 'payout_not_declared'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM promoters p WHERE p.id = v_promoter_id AND p.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'only_promoter_can_confirm';
  END IF;

  -- Solde EXACTEMENT les commissions du lot, pas « toutes celles en attente ».
  UPDATE promoter_conversions pc
  SET status = 'paid', paid_at = now()
  FROM promoter_payout_items i
  WHERE i.payout_id = p_payout_id
    AND pc.id = i.conversion_id
    AND pc.status = 'pending';

  UPDATE promoter_payouts
  SET status = 'paid', paid_at = now(), paid_by = auth.uid(),
      disputed_at = NULL, dispute_reason = NULL
  WHERE id = p_payout_id;

  UPDATE promoters
  SET pending_amount = GREATEST(COALESCE(pending_amount, 0) - v_amount, 0),
      total_paid = COALESCE(total_paid, 0) + v_amount,
      updated_at = now()
  WHERE id = v_promoter_id;

  RETURN jsonb_build_object('confirmed', true, 'amount', v_amount);
END;
$fn$;

-- ── 7. Litige — le promoteur conteste n'avoir rien recu ─────────────────────
CREATE OR REPLACE FUNCTION public.dispute_promoter_payout(
  p_payout_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_promoter_id uuid;
  v_status text;
BEGIN
  SELECT promoter_id, status INTO v_promoter_id, v_status
  FROM promoter_payouts WHERE id = p_payout_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'payout_not_found'; END IF;
  IF v_status <> 'approved' THEN RAISE EXCEPTION 'payout_not_declared'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM promoters p WHERE p.id = v_promoter_id AND p.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'only_promoter_can_dispute';
  END IF;

  UPDATE promoter_payouts
  SET status = 'disputed', disputed_at = now(), dispute_reason = left(COALESCE(p_reason, ''), 500)
  WHERE id = p_payout_id;

  RETURN jsonb_build_object('disputed', true, 'payout_id', p_payout_id);
END;
$fn$;

-- ── 8. Sortie de litige cote club ───────────────────────────────────────────
-- Deux issues, et seulement deux. « redeclare » : le club maintient avoir vire
-- (virement retrouve, delai bancaire) et relance le compte a rebours. « cancel »
-- : le club reconnait que le virement n'est pas parti — le lot est annule, les
-- commissions redeviennent dues et un nouveau reglement pourra etre prepare.
-- Dans aucun cas le club ne peut solder lui-meme.
CREATE OR REPLACE FUNCTION public.resolve_promoter_payout_dispute(
  p_payout_id uuid,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_venue_id text;
  v_org_id uuid;
  v_status text;
  v_due timestamptz;
BEGIN
  SELECT venue_id, organizer_user_id, status
    INTO v_venue_id, v_org_id, v_status
  FROM promoter_payouts WHERE id = p_payout_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'payout_not_found'; END IF;
  IF v_status <> 'disputed' THEN RAISE EXCEPTION 'payout_not_disputed'; END IF;

  IF v_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), v_venue_id) OR public.can_manage_venue(auth.uid(), v_venue_id)) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  ELSIF v_org_id IS NOT NULL THEN
    IF auth.uid() <> v_org_id AND NOT public.is_organizer_promoter_admin(auth.uid(), v_org_id) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  END IF;

  IF p_action = 'redeclare' THEN
    v_due := now() + interval '5 days';
    UPDATE promoter_payouts
    SET status = 'approved', disputed_at = NULL, dispute_reason = NULL, confirm_due_at = v_due
    WHERE id = p_payout_id;
    RETURN jsonb_build_object('resolved', true, 'action', 'redeclare', 'confirm_due_at', v_due);

  ELSIF p_action = 'cancel' THEN
    -- Les items partent en cascade : les commissions redeviennent rattachables.
    DELETE FROM promoter_payouts WHERE id = p_payout_id;
    RETURN jsonb_build_object('resolved', true, 'action', 'cancel');
  END IF;

  RAISE EXCEPTION 'unknown_action';
END;
$fn$;

-- ── 9. Annulation d'un lot prepare (avant declaration du virement) ──────────
CREATE OR REPLACE FUNCTION public.cancel_promoter_payout(p_payout_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_venue_id text;
  v_org_id uuid;
  v_status text;
BEGIN
  SELECT venue_id, organizer_user_id, status
    INTO v_venue_id, v_org_id, v_status
  FROM promoter_payouts WHERE id = p_payout_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'payout_not_found'; END IF;

  -- Un virement deja declare ne s'annule pas d'un clic : soit le promoteur
  -- confirme, soit il conteste et le club tranche via le litige. Sinon le club
  -- reprend le pouvoir d'effacer une dette unilateralement.
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'payout_not_cancellable'; END IF;

  IF v_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), v_venue_id) OR public.can_manage_venue(auth.uid(), v_venue_id)) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  ELSIF v_org_id IS NOT NULL THEN
    IF auth.uid() <> v_org_id AND NOT public.is_organizer_promoter_admin(auth.uid(), v_org_id) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  END IF;

  DELETE FROM promoter_payouts WHERE id = p_payout_id;
  RETURN jsonb_build_object('cancelled', true);
END;
$fn$;

-- ── 10. L'ancien reglement en un clic ne doit plus court-circuiter le cycle ──
-- settle_promoter_payout reclame « toutes les conversions en attente » sans rien
-- savoir de promoter_payout_items. Lance sur un promoteur ayant un lot ouvert,
-- il soldait les memes commissions une seconde fois : le lot ouvert pointait
-- alors sur des commissions deja payees, et l'accuse de reception les recomptait
-- dans total_paid. On ferme la porte.
CREATE OR REPLACE FUNCTION public.settle_promoter_payout(
  p_promoter_id uuid,
  p_period_label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  RAISE EXCEPTION 'use_two_step_flow'
    USING HINT = 'Le reglement passe par prepare_promoter_payout puis declare_promoter_payout_sent.';
END;
$fn$;

-- ── 11. Watchdog : pas d'accuse de reception dans les temps → litige ────────
-- Un lot declare vire mais jamais confirme est le pire etat possible : le club
-- pense avoir solde, le promoteur attend, et le systeme ne dit rien. Passe le
-- delai, on bascule en litige — ce qui reveille les deux parties.
CREATE OR REPLACE FUNCTION public.auto_dispute_stale_promoter_payouts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_count int;
BEGIN
  WITH stale AS (
    UPDATE promoter_payouts
    SET status = 'disputed', disputed_at = now(),
        dispute_reason = 'auto:no_acknowledgement'
    WHERE status = 'approved'
      AND confirm_due_at IS NOT NULL
      AND confirm_due_at < now()
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM stale;

  RETURN jsonb_build_object('disputed', v_count);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.prepare_promoter_payout(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.declare_promoter_payout_sent(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_promoter_payout_received(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dispute_promoter_payout(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_promoter_payout_dispute(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_promoter_payout(uuid) TO authenticated;

-- La fabrique de reference et le watchdog ne sont jamais appeles depuis le
-- client : ils sont internes au cycle.
REVOKE ALL ON FUNCTION public.build_payout_reference(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.auto_dispute_stale_promoter_payouts() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_promoter_payout_write() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_promoter_conversion_settlement() FROM public, anon, authenticated;

-- ── 12. Planification quotidienne du watchdog ───────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('promoter-payout-watchdog')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'promoter-payout-watchdog');

    PERFORM cron.schedule(
      'promoter-payout-watchdog',
      '30 5 * * *',
      $cron$ SELECT public.auto_dispute_stale_promoter_payouts(); $cron$
    );
  END IF;
END $$;

-- ── 13. Notifications automatiques du cycle ────────────────────────────────
INSERT INTO public.platform_notification_settings (notification_key, category) VALUES
  ('promoter_payout_declared',  'transactional'),
  ('promoter_payout_confirmed', 'transactional'),
  ('promoter_payout_disputed',  'transactional'),
  ('promoter_payout_reminder',  'reminder')
ON CONFLICT (notification_key) DO NOTHING;
