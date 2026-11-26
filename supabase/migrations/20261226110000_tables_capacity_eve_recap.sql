-- Tables VIP, vague C1 — P4.6 capacité unique + P4.5 (D7) récap de la veille dans la cloche.
--
-- P4.6. La capacité de tables d'une soirée se calculait de quatre façons (somme de tables_count des formules : _event_tables_left,
-- _tix_event_tables_total, get_events_sales_summary, get_event_report, verify-table-payment). Une seule règle,
-- `_event_table_capacity(event)` :
--   • mode ÉLITE (events.tables_mode <> 'basic', NULL = élite) : nombre de tables du plan de la soirée (sinon du club) liées à une
--     formule OUVERTE (active, non marquée complète). Une table dont la clé `packId` est absente (ancien plan) se lie par sa zone :
--     elle compte si une formule ouverte vit dans cette zone ; `packId: null` explicite = table non liée, jamais comptée ;
--   • mode BASIC : somme des tables_count des formules ouvertes, À CONDITION que TOUTES aient `limit_tables` ; sinon illimité (NULL),
--     la jauge n'a pas de pourcentage ;
--   • NULL = illimité / inconnu (aucune formule ouverte, aucune table liée) : même sens qu'avant pour `_event_tables_left`.
--
-- P4.5 (D7). Cloche seulement. Récap de la veille : `tables_eve_recap_run()`, appelée par le passage process-scheduled-campaigns
-- (fenêtre 16 h – 22 h Paris, dedup par soirée et par partie, démo exclue) : une notification `table_eve_recap` par soirée du lendemain
-- (nuit = début − 8 h, jour de Paris), club (emit_staff_notification) ET organisateur (emit_organizer_notification) : tables vendues,
-- convives, attribuées / à placer, précommandes de bouteilles ; metadata.link = 'vip_service' (Service VIP de la soirée).
-- Les nouvelles réservations (verify-table-payment, create-table-checkout) portent aussi metadata.link = 'vip_service' et pack_name.

-- ── 1. Capacité unique ──────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._event_table_capacity(p_event_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH e AS (
    SELECT id, COALESCE(venue_id, partner_venue_id) AS vid, COALESCE(sold_out_pack_ids, '{}'::uuid[]) AS closed,
           (tables_mode = 'basic') AS basic
      FROM public.events WHERE id = p_event_id
  ),
  open_packs AS (
    SELECT p.id, p.zone_id, COALESCE(p.tables_count, 0) AS tables_count, COALESCE(p.limit_tables, false) AS limit_tables
      FROM public.table_packs p, e
     WHERE p.is_active
       AND (p.event_id = e.id OR (p.event_id IS NULL AND e.vid IS NOT NULL AND p.venue_id = e.vid))
       AND NOT (p.id = ANY (e.closed))
  ),
  plan AS (
    SELECT f.layout
      FROM public.venue_floor_plans f, e
     WHERE f.event_id = e.id
        OR (f.event_id IS NULL AND e.vid IS NOT NULL AND f.venue_id = e.vid
            AND NOT EXISTS (SELECT 1 FROM public.venue_floor_plans f2 WHERE f2.event_id = e.id))
     ORDER BY (f.event_id IS NULL)
     LIMIT 1
  ),
  elite AS (
    SELECT count(*)::integer AS n
      FROM plan, jsonb_array_elements(COALESCE(plan.layout->'tables', '[]'::jsonb)) AS t
     WHERE (jsonb_typeof(t->'packId') = 'string'
            AND EXISTS (SELECT 1 FROM open_packs op WHERE op.id::text = t->>'packId'))
        OR (NOT (t ? 'packId')
            AND EXISTS (SELECT 1 FROM open_packs op WHERE op.zone_id IS NOT NULL AND op.zone_id::text = t->>'zoneId'))
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM e) THEN NULL
    WHEN (SELECT basic FROM e) THEN
      CASE WHEN NOT EXISTS (SELECT 1 FROM open_packs) THEN NULL
           WHEN (SELECT bool_and(limit_tables) FROM open_packs) THEN NULLIF((SELECT sum(tables_count) FROM open_packs), 0)::integer
           ELSE NULL END
    ELSE NULLIF((SELECT n FROM elite), 0)
  END;
$$;

-- Chiffre public (un visiteur lit déjà `_event_tables_left`, qui l'appelle) : lecture ouverte, rien à écrire.
REVOKE ALL ON FUNCTION public._event_table_capacity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._event_table_capacity(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._event_tables_left(p_event_id uuid)
RETURNS integer
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE WHEN public._event_table_capacity(p_event_id) IS NULL THEN NULL
              ELSE GREATEST(0, public._event_table_capacity(p_event_id) - (
                SELECT count(*)::integer FROM public.table_reservations r
                 WHERE r.event_id = p_event_id AND r.status IN ('paid', 'confirmed'))) END;
$$;

CREATE OR REPLACE FUNCTION public._tix_event_tables_total(p_event_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._event_table_capacity(p_event_id);
$$;

-- Lecteurs de la capacité : patch ciblé (regex ARE : la gourmandise de TOUT le motif suit son premier quantificateur, d'où \s*?) sur la définition VIVANTE (jamais une recopie de 12 000 caractères).
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  -- get_events_sales_summary : le CTE `packs` (somme des tables_count) devient la capacité unique.
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_events_sales_summary';
  v_new := regexp_replace(
    v_def,
    'packs as \(\s*?select ev\.id as event_id, coalesce\(sum\(p\.tables_count\), 0\)::integer as cap.*?group by ev\.id\s*\),',
    E'packs as (\n    select ev.id as event_id, coalesce(public._event_table_capacity(ev.id), 0)::integer as cap from ev\n  ),',
    's');
  IF v_new = v_def THEN RAISE EXCEPTION 'patch get_events_sales_summary: motif introuvable'; END IF;
  EXECUTE v_new;

  -- get_event_report : tables.capacity.
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_event_report';
  v_new := regexp_replace(
    v_def,
    '''capacity'', nullif\(\(\s*?select coalesce\(sum\(p\.tables_count\), 0\)\s*?from public\.table_packs p.*?\), 0\),',
    '''capacity'', public._event_table_capacity(p_event_id),',
    's');
  IF v_new = v_def THEN RAISE EXCEPTION 'patch get_event_report: motif introuvable'; END IF;
  EXECUTE v_new;
END
$patch$;

-- ── 2. Récap de la veille ───────────────────────────────────────────────────────────────────────────────────────────────
-- Langue d'un pro : celle de son profil, sinon le français (les notifications de table existantes sont en français).
CREATE OR REPLACE FUNCTION public._pro_notif_lang(p_user uuid)
RETURNS text
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT preferred_language FROM public.profiles WHERE id = p_user AND preferred_language IN ('en', 'es', 'fr')), 'fr');
$$;

CREATE OR REPLACE FUNCTION public._table_eve_recap_text(
  p_lang text, p_title text, p_sold integer, p_guests integer, p_placed integer, p_orders integer, p_orders_total numeric, p_left integer
) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_lang
    WHEN 'en' THEN p_sold || ' VIP table' || CASE WHEN p_sold = 1 THEN '' ELSE 's' END || ' sold, ' || p_guests || ' guests, '
      || p_placed || ' placed, ' || (p_sold - p_placed) || ' to place'
      || CASE WHEN p_orders > 0 THEN ', ' || p_orders || ' bottle pre-order' || CASE WHEN p_orders = 1 THEN '' ELSE 's' END
           || ' (' || to_char(p_orders_total, 'FM999990.00') || ' EUR to collect on site)' ELSE '' END
      || CASE WHEN p_left IS NOT NULL THEN ', ' || p_left || ' table' || CASE WHEN p_left = 1 THEN '' ELSE 's' END || ' left' ELSE '' END || '.'
    WHEN 'es' THEN p_sold || ' mesa' || CASE WHEN p_sold = 1 THEN '' ELSE 's' END || ' VIP vendida' || CASE WHEN p_sold = 1 THEN '' ELSE 's' END
      || ', ' || p_guests || ' invitados, ' || p_placed || ' asignadas, ' || (p_sold - p_placed) || ' por asignar'
      || CASE WHEN p_orders > 0 THEN ', ' || p_orders || ' pedido' || CASE WHEN p_orders = 1 THEN '' ELSE 's' END || ' previo' || CASE WHEN p_orders = 1 THEN '' ELSE 's' END
           || ' de botellas (' || to_char(p_orders_total, 'FM999990.00') || ' EUR a cobrar en el local)' ELSE '' END
      || CASE WHEN p_left IS NOT NULL THEN ', ' || p_left || ' mesa' || CASE WHEN p_left = 1 THEN '' ELSE 's' END || ' disponible' || CASE WHEN p_left = 1 THEN '' ELSE 's' END ELSE '' END || '.'
    ELSE p_sold || ' table' || CASE WHEN p_sold > 1 THEN 's' ELSE '' END || ' VIP vendue' || CASE WHEN p_sold > 1 THEN 's' ELSE '' END
      || ', ' || p_guests || ' convives, ' || p_placed || ' attribuée' || CASE WHEN p_placed > 1 THEN 's' ELSE '' END
      || ', ' || (p_sold - p_placed) || ' à placer'
      || CASE WHEN p_orders > 0 THEN ', ' || p_orders || ' précommande' || CASE WHEN p_orders > 1 THEN 's' ELSE '' END
           || ' de bouteilles (' || to_char(p_orders_total, 'FM999990.00') || ' € à encaisser sur place)' ELSE '' END
      || CASE WHEN p_left IS NOT NULL THEN ', ' || p_left || ' table' || CASE WHEN p_left > 1 THEN 's' ELSE '' END || ' restante' || CASE WHEN p_left > 1 THEN 's' ELSE '' END ELSE '' END || '.'
  END;
$$;

CREATE OR REPLACE FUNCTION public.tables_eve_recap_run(p_force boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_now_paris timestamp := now() AT TIME ZONE 'Europe/Paris';
  v_tomorrow  date := (now() AT TIME ZONE 'Europe/Paris')::date + 1;
  ev          record;
  v_sold      integer;
  v_guests    integer;
  v_placed    integer;
  v_orders    integer;
  v_total     numeric;
  v_left      integer;
  v_party     record;
  v_lang      text;
  v_title     text;
  v_msg       text;
  v_meta      jsonb;
  v_n         integer := 0;
BEGIN
  -- Fenêtre : 16 h – 22 h heure de Paris (le récap arrive la veille au soir, jamais en pleine nuit) ; p_force : banc d'essai.
  IF NOT COALESCE(p_force, false) AND (extract(hour FROM v_now_paris) < 16 OR extract(hour FROM v_now_paris) >= 22) THEN
    RETURN 0;
  END IF;

  FOR ev IN
    SELECT e.id, e.title, e.venue_id, e.partner_venue_id, e.organizer_user_id, e.partner_organizer_id
      FROM public.events e
     WHERE e.is_active AND e.cancelled_at IS NULL
       AND ((e.start_at AT TIME ZONE 'Europe/Paris') - interval '8 hours')::date = v_tomorrow
       AND e.start_at > now()
       AND NOT (e.id = ANY (public.demo_event_ids()))
       AND (COALESCE(e.tables_enabled, false)
            OR EXISTS (SELECT 1 FROM public.table_reservations r WHERE r.event_id = e.id AND r.status IN ('paid', 'confirmed')))
  LOOP
    SELECT count(*), COALESCE(sum(GREATEST(COALESCE(r.guest_count, 0), 0)), 0),
           count(*) FILTER (WHERE r.assigned_table_id IS NOT NULL)
      INTO v_sold, v_guests, v_placed
      FROM public.table_reservations r
     WHERE r.event_id = ev.id AND r.status IN ('paid', 'confirmed');
    CONTINUE WHEN v_sold = 0;  -- rien à raconter : pas de notification vide

    SELECT count(*), COALESCE(sum(o.total_amount), 0)
      INTO v_orders, v_total
      FROM public.vip_table_orders o
      JOIN public.table_reservations r ON r.id = o.table_reservation_id
     WHERE r.event_id = ev.id AND r.status IN ('paid', 'confirmed') AND o.status = 'preorder';
    v_left := public._event_tables_left(ev.id);

    v_meta := jsonb_build_object('sold', v_sold, 'guests', v_guests, 'placed', v_placed, 'to_place', v_sold - v_placed,
                                 'preorders', v_orders, 'preorders_total', v_total, 'tables_left', v_left, 'link', 'vip_service');

    -- Clubs : l'hôte et le club partenaire ; organisateurs : l'organisateur et l'organisateur partenaire.
    FOR v_party IN
      SELECT DISTINCT 'venue'::text AS kind, v.vid::text AS pid, NULL::uuid AS uid
        FROM (VALUES (ev.venue_id), (ev.partner_venue_id)) AS v(vid) WHERE v.vid IS NOT NULL
      UNION ALL
      SELECT DISTINCT 'org', o.oid::text, o.oid
        FROM (VALUES (ev.organizer_user_id), (ev.partner_organizer_id)) AS o(oid) WHERE o.oid IS NOT NULL
    LOOP
      BEGIN
        IF v_party.kind = 'venue' THEN
          v_lang := public._pro_notif_lang((SELECT owner_id FROM public.venues WHERE id = v_party.pid));
        ELSE
          v_lang := public._pro_notif_lang(v_party.uid);
        END IF;
        v_title := CASE v_lang WHEN 'en' THEN 'Tomorrow: VIP tables recap' WHEN 'es' THEN 'Mañana: resumen de mesas VIP' ELSE 'Demain : récap des tables VIP' END;
        v_msg := COALESCE(ev.title, '') || ' · ' || public._table_eve_recap_text(v_lang, ev.title, v_sold, v_guests, v_placed, v_orders, v_total, v_left);

        IF v_party.kind = 'venue' THEN
          PERFORM public.emit_staff_notification(
            v_party.pid, 'owner', 'table_eve_recap', v_title, left(v_msg, 480), 'normal',
            'event', ev.id, ev.id, v_meta, 'table_eve_recap:' || ev.id || ':v:' || v_party.pid);
        ELSE
          PERFORM public.emit_organizer_notification(
            v_party.uid, 'table_eve_recap', v_title, left(v_msg, 480), 'normal',
            'event', ev.id, ev.id, v_meta, 'table_eve_recap:' || ev.id || ':o:' || v_party.pid);
        END IF;
        v_n := v_n + 1;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'tables_eve_recap_run % : %', ev.id, SQLERRM;
      END;
    END LOOP;
  END LOOP;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public._pro_notif_lang(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._table_eve_recap_text(text, text, integer, integer, integer, integer, numeric, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tables_eve_recap_run(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._pro_notif_lang(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._table_eve_recap_text(text, text, integer, integer, integer, integer, numeric, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.tables_eve_recap_run(boolean) TO service_role;
