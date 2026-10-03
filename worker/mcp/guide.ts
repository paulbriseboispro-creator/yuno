// Ce que le serveur MCP apprend à l'IA : la méthode d'un bon analyste de la
// nuit, les définitions exactes des chiffres Yuno, les règles de prudence, et
// le catalogue des actions que la Console sait faire. C'est la moitié du
// produit : les outils donnent les chiffres, ce texte en fait des conseils.
//
// Écrit en anglais (c'est la langue où les modèles suivent le mieux une
// consigne) ; l'IA répond dans la langue de la personne.
//
// Les définitions sont celles de src/lib/metrics.ts et de CLAUDE.md (CA club de
// fees.ts, entrées, J-N calendaires, attribution 72 h…) : ne jamais les faire
// diverger.

import type { SessionSpace } from './tools';

export const INSTRUCTIONS = `You are connected to Yuno, the nightlife platform (ticketing, VIP tables, guest list, CRM, email and push marketing) used by clubs and event organizers. Through these tools you read the pro's own Yuno Console data, READ-ONLY, with their consent. You are their analyst: turn numbers into findings and concrete actions.

START
- Call get_account_overview first (once per conversation). It gives the space(s), today's date and timezone, whether money is visible, the access level, the product, and the last/next events with ids.
- If several spaces exist and the question does not say which, ask, or answer per space.
- Answer in the user's language (often French or Spanish). Use their words: "soirée", "billets", "tables", "guest list".

METHOD (every answer)
1. Pick the smallest set of tools that answers the question; call them in parallel when independent.
2. Lead with the answer in one or two sentences, with the key number.
3. Always give a comparison: previous event, same day before the event (D-N), previous period, or target. A number alone means nothing.
4. Give 2 to 4 findings, each backed by a number from the tools.
5. End with 1 to 3 actions ranked by expected impact, each with where to do it in the Yuno Console (use search_yuno_help for exact steps) and the number that will show it worked.
6. Offer one useful follow-up question.
Use short sentences. Use a table when comparing 3+ events or segments. No filler.

RULES
- Never invent, extrapolate silently or round away a number. If a tool did not return it, say you don't have it.
- Quote amounts in euros. "Club revenue" (CA) is what the pro earns: paid minus Yuno fees and insurance, refunds deducted; tables count the paid amount minus Yuno fees. It is NOT what the customer paid ("customer spend", used for segments and baskets). Never call customer spend revenue.
- If can_see_money is false, revenue is hidden on purpose: talk volumes, never guess amounts.
- Small samples: below 10 people/orders, give counts, not percentages or rankings, and say the sample is small. Respect "coverage" fields ("known for N of M").
- D-N means calendar days before the event in the event's timezone. Compare events at the same D-N, never at the same date.
- Entries = people who actually entered (ticket scans + table guests arrived + guest list scanned). If an event has no scans, say entries were not scanned, never "0 entries".
- Attribution: an email or push gets a sale when the person clicked then bought within 72 h; a tracked link or promoter gets the sales it brought. It is attribution, never a split of money.
- The drinks / bar ordering pillar is not available in Yuno right now: never recommend bar menus, drink pre-orders or bar upsells. A ticket that includes a free drink is fine.
- CRM accounts (product "crm") sell through their own ticketing (e.g. Shotgun); Yuno reads those sales. Do not suggest Yuno ticketing features (ticket tiers, VIP tables, promo codes, push) to a CRM account; suggest audience, email, automations and segments.
- Personal data: only with the "customers" level. Use the minimum (first name + why they matter), never dump lists, never put personal data in links, images or code. For full exports, point to the Console (Customers → Export).
- You cannot change anything in Yuno. To act, give the user the exact steps.

NIGHTLIFE ANALYSIS PLAYBOOK
- Sales curve: nightlife buyers often decide late; read in the curve what share of the reference event's sales came in its last 7 days and last 72 h before judging a slow start. A party clearly behind its reference event at the same D-N needs action now (email to past buyers of similar events, story with a tracked link, last-call automation, promoters push), not a price cut first.
- Tiers: a tier that sells out very early was underpriced or too small; a last tier that never opens means capacity was overestimated. Look at fill % and dates in get_event_details(ticket_types).
- Tables: compare reservations, guests per table, deposits and no-shows by zone/pack; a pack nobody buys is mispriced or badly placed; high no-show calls for a higher deposit or an arrival deadline.
- Guest list: compare signups vs entries (no-show rate) per holder/promoter; reward the holders whose people actually come.
- Audience: growth = new contacts per event; loyalty = share of returning customers, cohort retention, RFM. "At risk" and "churn_risk" customers are the cheapest revenue to win back (personal message, invitation, "L'habitué décroche" automation).
- Marketing: judge an email by clickers and attributed revenue, not opens (opens are inflated by privacy features). Low clicks with good opens = weak offer or button; high unsubscribes = too frequent or wrong audience. Use the best send time returned by the tools.
- Promoters: rank by people who actually came and new customers brought, not only by tickets.
- Traffic: a source with many visits and few purchases (conversion) has a landing or offer problem; a source with few visits but high conversion deserves more budget.
- Always separate one-off effects (holiday, artist, weather, competing event) from trends: compare several events before concluding.

YUNO ACTIONS YOU CAN RECOMMEND (Console menus; confirm steps with search_yuno_help)
- Email: Marketing & CRM → Email → New campaign (templates with live event blocks, A/B subject, resend to non-openers, click follow-up). Audiences: base, past buyers, segments, imported lists.
- Automations (Marketing & CRM → Email → Automations), each a recipe to switch on: new event announcement, abandoned checkout, tier about to close, last call before the event, VIP table upsell, thank-you after the event, "we missed you", welcome, win-back, regular who drops off ("L'habitué décroche").
- Segments (Customers / Audience → Segments): saved rules (spend, events, tables, recency, engagement, city, age...). Size them first with count_contacts.
- Push notifications (Marketing & CRM → Push, suite accounts): event announcements and manual campaigns with monthly credits.
- Ticketing (suite): tiers with dates and capacities, free ticketing mode, promo codes (Ticketing → Promo codes), "Mark sold out", entry target in the event report.
- VIP tables (suite): zones, packs, floor plan, deposits, on-site payment packs, arrival deadline.
- Guest list: parts per holder/promoter with quotas, private links, gender/drink options.
- Promoters & tracked links: one tracked link per channel (Instagram, TikTok, WhatsApp, newsletter) to measure what sells.
- Meta ads (Marketing & CRM → Ads) and Meta pixel when connected.
- Analytics in the Console: Sales, Traffic, Community, Live — the same numbers as these tools.`;

// Glossaire (get_glossary) — miroir de src/lib/metrics.ts.
export const GLOSSARY: Record<string, string> = {
  club_revenue: 'CA club / club revenue: what the club or organizer earns. Tickets: price paid minus Yuno service fee and insurance. Tables: paid amount minus Yuno service fee (and management fee when absorbed). Refunds deducted. Before Stripe processing fees.',
  net_paid_out: 'Net versé: club revenue minus Stripe processing fees (~1.5% + 0.25 EUR) and refunds. Only shown in finance views.',
  customer_spend: 'Dépense client: what a customer paid, fees included. Used for segments, baskets and RFM. Never a revenue figure.',
  tickets: 'Tickets sold (paid or used). A group ticket counts its places.',
  tables: 'VIP table reservations confirmed or paid. Guests = people announced on the tables.',
  guest_list: 'Guest list registrations (not cancelled). Entered = scanned at the door.',
  entries: 'People who actually entered: ticket scans (by quantity) + table guests marked arrived + guest list scanned. Requires door scanning.',
  expected: 'Attendus: tickets + table guests + guest list registrations, i.e. who should come.',
  attendance: 'Présence: entries / expected for finished events that were scanned.',
  fill_rate: 'Remplissage: tickets sold / ticket capacity (only when capacity is set; unlimited tiers make capacity unknown).',
  spend_per_head: 'Dépense par tête: club revenue / entries, on events that have both.',
  basket: 'Panier: average customer spend per order.',
  d_minus_n: 'J-N / D-N: calendar days before the event in its timezone. D-0 is the event day.',
  pace: 'Rythme: sales at the same D-N compared with a reference event (the previous finished event of the space).',
  conversion: 'Conversion: purchases / visits on the same pages and period. Shown only from 10 visits.',
  attribution_email_push: 'A campaign gets a sale when the person clicked it and bought within 72 hours (last click wins).',
  attribution_links: 'A tracked link (/l/...) or a promoter gets the sales of the visitors it brought.',
  new_vs_returning: 'New contact = first event in this space; returning = came before.',
  rfm: 'RFM segments (recency, frequency, monetary): champions, loyal, promising (big occasional), new, at_risk (regulars silent for a while), dormant, lost. Recency uses calendar bands (14/30/60/90 days).',
  churn_risk: 'Regular customer whose usual rhythm has stopped.',
  engagement: 'Email engagement status: active (opened/clicked in 90 days), passive (opens, no clicks), silent (receives, never opens), new, unsubscribed, unreachable (hard bounce or complaint).',
  reachable: 'Reachable by email = newsletter opt-in and not suppressed. Reachable by SMS = consented number (< 36 months) without STOP.',
  protected_by_yuno_rules: 'Contacts not emailed because of Yuno sending rules (too many emails recently, fatigue, suppression). Protects deliverability.',
  sample_size: 'Below 10 people, percentages and distributions are hidden: give counts only.',
  rfm_segment_names: 'In RFM summaries, "pillars" = champions (your best customers), "big_occasional" = promising (high spend, rare visits), "new_promising" = new, "lost" groups dormant and lost. "raw" lists the underlying segment names used by list_customers_by_segment.',
  weekdays: 'Weekday numbers are ISO (1 = Monday ... 7 = Sunday) unless a field says otherwise. Hours are local to the event timezone.',
  findings: 'Takeaways, insights and signals carry a "text" sentence written by Yuno from the same numbers: reuse it, it already respects the definitions above.',
  money_flag: 'money=false in a result means amounts are hidden for this person\'s role: revenue fields are absent or null on purpose.',
};

export function glossaryResult(): Record<string, unknown> {
  return { definitions: GLOSSARY };
}

// Le contexte personnalisé ajouté aux consignes : qui est connecté, sur quoi.
export function sessionContext(spaces: SessionSpace[], level: string, firstName?: string | null): string {
  const lines = spaces.map((s) =>
    `- ${s.name} (${s.kind === 'venue' ? 'club' : 'organizer'}, product ${s.product}, key ${s.key}${s.money ? '' : ', money hidden'})`);
  return `\n\nCONNECTION\n${firstName ? `Person: ${firstName}.\n` : ''}Access level: ${level}${level === 'customers' ? ' (customer identities allowed)' : ' (aggregates only, no personal data)'}.\nSpaces:\n${lines.join('\n')}`;
}

// Mémo factuel rendu par get_account_overview : ce que veulent dire les
// chiffres, pour les clients qui ne lisent pas les consignes du serveur. Des
// faits sur les données, jamais une consigne de comportement (grilles de
// relecture Claude et OpenAI : pas d'instruction au modèle dans un résultat).
export const OVERVIEW_NOTES = [
  'Club revenue (CA) is what the club or organizer earns: price paid minus Yuno fees and insurance, refunds deducted. Customer spend (fees included) is a different number.',
  'Amounts are absent when this person\'s role does not show money in the Yuno Console.',
  'Below 10 people, Yuno shows counts only: no percentage, ranking or distribution.',
  'D-N means calendar days before the event, in the event timezone; events are compared at the same D-N.',
  'Drink ordering at the bar is not available in Yuno at the moment.',
  'Related tools: get_event_report (one event), compare_events (several), get_sales_overview and get_sales_trends (periods), get_recommendations (signals for an action plan), search_yuno_help (steps in the Console).',
];

// ── Prompts prêts à l'emploi (Claude les montre dans le menu « + ») ─────────

type Lang = 'fr' | 'en' | 'es';

interface PromptDef {
  name: string;
  title: Record<Lang, string>;
  description: Record<Lang, string>;
  text: Record<Lang, string>;
  arguments?: { name: string; description: string; required?: boolean }[];
}

export const PROMPTS: PromptDef[] = [
  {
    name: 'last_event_recap',
    title: { fr: 'Bilan de ma dernière soirée', en: 'Last event recap', es: 'Balance de mi última fiesta' },
    description: { fr: 'Ce qui a marché, ce qui a coincé, quoi changer.', en: 'What worked, what did not, what to change.', es: 'Qué funcionó, qué no, qué cambiar.' },
    text: {
      fr: "Fais le bilan de ma dernière soirée terminée : ventes par pilier, entrées, comparaison avec la soirée d'avant au même J-N, d'où sont venues les ventes, nouveaux vs habitués. Termine par les 3 choses à changer pour la prochaine, avec où cliquer dans Yuno.",
      en: 'Recap my last finished event: sales by pillar, entries, comparison with the previous event at the same D-N, where sales came from, new vs returning. End with the 3 things to change for the next one, with where to click in Yuno.',
      es: 'Haz el balance de mi última fiesta terminada: ventas por pilar, entradas, comparación con la anterior al mismo D-N, de dónde vinieron las ventas, nuevos vs habituales. Termina con las 3 cosas a cambiar para la próxima, con dónde hacer clic en Yuno.',
    },
  },
  {
    name: 'next_event_boost',
    title: { fr: 'Booster ma prochaine soirée', en: 'Boost my next event', es: 'Impulsar mi próxima fiesta' },
    description: { fr: 'Où en sont les ventes et quoi faire cette semaine.', en: 'Where sales stand and what to do this week.', es: 'Cómo van las ventas y qué hacer esta semana.' },
    text: {
      fr: "Où en est ma prochaine soirée par rapport à la précédente au même J-N ? Est-ce qu'on est en avance ou en retard sur l'objectif ? Donne-moi un plan d'action jour par jour jusqu'à la soirée, avec les audiences à cibler (taille comprise) et les automatisations à allumer.",
      en: 'How is my next event selling compared with the previous one at the same D-N? Are we ahead or behind the target? Give me a day-by-day action plan until the event, with the audiences to target (with their size) and the automations to switch on.',
      es: '¿Cómo va mi próxima fiesta comparada con la anterior al mismo D-N? ¿Vamos por delante o por detrás del objetivo? Dame un plan de acción día a día hasta la fiesta, con las audiencias a las que dirigirme (con su tamaño) y las automatizaciones a activar.',
    },
  },
  {
    name: 'weekly_action_plan',
    title: { fr: 'Mon plan d\'action de la semaine', en: 'My weekly action plan', es: 'Mi plan de acción semanal' },
    description: { fr: 'Les actions qui rapportent le plus, classées.', en: 'Highest-impact actions, ranked.', es: 'Las acciones de mayor impacto, ordenadas.' },
    text: {
      fr: 'Analyse mes chiffres (ventes récentes, prochaines soirées, base clients, marketing) et donne-moi les 5 actions à plus fort impact cette semaine, classées, avec pour chacune : pourquoi (le chiffre), comment le faire dans Yuno, et le chiffre qui montrera que ça a marché.',
      en: 'Analyse my numbers (recent sales, upcoming events, customer base, marketing) and give me the 5 highest-impact actions for this week, ranked, each with: why (the number), how to do it in Yuno, and the number that will show it worked.',
      es: 'Analiza mis cifras (ventas recientes, próximas fiestas, base de clientes, marketing) y dame las 5 acciones de mayor impacto esta semana, ordenadas, cada una con: por qué (la cifra), cómo hacerlo en Yuno y la cifra que mostrará que funcionó.',
    },
  },
  {
    name: 'win_back_regulars',
    title: { fr: 'Faire revenir mes habitués', en: 'Win back my regulars', es: 'Recuperar a mis habituales' },
    description: { fr: 'Qui décroche et comment les relancer.', en: 'Who is dropping off and how to bring them back.', es: 'Quién se está yendo y cómo recuperarlo.' },
    text: {
      fr: "Combien de mes clients fidèles ou à risque ne sont pas revenus récemment ? Dimensionne l'audience (joignables par email et SMS), propose le message et le canal, et dis-moi quelle automatisation allumer pour que ça se fasse tout seul.",
      en: 'How many of my loyal or at-risk customers have not come back recently? Size the audience (reachable by email and SMS), propose the message and channel, and tell me which automation to switch on so it happens automatically.',
      es: '¿Cuántos de mis clientes fieles o en riesgo no han vuelto últimamente? Dimensiona la audiencia (alcanzable por email y SMS), propone el mensaje y el canal, y dime qué automatización activar para que ocurra solo.',
    },
  },
  {
    name: 'marketing_review',
    title: { fr: 'Ce que vaut mon marketing', en: 'Is my marketing working?', es: '¿Funciona mi marketing?' },
    description: { fr: 'Emails, automatisations, push, liens : ce qui vend.', en: 'Emails, automations, push, links: what sells.', es: 'Emails, automatizaciones, push, enlaces: qué vende.' },
    text: {
      fr: "Passe en revue mon marketing des 90 derniers jours : campagnes email (clics, ventes attribuées, désinscriptions), automatisations, push et liens suivis. Dis-moi ce qui vend, ce qui ne sert à rien, et le meilleur jour/heure d'envoi.",
      en: 'Review my marketing over the last 90 days: email campaigns (clicks, attributed sales, unsubscribes), automations, push and tracked links. Tell me what sells, what is useless, and the best day and time to send.',
      es: 'Revisa mi marketing de los últimos 90 días: campañas de email (clics, ventas atribuidas, bajas), automatizaciones, push y enlaces rastreados. Dime qué vende, qué no sirve y el mejor día y hora de envío.',
    },
  },
  {
    name: 'audience_portrait',
    title: { fr: 'Portrait de mon public', en: 'Portrait of my audience', es: 'Retrato de mi público' },
    description: { fr: 'Qui vient, combien, à quelle fréquence, quels goûts.', en: 'Who comes, how many, how often, what tastes.', es: 'Quién viene, cuántos, con qué frecuencia, qué gustos.' },
    text: {
      fr: "Fais le portrait de mon public : taille et croissance de la base, part de nouveaux et d'habitués, fréquence, segments, goûts musicaux, comment ils achètent (délai, heures, groupes). Termine par 3 idées pour mieux le servir.",
      en: 'Portray my audience: base size and growth, share of new vs returning, frequency, segments, music tastes, how they buy (lead time, hours, groups). End with 3 ideas to serve them better.',
      es: 'Haz el retrato de mi público: tamaño y crecimiento de la base, nuevos vs habituales, frecuencia, segmentos, gustos musicales, cómo compran (antelación, horas, grupos). Termina con 3 ideas para servirles mejor.',
    },
  },
  {
    name: 'compare_season',
    title: { fr: 'Comparer mes soirées', en: 'Compare my events', es: 'Comparar mis fiestas' },
    description: { fr: 'Tableau comparatif et ce qu\'il faut en retenir.', en: 'Side-by-side table and what to learn from it.', es: 'Tabla comparativa y qué aprender.' },
    text: {
      fr: 'Compare mes 6 dernières soirées dans un tableau (CA, billets, tables, guest list, entrées, nouveaux clients, canal principal) et explique ce qui distingue les meilleures des moins bonnes.',
      en: 'Compare my last 6 events in a table (revenue, tickets, tables, guest list, entries, new customers, main channel) and explain what separates the best from the weakest.',
      es: 'Compara mis últimas 6 fiestas en una tabla (ingresos, entradas, mesas, guest list, accesos, nuevos clientes, canal principal) y explica qué distingue a las mejores de las peores.',
    },
  },
  {
    name: 'release_live',
    title: { fr: 'Suivre une mise en vente en direct', en: 'Follow a release live', es: 'Seguir un lanzamiento en directo' },
    description: { fr: 'Ventes de la dernière heure et réaction.', en: 'Last hour sales and what to do.', es: 'Ventas de la última hora y qué hacer.' },
    text: {
      fr: "Où en est la mise en vente en ce moment : visiteurs, ventes des 10 et 60 dernières minutes, rythme par rapport à la dernière fois ? Dis-moi s'il faut relancer (story, email, push) et quand.",
      en: 'How is the release going right now: visitors, sales in the last 10 and 60 minutes, pace compared with last time? Tell me whether to push (story, email, push) and when.',
      es: '¿Cómo va el lanzamiento ahora mismo: visitantes, ventas de los últimos 10 y 60 minutos, ritmo comparado con la última vez? Dime si hay que relanzar (story, email, push) y cuándo.',
    },
  },
];

export function langOf(code: string | null | undefined): Lang {
  return code === 'fr' || code === 'es' ? code : 'en';
}

export function listPrompts(lang: Lang, products: Set<string>): Record<string, unknown>[] {
  return PROMPTS
    .filter((p) => p.name !== 'release_live' || products.has('suite'))
    .map((p) => ({ name: p.name, title: p.title[lang], description: p.description[lang] }));
}

export function getPrompt(name: string, lang: Lang): Record<string, unknown> | null {
  const p = PROMPTS.find((x) => x.name === name);
  if (!p) return null;
  return {
    description: p.description[lang],
    messages: [{ role: 'user', content: { type: 'text', text: p.text[lang] } }],
  };
}

// ── Ressources (consignes et glossaire lisibles par les clients qui les gèrent) ──

export const RESOURCES = [
  { uri: 'yuno://guide/analysis', name: 'analysis-guide', title: 'How to analyse Yuno data', mimeType: 'text/markdown', description: 'Method, rules and nightlife playbook used by this server.' },
  { uri: 'yuno://guide/glossary', name: 'glossary', title: 'Yuno metric definitions', mimeType: 'text/markdown', description: 'Exact definition of every number returned by the tools.' },
];

export function readResource(uri: string): { uri: string; mimeType: string; text: string } | null {
  if (uri === 'yuno://guide/analysis') return { uri, mimeType: 'text/markdown', text: INSTRUCTIONS };
  if (uri === 'yuno://guide/glossary') {
    return { uri, mimeType: 'text/markdown', text: Object.entries(GLOSSARY).map(([k, v]) => `- **${k}**: ${v}`).join('\n') };
  }
  return null;
}
