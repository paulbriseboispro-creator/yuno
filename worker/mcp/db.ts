// Accès base du serveur MCP : uniquement les fonctions `mcp_*` de la migration
// 20261003100000, exécutables par service_role seul. Le Worker n'a pas d'autre
// droit : il ne lit aucune table, il ne choisit jamais une portée.

import type { McpEnv } from './config';

export class DbNotConfigured extends Error {
  constructor() { super('mcp_not_configured'); }
}

export class DbError extends Error {
  constructor(public status: number, public body: string) {
    super(`db_${status}`);
  }
  // 57014 = statement_timeout (8 s côté PostgREST) : l'analyse demandée est trop
  // lourde pour une seule réponse. 408 = le Worker a cessé d'attendre (base
  // froide, file d'attente de connexions) : même traitement, une relance.
  get isTimeout(): boolean {
    return this.status === 408 || this.body.includes('57014') || this.body.includes('canceling statement');
  }
}

export async function rpc<T>(env: McpEnv, fn: string, args: Record<string, unknown>, timeoutMs = 9500): Promise<T> {
  const key = env.SUPABASE_MCP_KEY;
  if (!key || !env.SUPABASE_URL) throw new DbNotConfigured();
  const headers: Record<string, string> = {
    apikey: key,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  // Clé héritée (JWT service_role) : aussi en Authorization. Les nouvelles clés
  // `sb_secret_…` ne vont QUE dans apikey.
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  let res: Response;
  try {
    res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new DbError(408, `worker timeout after ${timeoutMs} ms`);
    }
    throw err;
  }
  if (!res.ok) throw new DbError(res.status, (await res.text()).slice(0, 500));
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}
