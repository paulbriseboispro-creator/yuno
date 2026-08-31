import type { RenderCtx } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Variables de personnalisation — interpolées AU MOMENT DE L'ENVOI, avec une
// valeur de repli par variable. Les clés canoniques sont accentuées (c'est ce
// que le Studio insère), mais la résolution accepte les formes sans accent
// ({{prenom}} hérité du v1, {{points_fidelite}} tapé à la main…).
// ─────────────────────────────────────────────────────────────────────────────

export interface VariableDef {
  /** Clé canonique, telle qu'insérée dans le contenu : {{prénom}} */
  key: string;
  /** Alias acceptés à l'interpolation (formes sans accent, héritées, etc.) */
  aliases: string[];
  fallback: string;
}

export const EMAIL_VARIABLES: readonly VariableDef[] = [
  { key: 'prénom', aliases: ['prenom', 'first_name', 'firstname'], fallback: '' },
  { key: 'nom', aliases: ['last_name', 'lastname'], fallback: '' },
  { key: 'ville', aliases: ['city'], fallback: '' },
  { key: 'dernier_event', aliases: ['dernier_évent', 'last_event'], fallback: 'ta dernière soirée' },
  { key: 'points_fidélité', aliases: ['points_fidelite', 'loyalty_points'], fallback: '0' },
  { key: 'nom_club', aliases: ['club', 'venue_name'], fallback: '' },
];

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Valeurs concrètes pour un destinataire donné. */
export function variableValues(ctx: RenderCtx): Record<string, string> {
  const r = ctx.recipient;
  return {
    'prénom': (r.firstName || '').trim(),
    'nom': (r.lastName || '').trim(),
    'ville': (r.city || ctx.city || '').trim(),
    'dernier_event': (r.lastEventTitle || '').trim(),
    'points_fidélité': r.loyaltyPoints != null ? String(r.loyaltyPoints) : '',
    'nom_club': ctx.venueName,
  };
}

/**
 * Remplace chaque {{variable}} par sa valeur, ou son repli si vide.
 * Une variable inconnue est laissée telle quelle (visible = corrigeable),
 * jamais remplacée par du vide silencieux.
 */
export function interpolateVariables(input: string, ctx: RenderCtx): string {
  if (!input || input.indexOf('{{') === -1) return input;
  const values = variableValues(ctx);
  const lookup = new Map<string, VariableDef>();
  for (const def of EMAIL_VARIABLES) {
    lookup.set(stripAccents(def.key).toLowerCase(), def);
    for (const a of def.aliases) lookup.set(stripAccents(a).toLowerCase(), def);
  }
  return input.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, rawKey: string) => {
    const def = lookup.get(stripAccents(rawKey).toLowerCase());
    if (!def) return whole;
    const value = values[def.key];
    return value && value.length > 0 ? value : def.fallback;
  })
    // « Salut  ! » quand le prénom manque → on resserre les doubles espaces.
    .replace(/ {2,}/g, ' ');
}

/** true si le contenu utilise au moins une variable connue (checklist, item 6). */
export function usesVariables(inputs: string[]): boolean {
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
  const known = new Set<string>();
  for (const def of EMAIL_VARIABLES) {
    known.add(stripAccents(def.key).toLowerCase());
    for (const a of def.aliases) known.add(stripAccents(a).toLowerCase());
  }
  for (const s of inputs) {
    if (!s) continue;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
      if (known.has(stripAccents(m[1].trim()).toLowerCase())) return true;
    }
  }
  return false;
}
