-- Audit de préparation Yuno CRM (18/10) — DATA-01, DATA-07, SYNC-03.
-- Rapport : docs/audit/2026-10-18-crm-readiness/REPORT.md.
--
-- ORDRE DE MISE EN LIGNE : cette migration AVANT la fonction
-- affiliate-ticket-sync (le connecteur écrit la colonne
-- buyer_email_unreadable ; sans elle, toute lecture Shotgun échoue).
--
-- 1. DATA-01 (décision de Paul du 18/10 : marque PAR BILLET). L'effacement
--    pour durée de conservation (_crm_erase_contacts, balayage quotidien)
--    rendait le billet anonyme, mais si Shotgun le renvoyait (billet mis à
--    jour chez lui), le connecteur réécrivait identité et accord jusqu'au
--    balayage suivant. Le billet effacé est désormais marqué (`erased_at`) et
--    reste anonyme quoi que la billetterie renvoie
--    (trg_external_tickets_zz_keep_erased, après la dérivation des colonnes
--    typées, qui rétablirait l'identifiant de contact). Un NOUVEL achat de la
--    même personne est un autre billet : il entre normalement, avec l'accord
--    donné à ce moment-là (pas de repoussoir, choix de Paul).
--
-- 2. DATA-07. Une adresse que Shotgun rend MAL FORMÉE devenait NULL au
--    connecteur, ce que le trigger d'effacement venu de la billetterie lisait
--    comme un droit à l'oubli exercé chez Shotgun : identité effacée, accord
--    retiré, adresse au repoussoir « erased ». Le connecteur dit maintenant
--    qu'il a lu une adresse illisible (`buyer_email_unreadable`) ; le trigger
--    garde alors l'adresse précédente et ne retire rien. Un champ ABSENT ou
--    vide reste un effacement (règle S5 inchangée).
--
-- 3. SYNC-03. Une version PLUS ANCIENNE d'un billet (source_updated_at, la
--    date de mise à jour Shotgun) n'écrase plus la plus récente : la ligne est
--    ignorée (trg_external_tickets_0_skip_stale, premier des triggers). Cela
--    ne pouvait arriver que si deux passes tournaient à la fois ; le connecteur
--    ne libère plus non plus le verrou d'une passe vivante à la reconnexion.

ALTER TABLE public.external_tickets
  ADD COLUMN IF NOT EXISTS erased_at timestamptz,
  ADD COLUMN IF NOT EXISTS buyer_email_unreadable boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.external_tickets.erased_at IS
  'Identité effacée par Yuno (durée de conservation) : le billet reste anonyme même si la billetterie le renvoie.';
COMMENT ON COLUMN public.external_tickets.buyer_email_unreadable IS
  'La billetterie a rendu une adresse mal formée : ce n''est pas un effacement, l''adresse précédente est gardée.';

-- ── DATA-01 : l'effacement marque le billet ────────────────────────────────
CREATE OR REPLACE FUNCTION public._crm_erase_contacts(p_venue_id text, p_organizer_user_id uuid, p_emails text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emails text[];
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'scope_required' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT lower(btrim(e))), '{}') INTO v_emails
    FROM unnest(p_emails) e WHERE e IS NOT NULL AND btrim(e) <> '';
  IF cardinality(v_emails) = 0 THEN RETURN 0; END IF;

  DELETE FROM public.crm_contact_notes WHERE scope_key = v_key AND lower(email) = ANY (v_emails);

  -- Analyse client (20261010110000) : profil et file de recalcul. L'exclusion
  -- du profilage (crm_profile_optouts), mémoire d'un refus, reste.
  DELETE FROM public.crm_person_profile WHERE scope_key = v_key AND email = ANY (v_emails);
  DELETE FROM public.crm_analysis_dirty WHERE scope_key = v_key AND email = ANY (v_emails);
  -- « Chances de venir » (20261012100000, 20261013110000) : ses chances et
  -- leur journal partent avec lui.
  DELETE FROM public.crm_person_night_score WHERE scope_key = v_key AND email = ANY (v_emails);
  DELETE FROM public.crm_prediction_people WHERE scope_key = v_key AND email = ANY (v_emails);

  DELETE FROM public.crm_import_journal j
   USING public.crm_imports i
   WHERE i.list_import_id = j.list_import_id AND i.scope_key = v_key AND lower(j.email) = ANY (v_emails);

  DELETE FROM public.imported_contacts c
   WHERE ((p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id))
     AND lower(c.email) = ANY (v_emails);

  -- Un désabonnement reste : c'est la mémoire du refus.
  DELETE FROM public.newsletter_subscriptions ns
   WHERE ((p_venue_id IS NOT NULL AND ns.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND ns.organizer_user_id = p_organizer_user_id))
     AND lower(ns.email) = ANY (v_emails)
     AND ns.opted_in;

  DELETE FROM public.venue_sms_contacts vc
   WHERE ((p_venue_id IS NOT NULL AND vc.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND vc.organizer_user_id = p_organizer_user_id))
     AND lower(vc.email) = ANY (v_emails)
     AND NOT vc.unsubscribed;

  -- Les ventes de la billetterie connectée gardent leur montant, sans identité.
  -- Le billet est MARQUÉ (erased_at, audit 18/10, DATA-01) : si la billetterie
  -- le renvoie, il reste anonyme (trg_external_tickets_zz_keep_erased) ; un
  -- nouvel achat de la même personne est un autre billet.
  UPDATE public.external_tickets t
     SET buyer_email = NULL, buyer_first_name = NULL, buyer_last_name = NULL, buyer_phone = NULL,
         buyer_ref = NULL, holder_email = NULL, holder_first_name = NULL, holder_last_name = NULL, provider_contact_id = NULL, provider_user_id = NULL,
         newsletter_optin = NULL, raw = '{}'::jsonb, erased_at = COALESCE(t.erased_at, now())
   WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
     AND lower(t.buyer_email) = ANY (v_emails);

  DELETE FROM public.contact_engagement ce
   WHERE ((p_venue_id IS NOT NULL AND ce.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND ce.organizer_user_id = p_organizer_user_id))
     AND lower(ce.email) = ANY (v_emails);

  -- Scénarios (20261016130000) : les inscriptions passées restent comptées
  -- (chiffres du scénario, témoin), sous une adresse qui ne désigne plus
  -- personne ; une inscription en route sort (« contact effacé ») ; ses
  -- entrées en attente et la base d'un déclencheur « segment » partent.
  UPDATE public.crm_scenario_runs r
     SET email = 'erased-' || md5(r.email) || '@erased.invalid',
         status = CASE WHEN r.status = 'active' THEN 'exited' ELSE r.status END,
         exit_reason = CASE WHEN r.status = 'active' THEN 'erased' ELSE r.exit_reason END,
         updated_at = now()
   WHERE r.scope_key = v_key AND r.email = ANY (v_emails);
  DELETE FROM public.crm_scenario_pending pd USING public.crm_scenarios s
   WHERE s.id = pd.scenario_id AND s.scope_key = v_key AND pd.email = ANY (v_emails);
  DELETE FROM public.crm_scenario_seen sn USING public.crm_scenarios s
   WHERE s.id = sn.scenario_id AND s.scope_key = v_key AND sn.email = ANY (v_emails);

  -- L'adresse portée par un destinataire SMS (20261013120000) part aussi.
  UPDATE public.sms_campaign_recipients r
     SET email = NULL
    FROM public.sms_campaigns c
   WHERE c.id = r.campaign_id
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND c.organizer_id IS NOT DISTINCT FROM CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END
     AND lower(r.email) = ANY (v_emails);

  -- Les envois passés restent comptés, sous une adresse qui ne désigne plus personne.
  UPDATE public.email_campaign_recipients r
     SET email = 'erased-' || md5(lower(r.email)) || '@erased.invalid',
         first_name = NULL, last_name = NULL, user_id = NULL
    FROM public.email_campaigns c
   WHERE c.id = r.campaign_id
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND r.status NOT IN ('pending', 'sending')
     AND lower(r.email) = ANY (v_emails);

  UPDATE public.email_campaign_events ev
     SET recipient_email = 'erased-' || md5(lower(ev.recipient_email)) || '@erased.invalid',
         metadata = ((COALESCE(ev.metadata, '{}'::jsonb) - 'to' - 'headers')
                     #- '{open,ipAddress}' #- '{open,userAgent}'
                     #- '{click,ipAddress}' #- '{click,userAgent}')
    FROM public.email_campaigns c
   WHERE c.id = ev.campaign_id
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND lower(ev.recipient_email) = ANY (v_emails);

  DELETE FROM public.contact_base_cache cb
   WHERE cb.scope_key = public.contact_base_scope_key(p_venue_id, p_organizer_user_id)
     AND lower(cb.email) = ANY (v_emails);
  UPDATE public.contact_base_cache_state
     SET dirty_at = now()
   WHERE scope_key = public.contact_base_scope_key(p_venue_id, p_organizer_user_id);

  RETURN cardinality(v_emails);
END;
$function$;

-- ── DATA-07 : une adresse illisible n'est pas un effacement ────────────────
CREATE OR REPLACE FUNCTION public.external_tickets_note_provider_erasure()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Une adresse que la billetterie rend MAL FORMÉE (le connecteur la lit
  -- illisible et le dit) n'est pas un effacement (audit 18/10, DATA-07) : on
  -- garde l'adresse précédente, rien n'est retiré.
  IF NEW.buyer_email_unreadable THEN
    NEW.buyer_email := OLD.buyer_email;
    RETURN NEW;
  END IF;
  -- Seule une écriture du connecteur fait avancer synced_at.
  IF NEW.synced_at IS DISTINCT FROM OLD.synced_at THEN
    NEW.buyer_first_name := NULL;
    NEW.buyer_last_name := NULL;
    NEW.buyer_phone := NULL;
    NEW.buyer_ref := NULL;
    NEW.holder_email := NULL;
    NEW.holder_first_name := NULL;
    NEW.holder_last_name := NULL;
    NEW.provider_contact_id := NULL;
    NEW.provider_user_id := NULL;
    INSERT INTO public.ticketing_erasures (connection_id, email) VALUES (OLD.connection_id, lower(OLD.buyer_email));
  END IF;
  RETURN NEW;
END;
$function$;

-- ── DATA-01 : un billet effacé reste anonyme ────────────────────────────────
CREATE OR REPLACE FUNCTION public.external_tickets_keep_erased()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.buyer_email := NULL;
  NEW.buyer_first_name := NULL;
  NEW.buyer_last_name := NULL;
  NEW.buyer_phone := NULL;
  NEW.buyer_ref := NULL;
  NEW.holder_email := NULL;
  NEW.holder_first_name := NULL;
  NEW.holder_last_name := NULL;
  NEW.provider_contact_id := NULL;
  NEW.provider_user_id := NULL;
  NEW.newsletter_optin := NULL;
  NEW.erased_at := OLD.erased_at;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.external_tickets_keep_erased() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_external_tickets_zz_keep_erased ON public.external_tickets;
CREATE TRIGGER trg_external_tickets_zz_keep_erased
  BEFORE UPDATE ON public.external_tickets
  FOR EACH ROW WHEN (OLD.erased_at IS NOT NULL)
  EXECUTE FUNCTION public.external_tickets_keep_erased();

-- ── SYNC-03 : jamais une version plus ancienne par-dessus la plus récente ───
CREATE OR REPLACE FUNCTION public.external_tickets_skip_stale()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN NULL;   -- la ligne n'est pas réécrite ; les triggers suivants ne tournent pas
END;
$function$;
REVOKE ALL ON FUNCTION public.external_tickets_skip_stale() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_external_tickets_0_skip_stale ON public.external_tickets;
CREATE TRIGGER trg_external_tickets_0_skip_stale
  BEFORE UPDATE ON public.external_tickets
  FOR EACH ROW WHEN (NEW.source_updated_at < OLD.source_updated_at)
  EXECUTE FUNCTION public.external_tickets_skip_stale();
