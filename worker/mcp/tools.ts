// Les outils du serveur MCP Yuno. Tous en LECTURE SEULE, sauf sept : la
// création et la modification d'un BROUILLON d'e-mail (create_email_draft,
// update_email_draft), l'ajout d'une image (add_email_image), et la création
// et la modification d'une PAGE D'INSCRIPTION (create_signup_page en
// brouillon, update_signup_page : brouillon modifié, page publiée = une
// proposition que le pro applique), et la création et la modification d'un
// BROUILLON de scénario (create_scenario_draft, update_scenario_draft). Chaque
// famille a sa permission, posée au consentement ; tout s'écrit par la seule
// porte mcp_write. Aucun outil n'envoie ni ne publie.
//
// Chaque description suit la même grammaire (guide OpenAI / Anthropic) : à quoi
// sert l'outil, quand l'utiliser (avec des questions de pro en exemple), ce
// qu'il rend, et quand préférer un autre outil. C'est elle qui fait choisir le
// bon outil à l'IA : la soigner autant qu'un écran.
//
// Le niveau `customers` (fiches nominatives) n'apparaît que si la personne l'a
// coché à la connexion ; la base le revérifie à chaque appel (mcp_call).

import { SCENARIO_TEMPLATES } from '../../src/crm/lib/scenarioTemplates';

const SCENARIO_TEMPLATE_KEYS: readonly string[] = SCENARIO_TEMPLATES;

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
  // Outil d'ÉCRITURE (brouillon d'e-mail) : listé seulement pour une connexion
  // qui a le droit aux brouillons, exécuté par mcp_write.
  write?: boolean;
  // Écriture qui remplace un contenu existant (annotation destructiveHint).
  destructive?: boolean;
  // Outil d'e-mail : sa réponse garde les URL d'images (affiche, logo, photos).
  email?: boolean;
  // Réservé aux connexions qui ont le droit aux brouillons (sans être une écriture).
  drafts?: boolean;
  // Outil des pages d'inscription : listé pour une connexion qui en a le droit
  // (can_pages) et dont un espace a Yuno CRM actif.
  pages?: boolean;
  // Sert aux deux familles (e-mails ET pages) : listé si l'une est accordée.
  shared?: boolean;
  // Outil des scénarios (Yuno CRM) : listé si un espace a Yuno CRM. Lecture
  // (liste, rapport) pour toute connexion ; le kit et les brouillons
  // (`scenarioDrafts`) seulement pour une connexion qui en a le droit
  // (can_scenarios). Aucun outil ne publie un scénario.
  scenario?: boolean;
  scenarioDrafts?: boolean;
  // Métadonnées propres à un client (ex. `openai/fileParams` : ChatGPT y passe
  // le fichier que la personne a joint à la conversation).
  meta?: Record<string, unknown>;
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

const HEX: JsonSchema = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' };
const PRODUCT: JsonSchema = {
  type: 'string', enum: ['suite', 'crm'],
  description: 'suite = Yuno ticketing, crm = Yuno CRM (external ticketing such as Shotgun). Omitted: the product of the space. A Yuno ticketing account with Yuno CRM added has both (products_available in get_email_design_kit).',
};
const LANGUAGE: JsonSchema = {
  type: 'string', enum: ['fr', 'en', 'es'],
  description: 'Language of the email, the one the person writes in or asks for: native Yuno blocks (buttons, prices, tables left, countdown), dates, the values of Yuno tags and the legal footer follow it. Default fr.',
};
const SECTION: JsonSchema = {
  type: 'object',
  properties: {
    html: { type: 'string', maxLength: 60000, description: 'Email-safe HTML of the section (tables and inline styles, 600 px wide) with Yuno tags such as {{event.title}} or {{event.tickets_url}}.' },
    yuno_block: { type: 'string', enum: ['event', 'tickets', 'lineup', 'countdown', 'table', 'guestlist', 'social', 'divider', 'spacer'], description: 'Instead of html: a native Yuno block with a fixed design (event card, ticket tiers, line-up, countdown, VIP tables, guest list, social links, divider, spacer).' },
    options: { type: 'object', description: 'Options of a native block: accent (#rrggbb), kicker, title, subtitle, button, layout (showcase, banner, minimal, split), align (left, center, right), photos (line-up), price_display (rows, from), pack_display (packs, zones), size (spacer: sm, md, lg, xl), color (social icons, divider).' },
    label: { type: 'string', maxLength: 60, description: 'Name of the section in the Studio structure ("Hero", "Line-up", "VIP").' },
    show_to: { type: 'string', enum: ['everyone', 'vip_table', 'no_vip_table', 'buyers', 'no_buyers', 'new_subscribers'], description: 'Who sees this section, decided per recipient at sending: people with a VIP table for the event (vip_table) or without (no_vip_table), buyers of the event or not, new subscribers. Default everyone.' },
    padding: { type: 'integer', minimum: 0, maximum: 48, description: 'Space around the section in px. Default 0: the section HTML controls its own spacing.' },
    background: { ...HEX, description: 'Color behind the section (#rrggbb).' },
  },
  additionalProperties: false,
};
const THEME: JsonSchema = {
  type: 'object',
  description: 'Colors of the email frame. background = page around the email, card = email body behind the sections, text, muted, accent (links and native Yuno blocks), button_text, divider, footer_background and footer_text (the legal footer Yuno adds), dark (dark design), radius (corners of the email, 0 to 40 px), footer_social (social icons in the footer, default true).',
  properties: {
    background: HEX, card: HEX, text: HEX, muted: HEX, accent: HEX, button_text: HEX, divider: HEX,
    footer_background: HEX, footer_text: HEX,
    dark: { type: 'boolean' },
    radius: { type: 'integer', minimum: 0, maximum: 40 },
    footer_social: { type: 'boolean' },
  },
  additionalProperties: false,
};
const DRAFT_FIELDS: Record<string, JsonSchema> = {
  product: PRODUCT,
  event: { ...EVENT, description: 'The night of the email: event id, "next", "last", part of the title, or "none" to unlink (update). Required when sections use event tags or native Yuno blocks.' },
  name: { type: 'string', minLength: 1, maxLength: 120, description: 'Internal name of the draft in the Console ("Portalis — annonce").' },
  subject: { type: 'string', minLength: 1, maxLength: 150, description: 'Email subject.' },
  subject_b: { type: 'string', maxLength: 150, description: 'Second subject for an A/B test (Yuno sends both to a sample, then the winner to the rest). "none" removes it (update).' },
  preheader: { type: 'string', maxLength: 200, description: 'Preview text shown after the subject in the inbox.' },
  language: LANGUAGE,
  audience: {
    type: 'array', maxItems: 10, items: { type: 'string', minLength: 3, maxLength: 60 },
    description: 'Audience ids from list_email_audiences ("all", "lifecycle:hab", "segment:<uuid>", "preset:vip", "kind:vip"…) or, on Yuno CRM, an audience_id of get_night_plan ("target:<night id>:<audience>"). Several ids add up. Empty or omitted: the person picks the audience in the Console.',
  },
  audience_label: { type: 'string', maxLength: 80, description: 'Name shown in the Console for a single Yuno CRM rule audience ("VIP Amoris").' },
  exclude_event_buyers: { type: 'boolean', description: 'Skip people who already bought a ticket for the linked night.' },
  exclude_recent_days: { type: 'integer', minimum: 0, maximum: 30, description: 'Skip people who received an email from this account in the last N days. Default 3, 0 = no exclusion.' },
  theme: THEME,
};

// ── Pages d'inscription ─────────────────────────────────────────────────────
const FONT_FAMILY: JsonSchema = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9 ]{1,39}$', description: 'Google Fonts family name ("Anton", "Playfair Display", "Inter").' };
const PAGE_SECTION: JsonSchema = {
  type: 'object',
  properties: {
    html: { type: 'string', maxLength: 30000, description: 'HTML of a custom section (mobile first, 480 px wide at most) with Yuno tags such as {{page.title}}, {{event.date}}, {{page.poster}}. No scripts, forms, inputs or buttons: the Yuno form block collects sign-ups.' },
    css: { type: 'string', maxLength: 15000, description: 'CSS of this section only (it is rendered on its own: style your classes or :host). @keyframes allowed; no @import or @font-face.' },
    yuno_block: { type: 'string', enum: ['form', 'countdown', 'reward', 'count'], description: 'Instead of html: a Yuno block. form (required once: fields, consent box, confirmation), countdown (to the ticket sale, presale), reward, count (sign-up counter).' },
    label: { type: 'string', maxLength: 60, description: 'Name of the section ("Hero", "Line-up", "FAQ").' },
    show_on: { type: 'string', enum: ['always', 'before_signup', 'after_signup'], description: 'always (default), before_signup (hidden once the fan signed up), after_signup (only on the confirmation).' },
    tagline: { type: 'boolean', description: 'Form block only: false hides the page tagline at the top of the form (when the hero already shows it).' },
  },
  additionalProperties: false,
};
const PAGE_THEME: JsonSchema = {
  type: 'object',
  description: 'Theme of a custom design: page, Yuno form, button and fonts (on update, only the keys to change). Colors are #rrggbb. Full meaning of each key in get_signup_page_kit.custom_design.theme.',
  properties: {
    bg: HEX,
    bg_css: { type: 'string', maxLength: 2000, description: 'Extra CSS background layers drawn over bg: gradients, or url() of an image hosted on Yuno.' },
    text: HEX, accent: HEX, accent2: HEX, accent_text: HEX,
    font_heading: FONT_FAMILY, font_body: FONT_FAMILY,
    heading_weight: { type: 'integer', minimum: 100, maximum: 900 },
    heading_case: { type: 'string', enum: ['none', 'uppercase'] },
    heading_tracking: { type: 'number', minimum: -0.1, maximum: 0.3, description: 'Letter-spacing of headlines in em.' },
    card_bg: { type: 'string', pattern: '^(#[0-9a-fA-F]{6}|transparent|glass)$', description: 'Form box: #rrggbb, transparent or glass (frosted).' },
    card_border: { type: 'string', pattern: '^(#[0-9a-fA-F]{6}|none)$' },
    card_radius: { type: 'integer', minimum: 0, maximum: 40 },
    card_shadow: { type: 'string', enum: ['none', 'soft', 'hard', 'glow'] },
    shadow_color: { ...HEX, description: 'Color of hard offset shadows (form box and button). Default: the accent on a dark page, ink on a light page.' },
    input_style: { type: 'string', enum: ['box', 'underline', 'pill'] },
    input_bg: { type: 'string', pattern: '^(#[0-9a-fA-F]{6}|transparent)$' },
    radius: { type: 'integer', minimum: 0, maximum: 40, description: 'Corners of inputs and answer chips.' },
    button_style: { type: 'string', enum: ['solid', 'gradient', 'outline'] },
    button_radius: { type: 'integer', minimum: 0, maximum: 99 },
    button_shadow: { type: 'string', enum: ['none', 'soft', 'hard', 'glow'] },
    button_case: { type: 'string', enum: ['none', 'uppercase'] },
    button_arrow: { type: 'boolean' },
    button_height: { type: 'integer', minimum: 44, maximum: 64 },
    button_font: { type: 'string', enum: ['body', 'heading'] },
    label_style: { type: 'string', enum: ['normal', 'uppercase', 'mono'] },
    extra_fonts: { type: 'array', maxItems: 2, items: FONT_FAMILY },
    css: { type: 'string', maxLength: 15000, description: 'CSS shared by every section (classes, @keyframes).' },
  },
  additionalProperties: false,
};
const PAGE_DATE: JsonSchema = { type: 'string', maxLength: 40, description: 'ISO 8601 with a timezone offset ("2026-10-24T18:00:00+02:00"), or "none" to clear it.' };
const PAGE_FIELDS: Record<string, JsonSchema> = {
  kind: {
    type: 'string', enum: ['prevente', 'venue', 'attente', 'communaute'],
    description: 'Page type: prevente (presale list: fans are told first when ticket sales open), venue ("I am coming" RSVP for a night), attente (waiting list: sold-out night or next date not announced), communaute (community list, no particular night). Default prevente.',
  },
  event: { ...EVENT, description: 'The night of the page: event id from get_signup_page_kit, "next", part of the title, or "none" to unlink. Not used by community pages.' },
  language: { type: 'string', enum: ['fr', 'en', 'es'], description: 'Language the page is written in (follow-up emails use it). Default: the language of the person.' },
  title: { type: 'string', maxLength: 40, description: 'Page title, the promise ("Prévente House Nation #21").' },
  tagline: { type: 'string', maxLength: 140, description: 'Short pitch under the title.' },
  button_label: { type: 'string', maxLength: 30, description: 'Label of the sign-up button ("Je veux ma place").' },
  thanks_message: { type: 'string', maxLength: 200, description: 'Message after sign-up: what happens next.' },
  poster_url: { type: 'string', maxLength: 600, description: 'Page visual hosted on Yuno (URL from add_email_image). Default: the event poster. "none" removes it.' },
  fields: {
    type: 'object',
    description: 'The Yuno form. 3 to 4 fields in total convert best.',
    properties: {
      contact: { type: 'string', enum: ['both', 'email', 'phone', 'all'], description: 'both = the fan chooses email or phone (default), email, phone, all = both asked.' },
      extra_fields: {
        type: 'object',
        properties: {
          last_name: { type: 'string', enum: ['off', 'optional', 'required'] },
          birthdate: { type: 'string', enum: ['off', 'optional', 'required'] },
          instagram: { type: 'string', enum: ['off', 'optional', 'required'] },
          city: { type: 'string', enum: ['off', 'optional', 'required'] },
        },
        additionalProperties: false,
      },
      questions: {
        type: 'array', maxItems: 2,
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', minLength: 1, maxLength: 60 },
            options: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'string', minLength: 1, maxLength: 40 } },
            multiple: { type: 'boolean', description: 'Several answers allowed.' },
            party_size: { type: 'boolean', description: '"How many are you?" question of a venue page (answers like "1", "2", "3", "4+").' },
          },
          required: ['label', 'options'],
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  },
  reward: {
    type: 'object',
    description: 'What a fan gets for signing up.',
    properties: {
      on: { type: 'boolean' },
      preset: { type: 'string', enum: ['prio', 'drink', 'pre', 'custom'], description: 'prio (priority entry), drink (free drink), pre (presale access), custom (label + how).' },
      label: { type: 'string', maxLength: 40 },
      how: { type: 'string', maxLength: 70, description: 'How to get it (custom).' },
      icon: { type: 'string', enum: ['gift', 'ticket', 'bolt', 'users', 'clock'] },
    },
    additionalProperties: false,
  },
  show_count: { type: 'boolean', description: 'Show the number of sign-ups on the page.' },
  countdown: { type: 'boolean', description: 'Presale: countdown to sale_opens_at.' },
  opens_at: { ...PAGE_DATE, description: 'When the page opens (empty = as soon as it is published).' },
  sale_opens_at: { ...PAGE_DATE, description: 'Presale: when ticket sales open (countdown, then "it is open").' },
  closes_mode: { type: 'string', enum: ['sale', 'eve', 'manual', 'never', 'date'], description: 'When the page closes; must fit the type (prevente: sale or date; venue: eve or date; attente: manual or date; communaute: never or date).' },
  closes_at: { ...PAGE_DATE, description: 'Closing date when closes_mode is "date".' },
  template: {
    type: 'object',
    description: 'A Yuno template instead of a custom design: name, palette from get_signup_page_kit.templates (or "custom" with background and accent), font.',
    properties: {
      name: { type: 'string', enum: ['soiree', 'affiche', 'brutal', 'edito', 'ticket', 'affichage', 'verre', 'epure', 'flyer', 'terminal'] },
      palette: { type: 'string', pattern: '^(custom|red|lime|ice|rose|bone|p[0-4])$' },
      background: HEX,
      accent: HEX,
      font: { type: 'string', enum: ['brico', 'anton', 'serif', 'space', 'black', 'mono'] },
    },
    additionalProperties: false,
  },
  theme: PAGE_THEME,
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
      + 'On a Yuno CRM account: tickets, buyers and revenue reported by the connected ticketing over a rolling period '
      + '(last and month = 30 days, last4 = 90 days, year and all = 12 months, or days), compared with the period before, with fill rate, tiers and sales per event. '
      + 'Examples: "how are we doing?", "this month vs last month", "is it going up or down?".',
    inputSchema: {
      type: 'object',
      properties: { space: SPACE, period: { type: 'string', enum: ['last', 'last4', 'month', 'year', 'all'] }, days: DAYS(90) },
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
      + 'and new vs returning buyers. On a Yuno CRM account: tickets and revenue per day (or hour, or month) of the period vs the period before, '
      + 'Yuno sends placed on that series, the sell-through pace vs reference nights, and where buyers came from (sources reported by the ticketing). '
      + 'Examples: "when do people buy?", "which channel brings sales?", "is Instagram worth it?".',
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
      + 'On a Yuno CRM account: purchases by weekday and two-hour slot, ticket tiers, and the tested buying habits (at sales opening, early, last minute, '
      + 'several tickets) with their status on the account. '
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
      + 'On a Yuno CRM account: base, lifecycle (regulars, occasional, new, lapsed), nights per person, reachable by email and SMS, people to bring back, '
      + 'age and cities when the ticketing reports them, return of each recent night\'s buyers, and the artists who bring new people. '
      + 'Can take a few seconds on large bases.',
    inputSchema: { type: 'object', properties: { space: SPACE, days: DAYS(365) }, additionalProperties: false },
  },
  {
    name: 'get_customer_segments',
    title: 'Customer segments',
    level: 'analytics',
    description:
      'Segmentation without personal data: RFM segments with counts and revenue (champions, loyal, promising/big occasional, new, at risk, dormant/lost), '
      + 'saved segments and their rules, imported contact lists health (active, unsubscribed, dead), and the suggested "high basket" threshold. '
      + 'On a Yuno CRM account: saved CRM segments, lifecycle segments (regulars, occasional, new, lapsed) with counts and message results over the period. '
      + 'Use before sizing or building a campaign audience. Examples: "who are my best customers?", "how many are at risk?".',
    inputSchema: { type: 'object', properties: { space: SPACE, days: DAYS(90) }, additionalProperties: false },
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
      + 'purchases and conversion by source, funnel visit to cart to purchase. On a Yuno CRM account: where ticket buyers came from '
      + '(sources reported by the ticketing, Yuno share links, signup pages); visits to the ticketing site itself are not reported. '
      + 'Examples: "where do my visitors come from?", "does Instagram convert?".',
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
    name: 'get_customer_analysis',
    title: 'What brings customers (tested hypotheses)',
    level: 'analytics',
    products: ['crm'],
    description:
      'Customer analysis of a Yuno CRM account, aggregates only: for each hypothesis family (line-up, music genre, format, time slot, weekday, venue, '
      + 'series; buying habits such as early, at sales opening, last minute, at the door, several tickets, table; return groups such as Shotgun discovery, '
      + 'passing through, invitation, first order with several tickets, first ticket with an existing customer, first channel) its status on this account: '
      + 'supported, not_supported, untested or inconclusive, with matched choices vs expected by chance, number tested, gain and z, availability '
      + '(unavailable when the ticketing does not send the data, uniform when all nights are alike), and the lesson seen on other Yuno accounts when published. '
      + 'Also: hypotheses carried by newcomers of the last 12 months, people who came once split into local / passing through / unknown distance, '
      + 'median return delay, 6-month return of newcomers, data coverage and the artists who bring new people and whether they come back. '
      + 'Examples: "why do my customers come?", "does the line-up bring people back?", "which artists bring new people who return?".',
    inputSchema: { type: 'object', properties: { space: SPACE }, additionalProperties: false },
  },
  {
    name: 'get_event_targets',
    title: 'Who to target for an upcoming event',
    level: 'analytics',
    products: ['crm'],
    description:
      'Yuno CRM, one upcoming event (the next one when "event" is omitted): the audiences of people WITHOUT a ticket for it, each with its size, '
      + 'how many are reachable by email and by SMS, the status on this account of the hypothesis family behind it, the suggested moment '
      + '(now, the week before at 18:00, the eve at 18:00) and evidence: concept (came to a past edition of the same series), lineup (saw a non-resident artist '
      + 'who plays that night, with the artists), genre (most attended genre is one of the event genres), early (buys early or at sales opening), '
      + 'last_minute (buys the eve or the same day), once_local (came once, lives nearby), likely (high chance of coming per the account\'s prediction model). '
      + 'When the model is validated: expected buyers per audience and for all known customers without a ticket (score.expected), an estimate. '
      + 'Also the union of all audiences and how many already have a ticket. '
      + 'Examples: "who should I target for Saturday?", "who can I bring back for the next Bunker?".',
    inputSchema: {
      type: 'object',
      properties: { space: SPACE, event: { type: 'string', minLength: 1, maxLength: 120, description: 'Event id or name (default: the next upcoming event).' } },
      additionalProperties: false,
    },
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
        hypothesis: {
          type: 'string',
          enum: ['artist', 'series', 'genre', 'format', 'slot', 'weekday', 'place', 'launch', 'early', 'last_minute', 'door', 'group', 'table', 'brought', 'discovery', 'invited', 'passing'],
          description: 'Yuno CRM: customers carrying this hypothesis family (medium or strong), from get_customer_analysis. Returns name, email, lifecycle, events, last seen.',
        },
        passing: { type: 'boolean', description: 'Yuno CRM: true = people passing through (far away or abroad), false = people living nearby; unknown distance is in neither.' },
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
      + 'On a Yuno CRM account the segment maps to the CRM lifecycle: champions and loyal = regulars, promising = occasional, new = new, the others = lapsed. '
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
      + 'consent (email, SMS), the automated emails they received and, on Yuno CRM, their hypotheses: facts (evidence key and values) with the status of each '
      + 'family on the account, plus the facts of their first night, and chances_to_come: for up to 3 upcoming nights without a ticket, a label '
      + '(high, medium, low) and its reasons, only when the account\'s prediction model passed its validation. Only with the "customers" level. '
      + 'Example: "tell me about julie@example.com".',
    inputSchema: {
      type: 'object',
      properties: { space: SPACE, email: { type: 'string', maxLength: 200 } },
      required: ['email'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_email_design_kit',
    title: 'Email design kit',
    level: 'analytics',
    email: true,
    description:
      'What is needed to design a Yuno email for a night, in one call: the brand of the space (name, logo, city, social links, sender, colors of recent emails), '
      + 'the upcoming events with their ids, the facts of one event (title, local date and time, venue, poster URL, ticket tiers with prices and sold-out state, '
      + 'VIP tables and packs, guest list, line-up with photos, sales page or external ticketing), the Yuno tags that make a custom HTML section live '
      + '(prices, sold out, line-up, countdown, tracked buy links) with what they render today for that event, the email HTML rules, '
      + 'a design method for opens and sales, an example section, the products available (suite, crm) and the 8 most recent drafts. '
      + 'Examples: "design the email for my next party", "make a VIP version", "redo my newsletter in my brand colors".',
    inputSchema: {
      type: 'object',
      properties: { space: SPACE, product: PRODUCT, event: { ...EVENT, description: 'Optional. The night to design for: id, "next", "last" or part of the title.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'list_email_audiences',
    title: 'Email audiences',
    level: 'analytics',
    email: true,
    description:
      'Who an email can go to, with the number of contacts reachable by email now: the whole base, lifecycle groups (Yuno CRM: regulars, occasional, new, dormant, never came) '
      + 'or built-in groups (Yuno ticketing: VIP, big spenders, regulars, new, dormant), saved segments, imported lists, and Yuno presets '
      + '(big spenders 200 € and more, loyal, recent, to reactivate, no ticket yet for what is next, recent clickers). '
      + 'Each audience has an id for create_email_draft. Can take a few seconds on large bases.',
    inputSchema: { type: 'object', properties: { space: SPACE, product: PRODUCT }, additionalProperties: false },
  },
  {
    name: 'get_email_draft',
    title: 'Read an email draft',
    level: 'analytics',
    email: true,
    description:
      'One email draft or campaign of the space by id (ids in get_email_design_kit.recent_drafts or get_marketing_performance): its sections in order '
      + '(custom HTML with Yuno tags, or native Yuno blocks), subject, B subject, preheader, language, linked event, audience, theme and status. '
      + 'Useful before update_email_draft, or to reuse the design of a past email.',
    inputSchema: {
      type: 'object',
      properties: { space: SPACE, draft_id: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' } },
      required: ['draft_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_email_draft',
    title: 'Create an email draft',
    level: 'analytics',
    email: true,
    write: true,
    description:
      'Creates an email campaign DRAFT in the Yuno Console: custom HTML sections (and optional native Yuno blocks), subject, optional B subject for an A/B test, '
      + 'preheader, language, linked night, audience and theme. Nothing is sent or scheduled: the draft waits in the Console, where the person reviews it and sends it. '
      + 'Yuno tags in the HTML are read again when the email leaves, and links written with tags are tracked (clicks and sales attributed to the email). '
      + 'The HTML is cleaned (scripts, styles, forms removed) and checked: errors such as unknown tags, unclosed blocks or a missing event are returned without '
      + 'creating anything. Returns the Console link, the current audience size and the quality checks. '
      + 'Needs the email drafts permission of the connection and the right to create emails in the space.',
    inputSchema: {
      type: 'object',
      properties: {
        space: SPACE,
        ...DRAFT_FIELDS,
        sections: { type: 'array', minItems: 1, maxItems: 30, items: SECTION, description: 'The email body, top to bottom. Yuno adds the legal footer after the last section.' },
      },
      required: ['name', 'subject', 'sections'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_email_draft',
    title: 'Update an email draft',
    level: 'analytics',
    email: true,
    write: true,
    destructive: true,
    description:
      'Changes an email DRAFT (never a scheduled or sent email), for example after the person asked for changes or showed a screenshot: '
      + 'replace every section (sections) or change some (section_updates, by section id: rewrite one, change the options of a native Yuno block, '
      + 'insert a new section above or below, move, remove, show to one audience only), and any of subject, B subject, preheader, language, night, '
      + 'audience, exclusions, theme or name. Sections not targeted stay exactly as they are, including the ones the person edited in the Console. '
      + 'Same tags, cleaning and checks as create_email_draft. Returns what changed, the new version, the Console link and the checks.',
    inputSchema: {
      type: 'object',
      properties: {
        space: SPACE,
        draft_id: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' },
        ...DRAFT_FIELDS,
        sections: { type: 'array', minItems: 1, maxItems: 30, items: SECTION, description: 'Replaces every section of the draft.' },
        draft_version: {
          type: 'string', maxLength: 40,
          description: 'The "version" returned by get_email_draft (or by the last create/update). If the person changed the draft in the Console since, nothing is written and the new sections are returned.',
        },
        section_updates: {
          type: 'array', minItems: 1, maxItems: 30,
          description: 'Targeted changes, applied in order. Target a section by its id from get_email_draft (preferred) or its index (0 = first).',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', maxLength: 80, description: 'Section id from get_email_draft.' },
              index: { type: 'integer', minimum: 0, maximum: 39, description: 'Section position, when no id.' },
              action: {
                type: 'string', enum: ['edit', 'remove', 'insert_before', 'insert_after', 'move'],
                description: 'edit (default): new html (a native block given html becomes a custom section), or yuno_block to replace it by a native block, or options of a native block, plus label / show_to / background / padding. '
                  + 'insert_before / insert_after: a NEW section (html or yuno_block) above or below the target. remove. move: to position move_to.',
              },
              html: { type: 'string', maxLength: 60000 },
              yuno_block: { type: 'string', enum: ['event', 'tickets', 'lineup', 'countdown', 'table', 'guestlist', 'social', 'divider', 'spacer'] },
              options: { type: 'object', description: 'Options of a native block (same names as in sections): accent, kicker, title, subtitle, button, layout, align, photos, price_display, pack_display, size, color. "none" clears accent or color.' },
              label: { type: 'string', maxLength: 60 },
              show_to: { type: 'string', enum: ['everyone', 'vip_table', 'no_vip_table', 'buyers', 'no_buyers', 'new_subscribers'] },
              background: { type: 'string', maxLength: 7, description: '#rrggbb, or "none" to remove.' },
              padding: { type: 'integer', minimum: 0, maximum: 48 },
              move_to: { type: 'integer', minimum: 0, maximum: 39, description: 'move: new position (0 = top).' },
              insert_after: { type: 'boolean', description: 'Older form of action "insert_after".' },
              remove: { type: 'boolean', description: 'Older form of action "remove".' },
            },
            additionalProperties: false,
          },
        },
      },
      required: ['draft_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_email_images',
    title: 'Email and page images',
    level: 'analytics',
    email: true,
    drafts: true,
    shared: true,
    description:
      'Images added for emails and signup pages in this space through the connector in the last 30 days (newest first): ready images with their public URL, width and height, '
      + 'and upload links still waiting for the person to drop or paste an image. Use it after the person says they added the image on the upload page.',
    inputSchema: { type: 'object', properties: { space: SPACE }, additionalProperties: false },
  },
  {
    name: 'add_email_image',
    title: 'Add an image',
    level: 'analytics',
    email: true,
    write: true,
    shared: true,
    description:
      'Stores an image on Yuno to use in an email section or a signup page (logo, photo, background; the event poster is already available in the design kits). '
      + 'Three ways: the image the person attached to the conversation (passed as "image" by apps that hand files to tools), a public image link ("url", copied to Yuno so it stays online), '
      + 'or neither, which returns a one-time upload page where the person pastes or drops the image. Returns the image URL with its width and height when ready, '
      + 'or the upload page. JPEG, PNG, GIF or WebP, 8 MB at most. Nothing is sent.',
    inputSchema: {
      type: 'object',
      properties: {
        space: SPACE,
        name: { type: 'string', maxLength: 80, description: 'Short name to recognize the image ("Photo DJ", "Logo partenaire").' },
        url: { type: 'string', maxLength: 2000, pattern: '^https://', description: 'Public https link to an image to copy to Yuno.' },
        image: {
          type: 'object',
          description: 'The image the person attached to the conversation.',
          properties: {
            download_url: { type: 'string' },
            file_id: { type: 'string' },
            mime_type: { type: 'string' },
            file_name: { type: 'string' },
          },
          required: ['download_url', 'file_id'],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    meta: { 'openai/fileParams': ['image'] },
  },
  {
    name: 'get_signup_page_kit',
    title: 'Signup page design kit',
    level: 'analytics',
    email: true,
    pages: true,
    description:
      'What is needed to design a Yuno CRM signup page in one call: the brand of the space (name, logo, city, social links, colors of recent emails), '
      + 'the upcoming nights with their ids, the facts of one night (title, local date, venue, poster, ticketing link, sold out), the existing pages with their ids and state, '
      + 'the four page types and their rules, the ten Yuno templates with their palettes, the custom design model (theme, HTML/CSS sections, Yuno blocks), '
      + 'the Yuno tags with what they show today, the web rules of a public page, a conversion method and an example. '
      + 'Examples: "make a presale page for my next party", "redo my waiting list page like this screenshot", "a community page in my brand colors".',
    inputSchema: {
      type: 'object',
      properties: { space: SPACE, event: { ...EVENT, description: 'Optional. The night the page is about: id, "next" or part of the title.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_signup_page',
    title: 'Read a signup page',
    level: 'analytics',
    email: true,
    pages: true,
    description:
      'One signup page of the space by id (ids in get_signup_page_kit.pages): type, night, texts, form fields, reward, dates, state (draft, scheduled, open, closed), '
      + 'design (Yuno template, or custom: theme and every section with its id, visible text, HTML and CSS), a pending proposal if any, sign-ups and visits, '
      + 'the Console link and the "version" to pass to update_signup_page. Useful before changing a page or to reuse its design.',
    inputSchema: {
      type: 'object',
      properties: { space: SPACE, page_id: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' } },
      required: ['page_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_signup_page',
    title: 'Create a signup page',
    level: 'analytics',
    email: true,
    pages: true,
    write: true,
    description:
      'Creates a Yuno CRM signup page as a DRAFT: page type, night, texts, form fields, reward, dates, and its design, either a Yuno template or a custom design '
      + '(theme + HTML/CSS sections with Yuno tags + Yuno blocks; the Yuno form block, with its consent box, is always part of the page). Nothing is published: '
      + 'the draft waits in the Console, where the person reviews it on a live phone preview and publishes it. The HTML and CSS are cleaned (scripts, forms, '
      + 'external images removed) and checked: errors such as unknown tags or a missing form are returned without creating anything. '
      + 'Returns the Console link, the version and the checks. Needs the signup pages permission of the connection and Yuno CRM on the space.',
    inputSchema: {
      type: 'object',
      properties: {
        space: SPACE,
        ...PAGE_FIELDS,
        sections: { type: 'array', minItems: 1, maxItems: 24, items: PAGE_SECTION, description: 'Custom design: the page top to bottom (with theme). Omit for a Yuno template.' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_signup_page',
    title: 'Update a signup page',
    level: 'analytics',
    email: true,
    pages: true,
    write: true,
    destructive: true,
    description:
      'Changes a signup page, for example after the person asked for changes or showed a screenshot: settings (texts, night, fields, reward, dates, language), '
      + 'the template, the theme (only the keys given), every section (sections) or some of them (section_updates, by section id: rewrite html or css, remove, '
      + 'insert a new section or Yuno block above or below, move, show before or after sign-up), or design_mode "template" to go back to a Yuno template. '
      + 'A DRAFT page is changed directly. A PUBLISHED page does not change: the update is saved as a proposal that the person previews and applies or ignores '
      + 'in the Console, and further updates add to it. Sections not targeted stay as they are. Same cleaning and checks as create_signup_page. '
      + 'Returns what changed, the mode (updated or proposed), the version and the Console link.',
    inputSchema: {
      type: 'object',
      properties: {
        space: SPACE,
        page_id: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' },
        page_version: { type: 'string', maxLength: 40, description: 'The "version" from get_signup_page (or the last create/update). If the person changed the page in the Console since, nothing is written and the current sections are returned.' },
        ...PAGE_FIELDS,
        design_mode: { type: 'string', enum: ['custom', 'template'], description: '"template" removes the custom design (the page uses its Yuno template again).' },
        sections: { type: 'array', minItems: 1, maxItems: 24, items: PAGE_SECTION, description: 'Replaces every section of the custom design.' },
        section_updates: {
          type: 'array', minItems: 1, maxItems: 24,
          description: 'Targeted changes, applied in order. Target a section by its id from get_signup_page (preferred) or its index (0 = first).',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', maxLength: 80 },
              index: { type: 'integer', minimum: 0, maximum: 30 },
              action: { type: 'string', enum: ['edit', 'remove', 'insert_before', 'insert_after', 'move'], description: 'edit (default): new html and/or css, or yuno_block, label, show_on, tagline. insert_before / insert_after: a NEW section (html or yuno_block). remove (not the form). move: to move_to.' },
              html: { type: 'string', maxLength: 30000 },
              css: { type: 'string', maxLength: 15000 },
              yuno_block: { type: 'string', enum: ['form', 'countdown', 'reward', 'count'] },
              label: { type: 'string', maxLength: 60 },
              show_on: { type: 'string', enum: ['always', 'before_signup', 'after_signup'] },
              tagline: { type: 'boolean' },
              move_to: { type: 'integer', minimum: 0, maximum: 30, description: 'move: new position (0 = top).' },
            },
            additionalProperties: false,
          },
        },
      },
      required: ['page_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_scenarios',
    title: 'Yuno CRM scenarios',
    level: 'analytics',
    scenario: true,
    description:
      'The scenarios of a Yuno CRM space (multi-step automations: a trigger, conditions, waits, emails and SMS, a goal): name, state (draft, live, paused, frozen, archived), '
      + 'trigger, version, unpublished changes, people who entered, are on their way and reached the goal, the share kept aside to measure the real effect and what it shows, '
      + 'and the Console link of each. Examples: "which scenarios are running?", "is my welcome scenario working?". Aggregates only.',
    inputSchema: { type: 'object', properties: { space: SPACE }, additionalProperties: false },
  },
  {
    name: 'get_scenario_report',
    title: 'Scenario report',
    level: 'analytics',
    scenario: true,
    description:
      'One scenario in detail: its draft graph (trigger, entry filter, goal, steps by id) and live graph, the checks that block publishing (step by step), '
      + 'and once published its results per step (entered, sent, opened, clicked, held or expired with the reason), the people who left and why, '
      + 'purchases and revenue after a click on its emails, and the comparison with the people not contacted. '
      + 'Examples: "where do people drop in my 1st-to-2nd-night scenario?", "did the reminder SMS help?". Aggregates only.',
    inputSchema: {
      type: 'object',
      properties: { space: SPACE, scenario: { type: 'string', minLength: 2, maxLength: 120, description: 'The scenario: its id (from list_scenarios) or part of its name.' } },
      required: ['scenario'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_night_plan',
    title: 'Night plan',
    level: 'analytics',
    scenario: true,
    description:
      'Yuno CRM, one upcoming night (the next one when "event" is omitted): a dated sending plan computed by Yuno. The steps (now, the week before, '
      + 'the eve at 18:00), each with its "Who to target" audiences in the suggested order where a person counts once (first_n), the people reachable '
      + 'by email and SMS, the suggested channel and its cost in Yunits, and the account balance; ticket sales against the previous edition at the '
      + 'same moment; emails and SMS already planned for this night; the share kept aside to measure the effect; the hypothesis families confirmed '
      + 'on the account; expected buyers when the model is validated (an estimate). Each audience has an audience_id that create_email_draft accepts. '
      + 'Examples: "prepare the plan of my next night", "what should I send for Velvet #3 and when?". Aggregates only.',
    inputSchema: {
      type: 'object',
      properties: { space: SPACE, event: { type: 'string', minLength: 2, maxLength: 120, description: 'The night: its id, part of its title, or "next" (default).' } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_scenario_kit',
    title: 'Scenario building kit',
    level: 'analytics',
    scenario: true,
    scenarioDrafts: true,
    description:
      'What is needed to write a Yuno CRM scenario graph in one call: the graph format, the triggers and their parameters, the step types, every condition with its family and value format, '
      + 'the limits and sending rules, seven example graphs (1st to 2nd night by what brings them, regulars without a ticket at D-10/D-3/D-1, high chances of coming, guest list to paying, absent buyers, welcome in 3 steps, win-back in 2 steps), '
      + 'and from the space: its email templates (ids for email steps), saved segments, signup pages, upcoming nights, the "what brings them" families confirmed on the account, '
      + 'whether "Chances of coming" and SMS sending are available, the share kept aside and the Yunits rates.',
    inputSchema: { type: 'object', properties: { space: SPACE }, additionalProperties: false },
  },
  {
    name: 'create_scenario_draft',
    title: 'Create a scenario draft',
    level: 'analytics',
    scenario: true,
    scenarioDrafts: true,
    write: true,
    description:
      'Saves a new scenario as a DRAFT in the Yuno CRM Console, prepared by this AI: the whole graph (format and examples in get_scenario_kit) and a name. '
      + 'Returns the scenario id, the checks that block publishing step by step (an incomplete draft is still saved), the most messages a person can receive and the Console link. '
      + 'Nothing runs: the person reviews "Before publishing", tests each message and publishes in the Console.',
    inputSchema: {
      type: 'object',
      properties: {
        space: SPACE,
        name: { type: 'string', minLength: 1, maxLength: 80, description: 'Name in the Console ("1st to 2nd night — techno").' },
        graph: { type: 'object', description: 'The scenario graph: {"v": 1, "trigger", "entry", "goal", "start", "nodes"} (see get_scenario_kit).' },
        template: { type: 'string', enum: [...SCENARIO_TEMPLATE_KEYS], description: 'Optional. The example the graph starts from (for the account statistics).' },
      },
      required: ['name', 'graph'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_scenario_draft',
    title: 'Update a scenario draft',
    level: 'analytics',
    scenario: true,
    scenarioDrafts: true,
    write: true,
    destructive: true,
    description:
      'Replaces the draft graph and / or the name of an existing scenario (the whole graph, as returned in get_scenario_report.scenario.draft, with the changes). '
      + 'A live scenario keeps running its live version until the person publishes the changes in the Console. Returns the same checks as create_scenario_draft. '
      + 'An archived scenario cannot change.',
    inputSchema: {
      type: 'object',
      properties: {
        space: SPACE,
        scenario: { type: 'string', minLength: 2, maxLength: 120, description: 'The scenario: its id (from list_scenarios) or part of its name.' },
        name: { type: 'string', minLength: 1, maxLength: 80 },
        graph: { type: 'object', description: 'The whole new draft graph.' },
      },
      required: ['scenario'],
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
  // Yuno CRM actif sur l'espace (compte CRM, ou CRM ajouté à la Billetterie).
  crm?: boolean;
}

// Les outils proposés à CETTE connexion : niveau accordé, produits couverts,
// droit aux brouillons d'e-mails, aux pages d'inscription et aux brouillons de
// scénarios.
export function toolsFor(level: ToolLevel, spaces: SessionSpace[], drafts = false, pages = false, scenarios = false): ToolDef[] {
  const products = new Set(spaces.map((s) => s.product));
  const anyCustomers = level === 'customers' && spaces.some((s) => s.customers);
  const anyCrm = spaces.some((s) => s.crm || s.product === 'crm');
  return TOOLS.filter((t) => {
    if (t.level === 'customers' && !anyCustomers) return false;
    if (t.shared) return drafts || (pages && anyCrm);
    if (t.pages) return pages && anyCrm;
    if (t.scenarioDrafts) return scenarios && anyCrm;
    if (t.scenario) return anyCrm;
    if ((t.write || t.drafts) && !drafts) return false;
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
    ...(t.meta ? { _meta: t.meta } : {}),
    annotations: t.write
      ? { title: t.title, readOnlyHint: false, destructiveHint: !!t.destructive, idempotentHint: false, openWorldHint: false }
      : { title: t.title, ...READ_ONLY_ANNOTATIONS },
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
