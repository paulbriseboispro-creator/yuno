/**
 * Instagram (réponse automatique aux commentaires) : règles pures, testées
 * (`__tests__/instagram.test.ts`). L'intégration réelle attend l'App Review Meta :
 * tant que CRM_INSTAGRAM_LIVE est faux, une réponse se prépare en brouillon mais
 * ne s'allume pas (miroir serveur : `crm_instagram_open()` → `crm_instagram_not_open`).
 */
export const CRM_INSTAGRAM_LIVE = false;

export type IgDestination = 'signup_page' | 'guest_list' | 'tickets';
/** Formats de publication couverts : réels, carrousels ET photos (jamais aucun). */
export type IgPostType = 'reel' | 'carousel' | 'photo';
export const IG_POST_TYPES: IgPostType[] = ['reel', 'carousel', 'photo'];

/** Coche / décoche un format sans jamais laisser la liste vide. */
export function togglePostType(cur: IgPostType[], k: IgPostType): IgPostType[] {
  const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
  return next.length ? IG_POST_TYPES.filter((x) => next.includes(x)) : cur;
}

/** Même normalisation que le serveur : minuscules, sans accent, lettres et chiffres seulement. */
export function normalizeKeyword(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** null si le mot-clé est valable, sinon la raison (affichée sous le champ). */
export function keywordError(s: string): 'short' | 'space' | 'long' | null {
  if (/\s/.test(s.trim())) return 'space';
  const k = normalizeKeyword(s);
  if (k.length < 3) return 'short';
  if (k.length > 30) return 'long';
  return null;
}

export interface IgFunnel { comments: number; dms: number; clicks: number; signups: number; buyers: number }

/** Les taux d'une étape à l'autre ; null quand l'étape précédente est vide (jamais un 0 % inventé). */
export function funnelRates(f: IgFunnel): { dm: number | null; click: number | null; signup: number | null; buyer: number | null } {
  const r = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);
  return { dm: r(f.dms, f.comments), click: r(f.clicks, f.dms), signup: r(f.signups, f.clicks), buyer: r(f.buyers, f.clicks) };
}

/** Combien de fans le solde peut atteindre (un message privé = `rate` Yunits). */
export function reachableFans(balance: number, rate: number): number {
  return rate > 0 ? Math.floor(Math.max(0, balance) / rate) : 0;
}

/** Ce qui manque pour qu'une réponse soit prête (clés de texte `yc.igp.miss.*`). */
export function missingFor(r: { keyword: string; button_label: string; dm_text: string; destination: IgDestination; signup_page_id: string | null; event_id: string | null }): string[] {
  const m: string[] = [];
  if (keywordError(r.keyword)) m.push('keyword');
  if (!r.dm_text.trim()) m.push('message');
  if (!r.button_label.trim()) m.push('button');
  if (r.destination === 'signup_page' && !r.signup_page_id) m.push('page');
  if (r.destination !== 'signup_page' && !r.event_id) m.push('night');
  return m;
}
