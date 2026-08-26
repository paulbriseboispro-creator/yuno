-- ============================================================================
-- Comptes vitrine — demandes d'activation (« Ça vous plaît ? Activez votre
-- compte »).
--
-- Le prospect, en session preview lecture seule (il EST le compte fantôme),
-- clique le CTA de la bannière et laisse son email. Une ligne par venue au
-- plus en attente (un 2e envoi corrige l'email), et le super admin reçoit
-- l'alerte dans la cloche (/admin/alerts) avec un lien vers /admin/demo-access
-- où il déclenche l'invitation owner.
--
-- request_showcase_claim est le SEUL canal d'écriture du prospect en preview :
-- le previewGuard front bloque tous les préfixes d'écriture mais laisse passer
-- `request_` (voir src/lib/previewGuard.ts).
-- ============================================================================

CREATE TABLE public.showcase_claim_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  shadow_user_id uuid NOT NULL,
  requested_email text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Une seule demande en attente par venue : le prospect qui re-clique met à
-- jour son email au lieu d'empiler des doublons.
CREATE UNIQUE INDEX uq_showcase_claim_pending
  ON public.showcase_claim_requests (venue_id)
  WHERE status = 'pending';

ALTER TABLE public.showcase_claim_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins manage showcase claims"
  ON public.showcase_claim_requests
  FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- RPC appelée par le prospect en session fantôme.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_showcase_claim(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_venue RECORD;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_shadow_email text;
  v_existing RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  -- Le demandeur doit ÊTRE le fantôme, encore propriétaire, d'une venue
  -- vitrine toujours cachée. Après réclamation, plus aucune écriture possible.
  SELECT v.id, v.name INTO v_venue
    FROM public.venues v
   WHERE v.showcase_shadow_owner_id = v_uid
     AND v.owner_id = v_uid
     AND v.is_hidden
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_showcase_session');
  END IF;

  IF v_email = '' OR length(v_email) > 255 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_email');
  END IF;

  SELECT lower(u.email) INTO v_shadow_email FROM auth.users u WHERE u.id = v_uid;
  IF v_email = v_shadow_email THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_email');
  END IF;

  -- Throttle : un re-clic à moins de 60 s est absorbé en silence.
  SELECT * INTO v_existing
    FROM public.showcase_claim_requests
   WHERE venue_id = v_venue.id AND status = 'pending';
  IF FOUND AND v_existing.updated_at > now() - interval '60 seconds' THEN
    RETURN jsonb_build_object('ok', true, 'throttled', true);
  END IF;

  INSERT INTO public.showcase_claim_requests (venue_id, shadow_user_id, requested_email)
  VALUES (v_venue.id, v_uid, v_email)
  ON CONFLICT (venue_id) WHERE status = 'pending'
  DO UPDATE SET requested_email = EXCLUDED.requested_email, updated_at = now();

  -- Même email = dédoublonné ; email corrigé = nouvelle notification.
  PERFORM public.emit_admin_notification(
    'admin_showcase_claim',
    'Activation demandée : ' || v_venue.name,
    v_venue.name || ' veut activer son compte vitrine. Contact : ' || v_email || '.',
    'high',
    'venue',
    v_venue.id,
    jsonb_build_object('venue_id', v_venue.id, 'venue_name', v_venue.name, 'email', v_email),
    'showcase_claim:' || v_venue.id || ':' || md5(v_email)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.request_showcase_claim(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_showcase_claim(text) TO authenticated;
