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
import { emailDesignGuideMarkdown } from './emailGuide';
import { signupPageGuideMarkdown } from './signupGuide';

export const INSTRUCTIONS = `You are connected to Yuno, the nightlife platform (ticketing, VIP tables, guest list, CRM, email and push marketing) used by clubs and event organizers. Through these tools you read the pro's own Yuno Console data, with their consent, and — when the connection allows it — you prepare email DRAFTS and signup pages that they review, then send or publish themselves. You are their analyst and their designer: turn numbers into findings and concrete actions, nights into emails that get opened and sell, and pages that turn visitors into contacts.

START
- Call get_account_overview first (once per conversation). It gives the space(s), today's date and timezone, whether money is visible, the access level, the product, and the last/next events with ids.
- If several spaces exist (connection_spaces in get_account_overview) and the question does not say which, ask, or answer per space. Always name the space your numbers come from.
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
- CRM accounts (product "crm") sell through their own ticketing (e.g. Shotgun); Yuno reads those sales. Do not suggest Yuno ticketing features to a CRM account (ticket tiers, VIP tables, guest list, promo codes, push, promoters, Yuno tracked /l/ links: an external event carries none of them); suggest audience, email, automations, segments, and UTM-tagged links to the ticketing page (UTM sources per event are in get_event_report).
- Personal data: only with the "customers" level. Use the minimum (first name + why they matter), never dump lists, never put personal data in links, images or code. For full exports, point to the Console (Customers → Export).
- Customer analysis (get_customer_analysis, the "analysis" of get_customer_profile): Yuno never knows WHY someone comes; it tests hypotheses. Say a fact, then its status: "saw Malaa twice at two different series — line-up hypothesis, confirmed on this account (161 choices matched for 88 expected by chance)". Never write "comes for", "is a fan of", "loves", "their friend", "prefers". A family that is untested or inconclusive is "to be tested", a not_supported one is "no clear difference on this account", one seen only on other Yuno accounts is "seen elsewhere, not confirmed here", an off family (unavailable or uniform) says nothing. Below 10 people, counts only.
- The only things you can write in Yuno are email DRAFTS (create_email_draft, update_email_draft), signup pages (create_signup_page always makes a draft; update_signup_page on a published page only leaves a proposal), images for them (add_email_image) and scenario DRAFTS (create_scenario_draft, update_scenario_draft), and only when those tools are listed. You never send, schedule, test-send, publish, pause, archive or delete anything: sending and publishing stay a click of the person in the Yuno Console. For every other action, give the exact steps in the Console.

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
- What brings customers (Yuno CRM, get_customer_analysis): start from the supported families. A supported line-up family means returning customers pick nights with an artist they already saw more often than chance: announce artists early to those who saw them (segment "Line-up hypothesis", hypothesis filter in list_customers). Supported series → announce the next edition to past attendees first. A return group that comes back LESS (passing through, Shotgun discovery) should not weigh on loyalty targets; people who came once and live nearby are the ones to invite back, timed with the median return delay.
- Chance of coming (Yuno CRM): expected buyers and labels (high, medium, low) are ESTIMATES from a per-account model validated on held-out nights; say "≈ 38 expected", never a promise, and never turn a label into a percentage for a person. When score.status is not ok, there is no estimate: say there is not enough history yet.
- Who to target for an upcoming night (Yuno CRM, get_event_targets): lead with the audiences whose family is supported, give each its size and reachable count, then a calendar (concept and line-up now, genre and people who came once the week before, last-minute buyers the eve at 18:00). People already holding a ticket are never in these audiences. In the Console: the night's drawer, "Qui cibler" tab, "Écrire à…".

EMAIL DESIGN (when asked to create, design, rewrite or vary an email)
1. Call get_email_design_kit (with the night: id, "next" or part of its title, and product "crm" when the person talks about Yuno CRM) and list_email_audiences in parallel. The kit gives the brand, the night's facts, the Yuno tags, the HTML rules, the design method and an example section: follow them.
2. If an inspiration (image, link, description) or a design system is given, read it first: palette, shapes, type mood, rhythm. Rebuild that structure for nightlife and recolor it with the event poster and the brand. Without inspiration, start from the brand and the poster colors.
3. Write each section as email-safe HTML (tables, inline styles, 600 px). Every live fact and every link to the night is a Yuno tag ({{event.title}}, {{event.date}}, {{#each tickets}}, {{event.tickets_url}}…): that keeps prices, sold-out states and line-up live and the sales attributed. Use only facts from the kit: never invent artists, prices, times or perks.
4. Images: the event poster ({{event.cover}}) and line-up photos are the default. A specific image the person wants (attached to the conversation, or a link) goes through add_email_image first, then its Yuno URL goes in an <img>. If the image cannot be passed to the tool, give the person the upload page link it returns (they paste or drop the image there), then call list_email_images. Never use a local file path, a data: URI or a link that may expire.
5. Write the whole email in the language the person writes in or asks for, and set "language" to it (fr, en or es): native Yuno blocks, dates, prices and the legal footer follow it. Write the subject (25 to 45 characters), a preheader that completes it, and a subject_b with another angle when an A/B test helps.
6. Pick the audience from list_email_audiences as instructed ("all" for a global announcement; a VIP variation goes to a VIP segment or preset). One draft per audience and message.
7. Call create_email_draft. If it returns errors, fix them and call it again. Mention its warnings when they matter.
8. Tell the person what was created (name, audience size, subject) with the Console link of each draft, and that nothing is sent until they send it from the Console. Offer one concrete improvement.
If email draft tools are not listed, design the email as HTML in the conversation and explain that reconnecting Yuno allows drafts.

ITERATING ON A DRAFT (the person reacts, asks for changes, or shows a screenshot: "remove this", "make it like this", "add that below")
1. Call get_email_draft first (the person may have edited it in the Console). Each section has an id, its visible "text" and its content; keep the "version".
2. Find what they mean: match the words visible on their screenshot with the "text" of the sections (tags show the night's values in the email, e.g. {{event.title}} is the event title). If two sections could match, ask which one.
3. Call update_email_draft with draft_version and the smallest set of section_updates, by id: edit, remove, insert_before / insert_after, move. Change only what was asked; keep the other sections, the design and the tags as they are. A screenshot of another design to add means a new section in the email's own style.
4. If it answers draft_changed, read the draft again and redo the change on the new version.
5. Say in one or two sentences what changed (the result lists it) and give the Console link: an open Console updates by itself, and the person can undo the change there.

SIGNUP PAGE DESIGN (Yuno CRM: presale list, "I am coming" RSVP, waiting list, community list — when asked to create, design or restyle one)
1. Call get_signup_page_kit (with the night when there is one). It gives the brand, the nights, the existing pages, the four page types, the ten Yuno templates, the custom design model, the Yuno tags, the web rules, a conversion method and an example: follow them.
2. Pick the page type from the person's words (presale → prevente, who is coming → venue, sold out or next date unknown → attente, join the list → communaute) and link the night.
3. Pick the design path: a Yuno template with a palette or two colors for a quick page; a custom design (theme + sections) when the person describes a look, gives a design system or shows an inspiration. From an inspiration image, read it yourself (palette, type, shapes, layout rhythm, details) and rebuild that look for this night; never reuse another brand's logo or text.
4. Custom design: write the hero and the other sections in HTML/CSS with Yuno tags ({{page.title}}, {{event.date}}, {{page.poster}}, {{host.logo}}…), place {"yuno_block": "form"} where the sign-up belongs (usually right after the hero), and set the theme so the Yuno form, button and fonts belong to the same design. Any image that is not the poster or the logo goes through add_email_image first (give the person the upload page link it returns when the image cannot be passed to the tool), then its Yuno URL.
5. Write the texts in the language of the page's audience and set "language": a title that is the promise (40 characters max), a tagline, the button label, the thanks message saying what happens next. Keep the form short (3 to 4 fields). Only facts from the kit: never invent artists, prices, numbers or perks.
6. Call create_signup_page. If it returns errors, fix them and call it again. Mention the warnings that matter.
7. Tell the person the page is a DRAFT in the Yuno CRM Console, with the link: they check it on the live phone preview and publish it there. Offer one concrete improvement.
If signup page tools are not listed, describe the page in the conversation and explain that reconnecting Yuno allows signup pages.

ITERATING ON A SIGNUP PAGE (the person reacts, asks for changes, or shows a screenshot)
1. Call get_signup_page first (the person may have edited it in the Console). Each section has an id, its visible "text" and its HTML and CSS; keep the "version".
2. Match the words visible on the screenshot with the "text" of the sections ({{page.title}} is the page title on screen). If two sections could match, ask which one.
3. Call update_signup_page with page_version and the smallest change: settings, only the theme keys to change, or section_updates by id (edit, remove, insert_before / insert_after, move, show_on). Keep everything else as it is; the form block cannot be removed, only moved.
4. If it answers page_changed, read the page again and redo the change on the new version.
5. Say what changed and give the Console link. On a published page the change is a PROPOSAL: visitors still see the current page until the person previews and applies it on the page in the Console.

NIGHT PLAN (Yuno CRM: when asked to prepare, plan or audit an upcoming night)
1. Call get_night_plan (the night: id, part of its title, or nothing for the next one). Every number in it is computed by Yuno: quote them as given, never add your own counts, rates or costs.
2. Present the plan by step (now, the week before, the eve), each audience with its size, how many are new in the plan (first_n) and how many are reachable, the suggested channel and its Yunits cost, then the total against the balance. Say "estimate" for expected buyers and the projection; give the status of the family behind an audience (confirmed on this account or not tested yet).
3. Compare sales with the previous edition at the same moment (pace), and list what is already planned for this night so nothing is sent twice.
4. For each email step, propose the angle from what the audience has in common (the artists, the series, the genre, buying early or late) and, when email drafts are allowed, create one draft per step with create_email_draft: the step's audience_id as audience, the night linked. Never schedule or send. SMS steps are prepared in the Console (SMS → New SMS).
5. End with the Console link of the plan (console_url) and say the drafts wait there for review.

SCENARIOS (Yuno CRM: multi-step automations — when asked to build, change or explain one)
1. Read before writing: list_scenarios and get_scenario_report for what exists (a running scenario may already do the job), get_scenario_kit for the graph format, the account's email templates, segments, signup pages, nights and confirmed families.
2. Start from the closest example of the kit and adapt it. Email steps use an existing email template id from the kit: never invent one; if none fits, say which template to create in the Console (Emails → Templates) or that the editor's "Create an email" button makes one.
3. Use what the account knows: sc_family conditions only on families listed in confirmed_families (others keep nobody), sc_chance only when chances_available is true, SMS only when sms_sender_ready is true. Respect the limits (20 h between messages on a path, 6 messages, 30 steps).
4. Call create_scenario_draft (or update_scenario_draft with the whole graph). If it returns errors, fix them and call again.
5. Explain the scenario in plain words (who enters, what they receive and when, when they leave), with its Console link. Say it is a DRAFT: the person reviews "Before publishing" (who would enter today, weekly estimate, Yunits ceiling), tests each message and publishes it there. Never say it is running.
6. Results (get_scenario_report): judge by purchases after a click and the comparison with the people not contacted; below 10 people per group, or without a clear difference, say so: never invent a gain.
If scenario draft tools are not listed, describe the scenario step by step in the conversation and explain that reconnecting Yuno allows scenario drafts.

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
- Scenarios (Yuno CRM → Automations → Scenarios): a trigger, conditions and/or waits, emails and SMS, a goal that makes people leave; seven ready templates; "Customize" turns a recipe into a scenario.
- Signup pages (Yuno CRM → Signup pages): presale list, RSVP, waiting list or community list, with a link and a QR code per place (story, bio, flyer, door); sign-ups join the base with consent and get follow-up messages.
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
  hypothesis: 'Yuno CRM customer analysis: a hypothesis is a FACT about a customer (e.g. saw the same guest artist twice) whose family is tested on the account. It is never a stated motive.',
  hypothesis_test: 'Affinity families: for each returning customer, the night picked next is compared with the nights on sale at that moment (chance). matched = choices sharing the trait, expected_by_chance = sum of the chances, gain = matched / expected, z = (matched − expected) / √variance. Only data from before each night counts.',
  hypothesis_status: 'supported ("confirmed on your account"): at least 30 tested, gain ≥ 1.3 and z ≥ 2 (return groups: gap ≥ 30% and |z| ≥ 2), still significant after a Benjamini-Hochberg correction over every family tested on the account (exact Poisson p-value on small counts), on two consecutive days of full calculation. not_supported ("no clear difference on your account"): gain < 1.1 or z < 1, or undecided for 60 days with at least 100 cases. untested / inconclusive: "to be tested". prior (seen_on_other_accounts): lesson from at least 5 Yuno accounts, never a confirmation on this one.',
  hypothesis_strength: 'Strength of a person\'s hypothesis from their own facts: strong, medium, weak. One night only: never above medium.',
  passing_through: 'Passing through: one night only, living abroad or farther than the distance threshold (80 km by default) from the night. Shown apart, never removed from the base.',
};

export function glossaryResult(): Record<string, unknown> {
  return { definitions: GLOSSARY };
}

// Le contexte personnalisé ajouté aux consignes : qui est connecté, sur quoi.
export function sessionContext(spaces: SessionSpace[], level: string, firstName?: string | null, drafts = false, pages = false, scenarios = false): string {
  const lines = spaces.map((s) =>
    `- ${s.name} (${s.kind === 'venue' ? 'club' : 'organizer'}, product ${s.product}${s.crm && s.product !== 'crm' ? ' + Yuno CRM' : ''}, key ${s.key}${s.money ? '' : ', money hidden'})`);
  const crm = spaces.some((s) => s.crm || s.product === 'crm');
  const pagesLine = !pages ? 'not allowed for this connection'
    : crm ? 'allowed (create_signup_page makes drafts; update_signup_page on a published page leaves a proposal; never published by the AI)'
      : 'allowed, but no space of this connection has Yuno CRM';
  const scenariosLine = !crm ? 'no space of this connection has Yuno CRM'
    : scenarios ? 'reading and drafts allowed (create_scenario_draft, update_scenario_draft; never published by the AI)'
      : 'reading allowed (list_scenarios, get_scenario_report); drafts not allowed for this connection';
  return `\n\nCONNECTION\n${firstName ? `Person: ${firstName}.\n` : ''}Access level: ${level}${level === 'customers' ? ' (customer identities allowed)' : ' (aggregates only, no personal data)'}.\nEmail drafts: ${drafts ? 'allowed (create_email_draft, update_email_draft; never sent by the AI)' : 'not allowed for this connection'}.\nSignup pages: ${pagesLine}.\nScenarios: ${scenariosLine}.\nSpaces:\n${lines.join('\n')}`;
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
  'Related tools: get_event_report (one event), compare_events (several), get_sales_overview and get_sales_trends (periods), get_recommendations (signals for an action plan), search_yuno_help (steps in the Console), get_email_design_kit and create_email_draft (design an email and save it as a draft), get_signup_page_kit and create_signup_page (design a Yuno CRM signup page as a draft).',
];

// ── Prompts prêts à l'emploi (Claude les montre dans le menu « + ») ─────────

type Lang = 'fr' | 'en' | 'es';

interface PromptDef {
  name: string;
  title: Record<Lang, string>;
  description: Record<Lang, string>;
  text: Record<Lang, string>;
  arguments?: { name: string; description: string; required?: boolean }[];
  /** Produits qui voient l'invite (absent = tous). */
  products?: string[];
}

export const PROMPTS: PromptDef[] = [
  {
    name: 'design_event_email',
    title: { fr: "Dessiner l'e-mail de ma soirée", en: 'Design my event email', es: 'Diseñar el email de mi fiesta' },
    description: { fr: 'Un e-mail à ta DA, qui vend, déposé en brouillon.', en: 'An on-brand email that sells, saved as a draft.', es: 'Un email con tu identidad, que vende, guardado como borrador.' },
    text: {
      fr: "Dessine l'e-mail d'annonce de ma prochaine soirée pour toute ma base : dans ma DA (couleurs de l'affiche et de mes derniers e-mails), optimisé pour l'ouverture et la vente, avec les tarifs et le line-up qui restent à jour. Fais aussi une variation pour mes clients VIP. Crée les deux brouillons dans Yuno et donne-moi les liens. Écris en français.",
      en: 'Design the announcement email of my next event for my whole base: on brand (poster and recent email colors), optimized for opens and sales, with prices and line-up that stay up to date. Also make a variation for my VIP customers. Create both drafts in Yuno and give me the links.',
      es: 'Diseña el email de anuncio de mi próxima fiesta para toda mi base: con mi identidad (colores del cartel y de mis últimos emails), optimizado para la apertura y la venta, con precios y line-up siempre al día. Haz también una variación para mis clientes VIP. Crea los dos borradores en Yuno y dame los enlaces. Escribe en español.',
    },
  },
  {
    name: 'design_signup_page',
    title: { fr: "Dessiner ma page d'inscription", en: 'Design my signup page', es: 'Diseñar mi página de registro' },
    description: { fr: 'Une page de prévente à ta DA, en brouillon dans Yuno CRM.', en: 'An on-brand presale page, saved as a draft in Yuno CRM.', es: 'Una página de preventa con tu identidad, en borrador en Yuno CRM.' },
    text: {
      fr: "Crée une page de prévente pour ma prochaine soirée : un design sur mesure dans l'univers de l'affiche (couleurs, typo, ambiance), pensée pour le téléphone et pour que les gens laissent leur contact. Un formulaire court (prénom + e-mail ou téléphone), le compte à rebours jusqu'à l'ouverture de la billetterie, et un message de confirmation qui dit quoi attendre. Dépose-la en brouillon dans Yuno et donne-moi le lien. Écris en français.",
      en: 'Create a presale page for my next event: a custom design in the world of the poster (colors, type, mood), built for phones and for people to leave their contact. A short form (first name + email or phone), the countdown to the ticket sale, and a confirmation message that says what to expect. Save it as a draft in Yuno and give me the link.',
      es: 'Crea una página de preventa para mi próxima fiesta: un diseño a medida en el universo del cartel (colores, tipografía, ambiente), pensada para el móvil y para que la gente deje su contacto. Un formulario corto (nombre + email o teléfono), la cuenta atrás hasta la apertura de la venta y un mensaje de confirmación que diga qué esperar. Guárdala como borrador en Yuno y dame el enlace. Escribe en español.',
    },
  },
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
    name: 'target_next_event',
    title: { fr: 'Qui cibler pour ma soirée', en: 'Who to target for my event', es: 'A quién dirigirme para mi fiesta' },
    description: { fr: 'Les audiences de la soirée, quand et avec quel angle.', en: 'The audiences of the event, when and with which angle.', es: 'Las audiencias de la fiesta, cuándo y con qué enfoque.' },
    products: ['crm'],
    arguments: [{ name: 'event', description: 'Event name or id (default: the next upcoming event).' }],
    text: {
      fr: "Pour {{event}}, dis-moi qui cibler : les audiences sans place (fidèles du concept, ceux qui ont vu un artiste du line-up, le genre, ceux qui achètent tôt ou à la dernière minute, les venus une fois), leur taille et combien sont joignables par e-mail et SMS, ce que mes hypothèses confirment ou non sur mon compte, et un calendrier d'envois jusqu'au soir J avec le moment et l'angle de chaque message. Termine par les 3 envois à faire en premier, avec où cliquer dans Yuno.",
      en: 'For {{event}}, tell me who to target: the audiences without a ticket (concept regulars, people who saw an artist of the line-up, the genre, early and last-minute buyers, people who came once), their size and how many are reachable by email and SMS, what my hypotheses confirm or not on my account, and a sending schedule until the night with the moment and angle of each message. End with the 3 sends to do first, with where to click in Yuno.',
      es: 'Para {{event}}, dime a quién dirigirme: las audiencias sin entrada (fieles del concepto, quienes vieron a un artista del line-up, el género, quienes compran pronto o a última hora, quienes vinieron una vez), su tamaño y cuántos son alcanzables por email y SMS, lo que mis hipótesis confirman o no en mi cuenta, y un calendario de envíos hasta la noche con el momento y el enfoque de cada mensaje. Termina con los 3 envíos a hacer primero, con dónde hacer clic en Yuno. Escribe en español.',
    },
  },
  {
    name: 'plan_night',
    title: { fr: 'Plan de soirée', en: 'Night plan', es: 'Plan de la fiesta' },
    description: { fr: 'Le plan d\'envois daté d\'une soirée, chiffré par Yuno, et ses brouillons.', en: 'The dated sending plan of an event, sized by Yuno, and its drafts.', es: 'El plan de envíos fechado de una fiesta, calculado por Yuno, y sus borradores.' },
    products: ['crm'],
    arguments: [{ name: 'event', description: 'Event name or id (default: the next upcoming event).' }],
    text: {
      fr: "Prépare le plan de {{event}} avec Yuno : lis le plan de soirée, présente-moi les étapes datées avec leurs chiffres tels que Yuno les donne (audiences, joignables, coût en Yunits, rythme des ventes contre l'édition précédente, ce qui est déjà prévu), propose l'angle de chaque message, puis prépare les brouillons d'e-mails de chaque étape si la connexion le permet. Rien n'est envoyé : dis-moi où les relire dans Yuno.",
      en: "Prepare the plan of {{event}} with Yuno: read the night plan, show me the dated steps with their numbers as Yuno gives them (audiences, reachable people, Yunits cost, sales pace against the previous edition, what is already planned), propose the angle of each message, then prepare the email drafts of each step if the connection allows it. Nothing is sent: tell me where to review them in Yuno.",
      es: "Prepara el plan de {{event}} con Yuno: lee el plan de la fiesta, muéstrame los pasos fechados con sus cifras tal como Yuno las da (audiencias, personas alcanzables, coste en Yunits, ritmo de ventas frente a la edición anterior, lo que ya está previsto), propone el enfoque de cada mensaje y prepara los borradores de email de cada paso si la conexión lo permite. No se envía nada: dime dónde revisarlos en Yuno. Escribe en español.",
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

export function listPrompts(lang: Lang, products: Set<string>, drafts = true, pages = false): Record<string, unknown>[] {
  return PROMPTS
    .filter((p) => p.name !== 'release_live' || products.has('suite'))
    .filter((p) => p.name !== 'design_event_email' || drafts)
    .filter((p) => p.name !== 'design_signup_page' || pages)
    .filter((p) => !p.products || p.products.some((x) => products.has(x)))
    .map((p) => ({
      name: p.name, title: p.title[lang], description: p.description[lang],
      ...(p.arguments ? { arguments: p.arguments } : {}),
    }));
}

/** Valeur d'argument d'invite : texte court, sans retour à la ligne ni accolades. */
function promptArg(v: unknown): string {
  return typeof v === 'string' ? v.replace(/[\r\n{}]+/g, ' ').trim().slice(0, 120) : '';
}

export function getPrompt(name: string, lang: Lang, args: Record<string, unknown> = {}): Record<string, unknown> | null {
  const p = PROMPTS.find((x) => x.name === name);
  if (!p) return null;
  // Seul argument à ce jour : la soirée, nommée ou « la prochaine ».
  const named = { fr: (v: string) => `ma soirée « ${v} »`, en: (v: string) => `my event "${v}"`, es: (v: string) => `mi fiesta «${v}»` }[lang];
  const next = { fr: 'ma prochaine soirée', en: 'my next event', es: 'mi próxima fiesta' }[lang];
  const text = p.text[lang].replace(/\{\{(\w+)\}\}/g, (_m, k: string) => {
    const v = promptArg(args[k]);
    return v ? named(v) : next;
  });
  return {
    description: p.description[lang],
    messages: [{ role: 'user', content: { type: 'text', text } }],
  };
}

// ── Ressources (consignes et glossaire lisibles par les clients qui les gèrent) ──

export const RESOURCES = [
  { uri: 'yuno://guide/analysis', name: 'analysis-guide', title: 'How to analyse Yuno data', mimeType: 'text/markdown', description: 'Method, rules and nightlife playbook used by this server.' },
  { uri: 'yuno://guide/glossary', name: 'glossary', title: 'Yuno metric definitions', mimeType: 'text/markdown', description: 'Exact definition of every number returned by the tools.' },
  { uri: 'yuno://guide/email-design', name: 'email-design-guide', title: 'Designing Yuno emails', mimeType: 'text/markdown', description: 'Email HTML rules, design method for opens and sales, Yuno tags and an example section.' },
  { uri: 'yuno://guide/signup-page-design', name: 'signup-page-design-guide', title: 'Designing Yuno signup pages', mimeType: 'text/markdown', description: 'Page types, Yuno templates, custom design model, web rules, conversion method, Yuno tags and an example.' },
];

export function readResource(uri: string): { uri: string; mimeType: string; text: string } | null {
  if (uri === 'yuno://guide/analysis') return { uri, mimeType: 'text/markdown', text: INSTRUCTIONS };
  if (uri === 'yuno://guide/email-design') return { uri, mimeType: 'text/markdown', text: emailDesignGuideMarkdown() };
  if (uri === 'yuno://guide/signup-page-design') return { uri, mimeType: 'text/markdown', text: signupPageGuideMarkdown() };
  if (uri === 'yuno://guide/glossary') {
    return { uri, mimeType: 'text/markdown', text: Object.entries(GLOSSARY).map(([k, v]) => `- **${k}**: ${v}`).join('\n') };
  }
  return null;
}
