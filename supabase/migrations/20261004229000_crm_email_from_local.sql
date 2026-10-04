-- Réglages d'envoi (Console CRM) : l'adresse d'envoi vient du serveur.
--
-- crm_email_settings_get rend `from_local`, la partie avant @ de l'adresse
-- d'envoi, tirée du MÊME nom que send-campaign (resolveSender) et passée au
-- même slug (slugifyVenueName). Le nom affiché dans la Console peut différer
-- (display_name d'une organisation) : l'écran ne devine plus.

CREATE OR REPLACE FUNCTION public.crm_email_settings_get(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.crm_email_settings%ROWTYPE;
  v_name text; v_reply text; v_city text; v_addr text; v_from text;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.crm_email_settings WHERE scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id);
  IF p_venue_id IS NOT NULL THEN
    SELECT v.name, p.email, v.city, v.address INTO v_name, v_reply, v_city, v_addr
      FROM public.venues v LEFT JOIN public.profiles p ON p.id = v.owner_id WHERE v.id = p_venue_id;
  ELSE
    SELECT COALESCE(NULLIF(btrim(p.organization_name), ''), NULLIF(btrim(op.display_name), ''), btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, ''))),
           p.email, COALESCE(op.city, p.city), NULL
      INTO v_name, v_reply, v_city, v_addr
      FROM public.profiles p LEFT JOIN public.organizer_profiles op ON op.user_id = p.id WHERE p.id = p_organizer_user_id;
  END IF;
  -- Nom dont l'adresse d'envoi est tirée : celui que lit send-campaign
  -- (resolveSender : nom du club, sinon nom de l'organisation du profil,
  -- sinon prénom nom), passé au même slug que slugifyVenueName.
  IF p_venue_id IS NOT NULL THEN
    v_from := v_name;
  ELSE
    SELECT COALESCE(NULLIF(p.organization_name, ''), NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''), 'Organisateur')
      INTO v_from FROM public.profiles p WHERE p.id = p_organizer_user_id;
  END IF;
  v_from := COALESCE(NULLIF(left(btrim(regexp_replace(regexp_replace(
              regexp_replace(normalize(lower(COALESCE(v_from, '')), NFD), '[\u0300-\u036f]', '', 'g'),
              '[^a-z0-9]+', '-', 'g'), '-+', '-', 'g'), '-'), 64), ''), 'club');

  RETURN jsonb_build_object(
    'from_local', v_from,
    'sender_name', s.sender_name, 'reply_to', s.reply_to, 'postal_address', s.postal_address,
    'quiet_hours', COALESCE(s.quiet_hours, true), 'waves', COALESCE(s.waves, false), 'notify_done', COALESCE(s.notify_done, true),
    'test_emails', COALESCE(to_jsonb(s.test_emails), '[]'::jsonb), 'updated_at', s.updated_at,
    'defaults', jsonb_build_object('sender_name', v_name, 'reply_to', v_reply, 'city', v_city, 'address', v_addr));
END;
$$;
