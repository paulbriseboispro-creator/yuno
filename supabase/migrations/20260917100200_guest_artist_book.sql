-- Le carnet d'artistes : ne saisir une photo qu'UNE fois.
--
-- Pourquoi ceci plutôt qu'une récupération automatique depuis Instagram.
-- Mesuré le 2026-09-17 : Instagram n'expose plus aucune API publique pour lire
-- un profil qu'on n'administre pas, le HTML de instagram.com est un mur JS sans
-- og:image, et le dernier endpoint interne qui répondait encore
-- (`users/web_profile_info`) est bloqué depuis les IP de datacenter — 0 réussite
-- sur 6 essais depuis les edge functions Supabase, alors que le même appel
-- passe depuis une connexion résidentielle. Une photo se met donc à la main.
--
-- Ce qui coûte vraiment cher au pro, ce n'est pas la première saisie : c'est de
-- la refaire chaque semaine pour les mêmes résidents. Le carnet règle ça — les
-- artistes déjà programmés reviennent avec leur photo et leur Instagram, en un
-- clic, sur chaque nouvelle soirée.
CREATE OR REPLACE FUNCTION public.get_guest_artist_book(p_query text DEFAULT NULL)
RETURNS TABLE (
  name             text,
  photo_url        text,
  instagram_url    text,
  instagram_handle text,
  times_used       integer,
  last_used_at     timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;

  RETURN QUERY
  -- Une personne = un nom (insensible à la casse). On garde sa fiche la plus
  -- récente : si le pro a changé la photo la dernière fois, c'est celle-là que
  -- le carnet propose.
  SELECT DISTINCT ON (lower(a.name))
    a.name,
    a.photo_url,
    a.instagram_url,
    a.instagram_handle,
    count(*) OVER (PARTITION BY lower(a.name))::integer,
    max(a.created_at) OVER (PARTITION BY lower(a.name))
  FROM event_guest_artists a
  WHERE public.can_manage_event_design(auth.uid(), a.event_id)
    AND (v_q IS NULL OR a.name ILIKE '%' || v_q || '%')
  ORDER BY lower(a.name), a.created_at DESC;
END;
$$;

COMMENT ON FUNCTION public.get_guest_artist_book(text) IS
  'Artistes invités déjà programmés par l''appelant — nom, photo, Instagram — pour les reposer en un clic.';

REVOKE ALL ON FUNCTION public.get_guest_artist_book(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_guest_artist_book(text) TO authenticated;
