import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.83.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.83.0";
import { SUBSCRIPTIONS_ENABLED } from "../_shared/venue-plan.ts";
import { lastUserPrompt, logAiUsage, messagesChars, sumUsage, trackOpenAiStream, type AiUsageEvent, type OpenAiUsage } from "../_shared/ai-usage.ts";
import { isDemoPreviewRequest } from "../_shared/demo-guard.ts";
import { CONSOLE_HELP_ARTICLES, DRINKS_HELP_ARTICLE_IDS } from "../_shared/console-help-articles.ts";

// Modèle OpenAI — changer ici suffit (clé : secret Supabase OPENAI_API_KEY)
const OPENAI_MODEL = "gpt-4o-mini";
// Modèle dédié à la génération de contenu marketing (action hors chat) —
// séparé du chat pour évoluer indépendamment.
const CONTENT_MODEL = "gpt-5-mini";
// Modèle du Night Report narratif (analyse post-soirée).
const REPORT_MODEL = "gpt-5-mini";
// Modèle du next-best-action quotidien (carte dashboard).
const ACTIONS_MODEL = "gpt-5-mini";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ═══════════════════════════════════════════
// SYSTEM PROMPT — Condensé, strict, data-driven
// ═══════════════════════════════════════════

// Pilier boissons en pause (2026-10-01), miroir de src/lib/drinksPillar.ts. Tant que
// c'est false : ni article ni outil boissons envoyé au modèle, et le prompt le dit.
const DRINKS_PILLAR_LIVE = false;

const OWNER_SYSTEM_PROMPT = `Tu es l'assistant de la Yuno Console, l'outil web des propriétaires de clubs sur Yuno. Tutoie l'owner. Réponds dans sa langue (français, anglais, espagnol).

═══ RÈGLE ABSOLUE ═══
Tu es un MOTEUR DE REQUÊTES, pas un chatbot.
- Pour TOUTE question factuelle (stats, événements, staff, revenus, commandes…) → APPELLE D'ABORD un tool.
- Si aucun tool ne peut répondre → dis "Je n'ai pas cette donnée."
- Tu ne DOIS JAMAIS inventer, deviner ou approximer un chiffre, un nom d'événement, ou un statut.
- Les seules réponses sans tool sont : remerciements, salutations, questions de clarification, explications de fonctionnalités.

═══ FORMAT DE RÉPONSE ═══
1. Commence par le RÉSULTAT (chiffre, action, donnée)
2. Ajoute du CONTEXTE si pertinent
3. Suggère la PROCHAINE ACTION
Utilise du Markdown : **gras**, listes, tableaux.

Exemple bon : "Le CA Club de ce soir est de **4 120€** (CA Net : **3 980€**). 18 commandes en attente. Tu veux vérifier la performance du bar ?"
Exemple mauvais : "Les ventes se passent bien !"

═══ CONFIRMATION OBLIGATOIRE ═══
AVANT d'exécuter une action qui MODIFIE des données :
1. Appelle list_events (ou le tool pertinent) pour identifier l'objet
2. Si ambiguïté (même nom, différentes dates) → liste les options avec dates et statut
3. Résume ce que tu vas faire en **gras**
4. Demande "**Tu confirmes ?**"
5. Exécute UNIQUEMENT après réponse affirmative ("oui", "ok", "go", "confirme")

⚠️ TOUJOURS cibler les événements À VENIR par défaut, jamais les passés.
⚠️ JAMAIS d'action write sans confirmation explicite.

═══ MÉTRIQUES DE REVENUS ═══
Quand tu donnes des chiffres de revenus, présente TOUJOURS :
- **CA Club** = Total payé - Frais Yuno (frais de service, assurance annulation, frais de gestion des tables quand le club les absorbe) - remboursements
- **CA Net** = CA Club - Frais Stripe (1.5% + 0.25€)
Un revenu, un CA ou un gain n'inclut JAMAIS l'argent de Yuno. La DÉPENSE d'un client (get_customer_insights : total_customer_spend, average_customer_spend) est une autre grandeur, frais Yuno compris : appelle-la « dépense client », jamais « CA » ni « revenu ».

Formate en tableau Markdown :
| Source | CA Club | CA Net |
|--------|---------|--------|
| Boissons | X€ | Y€ |
| Billets | X€ | Y€ |
| Tables VIP | X€ | Y€ |
| **Total** | **X€** | **Y€** |

═══ TARIFICATION (période de lancement) ═══
Yuno est GRATUIT pour les clubs pendant le lancement : aucune mensualité, TOUTES les fonctionnalités sont incluses (billetterie, tables VIP, fidélité, CRM, promoteurs, DJs, analytics…).
Seules les commissions par transaction s'appliquent (voir la structure des frais via search_help_articles).
Si l'owner demande le prix d'un abonnement : explique que c'est gratuit actuellement, que des plans payants arriveront plus tard, et que les early adopters seront prévenus à l'avance.
Ne bloque JAMAIS une fonctionnalité pour une question de plan.

═══ NAVIGATION ═══
Utilise des liens Markdown : [Événements](/owner/events), [Menu](/owner/menu), [Staff](/owner/staff), [Billetterie](/owner/ticketing), [Tables VIP](/owner/tables), [Analytics](/owner/analytics), [Paramètres](/owner/venue), [Clients](/owner/customers), [Fidélité](/owner/loyalty), [DJs](/owner/djs), [Promoteurs](/owner/promoters), [Mode d'emploi](/owner/help)

═══ NE MÉLANGE JAMAIS ═══
- Ne mélange PAS documentation et réponses data
- Pour les questions "comment ça marche" → utilise search_help_articles
- Pour les questions "combien / quoi / qui" → utilise les tools data${DRINKS_PILLAR_LIVE ? "" : `

═══ PILIER BOISSONS EN PAUSE ═══
La commande de boissons (carte du bar, Click & Collect, upsells de consos, Mode Live, écran barman) n'est PAS disponible dans Yuno pour le moment. Ne propose jamais la carte, les upsells ni le Click & Collect ; si on te le demande, dis que Yuno couvre aujourd'hui la billetterie, la guest list et les tables VIP, et que le bar reviendra plus tard.`}`;

// ═══════════════════════════════════════════
// HELP ARTICLES INDEX
// ═══════════════════════════════════════════

const HELP_ARTICLES_ALL = CONSOLE_HELP_ARTICLES;

// Pilier boissons en pause : ces articles dorment avec lui (src/lib/drinksPillar.ts).
const DRINKS_HELP_ARTICLES = DRINKS_HELP_ARTICLE_IDS;
const HELP_ARTICLES: typeof HELP_ARTICLES_ALL = Object.fromEntries(
  Object.entries(HELP_ARTICLES_ALL).filter(([id]) => DRINKS_PILLAR_LIVE || !DRINKS_HELP_ARTICLES.has(id)),
);

// ═══════════════════════════════════════════
// TOOL DEFINITIONS
// ═══════════════════════════════════════════

const TOOLS_ALL = [
  {
    type: "function",
    function: {
      name: "get_venue_stats",
      description: "Get venue KPIs: CA Club, CA Net, orders, tickets, tables. MUST use for any revenue/stats question.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["today", "yesterday", "7d", "30d", "all"], description: "Time period" },
        },
        required: ["period"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_revenue_breakdown",
      description: "Get detailed revenue breakdown by source. Use for detailed CA questions.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["today", "yesterday", "7d", "30d", "all"], description: "Time period" },
        },
        required: ["period"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_event_revenue",
      description: "Get revenue (CA Club + CA Net) for a specific event. Use when asking about revenue for a particular event.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "UUID of the event" },
        },
        required: ["event_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_event_report",
      description: "Full report of ONE event, the same numbers as Analytics → Sales → By event: tickets/tables/guest list/drinks with today's delta, club revenue, page visits and their sources, who buys (new vs returning), sales channels, tracked links, and the emails/pushes sent for this event with the sales they brought. Also the last 14 days of the sales curve (d = days before the event). Use for « how is Saturday selling », « what made this event sell », « compare with last time » (call it for both events).",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "UUID of the event (use list_events to find it)" },
        },
        required: ["event_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_community_overview",
      description: "The club's community (Analytics → Community): contacts (imported files + Yuno customers), email-reachable, followers, push-reachable, 30-day growth, how many events people come to (0-4+), when they last bought, new contacts brought by each of the last 10 events, and the community's music tastes (aggregated, only genres with ≥ 10 people). Use for « who are my customers », « is my base growing », « what music do my customers like ».",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_push_history",
      description: "History of the club's push notifications (manual, automatic, scheduled) with targeted / sent / opened (first tap per person) / buyers / revenue attributed (tap → purchase < 72 h), the 30-day summary and followers (total, reachable on iPhone, new). Use for « did my last push work », « how many people can I reach by push ».",
      parameters: {
        type: "object",
        properties: {
          filter: { type: "string", enum: ["all", "manual", "auto", "scheduled"], description: "Default all" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_events",
      description: "List events for the venue with filter. MUST use before any event-related action.",
      parameters: {
        type: "object",
        properties: {
          filter: { type: "string", enum: ["upcoming", "past", "all"], description: "Filter events. Default: upcoming" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_saved_segments",
      description: "List the venue's saved CRM segments (name + live customer count). Use when the owner asks about their segments, how many customers match one, or which segments exist.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_active_event",
      description: "Get the currently active event (ongoing) or the next upcoming one. Use for 'ma soirée', 'ce soir', 'tonight'.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tonight_stats",
      description: "Get live stats for tonight's event: revenue, orders, tickets scanned, pending orders. Use for 'ce soir', 'tonight', 'live'.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_pending_orders",
      description: "Get orders that are paid but not yet served. Use for 'commandes en attente', 'pending orders'.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_live_ops",
      description: "MUST use for any question about the night currently in progress ('comment se passe ma soirée', 'briefing', 'point de situation', 'que se passe-t-il en ce moment'). Returns the full command-center state: door (entries, pace, VIP no-shows), bar (backlog, oldest waiting order, out-of-stock products), VIP tables (arrived, min-spend at risk), cloakroom, staff on duty, tonight's incidents and active alerts. Complements get_tonight_stats (which is revenue-focused).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_event_lineup",
      description: "Get the full line-up of an event: Yuno DJs (confirmed) and guest artists without a Yuno account, with the number of clicks each guest artist's photo sent to their Instagram. Use for questions about who plays, the line-up, or how many people clicked an artist's Instagram.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "UUID of the event" },
        },
        required: ["event_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_event_details",
      description: "Get full details of a specific event including ticket stats and revenue.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "UUID of the event" },
        },
        required: ["event_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_ticket_rounds",
      description: "List ticket rounds for a specific event.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "UUID of the event" },
        },
        required: ["event_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "activate_ticket_round",
      description: "Activate or deactivate a ticket round. WRITE action — requires confirmation.",
      parameters: {
        type: "object",
        properties: {
          round_id: { type: "string", description: "UUID of the ticket round" },
          activate: { type: "boolean", description: "true to activate, false to deactivate" },
        },
        required: ["round_id", "activate"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_drinks",
      description: "List all drinks on the venue menu.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_drink",
      description: "Activate or deactivate a drink. WRITE action — requires confirmation.",
      parameters: {
        type: "object",
        properties: {
          drink_id: { type: "string", description: "UUID of the drink" },
          active: { type: "boolean", description: "true to activate, false to deactivate" },
        },
        required: ["drink_id", "active"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_drink_price",
      description: "Update the price of a drink. WRITE action — requires confirmation.",
      parameters: {
        type: "object",
        properties: {
          drink_id: { type: "string", description: "UUID of the drink" },
          price: { type: "number", description: "New price in euros" },
          promo_price: { type: "number", description: "Optional promo price" },
        },
        required: ["drink_id", "price"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_post_checkout_upsell",
      description: "Enable or disable the post-purchase drinks upsell page (shown right after a ticket purchase, presale prices). WRITE action — requires confirmation.",
      parameters: {
        type: "object",
        properties: {
          enabled: { type: "boolean", description: "true to enable, false to disable" },
        },
        required: ["enabled"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_staff_list",
      description: "List all staff members for the venue.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_reservations",
      description: "List VIP table reservations for an event.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "UUID of the event (optional, defaults to next event)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_event_ticketing",
      description: "Enable or disable ticketing for an event. WRITE action — requires confirmation.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "UUID of the event" },
          enabled: { type: "boolean", description: "true to enable, false to disable" },
        },
        required: ["event_id", "enabled"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_event_tables",
      description: "Enable or disable VIP tables for an event. WRITE action — requires confirmation.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "UUID of the event" },
          enabled: { type: "boolean", description: "true to enable, false to disable" },
        },
        required: ["event_id", "enabled"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_event",
      description: "Update event details. WRITE action — requires confirmation.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "UUID of the event" },
          title: { type: "string", description: "New title" },
          description: { type: "string", description: "New description" },
          music_genres: { type: "array", items: { type: "string" }, description: "New music genres array (e.g. ['House', 'Techno'])" },
        },
        required: ["event_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_email_automations",
      description: "List the club's automatic email recipes (new_event, abandoned_checkout, tier_closing, last_call, table_upsell, post_event_thanks, post_event_missed, regular_lapse, welcome, win_back): enabled or not, delay or tier threshold, template attached, who Yuno targets right now (eligible count, next send), their report (queued, in flight, sent, opens, clicks, skipped with reasons) and the recipes Yuno SUGGESTS turning on with the reason. Use for any question about automatic emails, 'relance automatique', 'panier abandonné', 'dernier appel', 'passe en table', 'le tarif monte', 'nouvelle soirée', 'merci', 'on t'a manqué', 'habitué qui décroche', 'bienvenue', 'reconquête', 'qui reçoit', 'suggestions'.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "set_email_automation",
      description: "Enable/disable an automatic email recipe, change its delay, or (tier_closing) its threshold. WRITE action — requires confirmation. Enabling requires a template already attached (created from the Automations page); if none, tell the owner to open /owner/campaigns/automations and click « Créer le modèle Yuno » or « Allumer » on the suggestion.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["new_event", "abandoned_checkout", "tier_closing", "last_call", "table_upsell", "post_event_thanks", "post_event_missed", "regular_lapse", "welcome", "win_back"], description: "The recipe" },
          enabled: { type: "boolean", description: "true to enable, false to disable" },
          delay_hours: { type: "integer", description: "Optional delay in hours (win_back in hours too: 90 days = 2160). abandoned_checkout 1-12, last_call 12-72 before start, table_upsell 48-168 before start, new_event 2-24 after publication, post_event 6-72 after end, welcome 1-48, win_back 1080-2880, regular_lapse 672 / 1008 / 1344 (4, 6 or 8 weeks of silence). Ignored for tier_closing." },
          threshold_pct: { type: "integer", enum: [75, 85, 95], description: "tier_closing only: share of the open ticket tier already sold that triggers « le tarif monte »." },
        },
        required: ["kind"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_guest_list",
      description: "Activate or deactivate guest list for an event. WRITE action — requires confirmation.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "UUID of the event" },
          active: { type: "boolean", description: "true to activate, false to deactivate" },
        },
        required: ["event_id", "active"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_onboarding_status",
      description: "Get onboarding progress.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_help_articles",
      description: "Search Yuno documentation. Use ONLY for 'how does X work' questions, NOT for data questions.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search keywords" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_customer_insights",
      description: "Get top customers, segments and customer SPENDING (what customers paid, Yuno fees included — not club revenue). Requires Pro plan.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of top customers (default 10)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_top_drinks",
      description: "Get best-selling drinks by order count.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["yesterday", "7d", "30d", "all"], description: "Time period" },
        },
        required: ["period"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_checklist",
      description: "Get personalized pre-party checklist.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_promoter_stats",
      description: "Get promoter performance stats for the venue. Requires Pro plan.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "set_night_brief",
      description: "Write (or clear) tonight's staff brief. It shows on top of every staff screen (door, bar, cloakroom, VIP) with a push notification, and the owner sees who read it. Use when the owner wants to brief the team: dress code, pricing changes, priorities, banned guests. Empty body clears the brief.",
      parameters: {
        type: "object",
        properties: {
          body: { type: "string", description: "The brief text (max 800 chars). Empty string clears tonight's brief." },
        },
        required: ["body"],
      },
    },
  },
];

// Pilier boissons en pause : les outils du bar ne sont pas proposés au modèle
// (leurs handlers restent, pour le relancement). src/lib/drinksPillar.ts.
const DRINKS_TOOLS = new Set(["list_drinks", "toggle_drink", "update_drink_price", "toggle_post_checkout_upsell", "get_top_drinks", "get_pending_orders"]);
const TOOLS = TOOLS_ALL.filter((t) => DRINKS_PILLAR_LIVE || !DRINKS_TOOLS.has(t.function.name));
// ═══════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════

function calcStripeFee(totalEuros: number): number {
  if (totalEuros <= 0) return 0;
  return Math.round((totalEuros * 0.015 + 0.25) * 100) / 100;
}

const WRITE_TOOLS = new Set([
  "activate_ticket_round", "toggle_drink", "update_drink_price", "toggle_post_checkout_upsell",
  "toggle_event_ticketing", "update_event", "toggle_guest_list", "toggle_event_tables",
  "set_night_brief", "set_email_automation",
]);
// Session d'un lien démo : l'IA ne se voit même pas proposer d'écrire.
const READ_ONLY_TOOLS = TOOLS.filter((t) => !WRITE_TOOLS.has(t.function.name));

const TOOL_MIN_PLAN: Record<string, string> = {
  get_customer_insights: "pro",
  get_promoter_stats: "pro",
  list_reservations: "elite",
  toggle_event_tables: "elite",
};

const PLAN_RANK: Record<string, number> = { essential: 0, pro: 1, elite: 2 };

function hasPlanAccess(currentPlan: string, requiredPlan: string): boolean {
  return (PLAN_RANK[currentPlan] || 0) >= (PLAN_RANK[requiredPlan] || 0);
}

function log(type: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), type, ...data }));
}

/** `value` s'il fait partie de `allowed`, sinon `fallback` — le test d'un includes(). */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? value as T : fallback;
}

// ═══════════════════════════════════════════
// LOCAL TYPES (tool args, rows read from the database, request bodies)
// ═══════════════════════════════════════════

// Arguments des tools, tels que déclarés dans TOOLS (JSON produit par le modèle).
interface ToolArgs {
  activate?: boolean;
  active?: boolean;
  body?: string;
  delay_hours?: number;
  description?: string;
  drink_id?: string;
  enabled?: boolean;
  event_id?: string;
  filter?: string;
  kind?: string;
  limit?: number;
  music_genres?: string[];
  period?: string;
  price?: number;
  promo_price?: number;
  query?: string;
  round_id?: string;
  threshold_pct?: number;
  title?: string;
}

type Amount = number | null;
type IdRow = { id: string };
type RoleRow = { role: string };
interface OrderAmounts { total: Amount; service_fee: Amount; refund_amount?: Amount }
interface TicketAmounts { total_price: Amount; service_fee: Amount; insurance_fee: Amount; refund_amount?: Amount }
interface TableAmounts { total_price: Amount; service_fee: Amount; management_fee: Amount; fee_absorbed?: boolean | null; refund_amount?: Amount }

// PostgREST rend au plus 1 000 lignes par requête : toute somme d'argent ou
// tout décompte fait sur des lignes passe par ici, sinon au-delà de 1 000
// ventes l'IA annonce un CA plus bas que l'écran. Le constructeur reçoit la
// tranche à lire et doit trier sur une clé stable (`order("id")`). Une erreur
// remonte : un chiffre partiel ne doit jamais être donné comme un total.
async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 100_000; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error instanceof Error ? error : new Error(String((error as { message?: unknown }).message ?? error));
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
// Ligne d'`orders.items` (jsonb) : les deux nommages coexistent.
interface OrderItem {
  name?: string;
  drink_name?: string;
  qty?: number;
  quantity?: number;
  price?: number;
  unit_price?: number;
}
interface EventListRow {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  is_active: boolean;
  ticketing_enabled: boolean;
  tables_enabled: boolean;
  music_genres: string[] | null;
  event_type: string | null;
  ticket_selling_mode: string | null;
}
interface PendingOrderRow { order_number: string | number | null; total: Amount; items: unknown; created_at: string }
interface LiveOrderRow {
  id: string;
  order_number: string | number | null;
  status: string;
  prep_status: string | null;
  created_at: string;
  ready_at: string | null;
  refunded_at: string | null;
}
interface LiveTableRow {
  id: string;
  full_name: string | null;
  status: string;
  checked_in_at: string | null;
  entry_scanned: boolean | null;
  minimum_spend: Amount;
}
interface NightOpsRow { kind: string; note: string | null; created_at: string }
interface StaffProfileRow { id: string; first_name: string | null; last_name: string | null; email: string | null }
interface PushCampaignRow {
  title: string | null;
  source: string | null;
  status: string | null;
  scheduledAt: string | null;
  createdAt: string | null;
  eventTitle: string | null;
  targeted: number | null;
  sent: number | null;
  taps: number | null;
  buyers: number | null;
  entries: number | null;
  revenue: number | null;
}
interface EmailAutomationStatRow {
  kind: string;
  enabled: boolean;
  delay_hours: number | null;
  threshold_pct: number | null;
  template_id: string | null;
  subject: string | null;
  pending: number;
  in_flight: number;
  queued: number;
  sent: number;
  opens: number;
  clickers: number;
  unsubscribes: number;
  campaigns: number;
  skipped: number;
}
interface EmailAutomationPreview { eligible: number; base: number; next_event_title: string | null; next_due_at: string | null }
interface VenueCustomerRow {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  total_spent: Amount;
  order_count: number | null;
  ticket_count: number | null;
  table_count: number | null;
}
interface PromoterRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  pending_amount: Amount;
  total_paid: Amount;
  is_active: boolean;
}
interface TicketRoundRow { name: string; price: number; tickets_sold: number | null; max_tickets: number | null; is_active: boolean }

// Corps JSON des actions hors chat (le client n'envoie que des préférences).
interface ActionBody {
  channel?: unknown;
  eventId?: unknown;
  segment?: unknown;
  tone?: unknown;
  customInstructions?: unknown;
  language?: string;
  stats?: unknown;
  scope?: string;
  messages?: unknown;
  docs?: unknown;
  currentArticle?: unknown;
}
type ContentFields = { title?: unknown; preheader?: unknown; body?: unknown };
type ContentVariant = { en?: ContentFields; fr?: ContentFields; es?: ContentFields };
interface NightReport { headline?: string; insights?: unknown[]; actions?: unknown[] }
interface NextBestAction { title?: string; why?: string; category?: string; path?: string }
type HelpChatMessage = { role?: unknown; content?: unknown };
interface OpenAiToolCall { id: string; type?: string; function: { name: string; arguments?: string } }
interface OpenAiChatMessage { role: string; content?: string | null; tool_call_id?: string; tool_calls?: OpenAiToolCall[] }

// ═══════════════════════════════════════════
// PERIOD HELPERS
// ═══════════════════════════════════════════

function getPeriodFilter(period: string): string {
  const now = new Date();
  // Use Paris timezone offset for accurate local-time boundaries
  const parisOffset = getParisOffsetMs(now);
  const parisNow = new Date(now.getTime() + parisOffset);

  switch (period) {
    case "today": { const d = new Date(parisNow); d.setHours(0,0,0,0); return new Date(d.getTime() - parisOffset).toISOString(); }
    case "yesterday": { const d = new Date(parisNow); d.setDate(d.getDate() - 1); d.setHours(0,0,0,0); return new Date(d.getTime() - parisOffset).toISOString(); }
    case "7d": { const d = new Date(parisNow); d.setDate(d.getDate() - 7); d.setHours(0,0,0,0); return new Date(d.getTime() - parisOffset).toISOString(); }
    case "30d": { const d = new Date(parisNow); d.setDate(d.getDate() - 30); d.setHours(0,0,0,0); return new Date(d.getTime() - parisOffset).toISOString(); }
    default: return "2020-01-01T00:00:00Z";
  }
}

function getPeriodEnd(period: string): string | null {
  if (period !== "yesterday") return null;
  const now = new Date();
  const parisOffset = getParisOffsetMs(now);
  const parisNow = new Date(now.getTime() + parisOffset);
  const d = new Date(parisNow); d.setHours(0,0,0,0);
  return new Date(d.getTime() - parisOffset).toISOString();
}

// Get Paris UTC offset in milliseconds (handles DST)
function getParisOffsetMs(date: Date): number {
  // Format a date in Paris timezone and parse it back to get the offset
  const utc = date.getTime();
  const parisStr = date.toLocaleString("en-US", { timeZone: "Europe/Paris" });
  const parisDate = new Date(parisStr);
  return parisDate.getTime() - utc + (date.getTimezoneOffset() * 60000);
}

// ═══════════════════════════════════════════
// REVENUE CALCULATION HELPERS
// ═══════════════════════════════════════════

// Statuts d'une vente comptée dans le CA : ceux des RPC d'analyse
// (get_events_sales_summary, get_event_report…). Une commande servie reste une
// vente, une table confirmée aussi.
const ORDER_SALE_STATUSES = ["paid", "served"];
const TICKET_SALE_STATUSES = ["paid", "used"];
const TABLE_SALE_STATUSES = ["paid", "confirmed"];

// Miroirs de src/utils/fees.ts : CA Club = part du club, frais Yuno exclus
// (service, assurance, frais de gestion absorbés), remboursement déduit
// (plafonné à la part du club) ; CA Net = CA Club − frais Stripe, que Stripe
// prélève sur le montant TOTAL payé (frais Yuno compris).
function addRow(acc: { caClub: number; caNet: number }, gross: number, charged: number, refund: unknown) {
  const refunded = Math.min(Math.max(Number(refund) || 0, 0), Math.max(gross, 0));
  acc.caClub += gross - refunded;
  acc.caNet += gross - refunded - calcStripeFee(charged);
}

function calcOrdersRevenue(orders: OrderAmounts[]): { caClub: number; caNet: number } {
  const acc = { caClub: 0, caNet: 0 };
  for (const o of orders) {
    const total = o.total || 0;
    addRow(acc, total - (o.service_fee || 0), total, o.refund_amount);
  }
  return acc;
}

function calcTicketsRevenue(tickets: TicketAmounts[]): { caClub: number; caNet: number } {
  const acc = { caClub: 0, caNet: 0 };
  for (const t of tickets) {
    const tp = t.total_price || 0;
    addRow(acc, tp - (t.service_fee || 0) - (t.insurance_fee || 0), tp, t.refund_amount);
  }
  return acc;
}

function calcTablesRevenue(tables: TableAmounts[]): { caClub: number; caNet: number } {
  const acc = { caClub: 0, caNet: 0 };
  for (const t of tables) {
    const tp = t.total_price || 0;
    // Frais de gestion : payés EN PLUS par le client, ils ne sortent de la
    // part du club que s'il les absorbe (miroir de tableRevenue, fees.ts).
    const mf = t.fee_absorbed ? (t.management_fee || 0) : 0;
    addRow(acc, tp - (t.service_fee || 0) - mf, tp, t.refund_amount);
  }
  return acc;
}

function r2(n: number): number { return Math.round(n * 100) / 100; }

// ═══════════════════════════════════════════
// TOOL EXECUTORS
// ═══════════════════════════════════════════

async function executeTool(
  toolName: string,
  args: ToolArgs,
  supabase: SupabaseClient,
  venueId: string,
  // Client au JWT de l'appelant : les RPC d'analyse (lot G) décident de la
  // portée et de l'argent sur auth.uid(), jamais le service role.
  userClient?: SupabaseClient,
): Promise<string> {
  try {
    switch (toolName) {

      // ─── ANALYSE (mêmes RPC que les écrans Analytics / Push) ───
      case "get_event_report": {
        if (!userClient) return JSON.stringify({ error: "unavailable" });
        const { data: evt } = await supabase.from("events").select("id").eq("id", args.event_id)
          .or(`venue_id.eq.${venueId},partner_venue_id.eq.${venueId}`).maybeSingle();
        if (!evt) return JSON.stringify({ error: "Event not found for this venue" });
        const { data, error } = await userClient.rpc("get_event_report", { p_event_id: args.event_id });
        if (error) return JSON.stringify({ error: error.message });
        if (!data?.ok) return JSON.stringify({ error: data?.reason || "unavailable" });
        const { series, lines, ...rest } = data;
        return JSON.stringify({
          ...rest,
          lines: (lines || []).slice(0, 20),
          series_last_14_days: (series || []).slice(-14),
          page: `/owner/analytics?tab=sales&view=overview&event=${args.event_id}`,
          note: "Amounts = club revenue (Yuno fees, insurance and refunds deducted); revenue is null when the caller can't see money. d = calendar days before the event (event timezone). Every count is PAID: tickets.orders = number of paid ticket orders (never call them pending), sold = tickets, today = since midnight in the event timezone.",
        }).slice(0, 14000);
      }
      case "get_community_overview": {
        if (!userClient) return JSON.stringify({ error: "unavailable" });
        const [{ data: ov, error: e1 }, { data: tastes }] = await Promise.all([
          userClient.rpc("get_community_overview", { p_venue_id: venueId }),
          userClient.rpc("get_community_tastes", { p_venue_id: venueId }),
        ]);
        if (e1) return JSON.stringify({ error: e1.message });
        if (!ov?.ok) return JSON.stringify({ error: ov?.reason || "unavailable" });
        const { growth, ...rest } = ov;
        return JSON.stringify({
          ...rest,
          growth_last_6_months: (growth?.series || []).slice(-6),
          tastes: tastes?.ok ? { people: tastes.people, known: tastes.known, genres: tastes.genres, hidden_genres: tastes.hidden, threshold: tastes.threshold } : null,
          page: "/owner/analytics?tab=community",
          note: "Music tastes are aggregated: a genre only appears with at least 10 people (quiz answers + genres of events they attended anywhere on Yuno in 18 months). Never describe an individual's tastes.",
        }).slice(0, 12000);
      }
      case "get_push_history": {
        if (!userClient) return JSON.stringify({ error: "unavailable" });
        const filter = oneOf(args.filter, ["all", "manual", "auto", "scheduled"], "all");
        const { data, error } = await userClient.rpc("get_push_campaigns", { p_venue_id: venueId, p_filter: filter, p_limit: 10, p_offset: 0 });
        if (error) return JSON.stringify({ error: error.message });
        if (!data?.ok) return JSON.stringify({ error: data?.reason || "unavailable" });
        return JSON.stringify({
          summary_30_days: data.summary,
          followers: data.followers,
          total_campaigns: data.total,
          latest: (data.campaigns || []).map((c: PushCampaignRow) => ({
            title: c.title, source: c.source, status: c.status, at: c.scheduledAt || c.createdAt, event: c.eventTitle,
            targeted: c.targeted, sent: c.sent, opened: c.taps, buyers: c.buyers, guest_list_entries: c.entries, revenue: c.revenue,
          })),
          page: "/owner/push",
          note: "« Sent » = accepted by Apple, not proof of display. « Opened » = first tap per person. Revenue = tap → purchase within 72 h, club revenue; null when the caller can't see money.",
        });
      }

      // ─── STATS ───
      case "get_venue_stats": {
        const since = getPeriodFilter(args.period || "30d");
        const periodEnd = getPeriodEnd(args.period || "30d");

        const { data: venueEvents } = await supabase.from("events").select("id").eq("venue_id", venueId);
        const eventIds = (venueEvents || []).map((e: IdRow) => e.id);
        const { data: venueZones } = await supabase.from("table_zones").select("id").eq("venue_id", venueId);
        const zoneIds = (venueZones || []).map((z: IdRow) => z.id);

        const ordersData = await fetchAllRows<OrderAmounts>((f, t) => {
          let oq = supabase.from("orders").select("total, service_fee, refund_amount").eq("venue_id", venueId).in("status", ORDER_SALE_STATUSES).gte("created_at", since);
          if (periodEnd) oq = oq.lt("created_at", periodEnd);
          return oq.order("id").range(f, t);
        });

        let ticketsData: TicketAmounts[] = [];
        if (eventIds.length > 0) {
          ticketsData = await fetchAllRows<TicketAmounts>((f, t) => {
            let tq = supabase.from("tickets").select("total_price, service_fee, insurance_fee, refund_amount").in("status", TICKET_SALE_STATUSES).in("event_id", eventIds).gte("created_at", since);
            if (periodEnd) tq = tq.lt("created_at", periodEnd);
            return tq.order("id").range(f, t);
          });
        }
        const ticketsCount = ticketsData.length;

        let tablesData: TableAmounts[] = [];
        if (zoneIds.length > 0) {
          tablesData = await fetchAllRows<TableAmounts>((f, t) => {
            let trq = supabase.from("table_reservations").select("total_price, service_fee, management_fee, fee_absorbed, refund_amount").in("status", TABLE_SALE_STATUSES).in("zone_id", zoneIds).gte("created_at", since);
            if (periodEnd) trq = trq.lt("created_at", periodEnd);
            return trq.order("id").range(f, t);
          });
        }
        const tablesCount = tablesData.length;

        const drinksRes = await supabase.from("drinks").select("id", { count: "exact", head: true }).eq("venue_id", venueId).eq("active", true);

        const ord = calcOrdersRevenue(ordersData);
        const tik = calcTicketsRevenue(ticketsData);
        const tab = calcTablesRevenue(tablesData);

        return JSON.stringify({
          period: args.period,
          orders: { count: ordersData.length, ca_club: r2(ord.caClub), ca_net: r2(ord.caNet) },
          tickets: { count: ticketsCount, ca_club: r2(tik.caClub), ca_net: r2(tik.caNet) },
          tables: { count: tablesCount, ca_club: r2(tab.caClub), ca_net: r2(tab.caNet) },
          active_drinks: drinksRes.count || 0,
          total_ca_club: r2(ord.caClub + tik.caClub + tab.caClub),
          total_ca_net: r2(ord.caNet + tik.caNet + tab.caNet),
        });
      }

      case "get_revenue_breakdown": {
        const since = getPeriodFilter(args.period || "30d");
        const periodEnd = getPeriodEnd(args.period || "30d");

        const { data: venueEvts } = await supabase.from("events").select("id").eq("venue_id", venueId);
        const evtIds = (venueEvts || []).map((e: IdRow) => e.id);
        const { data: venueZns } = await supabase.from("table_zones").select("id").eq("venue_id", venueId);
        const znIds = (venueZns || []).map((z: IdRow) => z.id);

        const ordersData = await fetchAllRows<OrderAmounts>((f, t) => {
          let oq = supabase.from("orders").select("total, service_fee, refund_amount").eq("venue_id", venueId).in("status", ORDER_SALE_STATUSES).gte("created_at", since);
          if (periodEnd) oq = oq.lt("created_at", periodEnd);
          return oq.order("id").range(f, t);
        });

        let ticketsData: TicketAmounts[] = [];
        if (evtIds.length > 0) {
          ticketsData = await fetchAllRows<TicketAmounts>((f, t) => {
            let tq = supabase.from("tickets").select("total_price, service_fee, insurance_fee, refund_amount").in("status", TICKET_SALE_STATUSES).in("event_id", evtIds).gte("created_at", since);
            if (periodEnd) tq = tq.lt("created_at", periodEnd);
            return tq.order("id").range(f, t);
          });
        }

        let tablesData: TableAmounts[] = [];
        if (znIds.length > 0) {
          tablesData = await fetchAllRows<TableAmounts>((f, t) => {
            let trq = supabase.from("table_reservations").select("total_price, service_fee, management_fee, fee_absorbed, refund_amount").in("status", TABLE_SALE_STATUSES).in("zone_id", znIds).gte("created_at", since);
            if (periodEnd) trq = trq.lt("created_at", periodEnd);
            return trq.order("id").range(f, t);
          });
        }

        const ord = calcOrdersRevenue(ordersData);
        const tik = calcTicketsRevenue(ticketsData);
        const tab = calcTablesRevenue(tablesData);

        return JSON.stringify({
          period: args.period,
          orders: { count: ordersData.length, ca_club: r2(ord.caClub), ca_net: r2(ord.caNet) },
          tickets: { count: ticketsData.length, ca_club: r2(tik.caClub), ca_net: r2(tik.caNet) },
          tables: { count: tablesData.length, ca_club: r2(tab.caClub), ca_net: r2(tab.caNet) },
          total_ca_club: r2(ord.caClub + tik.caClub + tab.caClub),
          total_ca_net: r2(ord.caNet + tik.caNet + tab.caNet),
        });
      }

      // ─── EVENTS ───
      case "list_saved_segments": {
        const { data: segs } = await supabase
          .from("venue_segments")
          .select("id, name, definition, created_at")
          .eq("venue_id", venueId)
          .order("created_at", { ascending: false })
          .limit(20);
        const withCounts = await Promise.all((segs || []).map(async (seg: { id: string; name: string; definition: unknown; created_at: string }) => {
          const { data: n } = await supabase.rpc("count_venue_segment", {
            p_venue_id: venueId, p_definition: seg.definition,
          });
          return {
            name: seg.name,
            customers_today: typeof n === "number" ? n : null,
            conditions: Array.isArray((seg.definition as { conditions?: unknown[] })?.conditions)
              ? ((seg.definition as { conditions: unknown[] }).conditions).length
              : 0,
            created_at: seg.created_at,
          };
        }));
        return JSON.stringify({ segments: withCounts, note: "Segments are dynamic: counts are computed live. Owners create them from Clients > filters > Save as segment, and target them in Push and Email campaigns." });
      }

      case "list_events": {
        const filter = args.filter || "upcoming";
        const now = new Date().toISOString();

        let query = supabase
          .from("events")
          .select("id, title, start_at, end_at, is_active, ticketing_enabled, tables_enabled, music_genres, event_type, ticket_selling_mode")
          .eq("venue_id", venueId);

        if (filter === "upcoming") {
          query = query.gte("end_at", now).order("start_at", { ascending: true });
        } else if (filter === "past") {
          query = query.lt("end_at", now).order("start_at", { ascending: false });
        } else {
          query = query.order("start_at", { ascending: false });
        }
        query = query.limit(20);

        const { data } = await query;

        const enriched = await Promise.all((data || []).map(async (e: EventListRow) => {
          const { count } = await supabase.from("tickets").select("id", { count: "exact", head: true }).eq("event_id", e.id).in("status", TICKET_SALE_STATUSES);
          let status = "🔜 À venir";
          if (e.end_at < now) status = "✅ Passée";
          else if (e.start_at <= now && e.end_at >= now) status = "🟢 En cours";
          return {
            ...e,
            music_genres: e.music_genres || [],
            tickets_sold: count || 0,
            event_status: status,
          };
        }));

        return JSON.stringify(enriched);
      }

      case "get_active_event": {
        const now = new Date().toISOString();
        const eventSelect = "id, title, start_at, end_at, is_active, ticketing_enabled, tables_enabled, music_genres, event_type, ticket_selling_mode";
        // Try ongoing first
        const { data: ongoing } = await supabase
          .from("events")
          .select(eventSelect)
          .eq("venue_id", venueId)
          .lte("start_at", now)
          .gte("end_at", now)
          .limit(1)
          .maybeSingle();

        if (ongoing) {
          return JSON.stringify({ ...ongoing, music_genres: ongoing.music_genres || [], event_status: "🟢 En cours" });
        }

        // Fallback: next upcoming
        const { data: next } = await supabase
          .from("events")
          .select(eventSelect)
          .eq("venue_id", venueId)
          .gt("start_at", now)
          .order("start_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (next) {
          return JSON.stringify({ ...next, music_genres: next.music_genres || [], event_status: "🔜 À venir" });
        }

        return JSON.stringify({ message: "Aucun événement en cours ou à venir." });
      }

      case "get_tonight_stats": {
        const now = new Date();
        const parisOffset = getParisOffsetMs(now);
        const parisNow = new Date(now.getTime() + parisOffset);

        // Tonight window in Paris time: 18:00 → 06:00
        const tonightStartParis = new Date(parisNow);
        tonightStartParis.setHours(18, 0, 0, 0);
        if (parisNow.getHours() < 6) {
          tonightStartParis.setDate(tonightStartParis.getDate() - 1);
        }
        const tonightEndParis = new Date(tonightStartParis);
        tonightEndParis.setDate(tonightEndParis.getDate() + 1);
        tonightEndParis.setHours(6, 0, 0, 0);

        // Convert back to UTC
        const since = new Date(tonightStartParis.getTime() - parisOffset).toISOString();
        const until = new Date(tonightEndParis.getTime() - parisOffset).toISOString();

        const { data: venueEvents } = await supabase.from("events").select("id").eq("venue_id", venueId);
        const eventIds = (venueEvents || []).map((e: IdRow) => e.id);
        const { data: venueZones } = await supabase.from("table_zones").select("id").eq("venue_id", venueId);
        const zoneIds = (venueZones || []).map((z: IdRow) => z.id);

        const ordersData = await fetchAllRows<OrderAmounts>((f, t) => supabase.from("orders").select("total, service_fee, refund_amount").eq("venue_id", venueId).in("status", ORDER_SALE_STATUSES).gte("created_at", since).lt("created_at", until).order("id").range(f, t));
        const pendingRes = await supabase.from("orders").select("id", { count: "exact", head: true }).eq("venue_id", venueId).eq("status", "paid").is("served_at", null).gte("created_at", since).lt("created_at", until);

        let ticketsData: (TicketAmounts & { entry_scanned: boolean | null })[] = [];
        let ticketsScanned = 0;
        if (eventIds.length > 0) {
          ticketsData = await fetchAllRows<TicketAmounts & { entry_scanned: boolean | null }>((f, t) => supabase.from("tickets").select("total_price, service_fee, insurance_fee, refund_amount, entry_scanned").in("status", TICKET_SALE_STATUSES).in("event_id", eventIds).gte("created_at", since).lt("created_at", until).order("id").range(f, t));
          ticketsScanned = ticketsData.filter((t) => t.entry_scanned).length;
        }

        let tablesData: TableAmounts[] = [];
        if (zoneIds.length > 0) {
          tablesData = await fetchAllRows<TableAmounts>((f, t) => supabase.from("table_reservations").select("total_price, service_fee, management_fee, fee_absorbed, refund_amount").in("status", TABLE_SALE_STATUSES).in("zone_id", zoneIds).gte("created_at", since).lt("created_at", until).order("id").range(f, t));
        }

        const ord = calcOrdersRevenue(ordersData);
        const tik = calcTicketsRevenue(ticketsData);
        const tab = calcTablesRevenue(tablesData);

        return JSON.stringify({
          window: { from: since, to: until },
          orders: { count: ordersData.length, pending: pendingRes.count || 0, ca_club: r2(ord.caClub), ca_net: r2(ord.caNet) },
          tickets: { sold: ticketsData.length, scanned: ticketsScanned, ca_club: r2(tik.caClub), ca_net: r2(tik.caNet) },
          tables: { count: tablesData.length, ca_club: r2(tab.caClub), ca_net: r2(tab.caNet) },
          total_ca_club: r2(ord.caClub + tik.caClub + tab.caClub),
          total_ca_net: r2(ord.caNet + tik.caNet + tab.caNet),
        });
      }

      case "get_pending_orders": {
        const { data, count } = await supabase
          .from("orders")
          .select("id, order_number, total, items, created_at", { count: "exact" })
          .eq("venue_id", venueId)
          .eq("status", "paid")
          .is("served_at", null)
          .order("created_at", { ascending: true })
          .limit(20);

        return JSON.stringify({
          pending_count: count || 0,
          orders: (data || []).map((o: PendingOrderRow) => {
            const items: OrderItem[] = Array.isArray(o.items) ? o.items : [];
            const itemNames = items.map((i) => {
              const name = i.name || i.drink_name || "?";
              const qty = i.qty || i.quantity || 1;
              return qty > 1 ? `${name} x${qty}` : name;
            }).join(", ");
            return {
              order_number: o.order_number,
              total: o.total,
              items_summary: itemNames,
              items_count: items.length,
              created_at: o.created_at,
            };
          }),
        });
      }

      case "get_live_ops": {
        // État complet du centre de commandement — même fenêtre de nuit Paris
        // que get_tonight_stats, JSON compact (le modèle n'a pas besoin du
        // détail ligne à ligne).
        const now = new Date();
        const parisOffset = getParisOffsetMs(now);
        const parisNow = new Date(now.getTime() + parisOffset);
        const tonightStartParis = new Date(parisNow);
        tonightStartParis.setHours(18, 0, 0, 0);
        if (parisNow.getHours() < 6) tonightStartParis.setDate(tonightStartParis.getDate() - 1);
        const since = new Date(tonightStartParis.getTime() - parisOffset).toISOString();
        const nowIso = now.toISOString();

        const { data: activeEvt } = await supabase
          .from("events").select("id, title, start_at, end_at")
          .eq("venue_id", venueId).eq("is_active", true)
          .lte("start_at", nowIso).gte("end_at", nowIso)
          .order("start_at").limit(1).maybeSingle();

        const [ordersRes, tablesRes, opsRes, stockRes, alertsRes, cloakRes] = await Promise.all([
          supabase.from("orders")
            .select("id, order_number, status, prep_status, created_at, ready_at, refunded_at")
            .eq("venue_id", venueId).gte("created_at", since),
          activeEvt
            ? supabase.from("table_reservations")
                .select("id, full_name, status, checked_in_at, entry_scanned, minimum_spend")
                .eq("event_id", activeEvt.id).neq("status", "cancelled")
            : Promise.resolve({ data: [] }),
          supabase.from("night_ops_events")
            .select("kind, note, created_at")
            .eq("venue_id", venueId).gte("created_at", since)
            .order("created_at", { ascending: false }).limit(30),
          supabase.from("drinks").select("name").eq("venue_id", venueId).eq("out_of_stock", true),
          supabase.from("staff_notifications")
            .select("notification_type, title, created_at")
            .eq("venue_id", venueId).like("notification_type", "liveops_%")
            .gte("created_at", since).order("created_at", { ascending: false }).limit(10),
          supabase.from("cloakroom_transactions")
            .select("retrieved").eq("venue_id", venueId).gte("created_at", since),
        ]);

        const orders: LiveOrderRow[] = ordersRes.data || [];
        const tables: LiveTableRow[] = tablesRes.data || [];
        const backlog = orders.filter((o) => o.status === "paid" && !o.refunded_at && (!o.prep_status || o.prep_status === "queue" || o.prep_status === "preparing"));
        const oldestWaiting = backlog.reduce<string | null>((min, o) => (min === null || o.created_at < min ? o.created_at : min), null);

        let scannedEntries = 0;
        let recentEntries = 0;
        if (activeEvt) {
          const tenMinAgo = new Date(now.getTime() - 10 * 60_000).toISOString();
          const { data: scans } = await supabase.from("tickets")
            .select("entry_scanned_at").eq("event_id", activeEvt.id)
            .eq("status", "paid").eq("entry_scanned", true);
          scannedEntries = (scans || []).length;
          recentEntries = (scans || []).filter((t: { entry_scanned_at: string | null }) => t.entry_scanned_at && t.entry_scanned_at >= tenMinAgo).length;
        }

        let vipSpend: Record<string, number> = {};
        if (tables.length > 0) {
          const { data: cons } = await supabase.from("vip_consumptions")
            .select("table_reservation_id, total_price")
            .eq("venue_id", venueId).gte("served_at", since);
          vipSpend = (cons || []).reduce((acc: Record<string, number>, c: { table_reservation_id: string; total_price: Amount }) => {
            acc[c.table_reservation_id] = (acc[c.table_reservation_id] || 0) + Number(c.total_price || 0);
            return acc;
          }, {});
        }
        const arrivedTables = tables.filter((t) => t.checked_in_at || t.entry_scanned);
        const atRisk = arrivedTables
          .filter((t) => Number(t.minimum_spend || 0) > 0 && (vipSpend[t.id] || 0) < Number(t.minimum_spend) * 0.6)
          .map((t) => ({ name: t.full_name || "VIP", spent: r2(vipSpend[t.id] || 0), minimum: r2(Number(t.minimum_spend)) }));

        const ops: NightOpsRow[] = opsRes.data || [];
        const cloak: { retrieved: boolean | null }[] = cloakRes.data || [];

        return JSON.stringify({
          active_event: activeEvt ? { title: activeEvt.title, start_at: activeEvt.start_at, end_at: activeEvt.end_at } : null,
          door: {
            entries_scanned: scannedEntries + arrivedTables.length,
            entries_last_10min: recentEntries,
            vip_no_shows: tables.length - arrivedTables.length,
          },
          bar: {
            backlog: backlog.length,
            oldest_waiting_minutes: oldestWaiting ? Math.floor((now.getTime() - new Date(oldestWaiting).getTime()) / 60_000) : null,
            out_of_stock: (stockRes.data || []).map((d: { name: string }) => d.name),
          },
          vip: {
            tables_total: tables.length,
            tables_arrived: arrivedTables.length,
            min_spend_at_risk: atRisk.slice(0, 5),
          },
          cloakroom: { active: cloak.filter((c) => !c.retrieved).length, retrieved: cloak.filter((c) => c.retrieved).length },
          staff_shift_starts: ops.filter((e) => e.kind === "shift_start").map((e) => e.note).filter(Boolean),
          incidents: ops.filter((e) => e.kind !== "shift_start").map((e) => ({ kind: e.kind, at: e.created_at })),
          alerts_tonight: (alertsRes.data || []).map((a: { notification_type: string; title: string; created_at: string }) => ({ type: a.notification_type, title: a.title, at: a.created_at })),
        });
      }

      // ─── TICKET ROUNDS ───
      case "list_ticket_rounds": {
        const { data: evt } = await supabase.from("events").select("id").eq("id", args.event_id).eq("venue_id", venueId).maybeSingle();
        if (!evt) return JSON.stringify({ error: "Event not found for this venue" });
        const { data } = await supabase.from("ticket_rounds").select("id, name, price, max_tickets, tickets_sold, is_active, position").eq("event_id", args.event_id).order("position");
        return JSON.stringify(data || []);
      }

      case "activate_ticket_round": {
        const { data: round } = await supabase.from("ticket_rounds").select("id, event_id").eq("id", args.round_id).maybeSingle();
        if (!round) return JSON.stringify({ error: "Round not found" });
        const { data: evt } = await supabase.from("events").select("id").eq("id", round.event_id).eq("venue_id", venueId).maybeSingle();
        if (!evt) return JSON.stringify({ error: "Event not found for this venue" });
        const { error } = await supabase.from("ticket_rounds").update({ is_active: args.activate }).eq("id", args.round_id);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, round_id: args.round_id, is_active: args.activate });
      }

      // ─── DRINKS ───
      case "list_drinks": {
        const { data } = await supabase.from("drinks").select("id, name, price, promo_price, active, collection, presale_active, presale_price").eq("venue_id", venueId).order("collection").order("name");
        return JSON.stringify(data || []);
      }

      case "toggle_drink": {
        const { data: drink } = await supabase.from("drinks").select("id, name").eq("id", args.drink_id).eq("venue_id", venueId).maybeSingle();
        if (!drink) return JSON.stringify({ error: "Drink not found for this venue" });
        const { error } = await supabase.from("drinks").update({ active: args.active }).eq("id", args.drink_id);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, drink: drink.name, active: args.active });
      }

      case "update_drink_price": {
        const { data: drink } = await supabase.from("drinks").select("id, name, price").eq("id", args.drink_id).eq("venue_id", venueId).maybeSingle();
        if (!drink) return JSON.stringify({ error: "Drink not found for this venue" });
        const updates: { price?: number; promo_price?: number } = { price: args.price };
        if (args.promo_price !== undefined) updates.promo_price = args.promo_price;
        const { error } = await supabase.from("drinks").update(updates).eq("id", args.drink_id);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, drink: drink.name, old_price: drink.price, new_price: args.price });
      }

      case "toggle_post_checkout_upsell": {
        // Page upsell boissons post-achat billet (voir docs/SYSTEME_VENTE_BOISSONS.md).
        const { error } = await supabase.from("venues").update({ post_checkout_upsell_enabled: args.enabled === true }).eq("id", venueId);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, post_checkout_upsell_enabled: args.enabled === true });
      }

      // ─── STAFF ───
      case "get_staff_list": {
        const { data } = await supabase.from("profiles").select("id, first_name, last_name, email").eq("venue_id", venueId);
        if (!data || data.length === 0) return JSON.stringify([]);
        const userIds = data.map((p: StaffProfileRow) => p.id);
        const { data: roles } = await supabase.from("user_roles").select("user_id, role").in("user_id", userIds).in("role", ["barman", "bouncer", "vip_host", "cloakroom", "manager"]);
        const staffWithRoles = data.map((p: StaffProfileRow) => ({ ...p, roles: (roles || []).filter((r: RoleRow & { user_id: string }) => r.user_id === p.id).map((r: RoleRow) => r.role) })).filter((p) => p.roles.length > 0);
        return JSON.stringify(staffWithRoles);
      }

      // ─── RESERVATIONS ───
      case "list_reservations": {
        let eventId = args.event_id;
        if (!eventId) {
          const { data: nextEvt } = await supabase.from("events").select("id").eq("venue_id", venueId).gte("start_at", new Date().toISOString()).order("start_at").limit(1).maybeSingle();
          eventId = nextEvt?.id;
        }
        if (!eventId) return JSON.stringify({ message: "No upcoming event found" });
        const { data: zones } = await supabase.from("table_zones").select("id").eq("venue_id", venueId);
        if (!zones || zones.length === 0) return JSON.stringify([]);
        const zoneIds = zones.map((z: IdRow) => z.id);
        const { data } = await supabase.from("table_reservations").select("id, full_name, status, total_price, zone_id, created_at").in("zone_id", zoneIds).eq("event_id", eventId).order("created_at", { ascending: false });
        return JSON.stringify(data || []);
      }

      // ─── EVENT DETAILS (with revenue) ───
      case "get_event_lineup": {
        const { data: evt } = await supabase.from("events").select("id, title").eq("id", args.event_id).eq("venue_id", venueId).maybeSingle();
        if (!evt) return JSON.stringify({ error: "Event not found" });

        const [djLinksRes, guestsRes] = await Promise.all([
          supabase.from("event_djs").select("dj_id").eq("event_id", args.event_id),
          supabase.from("event_guest_artists")
            .select("name, instagram_handle, instagram_clicks")
            .eq("event_id", args.event_id).order("position"),
        ]);

        const djIds = (djLinksRes.data || []).map((d: { dj_id: string | null }) => d.dj_id).filter(Boolean);
        let djNames: string[] = [];
        if (djIds.length > 0) {
          const { data: djRows } = await supabase.from("djs").select("id, stage_name, first_name, last_name").in("id", djIds);
          djNames = (djRows || []).map((d: { stage_name: string | null; first_name: string | null; last_name: string | null }) => d.stage_name || `${d.first_name || ""} ${d.last_name || ""}`.trim()).filter(Boolean);
        }

        const guests = (guestsRes.data || []).map((g: { name: string; instagram_handle: string | null; instagram_clicks: number | null }) => ({
          name: g.name,
          instagram: g.instagram_handle ? `@${g.instagram_handle}` : null,
          instagram_clicks: g.instagram_clicks ?? 0,
        }));

        return JSON.stringify({
          event: evt.title,
          yuno_djs: djNames,
          guest_artists: guests,
          total_instagram_clicks: guests.reduce((sum: number, g: { instagram_clicks: number }) => sum + g.instagram_clicks, 0),
          note: "guest_artists = artistes sans compte Yuno, ajoutés à la main sur la fiche de la soirée. instagram_clicks = clics sortants depuis l'affiche publique, dédupliqués par visiteur sur 30 minutes.",
        });
      }

      case "get_event_details": {
        const { data: evt } = await supabase.from("events").select("*").eq("id", args.event_id).eq("venue_id", venueId).maybeSingle();
        if (!evt) return JSON.stringify({ error: "Event not found" });

        // Fetch ticket rounds, tickets data, orders, and table zones in parallel
        const { data: zones } = await supabase.from("table_zones").select("id").eq("venue_id", venueId);
        const zoneIds = (zones || []).map((z: IdRow) => z.id);

        const [roundsRes, ticketsRows, ordersRows, tablesRows] = await Promise.all([
          supabase.from("ticket_rounds").select("id, name, price, max_tickets, tickets_sold, is_active").eq("event_id", args.event_id).order("position"),
          fetchAllRows<TicketAmounts>((f, t) => supabase.from("tickets").select("total_price, service_fee, insurance_fee, refund_amount").eq("event_id", args.event_id).in("status", TICKET_SALE_STATUSES).order("id").range(f, t)),
          fetchAllRows<OrderAmounts>((f, t) => supabase.from("orders").select("total, service_fee, refund_amount").eq("event_id", args.event_id).eq("venue_id", venueId).in("status", ORDER_SALE_STATUSES).order("id").range(f, t)),
          zoneIds.length > 0
            ? fetchAllRows<TableAmounts>((f, t) => supabase.from("table_reservations").select("total_price, service_fee, management_fee, fee_absorbed, refund_amount").eq("event_id", args.event_id).in("status", TABLE_SALE_STATUSES).in("zone_id", zoneIds).order("id").range(f, t))
            : Promise.resolve([] as TableAmounts[]),
        ]);

        const tik = calcTicketsRevenue(ticketsRows);
        const ord = calcOrdersRevenue(ordersRows);
        const tab = calcTablesRevenue(tablesRows);

        const now = new Date().toISOString();
        let status = "🔜 À venir";
        if (evt.end_at < now) status = "✅ Passée";
        else if (evt.start_at <= now && evt.end_at >= now) status = "🟢 En cours";

        return JSON.stringify({
          event: {
            id: evt.id, title: evt.title, start_at: evt.start_at, end_at: evt.end_at,
            is_active: evt.is_active, ticketing_enabled: evt.ticketing_enabled,
            tables_enabled: evt.tables_enabled, music_genres: evt.music_genres || [],
            event_type: evt.event_type, description: evt.description,
            ticket_selling_mode: evt.ticket_selling_mode, event_status: status,
          },
          ticket_rounds: roundsRes.data || [],
          tickets_sold: ticketsRows.length,
          revenue: {
            orders: { count: ordersRows.length, ca_club: r2(ord.caClub), ca_net: r2(ord.caNet) },
            tickets: { count: ticketsRows.length, ca_club: r2(tik.caClub), ca_net: r2(tik.caNet) },
            tables: { count: tablesRows.length, ca_club: r2(tab.caClub), ca_net: r2(tab.caNet) },
            total_ca_club: r2(ord.caClub + tik.caClub + tab.caClub),
            total_ca_net: r2(ord.caNet + tik.caNet + tab.caNet),
          },
        });
      }

      // ─── EVENT REVENUE (standalone) ───
      case "get_event_revenue": {
        const { data: evt } = await supabase.from("events").select("id, title").eq("id", args.event_id).eq("venue_id", venueId).maybeSingle();
        if (!evt) return JSON.stringify({ error: "Event not found for this venue" });

        const { data: zones } = await supabase.from("table_zones").select("id").eq("venue_id", venueId);
        const zoneIds = (zones || []).map((z: IdRow) => z.id);

        const [ticketsRows, ordersRows, tablesRows] = await Promise.all([
          fetchAllRows<TicketAmounts>((f, t) => supabase.from("tickets").select("total_price, service_fee, insurance_fee, refund_amount").eq("event_id", args.event_id).in("status", TICKET_SALE_STATUSES).order("id").range(f, t)),
          fetchAllRows<OrderAmounts>((f, t) => supabase.from("orders").select("total, service_fee, refund_amount").eq("event_id", args.event_id).eq("venue_id", venueId).in("status", ORDER_SALE_STATUSES).order("id").range(f, t)),
          zoneIds.length > 0
            ? fetchAllRows<TableAmounts>((f, t) => supabase.from("table_reservations").select("total_price, service_fee, management_fee, fee_absorbed, refund_amount").eq("event_id", args.event_id).in("status", TABLE_SALE_STATUSES).in("zone_id", zoneIds).order("id").range(f, t))
            : Promise.resolve([] as TableAmounts[]),
        ]);

        const tik = calcTicketsRevenue(ticketsRows);
        const ord = calcOrdersRevenue(ordersRows);
        const tab = calcTablesRevenue(tablesRows);

        return JSON.stringify({
          event_id: args.event_id,
          event_title: evt.title,
          orders: { count: ordersRows.length, ca_club: r2(ord.caClub), ca_net: r2(ord.caNet) },
          tickets: { count: ticketsRows.length, ca_club: r2(tik.caClub), ca_net: r2(tik.caNet) },
          tables: { count: tablesRows.length, ca_club: r2(tab.caClub), ca_net: r2(tab.caNet) },
          total_ca_club: r2(ord.caClub + tik.caClub + tab.caClub),
          total_ca_net: r2(ord.caNet + tik.caNet + tab.caNet),
        });
      }

      // ─── EVENT WRITE ACTIONS ───
      case "toggle_event_ticketing": {
        const { data: evt } = await supabase.from("events").select("id").eq("id", args.event_id).eq("venue_id", venueId).maybeSingle();
        if (!evt) return JSON.stringify({ error: "Event not found for this venue" });
        const { error } = await supabase.from("events").update({ ticketing_enabled: args.enabled }).eq("id", args.event_id);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, event_id: args.event_id, ticketing_enabled: args.enabled });
      }

      case "toggle_event_tables": {
        const { data: evt } = await supabase.from("events").select("id, title").eq("id", args.event_id).eq("venue_id", venueId).maybeSingle();
        if (!evt) return JSON.stringify({ error: "Event not found for this venue" });
        const { error } = await supabase.from("events").update({ tables_enabled: args.enabled }).eq("id", args.event_id);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, event_id: args.event_id, event_title: evt.title, tables_enabled: args.enabled });
      }

      case "update_event": {
        const { data: evt } = await supabase.from("events").select("id, title").eq("id", args.event_id).eq("venue_id", venueId).maybeSingle();
        if (!evt) return JSON.stringify({ error: "Event not found for this venue" });
        const updates: { title?: string; description?: string; music_genres?: string[]; music_genre?: string } = {};
        if (args.title) updates.title = args.title;
        if (args.description !== undefined) updates.description = args.description;
        if (args.music_genres && Array.isArray(args.music_genres)) {
          updates.music_genres = args.music_genres;
          // Rétrocompat: also write old field
          updates.music_genre = args.music_genres.join(", ");
        }
        if (Object.keys(updates).length === 0) return JSON.stringify({ error: "No fields to update" });
        const { error } = await supabase.from("events").update(updates).eq("id", args.event_id);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, event_id: args.event_id, updated_fields: Object.keys(updates) });
      }

      // ─── AUTOMATISATIONS EMAIL ───
      case "list_email_automations": {
        // Ces RPC gardent leur portée sur auth.uid() : au client de service
        // elles répondaient toujours « Unauthorized ». Client de l'appelant.
        const reader = userClient ?? supabase;
        const { data: stats, error } = await reader.rpc("get_email_automation_stats", { p_venue_id: venueId, p_organizer_user_id: null });
        if (error) return JSON.stringify({ error: error.message });
        const rows = (stats || []) as EmailAutomationStatRow[];
        const KINDS = ["new_event", "abandoned_checkout", "tier_closing", "last_call", "table_upsell", "post_event_thanks", "post_event_missed", "regular_lapse", "welcome", "win_back"];
        const byKind: Record<string, EmailAutomationStatRow> = {};
        for (const r of rows) byKind[r.kind] = r;
        // Qui Yuno cible maintenant (compte, jamais de liste) + suggestions.
        const [previews, { data: suggestions }] = await Promise.all([
          Promise.all(KINDS.map(async (kind) => {
            const { data } = await reader.rpc("preview_email_automation", { p_venue_id: venueId, p_organizer_user_id: null, p_kind: kind });
            return [kind, data] as const;
          })),
          reader.rpc("get_email_automation_suggestions", { p_venue_id: venueId, p_organizer_user_id: null }),
        ]);
        const previewByKind: Record<string, EmailAutomationPreview | null> = Object.fromEntries(previews);
        const out = KINDS.map((kind) => {
          const r = byKind[kind];
          const pv = previewByKind[kind] || null;
          const targets = pv ? { eligible_now: pv.eligible, base: pv.base, next_event: pv.next_event_title || null, next_send_at: pv.next_due_at || null } : null;
          if (!r) return { kind, configured: false, enabled: false, targets };
          return {
            kind, configured: true, enabled: !!r.enabled, delay_hours: r.delay_hours,
            threshold_pct: kind === "tier_closing" ? r.threshold_pct : undefined,
            has_template: !!r.template_id, subject_override: r.subject || null, targets,
            report: { pending: r.pending, in_flight: r.in_flight, queued: r.queued, sent: r.sent, opens: r.opens, clickers: r.clickers, unsubscribes: r.unsubscribes, campaigns: r.campaigns, skipped: r.skipped },
          };
        });
        return JSON.stringify({
          automations: out,
          suggestions: Array.isArray(suggestions) ? suggestions : [],
          page: "/owner/campaigns/automations",
          note: "A recipe without template sends nothing: the owner creates it from the Automations page (« Créer le modèle Yuno », or « Allumer » on a suggestion). The owner never picks the audience: Yuno computes it (opt-in base: purchases, guest list, form, imported files), excludes at send time anyone who already has a spot, and serves the most engaged first when the daily quota is short. Delays: abandoned_checkout hours after checkout, last_call and table_upsell hours BEFORE start, new_event hours after publication, post_event_* hours after end, welcome hours after signup, win_back hours since last visit (2160 = 90 days); regular_lapse hours of silence of a REGULAR (4 nights in the 60 days before their last visit), 1008 = 6 weeks, each recipient getting the upcoming night that matches their tastes (same series, genres, weekday); tier_closing uses threshold_pct instead of a delay.",
        });
      }
      case "set_email_automation": {
        const kind = String(args.kind || "");
        const KINDS = ["new_event", "abandoned_checkout", "tier_closing", "last_call", "table_upsell", "post_event_thanks", "post_event_missed", "regular_lapse", "welcome", "win_back"];
        if (!KINDS.includes(kind)) return JSON.stringify({ error: "Unknown recipe kind" });
        const { data: existing } = await supabase.from("email_automations").select("id, enabled, template_id, delay_hours").eq("venue_id", venueId).eq("kind", kind).maybeSingle();
        const patch: Record<string, unknown> = {};
        if (typeof args.enabled === "boolean") patch.enabled = args.enabled;
        if (kind !== "tier_closing" && Number.isFinite(Number(args.delay_hours)) && Number(args.delay_hours) > 0) patch.delay_hours = Math.min(8760, Math.max(1, Math.round(Number(args.delay_hours))));
        if (kind === "tier_closing" && [75, 85, 95].includes(Number(args.threshold_pct))) patch.threshold_pct = Number(args.threshold_pct);
        if (patch.enabled === true && !existing?.template_id) {
          return JSON.stringify({ error: "no_template", message: "This recipe has no email template yet. Ask the owner to open /owner/campaigns/automations and click « Créer le modèle Yuno » on the recipe — enabling it there creates the template in one click." });
        }
        if (existing) {
          const { error } = await supabase.from("email_automations").update(patch).eq("id", existing.id);
          if (error) return JSON.stringify({ error: error.message });
        } else {
          const { error } = await supabase.from("email_automations").insert({ venue_id: venueId, kind, enabled: false, ...patch });
          if (error) return JSON.stringify({ error: error.message });
        }
        return JSON.stringify({ success: true, kind, ...patch, page: "/owner/campaigns/automations" });
      }

      case "toggle_guest_list": {
        const { data: evt } = await supabase.from("events").select("id").eq("id", args.event_id).eq("venue_id", venueId).maybeSingle();
        if (!evt) return JSON.stringify({ error: "Event not found for this venue" });
        // dj_id IS NULL = the host's own list (DJ-scoped lists are separate rows now).
        const { data: gl } = await supabase.from("guest_lists").select("id").eq("event_id", args.event_id).is("dj_id", null).maybeSingle();
        if (!gl) return JSON.stringify({ error: "No guest list configured for this event." });
        const { error } = await supabase.from("guest_lists").update({ is_active: args.active }).eq("id", gl.id);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, event_id: args.event_id, guest_list_active: args.active });
      }

      // ─── ÉQUIPE ───
      case "set_night_brief": {
        // Réplique d'upsert_staff_brief pour le client service-role (auth.uid()
        // absent) : le périmètre venue est déjà garanti par l'appelant.
        const body = (args.body || "").trim();
        const { data: nightDate } = await supabase.rpc("paris_night_date");
        if (!nightDate) return JSON.stringify({ error: "could not resolve night date" });

        if (!body) {
          await supabase.from("staff_briefs").delete().eq("venue_id", venueId).eq("night_date", nightDate);
          return JSON.stringify({ success: true, cleared: true });
        }
        if (body.length > 800) return JSON.stringify({ error: "Brief too long (800 chars max)" });

        const { data: venue } = await supabase.from("venues").select("owner_id").eq("id", venueId).maybeSingle();
        if (!venue) return JSON.stringify({ error: "Venue not found" });

        const { error: upErr } = await supabase.from("staff_briefs").upsert(
          { venue_id: venueId, night_date: nightDate, body, updated_by: venue.owner_id, updated_at: new Date().toISOString() },
          { onConflict: "venue_id,night_date" },
        );
        if (upErr) return JSON.stringify({ error: upErr.message });

        // Réveil du staff terrain, throttlé à 15 min (même règle que la RPC).
        const { data: lastNotif } = await supabase
          .from("staff_notifications").select("created_at")
          .eq("venue_id", venueId).eq("notification_type", "night_brief")
          .gte("created_at", new Date(Date.now() - 15 * 60 * 1000).toISOString())
          .limit(1);
        if (!lastNotif?.length) {
          const rows = ["bouncer", "barman", "cloakroom", "vip_host"].map((role) => ({
            venue_id: venueId, target_role: role, notification_type: "night_brief",
            title: "Consigne du soir", message: body.slice(0, 180), priority: "high",
            metadata: { body_preview: body.slice(0, 140) },
          }));
          await supabase.from("staff_notifications").insert(rows);
        }
        return JSON.stringify({ success: true, night_date: nightDate, body_length: body.length });
      }

      // ─── ONBOARDING ───
      case "get_onboarding_status": {
        const { data } = await supabase.from("venue_onboarding").select("current_step, steps").eq("venue_id", venueId).maybeSingle();
        const { data: venue } = await supabase.from("venues").select("stripe_account_id, name").eq("id", venueId).maybeSingle();
        // `steps` = { "<n>": { status, completed_at } } : les étapes cochées.
        const steps = (data?.steps ?? {}) as Record<string, { status?: string }>;
        return JSON.stringify({
          current_step: data?.current_step || "not_started",
          completed_steps: Object.keys(steps).filter((k) => steps[k]?.status === "completed").map(Number).sort((a, b) => a - b),
          stripe_connected: !!venue?.stripe_account_id,
          venue_name: venue?.name,
        });
      }

      // ─── HELP ───
      case "search_help_articles": {
        const query = (args.query || "").toLowerCase();
        const tokens = query.split(/\s+/).filter(Boolean);

        const scored = Object.entries(HELP_ARTICLES).map(([id, article]) => {
          let score = 0;
          for (const token of tokens) {
            if (article.title.toLowerCase().includes(token)) score += 10;
            if (article.keywords.some(k => k.toLowerCase().includes(token))) score += 5;
          }
          return { id, ...article, score };
        }).filter(a => a.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);

        if (scored.length === 0) {
          return JSON.stringify({ message: "Aucun article trouvé. L'owner peut consulter le [Mode d'emploi](/owner/help)." });
        }

        return JSON.stringify({
          results: scored.map(a => ({
            title: a.title,
            path: a.path,
            snippet: a.snippet,
          })),
        });
      }

      // ─── CUSTOMER INSIGHTS ───
      case "get_customer_insights": {
        const limit = args.limit || 10;
        const [topCustomers, totalCustomers] = await Promise.all([
          supabase.from("venue_customers").select("id, first_name, last_name, email, total_spent, order_count, ticket_count, table_count, last_visit_at").eq("venue_id", venueId).order("total_spent", { ascending: false }).limit(limit),
          fetchAllRows<{ total_spent: Amount }>((f, t) => supabase.from("venue_customers").select("total_spent").eq("venue_id", venueId).order("id").range(f, t)),
        ]);
        const customers = totalCustomers;
        const totalSpent = customers.reduce((s: number, c: { total_spent: Amount }) => s + (c.total_spent || 0), 0);
        const avgSpent = customers.length > 0 ? totalSpent / customers.length : 0;
        const segments = {
          platinum: customers.filter((c: { total_spent: Amount }) => (c.total_spent || 0) >= 1000).length,
          gold: customers.filter((c: { total_spent: Amount }) => (c.total_spent || 0) >= 500 && (c.total_spent || 0) < 1000).length,
          silver: customers.filter((c: { total_spent: Amount }) => (c.total_spent || 0) >= 200 && (c.total_spent || 0) < 500).length,
          bronze: customers.filter((c: { total_spent: Amount }) => (c.total_spent || 0) < 200).length,
        };
        return JSON.stringify({
          total_customers: customers.length,
          // Dépense cumulée des clients (ce qu'ils ont payé, frais Yuno compris) :
          // une grandeur CRM, jamais le CA du club.
          total_customer_spend: r2(totalSpent),
          average_customer_spend: r2(avgSpent),
          segments,
          top_customers: (topCustomers.data || []).map((c: VenueCustomerRow) => ({
            name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email,
            total_spent: c.total_spent,
            orders: c.order_count,
            tickets: c.ticket_count,
            tables: c.table_count,
          })),
        });
      }

      // ─── TOP DRINKS ───
      case "get_top_drinks": {
        const since = getPeriodFilter(args.period || "30d");
        const orders = await fetchAllRows<{ items: unknown }>((f, t) => supabase.from("orders").select("items").eq("venue_id", venueId).in("status", ORDER_SALE_STATUSES).gte("created_at", since).order("id").range(f, t));
        if (orders.length === 0) return JSON.stringify({ message: "Aucune commande pour cette période", top_drinks: [] });
        const drinkSales: Record<string, { name: string; qty: number; revenue: number }> = {};
        for (const order of orders) {
          const items = order.items as OrderItem[];
          if (!items) continue;
          for (const item of items) {
            const name = item.name || item.drink_name || "Unknown";
            const qty = item.qty || item.quantity || 1;
            const price = item.price || item.unit_price || 0;
            if (!drinkSales[name]) drinkSales[name] = { name, qty: 0, revenue: 0 };
            drinkSales[name].qty += qty;
            drinkSales[name].revenue += qty * price;
          }
        }
        const sorted = Object.values(drinkSales).sort((a, b) => b.qty - a.qty).slice(0, 10);
        return JSON.stringify({ period: args.period, top_drinks: sorted });
      }

      // ─── CHECKLIST ───
      case "get_checklist": {
        const [eventsRes, drinksRes, staffRes, venueRes] = await Promise.all([
          supabase.from("events").select("id, title, start_at, ticketing_enabled, tables_enabled, ticket_selling_mode").eq("venue_id", venueId).gte("start_at", new Date().toISOString()).order("start_at").limit(1).maybeSingle(),
          supabase.from("drinks").select("id", { count: "exact", head: true }).eq("venue_id", venueId).eq("active", true),
          supabase.from("profiles").select("id", { count: "exact", head: true }).eq("venue_id", venueId),
          supabase.from("venues").select("stripe_account_id").eq("id", venueId).maybeSingle(),
        ]);
        const checklist: { item: string; status: string; detail: string }[] = [];
        checklist.push(venueRes.data?.stripe_account_id ? { item: "Stripe Connect", status: "ok", detail: "Connecté ✅" } : { item: "Stripe Connect", status: "missing", detail: "Non connecté — impossible de vendre !" });
        if (eventsRes.data) {
          checklist.push({ item: "Prochain event", status: "ok", detail: `${eventsRes.data.title} le ${eventsRes.data.start_at}` });
          const modeLabel = eventsRes.data.ticket_selling_mode === "rounds" ? "Rounds" : eventsRes.data.ticket_selling_mode === "timed_entry" ? "Créneaux horaires" : eventsRes.data.ticket_selling_mode === "free" ? "Libre" : "Simple";
          checklist.push(eventsRes.data.ticketing_enabled ? { item: "Billetterie", status: "ok", detail: `Activée (mode ${modeLabel})` } : { item: "Billetterie", status: "warning", detail: "Désactivée" });
        } else {
          checklist.push({ item: "Prochain event", status: "missing", detail: "Aucun événement à venir" });
        }
        const dc = drinksRes.count || 0;
        checklist.push(dc === 0 ? { item: "Menu", status: "missing", detail: "Aucune boisson active" } : dc < 5 ? { item: "Menu", status: "warning", detail: `${dc} boissons actives — ajoute-en plus` } : { item: "Menu", status: "ok", detail: `${dc} boissons actives` });
        const sc = staffRes.count || 0;
        checklist.push(sc === 0 ? { item: "Staff", status: "missing", detail: "Aucun employé" } : { item: "Staff", status: "ok", detail: `${sc} membres` });
        return JSON.stringify({ checklist });
      }

      // ─── PROMOTER STATS ───
      case "get_promoter_stats": {
        const { data: promoters } = await supabase
          .from("promoters")
          .select("id, first_name, last_name, pending_amount, total_paid, is_active")
          .eq("venue_id", venueId);

        if (!promoters || promoters.length === 0) {
          return JSON.stringify({ message: "Aucun promoteur configuré pour ce club.", promoters: [] });
        }
        // Conversions comptées dans promoter_conversions (la colonne
        // `promoters.total_conversions` n'existe pas).
        // Un compte exact par promoteur (une requête « head » chacun) : une
        // liste de lignes serait tronquée à 1 000 par PostgREST.
        const convCount = new Map<string, number>();
        await Promise.all(promoters.map(async (p: PromoterRow) => {
          const { count } = await supabase
            .from("promoter_conversions")
            .select("id", { count: "exact", head: true })
            .eq("promoter_id", p.id);
          convCount.set(p.id, count ?? 0);
        }));
        promoters.sort((a: PromoterRow, b: PromoterRow) => (convCount.get(b.id) ?? 0) - (convCount.get(a.id) ?? 0));

        return JSON.stringify({
          total_promoters: promoters.length,
          active: promoters.filter((p: PromoterRow) => p.is_active).length,
          promoters: promoters.map((p: PromoterRow) => ({
            name: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
            conversions: convCount.get(p.id) ?? 0,
            pending: r2(p.pending_amount || 0),
            total_paid: r2(p.total_paid || 0),
            active: p.is_active,
          })),
        });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err) {
    log("tool_error", { tool: toolName, error: String(err) });
    return JSON.stringify({ error: `Failed to execute ${toolName}` });
  }
}

// ═══════════════════════════════════════════
// GÉNÉRATION DE CONTENU MARKETING (action hors chat)
// ═══════════════════════════════════════════

const CHANNEL_RULES: Record<string, string> = {
  push: "Notification push mobile. title : max 40 caractères, percutant. body : max 120 caractères, une seule idée, max 1 emoji. preheader : chaîne vide.",
  sms: "SMS. body : max 120 caractères, alphabet GSM standard SANS emoji ni caractère spécial (le nom d'expéditeur et la mention STOP sont ajoutés automatiquement : le tout doit tenir dans un seul SMS de 160). Un seul call-to-action. Si le message renvoie vers la soirée, termine par le jeton {lien} tel quel (il sera remplacé par le lien court). title et preheader : chaînes vides.",
  email: "Email. title = objet (max 60 caractères). preheader : max 90 caractères, complète l'objet sans le répéter. body : 2 paragraphes courts séparés par une ligne vide, un call-to-action clair.",
};

const CHANNEL_LIMITS: Record<string, { title: number; preheader: number; body: number }> = {
  push: { title: 40, preheader: 0, body: 120 },
  sms: { title: 0, preheader: 0, body: 120 },
  email: { title: 60, preheader: 90, body: 2000 },
};

const CONTENT_LANG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "preheader", "body"],
  properties: {
    title: { type: "string" },
    preheader: { type: "string" },
    body: { type: "string" },
  },
};

const CONTENT_SCHEMA = {
  name: "marketing_variants",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["variants"],
    properties: {
      variants: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["en", "fr", "es"],
          properties: {
            en: CONTENT_LANG_SCHEMA,
            fr: CONTENT_LANG_SCHEMA,
            es: CONTENT_LANG_SCHEMA,
          },
        },
      },
    },
  },
};

async function handleGenerateContent(
  body: ActionBody,
  ctx: { supabase: SupabaseClient; venueId: string; userId: string; usage?: AiUsageEvent },
): Promise<Response> {
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
  const { supabase, venueId, userId } = ctx;
  const handlerStart = Date.now();

  const channel = String(body.channel || "");
  if (!CHANNEL_RULES[channel]) {
    return new Response(JSON.stringify({ error: "Invalid channel" }), { status: 400, headers: jsonHeaders });
  }
  const eventId = typeof body.eventId === "string" ? body.eventId : null;
  const segment = typeof body.segment === "string" ? body.segment.substring(0, 100) : null;
  const tone = typeof body.tone === "string" ? body.tone.substring(0, 50) : null;
  const customInstructions = typeof body.customInstructions === "string" ? body.customInstructions.substring(0, 500) : null;

  // Contexte 100 % requêté côté serveur (anti-injection) : le client ne
  // fournit que des identifiants et des préférences, jamais les données.
  const { data: venue } = await supabase.from("venues").select("name").eq("id", venueId).maybeSingle();
  const contextLines: string[] = [`- Club : ${venue?.name || "inconnu"}`];

  if (eventId) {
    const { data: evt } = await supabase
      .from("events")
      .select("id, title, start_at, music_genres, max_tickets")
      .eq("id", eventId)
      .eq("venue_id", venueId)
      .maybeSingle();
    if (!evt) {
      return new Response(JSON.stringify({ error: "Event not found for this venue" }), { status: 404, headers: jsonHeaders });
    }
    contextLines.push(`- Événement : ${evt.title} — ${evt.start_at}`);
    if (Array.isArray(evt.music_genres) && evt.music_genres.length) {
      contextLines.push(`- Genres musicaux : ${evt.music_genres.join(", ")}`);
    }
    const { data: rounds } = await supabase
      .from("ticket_rounds")
      .select("name, price, tickets_sold, max_tickets, is_active")
      .eq("event_id", eventId)
      .order("position");
    const activeRound = (rounds || []).find((r: TicketRoundRow) => r.is_active);
    if (activeRound) {
      contextLines.push(`- Prix billet actuel : ${activeRound.price}€ (round « ${activeRound.name} »)`);
    }
    const sold = (rounds || []).reduce((s: number, r: TicketRoundRow) => s + (r.tickets_sold || 0), 0);
    const cap = evt.max_tickets || (rounds || []).reduce((s: number, r: TicketRoundRow) => s + (r.max_tickets || 0), 0);
    if (cap > 0) contextLines.push(`- Remplissage : ${sold}/${cap} billets vendus`);
  }
  if (segment) contextLines.push(`- Audience ciblée : ${segment}`);

  const systemPrompt = `Tu es le copywriter marketing d'un club de nuit sur Yuno.
Génère EXACTEMENT 3 variantes distinctes de contenu marketing pour le canal demandé.
Chaque variante existe en anglais (en), français (fr) et espagnol (es) : mêmes idées, adaptées idiomatiquement — jamais de traduction mot à mot.
Règles du canal : ${CHANNEL_RULES[channel]}
CONTRAINTE ABSOLUE : le contexte ci-dessous est ta SEULE source de vérité. N'invente aucun prix, aucune date, aucun chiffre, aucune offre qui n'y figure pas.`;

  const userPrompt = `Contexte réel :
${contextLines.join("\n")}
${tone ? `Ton demandé : ${tone}` : "Ton : engageant, direct."}
${customInstructions ? `Instructions de l'owner (à respecter si compatibles avec les règles du canal) : ${customInstructions}` : ""}`;

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

  const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CONTENT_MODEL,
      reasoning_effort: "minimal",
      max_completion_tokens: 3000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_schema", json_schema: CONTENT_SCHEMA },
    }),
  });

  const contentUsage: AiUsageEvent = { ...(ctx.usage ?? { assistant: 'owner', model: CONTENT_MODEL, userId, venueId }), assistant: 'owner_content', model: CONTENT_MODEL, promptPreview: `${channel}${eventId ? ' · event' : ''}${tone ? ` · ${tone}` : ''}` };
  if (!aiResponse.ok) {
    logAiUsage(supabase, { ...contentUsage, status: aiResponse.status === 429 ? 'rate_limited' : 'error', error: `openai ${aiResponse.status}`, latencyMs: Date.now() - handlerStart });
    if (aiResponse.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: jsonHeaders });
    }
    const t = await aiResponse.text();
    log("content_ai_error", { status: aiResponse.status, body: t.substring(0, 200) });
    throw new Error("AI gateway error");
  }

  const aiData = await aiResponse.json();
  logAiUsage(supabase, { ...contentUsage, ...sumUsage(aiData?.usage as OpenAiUsage), latencyMs: Date.now() - handlerStart });
  let parsed: { variants?: ContentVariant[] } | null = null;
  try { parsed = JSON.parse(aiData.choices?.[0]?.message?.content || "{}"); } catch { /* empty */ }
  const limits = CHANNEL_LIMITS[channel];
  const variants = (parsed?.variants || []).slice(0, 3).map((v: ContentVariant) => {
    const clamp = (l: ContentFields | undefined) => ({
      title: String(l?.title || "").substring(0, limits.title),
      preheader: String(l?.preheader || "").substring(0, limits.preheader),
      body: String(l?.body || "").substring(0, limits.body),
    });
    return { en: clamp(v?.en), fr: clamp(v?.fr), es: clamp(v?.es) };
  });

  if (!variants.length) {
    log("content_empty", { channel });
    return new Response(JSON.stringify({ error: "Generation failed" }), { status: 502, headers: jsonHeaders });
  }

  try {
    await supabase.from("owner_ai_audit_log").insert({
      user_id: userId,
      venue_id: venueId,
      tool_name: "generate_marketing_content",
      tool_args: { channel, event_id: eventId, segment, tone },
      result: JSON.stringify(variants).substring(0, 1000),
    });
  } catch { /* ignore */ }

  log("content_generated", { channel, variants: variants.length });
  return new Response(JSON.stringify({ variants }), { headers: jsonHeaders });
}

// ═══════════════════════════════════════════
// NIGHT REPORT NARRATIF (action hors chat)
// ═══════════════════════════════════════════

const REPORT_SCHEMA = {
  name: "night_report",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["headline", "insights", "actions"],
    properties: {
      headline: { type: "string" },
      insights: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["text", "metric", "sentiment"],
          properties: {
            text: { type: "string" },
            metric: { type: "string" },
            sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
          },
        },
      },
      actions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["text", "category"],
          properties: {
            text: { type: "string" },
            category: { type: "string", enum: ["marketing", "pricing", "operations", "experience"] },
          },
        },
      },
    },
  },
};

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function handleGenerateNightReport(
  body: ActionBody,
  ctx: { supabase: SupabaseClient; venueId: string; userId: string; usage?: AiUsageEvent },
): Promise<Response> {
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
  const { supabase, venueId, userId } = ctx;
  const handlerStart = Date.now();

  const eventId = typeof body.eventId === "string" ? body.eventId : null;
  const language = oneOf(body.language, ["en", "fr", "es"], "en");
  const stats = body.stats;
  if (!eventId || !stats || typeof stats !== "object") {
    return new Response(JSON.stringify({ error: "Missing eventId or stats" }), { status: 400, headers: jsonHeaders });
  }
  const statsJson = JSON.stringify(stats);
  if (statsJson.length > 20_000) {
    return new Response(JSON.stringify({ error: "Stats payload too large" }), { status: 400, headers: jsonHeaders });
  }

  // Garde-fou : l'event doit appartenir au venue de l'owner.
  const { data: evt } = await supabase
    .from("events")
    .select("id, title, start_at")
    .eq("id", eventId)
    .eq("venue_id", venueId)
    .maybeSingle();
  if (!evt) {
    return new Response(JSON.stringify({ error: "Event not found for this venue" }), { status: 404, headers: jsonHeaders });
  }

  // Cache : un rapport par event × langue, invalidé quand les stats changent.
  const statsHash = await sha256Hex(statsJson);
  const { data: cached } = await supabase
    .from("event_ai_reports")
    .select("report, stats_hash")
    .eq("event_id", eventId)
    .eq("language", language)
    .maybeSingle();
  if (cached && cached.stats_hash === statsHash) {
    return new Response(JSON.stringify({ report: cached.report, cached: true }), { headers: jsonHeaders });
  }

  const langName = language === "fr" ? "français" : language === "es" ? "espagnol" : "anglais";
  const systemPrompt = `Tu es l'analyste nightlife d'un club sur Yuno. On te donne les statistiques calculées d'une soirée passée (JSON).
Produis, en ${langName} :
- headline : une phrase-verdict de la soirée (concrète, avec le chiffre le plus marquant).
- insights : EXACTEMENT 5 enseignements. Chacun cite sa métrique source (champ metric = nom du champ JSON utilisé) et un sentiment (positive/neutral/negative). Compare aux moyennes du club quand les deltas existent (champs *ChangePct).
- actions : EXACTEMENT 3 actions concrètes pour la prochaine soirée, chacune classée (marketing/pricing/operations/experience).
RÈGLES ABSOLUES : n'utilise QUE les chiffres présents dans le JSON — n'invente rien, ne recalcule pas. Si les données sont maigres (peu de billets, pas de scans : hasScanData=false, volumes faibles), dis-le honnêtement dans les insights plutôt que d'inventer des tendances. Tutoie l'owner, sois direct et utile, pas de flatterie.`;

  const userPrompt = `Soirée : ${evt.title} (${evt.start_at})\nStatistiques :\n${statsJson}`;

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

  const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: REPORT_MODEL,
      reasoning_effort: "medium",
      max_completion_tokens: 4000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_schema", json_schema: REPORT_SCHEMA },
    }),
  });

  const reportUsage: AiUsageEvent = { ...(ctx.usage ?? { assistant: 'owner', model: REPORT_MODEL, userId, venueId }), assistant: 'owner_report', model: REPORT_MODEL, language, promptPreview: `night report · ${eventId}` };
  if (!aiResponse.ok) {
    logAiUsage(supabase, { ...reportUsage, status: aiResponse.status === 429 ? 'rate_limited' : 'error', error: `openai ${aiResponse.status}`, latencyMs: Date.now() - handlerStart });
    if (aiResponse.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: jsonHeaders });
    }
    const t = await aiResponse.text();
    log("report_ai_error", { status: aiResponse.status, body: t.substring(0, 200) });
    throw new Error("AI gateway error");
  }

  const aiData = await aiResponse.json();
  logAiUsage(supabase, { ...reportUsage, ...sumUsage(aiData?.usage as OpenAiUsage), latencyMs: Date.now() - handlerStart });
  let report: NightReport | null = null;
  try { report = JSON.parse(aiData.choices?.[0]?.message?.content || "null"); } catch { /* empty */ }
  if (!report?.headline || !Array.isArray(report?.insights) || !Array.isArray(report?.actions)) {
    log("report_empty", { event_id: eventId });
    return new Response(JSON.stringify({ error: "Generation failed" }), { status: 502, headers: jsonHeaders });
  }
  report.insights = report.insights.slice(0, 5);
  report.actions = report.actions.slice(0, 3);

  try {
    await supabase.from("event_ai_reports").upsert({
      event_id: eventId,
      venue_id: venueId,
      language,
      report,
      model: REPORT_MODEL,
      stats_hash: statsHash,
      created_at: new Date().toISOString(),
    }, { onConflict: "event_id,language" });
  } catch { /* ignore */ }

  try {
    await supabase.from("owner_ai_audit_log").insert({
      user_id: userId,
      venue_id: venueId,
      tool_name: "generate_night_report",
      tool_args: { event_id: eventId, language },
      result: JSON.stringify(report).substring(0, 1000),
    });
  } catch { /* ignore */ }

  log("report_generated", { event_id: eventId, language });
  return new Response(JSON.stringify({ report, cached: false }), { headers: jsonHeaders });
}

// ═══════════════════════════════════════════
// NEXT-BEST-ACTION QUOTIDIEN (action hors chat)
// ═══════════════════════════════════════════

// Chemins autorisés dans les actions — enum strict pour empêcher tout lien
// halluciné. Miroir de la navigation du dashboard owner.
const ACTION_PATHS = [
  "/owner/push", "/owner/campaigns", "/owner/campaigns/automations", "/owner/sms-campaigns", "/owner/ticketing",
  "/owner/scarcity", "/owner/tables", "/owner/customers", "/owner/events",
  "/owner/hype", "/owner/menu", "/owner/loyalty", "/owner/promoters",
  "/owner/analytics", "/owner/upsell",
] as const;

const NBA_SCHEMA = {
  name: "next_best_actions",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["actions"],
    properties: {
      actions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "why", "category", "path"],
          properties: {
            title: { type: "string" },
            why: { type: "string" },
            category: { type: "string", enum: ["marketing", "pricing", "operations", "experience"] },
            path: { type: "string", enum: [...ACTION_PATHS] },
          },
        },
      },
    },
  },
};

// Change à chaque fois que les chiffres lus par les actions changent de source.
const ACTIONS_CACHE_TAG = `${ACTIONS_MODEL}#sales-rows-v2`;

async function handleNextBestActions(
  body: ActionBody,
  ctx: { supabase: SupabaseClient; venueId: string; userId: string; usage?: AiUsageEvent },
): Promise<Response> {
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
  const { supabase, venueId, userId } = ctx;
  const handlerStart = Date.now();
  const language = oneOf(body.language, ["en", "fr", "es"], "en");
  const today = new Date().toISOString().slice(0, 10);

  // Cache : une génération par venue × jour × langue.
  const { data: cached } = await supabase
    .from("venue_ai_actions")
    .select("actions")
    .eq("venue_id", venueId)
    .eq("day", today)
    .eq("language", language)
    // Le tag de version invalide le cache du jour quand les données lues
    // changent de source (sinon les actions fausses restent jusqu'à minuit).
    .eq("model", ACTIONS_CACHE_TAG)
    .maybeSingle();
  if (cached) {
    return new Response(JSON.stringify({ actions: cached.actions, cached: true }), { headers: jsonHeaders });
  }

  // ── État réel du club, requêté côté serveur ──
  const now = new Date();
  const in14d = new Date(now.getTime() + 14 * 24 * 3600 * 1000).toISOString();
  const [venueRes, eventsRes, lastPushRes, lastEmailRes, customersRes, pushCreditsRes] = await Promise.all([
    supabase.from("venues").select("name").eq("id", venueId).maybeSingle(),
    supabase.from("events")
      .select("id, title, start_at, max_tickets, ticketing_enabled, tables_enabled")
      .eq("venue_id", venueId).eq("is_active", true)
      .gte("start_at", now.toISOString()).lte("start_at", in14d)
      .order("start_at").limit(6),
    supabase.from("push_campaigns").select("created_at").eq("venue_id", venueId)
      .eq("source", "manual").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("email_campaigns").select("created_at").eq("venue_id", venueId)
      .eq("status", "sent").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    fetchAllRows<{ last_visit_at: string | null }>((f, t) => supabase.from("venue_customers").select("last_visit_at").eq("venue_id", venueId).eq("is_banned", false).order("id").range(f, t)).then((data) => ({ data }), () => ({ data: [] as { last_visit_at: string | null }[] })),
    supabase.rpc("push_credit_state_for", { p_scope: `venue:${venueId}` }),
  ]);

  const lines: string[] = [`Club : ${venueRes.data?.name || "inconnu"} — date : ${today}`];

  const events = eventsRes.data || [];
  if (events.length === 0) {
    lines.push("Aucune soirée programmée dans les 14 prochains jours.");
  } else {
    // Les MÊMES chiffres que le bloc « Vos prochaines soirées » juste en
    // dessous des actions : billets et tables réellement vendus (lignes de
    // vente), jamais le compteur `ticket_rounds.tickets_sold` — il n'est
    // incrémenté que par le checkout et a déjà fait écrire « 0 billet vendu »
    // à l'IA au-dessus d'une soirée affichée à 84 / 650.
    const ids = events.map((e: IdRow) => e.id);
    // PostgREST rend au plus 1 000 lignes par requête : on pagine, sinon une
    // grosse guest list serait comptée à 1 000 et l'IA contredirait l'écran.
    const allRows = async <T,>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<{ data: T[] }> => {
      const out: T[] = [];
      for (let from = 0; from < 50_000; from += 1000) {
        const { data, error } = await build(from, from + 999);
        if (error || !data?.length) break;
        out.push(...data);
        if (data.length < 1000) break;
      }
      return { data: out };
    };
    const [roundsRes, ticketsRes, tablesRes, glRes] = await Promise.all([
      supabase.from("ticket_rounds").select("event_id, max_tickets").in("event_id", ids),
      allRows((f, t) => supabase.from("tickets").select("event_id, quantity").in("event_id", ids).in("status", ["paid", "used"]).order("id").range(f, t)),
      allRows((f, t) => supabase.from("table_reservations").select("event_id").in("event_id", ids).in("status", ["paid", "confirmed"]).order("id").range(f, t)),
      allRows((f, t) => supabase.from("guest_list_entries").select("id, guest_lists!inner(event_id)").in("guest_lists.event_id", ids).neq("status", "cancelled").order("id").range(f, t)),
    ]);
    const sumBy = <R,>(rows: R[] | null, key: (r: R) => string, val: (r: R) => number) => {
      const m = new Map<string, number>();
      for (const r of rows || []) m.set(key(r), (m.get(key(r)) || 0) + val(r));
      return m;
    };
    const soldBy = sumBy(ticketsRes.data, (r) => r.event_id, (r) => r.quantity || 1);
    const tablesBy = sumBy(tablesRes.data, (r) => r.event_id, () => 1);
    // guest_lists est une relation « vers un » : PostgREST l'embarque en objet,
    // pas en tableau (le typage sans schéma suppose un tableau).
    const glRows = glRes.data as unknown as { guest_lists: { event_id: string } | null }[];
    const glBy = sumBy(glRows, (r) => r.guest_lists?.event_id ?? "", () => 1);
    const capBy = sumBy(roundsRes.data, (r) => r.event_id, (r) => r.max_tickets || 0);
    for (const evt of events) {
      const sold = soldBy.get(evt.id) || 0;
      const cap = evt.max_tickets || capBy.get(evt.id) || 0;
      const daysOut = Math.max(0, Math.round((new Date(evt.start_at).getTime() - now.getTime()) / 86400000));
      const fill = cap > 0 ? Math.round((sold / cap) * 100) : null;
      lines.push(`Soirée « ${evt.title} » dans ${daysOut} j : ${sold} billets vendus${cap ? ` / ${cap} (${fill}%)` : ""}, ${tablesBy.get(evt.id) || 0} tables réservées, ${glBy.get(evt.id) || 0} inscrits guest list${evt.ticketing_enabled ? "" : " — billetterie DÉSACTIVÉE"}${evt.tables_enabled ? "" : " — tables désactivées"}.`);
    }
  }

  const daysSince = (iso: string | null | undefined) =>
    iso ? Math.round((now.getTime() - new Date(iso).getTime()) / 86400000) : null;
  const dPush = daysSince(lastPushRes.data?.created_at);
  const dEmail = daysSince(lastEmailRes.data?.created_at);
  lines.push(`Dernier push manuel : ${dPush === null ? "jamais" : `il y a ${dPush} j`}. Dernière campagne email : ${dEmail === null ? "jamais" : `il y a ${dEmail} j`}.`);

  const customers = customersRes.data || [];
  if (customers.length > 0) {
    const bucket = (lo: number, hi: number | null) => customers.filter((c: { last_visit_at: string | null }) => {
      const d = daysSince(c.last_visit_at);
      return d !== null && d >= lo && (hi === null || d < hi);
    }).length;
    lines.push(`Base clients : ${customers.length} — actifs <30 j : ${bucket(0, 30)}, à risque 30-90 j : ${bucket(30, 90)}, perdus >90 j : ${bucket(90, null)}.`);
  } else {
    lines.push("Base clients vide pour l'instant.");
  }

  // Les notifications automatiques sont envoyées par Yuno (moteur de
  // notifications) : rien à activer, il reste les crédits de campagnes.
  const credits = pushCreditsRes.data as { remaining?: number } | null;
  lines.push(`Notifications automatiques : envoyées par Yuno pour chaque soirée (rien à activer). Crédits de campagnes push restants ce mois-ci : ${credits?.remaining ?? "inconnu"}.`);

  const systemPrompt = `Tu es le conseiller opérationnel quotidien d'un club sur Yuno. On te donne l'état réel du club ce matin.
Propose EXACTEMENT 3 actions concrètes et priorisées à faire AUJOURD'HUI, la plus impactante d'abord, en ${language === "fr" ? "français" : language === "es" ? "espagnol" : "anglais"}.
Pour chaque action : title = l'action en une phrase impérative courte ; why = la raison chiffrée tirée des données (1 phrase) ; category ; path = la page du dashboard où la faire (choisis dans la liste imposée).
RÈGLES : n'utilise QUE les chiffres fournis, n'invente rien. Si tout va bien, propose des actions d'optimisation (fidélité, upsell, analyse) plutôt que d'alarmer. Tutoie l'owner, direct, zéro flatterie.`;

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

  const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ACTIONS_MODEL,
      reasoning_effort: "low",
      max_completion_tokens: 2500,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: lines.join("\n") },
      ],
      response_format: { type: "json_schema", json_schema: NBA_SCHEMA },
    }),
  });

  const nbaUsage: AiUsageEvent = { ...(ctx.usage ?? { assistant: 'owner', model: ACTIONS_MODEL, userId, venueId }), assistant: 'owner_actions', model: ACTIONS_MODEL, language, promptPreview: `next best actions · ${today}` };
  if (!aiResponse.ok) {
    logAiUsage(supabase, { ...nbaUsage, status: aiResponse.status === 429 ? 'rate_limited' : 'error', error: `openai ${aiResponse.status}`, latencyMs: Date.now() - handlerStart });
    if (aiResponse.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: jsonHeaders });
    }
    const t = await aiResponse.text();
    log("nba_ai_error", { status: aiResponse.status, body: t.substring(0, 200) });
    throw new Error("AI gateway error");
  }

  const aiData = await aiResponse.json();
  logAiUsage(supabase, { ...nbaUsage, ...sumUsage(aiData?.usage as OpenAiUsage), latencyMs: Date.now() - handlerStart });
  let parsed: { actions?: NextBestAction[] } | null = null;
  try { parsed = JSON.parse(aiData.choices?.[0]?.message?.content || "null"); } catch { /* empty */ }
  const actions = (parsed?.actions || []).slice(0, 3)
    .filter((a: NextBestAction) => (ACTION_PATHS as readonly unknown[]).includes(a?.path));
  if (!actions.length) {
    log("nba_empty", { venue_id: venueId });
    return new Response(JSON.stringify({ error: "Generation failed" }), { status: 502, headers: jsonHeaders });
  }

  try {
    await supabase.from("venue_ai_actions").upsert({
      venue_id: venueId,
      day: today,
      language,
      actions,
      model: ACTIONS_CACHE_TAG,
    }, { onConflict: "venue_id,day,language" });
  } catch { /* ignore */ }

  try {
    await supabase.from("owner_ai_audit_log").insert({
      user_id: userId,
      venue_id: venueId,
      tool_name: "generate_next_best_actions",
      tool_args: { language, day: today },
      result: JSON.stringify(actions).substring(0, 1000),
    });
  } catch { /* ignore */ }

  log("nba_generated", { venue_id: venueId, language });
  return new Response(JSON.stringify({ actions, cached: false }), { headers: jsonHeaders });
}

// ═══════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════

// ═══════════════════════════════════════════
// ASSISTANT DU MODE D'EMPLOI — action help_chat
// ═══════════════════════════════════════════
// Ouvert à tout compte pro authentifié (club, manager, organisateur, agence).
// Il ne voit ni outil ni donnée du compte : il répond d'après les extraits du
// mode d'emploi que le centre d'aide lui envoie (recherche côté client, dans
// la langue de l'utilisateur), et renvoie toujours vers l'article utile.
// Le club garde en plus son assistant à outils (chat principal ci-dessous).
const HELP_MODEL = OPENAI_MODEL;
type HelpDoc = { title: string; path: string; text: string };

const HELP_SCOPE_LABEL: Record<string, string> = {
  owner: "propriétaire ou gérant de club (Console Club, sous /owner)",
  manager: "manager de club (mêmes écrans que le propriétaire, sous /manager)",
  organizer: "organisateur de soirées (Console Organisateur, sous /organizer-app : billets + tables VIP, pas de bar)",
  agency: "responsable d'agence de promoteurs (Console Agence, sous /agency-app)",
};

function helpSystemPrompt(scope: string, language: string, docs: HelpDoc[], currentArticle?: string): string {
  const langName = language === "en" ? "anglais" : language === "es" ? "espagnol" : "français";
  const register = scope === "owner" || scope === "manager" ? "en vouvoyant" : "en tutoyant";
  const excerpts = docs.length
    ? docs.map((d) => `### [${d.title}](${d.path})\n${d.text}`).join("\n\n")
    : "(aucun extrait ne correspond à la question)";
  return `Tu es l'assistant du mode d'emploi de Yuno, la plateforme nightlife : billets, tables VIP (bottle service), commandes de boissons, guest list, marketing, promoteurs. Tu parles à un ${HELP_SCOPE_LABEL[scope] ?? HELP_SCOPE_LABEL.owner}.
Tu réponds en ${langName}, ${register}.${currentArticle ? `\nLa personne lit en ce moment l'article « ${currentArticle} ».` : ""}

RÈGLES
1. Tu réponds UNIQUEMENT d'après les EXTRAITS DU MODE D'EMPLOI ci-dessous. Si la réponse n'y est pas, dis-le en une phrase, propose le bouton « Contacter le support » du centre d'aide, et n'invente JAMAIS un menu, un bouton, un réglage ou un chiffre.
2. Réponse courte : 60 à 180 mots. Une procédure = étapes numérotées (1. 2. 3.), une action par étape, les libellés exacts de l'interface entre guillemets, les chemins sous la forme A → B → C.
3. Pas de préambule, pas de rappel de la question, pas d'emoji, pas de titre markdown. Le gras (**…**) seulement pour un libellé clé.
4. Termine TOUJOURS par une ligne vide puis une seule ligne « Pour aller plus loin : [Titre de l'article](chemin) » avec l'article le plus utile parmi les extraits. Le chemin est recopié EXACTEMENT tel qu'il est écrit entre parenthèses dans le titre de l'extrait : il commence par « / », sans domaine, sans « https:// ». Un seul lien, jamais inventé.
5. Tu ne vois pas les données du compte (ventes, soirées, clients). Si on te demande un chiffre du compte, explique où le lire dans le dashboard.
6. Yuno ne prend jamais de commission : les frais de service sont payés par le client final en plus du prix affiché.

EXTRAITS DU MODE D'EMPLOI (${docs.length})
${excerpts}`;
}

async function handleHelpChat(
  body: ActionBody,
  ctx: { supabase: SupabaseClient; userId: string; userEmail: string | null; startedAt: number },
): Promise<Response> {
  const language = oneOf(body?.language, ["fr", "en", "es"], "fr");
  const scope = oneOf(body?.scope, ["owner", "manager", "organizer", "agency"], "owner");
  const messages = (Array.isArray(body?.messages) ? body.messages : [])
    .filter((m: HelpChatMessage) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-12)
    .map((m: HelpChatMessage) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return new Response(JSON.stringify({ error: "A user message is required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const docs: HelpDoc[] = (Array.isArray(body?.docs) ? body.docs : [])
    .slice(0, 6)
    .map((d: { title?: unknown; path?: unknown; text?: unknown }) => ({
      title: String(d?.title ?? "").slice(0, 200),
      path: String(d?.path ?? "").slice(0, 300),
      text: String(d?.text ?? "").slice(0, 7000),
    }))
    .filter((d: HelpDoc) => d.title && d.text);
  const currentArticle = typeof body?.currentArticle === "string" ? body.currentArticle.slice(0, 200) : undefined;
  const systemPrompt = helpSystemPrompt(scope, language, docs, currentArticle);

  const usage: AiUsageEvent = {
    assistant: "help",
    model: HELP_MODEL,
    userId: ctx.userId,
    userEmail: ctx.userEmail,
    venueId: null,
    language,
    turnCount: messages.length,
    promptChars: systemPrompt.length + messagesChars(messages),
    promptPreview: lastUserPrompt(messages),
  };

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  log("help_chat", { scope, language, docs: docs.length, msg_count: messages.length });

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: HELP_MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      temperature: 0.3,
      max_tokens: 700,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });
  if (!resp.ok) {
    const status = resp.status;
    logAiUsage(ctx.supabase, { ...usage, status: status === 429 ? "rate_limited" : "error", error: `openai ${status}`, latencyMs: Date.now() - ctx.startedAt });
    if (status === 429) {
      return new Response(JSON.stringify({ error: "Rate limited" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    throw new Error("AI gateway error");
  }
  const tracked = trackOpenAiStream(resp.body, ctx.supabase, usage, { startedAt: ctx.startedAt });
  return new Response(tracked, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid authentication" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const demoPreview = await isDemoPreviewRequest(req);

    const body = await req.json();

    // Assistant du mode d'emploi : tout pro authentifié, avant la porte « owner ».
    if (body?.action === "help_chat") {
      // « Pro » = un rôle autre que client, OU un profil organisateur (un
      // organisateur n'a PAS de rôle user_roles — voir CLAUDE.md), OU un
      // membre d'équipe d'organisateur.
      const [{ data: proRoles }, { data: proProfile }, { data: membership }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user.id),
        supabase.from("profiles").select("profile_type").eq("id", user.id).maybeSingle(),
        supabase.from("org_members").select("id").eq("member_user_id", user.id).limit(1).maybeSingle(),
      ]);
      const isPro = (proRoles ?? []).some((r: RoleRow) => r.role && r.role !== "client")
        || proProfile?.profile_type === "organizer"
        || Boolean(membership);
      if (!isPro) {
        return new Response(JSON.stringify({ error: "Pro role required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return await handleHelpChat(body, { supabase, userId: user.id, userEmail: user.email ?? null, startedAt: Date.now() });
    }

    // Verify owner role
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
    const isOwner = roles?.some((r: RoleRow) => r.role === "owner");
    if (!isOwner) {
      return new Response(JSON.stringify({ error: "Owner role required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get venue
    const { data: venueData } = await supabase.from("venues").select("id").eq("owner_id", user.id).limit(1).maybeSingle();
    if (!venueData) {
      return new Response(JSON.stringify({ error: "No venue found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const venueId = venueData.id;

    // Suivi de consommation IA (super admin) : identité de l'appel, complétée
    // à la fin par les tokens, les tools appelés et la latence.
    const startedAt = Date.now();
    const usageBase: AiUsageEvent = {
      assistant: 'owner',
      model: OPENAI_MODEL,
      userId: user.id,
      userEmail: user.email ?? null,
      venueId,
      language: (req.headers.get("accept-language") || "").split(",")[0].slice(0, 2).toLowerCase() || null,
    };

    // Actions structurées hors chat — même auth/rôle/venue que le chat,
    // mais réponse JSON directe sans boucle de tools.
    if (body?.action === "generate_marketing_content") {
      return await handleGenerateContent(body, { supabase, venueId, userId: user.id, usage: usageBase });
    }
    if (body?.action === "generate_night_report") {
      return await handleGenerateNightReport(body, { supabase, venueId, userId: user.id, usage: usageBase });
    }
    if (body?.action === "generate_next_best_actions") {
      return await handleNextBestActions(body, { supabase, venueId, userId: user.id, usage: usageBase });
    }

    const { messages, venueContext } = body;

    // Fetch subscription plan — inutile pendant le lancement (abonnement coupé,
    // tout est débloqué), on économise l'aller-retour.
    let venuePlan = "essential";
    if (SUBSCRIPTIONS_ENABLED) {
      try {
        const subRes = await fetch(`${supabaseUrl}/functions/v1/club-subscription`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ action: "check", venueId }),
        });
        if (subRes.ok) {
          const subData = await subRes.json();
          venuePlan = subData?.subscriptionPlan || "essential";
        }
      } catch (e) { log("plan_fetch_error", { error: String(e) }); }
    }

    // Build context
    let contextBlock = `\n\n📍 CONTEXTE :`;
    if (venueContext?.venueName) contextBlock += `\n- Club : ${venueContext.venueName}`;
    if (venueContext?.stripeConnected !== undefined) contextBlock += `\n- Stripe : ${venueContext.stripeConnected ? "Connecté" : "Non connecté"}`;
    if (venueContext?.eventsCount !== undefined) contextBlock += `\n- Events : ${venueContext.eventsCount}`;
    if (venueContext?.staffCount !== undefined) contextBlock += `\n- Staff : ${venueContext.staffCount}`;
    if (venueContext?.drinksCount !== undefined) contextBlock += `\n- Boissons actives : ${venueContext.drinksCount}`;
    if (venueContext?.currentPage) contextBlock += `\n- Page actuelle : ${venueContext.currentPage}`;
    contextBlock += SUBSCRIPTIONS_ENABLED
      ? `\n- Plan : ${venuePlan.toUpperCase()}`
      : `\n- Plan : LANCEMENT — toutes les fonctionnalités incluses`;

    // NB : l'ancienne injection FAQ depuis la table chatbot_training a été retirée
    // (données non maintenues, redondantes avec HELP_ARTICLES qui est versionné).
    const systemPrompt = OWNER_SYSTEM_PROMPT + contextBlock;

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

    const aiHeaders = {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    };

    log("request_start", { venue_id: venueId, plan: venuePlan, msg_count: messages.length });

    // ═══════════════════════════════════════
    // MULTI-ROUND TOOL CALLING (max 3 rounds)
    // ═══════════════════════════════════════

    const conversationMessages: OpenAiChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    const MAX_ROUNDS = 3;
    const chatUsage: AiUsageEvent = {
      ...usageBase,
      turnCount: Array.isArray(messages) ? messages.length : null,
      promptChars: systemPrompt.length + messagesChars(messages),
      promptPreview: lastUserPrompt(messages),
    };
    const roundUsages: OpenAiUsage[] = [];
    const calledTools: string[] = [];

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const roundResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: aiHeaders,
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: conversationMessages,
          tools: demoPreview ? READ_ONLY_TOOLS : TOOLS,
          tool_choice: "auto",
          stream: false,
        }),
      });

      if (!roundResponse.ok) {
        const status = roundResponse.status;
        logAiUsage(supabase, {
          ...chatUsage, ...sumUsage(...roundUsages), rounds: round + 1, toolCalls: calledTools,
          status: status === 429 ? 'rate_limited' : 'error', error: `openai ${status}`, latencyMs: Date.now() - startedAt,
        });
        if (status === 429) {
          return new Response(JSON.stringify({ error: "Rate limited" }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const t = await roundResponse.text();
        log("ai_error", { round, status, body: t.substring(0, 200) });
        throw new Error("AI gateway error");
      }

      const roundResult = await roundResponse.json();
      if (roundResult?.usage) roundUsages.push(roundResult.usage as OpenAiUsage);
      const choice = roundResult.choices?.[0];

      // No tool calls → use the content we already have (no redundant API call)
      if (!choice?.message?.tool_calls || choice.message.tool_calls.length === 0) {
        const finalContent = choice?.message?.content || "";
        log("final_answer", { round, content_length: finalContent.length });
        logAiUsage(supabase, {
          ...chatUsage, ...sumUsage(...roundUsages), rounds: round + 1, toolCalls: calledTools,
          completionChars: finalContent.length, latencyMs: Date.now() - startedAt,
        });

        // Format as SSE manually from the already-obtained content
        const ssePayload = `data: ${JSON.stringify({ choices: [{ delta: { content: finalContent } }] })}\n\ndata: [DONE]\n\n`;
        return new Response(ssePayload, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });
      }

      // Execute tool calls
      const toolCalls = choice.message.tool_calls;
      log("tool_calls", { round, tools: toolCalls.map((tc: OpenAiToolCall) => tc.function.name) });
      for (const tc of toolCalls) if (tc?.function?.name) calledTools.push(String(tc.function.name));

      // Add assistant message with tool calls
      conversationMessages.push(choice.message);

      for (const tc of toolCalls) {
        const fnName = tc.function.name;
        let fnArgs: ToolArgs = {};
        try { fnArgs = JSON.parse(tc.function.arguments || "{}"); } catch { /* empty */ }

        // Plan gating — désactivé pendant le lancement (SUBSCRIPTIONS_ENABLED=false) :
        // aucun tool n'est bloqué. La map TOOL_MIN_PLAN reste prête pour la réactivation.
        const minPlan = SUBSCRIPTIONS_ENABLED ? TOOL_MIN_PLAN[fnName] : undefined;
        if (minPlan && !hasPlanAccess(venuePlan, minPlan)) {
          log("plan_blocked", { tool: fnName, plan: venuePlan, required: minPlan });
          conversationMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({
              error: "plan_insufficient",
              current_plan: venuePlan,
              required_plan: minPlan,
              message: `Cette fonctionnalité nécessite le plan ${minPlan.toUpperCase()}. Plan actuel : ${venuePlan.toUpperCase()}.`,
            }),
          });
          continue;
        }

        log("tool_exec", { round, tool: fnName, args: fnArgs });
        // Lien démo = lecture seule : les outils d'écriture tournent en
        // service_role, le hook PostgREST ne les verrait pas.
        if (demoPreview && WRITE_TOOLS.has(fnName)) {
          conversationMessages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ error: "demo_read_only", message: "Aperçu de démonstration : lecture seule, aucune modification possible." }) });
          continue;
        }
        const result = await executeTool(fnName, fnArgs, supabase, venueId, supabaseAuth);
        log("tool_result", { round, tool: fnName, result_length: result.length });

        conversationMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });

        // Audit log for write tools
        if (WRITE_TOOLS.has(fnName)) {
          try {
            await supabase.from("owner_ai_audit_log").insert({
              user_id: user.id,
              venue_id: venueId,
              tool_name: fnName,
              tool_args: fnArgs,
              result: result.substring(0, 1000),
            });
          } catch { /* ignore */ }
        }
      }

      // Continue loop → next round will check if model wants more tools
    }

    // If we exhausted rounds, do a final stream without tools
    log("max_rounds_reached", { rounds: MAX_ROUNDS });
    const finalStream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: aiHeaders,
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: conversationMessages,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

    if (!finalStream.ok) {
      logAiUsage(supabase, {
        ...chatUsage, ...sumUsage(...roundUsages), rounds: MAX_ROUNDS + 1, toolCalls: calledTools,
        status: 'error', error: `openai final ${finalStream.status}`, latencyMs: Date.now() - startedAt,
      });
      throw new Error("Final stream error");
    }

    const trackedBody = trackOpenAiStream(finalStream.body, supabase,
      { ...chatUsage, rounds: MAX_ROUNDS + 1, toolCalls: calledTools },
      { startedAt, priorUsage: sumUsage(...roundUsages) });
    return new Response(trackedBody, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });

  } catch (e) {
    log("fatal_error", { error: String(e) });
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
