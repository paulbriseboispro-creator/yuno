// Serveur MCP Yuno, côté app : l'adresse à coller dans l'IA, les pas à pas par
// assistant, et les libellés du journal. Serveur et OAuth : worker/mcp,
// données : migration 20261003100000_mcp_server.sql, doc : docs/MCP.md.

// Toujours l'adresse de PRODUCTION : c'est elle que l'IA enregistre, et le
// serveur d'autorisation annonce l'issuer https://yunoapp.eu.
export const MCP_SERVER_URL = 'https://yunoapp.eu/mcp';

export type McpClientId = 'claude' | 'chatgpt' | 'gemini' | 'lechat' | 'other';

export interface McpClientGuide {
  id: McpClientId;
  name: string;
  /** Clés i18n des étapes, dans l'ordre. */
  steps: string[];
  /** Clé i18n d'une remarque sous les étapes (disponibilité, offre). */
  note?: string;
  /** Commande à copier (clients en ligne de commande). */
  command?: string;
}

export const MCP_CLIENT_GUIDES: McpClientGuide[] = [
  { id: 'claude', name: 'Claude', steps: ['aiMcp.claude.s1', 'aiMcp.claude.s2', 'aiMcp.claude.s3', 'aiMcp.claude.s4'] },
  { id: 'chatgpt', name: 'ChatGPT', steps: ['aiMcp.chatgpt.s1', 'aiMcp.chatgpt.s2', 'aiMcp.chatgpt.s3', 'aiMcp.chatgpt.s4'], note: 'aiMcp.chatgpt.note' },
  { id: 'gemini', name: 'Gemini', steps: ['aiMcp.gemini.s1', 'aiMcp.gemini.s2', 'aiMcp.gemini.s3'], note: 'aiMcp.gemini.note' },
  { id: 'lechat', name: 'Le Chat', steps: ['aiMcp.lechat.s1', 'aiMcp.lechat.s2', 'aiMcp.lechat.s3'] },
  {
    id: 'other',
    name: 'Claude Code, Cursor…',
    steps: ['aiMcp.other.s1'],
    command: `claude mcp add --transport http yuno ${MCP_SERVER_URL}`,
  },
];

export const MCP_EXAMPLE_QUESTIONS = ['aiMcp.q1', 'aiMcp.q2', 'aiMcp.q3', 'aiMcp.q4', 'aiMcp.q5', 'aiMcp.q6', 'aiMcp.q7', 'aiMcp.q8'];

// Libellés lisibles des outils dans le journal d'une connexion (le nom
// technique n'apprend rien au pro). Inconnu = nom brut.
export const MCP_TOOL_LABEL_KEYS: Record<string, string> = {
  get_account_overview: 'aiTool.overview',
  list_events: 'aiTool.events',
  get_event_report: 'aiTool.eventReport',
  get_event_details: 'aiTool.eventDetails',
  compare_events: 'aiTool.compare',
  get_sales_overview: 'aiTool.sales',
  get_sales_trends: 'aiTool.trends',
  get_purchase_behavior: 'aiTool.purchase',
  get_audience_overview: 'aiTool.audience',
  get_customer_segments: 'aiTool.segments',
  count_contacts: 'aiTool.count',
  get_web_traffic: 'aiTool.traffic',
  get_marketing_performance: 'aiTool.marketing',
  get_campaign_report: 'aiTool.campaign',
  get_promoters_performance: 'aiTool.promoters',
  get_live_now: 'aiTool.live',
  get_recommendations: 'aiTool.recommendations',
  list_customers: 'aiTool.customers',
  list_customers_by_segment: 'aiTool.customersSegment',
  get_customer_profile: 'aiTool.customerProfile',
  get_email_design_kit: 'aiTool.emailKit',
  list_email_audiences: 'aiTool.emailAudiences',
  get_email_draft: 'aiTool.emailDraftRead',
  create_email_draft: 'aiTool.emailDraftCreate',
  update_email_draft: 'aiTool.emailDraftUpdate',
  add_email_image: 'aiTool.imageAdd',
  list_email_images: 'aiTool.images',
  get_signup_page_kit: 'aiTool.pageKit',
  get_signup_page: 'aiTool.pageRead',
  create_signup_page: 'aiTool.pageCreate',
  update_signup_page: 'aiTool.pageUpdate',
  list_scenarios: 'aiTool.scenarios',
  get_scenario_report: 'aiTool.scenarioReport',
  get_scenario_kit: 'aiTool.scenarioKit',
  create_scenario_draft: 'aiTool.scenarioCreate',
  update_scenario_draft: 'aiTool.scenarioUpdate',
};

export interface McpConnection {
  id: string;
  client_name: string;
  level: 'analytics' | 'customers';
  created_at: string;
  last_used_at: string | null;
  calls_count: number;
  /** La connexion peut préparer des brouillons d'e-mails (jamais les envoyer). */
  can_draft?: boolean;
  /** Brouillons d'e-mails créés par cette IA. */
  drafts_created?: number;
  /** La connexion peut dessiner des pages d'inscription (brouillon ou proposition, jamais publiées). */
  can_pages?: boolean;
  /** Pages d'inscription préparées ou modifiées par cette IA. */
  pages_created?: number;
  /** La connexion peut préparer des brouillons de scénarios (jamais les publier). */
  can_scenarios?: boolean;
  /** Brouillons de scénarios créés par cette IA. */
  scenarios_created?: number;
  revoked_at: string | null;
  revoked_reason: string | null;
  mine: boolean;
  person: string | null;
  spaces: { key: string; name: string }[];
}

export interface McpActivityRow {
  tool: string;
  space: string | null;
  status: 'ok' | 'error' | 'denied' | 'rate_limited';
  created_at: string;
  duration_ms: number | null;
}

/** Construit l'URL de retour vers l'IA (code + state + iss, ou erreur). */
export function buildMcpRedirect(redirectUri: string, params: Record<string, string>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

/** Une IA qui ne revient que sur la machine de la personne (outil local). */
export function isLoopbackRedirectHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
}
