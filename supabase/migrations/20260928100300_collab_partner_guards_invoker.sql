-- ════════════════════════════════════════════════════════════════════════════
-- Collab club ↔ organisateur : les deux gardes « partenaire » étaient ÉTEINTS
-- ════════════════════════════════════════════════════════════════════════════
--
-- Trouvé le 2026-09-28 en testant la co-organisation. protect_event_columns_
-- from_partner (events) et protect_recurring_template_from_partner
-- (owner_recurring_templates) commencent par
--     IF current_user <> 'authenticated' THEN RETURN NEW; END IF;
-- mais sont SECURITY DEFINER : dans le trigger, current_user vaut le
-- PROPRIÉTAIRE de la fonction, jamais 'authenticated'. Ils sortaient donc
-- toujours à la première ligne. Vérifié sur la base : l'organisateur
-- partenaire d'une co-soirée menée par le club pouvait réécrire
-- `revenue_split_rules` (le partage que lit le checkout) et les colonnes du
-- domaine « opérations » confié au club, par un simple UPDATE PostgREST.
--
-- C'est exactement la règle de CLAUDE.md : un trigger de garde qui
-- discrimine sur current_user ne doit JAMAIS être SECURITY DEFINER. Passer
-- en INVOKER rétablit le comportement écrit : les RPC de confiance
-- (signature, avenants, crons) tournent sous leur propriétaire et passent ;
-- les UPDATE directs d'un client sont jugés colonne par colonne.
--
-- Deuxième défaut du même garde, trouvé en rejouant la matrice : sur une
-- soirée menée par le club, `v_is_lead := … OR (OLD.organizer_user_id =
-- auth.uid())` valait NULL (organizer_user_id NULL), et `IF NOT v_is_lead`
-- ne levait donc jamais. Même en INVOKER, le partenaire réécrivait le partage.
-- Le corps ci-dessous est l'état LIVE, corrigé de ces deux points, étendu aux
-- managers du club et à l'équipe de l'organisateur, et débarrassé des
-- colonnes recalculées par d'autres triggers (faux positifs « design »).
ALTER FUNCTION public.protect_recurring_template_from_partner() SECURITY INVOKER;

CREATE OR REPLACE FUNCTION public.protect_event_columns_from_partner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
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
  v_is_venue_side := OLD.venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), OLD.venue_id);
  v_is_org_side   := COALESCE(OLD.organizer_user_id = auth.uid(), false)
                  OR COALESCE(OLD.partner_organizer_id = auth.uid(), false)
                  OR (COALESCE(OLD.organizer_user_id, OLD.partner_organizer_id) IS NOT NULL
                      AND public.is_org_team_member(auth.uid(), COALESCE(OLD.organizer_user_id, OLD.partner_organizer_id), 'editor'));

  IF NOT (v_is_venue_side OR v_is_org_side) THEN RETURN NEW; END IF;
  IF v_is_venue_side AND v_is_org_side THEN RETURN NEW; END IF;
  v_side := CASE WHEN v_is_venue_side THEN 'venue' ELSE 'organizer' END;
  v_is_lead := v_is_venue_side
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
     OR NEW.minors_disabled        IS DISTINCT FROM OLD.minors_disabled
     OR NEW.alcohol_free           IS DISTINCT FROM OLD.alcohol_free
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
