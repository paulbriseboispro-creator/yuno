-- Effacement venu de la billetterie : un contact anonymisé chez Shotgun sort
-- aussi de chez Yuno, et n'y revient jamais par un import.
--
-- Plan CRM_AMORIS_SHOTGUN_AUDIT_PLAN.md §5.4, session S5. Constaté sur la prod
-- le 18/10 (faux billet sur la connexion démo, transaction annulée) : quand la
-- billetterie rend un billet dont le contact a disparu (e-mail vide alors qu'il
-- ne l'était pas — c'est ainsi que se lit un droit à l'oubli exercé chez elle),
-- `ticketing_after_sync` laissait l'accord newsletter versé par la billetterie
-- ACTIF, le profil d'analyse en place jusqu'au calcul complet de la nuit, et
-- rien n'empêchait un import ou la synchro de réinscrire l'adresse.
--
-- Désormais :
-- 1. Trigger `trg_external_tickets_provider_erasure` (BEFORE UPDATE OF
--    buyer_email, e-mail présent → vide, écriture du CONNECTEUR seulement :
--    `synced_at` avance — un effacement fait dans Yuno par `_crm_erase_contacts`
--    ne passe pas par ici) : le billet perd aussi le reste de l'identité
--    (mêmes colonnes que `_crm_erase_contacts`, plus les identifiants chez la
--    billetterie) et l'ancienne adresse entre dans `ticketing_erasures`.
-- 2. `ticketing_apply_erasures(connexion)`, appelée par `ticketing_after_sync`
--    avant le registre (3c), pour chaque adresse qui n'a plus AUCUN billet
--    nominatif dans la portée :
--      • profil d'analyse, file de recalcul, chances de venir : supprimés ;
--      • accord ACTIF versé par la billetterie (`source connector:%`) : supprimé,
--        retrait tracé dans `marketing_consent_events` ; un accord donné
--        ailleurs (page d'inscription, fichier attesté) reste, c'est un autre
--        consentement ; une ligne désabonnée reste (mémoire du refus) sans nom ;
--      • `email_opt_outs` (raison `erased`, invisible dans la Console) : ni un
--        import, ni la synchro, ni une page d'inscription ne la réinscrivent ;
--      • base de contacts de la portée : la ligne part, la portée est à refaire.
--    Une adresse qui garde d'autres billets nominatifs n'a perdu que ce billet.
-- Jamais bloquant pour la synchro : une erreur laisse la file pour la passe
-- suivante.

ALTER TABLE public.email_opt_outs DROP CONSTRAINT IF EXISTS email_opt_outs_reason_check;
ALTER TABLE public.email_opt_outs ADD CONSTRAINT email_opt_outs_reason_check
  CHECK (reason = ANY (ARRAY['unsubscribed'::text, 'suppressed'::text, 'erased'::text]));

CREATE TABLE IF NOT EXISTS public.ticketing_erasures (
  connection_id uuid NOT NULL REFERENCES public.ticketing_connections(id) ON DELETE CASCADE,
  email text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticketing_erasures_conn_idx ON public.ticketing_erasures (connection_id);
ALTER TABLE public.ticketing_erasures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ticketing_erasures FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.ticketing_erasures IS
  'Adresses qu''un billet a perdues chez la billetterie (contact anonymisé), en attente de ticketing_apply_erasures. Aucune policy : service_role seul.';

CREATE OR REPLACE FUNCTION public.external_tickets_note_provider_erasure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
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

REVOKE ALL ON FUNCTION public.external_tickets_note_provider_erasure() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_external_tickets_provider_erasure ON public.external_tickets;
CREATE TRIGGER trg_external_tickets_provider_erasure
  BEFORE UPDATE OF buyer_email ON public.external_tickets
  FOR EACH ROW
  WHEN (OLD.buyer_email IS NOT NULL AND NEW.buyer_email IS NULL)
  EXECUTE FUNCTION public.external_tickets_note_provider_erasure();

CREATE OR REPLACE FUNCTION public.ticketing_apply_erasures(p_connection_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c public.ticketing_connections%ROWTYPE;
  v_t0 timestamptz := clock_timestamp();
  v_key text;
  v_queued text[];
  v_gone text[];
  v_org uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'ticketing_apply_erasures: service_role only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.ticketing_connections WHERE id = p_connection_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT COALESCE(array_agg(DISTINCT e.email), '{}') INTO v_queued
    FROM public.ticketing_erasures e
   WHERE e.connection_id = p_connection_id AND e.at <= v_t0;
  IF cardinality(v_queued) = 0 THEN RETURN 0; END IF;

  -- Effacée = plus AUCUN billet nominatif à cette adresse dans la portée
  -- (toutes connexions confondues). Les adresses sont rangées en minuscules
  -- par le connecteur (`email()`), d'où l'égalité simple, indexée.
  SELECT COALESCE(array_agg(q.em), '{}') INTO v_gone
    FROM unnest(v_queued) q(em)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.external_tickets t
      WHERE t.buyer_email = q.em
        AND ((c.venue_id IS NOT NULL AND t.venue_id = c.venue_id)
          OR (c.venue_id IS NULL AND t.organizer_user_id = c.organizer_user_id)));

  IF cardinality(v_gone) > 0 THEN
    v_key := public.crm_scope_key(c.venue_id, c.organizer_user_id);
    v_org := CASE WHEN c.venue_id IS NULL THEN c.organizer_user_id END;

    DELETE FROM public.crm_person_profile WHERE scope_key = v_key AND email = ANY (v_gone);
    DELETE FROM public.crm_analysis_dirty WHERE scope_key = v_key AND email = ANY (v_gone);
    DELETE FROM public.crm_person_night_score WHERE scope_key = v_key AND email = ANY (v_gone);
    DELETE FROM public.crm_prediction_people WHERE scope_key = v_key AND email = ANY (v_gone);

    -- L'accord que la billetterie avait donné part avec la personne ; tracé.
    WITH off AS (
      DELETE FROM public.newsletter_subscriptions s
       WHERE ((c.venue_id IS NOT NULL AND s.venue_id = c.venue_id)
           OR (c.venue_id IS NULL AND s.organizer_user_id = c.organizer_user_id))
         AND lower(s.email) = ANY (v_gone)
         AND s.opted_in
         AND COALESCE(s.source, '') LIKE 'connector:%'
      RETURNING s.email, s.user_id
    )
    INSERT INTO public.marketing_consent_events
      (user_id, email, channel, venue_id, organizer_user_id, action, wording_key, wording_text, source)
    SELECT o.user_id, lower(o.email), 'email', c.venue_id, v_org, 'withdrawn', 'connector_contact_erased',
           'Contact effacé chez la billetterie (' || c.provider || ') : accord retiré, adresse écartée de tout import',
           'connector:' || c.provider
      FROM off o;

    -- Une ligne désabonnée reste (mémoire du refus), sans le nom.
    UPDATE public.newsletter_subscriptions s
       SET first_name = NULL, last_name = NULL
     WHERE ((c.venue_id IS NOT NULL AND s.venue_id = c.venue_id)
         OR (c.venue_id IS NULL AND s.organizer_user_id = c.organizer_user_id))
       AND lower(s.email) = ANY (v_gone)
       AND COALESCE(s.source, '') LIKE 'connector:%'
       AND (s.first_name IS NOT NULL OR s.last_name IS NOT NULL);

    -- Repoussoir : jamais réinscrite par un import, la synchro ou une page.
    INSERT INTO public.email_opt_outs (venue_id, organizer_user_id, email, reason, opted_out_at)
    SELECT c.venue_id, v_org, g.em, 'erased', now() FROM unnest(v_gone) g(em)
    ON CONFLICT DO NOTHING;

    DELETE FROM public.contact_base_cache cb
     WHERE cb.scope_key = public.contact_base_scope_key(c.venue_id, c.organizer_user_id)
       AND lower(cb.email) = ANY (v_gone);
    UPDATE public.contact_base_cache_state
       SET dirty_at = clock_timestamp()
     WHERE scope_key = public.contact_base_scope_key(c.venue_id, c.organizer_user_id);
  END IF;

  DELETE FROM public.ticketing_erasures WHERE connection_id = p_connection_id AND at <= v_t0;
  RETURN cardinality(v_gone);
END;
$function$;

REVOKE ALL ON FUNCTION public.ticketing_apply_erasures(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_apply_erasures(uuid) TO service_role;

-- ticketing_after_sync : l'effacement passe AVANT le registre (3c), dans son
-- propre bloc. Réécrit depuis la définition EN BASE (S4, 20261018220000).
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef('public.ticketing_after_sync(uuid)'::regprocedure) INTO v_def;
  IF v_def ~ 'ticketing_apply_erasures' THEN RETURN; END IF;
  v_new := replace(v_def, '  v_new_ext text[] := ''{}'';',
                          '  v_new_ext text[] := ''{}'';' || chr(10) || '  v_erased integer := 0;');
  v_new := replace(v_new, '  -- 3c. Accord newsletter rapporté par la billetterie',
    '  -- 3b'' Contact effacé chez la billetterie (20261019310000) : profil, accord' || chr(10) ||
    '  --     versé par la billetterie et base de contacts suivent ; adresse écartée' || chr(10) ||
    '  --     de tout import. Jamais bloquant : la file reste pour la passe suivante.' || chr(10) ||
    '  BEGIN' || chr(10) ||
    '    v_erased := public.ticketing_apply_erasures(p_connection_id);' || chr(10) ||
    '  EXCEPTION WHEN others THEN' || chr(10) ||
    '    v_erased := -1;' || chr(10) ||
    '  END;' || chr(10) || chr(10) ||
    '  -- 3c. Accord newsletter rapporté par la billetterie');
  v_new := replace(v_new, '''consents_withdrawn'', v_withdrawn, ''analysis'', v_an,',
                          '''consents_withdrawn'', v_withdrawn, ''contacts_erased'', v_erased, ''analysis'', v_an,');
  IF v_new !~ 'v_erased := public.ticketing_apply_erasures' OR v_new !~ '''contacts_erased'', v_erased'
     OR v_new !~ 'v_erased integer := 0' THEN
    RAISE EXCEPTION 'ticketing_after_sync : ancres introuvables, réécriture refusée';
  END IF;
  EXECUTE v_new;
END
$patch$;
