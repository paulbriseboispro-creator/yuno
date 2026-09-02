-- ============================================================================
-- Roster agence : les invitations EN ATTENTE deviennent visibles.
--
-- Une invitation envoyée (bras Yuno = promoter_invitations, bras externe =
-- platform_invitations + affiliate_invitations_meta) n'apparaissait nulle part
-- tant qu'elle n'était pas acceptée : le chef d'agence invitait puis regardait
-- une page « Aucun promoteur ». Deux RPC SECURITY DEFINER, gardées par
-- agencies.owner_user_id, exposent la liste SANS JAMAIS renvoyer le token
-- (c'est le secret d'acceptation — l'admin n'en a pas besoin).
-- ============================================================================

-- promoter_invitations ne connaissait pas 'revoked' (pending/accepted/
-- declined/expired) : on l'ajoute pour que l'annulation d'une invitation
-- soit un état honnête, pas un faux 'declined'.
ALTER TABLE public.promoter_invitations DROP CONSTRAINT promoter_invitations_status_check;
ALTER TABLE public.promoter_invitations ADD CONSTRAINT promoter_invitations_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'expired'::text, 'revoked'::text]));

CREATE OR REPLACE FUNCTION public.get_agency_pending_invitations(p_agency_id uuid)
RETURNS TABLE (
  kind text,
  invitation_id uuid,
  email text,
  first_name text,
  last_name text,
  member_role text,
  scope_all boolean,
  venue_count int,
  venue_name text,
  created_at timestamptz,
  expires_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM agencies g WHERE g.id = p_agency_id AND g.owner_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not_agency_owner';
  END IF;

  RETURN QUERY
  SELECT 'yuno'::text, i.id, i.email, i.first_name, i.last_name, 'promoter'::text,
         false, NULL::int, v.name,
         i.created_at, i.expires_at
  FROM promoter_invitations i
  LEFT JOIN venues v ON v.id = i.venue_id
  WHERE i.agency_id = p_agency_id
    AND i.status = 'pending'
    AND (i.expires_at IS NULL OR i.expires_at > now())

  UNION ALL

  SELECT 'external'::text, pi.id, pi.email, m.first_name, m.last_name,
         COALESCE(m.member_role, 'promoter'),
         (m.venue_scope IS NULL), COALESCE(array_length(m.venue_scope, 1), 0), NULL::text,
         pi.created_at, pi.expires_at
  FROM platform_invitations pi
  JOIN affiliate_invitations_meta m ON m.invitation_token = pi.token::text
  JOIN affiliates a ON a.id = m.affiliate_id
  WHERE a.agency_id = p_agency_id
    AND pi.profile_type = 'affiliate_member'
    AND pi.status = 'pending'
    AND (pi.expires_at IS NULL OR pi.expires_at > now())

  ORDER BY 10 DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_agency_invitation(p_kind text, p_invitation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
BEGIN
  IF p_kind = 'yuno' THEN
    UPDATE promoter_invitations i SET status = 'revoked'
    WHERE i.id = p_invitation_id
      AND i.status = 'pending'
      AND i.agency_id IN (SELECT g.id FROM agencies g WHERE g.owner_user_id = auth.uid());
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSIF p_kind = 'external' THEN
    UPDATE platform_invitations pi SET status = 'revoked'
    WHERE pi.id = p_invitation_id
      AND pi.status = 'pending'
      AND pi.profile_type = 'affiliate_member'
      AND EXISTS (
        SELECT 1
        FROM affiliate_invitations_meta m
        JOIN affiliates a ON a.id = m.affiliate_id
        JOIN agencies g ON g.id = a.agency_id
        WHERE m.invitation_token = pi.token::text
          AND g.owner_user_id = auth.uid()
      );
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;
  RETURN v_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.get_agency_pending_invitations(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_agency_invitation(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_agency_pending_invitations(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_agency_invitation(text, uuid) TO authenticated;
