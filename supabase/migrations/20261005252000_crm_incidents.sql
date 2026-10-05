-- Yuno CRM : registre des incidents de données (RGPD art. 33 : notification à la
-- CNIL dans les 72 heures après la découverte), Admin CRM › Légal.
--
--   • crm_incidents : déclaré le, découvert le, nature, comptes concernés (clés
--     de portée), personnes concernées estimées, mesures, notification CNIL faite
--     le, pros prévenus le, clos le. RLS sans policy : tout passe par les RPC du
--     super admin, et chaque geste écrit admin_audit_log avec un motif.
--   • crm_admin_incident_pros : PRÉPARE la liste des pros à prévenir (nom,
--     contact, e-mail du titulaire) ; elle n'envoie rien.
--   • crm_incident_deadline_sweep (cron horaire) : alerte super admin
--     `admin_crm_incident_deadline` à H-24 et à H-6 de l'échéance des 72 h, tant
--     que la CNIL n'est pas notifiée et l'incident pas clos (dedup par palier).

CREATE TABLE IF NOT EXISTS public.crm_incidents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  declared_at       timestamptz NOT NULL DEFAULT now(),
  discovered_at     timestamptz NOT NULL,
  nature            text NOT NULL CHECK (length(trim(nature)) >= 3),
  accounts          text[] NOT NULL DEFAULT '{}',
  persons_estimate  integer CHECK (persons_estimate IS NULL OR persons_estimate >= 0),
  measures          text,
  cnil_notified_at  timestamptz,
  cnil_reference    text,
  pros_notified_at  timestamptz,
  closed_at         timestamptz,
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (discovered_at <= declared_at + interval '1 minute')
);
ALTER TABLE public.crm_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_incidents FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_admin_incidents()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._crm_admin_gate();
  RETURN jsonb_build_object('at', now(), 'incidents', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', i.id, 'declared_at', i.declared_at, 'discovered_at', i.discovered_at, 'nature', i.nature,
             'accounts', to_jsonb(i.accounts), 'persons_estimate', i.persons_estimate, 'measures', i.measures,
             'cnil_notified_at', i.cnil_notified_at, 'cnil_reference', i.cnil_reference,
             'pros_notified_at', i.pros_notified_at, 'closed_at', i.closed_at,
             'deadline', i.discovered_at + interval '72 hours',
             'audit', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', a.created_at, 'action', a.action, 'reason', a.metadata->>'reason') ORDER BY a.created_at DESC)
                         FROM public.admin_audit_log a WHERE a.entity_type = 'crm_incident' AND a.entity_id = i.id::text), '[]'::jsonb))
           ORDER BY (i.closed_at IS NOT NULL), i.discovered_at DESC)
      FROM public.crm_incidents i), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_incidents() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_incidents() TO authenticated, service_role;

-- Déclarer (p_id NULL) ou mettre à jour un incident. Clés : discovered_at, nature,
-- accounts, persons_estimate, measures, cnil_notified_at, cnil_reference,
-- pros_notified_at, closed_at. Motif obligatoire, journalisé.
CREATE OR REPLACE FUNCTION public.crm_admin_incident_save(p_id uuid, p_patch jsonb, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := p_id;
  k text;
BEGIN
  PERFORM public._crm_admin_gate();
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'bad_patch' USING ERRCODE = '22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k NOT IN ('discovered_at', 'nature', 'accounts', 'persons_estimate', 'measures', 'cnil_notified_at', 'cnil_reference', 'pros_notified_at', 'closed_at') THEN
      RAISE EXCEPTION 'unknown_key' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF v_id IS NULL THEN
    IF NULLIF(p_patch->>'discovered_at', '') IS NULL OR length(trim(COALESCE(p_patch->>'nature', ''))) < 3 THEN
      RAISE EXCEPTION 'missing_fields' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.crm_incidents (discovered_at, nature, accounts, persons_estimate, measures, created_by)
    VALUES ((p_patch->>'discovered_at')::timestamptz, left(trim(p_patch->>'nature'), 2000),
            COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(COALESCE(p_patch->'accounts', '[]'::jsonb)) x), '{}'),
            NULLIF(p_patch->>'persons_estimate', '')::int, left(p_patch->>'measures', 4000), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.crm_incidents SET
      discovered_at = CASE WHEN p_patch ? 'discovered_at' THEN (p_patch->>'discovered_at')::timestamptz ELSE discovered_at END,
      nature = CASE WHEN p_patch ? 'nature' THEN left(trim(p_patch->>'nature'), 2000) ELSE nature END,
      accounts = CASE WHEN p_patch ? 'accounts' THEN COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(p_patch->'accounts') x), '{}') ELSE accounts END,
      persons_estimate = CASE WHEN p_patch ? 'persons_estimate' THEN NULLIF(p_patch->>'persons_estimate', '')::int ELSE persons_estimate END,
      measures = CASE WHEN p_patch ? 'measures' THEN left(p_patch->>'measures', 4000) ELSE measures END,
      cnil_notified_at = CASE WHEN p_patch ? 'cnil_notified_at' THEN NULLIF(p_patch->>'cnil_notified_at', '')::timestamptz ELSE cnil_notified_at END,
      cnil_reference = CASE WHEN p_patch ? 'cnil_reference' THEN left(NULLIF(p_patch->>'cnil_reference', ''), 120) ELSE cnil_reference END,
      pros_notified_at = CASE WHEN p_patch ? 'pros_notified_at' THEN NULLIF(p_patch->>'pros_notified_at', '')::timestamptz ELSE pros_notified_at END,
      closed_at = CASE WHEN p_patch ? 'closed_at' THEN NULLIF(p_patch->>'closed_at', '')::timestamptz ELSE closed_at END,
      updated_at = now()
     WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), CASE WHEN p_id IS NULL THEN 'crm_incident_declared' ELSE 'crm_incident_updated' END, 'crm_incident', v_id::text,
          jsonb_build_object('reason', left(trim(p_reason), 300), 'keys', (SELECT jsonb_agg(x) FROM jsonb_object_keys(p_patch) x)));
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_incident_save(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_incident_save(uuid, jsonb, text) TO authenticated, service_role;

-- La liste des pros à prévenir : PRÉPARÉE, jamais envoyée.
CREATE OR REPLACE FUNCTION public.crm_admin_incident_pros(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_acc text[];
BEGIN
  PERFORM public._crm_admin_gate();
  SELECT accounts INTO v_acc FROM public.crm_incidents WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'crm_incident_pros_prepared', 'crm_incident', p_id::text, jsonb_build_object('reason', 'liste préparée', 'n', COALESCE(array_length(v_acc, 1), 0)));
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r->>'id', 'name', r->>'name', 'contact', r->>'contact', 'email', r->>'email', 'is_demo', r->'is_demo'))
                     FROM jsonb_array_elements(public._crm_admin_rows(true)) r WHERE r->>'id' = ANY(v_acc)), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_incident_pros(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_incident_pros(uuid) TO authenticated, service_role;

-- Alerte super admin à H-24 et H-6 de l'échéance CNIL (72 h après la découverte).
CREATE OR REPLACE FUNCTION public.crm_incident_deadline_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_n integer := 0;
  v_left numeric;
  v_step text;
BEGIN
  FOR r IN SELECT * FROM public.crm_incidents WHERE cnil_notified_at IS NULL AND closed_at IS NULL LOOP
    v_left := extract(epoch FROM (r.discovered_at + interval '72 hours') - now()) / 3600;
    v_step := CASE WHEN v_left <= 6 THEN 'h6' WHEN v_left <= 24 THEN 'h24' END;
    IF v_step IS NULL THEN CONTINUE; END IF;
    BEGIN
      PERFORM public.emit_admin_notification(
        'admin_crm_incident_deadline',
        CASE WHEN v_left <= 0 THEN 'Incident CRM : échéance CNIL dépassée' ELSE 'Incident CRM : notification CNIL dans ' || greatest(0, floor(v_left))::int || ' h' END,
        left(r.nature, 200),
        'high', 'crm_incident', r.id::text,
        jsonb_build_object('deadline', r.discovered_at + interval '72 hours', 'step', v_step),
        'crm_incident:' || r.id || ':' || v_step, NULL);
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_incident_deadline_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_incident_deadline_sweep() TO service_role;

DO $$ BEGIN PERFORM cron.unschedule('crm-incident-deadline'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('crm-incident-deadline', '5 * * * *', $$SELECT public.crm_incident_deadline_sweep();$$);
