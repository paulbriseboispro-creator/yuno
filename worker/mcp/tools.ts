// Les outils du serveur MCP Yuno. Tous en LECTURE SEULE.
//
// Chaque description suit la même grammaire (guide OpenAI / Anthropic) : à quoi
// sert l'outil, quand l'utiliser (avec des questions de pro en exemple), ce
// qu'il rend, et quand préférer un autre outil. C'est elle qui fait choisir le
// bon outil à l'IA : la soigner autant qu'un écran.
//
// Le niveau `customers` (fiches nominatives) n'apparaît que si la personne l'a
// coché à la connexion ; la base le revérifie à chaque appel (mcp_call).

export type ToolLevel = 'analytics' | 'customers';
export type Product = 'suite' | 'crm';

type JsonSchema = Record<string, unknown>;

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  level: ToolLevel;
  products?: Product[];
  // Outil servi par le Worker sans appel aux données (glossaire, aide).
  local?: boolean;
  // Arguments posés quand l'IA ne les donne pas (fenêtre par défaut).
  defaults?: Record<string, unknown>;
  // Outil à fenêtre de temps : sur un dépassement de délai, le Worker relance
  // une fois sur une fenêtre resserrée plutôt que de rendre une erreur.
  windowed?: boolean;
}

const SPACE: JsonSchema = {
  type: 'string',
  description: 'Optional. Space key from connection_spaces in get_account_overview ("venue:<id>" for a club, "org:<id>" for an organizer), or the exact space name. Omitted: the default space, named in every result.',
};
const DAYS = (def: number): JsonSchema => ({
  type: 'integer', minimum: 1, maximum: 1095,
  description: `Look-back window in days, ending today (default ${def}). Ignored when "from" is given.`,
});
const FROM: JsonSchema = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Window start, YYYY-MM-DD (e.g. 2026-09-01).' };
const TO: JsonSchema = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Window end, YYYY-MM-DD, inclusive (default today).' };
const EVENT: JsonSchema = {
  type: 'string', minLength: 1, maxLength: 120,
  description: 'Event id (uuid from list_events), or "last" (most recent finished event), or "next" (next or ongoing event), or part of the event title (the closest date wins). Example: "last", "Reggaeton".',
};

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const TOOLS: ToolDef[] = [
  {
    name: 'get_account_overview',
    title: 'Account overview',
    level: 'analytics',
    description:
      'Returns the context of the connected Yuno account: the space (club or organizer) and the other spaces available, '
      + "today's date and timezone, whether money amounts are visible to this person, the access level (analytics or customers), the product "
      + '(suite = Yuno ticketing, crm = external ticketing such as Shotgun), event counts, the last 5 and next 5 events with their ids, '
      + 'and notes on how Yuno numbers are defined. Use it at the start of a conversation about Yuno data, or to resolve "my last party", "next Saturday", "this season".',
    inputSchema: { type: 'object', properties: { space: SPACE }, additionalProperties: false },
  },
  {
    name: 'list_events',
    title: 'List events',
    level: 'analytics',
    description:
      'Use this to find events and their ids, or to see headline numbers per event (people, tickets, tables, guest list, visits, club revenue). '
      + 'when="upcoming" also returns the sales pipeline of the next events (capacity, sold, sold today, revenue, visits). Filter by part of the title or by dates. '
      + 'Examples: "what are my next events?", "list my September parties", "which party sold the most?". '
      + 'Not for the analysis of one event: use get_event_report.',
    inputSchema: {
      type: 'object',
      properties: {
        space: SPACE,
        when: { type: 'string', enum: ['upcoming', 'past', 'all'], description: 'upcoming (not finished yet), past (finished), all (default).' },
        search: { type: 'string', maxLength: 80, description: 'Part of the event title.' },
        from: FROM,
        to: TO,
        limit: { type: 'integer', minimum: 1, maximum: 60, description: 'Max events returned (default 20).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_event_report',
    title: 'Event report',
    level: 'analytics',
    description:
      "The full report of ONE event, exactly as the Console's event report: sales by pillar (tickets, VIP tables, guest list), club revenue "
      + '(net of Yuno fees), entries at the door vs expected, the sales curve by calendar day before the event (D-N) compared with the previous event at the same D-N, '
      + 'pace and entry target, visits and visit sources, what drove sales (channels, tracked links, emails, push with attributed revenue), '
      + 'new vs returning customers, key markers (publication, tier changes, messages) and computed takeaways. '
      + 'Examples: "how did last night go?", "how is next Saturday selling?", "why did it underperform?". '
      + 'For a CRM account (external ticketing) it returns the ticketing report (tickets, buyers, scans, deals, UTM sources).',
    inputSchema: { type: 'object', properties: { space: SPACE, event: EVENT }, required: ['event'], additionalProperties: false },
  },
  {
    name: 'get_event_details',
    title: 'Event deep dive',
    level: 'analytics',
    description:
      'Zoom into one aspect of one event, after get_event_report. topic: '
      + 'ticket_types (each tier: price, capacity, sold, fill %, open/closed, sale dates, entry deadline); '
      + 'tables (VIP reservations by zone and pack, party size, lead time, booking hour, deposits, no-show rate); '
      + 'guest_list (signups vs arrivals by list holder, gender, signup lead time, arrival hours); '
      + 'traffic (event page funnel: visits, carts, checkouts, sources); '
      + 'pacing (cumulative sales day by day vs the reference event); '
      + 'door (arrival curve, peak, doors-open time); '
      + 'partners (what each partner of a co-hosted event brought); '
      + 'promoters (promoter results for this event). '
      + 'Examples: "which ticket tier sold out first?", "how many tables were no-shows?", "when did people arrive?".',
    inputSchema: {
      type: 'object',
      properties: {
        space: SPACE,
        event: EVENT,
        topic: { type: 'string', enum: ['ticket_types', 'tables', 'guest_list', 'traffic', 'pacing', 'door', 'partners', 'promoters'] },
        days: { type: 'integer', minimum: 7, maximum: 90, description: 'pacing only: number of days before the event (default 30).' },
      },
      required: ['event', 'topic'],
      additionalProperties: false,
    },
  },
  {
    name: 'compare_events',
    title: 'Compare events',
    level: 'analytics',
    description:
      'Compare 2 to 6 events side by side (sales by pillar, revenue, entries, audience new vs returning, channels, visit sources, takeaways). '
      + 'Pass "events" (ids, "last", or parts of titles) or "last" = N to compare the N most recent finished events. '
      + 'Examples: "compare my last 4 parties", "Thursday vs Saturday", "is the new concept better than the old one?".',
    inputSchema: {
      type: 'object',
      properties: {
        space: SPACE,
        events: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 120 }, minItems: 2, maxItems: 6 },
        last: { type: 'integer', minimum: 2, maximum: 6, description: 'Compare the N most recent finished events (default 4) when "events" is omitted.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_sales_overview',
    title: 'Sales overview',
    level: 'analytics',
    description:
      'Sales over a set of FINISHED events, compared with the same number of events just before: club revenue (net of Yuno fees), '
      + 'tickets (with capacity), VIP tables (booked, guests, arrived), guest list (registered, entered), entries at the door, attendance, customers, '
      + 'spend per head, plus best ticket tiers, best table packs and computed takeaways. '
      + 'period: last (last event), last4 (default), month, year, all. '
      + 'Examples: "how are we doing?", "this month vs last month", "is it going up or down?".',
    inputSchema: {
      type: 'object',
      properties: { space: SPACE, period: { type: 'string', enum: ['last', 'last4', 'month', 'year', 'all'] } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_sales_trends',
    title: 'Sales trends and drivers',
    level: 'analytics',
    windowed: true,
    description:
      'Sales dynamics over a date window (events that started in it), compared with the previous window of the same length: '
      + 'the average sales curve per event by D-N (how early people buy), what drives sales (channels, tracked links, emails and push with attributed revenue), '
      + 'and new vs returning buyers. Examples: "when do people buy?", "which channel brings sales?", "is Instagram worth it?". Suite accounts.',
    inputSchema: { type: 'object', properties: { space: SPACE, days: DAYS(90), from: FROM, to: TO }, additionalProperties: false },
  },
  {
    name: 'get_purchase_behavior',
    title: 'Purchase behavior',
    level: 'analytics',
    defaults: { days: 90 },
    windowed: true,
    description:
      'How customers buy: lead time before the event, day x hour heatmap of purchases, group size, basket, ticket tiers, options taken, '
      + 'new vs regulars and revenue concentration, cross-purchases the same night (ticket + table), channels and devices, visit to purchase funnel, attendance at the door. '
      + 'Examples: "when should I open sales?", "at what time should I send my email?", "do people come in groups?".',
    inputSchema: { type: 'object', properties: { space: SPACE, days: DAYS(90), from: FROM, to: TO }, additionalProperties: false },
  },
  {
    name: 'get_audience_overview',
    title: 'Audience overview',
    level: 'analytics',
    description:
      'The contact base and its loyalty: total contacts, reachable by email and push, followers, growth over 24 months, participation (events per person), '
      + 'last purchase recency, new contacts per event, music tastes of the community (only genres shared by 10+ people) and monthly cohort retention '
      + '(RFM segments are in get_customer_segments). Examples: "how big is my base?", "is my audience growing?", "how loyal are they?", "what music do they like?". '
      + 'Can take a few seconds on large bases.',
    inputSchema: { type: 'object', properties: { space: SPACE }, additionalProperties: false },
  },
  {
    name: 'get_customer_segments',
    title: 'Customer segments',
    level: 'analytics',
    description:
      'Segmentation without personal data: RFM segments with counts and revenue (champions, loyal, promising/big occasional, new, at risk, dormant/lost), '
      + 'saved segments and their rules, imported contact lists health (active, unsubscribed, dead), and the suggested "high basket" threshold. '
      + 'Use before sizing or building a campaign audience. Examples: "who are my best customers?", "how many are at risk?".',
    inputSchema: { type: 'object', properties: { space: SPACE }, additionalProperties: false },
  },
  {
    name: 'count_contacts',
    title: 'Count an audience',
    level: 'analytics',
    description:
      'Count the contacts matching a rule (all conditions combined with AND) and how many are reachable by email (opt-in) and by SMS. '
      + 'Use to size any audience: "how many people took a table and have not come in 60 days?", "women aged 18-25 in Paris who opened an email". '
      + 'Condition types: '
      + 'numeric with op (gte, gt, lte, lt, eq) + value: spent (EUR, total), spent_per_event, events, tables, tickets, orders, guest_lists, emails_received, opens, clicks; '
      + 'days with op + value: last_seen_days, last_purchase_days, last_open_days, last_click_days, added_days; '
      + 'age with min / max; '
      + 'lists with in: [...]: country / country_not (ISO codes like "FR"), city, region, zone, gender ("female", "male"), '
      + 'engagement (active, passive, silent, new, unsubscribed, unreachable), origin (import, yuno, both), list (imported list id); '
      + 'booleans with value true/false: newsletter_opt_in, has_email, has_phone, yuno_customer, has_account. '
      + 'Example: {"conditions":[{"type":"tables","op":"gte","value":1},{"type":"last_seen_days","op":"gt","value":60}]}.',
    inputSchema: {
      type: 'object',
      properties: {
        space: SPACE,
        conditions: {
          type: 'array',
          minItems: 1,
          maxItems: 12,
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['spent', 'spent_per_event', 'events', 'tables', 'tickets', 'orders', 'guest_lists', 'emails_received', 'opens', 'clicks',
                  'last_seen_days', 'last_purchase_days', 'last_open_days', 'last_click_days', 'added_days', 'age',
                  'country', 'country_not', 'city', 'region', 'zone', 'gender', 'engagement', 'origin', 'list',
                  'newsletter_opt_in', 'has_email', 'has_phone', 'yuno_customer', 'has_account'],
              },
              op: { type: 'string', enum: ['gte', 'gt', 'lte', 'lt', 'eq'] },
              value: { type: ['number', 'boolean'] },
              in: { type: 'array', items: { type: 'string', maxLength: 80 }, maxItems: 50 },
              min: { type: 'integer', minimum: 0, maximum: 120 },
              max: { type: 'integer', minimum: 0, maximum: 120 },
            },
            required: ['type'],
            additionalProperties: false,
          },
        },
      },
      required: ['conditions'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_web_traffic',
    title: 'Web traffic',
    level: 'analytics',
    windowed: true,
    description:
      'Visits to the public page and the event pages: daily visits, sources (Instagram, direct, Google, email, links...), devices, '
      + 'purchases and conversion by source, funnel visit to cart to purchase. Examples: "where do my visitors come from?", "does Instagram convert?".',
    inputSchema: { type: 'object', properties: { space: SPACE, days: DAYS(30), from: FROM, to: TO }, additionalProperties: false },
  },
  {
    name: 'get_marketing_performance',
    title: 'Marketing performance',
    level: 'analytics',
    windowed: true,
    description:
      'Marketing results over a window: email campaigns (recipients, delivered, open and click rates, unsubscribes, contacts protected by Yuno sending rules) '
      + 'with revenue attributed (click then purchase within 72 h), the best send time, email automations (each recipe on/off, sent, opens, buyers) '
      + 'and Yuno suggestions of recipes to turn on, push campaigns and automatic push results, SMS campaigns. '
      + 'channel: all (default), email, automations, push, sms. Examples: "did my last email work?", "which automations should I turn on?".',
    inputSchema: {
      type: 'object',
      properties: {
        space: SPACE,
        channel: { type: 'string', enum: ['all', 'email', 'automations', 'push', 'sms'] },
        days: DAYS(90), from: FROM, to: TO,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_campaign_report',
    title: 'Email campaign report',
    level: 'analytics',
    description:
      'Detail of one email campaign by id (ids come from get_marketing_performance): delivery, opens, clicks, unsubscribes, bounces, complaints, '
      + 'revenue attributed, A/B subject test result, resend to non-openers and click follow-up results.',
    inputSchema: {
      type: 'object',
      properties: { space: SPACE, campaign_id: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' } },
      required: ['campaign_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_promoters_performance',
    title: 'Promoters performance',
    level: 'analytics',
    windowed: true,
    products: ['suite'],
    description:
      'Promoter (RP) results over a window: link clicks, orders, tickets, tables, guest list, people brought, attendance at the door, share of new customers, '
      + 'attributed sales, commissions due and paid. Examples: "who are my best promoters?", "which promoter brings people who actually come?".',
    inputSchema: { type: 'object', properties: { space: SPACE, days: DAYS(90), from: FROM, to: TO }, additionalProperties: false },
  },
  {
    name: 'get_live_now',
    title: 'Live right now',
    level: 'analytics',
    products: ['suite'],
    description:
      'Real-time view: visitors on the pages right now, sales in the last 10 and 60 minutes, tickets per minute, cities, pages viewed and the live feed of visits and sales. '
      + 'Use during a ticket release or on the night itself: "how is the release going?", "is it selling right now?".',
    inputSchema: { type: 'object', properties: { space: SPACE }, additionalProperties: false },
  },
  {
    name: 'get_recommendations',
    title: 'Signals for recommendations',
    level: 'analytics',
    description:
      'Everything needed to build a concrete action plan in one call: takeaways of the last 4 events vs the 4 before, the pipeline of upcoming events '
      + '(sell-through vs capacity, sold today), 30-day signals (for example a channel with traffic but no sales), RFM segments (at risk, lost), '
      + 'email automations on/off and the recipes Yuno suggests turning on. '
      + 'Examples: "what should I do this week?", "how can I sell more?", "give me an action plan".',
    inputSchema: { type: 'object', properties: { space: SPACE }, additionalProperties: false },
  },
  {
    name: 'list_customers',
    title: 'List customers',
    level: 'customers',
    description:
      'List customers WITH identity (first name, last name, email) and their stats (spend, events, tables, tickets, guest lists, last seen, email engagement, consent). '
      + 'Sort by spent (default), events, engaged, recent or name; filter by text search (name or email), saved segment id, engagement status or origin. '
      + 'Max 50 per page. Only available when the person granted the "customers" level. '
      + 'Examples: "who are my top 20 customers?", "find Julie", "list my silent contacts".',
    inputSchema: {
      type: 'object',
      properties: {
        space: SPACE,
        search: { type: 'string', maxLength: 80 },
        segment_id: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$', description: 'Saved segment id from get_customer_segments.' },
        status: { type: 'string', enum: ['active', 'passive', 'silent', 'new', 'unsubscribed', 'unreachable'] },
        origin: { type: 'string', enum: ['import', 'yuno', 'both'] },
        sort: { type: 'string', enum: ['spent', 'events', 'engaged', 'recent', 'name'] },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        offset: { type: 'integer', minimum: 0, maximum: 500 },
        include_phone: { type: 'boolean', description: 'Also return phone numbers (default false). Only when the user explicitly needs them.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_customers_by_segment',
    title: 'Customers of a segment',
    level: 'customers',
    description:
      'List the customers of an RFM segment, sorted by spend, with name, email, spend, nights, tickets, tables, average basket, days since last visit and favourite event. '
      + 'segment: champions, loyal, promising, new, at_risk, dormant, lost, or churn_risk (regulars who stopped coming). Only with the "customers" level. '
      + 'Examples: "which VIPs stopped coming?", "who should I personally invite back?".',
    inputSchema: {
      type: 'object',
      properties: {
        space: SPACE,
        segment: { type: 'string', enum: ['champions', 'loyal', 'promising', 'new', 'at_risk', 'dormant', 'lost', 'churn_risk'] },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['segment'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_customer_profile',
    title: 'Customer profile',
    level: 'customers',
    description:
      "One customer's profile by email: origin (imported, Yuno, both), spend, events, tickets, tables, guest lists, first and last activity, email engagement, "
      + 'consent (email, SMS), and the automated emails they received. Only with the "customers" level. Example: "tell me about julie@example.com".',
    inputSchema: {
      type: 'object',
      properties: { space: SPACE, email: { type: 'string', maxLength: 200 } },
      required: ['email'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_glossary',
    title: 'Metric definitions',
    level: 'analytics',
    local: true,
    description:
      'Exact definitions of every Yuno metric (club revenue vs customer spend, entries, attendance, fill rate, D-N, conversion, attribution windows, '
      + 'RFM segments, engagement statuses, sample size rules). Use when unsure what a number means or before explaining a metric to the user.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_yuno_help',
    title: 'Yuno how-to',
    level: 'analytics',
    local: true,
    description:
      'How-to answers from the Yuno Console manual: where to click and what to fill to do something (create an email campaign, turn on an automation, '
      + 'add a promo code, mark an event sold out, set up VIP tables, add a guest list, track a link, set an entry target, connect Meta...). '
      + 'Use it when the user needs the exact steps to do something in Yuno. Example query: "turn on abandoned cart email".',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 2, maxLength: 200 } },
      required: ['query'],
      additionalProperties: false,
    },
  },
];

export const TOOL_BY_NAME: ReadonlyMap<string, ToolDef> = new Map(TOOLS.map((t) => [t.name, t]));

export interface SessionSpace {
  key: string;
  kind: 'venue' | 'organizer';
  name: string;
  product: Product;
  timezone: string;
  role: string;
  money: boolean;
  customers: boolean;
}

// Les outils proposés à CETTE connexion : niveau accordé et produits couverts.
export function toolsFor(level: ToolLevel, spaces: SessionSpace[]): ToolDef[] {
  const products = new Set(spaces.map((s) => s.product));
  const anyCustomers = level === 'customers' && spaces.some((s) => s.customers);
  return TOOLS.filter((t) => {
    if (t.level === 'customers' && !anyCustomers) return false;
    if (t.products && !t.products.some((p) => products.has(p))) return false;
    return true;
  });
}

export function toolListing(t: ToolDef): Record<string, unknown> {
  return {
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { title: t.title, ...READ_ONLY_ANNOTATIONS },
  };
}

// ── Validation des arguments ────────────────────────────────────────────────
// Légère et stricte : types, énumérations, bornes, motifs. Une propriété
// inconnue est ignorée (jamais transmise). L'erreur rendue dit à l'IA quoi
// corriger.

export type ValidationResult = { ok: true; args: Record<string, unknown> } | { ok: false; message: string };

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function matchesType(v: unknown, t: unknown): boolean {
  const types = Array.isArray(t) ? t : [t];
  const actual = typeOf(v);
  return types.some((x) => x === actual || (x === 'number' && actual === 'integer'));
}

function check(path: string, value: unknown, schema: JsonSchema): string | null {
  if (schema.type && !matchesType(value, schema.type)) {
    // Tolérance : un entier envoyé en chaîne (« 30 ») est accepté.
    return `${path} must be ${Array.isArray(schema.type) ? schema.type.join(' or ') : schema.type}`;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return `${path} must be one of: ${(schema.enum as unknown[]).join(', ')}`;
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return `${path} is too short`;
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return `${path} is too long (max ${schema.maxLength})`;
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) return `${path} has an invalid format`;
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return `${path} must be >= ${schema.minimum}`;
    if (typeof schema.maximum === 'number' && value > schema.maximum) return `${path} must be <= ${schema.maximum}`;
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) return `${path} needs at least ${schema.minItems} items`;
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return `${path} accepts at most ${schema.maxItems} items`;
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        const err = check(`${path}[${i}]`, value[i], schema.items as JsonSchema);
        if (err) return err;
      }
    }
  }
  if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
    for (const req of (schema.required as string[] | undefined) ?? []) {
      if ((value as Record<string, unknown>)[req] === undefined) return `${path ? `${path}.` : ''}${req} is required`;
    }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (props[k] && v !== undefined && v !== null) {
        const err = check(path ? `${path}.${k}` : k, v, props[k]);
        if (err) return err;
      }
    }
  }
  return null;
}

function coerce(value: unknown, schema: JsonSchema): unknown {
  if (typeof value === 'string' && (schema.type === 'integer' || schema.type === 'number') && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value.trim());
  }
  if (typeof value === 'string' && schema.type === 'boolean' && (value === 'true' || value === 'false')) return value === 'true';
  return value;
}

export function validateArgs(tool: ToolDef, raw: unknown): ValidationResult {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const props = ((tool.inputSchema.properties ?? {}) as Record<string, JsonSchema>);
  const args: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!props[k] || v === undefined || v === null || v === '') continue;
    args[k] = coerce(v, props[k]);
  }
  const err = check('', args, tool.inputSchema);
  return err ? { ok: false, message: `Invalid arguments: ${err}.` } : { ok: true, args };
}
