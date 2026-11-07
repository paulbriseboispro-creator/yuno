-- Un clic de scanner n'est pas un clic de personne : il est rangé à la SOURCE.
--
-- Constat du 07/11 sur 3AM × Act III : sur 21 adresses « qui ont cliqué », 16 sont des
-- passerelles de sécurité d'écoles (4 clics en 0 à 2 s, tous les liens du message, 5 à 118 s
-- après l'envoi). Sur la plateforme, 96 % des clics bruts d'envois réels (hors démo, hors
-- tests) sont automatiques. Ils comptaient comme de l'intérêt partout : taux de clic,
-- personnes « actives », relance après clic (16 destinataires sur 17 étaient des scanners),
-- attribution d'une vente au clic.
--
-- Même méthode que `unsubscribe_click` (20261129120000) : une cinquantaine de fonctions lisent
-- `event_type = 'clicked'`. Plutôt que de les corriger une à une, un clic automatique devient
-- un événement `auto_click`. Aucune lecture ne le voit plus comme un clic ; le lien, l'IP et
-- l'user-agent restent dans metadata (réversible : la fonction reclasse dans les deux sens).
--
-- Règles (clic par clic, jamais par personne : quelqu'un qui partage son lien déclenche des
-- aperçus de messagerie, et ses vrais clics restent comptés ; jamais sur le délai seul : une
-- personne a cliqué 16 s après l'envoi et acheté 11 s plus tard) :
--   · lecteur automatique connu (aperçus de partage, passerelles nommées) ;
--   · ≥ 3 clics à ≤ 5 s l'un de l'autre pour la même adresse, sur ≥ 2 liens ou ≥ 2 adresses réseau ;
--   · ≥ 4 adresses réseau distinctes en 30 minutes, sans téléphone ni tablette.
-- Tout le reste est le clic d'une personne : PROBABLE, jamais certain.
--
-- Les OUVERTURES ne changent pas d'événement : le moteur de délivrabilité (reprise Gmail,
-- recentrage faute d'ouvertures) s'appuie dessus. Leur nature (préchargement ou client) se
-- lit à l'affichage par `_email_open_class`.
SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public._email_try_ts(p_text text)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $$
BEGIN
  RETURN p_text::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public._email_click_is_bot_ua(p_ua text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT COALESCE(p_ua, '') ~* 'facebookexternalhit|googleimageproxy|barracuda|slackbot|twitterbot|proofpoint|mimecast|headlesschrome|python-requests|curl/|crawler|spider|\ybot\y';
$$;

-- Nature d'une ouverture, pour l'affichage seulement : 'proxy' = préchargement (Apple Mail
-- Privacy Protection : user-agent nu « Mozilla/5.0 », YahooMailProxy, GoogleImageProxy),
-- 'client' = un client de messagerie identifiable.
CREATE OR REPLACE FUNCTION public._email_open_class(p_ua text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT CASE WHEN p_ua IS NULL OR btrim(p_ua) = '' OR btrim(p_ua) = 'Mozilla/5.0'
                OR p_ua ~* 'yahoomailproxy|googleimageproxy' THEN 'proxy' ELSE 'client' END;
$$;

CREATE OR REPLACE FUNCTION public.email_click_classify(p_campaign uuid, p_email text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_changed integer;
BEGIN
  WITH c AS (
    SELECT e.id,
           COALESCE(public._email_try_ts(e.metadata #>> '{click,timestamp}'), e.created_at) AS t,
           e.metadata #>> '{click,ipAddress}' AS ip,
           e.metadata #>> '{click,userAgent}' AS ua,
           COALESCE(e.metadata #>> '{click,link}', '') AS link
      FROM public.email_campaign_events e
     WHERE e.campaign_id = p_campaign AND lower(e.recipient_email) = lower(p_email)
       AND e.event_type IN ('clicked', 'auto_click')
  ), n AS (
    SELECT c.id,
           (SELECT count(*) FROM c o WHERE o.id <> c.id AND abs(extract(epoch FROM o.t - c.t)) <= 5) AS nb,
           (SELECT count(DISTINCT x.link) FROM c x WHERE abs(extract(epoch FROM x.t - c.t)) <= 5) AS nlinks,
           (SELECT count(DISTINCT x.ip) FROM c x WHERE abs(extract(epoch FROM x.t - c.t)) <= 5) AS nips
      FROM c
  ), g AS (
    SELECT count(DISTINCT ip) AS ips,
           extract(epoch FROM max(t) - min(t)) AS span,
           COALESCE(bool_or(COALESCE(ua, '') ~* 'iphone|android'), false) AS mobile
      FROM c
  ), v AS (
    SELECT c.id,
           CASE WHEN public._email_click_is_bot_ua(c.ua) THEN true
                WHEN n.nb >= 2 AND (n.nlinks >= 2 OR n.nips >= 2) THEN true
                WHEN g.ips >= 4 AND g.span <= 1800 AND NOT g.mobile THEN true
                ELSE false END AS auto
      FROM c JOIN n ON n.id = c.id CROSS JOIN g
  )
  UPDATE public.email_campaign_events e
     SET event_type = CASE WHEN v.auto THEN 'auto_click' ELSE 'clicked' END
    FROM v
   WHERE e.id = v.id
     AND e.event_type <> CASE WHEN v.auto THEN 'auto_click' ELSE 'clicked' END;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END $$;
REVOKE ALL ON FUNCTION public.email_click_classify(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_click_classify(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public._email_try_ts(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._email_click_is_bot_ua(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._email_open_class(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._email_try_ts(text), public._email_click_is_bot_ua(text), public._email_open_class(text) TO authenticated, service_role;

-- Après chaque clic : la grappe de la même adresse se reclasse (l'ordre d'arrivée des
-- webhooks ne compte pas : le dernier clic d'une rafale voit toute la rafale). Ne bloque
-- jamais l'écriture de l'événement.
CREATE OR REPLACE FUNCTION public.trg_email_event_click_classify()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.event_type = 'clicked' AND NEW.recipient_email IS NOT NULL THEN
    BEGIN
      PERFORM public.email_click_classify(NEW.campaign_id, NEW.recipient_email);
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_email_event_click_classify ON public.email_campaign_events;
CREATE TRIGGER trg_email_event_click_classify
  AFTER INSERT ON public.email_campaign_events
  FOR EACH ROW EXECUTE FUNCTION public.trg_email_event_click_classify();

-- Rattrapage de l'historique, puis compteurs des campagnes touchées.
DO $$
DECLARE
  r record;
  v_ids uuid[] := '{}';
  v_n integer;
BEGIN
  FOR r IN
    SELECT DISTINCT e.campaign_id, lower(e.recipient_email) AS em
      FROM public.email_campaign_events e
     WHERE e.event_type IN ('clicked', 'auto_click') AND e.recipient_email IS NOT NULL
  LOOP
    v_n := public.email_click_classify(r.campaign_id, r.em);
    IF v_n > 0 AND NOT (r.campaign_id = ANY (v_ids)) THEN v_ids := v_ids || r.campaign_id; END IF;
  END LOOP;
  FOR r IN SELECT unnest(v_ids) AS id LOOP
    PERFORM public.recount_campaign_email_counters(r.id);
  END LOOP;
END $$;
