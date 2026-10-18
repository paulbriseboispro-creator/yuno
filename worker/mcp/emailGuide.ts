// Ce que le serveur MCP apprend à l'IA pour DESSINER un e-mail de soirée :
// les règles HTML qui tiennent dans toutes les boîtes de réception, la méthode
// d'un e-mail qui s'ouvre et qui vend, et un exemple de section complète avec
// les balises Yuno. Rendu par get_email_design_kit (les clients qui ne lisent
// pas les ressources le reçoivent quand même) et par la ressource
// yuno://guide/email-design.
//
// Des FAITS et des règles de métier, pas des ordres au modèle : les consignes
// de conduite vivent dans INSTRUCTIONS (guide.ts), seul endroit où les grilles
// des annuaires les acceptent.

import { SMART_TAGS } from '../../supabase/functions/_shared/email-smart';

/** Contraintes techniques d'une section : ce que les clients mail rendent vraiment. */
export const EMAIL_HTML_RULES: readonly string[] = [
  'Each section is HTML placed in a 600 px wide email column. Build layouts with <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">: nested tables for columns, never flexbox, grid, floats or position:absolute.',
  'MOBILE OVERFLOW (the usual defect, check it before sending the draft): the email is read on a 375 px phone. Never give a card, box or table a fixed pixel width above 320 (use width="100%" with style="max-width:Npx"). Never put padding on an element that also has width:100% (the padding is added on top and the box pokes out of its parent): put the padding on an inner <td>, or add box-sizing:border-box. No negative margins, no position, no flex or grid. A big date or number block (day, month, time) goes in a table cell with width="100%", centered text and padding on the cell, never in a fixed-width box.',
  'Styles are inline (style="..."). Yuno removes <style>, <link>, <script>, forms, iframes, SVG, video and on* attributes before sending.',
  'Responsive helpers already present in the email head (use them as class names): yn-stack (a column <td> that stacks full width on mobile and keeps its own padding: use it for two-column layouts), yn-hide-sm (hidden on mobile), yn-full-sm (image or block full width on mobile), yn-pad-sm (16 px side padding on mobile), yn-center-sm (centered text on mobile). Avoid yn-col: it also removes the column padding on mobile.',
  'Fonts: no web font is loaded. Use font stacks: "Helvetica Neue",Helvetica,Arial,sans-serif for strong headlines (weight 800 to 900, tight letter-spacing -0.5 to -1.5px, uppercase for a poster feel); Georgia,"Times New Roman",serif for an editorial feel; "Courier New",Courier,monospace for small labels. Body text 15 to 17 px, line-height 1.5; headlines 32 to 56 px; never below 13 px.',
  'Images: the event poster {{event.cover}}, line-up photos and {{brand.logo}} are ready to use. Any other image (attached by the person, or from a link) is first stored with add_email_image, which returns its Yuno URL and size. Always set width="…" and style="display:block;width:100%;max-width:…px;height:auto;border:0", keep the image ratio, and write an alt text that says what the image shows. Never put essential text only inside an image.',
  'Buttons are "bulletproof": a table cell with bgcolor and border-radius containing an <a> with display:inline-block, padding 15 to 18 px by 30 to 40 px, font-size 16 to 18 px, bold, text-decoration:none. Minimum 44 px tall. Add a VML <!--[if mso]> roundrect only if you want rounded buttons in Outlook (optional).',
  'Rounded shapes: border-radius works on a cell background, but a rounded OUTLINE drawn on a <td> renders square because email tables use border-collapse:collapse. For an outlined pill or card, put the border on its own <table style="border-collapse:separate;border:2px solid #hex;border-radius:999px;"> instead.',
  'Colors: always set both bgcolor="#hex" and background-color on cells that carry a color. CSS gradients and background images are not shown by Gmail and Outlook: put a solid color first, an image or gradient only as an extra.',
  'Dark mode: Apple Mail and Gmail may invert light designs. Dark nightlife designs survive best. Give every text an explicit color and every container an explicit background; put a transparent logo on a colored shape.',
  'Weight: keep the whole email under 90 KB (Gmail clips at 102 KB and hides the footer). 3 to 8 sections; no comments or unused code.',
  'Links: every link to the night uses a tag so clicks and sales are tracked: {{event.tickets_url}} (buy), {{event.url}} (night page), {{event.tables_url}} (VIP tables, Yuno ticketing only), {{event.guestlist_url}} (free guest list, Yuno only). Social links: {{social.instagram}}, {{social.tiktok}}, {{social.website}}. Use https for any other link.',
  'Never write a footer, legal text or unsubscribe link: Yuno adds the legal footer (sender, reason, unsubscribe, Powered by Yuno) below the sections, in the email language, in the theme footer colors.',
  'Optional parts are wrapped so the email never shows an empty or false block: {{#if event.cover}}, {{#if lineup}}, {{#if tables.available}}, {{#if guestlist.available}}, and {{#if event.sold_out}}…{{else}}…{{/if}} to swap the buy button for a sold-out message. Greet with {{#if first_name}}…{{else}}…{{/if}}: first names are often unknown.',
];

/** Méthode : un e-mail de soirée qui s'ouvre, se lit au pouce et vend. */
export const EMAIL_DESIGN_METHOD: readonly string[] = [
  'OPEN RATE. Subject 25 to 45 characters, concrete (artist, date, scarcity, what changes), at most one emoji, no ALL CAPS, no "!!!" or currency signs. Preheader 40 to 90 characters that completes the subject (date, place, the promise). For an A/B test give subject_b a different angle (curiosity vs urgency, artist vs date). The sender name is the account name.',
  'FIRST SCREEN (about 600 px tall on a phone): brand mark, the hook headline, date and place, and the main button. A portrait 4:5 poster takes a full phone screen: either make it the hero with the button right below, or put the headline first and the poster after, or use a two-column block (poster left, text right with yn-col).',
  'ANNOUNCEMENT FLOW: hero → line-up (photos when the kit has them, otherwise names) → why come (2 or 3 short concrete lines from the kit: music, venue, time, what is included) → the offer (tiers with prices; a sold-out tier shown crossed out is social proof) → VIP tables when available → urgency (countdown, last tiers) → final button → social links. Repeat the main button 2 or 3 times in a long email, same color, same words.',
  'VIP VARIATION: lead with exclusivity (best spot, table, bottle service, priority entry), show table packs or zones with their prices and the scarcity line {{tables.left_label}}, button to {{event.tables_url}}. On an external ticketing (event.sales = "external", Yuno CRM) there are no Yuno tables: the VIP angle is early access, the best tiers, a personal tone, and the button goes to {{event.tickets_url}}.',
  'COPY: short sentences, the second person ("tu" is the norm in French nightlife unless the brand says "vous"), active verbs on buttons ("Je prends ma place", "Réserver ma table"). Only facts from the kit: never invent an artist, a price, a time, a perk or a dress code.',
  'FROM AN INSPIRATION (image, link, description): extract the palette (page background, card, accent, text), the shapes (corner radius, pills, inset cards), the typography mood (weight, case, tracking) and the rhythm (stacked cards, image/text pairs, big headline blocks). Rebuild that structure in tables, then recolor it with the event poster and the brand: the inspiration gives the layout, the night gives the colors and the words.',
  'FROM A DESIGN SYSTEM: use its exact colors, radius and type scale; map them to the theme (background, card, text, accent, footer) and to inline styles.',
  'THEME: set theme.background (page around the email), theme.card (email body), theme.text, theme.accent (buttons of Yuno blocks, links), theme.footer_background and theme.footer_text so the legal footer matches the design, theme.radius for the container corners, theme.dark for dark designs.',
  'ACCESSIBILITY: text contrast at least 4.5:1, body 15 px or more, buttons 16 px or more, meaningful alt texts, a language attribute is set by Yuno from "language".',
  'LANGUAGE: write every word of the email in the language the person asks for, and set "language": the native Yuno blocks (buttons, "From 15 €", tables left, countdown), the dates and the legal footer then follow it.',
  'AUDIENCES: one draft per audience and message. A global announcement goes to "all"; a variation (VIP, regulars, people without a ticket yet) is its own draft with its own audience and angle. Use exclude_event_buyers for reminders and last calls, not for a first announcement.',
];

/** Une section complète, à adapter : la grammaire des balises Yuno en contexte. */
export const EXAMPLE_SECTION = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#1A0402" style="background-color:#1A0402;">
  <tr><td align="center" class="yn-pad-sm" style="padding:36px 32px 8px;">
    {{#if brand.logo}}<img src="{{brand.logo}}" width="64" alt="{{brand.name}}" style="display:block;width:64px;height:auto;border:0;margin:0 auto 20px;">{{/if}}
    <p style="margin:0 0 10px;font-family:'Courier New',Courier,monospace;font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#FF8A3D;">{{event.date}}</p>
    <h1 style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:52px;line-height:1;font-weight:900;letter-spacing:-1.5px;text-transform:uppercase;color:#FFF1E6;">{{event.title}}</h1>
    {{#if event.lineup}}<p style="margin:14px 0 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:17px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#FFD2B0;">{{event.lineup}}</p>{{/if}}
    <p style="margin:8px 0 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;color:#E9B79A;">{{event.venue}}</p>
  </td></tr>
  {{#if event.cover}}<tr><td class="yn-pad-sm" style="padding:24px 32px 0;">
    <img src="{{event.cover}}" width="536" alt="Affiche {{event.title}}" class="yn-full-sm" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:20px;">
  </td></tr>{{/if}}
  <tr><td align="center" style="padding:28px 32px 36px;">
    {{#if event.sold_out}}
      <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:18px;font-weight:800;color:#FFF1E6;">Complet — rendez-vous sur place</p>
    {{else}}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr>
        <td bgcolor="#FF5A1F" style="background-color:#FF5A1F;border-radius:999px;">
          <a href="{{event.tickets_url}}" style="display:inline-block;padding:17px 40px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:17px;font-weight:800;color:#1A0402;text-decoration:none;border-radius:999px;">Je prends ma place</a>
        </td></tr></table>
      {{#if event.price_from}}<p style="margin:12px 0 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;color:#E9B79A;">{{event.price_from}}</p>{{/if}}
    {{/if}}
  </td></tr>
</table>`;

/** Référence compacte des balises (le kit la rend telle quelle). */
export function smartTagReference(): { tag: string; type: string; description: string }[] {
  return SMART_TAGS.map((t) => ({ tag: `{{${t.tag}}}`, type: t.kind, description: t.desc }));
}

/** La ressource yuno://guide/email-design (markdown). */
export function emailDesignGuideMarkdown(): string {
  return [
    '# Designing Yuno emails',
    '',
    '## Email HTML rules',
    ...EMAIL_HTML_RULES.map((r) => `- ${r}`),
    '',
    '## Design method (opens and sales)',
    ...EMAIL_DESIGN_METHOD.map((r) => `- ${r}`),
    '',
    '## Yuno tags',
    'Handlebars syntax: {{value}}, {{#if x}}…{{else}}…{{/if}}, {{#unless x}}…{{/unless}}, {{#each list}}…{{/each}} with {{@first}} / {{@last}}. Every value is escaped; there is no {{{raw}}}. Values are read again when the email leaves (prices, sold out, line-up, tables left, countdown).',
    ...SMART_TAGS.map((t) => `- \`{{${t.tag}}}\` (${t.kind}): ${t.desc}`),
    '',
    '## Example section',
    '```html',
    EXAMPLE_SECTION,
    '```',
  ].join('\n');
}
