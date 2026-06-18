-- Auto-création des liens trackés par défaut pour chaque soirée.
-- But : supprimer l'étape manuelle "créer un lien". À la création d'un event,
-- un jeu de canaux par défaut (instagram, tiktok, newsletter, whatsapp) est
-- pré-créé. Backfill des soirées à venir existantes.

-- Générateur de code court unique (base36, 8 caractères).
CREATE OR REPLACE FUNCTION public.gen_tracked_link_code()
RETURNS text LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_alphabet text := 'abcdefghijklmnopqrstuvwxyz0123456789';
  v_code text;
  v_i int;
  v_exists boolean;
BEGIN
  LOOP
    v_code := '';
    FOR v_i IN 1..8 LOOP
      v_code := v_code || substr(v_alphabet, floor(random() * 36)::int + 1, 1);
    END LOOP;
    SELECT EXISTS (SELECT 1 FROM public.tracked_links WHERE code = v_code) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;
  RETURN v_code;
END; $$;

-- Pré-crée les liens par défaut d'une soirée (idempotent : ne duplique jamais un canal).
CREATE OR REPLACE FUNCTION public.seed_event_tracked_links(p_event_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_event      public.events%ROWTYPE;
  v_owner_kind text;
  v_venue_id   text;
  v_org_user   uuid;
  v_created_by uuid;
  v_channel    text;
  v_channels   text[] := ARRAY['instagram','tiktok','newsletter','whatsapp'];
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Une soirée de club appartient au club ; une soirée organisateur autonome à l'organisateur.
  IF v_event.venue_id IS NOT NULL THEN
    v_owner_kind := 'venue';
    v_venue_id   := v_event.venue_id;
    SELECT owner_id INTO v_created_by FROM public.venues WHERE id = v_event.venue_id;
    v_created_by := COALESCE(v_created_by, v_event.organizer_user_id);
  ELSIF v_event.organizer_user_id IS NOT NULL THEN
    v_owner_kind := 'organizer';
    v_org_user   := v_event.organizer_user_id;
    v_created_by := v_event.organizer_user_id;
  ELSE
    RETURN; -- aucun propriétaire à qui attribuer
  END IF;

  IF v_created_by IS NULL THEN RETURN; END IF;

  FOREACH v_channel IN ARRAY v_channels LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.tracked_links
      WHERE event_id = p_event_id AND owner_kind = v_owner_kind AND lower(label) = v_channel
    ) THEN
      INSERT INTO public.tracked_links
        (code, label, owner_kind, venue_id, organizer_user_id, created_by, target_kind, event_id, utm_source, utm_medium)
      VALUES
        (public.gen_tracked_link_code(), v_channel, v_owner_kind, v_venue_id, v_org_user, v_created_by, 'event', p_event_id, v_channel, 'event_link');
    END IF;
  END LOOP;
END; $$;

-- Trigger : couvre toutes les surfaces de création (owner, organizer, soirées récurrentes).
CREATE OR REPLACE FUNCTION public.trg_seed_event_tracked_links()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.seed_event_tracked_links(NEW.id);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS seed_tracked_links_on_event ON public.events;
CREATE TRIGGER seed_tracked_links_on_event
  AFTER INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.trg_seed_event_tracked_links();

-- Backfill : soirées à venir et actives (l'UI masque les soirées passées).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.events WHERE is_active = true AND end_at >= now() LOOP
    PERFORM public.seed_event_tracked_links(r.id);
  END LOOP;
END $$;
