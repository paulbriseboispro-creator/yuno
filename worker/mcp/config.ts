// Serveur MCP Yuno — constantes partagées par l'OAuth, le protocole et les outils.
// Doc : docs/MCP.md.

export const PROD_ORIGIN = 'https://yunoapp.eu';
export const MCP_PATH = '/mcp';

// L'origine publique d'une requête : la prod sur yunoapp.eu, sinon l'hôte appelé
// (wrangler dev en local, aperçu *.workers.dev). Le `resource` annoncé doit être
// EXACTEMENT l'URL saisie par la personne dans son IA, l'issuer aussi.
export function originFor(url: URL): string {
  if (url.hostname === 'yunoapp.eu' || url.hostname === 'www.yunoapp.eu') return PROD_ORIGIN;
  return url.origin;
}

export const ACCESS_TTL_SECONDS = 3600;
export const REFRESH_TTL_SECONDS = 30 * 86400;

export const SERVER_INFO = {
  name: 'yuno',
  title: 'Yuno',
  version: '1.0.0',
  websiteUrl: 'https://yunoapp.eu/ai',
} as const;

// Génération « moderne » (sans initialize, métadonnées par requête) et
// générations « legacy » (poignée de main initialize). Le serveur parle les deux.
export const MODERN_VERSIONS = ['2026-07-28'] as const;
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
export const ALL_VERSIONS: readonly string[] = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];

export const SCOPES = ['analytics', 'customers'] as const;

// Pilier boissons en pause (2026-10-01) — miroir de src/lib/drinksPillar.ts,
// comme la constante de worker/index.ts. Rallumer les cinq ensemble.
export const DRINKS_PILLAR_LIVE = false;

export interface McpEnv {
  SUPABASE_URL: string;
  // Clé serveur dédiée (Supabase → API keys → secret key « mcp-worker »), posée
  // comme SECRET du Worker dans Cloudflare. Sans elle, /mcp répond 503 proprement.
  SUPABASE_MCP_KEY?: string;
  // Clé PUBLIQUE (variable de wrangler.jsonc, déjà dans le bundle du front) :
  // seule clé utilisée pour déposer une image dans un emplacement ouvert.
  SUPABASE_ANON_KEY?: string;
  // Jeton de vérification de domaine du portail OpenAI (plugins), servi tel
  // quel sur /.well-known/openai-apps-challenge. Absent : 404.
  OPENAI_APPS_CHALLENGE?: string;
}

export type McpCtx = { waitUntil: (p: Promise<unknown>) => void };
