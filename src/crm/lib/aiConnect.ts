/**
 * Brancher son IA sur Yuno CRM (Connecteurs › Assistants IA) : où l'on ajoute
 * un connecteur dans Claude, et la commande de Claude Code. L'adresse du
 * serveur vient de src/lib/mcp.ts (production, toujours).
 */
import { MCP_SERVER_URL } from '@/lib/mcp';

/**
 * La fiche de Yuno dans l'annuaire public de Claude (« Yuno MCP », slug
 * `yuno-mcp` ; `claude.ai/directory/yuno` est un AUTRE Yuno, de paiement) :
 * « Connecter » y ouvre l'autorisation Yuno, sans adresse à coller.
 */
export const CLAUDE_DIRECTORY_URL = 'https://claude.ai/directory/yuno-mcp';
/** Ajout manuel (secours) : connecteur personnalisé, support.claude.com 11175166. */
export const CLAUDE_CONNECTORS_URL = 'https://claude.ai/customize/connectors';
/** Claude Code : le serveur distant de Yuno, en HTTP, nommé « yuno ». */
export const CLAUDE_CODE_COMMAND = `claude mcp add --transport http yuno ${MCP_SERVER_URL}`;
/** Le guide dans la Console (Connecteurs › Claude). */
export const AI_GUIDE_PATH = '/crm/connectors?v=claude';
