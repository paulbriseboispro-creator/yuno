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
  /** Variable de Yuno CRM (profil d'analyse client) : proposée dans la Console CRM seulement. */
  crm?: boolean;
}

export const EMAIL_VARIABLES: readonly VariableDef[] = [
  { key: 'prénom', aliases: ['prenom', 'first_name', 'firstname'], fallback: '' },
  { key: 'nom', aliases: ['last_name', 'lastname'], fallback: '' },
  { key: 'ville', aliases: ['city'], fallback: '' },
  { key: 'dernier_event', aliases: ['dernier_évent', 'last_event'], fallback: 'ta dernière soirée' },
  { key: 'points_fidélité', aliases: ['points_fidelite', 'loyalty_points'], fallback: '0' },
  { key: 'nom_club', aliases: ['club', 'venue_name'], fallback: '' },
  // Titre de la soirée reliée à l'email (données live). Sert aux recettes
  // automatiques, toutes déclenchées par une soirée précise : « le tarif de
  // {{soirée}} monte ». Repli : « la soirée », jamais du vide dans une phrase.
  { key: 'soirée', aliases: ['soiree', 'event', 'event_title'], fallback: 'la soirée' },
  // Yuno CRM (20261011120000) : l'artiste que la personne a vu le plus souvent
  // et qui joue à la soirée de l'e-mail (sinon son artiste le plus vu, hors
  // résidents), le titre de sa 1re soirée, son nombre de soirées.
  { key: 'artiste', aliases: ['artist'], fallback: 'nos artistes', crm: true },
  { key: '1re_soiree', aliases: ['1re_soirée', 'premiere_soiree', 'first_night'], fallback: 'ta première soirée', crm: true },
  { key: 'nb_soirees', aliases: ['nb_soirées', 'nights'], fallback: 'plusieurs', crm: true },
];

/**
 * La soirée de l'email : la première soirée résolue des données live. Une
 * campagne ne relie qu'une soirée en pratique (celle de la campagne, dont
 * héritent tous les blocs Yuno), et un envoi de recette en relie exactement une.
 */
export function liveEventTitle(ctx: RenderCtx): string {
  const first = ctx.live ? Object.values(ctx.live).find((e) => e && e.title) : undefined;
  return (first?.title || '').trim();
}

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
    'soirée': liveEventTitle(ctx),
    'artiste': (r.artistName || '').trim(),
    '1re_soiree': (r.firstNightTitle || '').trim(),
    'nb_soirees': r.nightsCount != null && r.nightsCount > 0 ? String(r.nightsCount) : '',
  };
}

/** Clés des variables Yuno CRM, pour savoir si un e-mail doit les résoudre à l'envoi. */
export const CRM_VARIABLE_KEYS: readonly string[] = EMAIL_VARIABLES.filter((v) => v.crm).flatMap((v) => [v.key, ...v.aliases]);

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
