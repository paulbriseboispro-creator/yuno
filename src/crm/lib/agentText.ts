/**
 * Contrôles des textes qu'une IA dépose dans Yuno (agents, principe 4) :
 *  • le vocabulaire interdit de l'analyse : un texte ne prête jamais un motif ou
 *    un goût à une personne (« vient pour », « fan de », « aime », « son ami »,
 *    « il préfère ») ; Yuno sait ce qui se vérifie sur un compte, pas ce qu'une
 *    personne ressent ;
 *  • les chiffres : tout nombre d'un texte doit se trouver dans les résultats
 *    d'outils de la même exécution (jeu d'évaluation ; le Worker, sans état
 *    entre deux appels, ne peut pas le vérifier en direct).
 * Module pur, partagé par le Worker MCP et les tests.
 */

const PHRASES: RegExp[] = [
  // Français
  /\bvien(?:t|nent|s)\s+pour\b/i, /\bfans?\s+d[e']/i, /\baim(?:e|es|ent|ez)\b/i, /\b(?:son|sa|ton|ta|leur)s?\s+ami(?:e|es|s)?\b/i,
  /\bpr[ée]f[èe]r(?:e|es|ent|ez)\b/i, /\badore(?:s|nt|z)?\b/i,
  // English
  /\bcomes?\s+for\b/i, /\bfans?\s+of\b/i, /\b(?:loves?|likes)\b/i, /\b(?:his|her|their|your)\s+friends?\b/i, /\bprefers?\b/i,
  // Español
  /\bvienen?\s+por\b/i, /\b(?:le|te|les)\s+gusta(?:n)?\b/i, /\b(?:su|sus|tu|tus)\s+amig[oa]s?\b/i, /\bprefieren?\b/i, /\bfans?\s+de\b/i,
];

/** Les tournures interdites trouvées dans un texte (vide = rien à redire). */
export function forbiddenWording(text: string | null | undefined): string[] {
  const s = String(text ?? '').replace(/\{\{[^}]*\}\}/g, ' ');
  const out: string[] = [];
  for (const re of PHRASES) {
    const m = re.exec(s);
    if (m && !out.includes(m[0].toLowerCase())) out.push(m[0].toLowerCase());
  }
  return out;
}

/** Les nombres d'un texte, normalisés (« 1 200 » → « 1200 », « 4,5 » → « 4.5 »), variables {{…}} exclues. */
export function numbersIn(text: string | null | undefined): string[] {
  const s = String(text ?? '').replace(/\{\{[^}]*\}\}/g, ' ');
  const out: string[] = [];
  for (const m of s.matchAll(/\d[\d\u00a0\u202f ]*(?:[.,]\d+)?/g)) {
    const v = m[0].replace(/[\u00a0\u202f ]/g, '').replace(',', '.').replace(/\.0+$/, '');
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Les nombres d'un texte qui ne figurent dans aucun résultat d'outil de l'exécution. */
export function inventedNumbers(text: string | null | undefined, toolResults: string): string[] {
  const known = new Set(numbersIn(toolResults));
  return numbersIn(text).filter((n) => !known.has(n));
}

/** Les textes qu'un scénario fait lire : nom, étiquettes, objets d'e-mail, SMS. */
export function scenarioTexts(name: string | null | undefined, graph: unknown): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  if (name) out.push({ where: 'name', text: name });
  const nodes = (graph && typeof graph === 'object' ? (graph as { nodes?: unknown }).nodes : null) ?? {};
  if (nodes && typeof nodes === 'object') {
    for (const [id, n] of Object.entries(nodes as Record<string, Record<string, unknown>>)) {
      if (!n || typeof n !== 'object') continue;
      for (const k of ['body', 'subject', 'label', 'tag']) {
        if (typeof n[k] === 'string' && n[k]) out.push({ where: `${id}.${k}`, text: n[k] as string });
      }
    }
  }
  return out;
}
