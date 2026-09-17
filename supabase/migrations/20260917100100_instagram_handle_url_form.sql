-- Un lien qui n'est PAS Instagram ne devient jamais un handle Instagram.
--
-- La première version retirait le préfixe « instagram.com/ » quand il était là,
-- puis coupait au premier « / ». Collée avec une URL TikTok
-- (« https://tiktok.com/@dj »), elle rendait donc le handle « tiktok.com » —
-- et la page publique de la soirée aurait pointé sur instagram.com/tiktok.com.
--
-- Règle : dès que la saisie a la FORME d'une URL, l'hôte doit être Instagram,
-- sinon on refuse. Une saisie sans hôte reste un handle nu — et il faut qu'elle
-- le reste : de vrais comptes s'appellent « yunoapp.fr » ou « amoris.paris »,
-- donc on ne peut pas refuser un point ni une terminaison de domaine.
CREATE OR REPLACE FUNCTION public.normalize_instagram_handle(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text;
BEGIN
  v := btrim(coalesce(p_raw, ''));
  IF v = '' THEN RETURN NULL; END IF;

  -- Forme URL : un protocole, un « www. » / « m. », ou un hôte suivi d'un « / ».
  IF v ~* '^(https?://|www\.|m\.)' OR v ~ '^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/' THEN
    IF v !~* '^(https?://)?(www\.|m\.)?instagram\.com/' THEN
      RETURN NULL;
    END IF;
    v := regexp_replace(v, '^(https?://)?(www\.|m\.)?instagram\.com/', '', 'i');
  END IF;

  v := regexp_replace(v, '^@', '');
  v := split_part(split_part(split_part(v, '?', 1), '#', 1), '/', 1);

  IF v !~ '^[A-Za-z0-9._]{1,30}$' THEN RETURN NULL; END IF;
  RETURN lower(v);
END;
$$;
