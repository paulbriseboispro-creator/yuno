
-- ====== 1. GUEST LISTS — autoriser scope organizer ======
ALTER TABLE public.guest_lists
  ALTER COLUMN venue_id DROP NOT NULL;

ALTER TABLE public.guest_lists
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid;

ALTER TABLE public.guest_lists
  DROP CONSTRAINT IF EXISTS guest_lists_scope_check;
ALTER TABLE public.guest_lists
  ADD CONSTRAINT guest_lists_scope_check
  CHECK (venue_id IS NOT NULL OR organizer_user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_guest_lists_organizer ON public.guest_lists(organizer_user_id);

-- RLS: organizer can manage own guest lists
DROP POLICY IF EXISTS "Organizers manage own guest lists" ON public.guest_lists;
CREATE POLICY "Organizers manage own guest lists"
ON public.guest_lists
FOR ALL
USING (organizer_user_id = auth.uid())
WITH CHECK (organizer_user_id = auth.uid());

-- ====== 2. INVOICES & INVOICE_NUMBERS — autoriser scope organizer ======
ALTER TABLE public.invoices
  ALTER COLUMN venue_id DROP NOT NULL;
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid;

ALTER TABLE public.invoice_numbers
  ALTER COLUMN venue_id DROP NOT NULL;
ALTER TABLE public.invoice_numbers
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid;

CREATE INDEX IF NOT EXISTS idx_invoices_organizer ON public.invoices(organizer_user_id);
CREATE INDEX IF NOT EXISTS idx_invoice_numbers_organizer ON public.invoice_numbers(organizer_user_id);

-- Add invoice_prefix on profiles (organizer)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS invoice_prefix text;

-- RLS: organizer can read own invoices
DROP POLICY IF EXISTS "Organizers view own invoices" ON public.invoices;
CREATE POLICY "Organizers view own invoices"
ON public.invoices
FOR SELECT
USING (organizer_user_id = auth.uid());

DROP POLICY IF EXISTS "Organizers view own invoice numbers" ON public.invoice_numbers;
CREATE POLICY "Organizers view own invoice numbers"
ON public.invoice_numbers
FOR SELECT
USING (organizer_user_id = auth.uid());

-- ====== 3. ORG_MEMBERS — granular perms + scanner PIN ======
ALTER TABLE public.org_members
  ADD COLUMN IF NOT EXISTS can_view_finance boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_refund boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_export boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_manage_team boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scanner_pin_hash text,
  ADD COLUMN IF NOT EXISTS scanner_pin_set_at timestamptz;

-- Helper: check granular perm
CREATE OR REPLACE FUNCTION public.org_member_has_permission(
  _user_id uuid,
  _organizer_user_id uuid,
  _permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE organizer_user_id = _organizer_user_id
      AND member_user_id = _user_id
      AND invitation_status = 'accepted'
      AND (
        role = 'admin'
        OR (_permission = 'view_finance' AND can_view_finance = true)
        OR (_permission = 'refund' AND can_refund = true)
        OR (_permission = 'export' AND can_export = true)
        OR (_permission = 'manage_team' AND can_manage_team = true)
      )
  )
$$;

-- ====== 4. generate_invoice_number — support organizer ======
CREATE OR REPLACE FUNCTION public.generate_invoice_number(
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_prefix TEXT;
  v_year TEXT;
  v_count INT;
  v_invoice_number TEXT;
  v_attempts INT := 0;
BEGIN
  IF p_venue_id IS NOT NULL THEN
    SELECT COALESCE(invoice_prefix, 'FAC') INTO v_prefix
    FROM venues WHERE id = p_venue_id;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    SELECT COALESCE(invoice_prefix, 'ORG') INTO v_prefix
    FROM profiles WHERE id = p_organizer_user_id;
  END IF;

  v_prefix := COALESCE(v_prefix, 'FAC');
  v_year := TO_CHAR(NOW(), 'YYYY');

  LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > 10 THEN
      RAISE EXCEPTION 'Could not generate unique invoice number after 10 attempts';
    END IF;

    SELECT COUNT(*) + v_attempts INTO v_count
    FROM invoice_numbers
    WHERE (
      (p_venue_id IS NOT NULL AND venue_id = p_venue_id)
      OR (p_organizer_user_id IS NOT NULL AND organizer_user_id = p_organizer_user_id)
    )
    AND created_at >= DATE_TRUNC('year', NOW());

    v_invoice_number := v_prefix || '-' || v_year || '-' || LPAD(v_count::TEXT, 5, '0');

    IF NOT EXISTS (SELECT 1 FROM invoice_numbers WHERE invoice_number = v_invoice_number) THEN
      RETURN v_invoice_number;
    END IF;
  END LOOP;
END;
$function$;
