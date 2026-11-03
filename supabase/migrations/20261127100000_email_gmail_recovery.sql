-- Mode reprise Gmail (03/11).
--
-- Constat : depuis l'envoi du 08/10 (11 458 adresses importées d'un coup, dont
-- 7 140 Gmail), Gmail range news.yunoapp.eu en spam pour TOUTES les marques qui
-- le partagent. Taux d'ouverture Gmail : 32,7 % le 17/09, 14 % le 08/10,
-- 1,3 à 1,4 % les 26 et 29/10, quand les autres messageries restent à 25-36 %.
-- SPF, DKIM et DMARC passent : c'est la RÉPUTATION du domaine chez Gmail.
--
-- Méthode de reprise (règles de Google pour les gros expéditeurs + pratique du
-- métier) : n'écrire, chez Gmail, qu'aux personnes qui ont ouvert ou cliqué un
-- e-mail récemment, le temps que les ouvertures, clics et « Non spam » de ces
-- personnes fassent remonter la réputation. Chaque e-mail de plus envoyé à une
-- adresse Gmail froide finit en spam et l'enfonce encore.
--
-- La règle vit dans la politique d'envoi commune (email_send_policy et sa forme
-- ensembliste), donc elle vaut pour TOUT le marketing : campagnes, renvois,
-- recettes automatiques, scénarios, relances de pages, e-mails du cycle de vie.
-- Un e-mail de service ou pratique (type informational) n'y passe pas.
-- Exception : un accord donné il y a moins de 30 jours par la personne elle-même
-- (page d'inscription, achat, guest list, liste d'attente…), jamais un fichier
-- importé ni un accord recopié d'une billetterie : sans elle, un nouvel inscrit
-- Gmail n'aurait jamais l'occasion d'ouvrir un premier e-mail.
-- Motif : 'gmail_cold'. Interrupteur et durée : email_deliverability_settings,
-- réglés par le super admin seul (admin_set_email_deliverability, audité).

CREATE TABLE IF NOT EXISTS public.email_deliverability_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  gmail_recovery boolean NOT NULL DEFAULT true,
  gmail_engaged_days integer NOT NULL DEFAULT 120 CHECK (gmail_engaged_days BETWEEN 30 AND 365),
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.email_deliverability_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_deliverability_settings FROM PUBLIC, anon, authenticated;
INSERT INTO public.email_deliverability_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- Le registre des recettes refuse tout motif inconnu : sans ce motif, la
-- collecte des automatisations lèverait à la première adresse Gmail froide.
ALTER TABLE public.email_automation_sends DROP CONSTRAINT IF EXISTS email_automation_sends_skip_reason_check;
ALTER TABLE public.email_automation_sends ADD CONSTRAINT email_automation_sends_skip_reason_check
  CHECK (skip_reason IS NULL OR skip_reason = ANY (ARRAY[
    'bought', 'guest_list', 'unsubscribed', 'suppressed', 'no_consent', 'cooldown', 'event_over',
    'already_event', 'pressure_24h', 'pressure_7d', 'fatigue', 'averse', 'has_table', 'gmail_cold'
  ]::text[])) NOT VALID;
ALTER TABLE public.email_automation_sends VALIDATE CONSTRAINT email_automation_sends_skip_reason_check;

-- Une adresse grand public de Google. Les domaines d'entreprise hébergés chez
-- Google Workspace ne se reconnaissent qu'à leur MX : hors règle.
CREATE OR REPLACE FUNCTION public._email_is_gmail(p_email text)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$ SELECT lower(coalesce(p_email, '')) ~ '@(gmail|googlemail)\.com$' $$;
REVOKE ALL ON FUNCTION public._email_is_gmail(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._email_is_gmail(text) TO service_role;

-- Accord frais donné par la personne elle-même (règle unique, lue par les deux formes).
CREATE OR REPLACE FUNCTION public._email_fresh_optins(p_emails text[])
RETURNS TABLE(em text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT DISTINCT lower(s.email)
    FROM public.newsletter_subscriptions s
   WHERE s.opted_in
     AND s.import_id IS NULL
     AND COALESCE(s.consent_recorded_at, s.created_at) > now() - interval '30 days'
     AND COALESCE(s.source, '') !~ '(import|connector:|seed|platform:clients|platform:pros|platform:leads)'
     AND lower(s.email) = ANY (p_emails)
$$;
REVOKE ALL ON FUNCTION public._email_fresh_optins(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._email_fresh_optins(text[]) TO service_role;

-- ── Forme ensembliste (campagnes, recettes, scénarios, relances, cycle de vie)
CREATE OR REPLACE FUNCTION public._email_send_policy_many(p_emails text[], p_kind text)
 RETURNS TABLE(email text, reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH e AS (
    SELECT DISTINCT lower(x) AS em FROM unnest(p_emails) AS x WHERE x IS NOT NULL
  ),
  cfg AS (
    SELECT k.tier,
           CASE k.tier WHEN 'campaign' THEN 3 WHEN 'urgent' THEN 2 ELSE 1 END AS cap24,
           CASE k.tier WHEN 'campaign' THEN 8 WHEN 'urgent' THEN 5 ELSE 3 END AS cap7
      FROM (SELECT CASE
              WHEN p_kind IN ('campaign', 'resend') THEN 'campaign'
              WHEN p_kind IN ('abandoned_checkout', 'upsell', 'tier_closing', 'click_no_buy') THEN 'urgent'
              ELSE 'automation' END AS tier) k
  ),
  gr AS (
    SELECT g.gmail_recovery AS on_, g.gmail_engaged_days AS days
      FROM public.email_deliverability_settings g WHERE g.id
  ),
  sends AS (
    SELECT lower(r.email) AS em, r.sent_at
      FROM public.email_campaign_recipients r
      JOIN public.email_campaigns c ON c.id = r.campaign_id
     WHERE r.status = 'sent' AND r.sent_at > now() - interval '90 days'
       AND COALESCE(c.type, 'promotional') = 'promotional'
       AND lower(r.email) IN (SELECT em FROM e)
    UNION ALL
    SELECT lower(l.email), l.sent_at
      FROM public.marketing_email_log l
     WHERE l.sent_at > now() - interval '90 days'
       AND lower(l.email) IN (SELECT em FROM e)
  ),
  agg AS (
    SELECT s.em,
           count(*) FILTER (WHERE s.sent_at > now() - interval '24 hours') AS n24,
           count(*) FILTER (WHERE s.sent_at > now() - interval '7 days') AS n7d,
           count(*) AS sent90
      FROM sends s
     GROUP BY s.em
  ),
  eng AS (
    SELECT DISTINCT lower(ev.recipient_email) AS em
      FROM public.email_campaign_events ev
     WHERE ev.event_type IN ('opened', 'clicked') AND ev.created_at > now() - interval '90 days'
       AND lower(ev.recipient_email) IN (SELECT em FROM e)
  ),
  -- Mode reprise Gmail : qui a ouvert ou cliqué dans la fenêtre réglée.
  engg AS (
    SELECT DISTINCT lower(ev.recipient_email) AS em
      FROM public.email_campaign_events ev, gr
     WHERE gr.on_
       AND ev.event_type IN ('opened', 'clicked')
       AND ev.created_at > now() - make_interval(days => gr.days)
       AND lower(ev.recipient_email) IN (SELECT em FROM e WHERE public._email_is_gmail(em))
  ),
  fresh AS (
    SELECT f.em FROM gr, public._email_fresh_optins(ARRAY(SELECT em FROM e WHERE public._email_is_gmail(em))) f
     WHERE gr.on_
  ),
  oo AS (
    SELECT lower(s.email) AS em, count(DISTINCT COALESCE(s.venue_id, s.organizer_user_id::text, 'platform')) AS n
      FROM public.newsletter_subscriptions s
     WHERE s.opted_out_at > now() - interval '30 days'
       AND lower(s.email) IN (SELECT em FROM e)
     GROUP BY lower(s.email)
  ),
  sup AS (
    SELECT DISTINCT lower(s.email) AS em
      FROM public.email_suppressions s
     WHERE lower(s.email) IN (SELECT em FROM e)
  )
  SELECT e.em,
         CASE
           WHEN position('@' in e.em) <= 1 THEN 'suppressed'
           WHEN sup.em IS NOT NULL THEN 'suppressed'
           WHEN COALESCE(gr.on_, false) AND public._email_is_gmail(e.em) AND engg.em IS NULL
                AND NOT EXISTS (SELECT 1 FROM fresh f WHERE f.em = e.em) THEN 'gmail_cold'
           WHEN COALESCE(a.sent90, 0) >= 8 AND eng.em IS NULL THEN 'fatigue'
           WHEN cfg.tier <> 'campaign' AND COALESCE(oo.n, 0) >= 2 THEN 'averse'
           WHEN COALESCE(a.n24, 0) >= cfg.cap24 THEN 'pressure_24h'
           WHEN COALESCE(a.n7d, 0) >= cfg.cap7 THEN 'pressure_7d'
         END
    FROM e
    CROSS JOIN cfg
    LEFT JOIN gr ON true
    LEFT JOIN agg a ON a.em = e.em
    LEFT JOIN eng ON eng.em = e.em
    LEFT JOIN engg ON engg.em = e.em
    LEFT JOIN oo ON oo.em = e.em
    LEFT JOIN sup ON sup.em = e.em;
$function$;

-- ── Forme unitaire (e-mails automatiques historiques de Yuno) : même règle,
-- posée juste après la liste de suppression, sur la définition vivante.
DO $do$
DECLARE
  v_def text := pg_get_functiondef('public.email_send_policy(text,text)'::regprocedure);
  v_anchor text := 'IF public.is_email_suppressed(p_email) THEN RETURN ''suppressed''; END IF;';
  v_new text;
BEGIN
  IF position('gmail_cold' in v_def) > 0 THEN RETURN; END IF;
  IF position(v_anchor in v_def) = 0 THEN
    RAISE EXCEPTION 'email_send_policy: point d''ancrage introuvable';
  END IF;
  v_new := replace(v_def, v_anchor, v_anchor || $add$
  IF public._email_is_gmail(p_email) AND EXISTS (
       SELECT 1 FROM public.email_deliverability_settings g WHERE g.id AND g.gmail_recovery
     ) AND NOT EXISTS (
       SELECT 1 FROM public.email_campaign_events ev, public.email_deliverability_settings g
        WHERE g.id
          AND lower(ev.recipient_email) = lower(p_email)
          AND ev.event_type IN ('opened', 'clicked')
          AND ev.created_at > now() - make_interval(days => g.gmail_engaged_days)
     ) AND NOT EXISTS (
       SELECT 1 FROM public._email_fresh_optins(ARRAY[lower(p_email)])
     ) THEN RETURN 'gmail_cold'; END IF;$add$);
  EXECUTE v_new;
END $do$;

-- ── Super admin : lire l'état et le suivi jour par jour, régler la reprise.
CREATE OR REPLACE FUNCTION public.admin_email_deliverability()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  s public.email_deliverability_settings;
  v_days jsonb;
  v_pool integer;
  v_cold integer;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM public.email_deliverability_settings WHERE id;

  -- Ouvertures par jour d'envoi, Gmail contre les autres messageries, hors démo
  -- et hors tests : c'est la courbe qui dit si Gmail remet en boîte de réception.
  WITH r AS (
    SELECT lower(rr.email) AS em, rr.campaign_id, (rr.sent_at AT TIME ZONE 'Europe/Paris')::date AS d
      FROM public.email_campaign_recipients rr
      JOIN public.email_campaigns c ON c.id = rr.campaign_id
     WHERE rr.status = 'sent' AND rr.sent_at > now() - interval '45 days'
       AND NOT public.is_demo_marketing_scope(c.venue_id, c.organizer_user_id)
  ),
  o AS (
    SELECT DISTINCT lower(ev.recipient_email) AS em, ev.campaign_id
      FROM public.email_campaign_events ev
     WHERE ev.event_type = 'opened' AND ev.created_at > now() - interval '45 days'
  ),
  j AS (
    SELECT r.d,
           count(*) FILTER (WHERE public._email_is_gmail(r.em)) AS gs,
           count(o.em) FILTER (WHERE public._email_is_gmail(r.em)) AS go,
           count(*) FILTER (WHERE NOT public._email_is_gmail(r.em)) AS os,
           count(o.em) FILTER (WHERE NOT public._email_is_gmail(r.em)) AS oo
      FROM r LEFT JOIN o ON o.em = r.em AND o.campaign_id = r.campaign_id
     GROUP BY r.d
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'day', j.d, 'gmail_sent', j.gs, 'gmail_opened', j.go,
           'other_sent', j.os, 'other_opened', j.oo
         ) ORDER BY j.d), '[]'::jsonb)
    INTO v_days
    FROM j;

  SELECT count(DISTINCT lower(ev.recipient_email)) INTO v_pool
    FROM public.email_campaign_events ev
   WHERE ev.event_type IN ('opened', 'clicked')
     AND ev.created_at > now() - make_interval(days => s.gmail_engaged_days)
     AND public._email_is_gmail(ev.recipient_email);

  SELECT count(*) INTO v_cold
    FROM public.email_campaign_recipients rr
   WHERE rr.status = 'skipped' AND rr.error_message = 'policy:gmail_cold'
     AND rr.created_at > now() - interval '30 days';

  RETURN jsonb_build_object(
    'gmail_recovery', s.gmail_recovery,
    'gmail_engaged_days', s.gmail_engaged_days,
    'started_at', s.started_at,
    'updated_at', s.updated_at,
    'gmail_engaged_pool', v_pool,
    'gmail_held_30d', v_cold,
    'days', v_days
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_email_deliverability() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_email_deliverability() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_email_deliverability(
  p_gmail_recovery boolean, p_gmail_engaged_days integer, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  old public.email_deliverability_settings;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_gmail_engaged_days IS NULL OR p_gmail_engaged_days NOT BETWEEN 30 AND 365 THEN
    RAISE EXCEPTION 'invalid_days';
  END IF;
  SELECT * INTO old FROM public.email_deliverability_settings WHERE id FOR UPDATE;
  UPDATE public.email_deliverability_settings
     SET gmail_recovery = p_gmail_recovery,
         gmail_engaged_days = p_gmail_engaged_days,
         started_at = CASE WHEN p_gmail_recovery AND NOT old.gmail_recovery THEN now() ELSE started_at END,
         updated_at = now(),
         updated_by = auth.uid()
   WHERE id;
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'email_deliverability_set', 'email_deliverability', 'gmail',
          jsonb_build_object('before', jsonb_build_object('on', old.gmail_recovery, 'days', old.gmail_engaged_days),
                             'after', jsonb_build_object('on', p_gmail_recovery, 'days', p_gmail_engaged_days),
                             'reason', trim(p_reason)));
  RETURN public.admin_email_deliverability();
END $$;
REVOKE ALL ON FUNCTION public.admin_set_email_deliverability(boolean, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_email_deliverability(boolean, integer, text) TO authenticated;
