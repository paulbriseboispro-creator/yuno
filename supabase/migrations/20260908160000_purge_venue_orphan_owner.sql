-- Purge d'un club dont le propriétaire est un PROFIL ORPHELIN.
--
-- Vécu en prod le 2026-09-08 sur Casanova et Le Bonsaï : `_purge_venue` mourait
-- sur `23503 profiles_id_fkey` à l'`UPDATE public.profiles SET mfa_enabled=false`.
-- Le propriétaire est un profil laissé derrière par une suppression douce
-- (`should_soft_delete`, voir docs/ORPHAN_PROFILES.md) : la ligne `auth.users`
-- n'existe plus, donc toute écriture sur ce profil revalide la FK et la casse.
--
-- Conséquence : un club orphelin ne pouvait plus être supprimé, ni à la main ni
-- par le cron de purge J+60 — il restait indéfiniment en décommission.
--
-- Correctif : le nettoyage MFA ne s'applique qu'à un propriétaire qui a encore
-- un compte. Un orphelin n'a pas de session, donc pas de MFA à désarmer : le
-- sauter ne perd rien. Le reste de la fonction est inchangé.
CREATE OR REPLACE FUNCTION public._purge_venue(_venue_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

      -- Le désarmement MFA n'a de sens que pour un propriétaire qui a encore un
      -- compte. Sur un profil orphelin, l'UPDATE revalide profiles_id_fkey et
      -- lève 23503 : c'est ce qui bloquait la purge des clubs orphelins.
      IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_owner_id) THEN
        UPDATE public.profiles SET mfa_enabled = false, mfa_enforced = false WHERE id = v_owner_id;
      END IF;

      DELETE FROM public.mfa_pending WHERE user_id = v_owner_id;
      DELETE FROM public.mfa_recovery_codes WHERE user_id = v_owner_id;
      DELETE FROM public.mfa_disable_requests WHERE user_id = v_owner_id;
    END IF;
  END IF;

  DELETE FROM public.owner_invitations WHERE venue_id = _venue_id;
END;
$function$;
