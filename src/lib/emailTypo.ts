// « Vouliez-vous dire …@gmail.com ? » — remplace le champ « Confirmer l'e-mail »
// du paiement. GOV.UK déconseille de faire retaper une adresse ; ce qui la rend
// fausse, c'est surtout une faute dans le domaine (gmial.com, hotmal.fr), que
// l'on peut repérer et corriger d'un tap sans jamais bloquer l'achat.

/** Domaines grand public vus chez les acheteurs de Yuno (France, Espagne, voisins). */
const KNOWN_DOMAINS = [
  'gmail.com', 'googlemail.com',
  'hotmail.com', 'hotmail.fr', 'hotmail.es', 'hotmail.it', 'hotmail.de', 'hotmail.co.uk', 'hotmail.be',
  'outlook.com', 'outlook.fr', 'outlook.es', 'outlook.de', 'outlook.it',
  'live.com', 'live.fr', 'live.be', 'msn.com',
  'yahoo.com', 'yahoo.fr', 'yahoo.es', 'yahoo.it', 'yahoo.de', 'yahoo.co.uk', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com',
  'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'neuf.fr', 'laposte.net', 'bbox.fr',
  'aol.com', 'protonmail.com', 'proton.me',
  'gmx.fr', 'gmx.de', 'gmx.com', 'gmx.net', 'web.de', 't-online.de',
  'telefonica.net', 'movistar.es', 'libero.it', 'skynet.be', 'bluewin.ch',
] as const;

const KNOWN = new Set<string>(KNOWN_DOMAINS);

/** Une adresse qui a la forme d'une adresse (le serveur fait la même lecture). */
export function isPlausibleEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s.]{2,}$/.test(email.trim());
}

/** Distance de Damerau-Levenshtein (transposition comptée pour 1 : gmial → gmail). */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[rows - 1][cols - 1];
}

/**
 * L'adresse corrigée quand le domaine ressemble de très près à un domaine connu
 * sans en être un ; sinon null (domaine connu, domaine d'entreprise, adresse
 * illisible). Le préfixe n'est jamais touché.
 */
export function suggestEmail(email: string): string | null {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();
  if (KNOWN.has(domain)) return null;
  // Un domaine court tolère une faute, un domaine long deux.
  const maxDistance = domain.length >= 9 ? 2 : 1;
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of KNOWN_DOMAINS) {
    if (Math.abs(candidate.length - domain.length) > maxDistance) continue;
    const distance = editDistance(domain, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  if (!best || bestDistance === 0 || bestDistance > maxDistance) return null;
  return `${local}@${best}`;
}
