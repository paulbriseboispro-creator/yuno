-- ============================================================================
-- Yuno CRM — gardes de limites compatibles avec les UPSERT.
--
-- Un `INSERT … ON CONFLICT DO UPDATE` déclenche le trigger BEFORE INSERT même
-- quand la ligne existe : NEW.id est alors un uuid neuf, et la ligne existante
-- était comptée contre elle-même. Un club à sa limite ne pouvait plus modifier
-- les droits d'un manager (OwnerStaff upsert sur user_id, venue_id), ni
-- réenregistrer une automatisation déjà allumée. On exclut donc la MÊME
-- personne (user_id / email) et la MÊME recette (kind), pas seulement le même id.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.crm_guard_member_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text;
  v_limits jsonb;
  v_count integer;
BEGIN
  IF TG_TABLE_NAME = 'org_members' THEN
    -- Une invitation retirée ne compte pas ; seule une ligne qui (re)devient
    -- vivante passe le contrôle.
    IF NEW.invitation_status NOT IN ('pending', 'accepted') THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND OLD.invitation_status IN ('pending', 'accepted') THEN RETURN NEW; END IF;
    v_scope := 'org:' || NEW.organizer_user_id::text;
    v_limits := public.crm_scope_limits(v_scope);
    IF v_limits IS NULL OR v_limits->'members' = 'null'::jsonb THEN RETURN NEW; END IF;
    SELECT count(*) INTO v_count FROM public.org_members m
     WHERE m.organizer_user_id = NEW.organizer_user_id AND m.id <> NEW.id
       AND lower(COALESCE(m.member_email, '')) IS DISTINCT FROM lower(COALESCE(NEW.member_email, ''))
       AND (NEW.member_user_id IS NULL OR m.member_user_id IS DISTINCT FROM NEW.member_user_id)
       AND (m.invitation_status = 'accepted'
            OR (m.invitation_status = 'pending' AND (m.expires_at IS NULL OR m.expires_at > now())));
  ELSE
    IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
    v_scope := 'venue:' || NEW.venue_id;
    v_limits := public.crm_scope_limits(v_scope);
    IF v_limits IS NULL OR v_limits->'members' = 'null'::jsonb THEN RETURN NEW; END IF;
    SELECT count(*) INTO v_count FROM public.manager_permissions mp
     WHERE mp.venue_id = NEW.venue_id AND mp.id <> NEW.id
       AND mp.user_id IS DISTINCT FROM NEW.user_id;
  END IF;
  IF v_count >= (v_limits->>'members')::int THEN
    RAISE EXCEPTION 'crm_member_limit' USING ERRCODE = 'P0001',
      HINT = 'Yuno CRM : le nombre de membres de votre offre est atteint.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_guard_automation_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limits jsonb;
  v_count integer;
BEGIN
  IF NOT COALESCE(NEW.enabled, false) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.enabled, false) THEN RETURN NEW; END IF;
  v_limits := public.crm_scope_limits(public.crm_scope_key(NEW.venue_id, NEW.organizer_user_id));
  IF v_limits IS NULL OR v_limits->'automations' = 'null'::jsonb THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_count FROM public.email_automations a
   WHERE a.enabled AND a.id <> NEW.id AND a.kind <> NEW.kind
     AND a.venue_id IS NOT DISTINCT FROM NEW.venue_id
     AND a.organizer_user_id IS NOT DISTINCT FROM NEW.organizer_user_id;
  IF v_count >= (v_limits->>'automations')::int THEN
    RAISE EXCEPTION 'crm_automation_limit' USING ERRCODE = 'P0001',
      HINT = 'Yuno CRM : le nombre d''automatisations de votre offre est atteint.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_guard_member_limit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_guard_automation_limit() FROM PUBLIC, anon, authenticated;
