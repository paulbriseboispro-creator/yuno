-- Séries récurrentes : le cron SQL (generate_recurring_events →
-- _insert_recurring_rounds) rejoue enfin un modèle de billetterie LIBRE.
--
-- Avant : un modèle libre (ticket_presets.selling_mode = 'free') posé sur une
-- série était recopié comme une file de paliers — seul le premier billet en
-- vente, les suivants auto-activés l'un après l'autre, et ses dates (J-N à
-- HH:MM), ses billets cachés, sa jauge et ses heures limite d'entrée perdus.
-- Seule la création de la série (edge create-owner-recurring-events,
-- freePresetToRoundRows) le lisait bien.
--
-- Ici, la branche 'free' est le MIROIR SQL de freePresetToRoundRows
-- (src/lib/freeTicketing.ts ⇄ supabase/functions/_shared/free-ticketing.ts) :
--   • dates relatives : jours CALENDAIRES avant le jour de la soirée, heure
--     murale, fuseau de la soirée (_free_rel_to_ts ⇄ fromRelative) ;
--   • une date de vente illisible ne met jamais le billet en vente ;
--   • « s'ouvre quand tel billet est complet » (opensAfter = clé d'un billet du
--     modèle) : ids tirés avant l'insertion, lien posé dans la même requête,
--     billet fermé (la garde guard_ticket_round_opens_after confirme) ;
--   • jauge totale du modèle posée sur la soirée si elle n'en a pas.
-- Les autres modes ne changent pas d'un octet.

CREATE OR REPLACE FUNCTION public._free_rel_to_ts(p_rel jsonb, p_start timestamptz, p_tz text)
 RETURNS timestamptz
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_time text;
BEGIN
  IF p_rel IS NULL OR jsonb_typeof(p_rel) <> 'object'
     OR jsonb_typeof(p_rel->'daysBefore') <> 'number' OR jsonb_typeof(p_rel->'time') <> 'string' THEN
    RETURN NULL;
  END IF;
  v_time := substring(p_rel->>'time' from '^(?:[01]?[0-9]|2[0-3]):[0-5][0-9]');
  IF v_time IS NULL OR p_start IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN (((p_start AT TIME ZONE p_tz)::date - trunc((p_rel->>'daysBefore')::numeric)::int) + v_time::time)
         AT TIME ZONE p_tz;
END;
$function$;

REVOKE ALL ON FUNCTION public._free_rel_to_ts(jsonb, timestamptz, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._insert_recurring_rounds(p_event_id uuid, p_preset_id uuid, p_start_position integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p public.ticket_presets%ROWTYPE;
  v_mode text;
  v_count int;
  v_start timestamptz;
  v_tz text;
BEGIN
  SELECT * INTO p FROM public.ticket_presets WHERE id = p_preset_id;
  IF p.id IS NULL OR p.rounds IS NULL OR jsonb_typeof(p.rounds) <> 'array' THEN
    RETURN 0;
  END IF;
  v_mode := COALESCE(p.selling_mode, 'rounds');

  -- ── Billetterie libre : miroir de freePresetToRoundRows ──────────────────
  IF v_mode = 'free' THEN
    SELECT e.start_at, COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris')
      INTO v_start, v_tz
      FROM public.events e WHERE e.id = p_event_id;

    WITH src AS MATERIALIZED (
      SELECT
        r,
        row_number() OVER (ORDER BY ord) AS n,
        gen_random_uuid() AS new_id,
        NULLIF(r->>'key', '') AS k,
        CASE WHEN r->>'display' IN ('at', 'hidden') THEN r->>'display' ELSE 'now' END AS display,
        CASE WHEN r->>'sale' IN ('at', 'manual') THEN r->>'sale'
             WHEN r->>'sale' = 'after' THEN 'manual' ELSE 'now' END AS sale,
        (r->>'includesDrink') = 'true' AS drink
      FROM jsonb_array_elements(p.rounds) WITH ORDINALITY AS t(r, ord)
      WHERE jsonb_typeof(r) = 'object' AND jsonb_typeof(r->'name') = 'string'
    ), calc AS (
      SELECT
        s.*,
        pred.new_id AS pred_id,
        CASE WHEN s.display = 'at' THEN public._free_rel_to_ts(s.r->'visibleAt', v_start, v_tz) END AS visible_from,
        CASE WHEN s.sale = 'at' THEN public._free_rel_to_ts(s.r->'saleStartAt', v_start, v_tz) END AS sale_starts,
        public._free_rel_to_ts(s.r->'saleEndAt', v_start, v_tz) AS sale_ends,
        CASE WHEN jsonb_typeof(s.r->'maxTickets') = 'number'
                  AND (s.r->>'maxTickets')::numeric > 0 AND (s.r->>'maxTickets')::numeric < 999999
             THEN (s.r->>'maxTickets')::numeric::int ELSE 999999 END AS max_tickets,
        substring(s.r->>'entryDeadline' from '^(?:[01][0-9]|2[0-3]):[0-5][0-9]') AS entry
      FROM src s
      LEFT JOIN src pred
        ON s.r->>'opensAfter' IS NOT NULL AND pred.k = s.r->>'opensAfter' AND pred.new_id <> s.new_id
    )
    INSERT INTO public.ticket_rounds (
      id, event_id, name, price, max_tickets, last_tickets_threshold, position,
      ticket_type, auto_activate, hidden, visible_from, is_active, opens_after_round_id,
      sale_starts_at, sale_ends_at, includes_drink, drink_deadline_type,
      drink_deadline_hours, drink_cutoff_time, entry_deadline
    )
    SELECT
      c.new_id, p_event_id, c.r->>'name',
      CASE WHEN jsonb_typeof(c.r->'price') = 'number' THEN (c.r->>'price')::numeric ELSE 0 END,
      c.max_tickets, 20, p_start_position + (c.n - 1)::int,
      'standard', false, c.display = 'hidden', c.visible_from,
      c.pred_id IS NULL AND c.sale IN ('now', 'at') AND NOT (c.sale = 'at' AND c.sale_starts IS NULL),
      c.pred_id,
      CASE WHEN c.pred_id IS NULL THEN c.sale_starts END,
      c.sale_ends,
      c.drink,
      CASE WHEN c.drink THEN COALESCE(NULLIF(c.r->>'drinkDeadlineType', ''), 'none') ELSE 'none' END,
      CASE WHEN c.drink AND c.r->>'drinkDeadlineType' = 'hours_after_start'
           THEN COALESCE(CASE WHEN jsonb_typeof(c.r->'drinkDeadlineHours') = 'number' THEN (c.r->>'drinkDeadlineHours')::numeric::int END, 2) END,
      CASE WHEN c.drink AND c.r->>'drinkDeadlineType' = 'fixed_time'
           THEN COALESCE(substring(c.r->>'drinkCutoffTime' from '^(?:[01][0-9]|2[0-3]):[0-5][0-9]'), '02:00')::time END,
      CASE WHEN c.entry IS NOT NULL THEN c.entry::time END
    FROM calc c
    ORDER BY c.n;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    IF COALESCE(p.total_capacity, 0) > 0 THEN
      UPDATE public.events SET max_tickets = p.total_capacity
       WHERE id = p_event_id AND max_tickets IS NULL;
    END IF;
    RETURN v_count;
  END IF;

  INSERT INTO public.ticket_rounds (
    event_id, name, price, max_tickets, last_tickets_threshold, position,
    is_active, auto_activate, ticket_type, includes_drink,
    drink_deadline_type, drink_deadline_hours, drink_cutoff_time, entry_deadline
  )
  SELECT
    p_event_id,
    COALESCE(r->>'name', 'Standard'),
    COALESCE((r->>'price')::numeric, 0),
    CASE WHEN v_mode = 'simple' THEN 999999 ELSE COALESCE((r->>'maxTickets')::int, 100) END,
    COALESCE((r->>'lastTicketsThreshold')::int, 20),
    p_start_position + (ord - 1)::int,
    CASE WHEN v_mode = 'simple' THEN true ELSE (ord = 1 AND p_start_position = 0) END,
    (v_mode <> 'timed_entry' AND v_mode <> 'simple'),
    COALESCE(p.ticket_type, 'standard'),
    COALESCE((r->>'includesDrink')::boolean, p.includes_drink, false),
    CASE WHEN COALESCE((r->>'includesDrink')::boolean, p.includes_drink, false)
         THEN COALESCE(p.drink_deadline_type, 'none') ELSE 'none' END,
    CASE WHEN COALESCE((r->>'includesDrink')::boolean, p.includes_drink, false)
              AND p.drink_deadline_type = 'hours_after_start' THEN p.drink_deadline_hours ELSE NULL END,
    -- FIX: cast text -> time (avec NULLIF pour les chaînes vides)
    CASE WHEN COALESCE((r->>'includesDrink')::boolean, p.includes_drink, false)
              AND p.drink_deadline_type = 'fixed_time' THEN NULLIF(p.drink_cutoff_time, '')::time ELSE NULL END,
    -- FIX: cast text -> time
    CASE WHEN (r->>'entryDeadline') IS NOT NULL AND (r->>'entryDeadline') <> ''
         THEN ((r->>'entryDeadline') || ':00')::time ELSE NULL END
  FROM jsonb_array_elements(p.rounds) WITH ORDINALITY AS t(r, ord);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
