-- Rendre les agences RP trouvables dans la barre de recherche Explorer.
--
-- La recherche (SearchOverlay) filtre des colonnes générées `search_*`
-- normalisées (minuscules + sans accents) via public.search_norm(), miroir exact
-- de searchNorm() côté front — cf. 20260717150000_search_accent_insensitive.sql.
-- Les agences vivent dans `affiliates` (identité maître fusionnée agence↔affilié,
-- cf. 20260727120000) mais n'avaient aucune colonne normalisée : introuvables.
--
-- On aligne `affiliates` sur les autres entités cherchées (venues, events, djs,
-- affiliate_venues, organizer_profiles) : deux colonnes générées STORED, aucune
-- désynchro possible, aucun trigger. Le front cherche une agence RP par nom OU
-- ville et navigue vers /rp/:linktree_slug (AgencyPublicPage).

BEGIN;

ALTER TABLE public.affiliates
  ADD COLUMN IF NOT EXISTS search_name text
    GENERATED ALWAYS AS (public.search_norm(name)) STORED,
  ADD COLUMN IF NOT EXISTS search_city text
    GENERATED ALWAYS AS (public.search_norm(city)) STORED;

-- `affiliates` est en GRANT SELECT au niveau table pour anon (la page /rp la lit
-- déjà en entier) : les nouvelles colonnes sont donc couvertes automatiquement.
-- On ré-affirme malgré tout le GRANT au niveau colonne — défensif, redondant mais
-- sans effet de bord — pour garantir que filtrer dessus ne tombe jamais en 403
-- (le piège documenté des tables grantées colonne par colonne).
GRANT SELECT (search_name, search_city) ON public.affiliates TO anon;

COMMIT;
