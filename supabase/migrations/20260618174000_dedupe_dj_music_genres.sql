-- Clean up duplicate music genres on DJ profiles.
--
-- music_genres is a free-form text[] populated by the DJ edit form, which does
-- not normalise input. Rows can therefore hold case/whitespace variants of the
-- same genre (e.g. ["house", "techno", "House"]) that the public /dj/:slug page
-- uppercases into a visible duplicate ("HOUSE" twice).
--
-- Normalise every row: trim each genre, drop empties, and dedupe
-- case-insensitively while preserving the original order and the casing of the
-- FIRST occurrence. Only rows whose array actually changes are written.

update public.djs d
set music_genres = cleaned.arr
from (
  select id, array_agg(g order by ord) as arr
  from (
    select distinct on (id, lower(btrim(genre)))
      id,
      btrim(genre) as g,
      ord
    from public.djs,
         unnest(music_genres) with ordinality as u(genre, ord)
    where btrim(genre) <> ''
    order by id, lower(btrim(genre)), ord
  ) firsts
  group by id
) cleaned
where d.id = cleaned.id
  and d.music_genres is distinct from cleaned.arr;
