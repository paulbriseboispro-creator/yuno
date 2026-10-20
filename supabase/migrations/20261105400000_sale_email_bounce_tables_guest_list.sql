-- Un e-mail de table VIP ou de guest list qui n'arrive pas se VOIT aussi
-- (2026-10-20, suite de 20261105100000).
--
-- Les e-mails de réservation de table (send-vip-confirmation : demande reçue,
-- confirmée, modifiée, refusée) et de guest list (create-guest-list-entry,
-- guest-list-manage, promoter-add-guest) portent désormais leurs tags
-- `sale_kind` = 'table' | 'guest_list' et `sale_id`, et s'enregistrent dans
-- `sale_email_deliveries` comme un billet. Cette migration fait parler le
-- rebond dur pour ces deux piliers : les parties qui mènent la soirée sont
-- prévenues avec le nom et le téléphone de la personne, et le super admin aussi.
--
-- Le billet garde exactement ses textes, son type et ses clés de déduplication.
-- La place reste valable dans tous les cas (la porte la trouve par son nom) ;
-- la phrase ne le dit que pour une réservation payée / confirmée ou une
-- inscription acceptée, jamais pour une vente remboursée ou annulée.
--
-- Corriger l'adresse depuis la page de confirmation ou la Console n'existe que
-- pour le billet (fix_ticket_email) : pour une table ou une guest list, le pro
-- appelle la personne avec le numéro de la notification.

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
  v_sale record;
  v_party record;
  v_lang text;
  v_name text;
  v_phone text;
  v_title text;
  v_msg text;
  v_type text;
  v_admin_type text;
  v_admin_title text;
  v_ref_type text;
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

  -- Prévenir une fois par adresse rebondie.
  IF p_event <> 'bounced' OR v_was_bounced OR p_kind NOT IN ('ticket', 'table', 'guest_list') THEN
    RETURN;
  END IF;

  BEGIN
    -- La vente : nom, téléphone, soirée, et « la place tient-elle encore ? ».
    IF p_kind = 'ticket' THEN
      SELECT t.id, t.event_id, e.title AS event_title,
             coalesce(nullif(trim(t.full_name), ''),
                      nullif(trim(concat_ws(' ', t.guest_first_name, t.guest_last_name)), '')) AS person,
             coalesce(nullif(trim(t.phone), ''), nullif(trim(t.guest_phone), '')) AS phone,
             true AS still_valid
        INTO v_sale
        FROM public.tickets t
        JOIN public.events e ON e.id = t.event_id
       WHERE t.id = p_sale_id;
    ELSIF p_kind = 'table' THEN
      SELECT r.id, r.event_id, e.title AS event_title,
             coalesce(nullif(trim(r.full_name), ''),
                      nullif(trim(concat_ws(' ', r.guest_first_name, r.guest_last_name)), '')) AS person,
             coalesce(nullif(trim(r.phone), ''), nullif(trim(r.guest_phone), '')) AS phone,
             r.status IN ('paid', 'confirmed') AS still_valid
        INTO v_sale
        FROM public.table_reservations r
        JOIN public.events e ON e.id = r.event_id
       WHERE r.id = p_sale_id;
    ELSE
      SELECT g.id, gl.event_id, e.title AS event_title,
             nullif(trim(g.full_name), '') AS person,
             nullif(trim(g.phone), '') AS phone,
             g.status IN ('reserved', 'confirmed', 'entered') AS still_valid
        INTO v_sale
        FROM public.guest_list_entries g
        JOIN public.guest_lists gl ON gl.id = g.guest_list_id
        JOIN public.events e ON e.id = gl.event_id
       WHERE g.id = p_sale_id;
    END IF;
    IF NOT FOUND OR v_sale.event_id = ANY (public.demo_event_ids()) THEN
      RETURN;
    END IF;

    v_name := coalesce(v_sale.person, '—');
    v_phone := v_sale.phone;
    v_type := p_kind || '_email_bounced';
    v_admin_type := 'admin_' || p_kind || '_email_bounced';
    v_ref_type := CASE p_kind WHEN 'ticket' THEN 'ticket'
                              WHEN 'table' THEN 'table_reservation'
                              ELSE 'guest_list_entry' END;
    v_admin_title := CASE p_kind WHEN 'ticket' THEN 'E-mail de billet non livré'
                                 WHEN 'table' THEN 'E-mail de table VIP non livré'
                                 ELSE 'E-mail de guest list non livré' END;

    FOR v_party IN
      SELECT p.kind, p.venue_id, p.organizer_user_id
        FROM public.event_parties(v_sale.event_id) p
       WHERE p.role IN ('lead', 'partner')
    LOOP
      SELECT coalesce(pr.preferred_language, 'fr') INTO v_lang
        FROM public.profiles pr
       WHERE pr.id = CASE WHEN v_party.kind = 'venue'
                          THEN (SELECT v.owner_id FROM public.venues v WHERE v.id = v_party.venue_id)
                          ELSE v_party.organizer_user_id END;
      v_lang := CASE WHEN v_lang IN ('en', 'es') THEN v_lang ELSE 'fr' END;

      IF p_kind = 'ticket' THEN
        v_title := CASE v_lang
          WHEN 'en' THEN 'Ticket email not delivered'
          WHEN 'es' THEN 'Email de entrada no entregado'
          ELSE 'E-mail de billet non livré' END;
        v_msg := CASE v_lang
          WHEN 'en' THEN v_name || ' (' || v_sale.event_title || ') entered an address that does not exist: ' || v_email
                         || '. The ticket is still valid and the door finds it by name.'
                         || coalesce(' Call them on ' || v_phone || ' to get the right address.', '')
          WHEN 'es' THEN v_name || ' (' || v_sale.event_title || ') escribió una dirección que no existe: ' || v_email
                         || '. Su entrada sigue siendo válida y la puerta la encuentra por su nombre.'
                         || coalesce(' Llámale al ' || v_phone || ' para tener la dirección correcta.', '')
          ELSE v_name || ' (' || v_sale.event_title || ') a saisi une adresse qui n''existe pas : ' || v_email
                         || '. Son billet reste valable, la porte le trouve par son nom.'
                         || coalesce(' Appelle-le au ' || v_phone || ' pour avoir la bonne adresse.', '') END;
      ELSIF p_kind = 'table' THEN
        v_title := CASE v_lang
          WHEN 'en' THEN 'Table booking email not delivered'
          WHEN 'es' THEN 'Email de reserva de mesa no entregado'
          ELSE 'E-mail de table VIP non livré' END;
        v_msg := CASE v_lang
          WHEN 'en' THEN v_name || ' (' || v_sale.event_title || ') did not receive their table booking email: '
                         || v_email || ' does not exist.'
                         || CASE WHEN v_sale.still_valid THEN ' The booking is still valid and the door finds it by name.' ELSE '' END
                         || coalesce(' Call them on ' || v_phone || ' to get the right address.', '')
          WHEN 'es' THEN v_name || ' (' || v_sale.event_title || ') no recibió el email de su reserva de mesa: la dirección '
                         || v_email || ' no existe.'
                         || CASE WHEN v_sale.still_valid THEN ' Su reserva sigue siendo válida y la puerta la encuentra por su nombre.' ELSE '' END
                         || coalesce(' Llámale al ' || v_phone || ' para tener la dirección correcta.', '')
          ELSE v_name || ' (' || v_sale.event_title || ') n''a pas reçu l''e-mail de sa réservation de table : l''adresse '
                         || v_email || ' n''existe pas.'
                         || CASE WHEN v_sale.still_valid THEN ' Sa réservation reste valable, la porte la trouve par son nom.' ELSE '' END
                         || coalesce(' Appelle-le au ' || v_phone || ' pour avoir la bonne adresse.', '') END;
      ELSE
        v_title := CASE v_lang
          WHEN 'en' THEN 'Guest list email not delivered'
          WHEN 'es' THEN 'Email de lista de invitados no entregado'
          ELSE 'E-mail de guest list non livré' END;
        v_msg := CASE v_lang
          WHEN 'en' THEN v_name || ' (' || v_sale.event_title || ') did not receive their guest list email: '
                         || v_email || ' does not exist.'
                         || CASE WHEN v_sale.still_valid THEN ' Their spot is still valid and the door finds it by name.' ELSE '' END
                         || coalesce(' Call them on ' || v_phone || ' to get the right address.', '')
          WHEN 'es' THEN v_name || ' (' || v_sale.event_title || ') no recibió el email de su lista de invitados: la dirección '
                         || v_email || ' no existe.'
                         || CASE WHEN v_sale.still_valid THEN ' Su plaza sigue siendo válida y la puerta la encuentra por su nombre.' ELSE '' END
                         || coalesce(' Llámale al ' || v_phone || ' para tener la dirección correcta.', '')
          ELSE v_name || ' (' || v_sale.event_title || ') n''a pas reçu l''e-mail de sa guest list : l''adresse '
                         || v_email || ' n''existe pas.'
                         || CASE WHEN v_sale.still_valid THEN ' Sa place reste valable, la porte la trouve par son nom.' ELSE '' END
                         || coalesce(' Appelle-le au ' || v_phone || ' pour avoir la bonne adresse.', '') END;
      END IF;

      IF v_party.kind = 'venue' THEN
        PERFORM public.emit_staff_notification(
          v_party.venue_id, 'owner', v_type, v_title, v_msg, 'high',
          v_ref_type, v_sale.id, v_sale.event_id,
          jsonb_build_object('email', v_email, 'buyer', v_name, 'phone', v_phone),
          v_type || ':' || v_sale.id || ':' || v_email);
      ELSE
        PERFORM public.emit_organizer_notification(
          v_party.organizer_user_id, v_type, v_title, v_msg, 'high',
          v_ref_type, v_sale.id, v_sale.event_id,
          jsonb_build_object('email', v_email, 'buyer', v_name, 'phone', v_phone),
          v_type || ':' || v_sale.id || ':' || v_email);
      END IF;
    END LOOP;

    PERFORM public.emit_admin_notification(
      v_admin_type,
      v_admin_title,
      v_name || ' · ' || v_sale.event_title || ' · ' || v_email,
      'high', v_ref_type, v_sale.id::text,
      jsonb_build_object('email', v_email, 'phone', v_phone),
      v_admin_type || ':' || v_sale.id || ':' || v_email,
      v_sale.event_id);
  EXCEPTION WHEN OTHERS THEN
    -- Une alerte ne fait jamais échouer l'accusé du webhook.
    RAISE WARNING 'record_sale_email_event notify failed: %', SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.record_sale_email_event(text, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_sale_email_event(text, uuid, text, text, text, text) TO service_role;
