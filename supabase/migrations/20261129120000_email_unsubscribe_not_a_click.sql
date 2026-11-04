-- Une désinscription n'est jamais un clic, et elle est toujours comptée.
--
-- Constat du 04/11 sur WOH × REVIVAL : 4 « clics » dans le rapport, dont 2 sur le lien
-- « se désinscrire » du pied de page. Resend rapporte tout lien cliqué comme
-- `email.clicked` : depuis le 09/09, 190 clics de désinscription (5 campagnes) étaient
-- comptés comme des clics : taux de clic, personnes « engagées », chaleur d'une adresse
-- pour la reprise Gmail, attribution d'une vente au clic, plan de soirée… Une
-- cinquantaine de fonctions lisent `event_type = 'clicked'` ; plutôt que de les
-- corriger une à une, l'événement est rangé à la SOURCE :
--
--   · trigger BEFORE INSERT sur email_campaign_events : un `clicked` dont le lien est
--     une page de désinscription devient `unsubscribe_click`. Aucune lecture ne le
--     voit plus comme un clic ; le lien reste dans metadata.
--   · rattrapage de l'historique, puis recalcul des compteurs des campagnes touchées.
--
-- Et le compteur de désinscriptions d'une campagne : `unsubscribe-newsletter` ne
-- comptait que les abonnés du registre (newsletter_subscriptions). Un destinataire
-- reçu au titre de « Vos clients » (jeton dans crm_customer_contacts) était bien
-- désinscrit mais jamais compté (les 2 du 04/11). Porte unique désormais :
-- record_campaign_unsubscribe(jeton, campagne) — un événement `unsubscribed` par
-- (campagne, adresse), le compteur ne bouge que sur un événement neuf.
SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public._email_link_is_unsubscribe(p_link text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT COALESCE(p_link, '') ~* '/unsubscribe([/?#]|$)|/functions/v1/unsubscribe-newsletter';
$$;
REVOKE ALL ON FUNCTION public._email_link_is_unsubscribe(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._email_link_is_unsubscribe(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_email_event_unsubscribe_click()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.event_type = 'clicked'
     AND public._email_link_is_unsubscribe(COALESCE(NEW.metadata->'click'->>'link', NEW.metadata->>'link')) THEN
    NEW.event_type := 'unsubscribe_click';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_email_event_unsubscribe_click ON public.email_campaign_events;
CREATE TRIGGER trg_email_event_unsubscribe_click
  BEFORE INSERT ON public.email_campaign_events
  FOR EACH ROW EXECUTE FUNCTION public.trg_email_event_unsubscribe_click();

-- Compter une désinscription sur SA campagne (appelée par unsubscribe-newsletter,
-- après unsubscribe_by_token, seulement si la personne recevait encore les e-mails).
CREATE OR REPLACE FUNCTION public.record_campaign_unsubscribe(p_token uuid, p_campaign_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_campaign uuid;
  v_email text;
  v_new integer;
BEGIN
  -- La campagne du lien si elle a vraiment écrit à ce jeton, sinon la dernière qui l'a fait.
  SELECT r.campaign_id, lower(r.email) INTO v_campaign, v_email
    FROM public.email_campaign_recipients r
   WHERE r.unsubscribe_token = p_token
     AND (p_campaign_id IS NULL OR r.campaign_id = p_campaign_id)
   ORDER BY r.sent_at DESC NULLS LAST
   LIMIT 1;
  IF v_campaign IS NULL AND p_campaign_id IS NOT NULL THEN
    SELECT r.campaign_id, lower(r.email) INTO v_campaign, v_email
      FROM public.email_campaign_recipients r
     WHERE r.unsubscribe_token = p_token
     ORDER BY r.sent_at DESC NULLS LAST LIMIT 1;
  END IF;
  IF v_campaign IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.email_campaign_events (campaign_id, recipient_email, event_type, metadata)
  SELECT v_campaign, v_email, 'unsubscribed', jsonb_build_object('source', 'unsubscribe_link')
   WHERE NOT EXISTS (SELECT 1 FROM public.email_campaign_events e
                      WHERE e.campaign_id = v_campaign AND e.event_type = 'unsubscribed'
                        AND lower(e.recipient_email) = v_email);
  GET DIAGNOSTICS v_new = ROW_COUNT;
  IF v_new > 0 THEN
    UPDATE public.email_campaigns SET unsubscribes_count = COALESCE(unsubscribes_count, 0) + 1
     WHERE id = v_campaign;
  END IF;
  RETURN v_campaign;
END $$;
REVOKE ALL ON FUNCTION public.record_campaign_unsubscribe(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_campaign_unsubscribe(uuid, uuid) TO service_role;

-- ── Rattrapage ──────────────────────────────────────────────────────────────
-- 1. Les clics de désinscription déjà enregistrés.
CREATE TEMP TABLE _unsub_fix ON COMMIT DROP AS
  SELECT DISTINCT campaign_id FROM public.email_campaign_events
   WHERE event_type = 'clicked'
     AND public._email_link_is_unsubscribe(COALESCE(metadata->'click'->>'link', metadata->>'link'));

UPDATE public.email_campaign_events SET event_type = 'unsubscribe_click'
 WHERE event_type = 'clicked'
   AND public._email_link_is_unsubscribe(COALESCE(metadata->'click'->>'link', metadata->>'link'));

DO $$
DECLARE c uuid;
BEGIN
  FOR c IN SELECT campaign_id FROM _unsub_fix LOOP
    PERFORM public.recount_campaign_email_counters(c);
  END LOOP;
END $$;

-- 2. Les désinscriptions « Vos clients » jamais comptées : la dernière campagne envoyée
--    à ce jeton avant l'opposition.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT cc.unsubscribe_token AS tok,
           (SELECT x.campaign_id FROM public.email_campaign_recipients x
             WHERE x.unsubscribe_token = cc.unsubscribe_token AND x.sent_at <= cc.objected_at
             ORDER BY x.sent_at DESC LIMIT 1) AS camp
      FROM public.crm_customer_contacts cc
     WHERE cc.objected_source = 'unsubscribe' AND cc.objected_at IS NOT NULL
  LOOP
    IF r.camp IS NOT NULL THEN
      PERFORM public.record_campaign_unsubscribe(r.tok, r.camp);
    END IF;
  END LOOP;
END $$;
