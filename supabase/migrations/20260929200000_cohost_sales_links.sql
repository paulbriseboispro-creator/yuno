-- Co-organisation — un LIEN DE VENTE SUIVI par partie (point 5, 2026-09-29).
--
-- Sur une soirée à plusieurs, chaque partie (club, organisateur, co-hôte) vend
-- à SON public. Sans lien propre, une vente venue du public d'un co-hôte se
-- lit comme une vente « directe » de l'hôte : impossible de dire qui a fait
-- vendre. Chaque partie reçoit donc un lien /l/<code> à elle, posé sur la
-- soirée (tracked_links, même mécanique que les canaux Instagram / newsletter),
-- et la page de co-organisation montre, partie par partie : clics, ventes,
-- billets, tables, inscriptions guest list — et le CA pour qui voit l'argent.
--
-- Règles :
--   • le lien appartient à la PORTÉE de la partie (owner_kind venue/organizer) :
--     il apparaît aussi dans ses propres « Liens suivis » ;
--   • c'est une ATTRIBUTION, jamais un partage d'argent : l'argent suit
--     l'accord de co-organisation et son décompte, rien d'autre ;
--   • un co-hôte qui quitte la soirée (ou en est retiré) voit son lien éteint ;
--   • CA = CA club de fees.ts (billets : total − frais de service − assurance −
--     remboursement ; tables : total − frais de service − frais de gestion
--     absorbés − remboursement), visible seulement à qui voit l'argent de la
--     soirée (coorg_sees_event_money) ; les compteurs sont visibles de toutes
--     les parties ; le CODE d'un lien n'est rendu qu'à sa partie.

-- ── 1. Créer (ou retrouver) le lien d'une partie ──────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_event_party_link(p_event_id uuid, p_party text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_ev    record;
  v_party record;
  v_code  text;
  v_id    uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated'); END IF;
  SELECT id, cancelled_at, end_at INTO v_ev FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF v_ev.cancelled_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'event_cancelled'); END IF;

  -- La partie demandée, sinon la mienne (la plus haute).
  SELECT p.* INTO v_party
    FROM public.event_parties(p_event_id) p
   WHERE (p_party IS NULL OR p.party_key = p_party)
     AND public.coorg_party_level(v_uid, p.party_key) >= 1
   ORDER BY public.coorg_party_level(v_uid, p.party_key) DESC, p.ord
   LIMIT 1;
  IF v_party.party_key IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;

  -- Un seul lien par (soirée, partie) : on sérialise sur la clé.
  PERFORM pg_advisory_xact_lock(hashtext('party_link:' || p_event_id::text || ':' || v_party.party_key));

  SELECT tl.id, tl.code INTO v_id, v_code
    FROM public.tracked_links tl
   WHERE tl.event_id = p_event_id AND tl.utm_medium = 'party_link' AND tl.utm_campaign = v_party.party_key
   ORDER BY tl.created_at
   LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.tracked_links
      (code, label, owner_kind, venue_id, organizer_user_id, created_by, target_kind, event_id,
       utm_source, utm_medium, utm_campaign)
    VALUES
      (public.gen_tracked_link_code(), 'coorg', CASE WHEN v_party.kind = 'venue' THEN 'venue' ELSE 'organizer' END,
       v_party.venue_id, v_party.organizer_user_id, v_uid, 'event', p_event_id,
       'coorg', 'party_link', v_party.party_key)
    RETURNING id, code INTO v_id, v_code;
  ELSE
    -- Rallumé si la partie est (re)devenue partie de la soirée.
    UPDATE public.tracked_links SET is_active = true WHERE id = v_id AND NOT is_active;
  END IF;

  RETURN jsonb_build_object('ok', true, 'party', v_party.party_key, 'code', v_code, 'id', v_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_event_party_link(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_event_party_link(uuid, text) TO authenticated;

-- ── 2. Chiffres par partie ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_event_party_links(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_admin boolean := public.is_super_admin();
  v_mine  text[];
  v_money boolean;
  v_rows  jsonb;
  v_total record;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT array_agg(p.party_key) INTO v_mine FROM public.event_parties(p_event_id) p
   WHERE public.coorg_party_level(v_uid, p.party_key) >= 1;
  IF v_mine IS NULL AND NOT v_admin THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;

  -- L'argent : une de MES parties de niveau argent, qui voit le CA de la soirée.
  v_money := v_admin OR EXISTS (
    SELECT 1 FROM unnest(COALESCE(v_mine, '{}'::text[])) k
     WHERE public.coorg_party_level(v_uid, k) >= 3 AND public.coorg_sees_event_money(p_event_id, k));

  WITH links AS (
    SELECT tl.id, tl.code, tl.utm_campaign AS party_key, tl.clicks_count, tl.is_active
      FROM public.tracked_links tl
     WHERE tl.event_id = p_event_id AND tl.utm_medium = 'party_link'
  ),
  sales AS (
    SELECT t.tracked_link_id AS link_id, 1 AS sales, COALESCE(t.quantity, 1) AS tickets, 0 AS tables, 0 AS guests,
           greatest(COALESCE(t.total_price, 0) - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)
             - least(greatest(COALESCE(t.refund_amount, 0), 0),
                     greatest(COALESCE(t.total_price, 0) - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)) AS ca
      FROM public.tickets t
     WHERE t.event_id = p_event_id AND t.tracked_link_id IN (SELECT id FROM links)
       AND t.status IN ('paid', 'used', 'served')
    UNION ALL
    SELECT r.tracked_link_id, 1, 0, 1, 0,
           greatest(COALESCE(r.total_price, 0) - COALESCE(r.service_fee, 0)
                    - CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END, 0)
             - least(greatest(COALESCE(r.refund_amount, 0), 0),
                     greatest(COALESCE(r.total_price, 0) - COALESCE(r.service_fee, 0)
                              - CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END, 0))
      FROM public.table_reservations r
     WHERE r.event_id = p_event_id AND r.tracked_link_id IN (SELECT id FROM links)
       AND r.status IN ('paid', 'confirmed', 'served')
    UNION ALL
    SELECT g.tracked_link_id, 1, 0, 0, 1, 0
      FROM public.guest_list_entries g
     WHERE g.tracked_link_id IN (SELECT id FROM links)
       AND g.status IN ('confirmed', 'entered', 'reserved')
  ),
  agg AS (
    SELECT link_id, sum(sales)::int AS sales, sum(tickets)::int AS tickets, sum(tables)::int AS tables,
           sum(guests)::int AS guests, round(sum(ca), 2) AS ca
      FROM sales GROUP BY link_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'party', p.party_key, 'name', p.display_name, 'kind', p.kind, 'role', p.role,
           'avatar_url', p.avatar_url,
           'mine', p.party_key = ANY (COALESCE(v_mine, '{}'::text[])),
           'has_link', l.id IS NOT NULL,
           'code', CASE WHEN p.party_key = ANY (COALESCE(v_mine, '{}'::text[])) OR v_admin THEN l.code END,
           'active', COALESCE(l.is_active, false),
           'clicks', COALESCE(l.clicks_count, 0),
           'sales', COALESCE(a.sales, 0), 'tickets', COALESCE(a.tickets, 0),
           'tables', COALESCE(a.tables, 0), 'guests', COALESCE(a.guests, 0),
           'revenue', CASE WHEN v_money THEN COALESCE(a.ca, 0) END
         ) ORDER BY p.ord, p.party_key), '[]'::jsonb)
    INTO v_rows
    FROM public.event_parties(p_event_id) p
    LEFT JOIN links l ON l.party_key = p.party_key
    LEFT JOIN agg a ON a.link_id = l.id;

  RETURN jsonb_build_object('ok', true, 'money', v_money, 'parties', v_rows);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_party_links(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_party_links(uuid) TO authenticated;

-- ── 3. Un co-hôte qui part : son lien s'éteint ────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_cohost_party_link_off()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_key text;
  v_row public.event_cohosts%ROWTYPE;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF TG_OP = 'UPDATE' AND (OLD.status IS NOT DISTINCT FROM NEW.status OR OLD.status <> 'accepted') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND OLD.status <> 'accepted' THEN RETURN OLD; END IF;
  v_key := CASE WHEN v_row.venue_id IS NOT NULL THEN 'venue:' || v_row.venue_id ELSE 'org:' || v_row.organizer_user_id END;
  -- Toujours partie de la soirée par une autre voie (principale) : on ne touche à rien.
  IF NOT EXISTS (SELECT 1 FROM public.event_parties(v_row.event_id) p WHERE p.party_key = v_key AND p.role <> 'cohost') THEN
    UPDATE public.tracked_links SET is_active = false
     WHERE event_id = v_row.event_id AND utm_medium = 'party_link' AND utm_campaign = v_key AND is_active;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
EXCEPTION WHEN OTHERS THEN
  -- Une attribution ne doit jamais bloquer le départ d'un co-hôte.
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

DROP TRIGGER IF EXISTS cohost_party_link_off ON public.event_cohosts;
CREATE TRIGGER cohost_party_link_off
  AFTER UPDATE OF status OR DELETE ON public.event_cohosts
  FOR EACH ROW EXECUTE FUNCTION public.trg_cohost_party_link_off();
