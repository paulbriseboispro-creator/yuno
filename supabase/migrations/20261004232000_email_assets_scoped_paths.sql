-- ============================================================
-- Images d'email (bucket `email-assets`) : chacun n'écrit que dans
-- SON dossier.
--
-- Avant : les policies INSERT / UPDATE / DELETE ne demandaient que
-- can_manage_email_assets() (« est-ce un pro ? ») sans jamais lire le
-- chemin. N'importe quel club ou organisateur pouvait donc écraser ou
-- supprimer les images d'un autre compte : un logo, ou le bloc Image
-- d'une campagne déjà partie (l'email envoyé pointe sur l'URL publique,
-- l'image changeait dans toutes les boîtes de réception).
--
-- Après : le premier dossier du chemin nomme la portée, le second son
-- identifiant, et seule une personne qui gère CETTE portée y écrit.
--   venue/<venue_id>/…  propriétaire du club ou can_manage_venue()
--   org/<uuid>/…        l'organisateur lui-même, ou un membre d'équipe
--                       admin / éditeur (is_org_team_member 'editor' :
--                       ni le lecteur ni le scanner)
--   platform/…          super admin seul (marketing de Yuno)
-- Le super admin écrit partout. Lecture publique inchangée.
-- C'est la règle d'écriture de la Console CRM (crm_scope_writable,
-- 20261004230000) ; la Suite n'ouvre de toute façon le Studio qu'au
-- propriétaire et à l'organisateur.
--
-- Chemins écrits par le code : Email Studio de la Suite
-- (StudioShell : venue/<id>, org/<organizerId>, platform), Studio CRM
-- (StudioInspector : venue/<venueId>, org/<organizerUserId>), ancien
-- éditeur (sous-dossiers images/ et logos/ sous le même préfixe).
-- Inventaire au 2026-10-04 : 11 objets org/<uuid>/…, tous déposés par
-- l'organisateur du dossier ; 1 objet venue/irish/images/… de l'ancien
-- éditeur (dossier au slug et non à l'id) : il reste lisible, seul le
-- super admin peut encore le modifier.
--
-- Un identifiant d'organisateur qui n'est pas un uuid ne se caste
-- jamais : la policy refuse au lieu de lever 22P02, qui ferait tomber
-- toute écriture du bucket (les quals RLS passent avant le filtre de la
-- requête).
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_write_email_asset(p_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_dirs  text[] := storage.foldername(p_name);
  v_kind  text := v_dirs[1];
  v_scope text := v_dirs[2];
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;
  IF public.is_super_admin() THEN
    RETURN true;
  END IF;
  IF v_scope IS NULL OR v_scope = '' THEN
    RETURN false;
  END IF;

  IF v_kind = 'venue' THEN
    RETURN EXISTS (
        SELECT 1 FROM public.venues v
         WHERE v.id = v_scope AND v.owner_id = v_uid
      )
      OR public.can_manage_venue(v_uid, v_scope);
  END IF;

  IF v_kind = 'org' THEN
    IF v_scope !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN false;
    END IF;
    RETURN v_scope = v_uid::text
      OR public.is_org_team_member(v_uid, v_scope::uuid, 'editor');
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_write_email_asset(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_write_email_asset(text) TO authenticated, service_role;

-- UPDATE vérifie l'ancien chemin (USING) ET le nouveau (WITH CHECK) :
-- un « déplacer » ne sort pas une image d'un autre dossier, et n'en
-- dépose pas une dans le dossier d'un autre.
DROP POLICY IF EXISTS "Owners and organizers can upload email assets" ON storage.objects;
DROP POLICY IF EXISTS "Owners and organizers can update email assets" ON storage.objects;
DROP POLICY IF EXISTS "Owners and organizers can delete email assets" ON storage.objects;

CREATE POLICY "Email assets: upload in own scope"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'email-assets' AND public.can_write_email_asset(name));

CREATE POLICY "Email assets: update in own scope"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'email-assets' AND public.can_write_email_asset(name))
  WITH CHECK (bucket_id = 'email-assets' AND public.can_write_email_asset(name));

CREATE POLICY "Email assets: delete in own scope"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'email-assets' AND public.can_write_email_asset(name));
