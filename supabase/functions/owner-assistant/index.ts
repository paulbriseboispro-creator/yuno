import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.83.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ═══════════════════════════════════════════
// SYSTEM PROMPT — Condensé, strict, data-driven
// ═══════════════════════════════════════════

const OWNER_SYSTEM_PROMPT = `Tu es Yuno Pro, l'assistant IA opérationnel des propriétaires de clubs sur Yuno. Tutoie l'owner. Réponds dans sa langue (français, anglais, espagnol).

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
- **CA Club** = Total payé - Frais Yuno (service_fee + insurance_fee)
- **CA Net** = CA Club - Frais Stripe (1.5% + 0.25€)

Formate en tableau Markdown :
| Source | CA Club | CA Net |
|--------|---------|--------|
| Boissons | X€ | Y€ |
| Billets | X€ | Y€ |
| Tables VIP | X€ | Y€ |
| **Total** | **X€** | **Y€** |

═══ PLAN D'ABONNEMENT ═══
Si l'owner demande une fonctionnalité au-delà de son plan :
- NE PAS exécuter l'action
- Expliquer la fonctionnalité pour donner envie
- Indiquer le plan requis (Essential 39€, Pro 69€, Elite 99€)
- Proposer [Abonnement](/owner/billing)

═══ NAVIGATION ═══
Utilise des liens Markdown : [Événements](/owner/events), [Menu](/owner/menu), [Staff](/owner/staff), [Billetterie](/owner/ticketing), [Tables VIP](/owner/tables), [Analytics](/owner/analytics), [Paramètres](/owner/venue), [Clients](/owner/customers), [Fidélité](/owner/loyalty), [DJs](/owner/djs), [Promoteurs](/owner/promoters), [Mode d'emploi](/owner/help)

═══ NE MÉLANGE JAMAIS ═══
- Ne mélange PAS documentation et réponses data
- Pour les questions "comment ça marche" → utilise search_help_articles
- Pour les questions "combien / quoi / qui" → utilise les tools data`;

// ═══════════════════════════════════════════
// HELP ARTICLES INDEX
// ═══════════════════════════════════════════

const HELP_ARTICLES: Record<string, { title: string; keywords: string[]; path: string; snippet: string }> = {
  "ticketing-modes": {
    title: "Modes de billetterie",
    keywords: ["ticket", "billet", "mode", "round", "simple", "timed", "créneau", "billetterie", "ticketing", "entrée"],
    path: "/owner/ticketing",
    snippet: "Yuno propose 3 modes de billetterie :\n1. **Simple** : Un seul type de billet à prix fixe, sans rounds. Idéal pour les soirées simples.\n2. **Rounds** (tours de vente) : Plusieurs tarifs progressifs (Early Bird → Regular → Last Minute). Chaque round a un nom, prix, quota et dates. Quand un round est sold out, le suivant s'active automatiquement.\n3. **Créneaux horaires (Timed Entry)** : Billets liés à des créneaux horaires spécifiques. Permet de gérer le flux d'entrées et d'éviter la surcharge.\n\nChaque mode peut inclure des frais de service et une assurance annulation optionnelle.",
  },
  "stripe-connect": {
    title: "Stripe Connect & Paiements",
    keywords: ["stripe", "paiement", "payment", "IBAN", "virement", "bank", "connect", "argent"],
    path: "/owner/venue",
    snippet: "Yuno utilise Stripe Connect (Standard) pour les paiements. Chaque club a son propre compte Stripe connecté. L'argent va directement sur le compte du club. Yuno prélève une commission automatiquement. Pour connecter Stripe : va dans Paramètres > Paiements et clique 'Connecter Stripe'. Stripe vérifie le compte en 24-48h.",
  },
  "staff-roles": {
    title: "Rôles du staff",
    keywords: ["staff", "employé", "barman", "bouncer", "videur", "manager", "vestiaire", "cloakroom", "rôle", "PIN"],
    path: "/owner/staff",
    snippet: "Rôles disponibles : Barman, Bouncer, VIP Host, Vestiaire (Cloakroom), Manager. Chaque employé a un PIN à 6 chiffres. L'employé doit déjà avoir un compte Yuno. Le Manager a des permissions granulaires configurables.",
  },
  "vip-tables": {
    title: "Tables VIP",
    keywords: ["table", "VIP", "réservation", "zone", "minimum", "consommation", "acompte", "deposit"],
    path: "/owner/tables",
    snippet: "Les Tables VIP permettent de créer des zones avec tables, capacité et minimum de consommation. Les clients réservent avec un acompte. Le VIP host gère les arrivées et les consommations sur place. Disponible uniquement avec le plan Elite.",
  },
  "subscription-plans": {
    title: "Plans d'abonnement",
    keywords: ["abonnement", "plan", "essential", "pro", "elite", "prix", "tarif", "billing"],
    path: "/owner/billing",
    snippet: "Essential (39€/mois) : Events, billetterie, QR, guest list, commandes, carte, staff, factures, analytics basiques.\nPro (69€/mois) : + DJs, organisateurs, promoteurs, analytics avancés, export CSV.\nElite (99€/mois) : + Tables VIP, fidélité, CRM, Hype Score.",
  },
  "guest-list": {
    title: "Guest List",
    keywords: ["guest", "list", "liste", "invité", "gratuit", "free", "quota"],
    path: "/owner/guest-list",
    snippet: "La guest list permet d'offrir l'entrée gratuite avant une certaine heure. Configure un quota (global ou par genre), active/désactive par event. Partage le lien avec tes promoteurs.",
  },
  "onboarding": {
    title: "Parcours de configuration",
    keywords: ["onboarding", "configuration", "configurer", "commencer", "démarrer", "setup"],
    path: "/owner/onboarding",
    snippet: "L'onboarding en 9 étapes : 1) Infos de base, 2) Design (logo/bannière), 3) Branding (couleur), 4) Stripe Connect, 5) Staff, 6) Menu, 7) Premier événement, 8) Prévisualisation, 9) Publication.",
  },
  "fee-structure": {
    title: "Structure des frais",
    keywords: ["frais", "fee", "commission", "service", "pourcentage", "coût", "stripe"],
    path: "/owner/help",
    snippet: "Frais Yuno : 3% sur commandes boissons, max(0.99€, 4%) sur billets et acomptes VIP. Le club paie les frais Stripe (1.5% + 0.25€ par transaction). CA Club = Total - Frais Yuno. CA Net = CA Club - Frais Stripe.",
  },
  "loyalty": {
    title: "Programme de fidélité",
    keywords: ["fidélité", "loyalty", "points", "récompense", "reward"],
    path: "/owner/loyalty",
    snippet: "Le programme de fidélité permet d'attribuer des points par euro dépensé. Configure un bonus de bienvenue, des récompenses échangeables. Disponible avec le plan Elite.",
  },
  "promoters": {
    title: "Système de promoteurs",
    keywords: ["promoteur", "promoter", "affiliation", "commission", "lien"],
    path: "/owner/promoters",
    snippet: "Les promoteurs ont un lien de parrainage unique. Ils gagnent une commission par ticket ou table vendue. Configure les taux de commission par type. Disponible avec le plan Pro.",
  },
  "menu": {
    title: "Gestion de la carte",
    keywords: ["menu", "carte", "boisson", "drink", "cocktail", "prix", "prévente", "commande"],
    path: "/owner/menu",
    snippet: "Catégories : Cocktails, Shooters, Bières, Vins/Champagnes, Spiritueux, Soft, Snacks, Autres. Chaque boisson a un nom, prix, image. Active/désactive sans supprimer. Prix promo disponible.",
  },
};

// ═══════════════════════════════════════════
// TOOL DEFINITIONS
// ═══════════════════════════════════════════

const TOOLS = [
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
      description: "Get top customers, segments, spending stats. Requires Pro plan.",
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
];
// ═══════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════

function calcStripeFee(totalEuros: number): number {
  if (totalEuros <= 0) return 0;
  return Math.round((totalEuros * 0.015 + 0.25) * 100) / 100;
}

const WRITE_TOOLS = new Set([
  "activate_ticket_round", "toggle_drink", "update_drink_price",
  "toggle_event_ticketing", "update_event", "toggle_guest_list", "toggle_event_tables",
]);

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

function log(type: string, data: Record<string, any>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), type, ...data }));
}

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

function calcOrdersRevenue(orders: any[]): { caClub: number; caNet: number } {
  let caClub = 0, caNet = 0;
  for (const o of orders) {
    const total = o.total || 0;
    const sf = o.service_fee || 0;
    // CA Club = what the club earns = total paid by client minus Yuno service fee
    const club = total - sf;
    caClub += club;
    // CA Net = CA Club minus Stripe fee (Stripe charges on the full amount including Yuno fee)
    caNet += club - calcStripeFee(total);
  }
  return { caClub, caNet };
}

function calcTicketsRevenue(tickets: any[]): { caClub: number; caNet: number } {
  let caClub = 0, caNet = 0;
  for (const t of tickets) {
    const tp = t.total_price || 0;
    const sf = t.service_fee || 0;
    const inf = t.insurance_fee || 0;
    const club = tp - sf - inf;
    caClub += club;
    caNet += club - calcStripeFee(tp);
  }
  return { caClub, caNet };
}

function calcTablesRevenue(tables: any[]): { caClub: number; caNet: number } {
  let caClub = 0, caNet = 0;
  for (const t of tables) {
    const tp = t.total_price || 0;
    const sf = t.service_fee || 0;
    const mf = t.management_fee || 0;
    const club = tp - sf - mf;
    caClub += club;
    caNet += club - calcStripeFee(tp);
  }
  return { caClub, caNet };
}

function r2(n: number): number { return Math.round(n * 100) / 100; }

// ═══════════════════════════════════════════
// TOOL EXECUTORS
// ═══════════════════════════════════════════

async function executeTool(
  toolName: string,
  args: Record<string, any>,
  supabase: any,
  venueId: string
): Promise<string> {
  try {
    switch (toolName) {

      // ─── STATS ───
      case "get_venue_stats": {
        const since = getPeriodFilter(args.period || "30d");
        const periodEnd = getPeriodEnd(args.period || "30d");

        const { data: venueEvents } = await supabase.from("events").select("id").eq("venue_id", venueId);
        const eventIds = (venueEvents || []).map((e: any) => e.id);
        const { data: venueZones } = await supabase.from("table_zones").select("id").eq("venue_id", venueId);
        const zoneIds = (venueZones || []).map((z: any) => z.id);

        let oq = supabase.from("orders").select("total, service_fee", { count: "exact" }).eq("venue_id", venueId).eq("status", "paid").gte("created_at", since);
        if (periodEnd) oq = oq.lt("created_at", periodEnd);
        const ordersRes = await oq;

        let ticketsData: any[] = [];
        let ticketsCount = 0;
        if (eventIds.length > 0) {
          let tq = supabase.from("tickets").select("total_price, service_fee, insurance_fee", { count: "exact" }).eq("status", "paid").in("event_id", eventIds).gte("created_at", since);
          if (periodEnd) tq = tq.lt("created_at", periodEnd);
          const tr = await tq;
          ticketsData = tr.data || [];
          ticketsCount = tr.count || 0;
        }

        let tablesData: any[] = [];
        let tablesCount = 0;
        if (zoneIds.length > 0) {
          let trq = supabase.from("table_reservations").select("total_price, service_fee, management_fee", { count: "exact" }).eq("status", "confirmed").in("zone_id", zoneIds).gte("created_at", since);
          if (periodEnd) trq = trq.lt("created_at", periodEnd);
          const tres = await trq;
          tablesData = tres.data || [];
          tablesCount = tres.count || 0;
        }

        const drinksRes = await supabase.from("drinks").select("id", { count: "exact", head: true }).eq("venue_id", venueId).eq("active", true);

        const ord = calcOrdersRevenue(ordersRes.data || []);
        const tik = calcTicketsRevenue(ticketsData);
        const tab = calcTablesRevenue(tablesData);

        return JSON.stringify({
          period: args.period,
          orders: { count: ordersRes.count || 0, ca_club: r2(ord.caClub), ca_net: r2(ord.caNet) },
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
        const evtIds = (venueEvts || []).map((e: any) => e.id);
        const { data: venueZns } = await supabase.from("table_zones").select("id").eq("venue_id", venueId);
        const znIds = (venueZns || []).map((z: any) => z.id);

        let oq = supabase.from("orders").select("total, service_fee").eq("venue_id", venueId).eq("status", "paid").gte("created_at", since);
        if (periodEnd) oq = oq.lt("created_at", periodEnd);
        const ordersRes = await oq;

        let ticketsData: any[] = [];
        if (evtIds.length > 0) {
          let tq = supabase.from("tickets").select("total_price, service_fee, insurance_fee").eq("status", "paid").in("event_id", evtIds).gte("created_at", since);
          if (periodEnd) tq = tq.lt("created_at", periodEnd);
          ticketsData = (await tq).data || [];
        }

        let tablesData: any[] = [];
        if (znIds.length > 0) {
          let trq = supabase.from("table_reservations").select("total_price, service_fee, management_fee").eq("status", "confirmed").in("zone_id", znIds).gte("created_at", since);
          if (periodEnd) trq = trq.lt("created_at", periodEnd);
          tablesData = (await trq).data || [];
        }

        const ord = calcOrdersRevenue(ordersRes.data || []);
        const tik = calcTicketsRevenue(ticketsData);
        const tab = calcTablesRevenue(tablesData);

        return JSON.stringify({
          period: args.period,
          orders: { count: (ordersRes.data || []).length, ca_club: r2(ord.caClub), ca_net: r2(ord.caNet) },
          tickets: { count: ticketsData.length, ca_club: r2(tik.caClub), ca_net: r2(tik.caNet) },
          tables: { count: tablesData.length, ca_club: r2(tab.caClub), ca_net: r2(tab.caNet) },
          total_ca_club: r2(ord.caClub + tik.caClub + tab.caClub),
          total_ca_net: r2(ord.caNet + tik.caNet + tab.caNet),
        });
      }

      // ─── EVENTS ───
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

        const enriched = await Promise.all((data || []).map(async (e: any) => {
          const { count } = await supabase.from("tickets").select("id", { count: "exact", head: true }).eq("event_id", e.id).eq("status", "paid");
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
        const eventIds = (venueEvents || []).map((e: any) => e.id);
        const { data: venueZones } = await supabase.from("table_zones").select("id").eq("venue_id", venueId);
        const zoneIds = (venueZones || []).map((z: any) => z.id);

        const ordersRes = await supabase.from("orders").select("total, service_fee, status", { count: "exact" }).eq("venue_id", venueId).eq("status", "paid").gte("created_at", since).lt("created_at", until);
        const pendingRes = await supabase.from("orders").select("id", { count: "exact", head: true }).eq("venue_id", venueId).eq("status", "paid").is("served_at", null).gte("created_at", since).lt("created_at", until);

        let ticketsData: any[] = [];
        let ticketsScanned = 0;
        if (eventIds.length > 0) {
          const tr = await supabase.from("tickets").select("total_price, service_fee, insurance_fee, entry_scanned").eq("status", "paid").in("event_id", eventIds).gte("created_at", since).lt("created_at", until);
          ticketsData = tr.data || [];
          ticketsScanned = ticketsData.filter((t: any) => t.entry_scanned).length;
        }

        let tablesData: any[] = [];
        if (zoneIds.length > 0) {
          const tres = await supabase.from("table_reservations").select("total_price, service_fee, management_fee").eq("status", "confirmed").in("zone_id", zoneIds).gte("created_at", since).lt("created_at", until);
          tablesData = tres.data || [];
        }

        const ord = calcOrdersRevenue(ordersRes.data || []);
        const tik = calcTicketsRevenue(ticketsData);
        const tab = calcTablesRevenue(tablesData);

        return JSON.stringify({
          window: { from: since, to: until },
          orders: { count: ordersRes.count || 0, pending: pendingRes.count || 0, ca_club: r2(ord.caClub), ca_net: r2(ord.caNet) },
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
          orders: (data || []).map((o: any) => {
            const items = Array.isArray(o.items) ? o.items : [];
            const itemNames = items.map((i: any) => {
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
        const updates: any = { price: args.price };
        if (args.promo_price !== undefined) updates.promo_price = args.promo_price;
        const { error } = await supabase.from("drinks").update(updates).eq("id", args.drink_id);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, drink: drink.name, old_price: drink.price, new_price: args.price });
      }

      // ─── STAFF ───
      case "get_staff_list": {
        const { data } = await supabase.from("profiles").select("id, first_name, last_name, email").eq("venue_id", venueId);
        if (!data || data.length === 0) return JSON.stringify([]);
        const userIds = data.map((p: any) => p.id);
        const { data: roles } = await supabase.from("user_roles").select("user_id, role").in("user_id", userIds).in("role", ["barman", "bouncer", "vip_host", "cloakroom", "manager"]);
        const staffWithRoles = data.map((p: any) => ({ ...p, roles: (roles || []).filter((r: any) => r.user_id === p.id).map((r: any) => r.role) })).filter((p: any) => p.roles.length > 0);
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
        const zoneIds = zones.map((z: any) => z.id);
        const { data } = await supabase.from("table_reservations").select("id, full_name, status, total_price, zone_id, created_at").in("zone_id", zoneIds).eq("event_id", eventId).order("created_at", { ascending: false });
        return JSON.stringify(data || []);
      }

      // ─── EVENT DETAILS (with revenue) ───
      case "get_event_details": {
        const { data: evt } = await supabase.from("events").select("*").eq("id", args.event_id).eq("venue_id", venueId).maybeSingle();
        if (!evt) return JSON.stringify({ error: "Event not found" });

        // Fetch ticket rounds, tickets data, orders, and table zones in parallel
        const { data: zones } = await supabase.from("table_zones").select("id").eq("venue_id", venueId);
        const zoneIds = (zones || []).map((z: any) => z.id);

        const [roundsRes, ticketsDataRes, ordersDataRes, tablesDataRes] = await Promise.all([
          supabase.from("ticket_rounds").select("id, name, price, max_tickets, tickets_sold, is_active").eq("event_id", args.event_id).order("position"),
          supabase.from("tickets").select("total_price, service_fee, insurance_fee", { count: "exact" }).eq("event_id", args.event_id).eq("status", "paid"),
          supabase.from("orders").select("total, service_fee").eq("event_id", args.event_id).eq("venue_id", venueId).eq("status", "paid"),
          zoneIds.length > 0
            ? supabase.from("table_reservations").select("total_price, service_fee, management_fee").eq("event_id", args.event_id).eq("status", "confirmed").in("zone_id", zoneIds)
            : Promise.resolve({ data: [] }),
        ]);

        const tik = calcTicketsRevenue(ticketsDataRes.data || []);
        const ord = calcOrdersRevenue(ordersDataRes.data || []);
        const tab = calcTablesRevenue(tablesDataRes.data || []);

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
          tickets_sold: ticketsDataRes.count || 0,
          revenue: {
            orders: { count: (ordersDataRes.data || []).length, ca_club: r2(ord.caClub), ca_net: r2(ord.caNet) },
            tickets: { count: (ticketsDataRes.data || []).length, ca_club: r2(tik.caClub), ca_net: r2(tik.caNet) },
            tables: { count: (tablesDataRes.data || []).length, ca_club: r2(tab.caClub), ca_net: r2(tab.caNet) },
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
        const zoneIds = (zones || []).map((z: any) => z.id);

        const [ticketsDataRes, ordersDataRes, tablesDataRes] = await Promise.all([
          supabase.from("tickets").select("total_price, service_fee, insurance_fee").eq("event_id", args.event_id).eq("status", "paid"),
          supabase.from("orders").select("total, service_fee").eq("event_id", args.event_id).eq("venue_id", venueId).eq("status", "paid"),
          zoneIds.length > 0
            ? supabase.from("table_reservations").select("total_price, service_fee, management_fee").eq("event_id", args.event_id).eq("status", "confirmed").in("zone_id", zoneIds)
            : Promise.resolve({ data: [] }),
        ]);

        const tik = calcTicketsRevenue(ticketsDataRes.data || []);
        const ord = calcOrdersRevenue(ordersDataRes.data || []);
        const tab = calcTablesRevenue(tablesDataRes.data || []);

        return JSON.stringify({
          event_id: args.event_id,
          event_title: evt.title,
          orders: { count: (ordersDataRes.data || []).length, ca_club: r2(ord.caClub), ca_net: r2(ord.caNet) },
          tickets: { count: (ticketsDataRes.data || []).length, ca_club: r2(tik.caClub), ca_net: r2(tik.caNet) },
          tables: { count: (tablesDataRes.data || []).length, ca_club: r2(tab.caClub), ca_net: r2(tab.caNet) },
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
        const updates: any = {};
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

      case "toggle_guest_list": {
        const { data: evt } = await supabase.from("events").select("id").eq("id", args.event_id).eq("venue_id", venueId).maybeSingle();
        if (!evt) return JSON.stringify({ error: "Event not found for this venue" });
        const { data: gl } = await supabase.from("guest_lists").select("id").eq("event_id", args.event_id).maybeSingle();
        if (!gl) return JSON.stringify({ error: "No guest list configured for this event." });
        const { error } = await supabase.from("guest_lists").update({ is_active: args.active }).eq("id", gl.id);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, event_id: args.event_id, guest_list_active: args.active });
      }

      // ─── ONBOARDING ───
      case "get_onboarding_status": {
        const { data } = await supabase.from("venue_onboarding").select("current_step, completed_steps").eq("venue_id", venueId).maybeSingle();
        const { data: venue } = await supabase.from("venues").select("stripe_account_id, name").eq("id", venueId).maybeSingle();
        return JSON.stringify({
          current_step: data?.current_step || "not_started",
          completed_steps: data?.completed_steps || [],
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
          supabase.from("venue_customers").select("total_spent").eq("venue_id", venueId),
        ]);
        const customers = totalCustomers.data || [];
        const totalSpent = customers.reduce((s: number, c: any) => s + (c.total_spent || 0), 0);
        const avgSpent = customers.length > 0 ? totalSpent / customers.length : 0;
        const segments = {
          platinum: customers.filter((c: any) => (c.total_spent || 0) >= 1000).length,
          gold: customers.filter((c: any) => (c.total_spent || 0) >= 500 && (c.total_spent || 0) < 1000).length,
          silver: customers.filter((c: any) => (c.total_spent || 0) >= 200 && (c.total_spent || 0) < 500).length,
          bronze: customers.filter((c: any) => (c.total_spent || 0) < 200).length,
        };
        return JSON.stringify({
          total_customers: customers.length,
          total_revenue: r2(totalSpent),
          average_spend: r2(avgSpent),
          segments,
          top_customers: (topCustomers.data || []).map((c: any) => ({
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
        const { data: orders } = await supabase.from("orders").select("items").eq("venue_id", venueId).eq("status", "paid").gte("created_at", since);
        if (!orders || orders.length === 0) return JSON.stringify({ message: "Aucune commande pour cette période", top_drinks: [] });
        const drinkSales: Record<string, { name: string; qty: number; revenue: number }> = {};
        for (const order of orders) {
          const items = order.items as any[];
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
          const modeLabel = eventsRes.data.ticket_selling_mode === "rounds" ? "Rounds" : eventsRes.data.ticket_selling_mode === "timed_entry" ? "Créneaux horaires" : "Simple";
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
          .select("id, first_name, last_name, pending_amount, total_paid, total_conversions, is_active")
          .eq("venue_id", venueId)
          .order("total_conversions", { ascending: false });

        if (!promoters || promoters.length === 0) {
          return JSON.stringify({ message: "Aucun promoteur configuré pour ce club.", promoters: [] });
        }

        return JSON.stringify({
          total_promoters: promoters.length,
          active: promoters.filter((p: any) => p.is_active).length,
          promoters: promoters.map((p: any) => ({
            name: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
            conversions: p.total_conversions || 0,
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
// MAIN HANDLER
// ═══════════════════════════════════════════

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

    // Verify owner role
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
    const isOwner = roles?.some((r: any) => r.role === "owner");
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
    const { messages, venueContext } = await req.json();

    // Fetch subscription plan
    let venuePlan = "essential";
    try {
      const subRes = await fetch(`${supabaseUrl}/functions/v1/check-club-subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ venueId }),
      });
      if (subRes.ok) {
        const subData = await subRes.json();
        venuePlan = subData?.subscriptionPlan || "essential";
      }
    } catch (e) { log("plan_fetch_error", { error: String(e) }); }

    // Build context
    let contextBlock = `\n\n📍 CONTEXTE :`;
    if (venueContext?.venueName) contextBlock += `\n- Club : ${venueContext.venueName}`;
    if (venueContext?.stripeConnected !== undefined) contextBlock += `\n- Stripe : ${venueContext.stripeConnected ? "Connecté" : "Non connecté"}`;
    if (venueContext?.eventsCount !== undefined) contextBlock += `\n- Events : ${venueContext.eventsCount}`;
    if (venueContext?.staffCount !== undefined) contextBlock += `\n- Staff : ${venueContext.staffCount}`;
    if (venueContext?.drinksCount !== undefined) contextBlock += `\n- Boissons actives : ${venueContext.drinksCount}`;
    if (venueContext?.currentPage) contextBlock += `\n- Page actuelle : ${venueContext.currentPage}`;
    contextBlock += `\n- Plan : ${venuePlan.toUpperCase()}`;

    // Training data
    let trainingContext = "";
    try {
      const { data: trainingData } = await supabase.from("chatbot_training").select("question, answer, category").eq("is_active", true).order("category");
      if (trainingData && trainingData.length > 0) {
        trainingContext = "\n\n📚 FAQ :\n";
        for (const item of trainingData) {
          trainingContext += `Q: ${item.question}\nR: ${item.answer}\n\n`;
        }
      }
    } catch { /* ignore */ }

    const systemPrompt = OWNER_SYSTEM_PROMPT + contextBlock + trainingContext;

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

    let conversationMessages: any[] = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    const MAX_ROUNDS = 3;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const roundResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: aiHeaders,
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: conversationMessages,
          tools: TOOLS,
          tool_choice: "auto",
          stream: false,
        }),
      });

      if (!roundResponse.ok) {
        const status = roundResponse.status;
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
      const choice = roundResult.choices?.[0];

      // No tool calls → use the content we already have (no redundant API call)
      if (!choice?.message?.tool_calls || choice.message.tool_calls.length === 0) {
        const finalContent = choice?.message?.content || "";
        log("final_answer", { round, content_length: finalContent.length });

        // Format as SSE manually from the already-obtained content
        const ssePayload = `data: ${JSON.stringify({ choices: [{ delta: { content: finalContent } }] })}\n\ndata: [DONE]\n\n`;
        return new Response(ssePayload, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });
      }

      // Execute tool calls
      const toolCalls = choice.message.tool_calls;
      log("tool_calls", { round, tools: toolCalls.map((tc: any) => tc.function.name) });

      // Add assistant message with tool calls
      conversationMessages.push(choice.message);

      for (const tc of toolCalls) {
        const fnName = tc.function.name;
        let fnArgs: Record<string, any> = {};
        try { fnArgs = JSON.parse(tc.function.arguments || "{}"); } catch { /* empty */ }

        // Plan gating
        const minPlan = TOOL_MIN_PLAN[fnName];
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
        const result = await executeTool(fnName, fnArgs, supabase, venueId);
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
        model: "google/gemini-3-flash-preview",
        messages: conversationMessages,
        stream: true,
      }),
    });

    if (!finalStream.ok) throw new Error("Final stream error");

    return new Response(finalStream.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });

  } catch (e) {
    log("fatal_error", { error: String(e) });
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
