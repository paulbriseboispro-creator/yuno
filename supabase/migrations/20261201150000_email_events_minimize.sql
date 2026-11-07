-- Minimisation : l'adresse IP et le user-agent d'un clic ou d'une ouverture ne servent qu'à
-- classer l'événement (personne ou contrôle de sécurité, préchargement ou client). Une fois classé,
-- on ne garde que le dérivé : après 30 jours, `ipAddress` et `userAgent` sont retirés de
-- `email_campaign_events.metadata` (même geste que `_crm_erase_contacts`), l'événement est marqué
-- `minimized`, et la nature d'une ouverture reste lisible dans `open_class`.
--
-- Recommandation CNIL 2026-042 sur les traceurs d'e-mails : ne pas conserver plus que nécessaire.
-- Le classement des clics ne revient jamais sur une ligne minimisée (elle n'a plus de quoi être
-- rejugée) : un clic tardif ne rouvre pas une campagne ancienne.
--
-- Le travail se fait par lots (20 000 lignes lues) avec un repère, jamais d'un coup : la table compte
-- plus de 120 000 lignes de plus de 30 jours et la prod est la plus petite machine.
SET lock_timeout = '3s';

ALTER TABLE public.email_campaign_events ADD COLUMN IF NOT EXISTS open_class text;
COMMENT ON COLUMN public.email_campaign_events.open_class IS
  'Nature d''une ouverture : proxy (préchargement) ou client identifiable. Posée à l''insertion ; garde le dérivé quand le user-agent est retiré.';

CREATE OR REPLACE FUNCTION public.trg_email_event_open_class()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.event_type = 'opened' AND NEW.open_class IS NULL THEN
    NEW.open_class := public._email_open_class(NEW.metadata #>> '{open,userAgent}');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_email_event_open_class ON public.email_campaign_events;
CREATE TRIGGER trg_email_event_open_class
  BEFORE INSERT ON public.email_campaign_events
  FOR EACH ROW EXECUTE FUNCTION public.trg_email_event_open_class();

-- Repère du travail de minimisation (une ligne).
CREATE TABLE IF NOT EXISTS public.email_events_minimize_state (
  id integer PRIMARY KEY CHECK (id = 1),
  upto timestamptz NOT NULL DEFAULT '-infinity',
  last_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.email_events_minimize_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_events_minimize_state FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.email_events_minimize(p_limit integer DEFAULT 20000, p_days integer DEFAULT 30)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_upto timestamptz; v_last uuid;
  v_n integer; v_max_at timestamptz; v_max_id uuid; v_changed integer;
BEGIN
  INSERT INTO public.email_events_minimize_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  SELECT s.upto, s.last_id INTO v_upto, v_last FROM public.email_events_minimize_state s WHERE s.id = 1 FOR UPDATE;

  DROP TABLE IF EXISTS _emb;
  CREATE TEMP TABLE _emb ON COMMIT DROP AS
    SELECT e.id, e.created_at
      FROM public.email_campaign_events e
     WHERE (e.created_at, e.id) > (v_upto, v_last)
       AND e.created_at < now() - make_interval(days => GREATEST(p_days, 1))
     ORDER BY e.created_at, e.id
     LIMIT GREATEST(p_limit, 1);
  SELECT count(*) INTO v_n FROM _emb;
  IF v_n = 0 THEN RETURN 0; END IF;

  UPDATE public.email_campaign_events e
     SET open_class = CASE WHEN e.event_type = 'opened' THEN COALESCE(e.open_class, public._email_open_class(e.metadata #>> '{open,userAgent}')) ELSE e.open_class END,
         metadata = ((e.metadata #- '{click,ipAddress}' #- '{click,userAgent}' #- '{open,ipAddress}' #- '{open,userAgent}')
                     || '{"minimized": true}'::jsonb)
    FROM _emb b
   WHERE e.id = b.id
     AND (e.metadata #> '{click,ipAddress}' IS NOT NULL OR e.metadata #> '{click,userAgent}' IS NOT NULL
          OR e.metadata #> '{open,ipAddress}' IS NOT NULL OR e.metadata #> '{open,userAgent}' IS NOT NULL);
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  SELECT b.created_at, b.id INTO v_max_at, v_max_id FROM _emb b ORDER BY b.created_at DESC, b.id DESC LIMIT 1;
  UPDATE public.email_events_minimize_state SET upto = v_max_at, last_id = v_max_id, updated_at = now() WHERE id = 1;
  RETURN v_changed;
END $$;
REVOKE ALL ON FUNCTION public.email_events_minimize(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_events_minimize(integer, integer) TO service_role;

-- Le classement ne rejuge jamais une ligne minimisée.
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
       AND NOT COALESCE((e.metadata ->> 'minimized')::boolean, false)
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

-- Résultats : la nature d'une ouverture se lit dans `open_class` d'abord (le user-agent a pu être retiré).
DO $$
DECLARE
  v_def text;
  v_old text := $q$public._email_open_class(e.metadata->'open'->>'userAgent')$q$;
  v_new text := $q$COALESCE(e.open_class, public._email_open_class(e.metadata->'open'->>'userAgent'))$q$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
   WHERE p.proname = 'crm_email_result__core' AND p.pronamespace = 'public'::regnamespace;
  IF v_def IS NULL OR position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'crm_email_result__core : définition inattendue, rien n''est modifié';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;

-- Un lot toutes les 10 minutes ; sans rien à faire, l'appel ne lit qu'une ligne du repère.
DO $$
BEGIN
  PERFORM cron.schedule('email-events-minimize', '3,13,23,33,43,53 * * * *', 'SELECT public.email_events_minimize();');
EXCEPTION WHEN others THEN
  RAISE NOTICE 'cron.schedule indisponible : %', SQLERRM;
END $$;
