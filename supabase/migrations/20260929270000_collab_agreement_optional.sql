-- ═══════════════════════════════════════════════════════════════════════════
-- Collaboration : l'accord financier via Yuno devient FACULTATIF (29/09).
--
-- Jusqu'ici une co-soirée club × organisateur ne vendait rien tant que les deux
-- parties n'avaient pas signé le contrat Yuno : `revenue_split_rules` restait à
-- NULL, et les checkouts (garde 2) comme `event_payments_ready` refusaient.
-- Or une collaboration commence souvent AVANT d'avoir parlé d'argent.
--
-- Deuxième voie, « Réglé entre vous » : pas de contrat, pas de décompte, pas de
-- virement suivi. Chaque pilier est encaissé EN DIRECT par une seule partie,
-- choisie par le lead (billets → orga ou club, tables → orga ou club, bar →
-- toujours le club, licence alcool). Techniquement c'est un partage 100/0 par
-- pilier : le résolveur (`_shared/payment-split.ts`) le traite déjà comme une
-- charge DIRECTE sur le seul compte qui reçoit de l'argent — aucune jambe, aucune
-- rétention, aucun circuit d'argent nouveau. Le marqueur `agreement = 'external'`
-- dit aux écrans que ce n'est PAS un contrat signé.
--
-- Passer ensuite par un contrat Yuno reste possible tant que rien n'est vendu :
-- `create_event_collab_contract` pose une proposition, la signature des deux
-- remplace les règles (le marqueur disparaît avec elles).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Lecture du marqueur (miroir : isExternalAgreement, src/lib/splitRules.ts)

CREATE OR REPLACE FUNCTION public.collab_agreement_is_external(p_rules jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT COALESCE(p_rules ->> 'agreement', '') = 'external';
$$;
GRANT EXECUTE ON FUNCTION public.collab_agreement_is_external(jsonb) TO anon, authenticated;

-- ─── 2. Poser « Réglé entre vous » sur une co-soirée ──────────────────────────
--
-- Appelée par le LEAD (celui dont la colonne principale porte la soirée) juste
-- après avoir rattaché le partenaire. Refusée s'il existe un contrat vivant
-- (annuler d'abord la demande) ou si une vente a déjà verrouillé le partage.

CREATE OR REPLACE FUNCTION public.set_event_collab_external_agreement(
  p_event_id uuid,
  p_tickets  text DEFAULT NULL,   -- 'organizer' | 'venue'
  p_tables   text DEFAULT NULL    -- 'organizer' | 'venue'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e          record;
  v_venue    text;
  v_org      uuid;
  v_is_venue boolean;
  v_is_org   boolean;
  v_lead     text;
  v_tickets  text;
  v_tables   text;
  v_rules    jsonb;
  v_name     text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO e FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;

  SELECT venue_id, organizer_user_id INTO v_venue, v_org FROM public.collab_event_parties(p_event_id);
  IF v_venue IS NULL OR v_org IS NULL THEN RAISE EXCEPTION 'not_a_collab'; END IF;

  -- Le lead seulement : le club qui porte la soirée, ou l'organisation qui la porte.
  v_lead := CASE WHEN e.venue_id IS NOT NULL THEN 'venue' ELSE 'organizer' END;
  v_is_venue := v_lead = 'venue' AND public.is_venue_owner(auth.uid(), v_venue);
  v_is_org   := v_lead = 'organizer' AND public.collab_org_can_act(v_org);
  IF NOT (v_is_venue OR v_is_org) THEN RAISE EXCEPTION 'not_lead'; END IF;

  IF EXISTS (SELECT 1 FROM public.event_collab_contracts c
              WHERE c.event_id = p_event_id AND c.status <> 'cancelled') THEN
    RAISE EXCEPTION 'contract_exists';
  END IF;
  IF e.split_locked_at IS NOT NULL OR public.collab_event_has_sales(p_event_id) THEN
    RAISE EXCEPTION 'split_locked';
  END IF;

  -- Défauts : la billetterie à l'organisateur, les tables au club — sauf la
  -- « soirée de l'organisateur » (org_hosted), où il tient aussi les tables.
  v_tickets := CASE WHEN p_tickets IN ('organizer', 'venue') THEN p_tickets ELSE 'organizer' END;
  v_tables  := CASE WHEN p_tables IN ('organizer', 'venue') THEN p_tables
                    WHEN e.event_mode::text = 'org_hosted' THEN 'organizer'
                    ELSE 'venue' END;

  v_rules := jsonb_build_object(
    'agreement', 'external',
    'tickets', jsonb_build_object(
      'organizer_pct', CASE WHEN v_tickets = 'organizer' THEN 100 ELSE 0 END,
      'venue_pct',     CASE WHEN v_tickets = 'organizer' THEN 0 ELSE 100 END),
    'tables', jsonb_build_object(
      'organizer_pct', CASE WHEN v_tables = 'organizer' THEN 100 ELSE 0 END,
      'venue_pct',     CASE WHEN v_tables = 'organizer' THEN 0 ELSE 100 END),
    'drinks', jsonb_build_object('organizer_pct', 0, 'venue_pct', 100)
  );

  UPDATE public.events
     SET revenue_split_rules = v_rules,
         revenue_split_proposal = NULL,
         split_proposed_by = NULL,
         split_proposed_at = NULL,
         split_approved_by_venue = false,
         split_approved_by_organizer = false
   WHERE id = p_event_id;

  -- Prévenir l'autre partie (in-app). Une alerte ne fait jamais échouer l'accord.
  BEGIN
    IF v_lead = 'venue' THEN
      SELECT name INTO v_name FROM public.venues WHERE id = v_venue;
      PERFORM public.emit_organizer_notification(
        v_org, 'collab_external_added',
        COALESCE(v_name, 'Un club') || ' t''ajoute à une soirée',
        e.title || ' — accord financier réglé entre vous, hors Yuno.',
        'normal', 'event', p_event_id, p_event_id,
        jsonb_build_object('agreement', 'external', 'tickets', v_tickets, 'tables', v_tables),
        'collab_external:' || p_event_id::text);
    ELSE
      SELECT display_name INTO v_name FROM public.organizer_profiles WHERE user_id = v_org;
      PERFORM public.emit_staff_notification(
        v_venue, 'owner', 'collab_external_added',
        COALESCE(v_name, 'Un organisateur') || ' t''ajoute à une soirée',
        e.title || ' — accord financier réglé entre vous, hors Yuno.',
        'normal', 'event', p_event_id, p_event_id,
        jsonb_build_object('agreement', 'external', 'tickets', v_tickets, 'tables', v_tables),
        'collab_external:' || p_event_id::text);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'set_event_collab_external_agreement notify: %', SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true, 'tickets', v_tickets, 'tables', v_tables, 'drinks', 'venue');
END;
$$;
REVOKE ALL ON FUNCTION public.set_event_collab_external_agreement(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_event_collab_external_agreement(uuid, text, text) TO authenticated;

-- ─── 3. Un contrat Yuno proposé APRÈS coup, jamais sur une soirée qui a vendu ──
--
-- Sur « Réglé entre vous », proposer un contrat pose une proposition que la garde
-- 1 des checkouts lit comme « contrat en attente » : la vente se refermerait
-- jusqu'aux deux signatures, et la signature réécrirait un partage déjà engagé
-- par des ventes. Tant que rien n'est vendu, c'est permis ; après, non.

CREATE OR REPLACE FUNCTION public.guard_collab_contract_after_external()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.events e
              WHERE e.id = NEW.event_id
                AND public.collab_agreement_is_external(e.revenue_split_rules)
                AND (e.split_locked_at IS NOT NULL OR public.collab_event_has_sales(e.id))) THEN
    RAISE EXCEPTION 'external_agreement_locked';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_collab_contract_after_external() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_collab_contract_after_external ON public.event_collab_contracts;
CREATE TRIGGER trg_guard_collab_contract_after_external
  BEFORE INSERT ON public.event_collab_contracts
  FOR EACH ROW EXECUTE FUNCTION public.guard_collab_contract_after_external();

-- ═══════════════════════════════════════════════════════════════════════════
-- Chaque partie a SES liens de la soirée, et ses emails parlent en SON nom.
--
-- Constaté le 29/09 en préparant la première soirée à plusieurs organisations :
--  • `seed_event_tracked_links` ne semait les canaux (Instagram, TikTok,
--    Newsletter, WhatsApp) qu'au nom de l'HÔTE : un co-hôte qui ouvrait « Liens
--    suivis » sur la soirée voyait une liste vide, et le semis automatique
--    retombait… sur l'hôte ;
--  • `resolve_campaign_tracked_links` prenait le premier lien « newsletter » de
--    la soirée, sans regarder qui envoie : les boutons de la campagne d'un
--    co-hôte partaient sur le lien de l'hôte, et « Qui fait vendre ? » créditait
--    l'hôte des ventes de l'email du partenaire ;
--  • l'audience INFORMATIVE « acheteurs de la soirée » rendait tous les
--    acheteurs à n'importe quelle portée qui la demandait — un co-hôte pouvait
--    écrire à des clients qui ne l'ont jamais nommé.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 4. Les canaux d'une PARTIE de la soirée ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.seed_event_party_tracked_links(
  p_event_id uuid,
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e            record;
  v_key        text;
  v_owner_kind text;
  v_created_by uuid;
  v_channel    text;
  v_channels   text[] := ARRAY['instagram','tiktok','newsletter','whatsapp'];
BEGIN
  IF p_event_id IS NULL OR (p_venue_id IS NULL AND p_organizer_user_id IS NULL) THEN RETURN; END IF;
  SELECT id, venue_id, organizer_user_id INTO e FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- L'hôte garde son semis historique (mêmes lignes, mêmes codes).
  IF (p_venue_id IS NOT NULL AND p_venue_id = e.venue_id)
     OR (p_venue_id IS NULL AND e.venue_id IS NULL AND p_organizer_user_id = e.organizer_user_id) THEN
    PERFORM public.seed_event_tracked_links(p_event_id);
    RETURN;
  END IF;

  v_key := CASE WHEN p_venue_id IS NOT NULL THEN 'venue:' || p_venue_id ELSE 'org:' || p_organizer_user_id::text END;
  -- Une partie de la soirée (principale ou co-hôte accepté), et l'appelant en est.
  IF NOT EXISTS (SELECT 1 FROM public.event_parties(p_event_id) p WHERE p.party_key = v_key) THEN RETURN; END IF;
  IF auth.uid() IS NOT NULL AND COALESCE(public.coorg_party_level(auth.uid(), v_key), 0) < 1 THEN RETURN; END IF;

  IF p_venue_id IS NOT NULL THEN
    v_owner_kind := 'venue';
    SELECT owner_id INTO v_created_by FROM public.venues WHERE id = p_venue_id;
  ELSE
    v_owner_kind := 'organizer';
    v_created_by := p_organizer_user_id;
  END IF;
  v_created_by := COALESCE(auth.uid(), v_created_by);
  IF v_created_by IS NULL THEN RETURN; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('party_channels:' || p_event_id::text || ':' || v_key));
  FOREACH v_channel IN ARRAY v_channels LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.tracked_links tl
       WHERE tl.event_id = p_event_id AND tl.target_kind = 'event'
         AND tl.owner_kind = v_owner_kind
         AND tl.venue_id IS NOT DISTINCT FROM (CASE WHEN v_owner_kind = 'venue' THEN p_venue_id END)
         AND tl.organizer_user_id IS NOT DISTINCT FROM (CASE WHEN v_owner_kind = 'organizer' THEN p_organizer_user_id END)
         AND tl.promoter_id IS NULL AND tl.dj_id IS NULL
         AND lower(tl.label) = v_channel
    ) THEN
      INSERT INTO public.tracked_links
        (code, label, owner_kind, venue_id, organizer_user_id, created_by, target_kind, event_id, utm_source, utm_medium)
      VALUES
        (public.gen_tracked_link_code(), v_channel, v_owner_kind,
         CASE WHEN v_owner_kind = 'venue' THEN p_venue_id END,
         CASE WHEN v_owner_kind = 'organizer' THEN p_organizer_user_id END,
         v_created_by, 'event', p_event_id, v_channel, 'event_link');
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.seed_event_party_tracked_links(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_event_party_tracked_links(uuid, text, uuid) TO authenticated, service_role;

-- Un co-hôte qui accepte trouve ses liens déjà prêts (lien direct compris).
CREATE OR REPLACE FUNCTION public.trg_cohost_seed_party_links()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'accepted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'accepted') THEN
    BEGIN
      PERFORM public.seed_event_party_tracked_links(NEW.event_id, NEW.venue_id, NEW.organizer_user_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'trg_cohost_seed_party_links: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_cohost_seed_party_links() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cohost_seed_party_links ON public.event_cohosts;
CREATE TRIGGER trg_cohost_seed_party_links
  AFTER INSERT OR UPDATE OF status ON public.event_cohosts
  FOR EACH ROW EXECUTE FUNCTION public.trg_cohost_seed_party_links();

-- ─── 5. Les boutons d'une campagne partent sur le lien de QUI l'envoie ───────
--
-- Nouvelle signature (portée de l'expéditeur) : DROP + CREATE, jamais une
-- surcharge — l'appel à 2 arguments nommés des fonctions déjà déployées doit
-- continuer de résoudre sans ambiguïté (erreur 300).

DROP FUNCTION IF EXISTS public.resolve_campaign_tracked_links(uuid[], text);
CREATE FUNCTION public.resolve_campaign_tracked_links(
  p_event_ids uuid[],
  p_channel text DEFAULT 'newsletter',
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL
) RETURNS TABLE(event_id uuid, event_code text, guest_list_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_event   uuid;
  v_gl      uuid;
  v_channel text := lower(coalesce(nullif(btrim(p_channel), ''), 'newsletter'));
  v_scoped  boolean := p_venue_id IS NOT NULL OR p_organizer_user_id IS NOT NULL;
  v_code    text;
  v_host    boolean;
BEGIN
  IF p_event_ids IS NULL OR array_length(p_event_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  FOREACH v_event IN ARRAY p_event_ids LOOP
    -- La part publique = celle que l'email montre déjà (pickPublicGuestList).
    v_gl := NULL;
    SELECT gl.id INTO v_gl
      FROM public.guest_lists gl
     WHERE gl.event_id = v_event
       AND gl.is_active = true
       AND gl.visible_on_club_page = true
     ORDER BY (gl.holder_type = 'club') DESC, gl.created_at ASC
     LIMIT 1;

    -- L'expéditeur est-il l'hôte de la soirée (propriétaire historique des canaux) ?
    SELECT (p_venue_id IS NOT NULL AND p_venue_id = e.venue_id)
        OR (p_venue_id IS NULL AND e.venue_id IS NULL AND p_organizer_user_id = e.organizer_user_id)
      INTO v_host
      FROM public.events e WHERE e.id = v_event;
    v_host := COALESCE(v_host, false);

    BEGIN
      PERFORM public.seed_event_tracked_links(v_event);
      IF v_scoped AND NOT v_host THEN
        PERFORM public.seed_event_party_tracked_links(v_event, p_venue_id, p_organizer_user_id);
      END IF;
      IF v_gl IS NOT NULL THEN
        PERFORM public.seed_guest_list_tracked_links(v_gl);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    v_code := NULL;
    IF v_scoped AND NOT v_host THEN
      -- Partenaire / co-hôte : SON canal, jamais celui de l'hôte.
      SELECT tl.code INTO v_code FROM public.tracked_links tl
       WHERE tl.target_kind = 'event' AND tl.event_id = v_event
         AND tl.promoter_id IS NULL AND tl.dj_id IS NULL AND tl.is_active
         AND lower(tl.label) = v_channel
         AND ((p_venue_id IS NOT NULL AND tl.owner_kind = 'venue' AND tl.venue_id = p_venue_id)
           OR (p_venue_id IS NULL AND tl.owner_kind = 'organizer' AND tl.organizer_user_id = p_organizer_user_id))
       ORDER BY tl.created_at ASC
       LIMIT 1;
    END IF;
    IF v_code IS NULL AND (NOT v_scoped OR v_host) THEN
      -- Hôte (ou portée plateforme) : comportement historique.
      SELECT tl.code INTO v_code FROM public.tracked_links tl
       WHERE tl.target_kind = 'event'
         AND tl.event_id = v_event
         AND tl.promoter_id IS NULL
         AND tl.dj_id IS NULL
         AND tl.is_active
         AND lower(tl.label) = v_channel
       ORDER BY tl.created_at ASC
       LIMIT 1;
    END IF;

    RETURN QUERY
    SELECT
      v_event,
      v_code,
      -- La part guest list publique appartient à qui la tient : un partenaire
      -- ne réécrit pas son canal. Sans lien suivi, le bouton garde l'URL nue.
      CASE WHEN v_scoped AND NOT v_host THEN NULL ELSE (
        SELECT tl.code FROM public.tracked_links tl
         WHERE tl.target_kind = 'guestlist'
           AND v_gl IS NOT NULL
           AND tl.guest_list_id = v_gl
           AND tl.is_active
           AND lower(tl.label) = v_channel
         ORDER BY tl.created_at ASC
         LIMIT 1) END;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.resolve_campaign_tracked_links(uuid[], text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_campaign_tracked_links(uuid[], text, text, uuid) TO service_role;

-- ─── 6. Porte : la portée d'une campagne est-elle une partie PRINCIPALE ? ────

CREATE OR REPLACE FUNCTION public.campaign_scope_is_event_principal(
  p_venue_id text, p_organizer_user_id uuid, p_event_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id = p_event_id
       AND ((p_venue_id IS NOT NULL AND (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id))
         OR (p_organizer_user_id IS NOT NULL
             AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id)))
  );
$$;
REVOKE ALL ON FUNCTION public.campaign_scope_is_event_principal(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campaign_scope_is_event_principal(text, uuid, uuid) TO authenticated, service_role;

-- ─── 7. Audience informative « acheteurs de la soirée » : parties principales ─
-- (reprise de la définition EN LIGNE du 29/09, seule la porte est ajoutée)

CREATE OR REPLACE FUNCTION public.resolve_campaign_audience(p_campaign_id uuid)
 RETURNS TABLE(email text, first_name text, last_name text, user_id uuid, unsubscribe_token uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign RECORD;
  v_is_authorized boolean := false;
  v_audiences jsonb := '[]'::jsonb;
  v_excl_recent_days integer := NULL;
  v_excl_buyers boolean := false;
  -- Mode de combinaison des audiences cochées : 'any' (réunir, défaut) ou
  -- 'all' (croiser : le contact doit être dans CHAQUE audience cochée).
  v_match_all boolean := false;
  v_aud_n integer := 0;
BEGIN
  SELECT * INTO v_campaign FROM public.email_campaigns WHERE id = p_campaign_id;
  IF v_campaign IS NULL THEN RETURN; END IF;

  IF v_campaign.venue_id IS NOT NULL THEN
    v_is_authorized := public.is_venue_owner(auth.uid(), v_campaign.venue_id) OR public.is_super_admin();
  ELSIF v_campaign.organizer_user_id IS NOT NULL THEN
    v_is_authorized := (v_campaign.organizer_user_id = auth.uid()) OR public.is_super_admin();
  ELSE
    -- Portée plateforme : super admin uniquement.
    v_is_authorized := public.is_super_admin();
  END IF;
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    v_is_authorized := true;
  END IF;
  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- ── Portée plateforme ────────────────────────────────────────────────────
  -- Yuno écrit à SA base, jamais à celle d'un club. Une seule source : le
  -- registre plateforme (`newsletter_subscriptions` avec les deux colonnes de
  -- portée à NULL), alimenté par `sync_platform_marketing_contacts` et par les
  -- imports attestés. C'est lui qui porte le jeton de désinscription : aucune
  -- adresse ne peut entrer dans une campagne sans porte de sortie.
  IF v_campaign.venue_id IS NULL AND v_campaign.organizer_user_id IS NULL THEN
    v_audiences := COALESCE(v_campaign.audiences_json, '[]'::jsonb);
    v_aud_n := CASE WHEN jsonb_typeof(v_audiences) = 'array' THEN jsonb_array_length(v_audiences) ELSE 0 END;
    v_match_all := COALESCE(v_campaign.exclusions_json->>'audienceMatch', 'any') = 'all';
    IF jsonb_typeof(v_audiences) <> 'array' OR jsonb_array_length(v_audiences) = 0 THEN
      RETURN;                       -- audience vide ⇒ personne, jamais « tout le monde »
    END IF;

    v_excl_recent_days := CASE
      WHEN COALESCE(v_campaign.exclusions_json->>'recentDays', '') ~ '^[0-9]{1,3}$'
      THEN (v_campaign.exclusions_json->>'recentDays')::integer
      ELSE NULL
    END;
    v_excl_buyers := COALESCE(v_campaign.exclusions_json->>'excludeEventBuyers', 'false') IN ('true', 't', '1')
                     AND v_campaign.event_id IS NOT NULL;

    RETURN QUERY
    WITH cseg AS (
      SELECT DISTINCT LOWER(r.email) AS addr, cs.id AS sid
        FROM jsonb_array_elements(v_audiences) a
        JOIN public.contact_segments cs
          ON a->>'kind' = 'contact_segment'
         AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND cs.id = (a->>'segmentId')::uuid
         AND cs.venue_id IS NULL AND cs.organizer_user_id IS NULL
        CROSS JOIN LATERAL public.resolve_contact_segment_def(NULL, NULL, cs.definition) r
       WHERE r.email IS NOT NULL
    ), cseg_hits AS (
      SELECT addr, count(DISTINCT sid) AS n FROM cseg GROUP BY addr
    ), subs AS (
      SELECT LOWER(ns.email) AS addr,
             COALESCE(ch.n, 0)::integer AS seg_hits, 0::integer AS vseg_hits,
             COALESCE(p.first_name, ns.first_name) AS fname,
             COALESCE(p.last_name,  ns.last_name)  AS lname,
             ns.user_id AS uid, ns.unsubscribe_token AS tok,
             ns.import_id AS imp,
             COALESCE(ns.source, '') AS src,
             EXISTS (SELECT 1 FROM public.tickets t
                      WHERE LOWER(t.user_email) = LOWER(ns.email) AND t.status = 'paid') AS bought
        FROM public.newsletter_subscriptions ns
        LEFT JOIN cseg_hits ch ON ch.addr = LOWER(ns.email)
        LEFT JOIN public.profiles p ON p.id = ns.user_id
       WHERE ns.venue_id IS NULL AND ns.organizer_user_id IS NULL AND ns.opted_in = true
    ), matched AS (
      SELECT DISTINCT ON (s.addr) s.*
        FROM subs s
       WHERE (
         SELECT count(*) FROM jsonb_array_elements(v_audiences) a
          WHERE a->>'kind' NOT IN ('contact_segment','segment') AND CASE a->>'kind'
            WHEN 'all_subscribers' THEN true
            WHEN 'clients'    THEN s.src = 'platform:clients'
            WHEN 'pros'       THEN s.src = 'platform:pros'
            WHEN 'waitlist'   THEN s.src = 'platform:waitlist'
            WHEN 'leads'      THEN s.src = 'platform:leads'
            WHEN 'app_users'  THEN s.uid IS NOT NULL
            WHEN 'no_account' THEN s.uid IS NULL
            WHEN 'buyers'     THEN s.bought
            WHEN 'contact_segment' THEN false  -- compté via seg_hits
            WHEN 'import'     THEN s.imp IS NOT NULL
                                   AND s.imp::text = lower(COALESCE(a->>'importId',''))
            ELSE false
          END) + s.seg_hits + s.vseg_hits >= CASE WHEN v_match_all THEN v_aud_n ELSE 1 END
    )
    SELECT m.addr::text, m.fname::text, m.lname::text, m.uid, m.tok
      FROM matched m
     WHERE (v_excl_recent_days IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.email_campaign_recipients r
               JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
              WHERE c2.venue_id IS NULL AND c2.organizer_user_id IS NULL
                AND c2.id <> p_campaign_id
                AND r.status = 'sent'
                AND r.sent_at > now() - make_interval(days => v_excl_recent_days)
                AND LOWER(r.email) = m.addr))
       AND (NOT v_excl_buyers OR NOT EXISTS (
             SELECT 1 FROM public.tickets t
              WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                AND LOWER(t.user_email) = m.addr));
    RETURN;
  END IF;

  IF v_campaign.type = 'informational' AND v_campaign.event_id IS NOT NULL THEN
    -- Les acheteurs d'une soirée ne sont joignables en informatif QUE par ses
    -- parties PRINCIPALES : un co-hôte n'a que les contacts qui l'ont nommé
    -- (case du checkout), jamais toute la liste des acheteurs.
    IF NOT public.campaign_scope_is_event_principal(v_campaign.venue_id, v_campaign.organizer_user_id, v_campaign.event_id) THEN
      RETURN;
    END IF;
    IF v_campaign.audience_type IN ('event_buyers','event_all_buyers') THEN
      RETURN QUERY
      SELECT DISTINCT ON (LOWER(t.user_email))
        LOWER(t.user_email)::text,
        SPLIT_PART(COALESCE(t.full_name,''), ' ', 1)::text,
        NULLIF(REGEXP_REPLACE(COALESCE(t.full_name,''), '^\S+\s*', ''), '')::text,
        t.user_id,
        NULL::uuid
      FROM public.tickets t
      WHERE t.event_id = v_campaign.event_id AND t.status = 'paid' AND t.user_email IS NOT NULL;
    END IF;
    IF v_campaign.audience_type IN ('event_table_buyers','event_all_buyers') THEN
      RETURN QUERY
      SELECT DISTINCT ON (LOWER(tr.user_email))
        LOWER(tr.user_email)::text,
        SPLIT_PART(COALESCE(tr.full_name,''), ' ', 1)::text,
        NULLIF(REGEXP_REPLACE(COALESCE(tr.full_name,''), '^\S+\s*', ''), '')::text,
        tr.user_id,
        NULL::uuid
      FROM public.table_reservations tr
      WHERE tr.event_id = v_campaign.event_id AND tr.status = 'confirmed' AND tr.user_email IS NOT NULL;
    END IF;
    RETURN;
  END IF;

  IF v_campaign.type <> 'promotional' THEN RETURN; END IF;

  IF jsonb_typeof(COALESCE(v_campaign.audiences_json, '[]'::jsonb)) = 'array'
     AND jsonb_array_length(COALESCE(v_campaign.audiences_json, '[]'::jsonb)) > 0 THEN

    v_audiences := v_campaign.audiences_json;
    v_aud_n := CASE WHEN jsonb_typeof(v_audiences) = 'array' THEN jsonb_array_length(v_audiences) ELSE 0 END;
    v_match_all := COALESCE(v_campaign.exclusions_json->>'audienceMatch', 'any') = 'all';
    v_excl_recent_days := CASE
      WHEN COALESCE(v_campaign.exclusions_json->>'recentDays', '') ~ '^[0-9]{1,3}$'
      THEN (v_campaign.exclusions_json->>'recentDays')::integer
      ELSE NULL
    END;
    v_excl_buyers := COALESCE(v_campaign.exclusions_json->>'excludeEventBuyers', 'false') IN ('true', 't', '1')
                     AND v_campaign.event_id IS NOT NULL;

    IF v_campaign.venue_id IS NOT NULL THEN
      RETURN QUERY
      WITH seg_emails AS (
        SELECT DISTINCT LOWER(seg.email) AS addr, vs.id AS sid
          FROM jsonb_array_elements(v_audiences) a
          JOIN public.venue_segments vs
            ON a->>'kind' = 'segment'
           AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           AND vs.id = (a->>'segmentId')::uuid
           AND vs.venue_id = v_campaign.venue_id
          CROSS JOIN LATERAL public.resolve_venue_segment(v_campaign.venue_id, vs.definition) seg
      ), cseg AS (
        -- Segments sur la base importée : la définition est résolue à l'envoi.
        SELECT DISTINCT LOWER(r.email) AS addr, cs.id AS sid
          FROM jsonb_array_elements(v_audiences) a
          JOIN public.contact_segments cs
            ON a->>'kind' = 'contact_segment'
           AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           AND cs.id = (a->>'segmentId')::uuid
           AND cs.venue_id = v_campaign.venue_id
          CROSS JOIN LATERAL public.resolve_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition) r
         WHERE r.email IS NOT NULL
      ), cseg_hits AS (
        SELECT addr, count(DISTINCT sid) AS n FROM cseg GROUP BY addr
      ), vseg_hits AS (
        SELECT addr, count(DISTINCT sid) AS n FROM seg_emails GROUP BY addr
      ), subs AS (
        SELECT LOWER(ns.email) AS addr,
               COALESCE(ch.n, 0)::integer AS seg_hits, COALESCE(vh.n, 0)::integer AS vseg_hits,
               COALESCE(p.first_name, vc.first_name, ns.first_name) AS fname,
               COALESCE(p.last_name,  vc.last_name, ns.last_name)  AS lname,
               ns.user_id AS uid, ns.unsubscribe_token AS tok,
               ns.import_id AS imp,
               COALESCE(vc.total_spent, 0) AS spent,
               (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) AS visits,
               vc.last_visit_at AS last_visit
          FROM public.newsletter_subscriptions ns
          LEFT JOIN public.venue_customers vc
            ON vc.venue_id = v_campaign.venue_id AND LOWER(vc.email) = LOWER(ns.email)
          LEFT JOIN cseg_hits ch ON ch.addr = LOWER(ns.email)
          LEFT JOIN vseg_hits vh ON vh.addr = LOWER(ns.email)
          LEFT JOIN public.profiles p ON p.id = ns.user_id
         WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true
      ), matched AS (
        SELECT DISTINCT ON (s.addr) s.*
          FROM subs s
         WHERE (
           SELECT count(*) FROM jsonb_array_elements(v_audiences) a
            WHERE a->>'kind' NOT IN ('contact_segment','segment') AND CASE a->>'kind'
              WHEN 'all_subscribers' THEN true
              WHEN 'vip'           THEN s.spent >= 500
              WHEN 'big_spenders'  THEN s.spent >= 1000
              WHEN 'regulars'      THEN s.visits BETWEEN 2 AND 4
              WHEN 'new_customers' THEN s.visits <= 1
              WHEN 'dormant'       THEN s.last_visit IS NOT NULL AND s.last_visit < now() - interval '90 days'
              WHEN 'event_subscribers' THEN v_campaign.event_id IS NOT NULL AND EXISTS (
                     SELECT 1 FROM public.tickets t
                      WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                        AND LOWER(t.user_email) = s.addr)
              WHEN 'segment' THEN false  -- compté via vseg_hits
              WHEN 'contact_segment' THEN false  -- compté via seg_hits
              WHEN 'import'  THEN s.imp IS NOT NULL
                                  AND s.imp::text = lower(COALESCE(a->>'importId',''))
              ELSE false
            END) + s.seg_hits + s.vseg_hits >= CASE WHEN v_match_all THEN v_aud_n ELSE 1 END
      )
      SELECT m.addr::text, m.fname::text, m.lname::text, m.uid, m.tok
        FROM matched m
       WHERE (v_excl_recent_days IS NULL OR NOT EXISTS (
               SELECT 1 FROM public.email_campaign_recipients r
                 JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
                WHERE c2.venue_id = v_campaign.venue_id
                  AND c2.id <> p_campaign_id
                  AND r.status = 'sent'
                  AND r.sent_at > now() - make_interval(days => v_excl_recent_days)
                  AND LOWER(r.email) = m.addr))
         AND (NOT v_excl_buyers OR (
               NOT EXISTS (SELECT 1 FROM public.tickets t
                            WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                              AND LOWER(t.user_email) = m.addr)
               AND NOT EXISTS (SELECT 1 FROM public.table_reservations tr
                            WHERE tr.event_id = v_campaign.event_id AND tr.status IN ('paid','confirmed')
                              AND LOWER(tr.user_email) = m.addr)));
      RETURN;
    END IF;

    RETURN QUERY
    WITH agg AS (
      -- Un client est quelqu'un qui est VENU : billets, tables ET guest list
      -- (contact_scope_customers, la même source que la base de contacts).
      -- Avant, seuls les billets comptaient : un organisateur qui ne vend que
      -- des tables n'avait ni VIP, ni habitué, ni dormant.
      SELECT c.email AS addr,
             COALESCE(c.spent, 0)::numeric AS spent,
             COALESCE(c.event_count, 0) AS visits,
             c.last_at AS last_seen,
             c.first_name AS fname0,
             c.last_name AS lname0
        FROM public.contact_scope_customers(NULL, v_campaign.organizer_user_id) c
    ), cseg AS (
      SELECT DISTINCT LOWER(r.email) AS addr, cs.id AS sid
        FROM jsonb_array_elements(v_audiences) a
        JOIN public.contact_segments cs
          ON a->>'kind' = 'contact_segment'
         AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND cs.id = (a->>'segmentId')::uuid
         AND cs.organizer_user_id = v_campaign.organizer_user_id
        CROSS JOIN LATERAL public.resolve_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition) r
       WHERE r.email IS NOT NULL
    ), cseg_hits AS (
      SELECT addr, count(DISTINCT sid) AS n FROM cseg GROUP BY addr
    ), subs AS (
      SELECT LOWER(ns.email) AS addr,
             COALESCE(ch.n, 0)::integer AS seg_hits, 0::integer AS vseg_hits,
             COALESCE(p.first_name, ns.first_name, a.fname0) AS fname,
             COALESCE(p.last_name, ns.last_name, a.lname0) AS lname,
             ns.user_id AS uid, ns.unsubscribe_token AS tok,
             ns.import_id AS imp,
             COALESCE(a.spent, 0) AS spent,
             COALESCE(a.visits, 0) AS visits,
             a.last_seen AS last_visit
        FROM public.newsletter_subscriptions ns
        LEFT JOIN agg a ON a.addr = LOWER(ns.email)
        LEFT JOIN cseg_hits ch ON ch.addr = LOWER(ns.email)
        LEFT JOIN public.profiles p ON p.id = ns.user_id
       WHERE ns.organizer_user_id = v_campaign.organizer_user_id AND ns.opted_in = true
    ), matched AS (
      SELECT DISTINCT ON (s.addr) s.*
        FROM subs s
       WHERE (
         SELECT count(*) FROM jsonb_array_elements(v_audiences) a2
          WHERE a2->>'kind' NOT IN ('contact_segment','segment') AND CASE a2->>'kind'
            WHEN 'all_subscribers' THEN true
            WHEN 'vip'           THEN s.spent >= 500
            WHEN 'big_spenders'  THEN s.spent >= 1000
            WHEN 'regulars'      THEN s.visits BETWEEN 2 AND 4
            WHEN 'new_customers' THEN s.visits <= 1
            WHEN 'dormant'       THEN s.last_visit IS NOT NULL AND s.last_visit < now() - interval '90 days'
            WHEN 'event_subscribers' THEN v_campaign.event_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM public.tickets t
                    WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                      AND LOWER(t.user_email) = s.addr)
            WHEN 'contact_segment' THEN false  -- compté via seg_hits
            WHEN 'import'  THEN s.imp IS NOT NULL
                                AND s.imp::text = lower(COALESCE(a2->>'importId',''))
            ELSE false
          END) + s.seg_hits + s.vseg_hits >= CASE WHEN v_match_all THEN v_aud_n ELSE 1 END
    )
    SELECT m.addr::text, m.fname::text, m.lname::text, m.uid, m.tok
      FROM matched m
     WHERE (v_excl_recent_days IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.email_campaign_recipients r
               JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
              WHERE c2.organizer_user_id = v_campaign.organizer_user_id
                AND c2.id <> p_campaign_id
                AND r.status = 'sent'
                AND r.sent_at > now() - make_interval(days => v_excl_recent_days)
                AND LOWER(r.email) = m.addr))
       AND (NOT v_excl_buyers OR (
             NOT EXISTS (SELECT 1 FROM public.tickets t
                          WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                            AND LOWER(t.user_email) = m.addr)
             AND NOT EXISTS (SELECT 1 FROM public.table_reservations tr
                          WHERE tr.event_id = v_campaign.event_id AND tr.status IN ('paid','confirmed')
                            AND LOWER(tr.user_email) = m.addr)));
    RETURN;
  END IF;

  IF v_campaign.audience_type = 'all_subscribers' THEN
    RETURN QUERY
    SELECT LOWER(ns.email)::text, p.first_name::text, p.last_name::text, ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    LEFT JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.opted_in = true
      AND ((v_campaign.venue_id IS NOT NULL AND ns.venue_id = v_campaign.venue_id)
           OR (v_campaign.organizer_user_id IS NOT NULL AND ns.organizer_user_id = v_campaign.organizer_user_id));
    RETURN;
  END IF;

  IF v_campaign.audience_type = 'event_subscribers' AND v_campaign.event_id IS NOT NULL THEN
    RETURN QUERY
    SELECT DISTINCT ON (LOWER(ns.email))
      LOWER(ns.email)::text, p.first_name::text, p.last_name::text, ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    JOIN public.tickets t ON LOWER(t.user_email) = LOWER(ns.email)
    LEFT JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.opted_in = true
      AND t.event_id = v_campaign.event_id AND t.status = 'paid'
      AND ((v_campaign.venue_id IS NOT NULL AND ns.venue_id = v_campaign.venue_id)
           OR (v_campaign.organizer_user_id IS NOT NULL AND ns.organizer_user_id = v_campaign.organizer_user_id));
    RETURN;
  END IF;

  IF v_campaign.audience_type = 'custom_segment' THEN
    IF v_campaign.venue_id IS NULL OR v_campaign.segment_id IS NULL THEN RETURN; END IF;
    RETURN QUERY
    SELECT DISTINCT ON (LOWER(ns.email))
      LOWER(ns.email)::text,
      COALESCE(p.first_name, vc.first_name)::text,
      COALESCE(p.last_name, vc.last_name)::text,
      ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    JOIN public.resolve_venue_segment(
           v_campaign.venue_id,
           (SELECT vs.definition FROM public.venue_segments vs
             WHERE vs.id = v_campaign.segment_id AND vs.venue_id = v_campaign.venue_id)
         ) seg ON LOWER(seg.email) = LOWER(ns.email)
    LEFT JOIN public.venue_customers vc
      ON vc.venue_id = v_campaign.venue_id AND LOWER(vc.email) = LOWER(ns.email)
    LEFT JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true;
    RETURN;
  END IF;

  IF v_campaign.audience_type IN ('vip','regulars','new_customers','big_spenders','dormant') THEN
    IF v_campaign.venue_id IS NOT NULL THEN
      RETURN QUERY
      SELECT LOWER(ns.email)::text,
             COALESCE(p.first_name, vc.first_name)::text,
             COALESCE(p.last_name, vc.last_name)::text,
             ns.user_id, ns.unsubscribe_token
      FROM public.newsletter_subscriptions ns
      JOIN public.venue_customers vc ON LOWER(vc.email) = LOWER(ns.email) AND vc.venue_id = v_campaign.venue_id
      LEFT JOIN public.profiles p ON p.id = ns.user_id
      WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true
        AND CASE v_campaign.audience_type
          WHEN 'vip' THEN vc.total_spent >= 500
          WHEN 'regulars' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) BETWEEN 2 AND 4
          WHEN 'new_customers' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) <= 1
          WHEN 'big_spenders' THEN vc.total_spent >= 1000
          WHEN 'dormant' THEN vc.last_visit_at < now() - interval '90 days'
          ELSE FALSE
        END;
      RETURN;
    END IF;

    RETURN QUERY
    WITH agg AS (
      SELECT c.email,
             COALESCE(c.spent, 0)::numeric AS spent,
             COALESCE(c.event_count, 0) AS visits,
             c.last_at AS last_seen,
             c.first_name, c.last_name
        FROM public.contact_scope_customers(NULL, v_campaign.organizer_user_id) c
    )
    SELECT a.email::text,
           a.first_name::text,
           a.last_name::text,
           ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    JOIN agg a ON a.email = LOWER(ns.email)
    WHERE ns.organizer_user_id = v_campaign.organizer_user_id AND ns.opted_in = true
      AND CASE v_campaign.audience_type
        WHEN 'vip' THEN a.spent >= 500
        WHEN 'regulars' THEN a.visits BETWEEN 2 AND 4
        WHEN 'new_customers' THEN a.visits = 1
        WHEN 'big_spenders' THEN a.spent >= 1000
        WHEN 'dormant' THEN a.last_seen < now() - interval '90 days'
        ELSE FALSE
      END;
    RETURN;
  END IF;
END;
$function$;

-- ─── 8. Le choix fait à la création, gardé sur la soirée ─────────────────────
--
-- « Encadré par Yuno » (contrat collab, accord de co-organisation) ou « Réglé
-- entre vous » (Yuno ne suit pas l'argent). Pour un collab club × orga la
-- vérité d'argent reste `revenue_split_rules` / le contrat ; cette colonne dit
-- ce que le lead a CHOISI, pour que la page de la soirée rappelle la suite
-- (fixer les parts dès que les partenaires ont accepté) ou se taise.
-- Un co-hôte ne l'écrit jamais : elle n'est pas dans la liste blanche de
-- `protect_event_columns_from_cohost`.

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS money_agreement text;
DO $$ BEGIN
  ALTER TABLE public.events ADD CONSTRAINT events_money_agreement_check
    CHECK (money_agreement IS NULL OR money_agreement IN ('yuno', 'external'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN public.events.money_agreement IS
  'Accord financier choisi par le lead : yuno (contrat / accord Yuno) ou external (réglé entre les parties). NULL = pas de choix (soirée solo ou héritage).';
