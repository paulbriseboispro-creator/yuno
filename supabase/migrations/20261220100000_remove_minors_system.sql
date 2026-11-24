-- Suppression du système « mineurs » (2026-11-24, décision de Paul).
--
-- Yuno est réservé aux majeurs : plus de réglage « autoriser les mineurs (sans
-- alcool) » côté club ou organisateur, plus d'exclusion par soirée, plus de
-- document d'autorisation parentale à télécharger / signer / renvoyer, plus de
-- registre des billets « mineur ». La porte d'âge des paiements (date de
-- naissance, 18 ans ou plus) reste.
--
-- Vérifié en prod avant la migration : aucune donnée réelle (0 ligne
-- minor_ticket_docs, 0 soirée alcohol_free / minors_disabled, 0 club ou
-- organisateur minors_allowed, 0 document posé, 0 billet minor_auth_doc_url).
--
-- Le bucket `minor-auth-uploads` (public, écriture anonyme ouverte) perd ici ses
-- policies : plus personne ne peut y écrire ni le lire par l'API. Ses fichiers
-- de test et le bucket lui-même sont supprimés par l'API Storage (jamais par
-- SQL, qui laisserait les fichiers orphelins chez le stockage).
--
-- Ordre : les fonctions vivantes qui citent ces colonnes sont réécrites AVANT
-- le DROP (réécritures tirées de pg_get_functiondef de la prod, seules les
-- lignes « mineurs » retirées). Aucun DROP n'utilise CASCADE : une dépendance
-- oubliée fait échouer la migration au lieu de disparaître en silence.

BEGIN;

-- 1. Fonctions vivantes qui citaient les colonnes supprimées.
CREATE OR REPLACE FUNCTION public.block_support_sensitive_orgprofile_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_support_session() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'support_session_forbidden: DELETE interdit sur organizer_profiles en mode support'
      USING ERRCODE = 'P0403';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Upsert sur un profil existant : ce n'est pas une création. Le diff réel
    -- sera jugé juste après par la branche UPDATE (ON CONFLICT DO UPDATE).
    IF EXISTS (SELECT 1 FROM public.organizer_profiles op WHERE op.user_id = NEW.user_id) THEN
      RETURN NEW;
    END IF;
    -- Création véritable : légitime en mode assisté tant que les champs
    -- légaux/financiers restent vides.
    IF NULLIF(btrim(COALESCE(NEW.billing_email, '')), '') IS NOT NULL
       OR NULLIF(btrim(COALESCE(NEW.siret, '')), '') IS NOT NULL
       OR NULLIF(btrim(COALESCE(NEW.vat_number, '')), '') IS NOT NULL
       OR NULLIF(btrim(COALESCE(NEW.legal_name, '')), '') IS NOT NULL
       OR NULLIF(btrim(COALESCE(NEW.legal_address, '')), '') IS NOT NULL
       OR NULLIF(btrim(COALESCE(NEW.rna_number, '')), '') IS NOT NULL
       OR NEW.vat_regime IS NOT NULL
       OR COALESCE(NEW.absorb_yuno_fees, false)
       OR COALESCE(NEW.can_sell_alcohol, false)
       OR COALESCE(NEW.bde_verified, false)
    THEN
      RAISE EXCEPTION 'support_session_forbidden: champs légaux/financiers en mode support'
        USING ERRCODE = 'P0403';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE : seul un CHANGEMENT réel d'un champ légal/financier bloque.
  IF NULLIF(btrim(COALESCE(NEW.billing_email, '')), '') IS DISTINCT FROM NULLIF(btrim(COALESCE(OLD.billing_email, '')), '')
     OR NULLIF(btrim(COALESCE(NEW.siret, '')), '')       IS DISTINCT FROM NULLIF(btrim(COALESCE(OLD.siret, '')), '')
     OR NULLIF(btrim(COALESCE(NEW.vat_number, '')), '')  IS DISTINCT FROM NULLIF(btrim(COALESCE(OLD.vat_number, '')), '')
     OR NULLIF(btrim(COALESCE(NEW.legal_name, '')), '')  IS DISTINCT FROM NULLIF(btrim(COALESCE(OLD.legal_name, '')), '')
     OR NULLIF(btrim(COALESCE(NEW.legal_address, '')), '') IS DISTINCT FROM NULLIF(btrim(COALESCE(OLD.legal_address, '')), '')
     OR NULLIF(btrim(COALESCE(NEW.rna_number, '')), '') IS DISTINCT FROM NULLIF(btrim(COALESCE(OLD.rna_number, '')), '')
     OR NEW.vat_regime IS DISTINCT FROM OLD.vat_regime
     OR COALESCE(NEW.absorb_yuno_fees, false) IS DISTINCT FROM COALESCE(OLD.absorb_yuno_fees, false)
     OR COALESCE(NEW.can_sell_alcohol, false) IS DISTINCT FROM COALESCE(OLD.can_sell_alcohol, false)
     OR NEW.can_sell_alcohol_confirmed_at IS DISTINCT FROM OLD.can_sell_alcohol_confirmed_at
     OR COALESCE(NEW.bde_verified, false) IS DISTINCT FROM COALESCE(OLD.bde_verified, false)
     OR NEW.bde_verified_at IS DISTINCT FROM OLD.bde_verified_at
  THEN
    RAISE EXCEPTION 'support_session_forbidden: champs légaux/financiers d''organizer_profiles en mode support'
      USING ERRCODE = 'P0403';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_scan_manifest(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue_id text;
  v_partner_venue_id text;
  v_organizer_user_id uuid;
  v_partner_organizer_id uuid;
  v_uid uuid := auth.uid();
  v_found boolean;
  v_ok boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT true, e.venue_id, e.partner_venue_id, e.organizer_user_id, e.partner_organizer_id
    INTO v_found, v_venue_id, v_partner_venue_id, v_organizer_user_id, v_partner_organizer_id
    FROM events e WHERE e.id = p_event_id;
  -- Une soirée org-led n'a NI club NI club partenaire : l'existence se teste
  -- sur la ligne, jamais sur ses colonnes de rattachement.
  IF NOT COALESCE(v_found, false) THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  -- Staff porte OU owner de l'un des deux clubs de l'event (lead ou partenaire)
  -- OU organisateur de l'event (lead ou partenaire) OU son staff de porte.
  --
  -- ⚠️ AUCUN terme ne doit pouvoir valoir NULL. `v_uid IN (a, b)` renvoie NULL
  -- — pas FALSE — dès qu'un des deux membres est NULL et qu'aucun ne matche.
  -- Or sur une soirée de club les deux colonnes organizer SONT NULL : le OU
  -- entier retombait à NULL, `IF NOT NULL` ne déclenche pas, et le manifeste
  -- partait à n'importe quel compte connecté. D'où `IS NOT DISTINCT FROM`
  -- (jamais NULL) et un COALESCE de ceinture sur la garde elle-même.
  v_ok := COALESCE((
    SELECT EXISTS (
      SELECT 1
        FROM user_roles ur
        JOIN profiles p ON p.id = ur.user_id
       WHERE ur.user_id = v_uid
         AND ur.role IN ('bouncer', 'vip_host', 'manager')
         AND p.venue_id IN (v_venue_id, v_partner_venue_id)
    )), false)
    OR COALESCE((
    SELECT EXISTS (
      SELECT 1 FROM venues v
       WHERE v.id IN (v_venue_id, v_partner_venue_id) AND v.owner_id = v_uid
    )), false)
    OR v_uid IS NOT DISTINCT FROM v_organizer_user_id
    OR v_uid IS NOT DISTINCT FROM v_partner_organizer_id
    OR COALESCE(is_event_door_staff(v_uid, p_event_id), false);

  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'event', (
      -- venue_id = le club qui tient la porte, NULL sur une soirée org-led.
      -- organizer_user_id prend alors le relais comme périmètre de la porte.
      SELECT jsonb_build_object(
        'id', e.id, 'title', e.title, 'start_at', e.start_at, 'end_at', e.end_at,
        'venue_id', COALESCE(e.venue_id, e.partner_venue_id),
        'organizer_user_id', COALESCE(e.organizer_user_id, e.partner_organizer_id)
      ) FROM events e WHERE e.id = p_event_id
    ),
    'attendees', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ta.id, 'qr', ta.qr_code, 'name', COALESCE(ta.full_name, t.full_name),
        'scanned', COALESCE(ta.entry_scanned, false), 'scanned_at', ta.entry_scanned_at,
        -- Place remboursée une à une : refusée à la porte, hors ligne compris.
        'ticket_id', t.id,
        'status', CASE WHEN ta.refunded_at IS NOT NULL THEN 'refunded' ELSE t.status END,
        'qty', t.quantity,
        'round', CASE WHEN NULLIF(btrim(tr.group_label), '') IS NULL THEN tr.name ELSE btrim(tr.group_label) || ' · ' || tr.name END, 'drink', tr.includes_drink,
        'deadline', tr.entry_deadline,
        'drink_cutoff', CASE WHEN tr.drink_deadline_type = 'fixed_time' THEN tr.drink_cutoff_time END
      ))
      FROM ticket_attendees ta
      JOIN tickets t ON t.id = ta.ticket_id
      LEFT JOIN ticket_rounds tr ON tr.id = t.ticket_round_id
      WHERE t.event_id = p_event_id AND ta.qr_code IS NOT NULL
    ), '[]'::jsonb),
    'tickets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id, 'qr', t.qr_code, 'name', t.full_name, 'status', t.status,
        -- Billet à places : le QR entier fait entrer les places encore libres
        -- (ni entrées, ni remboursées) ; « scanné » quand il n'en reste aucune.
        'scanned', CASE WHEN pl.n > 0 THEN pl.free = 0 ELSE COALESCE(t.entry_scanned, false) END,
        'scanned_at', t.entry_scanned_at,
        'qty', CASE WHEN pl.n > 0 THEN GREATEST(1, pl.free) ELSE GREATEST(1, COALESCE(t.quantity, 1)) END,
        'round', CASE WHEN NULLIF(btrim(tr.group_label), '') IS NULL THEN tr.name ELSE btrim(tr.group_label) || ' · ' || tr.name END, 'drink', tr.includes_drink,
        'deadline', tr.entry_deadline,
        'drink_cutoff', CASE WHEN tr.drink_deadline_type = 'fixed_time' THEN tr.drink_cutoff_time END
      ))
      FROM tickets t
      LEFT JOIN ticket_rounds tr ON tr.id = t.ticket_round_id
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS n,
               count(*) FILTER (WHERE x.refunded_at IS NULL AND NOT COALESCE(x.entry_scanned, false))::int AS free
          FROM ticket_attendees x WHERE x.ticket_id = t.id
      ) pl
      WHERE t.event_id = p_event_id AND t.qr_code IS NOT NULL
    ), '[]'::jsonb),
    'guest_list', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', g.id, 'qr', g.qr_code, 'name', g.full_name, 'status', g.status,
        'scanned', COALESCE(g.entry_scanned, false), 'scanned_at', g.entry_scanned_at,
        'entry_deadline', g.entry_deadline, 'entry_type', g.entry_type,
        'gl_deadline', gl.entry_deadline, 'free_before', gl.free_before_time,
        'gl_drink', gl.includes_drink
      ))
      FROM guest_list_entries g
      JOIN guest_lists gl ON gl.id = g.guest_list_id
      WHERE gl.event_id = p_event_id AND g.qr_code IS NOT NULL
    ), '[]'::jsonb),
    'tables', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'qr', r.qr_code, 'name', r.full_name, 'status', r.status,
        -- Table à tickets d'invités : le QR de la réservation fait entrer les
        -- invités encore dehors ; « scanné » quand il n'en reste aucun.
        'scanned', CASE WHEN gp.n > 0 THEN gp.free = 0 ELSE COALESCE(r.entry_scanned, false) END,
        'scanned_at', r.entry_scanned_at,
        'guests', CASE WHEN gp.n > 0 THEN GREATEST(1, gp.free) ELSE r.guest_count END,
        'party', r.guest_count,
        'zone', z.name, 'pack', pk.name,
        'arrival', pk.arrival_deadline,
        'deposit', r.deposit, 'total', r.total_price
      ))
      FROM table_reservations r
      LEFT JOIN table_zones z ON z.id = r.zone_id
      LEFT JOIN table_packs pk ON pk.id = r.pack_id
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS n,
               count(*) FILTER (WHERE NOT x.entry_scanned)::int AS free
          FROM table_reservation_guests x WHERE x.reservation_id = r.id
      ) gp
      WHERE r.event_id = p_event_id AND r.qr_code IS NOT NULL
    ), '[]'::jsonb),
    -- Un ticket par personne d'une table : le titulaire (n° 0) puis Invité 1, 2…
    'table_guests', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', g.id, 'qr', g.qr_code, 'reservation_id', r.id,
        'number', g.guest_number, 'name', g.full_name, 'holder', r.full_name,
        'status', r.status,
        'scanned', g.entry_scanned, 'scanned_at', g.entry_scanned_at,
        'party', r.guest_count, 'zone', z.name, 'pack', pk.name,
        'arrival', pk.arrival_deadline,
        'deposit', r.deposit, 'total', r.total_price
      ) ORDER BY r.id, g.guest_number)
      FROM table_reservation_guests g
      JOIN table_reservations r ON r.id = g.reservation_id
      LEFT JOIN table_zones z ON z.id = r.zone_id
      LEFT JOIN table_packs pk ON pk.id = r.pack_id
      WHERE r.event_id = p_event_id
    ), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_event_columns_from_partner()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_venue_side boolean;
  v_is_org_side   boolean;
  v_is_lead       boolean;
  v_side          text;
  v_touched       text;
BEGIN
  -- Ne garder QUE les UPDATE clients directs (PostgREST = rôle `authenticated`).
  -- Les RPC SECURITY DEFINER (signature de contrat, avenants, crons) tournent
  -- sous le rôle propriétaire et sont de confiance.
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF public.is_super_admin() THEN RETURN NEW; END IF;

  IF OLD.partner_organizer_id IS NULL AND OLD.partner_venue_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- COALESCE partout : sur une soirée menée par le club, organizer_user_id est
  -- NULL, et « NULL = uid » rendait v_is_lead NULL — le blocage structurel ne
  -- se déclenchait jamais (le partenaire réécrivait le partage).
  -- Le club = propriétaire OU manager ; l'orga = lui OU son équipe (éditeur+).
  -- Le club LEAD (venue_id) ou le club PARTENAIRE d'une soirée menée par
  -- l'organisateur (partner_venue_id) : les deux sont « côté club ».
  v_is_venue_side := (OLD.venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), OLD.venue_id))
                  OR (OLD.partner_venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), OLD.partner_venue_id));
  v_is_org_side   := COALESCE(OLD.organizer_user_id = auth.uid(), false)
                  OR COALESCE(OLD.partner_organizer_id = auth.uid(), false)
                  OR (COALESCE(OLD.organizer_user_id, OLD.partner_organizer_id) IS NOT NULL
                      AND public.is_org_team_member(auth.uid(), COALESCE(OLD.organizer_user_id, OLD.partner_organizer_id), 'editor'));

  IF NOT (v_is_venue_side OR v_is_org_side) THEN RETURN NEW; END IF;
  IF v_is_venue_side AND v_is_org_side THEN RETURN NEW; END IF;
  v_side := CASE WHEN v_is_venue_side THEN 'venue' ELSE 'organizer' END;
  -- Seul le club qui MÈNE (venue_id) est lead ; un club partenaire ne l'est jamais.
  v_is_lead := (OLD.venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), OLD.venue_id))
            OR COALESCE(OLD.organizer_user_id = auth.uid(), false)
            OR (OLD.organizer_user_id IS NOT NULL
                AND public.is_org_team_member(auth.uid(), OLD.organizer_user_id, 'editor'));

  -- 5a. STRUCTUREL : l'argent, l'identité des parties, le mode, la répartition
  -- elle-même, le cycle de vie. Ne relève d'aucun domaine — ça se renégocie par
  -- contrat ou par avenant, pas dans un champ de formulaire.
  -- (start_at / end_at ont QUITTÉ cette liste : voir 5c.)
  IF NEW.revenue_split_rules      IS DISTINCT FROM OLD.revenue_split_rules
   OR NEW.revenue_split_proposal  IS DISTINCT FROM OLD.revenue_split_proposal
   OR NEW.is_bde                  IS DISTINCT FROM OLD.is_bde
   OR NEW.venue_id                IS DISTINCT FROM OLD.venue_id
   OR NEW.partner_venue_id        IS DISTINCT FROM OLD.partner_venue_id
   OR NEW.organizer_user_id       IS DISTINCT FROM OLD.organizer_user_id
   OR NEW.partner_organizer_id    IS DISTINCT FROM OLD.partner_organizer_id
   OR NEW.event_mode              IS DISTINCT FROM OLD.event_mode
   OR NEW.collab_responsibilities IS DISTINCT FROM OLD.collab_responsibilities
  THEN
    IF NOT v_is_lead THEN
      RAISE EXCEPTION 'Le partenaire ne peut pas modifier le partage, le mode ni la structure de la soirée';
    END IF;
  END IF;

  -- 5b. DESIGN — ce qui habille la soirée et la façon dont elle est montrée.
  IF (NEW.title              IS DISTINCT FROM OLD.title
   OR NEW.description        IS DISTINCT FROM OLD.description
   OR NEW.poster_url         IS DISTINCT FROM OLD.poster_url
   OR NEW.poster_position    IS DISTINCT FROM OLD.poster_position
   OR NEW.video_url          IS DISTINCT FROM OLD.video_url
   OR NEW.flyer_wide_url     IS DISTINCT FROM OLD.flyer_wide_url
   OR NEW.image_url          IS DISTINCT FROM OLD.image_url
   OR NEW.banner_position    IS DISTINCT FROM OLD.banner_position
   OR NEW.music_genres       IS DISTINCT FROM OLD.music_genres
   OR NEW.music_genre        IS DISTINCT FROM OLD.music_genre
   OR NEW.event_type         IS DISTINCT FROM OLD.event_type
   OR NEW.visibility         IS DISTINCT FROM OLD.visibility
   OR NEW.hide_yuno_navigation IS DISTINCT FROM OLD.hide_yuno_navigation)
   -- is_discoverable / discovery_status sont recalculés par
   -- evaluate_event_discoverability (déclenché AVANT ce garde) à partir de
   -- `visibility`, qui reste dans la liste ; search_title est une colonne
   -- GÉNÉRÉE, indéfinie dans NEW en BEFORE. Les comparer bloquait toute
   -- modification de la partie qui ne tient pas le design.
   AND public.collab_domain_holder(OLD.collab_responsibilities, OLD.event_mode, 'design')
       NOT IN (v_side, 'both')
  THEN
    v_touched := 'design';
  END IF;

  -- 5c. OPÉRATIONS — ce qui fait tourner la soirée. Billetterie, tables, lieu,
  -- accès, ET horaires : celui qui fait tourner la nuit en fixe les heures.
  IF v_touched IS NULL
   AND (NEW.ticketing_enabled      IS DISTINCT FROM OLD.ticketing_enabled
     OR NEW.ticket_selling_mode    IS DISTINCT FROM OLD.ticket_selling_mode
     OR NEW.max_tickets            IS DISTINCT FROM OLD.max_tickets
     OR NEW.max_tickets_per_person IS DISTINCT FROM OLD.max_tickets_per_person
     OR NEW.presale_start_at       IS DISTINCT FROM OLD.presale_start_at
     OR NEW.public_sale_start_at   IS DISTINCT FROM OLD.public_sale_start_at
     OR NEW.rounds_visibility      IS DISTINCT FROM OLD.rounds_visibility
     OR NEW.sale_password_enabled  IS DISTINCT FROM OLD.sale_password_enabled
     OR NEW.waitlist_enabled       IS DISTINCT FROM OLD.waitlist_enabled
     OR NEW.tables_enabled         IS DISTINCT FROM OLD.tables_enabled
     OR NEW.tables_mode            IS DISTINCT FROM OLD.tables_mode
     OR NEW.tables_locked_to_venue IS DISTINCT FROM OLD.tables_locked_to_venue
     OR NEW.tables_owner_user_id   IS DISTINCT FROM OLD.tables_owner_user_id
     OR NEW.location_name          IS DISTINCT FROM OLD.location_name
     OR NEW.location_address       IS DISTINCT FROM OLD.location_address
     OR NEW.location_city          IS DISTINCT FROM OLD.location_city
     OR NEW.location_is_secret     IS DISTINCT FROM OLD.location_is_secret
     OR NEW.reveal_address_in_email IS DISTINCT FROM OLD.reveal_address_in_email
     OR NEW.access_code            IS DISTINCT FROM OLD.access_code
     OR NEW.requires_access_code   IS DISTINCT FROM OLD.requires_access_code
     OR NEW.start_at               IS DISTINCT FROM OLD.start_at
     OR NEW.end_at                 IS DISTINCT FROM OLD.end_at)
   AND public.collab_domain_holder(OLD.collab_responsibilities, OLD.event_mode, 'operations')
       NOT IN (v_side, 'both')
  THEN
    v_touched := 'operations';
  END IF;

  IF v_touched IS NOT NULL THEN
    RAISE EXCEPTION 'Ce domaine (%) est confié à l''autre partie sur cette soirée', v_touched
      USING HINT = 'Proposez un avenant pour déplacer ce domaine.';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_event_columns_from_cohost()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed text[] := ARRAY[
    -- design
    'title', 'description', 'poster_url', 'image_url', 'poster_position', 'banner_position',
    'music_genre', 'music_genres', 'video_url', 'flyer_wide_url', 'location_logo_url', 'event_type',
    -- ventes au quotidien
    'tickets_sold_out', 'tables_sold_out', 'guest_list_sold_out', 'sold_out_pack_ids',
    'entry_target', 'max_tickets_per_person', 'rounds_visibility', 'waitlist_enabled',
    'presale_start_at', 'public_sale_start_at',
    -- recalculés par d'autres triggers (contrôlés plus bas quand il le faut)
    'updated_at', 'slug', 'search_title', 'is_discoverable', 'discovery_status', 'published_at'
  ];
BEGIN
  IF current_user <> 'authenticated' OR v_uid IS NULL THEN RETURN NEW; END IF;
  IF public.is_super_admin() THEN RETURN NEW; END IF;
  IF (OLD.organizer_user_id IS NOT NULL
        AND (OLD.organizer_user_id = v_uid OR public.is_org_team_member(v_uid, OLD.organizer_user_id, 'editor')))
     OR (OLD.partner_organizer_id IS NOT NULL
        AND (OLD.partner_organizer_id = v_uid OR public.is_org_team_member(v_uid, OLD.partner_organizer_id, 'editor')))
     OR (OLD.venue_id IS NOT NULL AND public.can_manage_venue(v_uid, OLD.venue_id))
     OR (OLD.partner_venue_id IS NOT NULL AND public.can_manage_venue(v_uid, OLD.partner_venue_id))
     OR OLD.tables_owner_user_id = v_uid
  THEN
    RETURN NEW;
  END IF;
  IF NOT public.is_event_cohost(OLD.id, v_uid, 'editor') THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - v_allowed) IS DISTINCT FROM (to_jsonb(OLD) - v_allowed)
     -- event_mode : 'co_event' sur une soirée solo couperait toutes les ventes.
     -- published_at : rejouerait les annonces « nouvelle soirée ».
     OR (OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at)
     -- Un rejet de découverte est une décision de Yuno, jamais d'un co-hôte.
     OR (NEW.discovery_status = 'rejected' AND OLD.discovery_status IS DISTINCT FROM 'rejected')
  THEN
    RAISE EXCEPTION 'cohost_structural_change'
      USING HINT = 'Un co-hôte peut habiller la soirée et gérer ses ventes, pas en changer la structure.';
  END IF;
  RETURN NEW;
END;
$function$;

-- 2. Triggers et fonctions de la soirée « sans alcool ».
DROP TRIGGER IF EXISTS trg_event_alcohol_free ON public.events;
DROP TRIGGER IF EXISTS trg_venue_minors_allowed ON public.venues;
DROP TRIGGER IF EXISTS trg_organizer_minors_allowed ON public.organizer_profiles;
DROP FUNCTION IF EXISTS public.compute_event_alcohol_free();
DROP FUNCTION IF EXISTS public.sync_events_alcohol_free_from_venue();
DROP FUNCTION IF EXISTS public.sync_events_alcohol_free_from_organizer();

-- 3. Registre des billets « mineur ».
DROP TABLE IF EXISTS public.minor_ticket_docs;

-- 4. Bucket des autorisations renvoyées : plus aucune lecture ni écriture.
DROP POLICY IF EXISTS "Public read minor auth uploads" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload minor auth docs" ON storage.objects;

-- 5. Colonnes.
ALTER TABLE public.events
  DROP COLUMN IF EXISTS minors_disabled,
  DROP COLUMN IF EXISTS alcohol_free;
ALTER TABLE public.venues
  DROP COLUMN IF EXISTS minors_allowed,
  DROP COLUMN IF EXISTS minor_auth_doc_url,
  DROP COLUMN IF EXISTS minor_auth_doc_name;
ALTER TABLE public.organizer_profiles
  DROP COLUMN IF EXISTS minors_allowed,
  DROP COLUMN IF EXISTS minor_auth_doc_url,
  DROP COLUMN IF EXISTS minor_auth_doc_name;
ALTER TABLE public.tickets
  DROP COLUMN IF EXISTS minor_auth_doc_url;

COMMIT;

NOTIFY pgrst, 'reload schema';
