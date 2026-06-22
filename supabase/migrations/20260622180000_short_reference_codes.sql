-- Short, human-friendly reference codes for tickets and VIP table reservations.
--
-- Problem: tickets/tables only had `qr_code` (TK-/VP- + a full UUID, ~39 chars)
-- as their reference. The confirmation email showed that giant string and the
-- guest "Find my order" flow forced people to paste it exactly, case-sensitive.
-- Drinks already had a clean short `order_number` (DR-XXXXXX). This brings the
-- same short reference to tickets (TK-XXXXXX) and tables (VP-XXXXXX).
--
-- The long `qr_code` stays untouched and remains the value encoded in the
-- scannable QR (door scanning matches on qr_code). `reference_code` is purely
-- the human-typed lookup key.

-- 1. Columns ----------------------------------------------------------------
ALTER TABLE public.tickets             ADD COLUMN IF NOT EXISTS reference_code text;
ALTER TABLE public.table_reservations  ADD COLUMN IF NOT EXISTS reference_code text;

-- 2. Generators (mirror generate_order_number: 6 uppercase hex chars) --------
CREATE OR REPLACE FUNCTION public.generate_ticket_reference()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_number text; v_exists boolean;
BEGIN
  LOOP
    v_number := 'TK-' || upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 6));
    SELECT EXISTS(SELECT 1 FROM public.tickets WHERE reference_code = v_number) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;
  RETURN v_number;
END; $function$;

CREATE OR REPLACE FUNCTION public.generate_table_reference()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_number text; v_exists boolean;
BEGIN
  LOOP
    v_number := 'VP-' || upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 6));
    SELECT EXISTS(SELECT 1 FROM public.table_reservations WHERE reference_code = v_number) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;
  RETURN v_number;
END; $function$;

-- 3. Auto-assign on insert when not provided --------------------------------
CREATE OR REPLACE FUNCTION public.set_ticket_reference()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.reference_code IS NULL THEN
    NEW.reference_code := public.generate_ticket_reference();
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.set_table_reference()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.reference_code IS NULL THEN
    NEW.reference_code := public.generate_table_reference();
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_set_ticket_reference ON public.tickets;
CREATE TRIGGER trg_set_ticket_reference BEFORE INSERT ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.set_ticket_reference();

DROP TRIGGER IF EXISTS trg_set_table_reference ON public.table_reservations;
CREATE TRIGGER trg_set_table_reference BEFORE INSERT ON public.table_reservations
FOR EACH ROW EXECUTE FUNCTION public.set_table_reference();

-- 4. Backfill existing rows -------------------------------------------------
-- Row-by-row so each generated code is visible to the next iteration's
-- uniqueness check inside this transaction (a single set-based UPDATE could
-- otherwise hand out duplicate codes before the unique index is created).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.tickets WHERE reference_code IS NULL LOOP
    UPDATE public.tickets SET reference_code = public.generate_ticket_reference() WHERE id = r.id;
  END LOOP;
  FOR r IN SELECT id FROM public.table_reservations WHERE reference_code IS NULL LOOP
    UPDATE public.table_reservations SET reference_code = public.generate_table_reference() WHERE id = r.id;
  END LOOP;
END $$;

-- 5. Enforce uniqueness (NULLs allowed for any future insert before trigger) -
CREATE UNIQUE INDEX IF NOT EXISTS tickets_reference_code_key
  ON public.tickets (reference_code);
CREATE UNIQUE INDEX IF NOT EXISTS table_reservations_reference_code_key
  ON public.table_reservations (reference_code);
