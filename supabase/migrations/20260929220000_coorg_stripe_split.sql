-- Co-organisation entre DEUX organisations : « Répartir via Stripe ? » Oui / Non
-- (2026-09-29).
--
-- Stripe n'a que deux jambes par paiement : entre deux organisations (sans club),
-- l'accord de co-organisation peut donc couper CHAQUE vente en ligne par Stripe,
-- selon les parts de l'accord — même mécanique que le partage club × orga
-- (charge plateforme au nom de l'hôte, deux jambes versées après la fenêtre de
-- remboursement, `revenue_distributions`). Le décompte ne change pas : il lit
-- déjà les ventes « au nom de qui les a reçues » (`_coorg_yuno_legs`), donc il ne
-- règle plus par virement que le reste (frais avancés, recettes hors Yuno).
--
-- Règles :
--   • éligible seulement si l'accord porte EXACTEMENT deux parties à part > 0,
--     toutes deux des organisations, l'hôte (organisateur de la soirée) parmi
--     elles, aucun club sur la soirée et aucun contrat collab (club × orga =
--     contrat collab, qui a déjà son propre « Répartir via Stripe ? ») ;
--   • le partage ne s'applique qu'à un accord ACTIF (validé par les deux) et
--     quand le compte Stripe du partenaire est activé — sinon la vente part en
--     charge directe chez l'hôte, comme avant, et le décompte règle la part du
--     partenaire par virement : on ne bloque jamais une vente pour ça ;
--   • changer le choix = nouvelle version de l'accord (re-validation de tous).

ALTER TABLE public.event_coorg_deals ADD COLUMN IF NOT EXISTS stripe_split boolean NOT NULL DEFAULT false;

-- Pourquoi un accord NE PEUT PAS être réparti par Stripe (NULL = il le peut).
CREATE OR REPLACE FUNCTION public.coorg_stripe_split_blocker(p_event_id uuid, p_shares jsonb)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ev   record;
  v_keys text[];
BEGIN
  SELECT id, venue_id, partner_venue_id, organizer_user_id INTO v_ev FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN 'event_not_found'; END IF;
  IF v_ev.venue_id IS NOT NULL OR v_ev.partner_venue_id IS NOT NULL THEN RETURN 'venue_on_event'; END IF;
  IF EXISTS (SELECT 1 FROM public.event_collab_contracts c
              WHERE c.event_id = p_event_id AND c.status IN ('pending_signatures', 'active', 'locked')) THEN
    RETURN 'collab_contract';
  END IF;
  IF p_shares IS NULL OR jsonb_typeof(p_shares) <> 'object' THEN RETURN 'two_orgs_only'; END IF;
  SELECT array_agg(k) INTO v_keys FROM jsonb_each_text(p_shares) AS s(k, v) WHERE v::numeric > 0;
  IF COALESCE(array_length(v_keys, 1), 0) <> 2 THEN RETURN 'two_orgs_only'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_keys) k WHERE k NOT LIKE 'org:%') THEN RETURN 'two_orgs_only'; END IF;
  IF v_ev.organizer_user_id IS NULL OR NOT ('org:' || v_ev.organizer_user_id::text) = ANY (v_keys) THEN
    RETURN 'lead_must_share';
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.coorg_stripe_split_blocker(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coorg_stripe_split_blocker(uuid, jsonb) TO authenticated;

-- Configuration lue par les checkouts (service_role) : partenaire, sa part, son
-- compte — ou NULL (charge directe chez l'hôte, décompte par virement).
CREATE OR REPLACE FUNCTION public.coorg_stripe_split_config(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  d       record;
  v_lead  uuid;
  v_key   text;
  v_pct   numeric;
  v_org   uuid;
  v_acct  text;
  v_ok    boolean;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND session_user = 'authenticator' THEN
    RAISE EXCEPTION 'coorg_stripe_split_config: service_role only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO d FROM public.event_coorg_deals WHERE event_id = p_event_id;
  IF NOT FOUND OR d.status <> 'active' OR NOT d.stripe_split THEN RETURN NULL; END IF;
  IF public.coorg_stripe_split_blocker(p_event_id, d.shares) IS NOT NULL THEN RETURN NULL; END IF;
  SELECT organizer_user_id INTO v_lead FROM public.events WHERE id = p_event_id;
  SELECT k, v::numeric INTO v_key, v_pct FROM jsonb_each_text(d.shares) AS s(k, v)
   WHERE v::numeric > 0 AND k <> 'org:' || v_lead::text LIMIT 1;
  IF v_key IS NULL THEN RETURN NULL; END IF;
  BEGIN v_org := substr(v_key, 5)::uuid; EXCEPTION WHEN others THEN RETURN NULL; END;
  SELECT stripe_connect_account_id, COALESCE(stripe_connect_charges_enabled, false)
    INTO v_acct, v_ok FROM public.profiles WHERE id = v_org;
  RETURN jsonb_build_object(
    'partner_organizer_id', v_org,
    'partner_pct', v_pct,
    'partner_account_id', v_acct,
    'partner_ready', v_acct IS NOT NULL AND v_ok,
    'deal_version', d.version);
END;
$function$;
REVOKE ALL ON FUNCTION public.coorg_stripe_split_config(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coorg_stripe_split_config(uuid) TO service_role;

-- save_coorg_deal + p_stripe_split. DROP + CREATE : une surcharge rendrait
-- ambigus les appels à arguments nommés des bundles en cache.
DROP FUNCTION IF EXISTS public.save_coorg_deal(uuid, jsonb, boolean, text, integer);
CREATE OR REPLACE FUNCTION public.save_coorg_deal(p_event_id uuid, p_shares jsonb, p_formal boolean DEFAULT false, p_clauses text DEFAULT NULL::text, p_payment_terms_days integer DEFAULT 15, p_stripe_split boolean DEFAULT false)
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
  -- Collab réglé par virement : le contrat partage déjà l'argent entre le club et
  -- l'orga ; un second accord le compterait deux fois.
  IF public.collab_settlement_mode((SELECT e.revenue_split_rules FROM public.events e WHERE e.id = p_event_id)) = 'transfer' THEN
    RAISE EXCEPTION 'collab_transfer_unsupported';
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
  -- « Répartir via Stripe ? » Oui : deux organisations seulement (cf. en-tête).
  IF COALESCE(p_stripe_split, false) AND public.coorg_stripe_split_blocker(p_event_id, p_shares) IS NOT NULL THEN
    RAISE EXCEPTION 'stripe_split_unsupported';
  END IF;

  INSERT INTO public.event_coorg_deals (event_id, shares, formal, clauses, payment_terms_days, stripe_split, created_by, status, signatures)
  VALUES (p_event_id, p_shares, COALESCE(p_formal, false), NULLIF(btrim(COALESCE(p_clauses, '')), ''), v_terms,
          COALESCE(p_stripe_split, false), auth.uid(), 'pending', '{}'::jsonb)
  ON CONFLICT (event_id) DO UPDATE
     SET shares = EXCLUDED.shares, formal = EXCLUDED.formal, clauses = EXCLUDED.clauses,
         payment_terms_days = EXCLUDED.payment_terms_days, stripe_split = EXCLUDED.stripe_split,
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
REVOKE ALL ON FUNCTION public.save_coorg_deal(uuid, jsonb, boolean, text, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_coorg_deal(uuid, jsonb, boolean, text, integer, boolean) TO authenticated;

-- get_event_coorg : + event.has_venue, + parties[].stripe_ready (pour qui tient
-- l'argent). Reprise de l'état LIVE.
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
                                'ended', v_ev.end_at < now(),
                                'has_venue', v_ev.venue_id IS NOT NULL OR v_ev.partner_venue_id IS NOT NULL,
                                'has_stripe_collab',
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
                  'slug', p.slug, 'avatar_url', p.avatar_url, 'city', p.city,
                  -- Compte Stripe activé : seulement pour qui tient l'argent (« Répartir via Stripe ? »).
                  'stripe_ready', CASE WHEN v_money THEN
                    CASE WHEN p.kind = 'venue' THEN COALESCE((SELECT v.stripe_charges_enabled FROM public.venues v WHERE v.id = p.venue_id), false)
                         ELSE COALESCE((SELECT pr.stripe_connect_charges_enabled AND pr.stripe_connect_account_id IS NOT NULL
                                          FROM public.profiles pr WHERE pr.id = p.organizer_user_id), false) END END
                ) ORDER BY p.ord), '[]'::jsonb)
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
    -- Invitations par email (structures sans compte) : visibles des parties principales.
    'email_invitations', CASE WHEN COALESCE(v_me.role IN ('lead', 'partner') AND v_me.level >= 2, false) OR public.is_super_admin()
                         THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                                 'id', i.id, 'email', i.email, 'name', i.name, 'access', i.access,
                                 'invited_at', i.created_at, 'expires_at', i.expires_at) ORDER BY i.created_at DESC), '[]'::jsonb)
                                 FROM public.event_cohost_email_invites i
                                WHERE i.event_id = p_event_id AND i.status = 'pending' AND i.expires_at > now())
                         ELSE '[]'::jsonb END,
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
                    FROM public.event_coorg_transfers t WHERE t.event_id = p_event_id AND t.source = 'coorg') END
  );
END;
$function$;
