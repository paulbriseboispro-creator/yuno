-- Yuno CRM : NPS et demandes de fonctionnalités (Console › Compte › Aide,
-- lus dans l'Admin CRM › Produit).
--
--   • crm_nps_responses : une ligne par PERSONNE et par trimestre (unique) ; une
--     réponse (score 0-10, commentaire facultatif) OU un « plus tard » (score
--     NULL). La question n'est posée qu'après 30 jours d'ancienneté du compte et
--     au plus une fois tous les 90 jours (crm_nps_should_ask). Jamais en accès
--     assisté (la question est posée à la personne, pas au support).
--   • crm_feature_requests : « Une fonction vous manque ? », texte libre, avec un
--     statut (nouvelle / vue / planifiée / faite) que le super admin change avec
--     un motif (admin_audit_log). L'Admin regroupe les demandes au texte
--     identique (sans accents ni casse) et compte les comptes demandeurs.
--   • crm_admin_feedback : le NPS (score SEULEMENT à partir de 10 réponses,
--     sinon les réponses nom par nom) et les demandes.
-- RLS sans policy sur les deux tables : tout passe par les RPC.

CREATE TABLE IF NOT EXISTS public.crm_nps_responses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key   text NOT NULL,
  user_id     uuid NOT NULL,
  quarter     text NOT NULL,
  score       smallint CHECK (score IS NULL OR score BETWEEN 0 AND 10),
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, quarter)
);
CREATE INDEX IF NOT EXISTS crm_nps_responses_at_idx ON public.crm_nps_responses (created_at DESC);
ALTER TABLE public.crm_nps_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_nps_responses FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.crm_feature_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key         text NOT NULL,
  user_id           uuid NOT NULL,
  body              text NOT NULL CHECK (length(trim(body)) BETWEEN 3 AND 1000),
  status            text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'seen', 'planned', 'done')),
  status_reason     text,
  status_changed_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_feature_requests_at_idx ON public.crm_feature_requests (created_at DESC);
ALTER TABLE public.crm_feature_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_feature_requests FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public._crm_quarter(p_at timestamptz DEFAULT now())
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$ SELECT to_char(p_at AT TIME ZONE 'Europe/Paris', 'YYYY') || '-Q' || to_char(p_at AT TIME ZONE 'Europe/Paris', 'Q'); $$;

-- La question se pose-t-elle à CETTE personne, dans CET espace ?
CREATE OR REPLACE FUNCTION public.crm_nps_should_ask(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text;
  v_since timestamptz;
BEGIN
  IF auth.uid() IS NULL OR (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN RETURN false; END IF;
  IF public.is_support_session() THEN RETURN false; END IF;
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN RETURN false; END IF;
  v_scope := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  SELECT created_at INTO v_since FROM public.crm_subscriptions WHERE scope_key = v_scope;
  IF v_since IS NULL OR v_since > now() - interval '30 days' THEN RETURN false; END IF;
  RETURN NOT EXISTS (SELECT 1 FROM public.crm_nps_responses WHERE user_id = auth.uid() AND created_at > now() - interval '90 days');
END;
$$;
REVOKE ALL ON FUNCTION public.crm_nps_should_ask(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_nps_should_ask(text, uuid) TO authenticated, service_role;

-- Répondre (score 0-10) ou « plus tard » (score NULL) : une ligne par trimestre.
CREATE OR REPLACE FUNCTION public.crm_nps_submit(p_venue_id text, p_organizer_user_id uuid, p_score integer, p_comment text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session' USING ERRCODE = '42501'; END IF;
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_score IS NOT NULL AND (p_score < 0 OR p_score > 10) THEN RAISE EXCEPTION 'bad_score' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.crm_nps_responses (scope_key, user_id, quarter, score, comment)
  VALUES (public.crm_scope_key(p_venue_id, p_organizer_user_id), auth.uid(), public._crm_quarter(), p_score, NULLIF(left(trim(COALESCE(p_comment, '')), 1000), ''))
  ON CONFLICT (user_id, quarter) DO UPDATE
    SET score = COALESCE(EXCLUDED.score, crm_nps_responses.score),
        comment = COALESCE(EXCLUDED.comment, crm_nps_responses.comment),
        created_at = CASE WHEN crm_nps_responses.score IS NULL AND EXCLUDED.score IS NOT NULL THEN now() ELSE crm_nps_responses.created_at END;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_nps_submit(text, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_nps_submit(text, uuid, integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_feature_request_submit(p_venue_id text, p_organizer_user_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session' USING ERRCODE = '42501'; END IF;
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF length(trim(COALESCE(p_body, ''))) < 3 THEN RAISE EXCEPTION 'too_short' USING ERRCODE = '22023'; END IF;
  -- Anti-flood : 10 demandes par personne et par jour.
  IF (SELECT count(*) FROM public.crm_feature_requests WHERE user_id = auth.uid() AND created_at > now() - interval '1 day') >= 10 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.crm_feature_requests (scope_key, user_id, body)
  VALUES (public.crm_scope_key(p_venue_id, p_organizer_user_id), auth.uid(), left(trim(p_body), 1000))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_feature_request_submit(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_feature_request_submit(text, uuid, text) TO authenticated, service_role;

-- ── Admin ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_admin_feedback(p_include_demo boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
  v_n integer;
  v_out jsonb;
BEGIN
  PERFORM public._crm_admin_gate();
  v_rows := public._crm_admin_rows(p_include_demo);
  WITH acc AS (SELECT r->>'id' AS id, r->>'name' AS name FROM jsonb_array_elements(v_rows) r),
  ans AS (
    SELECT n.*, a.name FROM public.crm_nps_responses n JOIN acc a ON a.id = n.scope_key
     WHERE n.score IS NOT NULL AND n.created_at > now() - interval '12 months'
  )
  SELECT count(*) INTO v_n FROM ans;
  WITH acc AS (SELECT r->>'id' AS id, r->>'name' AS name FROM jsonb_array_elements(v_rows) r),
  ans AS (
    SELECT n.*, a.name, NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), '') AS person
      FROM public.crm_nps_responses n JOIN acc a ON a.id = n.scope_key
      LEFT JOIN public.profiles p ON p.id = n.user_id
     WHERE n.score IS NOT NULL AND n.created_at > now() - interval '12 months'
  ), fr AS (
    SELECT f.*, a.name, trim(public._crm_norm(f.body)) AS k FROM public.crm_feature_requests f JOIN acc a ON a.id = f.scope_key
  )
  SELECT jsonb_build_object('at', now(),
    'nps', jsonb_build_object(
      'n', v_n,
      'promoters', (SELECT count(*) FROM ans WHERE score >= 9),
      'passives', (SELECT count(*) FROM ans WHERE score BETWEEN 7 AND 8),
      'detractors', (SELECT count(*) FROM ans WHERE score <= 6),
      -- Le score n'a de sens qu'à partir de 10 réponses : en dessous, on lit les réponses une à une.
      'score', CASE WHEN v_n >= 10 THEN round(100.0 * ((SELECT count(*) FROM ans WHERE score >= 9) - (SELECT count(*) FROM ans WHERE score <= 6)) / v_n) END,
      'dismissed', (SELECT count(*) FROM public.crm_nps_responses n JOIN acc a ON a.id = n.scope_key WHERE n.score IS NULL AND n.created_at > now() - interval '12 months'),
      'responses', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', created_at, 'score', score, 'comment', comment, 'name', name, 'person', person, 'id', scope_key) ORDER BY created_at DESC)
                    FROM (SELECT * FROM ans ORDER BY created_at DESC LIMIT CASE WHEN v_n >= 10 THEN 30 ELSE 10 END) x), '[]'::jsonb)),
    'requests', COALESCE((SELECT jsonb_agg(g ORDER BY (g->>'accounts')::int DESC, g->>'last_at' DESC) FROM (
       SELECT jsonb_build_object('key', k, 'body', (array_agg(body ORDER BY created_at DESC))[1], 'accounts', count(DISTINCT scope_key),
                'n', count(*), 'names', (SELECT jsonb_agg(DISTINCT x) FROM unnest(array_agg(name)) x),
                'status', (array_agg(status ORDER BY COALESCE(status_changed_at, created_at) DESC))[1],
                'reason', (array_agg(status_reason ORDER BY COALESCE(status_changed_at, created_at) DESC))[1],
                'last_at', max(created_at)) AS g
         FROM fr GROUP BY k) q), '[]'::jsonb))
    INTO v_out;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_feedback(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_feedback(boolean) TO authenticated, service_role;

-- Statut d'une demande (toutes les demandes au même texte), avec motif.
CREATE OR REPLACE FUNCTION public.crm_admin_feature_status(p_key text, p_status text, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  PERFORM public._crm_admin_gate();
  IF p_status NOT IN ('new', 'seen', 'planned', 'done') THEN RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023'; END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  UPDATE public.crm_feature_requests SET status = p_status, status_reason = left(trim(p_reason), 300), status_changed_at = now()
   WHERE trim(public._crm_norm(body)) = p_key;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'crm_feature_status', 'crm_feature_request', left(p_key, 200), jsonb_build_object('status', p_status, 'reason', left(trim(p_reason), 300), 'rows', v_n));
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_feature_status(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_feature_status(text, text, text) TO authenticated, service_role;
