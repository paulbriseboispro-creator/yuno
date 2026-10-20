-- Corriger l'adresse d'un billet = seulement après un rebond (décision de Paul
-- du 20/10). La confirmation ne montre plus « Ton billet part à … · Pas la
-- bonne adresse ? » à tout le monde : un acheteur dont l'e-mail est parti
-- normalement ne voit rien. La porte serveur suit l'écran : la fenêtre des
-- deux heures après le paiement disparaît, seul un rebond ouvre la correction.

CREATE OR REPLACE FUNCTION public.get_ticket_email_delivery(p_ticket_id uuid, p_qr text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
           'status', coalesce(d.status, 'sent'),
           'email', lower(t.user_email),
           'can_fix', coalesce(t.status = 'paid'
                               AND d.status = 'bounced'
                               AND d.fixes < 3, false))
    FROM public.tickets t
    LEFT JOIN public.sale_email_deliveries d ON d.kind = 'ticket' AND d.sale_id = t.id
   WHERE t.id = p_ticket_id
     AND p_qr IS NOT NULL
     AND t.qr_code = p_qr
     AND t.user_email IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.fix_ticket_email(p_ticket_id uuid, p_qr text, p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_email text := lower(trim(coalesce(p_email, '')));
  v_t record;
  v_d public.sale_email_deliveries%ROWTYPE;
BEGIN
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s.]{2,}$' OR length(v_email) > 254 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_email');
  END IF;

  SELECT t.id, t.status, t.user_email, t.full_name, t.user_id, t.is_guest
    INTO v_t
    FROM public.tickets t
   WHERE t.id = p_ticket_id AND p_qr IS NOT NULL AND t.qr_code = p_qr
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_t.status <> 'paid' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_paid');
  END IF;

  SELECT * INTO v_d FROM public.sale_email_deliveries
   WHERE kind = 'ticket' AND sale_id = p_ticket_id
   FOR UPDATE;

  IF NOT FOUND OR v_d.status <> 'bounced' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_late');
  END IF;
  IF v_d.fixes >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_many');
  END IF;
  IF v_email = lower(coalesce(v_t.user_email, '')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'same_email');
  END IF;

  UPDATE public.tickets SET user_email = v_email WHERE id = p_ticket_id;

  UPDATE public.sale_email_deliveries
     SET email = v_email, status = 'sent', fixes = fixes + 1,
         delivered_at = NULL, bounced_at = NULL, bounce_detail = NULL, updated_at = now()
   WHERE kind = 'ticket' AND sale_id = p_ticket_id;

  RETURN jsonb_build_object(
    'ok', true,
    'email', v_email,
    'first_name', split_part(coalesce(v_t.full_name, ''), ' ', 1),
    'is_guest', coalesce(v_t.is_guest, v_t.user_id IS NULL));
END;
$$;

REVOKE ALL ON FUNCTION public.fix_ticket_email(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_ticket_email_delivery(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fix_ticket_email(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_ticket_email_delivery(uuid, text) TO anon, authenticated, service_role;
