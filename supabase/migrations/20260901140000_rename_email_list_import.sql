-- ───────────────────────────────────────────────────────────────────────────
-- Renommer une liste importée, après coup.
--
-- Le nom se donne à l'import depuis 20260901120000, mais une liste mal nommée
-- le restait pour toujours — et les listes importées AVANT ce champ n'avaient
-- jamais eu l'occasion d'en recevoir un. C'est le genre de détail qui pousse
-- un pro à réimporter son fichier « pour le renommer », donc à créer un
-- doublon de segment. Une étiquette doit pouvoir se corriger.
--
-- • `email_list_imports` n'a AUCUNE policy d'écriture (par construction, cf.
--   20260829150200) : cette RPC SECURITY DEFINER est le seul chemin.
-- • Un nom vide REMET la valeur à NULL — l'affichage retombe alors sur le nom
--   de fichier. Effacer, c'est revenir au défaut, pas casser la ligne.
-- • `filename`, `consent_source`, `attested_by` et les compteurs ne bougent
--   jamais : on renomme une étiquette, on ne retouche pas le dossier de
--   consentement.
-- • Volontairement AUTORISÉ en session support : un nom de liste n'est ni de
--   l'argent ni de l'identité, et aider un pro à s'y retrouver est exactement
--   ce que l'accès assisté sert à faire. L'import, lui, reste bloqué — c'est
--   lui qui porte l'attestation.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rename_email_list_import(
  p_import_id uuid,
  p_name text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_venue text;
  v_org uuid;
  v_clean text := NULLIF(btrim(COALESCE(p_name, '')), '');
BEGIN
  SELECT venue_id, organizer_user_id INTO v_venue, v_org
    FROM public.email_list_imports
   WHERE id = p_import_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import inconnu';
  END IF;

  -- Même périmètre que la lecture (policy « Owners read own imports »).
  IF NOT (
    (v_venue IS NOT NULL AND public.is_venue_owner(v_uid, v_venue))
    OR (v_org IS NOT NULL AND v_org = v_uid)
    OR public.is_super_admin()
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Le CHECK de la colonne plafonne à 60 : on coupe plutôt que de faire
  -- échouer une frappe un peu longue.
  IF v_clean IS NOT NULL THEN
    v_clean := left(v_clean, 60);
  END IF;

  UPDATE public.email_list_imports
     SET list_name = v_clean
   WHERE id = p_import_id;

  RETURN v_clean;
END;
$$;

REVOKE ALL ON FUNCTION public.rename_email_list_import(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rename_email_list_import(uuid, text) TO authenticated;
