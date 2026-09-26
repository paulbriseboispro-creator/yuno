-- =====================================================================
-- Colonnes légales d'un organisateur : plus lisibles par n'importe quel compte
-- =====================================================================
-- 20260703140000 avait retiré à `anon` la lecture de l'identité légale
-- (legal_name, legal_address, siret, vat_number, billing_email). Mais
-- `authenticated` gardait le SELECT de TABLE, et la policy « Public organizer
-- profiles are viewable » est `USING (is_public = true)` : n'importe quel
-- compte connecté lisait l'adresse légale, le SIRET et l'email de facturation
-- de tout organisateur public. Pour une association, l'adresse légale est
-- souvent le domicile du président.
--
-- Même modèle que pour anon : SELECT par colonne, sans les colonnes légales.
-- ⚠ Conséquence à retenir : une colonne AJOUTÉE plus tard à organizer_profiles
-- n'est lisible par authenticated (et anon) que si on la GRANT explicitement.
--
-- Les lectures légitimes passent par get_organizer_legal_identity() :
--   • l'organisateur lui-même, son équipe (admin / éditeur : factures,
--     contrats) ;
--   • un club qui a un contrat, un avenant ou une co-soirée avec lui (le PDF du
--     contrat porte l'identité légale des deux parties) ;
--   • le super admin.
-- Les reçus lisent déjà le vendeur par get_event_seller() (20260926130000).
-- Les edge functions lisent en service_role : non concernées.

REVOKE SELECT ON public.organizer_profiles FROM authenticated;
GRANT SELECT (
  user_id, display_name, slug, bio, avatar_url, cover_url, instagram_url,
  website_url, is_public, created_at, updated_at, minors_allowed,
  minor_auth_doc_url, minor_auth_doc_name, city, absorb_yuno_fees,
  can_sell_alcohol, can_sell_alcohol_confirmed_at, bde_verified,
  bde_verified_at, search_display_name, name_changed_at, is_showcase_shadow,
  home_banner
) ON public.organizer_profiles TO authenticated;

-- Le rôle anon garde exactement ses colonnes d'avant (aucune colonne légale).
REVOKE SELECT (legal_name, legal_address, siret, vat_number, billing_email, rna_number, vat_regime)
  ON public.organizer_profiles FROM anon;

CREATE OR REPLACE FUNCTION public.get_organizer_legal_identity(p_organizer_user_id uuid)
RETURNS TABLE (
  legal_name text, legal_address text, siret text, vat_number text,
  billing_email text, rna_number text, vat_regime text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_organizer_user_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT (
    v_uid = p_organizer_user_id
    OR public.is_super_admin()
    OR public.is_org_team_member(v_uid, p_organizer_user_id, 'editor')
    OR EXISTS (
      SELECT 1 FROM public.event_collab_contracts c
       WHERE c.organizer_user_id = p_organizer_user_id
         AND public.can_manage_venue(v_uid, c.venue_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.event_collab_series_contracts c
       WHERE c.organizer_user_id = p_organizer_user_id
         AND public.can_manage_venue(v_uid, c.venue_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.event_collab_amendments a
       WHERE a.organizer_user_id = p_organizer_user_id
         AND public.can_manage_venue(v_uid, a.venue_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.events e
       WHERE p_organizer_user_id IN (e.organizer_user_id, e.partner_organizer_id)
         AND (
           (e.venue_id IS NOT NULL AND public.can_manage_venue(v_uid, e.venue_id))
           OR (e.partner_venue_id IS NOT NULL AND public.can_manage_venue(v_uid, e.partner_venue_id))
         )
    )
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT o.legal_name, o.legal_address, o.siret, o.vat_number,
         o.billing_email, o.rna_number, o.vat_regime
    FROM public.organizer_profiles o
   WHERE o.user_id = p_organizer_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_organizer_legal_identity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_organizer_legal_identity(uuid) TO authenticated, service_role;
