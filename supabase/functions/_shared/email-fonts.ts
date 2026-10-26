// Polices web des e-mails : une liste fermée de familles Google Fonts que
// l'IA du pro (ou le Studio) peut poser sur un e-mail (`theme.fonts`).
//
// Apple Mail, l'app Mail d'iOS, Outlook pour Mac et Samsung Mail chargent la
// police ; Gmail et Outlook Windows retombent sur la police de secours
// (`stack`). Chaque famille a SA balise <link> : une adresse refusée par
// Google ne fait tomber qu'elle. Outlook Windows ne voit aucune balise (il
// afficherait Times New Roman au lieu de la police de secours).
//
// Pur : lu par le rendu du Studio (render.ts), son port Deno
// (email-studio-html.ts), l'aperçu d'une section (HtmlView) et le MCP.

export type EmailFontCategory = 'sans' | 'display' | 'condensed' | 'serif' | 'slab' | 'mono' | 'script' | 'rounded';

export interface EmailFont {
  family: string;
  category: EmailFontCategory;
  /** Axes demandés à l'API css2 de Google Fonts (vérifiés un par un). */
  axes: string;
  /** Graisses disponibles (pour l'IA : ne jamais demander une graisse absente). */
  weights: string;
  /** Pile complète à écrire dans font-family. */
  stack: string;
  /** À quoi elle sert (aide au choix). */
  mood: string;
}

// Guillemets simples partout : la pile s'écrit dans un attribut style="…".
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const NARROW = "'Arial Narrow','Helvetica Neue',Arial,sans-serif";
const IMPACT = "Impact,'Arial Black','Helvetica Neue',Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";
const MONO = "'Courier New',Courier,monospace";
const ROUND = "'Trebuchet MS','Helvetica Neue',Arial,sans-serif";

const f = (family: string, category: EmailFontCategory, axes: string, weights: string, fallback: string, mood: string): EmailFont =>
  ({ family, category, axes, weights, stack: `'${family}',${fallback}`, mood });

export const EMAIL_FONTS: readonly EmailFont[] = [
  // Sans de texte et de titre
  f('Inter', 'sans', 'ital,wght@0,100..900;1,100..900', '100-900, italic', SANS, 'neutral modern UI, tech, clean product emails'),
  f('DM Sans', 'sans', 'ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000', '100-1000, italic', SANS, 'friendly geometric, soft and modern'),
  f('Rubik', 'rounded', 'ital,wght@0,300..900;1,300..900', '300-900, italic', ROUND, 'slightly rounded, warm, food and lifestyle, playful but solid'),
  f('Open Sans', 'sans', 'ital,wght@0,300..800;1,300..800', '300-800, italic', SANS, 'humanist, very common product and newsletter body'),
  f('Roboto', 'sans', 'ital,wght@0,100..900;1,100..900', '100-900, italic', SANS, 'neutral Android-like sans'),
  f('Lato', 'sans', 'ital,wght@0,300;0,400;0,700;0,900;1,400;1,700', '300, 400, 700, 900, italic', SANS, 'warm classic sans, newsletters'),
  f('Nunito', 'rounded', 'ital,wght@0,200..1000;1,200..1000', '200-1000, italic', ROUND, 'rounded friendly sans'),
  f('Raleway', 'sans', 'ital,wght@0,100..900;1,100..900', '100-900, italic', SANS, 'elegant thin-to-black sans, fashion'),
  f('Manrope', 'sans', 'wght@200..800', '200-800', SANS, 'calm premium sans'),
  f('Plus Jakarta Sans', 'sans', 'ital,wght@0,200..800;1,200..800', '200-800, italic', SANS, 'polished startup sans'),
  f('Figtree', 'sans', 'ital,wght@0,300..900;1,300..900', '300-900, italic', SANS, 'clean friendly sans, close to platform brand fonts'),
  f('Montserrat', 'sans', 'ital,wght@0,100..900;1,100..900', '100-900, italic', SANS, 'wide geometric, uppercase titles, classic nightlife flyer'),
  f('Poppins', 'sans', 'ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,700', '300-900, italic 400/700', SANS, 'round geometric, bold friendly titles'),
  f('Work Sans', 'sans', 'ital,wght@0,100..900;1,100..900', '100-900, italic', SANS, 'neutral grotesk, editorial body'),
  f('Outfit', 'sans', 'wght@100..900', '100-900', SANS, 'geometric display sans'),
  f('Sora', 'sans', 'wght@100..800', '100-800', SANS, 'futuristic geometric'),
  f('Urbanist', 'sans', 'ital,wght@0,100..900;1,100..900', '100-900, italic', SANS, 'modern geometric, fashion'),
  f('Instrument Sans', 'sans', 'ital,wght@0,400..700;1,400..700', '400-700, italic', SANS, 'refined grotesk, minimal luxury'),
  f('Albert Sans', 'sans', 'ital,wght@0,100..900;1,100..900', '100-900, italic', SANS, 'scandinavian grotesk, furniture, design'),
  f('Schibsted Grotesk', 'sans', 'ital,wght@0,400..900;1,400..900', '400-900, italic', SANS, 'news grotesk, strong titles'),
  f('Space Grotesk', 'sans', 'wght@300..700', '300-700', SANS, 'quirky grotesk, techno, underground'),
  f('Bricolage Grotesque', 'display', 'opsz,wght@12..96,200..800', '200-800', SANS, 'expressive grotesk with character, creative brands'),
  f('Unbounded', 'display', 'wght@200..900', '200-900', SANS, 'wide rounded display, rave, electronic'),
  f('Syne', 'display', 'wght@400..800', '400-800', SANS, 'art-school display, galleries, avant-garde'),
  f('Archivo', 'sans', 'ital,wdth,wght@0,62..125,100..900;1,62..125,100..900', '100-900, italic, width 62-125% (font-stretch)', SANS, 'grotesk with heavy weights, posters; font-stretch:62% to 125% makes it condensed or extended'),
  f('Archivo Black', 'display', 'wght@400', '400 (already black)', IMPACT, 'heavy grotesk headlines'),
  // Condensées, affiches
  f('Anton', 'condensed', 'wght@400', '400 (already heavy)', IMPACT, 'tall heavy condensed poster headline'),
  f('Bebas Neue', 'condensed', 'wght@400', '400 (bold caps only)', IMPACT, 'all-caps condensed poster, events, sport'),
  f('Oswald', 'condensed', 'wght@200..700', '200-700', NARROW, 'condensed gothic, flyers, labels'),
  f('Barlow Condensed', 'condensed', 'ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,500;1,700;1,800', '300-900, italic 500/700/800', NARROW, 'condensed grotesk, sporty, festival line-ups'),
  f('Big Shoulders Display', 'condensed', 'wght@100..900', '100-900', NARROW, 'industrial condensed, Chicago, techno'),
  f('Archivo Narrow', 'condensed', 'ital,wght@0,400..700;1,400..700', '400-700, italic', NARROW, 'narrow grotesk for dense info'),
  f('Saira Condensed', 'condensed', 'wght@100;200;300;400;500;600;700;800;900', '100-900', NARROW, 'techy condensed'),
  f('Teko', 'condensed', 'wght@300..700', '300-700', NARROW, 'squared condensed, electronic'),
  // Ludiques, arrondies, très grasses
  f('Fredoka', 'rounded', 'wght@300..700', '300-700', ROUND, 'bubbly rounded, playful, candy, kids'),
  f('Baloo 2', 'rounded', 'wght@400..800', '400-800', ROUND, 'chunky rounded, fun brands'),
  f('Lilita One', 'rounded', 'wght@400', '400 (already heavy)', IMPACT, 'heavy rounded poster, playful headlines'),
  f('Titan One', 'rounded', 'wght@400', '400 (already heavy)', IMPACT, 'fat rounded display, retro candy'),
  f('Bowlby One', 'display', 'wght@400', '400 (already heavy)', IMPACT, 'ultra heavy, loud retro'),
  f('Bungee', 'display', 'wght@400', '400', IMPACT, 'signage caps, urban, arcade'),
  f('Rubik Mono One', 'display', 'wght@400', '400', IMPACT, 'wide mono caps, street, rave'),
  f('Dela Gothic One', 'display', 'wght@400', '400', IMPACT, 'very heavy wide caps, impact'),
  f('Righteous', 'display', 'wght@400', '400', SANS, '70s retro display'),
  f('Shrikhand', 'display', 'wght@400', '400 (italic look)', IMPACT, 'groovy 70s italic display'),
  // Serif, éditorial
  f('Playfair Display', 'serif', 'ital,wght@0,400..900;1,400..900', '400-900, italic', SERIF, 'high-contrast editorial, luxury, magazine'),
  f('DM Serif Display', 'serif', 'ital@0;1', '400, italic', SERIF, 'elegant display serif, titles'),
  f('Instrument Serif', 'serif', 'ital@0;1', '400, italic', SERIF, 'thin fashion serif, minimal luxury'),
  f('Fraunces', 'serif', 'ital,opsz,wght@0,9..144,100..900;1,9..144,100..900', '100-900, italic', SERIF, 'soft wonky serif, warm editorial'),
  f('Bodoni Moda', 'serif', 'ital,opsz,wght@0,6..96,400..900;1,6..96,400..900', '400-900, italic', SERIF, 'fashion didone, couture'),
  f('Cormorant Garamond', 'serif', 'ital,wght@0,300..700;1,300..700', '300-700, italic', SERIF, 'refined classical serif'),
  f('EB Garamond', 'serif', 'ital,wght@0,400..800;1,400..800', '400-800, italic', SERIF, 'book serif, literary body'),
  f('Libre Baskerville', 'serif', 'ital,wght@0,400;0,700;1,400', '400, 700, italic 400', SERIF, 'classic newspaper body serif'),
  f('Newsreader', 'serif', 'ital,opsz,wght@0,6..72,200..800;1,6..72,200..800', '200-800, italic', SERIF, 'magazine body serif'),
  f('Abril Fatface', 'serif', 'wght@400', '400 (already fat)', SERIF, 'fat didone headlines, magazine covers'),
  f('Roboto Serif', 'serif', 'ital,opsz,wdth,wght@0,8..144,50..150,100..900;1,8..144,50..150,100..900', '100-900, italic, width 50-150% (font-stretch)', SERIF, 'versatile serif; with font-stretch:55% and weight 900 it becomes a heavy condensed magazine headline'),
  f('Ultra', 'slab', 'wght@400', '400 (already black)', SERIF, 'black slab headlines, loud editorial'),
  f('Alfa Slab One', 'slab', 'wght@400', '400 (already heavy)', SERIF, 'heavy slab, western, posters'),
  f('Young Serif', 'serif', 'wght@400', '400', SERIF, 'soft old-style serif titles'),
  f('Gloock', 'serif', 'wght@400', '400', SERIF, 'high-contrast black serif titles'),
  f('Italiana', 'serif', 'wght@400', '400 (thin)', SERIF, 'thin elegant caps, perfume, gala'),
  // Mono
  f('Space Mono', 'mono', 'ital,wght@0,400;0,700;1,400;1,700', '400, 700, italic', MONO, 'retro mono, labels, techno'),
  f('IBM Plex Mono', 'mono', 'ital,wght@0,300;0,400;0,500;0,600;0,700;1,400', '300-700, italic 400', MONO, 'clean typewriter mono, editorial labels'),
  f('JetBrains Mono', 'mono', 'ital,wght@0,100..800;1,100..800', '100-800, italic', MONO, 'modern mono'),
  f('DM Mono', 'mono', 'ital,wght@0,300;0,400;0,500;1,400', '300-500, italic 400', MONO, 'light mono, minimal'),
  f('Courier Prime', 'mono', 'ital,wght@0,400;0,700;1,400;1,700', '400, 700, italic', MONO, 'typewriter'),
  // Script
  f('Pacifico', 'script', 'wght@400', '400', 'cursive', 'surf retro script'),
  f('Caveat', 'script', 'wght@400..700', '400-700', 'cursive', 'handwritten notes'),
  f('Dancing Script', 'script', 'wght@400..700', '400-700', 'cursive', 'romantic script'),
  f('Permanent Marker', 'script', 'wght@400', '400', 'cursive', 'marker, street, DIY'),
  f('Great Vibes', 'script', 'wght@400', '400', 'cursive', 'formal calligraphy, gala'),
  f('Yellowtail', 'script', 'wght@400', '400', 'cursive', '50s signage script'),
];

const BY_NAME = new Map(EMAIL_FONTS.map((x) => [x.family.toLowerCase(), x]));

/** La police de la liste (insensible à la casse), sinon null. */
export function emailFont(name: unknown): EmailFont | null {
  return typeof name === 'string' ? BY_NAME.get(name.trim().toLowerCase()) ?? null : null;
}

/** Familles valides d'un thème, sans doublon, 3 au plus. */
export function cleanEmailFonts(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const v of list) {
    const font = emailFont(v);
    if (font && !out.includes(font.family)) out.push(font.family);
    if (out.length >= 3) break;
  }
  return out;
}

export function emailFontHref(font: EmailFont): string {
  return `https://fonts.googleapis.com/css2?family=${font.family.replace(/ /g, '+')}:${font.axes}&display=swap`;
}

/**
 * Balises <link> du <head> de l'e-mail. Masquées à Outlook Windows (sinon il
 * remplace toute la pile par Times New Roman).
 */
export function emailFontLinks(list: unknown): string {
  const fonts = cleanEmailFonts(list).map((n) => emailFont(n)!);
  if (!fonts.length) return '';
  const links = fonts.map((x) => `<link href="${emailFontHref(x).replace(/&/g, '&amp;')}" rel="stylesheet" type="text/css">`).join('\n');
  return `<!--[if !mso]><!-->\n${links}\n<!--<![endif]-->`;
}

/**
 * Pile du pied de page légal : la police choisie (`footerFont`) si elle fait
 * partie des polices de l'e-mail, sinon `fallback`. Lu par render.ts et son
 * port Deno.
 */
export function footerFontStack(theme: { fonts?: unknown; footerFont?: unknown }, fallback: string): string {
  const font = emailFont(theme.footerFont);
  return font && cleanEmailFonts(theme.fonts).includes(font.family) ? font.stack : fallback;
}
