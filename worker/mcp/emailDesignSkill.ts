// Le skill de design d'e-mail que le MCP Yuno donne à l'IA du pro : comment
// dessiner un e-mail qui a de l'allure (et pas un gabarit générique), comment
// reproduire fidèlement une inspiration, et une bibliothèque de composants
// HTML éprouvés dans toutes les boîtes de réception.
//
// Mis au point sur un banc : dix e-mails de marque reproduits section par
// section par le vrai moteur de rendu Yuno, comparés à leur capture, et le
// skill corrigé à chaque écart (octobre 2026).
//
// Des FAITS de métier et des recettes, pas des ordres au modèle : les
// consignes de conduite vivent dans INSTRUCTIONS (guide.ts).

import { EMAIL_FONTS } from '../../supabase/functions/_shared/email-fonts';
import { SHAPE_KINDS } from '../emailShape';

/** Les polices de la liste fermée, groupées par usage (rendu dans le skill). */
export function fontCatalog(): string {
  const groups: Record<string, string[]> = {};
  for (const f of EMAIL_FONTS) {
    (groups[f.category] ||= []).push(`${f.family} (${f.weights}): ${f.mood}`);
  }
  const order = ['sans', 'display', 'condensed', 'rounded', 'serif', 'slab', 'mono', 'script'];
  return order.filter((k) => groups[k]).map((k) => `- ${k}: ${groups[k].join('; ')}`).join('\n');
}

const SKILL = String.raw`# Yuno email design skill

You design emails that look made by a good studio, not by a template. Everything here works in Apple Mail, iOS Mail, Gmail and Outlook, and survives the Yuno cleaning.

## 1. Read the request literally

- "Like this", "copy this", "same style as" + an image or a link: REPRODUCE it. Same structure, same order of bands, same proportions, same palette, same fonts (nearest family in the list), same shapes, same button style, same spacing. Only the words and the photos change to the night's (unless the person asks for the exact words). Do not "improve", re-theme or simplify it: a faithful copy is the job.
- "In my colors / my brand": keep the layout, swap the palette for the brand's (logo, poster, recent emails).
- No inspiration: pick ONE concept from section 7 that suits the night and the brand, and commit to it.
- Never mix two concepts, never add blocks the person did not ask for, never drop a block the inspiration has.

## 2. Reproducing an inspiration: the protocol

Do these steps in order, in your head or in writing, before any HTML.

1. SCALE. The email column is 600 px. Measure the width of the inspiration's email column on the image (not the page around it): scale = 600 / that width. When the page and the column share a color (often a dark email), the column is usually the full screenshot width: cards that stop 15 to 25 px short of each side are INSET cards inside the column, not its edges. Check with the full-width elements (rules, color bands, footer), which run edge to edge. Every size you read on the image (text height, padding, image height, radius) is multiplied by the scale.
2. INVENTORY. List the bands from top to bottom, including the GAPS of page color between floating bands or cards (a 24 px gap is a band too: a section in the page color, or padding-top on a page-colored wrapper). A band is a horizontal stripe with one background (color, photo, gradient). For each: background color, height in px (scaled), what is inside (logo, headline, text, button, image, grid, shape), alignment, inner side padding.
3. PALETTE. Write the exact hex of: page background (around the column), each band background, headline color, body text color, accent/button color, button text color, borders and lines. Sample carefully: a cream is not white, a dark green is not black, a "black" background is often #0B0B0B to #141414.
4. TYPE. For each text style (logo wordmark, kicker, headline, subtitle, body, button, small print): family from the font list (nearest look: geometric, grotesk, condensed, rounded, serif, slab, mono, script), weight, size, line-height, letter-spacing, case, color, italic. Put up to 3 families in theme.fonts and write their full stack in every font-family.
   - SIZE FROM WIDTHS, not from letter height (letters on a screenshot always look smaller than they are). Pick the longest line of a paragraph or a headline word, measure its width W in px (×scale), count its characters N: font-size ≈ W ÷ (N × k). k for normal mixed-case text: 0.45 for Arial / Helvetica regular and 0.50 bold, 0.44 for most other sans (Inter, Open Sans, Figtree, Rubik, DM Sans, Albert Sans), 0.47 for wide geometric (Montserrat, Poppins), 0.36 for condensed (Oswald, Barlow Condensed), 0.31 for Anton / Bebas Neue, 0.42 for serif, 0.60 for mono; ALL CAPS: multiply k by 1.4, and add the letter-spacing (N × spacing) to the width. Then CHECK with the line breaks: your size is right when the same words end each line. Marketing body text is often 15 to 21 px and hero headlines 60 to 110 px: bigger than you think.
   - Line-height from the distance between two baselines × scale (an exact px value, e.g. line-height:26px). Measure it, never take a typical range: tight display headlines often go down to 0.75 to 0.85 of the font size.
   - Weight from the stroke: the thickness of a vertical stroke is about 1/12 of the font size at weight 300, 1/9 at 400, 1/7 at 600, 1/5 at 900. Light display headlines (300) are common in modern brands; do not default to bold.
   - Colors of text: a body text on a dark band is rarely pure white (often a cream or a grey); on cream it is often the brand color at lighter shade.
5. IMAGES. Classify each picture: (a) a photo or an illustration → an <img> (the poster {{event.cover}}, a line-up photo, or an image stored with add_email_image); words that belong to an illustration or a logo lockup (tabs drawn in an illustration, a script logo in a badge) stay in the image; (b) text that only looks like an image (a headline, a price, a label set in plain type) → rebuild it in HTML; (c) a decoration (wave, scallop, zigzag, checker strip, stripes, dots, slanted or curved edge, arch) → a shape image (section 6) or table cells. Note each image's ratio, radius, border (width + color) and whether it is full-bleed or inset (side margins).
6. BUILD. One section per band (3 to 12 sections). Copy the measured numbers into the HTML. Use the components of section 8.
7. CHECK. Compare band by band: same order, same heights within ~10 %, same colors, same alignment, same type weight and case, same button shape. Fix before saving.

## 3. The canvas

- The email is a 600 px column ("card", theme.card) on a page background (theme.background). The column has rounded corners (theme.radius, 0 for a square editorial look) and page space above and below it (theme.page_padding, 0 to 64, default 24: measure it on the inspiration × scale).
- Sections are stacked bands with no gap between them. A section that does not set its own background shows theme.card. Give every band its explicit background (bgcolor + background-color) so the colors never depend on the theme.
- Full-bleed band: the section's table carries the color, the content has inner padding (usually 32 to 48 px each side, 16 px on mobile with class yn-pad-sm).
- Inset card: a band in the page color containing a rounded table (border-radius on the cell, border-collapse:separate) with its own color. Use it when the inspiration shows cards floating on a background.
- When the inspiration's column touches the page with no visible card (the bands themselves are the email), set theme.card to the first band's color and theme.radius to 0.
- The legal footer (sender, reason, unsubscribe, Powered by Yuno) is added by Yuno below the sections: never write one. Dress it like the inspiration's footer band: theme.footer_background, theme.footer_text, theme.footer_font (one of theme.fonts), theme.footer_social (social icons above it), theme.footer_social_style ("plain" = bare icons like most brand emails, "chip" = round chips), theme.footer_divider (false removes the line above it, true forces it). Social links sit there already: do not add a second row of social icons unless the inspiration has them in the body. A rule drawn by the inspiration just above its footer belongs in your last section.
- Lines of the inspiration that belong to its own footer or envelope ("View online", "Can't see this email?", unsubscribe, address, app store links, legal notes) are dropped: Yuno writes its own. A "Can't see this email?" line at the very top may be kept as small text if it is part of the look, with a link to {{event.url}}.
- Social networks of the footer: instagram, tiktok, facebook, x, website (no YouTube, Pinterest or Snapchat). The footer is always centred; text links of the brand (FAQ, Press) go in the last section if they matter.
- What the footer cannot change: its order (social icons first, then the sender line, reason, copyright, unsubscribe, Powered by Yuno) and the icon color (bare icons are black on a light footer, white on a dark one; chips take theme.muted). If the inspiration's footer differs, match its background, font and text color and leave the rest.
- A dark email whose bands fill the whole page: theme.background = theme.card = the dark color, radius 0, page_padding 0.

## 4. HTML facts that decide the result

- A cell's width attribute is its CONTENT width: padding is added to it. A 235 px column with 25 px of left padding is width="210" + padding-left:25px.
- A cell's height (attribute or CSS) is also added to its vertical padding. On a background-photo cell, put the height on the cell and NO padding; put the overlay content in an inner table that carries the padding.
- Inside style="…" write font names with single quotes: font-family:'Open Sans','Helvetica Neue',Arial,sans-serif. A double quote ends the attribute and breaks the whole style.
- Images are display:block (no gap under them), their width attribute is the displayed width, and a cell around them carries the margins.
- Spacing between blocks: padding on cells (padding-top of the next block), not margins on tables. Margins on <p> and <h1> are fine (always set them, browsers add defaults).
- Every text element sets its font-family, size, line-height (px), weight and color: nothing is inherited reliably.
- A button or a pill of a measured width: display:block;width:Npx on the <a> (N = measured width minus the border), padding top/bottom = (height − line-height − 2 × border) ÷ 2, text-align:center. Two pills side by side keep their own widths.
- A colored frame around an image: the border goes on a table with border-collapse:separate around the image (a border on a <td> of a collapsed table can merge with its neighbours), or directly on the <img> (border:3px solid #HEX).
- A card whose gradient must melt into an image inside it: sample the image's top edge (center and sides) and end the gradient on those exact colors (a horizontal gradient side→center→side over a vertical white fade), with no gap between the text cells and the image.
- Logos and badges with transparency stay PNG; photos JPG.
- Gradient that melts into a photo: <td bgcolor="#C8B9FC" style="background-color:#C8B9FC;background-image:radial-gradient(ellipse at 50% 0%,rgba(255,255,255,.6) 0%,rgba(255,255,255,0) 70%),linear-gradient(90deg,#B4A1FB 0%,#C8B9FC 50%,#B4A1FB 100%);"> above the photo, whose top edge has exactly those side and center colors.

## 5. Typography

Web fonts load in Apple Mail, iOS Mail, Outlook for Mac and Samsung Mail (most nightlife opens); Gmail and Outlook Windows show the fallback of the stack. List the families in theme.fonts (3 at most) and write the full stack every time, for example font-family:'Rubik','Trebuchet MS',Arial,sans-serif. Only families from this list exist:

{{FONTS}}

Look-alikes when the inspiration uses a commercial font: Graphik / Circular / Avenir → Figtree or Albert Sans; Helvetica / Arial / SF → Inter (or Arial itself, no web font needed); Canva Sans → Figtree; GT Super / Tiempos → Fraunces or Newsreader; Cheltenham / NYMag condensed serif → Roboto Serif with font-weight:900;font-stretch:55% to 62%; Druk / Knockout → Anton or Archivo with font-stretch:62%; Futura → Outfit; Cooper / Recoleta → Fraunces 600; a typewriter-like mono → 'Courier New' (no web font); a clean mono → IBM Plex Mono or Space Mono. Variable widths (font-stretch) work only on Archivo and Roboto Serif in this list.
Fake bold text never helps: if the inspiration is lighter than your render, drop one weight step (700 → 600 → 500).

Scale that looks designed (at 600 px): hero headline 40 to 72 px (line-height 0.95 to 1.05, letter-spacing -1 to -2 px for heavy sans, +1 to +3 px for wide caps); section title 24 to 34 px; subtitle 18 to 22 px; body 15 to 17 px with line-height 1.45 to 1.6; kicker/label 11 to 13 px uppercase letter-spacing 2 to 3 px; button 14 to 18 px. Use one display family + one text family, plus a mono for labels at most. When there is no inspiration, weight contrast (a heavy headline over a regular body) does more than size; with an inspiration, copy its measured weights. text-shadow works in Apple Mail (offset color shadow: text-shadow:3px 3px 0 #F4A582) and is ignored elsewhere, so the headline must read without it.

## 6. Shapes (waves, scallops, edges, strips)

SVG and CSS shapes are removed or ignored by mail clients. Yuno draws shapes as PNG on demand, at double resolution, cached forever:

https://yunoapp.eu/email-shape/<kind>.png?top=<hex>&bottom=<hex>&w=600&h=<px>&n=<count>

kinds: {{SHAPES}}.
- top / bottom: the color above and below the edge (hex without #, or none = transparent). wave, scallop, zigzag, arch, curve, slant, torn draw an edge between the two colors.
- fill + thick: a RIBBON, a band of the fill color between two parallel edges (thick = its share of the height, 0.05 to 0.9). Example: the colored wavy ribbon that crosses the top of a photo: wave.png?top=FAE7C3&fill=F9A67E&bottom=none&h=64&n=1.3&thick=0.6. checker, stripes and dots draw a pattern with colors=hex,hex,… (2 to 8, cycling).
- w, h: displayed size in px (w = the band width, usually 600). n: waves, bumps, teeth, squares or stripes across the width. amp (0.1 to 1): how much of the height the edge uses. flip=1 mirrors, invert=1 turns it upside down, phase (0 to 1) shifts a wave, rows (checker), seed (torn).
- Place it as a full-width image between two bands: <img src="…" width="600" height="40" alt="" style="display:block;width:100%;height:auto;border:0;">. Its top color = the band above, its bottom color = the band below, so the two bands meet on a wave.
- n can be decimal (1.3 waves look hand-drawn; 2 to 3 for a gentle wave between two bands, h 20 to 30). phase shifts it: use different phases for two waves of the same email.
- A photo with wavy ribbons over its top and bottom edges (the classic food/lifestyle hero): the photo as the cell background (section 8.9), a ribbon at the top (top=band above, fill=ribbon, bottom=none), a spacer row of the photo height, a ribbon at the bottom (top=none, fill=ribbon, bottom=band below).
- A checker or stripe border: checker with h = square size and n = 600 / h, colors=the two to four colors. stroke=hex&sw=1.5 outlines each square (the illustrated, hand-drawn look).
- A bright light streak along a slanted edge (sports, tech, gaming): slant with fill = a pale tint of the band color and thick=0.07 (a thin bright line between the two bands).
Use shapes when the inspiration has them, or for a playful/festive concept; never as filler on a minimal design.

## 7. Concepts that work (pick one when there is no inspiration)

- POSTER: dark band, the poster big (full-bleed or inset with radius 16 to 24), a massive condensed or heavy headline (Anton, Bebas Neue, Archivo Black, Big Shoulders Display), date and venue in mono caps, one loud pill button. Best for a line-up announcement.
- EDITORIAL: off-white or cream column (#F4F1EA, #FBF7F0), serif display headline (Playfair Display, Instrument Serif, DM Serif Display, Fraunces), small mono or grotesk labels, thin rules, black rectangular buttons, black and white photos. Best for a concept night, a gala, a VIP invitation.
- COLOR BLOCKS: a stack of full-bleed bands in 3 to 5 saturated colors, each with one idea (a tier, an artist, a perk), heavy serif or rounded titles, outlined pill buttons. Best for a recap, several dates, a list of perks.
- PLAYFUL: one bright background color (lime, orange, pink), rounded or groovy display font (Fredoka, Lilita One, Titan One, Shrikhand), thick dark outlines on buttons (border 3px on a separate table), checker or scallop strips, emoji-free. Best for a theme night, a birthday, students.
- MINIMAL DARK: #0B0B0B to #141414, grotesk headline (Inter, Manrope, Figtree), grey body #A1A1AA, one accent, white pill button, generous spacing, images with 16 to 24 px radius, mono labels. Best for techno and premium clubs.
- GRADIENT CARDS: black page, rounded cards (radius 24) with a vertical gradient (solid fallback color first), product or poster image inside the card, white pill buttons. Best for a VIP or an app-like look.
- GALLERY: dark page, labels in mono, a grid of photos (2 columns with a 1 px or 16 px gutter, a full-width image every few rows), big sans titles between grids. Best for a recap with photos.

## 8. Component library (copy, then set the measured values)

Every snippet is a complete section. Replace the CAPS placeholders. Keep cellpadding/cellspacing/border at 0 and the role="presentation".

8.1 Band with centered content
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#HEX" style="background-color:#HEX;"><tr><td align="center" class="yn-pad-sm" style="padding:40px 48px;">CONTENT</td></tr></table>

8.2 Logo (image) or wordmark (text)
<img src="LOGO_URL" width="140" alt="BRAND" style="display:block;width:140px;max-width:140px;height:auto;border:0;margin:0 auto;">
<p style="margin:0;font-family:STACK;font-size:28px;font-weight:700;letter-spacing:8px;color:#HEX;text-align:center;">BRAND</p>
A wordmark inside a frame: a table with style="border-collapse:separate;border:2px solid #HEX;border-radius:8px;" and padding on its cell.

8.3 Headline, kicker, body
<p style="margin:0 0 12px;font-family:MONO_STACK;font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#HEX;">KICKER</p>
<h1 style="margin:0;font-family:DISPLAY_STACK;font-size:56px;line-height:1;font-weight:800;letter-spacing:-1px;color:#HEX;">HEADLINE</h1>
<p style="margin:16px 0 0;font-family:TEXT_STACK;font-size:16px;line-height:1.55;color:#HEX;">BODY</p>
Bold words inside body: <strong style="font-weight:700;">…</strong>. Underlined inline link: <a href="URL" style="color:#HEX;text-decoration:underline;">…</a>. Italic tagline: font-style:italic.

8.4 Buttons (always a table; the <a> carries the padding so the whole button is clickable)
Solid pill:
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;"><tr><td bgcolor="#HEX" style="background-color:#HEX;border-radius:999px;"><a href="URL" style="display:inline-block;padding:16px 36px;font-family:STACK;font-size:16px;font-weight:700;line-height:1.2;color:#HEX;text-decoration:none;border-radius:999px;">LABEL</a></td></tr></table>
Rectangle: same with border-radius:0 to 6px. Full-width bar: add width="100%" on the table and display:block;text-align:center on the <a>.
Outline pill (also for a solid pill with a dark outline): <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;border-collapse:separate;border:2px solid #HEX;border-radius:999px;background-color:#FILL_OR_TRANSPARENT;"><tr><td style="border-radius:999px;"><a href="URL" style="display:inline-block;padding:12px 28px;…">LABEL</a></td></tr></table>
Two buttons side by side: one table, two cells with the buttons, a 12 px spacer cell between them.
Text link button: <a href="URL" style="font-family:MONO;font-size:13px;color:#HEX;text-decoration:underline;">Explore Sale →</a>
Button height: padding-top + padding-bottom + line-height ≈ the measured height.

8.5 Pill badge / label
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;"><tr><td bgcolor="#HEX" style="background-color:#HEX;border-radius:999px;padding:6px 16px;font-family:STACK;font-size:14px;font-weight:700;color:#HEX;">LABEL</td></tr></table>

8.6 Images
Full-bleed: <img src="URL" width="600" alt="WHAT IT SHOWS" style="display:block;width:100%;max-width:600px;height:auto;border:0;">
Inset with radius and border: <td style="padding:0 48px;"><img src="URL" width="504" alt="…" class="yn-full-sm" style="display:block;width:100%;max-width:504px;height:auto;border:1px solid #HEX;border-radius:20px;"></td>
An image never gets padding itself; the cell around it does. The width attribute = the displayed width at 600 px.

8.7 Two images side by side (gutter G)
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="yn-stack" width="50%" valign="top" style="padding-right:8px;"><img src="A" width="268" alt="…" style="display:block;width:100%;height:auto;border-radius:12px;"></td>
<td class="yn-stack" width="50%" valign="top" style="padding-left:8px;"><img src="B" width="268" alt="…" style="display:block;width:100%;height:auto;border-radius:12px;"></td>
</tr></table>
Grid of 2 × N: repeat the row with a spacer row (<tr><td colspan="2" style="height:16px;font-size:0;line-height:0;">&nbsp;</td></tr>). A tall image on one side and two stacked on the other: left cell holds a 2-row table, right cell the tall image.
Crop all images of a grid to the same ratio before storing them, or use the same width and let heights follow.

8.8 Media row (image left, text right) and alternating rows
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#HEX" style="background-color:#HEX;"><tr>
<td class="yn-stack" width="168" valign="top" style="padding:24px 0 24px 32px;"><img src="URL" width="168" alt="…" style="display:block;width:168px;max-width:100%;height:auto;border-radius:12px;"></td>
<td class="yn-stack" valign="top" style="padding:24px 32px 24px 24px;"><p style="margin:0 0 8px;font-family:…;font-size:18px;font-weight:700;color:#HEX;">TITLE</p><p style="margin:0;font-family:…;font-size:15px;line-height:1.5;color:#HEX;">TEXT</p></td>
</tr></table>
The image cell's width = the image width (its padding comes on top). Alternating backgrounds: one section per row, each with its own bgcolor. A number badge on the image: put the number in a small cell above or at the corner of the image cell (a 28 × 28 white cell with the number, font 13 px).

8.8b Banner with an image on each side (image | text | image)
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#HEX" style="background-color:#HEX;"><tr>
<td width="150" valign="bottom" style="font-size:0;line-height:0;"><img src="LEFT" width="150" alt="" style="display:block;width:150px;height:auto;border:0;"></td>
<td align="center" valign="middle" style="padding:20px 12px;">TITLE + BUTTON</td>
<td width="130" valign="bottom" style="font-size:0;line-height:0;"><img src="RIGHT" width="130" alt="" style="display:block;width:130px;height:auto;border:0;"></td>
</tr></table>
The side cells have no padding; when the whole banner is one illustration with drawn text, store it as one image instead.

8.9 Photo with text or shapes over it (background image)
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td background="PHOTO_URL" bgcolor="#FALLBACK" valign="bottom" height="420" style="background-color:#FALLBACK;background-image:url('PHOTO_URL');background-size:cover;background-position:center;height:420px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:0 24px 28px;">OVERLAY CONTENT</td></tr></table>
</td></tr></table>
The photo cell has no padding (its height would grow): the inner table carries it. For shaped edges, the inner content is: a shape image (bottom=none) at the top, a spacer row of the photo height, a shape image (top=none) at the bottom.
To show the photo at its natural ratio at the top of a taller cell (text below it on the photo's continued color): background-size:100% auto;background-position:center top;background-repeat:no-repeat, and bgcolor = the color of the photo's bottom edge.
Apple Mail and Gmail show the photo; Outlook Windows shows the fallback color, so the overlay text must read on that color too. Text over a photo needs a dark area or a gradient: add background-image:linear-gradient(rgba(0,0,0,0) 40%,rgba(0,0,0,.75)),url('PHOTO_URL').

8.10 Gradient card
<td bgcolor="#7C5CFC" style="background-color:#7C5CFC;background-image:linear-gradient(180deg,#B9A7FF 0%,#7C5CFC 100%);border-radius:24px;padding:36px 32px;">…</td>
The solid color is what Outlook shows: pick the middle of the gradient.

8.11 Rules, spacers and color bars
Rule: <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #HEX;font-size:0;line-height:0;height:1px;">&nbsp;</td></tr></table>
Spacer: <tr><td style="height:24px;font-size:0;line-height:0;">&nbsp;</td></tr>
Color bars (small squares in a row): a table with cells width="22" height="10" bgcolor="#HEX", 4 px spacer cells between them.

8.12 Two columns of small text (header info, footer-like columns)
Two cells width="50%" class="yn-stack" with mono 11 to 12 px text, line-height 1.4.

8.13 Live night blocks with Yuno tags
Tiers: {{#each tickets}}<tr><td style="padding:14px 0;border-bottom:1px solid #HEX;font-family:…;font-size:16px;color:#HEX;">{{name}}{{#if detail}}<br><span style="font-size:13px;color:#HEX;">{{detail}}</span>{{/if}}</td><td align="right" style="padding:14px 0;border-bottom:1px solid #HEX;font-family:…;font-size:16px;font-weight:700;color:#HEX;">{{#if sold_out}}<s>{{price}}</s>{{else}}{{price}}{{/if}}</td></tr>{{/each}}
Line-up: {{#each lineup}}…{{name}}…{{/each}}, photos only {{#if photo}}.
Countdown: {{countdown.days}} / {{countdown.hours}} / {{countdown.minutes}} in big cells.

## 9. Quality checklist (before create_email_draft)

- Every band of the inspiration is there, in order, with its color and height.
- Fonts: families from the list, in theme.fonts, full stack in each font-family.
- No fixed width above 320 px except images and the 600 px shapes (they carry width:100%). No padding on an element with width:100% (put it on the cell).
- Images: width attribute, display:block, height:auto, alt, border:0; full-bleed images are exactly 600 wide.
- Buttons: tables, padding on the <a>, the label fits on one line on a phone (short labels).
- Text contrast 4.5:1. For a free design: body ≥ 15 px (13 px for small print). For a reproduction: keep the measured sizes, even 12 to 13 px.
- No footer, no unsubscribe, no legal text: Yuno adds them. Theme footer colors set.
- Links: night links are Yuno tags; others https.
`;

/** Le skill complet (markdown), polices et formes à jour. */
export function emailDesignSkill(): string {
  return SKILL.replace('{{FONTS}}', fontCatalog()).replace('{{SHAPES}}', SHAPE_KINDS.join(', '));
}
