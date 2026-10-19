-- Description d'un billet (2026-10-19, demande de Paul pour House Of Masquerade).
--
-- ticket_rounds.description existait depuis l'origine (la page d'achat la lit)
-- mais aucun écran ne l'écrivait : 0 ligne sur 416 au 19/10. Elle devient un
-- champ FACULTATIF de chaque billet, tous modes de vente, affiché sous le
-- billet sur la page de la soirée et sur la page d'achat.
--
-- 1. Au plus 200 caractères (même plafond que TICKET_DESCRIPTION_MAX,
--    src/lib/freeTicketing.ts) : c'est une précision sur ce que le billet
--    donne, pas un second texte de soirée.
-- 2. Un modèle de billetterie LIBRE la garde (FreePresetTicket.description) :
--    _insert_recurring_rounds, miroir SQL de freePresetToRoundRows, la recopie
--    sur les soirées d'une série (le reste de la fonction est inchangé).

ALTER TABLE public.ticket_rounds
  DROP CONSTRAINT IF EXISTS ticket_rounds_description_length_check;
ALTER TABLE public.ticket_rounds
  ADD CONSTRAINT ticket_rounds_description_length_check
  CHECK (description IS NULL OR char_length(description) <= 200);

COMMENT ON COLUMN public.ticket_rounds.description IS
  'Description facultative du billet (200 caractères au plus), affichée sous le billet côté client.';

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
      drink_deadline_hours, drink_cutoff_time, entry_deadline, description
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
      CASE WHEN c.entry IS NOT NULL THEN c.entry::time END,
      -- Description du billet : miroir de normalizeTicketDescription (200 au plus).
      CASE WHEN jsonb_typeof(c.r->'description') = 'string'
           THEN left(NULLIF(btrim(c.r->>'description', E' \t\r\n'), ''), 200) END
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

REVOKE ALL ON FUNCTION public._insert_recurring_rounds(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._insert_recurring_rounds(uuid, uuid, integer) TO service_role;
