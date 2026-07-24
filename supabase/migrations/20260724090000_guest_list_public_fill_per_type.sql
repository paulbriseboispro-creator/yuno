-- Compteurs de remplissage guest list — ventilation PAR TYPE d'entrée.
--
-- « X places restantes » se calculait sur le quota GLOBAL de la part. Sur un
-- lien qui ne propose qu'une partie des types (ex. normale + boisson, sans
-- VIP), le chiffre comptait donc aussi les entrées VIP : le visiteur voyait
-- moins de places qu'il n'en restait réellement pour ce qu'on lui propose.
--
-- On renvoie les trois compteurs par type ; le front en déduit le restant des
-- seuls types offerts, plafonné par le quota global.
--
-- Ajout de colonnes à un RETURNS TABLE ⇒ DROP obligatoire (le remplacement en
-- place refuse tout changement de signature de sortie).
DROP FUNCTION IF EXISTS public.get_guest_list_public_fill(uuid);

CREATE OR REPLACE FUNCTION public.get_guest_list_public_fill(_guest_list_id uuid)
RETURNS TABLE (
  total_count  integer,
  female_count integer,
  male_count   integer,
  normal_count integer,
  drink_count  integer,
  table_count  integer
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    count(*)::int AS total_count,
    count(*) FILTER (WHERE lower(btrim(coalesce(gender, ''))) IN ('female', 'f', 'femme'))::int AS female_count,
    count(*) FILTER (WHERE lower(btrim(coalesce(gender, ''))) IN ('male', 'm', 'homme'))::int AS male_count,
    -- entry_type est nullable et sans contrainte : tout ce qui n'est ni
    -- 'drink' ni 'table' compte comme une entrée normale (défaut historique).
    count(*) FILTER (WHERE coalesce(entry_type, 'normal') NOT IN ('drink', 'table'))::int AS normal_count,
    count(*) FILTER (WHERE entry_type = 'drink')::int AS drink_count,
    count(*) FILTER (WHERE entry_type = 'table')::int AS table_count
  FROM public.guest_list_entries
  WHERE guest_list_id = _guest_list_id
    AND status <> 'cancelled'
    AND EXISTS (
      SELECT 1 FROM public.guest_lists gl
      WHERE gl.id = _guest_list_id AND gl.is_active = true
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_guest_list_public_fill(uuid) TO anon, authenticated;
