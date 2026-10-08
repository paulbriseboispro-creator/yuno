/**
 * « Préparer avec mon IA » (agents, décisions 6 et 7 du 08/10) : Yuno n'appelle
 * aucune IA. Le bouton ouvre l'IA que le pro a branchée sur Yuno (connexion
 * MCP, `mcp_my_connections`) avec la demande déjà écrite ; c'est elle qui lit
 * les chiffres par le MCP et dépose des brouillons. Claude et ChatGPT acceptent
 * une demande dans l'adresse (`?q=`) et l'envoient aussitôt : la demande ne fait
 * que préparer, jamais envoyer. Toute autre IA : la demande se copie.
 */

export type AiApp = 'claude' | 'chatgpt';
/** Ce que la demande attend de la connexion : rien de plus que lire, ou un droit d'écriture. */
export type AiNeed = 'drafts' | 'scenarios' | null;

/** Au-delà, certains navigateurs et clients coupent l'adresse. */
export const ASK_AI_MAX = 1800;

export interface AiConnectionLite {
  client_name: string;
  revoked_at: string | null;
  /** La connexion est celle de la personne (et non d'un membre de son équipe). */
  mine?: boolean;
  spaces: { key: string }[];
  can_draft?: boolean;
  can_scenarios?: boolean;
}

/** L'application web qui correspond à une connexion (Claude Code, Cursor… n'en ont pas). */
export function aiAppFor(clientName: string | null | undefined): AiApp | null {
  const s = (clientName ?? '').toLowerCase();
  if (/claude/.test(s) && !/\bcode\b|cursor|desktop cli/.test(s)) return 'claude';
  if (/chatgpt|openai/.test(s)) return 'chatgpt';
  return null;
}

export function askAiUrl(app: AiApp, text: string): string {
  const q = encodeURIComponent(text.slice(0, ASK_AI_MAX));
  return app === 'claude' ? `https://claude.ai/new?q=${q}` : `https://chatgpt.com/?q=${q}`;
}

function hasRight(c: AiConnectionLite, need: AiNeed): boolean {
  if (need === 'drafts') return !!c.can_draft;
  if (need === 'scenarios') return !!c.can_scenarios;
  return true;
}

/**
 * La connexion à utiliser pour un espace : celle de la personne (jamais celle
 * d'un coéquipier), active et qui couvre l'espace, avec
 * le droit voulu de préférence, et une application web de préférence.
 * `right` dit si elle a le droit demandé.
 */
export function pickConnection(list: AiConnectionLite[], spaceKey: string, need: AiNeed): { conn: AiConnectionLite | null; right: boolean } {
  const active = list.filter((c) => c.mine !== false && !c.revoked_at && c.spaces.some((s) => s.key === spaceKey));
  const best = (arr: AiConnectionLite[]) => arr.find((c) => aiAppFor(c.client_name)) ?? arr[0] ?? null;
  const ok = active.filter((c) => hasRight(c, need));
  if (ok.length) return { conn: best(ok), right: true };
  return { conn: best(active), right: false };
}
