-- ============================================================================
-- Fix : _insert_recurring_rounds insérait des valeurs TEXT dans des colonnes TIME
-- de ticket_rounds (drink_cutoff_time, entry_deadline) sans cast → erreur 42804
-- "column ... is of type time without time zone but expression is of type text".
-- Comme l'insert des rounds et l'insert de l'event sont dans le même bloc
-- EXCEPTION de generate_recurring_events, l'event entier était rollback →
-- 0 occurrence générée pour TOUTE soirée récurrente avec billetterie.
--
-- ticket_presets.drink_cutoff_time = text  ->  ticket_rounds.drink_cutoff_time = time
-- (r->>'entryDeadline')||':00'      = text  ->  ticket_rounds.entry_deadline    = time
-- ============================================================================

CREATE OR REPLACE FUNCTION public._insert_recurring_rounds(
  p_event_id uuid,
  p_preset_id uuid,
  p_start_position int
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.ticket_presets%ROWTYPE;
  v_mode text;
  v_count int;
BEGIN
  SELECT * INTO p FROM public.ticket_presets WHERE id = p_preset_id;
  IF p.id IS NULL OR p.rounds IS NULL OR jsonb_typeof(p.rounds) <> 'array' THEN
    RETURN 0;
  END IF;
  v_mode := COALESCE(p.selling_mode, 'rounds');

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
$$;
