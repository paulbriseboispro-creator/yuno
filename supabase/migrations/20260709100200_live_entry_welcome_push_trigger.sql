-- Mode Live — push de bienvenue au scan d'entrée.
--
-- Un trigger DB (plutôt qu'un appel JS côté scanner) : il y a TROIS surfaces
-- de scan (Bouncer, check-in organisateur, scan promoteur) et toutes passent
-- par le même UPDATE entry_scanned=true. Le trigger attrape tous les
-- écrivains présents et futurs.
--
-- `net.http_post` est asynchrone (queue pg_net) : zéro latence ajoutée au
-- scan du videur. L'authentification vers send-push-notification passe par le
-- header x-cron-secret (Vault, pattern private.get_cron_secret() des crons).
-- Tout le corps est enveloppé d'un EXCEPTION WHEN OTHERS : le push est
-- best-effort et ne doit JAMAIS faire échouer un scan à la porte.
--
-- Pas de trigger sur ticket_attendees : le scan nominatif flippe aussi le
-- ticket parent (gardé par .eq entry_scanned=false côté scanner), qui
-- déduplique naturellement — un seul push par ticket.

CREATE OR REPLACE FUNCTION private.notify_live_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_user_id uuid;
  v_event_id uuid;
  v_event record;
  v_venue record;
  v_lang text;
  v_title text;
  v_body text;
BEGIN
  IF TG_TABLE_NAME = 'tickets' THEN
    v_user_id := NEW.user_id;
    v_event_id := NEW.event_id;
  ELSIF TG_TABLE_NAME = 'table_reservations' THEN
    v_user_id := NEW.user_id;
    v_event_id := NEW.event_id;
  ELSIF TG_TABLE_NAME = 'guest_list_entries' THEN
    v_user_id := NEW.user_id;
    SELECT gl.event_id INTO v_event_id
    FROM public.guest_lists gl
    WHERE gl.id = NEW.guest_list_id;
    IF v_user_id IS NULL AND NEW.email IS NOT NULL THEN
      SELECT u.id INTO v_user_id
      FROM auth.users u
      WHERE lower(u.email) = lower(NEW.email)
      LIMIT 1;
    END IF;
  END IF;

  IF v_user_id IS NULL OR v_event_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT e.title, e.start_at, e.end_at, e.venue_id
  INTO v_event
  FROM public.events e
  WHERE e.id = v_event_id;

  IF v_event.venue_id IS NULL THEN
    RETURN NEW; -- événement sans club : pas de menu, pas de Mode Live
  END IF;

  IF now() NOT BETWEEN v_event.start_at - interval '2 hours'
                   AND v_event.end_at + interval '2 hours' THEN
    RETURN NEW;
  END IF;

  SELECT v.name, v.live_mode_enabled
  INTO v_venue
  FROM public.venues v
  WHERE v.id = v_event.venue_id;

  IF NOT COALESCE(v_venue.live_mode_enabled, false) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(p.preferred_language, 'fr')
  INTO v_lang
  FROM public.profiles p
  WHERE p.id = v_user_id;

  IF v_lang = 'fr' THEN
    v_title := '🎉 Tu es entré — bienvenue au ' || v_venue.name || ' !';
    v_body := 'Ton menu de soirée est ouvert. Commande tes boissons sans faire la queue au bar.';
  ELSIF v_lang = 'es' THEN
    v_title := '🎉 Ya estás dentro — ¡bienvenido a ' || v_venue.name || '!';
    v_body := 'Tu menú de la noche está abierto. Pide tus bebidas sin hacer cola en la barra.';
  ELSE
    v_title := '🎉 You''re in — welcome to ' || v_venue.name || '!';
    v_body := 'Your night menu is open. Order drinks without queuing at the bar.';
  END IF;

  PERFORM net.http_post(
    url := 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', private.get_cron_secret()
    ),
    body := jsonb_build_object(
      'user_id', v_user_id,
      'payload', jsonb_build_object(
        'title', v_title,
        'body', v_body,
        'url', '/live'
      )
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Best-effort : ne jamais casser le scan à la porte pour un push raté.
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.notify_live_entry() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_live_entry_push ON public.tickets;
CREATE TRIGGER trg_live_entry_push
  AFTER UPDATE OF entry_scanned ON public.tickets
  FOR EACH ROW
  WHEN (NEW.entry_scanned AND OLD.entry_scanned IS DISTINCT FROM NEW.entry_scanned)
  EXECUTE FUNCTION private.notify_live_entry();

DROP TRIGGER IF EXISTS trg_live_entry_push ON public.table_reservations;
CREATE TRIGGER trg_live_entry_push
  AFTER UPDATE OF entry_scanned ON public.table_reservations
  FOR EACH ROW
  WHEN (NEW.entry_scanned AND OLD.entry_scanned IS DISTINCT FROM NEW.entry_scanned)
  EXECUTE FUNCTION private.notify_live_entry();

DROP TRIGGER IF EXISTS trg_live_entry_push ON public.guest_list_entries;
CREATE TRIGGER trg_live_entry_push
  AFTER UPDATE OF entry_scanned ON public.guest_list_entries
  FOR EACH ROW
  WHEN (NEW.entry_scanned AND OLD.entry_scanned IS DISTINCT FROM NEW.entry_scanned)
  EXECUTE FUNCTION private.notify_live_entry();
