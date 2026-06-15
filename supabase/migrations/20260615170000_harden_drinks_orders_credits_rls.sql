-- Harden the drinks ordering surface: RLS holes, payment-bypass vectors, and
-- the non-atomic drink-credit decrement that allowed free drinks under races.
--
-- Scope is deliberately the drinks/orders/credits path. Each statement is
-- written to be safe for the existing legitimate flows (service-role edge
-- functions bypass RLS; barman/owner serve-paths never touch financial fields).

-- ---------------------------------------------------------------------------
-- 1. orders INSERT: a client may only create a PENDING order for themselves.
--    Real orders are inserted by create-checkout / use-drink-credit using the
--    service role (which bypasses RLS), so this never blocks a legitimate path.
--    It does block a logged-in user from forging `status='paid', total=0`
--    straight through PostgREST and getting free drinks served at the bar.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can create orders" ON public.orders;
CREATE POLICY "Users can create orders"
  ON public.orders FOR INSERT
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

-- ---------------------------------------------------------------------------
-- 2. orders UPDATE: add WITH CHECK mirroring USING so a barman/owner can't move
--    an order to a venue that isn't theirs (the policies only had USING).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Barmen can update their venue orders" ON public.orders;
CREATE POLICY "Barmen can update their venue orders"
  ON public.orders FOR UPDATE
  USING (
    has_role(auth.uid(), 'barman'::app_role)
    AND venue_id = get_user_venue_id(auth.uid())
  )
  WITH CHECK (
    has_role(auth.uid(), 'barman'::app_role)
    AND venue_id = get_user_venue_id(auth.uid())
  );

DROP POLICY IF EXISTS "Owners can update their venue orders" ON public.orders;
CREATE POLICY "Owners can update their venue orders"
  ON public.orders FOR UPDATE
  USING (
    has_role(auth.uid(), 'owner'::app_role)
    AND is_venue_owner(auth.uid(), venue_id)
  )
  WITH CHECK (
    has_role(auth.uid(), 'owner'::app_role)
    AND is_venue_owner(auth.uid(), venue_id)
  );

-- ---------------------------------------------------------------------------
-- 3. orders: financial fields are immutable for end-user roles. WITH CHECK
--    can't compare against the OLD row, so use a trigger. service_role (edge
--    functions) and admin/migration roles are exempt; the barman serve-path
--    only writes status/prep_status/served_at/items/token_used(false->true),
--    none of which are touched here, so legitimate flows are unaffected.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_order_immutable_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.total                    IS DISTINCT FROM OLD.total
       OR NEW.paid_at               IS DISTINCT FROM OLD.paid_at
       OR NEW.stripe_payment_intent_id IS DISTINCT FROM OLD.stripe_payment_intent_id
       OR NEW.user_id               IS DISTINCT FROM OLD.user_id
       OR NEW.venue_id              IS DISTINCT FROM OLD.venue_id THEN
      RAISE EXCEPTION 'orders: financial fields are immutable for non-service roles';
    END IF;
    -- A consumed QR token may never be re-opened to allow a second pickup.
    IF OLD.token_used = true AND NEW.token_used = false THEN
      RAISE EXCEPTION 'orders: token_used cannot be reset';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_order_immutable_fields ON public.orders;
CREATE TRIGGER trg_protect_order_immutable_fields
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.protect_order_immutable_fields();

-- ---------------------------------------------------------------------------
-- 4. cart_snapshots: the "service role full access" policy had no TO clause, so
--    USING(true)/WITH CHECK(true) applied to anon + authenticated, letting any
--    user read/write/delete every other user's saved cart. The service role
--    bypasses RLS anyway, so this policy was pure exposure — drop it. The
--    per-user policy "Users can manage own cart snapshots" remains.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role full access cart_snapshots" ON public.cart_snapshots;

-- ---------------------------------------------------------------------------
-- 5. upsell_cart_rules: owner FOR ALL policy had USING but no WITH CHECK, so an
--    owner could INSERT/UPDATE a rule pointing at another venue. Add WITH CHECK.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "venue owner full access on upsell_cart_rules" ON public.upsell_cart_rules;
CREATE POLICY "venue owner full access on upsell_cart_rules"
  ON public.upsell_cart_rules FOR ALL
  USING (
    venue_id IN (SELECT v.id::text FROM public.venues v WHERE v.owner_id = auth.uid())
  )
  WITH CHECK (
    venue_id IN (SELECT v.id::text FROM public.venues v WHERE v.owner_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 6. tickets drink redemption: barman UPDATE policy had USING but no WITH CHECK,
--    so a barman could rewrite a ticket onto another venue's event. Recreate
--    with a matching WITH CHECK (keeps the legitimate drink-redeem update).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Barmen can redeem drinks for their venue" ON public.tickets;
CREATE POLICY "Barmen can redeem drinks for their venue"
  ON public.tickets FOR UPDATE
  USING (
    has_role(auth.uid(), 'barman'::app_role)
    AND EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = tickets.event_id
        AND e.venue_id = get_user_venue_id(auth.uid())
    )
  )
  WITH CHECK (
    has_role(auth.uid(), 'barman'::app_role)
    AND EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = tickets.event_id
        AND e.venue_id = get_user_venue_id(auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 7. order_pack_credits: never let consumed credits exceed what was purchased.
--    Clamp any legacy rows already over the limit (from the old non-atomic
--    decrement bug) before adding the constraint, so it applies cleanly.
-- ---------------------------------------------------------------------------
UPDATE public.order_pack_credits
  SET used_credits = total_credits
  WHERE used_credits > total_credits;

ALTER TABLE public.order_pack_credits
  DROP CONSTRAINT IF EXISTS order_pack_credits_used_within_total;
ALTER TABLE public.order_pack_credits
  ADD CONSTRAINT order_pack_credits_used_within_total
  CHECK (used_credits >= 0 AND used_credits <= total_credits);

-- ---------------------------------------------------------------------------
-- 8. Atomic credit consumption. The edge function read used_credits in memory
--    then wrote back an absolute value — two concurrent redemptions both read
--    the same number and double-spent. These functions lock the pack row
--    (FOR UPDATE) and return the amount actually taken / released.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_pack_credit(p_credit_id UUID, p_want INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_available INTEGER;
  v_consumed  INTEGER;
BEGIN
  IF p_want IS NULL OR p_want <= 0 THEN
    RETURN 0;
  END IF;

  SELECT GREATEST(total_credits - used_credits, 0)
    INTO v_available
    FROM public.order_pack_credits
    WHERE id = p_credit_id
    FOR UPDATE;

  IF v_available IS NULL THEN
    RETURN 0;
  END IF;

  v_consumed := LEAST(p_want, v_available);
  IF v_consumed > 0 THEN
    UPDATE public.order_pack_credits
      SET used_credits = used_credits + v_consumed
      WHERE id = p_credit_id;
  END IF;

  RETURN v_consumed;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_pack_credit(p_credit_id UUID, p_amount INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN;
  END IF;

  UPDATE public.order_pack_credits
    SET used_credits = GREATEST(used_credits - p_amount, 0)
    WHERE id = p_credit_id;
END;
$$;

-- These mutate credit balances: only the service role (edge functions) calls them.
REVOKE ALL ON FUNCTION public.consume_pack_credit(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_pack_credit(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_pack_credit(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_pack_credit(UUID, INTEGER) TO service_role;
