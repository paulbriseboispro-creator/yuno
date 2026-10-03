// Mise en forme d'un résultat d'outil pour une IA : moins de jetons, autant de
// sens. Les RPC de la Console rendent ce dont un ÉCRAN a besoin (affiches,
// couleurs, horodatages à la microseconde) ; une IA a besoin des chiffres.
//
//   • retire les images (affiches, couvertures, logos) et le pilier boissons en
//     pause (DRINKS_PILLAR_LIVE) ;
//   • retire les valeurs vides (null, "", [], {}) ;
//   • arrondit les décimales, raccourcit les horodatages UTC à la minute ;
//   • plafonne les longues listes en le DISANT (« … N de plus »), puis resserre
//     tant que le tout dépasse le budget de caractères.
//
// Pur et testé (worker/mcp/__tests__/compact.test.ts).

import { DRINKS_PILLAR_LIVE } from './config';

const IMAGE_KEY = /(poster|cover|photo|image|logo|avatar|thumbnail|flyer|icon)(_?url)?$/i;
const DRINKS_KEYS = new Set([
  'drinks', 'drink', 'rev_bar', 'bar_orders', 'money_bar_orders', 'has_bar', 'hasDrinks', 'bar_revenue',
  'barRevenue', 'bottles', 'bundledDrink', 'bundledDrinkRedeemed', 'topDrinks', 'top_drinks', 'bar',
]);
const NOISE_KEYS = new Set(['ok', 'dayStart']);
const ISO_UTC = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(?:\+00(?::?00)?|Z)$/;

export const DEFAULT_MAX_CHARS = 60_000;

function round(n: number): number {
  if (Number.isInteger(n)) return n;
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 1 : 2;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function compactValue(value: unknown, arrayCap: number, depth: number): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? round(value) : undefined;
  if (typeof value === 'string') {
    if (value === '') return undefined;
    const m = ISO_UTC.exec(value);
    return m ? `${m[1]}T${m[2]}Z` : value;
  }
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const items = value.slice(0, arrayCap)
      .map((v) => compactValue(v, arrayCap, depth + 1))
      .filter((v) => v !== undefined);
    if (value.length > arrayCap) items.push(`… ${value.length - arrayCap} more not shown`);
    return items.length ? items : undefined;
  }
  if (typeof value === 'object') {
    if (depth > 12) return undefined;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (NOISE_KEYS.has(k) || IMAGE_KEY.test(k)) continue;
      if (!DRINKS_PILLAR_LIVE && DRINKS_KEYS.has(k)) continue;
      const c = compactValue(v, arrayCap, depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

// Rend le texte JSON le plus riche qui tienne dans le budget.
export function compactResult(value: unknown, maxChars = DEFAULT_MAX_CHARS): string {
  for (const cap of [120, 60, 30, 12, 5]) {
    const text = JSON.stringify(compactValue(value, cap, 0) ?? {});
    if (text.length <= maxChars) return text;
  }
  const text = JSON.stringify(compactValue(value, 3, 0) ?? {});
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}… [truncated]`;
}
