-- ════════════════════════════════════════════════════════════════════════════
-- Co-organisation — consentement partagé : les clés d'hôtes du checkout font foi
-- ════════════════════════════════════════════════════════════════════════════
--
-- share_event_marketing_consent excluait « la portée principale » calculée
-- côté serveur (club de la soirée, sinon organisateur). Or le checkout TABLES
-- d'une soirée d'organisateur tenue dans un club consent au CLUB (formules du
-- club) : l'organisateur, nommé dans la case, était alors écarté des deux
-- côtés et ne recevait jamais le contact. Quand le checkout transmet la liste
-- des hôtes qu'il a NOMMÉS (p_host_keys), c'est elle qui décide — l'écriture
-- est idempotente (upsert), une portée déjà abonnée ne bouge pas.
CREATE OR REPLACE FUNCTION public.share_event_marketing_consent(
  p_event_id uuid, p_email text, p_wording text, p_locale text DEFAULT NULL, p_source text DEFAULT 'checkout',
  p_host_keys text[] DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email  text := lower(btrim(COALESCE(p_email, '')));
  v_ev     record;
  v_primary text;
  v_uid    uuid;
  p        record;
  v_n      integer := 0;
BEGIN
  IF v_email = '' OR position('@' IN v_email) = 0 THEN RETURN 0; END IF;
  IF COALESCE(btrim(p_wording), '') = '' THEN RETURN 0; END IF;
  SELECT * INTO v_ev FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- Une vente / inscription RÉCENTE de cette adresse sur cette soirée, case
  -- cochée : impossible d'abonner une adresse quelconque.
  IF NOT (
    EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id = p_event_id AND lower(t.user_email) = v_email
             AND COALESCE(t.newsletter_opt_in, false) AND t.created_at > now() - interval '3 hours')
    OR EXISTS (SELECT 1 FROM public.table_reservations r WHERE r.event_id = p_event_id AND lower(r.user_email) = v_email
             AND COALESCE(r.newsletter_opt_in, false) AND r.created_at > now() - interval '3 hours')
    OR EXISTS (SELECT 1 FROM public.guest_list_entries g JOIN public.guest_lists gl ON gl.id = g.guest_list_id
                WHERE gl.event_id = p_event_id AND lower(g.email) = v_email
                  AND COALESCE(g.newsletter_opt_in, false) AND g.created_at > now() - interval '3 hours')
  ) THEN
    RETURN 0;
  END IF;

  v_primary := CASE WHEN v_ev.venue_id IS NOT NULL THEN 'venue:' || v_ev.venue_id ELSE 'org:' || v_ev.organizer_user_id END;
  SELECT u.id INTO v_uid FROM auth.users u WHERE lower(u.email) = v_email LIMIT 1;

  FOR p IN SELECT * FROM public.event_parties(p_event_id) x
            WHERE x.share_crm
              AND CASE WHEN p_host_keys IS NULL THEN x.party_key <> v_primary
                       ELSE x.party_key = ANY (p_host_keys) END
  LOOP
    IF p.kind = 'venue' THEN
      INSERT INTO public.newsletter_subscriptions (user_id, venue_id, email, opted_in, source, consent_source, consent_recorded_at)
      VALUES (v_uid, p.venue_id, v_email, true, 'cohost_purchase', 'ticketing', now())
      ON CONFLICT (lower(email), venue_id) WHERE venue_id IS NOT NULL DO UPDATE
        SET opted_in = true, opted_out_at = NULL,
            user_id = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id), updated_at = now();
    ELSE
      INSERT INTO public.newsletter_subscriptions (user_id, organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at)
      VALUES (v_uid, p.organizer_user_id, v_email, true, 'cohost_purchase', 'ticketing', now())
      ON CONFLICT (lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL DO UPDATE
        SET opted_in = true, opted_out_at = NULL,
            user_id = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id), updated_at = now();
    END IF;
    INSERT INTO public.marketing_consent_events (user_id, email, channel, venue_id, organizer_user_id,
                                                 action, wording_key, wording_text, locale, source)
    VALUES (v_uid, v_email, 'email', p.venue_id, p.organizer_user_id, 'granted', 'consent.emailOffersFrom',
            left(btrim(p_wording), 1000), p_locale, left(COALESCE(p_source, 'checkout'), 60) || ':cohost');
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'share_event_marketing_consent: %', SQLERRM;
  RETURN 0;
END;
$$;
