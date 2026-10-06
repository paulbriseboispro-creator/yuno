// Ce que le serveur MCP apprend à l'IA pour DESSINER une page d'inscription :
// les quatre types de page, les dix gabarits Yuno, le modèle du design sur
// mesure (thème, sections, blocs Yuno), les règles d'une page web publique et
// la méthode d'une page qui convertit. Rendu par get_signup_page_kit et par la
// ressource yuno://guide/signup-page-design.
//
// Des FAITS et des règles de métier, pas des ordres au modèle : les consignes
// de conduite vivent dans INSTRUCTIONS (guide.ts).

import { CUSTOM_LIMITS, PAGE_TAGS } from '../../src/crm/signup/custom';
import { FONTS, TPL } from '../../src/crm/signup/model';

/** Les quatre types de page (KIND_META de la Console), en mots. */
export const PAGE_KIND_RULES: Record<string, { use_for: string; night: string; closes: string; follow_up: string }> = {
  prevente: {
    use_for: 'Presale list: fans leave their contact to be told first when ticket sales open (often with early access).',
    night: 'required', closes: 'closes_mode "sale" (when sales open, sale_opens_at) or "date"',
    follow_up: '"It is open" message at sale_opens_at, then a reminder and a last call to people who did not buy (set in the Console).',
  },
  venue: {
    use_for: '"I am coming": RSVP for a night (free entry, guest-list style); can ask how many people come (party_size question).',
    night: 'required', closes: 'closes_mode "eve" (the day before at 18:00) or "date"',
    follow_up: 'Reminder the day before at 18:00.',
  },
  attente: {
    use_for: 'Waiting list: the night is sold out, or the next date is not announced yet.',
    night: 'optional (a sold-out night, or none)', closes: 'closes_mode "manual" (the person opens the places) or "date"',
    follow_up: '"It is open" message when the person clicks "notify" in the Console, then reminders.',
  },
  communaute: {
    use_for: 'Community list: join the club or organizer list, no particular night. A reward (free drink, priority entry) lifts sign-ups.',
    night: 'none', closes: 'closes_mode "never" or "date"',
    follow_up: 'Welcome message at sign-up.',
  },
};

const LAYOUT_WORDS: Record<string, string> = {
  soiree: 'poster at the top fading into a dark page, club chip and badge over the poster, title at the bottom of the poster; gradient button',
  affiche: 'full-bleed poster behind the page, the form in a blurred glass panel at the bottom',
  brutal: 'neo-brutalist: bright paper color, thick black borders, hard offset shadows, uppercase heavy type, white card',
  edito: 'editorial magazine: paper background, serif headline, underlined inputs, square buttons',
  ticket: 'a paper ticket with notches on a colored background, mono labels',
  affichage: 'billboard typography: huge condensed uppercase title (Anton), square inputs',
  verre: 'glassmorphism: blurred poster, colored glows, frosted form card',
  epure: 'minimal and light, centered, pill inputs, no shadows',
  flyer: 'street flyer: halftone dots, bold colors, white card with black borders, tilted button',
  terminal: 'hacker terminal: monospace, scanlines, outlined button in brackets',
};

/** Les dix gabarits Yuno (le plus rapide : un gabarit + une palette ou deux couleurs). */
export function templateCatalog(): Record<string, unknown>[] {
  return TPL.map((t) => ({
    name: t.id,
    look: LAYOUT_WORDS[t.id] ?? '',
    font: FONTS.find((f) => f.id === t.font)?.f.replace(/'/g, ''),
    palettes: t.pals.map((p) => ({ palette: p.id, background: p.bg, accent: p.a })),
  }));
}

export const TEMPLATE_FONTS_HELP = 'template.font overrides the headline font: brico (Bricolage Grotesque), anton (Anton), serif (DM Serif Display), space (Space Grotesk), black (Archivo Black), mono (Space Mono). template.palette "custom" + background + accent sets your own two colors.';

/** Le modèle du design sur mesure, tel que l'IA l'écrit. */
export const CUSTOM_DESIGN_MODEL = {
  when: 'A custom design ("Design sur mesure" in the Console) replaces the template: you draw the page with HTML/CSS sections and place the Yuno blocks. Use it to follow an inspiration, a design system or a precise description. A Yuno template is enough for a quick, safe page.',
  theme: {
    bg: '#rrggbb page background (base color)',
    bg_css: 'optional extra CSS background layers drawn over bg: gradients, or url() of an image hosted on Yuno. Example: "radial-gradient(120% 60% at 50% 0%, rgba(227,20,27,.35), transparent 70%)"',
    text: '#rrggbb text color (contrast 4.5:1 with bg)',
    accent: '#rrggbb accent: Yuno button, checkbox, chosen answers, focus',
    accent2: 'optional #rrggbb second accent: end of the button gradient (button_style "gradient")',
    accent_text: 'optional #rrggbb text on the accent (computed when missing)',
    font_heading: 'Google Fonts family for headlines (exact name, e.g. "Anton", "Playfair Display", "Space Grotesk")',
    font_body: 'Google Fonts family for text and form (e.g. "Inter", "DM Sans", "Geist")',
    heading_weight: '100 to 900 (a weight the family has)',
    heading_case: 'none | uppercase',
    heading_tracking: 'letter-spacing of headlines in em, -0.1 to 0.3',
    card_bg: 'the Yuno form box: #rrggbb, "transparent" (on the page) or "glass" (frosted)',
    card_border: '#rrggbb or "none"', card_radius: '0 to 40', card_shadow: 'none | soft | hard (offset, brutalist) | glow',
    shadow_color: 'optional #rrggbb of hard offset shadows (form box, button); default accent on a dark page, ink on a light page',
    input_style: 'box | underline | pill', input_bg: 'optional #rrggbb or "transparent"', radius: 'corners of inputs and answer chips, 0 to 40',
    button_style: 'solid | gradient | outline', button_radius: '0 to 99', button_shadow: 'none | soft | hard | glow',
    button_case: 'none | uppercase', button_arrow: 'true shows a round arrow in the button', button_height: '44 to 64', button_font: 'body | heading',
    label_style: 'normal | uppercase | mono (field labels)',
    extra_fonts: 'up to 2 more Google Fonts families for your sections',
    css: `CSS shared by every section (${CUSTOM_LIMITS.themeCss / 1000} KB max): classes, keyframes, :host rules`,
  },
  sections: 'Top to bottom. Each item is either {"html": "...", "css": "...", "label": "Hero", "show_on": "always | before_signup | after_signup"} or {"yuno_block": "form | countdown | reward | count"}.',
  yuno_blocks: {
    form: 'REQUIRED, exactly once: the fields, questions, consent box with its exact legal text, errors, then the confirmation ("You are on the list"), the "it is open" and closed states. Styled by the theme. Option tagline:false hides the page tagline at its top (when your hero already says it).',
    countdown: 'Presale with sale_opens_at: live countdown to the opening of sales. Not placed = shown inside the form box when countdown is on.',
    reward: 'The reward box (when the page has a reward). Not placed = shown inside the form box.',
    count: 'The sign-up counter ("128 already signed up", when show_count is on). Not placed = shown inside the form box.',
  },
  fixed_by_yuno: 'The sticky button at the bottom (its label is button_label; after sign-up it becomes "add to calendar" and "share"), and the legal footer (host, Powered by Yuno, privacy) are drawn by Yuno in the theme colors. Never draw a form, an input, a checkbox, a submit button or a legal footer yourself.',
};

/** Règles techniques d'une section de page (web public, mobile d'abord). */
export const PAGE_WEB_RULES: readonly string[] = [
  'Mobile first: the page is a single column 360 to 480 px wide (phones; centered on a desktop). Use %, rem and clamp(); never a fixed width above 480 px; images max-width:100%.',
  'Each HTML section is rendered on its own (Shadow DOM): its css field styles only that section, and nothing outside it. Style the section box with :host or a wrapper class. The theme fonts are available by name (font-family:"Anton"), inherit the text color, and add your own classes. Shared rules go in theme.css.',
  'Allowed: any HTML layout element, inline SVG (no <use>, no SMIL animation), <details>/<summary>, CSS gradients, flexbox, grid, transforms, CSS animations and @keyframes (wrap motion in @media (prefers-reduced-motion: no-preference)).',
  'Removed by Yuno (and reported): <script>, <style> inside html (use the css field), iframes, objects, video and audio, forms, inputs, buttons, select, on* attributes, javascript: links, @import, @font-face, and images or url() not hosted on Yuno.',
  'Images must be hosted on Yuno: {{page.poster}} (page poster, else the event poster), {{event.poster}}, {{host.logo}}, or the URL returned by add_email_image for any other image (attached file, a link, or the upload page). Pages on yunoapp.eu block images from other sites. Write an alt text that says what the image shows.',
  'Links: use {{event.tickets_url}} for the ticketing page and https for others; they open in a new tab. Never link to a form of another service to collect contacts: only the Yuno form collects them, with consent.',
  `Size: ${CUSTOM_LIMITS.sections} sections at most, ${CUSTOM_LIMITS.sectionHtml / 1000} KB of HTML and ${CUSTOM_LIMITS.sectionCss / 1000} KB of CSS per section, ${CUSTOM_LIMITS.total / 1000} KB for the whole design. 3 to 7 sections is the norm.`,
  'Position fixed and vh units refer to the section, not the screen (the Console shows the page inside a phone): build with normal flow.',
  'Contrast: text 4.5:1 with its background, buttons 3:1. Body text 15 px or more, inputs are 16 px (no zoom on iOS).',
];

/** Méthode : une page d'inscription qui convertit (vue Instagram, au pouce). */
export const PAGE_DESIGN_METHOD: readonly string[] = [
  'FIRST SCREEN (about 640 px on a phone, people arrive from an Instagram story or a QR code): who (host), what (the night or the list), when (date), and why sign up now (early access, reward, sold-out last time). The title is the promise; the poster or a strong visual sets the mood.',
  'ORDER that converts: hero → form (right after the hero, or after one short proof block) → details (line-up, address, FAQ) after the form. People who need more scroll; the sticky button is always visible.',
  'FEWER FIELDS, MORE SIGN-UPS: first name + email or phone is enough (contact "both" lets the fan choose). Each extra field or question costs sign-ups: 3 to 4 fields in total. A question is worth it when it changes what you do (party size for a "venue" page, music taste).',
  'PROOF AND URGENCY, NEVER INVENTED: the sign-up counter (show_count) once there are people, the countdown to the sale (presale), a real reward, sold-out history only if true. Never invent artists, prices, numbers or perks: only facts from the kit.',
  'VOICE: the Yuno form, its consent box and its confirmation speak to the fan with "tu" in French and "tú" in Spanish ("Ton prénom", "Où te prévenir ?"). Write the page with the same "tu" so it reads as one voice, even for a luxury brand; if the person insists on "vous", say that the Yuno form keeps "tu".',
  'COPY: short sentences, active button label ("Je veux ma place en avant-première", "Je m\'inscris"). The thanks message tells what happens next ("Tu recevras le lien de la prévente 1 h avant tout le monde").',
  'FROM AN INSPIRATION (an image of a page, a site, a poster): extract the palette, the type (family, weight, case, tracking), the shapes (radius, borders, shadows), the layout rhythm (full-bleed hero, stacked cards, split blocks, marquee) and the details (grain, glow, stickers). Rebuild it with sections and the theme; the night gives the words and the poster.',
  'FROM A DESIGN SYSTEM: use its exact colors, fonts (Google Fonts names), radius and spacing scale: map them to the theme, then to the sections css.',
  'AFTER SIGN-UP: the form block shows the confirmation. A section with show_on "after_signup" can add a message, a share prompt or the next steps; sections with show_on "before_signup" (a long hero, a FAQ) disappear on the confirmation.',
  'LANGUAGE: write the page in the language of its audience and set "language" (fr, en or es); the form labels and legal texts follow the visitor language.',
];

export const EXAMPLE_PAGE = {
  theme: {
    bg: '#0B0B0C', text: '#F5EFE6', accent: '#E3141B', accent2: '#FF6B35', font_heading: 'Anton', font_body: 'Inter',
    heading_weight: 400, heading_case: 'uppercase', heading_tracking: 0.01, card_bg: 'glass', card_radius: 24,
    input_style: 'box', radius: 14, button_style: 'gradient', button_radius: 99, button_shadow: 'glow', button_case: 'uppercase', button_arrow: false,
    bg_css: 'radial-gradient(110% 55% at 50% 0%, rgba(227,20,27,.32), transparent 72%)',
  },
  sections: [
    {
      label: 'Hero',
      html: `<header class="hero">
  {{#if page.poster}}<img class="poster" src="{{page.poster}}" alt="Affiche {{event.title}}">{{/if}}
  <p class="kicker">{{host.name}} · {{event.date}}</p>
  <h1>{{page.title}}</h1>
  <p class="lead">{{page.tagline}}</p>
</header>`,
      css: `.hero{padding:28px 20px 8px;text-align:center}
.poster{display:block;width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:22px;box-shadow:0 30px 80px rgba(227,20,27,.35)}
.kicker{margin:18px 0 6px;font:600 12px/1.2 "Inter",sans-serif;letter-spacing:.14em;text-transform:uppercase;opacity:.75}
h1{margin:0;font-family:"Anton",sans-serif;font-weight:400;font-size:clamp(44px,13vw,64px);line-height:.92;text-transform:uppercase;letter-spacing:.01em}
.lead{margin:12px auto 0;max-width:34ch;font-size:16px;line-height:1.45;opacity:.85}
@media (prefers-reduced-motion:no-preference){.poster{animation:rise .7s cubic-bezier(.22,1,.36,1) both}@keyframes rise{from{opacity:0;transform:translateY(14px)}}}`,
    },
    { yuno_block: 'form', tagline: false },
    {
      label: 'Infos',
      show_on: 'before_signup',
      html: `{{#if event.has_date}}<section class="infos"><div><b>{{event.date_long}}</b><span>{{event.time}}</span></div><div><b>{{event.venue}}</b><span>{{event.city}}</span></div></section>{{/if}}`,
      css: `.infos{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:18px 20px 6px}
.infos div{padding:14px;border-radius:16px;background:rgba(245,239,230,.06);border:1px solid rgba(245,239,230,.12)}
.infos b{display:block;font-size:15px}.infos span{font-size:13px;opacity:.7}`,
    },
  ],
};

export function pageTagReference(): { tag: string; type: string; description: string }[] {
  return PAGE_TAGS.map((t) => ({ tag: `{{${t.tag}}}`, type: t.kind, description: t.desc }));
}

export const PAGE_TAG_SYNTAX = 'Handlebars, as in Yuno emails: {{value}}, {{#if x}}…{{else}}…{{/if}}, {{#unless x}}…{{/unless}}. Every value is escaped (no {{{raw}}}). Tags work in html (and in inline style attributes), not in the css field. Values are read when the page is displayed: title, date, counter and states stay up to date.';

/** La ressource yuno://guide/signup-page-design (markdown). */
export function signupPageGuideMarkdown(): string {
  return [
    '# Designing Yuno signup pages',
    '',
    '## Page types',
    ...Object.entries(PAGE_KIND_RULES).map(([k, r]) => `- **${k}**: ${r.use_for} Night: ${r.night}. Closes: ${r.closes}. Follow-up: ${r.follow_up}`),
    '',
    '## Yuno templates (quick)',
    ...templateCatalog().map((t) => `- **${String(t.name)}**: ${String(t.look)}`),
    TEMPLATE_FONTS_HELP,
    '',
    '## Custom design',
    CUSTOM_DESIGN_MODEL.when,
    ...Object.entries(CUSTOM_DESIGN_MODEL.theme).map(([k, v]) => `- theme.${k}: ${v}`),
    `- sections: ${CUSTOM_DESIGN_MODEL.sections}`,
    ...Object.entries(CUSTOM_DESIGN_MODEL.yuno_blocks).map(([k, v]) => `- yuno_block ${k}: ${v}`),
    `- ${CUSTOM_DESIGN_MODEL.fixed_by_yuno}`,
    '',
    '## Web rules',
    ...PAGE_WEB_RULES.map((r) => `- ${r}`),
    '',
    '## Design method',
    ...PAGE_DESIGN_METHOD.map((r) => `- ${r}`),
    '',
    '## Yuno tags',
    PAGE_TAG_SYNTAX,
    ...PAGE_TAGS.map((t) => `- \`{{${t.tag}}}\` (${t.kind}): ${t.desc}`),
    '',
    '## Example (theme + sections)',
    '```json',
    JSON.stringify(EXAMPLE_PAGE, null, 2),
    '```',
  ].join('\n');
}
