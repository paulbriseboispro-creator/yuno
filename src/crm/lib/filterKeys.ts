/**
 * Clés de filtre de clients (segments, audiences) que lit `_crm_filter_sql`.
 * Module pur : importable par un test sans client Supabase.
 */
import type { ClientFilterDef } from '@/crm/data/clients';

type FilterF = NonNullable<ClientFilterDef['f']>;

/**
 * Toutes les clés de `f` que lit `_crm_filter_sql`, par type de valeur. Une clé
 * absente de cette liste ne garde personne côté serveur (audit du 18/10,
 * MAIL-09, migration 20261023110000) : ajouter une clé au type ci-dessus
 * oblige à l'ajouter ici ET dans la migration (filterKeys.test.ts).
 */
export const CLIENT_FILTER_KEYS = {
  list: ['ev', 'rc', 'src', 'tags', 'emails', 'glev', 'area', 'country', 'hyp', 'artist', 'genre', 'fmt', 'series', 'buy', 'arr'],
  scalar: ['last', 'last_gt_days', 'nb', 'sp', 'msg', 'gl', 'nb_min', 'nb_max', 'last_lt_days', 'sp_min', 'basket_min',
    'paid_min', 'age_min', 'age_max', 'gender', 'country_not', 'up', 'click_lt_days', 'ch', 'grp', 'dist_min', 'dist_max', 'pass'],
  object: ['ntgt'],
} as const satisfies Record<'list' | 'scalar' | 'object', readonly (keyof FilterF)[]>;

// Toute clé du type est rangée : sinon, erreur de typage ici.
type ListedKey = (typeof CLIENT_FILTER_KEYS)[keyof typeof CLIENT_FILTER_KEYS][number];
const _everyKeyListed: Record<Exclude<keyof FilterF, ListedKey>, never> = {};
void _everyKeyListed;
