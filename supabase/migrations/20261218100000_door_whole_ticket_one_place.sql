-- Porte : le QR du BILLET ENTIER fait entrer UNE personne par scan (2026-11-18)
--
-- House Of Love (Amoris, 18/11) : une commande de 2 billets (Cristina Egger +
-- Svetlana Nourrain, même adresse e-mail). L'acheteuse a montré le QR du billet
-- entier (pass Wallet « t-… ») : les DEUX places ont été marquées entrées à la
-- même seconde, et le QR de Svetlana a été refusé (« déjà scanné ») à son
-- arrivée. Le QR entier faisait entrer toutes les places encore libres.
--
-- Règle désormais, partout (app : enterNextPlace / wholeTicketDoorState / scan
-- hors ligne ; base : ce fichier) : le QR entier fait entrer la PREMIÈRE place
-- encore dehors (l'acheteur d'abord, suffixe « -1 »), une seule. Un groupe qui
-- n'a que ce QR le fait scanner une fois par personne ; il n'est « déjà
-- scanné » que quand toutes les places sont entrées.
--
-- 1. door_ticket_scan_consumes_attendees : un billet marqué directement (ancien
--    chemin, rejeu d'un vieux téléphone) ne consomme plus qu'UNE place.
-- 2. sync_offline_scans, branche 'ticket' d'un billet à places : une place.
--    Patchée sur la définition VIVANTE (remplacement ciblé), jamais recopiée.
-- Les tables VIP ne changent pas (le QR de la réservation fait entrer la table).

CREATE OR REPLACE FUNCTION public._ticket_place_rank(p_qr text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $$
  SELECT COALESCE(NULLIF(substring(COALESCE(p_qr, '') FROM '-([0-9]{1,3})$'), '')::int, 9999)
$$;
REVOKE ALL ON FUNCTION public._ticket_place_rank(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._ticket_place_rank(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.door_ticket_scan_consumes_attendees()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Une place déjà entrée avec son QR a marqué le billet : rien d'autre à faire.
  IF EXISTS (
    SELECT 1 FROM public.ticket_attendees
     WHERE ticket_id = NEW.id AND COALESCE(entry_scanned, false)
  ) THEN
    RETURN NEW;
  END IF;
  -- Billet marqué directement : UNE personne entre, la première place dehors.
  UPDATE public.ticket_attendees
     SET entry_scanned = true,
         entry_scanned_at = COALESCE(NEW.entry_scanned_at, now()),
         entry_scanned_by = NEW.entry_scanned_by
   WHERE id = (
     SELECT ta.id FROM public.ticket_attendees ta
      WHERE ta.ticket_id = NEW.id
        AND ta.refunded_at IS NULL
        AND COALESCE(ta.entry_scanned, false) = false
      ORDER BY public._ticket_place_rank(ta.qr_code), ta.created_at
      LIMIT 1
   );
  RETURN NEW;
END;
$function$;

DO $do$
DECLARE
  v_def text := pg_get_functiondef('public.sync_offline_scans'::regproc);
  v_old text := $o$        UPDATE ticket_attendees ta
           SET entry_scanned = true, entry_scanned_at = v_ts, entry_scanned_by = v_uid
          FROM tickets t
         WHERE ta.ticket_id = v_id AND t.id = ta.ticket_id AND t.event_id = v_event_id
           AND t.status = 'paid' AND ta.refunded_at IS NULL
           AND COALESCE(ta.entry_scanned, false) = false;$o$;
  v_new text := $n$        -- Une seule place par scan du QR entier (18/11), l'acheteur d'abord.
        UPDATE ticket_attendees ta
           SET entry_scanned = true, entry_scanned_at = v_ts, entry_scanned_by = v_uid
          FROM tickets t
         WHERE t.id = ta.ticket_id AND t.event_id = v_event_id AND t.status = 'paid'
           AND ta.id = (
             SELECT ta2.id FROM ticket_attendees ta2
              WHERE ta2.ticket_id = v_id AND ta2.refunded_at IS NULL
                AND COALESCE(ta2.entry_scanned, false) = false
              ORDER BY public._ticket_place_rank(ta2.qr_code), ta2.created_at
              LIMIT 1
           )
           AND COALESCE(ta.entry_scanned, false) = false;$n$;
BEGIN
  IF position(v_new IN v_def) > 0 THEN
    RETURN; -- déjà appliqué
  END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'sync_offline_scans: branche ticket introuvable, patch non appliqué';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$do$;
