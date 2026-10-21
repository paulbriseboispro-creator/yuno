-- ============================================================================
-- Espace invité : QUI TIENT LA PORTE, et les visuels de la soirée (21/10)
-- ============================================================================
-- Choix de Paul : à l'invitation d'un club, la porte est tenue par
-- l'organisateur seul (`organizer`), par le club seul (`guest`) ou par les deux
-- (`both`, défaut d'un club). Sans objet pour une organisation invitée (NULL).
--   • Le club n'invite son staff de porte par son lien que si la porte est à
--     lui (`guest_pass_invite_door_staff` refuse `door_not_yours`).
--   • Le staff qu'il a invité ne scanne que tant que la porte lui revient :
--     `is_event_door_staff`, `event_door_staff_ids` et
--     `get_my_event_door_events` le relisent à chaque appel (repasser en
--     « organisateur seul » ferme sa porte sans rien supprimer ; la rouvrir la
--     lui rend). Le staff invité par l'organisateur garde toujours la porte.
--   • L'espace lit `guest.door_mode` ; la carte de l'organisateur aussi.
-- Visuels : l'espace rend aussi l'image 16:9 et la vidéo de la page soirée
-- (`wide_url`, `video_url`), telles quelles.
-- ============================================================================

ALTER TABLE public.event_guest_passes
  ADD COLUMN IF NOT EXISTS door_mode text CHECK (door_mode IS NULL OR door_mode IN ('organizer', 'guest', 'both'));

COMMENT ON COLUMN public.event_guest_passes.door_mode IS
  'Qui tient la porte d''une soirée pour un club invité : organizer | guest | both (défaut). NULL pour une organisation invitée.';

UPDATE public.event_guest_passes SET door_mode = 'both' WHERE guest_kind = 'venue' AND door_mode IS NULL;

CREATE OR REPLACE FUNCTION public.guest_pass_door_mode_default()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.guest_kind = 'venue' THEN
    NEW.door_mode := coalesce(NEW.door_mode, 'both');
  ELSE
    NEW.door_mode := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guest_pass_door_mode_default() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guest_pass_door_mode_default ON public.event_guest_passes;
CREATE TRIGGER trg_guest_pass_door_mode_default
  BEFORE INSERT OR UPDATE OF door_mode, guest_kind ON public.event_guest_passes
  FOR EACH ROW EXECUTE FUNCTION public.guest_pass_door_mode_default();

-- Régler qui tient la porte (organisateur, niveau gestion).
CREATE OR REPLACE FUNCTION public.set_event_guest_pass_door(p_pass_id uuid, p_mode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.event_guest_passes%ROWTYPE;
  v_me  record;
BEGIN
  SELECT * INTO v_row FROM public.event_guest_passes WHERE id = p_pass_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_me FROM public._guest_pass_manager(v_row.event_id);
  IF v_me.level < 2 THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_row.guest_kind <> 'venue' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_mode NOT IN ('organizer', 'guest', 'both') THEN RAISE EXCEPTION 'invalid_door_mode'; END IF;
  UPDATE public.event_guest_passes SET door_mode = p_mode WHERE id = p_pass_id;
  RETURN jsonb_build_object('ok', true, 'door_mode', p_mode);
END;
$$;
REVOKE ALL ON FUNCTION public.set_event_guest_pass_door(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_event_guest_pass_door(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_event_door_staff(_user_id uuid, _event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.events e
     WHERE e.id = _event_id
       AND (
         EXISTS (
           SELECT 1 FROM public.org_members om
            WHERE om.organizer_user_id IN (e.organizer_user_id, e.partner_organizer_id)
              AND om.member_user_id = _user_id
              AND om.invitation_status = 'accepted'
              AND om.role IN ('admin', 'editor', 'scanner')
         )
         OR EXISTS (
           SELECT 1 FROM public.org_staff os
            WHERE os.organizer_user_id IN (e.organizer_user_id, e.partner_organizer_id)
              AND os.user_id = _user_id
              AND os.invitation_status = 'accepted'
              AND os.role = 'bouncer'
         )
         -- Co-hôtes ÉDITEURS acceptés de cette soirée.
         OR EXISTS (
           SELECT 1 FROM public.event_cohosts c
            WHERE c.event_id = e.id
              AND c.status = 'accepted'
              AND c.access = 'editor'
              AND (
                (c.organizer_user_id IS NOT NULL AND (
                   c.organizer_user_id = _user_id
                   OR EXISTS (SELECT 1 FROM public.org_members om2
                               WHERE om2.organizer_user_id = c.organizer_user_id
                                 AND om2.member_user_id = _user_id
                                 AND om2.invitation_status = 'accepted'
                                 AND om2.role IN ('admin', 'editor', 'scanner'))
                   OR EXISTS (SELECT 1 FROM public.org_staff os2
                               WHERE os2.organizer_user_id = c.organizer_user_id
                                 AND os2.user_id = _user_id
                                 AND os2.invitation_status = 'accepted'
                                 AND os2.role = 'bouncer')))
                OR (c.venue_id IS NOT NULL AND (
                   EXISTS (SELECT 1 FROM public.venues v WHERE v.id = c.venue_id AND v.owner_id = _user_id)
                   OR public.can_manage_venue(_user_id, c.venue_id)))
              )
         )
         -- Staff de porte de CETTE soirée (staff du club invité), jusqu'à 6 h après la fin.
         OR EXISTS (
           SELECT 1 FROM public.event_door_staff ds
            WHERE ds.event_id = e.id
              AND ds.user_id = _user_id
              AND ds.status = 'accepted' AND (ds.invited_by_kind <> 'guest'
                   OR EXISTS (SELECT 1 FROM public.event_guest_passes gp
                               WHERE gp.id = ds.guest_pass_id AND gp.door_mode IN ('guest', 'both')))
              AND e.cancelled_at IS NULL
              AND now() <= coalesce(e.end_at, e.start_at + interval '8 hours') + interval '6 hours'
         )
       )
  )
$function$;

CREATE OR REPLACE FUNCTION public.event_door_staff_ids(p_event_id uuid)
 RETURNS TABLE(user_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT s.user_id
    FROM events e
    CROSS JOIN LATERAL (
      -- Staff de club : le rattachement se lit sur profiles.venue_id, comme
      -- partout ailleurs (il n'y a pas de table de jonction staff ↔ club).
      SELECT ur.user_id
        FROM user_roles ur
        JOIN profiles p ON p.id = ur.user_id
       WHERE ur.role IN ('bouncer', 'manager')
         AND p.venue_id IS NOT NULL
         AND p.venue_id IN (e.venue_id, e.partner_venue_id)
      UNION
      SELECT os.user_id
        FROM org_staff os
       WHERE os.user_id IS NOT NULL
         AND os.invitation_status = 'accepted'
         AND os.role = 'bouncer'
         AND os.organizer_user_id IN (e.organizer_user_id, e.partner_organizer_id)
      UNION
      SELECT om.member_user_id
        FROM org_members om
       WHERE om.member_user_id IS NOT NULL
         AND om.invitation_status = 'accepted'
         AND om.role IN ('admin', 'editor', 'scanner')
         AND om.organizer_user_id IN (e.organizer_user_id, e.partner_organizer_id)
      UNION
      -- Staff de porte de cette soirée seulement.
      SELECT ds.user_id
        FROM event_door_staff ds
       WHERE ds.event_id = e.id AND ds.status = 'accepted' AND ds.user_id IS NOT NULL AND (ds.invited_by_kind <> 'guest'
                   OR EXISTS (SELECT 1 FROM public.event_guest_passes gp
                               WHERE gp.id = ds.guest_pass_id AND gp.door_mode IN ('guest', 'both')))
    ) AS s(user_id)
   WHERE e.id = p_event_id
     AND s.user_id IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_event_door_events()
 RETURNS TABLE(event_id uuid, title text, start_at timestamp with time zone, end_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT e.id, e.title, e.start_at, e.end_at
    FROM public.event_door_staff ds
    JOIN public.events e ON e.id = ds.event_id
   WHERE ds.user_id = auth.uid() AND ds.status = 'accepted' AND (ds.invited_by_kind <> 'guest'
                   OR EXISTS (SELECT 1 FROM public.event_guest_passes gp
                               WHERE gp.id = ds.guest_pass_id AND gp.door_mode IN ('guest', 'both')))
     AND e.cancelled_at IS NULL
     AND now() <= coalesce(e.end_at, e.start_at + interval '8 hours') + interval '6 hours'
   ORDER BY e.start_at;
$function$;

CREATE OR REPLACE FUNCTION public.guest_pass_invite_door_staff(p_token text, p_name text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pass public.event_guest_passes%ROWTYPE;
  v_row  public.event_door_staff%ROWTYPE;
BEGIN
  v_pass := public._guest_pass_live(p_token);
  IF v_pass.guest_kind <> 'venue' THEN RAISE EXCEPTION 'forbidden'; END IF;
  -- La porte est tenue par l'organisateur seul : le club n'y invite personne.
  IF v_pass.door_mode NOT IN ('guest', 'both') THEN RAISE EXCEPTION 'door_not_yours'; END IF;
  IF NOT public._guest_pass_note(v_pass.id, 'staff') THEN RAISE EXCEPTION 'too_many_actions'; END IF;
  v_row := public._event_door_invite(v_pass.event_id, v_pass.id, p_name, p_email, p_phone, auth.uid(), 'guest', v_pass.guest_party);
  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'invite_token', v_row.token, 'email', v_row.email, 'phone', v_row.phone);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_guest_space(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pass  public.event_guest_passes%ROWTYPE;
  v_ev    record;
  v_close timestamptz;
  v_team  boolean := false;
  v_ctx   record;
  v_count boolean := true;
  v_paul  text;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT * INTO v_pass FROM public.event_guest_passes WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;

  SELECT e.title, e.start_at, e.end_at INTO v_ev FROM public.events e WHERE e.id = v_pass.event_id;
  v_close := coalesce(v_ev.end_at, v_ev.start_at + interval '8 hours') + interval '7 days';
  IF v_pass.revoked_at IS NOT NULL OR now() > v_close THEN
    RETURN jsonb_build_object('found', true, 'closed', true, 'revoked', v_pass.revoked_at IS NOT NULL,
                              'language', v_pass.language, 'guest_name', v_pass.guest_name, 'event_title', v_ev.title);
  END IF;

  -- Contrat d'invité : le décompte se fige 48 h après la fin (une fois).
  IF public._guest_pass_freeze_if_due(v_pass.id) THEN
    SELECT * INTO v_pass FROM public.event_guest_passes WHERE id = v_pass.id;
  END IF;

  v_team := public._guest_pass_is_team(v_pass.event_id);
  IF NOT v_team THEN
    BEGIN
      SELECT * INTO v_ctx FROM public.links_visitor_context();
      IF EXISTS (SELECT 1 FROM public.event_guest_pass_opens o
                  WHERE o.pass_id = v_pass.id AND o.action = 'open' AND o.visitor_hash = v_ctx.o_hash
                    AND o.created_at > now() - interval '30 minutes')
         OR (SELECT count(*) FROM public.event_guest_pass_opens o
              WHERE o.visitor_hash = v_ctx.o_hash AND o.created_at > now() - interval '1 hour') >= 60 THEN
        v_count := false;
      END IF;
      IF v_count THEN
        INSERT INTO public.event_guest_pass_opens (pass_id, visitor_hash, action) VALUES (v_pass.id, v_ctx.o_hash, 'open');
        UPDATE public.event_guest_passes
           SET opened_count = opened_count + 1, first_opened_at = coalesce(first_opened_at, now()), last_opened_at = now()
         WHERE id = v_pass.id
         RETURNING * INTO v_pass;
        IF v_pass.opened_count = 1 THEN
          PERFORM public._guest_pass_alert(v_pass, 'open', 'host_pass_open:' || v_pass.id::text);
        ELSIF v_pass.opened_count = 5 THEN
          PERFORM public._guest_pass_alert(v_pass, 'hot', 'host_pass_hot:' || v_pass.id::text);
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'get_event_guest_space count: %', SQLERRM;
    END;
  END IF;

  SELECT nullif(regexp_replace(coalesce(c.config->>'whatsapp_number', ''), '\D', '', 'g'), '')
    INTO v_paul FROM public.links_page_config c WHERE c.id = 'default';

  RETURN jsonb_build_object(
    'found', true, 'closed', false, 'revoked', false,
    'guest', jsonb_build_object(
      'kind', v_pass.guest_kind, 'name', v_pass.guest_name, 'contact_email', v_pass.contact_email,
      'party', v_pass.guest_party, 'claim_status', v_pass.claim_status,
      'party_name', (SELECT coalesce(v.name, op.display_name) FROM (SELECT 1) one
                       LEFT JOIN public.venues v ON 'venue:' || v.id = v_pass.guest_party
                       LEFT JOIN public.organizer_profiles op ON 'org:' || op.user_id = v_pass.guest_party),
      'places_requested', v_pass.places_requested, 'door_mode', v_pass.door_mode),
    'language', v_pass.language,
    'show_revenue', v_pass.show_revenue,
    'closes_at', v_close,
    'paul_whatsapp', v_paul,
    'is_team', v_team,
    'is_demo', v_pass.event_id = ANY (public.demo_event_ids()),
    'door_staff', CASE WHEN v_pass.guest_kind = 'venue' THEN public._event_door_staff_list(v_pass.event_id, v_pass.id) END
  ) || public._guest_space_payload(v_pass);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_event_guest_passes(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me record;
BEGIN
  SELECT * INTO v_me FROM public._guest_pass_manager(p_event_id);
  PERFORM public._guest_pass_freeze_if_due(h.id) FROM public.event_guest_passes h
   WHERE h.event_id = p_event_id AND h.contract_status = 'signed' AND h.statement_frozen_at IS NULL;
  RETURN jsonb_build_object(
    'ok', true,
    'can_show_revenue', v_me.level >= 3,
    'passes', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', h.id, 'guest_kind', h.guest_kind, 'guest_name', h.guest_name,
               'contact_email', h.contact_email, 'contact_phone', h.contact_phone,
               'language', h.language, 'token', h.token, 'show_revenue', h.show_revenue,
               'opened_count', h.opened_count, 'first_opened_at', h.first_opened_at, 'last_opened_at', h.last_opened_at,
               'email_sent_count', h.email_sent_count, 'email_sent_at', h.email_sent_at,
               'signup_clicks', h.signup_clicks, 'revoked', h.revoked_at IS NOT NULL, 'created_at', h.created_at,
               'share_tickets_pct', h.share_tickets_pct, 'share_tables_pct', h.share_tables_pct,
               'statement_response', h.statement_response, 'statement_reason', h.statement_reason,
               'statement_responded_at', h.statement_responded_at,
               'places_requested', h.places_requested, 'places_requested_at', h.places_requested_at,
               'guest_list', (SELECT jsonb_build_object('places', gl.quota,
                                'registered', (SELECT count(*) FROM public.guest_list_entries g
                                                WHERE g.guest_list_id = gl.id AND g.status <> 'cancelled'))
                                FROM public.guest_lists gl WHERE gl.guest_pass_id = h.id),
               'links', (SELECT count(*) FROM public.tracked_links tl WHERE tl.guest_pass_id = h.id),
               'link_clicks', (SELECT coalesce(sum(tl.clicks_count), 0) FROM public.tracked_links tl WHERE tl.guest_pass_id = h.id),
               'link_sales', (SELECT count(*) FROM public.tickets t JOIN public.tracked_links tl ON tl.id = t.tracked_link_id
                               WHERE tl.guest_pass_id = h.id AND t.status IN ('paid', 'used'))
                           + (SELECT count(*) FROM public.table_reservations r JOIN public.tracked_links tl ON tl.id = r.tracked_link_id
                               WHERE tl.guest_pass_id = h.id AND r.status IN ('paid', 'confirmed')),
               'contract_status', h.contract_status, 'contract_terms', h.contract_terms,
               'contract_version', h.contract_version, 'contract_signed_at', h.contract_signed_at,
               'contract_signer_name', h.contract_signer_name, 'contract_signer_email', h.contract_signer_email,
               'statement_frozen_at', h.statement_frozen_at,
               'guest_iban', CASE WHEN v_me.level >= 3 THEN h.guest_iban END, 'guest_iban_holder', CASE WHEN v_me.level >= 3 THEN h.guest_iban_holder END,
               'transfer_reference', h.transfer_reference, 'transfer_status', h.transfer_status,
               'transfer_amount', CASE WHEN v_me.level >= 3 THEN h.transfer_amount END,
               'transfer_due_at', h.transfer_due_at, 'transfer_sent_at', h.transfer_sent_at,
               'transfer_received_at', h.transfer_received_at, 'transfer_dispute_reason', h.transfer_dispute_reason,
               'door_mode', h.door_mode, 'guest_party', h.guest_party, 'claim_status', h.claim_status, 'claimed_at', h.claimed_at,
               'guest_party_name', (SELECT coalesce(v.name, op.display_name) FROM (SELECT 1) one
                                      LEFT JOIN public.venues v ON 'venue:' || v.id = h.guest_party
                                      LEFT JOIN public.organizer_profiles op ON 'org:' || op.user_id = h.guest_party),
               'guest_is_party', h.guest_party IS NOT NULL AND EXISTS (
                 SELECT 1 FROM public.event_parties(p_event_id) p WHERE p.party_key = h.guest_party),
               'guest_invited', h.guest_party IS NOT NULL AND EXISTS (
                 SELECT 1 FROM public.event_cohosts c
                  WHERE c.event_id = p_event_id AND c.status = 'pending'
                    AND ('venue:' || c.venue_id = h.guest_party OR 'org:' || c.organizer_user_id = h.guest_party))
             ) ORDER BY h.revoked_at IS NOT NULL, h.created_at DESC)
        FROM public.event_guest_passes h
       WHERE h.event_id = p_event_id
    ), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._guest_space_payload(p_pass event_guest_passes, p_full boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now       timestamptz := now();
  e           record;
  v_tz        text;
  v_day_start timestamptz;
  v_phase     text;
  v_uid       uuid := auth.uid();
  v_member    integer := 0;
  v_money     boolean;
  v_org       record;
  v_result    jsonb;
  v_rules     jsonb;
  v_compute   jsonb;
  v_contract  boolean := false;
  v_statement record;
  v_transfer  record;
  v_money_obj jsonb;
  v_collector text;
  v_gl_id     uuid;
  v_live      numeric;
  v_figs      boolean;
BEGIN
  SELECT ev.*, coalesce(nullif(ev.timezone, ''), v.timezone, 'Europe/Paris') AS tz
    INTO e
    FROM public.events ev
    LEFT JOIN public.venues v ON v.id = coalesce(ev.venue_id, ev.partner_venue_id)
   WHERE ev.id = p_pass.event_id;

  v_tz := e.tz;
  v_day_start := date_trunc('day', v_now AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  v_phase := CASE WHEN e.cancelled_at IS NOT NULL THEN 'cancelled'
                  WHEN v_now >= coalesce(e.end_at, e.start_at + interval '8 hours') THEN 'after'
                  WHEN v_now >= e.start_at THEN 'live'
                  ELSE 'before' END;

  IF v_uid IS NOT NULL AND p_pass.guest_party IS NOT NULL THEN
    v_member := public.coorg_party_level(v_uid, p_pass.guest_party);
  END IF;
  -- L'argent : ce que l'organisateur laisse voir, ou le titulaire de la partie
  -- invitée quand elle est signataire du contrat de la soirée.
  -- Deux choix indépendants (Paul, 20/10) : avec ou sans contrat, avec ou sans
  -- montants. Les chiffres du décompte se CALCULENT dès qu'un contrat existe
  -- (la part due en découle) mais ne se MONTRENT qu'avec les montants.
  v_money := p_pass.show_revenue OR v_member >= 3;
  v_figs := v_money OR coalesce(p_full, false) OR p_pass.contract_status IN ('proposed', 'signed');

  SELECT p.display_name, p.avatar_url, p.kind,
         (SELECT op.instagram_url FROM public.organizer_profiles op WHERE op.user_id = p.organizer_user_id) AS instagram
    INTO v_org
    FROM public.event_parties(p_pass.event_id) p
   WHERE p.party_key = p_pass.created_by_party;

  SELECT gl.id INTO v_gl_id FROM public.guest_lists gl WHERE gl.guest_pass_id = p_pass.id;

  -- Contrat Yuno réglé par virement dont l'invité est une des deux parties ?
  v_rules := public.normalize_collab_settlement(e.revenue_split_rules);
  IF p_pass.guest_party IS NOT NULL AND v_rules IS NOT NULL
     AND public.collab_settlement_mode(v_rules) = 'transfer' THEN
    v_compute := public._collab_transfer_compute(p_pass.event_id);
    v_contract := coalesce((v_compute->>'ok')::boolean, false)
                  AND p_pass.guest_party IN (v_compute->>'venue_key', v_compute->>'org_key');
  END IF;

  WITH
  tx AS MATERIALIZED (
    SELECT 'tickets'::text AS pillar, t.id, coalesce(t.paid_at, t.created_at) AS at_ts,
           greatest(coalesce(t.quantity, 1), 1) AS heads,
           (coalesce(t.total_price, 0) > 0) AS paid,
           greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0) AS gross,
           least(greatest(coalesce(t.refund_amount, 0), 0),
                 greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)) AS refund,
           coalesce(t.service_fee, 0) + coalesce(t.insurance_fee, 0) AS yuno_fee,
           CASE WHEN coalesce(t.total_price, 0) > 0 THEN round(t.total_price * 0.015 + 0.25, 2) ELSE 0 END AS stripe,
           t.ticket_round_id AS line_id,
           (coalesce(t.entry_scanned, false) OR coalesce(t.used, false) OR t.status = 'used') AS scanned,
           public._guest_space_sale_key(t.tracked_link_id, t.id, NULL, t.attribution_source, t.purchase_source) AS skey
      FROM public.tickets t
     WHERE t.event_id = p_pass.event_id AND t.status IN ('paid', 'used')
    UNION ALL
    SELECT 'tables', r.id, coalesce(r.paid_at, r.created_at),
           greatest(coalesce(r.guest_count, 0), 1),
           true,
           greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0),
           least(greatest(coalesce(r.refund_amount, 0), 0),
                 greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)),
           coalesce(r.service_fee, 0),
           CASE WHEN coalesce(r.deposit, 0) > 0 AND coalesce(r.payment_mode, 'online') = 'online'
                THEN round((r.deposit + CASE WHEN coalesce(r.fee_absorbed, false) THEN 0 ELSE coalesce(r.management_fee, 0) END) * 0.015 + 0.25, 2)
                ELSE 0 END,
           r.pack_id,
           (coalesce(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL),
           public._guest_space_sale_key(r.tracked_link_id, NULL, r.id, r.attribution_source, r.purchase_source)
      FROM public.table_reservations r
     WHERE r.event_id = p_pass.event_id AND r.status IN ('paid', 'confirmed')
  ),
  gle AS MATERIALIZED (
    SELECT g.id, g.created_at AS at_ts, g.guest_list_id, coalesce(g.entry_scanned, false) AS scanned
      FROM public.guest_list_entries g
      JOIN public.guest_lists gl ON gl.id = g.guest_list_id
     WHERE gl.event_id = p_pass.event_id AND g.status <> 'cancelled'
  ),
  series AS (
    SELECT (e.start_at AT TIME ZONE v_tz)::date - (at_ts AT TIME ZONE v_tz)::date AS d,
           sum(heads) FILTER (WHERE pillar = 'tickets') AS tickets,
           count(*) FILTER (WHERE pillar = 'tables') AS tables
      FROM tx GROUP BY 1
  ),
  rounds AS (
    SELECT tr.id, tr.name, tr.price, tr.position, tr.created_at, tr.max_tickets, tr.is_active,
           tr.auto_activate, tr.manually_sold_out, tr.hidden, tr.entry_deadline, tr.includes_drink,
           tr.drink_cutoff_time,
           coalesce((SELECT sum(heads) FROM tx WHERE pillar = 'tickets' AND line_id = tr.id), 0) AS sold,
           coalesce((SELECT sum(gross - refund) FROM tx WHERE pillar = 'tickets' AND line_id = tr.id), 0) AS ca
      FROM public.ticket_rounds tr
     WHERE tr.event_id = p_pass.event_id
  ),
  packs AS (
    SELECT p.id, p.name, p.base_price, p.position, p.created_at, p.tables_count,
           (SELECT count(*) FROM tx WHERE pillar = 'tables' AND line_id = p.id) AS sold,
           coalesce((SELECT sum(gross - refund) FROM tx WHERE pillar = 'tables' AND line_id = p.id), 0) AS ca,
           coalesce((SELECT sum(heads) FROM tx WHERE pillar = 'tables' AND line_id = p.id), 0) AS guests
      FROM public.table_packs p
     WHERE p.is_active
       AND (p.event_id = p_pass.event_id
            OR (p.event_id IS NULL AND coalesce(e.venue_id, e.partner_venue_id) IS NOT NULL
                AND p.venue_id = coalesce(e.venue_id, e.partner_venue_id)))
  ),
  who AS (
    SELECT skey,
           sum(heads) FILTER (WHERE pillar = 'tickets') AS tickets,
           count(*) FILTER (WHERE pillar = 'tables') AS tables,
           sum(gross - refund) AS ca
      FROM tx GROUP BY skey
  ),
  who_named AS (
    SELECT w.skey, w.tickets, w.tables, w.ca,
           CASE
             WHEN w.skey = 'guest:' || p_pass.id THEN p_pass.guest_name
             WHEN w.skey LIKE 'guest:%' THEN (SELECT h.guest_name FROM public.event_guest_passes h WHERE 'guest:' || h.id = w.skey)
             WHEN w.skey IN ('yuno', 'direct') THEN NULL
             ELSE (SELECT p.display_name FROM public.event_parties(p_pass.event_id) p WHERE p.party_key = w.skey)
           END AS name,
           CASE WHEN w.skey = 'guest:' || p_pass.id THEN 'me'
                WHEN w.skey IN ('yuno', 'direct') THEN w.skey
                WHEN w.skey LIKE 'guest:%' THEN 'guest'
                ELSE 'party' END AS kind
      FROM who w
  )
  SELECT jsonb_build_object(
    'now', v_now,
    'phase', v_phase,
    'viewer', jsonb_build_object('member_level', v_member, 'signed_in', v_uid IS NOT NULL),
    'money_visible', v_money,
    'event', jsonb_build_object(
      'title', e.title, 'start_at', e.start_at, 'end_at', e.end_at, 'timezone', v_tz,
      'poster_url', coalesce(e.poster_url, e.image_url),
      -- Visuels de la page soirée, tels quels : l'image 16:9 et la vidéo.
      'wide_url', e.flyer_wide_url,
      'video_url', e.video_url,
      'location_name', e.location_name, 'location_city', e.location_city,
      'location_address', CASE WHEN coalesce(e.location_is_secret, false) THEN NULL ELSE e.location_address END,
      'organizer_name', coalesce(v_org.display_name, 'Yuno'), 'organizer_avatar', v_org.avatar_url,
      'event_mode', e.event_mode, 'ticket_selling_mode', e.ticket_selling_mode,
      'tables_enabled', coalesce(e.tables_enabled, false)
    ),
    'organizer_contact', jsonb_build_object(
      'email', p_pass.organizer_contact_email, 'phone', p_pass.organizer_contact_phone, 'instagram', v_org.instagram
    ),
    'totals', jsonb_build_object(
      'tickets', jsonb_build_object(
        'sold', (SELECT coalesce(sum(heads), 0) FROM tx WHERE pillar = 'tickets'),
        'paid', (SELECT coalesce(sum(heads), 0) FROM tx WHERE pillar = 'tickets' AND paid),
        'free', (SELECT coalesce(sum(heads), 0) FROM tx WHERE pillar = 'tickets' AND NOT paid),
        'today', (SELECT coalesce(sum(heads), 0) FROM tx WHERE pillar = 'tickets' AND at_ts >= v_day_start),
        'capacity', CASE
          WHEN coalesce(e.max_tickets, 0) > 0 THEN e.max_tickets
          WHEN EXISTS (SELECT 1 FROM rounds) AND NOT EXISTS (SELECT 1 FROM rounds WHERE coalesce(max_tickets, 0) <= 0)
            THEN (SELECT sum(max_tickets) FROM rounds)
          ELSE NULL END,
        'on_sale', (SELECT count(*) FROM rounds r WHERE r.is_active AND NOT coalesce(r.manually_sold_out, false)
                     AND (coalesce(r.max_tickets, 0) <= 0 OR r.sold < r.max_tickets) AND NOT coalesce(e.tickets_sold_out, false))
      ),
      'tables', jsonb_build_object(
        'booked', (SELECT count(*) FROM tx WHERE pillar = 'tables'),
        'guests', (SELECT coalesce(sum(heads), 0) FROM tx WHERE pillar = 'tables'),
        'today', (SELECT count(*) FROM tx WHERE pillar = 'tables' AND at_ts >= v_day_start),
        'capacity', nullif((SELECT coalesce(sum(tables_count), 0) FROM packs), 0)
      ),
      'guest_list', jsonb_build_object(
        'registered', (SELECT count(*) FROM gle),
        'places', (SELECT CASE WHEN count(*) > 0 AND count(*) FILTER (WHERE coalesce(gl.quota, 0) <= 0) = 0
                               THEN sum(gl.quota) END
                     FROM public.guest_lists gl WHERE gl.event_id = p_pass.event_id AND gl.is_active),
        'mine_places', (SELECT gl.quota FROM public.guest_lists gl WHERE gl.id = v_gl_id),
        'mine_registered', (SELECT count(*) FROM gle WHERE guest_list_id = v_gl_id),
        'mine_entered', (SELECT count(*) FROM gle WHERE guest_list_id = v_gl_id AND scanned)
      ),
      'expected', (SELECT coalesce(sum(heads), 0) FROM tx) + (SELECT count(*) FROM gle),
      'expected_today', (SELECT coalesce(sum(heads), 0) FROM tx WHERE at_ts >= v_day_start)
                      + (SELECT count(*) FROM gle WHERE at_ts >= v_day_start),
      'entered', jsonb_build_object(
        'tickets', (SELECT coalesce(sum(heads), 0) FROM tx WHERE pillar = 'tickets' AND scanned),
        'tables', (SELECT coalesce(sum(heads), 0) FROM tx WHERE pillar = 'tables' AND scanned),
        'guest_list', (SELECT count(*) FROM gle WHERE scanned),
        'last_10min', (SELECT count(*) FROM public.tickets t WHERE t.event_id = p_pass.event_id
                         AND t.entry_scanned_at > v_now - interval '10 minutes')
                    + (SELECT count(*) FROM public.guest_list_entries g JOIN public.guest_lists gl ON gl.id = g.guest_list_id
                         WHERE gl.event_id = p_pass.event_id AND g.entry_scanned_at > v_now - interval '10 minutes')
      ),
      'revenue', CASE WHEN v_money THEN jsonb_build_object(
        'total', round((SELECT coalesce(sum(gross - refund), 0) FROM tx)::numeric, 2),
        'today', round((SELECT coalesce(sum(gross - refund), 0) FROM tx WHERE at_ts >= v_day_start)::numeric, 2),
        'tickets', round((SELECT coalesce(sum(gross - refund), 0) FROM tx WHERE pillar = 'tickets')::numeric, 2),
        'tables', round((SELECT coalesce(sum(gross - refund), 0) FROM tx WHERE pillar = 'tables')::numeric, 2)
      ) END
    ),
    'series', coalesce((
      SELECT jsonb_agg(jsonb_build_object('d', s.d, 'tickets', coalesce(s.tickets, 0), 'tables', s.tables) ORDER BY s.d DESC)
        FROM series s WHERE s.d <= 60
    ), '[]'::jsonb),
    'series_before', jsonb_build_object(
      'tickets', (SELECT coalesce(sum(s.tickets), 0) FROM series s WHERE s.d > 60),
      'tables', (SELECT coalesce(sum(s.tables), 0) FROM series s WHERE s.d > 60)),
    'tickets', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'name', r.name, 'price', r.price, 'sold', r.sold, 'capacity', nullif(r.max_tickets, 0),
               'entry_deadline', to_char(r.entry_deadline, 'HH24:MI'),
               'includes_drink', coalesce(r.includes_drink, false),
               'drink_cutoff', to_char(r.drink_cutoff_time, 'HH24:MI'),
               'revenue', CASE WHEN v_money THEN round(r.ca::numeric, 2) END,
               'status', CASE
                 WHEN coalesce(e.tickets_sold_out, false) OR coalesce(r.manually_sold_out, false)
                   OR (coalesce(r.max_tickets, 0) > 0 AND r.sold >= r.max_tickets) THEN 'sold_out'
                 WHEN r.is_active THEN 'on_sale'
                 WHEN coalesce(r.auto_activate, false) THEN 'upcoming'
                 ELSE 'closed' END
             ) ORDER BY r.position, r.created_at)
        FROM rounds r WHERE NOT coalesce(r.hidden, false) OR r.sold > 0
    ), '[]'::jsonb),
    'tables', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'name', p.name, 'price', p.base_price, 'sold', p.sold, 'capacity', nullif(p.tables_count, 0),
               'guests', p.guests, 'revenue', CASE WHEN v_money THEN round(p.ca::numeric, 2) END
             ) ORDER BY p.position, p.created_at)
        FROM packs p
    ), '[]'::jsonb),
    'guest_list_parts', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'name', CASE WHEN gl.guest_pass_id IS NOT NULL THEN coalesce(h.guest_name, gl.holder_label)
                            WHEN gl.holder_type = 'organizer' THEN coalesce(op.display_name, nullif(btrim(gl.holder_label), ''))
                            ELSE coalesce(nullif(btrim(gl.holder_label), ''), v_org.display_name) END,
               'places', nullif(gl.quota, 0),
               'registered', (SELECT count(*) FROM gle WHERE gle.guest_list_id = gl.id),
               'entered', (SELECT count(*) FROM gle WHERE gle.guest_list_id = gl.id AND gle.scanned),
               'mine', gl.id = v_gl_id
             ) ORDER BY gl.id = v_gl_id DESC, gl.created_at)
        FROM public.guest_lists gl
        LEFT JOIN public.event_guest_passes h ON h.id = gl.guest_pass_id
        LEFT JOIN public.organizer_profiles op ON op.user_id = gl.organizer_user_id
       WHERE gl.event_id = p_pass.event_id AND (gl.is_active OR gl.id = v_gl_id)
    ), '[]'::jsonb),
    'my_guests', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.full_name, 'entered', coalesce(g.entry_scanned, false),
                                          'at', g.created_at) ORDER BY g.created_at DESC)
        FROM public.guest_list_entries g
       WHERE g.guest_list_id = v_gl_id AND g.status <> 'cancelled'
    ), '[]'::jsonb),
    'who_sells', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'key', w.skey, 'kind', w.kind, 'name', w.name,
               'tickets', coalesce(w.tickets, 0), 'tables', coalesce(w.tables, 0),
               'revenue', CASE WHEN v_money THEN round(coalesce(w.ca, 0)::numeric, 2) END
             ) ORDER BY coalesce(w.tickets, 0) + coalesce(w.tables, 0) DESC)
        FROM who_named w
    ), '[]'::jsonb),
    'parties', coalesce((
      SELECT jsonb_agg(jsonb_build_object('key', p.party_key, 'name', p.display_name, 'kind', p.kind, 'role', p.role) ORDER BY p.ord)
        FROM public.event_parties(p_pass.event_id) p
    ), '[]'::jsonb),
    'my_links', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', tl.id, 'code', tl.code, 'channel', replace(coalesce(tl.utm_source, 'guest_direct'), 'guest_', ''),
               'active', tl.is_active, 'clicks', coalesce(tl.clicks_count, 0),
               'tickets', (SELECT coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0) FROM public.tickets t
                            WHERE t.tracked_link_id = tl.id AND t.status IN ('paid', 'used')),
               'tables', (SELECT count(*) FROM public.table_reservations r
                           WHERE r.tracked_link_id = tl.id AND r.status IN ('paid', 'confirmed')),
               'revenue', CASE WHEN v_money THEN round((
                   (SELECT coalesce(sum(greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
                                        - least(greatest(coalesce(t.refund_amount, 0), 0),
                                                greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))), 0)
                      FROM public.tickets t WHERE t.tracked_link_id = tl.id AND t.status IN ('paid', 'used'))
                 + (SELECT coalesce(sum(greatest(r.total_price - coalesce(r.service_fee, 0)
                                          - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
                                        - least(greatest(coalesce(r.refund_amount, 0), 0),
                                                greatest(r.total_price - coalesce(r.service_fee, 0)
                                                  - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))), 0)
                      FROM public.table_reservations r WHERE r.tracked_link_id = tl.id AND r.status IN ('paid', 'confirmed'))
                 )::numeric, 2) END
             ) ORDER BY tl.created_at)
        FROM public.tracked_links tl
       WHERE tl.guest_pass_id = p_pass.id AND tl.archived_at IS NULL
    ), '[]'::jsonb),
    'door', jsonb_build_object(
      'deadlines', coalesce((SELECT jsonb_agg(DISTINCT to_char(r.entry_deadline, 'HH24:MI')) FROM rounds r WHERE r.entry_deadline IS NOT NULL), '[]'::jsonb),
      'drink_heads', (SELECT coalesce(sum(r.sold), 0) FROM rounds r WHERE coalesce(r.includes_drink, false)),
      'drink_cutoff', (SELECT to_char(r.drink_cutoff_time, 'HH24:MI') FROM rounds r
                        WHERE coalesce(r.includes_drink, false) AND r.drink_cutoff_time IS NOT NULL
                        GROUP BY r.drink_cutoff_time ORDER BY sum(r.sold) DESC, r.drink_cutoff_time LIMIT 1)
    ),
    'figures', CASE WHEN v_figs THEN jsonb_build_object(
      'tickets_count', (SELECT coalesce(sum(heads), 0) FROM tx WHERE pillar = 'tickets'),
      'tickets_gross', round((SELECT coalesce(sum(gross), 0) FROM tx WHERE pillar = 'tickets')::numeric, 2),
      'tables_count', (SELECT count(*) FROM tx WHERE pillar = 'tables'),
      'tables_gross', round((SELECT coalesce(sum(gross), 0) FROM tx WHERE pillar = 'tables')::numeric, 2),
      'refunds', round((SELECT coalesce(sum(refund), 0) FROM tx)::numeric, 2),
      'refunds_count', (SELECT count(*) FROM tx WHERE refund > 0),
      'ca', round((SELECT coalesce(sum(gross - refund), 0) FROM tx)::numeric, 2),
      'stripe', round((SELECT coalesce(sum(stripe), 0) FROM tx)::numeric, 2),
      'net', round((SELECT coalesce(sum(greatest(gross - refund - stripe, 0)), 0) FROM tx)::numeric, 2),
      'net_tickets', round((SELECT coalesce(sum(greatest(gross - refund - stripe, 0)), 0) FROM tx WHERE pillar = 'tickets')::numeric, 2),
      'net_tables', round((SELECT coalesce(sum(greatest(gross - refund - stripe, 0)), 0) FROM tx WHERE pillar = 'tables')::numeric, 2),
      'yuno_fees', round((SELECT coalesce(sum(yuno_fee), 0) FROM tx)::numeric, 2)
    ) END
  ) INTO v_result;

  -- ── Argent : SA part seulement ─────────────────────────────────────────────
  v_collector := coalesce(v_compute->>'collector_key',
                          (SELECT p.party_key FROM public.event_parties(p_pass.event_id) p WHERE p.role = 'lead' ORDER BY p.ord LIMIT 1));
  IF v_contract THEN
    SELECT * INTO v_statement FROM public.collab_transfer_statements s WHERE s.event_id = p_pass.event_id;
    SELECT t.* INTO v_transfer FROM public.event_coorg_transfers t
     WHERE t.event_id = p_pass.event_id AND coalesce(t.source, 'collab') = 'collab'
       AND (t.from_party = p_pass.guest_party OR t.to_party = p_pass.guest_party)
     ORDER BY t.created_at DESC LIMIT 1;
    v_money_obj := jsonb_build_object(
      'mode', 'contract',
      'collector', v_collector,
      'collector_name', (SELECT p.display_name FROM public.event_parties(p_pass.event_id) p WHERE p.party_key = v_collector),
      'payment_terms_days', v_compute->'payment_terms_days',
      'my_share', jsonb_build_object(
        'tickets_pct', CASE WHEN p_pass.guest_party = v_compute->>'venue_key'
                            THEN 100 - public.collab_rules_org_pct(v_rules, 'tickets', e.event_mode::text)
                            ELSE public.collab_rules_org_pct(v_rules, 'tickets', e.event_mode::text) END,
        'tables_pct', CASE WHEN p_pass.guest_party = v_compute->>'venue_key'
                           THEN 100 - public.collab_rules_org_pct(v_rules, 'tables', e.event_mode::text)
                           ELSE public.collab_rules_org_pct(v_rules, 'tables', e.event_mode::text) END,
        'amount', CASE WHEN p_pass.guest_party = v_compute->>'venue_key' THEN v_compute->'venue_total' ELSE v_compute->'organizer_total' END
      ),
      'transfer', CASE
        WHEN v_transfer.id IS NOT NULL THEN jsonb_build_object(
          'direction', CASE WHEN v_transfer.to_party = p_pass.guest_party THEN 'in' ELSE 'out' END,
          'amount', v_transfer.amount, 'status', v_transfer.status, 'due_at', v_transfer.due_at,
          'reference', v_transfer.reference, 'iban_set', v_transfer.payee_iban IS NOT NULL,
          'id', CASE WHEN v_member >= 3 THEN v_transfer.id END)
        WHEN v_compute->'transfer' IS NOT NULL AND v_compute->'transfer' <> 'null'::jsonb THEN jsonb_build_object(
          'direction', CASE WHEN v_compute#>>'{transfer,to}' = p_pass.guest_party THEN 'in' ELSE 'out' END,
          'amount', v_compute#>'{transfer,amount}', 'status', 'estimate')
        END,
      'statement', jsonb_build_object('frozen', v_statement.frozen_at IS NOT NULL, 'frozen_at', v_statement.frozen_at,
                                      'status', v_statement.status)
    );
  ELSIF p_pass.contract_status IN ('proposed', 'signed') THEN
    -- Contrat de soirée de l'INVITÉ (signé dans son espace, sans compte) : sa part
    -- vient des termes signés, le décompte se fige 48 h après la fin.
    v_live := round((
      coalesce((v_result#>>'{figures,net_tickets}')::numeric, 0) * coalesce((p_pass.contract_terms->>'tickets_pct')::numeric, 0) / 100
      + coalesce((v_result#>>'{figures,net_tables}')::numeric, 0) * coalesce((p_pass.contract_terms->>'tables_pct')::numeric, 0) / 100)::numeric, 2);
    v_money_obj := jsonb_build_object(
      'mode', 'guest_contract',
      'collector', v_collector,
      'collector_name', (SELECT p.display_name FROM public.event_parties(p_pass.event_id) p WHERE p.party_key = v_collector),
      'payment_terms_days', coalesce((p_pass.contract_terms->>'payment_terms_days')::int, 15),
      'contract', jsonb_build_object(
        'status', p_pass.contract_status, 'version', p_pass.contract_version, 'terms', p_pass.contract_terms,
        'proposed_at', p_pass.contract_proposed_at, 'org_signer', p_pass.contract_org_signer,
        'signed_at', p_pass.contract_signed_at, 'signer_name', p_pass.contract_signer_name,
        'signer_email', CASE WHEN p_pass.contract_signer_email IS NOT NULL
                             THEN left(p_pass.contract_signer_email, 2) || '•••@' || split_part(p_pass.contract_signer_email, '@', 2) END,
        'reference', p_pass.transfer_reference, 'hash', p_pass.contract_hash),
      'my_share', jsonb_build_object(
        'tickets_pct', (p_pass.contract_terms->>'tickets_pct')::numeric,
        'tables_pct', (p_pass.contract_terms->>'tables_pct')::numeric,
        'amount', coalesce(CASE WHEN p_pass.statement_frozen_at IS NOT NULL THEN p_pass.transfer_amount END, v_live)),
      'transfer', jsonb_build_object(
        'direction', 'in',
        'amount', coalesce(CASE WHEN p_pass.statement_frozen_at IS NOT NULL THEN p_pass.transfer_amount END, v_live),
        'status', coalesce(p_pass.transfer_status, 'estimate'),
        'due_at', p_pass.transfer_due_at, 'reference', p_pass.transfer_reference,
        'iban_set', p_pass.guest_iban IS NOT NULL,
        'iban_masked', CASE WHEN p_pass.guest_iban IS NOT NULL THEN left(p_pass.guest_iban, 4) || ' •••• ' || right(p_pass.guest_iban, 4) END,
        'sent_at', p_pass.transfer_sent_at, 'sent_reference', p_pass.transfer_sent_reference,
        'received_at', p_pass.transfer_received_at, 'dispute_reason', p_pass.transfer_dispute_reason),
      'statement', jsonb_build_object('frozen', p_pass.statement_frozen_at IS NOT NULL, 'frozen_at', p_pass.statement_frozen_at),
      'frozen_figures', p_pass.statement_snapshot
    );
  ELSE
    v_money_obj := jsonb_build_object(
      'mode', 'external',
      'collector', v_collector,
      'collector_name', (SELECT p.display_name FROM public.event_parties(p_pass.event_id) p WHERE p.party_key = v_collector),
      'my_share', CASE WHEN p_pass.share_tickets_pct IS NOT NULL OR p_pass.share_tables_pct IS NOT NULL THEN jsonb_build_object(
        'tickets_pct', p_pass.share_tickets_pct, 'tables_pct', p_pass.share_tables_pct,
        'amount', CASE WHEN v_money THEN round((
          coalesce((v_result#>>'{figures,net_tickets}')::numeric, 0) * coalesce(p_pass.share_tickets_pct, 0) / 100
          + coalesce((v_result#>>'{figures,net_tables}')::numeric, 0) * coalesce(p_pass.share_tables_pct, 0) / 100)::numeric, 2) END,
        'declared', true) END
    );
  END IF;
  v_money_obj := v_money_obj || jsonb_build_object(
    'response', p_pass.statement_response, 'response_reason', p_pass.statement_reason,
    'responded_at', p_pass.statement_responded_at,
    'statement_ready', v_phase = 'after');

  -- Sans montants : la part due reste (c'est l'argent de l'invité), le CA et le
  -- décompte détaillé de la soirée non.
  IF NOT v_money AND NOT coalesce(p_full, false) THEN
    v_result := v_result || jsonb_build_object('figures', NULL);
    v_money_obj := v_money_obj - 'frozen_figures';
  END IF;
  RETURN v_result || jsonb_build_object('money', v_money_obj);
END;
$function$;

