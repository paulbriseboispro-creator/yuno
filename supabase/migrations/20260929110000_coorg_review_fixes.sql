-- ════════════════════════════════════════════════════════════════════════════
-- Co-organisation — corrections de la revue adverse du 29/09
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. CRM : un co-hôte ne reçoit un client QUE par le consentement nommé.
--    `contact_scope_customers` (base vivante, segments, export), l'ancienne
--    RFM, les segments orga, les audiences pub et le comptage d'audience ne
--    lisent plus les soirées co-hébergées ; les lignes de vente (billets,
--    tables, invités) ne sont plus lisibles que d'un co-hôte ÉDITEUR (qui gère
--    la soirée), jamais d'un lecteur.
-- 2. Consentement : la preuve d'achat devient obligatoire (session Stripe,
--    id ou QR de la vente, < 15 min) et une session Stripe encore impayée
--    laisse une INTENTION consommée au paiement (trigger). Sans preuve, rien.
-- 3. Argent : un co-hôte ne voit le CA d'une soirée que s'il a une part dans
--    un accord actif ; P&L, vue d'ensemble, revenus d'audience et analyses VIP
--    ne comptent plus que ses propres soirées.
-- 4. Garde co-hôte : event_mode, published_at et un rejet de découverte ne
--    sont plus modifiables par un co-hôte.
-- 5. Accord : figé une fois la soirée commencée (ni annulation, ni retrait
--    d'une partie qui a une part, ni nouvelles parts) ; inviter ne remet plus
--    les signatures à zéro ; signer exige la version lue ; valider le décompte
--    exige les chiffres lus (empreinte) et efface les validations faites sur
--    d'autres chiffres ; refusé sur un collab à barème (l'argent y part par le
--    décompte de fin de soirée, le compter deux fois paierait deux fois).
-- 6. Décompte : seules les tables payées EN LIGNE comptent, pour l'acompte
--    réellement encaissé ; le solde réglé sur place se déclare. Frais de
--    gestion : total_price ne les contient pas, ils ne se déduisent que
--    lorsque le club les absorbe (même correction dans le CA du barème).
-- 7. Divers : partie choisie par niveau de droits, éditeur club = gestion,
--    sondage de droits d'un tiers impossible, garde démo à l'invitation et au
--    marketing, accès assisté refusé pour annuler un accord ou retirer une
--    ligne, invitation acceptée après la soirée refusée, « suivre tous les
--    hôtes » ne suit que les hôtes publics.

-- ─── Helpers ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.coorg_sees_event_money(p_event_id uuid, p_party text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.event_parties(p_event_id) p
                  WHERE p.party_key = p_party AND p.role IN ('lead', 'partner'))
      OR EXISTS (SELECT 1 FROM public.event_coorg_deals d
                  WHERE d.event_id = p_event_id AND d.status = 'active'
                    AND COALESCE((d.shares ->> p_party)::numeric, 0) > 0);
$$;
REVOKE ALL ON FUNCTION public.coorg_sees_event_money(uuid, text) FROM PUBLIC, anon;

-- Accord figé : actif et soirée commencée.
CREATE OR REPLACE FUNCTION public.coorg_deal_frozen(p_event_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.event_coorg_deals d JOIN public.events e ON e.id = d.event_id
                  WHERE d.event_id = p_event_id AND d.status = 'active' AND e.start_at <= now());
$$;
REVOKE ALL ON FUNCTION public.coorg_deal_frozen(uuid) FROM PUBLIC, anon;

-- ─── 1. Lignes de vente : éditeurs seulement ─────────────────────────────────

DROP POLICY IF EXISTS "Cohosts view co-organized tickets" ON public.tickets;
CREATE POLICY "Cohosts view co-organized tickets" ON public.tickets
  FOR SELECT TO authenticated
  USING (event_id IN (SELECT public.my_cohost_event_ids('editor')));

DROP POLICY IF EXISTS "Cohosts view co-organized reservations" ON public.table_reservations;
CREATE POLICY "Cohosts view co-organized reservations" ON public.table_reservations
  FOR SELECT TO authenticated
  USING (event_id IN (SELECT public.my_cohost_event_ids('editor')));

DROP POLICY IF EXISTS "Cohosts view co-organized guest entries" ON public.guest_list_entries;
CREATE POLICY "Cohosts view co-organized guest entries" ON public.guest_list_entries
  FOR SELECT TO authenticated
  USING (guest_list_id IN (
    SELECT gl.id FROM public.guest_lists gl
     WHERE gl.event_id IN (SELECT public.my_cohost_event_ids('editor'))));

-- ─── 7. Droits : éditeur club = niveau gestion ; pas de sondage d'un tiers ──

CREATE OR REPLACE FUNCTION public.my_cohost_event_ids(p_min text DEFAULT 'viewer'::text)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.event_id
    FROM public.event_cohosts c
   WHERE c.status = 'accepted'
     AND (p_min = 'viewer' OR c.access = 'editor')
     AND auth.uid() IS NOT NULL
     AND (
       (c.organizer_user_id IS NOT NULL
        AND (c.organizer_user_id = auth.uid()
             OR public.is_org_team_member(auth.uid(), c.organizer_user_id, 'editor')))
       OR (c.venue_id IS NOT NULL
           AND CASE WHEN p_min = 'viewer' THEN public.can_manage_venue(auth.uid(), c.venue_id)
                    ELSE public.coorg_party_level(auth.uid(), 'venue:' || c.venue_id) >= 2 END)
     );
$$;

CREATE OR REPLACE FUNCTION public.is_event_cohost(p_event_id uuid, p_uid uuid, p_min text DEFAULT 'viewer'::text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.event_cohosts c
     WHERE c.event_id = p_event_id AND c.status = 'accepted'
       AND (p_min = 'viewer' OR c.access = 'editor')
       AND p_uid IS NOT NULL
       -- Depuis l'API, on ne se renseigne que sur soi-même.
       AND (session_user <> 'authenticator' OR p_uid = auth.uid())
       AND (
         (c.organizer_user_id IS NOT NULL
          AND (c.organizer_user_id = p_uid OR public.is_org_team_member(p_uid, c.organizer_user_id, 'editor')))
         OR (c.venue_id IS NOT NULL
             AND CASE WHEN p_min = 'viewer' THEN public.can_manage_venue(p_uid, c.venue_id)
                      ELSE public.coorg_party_level(p_uid, 'venue:' || c.venue_id) >= 2 END)
       )
  );
$$;

CREATE OR REPLACE FUNCTION public.coorg_party_level(p_uid uuid, p_party text)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_kind text := split_part(p_party, ':', 1);
  v_id   text := substr(p_party, length(split_part(p_party, ':', 1)) + 2);
  v_org  uuid;
BEGIN
  IF p_uid IS NULL OR p_party IS NULL OR v_id = '' THEN RETURN 0; END IF;
  -- Depuis l'API, on ne se renseigne que sur soi-même.
  IF session_user = 'authenticator' AND p_uid IS DISTINCT FROM auth.uid() THEN RETURN 0; END IF;
  IF v_kind = 'org' THEN
    BEGIN v_org := v_id::uuid; EXCEPTION WHEN others THEN RETURN 0; END;
    IF p_uid = v_org OR public.is_org_team_member(p_uid, v_org, 'admin') THEN RETURN 3; END IF;
    IF public.is_org_team_member(p_uid, v_org, 'editor') THEN RETURN 1; END IF;
    RETURN 0;
  ELSIF v_kind = 'venue' THEN
    IF EXISTS (SELECT 1 FROM public.venues v WHERE v.id = v_id AND v.owner_id = p_uid) THEN RETURN 3; END IF;
    IF EXISTS (SELECT 1 FROM public.manager_permissions mp
                WHERE mp.user_id = p_uid AND mp.venue_id = v_id AND COALESCE(mp.can_view_finance, false)) THEN
      RETURN 3;
    END IF;
    IF EXISTS (SELECT 1 FROM public.manager_permissions mp
                WHERE mp.user_id = p_uid AND mp.venue_id = v_id AND COALESCE(mp.can_manage_events, false)) THEN
      RETURN 2;
    END IF;
    IF public.can_manage_venue(p_uid, v_id) THEN RETURN 1; END IF;
    RETURN 0;
  END IF;
  RETURN 0;
END;
$$;

-- Qui a plusieurs casquettes agit avec la plus forte.
CREATE OR REPLACE FUNCTION public.my_event_party(p_event_id uuid)
RETURNS TABLE(party_key text, role text, access text, level integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.party_key, p.role, p.access, public.coorg_party_level(auth.uid(), p.party_key)
    FROM public.event_parties(p_event_id) p
   WHERE public.coorg_party_level(auth.uid(), p.party_key) > 0
   ORDER BY public.coorg_party_level(auth.uid(), p.party_key) DESC, p.ord
   LIMIT 1;
$$;

-- ─── 4. Garde co-hôte ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.protect_event_columns_from_cohost()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed text[] := ARRAY[
    -- design
    'title', 'description', 'poster_url', 'image_url', 'poster_position', 'banner_position',
    'music_genre', 'music_genres', 'video_url', 'location_logo_url', 'event_type',
    -- ventes au quotidien
    'tickets_sold_out', 'tables_sold_out', 'guest_list_sold_out', 'sold_out_pack_ids',
    'entry_target', 'max_tickets_per_person', 'rounds_visibility', 'waitlist_enabled',
    'presale_start_at', 'public_sale_start_at',
    -- recalculés par d'autres triggers (contrôlés plus bas quand il le faut)
    'updated_at', 'slug', 'search_title', 'is_discoverable', 'discovery_status', 'published_at',
    'alcohol_free'
  ];
BEGIN
  IF current_user <> 'authenticated' OR v_uid IS NULL THEN RETURN NEW; END IF;
  IF public.is_super_admin() THEN RETURN NEW; END IF;
  IF (OLD.organizer_user_id IS NOT NULL
        AND (OLD.organizer_user_id = v_uid OR public.is_org_team_member(v_uid, OLD.organizer_user_id, 'editor')))
     OR (OLD.partner_organizer_id IS NOT NULL
        AND (OLD.partner_organizer_id = v_uid OR public.is_org_team_member(v_uid, OLD.partner_organizer_id, 'editor')))
     OR (OLD.venue_id IS NOT NULL AND public.can_manage_venue(v_uid, OLD.venue_id))
     OR (OLD.partner_venue_id IS NOT NULL AND public.can_manage_venue(v_uid, OLD.partner_venue_id))
     OR OLD.tables_owner_user_id = v_uid
  THEN
    RETURN NEW;
  END IF;
  IF NOT public.is_event_cohost(OLD.id, v_uid, 'editor') THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - v_allowed) IS DISTINCT FROM (to_jsonb(OLD) - v_allowed)
     -- event_mode : 'co_event' sur une soirée solo couperait toutes les ventes.
     -- published_at : rejouerait les annonces « nouvelle soirée ».
     OR (OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at)
     -- Un rejet de découverte est une décision de Yuno, jamais d'un co-hôte.
     OR (NEW.discovery_status = 'rejected' AND OLD.discovery_status IS DISTINCT FROM 'rejected')
  THEN
    RAISE EXCEPTION 'cohost_structural_change'
      USING HINT = 'Un co-hôte peut habiller la soirée et gérer ses ventes, pas en changer la structure.';
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 5. Invitations et accord ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.invite_event_cohost(p_event_id uuid, p_organizer_user_id uuid DEFAULT NULL::uuid, p_venue_id text DEFAULT NULL::text, p_access text DEFAULT 'editor'::text, p_share_crm boolean DEFAULT true, p_message text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_me    record;
  v_ev    record;
  v_party text;
  v_id    uuid;
  v_count integer;
  v_title text;
  v_ev_demo boolean;
  v_inv_demo boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF (p_organizer_user_id IS NULL) = (p_venue_id IS NULL) THEN RAISE EXCEPTION 'one_party_required'; END IF;
  IF p_access NOT IN ('editor', 'viewer') THEN RAISE EXCEPTION 'invalid_access'; END IF;

  SELECT * INTO v_ev FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF v_ev.cancelled_at IS NOT NULL OR v_ev.end_at < now() THEN RAISE EXCEPTION 'event_closed'; END IF;

  SELECT * INTO v_me FROM public.my_event_party(p_event_id);
  IF v_me.party_key IS NULL OR v_me.role NOT IN ('lead', 'partner') OR v_me.level < 2 THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_party := CASE WHEN p_venue_id IS NOT NULL THEN 'venue:' || p_venue_id ELSE 'org:' || p_organizer_user_id END;
  IF EXISTS (SELECT 1 FROM public.event_parties(p_event_id) p WHERE p.party_key = v_party) THEN
    RAISE EXCEPTION 'already_party';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_cohosts c WHERE c.event_id = p_event_id AND c.status = 'pending'
              AND (c.organizer_user_id = p_organizer_user_id OR c.venue_id = p_venue_id)) THEN
    RAISE EXCEPTION 'already_invited';
  END IF;

  IF p_organizer_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.organizer_profiles op WHERE op.user_id = p_organizer_user_id) THEN
      RAISE EXCEPTION 'organizer_not_found';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.decommissioned_at IS NULL) THEN
      RAISE EXCEPTION 'venue_not_found';
    END IF;
  END IF;

  -- La démo ne s'invite qu'entre comptes démo : une soirée démo annoncée par
  -- les recettes d'un vrai compte partirait chez de vrais clients.
  v_ev_demo := p_event_id = ANY (public.demo_event_ids());
  v_inv_demo := CASE WHEN p_venue_id IS NOT NULL THEN p_venue_id = ANY (public.demo_venue_ids())
                     ELSE COALESCE((SELECT public.is_demo_email(u.email) FROM auth.users u WHERE u.id = p_organizer_user_id), false) END;
  IF v_ev_demo IS DISTINCT FROM v_inv_demo THEN RAISE EXCEPTION 'demo_mismatch'; END IF;

  SELECT count(*) INTO v_count FROM public.event_cohosts c
   WHERE c.event_id = p_event_id AND c.status IN ('pending', 'accepted');
  IF v_count >= 8 THEN RAISE EXCEPTION 'too_many_cohosts'; END IF;

  INSERT INTO public.event_cohosts (event_id, organizer_user_id, venue_id, access, share_crm, message,
                                    invited_by, invited_by_party)
  VALUES (p_event_id, p_organizer_user_id, p_venue_id, p_access, COALESCE(p_share_crm, true),
          NULLIF(btrim(COALESCE(p_message, '')), ''), v_uid, v_me.party_key)
  RETURNING id INTO v_id;

  -- L'accord en cours NE bouge PAS : la nouvelle partie y entre à 0 % (hors
  -- décompte) tant que les parts ne sont pas reproposées et re-signées.

  v_title := COALESCE(v_ev.title, 'Soirée');
  PERFORM public.notify_coorg_party(v_party, p_event_id, 'cohost_invited',
    'Invitation à co-organiser',
    COALESCE((SELECT display_name FROM public.event_parties(p_event_id) WHERE party_key = v_me.party_key), 'Un partenaire')
      || ' t''invite à co-organiser « ' || v_title || ' ».',
    v_id, 'cohost_invited:' || v_id::text);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_event_cohost_invitation(p_cohost_id uuid, p_accept boolean)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  c     record;
  v_key text;
  v_title text;
  v_name text;
BEGIN
  SELECT * INTO c FROM public.event_cohosts WHERE id = p_cohost_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  v_key := CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id ELSE 'org:' || c.organizer_user_id END;
  IF public.coorg_party_level(v_uid, v_key) < 2 THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  IF c.status <> 'pending' THEN RAISE EXCEPTION 'not_pending'; END IF;
  IF p_accept AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = c.event_id
                           AND (e.end_at < now() OR e.cancelled_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'event_closed';
  END IF;

  UPDATE public.event_cohosts
     SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
         responded_at = now(), responded_by = v_uid, updated_at = now()
   WHERE id = p_cohost_id;

  SELECT title INTO v_title FROM public.events WHERE id = c.event_id;
  SELECT COALESCE(v.name, op.display_name, 'Un partenaire') INTO v_name
    FROM (SELECT 1) one
    LEFT JOIN public.venues v ON v.id = c.venue_id
    LEFT JOIN public.organizer_profiles op ON op.user_id = c.organizer_user_id;

  IF c.invited_by_party IS NOT NULL THEN
    PERFORM public.notify_coorg_party(c.invited_by_party, c.event_id,
      CASE WHEN p_accept THEN 'cohost_accepted' ELSE 'cohost_declined' END,
      CASE WHEN p_accept THEN 'Co-organisation acceptée' ELSE 'Co-organisation déclinée' END,
      v_name || CASE WHEN p_accept THEN ' co-organise désormais « ' ELSE ' a décliné « ' END
        || COALESCE(v_title, 'la soirée') || ' ».',
      p_cohost_id, 'cohost_resp:' || p_cohost_id::text);
  END IF;
  RETURN CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_event_cohost(p_cohost_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  c record; v_me record; v_key text; v_status text;
BEGIN
  SELECT * INTO c FROM public.event_cohosts WHERE id = p_cohost_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF c.status NOT IN ('pending', 'accepted') THEN RAISE EXCEPTION 'not_live'; END IF;
  v_key := CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id ELSE 'org:' || c.organizer_user_id END;

  IF public.coorg_party_level(v_uid, v_key) >= 2 THEN
    v_status := CASE WHEN c.status = 'pending' THEN 'declined' ELSE 'left' END;
  ELSE
    SELECT * INTO v_me FROM public.my_event_party(c.event_id);
    IF v_me.party_key IS NULL OR v_me.role NOT IN ('lead', 'partner') OR v_me.level < 2 THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
    v_status := 'removed';
  END IF;

  IF EXISTS (SELECT 1 FROM public.event_coorg_settlements s
              WHERE s.event_id = c.event_id AND s.status <> 'open'
                AND s.snapshot -> 'party_set' ? v_key) THEN
    RAISE EXCEPTION 'settlement_locked';
  END IF;
  -- Une partie qui a une part dans un accord actif ne sort plus seule une fois
  -- la soirée commencée : ni pour se soustraire à ce qu'elle doit, ni pour en
  -- priver un créancier.
  IF c.status = 'accepted' AND public.coorg_deal_frozen(c.event_id)
     AND EXISTS (SELECT 1 FROM public.event_coorg_deals d WHERE d.event_id = c.event_id
                  AND COALESCE((d.shares ->> v_key)::numeric, 0) > 0) THEN
    RAISE EXCEPTION 'deal_locked';
  END IF;

  UPDATE public.event_cohosts SET status = v_status, ended_at = now(), updated_at = now() WHERE id = p_cohost_id;

  UPDATE public.event_coorg_deals
     SET shares = shares - v_key, status = 'pending', signatures = '{}'::jsonb,
         version = version + 1, activated_at = NULL, updated_at = now()
   WHERE event_id = c.event_id AND shares ? v_key;

  IF v_status = 'removed' THEN
    PERFORM public.notify_coorg_party(v_key, c.event_id, 'cohost_removed', 'Co-organisation terminée',
      'Tu ne co-organises plus « ' || COALESCE((SELECT title FROM public.events WHERE id = c.event_id), 'la soirée') || ' ».',
      p_cohost_id, 'cohost_removed:' || p_cohost_id::text);
  END IF;
  RETURN v_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_coorg_deal(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_me record;
BEGIN
  SELECT * INTO v_me FROM public.my_event_party(p_event_id);
  IF v_me.party_key IS NULL OR v_me.role NOT IN ('lead', 'partner') OR v_me.level < 3 THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  IF EXISTS (SELECT 1 FROM public.event_coorg_settlements s WHERE s.event_id = p_event_id AND s.status <> 'open') THEN
    RAISE EXCEPTION 'settlement_locked';
  END IF;
  IF public.coorg_deal_frozen(p_event_id) THEN RAISE EXCEPTION 'deal_locked'; END IF;
  UPDATE public.event_coorg_deals SET status = 'cancelled', updated_at = now() WHERE event_id = p_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_coorg_ledger_line(p_line_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE l record;
BEGIN
  SELECT * INTO l FROM public.event_coorg_ledger WHERE id = p_line_id AND voided_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF public.coorg_party_level(auth.uid(), l.party_key) < 3 THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  IF EXISTS (SELECT 1 FROM public.event_coorg_settlements s WHERE s.event_id = l.event_id AND s.status <> 'open') THEN
    RAISE EXCEPTION 'settlement_locked';
  END IF;
  UPDATE public.event_coorg_ledger SET voided_at = now(), voided_by = auth.uid() WHERE id = p_line_id;
  PERFORM public._coorg_touch_settlement(l.event_id);
END;
$$;

DROP FUNCTION IF EXISTS public.sign_coorg_deal(uuid, text, text, text);
CREATE OR REPLACE FUNCTION public.sign_coorg_deal(p_event_id uuid, p_party text, p_ip text DEFAULT NULL::text,
                                                  p_ua text DEFAULT NULL::text, p_version integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  d record; v_all boolean;
BEGIN
  IF public.coorg_party_level(auth.uid(), p_party) < 3 THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  SELECT * INTO d FROM public.event_coorg_deals WHERE event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_deal'; END IF;
  IF d.status = 'cancelled' THEN RAISE EXCEPTION 'deal_cancelled'; END IF;
  IF NOT (d.shares ? p_party) THEN RAISE EXCEPTION 'not_in_deal'; END IF;
  -- On signe ce qu'on a LU : une nouvelle proposition entre-temps change la version.
  IF p_version IS NOT NULL AND p_version IS DISTINCT FROM d.version THEN RAISE EXCEPTION 'stale_version'; END IF;

  UPDATE public.event_coorg_deals
     SET signatures = signatures || jsonb_build_object(p_party, jsonb_build_object(
           'at', now(), 'by', auth.uid(), 'ip', p_ip, 'ua', left(COALESCE(p_ua, ''), 400), 'version', d.version)),
         updated_at = now()
   WHERE event_id = p_event_id;

  SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_object_keys(dd.shares) k WHERE NOT (dd.signatures ? k)
  ) INTO v_all FROM public.event_coorg_deals dd WHERE dd.event_id = p_event_id;

  IF v_all AND d.status <> 'active' THEN
    UPDATE public.event_coorg_deals SET status = 'active', activated_at = now() WHERE event_id = p_event_id;
    PERFORM public.notify_coorg_party(k, p_event_id, 'coorg_deal_active',
        'Accord de co-organisation actif',
        'Toutes les parties ont validé les parts de « ' || COALESCE((SELECT title FROM public.events WHERE id = p_event_id), 'la soirée') || ' ».',
        NULL, 'coorg_deal_active:' || p_event_id::text || ':' || d.version::text)
      FROM jsonb_object_keys(d.shares) AS k;
  END IF;
  RETURN (SELECT to_jsonb(x) FROM public.event_coorg_deals x WHERE x.event_id = p_event_id);
END;
$$;
-- ─── 5 bis. Accord : verrou et barème ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.save_coorg_deal(p_event_id uuid, p_shares jsonb, p_formal boolean DEFAULT false, p_clauses text DEFAULT NULL::text, p_payment_terms_days integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me record; v_total numeric := 0; k text; v_pct numeric; v_n integer := 0;
  v_terms integer := COALESCE(p_payment_terms_days, 15);
BEGIN
  SELECT * INTO v_me FROM public.my_event_party(p_event_id);
  IF v_me.party_key IS NULL OR v_me.role NOT IN ('lead', 'partner') OR v_me.level < 3 THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  IF v_terms NOT IN (7, 15, 30) THEN RAISE EXCEPTION 'invalid_terms'; END IF;
  -- Soirée commencée : l'accord signé tient, les parts ne se rouvrent plus.
  IF public.coorg_deal_frozen(p_event_id) THEN RAISE EXCEPTION 'deal_locked'; END IF;
  -- Collab à barème : l'argent part déjà par le décompte de fin de soirée,
  -- le recompter ici paierait deux fois.
  IF public.is_tiered_collab((SELECT e.revenue_split_rules FROM public.events e WHERE e.id = p_event_id)) THEN
    RAISE EXCEPTION 'tiered_collab_unsupported';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_coorg_settlements s WHERE s.event_id = p_event_id AND s.status <> 'open') THEN
    RAISE EXCEPTION 'settlement_locked';
  END IF;
  IF jsonb_typeof(p_shares) <> 'object' THEN RAISE EXCEPTION 'invalid_shares'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_shares) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.event_parties(p_event_id) p WHERE p.party_key = k) THEN
      RAISE EXCEPTION 'unknown_party %', k;
    END IF;
    v_pct := (p_shares ->> k)::numeric;
    IF v_pct < 0 OR v_pct > 100 THEN RAISE EXCEPTION 'invalid_pct'; END IF;
    v_total := v_total + v_pct;
    v_n := v_n + 1;
  END LOOP;
  IF v_n < 2 THEN RAISE EXCEPTION 'at_least_two_parties'; END IF;
  IF abs(v_total - 100) > 0.001 THEN RAISE EXCEPTION 'shares_must_total_100'; END IF;

  INSERT INTO public.event_coorg_deals (event_id, shares, formal, clauses, payment_terms_days, created_by, status, signatures)
  VALUES (p_event_id, p_shares, COALESCE(p_formal, false), NULLIF(btrim(COALESCE(p_clauses, '')), ''), v_terms,
          auth.uid(), 'pending', '{}'::jsonb)
  ON CONFLICT (event_id) DO UPDATE
     SET shares = EXCLUDED.shares, formal = EXCLUDED.formal, clauses = EXCLUDED.clauses,
         payment_terms_days = EXCLUDED.payment_terms_days,
         status = 'pending', signatures = '{}'::jsonb, activated_at = NULL,
         version = public.event_coorg_deals.version + 1, updated_at = now();

  PERFORM public.sign_coorg_deal(p_event_id, v_me.party_key, NULL, NULL);

  UPDATE public.event_coorg_settlements SET approvals = '{}'::jsonb, version = version + 1, updated_at = now()
   WHERE event_id = p_event_id AND status = 'open';

  PERFORM public.notify_coorg_party(k2, p_event_id, 'coorg_deal_to_sign',
      CASE WHEN p_formal THEN 'Contrat de co-organisation à signer' ELSE 'Accord de co-organisation à valider' END,
      'Les parts de « ' || COALESCE((SELECT title FROM public.events WHERE id = p_event_id), 'la soirée') || ' » attendent ton accord.',
      NULL, NULL)
    FROM jsonb_object_keys(p_shares) AS k2 WHERE k2 <> v_me.party_key;

  RETURN (SELECT to_jsonb(d) FROM public.event_coorg_deals d WHERE d.event_id = p_event_id);
END;
$function$;

-- ─── 5 ter. Décompte : on valide les chiffres lus ─────────────────────────

DROP FUNCTION IF EXISTS public.approve_coorg_settlement(uuid, text, integer);
CREATE OR REPLACE FUNCTION public.approve_coorg_settlement(p_event_id uuid, p_party text, p_version integer, p_fingerprint text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ev record; d record; s record; v_fig jsonb; v_all boolean; t jsonb; v_iban text; v_id uuid;
  v_due timestamptz;
  v_now jsonb; v_fp text;
BEGIN
  IF public.coorg_party_level(auth.uid(), p_party) < 3 THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  SELECT * INTO v_ev FROM public.events WHERE id = p_event_id;
  IF v_ev.end_at > now() THEN RAISE EXCEPTION 'event_not_over'; END IF;
  SELECT * INTO d FROM public.event_coorg_deals WHERE event_id = p_event_id;
  IF NOT FOUND OR d.status <> 'active' THEN RAISE EXCEPTION 'deal_not_active'; END IF;
  IF NOT (d.shares ? p_party) THEN RAISE EXCEPTION 'not_in_deal'; END IF;

  INSERT INTO public.event_coorg_settlements (event_id) VALUES (p_event_id) ON CONFLICT (event_id) DO NOTHING;
  SELECT * INTO s FROM public.event_coorg_settlements WHERE event_id = p_event_id FOR UPDATE;
  IF s.status <> 'open' THEN RAISE EXCEPTION 'already_approved'; END IF;
  IF p_version IS DISTINCT FROM s.version THEN RAISE EXCEPTION 'stale_version'; END IF;

  -- On valide les CHIFFRES qu'on a lus : les ventes Yuno se lisent en direct
  -- (remboursement, vente tardive…), l'empreinte les fige. Une validation
  -- donnée sur d'autres chiffres tombe et sa partie est relancée.
  v_now := public._coorg_compute(p_event_id);
  v_fp := md5(v_now::text);
  IF p_fingerprint IS NOT NULL AND p_fingerprint <> v_fp THEN RAISE EXCEPTION 'figures_changed'; END IF;

  UPDATE public.event_coorg_settlements
     SET approvals = COALESCE((SELECT jsonb_object_agg(a.key, a.value) FROM jsonb_each(approvals) a
                                WHERE a.value ->> 'fp' = v_fp), '{}'::jsonb)
                     || jsonb_build_object(p_party, jsonb_build_object('at', now(), 'by', auth.uid(),
                                                                       'version', s.version, 'fp', v_fp)),
         updated_at = now()
   WHERE event_id = p_event_id;

  SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_object_keys(d.shares) k
     WHERE NOT (ss.approvals ? k) OR (ss.approvals -> k ->> 'version')::integer <> ss.version
  ) INTO v_all FROM public.event_coorg_settlements ss WHERE ss.event_id = p_event_id;

  IF NOT v_all THEN
    PERFORM public.notify_coorg_party(k, p_event_id, 'coorg_settlement_to_approve',
        'Décompte de co-organisation à valider',
        'Une partie a validé le décompte de « ' || COALESCE(v_ev.title, 'la soirée') || ' ». À toi.',
        NULL, 'coorg_settle:' || p_event_id::text || ':' || s.version::text || ':' || k)
      FROM jsonb_object_keys(d.shares) AS k
     WHERE NOT ((SELECT approvals FROM public.event_coorg_settlements WHERE event_id = p_event_id) ? k);
    RETURN jsonb_build_object('status', 'open', 'waiting', true);
  END IF;

  v_fig := v_now;
  UPDATE public.event_coorg_settlements
     SET status = CASE WHEN jsonb_array_length(v_fig -> 'transfers') = 0 THEN 'settled' ELSE 'approved' END,
         snapshot = v_fig || jsonb_build_object('party_set',
                      (SELECT jsonb_object_agg(k, true) FROM jsonb_object_keys(d.shares) k)),
         approved_at = now(),
         settled_at = CASE WHEN jsonb_array_length(v_fig -> 'transfers') = 0 THEN now() END,
         updated_at = now()
   WHERE event_id = p_event_id;

  v_due := now() + make_interval(days => COALESCE(d.payment_terms_days, 15));
  FOR t IN SELECT * FROM jsonb_array_elements(v_fig -> 'transfers') LOOP
    v_iban := NULL;
    IF split_part(t->>'to', ':', 1) = 'org' THEN
      SELECT opd.iban INTO v_iban FROM public.organizer_payout_details opd
       WHERE opd.user_id = substr(t->>'to', 5)::uuid;
    END IF;
    IF v_iban IS NULL THEN
      SELECT x.payee_iban INTO v_iban FROM public.event_coorg_transfers x
       WHERE x.to_party = t->>'to' AND x.payee_iban IS NOT NULL
       ORDER BY x.updated_at DESC LIMIT 1;
    END IF;
    v_id := gen_random_uuid();
    INSERT INTO public.event_coorg_transfers (id, event_id, from_party, to_party, amount, reference, payee_iban, due_at)
    VALUES (v_id, p_event_id, t->>'from', t->>'to', (t->>'amount')::numeric,
            'YCO-' || upper(substr(replace(v_id::text, '-', ''), 1, 8)), v_iban, v_due);
    PERFORM public.notify_coorg_party(t->>'from', p_event_id, 'coorg_transfer_due', 'Virement de co-organisation à faire',
      'Décompte validé : ' || public._coorg_eur((t->>'amount')::numeric) || ' à virer avant le '
        || to_char(v_due AT TIME ZONE 'Europe/Paris', 'DD/MM') || ' (référence YCO-'
        || upper(substr(replace(v_id::text, '-', ''), 1, 8)) || ').',
      v_id, 'coorg_transfer_due:' || v_id::text);
    IF v_iban IS NULL THEN
      PERFORM public.notify_coorg_party(t->>'to', p_event_id, 'coorg_iban_needed', 'IBAN à renseigner',
        'Un virement de ' || public._coorg_eur((t->>'amount')::numeric) || ' t''attend : donne ton IBAN pour qu''il parte.',
        v_id, 'coorg_iban_needed:' || v_id::text || ':0');
    END IF;
  END LOOP;
  RETURN jsonb_build_object('status', 'approved');
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_coorg(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_me    record;
  v_ev    record;
  v_money boolean;
  v_mine  text[];
  v_set   record;
  v_fig   jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated'); END IF;
  SELECT * INTO v_ev FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  SELECT * INTO v_me FROM public.my_event_party(p_event_id);

  -- Une invitation en attente se lit aussi (pour décider).
  IF v_me.party_key IS NULL AND NOT public.is_super_admin() THEN
    IF NOT EXISTS (SELECT 1 FROM public.event_cohosts c
                    WHERE c.event_id = p_event_id AND c.status = 'pending'
                      AND public.coorg_party_level(v_uid,
                            CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id ELSE 'org:' || c.organizer_user_id END) >= 1) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
    END IF;
  END IF;

  SELECT array_agg(p.party_key) INTO v_mine FROM public.event_parties(p_event_id) p
   WHERE public.coorg_party_level(v_uid, p.party_key) >= 3;
  v_money := public.is_super_admin() OR COALESCE(array_length(v_mine, 1), 0) > 0;

  SELECT * INTO v_set FROM public.event_coorg_settlements WHERE event_id = p_event_id;
  IF v_money THEN
    v_fig := CASE WHEN v_set.status IN ('approved', 'settled') THEN v_set.snapshot ELSE public._coorg_compute(p_event_id) END;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'event', jsonb_build_object('id', v_ev.id, 'title', v_ev.title, 'start_at', v_ev.start_at, 'end_at', v_ev.end_at,
                                'ended', v_ev.end_at < now(), 'has_stripe_collab',
                                EXISTS (SELECT 1 FROM public.event_collab_contracts cc
                                         WHERE cc.event_id = p_event_id AND cc.status IN ('active', 'locked', 'closed'))),
    'me', CASE WHEN v_me.party_key IS NULL THEN NULL
               ELSE jsonb_build_object('party', v_me.party_key, 'role', v_me.role, 'access', v_me.access, 'level', v_me.level) END,
    'my_parties', COALESCE(to_jsonb(v_mine), '[]'::jsonb),
    'can_invite', COALESCE(v_me.role IN ('lead', 'partner') AND v_me.level >= 2, false)
                  AND v_ev.end_at > now() AND v_ev.cancelled_at IS NULL,
    'can_deal', COALESCE(v_me.role IN ('lead', 'partner') AND v_me.level >= 3, false),
    'parties', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'key', p.party_key, 'kind', p.kind, 'role', p.role, 'access', p.access,
                  'share_crm', p.share_crm, 'cohost_id', p.cohost_id, 'name', p.display_name,
                  'slug', p.slug, 'avatar_url', p.avatar_url, 'city', p.city) ORDER BY p.ord), '[]'::jsonb)
                  FROM public.event_parties(p_event_id) p),
    'invitations', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                      'id', c.id, 'status', c.status, 'access', c.access, 'share_crm', c.share_crm,
                      'invited_at', c.invited_at, 'message', c.message,
                      'party', CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id ELSE 'org:' || c.organizer_user_id END,
                      'name', COALESCE(v.name, op.display_name),
                      'avatar_url', COALESCE(v.logo_url, op.avatar_url),
                      'mine', public.coorg_party_level(v_uid,
                                CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id ELSE 'org:' || c.organizer_user_id END) >= 1
                    ) ORDER BY c.invited_at DESC), '[]'::jsonb)
                      FROM public.event_cohosts c
                      LEFT JOIN public.venues v ON v.id = c.venue_id
                      LEFT JOIN public.organizer_profiles op ON op.user_id = c.organizer_user_id
                     WHERE c.event_id = p_event_id AND c.status IN ('pending', 'declined')),
    'deal', CASE WHEN v_money THEN (SELECT to_jsonb(d) - 'created_by' FROM public.event_coorg_deals d WHERE d.event_id = p_event_id) END,
    'ledger', CASE WHEN v_money THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'id', l.id, 'kind', l.kind, 'party', l.party_key, 'category', l.category, 'label', l.label,
                  'amount', l.amount, 'note', l.note, 'created_at', l.created_at,
                  'mine', l.party_key = ANY (COALESCE(v_mine, '{}'::text[]))) ORDER BY l.created_at), '[]'::jsonb)
                  FROM public.event_coorg_ledger l WHERE l.event_id = p_event_id AND l.voided_at IS NULL) END,
    'settlement', CASE WHEN v_money THEN jsonb_build_object(
                    'status', COALESCE(v_set.status, 'open'),
                    'version', COALESCE(v_set.version, 1),
                    'approvals', COALESCE(v_set.approvals, '{}'::jsonb),
                    'approved_at', v_set.approved_at, 'settled_at', v_set.settled_at,
                    'figures', v_fig,
                    'fingerprint', CASE WHEN COALESCE(v_set.status, 'open') = 'open' THEN md5(v_fig::text) END) END,
    'transfers', CASE WHEN v_money THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', t.id, 'from', t.from_party, 'to', t.to_party, 'amount', t.amount,
                    'reference', t.reference, 'status', t.status,
                    'payee_iban', CASE WHEN t.from_party = ANY (COALESCE(v_mine, '{}'::text[]))
                                         OR t.to_party = ANY (COALESCE(v_mine, '{}'::text[]))
                                       THEN t.payee_iban END,
                    'sent_at', t.sent_at, 'sent_reference', t.sent_reference,
                    'received_at', t.received_at, 'disputed_at', t.disputed_at, 'dispute_reason', t.dispute_reason,
                    'i_pay', t.from_party = ANY (COALESCE(v_mine, '{}'::text[])),
                    'i_receive', t.to_party = ANY (COALESCE(v_mine, '{}'::text[])),
                    'due_at', t.due_at, 'confirm_due_at', t.confirm_due_at,
                    'reminder_count', t.reminder_count, 'escalated_at', t.escalated_at,
                    'last_nudged_at', t.last_nudged_at,
                    'resolved_by_admin', t.resolved_by_admin, 'admin_note', t.admin_note
                  ) ORDER BY t.amount DESC), '[]'::jsonb)
                    FROM public.event_coorg_transfers t WHERE t.event_id = p_event_id) END
  );
END;
$function$;

-- ─── 6. Décompte : ce qui est vraiment passé par Yuno ─────────────────────

CREATE OR REPLACE FUNCTION public._coorg_yuno_legs(p_event_id uuid)
 RETURNS TABLE(party_key text, pillar text, amount numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH m AS (SELECT public.event_merchant_party(p_event_id) AS k)
  SELECT leg.party_key, 'tickets', leg.amount
      FROM public.tickets t
      CROSS JOIN m
      CROSS JOIN LATERAL (
        SELECT greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0) AS ca,
               CASE WHEN coalesce(t.total_price, 0) > 0 THEN round(t.total_price * 0.015 + 0.25, 2) ELSE 0 END AS stripe
      ) f
      CROSS JOIN LATERAL (
        SELECT f.ca - least(greatest(coalesce(t.refund_amount, 0), 0), f.ca) - f.stripe AS net
      ) n
      LEFT JOIN LATERAL (
        SELECT rd.* FROM public.revenue_distributions rd WHERE rd.ticket_id = t.id ORDER BY rd.created_at DESC LIMIT 1
      ) rd ON true
      CROSS JOIN LATERAL (
        SELECT CASE WHEN rd.id IS NULL OR coalesce(rd.primary_amount_cents, 0) + coalesce(rd.secondary_amount_cents, 0) <= 0
                    THEN m.k
                    ELSE CASE WHEN rd.primary_recipient_kind = 'venue' THEN 'venue:' || rd.primary_recipient_venue_id
                              ELSE 'org:' || rd.primary_recipient_organizer_id END END AS party_key,
               CASE WHEN rd.id IS NULL OR coalesce(rd.primary_amount_cents, 0) + coalesce(rd.secondary_amount_cents, 0) <= 0
                    THEN n.net
                    ELSE n.net * rd.primary_amount_cents::numeric
                         / (coalesce(rd.primary_amount_cents, 0) + coalesce(rd.secondary_amount_cents, 0)) END AS amount
        UNION ALL
        SELECT CASE WHEN rd.secondary_recipient_kind = 'venue' THEN 'venue:' || rd.secondary_recipient_venue_id
                    ELSE 'org:' || rd.secondary_recipient_organizer_id END,
               n.net * rd.secondary_amount_cents::numeric
                 / (coalesce(rd.primary_amount_cents, 0) + coalesce(rd.secondary_amount_cents, 0))
         WHERE rd.id IS NOT NULL AND coalesce(rd.secondary_amount_cents, 0) > 0
      ) leg
     WHERE t.event_id = p_event_id AND t.status IN ('paid', 'used')
  UNION ALL
  SELECT leg.party_key, 'tables', leg.amount
      FROM public.table_reservations t
      CROSS JOIN m
      CROSS JOIN LATERAL (
        -- Seul l'ACOMPTE passe par Yuno ; les frais de gestion sont payés EN PLUS
        -- par le client (total_price ne les contient pas), sauf s'ils sont absorbés.
        SELECT greatest(coalesce(t.deposit, 0) - coalesce(t.service_fee, 0)
                        - CASE WHEN coalesce(t.fee_absorbed, false) THEN coalesce(t.management_fee, 0) ELSE 0 END, 0) AS ca,
               CASE WHEN coalesce(t.deposit, 0) > 0
                    THEN round((t.deposit + CASE WHEN coalesce(t.fee_absorbed, false) THEN 0 ELSE coalesce(t.management_fee, 0) END) * 0.015 + 0.25, 2)
                    ELSE 0 END AS stripe
      ) f
      CROSS JOIN LATERAL (
        SELECT f.ca - least(greatest(coalesce(t.refund_amount, 0), 0), f.ca) - f.stripe AS net
      ) n
      LEFT JOIN LATERAL (
        SELECT rd.* FROM public.revenue_distributions rd WHERE rd.table_reservation_id = t.id ORDER BY rd.created_at DESC LIMIT 1
      ) rd ON true
      CROSS JOIN LATERAL (
        SELECT CASE WHEN rd.id IS NULL OR coalesce(rd.primary_amount_cents, 0) + coalesce(rd.secondary_amount_cents, 0) <= 0
                    THEN m.k
                    ELSE CASE WHEN rd.primary_recipient_kind = 'venue' THEN 'venue:' || rd.primary_recipient_venue_id
                              ELSE 'org:' || rd.primary_recipient_organizer_id END END AS party_key,
               CASE WHEN rd.id IS NULL OR coalesce(rd.primary_amount_cents, 0) + coalesce(rd.secondary_amount_cents, 0) <= 0
                    THEN n.net
                    ELSE n.net * rd.primary_amount_cents::numeric
                         / (coalesce(rd.primary_amount_cents, 0) + coalesce(rd.secondary_amount_cents, 0)) END AS amount
        UNION ALL
        SELECT CASE WHEN rd.secondary_recipient_kind = 'venue' THEN 'venue:' || rd.secondary_recipient_venue_id
                    ELSE 'org:' || rd.secondary_recipient_organizer_id END,
               n.net * rd.secondary_amount_cents::numeric
                 / (coalesce(rd.primary_amount_cents, 0) + coalesce(rd.secondary_amount_cents, 0))
         WHERE rd.id IS NOT NULL AND coalesce(rd.secondary_amount_cents, 0) > 0
      ) leg
     WHERE t.event_id = p_event_id AND t.status IN ('paid', 'confirmed')
       -- Réglé sur place ou saisi à la main : l'argent n'est pas passé par Yuno.
       AND coalesce(t.payment_mode, 'online') = 'online'
  UNION ALL
  SELECT 'venue:' || o.venue_id, 'drinks',
           greatest(o.total - coalesce(o.service_fee, 0), 0)
           - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))
           - CASE WHEN coalesce(o.total, 0) > 0 THEN round(o.total * 0.015 + 0.25, 2) ELSE 0 END
      FROM public.orders o
     WHERE o.event_id = p_event_id AND o.status IN ('paid', 'served') AND o.venue_id IS NOT NULL;
$function$;

-- CA du barème : même correction des frais de gestion (payés en plus par le
-- client, ils ne sortent du CA que lorsque le club les absorbe).
CREATE OR REPLACE FUNCTION public.collab_night_yuno_figures(p_event_id uuid)
 RETURNS TABLE(tickets numeric, tickets_count integer, tables numeric, tables_count integer, drinks numeric, drinks_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    (SELECT ROUND(COALESCE(SUM(GREATEST(
        COALESCE(t.total_price, 0) - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0)
        - LEAST(COALESCE(t.refund_amount, 0), GREATEST(COALESCE(t.total_price, 0) - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0))
      , 0)), 0), 2)
     FROM public.tickets t WHERE t.event_id = p_event_id AND t.status = 'paid'),
    (SELECT COALESCE(SUM(COALESCE(t.quantity, 1)), 0)::integer
     FROM public.tickets t WHERE t.event_id = p_event_id AND t.status = 'paid'),
    (SELECT ROUND(COALESCE(SUM(GREATEST(
        COALESCE(r.total_price, 0) - COALESCE(r.service_fee, 0) - CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END
        - LEAST(COALESCE(r.refund_amount, 0), GREATEST(COALESCE(r.total_price, 0) - COALESCE(r.service_fee, 0) - CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END, 0))
      , 0)), 0), 2)
     FROM public.table_reservations r WHERE r.event_id = p_event_id AND r.status = 'paid'),
    (SELECT COUNT(*)::integer
     FROM public.table_reservations r WHERE r.event_id = p_event_id AND r.status = 'paid'),
    (SELECT ROUND(COALESCE(SUM(GREATEST(
        COALESCE(o.total, 0) - COALESCE(o.service_fee, 0)
        - LEAST(COALESCE(o.refund_amount, 0), GREATEST(COALESCE(o.total, 0) - COALESCE(o.service_fee, 0), 0))
      , 0)), 0), 2)
     FROM public.orders o WHERE o.event_id = p_event_id AND o.status = 'paid'),
    (SELECT COUNT(*)::integer
     FROM public.orders o WHERE o.event_id = p_event_id AND o.status = 'paid');
$function$;

-- ─── 3. Argent : un co-hôte sans part ne voit pas le CA ────────────────────

CREATE OR REPLACE FUNCTION public.get_event_report(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid        uuid := auth.uid();
  v_now        timestamptz := now();
  e            record;
  v_tz         text;
  v_day_start  timestamptz;
  v_scope_venue text := null;
  v_scope_org  uuid := null;
  v_money      boolean := false;
  v_scope_ids  uuid[];
  v_result     jsonb;
  v_take       jsonb := '[]'::jsonb;
  v_tx_total   integer;
  v_expected   integer;
  v_entered    integer;
  v_heads_d0   integer;
  v_heads      integer;
  v_row        record;
  v_ref        record;
  v_ref_d      integer;
  v_ref_final  integer;
  v_ref_at     integer;
  v_pace       jsonb := null;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select ev.*, coalesce(ev.timezone, v.timezone, 'Europe/Paris') as tz, v.name as venue_name
    into e
  from public.events ev
  left join public.venues v on v.id = coalesce(ev.venue_id, ev.partner_venue_id)
  where ev.id = p_event_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- ── Portée + droit de voir l'argent ───────────────────────────────────
  if e.venue_id is not null and (public.can_manage_venue(v_uid, e.venue_id) or public.is_super_admin()) then
    v_scope_venue := e.venue_id;
  elsif e.partner_venue_id is not null and public.can_manage_venue(v_uid, e.partner_venue_id) then
    v_scope_venue := e.partner_venue_id;
  elsif e.organizer_user_id is not null and (
          v_uid = e.organizer_user_id
          or public.is_super_admin()
          or public.is_org_team_member(v_uid, e.organizer_user_id, 'editor')) then
    v_scope_org := e.organizer_user_id;
  elsif e.partner_organizer_id is not null and (
          v_uid = e.partner_organizer_id
          or public.is_org_team_member(v_uid, e.partner_organizer_id, 'editor')) then
    v_scope_org := e.partner_organizer_id;
  -- Co-hôte accepté : la soirée se lit dans SA portée (orga d'abord).
  elsif exists (select 1 from public.event_cohosts c
                 where c.event_id = p_event_id and c.status = 'accepted' and c.organizer_user_id is not null
                   and (c.organizer_user_id = v_uid or public.is_org_team_member(v_uid, c.organizer_user_id, 'editor'))) then
    select c.organizer_user_id into v_scope_org from public.event_cohosts c
     where c.event_id = p_event_id and c.status = 'accepted' and c.organizer_user_id is not null
       and (c.organizer_user_id = v_uid or public.is_org_team_member(v_uid, c.organizer_user_id, 'editor'))
     order by (c.organizer_user_id = v_uid) desc limit 1;
  elsif exists (select 1 from public.event_cohosts c
                 where c.event_id = p_event_id and c.status = 'accepted' and c.venue_id is not null
                   and public.can_manage_venue(v_uid, c.venue_id)) then
    select c.venue_id into v_scope_venue from public.event_cohosts c
     where c.event_id = p_event_id and c.status = 'accepted' and c.venue_id is not null
       and public.can_manage_venue(v_uid, c.venue_id)
     limit 1;
  else
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_scope_venue is not null then
    v_money := coalesce(v_scope_venue = e.venue_id, false) and (
      public.is_super_admin()
      or exists (select 1 from public.venues v where v.id = v_scope_venue and v.owner_id = v_uid)
      or exists (
        select 1 from public.manager_permissions mp
        where mp.user_id = v_uid and mp.venue_id = v_scope_venue
          and (coalesce(mp.can_view_analytics, false) or coalesce(mp.can_view_finance, false))
      ));
    select coalesce(array_agg(x.id), '{}') into v_scope_ids
    from public.events x
    where x.venue_id = v_scope_venue or x.partner_venue_id = v_scope_venue or x.id in (select public.cohost_event_ids_venue(v_scope_venue));
  else
    v_money := (v_uid = v_scope_org
      or public.is_super_admin()
      or public.org_member_has_permission(v_uid, v_scope_org, 'view_finance'))
      -- Un co-hôte ne voit l'argent que s'il a une part dans un accord actif.
      and (public.is_super_admin() or public.coorg_sees_event_money(p_event_id, 'org:' || v_scope_org::text));
    select coalesce(array_agg(x.id), '{}') into v_scope_ids
    from public.events x
    where x.organizer_user_id = v_scope_org or x.partner_organizer_id = v_scope_org or x.id in (select public.cohost_event_ids_org(v_scope_org));
  end if;

  v_tz := e.tz;
  v_day_start := date_trunc('day', v_now at time zone v_tz) at time zone v_tz;

  with
  -- ── Les ventes de la soirée, une ligne par transaction ────────────────
  tx as materialized (
    select 'tickets'::text as pillar, t.id, lower(t.user_email) as email, t.user_id,
           coalesce(t.paid_at, t.created_at) as at_ts,
           greatest(coalesce(t.quantity, 1), 1) as units,
           greatest(coalesce(t.quantity, 1), 1) as heads,
           greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
             - least(greatest(coalesce(t.refund_amount, 0), 0),
                     greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)) as amount,
           coalesce(nullif(t.purchase_source, ''), 'direct') as source,
           t.tracked_link_id, t.ticket_round_id as line_id
    from public.tickets t
    where t.event_id = p_event_id and t.status in ('paid', 'used')
    union all
    select 'tables', r.id, lower(r.user_email), r.user_id,
           coalesce(r.paid_at, r.created_at),
           1,
           greatest(coalesce(r.guest_count, 0), 1),
           greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0)),
           coalesce(nullif(r.purchase_source, ''), 'direct'),
           r.tracked_link_id, r.pack_id
    from public.table_reservations r
    where r.event_id = p_event_id and r.status in ('paid', 'confirmed')
    union all
    select 'drinks', o.id, lower(o.user_email), o.user_id,
           coalesce(o.paid_at, o.created_at),
           1,
           0,
           greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0)),
           coalesce(nullif(o.purchase_source, ''), 'direct'),
           o.tracked_link_id, null::uuid
    from public.orders o
    where o.event_id = p_event_id and o.status in ('paid', 'served')
      and v_scope_venue is not null and o.venue_id = v_scope_venue
  ),
  gle as materialized (
    select g.id, lower(nullif(btrim(g.email), '')) as email, g.user_id, g.created_at as at_ts,
           g.guest_list_id as line_id, g.tracked_link_id
    from public.guest_list_entries g
    join public.guest_lists gl on gl.id = g.guest_list_id
    where gl.event_id = p_event_id and g.status <> 'cancelled'
  ),
  vis as materialized (
    select s.visited_at, coalesce(nullif(s.referrer_category, ''), 'direct') as source,
           coalesce(s.completed_order, false) as done
    from public.visitor_sessions s
    where s.event_id = p_event_id
  ),

  -- ── Contacts de la soirée, et ceux déjà vus à une soirée PRÉCÉDENTE ────
  people as (
    select distinct email from (
      select email from tx where pillar in ('tickets', 'tables') and email is not null
      union all
      select email from gle where email is not null
    ) p
  ),
  prior_events as materialized (
    select x.id from public.events x
    where x.id = any(v_scope_ids) and x.id <> p_event_id and x.start_at < e.start_at
  ),
  seen_before as (
    select distinct p.email
    from people p
    where exists (select 1 from public.tickets t
                  where t.event_id in (select id from prior_events)
                    and t.status in ('paid', 'used') and lower(t.user_email) = p.email)
       or exists (select 1 from public.table_reservations r
                  where r.event_id in (select id from prior_events)
                    and r.status in ('paid', 'confirmed') and lower(r.user_email) = p.email)
       or exists (select 1 from public.guest_list_entries g
                  join public.guest_lists gl on gl.id = g.guest_list_id
                  where gl.event_id in (select id from prior_events)
                    and g.status <> 'cancelled' and lower(g.email) = p.email)
  ),

  -- ── Série jour par jour, clé d = jours calendaires avant la soirée ─────
  day_rows as (
    select (e.start_at at time zone v_tz)::date - (at_ts at time zone v_tz)::date as d,
           case when pillar = 'tickets' then units else 0 end as tickets,
           case when pillar = 'tables' then 1 else 0 end as tables,
           0 as guests, amount, 0 as visits,
           heads as people
    from tx
    union all
    select (e.start_at at time zone v_tz)::date - (at_ts at time zone v_tz)::date, 0, 0, 1, 0, 0, 1 from gle
    union all
    select (e.start_at at time zone v_tz)::date - (visited_at at time zone v_tz)::date, 0, 0, 0, 0, 1, 0 from vis
  ),
  series as (
    select d, sum(tickets) as tickets, sum(tables) as tables, sum(guests) as guests,
           sum(amount) as amount, sum(visits) as visits, sum(people) as people
    from day_rows group by d
  ),

  -- ── Messages qui parlaient de CETTE soirée ────────────────────────────
  emails as (
    select ec.id, coalesce(nullif(ec.subject, ''), ec.name) as title, ec.sent_at,
           coalesce(ec.recipients_count, ec.total_recipients, 0) as reach,
           coalesce(ec.opens_count, 0) as opens, coalesce(ec.clickers_count, ec.clicks_count, 0) as clicks,
           ec.automation_id is not null as auto
    from public.email_campaigns ec
    where (ec.event_id = p_event_id or ec.automation_trigger_event_id = p_event_id)
      and ec.status in ('sent', 'sending', 'paused')
      and ((v_scope_venue is not null and ec.venue_id = v_scope_venue)
        or (v_scope_org is not null and ec.organizer_user_id = v_scope_org))
    order by ec.sent_at desc nulls last
    limit 30
  ),
  email_clicks as (
    select ece.campaign_id, lower(ece.recipient_email) as email, min(ece.created_at) as click_at
    from public.email_campaign_events ece
    where ece.campaign_id in (select id from emails)
      and ece.event_type = 'clicked' and ece.recipient_email is not null
    group by 1, 2
  ),
  email_attr as (
    select c.campaign_id,
           count(distinct x.id) filter (where x.pillar <> 'guestlist') as orders,
           coalesce(sum(x.amount), 0) as amount,
           count(distinct x.id) filter (where x.pillar = 'guestlist') as entries
    from email_clicks c
    join (
      select pillar, id, email, at_ts, amount from tx where pillar in ('tickets', 'tables')
      union all
      select 'guestlist', id, email, at_ts, 0 from gle
    ) x on x.email = c.email and x.at_ts >= c.click_at and x.at_ts < c.click_at + interval '72 hours'
    group by c.campaign_id
  ),
  pushes as (
    select pc.id, coalesce(pc.title, pc.template_key) as title, pc.created_at as sent_at,
           coalesce(pc.sent_count, 0) as reach, pc.source = 'auto' as auto, pc.template_key
    from public.push_campaigns pc
    where pc.event_id = p_event_id
      and pc.status in ('sent', 'sending', 'completed')
      and ((v_scope_venue is not null and pc.venue_id = v_scope_venue)
        or (v_scope_org is not null and pc.venue_id is null and pc.agency_id is null))
    order by pc.created_at desc
    limit 30
  ),
  push_clicks as (
    select pce.campaign_id, pce.user_id, min(pce.created_at) as click_at
    from public.push_campaign_events pce
    where pce.campaign_id in (select id from pushes)
      and pce.event_type = 'clicked' and pce.user_id is not null
    group by 1, 2
  ),
  push_attr as (
    select c.campaign_id,
           count(*) as clicks,
           count(distinct x.id) filter (where x.pillar <> 'guestlist') as orders,
           coalesce(sum(x.amount), 0) as amount,
           count(distinct x.id) filter (where x.pillar = 'guestlist') as entries
    from push_clicks c
    left join (
      select pillar, id, user_id, at_ts, amount from tx where pillar in ('tickets', 'tables')
      union all
      select 'guestlist', id, user_id, at_ts, 0 from gle
    ) x on x.user_id = c.user_id and x.at_ts >= c.click_at and x.at_ts < c.click_at + interval '72 hours'
    group by c.campaign_id
  )

  select jsonb_build_object(
    'ok', true,
    'now', v_now,
    'tz', v_tz,
    'dayStart', v_day_start,
    'money', v_money,
    'scope', case when v_scope_venue is not null then 'venue' else 'organizer' end,
    'event', jsonb_build_object(
      'id', e.id, 'title', e.title, 'startAt', e.start_at, 'endAt', e.end_at,
      'poster', coalesce(e.poster_url, e.image_url), 'status', e.status,
      'cancelled', e.cancelled_at is not null,
      'publishedAt', e.published_at, 'createdAt', e.created_at,
      'venueName', e.venue_name,
      'entryTarget', e.entry_target,
      'phase', case when v_now >= e.end_at then 'after' when v_now >= e.start_at then 'live' else 'before' end
    ),

    -- 1. Où en sont mes ventes ?
    'totals', jsonb_build_object(
      'tickets', jsonb_build_object(
        'sold', (select coalesce(sum(units), 0) from tx where pillar = 'tickets'),
        'today', (select coalesce(sum(units), 0) from tx where pillar = 'tickets' and at_ts >= v_day_start),
        'orders', (select count(*) from tx where pillar = 'tickets'),
        'capacity', case
          when coalesce(e.max_tickets, 0) > 0 then e.max_tickets
          when exists (select 1 from public.ticket_rounds tr where tr.event_id = p_event_id)
           and not exists (select 1 from public.ticket_rounds tr where tr.event_id = p_event_id and coalesce(tr.max_tickets, 0) <= 0)
            then (select sum(tr.max_tickets) from public.ticket_rounds tr where tr.event_id = p_event_id)
          else null end,
        'enabled', coalesce(e.ticketing_enabled, false),
        'soldOut', coalesce(e.tickets_sold_out, false)
      ),
      'tables', jsonb_build_object(
        'booked', (select count(*) from tx where pillar = 'tables'),
        'today', (select count(*) from tx where pillar = 'tables' and at_ts >= v_day_start),
        'guests', (select coalesce(sum(greatest(coalesce(r.guest_count, 0), 0)), 0)
                   from public.table_reservations r where r.event_id = p_event_id and r.status in ('paid', 'confirmed')),
        'capacity', nullif((
          select coalesce(sum(p.tables_count), 0)
          from public.table_packs p
          where p.is_active
            and (p.event_id = p_event_id
                 or (p.event_id is null and coalesce(e.venue_id, e.partner_venue_id) is not null
                     and p.venue_id = coalesce(e.venue_id, e.partner_venue_id)))
            and not (p.id = any (coalesce(e.sold_out_pack_ids, '{}'::uuid[])))
        ), 0),
        'enabled', coalesce(e.tables_enabled, false),
        'soldOut', coalesce(e.tables_sold_out, false)
      ),
      'guestList', jsonb_build_object(
        'registered', (select count(*) from gle),
        'today', (select count(*) from gle where at_ts >= v_day_start),
        'capacity', (
          select case when count(*) > 0 and count(*) filter (where coalesce(gl.quota, 0) <= 0) = 0
                      then sum(gl.quota) else null end
          from public.guest_lists gl where gl.event_id = p_event_id and gl.is_active
        ),
        'enabled', exists (select 1 from public.guest_lists gl where gl.event_id = p_event_id and gl.is_active),
        'soldOut', coalesce(e.guest_list_sold_out, false)
      ),
      'drinks', case when v_scope_venue is not null then jsonb_build_object(
        'orders', (select count(*) from tx where pillar = 'drinks'),
        'today', (select count(*) from tx where pillar = 'drinks' and at_ts >= v_day_start)
      ) else null end,
      'revenue', case when v_money then jsonb_build_object(
        'total', round((select coalesce(sum(amount), 0) from tx)::numeric, 2),
        'today', round((select coalesce(sum(amount), 0) from tx where at_ts >= v_day_start)::numeric, 2),
        'tickets', round((select coalesce(sum(amount), 0) from tx where pillar = 'tickets')::numeric, 2),
        'tables', round((select coalesce(sum(amount), 0) from tx where pillar = 'tables')::numeric, 2),
        'drinks', round((select coalesce(sum(amount), 0) from tx where pillar = 'drinks')::numeric, 2)
      ) else null end,
      'visits', jsonb_build_object(
        'total', (select count(*) from vis),
        'today', (select count(*) from vis where visited_at >= v_day_start),
        'withOrder', (select count(*) from vis where done)
      ),
      -- La porte : personnes scannées (billets en quantité, convives d'une
      -- table scannée ou arrivée, inscrits guest list) et attendus. Même
      -- définition que « Entrées » dans get_sales_overview.
      'door', jsonb_build_object(
        'entered',
          (select coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0) from public.tickets t
            where t.event_id = p_event_id and t.status in ('paid', 'used')
              and (coalesce(t.entry_scanned, false) or coalesce(t.used, false) or t.status = 'used'))
        + (select coalesce(sum(greatest(coalesce(r.guest_count, 0), 1)), 0) from public.table_reservations r
            where r.event_id = p_event_id and r.status in ('paid', 'confirmed')
              and (coalesce(r.entry_scanned, false) or r.checked_in_at is not null))
        + (select count(*) from public.guest_list_entries g2 join public.guest_lists l2 on l2.id = g2.guest_list_id
            where l2.event_id = p_event_id and g2.status <> 'cancelled' and coalesce(g2.entry_scanned, false)),
        'expected',
          (select coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0) from public.tickets t
            where t.event_id = p_event_id and t.status in ('paid', 'used'))
        + (select coalesce(sum(greatest(coalesce(r.guest_count, 0), 1)), 0) from public.table_reservations r
            where r.event_id = p_event_id and r.status in ('paid', 'confirmed'))
        + (select count(*) from public.guest_list_entries g2 join public.guest_lists l2 on l2.id = g2.guest_list_id
            where l2.event_id = p_event_id and g2.status <> 'cancelled')
      )
    ),

    'lines', coalesce((
      select jsonb_agg(l.obj order by l.pillar_ord, l.ord)
      from (
        -- Paliers de billets
        select 1 as pillar_ord, coalesce(tr.position, 0) * 1000 + row_number() over (order by tr.position, tr.created_at) as ord,
               jsonb_build_object(
                 'pillar', 'tickets', 'id', tr.id, 'name', tr.name, 'price', tr.price,
                 'sold', coalesce((select sum(units) from tx where pillar = 'tickets' and line_id = tr.id), 0),
                 'capacity', nullif(tr.max_tickets, 0),
                 'status', case
                   when coalesce(e.tickets_sold_out, false) or coalesce(tr.manually_sold_out, false)
                     or (coalesce(tr.max_tickets, 0) > 0 and coalesce((select sum(units) from tx where pillar = 'tickets' and line_id = tr.id), 0) >= tr.max_tickets)
                     then 'sold_out'
                   when tr.is_active then 'on_sale'
                   when coalesce(tr.auto_activate, false) then 'upcoming'
                   else 'closed' end,
                 'amount', case when v_money then round(coalesce((select sum(amount) from tx where pillar = 'tickets' and line_id = tr.id), 0)::numeric, 2) else null end
               ) as obj
        from public.ticket_rounds tr where tr.event_id = p_event_id
        union all
        -- Formules de table (de la soirée, ou du club quand elles ne sont pas event-scopées)
        select 2, coalesce(p.position, 0) * 1000 + row_number() over (order by p.position, p.created_at),
               jsonb_build_object(
                 'pillar', 'tables', 'id', p.id, 'name', p.name, 'price', p.base_price,
                 'sold', (select count(*) from tx where pillar = 'tables' and line_id = p.id),
                 'capacity', nullif(p.tables_count, 0),
                 'status', case
                   when coalesce(e.tables_sold_out, false) or p.id = any (coalesce(e.sold_out_pack_ids, '{}'::uuid[])) then 'sold_out'
                   when coalesce(p.tables_count, 0) > 0 and (select count(*) from tx where pillar = 'tables' and line_id = p.id) >= p.tables_count then 'sold_out'
                   when coalesce(e.tables_enabled, false) then 'on_sale'
                   else 'closed' end,
                 'amount', case when v_money then round(coalesce((select sum(amount) from tx where pillar = 'tables' and line_id = p.id), 0)::numeric, 2) else null end
               )
        from public.table_packs p
        where p.is_active
          and (p.event_id = p_event_id
               or (p.event_id is null and coalesce(e.venue_id, e.partner_venue_id) is not null
                   and p.venue_id = coalesce(e.venue_id, e.partner_venue_id)))
        union all
        -- Parts de guest list
        select 3, row_number() over (order by gl.created_at),
               jsonb_build_object(
                 'pillar', 'guestList', 'id', gl.id,
                 'name', nullif(btrim(coalesce(gl.holder_label, '')), ''),
                 'holderType', gl.holder_type,
                 'price', null,
                 'sold', (select count(*) from gle where line_id = gl.id),
                 'capacity', nullif(gl.quota, 0),
                 'status', case
                   when coalesce(e.guest_list_sold_out, false) or coalesce(gl.manually_sold_out, false) then 'sold_out'
                   when coalesce(gl.quota, 0) > 0 and (select count(*) from gle where line_id = gl.id) >= gl.quota then 'sold_out'
                   when gl.is_active then 'on_sale'
                   else 'closed' end,
                 'amount', null
               )
        from public.guest_lists gl where gl.event_id = p_event_id
      ) l
    ), '[]'::jsonb),

    -- 2. Comment évoluent-elles ?
    'series', coalesce((
      select jsonb_agg(jsonb_build_object(
               'd', s.d, 'tickets', s.tickets, 'tables', s.tables, 'guests', s.guests,
               'amount', case when v_money then round(s.amount::numeric, 2) else null end,
               'visits', s.visits, 'people', s.people
             ) order by s.d desc)
      from series s
    ), '[]'::jsonb),

    -- 3. Est-ce qu'on voit ma soirée ?
    'visitSources', coalesce((
      select jsonb_agg(jsonb_build_object('source', v.source, 'sessions', v.sessions, 'orders', v.orders) order by v.sessions desc)
      from (select source, count(*) as sessions, count(*) filter (where done) as orders
            from vis group by source order by 2 desc limit 8) v
    ), '[]'::jsonb),

    -- 4. Qui achète ?
    'audience', jsonb_build_object(
      'people', (select count(*) from people),
      'returning', (select count(*) from seen_before),
      'new', (select count(*) from people) - (select count(*) from seen_before),
      'buyers', (select count(distinct email) from tx where pillar in ('tickets', 'tables') and email is not null),
      'priorEvents', (select count(*) from prior_events)
    ),

    -- 5. Qu'est-ce qui a fait vendre ?
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object('source', c.source, 'n', c.n,
               'amount', case when v_money then round(c.amount::numeric, 2) else null end) order by c.n desc)
      from (
        select case when source in ('venue_profile', 'organizer_profile', 'dj_profile', 'explore', 'promoter', 'direct') then source
                    when source in ('manual', 'manual_open') then 'manual'
                    else 'other' end as source,
               count(*) as n, sum(amount) as amount
        from tx where pillar in ('tickets', 'tables')
        group by 1
      ) c
    ), '[]'::jsonb),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', k.id, 'label', coalesce(nullif(btrim(k.label), ''), k.utm_source, k.code), 'code', k.code,
               'clicks', coalesce(k.clicks_count, 0), 'n', k.n, 'entries', k.entries,
               'amount', case when v_money then round(k.amount::numeric, 2) else null end
             ) order by k.n + k.entries desc, k.clicks_count desc nulls last)
      from (
        select tl.id, tl.label, tl.utm_source, tl.code, tl.clicks_count,
               (select count(*) from tx where tx.tracked_link_id = tl.id and pillar in ('tickets', 'tables')) as n,
               (select count(*) from gle where gle.tracked_link_id = tl.id) as entries,
               (select coalesce(sum(amount), 0) from tx where tx.tracked_link_id = tl.id and pillar in ('tickets', 'tables')) as amount
        from public.tracked_links tl
        where tl.event_id = p_event_id
           or tl.id in (select tracked_link_id from tx where tracked_link_id is not null)
           or tl.id in (select tracked_link_id from gle where tracked_link_id is not null)
      ) k
      where k.n > 0 or k.entries > 0 or coalesce(k.clicks_count, 0) > 0
    ), '[]'::jsonb),
    -- Repères de la courbe J-N : publication, ouverture d'un tarif (première
    -- vente d'un palier qui n'est pas le premier), emails et push de la soirée.
    'markers', coalesce((
      select jsonb_agg(jsonb_build_object('kind', mk.kind, 'd', mk.d, 'at', mk.at_ts, 'label', mk.label)
                       order by mk.at_ts)
      from (
        select 'published'::text as kind, e.published_at as at_ts, null::text as label,
               (e.start_at at time zone v_tz)::date - (e.published_at at time zone v_tz)::date as d
        where e.published_at is not null
        union all
        select 'round', r.first_at, r.name,
               (e.start_at at time zone v_tz)::date - (r.first_at at time zone v_tz)::date
        from (
          select tr.name, min(tx.at_ts) as first_at,
                 row_number() over (order by min(tx.at_ts)) as rn
          from public.ticket_rounds tr
          join tx on tx.pillar = 'tickets' and tx.line_id = tr.id
          where tr.event_id = p_event_id
          group by tr.id, tr.name
        ) r
        where r.rn > 1
        union all
        select 'email', em.sent_at, em.title,
               (e.start_at at time zone v_tz)::date - (em.sent_at at time zone v_tz)::date
        from emails em where em.sent_at is not null
        union all
        select 'push', pu.sent_at, pu.title,
               (e.start_at at time zone v_tz)::date - (pu.sent_at at time zone v_tz)::date
        from pushes pu where pu.sent_at is not null
      ) mk
      where mk.at_ts <= v_now
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(m.obj order by m.sent_at desc nulls last)
      from (
        select em.sent_at, jsonb_build_object(
                 'kind', 'email', 'id', em.id, 'title', em.title, 'sentAt', em.sent_at, 'auto', em.auto,
                 'reach', em.reach, 'opens', em.opens, 'clicks', em.clicks,
                 'orders', coalesce(a.orders, 0), 'entries', coalesce(a.entries, 0),
                 'amount', case when v_money then round(coalesce(a.amount, 0)::numeric, 2) else null end
               ) as obj
        from emails em left join email_attr a on a.campaign_id = em.id
        union all
        select pu.sent_at, jsonb_build_object(
                 'kind', 'push', 'id', pu.id, 'title', pu.title, 'sentAt', pu.sent_at, 'auto', pu.auto,
                 'templateKey', pu.template_key,
                 'reach', pu.reach, 'opens', null, 'clicks', coalesce(a.clicks, 0),
                 'orders', coalesce(a.orders, 0), 'entries', coalesce(a.entries, 0),
                 'amount', case when v_money then round(coalesce(a.amount, 0)::numeric, 2) else null end
               )
        from pushes pu left join push_attr a on a.campaign_id = pu.id
      ) m
    ), '[]'::jsonb)
  )
  into v_result;

  -- ── À retenir : 0 à 3 constats, chacun avec son seuil et sa section ──────
  -- Clé + paramètres ; le texte est traduit côté front (er.tk.*). Une base
  -- mince ne dit rien : chaque constat porte un minimum de volume.
  v_entered  := coalesce((v_result #>> '{totals,door,entered}')::int, 0);
  v_expected := coalesce((v_result #>> '{totals,door,expected}')::int, 0);
  v_tx_total := coalesce((v_result #>> '{totals,tickets,orders}')::int, 0)
              + coalesce((v_result #>> '{totals,tables,booked}')::int, 0)
              + coalesce((v_result #>> '{totals,guestList,registered}')::int, 0);

  -- 1. Soirée passée : la porte n'a pas vu tout le monde.
  if v_result #>> '{event,phase}' = 'after' and v_expected >= 30 and v_entered > 0
     and v_entered::numeric / v_expected < 0.7 then
    v_take := v_take || jsonb_build_object('key', 'no_show', 'tone', 'bad', 'section', 'sales',
      'params', jsonb_build_object('pct', round(100.0 * v_entered / v_expected), 'missing', v_expected - v_entered));
  end if;

  -- 2. Un message a fait une bonne part des ventes.
  select m.value into v_row from jsonb_array_elements(v_result -> 'messages') m
   order by (m.value ->> 'orders')::int + (m.value ->> 'entries')::int desc limit 1;
  if found and v_tx_total >= 10
     and ((v_row.value ->> 'orders')::int + (v_row.value ->> 'entries')::int) >= 5
     and ((v_row.value ->> 'orders')::int + (v_row.value ->> 'entries')::int)::numeric / v_tx_total >= 0.2 then
    v_take := v_take || jsonb_build_object('key', 'msg_drove', 'tone', 'good', 'section', 'reach',
      'params', jsonb_build_object('kind', v_row.value ->> 'kind', 'title', v_row.value ->> 'title',
        'n', (v_row.value ->> 'orders')::int + (v_row.value ->> 'entries')::int,
        'pct', round(100.0 * ((v_row.value ->> 'orders')::int + (v_row.value ->> 'entries')::int) / v_tx_total)));
  end if;

  -- 3. Beaucoup de visites, peu d'achats.
  if coalesce((v_result #>> '{totals,visits,total}')::int, 0) >= 100
     and (v_result #>> '{totals,visits,withOrder}')::numeric / (v_result #>> '{totals,visits,total}')::int < 0.02 then
    v_take := v_take || jsonb_build_object('key', 'low_conversion', 'tone', 'bad', 'section', 'reach',
      'params', jsonb_build_object('visits', (v_result #>> '{totals,visits,total}')::int,
        'pct', round(100.0 * (v_result #>> '{totals,visits,withOrder}')::numeric / (v_result #>> '{totals,visits,total}')::int, 1)));
  end if;

  -- 4. Soirée passée : une grosse part des attendus a acheté le jour J.
  select coalesce(sum((x.value ->> 'people')::int) filter (where (x.value ->> 'd')::int <= 0), 0),
         coalesce(sum((x.value ->> 'people')::int), 0)
    into v_heads_d0, v_heads
  from jsonb_array_elements(v_result -> 'series') x;
  if v_result #>> '{event,phase}' = 'after' and v_heads >= 30 and v_heads_d0::numeric / v_heads >= 0.3 then
    v_take := v_take || jsonb_build_object('key', 'day_of', 'tone', 'info', 'section', 'curve',
      'params', jsonb_build_object('pct', round(100.0 * v_heads_d0 / v_heads)));
  end if;

  -- 5. D'où viennent les visites.
  select s.value into v_row from jsonb_array_elements(v_result -> 'visitSources') s
   order by (s.value ->> 'sessions')::int desc limit 1;
  if found and coalesce((v_result #>> '{totals,visits,total}')::int, 0) >= 30
     and (v_row.value ->> 'sessions')::numeric / (v_result #>> '{totals,visits,total}')::int >= 0.5 then
    v_take := v_take || jsonb_build_object('key', 'visit_source', 'tone', 'info', 'section', 'reach',
      'params', jsonb_build_object('source', v_row.value ->> 'source',
        'pct', round(100.0 * (v_row.value ->> 'sessions')::int / (v_result #>> '{totals,visits,total}')::int)));
  end if;

  -- 6. Public neuf ou public d'habitués (seulement s'il y a eu des soirées avant).
  if coalesce((v_result #>> '{audience,people}')::int, 0) >= 20
     and coalesce((v_result #>> '{audience,priorEvents}')::int, 0) >= 1 then
    if (v_result #>> '{audience,new}')::numeric / (v_result #>> '{audience,people}')::int >= 0.6 then
      v_take := v_take || jsonb_build_object('key', 'mostly_new', 'tone', 'info', 'section', 'who',
        'params', jsonb_build_object('pct', round(100.0 * (v_result #>> '{audience,new}')::int / (v_result #>> '{audience,people}')::int)));
    elsif (v_result #>> '{audience,returning}')::numeric / (v_result #>> '{audience,people}')::int >= 0.5 then
      v_take := v_take || jsonb_build_object('key', 'mostly_returning', 'tone', 'good', 'section', 'who',
        'params', jsonb_build_object('pct', round(100.0 * (v_result #>> '{audience,returning}')::int / (v_result #>> '{audience,people}')::int)));
    end if;
  end if;

  -- ── Rythme : la dernière soirée TERMINÉE de la portée (≥ 20 attendus), et
  --    la part de ses attendus qu'elle avait au même J-N. Le front applique
  --    cette part aux attendus d'aujourd'hui pour dire où finira la soirée.
  if v_result #>> '{event,phase}' = 'before' then
    v_ref_d := (e.start_at at time zone v_tz)::date - (v_now at time zone v_tz)::date;
    for v_ref in
      select x.id, x.title, x.start_at, coalesce(x.timezone, v.timezone, 'Europe/Paris') as tz
      from public.events x
      left join public.venues v on v.id = coalesce(x.venue_id, x.partner_venue_id)
      where x.id = any(v_scope_ids) and x.id <> p_event_id
        and x.cancelled_at is null and x.end_at < v_now and x.start_at < e.start_at
      order by x.start_at desc
      limit 6
    loop
      select coalesce(sum(h.n), 0),
             -- Jours ENTIERS avant ce J-N (strictement) : aujourd'hui n'est pas
             -- fini ici, on ne le compare pas à une journée complète là-bas.
             coalesce(sum(h.n) filter (where (v_ref.start_at at time zone v_ref.tz)::date - (h.at_ts at time zone v_ref.tz)::date > v_ref_d), 0)
        into v_ref_final, v_ref_at
      from (
        select greatest(coalesce(t.quantity, 1), 1) as n, coalesce(t.paid_at, t.created_at) as at_ts
        from public.tickets t where t.event_id = v_ref.id and t.status in ('paid', 'used')
        union all
        select greatest(coalesce(r.guest_count, 0), 1), coalesce(r.paid_at, r.created_at)
        from public.table_reservations r where r.event_id = v_ref.id and r.status in ('paid', 'confirmed')
        union all
        select 1, g.created_at
        from public.guest_list_entries g join public.guest_lists gl on gl.id = g.guest_list_id
        where gl.event_id = v_ref.id and g.status <> 'cancelled'
      ) h;
      if v_ref_final >= 20 then
        v_pace := jsonb_build_object('refId', v_ref.id, 'refTitle', v_ref.title, 'd', v_ref_d,
                                     'final', v_ref_final, 'atSameD', v_ref_at);
        exit;
      end if;
    end loop;
  end if;
  v_result := v_result || jsonb_build_object('pace', v_pace);

  v_result := v_result || jsonb_build_object('takeaways',
    coalesce((select jsonb_agg(x.value) from (select value from jsonb_array_elements(v_take) limit 3) x), '[]'::jsonb));

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_events_sales_summary(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_now    timestamptz := now();
  v_money  boolean := false;
  v_events jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(v_uid, p_organizer_user_id, 'editor')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_money := v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.org_member_has_permission(v_uid, p_organizer_user_id, 'view_finance');
  elsif p_venue_id is null
     or not (public.can_manage_venue(v_uid, p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  else
    v_money := public.is_super_admin()
      or exists (select 1 from public.venues v where v.id = p_venue_id and v.owner_id = v_uid)
      or exists (
        select 1 from public.manager_permissions mp
        where mp.user_id = v_uid and mp.venue_id = p_venue_id
          and (coalesce(mp.can_view_analytics, false) or coalesce(mp.can_view_finance, false))
      );
  end if;

  with
  ev as materialized (
    select e.id, e.title, e.start_at, e.end_at, e.status, e.is_active, e.cancelled_at,
           e.published_at, coalesce(e.poster_url, e.image_url) as poster,
           e.ticketing_enabled, e.tables_enabled,
           e.tickets_sold_out, e.tables_sold_out, e.guest_list_sold_out,
           e.max_tickets, e.venue_id, e.partner_venue_id,
           coalesce(e.sold_out_pack_ids, '{}'::uuid[]) as closed_packs,
           date_trunc('day', v_now at time zone coalesce(e.timezone, v.timezone, 'Europe/Paris'))
             at time zone coalesce(e.timezone, v.timezone, 'Europe/Paris') as day_start,
           case
             when p_organizer_user_id is not null then v_money
               and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id
                    or public.coorg_sees_event_money(e.id, 'org:' || p_organizer_user_id::text))
             else v_money and e.venue_id = p_venue_id
           end as show_money
    from public.events e
    left join public.venues v on v.id = coalesce(e.venue_id, e.partner_venue_id)
    where e.end_at > v_now - interval '12 hours'
      and e.cancelled_at is null
      and coalesce(e.status, 'active') <> 'cancelled'
      and (
           (p_venue_id is not null and (e.venue_id = p_venue_id or e.partner_venue_id = p_venue_id or e.id in (select public.cohost_event_ids_venue(p_venue_id))))
        or (p_organizer_user_id is not null
            and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id or e.id in (select public.cohost_event_ids_org(p_organizer_user_id))))
      )
    order by e.start_at
    limit 60
  ),

  tk as (
    select t.event_id,
           coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0) as sold,
           coalesce(sum(greatest(coalesce(t.quantity, 1), 1))
             filter (where coalesce(t.paid_at, t.created_at) >= ev.day_start), 0) as sold_today,
           coalesce(sum(
             greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
             - least(greatest(coalesce(t.refund_amount, 0), 0),
                     greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))
           ), 0) as amount,
           coalesce(sum(
             greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
             - least(greatest(coalesce(t.refund_amount, 0), 0),
                     greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))
           ) filter (where coalesce(t.paid_at, t.created_at) >= ev.day_start), 0) as amount_today
    from public.tickets t
    join ev on ev.id = t.event_id
    where t.status in ('paid', 'used')
    group by t.event_id
  ),

  rounds as (
    select tr.event_id,
           count(*) as n,
           count(*) filter (where coalesce(tr.max_tickets, 0) <= 0) as unbounded,
           coalesce(sum(greatest(coalesce(tr.max_tickets, 0), 0)), 0) as cap
    from public.ticket_rounds tr
    join ev on ev.id = tr.event_id
    group by tr.event_id
  ),

  tb as (
    select r.event_id,
           count(*) as booked,
           count(*) filter (where coalesce(r.paid_at, r.created_at) >= ev.day_start) as booked_today,
           coalesce(sum(greatest(coalesce(r.guest_count, 0), 0)), 0) as guests,
           coalesce(sum(
             greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0))
           ), 0) as amount,
           coalesce(sum(
             greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0))
           ) filter (where coalesce(r.paid_at, r.created_at) >= ev.day_start), 0) as amount_today
    from public.table_reservations r
    join ev on ev.id = r.event_id
    where r.status in ('paid', 'confirmed')
    group by r.event_id
  ),

  -- Même inventaire que `_event_tables_left` : formules actives de la soirée,
  -- ou du club quand la formule n'est pas event-scopée, formules « complètes »
  -- exclues.
  packs as (
    select ev.id as event_id, coalesce(sum(p.tables_count), 0)::integer as cap
    from ev
    join public.table_packs p
      on p.is_active
     and (p.event_id = ev.id
          or (p.event_id is null and coalesce(ev.venue_id, ev.partner_venue_id) is not null
              and p.venue_id = coalesce(ev.venue_id, ev.partner_venue_id)))
     and not (p.id = any (ev.closed_packs))
    group by ev.id
  ),

  gls as (
    select gl.event_id,
           count(*) filter (where gl.is_active) as lists,
           count(*) filter (where gl.is_active and coalesce(gl.quota, 0) <= 0) as unbounded,
           coalesce(sum(greatest(coalesce(gl.quota, 0), 0)) filter (where gl.is_active), 0) as cap,
           bool_and(coalesce(gl.manually_sold_out, false)) filter (where gl.is_active) as all_closed
    from public.guest_lists gl
    join ev on ev.id = gl.event_id
    group by gl.event_id
  ),

  gle as (
    select gl.event_id,
           count(*) as registered,
           count(*) filter (where e2.created_at >= ev.day_start) as registered_today
    from public.guest_list_entries e2
    join public.guest_lists gl on gl.id = e2.guest_list_id
    join ev on ev.id = gl.event_id
    where e2.status <> 'cancelled'
    group by gl.event_id
  ),

  dr as (
    select o.event_id,
           count(*) as orders,
           count(*) filter (where coalesce(o.paid_at, o.created_at) >= ev.day_start) as orders_today,
           coalesce(sum(
             greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))
           ), 0) as amount,
           coalesce(sum(
             greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))
           ) filter (where coalesce(o.paid_at, o.created_at) >= ev.day_start), 0) as amount_today
    from public.orders o
    join ev on ev.id = o.event_id
    where p_venue_id is not null
      and o.venue_id = p_venue_id
      and o.status in ('paid', 'served')
    group by o.event_id
  ),

  vis as (
    select s.event_id,
           count(*) as total,
           count(*) filter (where s.visited_at >= ev.day_start) as today
    from public.visitor_sessions s
    join ev on ev.id = s.event_id
    group by s.event_id
  )

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', ev.id,
           'title', ev.title,
           'startAt', ev.start_at,
           'endAt', ev.end_at,
           'poster', ev.poster,
           'status', ev.status,
           'isActive', ev.is_active,
           'publishedAt', ev.published_at,
           'dayStart', ev.day_start,
           'tickets', jsonb_build_object(
             'enabled', coalesce(ev.ticketing_enabled, false),
             'soldOut', coalesce(ev.tickets_sold_out, false),
             'sold', coalesce(tk.sold, 0),
             'today', coalesce(tk.sold_today, 0),
             'capacity', case
               when coalesce(ev.max_tickets, 0) > 0 then ev.max_tickets
               when rounds.n > 0 and rounds.unbounded = 0 then rounds.cap
               else null end
           ),
           'tables', jsonb_build_object(
             'enabled', coalesce(ev.tables_enabled, false),
             'soldOut', coalesce(ev.tables_sold_out, false),
             'booked', coalesce(tb.booked, 0),
             'today', coalesce(tb.booked_today, 0),
             'guests', coalesce(tb.guests, 0),
             'capacity', case when coalesce(packs.cap, 0) > 0 then packs.cap else null end
           ),
           'guestList', jsonb_build_object(
             'enabled', coalesce(gls.lists, 0) > 0,
             'soldOut', coalesce(ev.guest_list_sold_out, false) or coalesce(gls.all_closed, false),
             'registered', coalesce(gle.registered, 0),
             'today', coalesce(gle.registered_today, 0),
             'capacity', case when coalesce(gls.lists, 0) > 0 and gls.unbounded = 0 and gls.cap > 0
                              then gls.cap else null end
           ),
           'drinks', case when p_venue_id is not null then jsonb_build_object(
             'orders', coalesce(dr.orders, 0),
             'today', coalesce(dr.orders_today, 0)
           ) else null end,
           'visits', jsonb_build_object(
             'total', coalesce(vis.total, 0),
             'today', coalesce(vis.today, 0)
           ),
           'revenue', case when ev.show_money then jsonb_build_object(
             'total', round((coalesce(tk.amount, 0) + coalesce(tb.amount, 0) + coalesce(dr.amount, 0))::numeric, 2),
             'today', round((coalesce(tk.amount_today, 0) + coalesce(tb.amount_today, 0) + coalesce(dr.amount_today, 0))::numeric, 2),
             'tickets', round(coalesce(tk.amount, 0)::numeric, 2),
             'tables', round(coalesce(tb.amount, 0)::numeric, 2),
             'drinks', round(coalesce(dr.amount, 0)::numeric, 2)
           ) else null end
         ) order by ev.start_at), '[]'::jsonb)
    into v_events
  from ev
  left join tk     on tk.event_id = ev.id
  left join rounds on rounds.event_id = ev.id
  left join tb     on tb.event_id = ev.id
  left join packs  on packs.event_id = ev.id
  left join gls    on gls.event_id = ev.id
  left join gle    on gle.event_id = ev.id
  left join dr     on dr.event_id = ev.id
  left join vis    on vis.event_id = ev.id;

  return jsonb_build_object(
    'ok', true,
    'now', v_now,
    'money', v_money,
    'events', v_events
  );
end;
$function$;

-- ─── 1 bis. Portée CRM / totaux : les soirées co-hébergées en sortent ───────
-- (corps en ligne, seule la branche co-hôte ajoutée par 20260928100100 retirée)

CREATE OR REPLACE FUNCTION public._resolve_meta_audience_rows(p_connection_id uuid, p_kind text, p_ref text)
 RETURNS TABLE(email text, phone text, first_name text, last_name text, country text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue text;
  v_org   uuid;
BEGIN
  SELECT mc.venue_id, mc.organizer_user_id INTO v_venue, v_org
    FROM public.meta_connections mc WHERE mc.id = p_connection_id;
  IF NOT FOUND OR (v_venue IS NULL AND v_org IS NULL) THEN RETURN; END IF;

  RETURN QUERY
  WITH sms AS (
    SELECT lower(COALESCE(vsc.email, '')) AS em, vsc.phone_e164, vsc.full_name
      FROM public.venue_sms_contacts vsc
     WHERE ((v_venue IS NOT NULL AND vsc.venue_id = v_venue) OR (v_org IS NOT NULL AND vsc.organizer_user_id = v_org))
       AND vsc.unsubscribed = false AND vsc.phone_e164 IS NOT NULL
       AND vsc.sms_consent_at >= now() - interval '36 months'
  ),
  news AS (
    SELECT lower(ns.email) AS em, ns.user_id, ns.first_name, ns.last_name
      FROM public.newsletter_subscriptions ns
     WHERE ((v_venue IS NOT NULL AND ns.venue_id = v_venue) OR (v_org IS NOT NULL AND ns.organizer_user_id = v_org))
       AND ns.opted_in = true
       AND NOT public.is_email_suppressed(ns.email)
  ),
  consenting AS (
    SELECT n.em,
           (SELECT s.phone_e164 FROM sms s WHERE s.em = n.em LIMIT 1) AS phone_e164,
           COALESCE(n.first_name, pr.first_name) AS fn,
           COALESCE(n.last_name, pr.last_name) AS ln
      FROM news n
      LEFT JOIN public.profiles pr ON pr.id = n.user_id
    UNION
    SELECT s.em, s.phone_e164,
           NULLIF(split_part(COALESCE(s.full_name, ''), ' ', 1), ''),
           NULLIF(regexp_replace(COALESCE(s.full_name, ''), '^\S+\s*', ''), '')
      FROM sms s
     WHERE s.em = '' OR s.em NOT IN (SELECT n2.em FROM news n2)
  ),
  scope_events AS (
    SELECT e.id FROM public.events e
     WHERE (v_venue IS NOT NULL AND (e.venue_id = v_venue OR e.partner_venue_id = v_venue))
        OR (v_org IS NOT NULL AND (e.organizer_user_id = v_org OR e.partner_organizer_id = v_org))
  ),
  activity AS (
    SELECT lower(t.user_email) AS em, t.event_id, 'ticket'::text AS kind, t.created_at
      FROM public.tickets t WHERE t.paid_at IS NOT NULL AND t.event_id IN (SELECT id FROM scope_events)
    UNION ALL
    SELECT lower(tr.user_email), tr.event_id, 'table', tr.created_at
      FROM public.table_reservations tr WHERE tr.paid_at IS NOT NULL AND tr.event_id IN (SELECT id FROM scope_events)
    UNION ALL
    SELECT lower(o.user_email), o.event_id, 'order', o.created_at
      FROM public.orders o WHERE o.status IN ('paid', 'served') AND o.user_email IS NOT NULL
       AND ((v_venue IS NOT NULL AND o.venue_id = v_venue) OR o.event_id IN (SELECT id FROM scope_events))
    UNION ALL
    SELECT lower(gle.email), g.event_id, 'guest_list', gle.created_at
      FROM public.guest_list_entries gle JOIN public.guest_lists g ON g.id = gle.guest_list_id
     WHERE gle.status <> 'cancelled' AND g.event_id IN (SELECT id FROM scope_events)
  ),
  selected AS (
    SELECT c.* FROM consenting c
     WHERE CASE p_kind
       WHEN 'builtin' THEN
         CASE p_ref
           WHEN 'all_consenting' THEN true
           WHEN 'buyers_12m'    THEN EXISTS (SELECT 1 FROM activity a WHERE a.em = c.em AND a.kind IN ('ticket','table','order') AND a.created_at >= now() - interval '12 months')
           WHEN 'vip_tables'    THEN EXISTS (SELECT 1 FROM activity a WHERE a.em = c.em AND a.kind = 'table')
           WHEN 'guest_list'    THEN EXISTS (SELECT 1 FROM activity a WHERE a.em = c.em AND a.kind = 'guest_list')
           WHEN 'regulars_3'    THEN (SELECT count(DISTINCT a.event_id) FROM activity a WHERE a.em = c.em) >= 3
           ELSE false
         END
       WHEN 'venue_segment' THEN
         v_venue IS NOT NULL AND c.em IN (
           SELECT lower(r.email) FROM public.venue_segments vs
             CROSS JOIN LATERAL public.resolve_venue_segment(v_venue, vs.definition) r
            WHERE vs.id::text = p_ref AND vs.venue_id = v_venue)
       WHEN 'contact_segment' THEN
         c.em IN (
           SELECT lower(r.email) FROM public.contact_segments cs
             CROSS JOIN LATERAL public.resolve_contact_segment_def(v_venue, v_org, cs.definition) r
            WHERE cs.id::text = p_ref
              AND cs.venue_id IS NOT DISTINCT FROM v_venue AND cs.organizer_user_id IS NOT DISTINCT FROM v_org
              AND r.email IS NOT NULL)
       ELSE false END
  )
  SELECT NULLIF(s.em, '')::text, s.phone_e164::text, s.fn::text, s.ln::text,
         (CASE
            WHEN s.phone_e164 LIKE '+33%' THEN 'FR' WHEN s.phone_e164 LIKE '+34%' THEN 'ES'
            WHEN s.phone_e164 LIKE '+44%' THEN 'GB' WHEN s.phone_e164 LIKE '+49%' THEN 'DE'
            WHEN s.phone_e164 LIKE '+39%' THEN 'IT' WHEN s.phone_e164 LIKE '+32%' THEN 'BE'
            WHEN s.phone_e164 LIKE '+41%' THEN 'CH' WHEN s.phone_e164 LIKE '+351%' THEN 'PT'
            WHEN s.phone_e164 LIKE '+31%' THEN 'NL' ELSE '' END)::text
    FROM selected s
   WHERE NULLIF(s.em, '') IS NOT NULL OR s.phone_e164 IS NOT NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public._venue_customer_rfm(p_venue_id text)
 RETURNS TABLE(id uuid, user_id uuid, email text, first_name text, last_name text, phone text, first_visit_at timestamp with time zone, last_visit_at timestamp with time zone, total_spent numeric, ticket_count integer, order_count integer, table_count integer, is_banned boolean, banned_at timestamp with time zone, ban_reason text, notes text, revenue_30d numeric, revenue_90d numeric, revenue_prev_90d numeric, avg_basket numeric, visit_nights integer, visits_per_month numeric, last_activity_at timestamp with time zone, preferred_dow integer, preferred_event_title text, recency_days integer, rfm_r integer, rfm_f integer, rfm_m integer, rfm_segment text, rfm_tier text, churn_risk boolean, is_guest boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Fonction INTERNE : aucune garde ici, droits révoqués plus bas.
  RETURN QUERY
  WITH venue_events AS (
    SELECT e.id, e.start_at, e.title
    FROM events e
    WHERE e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id
  ),
  -- Revenu club = montant facturé − frais Yuno. La part Yuno n'est jamais comptée.
  activity AS (
    SELECT lower(t.user_email) AS em,
           (t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0))::numeric AS amount,
           t.created_at, t.event_id
    FROM tickets t JOIN venue_events ve ON ve.id = t.event_id
    WHERE t.user_email IS NOT NULL AND t.paid_at IS NOT NULL
    UNION ALL
    SELECT lower(o.user_email),
           (o.total - COALESCE(o.service_fee, 0))::numeric,
           o.created_at, o.event_id
    FROM orders o
    WHERE o.venue_id = p_venue_id AND o.user_email IS NOT NULL AND o.status = 'paid'
    UNION ALL
    SELECT lower(tr.user_email),
           (tr.total_price - COALESCE(tr.service_fee, 0) - COALESCE(tr.management_fee, 0))::numeric,
           tr.created_at, tr.event_id
    FROM table_reservations tr JOIN venue_events ve ON ve.id = tr.event_id
    WHERE tr.user_email IS NOT NULL AND tr.paid_at IS NOT NULL
  ),
  agg AS (
    SELECT a.em,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '30 days'), 0) AS revenue_30d,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '90 days'), 0) AS revenue_90d,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '180 days'
                                       AND a.created_at < now() - interval '90 days'), 0) AS revenue_prev_90d,
      COALESCE(avg(a.amount), 0) AS avg_basket,
      count(DISTINCT date(a.created_at)) AS visit_nights,
      max(a.created_at) AS last_activity_at,
      min(a.created_at) AS first_activity_at
    FROM activity a GROUP BY a.em
  ),
  event_activity AS (
    SELECT a.em, a.event_id, ve.start_at, ve.title, count(*) AS cnt
    FROM activity a JOIN venue_events ve ON ve.id = a.event_id
    WHERE a.event_id IS NOT NULL
    GROUP BY a.em, a.event_id, ve.start_at, ve.title
  ),
  pref_event AS (
    SELECT DISTINCT ON (ea.em) ea.em, ea.title AS preferred_event_title
    FROM event_activity ea ORDER BY ea.em, ea.cnt DESC, ea.start_at DESC
  ),
  pref_dow AS (
    SELECT s.em, s.dow FROM (
      SELECT ea.em, extract(dow FROM ea.start_at)::int AS dow,
             row_number() OVER (PARTITION BY ea.em ORDER BY sum(ea.cnt) DESC) AS rn
      FROM event_activity ea GROUP BY ea.em, extract(dow FROM ea.start_at)
    ) s WHERE s.rn = 1
  ),
  -- Ventes brutes par email : sémantique gross (= increment_venue_customer_stats),
  -- identité (nom/tél du dernier achat qui en porte), compteurs par pilier.
  guest_sales AS (
    SELECT lower(t.user_email) AS em, t.total_price::numeric AS gross, t.created_at,
           'ticket'::text AS kind, t.full_name, t.phone AS ph
    FROM tickets t JOIN venue_events ve ON ve.id = t.event_id
    WHERE t.user_email IS NOT NULL AND t.paid_at IS NOT NULL
    UNION ALL
    SELECT lower(o.user_email), o.total::numeric, o.created_at, 'order', NULL, NULL
    FROM orders o
    WHERE o.venue_id = p_venue_id AND o.user_email IS NOT NULL AND o.status = 'paid'
    UNION ALL
    SELECT lower(tr.user_email), tr.total_price::numeric, tr.created_at, 'table', tr.full_name, tr.phone
    FROM table_reservations tr JOIN venue_events ve ON ve.id = tr.event_id
    WHERE tr.user_email IS NOT NULL AND tr.paid_at IS NOT NULL
  ),
  -- Dernière valeur NON NULLE de chaque champ (et non la dernière ligne) : un
  -- achat sans numéro ne doit pas effacer le numéro laissé la fois d'avant.
  guest_identity AS (
    SELECT gs.em,
      (array_agg(gs.full_name ORDER BY gs.created_at DESC) FILTER (WHERE gs.full_name IS NOT NULL))[1] AS full_name,
      (array_agg(gs.ph ORDER BY gs.created_at DESC) FILTER (WHERE gs.ph IS NOT NULL))[1] AS ph
    FROM guest_sales gs GROUP BY gs.em
  ),
  guest_agg AS (
    SELECT gs.em,
      sum(gs.gross) AS total_spent,
      count(*) FILTER (WHERE gs.kind = 'ticket') AS ticket_count,
      count(*) FILTER (WHERE gs.kind = 'order')  AS order_count,
      count(*) FILTER (WHERE gs.kind = 'table')  AS table_count,
      min(gs.created_at) AS first_at,
      max(gs.created_at) AS last_at
    FROM guest_sales gs
    -- Anti-jointure : seuls les emails SANS ligne venue_customers deviennent invités.
    WHERE NOT EXISTS (
      SELECT 1 FROM venue_customers vc
      WHERE vc.venue_id = p_venue_id AND lower(vc.email) = gs.em
    )
    GROUP BY gs.em
  ),
  base AS (
    -- Clients à compte (lignes venue_customers)
    SELECT
      vc.id, vc.user_id, vc.email,
      COALESCE(vc.first_name, pr.first_name) AS first_name,
      COALESCE(vc.last_name, pr.last_name) AS last_name,
      COALESCE(NULLIF(btrim(COALESCE(vc.phone, '')), ''), pr.phone) AS phone,
      vc.first_visit_at, vc.last_visit_at, vc.total_spent,
      vc.ticket_count, vc.order_count, vc.table_count,
      vc.is_banned, vc.banned_at, vc.ban_reason, vc.notes,
      ag.revenue_30d, ag.revenue_90d, ag.revenue_prev_90d, ag.avg_basket,
      COALESCE(ag.visit_nights, 0)::int AS visit_nights,
      CASE
        WHEN ag.first_activity_at IS NULL THEN 0
        ELSE round(
          ag.visit_nights::numeric /
          greatest(1, extract(epoch FROM (ag.last_activity_at - ag.first_activity_at)) / 2592000.0),
          2)
      END AS visits_per_month,
      ag.last_activity_at, pd.dow AS preferred_dow, pe.preferred_event_title,
      floor(extract(epoch FROM (now() - COALESCE(ag.last_activity_at, vc.last_visit_at, vc.first_visit_at, now()))) / 86400)::int AS recency_days,
      CASE WHEN COALESCE(ag.visit_nights, 0) > 0 THEN ag.visit_nights::int
           ELSE COALESCE(vc.ticket_count, 0) + COALESCE(vc.order_count, 0) + COALESCE(vc.table_count, 0)
      END AS rfm_freq,
      COALESCE(vc.total_spent, 0)::numeric AS rfm_money,
      false AS is_guest
    FROM venue_customers vc
    LEFT JOIN agg ag ON ag.em = lower(vc.email)
    LEFT JOIN pref_event pe ON pe.em = lower(vc.email)
    LEFT JOIN pref_dow pd ON pd.em = lower(vc.email)
    -- Repli sur le profil du compte : le fichier client doit porter le
    -- téléphone du client, même quand l'achat qui l'a créé n'en portait pas.
    LEFT JOIN LATERAL (
      SELECT p.first_name, p.last_name, NULLIF(btrim(COALESCE(p.phone, '')), '') AS phone
      FROM profiles p WHERE p.id = vc.user_id LIMIT 1
    ) pr ON true
    WHERE vc.venue_id = p_venue_id

    UNION ALL

    -- Invités (lignes synthétiques par email)
    SELECT
      md5('guest:' || ga.em)::uuid AS id,
      -- user_id reste NULL : un invité n'est pas un compte, et c'est ce NULL
      -- qui l'exclut d'office du ciblage push de resolve_venue_segment.
      NULL::uuid AS user_id,
      ga.em AS email,
      NULLIF(split_part(COALESCE(gi.full_name, ''), ' ', 1), '') AS first_name,
      NULLIF(regexp_replace(COALESCE(gi.full_name, ''), '^\S+\s*', ''), '') AS last_name,
      NULLIF(btrim(COALESCE(gi.ph, '')), '') AS phone,
      ga.first_at AS first_visit_at,
      ga.last_at AS last_visit_at,
      COALESCE(ga.total_spent, 0) AS total_spent,
      ga.ticket_count::int, ga.order_count::int, ga.table_count::int,
      (vbe.email IS NOT NULL) AS is_banned,
      vbe.banned_at,
      vbe.ban_reason,
      NULL::text AS notes,
      ag.revenue_30d, ag.revenue_90d, ag.revenue_prev_90d, ag.avg_basket,
      COALESCE(ag.visit_nights, 0)::int AS visit_nights,
      CASE
        WHEN ag.first_activity_at IS NULL THEN 0
        ELSE round(
          ag.visit_nights::numeric /
          greatest(1, extract(epoch FROM (ag.last_activity_at - ag.first_activity_at)) / 2592000.0),
          2)
      END AS visits_per_month,
      ag.last_activity_at, pd.dow AS preferred_dow, pe.preferred_event_title,
      floor(extract(epoch FROM (now() - COALESCE(ag.last_activity_at, ga.last_at, ga.first_at, now()))) / 86400)::int AS recency_days,
      CASE WHEN COALESCE(ag.visit_nights, 0) > 0 THEN ag.visit_nights::int
           ELSE (ga.ticket_count + ga.order_count + ga.table_count)::int
      END AS rfm_freq,
      COALESCE(ga.total_spent, 0)::numeric AS rfm_money,
      true AS is_guest
    FROM guest_agg ga
    LEFT JOIN guest_identity gi ON gi.em = ga.em
    LEFT JOIN agg ag ON ag.em = ga.em
    LEFT JOIN pref_event pe ON pe.em = ga.em
    LEFT JOIN pref_dow pd ON pd.em = ga.em
    LEFT JOIN venue_banned_emails vbe ON vbe.venue_id = p_venue_id AND lower(vbe.email) = ga.em
  ),
  ranked AS (
    SELECT b.*,
      count(*) OVER () AS n_total,
      (rank() OVER (ORDER BY b.rfm_freq) - 1)::numeric  AS freq_below,
      (rank() OVER (ORDER BY b.rfm_money) - 1)::numeric AS mon_below
    FROM base b
  ),
  scored AS (
    SELECT rk.*,
      -- R n'est PLUS relatif : la récence est un fait de calendrier, pas une
      -- opinion sur la population. C'est là qu'était le mensonge — sur un
      -- fichier de deux personnes, la moins récente des deux tombait à 1/5 et
      -- passait « Perdue » alors qu'elle s'était inscrite l'avant-veille. Les
      -- paliers sont ceux annoncés au client dans le mode d'emploi.
      CASE WHEN rk.recency_days <= 14 THEN 5
           WHEN rk.recency_days <= 30 THEN 4
           WHEN rk.recency_days <= 60 THEN 3
           WHEN rk.recency_days <= 90 THEN 2
           ELSE 1 END AS s_r,
      -- F : bande absolue en nuits, affinée ±1 par la position dans le fichier
      -- (un club qui tourne chaque semaine n'a pas le rythme d'une soirée
      -- mensuelle). M reste purement relatif : « gros dépensier » ne veut rien
      -- dire hors du contexte du lieu.
      CASE WHEN rk.n_total <= 1 THEN 3
           ELSE least(5, greatest(1, floor((rk.freq_below / (rk.n_total - 1)) * 5)::int + 1))
      END AS rel_f,
      CASE WHEN rk.n_total <= 1 THEN 3
           ELSE least(5, greatest(1, floor((rk.mon_below / (rk.n_total - 1)) * 5)::int + 1))
      END AS s_m,
      CASE WHEN rk.rfm_freq >= 10 THEN 5
           WHEN rk.rfm_freq >= 6 THEN 4
           WHEN rk.rfm_freq >= 3 THEN 3
           WHEN rk.rfm_freq >= 2 THEN 2
           ELSE 1 END AS abs_f
    FROM ranked rk
  ),
  blended AS (
    SELECT s.*,
      least(5, greatest(1, least(greatest(s.rel_f, s.abs_f - 1), s.abs_f + 1))) AS s_f
    FROM scored s
  )
  SELECT
    s.id, s.user_id, s.email, s.first_name, s.last_name, s.phone,
    s.first_visit_at, s.last_visit_at, s.total_spent,
    s.ticket_count, s.order_count, s.table_count,
    s.is_banned, s.banned_at, s.ban_reason, s.notes,
    s.revenue_30d, s.revenue_90d, s.revenue_prev_90d, s.avg_basket,
    s.visit_nights, s.visits_per_month,
    s.last_activity_at, s.preferred_dow, s.preferred_event_title,
    s.recency_days,
    s.s_r::int AS rfm_r, s.s_f::int AS rfm_f, s.s_m::int AS rfm_m,
    (CASE
      WHEN s.s_r >= 4 AND s.s_f >= 4 THEN 'champions'
      -- « Était régulier, se met en silence » passe AVANT « fidèle » : un
      -- habitué muet depuis trois mois est le client à rappeler ce soir, pas
      -- une ligne rassurante dans le camembert. L'ordre inverse le rangeait en
      -- « Fidèles » et le club ne le voyait jamais partir.
      WHEN s.s_r <= 2 AND s.s_f >= 3 THEN 'at_risk'
      WHEN s.s_f >= 4 THEN 'loyal'
      WHEN s.s_r >= 4 AND s.s_f <= 2 THEN CASE WHEN s.s_m >= 3 THEN 'promising' ELSE 'new' END
      WHEN s.s_r >= 3 THEN 'loyal'
      WHEN s.s_r = 2 THEN 'dormant'
      ELSE 'lost'
    END)::text AS rfm_segment,
    (CASE
      WHEN s.s_m >= 5 THEN 'platinum'
      WHEN s.s_m >= 4 THEN 'gold'
      WHEN s.s_m >= 2 THEN 'silver'
      ELSE 'bronze'
    END)::text AS rfm_tier,
    (s.s_f >= 3 AND s.recency_days > 45 AND s.recency_days <= 180) AS churn_risk,
    s.is_guest
  FROM blended s
  ORDER BY s.last_visit_at DESC NULLS LAST;
END;
$function$;

CREATE OR REPLACE FUNCTION public.contact_scope_customers(p_venue_id text, p_organizer_user_id uuid)
 RETURNS TABLE(email text, user_id uuid, first_name text, last_name text, phone text, spent numeric, event_count integer, paid_count integer, ticket_count integer, table_count integer, order_count integer, guest_list_count integer, first_at timestamp with time zone, last_at timestamp with time zone, last_paid_at timestamp with time zone, city text, age integer, gender text, subscribed boolean, sub_source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ev AS (
    SELECT e.id
      FROM public.events e
     WHERE (p_venue_id IS NOT NULL AND (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id))
        OR (p_organizer_user_id IS NOT NULL AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id))
  ), act AS (
    SELECT lower(btrim(t.user_email)) AS em,
           (t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0))::numeric AS amount,
           t.created_at, t.event_id, 'ticket'::text AS kind, t.user_id,
           COALESCE(t.guest_first_name, NULLIF(split_part(btrim(COALESCE(t.full_name, '')), ' ', 1), '')) AS fn,
           COALESCE(t.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(t.full_name, ''), '^\S+\s*', '')), '')) AS ln,
           NULLIF(btrim(COALESCE(t.phone, t.guest_phone, '')), '') AS ph
      FROM public.tickets t JOIN ev ON ev.id = t.event_id
     WHERE t.user_email IS NOT NULL AND btrim(t.user_email) <> '' AND t.paid_at IS NOT NULL
    UNION ALL
    SELECT lower(btrim(tr.user_email)),
           (tr.total_price - COALESCE(tr.service_fee, 0) - COALESCE(tr.management_fee, 0))::numeric,
           tr.created_at, tr.event_id, 'table', tr.user_id,
           COALESCE(tr.guest_first_name, NULLIF(split_part(btrim(COALESCE(tr.full_name, '')), ' ', 1), '')),
           COALESCE(tr.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(tr.full_name, ''), '^\S+\s*', '')), '')),
           NULLIF(btrim(COALESCE(tr.phone, tr.guest_phone, '')), '')
      FROM public.table_reservations tr JOIN ev ON ev.id = tr.event_id
     WHERE tr.user_email IS NOT NULL AND btrim(tr.user_email) <> ''
       AND (tr.paid_at IS NOT NULL OR tr.status IN ('paid', 'confirmed'))
    UNION ALL
    SELECT lower(btrim(o.user_email)),
           (o.total - COALESCE(o.service_fee, 0))::numeric,
           o.created_at, o.event_id, 'order', o.user_id,
           o.guest_first_name, o.guest_last_name,
           NULLIF(btrim(COALESCE(o.guest_phone, '')), '')
      FROM public.orders o
     WHERE p_venue_id IS NOT NULL AND o.venue_id = p_venue_id
       AND o.user_email IS NOT NULL AND btrim(o.user_email) <> '' AND o.status = 'paid'
    UNION ALL
    SELECT lower(btrim(gle.email)),
           0::numeric,
           gle.created_at, gl.event_id, 'guestlist', gle.user_id,
           NULLIF(split_part(btrim(COALESCE(gle.full_name, '')), ' ', 1), ''),
           NULLIF(btrim(regexp_replace(COALESCE(gle.full_name, ''), '^\S+\s*', '')), ''),
           NULLIF(btrim(COALESCE(gle.phone, '')), '')
      FROM public.guest_list_entries gle
      JOIN public.guest_lists gl ON gl.id = gle.guest_list_id
      JOIN ev ON ev.id = gl.event_id
     WHERE gle.email IS NOT NULL AND btrim(gle.email) <> '' AND gle.status <> 'cancelled'
  ), agg AS (
    SELECT a.em,
           COALESCE(sum(a.amount), 0) AS spent,
           count(DISTINCT a.event_id) AS event_count,
           count(*) FILTER (WHERE a.kind <> 'guestlist') AS paid_count,
           count(*) FILTER (WHERE a.kind = 'ticket') AS ticket_count,
           count(*) FILTER (WHERE a.kind = 'table') AS table_count,
           count(*) FILTER (WHERE a.kind = 'order') AS order_count,
           count(*) FILTER (WHERE a.kind = 'guestlist') AS guest_list_count,
           min(a.created_at) AS first_at,
           max(a.created_at) AS last_at,
           max(a.created_at) FILTER (WHERE a.kind <> 'guestlist') AS last_paid_at,
           (array_agg(a.user_id ORDER BY a.created_at DESC) FILTER (WHERE a.user_id IS NOT NULL))[1] AS uid,
           (array_agg(a.fn ORDER BY a.created_at DESC) FILTER (WHERE a.fn IS NOT NULL))[1] AS fn,
           (array_agg(a.ln ORDER BY a.created_at DESC) FILTER (WHERE a.ln IS NOT NULL))[1] AS ln,
           (array_agg(a.ph ORDER BY a.created_at DESC) FILTER (WHERE a.ph IS NOT NULL))[1] AS ph
      FROM act a
     GROUP BY a.em
  ), subs AS (
    -- Abonnés entrés par une surface Yuno (jamais par un fichier importé).
    SELECT lower(ns.email) AS em,
           bool_or(ns.opted_in AND ns.opted_out_at IS NULL) AS subscribed,
           max(ns.source) AS src,
           (array_agg(ns.user_id) FILTER (WHERE ns.user_id IS NOT NULL))[1] AS uid,
           max(ns.first_name) AS fn, max(ns.last_name) AS ln
      FROM public.newsletter_subscriptions ns
     WHERE public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND ns.import_id IS NULL
       AND COALESCE(ns.source, '') NOT LIKE '%import%'
     GROUP BY lower(ns.email)
  ), merged AS (
    SELECT COALESCE(a.em, s.em) AS em,
           COALESCE(a.uid, s.uid) AS uid,
           a.spent, a.event_count, a.paid_count, a.ticket_count, a.table_count, a.order_count, a.guest_list_count,
           a.first_at, a.last_at, a.last_paid_at,
           COALESCE(a.fn, s.fn) AS fn, COALESCE(a.ln, s.ln) AS ln, a.ph,
           COALESCE(s.subscribed, false) AS subscribed, s.src
      FROM agg a
      FULL OUTER JOIN subs s ON s.em = a.em
  )
  SELECT m.em::text AS email,
         COALESCE(m.uid, p.id) AS user_id,
         COALESCE(p.first_name, m.fn)::text AS first_name,
         COALESCE(p.last_name, m.ln)::text AS last_name,
         COALESCE(m.ph, p.phone)::text AS phone,
         m.spent, m.event_count::int, m.paid_count::int, m.ticket_count::int, m.table_count::int,
         m.order_count::int, m.guest_list_count::int, m.first_at, m.last_at, m.last_paid_at,
         NULLIF(btrim(COALESCE(p.city, '')), '')::text AS city,
         CASE WHEN p.birth_date IS NOT NULL THEN date_part('year', age(p.birth_date))::int END AS age,
         CASE
           WHEN lower(COALESCE(p.gender, '')) IN ('female', 'f', 'femme', 'woman', 'mujer') THEN 'female'
           WHEN lower(COALESCE(p.gender, '')) IN ('male', 'm', 'homme', 'man', 'hombre') THEN 'male'
           WHEN lower(COALESCE(p.gender, '')) IN ('other', 'autre', 'otro', 'non-binary', 'nb') THEN 'other'
         END::text AS gender,
         m.subscribed, m.src::text AS sub_source
    FROM merged m
    LEFT JOIN public.profiles p ON p.id = m.uid AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.uid AND u.deleted_at IS NULL)
   WHERE m.em IS NOT NULL AND position('@' in m.em) > 1;
$function$;

CREATE OR REPLACE FUNCTION public.count_campaign_recipients_org(p_organizer_user_id uuid, p_type text, p_audience_type text, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_count integer := 0;
BEGIN
  IF NOT (p_organizer_user_id = auth.uid() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_type = 'informational' AND p_audience_type = 'event_buyers' AND p_event_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT LOWER(t.user_email)) INTO v_count
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.event_id = p_event_id AND t.status = 'paid' AND t.user_email IS NOT NULL
      AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id);
    RETURN v_count;
  END IF;

  IF p_type = 'informational' AND p_audience_type = 'event_table_buyers' AND p_event_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT LOWER(tr.user_email)) INTO v_count
    FROM public.table_reservations tr
    JOIN public.events e ON e.id = tr.event_id
    WHERE tr.event_id = p_event_id AND tr.status = 'confirmed' AND tr.user_email IS NOT NULL
      AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id);
    RETURN v_count;
  END IF;

  IF p_type = 'informational' AND p_audience_type = 'event_all_buyers' AND p_event_id IS NOT NULL THEN
    WITH allowed AS (
      SELECT id FROM public.events
      WHERE id = p_event_id
        AND (organizer_user_id = p_organizer_user_id OR partner_organizer_id = p_organizer_user_id)
    ), emails AS (
      SELECT LOWER(user_email) AS e FROM public.tickets WHERE event_id IN (SELECT id FROM allowed) AND status = 'paid' AND user_email IS NOT NULL
      UNION
      SELECT LOWER(user_email) FROM public.table_reservations WHERE event_id IN (SELECT id FROM allowed) AND status = 'confirmed' AND user_email IS NOT NULL
    )
    SELECT COUNT(*) INTO v_count FROM emails;
    RETURN v_count;
  END IF;

  IF p_type = 'promotional' THEN
    IF p_audience_type = 'all_subscribers' THEN
      SELECT COUNT(*) INTO v_count FROM public.newsletter_subscriptions
      WHERE organizer_user_id = p_organizer_user_id AND opted_in = true;
    ELSIF p_audience_type = 'event_subscribers' AND p_event_id IS NOT NULL THEN
      SELECT COUNT(DISTINCT LOWER(t.user_email)) INTO v_count
      FROM public.tickets t
      JOIN public.newsletter_subscriptions ns
        ON LOWER(ns.email) = LOWER(t.user_email) AND ns.organizer_user_id = p_organizer_user_id
      JOIN public.events e ON e.id = t.event_id
      WHERE t.event_id = p_event_id AND t.status = 'paid' AND ns.opted_in = true
        AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id);
    ELSIF p_audience_type IN ('vip','regulars','new_customers','big_spenders','dormant') THEN
      WITH agg AS (
        SELECT LOWER(t.user_email) AS email,
               SUM(t.total_price)::numeric AS spent,
               COUNT(DISTINCT t.event_id) AS visits,
               MAX(t.created_at) AS last_seen
        FROM public.tickets t
        JOIN public.events e ON e.id = t.event_id
        WHERE t.status = 'paid' AND t.user_email IS NOT NULL
          AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id)
        GROUP BY LOWER(t.user_email)
      )
      SELECT COUNT(*) INTO v_count
      FROM public.newsletter_subscriptions ns
      JOIN agg a ON a.email = LOWER(ns.email)
      WHERE ns.organizer_user_id = p_organizer_user_id AND ns.opted_in = true
        AND CASE p_audience_type
          WHEN 'vip' THEN a.spent >= 500
          WHEN 'regulars' THEN a.visits BETWEEN 2 AND 4
          WHEN 'new_customers' THEN a.visits = 1
          WHEN 'big_spenders' THEN a.spent >= 1000
          WHEN 'dormant' THEN a.last_seen < now() - interval '90 days'
          ELSE FALSE
        END;
    END IF;
  END IF;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_organizer_customer_segments(p_organizer_user_id uuid)
 RETURNS TABLE(id text, user_id uuid, email text, first_name text, last_name text, phone text, first_visit_at timestamp with time zone, last_visit_at timestamp with time zone, total_spent numeric, ticket_count integer, order_count integer, table_count integer, is_banned boolean, banned_at timestamp with time zone, ban_reason text, notes text, revenue_30d numeric, revenue_90d numeric, revenue_prev_90d numeric, avg_basket numeric, visit_nights integer, visits_per_month numeric, last_activity_at timestamp with time zone, preferred_dow integer, preferred_event_title text, recency_days integer, rfm_r integer, rfm_f integer, rfm_m integer, rfm_segment text, rfm_tier text, churn_risk boolean, guest_list_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT can_manage_organizer(p_organizer_user_id) THEN
    RAISE EXCEPTION 'Not authorized for organizer %', p_organizer_user_id USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH organizer_events AS (
    SELECT e.id, e.start_at, e.title
    FROM events e
    WHERE e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id
  ),
  -- Revenu organisateur = montant facturé − frais Yuno (billets + tables).
  activity AS (
    SELECT lower(t.user_email) AS em,
           (t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0))::numeric AS amount,
           t.created_at, t.event_id, 'ticket'::text AS kind,
           t.user_id, t.full_name, t.guest_first_name, t.guest_last_name,
           NULLIF(btrim(COALESCE(t.phone, t.guest_phone, '')), '') AS phone
    FROM tickets t JOIN organizer_events oe ON oe.id = t.event_id
    WHERE t.user_email IS NOT NULL AND t.paid_at IS NOT NULL
    UNION ALL
    SELECT lower(tr.user_email),
           (tr.total_price - COALESCE(tr.service_fee, 0) - COALESCE(tr.management_fee, 0))::numeric,
           tr.created_at, tr.event_id, 'table'::text,
           tr.user_id, tr.full_name, tr.guest_first_name, tr.guest_last_name,
           NULLIF(btrim(COALESCE(tr.phone, tr.guest_phone, '')), '')
    FROM table_reservations tr JOIN organizer_events oe ON oe.id = tr.event_id
    WHERE tr.user_email IS NOT NULL AND tr.paid_at IS NOT NULL
    UNION ALL
    -- Guest list : montant 0, mais c'est une PERSONNE de plus dans le fichier
    -- client. Sur une soirée en entrée libre (aucune billetterie, aucune table)
    -- c'est la SEULE activité qui existe : sans cette branche, l'organisateur
    -- terminait sa soirée avec un fichier client vide.
    SELECT lower(gle.email),
           0::numeric,
           gle.created_at, gl.event_id, 'guestlist'::text,
           gle.user_id, gle.full_name, NULL::text, NULL::text,
           NULLIF(btrim(COALESCE(gle.phone, '')), '')
    FROM guest_list_entries gle
    JOIN guest_lists gl ON gl.id = gle.guest_list_id
    JOIN organizer_events oe ON oe.id = gl.event_id
    WHERE gle.email IS NOT NULL
      AND btrim(gle.email) <> ''
      AND gle.status <> 'cancelled'
  ),
  agg AS (
    SELECT a.em,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '30 days'), 0) AS revenue_30d,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '90 days'), 0) AS revenue_90d,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '180 days'
                                       AND a.created_at < now() - interval '90 days'), 0) AS revenue_prev_90d,
      COALESCE(sum(a.amount), 0) AS total_spent,
      COALESCE(avg(a.amount) FILTER (WHERE a.kind <> 'guestlist'), 0) AS avg_basket,
      count(*) FILTER (WHERE a.kind = 'ticket') AS ticket_count,
      count(*) FILTER (WHERE a.kind = 'table') AS table_count,
      count(*) FILTER (WHERE a.kind = 'guestlist') AS guest_list_count,
      count(DISTINCT date(a.created_at)) AS visit_nights,
      max(a.created_at) AS last_activity_at,
      min(a.created_at) AS first_activity_at
    FROM activity a GROUP BY a.em
  ),
  -- Dernière valeur NON NULLE de chaque champ, jamais « la dernière ligne » :
  -- une inscription guest list sans numéro effaçait le téléphone laissé lors
  -- d'un achat précédent, et la fiche client s'ouvrait sans coordonnées.
  ident AS (
    SELECT a.em,
      (array_agg(a.user_id ORDER BY a.created_at DESC) FILTER (WHERE a.user_id IS NOT NULL))[1] AS user_id,
      (array_agg(a.full_name ORDER BY a.created_at DESC) FILTER (WHERE a.full_name IS NOT NULL))[1] AS full_name,
      (array_agg(a.guest_first_name ORDER BY a.created_at DESC) FILTER (WHERE a.guest_first_name IS NOT NULL))[1] AS guest_first_name,
      (array_agg(a.guest_last_name ORDER BY a.created_at DESC) FILTER (WHERE a.guest_last_name IS NOT NULL))[1] AS guest_last_name,
      (array_agg(a.phone ORDER BY a.created_at DESC) FILTER (WHERE a.phone IS NOT NULL))[1] AS phone
    FROM activity a GROUP BY a.em
  ),
  event_activity AS (
    SELECT a.em, a.event_id, oe.start_at, oe.title, count(*) AS cnt
    FROM activity a JOIN organizer_events oe ON oe.id = a.event_id
    WHERE a.event_id IS NOT NULL
    GROUP BY a.em, a.event_id, oe.start_at, oe.title
  ),
  pref_event AS (
    SELECT DISTINCT ON (ea.em) ea.em, ea.title AS preferred_event_title
    FROM event_activity ea ORDER BY ea.em, ea.cnt DESC, ea.start_at DESC
  ),
  pref_dow AS (
    SELECT s.em, s.dow FROM (
      SELECT ea.em, extract(dow FROM ea.start_at)::int AS dow,
             row_number() OVER (PARTITION BY ea.em ORDER BY sum(ea.cnt) DESC) AS rn
      FROM event_activity ea GROUP BY ea.em, extract(dow FROM ea.start_at)
    ) s WHERE s.rn = 1
  ),
  base AS (
    SELECT
      ag.em AS c_id,
      COALESCE(id_.user_id, p.id) AS c_user_id,
      ag.em AS c_email,
      COALESCE(p.first_name, id_.guest_first_name,
               NULLIF(split_part(COALESCE(id_.full_name, ''), ' ', 1), '')) AS c_first_name,
      COALESCE(p.last_name, id_.guest_last_name,
               NULLIF(substr(COALESCE(id_.full_name, ''), strpos(COALESCE(id_.full_name, '') || ' ', ' ') + 1), '')) AS c_last_name,
      COALESCE(id_.phone, p.phone) AS c_phone,
      ag.first_activity_at AS c_first_visit_at,
      ag.last_activity_at AS c_last_visit_at,
      round(ag.total_spent, 2) AS c_total_spent,
      ag.ticket_count::int AS c_ticket_count,
      ag.table_count::int AS c_table_count,
      ag.guest_list_count::int AS c_guest_list_count,
      (b.email IS NOT NULL) AS c_is_banned, b.banned_at AS c_banned_at, b.ban_reason AS c_ban_reason,
      n.notes AS c_notes,
      ag.revenue_30d AS c_revenue_30d, ag.revenue_90d AS c_revenue_90d,
      ag.revenue_prev_90d AS c_revenue_prev_90d, ag.avg_basket AS c_avg_basket,
      COALESCE(ag.visit_nights, 0)::int AS c_visit_nights,
      CASE
        WHEN ag.first_activity_at IS NULL THEN 0
        ELSE round(
          ag.visit_nights::numeric /
          greatest(1, extract(epoch FROM (ag.last_activity_at - ag.first_activity_at)) / 2592000.0),
          2)
      END AS c_visits_per_month,
      ag.last_activity_at AS c_last_activity_at,
      pd.dow AS c_preferred_dow, pe.preferred_event_title AS c_preferred_event_title,
      floor(extract(epoch FROM (now() - COALESCE(ag.last_activity_at, ag.first_activity_at, now()))) / 86400)::int AS c_recency_days,
      CASE WHEN COALESCE(ag.visit_nights, 0) > 0 THEN ag.visit_nights::int
           ELSE (ag.ticket_count + ag.table_count + ag.guest_list_count)::int
      END AS c_rfm_freq,
      round(ag.total_spent, 2) AS c_rfm_money
    FROM agg ag
    LEFT JOIN ident id_ ON id_.em = ag.em
    -- Un email peut porter PLUSIEURS profils (comptes orphelins, comptes
    -- vitrine). Un LEFT JOIN direct dupliquait alors la ligne client. On n'en
    -- retient qu'un : celui qui a réellement fait l'activité, sinon le plus récent.
    LEFT JOIN LATERAL (
      SELECT pr.id, pr.first_name, pr.last_name, NULLIF(btrim(COALESCE(pr.phone, '')), '') AS phone
      FROM profiles pr
      WHERE lower(pr.email) = ag.em
      ORDER BY (pr.id = id_.user_id) DESC NULLS LAST, pr.created_at DESC
      LIMIT 1
    ) p ON true
    LEFT JOIN organizer_banned_emails b ON b.organizer_user_id = p_organizer_user_id AND b.email = ag.em
    LEFT JOIN organizer_customer_notes n ON n.organizer_user_id = p_organizer_user_id AND n.email = ag.em
    LEFT JOIN pref_event pe ON pe.em = ag.em
    LEFT JOIN pref_dow pd ON pd.em = ag.em
  ),
  ranked AS (
    SELECT b.*,
      count(*) OVER () AS n_total,
      (rank() OVER (ORDER BY b.c_rfm_freq) - 1)::numeric  AS freq_below,
      (rank() OVER (ORDER BY b.c_rfm_money) - 1)::numeric AS mon_below
    FROM base b
  ),
  scored AS (
    -- Règle identique au club, au mot près (cf. _venue_customer_rfm).
    SELECT rk.*,
      CASE WHEN rk.c_recency_days <= 14 THEN 5
           WHEN rk.c_recency_days <= 30 THEN 4
           WHEN rk.c_recency_days <= 60 THEN 3
           WHEN rk.c_recency_days <= 90 THEN 2
           ELSE 1 END AS s_r,
      CASE WHEN rk.n_total <= 1 THEN 3
           ELSE least(5, greatest(1, floor((rk.freq_below / (rk.n_total - 1)) * 5)::int + 1))
      END AS rel_f,
      CASE WHEN rk.n_total <= 1 THEN 3
           ELSE least(5, greatest(1, floor((rk.mon_below / (rk.n_total - 1)) * 5)::int + 1))
      END AS s_m,
      CASE WHEN rk.c_rfm_freq >= 10 THEN 5
           WHEN rk.c_rfm_freq >= 6 THEN 4
           WHEN rk.c_rfm_freq >= 3 THEN 3
           WHEN rk.c_rfm_freq >= 2 THEN 2
           ELSE 1 END AS abs_f
    FROM ranked rk
  ),
  blended AS (
    SELECT s.*,
      least(5, greatest(1, least(greatest(s.rel_f, s.abs_f - 1), s.abs_f + 1))) AS s_f
    FROM scored s
  )
  SELECT
    s.c_id, s.c_user_id, s.c_email, s.c_first_name, s.c_last_name, s.c_phone,
    s.c_first_visit_at, s.c_last_visit_at, s.c_total_spent,
    s.c_ticket_count, 0 AS order_count, s.c_table_count,
    s.c_is_banned, s.c_banned_at, s.c_ban_reason, s.c_notes,
    s.c_revenue_30d, s.c_revenue_90d, s.c_revenue_prev_90d, s.c_avg_basket,
    s.c_visit_nights, s.c_visits_per_month,
    s.c_last_activity_at, s.c_preferred_dow, s.c_preferred_event_title,
    s.c_recency_days,
    s.s_r::int, s.s_f::int, s.s_m::int,
    (CASE
      WHEN s.s_r >= 4 AND s.s_f >= 4 THEN 'champions'
      -- « Était régulier, se met en silence » passe AVANT « fidèle » : un
      -- habitué muet depuis trois mois est le client à rappeler ce soir, pas
      -- une ligne rassurante dans le camembert. L'ordre inverse le rangeait en
      -- « Fidèles » et le club ne le voyait jamais partir.
      WHEN s.s_r <= 2 AND s.s_f >= 3 THEN 'at_risk'
      WHEN s.s_f >= 4 THEN 'loyal'
      WHEN s.s_r >= 4 AND s.s_f <= 2 THEN CASE WHEN s.s_m >= 3 THEN 'promising' ELSE 'new' END
      WHEN s.s_r >= 3 THEN 'loyal'
      WHEN s.s_r = 2 THEN 'dormant'
      ELSE 'lost'
    END)::text,
    (CASE
      WHEN s.s_m >= 5 THEN 'platinum'
      WHEN s.s_m >= 4 THEN 'gold'
      WHEN s.s_m >= 2 THEN 'silver'
      ELSE 'bronze'
    END)::text,
    (s.s_f >= 3 AND s.c_recency_days > 45 AND s.c_recency_days <= 180),
    s.c_guest_list_count
  FROM blended s
  ORDER BY s.c_last_visit_at DESC NULLS LAST;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_audience_revenue(p_subject_type text, p_subject_id text, p_from timestamp with time zone DEFAULT (now() - '90 days'::interval), p_to timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result   jsonb;
  v_org    uuid := CASE WHEN p_subject_type = 'organizer' THEN nullif(p_subject_id, '')::uuid END;
  v_agency uuid := CASE WHEN p_subject_type = 'agency'    THEN nullif(p_subject_id, '')::uuid END;
BEGIN
  IF NOT public.can_read_audience(p_subject_type, p_subject_id) THEN
    RETURN jsonb_build_object('ok', false,
             'reason', CASE WHEN auth.uid() IS NULL THEN 'not_authenticated' ELSE 'forbidden' END);
  END IF;

  IF p_subject_type = 'dj' THEN
    RETURN jsonb_build_object('ok', true, 'supported', false, 'reason', 'dj_revenue_via_conversion_hub');
  END IF;

  WITH members AS (
    SELECT user_id FROM public.audience_members(p_subject_type, p_subject_id)
  ),
  scoped_events AS (
    SELECT e.id FROM public.events e
    WHERE (p_subject_type = 'venue'
             AND (e.venue_id = p_subject_id OR e.partner_venue_id = p_subject_id))
       OR (p_subject_type = 'organizer'
             AND (e.organizer_user_id = v_org OR e.partner_organizer_id = v_org))
       OR (p_subject_type = 'agency' AND EXISTS (
             SELECT 1 FROM public.agency_venue_contracts avc
              WHERE avc.agency_id = v_agency AND avc.status = 'active'
                AND ((avc.venue_id IS NOT NULL AND avc.venue_id = e.venue_id)
                  OR (avc.organizer_user_id IS NOT NULL AND avc.organizer_user_id = e.organizer_user_id))
           ))
  ),
  sales AS (
    SELECT t.user_id, lower(nullif(trim(t.user_email), '')) AS email,
           (t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0)) AS gross,
           coalesce(t.refund_amount, 0) AS refund
      FROM public.tickets t
     WHERE t.event_id IN (SELECT id FROM scoped_events) AND t.status = 'paid'
       AND t.created_at BETWEEN p_from AND p_to
    UNION ALL
    SELECT r.user_id, lower(nullif(trim(r.user_email), '')),
           (r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0)),
           coalesce(r.refund_amount, 0)
      FROM public.table_reservations r
     WHERE r.event_id IN (SELECT id FROM scoped_events) AND r.status = 'paid'
       AND r.created_at BETWEEN p_from AND p_to
    UNION ALL
    SELECT o.user_id, lower(nullif(trim(o.user_email), '')),
           (o.total - coalesce(o.service_fee, 0)),
           coalesce(o.refund_amount, 0)
      FROM public.orders o
     WHERE o.status IN ('paid', 'served')
       AND o.created_at BETWEEN p_from AND p_to
       AND ((p_subject_type = 'venue'     AND o.venue_id = p_subject_id)
         OR (p_subject_type = 'organizer' AND o.event_id IN (SELECT id FROM scoped_events))
         OR (p_subject_type = 'agency'    AND o.event_id IN (SELECT id FROM scoped_events)))
  ),
  resolved AS (
    SELECT s.gross, s.refund,
      coalesce(s.user_id,
               (SELECT pr.id FROM public.profiles pr
                 WHERE s.email IS NOT NULL AND lower(pr.email) = s.email LIMIT 1)) AS buyer_uid
    FROM sales s
  ),
  tagged AS (
    SELECT r.gross, r.refund,
      EXISTS (SELECT 1 FROM members mm WHERE mm.user_id = r.buyer_uid) AS is_follower
    FROM resolved r
  )
  SELECT jsonb_build_object(
    'ok', true, 'supported', true,
    'from', p_from, 'to', p_to,
    'followers', jsonb_build_object(
      'orders', (SELECT count(*) FROM tagged WHERE is_follower),
      'gross',  (SELECT round(coalesce(sum(gross), 0)::numeric, 2)        FROM tagged WHERE is_follower),
      'net',    (SELECT round(coalesce(sum(gross - refund), 0)::numeric, 2) FROM tagged WHERE is_follower)
    ),
    'non_followers', jsonb_build_object(
      'orders', (SELECT count(*) FROM tagged WHERE NOT is_follower),
      'gross',  (SELECT round(coalesce(sum(gross), 0)::numeric, 2)        FROM tagged WHERE NOT is_follower),
      'net',    (SELECT round(coalesce(sum(gross - refund), 0)::numeric, 2) FROM tagged WHERE NOT is_follower)
    ),
    'follower_share', (
      SELECT CASE WHEN coalesce(sum(gross), 0) > 0
                  THEN round(100.0 * coalesce(sum(gross) FILTER (WHERE is_follower), 0) / sum(gross), 1)
                  ELSE 0 END
      FROM tagged
    )
  ) INTO result;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_events_pnl(p_venue_id text DEFAULT NULL::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      auth.uid() = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif p_venue_id is null
     or not (public.is_venue_owner(auth.uid(), p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  with evs as (
    select e.id, e.title, e.start_at
    from public.events e
    where (
          (p_venue_id is not null and e.venue_id = p_venue_id)
       or (p_organizer_user_id is not null and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id))
      )
      -- Une soirée est dans la période si elle y tombe OU si elle a encaissé
      -- (billet, table, commande) ou reçu un inscrit guest list pendant la
      -- période : une soirée à venir qui vend cette semaine a sa ligne.
      and (
        ((p_from is null or e.start_at >= p_from) and (p_to is null or e.start_at <= p_to))
        or exists (select 1 from public.tickets t where t.event_id = e.id and t.status = 'paid'
                   and (p_from is null or t.created_at >= p_from) and (p_to is null or t.created_at <= p_to))
        or exists (select 1 from public.table_reservations r where r.event_id = e.id and r.status = 'paid'
                   and (p_from is null or r.created_at >= p_from) and (p_to is null or r.created_at <= p_to))
        or (p_venue_id is not null and exists (select 1 from public.orders o where o.event_id = e.id and o.status in ('paid','served')
                   and (p_from is null or o.created_at >= p_from) and (p_to is null or o.created_at <= p_to)))
        or exists (select 1 from public.guest_lists gl join public.guest_list_entries x on x.guest_list_id = gl.id
                   where gl.event_id = e.id and x.status <> 'cancelled'
                   and (p_from is null or x.created_at >= p_from) and (p_to is null or x.created_at <= p_to))
      )
  ),
  tk as (
    select t.event_id,
      coalesce(sum(greatest(t.total_price - coalesce(t.service_fee,0) - coalesce(t.insurance_fee,0), 0))
        filter (where t.status = 'paid'), 0)                                   as revenue,
      coalesce(sum(t.quantity) filter (where t.status = 'paid'), 0)             as cnt,
      coalesce(sum(t.quantity) filter (where t.status = 'paid' and coalesce(t.entry_scanned,false)), 0) as scanned,
      coalesce(sum(coalesce(t.refund_amount,0)) filter (where t.status = 'refunded' or t.refund_amount > 0), 0) as refunds
    from public.tickets t
    join evs on evs.id = t.event_id
    group by t.event_id
  ),
  dr as (
    select o.event_id,
      coalesce(sum(greatest(o.total - coalesce(o.service_fee,0), 0))
        filter (where o.status in ('paid','served')), 0)                       as revenue,
      coalesce(count(*) filter (where o.status in ('paid','served')), 0)        as cnt,
      coalesce(sum(coalesce(o.refund_amount,0)) filter (where o.status = 'refunded' or o.refund_amount > 0), 0) as refunds
    from public.orders o
    join evs on evs.id = o.event_id
    where p_venue_id is not null
    group by o.event_id
  ),
  tb as (
    select r.event_id,
      coalesce(sum(greatest(r.total_price - coalesce(r.service_fee,0) - coalesce(r.management_fee,0), 0))
        filter (where r.status = 'paid'), 0)                                    as revenue,
      coalesce(count(*) filter (where r.status = 'paid'), 0)                     as cnt,
      coalesce(sum(coalesce(r.guest_count,0))
        filter (where r.status = 'paid' and (r.checked_in_at is not null or coalesce(r.entry_scanned,false))), 0) as guests_arrived,
      coalesce(sum(coalesce(r.refund_amount,0)) filter (where r.status = 'refunded' or r.refund_amount > 0), 0) as refunds
    from public.table_reservations r
    join evs on evs.id = r.event_id
    group by r.event_id
  ),
  glist as (
    select gl.event_id,
      count(gle.id)                                          as signups,
      count(gle.id) filter (where coalesce(gle.entry_scanned,false)) as arrived
    from public.guest_lists gl
    join evs on evs.id = gl.event_id
    left join public.guest_list_entries gle on gle.guest_list_id = gl.id
    group by gl.event_id
  )
  select jsonb_build_object(
    'ok', true,
    'events', coalesce((
      select jsonb_agg(row_to_json(x) order by x.start_at desc) from (
        select
          evs.id                                        as event_id,
          evs.title                                     as title,
          evs.start_at                                  as start_at,
          coalesce(tk.revenue,0)                        as tickets_revenue,
          coalesce(tk.cnt,0)                            as tickets_count,
          coalesce(dr.revenue,0)                        as drinks_revenue,
          coalesce(dr.cnt,0)                            as drinks_orders,
          coalesce(tb.revenue,0)                        as tables_revenue,
          coalesce(tb.cnt,0)                            as tables_count,
          coalesce(glist.signups,0)                     as guestlist_signups,
          coalesce(glist.arrived,0)                     as guestlist_arrived,
          coalesce(tk.scanned,0) + coalesce(tb.guests_arrived,0) + coalesce(glist.arrived,0) as attendance,
          coalesce(tk.refunds,0) + coalesce(dr.refunds,0) + coalesce(tb.refunds,0)           as refunds,
          coalesce(tk.revenue,0) + coalesce(dr.revenue,0) + coalesce(tb.revenue,0)           as gross,
          (coalesce(tk.revenue,0) + coalesce(dr.revenue,0) + coalesce(tb.revenue,0))
            - (coalesce(tk.refunds,0) + coalesce(dr.refunds,0) + coalesce(tb.refunds,0))     as net
        from evs
        left join tk    on tk.event_id = evs.id
        left join dr    on dr.event_id = evs.id
        left join tb    on tb.event_id = evs.id
        left join glist on glist.event_id = evs.id
      ) x
      where x.gross > 0 or x.guestlist_signups > 0
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_sales_overview(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT 'last4'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_now    timestamptz := now();
  v_money  boolean := false;
  v_is_org boolean := p_organizer_user_id is not null;
  v_tz     text := 'Europe/Paris';
  v_from   timestamptz;
  v_limit  integer;
  v_result jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if v_is_org then
    if not (
      v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(v_uid, p_organizer_user_id, 'editor')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_money := v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.org_member_has_permission(v_uid, p_organizer_user_id, 'view_finance');
  elsif p_venue_id is null
     or not (public.can_manage_venue(v_uid, p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  else
    v_money := public.is_super_admin()
      or exists (select 1 from public.venues v where v.id = p_venue_id and v.owner_id = v_uid)
      or exists (
        select 1 from public.manager_permissions mp
        where mp.user_id = v_uid and mp.venue_id = p_venue_id
          and (coalesce(mp.can_view_analytics, false) or coalesce(mp.can_view_finance, false))
      );
    select coalesce(v.timezone, 'Europe/Paris') into v_tz from public.venues v where v.id = p_venue_id;
  end if;

  v_from := case p_period
    when 'month' then date_trunc('month', v_now at time zone v_tz) at time zone v_tz
    when 'year'  then date_trunc('year',  v_now at time zone v_tz) at time zone v_tz
    else null
  end;
  v_limit := case p_period when 'last' then 1 when 'last4' then 4 else null end;

  with
  -- Toutes les soirées commencées de la portée, de la plus récente à la plus
  -- ancienne ; `rn` numérote cette file.
  scope as materialized (
    select e.id, e.title, e.start_at, coalesce(e.poster_url, e.image_url) as poster,
           e.max_tickets, e.venue_id, e.partner_venue_id,
           case when v_is_org then v_money else v_money and e.venue_id = p_venue_id end as show_money,
           row_number() over (order by e.start_at desc) as rn
    from public.events e
    -- Soirées TERMINÉES : une soirée en cours (entrées partielles) n'est pas
    -- « la dernière soirée ».
    where coalesce(e.end_at, e.start_at + interval '8 hours') <= v_now
      and e.cancelled_at is null
      and coalesce(e.status, 'active') <> 'cancelled'
      and (
           (not v_is_org and (e.venue_id = p_venue_id or e.partner_venue_id = p_venue_id))
        or (v_is_org and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id))
      )
    order by e.start_at desc
    limit 1000
  ),
  cur_n as (
    select count(*)::integer as n from scope s
    where (v_limit is null or s.rn <= v_limit)
      and (v_from is null or s.start_at >= v_from)
  ),
  -- Période courante = les N premières ; précédente = les N suivantes.
  -- « Tout » n'a pas de période précédente.
  nights as materialized (
    select s.*, case when s.rn <= c.n then 'cur' else 'prev' end as bucket
    from scope s cross join cur_n c
    where s.rn <= c.n
       or (p_period <> 'all' and c.n > 0 and s.rn > c.n and s.rn <= 2 * c.n)
  ),

  tk as (
    select t.event_id,
           sum(greatest(coalesce(t.quantity, 1), 1)) as sold,
           count(*) as orders,
           sum(greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
               - least(greatest(coalesce(t.refund_amount, 0), 0),
                       greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))) as amount,
           sum(case when coalesce(t.total_price, 0) > 0 then round(t.total_price * 0.015 + 0.25, 2) else 0 end) as stripe,
           sum(greatest(coalesce(t.quantity, 1), 1))
             filter (where coalesce(t.entry_scanned, false) or coalesce(t.used, false) or t.status = 'used') as entered
    from public.tickets t
    join nights n on n.id = t.event_id
    where t.status in ('paid', 'used')
    group by t.event_id
  ),
  tb as (
    select r.event_id,
           count(*) as booked,
           sum(greatest(coalesce(r.guest_count, 0), 0)) as guests,
           sum(greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0)
               - least(greatest(coalesce(r.refund_amount, 0), 0),
                       greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0))) as amount,
           sum(case when coalesce(r.payment_mode, 'online') <> 'on_site' and coalesce(r.total_price, 0) > 0
                    then round(r.total_price * 0.015 + 0.25, 2) else 0 end) as stripe,
           count(*) filter (where coalesce(r.entry_scanned, false) or r.checked_in_at is not null) as arrived,
           sum(greatest(coalesce(r.guest_count, 0), 1))
             filter (where coalesce(r.entry_scanned, false) or r.checked_in_at is not null) as entered
    from public.table_reservations r
    join nights n on n.id = r.event_id
    where r.status in ('paid', 'confirmed')
    group by r.event_id
  ),
  dr as (
    select o.event_id,
           count(*) as orders,
           sum(greatest(o.total - coalesce(o.service_fee, 0), 0)
               - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))) as amount,
           sum(case when coalesce(o.total, 0) > 0 then round(o.total * 0.015 + 0.25, 2) else 0 end) as stripe
    from public.orders o
    join nights n on n.id = o.event_id
    where not v_is_org
      and o.status in ('paid', 'served')
    group by o.event_id
  ),
  gl as (
    select g.event_id,
           count(*) as registered,
           count(*) filter (where coalesce(e2.entry_scanned, false)) as entered
    from public.guest_list_entries e2
    join public.guest_lists g on g.id = e2.guest_list_id
    join nights n on n.id = g.event_id
    where e2.status <> 'cancelled'
    group by g.event_id
  ),
  caps as (
    select n.id as event_id,
           -- Même capacité que get_event_report : un palier illimité rend la
           -- jauge sans capacité (pas un remplissage au-delà de 100 %).
           case when coalesce(n.max_tickets, 0) > 0 then n.max_tickets
                when exists (select 1 from public.ticket_rounds tr where tr.event_id = n.id)
                 and not exists (select 1 from public.ticket_rounds tr where tr.event_id = n.id and coalesce(tr.max_tickets, 0) <= 0)
                  then (select sum(tr.max_tickets) from public.ticket_rounds tr where tr.event_id = n.id)
                else null end as cap
    from nights n
  ),
  -- Personnes distinctes par soirée et par période (tous piliers).
  people as (
    select n.bucket, n.id as event_id, lower(trim(x.email)) as email
    from nights n
    join lateral (
      select t.user_email as email from public.tickets t where t.event_id = n.id and t.status in ('paid', 'used')
      union all
      select r.user_email from public.table_reservations r where r.event_id = n.id and r.status in ('paid', 'confirmed')
      union all
      select o.user_email from public.orders o where not v_is_org and o.event_id = n.id and o.status in ('paid', 'served')
      union all
      select e2.email from public.guest_list_entries e2 join public.guest_lists g on g.id = e2.guest_list_id
       where g.event_id = n.id and e2.status <> 'cancelled'
    ) x on true
    where nullif(trim(x.email), '') is not null
  ),
  per_night as (
    select n.id, n.title, n.start_at, n.poster, n.bucket, n.rn, n.show_money,
           coalesce(tk.sold, 0) as tickets, coalesce(tk.orders, 0) as ticket_orders,
           coalesce(tb.booked, 0) as tables, coalesce(tb.guests, 0) as table_guests, coalesce(tb.arrived, 0) as tables_arrived,
           coalesce(dr.orders, 0) as bar_orders,
           coalesce(gl.registered, 0) as gl_registered, coalesce(gl.entered, 0) as gl_entered,
           coalesce(tk.entered, 0) + coalesce(tb.entered, 0) + coalesce(gl.entered, 0) as entries,
           coalesce(tk.entered, 0) as ticket_entries,
           case when n.show_money then coalesce(tk.amount, 0) else 0 end as rev_tickets,
           case when n.show_money then coalesce(tb.amount, 0) else 0 end as rev_tables,
           case when n.show_money then coalesce(dr.amount, 0) else 0 end as rev_bar,
           case when n.show_money then coalesce(tk.stripe, 0) + coalesce(tb.stripe, 0) + coalesce(dr.stripe, 0) else 0 end as stripe,
           caps.cap,
           (select count(distinct p.email) from people p where p.event_id = n.id) as customers
    from nights n
    left join tk on tk.event_id = n.id
    left join tb on tb.event_id = n.id
    left join dr on dr.event_id = n.id
    left join gl on gl.event_id = n.id
    left join caps on caps.event_id = n.id
  ),
  totals as (
    select b.bucket,
           count(pn.id) as nights,
           coalesce(sum(pn.rev_tickets + pn.rev_tables + pn.rev_bar), 0) as revenue,
           coalesce(sum(pn.rev_tickets), 0) as rev_tickets,
           coalesce(sum(pn.rev_tables), 0) as rev_tables,
           coalesce(sum(pn.rev_bar), 0) as rev_bar,
           coalesce(sum(pn.stripe), 0) as stripe,
           coalesce(sum(pn.entries), 0) as entries,
           coalesce(sum(pn.ticket_entries), 0) as ticket_entries,
           coalesce(sum(pn.tickets), 0) as tickets,
           coalesce(sum(pn.ticket_orders), 0) as ticket_orders,
           coalesce(sum(pn.tables), 0) as tables,
           coalesce(sum(pn.table_guests), 0) as table_guests,
           coalesce(sum(pn.tables_arrived), 0) as tables_arrived,
           coalesce(sum(pn.bar_orders), 0) as bar_orders,
           coalesce(sum(pn.gl_registered), 0) as gl_registered,
           coalesce(sum(pn.gl_entered), 0) as gl_entered,
           coalesce(sum(pn.cap) filter (where pn.cap > 0), 0) as ticket_cap,
           coalesce(sum(pn.tickets) filter (where pn.cap > 0), 0) as tickets_with_cap,
           -- Dénominateurs justes (revue du 25/09) : la dépense par tête ne
           -- compte que les soirées dont on voit l'argent ET où la porte a
           -- scanné ; la présence, que les soirées où la porte a scanné (sans
           -- scan, « pas scanné » ne veut pas dire « pas venu ») ; prix moyens
           -- sur les soirées dont on voit l'argent.
           count(pn.id) filter (where pn.show_money) as money_nights,
           coalesce(sum(pn.rev_tickets + pn.rev_tables + pn.rev_bar) filter (where pn.show_money and pn.entries > 0), 0) as spend_revenue,
           coalesce(sum(pn.entries) filter (where pn.show_money and pn.entries > 0), 0) as spend_entries,
           coalesce(sum(pn.entries) filter (where pn.entries > 0), 0) as presence_entries,
           coalesce(sum(pn.tickets + pn.table_guests + pn.gl_registered) filter (where pn.entries > 0), 0) as presence_expected,
           coalesce(sum(pn.gl_registered) filter (where pn.gl_entered > 0), 0) as gl_presence_registered,
           coalesce(sum(pn.gl_entered) filter (where pn.gl_entered > 0), 0) as gl_presence_entered,
           coalesce(sum(pn.tables) filter (where pn.tables_arrived > 0), 0) as tables_presence_booked,
           coalesce(sum(pn.tables_arrived) filter (where pn.tables_arrived > 0), 0) as tables_presence_arrived,
           coalesce(sum(pn.tickets) filter (where pn.show_money), 0) as money_tickets,
           coalesce(sum(pn.tables) filter (where pn.show_money), 0) as money_tables,
           coalesce(sum(pn.bar_orders) filter (where pn.show_money), 0) as money_bar_orders,
           (select count(distinct p.email) from people p where p.bucket = b.bucket) as customers
    from (values ('cur'), ('prev')) b(bucket)
    left join per_night pn on pn.bucket = b.bucket
    group by b.bucket
  ),
  -- Détail des piliers, période courante seulement.
  rounds_list as (
    select tr.name,
           sum(greatest(coalesce(t.quantity, 1), 1)) as sold,
           sum(case when n.show_money then
               greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
               - least(greatest(coalesce(t.refund_amount, 0), 0),
                       greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))
               else 0 end) as amount
    from public.tickets t
    join nights n on n.id = t.event_id and n.bucket = 'cur'
    join public.ticket_rounds tr on tr.id = t.ticket_round_id
    where t.status in ('paid', 'used')
    group by tr.name
    order by 2 desc
    limit 12
  ),
  packs_list as (
    select coalesce(p.name, '—') as name,
           count(*) as booked,
           sum(greatest(coalesce(r.guest_count, 0), 0)) as guests,
           sum(case when n.show_money then
               greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0)
               - least(greatest(coalesce(r.refund_amount, 0), 0),
                       greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0))
               else 0 end) as amount
    from public.table_reservations r
    join nights n on n.id = r.event_id and n.bucket = 'cur'
    left join public.table_packs p on p.id = r.pack_id
    where r.status in ('paid', 'confirmed')
    group by 1
    order by 4 desc, 2 desc
    limit 12
  ),
  -- Montant d'un produit = sa part du CA CLUB de la commande (fees.ts : total
  -- − frais Yuno, remboursement déduit), au prorata du prix carte : la somme
  -- des produits retombe exactement sur le CA du bar, jamais au-dessus.
  order_lines as (
    select o.id as order_id,
           it.value ->> 'name' as name,
           greatest(coalesce((it.value ->> 'quantity')::numeric, (it.value ->> 'qty')::numeric, 1), 1) as qty,
           greatest(coalesce((it.value ->> 'quantity')::numeric, (it.value ->> 'qty')::numeric, 1), 1)
             * greatest(coalesce((it.value ->> 'price')::numeric, 0), 0) as gross,
           greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0)) as order_net
    from public.orders o
    join nights n on n.id = o.event_id and n.bucket = 'cur' and n.show_money
    cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) it
    where not v_is_org and o.status in ('paid', 'served')
      and nullif(it.value ->> 'name', '') is not null
  ),
  products_list as (
    select l.name,
           sum(l.qty) as qty,
           round(sum(case when t.gross_total > 0 then l.order_net * l.gross / t.gross_total else 0 end), 2) as amount
    from order_lines l
    join (select order_id, sum(gross) as gross_total from order_lines group by 1) t on t.order_id = l.order_id
    group by 1
    order by 2 desc
    limit 10
  ),
  bar_service as (
    select percentile_cont(0.5) within group (
             order by extract(epoch from (o.served_at - coalesce(o.paid_at, o.created_at))) / 60.0
           ) as median_min,
           count(*) as sample
    from public.orders o
    join nights n on n.id = o.event_id and n.bucket = 'cur'
    where not v_is_org and o.status = 'served' and o.served_at is not null
      and o.served_at > coalesce(o.paid_at, o.created_at)
      and o.served_at < coalesce(o.paid_at, o.created_at) + interval '3 hours'
  ),
  holders_list as (
    select case g.holder_type
             when 'club' then 'club' when 'organizer' then 'organizer' else coalesce(nullif(g.holder_label, ''), g.holder_type)
           end as name,
           g.holder_type as kind,
           count(*) as registered,
           count(*) filter (where coalesce(e2.entry_scanned, false)) as entered
    from public.guest_list_entries e2
    join public.guest_lists g on g.id = e2.guest_list_id
    join nights n on n.id = g.event_id and n.bucket = 'cur'
    where e2.status <> 'cancelled'
    group by 1, 2
    order by 3 desc
    limit 12
  ),
  -- Déjà vendu pour les soirées À VENIR (renvoie vers les prochaines soirées).
  upcoming as (
    select count(distinct e.id) as nights,
           coalesce(sum(
             case when (v_is_org and v_money) or (not v_is_org and v_money and e.venue_id = p_venue_id) then x.amount else 0 end
           ), 0) as amount
    from public.events e
    left join lateral (
      select coalesce(sum(greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
                          - least(greatest(coalesce(t.refund_amount, 0), 0),
                                  greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))), 0)
           + coalesce((select sum(greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0)
                          - least(greatest(coalesce(r.refund_amount, 0), 0),
                                  greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0)))
                       from public.table_reservations r where r.event_id = e.id and r.status in ('paid', 'confirmed')), 0) as amount
      from public.tickets t where t.event_id = e.id and t.status in ('paid', 'used')
    ) x on true
    where e.start_at > v_now
      and e.cancelled_at is null
      and coalesce(e.status, 'active') <> 'cancelled'
      and (
           (not v_is_org and (e.venue_id = p_venue_id or e.partner_venue_id = p_venue_id))
        or (v_is_org and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id))
      )
  )
  select jsonb_build_object(
    'ok', true,
    'money', v_money,
    'has_bar', not v_is_org,
    'period', p_period,
    'generated_at', v_now,
    'current', (select to_jsonb(t) - 'bucket' from totals t where t.bucket = 'cur'),
    'previous', case when p_period = 'all' then null
                     -- Une comparaison n'a de sens qu'à nombre de soirées égal.
                     else (select case when t.nights > 0 and t.nights = (select n from cur_n) then to_jsonb(t) - 'bucket' end
                           from totals t where t.bucket = 'prev') end,
    'nights', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pn.id, 'title', pn.title, 'start_at', pn.start_at, 'poster', pn.poster,
               'revenue', case when pn.show_money then pn.rev_tickets + pn.rev_tables + pn.rev_bar end,
               'rev_tickets', case when pn.show_money then pn.rev_tickets end,
               'rev_tables', case when pn.show_money then pn.rev_tables end,
               'rev_bar', case when pn.show_money then pn.rev_bar end,
               'entries', pn.entries, 'customers', pn.customers,
               'tickets', pn.tickets, 'ticket_cap', pn.cap, 'tables', pn.tables,
               'table_guests', pn.table_guests, 'tables_arrived', pn.tables_arrived,
               'bar_orders', pn.bar_orders,
               'gl_registered', pn.gl_registered, 'gl_entered', pn.gl_entered
             ) order by pn.start_at desc)
      from per_night pn where pn.bucket = 'cur'
    ), '[]'::jsonb),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('name', r.name, 'sold', r.sold,
                         'amount', case when v_money then r.amount end)) from rounds_list r), '[]'::jsonb),
    'packs', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'booked', p.booked, 'guests', p.guests,
                        'amount', case when v_money then p.amount end)) from packs_list p), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'qty', p.qty,
                           'amount', case when v_money then p.amount end)) from products_list p), '[]'::jsonb),
    'bar_service_min', (select case when b.sample >= 5 then round(b.median_min::numeric, 1) end from bar_service b),
    'holders', coalesce((select jsonb_agg(jsonb_build_object('name', h.name, 'kind', h.kind,
                          'registered', h.registered, 'entered', h.entered)) from holders_list h), '[]'::jsonb),
    'upcoming', (select jsonb_build_object('nights', u.nights, 'amount', case when v_money then u.amount end) from upcoming u)
  ) into v_result;

  -- Sans l'argent, aucun montant ne sort, même agrégé.
  if not v_money then
    v_result := jsonb_set(v_result, '{current}',
      (v_result -> 'current') - 'revenue' - 'rev_tickets' - 'rev_tables' - 'rev_bar' - 'stripe' - 'spend_revenue');
    if v_result -> 'previous' is not null and jsonb_typeof(v_result -> 'previous') = 'object' then
      v_result := jsonb_set(v_result, '{previous}',
        (v_result -> 'previous') - 'revenue' - 'rev_tickets' - 'rev_tables' - 'rev_bar' - 'stripe' - 'spend_revenue');
    end if;
  end if;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_vip_consumption_analytics(p_venue_id text DEFAULT NULL::text, p_event_id uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_tz text DEFAULT 'Europe/Paris'::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      auth.uid() = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif p_venue_id is null
     or not (public.is_venue_owner(auth.uid(), p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  with facts as (
    select f.*
    from public.vip_consumption_facts f
    where (
          (p_venue_id is not null and f.venue_id = p_venue_id)
       or (p_organizer_user_id is not null and f.event_id in (
            select e.id from public.events e
            where (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id)))
      )
      and (p_event_id is null or f.event_id = p_event_id)
      and (p_from is null or f.served_at >= p_from)
      and (p_to   is null or f.served_at <= p_to)
  ),
  -- Conso agrégée par réservation, pour le calcul upsell vs minimum
  per_res as (
    select f.table_reservation_id, sum(f.total_price) as consumed
    from facts f
    group by f.table_reservation_id
  ),
  res_scope as (
    select r.id, r.minimum_spend, coalesce(pr.consumed, 0) as consumed
    from public.table_reservations r
    join per_res pr on pr.table_reservation_id = r.id
    where r.status = 'paid'
  )
  select jsonb_build_object(
    'ok', true,
    'totals', jsonb_build_object(
      'revenue',        coalesce((select sum(total_price) from facts), 0),
      'items',          coalesce((select sum(quantity)    from facts), 0),
      'bottles',        coalesce((select sum(quantity)    from facts where item_type = 'bottle'), 0),
      'active_tables',  (select count(distinct table_reservation_id) from facts),
      'included_value', coalesce((select sum(total_price) from facts where is_included), 0),
      'upsell_value',   coalesce((select sum(total_price) from facts where not is_included), 0),
      'avg_per_table',  coalesce((
        select round(avg(t.rev)::numeric, 2) from (
          select table_reservation_id, sum(total_price) rev from facts group by table_reservation_id
        ) t), 0)
    ),
    'top_items', coalesce((
      select jsonb_agg(row_to_json(ti)) from (
        select
          menu_item_id,
          max(item_name)  as name,
          max(category)   as category,
          max(brand)      as brand,
          sum(quantity)   as qty,
          sum(total_price) as revenue
        from facts
        group by menu_item_id, lower(coalesce(item_name, ''))
        order by revenue desc
        limit 15
      ) ti), '[]'::jsonb),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object('category', coalesce(category, 'other'), 'qty', qty, 'revenue', revenue) order by revenue desc)
      from (
        select category, sum(quantity) qty, sum(total_price) revenue
        from facts group by category
      ) bc), '[]'::jsonb),
    'by_zone', coalesce((
      select jsonb_agg(jsonb_build_object(
        'zone_id', zone_id, 'zone_name', zone_name,
        'revenue', revenue, 'qty', qty, 'tables', tables) order by revenue desc)
      from (
        select f.zone_id, coalesce(tz.name, 'Zone') as zone_name,
               sum(f.total_price) revenue, sum(f.quantity) qty,
               count(distinct f.table_reservation_id) tables
        from facts f
        left join public.table_zones tz on tz.id = f.zone_id
        group by f.zone_id, tz.name
      ) bz), '[]'::jsonb),
    'by_hour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', hour, 'revenue', revenue, 'qty', qty) order by hour)
      from (
        select extract(hour from (served_at at time zone p_tz))::int as hour,
               sum(total_price) revenue, sum(quantity) qty
        from facts
        group by 1
      ) bh), '[]'::jsonb),
    'upsell', jsonb_build_object(
      'total_minimum',      coalesce((select sum(minimum_spend) from res_scope where minimum_spend > 0), 0),
      'total_consumed',     coalesce((select sum(consumed) from res_scope), 0),
      'upsell_amount',      coalesce((select sum(greatest(consumed - coalesce(minimum_spend,0), 0)) from res_scope), 0),
      'tables_over_min',    (select count(*) from res_scope where minimum_spend > 0 and consumed >= minimum_spend),
      'tables_under_min',   (select count(*) from res_scope where minimum_spend > 0 and consumed <  minimum_spend)
    )
  ) into result;

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_vip_table_analytics(p_venue_id text DEFAULT NULL::text, p_event_id uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_tz text DEFAULT 'Europe/Paris'::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      auth.uid() = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif p_venue_id is null
     or not (public.is_venue_owner(auth.uid(), p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  with res as (
    select
      r.id,
      r.zone_id,
      r.total_price,
      coalesce(r.service_fee, 0)     as service_fee,
      coalesce(r.management_fee, 0)   as management_fee,
      -- CA Club (Yuno fees exclus), avant remboursement — foote avec tableAnalytics.totalRevenue.
      greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0) as gross,
      coalesce(r.guest_count, 0)      as guest_count,
      coalesce(r.deposit, 0)          as deposit,
      coalesce(r.minimum_spend, 0)    as minimum_spend,
      r.created_at,
      r.placed_at,
      r.finished_at,
      (r.checked_in_at is not null or coalesce(r.entry_scanned, false)) as arrived,
      e.start_at as event_start
    from public.table_reservations r
    join public.events e on e.id = r.event_id
    where (
          (p_venue_id is not null and e.venue_id = p_venue_id)
       or (p_organizer_user_id is not null and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id))
      )
      and r.status = 'paid'
      and (p_event_id is null or r.event_id = p_event_id)
      and (p_from is null or r.created_at >= p_from)
      and (p_to   is null or r.created_at <= p_to)
  ),
  buckets as (
    select
      id, gross, guest_count,
      case
        when guest_count <= 2 then '1-2'
        when guest_count <= 4 then '3-4'
        when guest_count <= 6 then '5-6'
        when guest_count <= 8 then '7-8'
        else '9+'
      end as party_bucket,
      case
        when event_start is null then 'J-0'
        when (extract(epoch from (event_start - created_at)) / 86400.0) < 1 then 'J-0'
        when (extract(epoch from (event_start - created_at)) / 86400.0) < 2 then 'J-1'
        when (extract(epoch from (event_start - created_at)) / 86400.0) < 4 then 'J-2-3'
        when (extract(epoch from (event_start - created_at)) / 86400.0) < 8 then 'J-4-7'
        else 'J-8+'
      end as lead_bucket
    from res
  )
  select jsonb_build_object(
    'ok', true,
    'totals', jsonb_build_object(
      'booking_revenue', coalesce((select sum(gross) from res), 0),
      'reservations',    (select count(*) from res),
      'guests',          coalesce((select sum(guest_count) from res), 0),
      'avg_per_table',   coalesce((select round(avg(gross)::numeric, 2) from res), 0),
      'revenue_per_head', coalesce((
        select round((sum(gross) / nullif(sum(guest_count), 0))::numeric, 2) from res), 0),
      'avg_party_size',  coalesce((
        select round(avg(nullif(guest_count, 0))::numeric, 1) from res), 0),
      'total_deposit',   coalesce((select sum(deposit) from res), 0),
      'total_minimum',   coalesce((select sum(minimum_spend) from res where minimum_spend > 0), 0),
      'arrived_tables',  (select count(*) from res where arrived),
      'no_show_rate',    coalesce((
        select round((100.0 * (count(*) filter (where not arrived)) / nullif(count(*), 0))::numeric, 1)
        from res), 0),
      'avg_rotation_min', coalesce((
        select round(avg(extract(epoch from (finished_at - placed_at)) / 60.0)::numeric, 0)
        from res where placed_at is not null and finished_at is not null and finished_at > placed_at), 0),
      'median_rotation_min', coalesce((
        select round(percentile_cont(0.5) within group (
          order by extract(epoch from (finished_at - placed_at)) / 60.0)::numeric, 0)
        from res where placed_at is not null and finished_at is not null and finished_at > placed_at), 0),
      'rotation_sample', (select count(*) from res where placed_at is not null and finished_at is not null and finished_at > placed_at)
    ),
    'party_size', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', party_bucket, 'count', cnt, 'revenue', rev) order by ord)
      from (
        select party_bucket, count(*) cnt, sum(gross) rev,
               min(case party_bucket when '1-2' then 1 when '3-4' then 2 when '5-6' then 3 when '7-8' then 4 else 5 end) ord
        from buckets group by party_bucket
      ) p), '[]'::jsonb),
    'lead_time', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', lead_bucket, 'count', cnt, 'revenue', rev) order by ord)
      from (
        select lead_bucket, count(*) cnt, sum(gross) rev,
               min(case lead_bucket when 'J-0' then 1 when 'J-1' then 2 when 'J-2-3' then 3 when 'J-4-7' then 4 else 5 end) ord
        from buckets group by lead_bucket
      ) l), '[]'::jsonb),
    'by_zone', coalesce((
      select jsonb_agg(jsonb_build_object(
        'zone_id', zone_id, 'zone_name', zone_name,
        'reservations', reservations, 'revenue', revenue, 'guests', guests,
        'avg_per_table', avg_per_table) order by revenue desc)
      from (
        select r.zone_id, coalesce(tz.name, 'Zone') as zone_name,
               count(*) reservations, sum(r.gross) revenue, sum(r.guest_count) guests,
               round(avg(r.gross)::numeric, 2) avg_per_table
        from res r
        left join public.table_zones tz on tz.id = r.zone_id
        group by r.zone_id, tz.name
      ) z), '[]'::jsonb),
    'by_hour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', hour, 'reservations', reservations, 'revenue', revenue) order by hour)
      from (
        select extract(hour from (created_at at time zone p_tz))::int as hour,
               count(*) reservations, sum(gross) revenue
        from res
        group by 1
      ) h), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$;


-- ─── 2. Consentement nommé : preuve d'achat obligatoire ─────────────────────
-- Avant : n'importe qui (anon compris) pouvait, dans les 3 h suivant un achat
-- case cochée, verser l'adresse de l'acheteur chez tous les co-hôtes avec un
-- libellé inventé. Désormais la preuve est un secret que seul le navigateur
-- de l'acheteur détient : la session Stripe (cs_…) de SA commande, ou l'id /
-- le QR de la vente que le checkout vient de lui rendre (< 15 min).
-- Une session Stripe pas encore payée laisse une INTENTION, consommée par le
-- trigger au moment où le paiement relie la session à la vente.

CREATE TABLE IF NOT EXISTS public.event_cohost_consent_intents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  email       text NOT NULL,
  host_keys   text[] NOT NULL,
  wording     text NOT NULL,
  locale      text,
  source      text,
  proof       text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);
ALTER TABLE public.event_cohost_consent_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_cohost_consent_intents FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public._coorg_apply_cohost_consent(
  p_event_id uuid, p_email text, p_host_keys text[], p_wording text, p_locale text, p_source text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_ev record; v_primary text; v_uid uuid; p record; v_n integer := 0;
BEGIN
  SELECT * INTO v_ev FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR v_email = '' OR COALESCE(array_length(p_host_keys, 1), 0) = 0 THEN RETURN 0; END IF;
  v_primary := CASE WHEN v_ev.venue_id IS NOT NULL THEN 'venue:' || v_ev.venue_id ELSE 'org:' || v_ev.organizer_user_id END;
  SELECT u.id INTO v_uid FROM auth.users u WHERE lower(u.email) = v_email LIMIT 1;

  FOR p IN SELECT * FROM public.event_parties(p_event_id) x
            WHERE x.share_crm AND x.party_key <> v_primary AND x.party_key = ANY (p_host_keys)
  LOOP
    IF p.kind = 'venue' THEN
      INSERT INTO public.newsletter_subscriptions (user_id, venue_id, email, opted_in, source, consent_source, consent_recorded_at)
      VALUES (v_uid, p.venue_id, v_email, true, 'cohost_purchase', 'ticketing', now())
      ON CONFLICT (lower(email), venue_id) WHERE venue_id IS NOT NULL DO UPDATE
        SET opted_in = true, opted_out_at = NULL,
            user_id = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id), updated_at = now();
    ELSE
      INSERT INTO public.newsletter_subscriptions (user_id, organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at)
      VALUES (v_uid, p.organizer_user_id, v_email, true, 'cohost_purchase', 'ticketing', now())
      ON CONFLICT (lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL DO UPDATE
        SET opted_in = true, opted_out_at = NULL,
            user_id = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id), updated_at = now();
    END IF;
    INSERT INTO public.marketing_consent_events (user_id, email, channel, venue_id, organizer_user_id,
                                                 action, wording_key, wording_text, locale, source)
    VALUES (v_uid, v_email, 'email', p.venue_id, p.organizer_user_id, 'granted', 'consent.emailOffersFrom',
            left(btrim(p_wording), 1000), p_locale, left(COALESCE(p_source, 'checkout'), 60) || ':cohost');
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public._coorg_apply_cohost_consent(uuid, text, text[], text, text, text) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.share_event_marketing_consent(uuid, text, text, text, text, text[]);
CREATE OR REPLACE FUNCTION public.share_event_marketing_consent(
  p_event_id uuid, p_email text, p_wording text, p_locale text DEFAULT NULL, p_source text DEFAULT 'checkout',
  p_host_keys text[] DEFAULT NULL, p_proof text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_proof text := btrim(COALESCE(p_proof, ''));
  v_found boolean := false;
  v_optin boolean := false;
BEGIN
  IF v_email = '' OR position('@' IN v_email) = 0 THEN RETURN 0; END IF;
  IF COALESCE(btrim(p_wording), '') = '' THEN RETURN 0; END IF;
  -- Les hôtes NOMMÉS par la case, explicitement ; jamais « tous ».
  IF COALESCE(array_length(p_host_keys, 1), 0) = 0 THEN RETURN 0; END IF;
  IF v_proof = '' OR length(v_proof) > 300 THEN RETURN 0; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id) THEN RETURN 0; END IF;

  -- a) La vente est déjà là (billet de test / gratuit, table, guest list).
  SELECT true, COALESCE(t.newsletter_opt_in, false) INTO v_found, v_optin
    FROM public.tickets t
   WHERE t.event_id = p_event_id AND lower(t.user_email) = v_email
     AND (t.id::text = v_proof OR t.stripe_session_id = v_proof OR t.qr_code = v_proof)
     AND (t.stripe_session_id = v_proof OR t.created_at > now() - interval '15 minutes')
   LIMIT 1;
  IF NOT COALESCE(v_found, false) THEN
    SELECT true, COALESCE(r.newsletter_opt_in, false) INTO v_found, v_optin
      FROM public.table_reservations r
     WHERE r.event_id = p_event_id AND lower(r.user_email) = v_email
       AND (r.id::text = v_proof OR r.stripe_session_id = v_proof OR r.qr_code = v_proof)
       AND (r.stripe_session_id = v_proof OR r.created_at > now() - interval '15 minutes')
     LIMIT 1;
  END IF;
  IF NOT COALESCE(v_found, false) THEN
    SELECT true, COALESCE(g.newsletter_opt_in, false) INTO v_found, v_optin
      FROM public.guest_list_entries g JOIN public.guest_lists gl ON gl.id = g.guest_list_id
     WHERE gl.event_id = p_event_id AND lower(g.email) = v_email
       AND (g.id::text = v_proof OR g.qr_code = v_proof)
       AND g.created_at > now() - interval '15 minutes'
     LIMIT 1;
  END IF;

  IF COALESCE(v_found, false) THEN
    IF NOT v_optin THEN RETURN 0; END IF;
    RETURN public._coorg_apply_cohost_consent(p_event_id, v_email, p_host_keys, p_wording, p_locale, p_source);
  END IF;

  -- b) Session Stripe pas encore payée : l'intention attend le paiement.
  IF v_proof LIKE 'cs\_%' THEN
    DELETE FROM public.event_cohost_consent_intents WHERE created_at < now() - interval '2 days';
    INSERT INTO public.event_cohost_consent_intents (event_id, email, host_keys, wording, locale, source, proof)
    VALUES (p_event_id, v_email, p_host_keys, left(btrim(p_wording), 1000), left(p_locale, 10),
            left(COALESCE(p_source, 'checkout'), 60), v_proof)
    ON CONFLICT (proof) DO NOTHING;
  END IF;
  RETURN 0;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'share_event_marketing_consent: %', SQLERRM;
  RETURN 0;
END;
$$;
GRANT EXECUTE ON FUNCTION public.share_event_marketing_consent(uuid, text, text, text, text, text[], text) TO anon, authenticated;

-- Le paiement relie la session Stripe à la vente : l'intention se consomme là,
-- sur la case réellement enregistrée sur la vente.
CREATE OR REPLACE FUNCTION public.apply_cohost_consent_intent()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE i record;
BEGIN
  IF NEW.stripe_session_id IS NULL OR NEW.stripe_session_id IS NOT DISTINCT FROM OLD.stripe_session_id THEN
    RETURN NEW;
  END IF;
  FOR i IN SELECT * FROM public.event_cohost_consent_intents x
            WHERE x.proof = NEW.stripe_session_id AND x.consumed_at IS NULL
              AND x.event_id = NEW.event_id AND x.email = lower(NEW.user_email)
  LOOP
    IF COALESCE(NEW.newsletter_opt_in, false) THEN
      PERFORM public._coorg_apply_cohost_consent(i.event_id, i.email, i.host_keys, i.wording, i.locale, i.source);
    END IF;
    UPDATE public.event_cohost_consent_intents SET consumed_at = now() WHERE id = i.id;
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'apply_cohost_consent_intent: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_cohost_consent_intent() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_cohost_consent_intent ON public.tickets;
CREATE TRIGGER zz_cohost_consent_intent AFTER UPDATE OF stripe_session_id ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.apply_cohost_consent_intent();
DROP TRIGGER IF EXISTS zz_cohost_consent_intent ON public.table_reservations;
CREATE TRIGGER zz_cohost_consent_intent AFTER UPDATE OF stripe_session_id ON public.table_reservations
  FOR EACH ROW EXECUTE FUNCTION public.apply_cohost_consent_intent();

-- ─── 7 bis. Marketing et suivi : démo et hôtes publics ───────────────────────

CREATE OR REPLACE FUNCTION public.coorg_marketing_event_ids(p_venue text, p_org uuid)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT u.id FROM (
    SELECT e.id FROM public.events e
     WHERE (p_venue IS NOT NULL AND e.partner_venue_id = p_venue)
        OR (p_org IS NOT NULL AND e.partner_organizer_id = p_org)
    UNION
    SELECT c.event_id FROM public.event_cohosts c
     WHERE c.status = 'accepted' AND c.share_crm
       AND ((p_venue IS NOT NULL AND c.venue_id = p_venue)
         OR (p_org IS NOT NULL AND c.organizer_user_id = p_org))
  ) u(id)
  -- Une soirée démo n'est jamais annoncée par la recette d'un vrai compte.
  WHERE NOT (u.id = ANY (public.demo_event_ids()));
$$;

CREATE OR REPLACE FUNCTION public.follow_event_hosts(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); p record; v_n integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  PERFORM set_config('yuno.follow_source', 'event_hosts', true);
  -- Mêmes hôtes que « Présenté par » : jamais un club caché ou un orga privé.
  FOR p IN SELECT x.* FROM public.event_parties(p_event_id) x
             LEFT JOIN public.organizer_profiles op ON op.user_id = x.organizer_user_id
             LEFT JOIN public.venues v ON v.id = x.venue_id
            WHERE (x.kind = 'org' AND COALESCE(op.is_public, true))
               OR (x.kind = 'venue' AND v.decommissioned_at IS NULL
                   AND (NOT COALESCE(v.is_hidden, false) OR v.id = ANY (public.demo_venue_ids())))
  LOOP
    IF p.kind = 'org' THEN
      IF NOT EXISTS (SELECT 1 FROM public.organizer_profile_followers f
                      WHERE f.organizer_user_id = p.organizer_user_id AND f.user_id = v_uid)
         AND p.organizer_user_id <> v_uid THEN
        INSERT INTO public.organizer_profile_followers (organizer_user_id, user_id) VALUES (p.organizer_user_id, v_uid);
        v_n := v_n + 1;
      END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.favorites f
                      WHERE f.venue_id = p.venue_id AND f.user_id = v_uid AND f.favorite_type = 'club') THEN
        INSERT INTO public.favorites (user_id, favorite_type, venue_id) VALUES (v_uid, 'club', p.venue_id);
        v_n := v_n + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$$;
