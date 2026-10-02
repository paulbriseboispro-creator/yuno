-- ============================================================================
-- Yuno CRM — lien d'aperçu démo vers le compte crm@womber.fr.
-- Le compte « crm » entre dans la liste des rôles d'un lien (contrainte de la
-- table et create_demo_preview_link) ; l'edge demo-login l'accepte aussi.
-- ============================================================================
ALTER TABLE public.demo_preview_links DROP CONSTRAINT IF EXISTS demo_preview_links_target_account_check;
ALTER TABLE public.demo_preview_links ADD CONSTRAINT demo_preview_links_target_account_check
  CHECK (target_account = ANY (ARRAY['owner','organizer','bde','crm','promoter','agency','dj',
                                     'affiliate','bouncer','barman','cloakroom','vip_host']::text[]));

CREATE OR REPLACE FUNCTION public.create_demo_preview_link(p_label text, p_password text, p_target_accounts text[], p_language text DEFAULT 'en'::text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_accounts text[] := p_target_accounts;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF coalesce(btrim(p_label), '') = '' THEN
    RAISE EXCEPTION 'label required';
  END IF;
  IF length(coalesce(p_password, '')) < 4 THEN
    RAISE EXCEPTION 'password too short';
  END IF;
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'one showcase target only';
  END IF;

  IF p_venue_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.venues v
       WHERE v.id = p_venue_id AND v.showcase_shadow_owner_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'venue is not a showcase';
    END IF;
    v_accounts := ARRAY['owner'];
  ELSIF p_organizer_user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.organizer_profiles op
       WHERE op.user_id = p_organizer_user_id AND op.is_showcase_shadow
    ) THEN
      RAISE EXCEPTION 'organizer is not a showcase';
    END IF;
    v_accounts := ARRAY['organizer'];
  ELSE
    IF v_accounts IS NULL OR cardinality(v_accounts) = 0 THEN
      RAISE EXCEPTION 'at least one role required';
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(v_accounts) a
      WHERE a NOT IN ('owner','organizer','bde','crm','promoter','agency','dj',
                      'affiliate','bouncer','barman','cloakroom','vip_host')
    ) THEN
      RAISE EXCEPTION 'invalid target_account';
    END IF;
  END IF;

  IF coalesce(p_language, 'en') NOT IN ('en','fr','es') THEN
    RAISE EXCEPTION 'invalid language';
  END IF;

  INSERT INTO public.demo_preview_links
    (label, target_accounts, target_account, language, password_hash, created_by,
     expires_at, venue_id, organizer_user_id)
  VALUES (
    btrim(p_label),
    v_accounts,
    v_accounts[1],
    coalesce(p_language, 'en'),
    extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
    auth.uid(),
    p_expires_at,
    p_venue_id,
    p_organizer_user_id
  )
  RETURNING demo_preview_links.id, demo_preview_links.token INTO id, token;

  RETURN NEXT;
END;
$function$;
