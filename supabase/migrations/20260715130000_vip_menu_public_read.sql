-- La carte bouteilles VIP (précommande) doit être visible par les invités.
--
-- Contexte : dans le tunnel de réservation de table (TableCheckout -> VipMenuPreview),
-- un invité non connecté lit `vip_menu_items` et `vip_menu_eligibility` avec la clé anon.
-- Les policies SELECT créées à l'origine étaient restreintes `TO authenticated`, donc un
-- invité recevait 0 ligne -> `visible.length === 0` -> le composant se masquait
-- (`return null`). Résultat : « en tant qu'invité, je ne peux pas accéder au menu VIP
-- en précommande ».
--
-- Correctif : ouvrir la LECTURE des items ACTIFS et de l'éligibilité au rôle `anon`,
-- au même titre que le reste du catalogue de réservation (venues, table_packs,
-- table_zones sont déjà publics). Ce sont des données de catalogue public
-- (noms de bouteilles, prix, images) — rien de sensible. Les policies de gestion
-- réservées aux propriétaires de venue (FOR ALL) restent inchangées, et le chemin
-- d'écriture des commandes (create-table-checkout via service_role) n'est pas touché.

-- vip_menu_items : items actifs lisibles par tous (invités + connectés)
DROP POLICY IF EXISTS "Active menu items are visible to authenticated users" ON public.vip_menu_items;

CREATE POLICY "Active menu items are publicly visible"
ON public.vip_menu_items FOR SELECT
TO anon, authenticated
USING (is_active = true);

-- vip_menu_eligibility : éligibilité (prix custom, inclus, quotas) lisible par tous
DROP POLICY IF EXISTS "Eligibility visible to authenticated users" ON public.vip_menu_eligibility;

CREATE POLICY "Eligibility is publicly visible"
ON public.vip_menu_eligibility FOR SELECT
TO anon, authenticated
USING (true);
