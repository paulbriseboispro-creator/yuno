
REVOKE SELECT (
  stripe_account_id, stripe_onboarding_complete, stripe_charges_enabled,
  stripe_payouts_enabled, siret, vat_number, legal_address, legal_name, invoice_prefix
) ON public.venues FROM anon;

REVOKE SELECT (stripe_customer_id, stripe_subscription_id) ON public.venue_subscriptions FROM anon;

REVOKE SELECT (billing_email, vat_number, siret, legal_address, legal_name)
  ON public.organizer_profiles FROM anon;

DROP POLICY IF EXISTS "Anyone can view active guest lists" ON public.guest_lists;
CREATE POLICY "Public can view publicly listed guest lists"
  ON public.guest_lists FOR SELECT
  TO anon, authenticated
  USING (is_active = true AND visible_on_club_page = true);

CREATE OR REPLACE FUNCTION public.get_guest_list_by_token(_token text)
RETURNS SETOF public.guest_lists
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.guest_lists
  WHERE share_token = _token AND is_active = true
  LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.get_guest_list_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guest_list_by_token(text) TO anon, authenticated;

DROP POLICY IF EXISTS "Public can read claim invitation by token" ON public.venue_claim_invitations;

CREATE POLICY "Venue owner can view invitation that created their venue"
  ON public.venue_claim_invitations FOR SELECT
  TO authenticated
  USING (
    created_venue_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.venues v
      WHERE v.id = created_venue_id AND v.owner_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.is_event_partner_venue_owner(_user_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    JOIN public.venues v ON v.id = e.partner_venue_id
    WHERE e.id = _event_id
      AND e.partner_venue_id IS NOT NULL
      AND v.owner_id = _user_id
  )
$function$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'realtime' AND c.relname = 'messages'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS "Deny broadcast/presence by default" ON realtime.messages';
    EXECUTE 'CREATE POLICY "Deny broadcast/presence by default" ON realtime.messages FOR SELECT TO authenticated USING (false)';
  END IF;
END $$;
