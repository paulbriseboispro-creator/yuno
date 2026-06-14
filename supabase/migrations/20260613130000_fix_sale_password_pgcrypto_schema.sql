-- ============================================================================
-- Fix: pgcrypto lives in the `extensions` schema on this project, not `public`.
-- The sale-password RPCs run with `SET search_path = public`, so bare crypt()/
-- gen_salt() resolve to nothing ("function gen_salt(unknown, integer) does not
-- exist"). Schema-qualify the calls so they resolve regardless of search_path.
-- Only the two functions that call pgcrypto need the fix.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_event_sale_password(
  p_event_id uuid,
  p_password text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pw text := nullif(btrim(coalesce(p_password, '')), '');
BEGIN
  IF NOT public.can_manage_event_tables(auth.uid(), p_event_id) THEN
    RAISE EXCEPTION 'Not authorized to manage this event' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_pw IS NULL THEN
    DELETE FROM public.event_sale_protection WHERE event_id = p_event_id;
    DELETE FROM public.event_sale_access WHERE event_id = p_event_id;
    UPDATE public.events SET sale_password_enabled = false WHERE id = p_event_id;
    RETURN;
  END IF;

  INSERT INTO public.event_sale_protection (event_id, password_hash, updated_at)
  VALUES (p_event_id, extensions.crypt(v_pw, extensions.gen_salt('bf', 10)), now())
  ON CONFLICT (event_id)
  DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now();

  DELETE FROM public.event_sale_access WHERE event_id = p_event_id;

  UPDATE public.events SET sale_password_enabled = true WHERE id = p_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unlock_event_sale(
  p_event_id uuid,
  p_password text,
  p_guest_email text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_uid uuid := auth.uid();
  v_email text := nullif(lower(btrim(coalesce(p_guest_email, ''))), '');
BEGIN
  SELECT password_hash INTO v_hash
  FROM public.event_sale_protection
  WHERE event_id = p_event_id;

  IF v_hash IS NULL THEN
    RETURN true;
  END IF;

  IF extensions.crypt(coalesce(p_password, ''), v_hash) <> v_hash THEN
    RETURN false;
  END IF;

  IF v_uid IS NOT NULL THEN
    INSERT INTO public.event_sale_access (event_id, user_id)
    VALUES (p_event_id, v_uid)
    ON CONFLICT (event_id, user_id) WHERE user_id IS NOT NULL DO NOTHING;
  ELSIF v_email IS NOT NULL THEN
    INSERT INTO public.event_sale_access (event_id, guest_email)
    VALUES (p_event_id, v_email)
    ON CONFLICT (event_id, lower(guest_email)) WHERE guest_email IS NOT NULL DO NOTHING;
  END IF;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_event_sale_password(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.set_event_sale_password(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.unlock_event_sale(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.unlock_event_sale(uuid, text, text) TO anon, authenticated;
