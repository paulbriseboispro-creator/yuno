-- Analyse des e-mails (Console CRM) : la base joignable.
--
-- `crm_email_analysis` rend en plus `audience` : clients de la base, ceux
-- qu'un e-mail peut atteindre (`email_ok`), la raison des autres
-- (désinscrits, adresses en erreur, jamais d'accord) et les joignables par
-- cycle de vie. Le reste de la fonction ne change pas.

CREATE OR REPLACE FUNCTION public.crm_email_analysis(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_c jsonb; v_grid jsonb; v_subj jsonb; v_seg jsonb; v_aud jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  PERFORM public._crm_email_stats(p_venue_id, p_organizer_user_id, now() - interval '12 months', now() + interval '1 day');

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'subject', subject, 'sent_at', sent_at, 'kind', template_kind,
           'n', n, 'received', received, 'opened', opened, 'clicked', clicked, 'purchases', purchases, 'revenue', round(revenue, 2),
           'bounced', bounced, 'complained', complained, 'unsub', unsub) ORDER BY sent_at), '[]'::jsonb)
    INTO v_c FROM _ces;

  -- Taux de clic par créneau d'envoi (jour de la semaine × tranche de 2 h, heure de Paris).
  WITH rec AS (
    SELECT s.id, r.email,
           (extract(isodow FROM (s.sent_at AT TIME ZONE 'Europe/Paris'))::int - 1) AS d,
           LEAST(7, GREATEST(0, (extract(hour FROM (s.sent_at AT TIME ZONE 'Europe/Paris'))::int - 8) / 2)) AS h
      FROM _ces s JOIN public.email_campaign_recipients r ON r.campaign_id = s.id AND r.status IN ('sent', 'complained')
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('d', d, 'h', h, 'n', n, 'clicked', clicked) ORDER BY d, h), '[]'::jsonb)
    INTO v_grid FROM (
      SELECT rec.d, rec.h, count(*) AS n,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM _cmk k WHERE k.campaign_id = rec.id AND k.email = lower(rec.email))) AS clicked
        FROM rec GROUP BY 1, 2) z;

  -- Ouvertures selon la longueur de l'objet.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('b', b, 'campaigns', c, 'received', rcv, 'opened', op) ORDER BY b), '[]'::jsonb)
    INTO v_subj FROM (
      SELECT CASE WHEN char_length(COALESCE(subject, '')) < 30 THEN 0 WHEN char_length(subject) <= 45 THEN 1
                  WHEN char_length(subject) <= 62 THEN 2 ELSE 3 END AS b,
             count(*) AS c, sum(received) AS rcv, sum(opened) AS op
        FROM _ces GROUP BY 1) z;

  -- Réponse par cycle de vie (au jour d'aujourd'hui).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('seg', lifecycle, 'people', people, 'received', received, 'opened', opened,
           'clicked', clicked, 'purchases', purchases)), '[]'::jsonb)
    INTO v_seg FROM (
      SELECT p.lifecycle, count(DISTINCT p.email) AS people, count(*) AS received,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.email_campaign_events e WHERE e.campaign_id = s.id AND e.event_type = 'opened' AND lower(e.recipient_email) = p.email)) AS opened,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM _cmk k WHERE k.campaign_id = s.id AND k.email = p.email)) AS clicked,
             (SELECT count(*) FROM _cma a JOIN _ces s2 ON s2.id = a.campaign_id JOIN _cp p2 ON p2.email = a.email WHERE p2.lifecycle = p.lifecycle) AS purchases
        FROM _ces s
        JOIN public.email_campaign_recipients r ON r.campaign_id = s.id AND r.status IN ('sent', 'complained')
        JOIN _cp p ON p.email = lower(r.email)
       GROUP BY p.lifecycle) z;

  -- Joignables : la base entière, ceux qu'un e-mail peut atteindre et, pour
  -- les autres, pourquoi (désinscrit, adresse en erreur, jamais d'accord).
  SELECT jsonb_build_object(
           'clients', count(*),
           'reachable', count(*) FILTER (WHERE p.email_ok),
           'unsub', count(*) FILTER (WHERE NOT p.email_ok AND p.eng_status = 'unsubscribed'),
           'bounced', count(*) FILTER (WHERE NOT p.email_ok AND COALESCE(p.eng_status, '') <> 'unsubscribed' AND (p.bounced OR p.eng_status = 'unreachable')),
           'no_consent', count(*) FILTER (WHERE NOT p.email_ok AND COALESCE(p.eng_status, '') NOT IN ('unsubscribed', 'unreachable') AND NOT p.bounced),
           'by_seg', COALESCE((SELECT jsonb_object_agg(z.lifecycle, z.reach) FROM (
               SELECT q.lifecycle, count(*) FILTER (WHERE q.email_ok) AS reach FROM _cp q GROUP BY q.lifecycle) z), '{}'::jsonb))
    INTO v_aud FROM _cp p;

  RETURN jsonb_build_object('campaigns', v_c, 'grid', v_grid, 'subjects', v_subj, 'segments', v_seg, 'audience', v_aud);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_email_analysis(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_analysis(text, uuid) TO authenticated, service_role;
