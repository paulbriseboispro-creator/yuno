-- Justesse des compteurs de campagne email (suite du fix tags webhook a6ffb03).
--
-- Deux défauts constatés en prod le 02/09 après le backfill Svix de la campagne
-- WOH (317 destinataires) :
--   1. Les retries Svix livrent le même événement plusieurs fois ; le webhook
--      insérait une ligne par livraison (2 doublons constatés).
--   2. Le pattern « compter puis incrémenter » du webhook perd des unités quand
--      deux livraisons concurrentes se comptent l'une l'autre (delivered_count
--      = 308 pour 319 destinataires uniques réellement livrés).
--
-- Réponse : dédup par identifiant Svix (stable across retries) + compteurs
-- RECALCULÉS depuis email_campaign_events (idempotent, converge, auto-guérit
-- toute dérive passée). Le webhook appelle recount au lieu d'incrémenter.

-- 1. Identifiant Svix : une livraison retentée porte le même svix-id, l'index
--    unique fait échouer l'insert du doublon (23505) et le webhook s'arrête là.
ALTER TABLE public.email_campaign_events ADD COLUMN IF NOT EXISTS svix_id text;
CREATE UNIQUE INDEX IF NOT EXISTS email_campaign_events_svix_id_key
  ON public.email_campaign_events (svix_id)
  WHERE svix_id IS NOT NULL;

-- Le recount lit par (campaign_id, event_type) : l'index existant sur
-- campaign_id suffit aux volumes actuels, pas d'index composite ajouté.

-- 2. Purge des doublons existants (delivered uniquement : un email n'est
--    délivré qu'une fois ; opened/clicked peuvent légitimement se répéter).
DELETE FROM public.email_campaign_events e
USING public.email_campaign_events d
WHERE e.event_type = 'delivered'
  AND d.event_type = 'delivered'
  AND e.campaign_id = d.campaign_id
  AND e.recipient_email = d.recipient_email
  AND coalesce(e.resend_email_id, '') = coalesce(d.resend_email_id, '')
  AND e.id > d.id;

-- 3. Recalcul des compteurs d'une campagne depuis la table d'événements.
--    delivered/bounced/complained/opened = destinataires UNIQUES (le
--    disjoncteur divise par recipients_count, il lui faut des uniques) ;
--    clicks = nombre d'événements (chaque clic compte, dédupé par svix_id).
--    Seuls les destinataires de la FILE comptent : les envois de TEST portent
--    aussi le tag campaign_id (send-campaign, mode test) et gonflaient les
--    compteurs (319 « delivered » pour 317 destinataires réels constatés).
--    Le filtre lower(email) s'appuie sur uniq_campaign_recipient_email.
CREATE OR REPLACE FUNCTION public.recount_campaign_email_counters(p_campaign_id uuid)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.email_campaigns c SET
    delivered_count  = (SELECT count(DISTINCT lower(e.recipient_email)) FROM public.email_campaign_events e
                        WHERE e.campaign_id = p_campaign_id AND e.event_type = 'delivered'
                          AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                                      WHERE r.campaign_id = e.campaign_id AND lower(r.email) = lower(e.recipient_email))),
    bounced_count    = (SELECT count(DISTINCT lower(e.recipient_email)) FROM public.email_campaign_events e
                        WHERE e.campaign_id = p_campaign_id AND e.event_type = 'bounced'
                          AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                                      WHERE r.campaign_id = e.campaign_id AND lower(r.email) = lower(e.recipient_email))),
    complained_count = (SELECT count(DISTINCT lower(e.recipient_email)) FROM public.email_campaign_events e
                        WHERE e.campaign_id = p_campaign_id AND e.event_type = 'complained'
                          AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                                      WHERE r.campaign_id = e.campaign_id AND lower(r.email) = lower(e.recipient_email))),
    opens_count      = (SELECT count(DISTINCT lower(e.recipient_email)) FROM public.email_campaign_events e
                        WHERE e.campaign_id = p_campaign_id AND e.event_type = 'opened'
                          AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                                      WHERE r.campaign_id = e.campaign_id AND lower(r.email) = lower(e.recipient_email))),
    clicks_count     = (SELECT count(*) FROM public.email_campaign_events e
                        WHERE e.campaign_id = p_campaign_id AND e.event_type = 'clicked'
                          AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                                      WHERE r.campaign_id = e.campaign_id AND lower(r.email) = lower(e.recipient_email)))
  WHERE c.id = p_campaign_id;
$$;

-- Seul le webhook (service_role) recalcule ; pas d'appel client.
REVOKE ALL ON FUNCTION public.recount_campaign_email_counters(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recount_campaign_email_counters(uuid) TO service_role;

-- 4. Guérison immédiate : recalculer toute campagne ayant déjà des événements.
DO $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN SELECT DISTINCT campaign_id FROM public.email_campaign_events LOOP
    PERFORM public.recount_campaign_email_counters(v_id);
  END LOOP;
END $$;
