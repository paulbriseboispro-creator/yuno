-- ════════════════════════════════════════════════════════════════════════════
-- Collab club × organisateur — bloquants trouvés par la revue du 29/09
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. Le CLUB PARTENAIRE d'une soirée menée par l'organisateur ne pouvait rien
--    écrire (aucune policy UPDATE), et le garde ne le voyait pas comme partie :
--    tout domaine confié au club était gelé pour les deux. Policy miroir de
--    celle de l'organisateur partenaire + garde qui le reconnaît (jamais lead).
-- 2. Une invitation de club pouvait rattacher un partenaire à la soirée de
--    N'IMPORTE QUI : l'acceptation vérifie que la soirée est bien au club
--    invitant.
-- 3. « Supprimer d'un commun accord » effaçait une soirée qui avait vendu
--    (billets, tables, commandes, décompte) sans aucun remboursement, et une
--    suppression programmée pouvait rester bloquée à vie. Refusée dès la
--    première vente ou le partage figé ; un échec d'exécution est clos.
-- 4. Un avenant de partage signé après la première vente échouait en entier
--    (contrat immuable) : refus clair à la signature.
-- 5. Le club pouvait effacer la dette SEPA née d'un décompte accepté
--    (annulation / litige « annuler ») : réservé au super admin pour ce lot.
-- 6. Accepter le décompte exige la révision LUE : un club qui redéclare
--    pendant que l'organisateur lit ne fait pas accepter d'autres chiffres.
-- 7. Surcharge à 3 arguments de create_event_collab_series_contract retirée
--    (appel ambigu, erreur 300).

-- ─── 1. Club partenaire ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Partner venue can manage co-event" ON public.events;
CREATE POLICY "Partner venue can manage co-event" ON public.events
  FOR UPDATE TO authenticated
  USING (partner_venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), partner_venue_id)
         AND (public.collab_domain_holder(collab_responsibilities, event_mode, 'design') IN ('venue', 'both')
              OR public.collab_domain_holder(collab_responsibilities, event_mode, 'operations') IN ('venue', 'both')))
  WITH CHECK (partner_venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), partner_venue_id)
         AND (public.collab_domain_holder(collab_responsibilities, event_mode, 'design') IN ('venue', 'both')
              OR public.collab_domain_holder(collab_responsibilities, event_mode, 'operations') IN ('venue', 'both')));

-- ─── 3. Suppression d'un commun accord : jamais une soirée qui a vendu ──────

CREATE OR REPLACE FUNCTION public.collab_event_has_sales(p_event_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id = p_event_id AND t.status IN ('paid', 'used', 'refunded'))
      OR EXISTS (SELECT 1 FROM public.table_reservations r WHERE r.event_id = p_event_id AND r.status IN ('paid', 'confirmed', 'refunded'))
      OR EXISTS (SELECT 1 FROM public.orders o WHERE o.event_id = p_event_id AND o.status IN ('paid', 'served', 'refunded'))
      OR EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event_id AND e.split_locked_at IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION public.collab_event_has_sales(uuid) FROM PUBLIC, anon;
-- Garde : le club partenaire est une partie (côté club), jamais le lead.
CREATE OR REPLACE FUNCTION public.protect_event_columns_from_partner()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_venue_side boolean;
  v_is_org_side   boolean;
  v_is_lead       boolean;
  v_side          text;
  v_touched       text;
BEGIN
  -- Ne garder QUE les UPDATE clients directs (PostgREST = rôle `authenticated`).
  -- Les RPC SECURITY DEFINER (signature de contrat, avenants, crons) tournent
  -- sous le rôle propriétaire et sont de confiance.
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF public.is_super_admin() THEN RETURN NEW; END IF;

  IF OLD.partner_organizer_id IS NULL AND OLD.partner_venue_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- COALESCE partout : sur une soirée menée par le club, organizer_user_id est
  -- NULL, et « NULL = uid » rendait v_is_lead NULL — le blocage structurel ne
  -- se déclenchait jamais (le partenaire réécrivait le partage).
  -- Le club = propriétaire OU manager ; l'orga = lui OU son équipe (éditeur+).
  -- Le club LEAD (venue_id) ou le club PARTENAIRE d'une soirée menée par
  -- l'organisateur (partner_venue_id) : les deux sont « côté club ».
  v_is_venue_side := (OLD.venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), OLD.venue_id))
                  OR (OLD.partner_venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), OLD.partner_venue_id));
  v_is_org_side   := COALESCE(OLD.organizer_user_id = auth.uid(), false)
                  OR COALESCE(OLD.partner_organizer_id = auth.uid(), false)
                  OR (COALESCE(OLD.organizer_user_id, OLD.partner_organizer_id) IS NOT NULL
                      AND public.is_org_team_member(auth.uid(), COALESCE(OLD.organizer_user_id, OLD.partner_organizer_id), 'editor'));

  IF NOT (v_is_venue_side OR v_is_org_side) THEN RETURN NEW; END IF;
  IF v_is_venue_side AND v_is_org_side THEN RETURN NEW; END IF;
  v_side := CASE WHEN v_is_venue_side THEN 'venue' ELSE 'organizer' END;
  -- Seul le club qui MÈNE (venue_id) est lead ; un club partenaire ne l'est jamais.
  v_is_lead := (OLD.venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), OLD.venue_id))
            OR COALESCE(OLD.organizer_user_id = auth.uid(), false)
            OR (OLD.organizer_user_id IS NOT NULL
                AND public.is_org_team_member(auth.uid(), OLD.organizer_user_id, 'editor'));

  -- 5a. STRUCTUREL : l'argent, l'identité des parties, le mode, la répartition
  -- elle-même, le cycle de vie. Ne relève d'aucun domaine — ça se renégocie par
  -- contrat ou par avenant, pas dans un champ de formulaire.
  -- (start_at / end_at ont QUITTÉ cette liste : voir 5c.)
  IF NEW.revenue_split_rules      IS DISTINCT FROM OLD.revenue_split_rules
   OR NEW.revenue_split_proposal  IS DISTINCT FROM OLD.revenue_split_proposal
   OR NEW.is_bde                  IS DISTINCT FROM OLD.is_bde
   OR NEW.venue_id                IS DISTINCT FROM OLD.venue_id
   OR NEW.partner_venue_id        IS DISTINCT FROM OLD.partner_venue_id
   OR NEW.organizer_user_id       IS DISTINCT FROM OLD.organizer_user_id
   OR NEW.partner_organizer_id    IS DISTINCT FROM OLD.partner_organizer_id
   OR NEW.event_mode              IS DISTINCT FROM OLD.event_mode
   OR NEW.collab_responsibilities IS DISTINCT FROM OLD.collab_responsibilities
  THEN
    IF NOT v_is_lead THEN
      RAISE EXCEPTION 'Le partenaire ne peut pas modifier le partage, le mode ni la structure de la soirée';
    END IF;
  END IF;

  -- 5b. DESIGN — ce qui habille la soirée et la façon dont elle est montrée.
  IF (NEW.title              IS DISTINCT FROM OLD.title
   OR NEW.description        IS DISTINCT FROM OLD.description
   OR NEW.poster_url         IS DISTINCT FROM OLD.poster_url
   OR NEW.poster_position    IS DISTINCT FROM OLD.poster_position
   OR NEW.video_url          IS DISTINCT FROM OLD.video_url
   OR NEW.image_url          IS DISTINCT FROM OLD.image_url
   OR NEW.banner_position    IS DISTINCT FROM OLD.banner_position
   OR NEW.music_genres       IS DISTINCT FROM OLD.music_genres
   OR NEW.music_genre        IS DISTINCT FROM OLD.music_genre
   OR NEW.event_type         IS DISTINCT FROM OLD.event_type
   OR NEW.visibility         IS DISTINCT FROM OLD.visibility
   OR NEW.hide_yuno_navigation IS DISTINCT FROM OLD.hide_yuno_navigation)
   -- is_discoverable / discovery_status sont recalculés par
   -- evaluate_event_discoverability (déclenché AVANT ce garde) à partir de
   -- `visibility`, qui reste dans la liste ; search_title est une colonne
   -- GÉNÉRÉE, indéfinie dans NEW en BEFORE. Les comparer bloquait toute
   -- modification de la partie qui ne tient pas le design.
   AND public.collab_domain_holder(OLD.collab_responsibilities, OLD.event_mode, 'design')
       NOT IN (v_side, 'both')
  THEN
    v_touched := 'design';
  END IF;

  -- 5c. OPÉRATIONS — ce qui fait tourner la soirée. Billetterie, tables, lieu,
  -- accès, ET horaires : celui qui fait tourner la nuit en fixe les heures.
  IF v_touched IS NULL
   AND (NEW.ticketing_enabled      IS DISTINCT FROM OLD.ticketing_enabled
     OR NEW.ticket_selling_mode    IS DISTINCT FROM OLD.ticket_selling_mode
     OR NEW.max_tickets            IS DISTINCT FROM OLD.max_tickets
     OR NEW.max_tickets_per_person IS DISTINCT FROM OLD.max_tickets_per_person
     OR NEW.presale_start_at       IS DISTINCT FROM OLD.presale_start_at
     OR NEW.public_sale_start_at   IS DISTINCT FROM OLD.public_sale_start_at
     OR NEW.rounds_visibility      IS DISTINCT FROM OLD.rounds_visibility
     OR NEW.sale_password_enabled  IS DISTINCT FROM OLD.sale_password_enabled
     OR NEW.waitlist_enabled       IS DISTINCT FROM OLD.waitlist_enabled
     OR NEW.tables_enabled         IS DISTINCT FROM OLD.tables_enabled
     OR NEW.tables_mode            IS DISTINCT FROM OLD.tables_mode
     OR NEW.tables_locked_to_venue IS DISTINCT FROM OLD.tables_locked_to_venue
     OR NEW.tables_owner_user_id   IS DISTINCT FROM OLD.tables_owner_user_id
     OR NEW.minors_disabled        IS DISTINCT FROM OLD.minors_disabled
     OR NEW.alcohol_free           IS DISTINCT FROM OLD.alcohol_free
     OR NEW.location_name          IS DISTINCT FROM OLD.location_name
     OR NEW.location_address       IS DISTINCT FROM OLD.location_address
     OR NEW.location_city          IS DISTINCT FROM OLD.location_city
     OR NEW.location_is_secret     IS DISTINCT FROM OLD.location_is_secret
     OR NEW.reveal_address_in_email IS DISTINCT FROM OLD.reveal_address_in_email
     OR NEW.access_code            IS DISTINCT FROM OLD.access_code
     OR NEW.requires_access_code   IS DISTINCT FROM OLD.requires_access_code
     OR NEW.start_at               IS DISTINCT FROM OLD.start_at
     OR NEW.end_at                 IS DISTINCT FROM OLD.end_at)
   AND public.collab_domain_holder(OLD.collab_responsibilities, OLD.event_mode, 'operations')
       NOT IN (v_side, 'both')
  THEN
    v_touched := 'operations';
  END IF;

  IF v_touched IS NOT NULL THEN
    RAISE EXCEPTION 'Ce domaine (%) est confié à l''autre partie sur cette soirée', v_touched
      USING HINT = 'Proposez un avenant pour déplacer ce domaine.';
  END IF;

  RETURN NEW;
END;
$function$;

-- ─── 2. Invitation : la soirée appartient au club invitant ─────────────────

CREATE OR REPLACE FUNCTION public.accept_organizer_claim_invitation(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  inv RECORD;
  v_org_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_uid;

  SELECT * INTO inv
    FROM organizer_claim_invitations
   WHERE token = p_token
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_not_found';
  END IF;
  IF inv.status <> 'pending' THEN
    RAISE EXCEPTION 'invitation_not_pending';
  END IF;
  IF inv.expires_at < now() THEN
    UPDATE organizer_claim_invitations SET status = 'expired', updated_at = now()
     WHERE id = inv.id;
    RAISE EXCEPTION 'invitation_expired';
  END IF;
  -- Anti-détournement de lien : seul le destinataire de l'email peut accepter
  -- (même règle que accept-club-collab-invitation côté club).
  IF v_email IS NULL OR v_email <> lower(inv.organizer_email) THEN
    RAISE EXCEPTION 'email_mismatch';
  END IF;

  v_org_name := COALESCE(
    NULLIF(inv.organizer_name, ''),
    NULLIF(trim(COALESCE(inv.contact_first_name, '') || ' ' || COALESCE(inv.contact_last_name, '')), '')
  );

  -- 1. Promotion du profil en organisateur.
  UPDATE profiles
     SET profile_type = 'organizer',
         organization_name = COALESCE(organization_name, v_org_name),
         first_name = COALESCE(first_name, inv.contact_first_name),
         last_name = COALESCE(last_name, inv.contact_last_name)
   WHERE id = v_uid;

  -- 2. Rôle organisateur.
  INSERT INTO user_roles (user_id, role, email)
  VALUES (v_uid, 'organizer', v_email)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- 3. Partenariat actif club ↔ orga (les défauts de split de l'invitation
  --    deviennent les défauts du partenariat). Idempotent si une paire
  --    pending/active existe déjà : on l'active.
  INSERT INTO venue_organizer_partnerships
    (venue_id, organizer_user_id, status, initiated_by, accepted_at,
     invitation_message, default_split_rules)
  VALUES
    (inv.inviting_venue_id, v_uid, 'active', 'venue', now(),
     inv.invitation_message, COALESCE(inv.default_split_rules,
       '{"tickets":{"organizer_pct":100,"venue_pct":0},"tables":{"organizer_pct":0,"venue_pct":100},"drinks":{"organizer_pct":0,"venue_pct":100}}'::jsonb))
  ON CONFLICT DO NOTHING;

  UPDATE venue_organizer_partnerships
     SET status = 'active', accepted_at = COALESCE(accepted_at, now())
   WHERE venue_id = inv.inviting_venue_id
     AND organizer_user_id = v_uid
     AND status = 'pending';

  -- 4. Rattachement de la soirée en co-event (l'orga rejoint comme partenaire).
  IF inv.event_id IS NOT NULL THEN
    UPDATE events
       SET partner_organizer_id = v_uid,
           event_mode = CASE
             WHEN event_mode IS NULL OR event_mode IN ('solo_venue', 'solo_organizer')
               THEN 'co_event'
             ELSE event_mode
           END
     WHERE id = inv.event_id
       AND partner_organizer_id IS NULL
       -- La soirée doit appartenir au club qui invite : jamais celle d'un autre.
       AND venue_id = inv.inviting_venue_id;
  END IF;

  -- 5. Invitation consommée.
  UPDATE organizer_claim_invitations
     SET status = 'accepted', accepted_at = now(),
         created_organizer_user_id = v_uid, updated_at = now()
   WHERE id = inv.id;

  RETURN jsonb_build_object(
    'partnership_venue_id', inv.inviting_venue_id,
    'event_id', inv.event_id
  );
END;
$function$;

-- ─── 3. Suppression ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.request_event_collab_action(p_event_id uuid, p_action text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue_id     text;
  v_org_id       uuid;
  v_is_venue     boolean;
  v_is_org       boolean;
  v_role         text;
  v_req_id       uuid;
  v_title        text;
  v_actor        text;
  v_label        text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_action NOT IN ('pause','delete') THEN RAISE EXCEPTION 'Invalid action'; END IF;

  PERFORM 1 FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;

  SELECT venue_id, organizer_user_id INTO v_venue_id, v_org_id
    FROM public.collab_event_parties(p_event_id);
  IF v_venue_id IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'Cette soirée n''est pas une collaboration';
  END IF;

  v_is_venue := public.is_venue_owner(auth.uid(), v_venue_id);
  v_is_org   := (v_org_id = auth.uid());
  IF NOT (v_is_venue OR v_is_org) THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  v_role := CASE WHEN v_is_org THEN 'organizer' ELSE 'venue' END;

  IF p_action = 'delete' AND public.collab_event_has_sales(p_event_id) THEN
    RAISE EXCEPTION 'COLLAB_DELETE_HAS_SALES: cette soirée a déjà vendu — mettez-la en pause ou annulez-la (remboursements), elle ne se supprime plus';
  END IF;

  IF EXISTS (SELECT 1 FROM public.event_collab_action_requests r
             WHERE r.event_id = p_event_id AND r.status IN ('pending','scheduled')) THEN
    RAISE EXCEPTION 'COLLAB_ACTION_PENDING: une demande est déjà en cours pour cette soirée';
  END IF;

  INSERT INTO public.event_collab_action_requests (
    event_id, action, status, requested_by, requested_by_role,
    venue_approved, organizer_approved, venue_id, organizer_user_id
  ) VALUES (
    p_event_id, p_action, 'pending', auth.uid(), v_role,
    (v_role = 'venue'), (v_role = 'organizer'), v_venue_id, v_org_id
  ) RETURNING id INTO v_req_id;

  SELECT title INTO v_title FROM public.events WHERE id = p_event_id;
  v_title := COALESCE(v_title, 'une soirée');
  v_label := CASE WHEN p_action = 'pause' THEN 'mettre en pause' ELSE 'supprimer' END;

  -- Notifier la partie adverse, dont l'accord est requis.
  IF v_role = 'venue' THEN
    SELECT name INTO v_actor FROM public.venues WHERE id = v_venue_id;
    PERFORM public.notify_collab_party('organizer', v_venue_id, v_org_id, p_event_id,
      'collab_action_request', 'Demande sur une co-soirée',
      COALESCE(v_actor, 'Le club') || ' souhaite ' || v_label || ' « ' || v_title || ' ». Ton accord est requis.',
      'high', 'event_collab_action', v_req_id,
      jsonb_build_object('action', p_action, 'event_id', p_event_id, 'requested_by_role', v_role));
  ELSE
    SELECT display_name INTO v_actor FROM public.organizer_profiles WHERE user_id = v_org_id;
    PERFORM public.notify_collab_party('venue', v_venue_id, v_org_id, p_event_id,
      'collab_action_request', 'Demande sur une co-soirée',
      COALESCE(v_actor, 'L''organisateur') || ' souhaite ' || v_label || ' « ' || v_title || ' ». Ton accord est requis.',
      'high', 'event_collab_action', v_req_id,
      jsonb_build_object('action', p_action, 'event_id', p_event_id, 'requested_by_role', v_role));
  END IF;

  RETURN v_req_id;
END; $function$;

CREATE OR REPLACE FUNCTION public._execute_event_collab_action(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.event_collab_action_requests%ROWTYPE;
  v_title text;
BEGIN
  SELECT * INTO r FROM public.event_collab_action_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF r.status NOT IN ('pending','scheduled') THEN RETURN; END IF;

  SELECT title INTO v_title FROM public.events WHERE id = r.event_id;
  v_title := COALESCE(v_title, 'une soirée');

  IF r.action = 'pause' THEN
    UPDATE public.events SET collab_paused_at = now(), is_active = false WHERE id = r.event_id;
    UPDATE public.event_collab_action_requests
       SET status = 'executed', resolved_at = now(), updated_at = now()
     WHERE id = p_request_id;
    PERFORM public.notify_collab_party('organizer', r.venue_id, r.organizer_user_id, r.event_id,
      'collab_action_done', 'Co-soirée mise en pause',
      '« ' || v_title || ' » a été mise en pause d''un commun accord.',
      'normal', 'event_collab_action', r.id, jsonb_build_object('action', 'pause', 'event_id', r.event_id));
    PERFORM public.notify_collab_party('venue', r.venue_id, r.organizer_user_id, r.event_id,
      'collab_action_done', 'Co-soirée mise en pause',
      '« ' || v_title || ' » a été mise en pause d''un commun accord.',
      'normal', 'event_collab_action', r.id, jsonb_build_object('action', 'pause', 'event_id', r.event_id));
    RETURN;
  END IF;

  -- Une vente est arrivée depuis la demande (ou le partage s'est figé) : on
  -- ne supprime pas, la demande est close et les deux parties le savent.
  IF public.collab_event_has_sales(r.event_id) THEN
    UPDATE public.event_collab_action_requests
       SET status = 'cancelled', resolved_at = now(), updated_at = now()
     WHERE id = p_request_id;
    PERFORM public.notify_collab_party(p, r.venue_id, r.organizer_user_id, r.event_id,
      'collab_action_rejected', 'Suppression annulée',
      '« ' || v_title || ' » a déjà vendu : elle ne peut plus être supprimée. Mettez-la en pause ou annulez-la.',
      'high', 'event_collab_action', r.id, jsonb_build_object('action', 'delete', 'event_id', r.event_id))
      FROM unnest(ARRAY['organizer', 'venue']) AS p;
    RETURN;
  END IF;

  -- action = 'delete' : notifier AVANT (la ligne de demande disparaît en cascade
  -- avec la soirée).
  PERFORM public.notify_collab_party('organizer', r.venue_id, r.organizer_user_id, r.event_id,
    'collab_action_done', 'Co-soirée supprimée',
    '« ' || v_title || ' » a été supprimée d''un commun accord.',
    'normal', 'event_collab_action', NULL, jsonb_build_object('action', 'delete'));
  PERFORM public.notify_collab_party('venue', r.venue_id, r.organizer_user_id, r.event_id,
    'collab_action_done', 'Co-soirée supprimée',
    '« ' || v_title || ' » a été supprimée d''un commun accord.',
    'normal', 'event_collab_action', NULL, jsonb_build_object('action', 'delete'));

  -- Lever le garde-fou pour CETTE transaction seulement, puis supprimer.
  PERFORM set_config('app.collab_delete_ok', '1', true);
  BEGIN
    DELETE FROM public.events WHERE id = r.event_id;  -- cascade : contrats + demande
  EXCEPTION WHEN OTHERS THEN
    -- Une dépendance bloque (vestiaire…) : la demande est close au lieu de
    -- rester « programmée » à vie et de bloquer toute nouvelle demande.
    RAISE WARNING '_execute_event_collab_action % : %', p_request_id, SQLERRM;
    UPDATE public.event_collab_action_requests
       SET status = 'cancelled', resolved_at = now(), updated_at = now()
     WHERE id = p_request_id;
  END;
END; $function$;

-- ─── 4. Avenant de partage après la première vente ─────────────────────────

CREATE OR REPLACE FUNCTION public.sign_collab_amendment(p_amendment_id uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_terms_version text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a          public.event_collab_amendments%ROWTYPE;
  v_is_venue boolean;
  v_is_org   boolean;
BEGIN
  SELECT * INTO a FROM public.event_collab_amendments WHERE id = p_amendment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Avenant introuvable'; END IF;
  IF a.status <> 'pending_signatures' THEN
    RAISE EXCEPTION 'Cet avenant n''attend pas de signature (statut=%)', a.status;
  END IF;

  -- ─── Partage figé depuis la première vente : un avenant ne peut plus le changer.
  IF a.contract_id IS NOT NULL AND a.split_rules IS NOT NULL
     AND a.split_rules IS DISTINCT FROM a.prev_split_rules
     AND EXISTS (SELECT 1 FROM public.event_collab_contracts cc
                   JOIN public.events e ON e.id = cc.event_id
                  WHERE cc.id = a.contract_id
                    AND (cc.status = 'locked' OR e.split_locked_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'AMENDMENT_SPLIT_LOCKED: le partage est figé depuis la première vente, cet avenant ne peut plus le modifier. Proposez un avenant sur les seules responsabilités.';
  END IF;

  v_is_venue := public.is_venue_owner(auth.uid(), a.venue_id);
  v_is_org   := (a.organizer_user_id = auth.uid());
  IF NOT (v_is_venue OR v_is_org) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF v_is_venue THEN
    UPDATE public.event_collab_amendments
       SET venue_signed_at = COALESCE(venue_signed_at, now()),
           venue_signed_by = COALESCE(venue_signed_by, auth.uid()),
           venue_signed_ip = COALESCE(venue_signed_ip, p_ip),
           venue_signed_user_agent = COALESCE(venue_signed_user_agent, p_user_agent)
     WHERE id = p_amendment_id;
  ELSE
    UPDATE public.event_collab_amendments
       SET org_signed_at = COALESCE(org_signed_at, now()),
           org_signed_by = COALESCE(org_signed_by, auth.uid()),
           org_signed_ip = COALESCE(org_signed_ip, p_ip),
           org_signed_user_agent = COALESCE(org_signed_user_agent, p_user_agent)
     WHERE id = p_amendment_id;
  END IF;

  SELECT * INTO a FROM public.event_collab_amendments WHERE id = p_amendment_id;
  IF a.venue_signed_at IS NULL OR a.org_signed_at IS NULL THEN
    RETURN 'pending_signatures';
  END IF;

  -- Double signature → l'avenant prend effet et se fige.
  UPDATE public.event_collab_amendments
     SET status = 'active',
         effective_at = now(),
         terms_snapshot = jsonb_build_object(
           'responsibilities', a.responsibilities,
           'split_rules', a.split_rules,
           'prev_responsibilities', a.prev_responsibilities,
           'prev_split_rules', a.prev_split_rules,
           'reason', a.reason,
           'proposed_by', a.proposed_by,
           'venue_signed_at', a.venue_signed_at,
           'org_signed_at', a.org_signed_at,
           'terms_version', p_terms_version,
           'frozen_at', now()
         )
   WHERE id = p_amendment_id;

  PERFORM public.apply_collab_amendment(p_amendment_id);
  RETURN 'active';
END; $function$;

CREATE OR REPLACE FUNCTION public.cancel_collab_table_settlement(p_settlement_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue_id text;
  v_status   text;
BEGIN
  SELECT venue_id, status INTO v_venue_id, v_status
  FROM public.collab_table_settlements WHERE id = p_settlement_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'settlement_not_cancellable'; END IF;
  -- La dette née d'un décompte de fin de soirée ACCEPTÉ par l'organisateur ne
  -- s'efface pas d'un clic du club : seul le super admin peut l'annuler.
  IF EXISTS (SELECT 1 FROM public.collab_table_settlements s WHERE s.id = p_settlement_id AND s.kind = 'night_closing')
     AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'night_closing_settlement_locked';
  END IF;

  IF NOT (public.is_venue_owner(auth.uid(), v_venue_id) OR public.can_manage_venue(auth.uid(), v_venue_id)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  DELETE FROM public.collab_table_settlements WHERE id = p_settlement_id;
  RETURN jsonb_build_object('cancelled', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_collab_settlement_dispute(p_settlement_id uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue_id text;
  v_status   text;
  v_due      timestamptz;
BEGIN
  SELECT venue_id, status INTO v_venue_id, v_status
  FROM public.collab_table_settlements WHERE id = p_settlement_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
  IF v_status <> 'disputed' THEN RAISE EXCEPTION 'settlement_not_disputed'; END IF;

  IF NOT (public.is_venue_owner(auth.uid(), v_venue_id) OR public.can_manage_venue(auth.uid(), v_venue_id)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_action = 'redeclare' THEN
    v_due := now() + interval '5 days';
    UPDATE public.collab_table_settlements
    SET status = 'approved', disputed_at = NULL, dispute_reason = NULL, confirm_due_at = v_due
    WHERE id = p_settlement_id;
    RETURN jsonb_build_object('resolved', true, 'action', 'redeclare', 'confirm_due_at', v_due);

  ELSIF p_action = 'cancel' THEN
    IF EXISTS (SELECT 1 FROM public.collab_table_settlements s WHERE s.id = p_settlement_id AND s.kind = 'night_closing')
       AND NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'night_closing_settlement_locked';
    END IF;
    -- Les lignes partent en cascade : les réservations redeviennent réglables.
    DELETE FROM public.collab_table_settlements WHERE id = p_settlement_id;
    RETURN jsonb_build_object('resolved', true, 'action', 'cancel');
  END IF;

  RAISE EXCEPTION 'unknown_action';
END;
$function$;

-- ─── 6. Décompte de fin de soirée : on accepte la révision lue ─────────────

DROP FUNCTION IF EXISTS public.accept_collab_night_closing(uuid);
CREATE OR REPLACE FUNCTION public.accept_collab_night_closing(p_closing_id uuid, p_expected_revision integer DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c             public.collab_night_closings%ROWTYPE;
  v_rules       jsonb;
  v_ended       boolean;
  v_fig         record;
  v_total       numeric;
  v_pct         numeric;
  v_due         numeric;
  v_due_cents   bigint;
  v_held_cents  bigint := 0;
  v_online      bigint := 0;
  v_sepa_cents  bigint := 0;
  v_org_acct    text;
  v_org_ready   boolean;
  v_iban        text;
  v_iban_chg    timestamptz;
  v_settle_id   uuid;
  v_ref         text;
  v_rows        int := 0;
  v_sum_base    bigint := 0;
  v_remainder   bigint;
  v_idx         int := 0;
  v_org_cents   bigint;
  r             record;
  v_title       text;
  v_org_name    text;
BEGIN
  SELECT * INTO c FROM public.collab_night_closings WHERE id = p_closing_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'closing_not_found'; END IF;
  -- Le décompte est une créance de l'ORGANISATEUR : lui seul l'accepte.
  IF c.organizer_user_id <> auth.uid() THEN RAISE EXCEPTION 'only_organizer_can_accept'; END IF;
  IF c.status <> 'declared' THEN RAISE EXCEPTION 'closing_not_declared'; END IF;
  -- On accepte les chiffres LUS : une redéclaration entre-temps change la révision.
  IF p_expected_revision IS NOT NULL AND c.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'closing_revised';
  END IF;

  SELECT revenue_split_rules, COALESCE(end_at, start_at) < now()
    INTO v_rules, v_ended
  FROM public.events WHERE id = c.event_id;
  IF v_rules IS NULL OR NOT public.is_tiered_collab(v_rules) THEN RAISE EXCEPTION 'not_tiered'; END IF;
  IF NOT v_ended THEN RAISE EXCEPTION 'event_not_ended'; END IF;

  -- Refiger les chiffres Yuno à l'instant de l'acceptation.
  SELECT * INTO v_fig FROM public.collab_night_yuno_figures(c.event_id);
  v_total := v_fig.tickets + v_fig.tables + v_fig.drinks
    + c.declared_bar + c.declared_door_tickets + c.declared_tables_extra + c.declared_other;
  SELECT tp.pct, tp.amount INTO v_pct, v_due FROM public.collab_tier_pct(v_rules, v_total) tp;
  v_due_cents := ROUND(v_due * 100)::bigint;

  -- Fonds retenus, verrouillés le temps de la répartition.
  SELECT COALESCE(SUM(h.primary_amount_cents), 0), COUNT(*) INTO v_held_cents, v_rows
  FROM public.collab_night_held_rows(c.event_id) h;
  IF v_rows > 0 THEN
    PERFORM 1 FROM public.revenue_distributions d
    WHERE d.id IN (SELECT h.id FROM public.collab_night_held_rows(c.event_id) h) FOR UPDATE;
  END IF;

  SELECT p.stripe_connect_account_id, COALESCE(p.stripe_connect_charges_enabled, false)
    INTO v_org_acct, v_org_ready
  FROM public.profiles p WHERE p.id = c.organizer_user_id;

  IF v_org_acct IS NOT NULL AND v_org_ready THEN
    v_online := LEAST(v_due_cents, v_held_cents);
  END IF;
  v_sepa_cents := v_due_cents - v_online;

  -- Le reste passe par SEPA : il faut un IBAN organisateur, posé depuis > 24 h.
  IF v_sepa_cents > 0 THEN
    SELECT iban, iban_changed_at INTO v_iban, v_iban_chg
    FROM public.organizer_payout_details WHERE user_id = c.organizer_user_id;
    IF v_iban IS NULL OR length(trim(v_iban)) < 8 THEN RAISE EXCEPTION 'organizer_iban_missing'; END IF;
    IF v_iban_chg IS NOT NULL AND v_iban_chg > now() - interval '24 hours' THEN
      RAISE EXCEPTION 'iban_recently_changed';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.collab_table_settlements
      WHERE event_id = c.event_id AND status IN ('pending', 'approved', 'disputed')
    ) THEN
      RAISE EXCEPTION 'settlement_already_open';
    END IF;
  END IF;

  -- Répartition du montant en ligne au PRORATA de chaque jambe retenue. On
  -- distribue d'abord la part entière de chaque ligne, puis les centimes de
  -- reste aux plus grosses lignes : la somme des jambes organisateur vaut
  -- exactement v_online, et aucune ligne ne dépasse ce qu'elle porte.
  IF v_online > 0 THEN
    FOR r IN
      SELECT h.id, h.primary_amount_cents AS p
      FROM public.collab_night_held_rows(c.event_id) h
      ORDER BY h.primary_amount_cents DESC, h.id
    LOOP
      v_sum_base := v_sum_base + FLOOR(r.p::numeric * v_online / v_held_cents)::bigint;
    END LOOP;
    v_remainder := v_online - v_sum_base;

    FOR r IN
      SELECT h.id, h.primary_amount_cents AS p
      FROM public.collab_night_held_rows(c.event_id) h
      ORDER BY h.primary_amount_cents DESC, h.id
    LOOP
      v_idx := v_idx + 1;
      v_org_cents := FLOOR(r.p::numeric * v_online / v_held_cents)::bigint
        + CASE WHEN v_idx <= v_remainder THEN 1 ELSE 0 END;
      v_org_cents := LEAST(v_org_cents, r.p);

      UPDATE public.revenue_distributions SET
        primary_amount_cents = (r.p - v_org_cents)::integer,
        primary_transfer_status = CASE WHEN r.p - v_org_cents > 0 THEN 'scheduled' ELSE 'not_required' END,
        primary_transfer_error = NULL,
        secondary_account_id = CASE WHEN v_org_cents > 0 THEN v_org_acct ELSE secondary_account_id END,
        secondary_amount_cents = v_org_cents::integer,
        secondary_recipient_kind = CASE WHEN v_org_cents > 0 THEN 'organizer' ELSE secondary_recipient_kind END,
        secondary_recipient_organizer_id = CASE WHEN v_org_cents > 0 THEN c.organizer_user_id ELSE secondary_recipient_organizer_id END,
        secondary_transfer_status = CASE WHEN v_org_cents > 0 THEN 'scheduled' ELSE 'not_required' END,
        secondary_transfer_error = NULL,
        transfers_release_at = now(),
        metadata = COALESCE(metadata, '{}'::jsonb)
          || jsonb_build_object('night_closing_id', c.id, 'night_closing_organizer_cents', v_org_cents),
        updated_at = now()
      WHERE id = r.id;
    END LOOP;
  END IF;

  -- Tout ce qui reste retenu sur cette soirée (part club, lignes sans part
  -- organisateur) est libéré maintenant : le décompte est le seul verrou.
  UPDATE public.revenue_distributions SET
    transfers_release_at = now(),
    primary_transfer_status = CASE WHEN primary_transfer_status = 'failed' THEN 'scheduled' ELSE primary_transfer_status END,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('night_closing_id', c.id),
    updated_at = now()
  WHERE event_id = c.event_id
    AND item_type IN ('ticket', 'table')
    AND split_mode = 'separate'
    AND transfers_release_at IS NULL;

  -- Le reste dû par virement : un lot du cycle existant, à déclarer par le club.
  IF v_sepa_cents > 0 THEN
    v_ref := public.build_collab_settlement_reference(c.organizer_user_id);
    INSERT INTO public.collab_table_settlements (
      event_id, contract_id, venue_id, organizer_user_id,
      amount, organizer_pct_applied, night_revenue, organizer_theoretical, organizer_prepaid,
      breakdown, status, transfer_reference, created_by, kind, closing_id
    ) VALUES (
      c.event_id, c.contract_id, c.venue_id, c.organizer_user_id,
      ROUND(v_sepa_cents / 100.0, 2), v_pct, ROUND(v_total, 2), v_due, ROUND(v_online / 100.0, 2),
      jsonb_build_object(
        'kind', 'night_closing', 'closing_id', c.id,
        'yuno_tickets', v_fig.tickets, 'yuno_tables', v_fig.tables, 'yuno_drinks', v_fig.drinks,
        'declared_bar', c.declared_bar, 'declared_door_tickets', c.declared_door_tickets,
        'declared_door_count', c.declared_door_count,
        'declared_tables_extra', c.declared_tables_extra, 'declared_other', c.declared_other,
        'total', ROUND(v_total, 2), 'pct', v_pct, 'due', v_due,
        'held', ROUND(v_held_cents / 100.0, 2), 'online', ROUND(v_online / 100.0, 2),
        'computed_at', now()
      ),
      'pending', v_ref, auth.uid(), 'night_closing', c.id
    ) RETURNING id INTO v_settle_id;
  END IF;

  UPDATE public.collab_night_closings SET
    status = 'accepted', accepted_at = now(), accepted_by = auth.uid(),
    disputed_at = NULL, dispute_reason = NULL,
    yuno_tickets = v_fig.tickets, yuno_tables = v_fig.tables, yuno_drinks = v_fig.drinks,
    total_revenue = ROUND(v_total, 2), tier_pct = v_pct,
    tiers_mode = COALESCE(v_rules->'remuneration'->>'tiers_mode', 'flat'),
    organizer_due = v_due,
    held_amount = ROUND(v_held_cents / 100.0, 2),
    online_amount = ROUND(v_online / 100.0, 2),
    sepa_amount = ROUND(v_sepa_cents / 100.0, 2),
    settlement_id = v_settle_id
  WHERE id = c.id;

  -- Libération immédiate des transferts Stripe (même appel que le cron horaire).
  -- Best-effort : le cron repasse de toute façon à H+07.
  BEGIN
    PERFORM net.http_post(
      url := 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/stripe-webhook',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', private.get_cron_secret()
      ),
      body := jsonb_build_object('task', 'release_held_transfers')
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  SELECT title INTO v_title FROM public.events WHERE id = c.event_id;
  SELECT display_name INTO v_org_name FROM public.organizer_profiles WHERE user_id = c.organizer_user_id;
  BEGIN
    PERFORM public.notify_collab_party('venue', c.venue_id, c.organizer_user_id, c.event_id,
      'collab_request', 'Décompte de soirée accepté',
      COALESCE(v_org_name, 'L''organisateur') || ' a accepté le décompte de « ' || COALESCE(v_title, 'la soirée') || ' » : '
        || to_char(ROUND(v_total, 2), 'FM999G999G990D00') || ' € au total, palier ' || v_pct || ' %. '
        || CASE WHEN v_online > 0 THEN to_char(ROUND(v_online / 100.0, 2), 'FM999G999G990D00') || ' € partent des ventes Yuno retenues. ' ELSE '' END
        || CASE WHEN v_sepa_cents > 0 THEN 'Reste ' || to_char(ROUND(v_sepa_cents / 100.0, 2), 'FM999G999G990D00') || ' € à virer (référence dans la carte Décompte).' ELSE 'Rien à virer.' END,
      'high', 'collab_night_closing', c.id,
      jsonb_build_object('event_id', c.event_id, 'closing_id', c.id, 'settlement_id', v_settle_id));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'accepted', true, 'closing_id', c.id,
    'total', ROUND(v_total, 2), 'pct', v_pct, 'due', v_due,
    'held', ROUND(v_held_cents / 100.0, 2),
    'online', ROUND(v_online / 100.0, 2),
    'sepa', ROUND(v_sepa_cents / 100.0, 2),
    'settlement_id', v_settle_id
  );
END;
$function$;

-- ─── 7. Surcharge ambiguë ────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.create_event_collab_series_contract(uuid, jsonb, text);

GRANT EXECUTE ON FUNCTION public.accept_collab_night_closing(uuid, integer) TO authenticated;
