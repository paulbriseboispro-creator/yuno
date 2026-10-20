-- Un e-mail de billet qui n'arrive pas se VOIT (2026-10-20).
--
-- Le 20/10, une invitée a payé son billet pour House Of Masquerade avec une
-- faute dans son adresse (domaine juste, « gmail.com », mais une lettre fausse
-- avant le @). Resend a rendu un rebond dur 27 secondes après l'envoi : la
-- liste de suppression l'a noté, personne d'autre. Elle n'a jamais reçu son
-- billet, et l'organisateur ne l'a pas su.
--
-- Désormais chaque e-mail de vente porte ses tags (`sale_kind`, `sale_id`),
-- son état est tenu ici (envoyé → livré | rebondi), et :
--   * la page de confirmation, encore ouverte quand le rebond arrive, le dit
--     et fait corriger l'adresse (send-ticket-confirmation, action fix_email) ;
--   * l'organisateur (et le super admin) est prévenu, avec le nom et le
--     téléphone de l'acheteur : son billet reste valable, la porte le trouve
--     par son nom.
--
-- Table sans policy : écrite par les seules fonctions ci-dessous.

CREATE TABLE IF NOT EXISTS public.sale_email_deliveries (
  kind            text        NOT NULL CHECK (kind IN ('ticket', 'table', 'guest_list')),
  sale_id         uuid        NOT NULL,
  email           text        NOT NULL,
  status          text        NOT NULL CHECK (status IN ('sent', 'delivered', 'bounced')),
  resend_email_id text,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  bounced_at      timestamptz,
  bounce_detail   text,
  fixes           integer     NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, sale_id)
);

ALTER TABLE public.sale_email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_email_deliveries FROM anon, authenticated;

-- ── Envoi : l'e-mail vient de partir (premier envoi ou renvoi après correction).
CREATE OR REPLACE FUNCTION public.record_sale_email_sent(
  p_kind text, p_sale_id uuid, p_email text, p_resend_email_id text
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  INSERT INTO public.sale_email_deliveries AS d (kind, sale_id, email, status, resend_email_id, sent_at, updated_at)
  VALUES (p_kind, p_sale_id, lower(trim(p_email)), 'sent', p_resend_email_id, now(), now())
  ON CONFLICT (kind, sale_id) DO UPDATE
     SET email = EXCLUDED.email,
         status = 'sent',
         resend_email_id = EXCLUDED.resend_email_id,
         sent_at = now(),
         delivered_at = NULL,
         bounced_at = NULL,
         bounce_detail = NULL,
         updated_at = now();
$$;

-- ── Webhook Resend : livré ou rebondi. Un événement qui porte une AUTRE adresse
-- que la dernière envoyée (retard d'un ancien envoi, après correction) ne
-- touche rien. Un rebond dur prévient les parties qui mènent la soirée.
CREATE OR REPLACE FUNCTION public.record_sale_email_event(
  p_kind text, p_sale_id uuid, p_email text, p_event text, p_resend_email_id text, p_detail text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_email text := lower(trim(coalesce(p_email, '')));
  v_row   public.sale_email_deliveries%ROWTYPE;
  v_was_bounced boolean := false;
  v_ticket record;
  v_party record;
  v_lang text;
  v_name text;
  v_phone text;
  v_title text;
  v_msg text;
BEGIN
  IF p_event NOT IN ('delivered', 'bounced') OR v_email = '' THEN
    RETURN;
  END IF;

  SELECT * INTO v_row FROM public.sale_email_deliveries
   WHERE kind = p_kind AND sale_id = p_sale_id
   FOR UPDATE;

  IF FOUND THEN
    IF v_row.email <> v_email THEN
      RETURN;
    END IF;
    v_was_bounced := v_row.status = 'bounced';
    IF p_event = 'delivered' THEN
      UPDATE public.sale_email_deliveries
         SET status = CASE WHEN status = 'bounced' THEN status ELSE 'delivered' END,
             delivered_at = coalesce(delivered_at, now()),
             updated_at = now()
       WHERE kind = p_kind AND sale_id = p_sale_id;
    ELSE
      UPDATE public.sale_email_deliveries
         SET status = 'bounced',
             bounced_at = coalesce(bounced_at, now()),
             bounce_detail = left(p_detail, 500),
             updated_at = now()
       WHERE kind = p_kind AND sale_id = p_sale_id;
    END IF;
  ELSE
    -- E-mail parti avant le suivi : on prend l'état tel qu'il arrive.
    INSERT INTO public.sale_email_deliveries (kind, sale_id, email, status, resend_email_id, delivered_at, bounced_at, bounce_detail)
    VALUES (p_kind, p_sale_id, v_email, p_event, p_resend_email_id,
            CASE WHEN p_event = 'delivered' THEN now() END,
            CASE WHEN p_event = 'bounced' THEN now() END,
            CASE WHEN p_event = 'bounced' THEN left(p_detail, 500) END)
    ON CONFLICT (kind, sale_id) DO NOTHING;
  END IF;

  -- Prévenir une fois par adresse rebondie, et seulement pour un billet
  -- (tables et guest list suivront le même chemin).
  IF p_event <> 'bounced' OR v_was_bounced OR p_kind <> 'ticket' THEN
    RETURN;
  END IF;

  BEGIN
    SELECT t.id, t.full_name, t.guest_first_name, t.guest_last_name, t.phone, t.guest_phone,
           t.event_id, e.title AS event_title
      INTO v_ticket
      FROM public.tickets t
      JOIN public.events e ON e.id = t.event_id
     WHERE t.id = p_sale_id;
    IF NOT FOUND OR v_ticket.event_id = ANY (public.demo_event_ids()) THEN
      RETURN;
    END IF;

    v_name := coalesce(nullif(trim(v_ticket.full_name), ''),
                       nullif(trim(concat_ws(' ', v_ticket.guest_first_name, v_ticket.guest_last_name)), ''),
                       '—');
    v_phone := coalesce(nullif(trim(v_ticket.phone), ''), nullif(trim(v_ticket.guest_phone), ''));

    FOR v_party IN
      SELECT p.kind, p.venue_id, p.organizer_user_id
        FROM public.event_parties(v_ticket.event_id) p
       WHERE p.role IN ('lead', 'partner')
    LOOP
      SELECT coalesce(pr.preferred_language, 'fr') INTO v_lang
        FROM public.profiles pr
       WHERE pr.id = CASE WHEN v_party.kind = 'venue'
                          THEN (SELECT v.owner_id FROM public.venues v WHERE v.id = v_party.venue_id)
                          ELSE v_party.organizer_user_id END;
      v_lang := CASE WHEN v_lang IN ('en', 'es') THEN v_lang ELSE 'fr' END;

      v_title := CASE v_lang
        WHEN 'en' THEN 'Ticket email not delivered'
        WHEN 'es' THEN 'Email de entrada no entregado'
        ELSE 'E-mail de billet non livré' END;
      v_msg := CASE v_lang
        WHEN 'en' THEN v_name || ' (' || v_ticket.event_title || ') entered an address that does not exist: ' || v_email
                       || '. The ticket is still valid and the door finds it by name.'
                       || coalesce(' Call them on ' || v_phone || ' to get the right address.', '')
        WHEN 'es' THEN v_name || ' (' || v_ticket.event_title || ') escribió una dirección que no existe: ' || v_email
                       || '. Su entrada sigue siendo válida y la puerta la encuentra por su nombre.'
                       || coalesce(' Llámale al ' || v_phone || ' para tener la dirección correcta.', '')
        ELSE v_name || ' (' || v_ticket.event_title || ') a saisi une adresse qui n''existe pas : ' || v_email
                       || '. Son billet reste valable, la porte le trouve par son nom.'
                       || coalesce(' Appelle-le au ' || v_phone || ' pour avoir la bonne adresse.', '') END;

      IF v_party.kind = 'venue' THEN
        PERFORM public.emit_staff_notification(
          v_party.venue_id, 'owner', 'ticket_email_bounced', v_title, v_msg, 'high',
          'ticket', v_ticket.id, v_ticket.event_id,
          jsonb_build_object('email', v_email, 'buyer', v_name, 'phone', v_phone),
          'ticket_email_bounced:' || v_ticket.id || ':' || v_email);
      ELSE
        PERFORM public.emit_organizer_notification(
          v_party.organizer_user_id, 'ticket_email_bounced', v_title, v_msg, 'high',
          'ticket', v_ticket.id, v_ticket.event_id,
          jsonb_build_object('email', v_email, 'buyer', v_name, 'phone', v_phone),
          'ticket_email_bounced:' || v_ticket.id || ':' || v_email);
      END IF;
    END LOOP;

    PERFORM public.emit_admin_notification(
      'admin_ticket_email_bounced',
      'E-mail de billet non livré',
      v_name || ' · ' || v_ticket.event_title || ' · ' || v_email,
      'high', 'ticket', v_ticket.id::text,
      jsonb_build_object('email', v_email, 'phone', v_phone),
      'admin_ticket_email_bounced:' || v_ticket.id || ':' || v_email,
      v_ticket.event_id);
  EXCEPTION WHEN OTHERS THEN
    -- Une alerte ne fait jamais échouer l'accusé du webhook.
    RAISE WARNING 'record_sale_email_event notify failed: %', SQLERRM;
  END;
END;
$$;

-- ── Page de confirmation : l'état de l'e-mail d'un billet, à qui tient son QR.
-- `can_fix` dit si l'adresse peut encore être corrigée : rebond, ou moins de
-- deux heures après le paiement (une faute qui tombe sur la boîte de quelqu'un
-- d'autre ne rebondit pas), trois corrections au plus.
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
           'can_fix', t.status = 'paid'
                      AND coalesce(d.fixes, 0) < 3
                      AND (d.status = 'bounced' OR coalesce(t.paid_at, t.created_at) > now() - interval '2 hours'))
    FROM public.tickets t
    LEFT JOIN public.sale_email_deliveries d ON d.kind = 'ticket' AND d.sale_id = t.id
   WHERE t.id = p_ticket_id
     AND p_qr IS NOT NULL
     AND t.qr_code = p_qr
     AND t.user_email IS NOT NULL;
$$;

-- ── Correction de l'adresse (appelée par send-ticket-confirmation, qui renvoie
-- ensuite le billet). Mêmes règles que `can_fix`.
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

  SELECT t.id, t.status, t.user_email, t.paid_at, t.created_at, t.full_name, t.user_id, t.is_guest
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

  IF coalesce(v_d.fixes, 0) >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_many');
  END IF;
  IF NOT (coalesce(v_d.status, '') = 'bounced'
          OR coalesce(v_t.paid_at, v_t.created_at) > now() - interval '2 hours') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_late');
  END IF;
  IF v_email = lower(coalesce(v_t.user_email, '')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'same_email');
  END IF;

  UPDATE public.tickets SET user_email = v_email WHERE id = p_ticket_id;

  INSERT INTO public.sale_email_deliveries (kind, sale_id, email, status, fixes)
  VALUES ('ticket', p_ticket_id, v_email, 'sent', 1)
  ON CONFLICT (kind, sale_id) DO UPDATE
     SET email = EXCLUDED.email, status = 'sent', fixes = public.sale_email_deliveries.fixes + 1,
         delivered_at = NULL, bounced_at = NULL, bounce_detail = NULL, updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'email', v_email,
    'first_name', split_part(coalesce(v_t.full_name, ''), ' ', 1),
    'is_guest', coalesce(v_t.is_guest, v_t.user_id IS NULL));
END;
$$;

REVOKE ALL ON FUNCTION public.record_sale_email_sent(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_sale_email_event(text, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fix_ticket_email(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_ticket_email_delivery(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_sale_email_sent(text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_sale_email_event(text, uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fix_ticket_email(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_ticket_email_delivery(uuid, text) TO anon, authenticated, service_role;

-- Le billet du 20/10 : son rebond est déjà dans la liste de suppression ;
-- on le reporte ici pour que sa page et la Console le disent.
INSERT INTO public.sale_email_deliveries (kind, sale_id, email, status, bounced_at, bounce_detail)
SELECT 'ticket', t.id, lower(t.user_email), 'bounced', s.created_at, 'hard_bounce (rattrapage)'
  FROM public.email_suppressions s
  JOIN public.tickets t ON lower(t.user_email) = lower(s.email)
 WHERE s.reason = 'hard_bounce'
   AND s.campaign_id IS NULL
   AND s.created_at > now() - interval '7 days'
   AND t.status = 'paid'
   AND t.created_at BETWEEN s.created_at - interval '1 hour' AND s.created_at
ON CONFLICT (kind, sale_id) DO NOTHING;
