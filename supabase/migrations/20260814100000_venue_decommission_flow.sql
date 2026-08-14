-- =============================================================================
-- Suppression d'un club en deux temps : mise hors ligne immédiate, purge à J+60.
--
-- Problème d'origine : « Supprimer » depuis /admin/venues appelait
-- admin_delete_venue (hard delete). La cascade events → guest_lists heurtait
-- trg_guard_guest_list_house (SECURITY INVOKER : il voit l'auth.uid() de
-- l'admin, qui n'est pas le gestionnaire opérationnel) et la suppression
-- échouait avec « La guest list maison est tenue par la partie qui gère
-- l'opérationnel » — un message de collab qui n'a aucun sens pour l'admin.
--
-- Nouveau modèle (demande de Paul) :
--   1. « Supprimer » = DÉCOMMISSION : le club disparaît immédiatement de tout
--      le public (listes, recherche, carte, page club, soirées, ventes) mais
--      le owner et son staff gardent l'accès au dashboard pendant 2 mois pour
--      récupérer leurs données et couvrir les dernières transactions
--      (remboursements, litiges, comptabilité).
--   2. À l'échéance, un cron quotidien purge définitivement (hard delete) et
--      prévient le super admin via le flux admin_notifications.
--   3. L'admin peut annuler la suppression pendant la fenêtre, ou purger
--      immédiatement (cas des clubs de test).
--
-- Leviers de retrait public (aucun changement RLS — cf. le précédent de la
-- régression door-scan) :
--   • venues.is_hidden = true  → retiré des listes/recherche/carte, et la page
--     /club/:slug refuse désormais les clubs masqués (gate front, owner+admin
--     exemptés).
--   • events.is_active = false → invisibles sur Explore, et les 3 checkouts
--     (billets, tables, boissons) refusent déjà tout event inactif côté
--     serveur : plus un euro ne peut entrer.
-- =============================================================================

-- ── 1. Colonnes d'état sur venues ─────────────────────────────────────────────
-- Non grantées à anon (le grant anon est colonne par colonne depuis
-- 20260703140000) : l'état de décommission est invisible côté client public.
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS decommissioned_at timestamptz,
  ADD COLUMN IF NOT EXISTS purge_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_venues_purge_due
  ON public.venues (purge_at) WHERE purge_at IS NOT NULL;

-- ── 2. Garde guest list maison : le super admin passe ─────────────────────────
-- Même bypass que guard_collab_event_delete : la plateforme (root) n'est pas
-- une partie au contrat club/organisateur, elle l'arbitre. Sans ce bypass,
-- toute suppression administrative qui cascade sur guest_lists est morte.
-- Corps identique à 20260723130000, + le bypass super admin.
CREATE OR REPLACE FUNCTION public.guard_guest_list_house()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_is_house boolean;
  v_event uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF COALESCE(public.is_super_admin(), false) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_is_house := (OLD.holder_type = 'club');
    v_event := OLD.event_id;
  ELSE
    v_is_house := (OLD.holder_type = 'club' OR NEW.holder_type = 'club');
    v_event := NEW.event_id;
  END IF;

  IF v_is_house AND NOT public.can_manage_event_guestlist_house(auth.uid(), v_event) THEN
    RAISE EXCEPTION 'La guest list maison est tenue par la partie qui gère l''opérationnel'
      USING HINT = 'Proposez un avenant pour déplacer l''opérationnel, ou demandez une allocation.';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.holder_type = 'organizer'
     AND NOT public.can_manage_event_guestlist_house(auth.uid(), NEW.event_id)
     AND (NEW.quota        IS DISTINCT FROM OLD.quota
       OR NEW.quota_female IS DISTINCT FROM OLD.quota_female
       OR NEW.quota_male   IS DISTINCT FROM OLD.quota_male
       OR NEW.quota_normal IS DISTINCT FROM OLD.quota_normal
       OR NEW.quota_drink  IS DISTINCT FROM OLD.quota_drink
       OR NEW.quota_table  IS DISTINCT FROM OLD.quota_table) THEN
    RAISE EXCEPTION 'Le quota de votre part est fixé par le club'
      USING HINT = 'Déposez une nouvelle demande d''allocation pour en obtenir plus.';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- ── 3. Journal de consentement : la purge peut effacer, personne d'autre ──────
-- Le journal reste append-only pour tout le monde (y compris UPDATE, toujours
-- interdit). Seule exception : le DELETE en cascade d'une purge de club, signalé
-- par le GUC transaction-local app.venue_purge_ok (même mécanique que
-- app.collab_delete_ok). Quand le club disparaît de la plateforme, son journal
-- de preuve marketing n'a plus d'objet.
CREATE OR REPLACE FUNCTION public.block_marketing_consent_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.venue_purge_ok', true) = '1' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'marketing_consent_events est un journal append-only (tentative de %)',
    TG_OP;
END;
$$;

-- ── 4. Décommission : hors ligne tout de suite, purge dans 2 mois ─────────────
CREATE OR REPLACE FUNCTION public.admin_decommission_venue(_venue_id text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_purge_at timestamptz;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  -- COALESCE : re-cliquer ne repousse pas l'échéance déjà posée.
  UPDATE public.venues
     SET is_hidden = true,
         decommissioned_at = COALESCE(decommissioned_at, now()),
         purge_at = COALESCE(purge_at, now() + interval '2 months')
   WHERE id = _venue_id
   RETURNING purge_at INTO v_purge_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venue not found: %', _venue_id;
  END IF;

  -- Coupe les ventes et la visibilité de toutes les soirées du club — y compris
  -- les co-soirées hébergées chez lui (partner_venue_id) : le lieu ferme, la
  -- soirée ne peut plus s'y vendre. Tourne sous le propriétaire de la fonction,
  -- donc les gardes collab (protect_event_columns_from_partner) s'écartent.
  UPDATE public.events
     SET is_active = false
   WHERE (venue_id = _venue_id OR partner_venue_id = _venue_id)
     AND is_active;

  RETURN v_purge_at;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_decommission_venue(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_decommission_venue(text) TO authenticated;

-- ── 5. Annuler une suppression programmée ─────────────────────────────────────
-- Ne réactive rien : le club reste masqué (l'admin le remet visible avec
-- l'œil s'il le souhaite) et les soirées restent hors ligne (le owner les
-- remet en ligne lui-même). On rouvre la porte, on ne rallume pas la salle.
CREATE OR REPLACE FUNCTION public.admin_restore_venue(_venue_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  UPDATE public.venues
     SET decommissioned_at = NULL,
         purge_at = NULL
   WHERE id = _venue_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venue not found: %', _venue_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_restore_venue(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_restore_venue(text) TO authenticated;

-- ── 6. Purge effective (interne, aucun contrôle d'auth ici) ───────────────────
-- Appelée par le cron (auth.uid() NULL) et par admin_purge_venue (contrôlé).
-- Basée sur le corps live éprouvé d'admin_delete_venue, complétée des FK
-- NO ACTION restantes (cloakroom_transactions, terms_acceptances) et du
-- nettoyage des rôles, avec les deux GUC qui lèvent les gardes pour CETTE
-- transaction seulement.
CREATE OR REPLACE FUNCTION public._purge_venue(_venue_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_owner_id uuid;
  v_staff_ids uuid[];
  v_event_ids uuid[];
  v_deleted_count integer;
  v_owns_other boolean;
BEGIN
  SELECT owner_id INTO v_owner_id FROM public.venues WHERE id = _venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venue not found: %', _venue_id;
  END IF;

  -- Gardes levées pour cette transaction : suppression de co-soirées sans
  -- double accord (la plateforme ferme le lieu) et cascade sur le journal de
  -- consentement marketing.
  PERFORM set_config('app.collab_delete_ok', '1', true);
  PERFORM set_config('app.venue_purge_ok', '1', true);

  -- Staff rattaché au club, capturé AVANT que la FK profiles.venue_id
  -- ne soit mise à NULL par la suppression du club.
  SELECT COALESCE(array_agg(id), '{}') INTO v_staff_ids
    FROM public.profiles WHERE venue_id = _venue_id;

  SELECT ARRAY_AGG(id) INTO v_event_ids
    FROM public.events WHERE venue_id = _venue_id;

  -- FK NO ACTION sur events : à vider explicitement avant les events.
  IF v_event_ids IS NOT NULL THEN
    DELETE FROM public.cloakroom_transactions WHERE event_id = ANY(v_event_ids);
  END IF;

  -- FK NO ACTION sur table_zones : réservations de toutes les zones du club
  -- (couvre aussi les co-soirées d'organisateurs hébergées chez lui).
  DELETE FROM public.table_reservations
  WHERE zone_id IN (SELECT id FROM public.table_zones WHERE venue_id = _venue_id);

  -- FK NO ACTION sur venues.
  DELETE FROM public.terms_acceptances WHERE venue_id = _venue_id;

  -- Events du club (cascade : billets, guest lists, contrats collab, etc.).
  DELETE FROM public.events WHERE venue_id = _venue_id;

  -- Le club (cascade : drinks, orders, zones, packs, consentements, etc. ;
  -- profiles.venue_id et events.partner_venue_id passent à NULL par FK).
  DELETE FROM public.venues WHERE id = _venue_id;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count = 0 THEN
    RAISE EXCEPTION 'Venue not found: %', _venue_id;
  END IF;

  -- Rôles staff des personnes rattachées à CE club uniquement (une personne =
  -- un club : profiles.venue_id est scalaire).
  IF array_length(v_staff_ids, 1) IS NOT NULL THEN
    DELETE FROM public.user_roles
     WHERE user_id = ANY(v_staff_ids)
       AND role IN ('barman'::app_role, 'bouncer'::app_role, 'vip_host'::app_role,
                    'manager'::app_role, 'cloakroom'::app_role);
  END IF;

  -- Owner : retirer le rôle et la MFA imposée s'il ne possède plus aucun club.
  IF v_owner_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.venues WHERE owner_id = v_owner_id AND id <> _venue_id
    ) INTO v_owns_other;

    IF NOT v_owns_other THEN
      DELETE FROM public.user_roles WHERE user_id = v_owner_id AND role = 'owner'::app_role;
      UPDATE public.profiles SET mfa_enabled = false, mfa_enforced = false WHERE id = v_owner_id;
      DELETE FROM public.mfa_pending WHERE user_id = v_owner_id;
      DELETE FROM public.mfa_recovery_codes WHERE user_id = v_owner_id;
      DELETE FROM public.mfa_disable_requests WHERE user_id = v_owner_id;
    END IF;
  END IF;

  DELETE FROM public.owner_invitations WHERE venue_id = _venue_id;
END;
$$;

REVOKE ALL ON FUNCTION public._purge_venue(text) FROM public, anon, authenticated;

-- ── 7. Purge immédiate depuis l'admin (clubs de test) ─────────────────────────
CREATE OR REPLACE FUNCTION public.admin_purge_venue(_venue_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;
  PERFORM public._purge_venue(_venue_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_purge_venue(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_purge_venue(text) TO authenticated;

-- ── 8. L'ancien nom devient la décommission ───────────────────────────────────
-- Un bundle admin encore en cache PWA appelle admin_delete_venue : il doit
-- déclencher le nouveau flux en deux temps, jamais plus un hard delete.
CREATE OR REPLACE FUNCTION public.admin_delete_venue(_venue_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.admin_decommission_venue(_venue_id);
END;
$$;

-- ── 9. Balayage quotidien des purges arrivées à échéance ──────────────────────
CREATE OR REPLACE FUNCTION public.run_venue_purge_sweep()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id, name FROM public.venues
    WHERE purge_at IS NOT NULL AND purge_at <= now()
    ORDER BY purge_at
    LIMIT 20
  LOOP
    BEGIN
      PERFORM public._purge_venue(r.id);
      PERFORM public.emit_admin_notification(
        'admin_venue_purged',
        'Club purgé : ' || r.name,
        'Le club « ' || r.name || ' » (' || r.id || ') a été définitivement supprimé, '
          || 'deux mois après sa mise hors ligne.',
        'normal', 'venue', r.id,
        jsonb_build_object('venue_id', r.id, 'venue_name', r.name),
        'venue_purge:' || r.id, NULL
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'run_venue_purge_sweep: échec purge %: %', r.id, SQLERRM;
      -- dedup_key : une seule alerte par club même si le balayage réessaie
      -- chaque jour.
      PERFORM public.emit_admin_notification(
        'admin_venue_purge_failed',
        'Purge de club en échec : ' || r.name,
        'La purge automatique de « ' || r.name || ' » (' || r.id || ') a échoué : '
          || SQLERRM || '. Nouvel essai au prochain balayage.',
        'high', 'venue', r.id,
        jsonb_build_object('venue_id', r.id, 'error', SQLERRM),
        'venue_purge_failed:' || r.id, NULL
      );
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.run_venue_purge_sweep() FROM public, anon, authenticated;

-- Tous les jours à 05:20 UTC (pure SQL, pas d'edge function). Même mécanique
-- que process-due-collab-actions.
DO $$ BEGIN
  PERFORM cron.unschedule('purge-decommissioned-venues');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('purge-decommissioned-venues', '20 5 * * *',
  $$SELECT public.run_venue_purge_sweep();$$);
