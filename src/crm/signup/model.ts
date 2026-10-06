/**
 * Pages d'inscription — le modèle partagé par la Console (assistant, fiche,
 * aperçus) et la page publique `/j/<slug>`. Port fidèle de `assets/yuno-pages.js`
 * du projet Claude Design « Pages inscription » : quatre types de page, dix
 * gabarits (palettes, police des titres, tokens de style), récompenses, champs.
 *
 * Tout est PUR (aucun React, aucun appel) : les textes passent par des clés
 * `yc.sp.*` (section de langue `crm`), les données réelles par les RPC
 * `crm_signup_*`. Le serveur valide les mêmes listes (migration
 * 20261007193500_crm_signup_pages_v2.sql) : une valeur ajoutée ici s'ajoute là-bas.
 */

// ── Icônes du design (tracés SVG 24×24, trait) ──────────────────────────────

export const SP_ICON = {
  ticket: 'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2ZM13 5v2M13 17v2M13 11v2',
  check: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v.01M14 20h.01M17 17v4M20 20h1',
  cal: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
  sms: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  send: 'm22 2-7 20-4-9-9-4ZM22 2 11 13',
  gift: 'M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z',
  pen: 'M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  lock: 'M7 11V7a5 5 0 0 1 10 0v4M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z',
  img: 'M21 15l-5-5L5 21M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  dl: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9z',
  pin: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
} as const;

export type SpIcon = keyof typeof SP_ICON;

// ── Les quatre types de page ────────────────────────────────────────────────

export const SIGNUP_KINDS = ['prevente', 'venue', 'attente', 'communaute'] as const;
export type SignupKind = (typeof SIGNUP_KINDS)[number];

export type CloseMode = 'sale' | 'eve' | 'manual' | 'never' | 'date';

export interface KindMeta {
  icon: SpIcon;
  /** La page parle d'une soirée précise. */
  night: boolean;
  /** Une vente existe (acheteurs mesurables). */
  sale: boolean;
  /** Fermetures proposées, dans l'ordre de l'assistant (la première = défaut). */
  closes: CloseMode[];
  /** Les étapes de relance proposées dans l'onglet Relance. */
  relance: RelanceStepId[];
}

export const KIND_META: Record<SignupKind, KindMeta> = {
  prevente: { icon: 'ticket', night: true, sale: true, closes: ['sale', 'date'], relance: ['open', 'nudge', 'last'] },
  venue: { icon: 'check', night: true, sale: false, closes: ['eve', 'date'], relance: ['open'] },
  attente: { icon: 'clock', night: true, sale: true, closes: ['manual', 'date'], relance: ['open', 'nudge', 'last'] },
  communaute: { icon: 'users', night: false, sale: true, closes: ['never', 'date'], relance: ['open'] },
};

// ── Gabarits ───────────────────────────────────────────────────────────────

export const TPL_IDS = ['soiree', 'affiche', 'brutal', 'edito', 'ticket', 'affichage', 'verre', 'epure', 'flyer', 'terminal'] as const;
export type TplId = (typeof TPL_IDS)[number];
export type Layout = 'top' | 'full' | 'brut' | 'edit' | 'ticket' | 'type' | 'glass' | 'clean' | 'flyer' | 'term';

export const FONT_IDS = ['brico', 'anton', 'serif', 'space', 'black', 'mono'] as const;
export type FontId = (typeof FONT_IDS)[number];

export interface FontDef { id: FontId; f: string; sc: number; w: number; ls: string }
/** La police des jetons d'une page : une des six du design, ou celle d'un design sur mesure (`custom`). */
export type TokenFont = Omit<FontDef, 'id'> & { id: FontId | 'custom' };

export const FONTS: readonly FontDef[] = [
  { id: 'brico', f: "'Bricolage Grotesque'", sc: 1, w: 600, ls: '-.035em' },
  { id: 'anton', f: "'Anton'", sc: 1.3, w: 400, ls: '.005em' },
  { id: 'serif', f: "'DM Serif Display'", sc: 1.08, w: 400, ls: '-.02em' },
  { id: 'space', f: "'Space Grotesk'", sc: 0.98, w: 700, ls: '-.04em' },
  { id: 'black', f: "'Archivo Black'", sc: 0.88, w: 400, ls: '-.03em' },
  { id: 'mono', f: "'Space Mono'", sc: 0.78, w: 700, ls: '-.04em' },
];

/** Polices des gabarits (Google Fonts) : chargées par la Console et la page publique. */
export const SIGNUP_FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Anton&family=Archivo+Black&family=DM+Serif+Display&family=Space+Grotesk:wght@500;700&family=Space+Mono:wght@400;700&family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap';

/** Une palette : fond, accent, second accent (dégradé du gabarit Soirée). `l` = clé de libellé. */
export interface Palette { id: string; l: string; bg: string; a: string; b?: string }

type Style = Partial<typeof DEFAULT_STYLE>;

export interface TplDef { id: TplId; lay: Layout; font: FontId; card?: string; pals: Palette[]; s: Style }

const pp = (arr: [string, string, string][]): Palette[] => arr.map((x, i) => ({ id: 'p' + i, l: x[0], bg: x[1], a: x[2] }));

/** Valeurs de style par défaut ; `{nom}` est remplacé par le token du même nom. */
export const DEFAULT_STYLE = {
  hs: 36, hup: 'none', hlh: 1.02, inH: 52, inRad: '14px', inBw: '1.5px', inBg: '{kSoft}', inBd: '{kLine}', chRad: '99px', chBw: '1.5px', chBd: '{kLine}',
  bH: 56, bRad: '99px', bBd: 'none', bSh: '0 10px 28px rgba({aRgb},.38),inset 0 1px 0 rgba(255,255,255,.35)', bTr: 'none', bUp: 'none', bFs: 16.5, bLs: '0',
  bFam: 'body', arrow: true, bMode: 'solid', bPre: '', bSuf: '', grad: false, lbF: 'body', lbS: 13.5, lbT: 'none', lbLs: '0', lbW: 600, lbPre: '',
  wBg: 'transparent', wBd: 'none', wRad: '0', wSh: 'none', wMx: '0', wPad: '14px 20px 22px', wBlur: 'none', wBt: 'none', wFlex: '1', bodyF: 'Geist', rootBg: '{bg}',
} as {
  hs: number; hup: string; hlh: number; inH: number; inRad: string; inBw: string; inBg: string; inBd: string; chRad: string; chBw: string; chBd: string;
  bH: number; bRad: string; bBd: string; bSh: string; bTr: string; bUp: string; bFs: number; bLs: string;
  bFam: 'body' | 'head' | 'mono'; arrow: boolean; bMode: 'solid' | 'outline'; bPre: string; bSuf: string; grad: boolean; lbF: 'body' | 'head' | 'mono'; lbS: number; lbT: string; lbLs: string; lbW: number; lbPre: string;
  wBg: string; wBd: string; wRad: string; wSh: string; wMx: string; wPad: string; wBlur: string; wBt: string; wFlex: string; bodyF: string; rootBg: string;
};

export const TPL: readonly TplDef[] = [
  { id: 'soiree', lay: 'top', font: 'brico',
    pals: [{ id: 'red', l: 'rouge_yuno', bg: '#120C0E', a: '#E3141B', b: '#FF6B35' }, { id: 'lime', l: 'acide', bg: '#120C0E', a: '#B8E62E', b: '#E2F76A' }, { id: 'ice', l: 'glace', bg: '#0C1114', a: '#4DB3FF', b: '#9BE0FF' }, { id: 'rose', l: 'rose', bg: '#140C10', a: '#FF4FA0', b: '#FF9AC8' }, { id: 'bone', l: 'os', bg: '#120C0E', a: '#F2EBDD', b: '#FFFFFF' }],
    s: { grad: true, rootBg: 'radial-gradient(120% 46% at 50% 0%,rgba({aRgb},.26),transparent 72%),{bg}' } },
  { id: 'affiche', lay: 'full', font: 'brico',
    pals: pp([['braise', '#0B0B0C', '#FF4A3D'], ['blanc', '#0B0B0C', '#F5F3EE'], ['violet', '#0E0B16', '#A98BFF'], ['menthe', '#0A100D', '#3DDC84'], ['or', '#100D08', '#F2B84B']]),
    s: { hs: 44, wBg: 'rgba({bgRgb},.8)', wBlur: 'blur(18px)', wRad: '28px 28px 0 0', wBd: '1px solid {line}', wPad: '22px 20px 22px' } },
  { id: 'brutal', lay: 'brut', font: 'black', card: '#FFFFFF',
    pals: pp([['beurre', '#FFE14D', '#FF4A1C'], ['bonbon', '#FF9ECF', '#2B2BFF'], ['menthe', '#B8F0C8', '#FF4A1C'], ['lilas', '#D9D4FF', '#111111'], ['papier', '#F4F0E6', '#3B5BFF']]),
    s: { hs: 40, hup: 'uppercase', hlh: 0.95, inH: 50, inRad: '10px', inBw: '2.5px', inBg: '#FFFFFF', inBd: '#1C1517', chRad: '8px', chBw: '2.5px', chBd: '#1C1517', bRad: '12px', bBd: '3px solid #1C1517', bSh: '4px 4px 0 #1C1517', bUp: 'uppercase', bFam: 'head', bFs: 16, arrow: false, lbF: 'mono', lbS: 12, lbT: 'uppercase', lbLs: '.04em', lbW: 700, wBg: '#FFFFFF', wBd: '3px solid #1C1517', wRad: '18px', wSh: '6px 6px 0 #1C1517', wMx: '6px 18px 0', wPad: '18px', wFlex: 'none' } },
  { id: 'edito', lay: 'edit', font: 'serif',
    pals: pp([['papier', '#F4EFE6', '#1C1517'], ['rouge', '#F6F1E7', '#C1272D'], ['encre', '#EEF0F2', '#1D3A8A'], ['nuit', '#14110F', '#E9DFC9'], ['sapin', '#EEF1E8', '#2F5D3A']]),
    s: { hs: 46, hlh: 0.96, inH: 46, inRad: '0', inBw: '0 0 1.5px', inBg: 'transparent', inBd: '{k}', chRad: '0', chBw: '1px', chBd: '{k}', bH: 52, bRad: '0', bUp: 'uppercase', bLs: '.14em', bFs: 13.5, arrow: false, bSh: 'none', lbT: 'uppercase', lbS: 11, lbLs: '.12em', lbW: 600, wSh: 'inset 0 1.5px 0 {ink}', wPad: '18px 22px 22px' } },
  { id: 'ticket', lay: 'ticket', font: 'space', card: '#FFFBF2',
    pals: pp([['orange', '#FF6B35', '#1C1517'], ['bleu', '#3B5BFF', '#FF6B35'], ['rose', '#FF8AC0', '#1C1517'], ['vert', '#1F8A5B', '#E3141B'], ['nuit', '#16121A', '#E3141B']]),
    s: { hs: 34, inRad: '8px', inBg: '#FFFFFF', chRad: '8px', bRad: '10px', bSh: 'none', bUp: 'uppercase', bLs: '.06em', bFs: 14.5, arrow: false, lbF: 'mono', lbS: 11, lbT: 'uppercase', lbLs: '.08em', wBg: '#FFFBF2', wRad: '0 0 18px 18px', wMx: '0 16px', wBt: '2px dashed rgba(28,21,23,.28)', wPad: '20px 18px 20px', wFlex: 'none' } },
  { id: 'affichage', lay: 'type', font: 'anton',
    pals: pp([['acide', '#0D0D0D', '#D4FF3A'], ['feu', '#0D0D0D', '#FF4A1C'], ['papier', '#F2F0EA', '#E3141B'], ['glace', '#101820', '#5EE6FF'], ['neon', '#1A1033', '#FF5CA8']]),
    s: { hs: 58, hup: 'uppercase', hlh: 0.88, inRad: '0', inBw: '2.5px', inBg: 'transparent', inBd: '{k}', chRad: '0', chBw: '2.5px', chBd: '{k}', bH: 60, bRad: '0', bUp: 'uppercase', bFam: 'head', bFs: 22, bLs: '.02em', arrow: false, bSh: '5px 5px 0 {ink}', lbT: 'uppercase', lbS: 12, lbLs: '.1em', lbW: 700, wPad: '20px 20px 22px' } },
  { id: 'verre', lay: 'glass', font: 'space',
    pals: pp([['violet', '#0F0B1A', '#9B7BFF'], ['lagon', '#0B1418', '#4DD6C1'], ['corail', '#1A0D0D', '#FF7A59'], ['azur', '#0D0D14', '#6FA8FF'], ['magenta', '#160B14', '#FF5CA8']]),
    s: { rootBg: 'radial-gradient(70% 38% at 12% 8%,rgba({aRgb},.5),transparent 70%),radial-gradient(60% 36% at 95% 55%,rgba({aRgb},.28),transparent 70%),{bg}', inBg: 'rgba({inkRgb},.09)', inBd: 'rgba({inkRgb},.2)', wBg: 'rgba({inkRgb},.07)', wBd: '1px solid rgba({inkRgb},.18)', wRad: '28px', wMx: '8px 16px 0', wPad: '20px', wBlur: 'blur(22px)', wFlex: 'none' } },
  { id: 'epure', lay: 'clean', font: 'brico',
    pals: pp([['encre', '#FFFFFF', '#111111'], ['terre', '#FAF7F2', '#C2410C'], ['ciel', '#F4F7FB', '#2563EB'], ['sauge', '#F6F9F4', '#15803D'], ['rose', '#FDF6F8', '#DB2777']]),
    s: { hs: 32, inRad: '99px', inBd: 'transparent', bH: 54, arrow: false, bSh: 'none', lbW: 500, lbS: 13, wPad: '22px 24px 22px' } },
  { id: 'flyer', lay: 'flyer', font: 'black', card: '#FFFFFF',
    pals: pp([['piment', '#FF5A36', '#FFE14D'], ['cobalt', '#2B4BFF', '#FFD43B'], ['soleil', '#FFD43B', '#E3141B'], ['jade', '#18B879', '#FFE14D'], ['barbe', '#F5A3C7', '#2B2BFF']]),
    s: { hs: 42, hup: 'uppercase', hlh: 0.96, rootBg: 'radial-gradient(rgba(28,21,23,.13) 1.3px,transparent 1.6px) 0 0/11px 11px,{bg}', inH: 50, inRad: '12px', inBw: '2.5px', inBg: '#FFFFFF', inBd: '#1C1517', chBw: '2.5px', chBd: '#1C1517', bH: 58, bBd: '3px solid #1C1517', bSh: '0 5px 0 #1C1517', bTr: 'rotate(-1.2deg)', bUp: 'uppercase', bFam: 'head', bFs: 17, arrow: false, lbW: 700, wBg: '#FFFFFF', wBd: '3px solid #1C1517', wRad: '24px', wSh: '0 6px 0 #1C1517', wMx: '6px 16px 0', wPad: '18px', wFlex: 'none' } },
  { id: 'terminal', lay: 'term', font: 'mono',
    pals: pp([['phosphore', '#0A0F0A', '#4ADE80'], ['ambre', '#0B0B0B', '#FFB000'], ['cyan', '#0A0D12', '#5EE6FF'], ['magenta', '#0D0A0D', '#FF4FA0'], ['papier', '#F4F4EF', '#111111']]),
    s: { rootBg: 'repeating-linear-gradient(0deg,rgba({inkRgb},.03) 0 1px,transparent 1px 3px),{bg}', bodyF: "'Space Mono'", hs: 30, hlh: 1.1, inH: 46, inRad: '0', inBw: '0 0 1px', inBg: 'transparent', inBd: 'rgba({aRgb},.6)', chRad: '0', chBw: '1px', chBd: 'rgba({aRgb},.5)', bMode: 'outline', bH: 52, bRad: '0', bBd: '1.5px solid {a}', bSh: 'none', bUp: 'uppercase', bFam: 'mono', bFs: 14, bPre: '[ ', bSuf: ' ]', arrow: false, lbF: 'mono', lbS: 12, lbPre: '> ', lbW: 400, wPad: '16px 16px 22px' } },
];

export function tplOf(id: string | null | undefined): TplDef {
  return TPL.find((t) => t.id === id) ?? TPL[0];
}

// ── Couleurs ───────────────────────────────────────────────────────────────

const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (h: unknown): h is string => typeof h === 'string' && HEX.test(h);

export function rgb3(h: string): [number, number, number] {
  let s = String(h || '#000').replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbs = (h: string) => rgb3(h).join(',');
export const rgba = (h: string, a: number) => `rgba(${rgbs(h)},${a})`;
export function lum(h: string): number {
  const c = rgb3(h).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
/** Texte lisible sur une couleur (clair sur foncé, encre sur clair). */
export const onC = (h: string) => (lum(h) > 0.2 ? '#1C1517' : '#FFFFFF');

/** Le style choisi pour une page : gabarit, palette (ou « custom » + fond / accent), police. */
export interface SignupDesign { tpl: TplId; pal: string; bg: string; acc: string; font: FontId | '' }

export const DEFAULT_DESIGN: SignupDesign = { tpl: 'soiree', pal: 'red', bg: '', acc: '', font: '' };

export function normalizeDesign(d: Partial<SignupDesign> | null | undefined): SignupDesign {
  const tpl = tplOf(d?.tpl).id;
  const pal = d?.pal === 'custom' ? 'custom' : (tplOf(tpl).pals.find((p) => p.id === d?.pal)?.id ?? tplOf(tpl).pals[0].id);
  return {
    tpl, pal,
    bg: isHex(d?.bg) ? d!.bg : '',
    acc: isHex(d?.acc) ? d!.acc : '',
    font: (FONT_IDS as readonly string[]).includes(d?.font ?? '') ? (d!.font as FontId) : '',
  };
}

export type ResolvedStyle = typeof DEFAULT_STYLE;

export interface Tokens {
  /** `custom` = design sur mesure (`custom.ts`, `customTokens`). */
  id: TplId | 'custom'; lay: Layout | 'custom'; dark: boolean; card: string; kDark: boolean; errC: string; F: TokenFont; s: ResolvedStyle;
  bg: string; bgRgb: string; ink: string; inkRgb: string; a: string; b: string; aRgb: string; aFg: string;
  k: string; kRgb: string; line: string; soft: string; kLine: string; kSoft: string; kM: string; inkM: string; inkF: string;
}

/** Les couleurs et le style résolus d'une page (fonction `tokens` du design, à l'identique). */
export function tokens(d: Partial<SignupDesign> | null | undefined): Tokens {
  const design = normalizeDesign(d);
  const T = tplOf(design.tpl);
  const Pl: Palette = design.pal === 'custom'
    ? { id: 'custom', l: 'custom', bg: design.bg || T.pals[0].bg, a: design.acc || T.pals[0].a }
    : (T.pals.find((x) => x.id === design.pal) ?? T.pals[0]);
  const bg = Pl.bg, a = Pl.a, b = Pl.b || a, dark = onC(bg) === '#FFFFFF', card = T.card || '';
  const ink = dark ? '#F7F2F1' : '#1C1517', k = card ? '#1C1517' : ink;
  const R = {
    bg, bgRgb: rgbs(bg), ink, inkRgb: rgbs(ink), a, b, aRgb: rgbs(a), aFg: onC(a), k, kRgb: rgbs(k),
    line: rgba(ink, 0.16), soft: rgba(ink, 0.07), kLine: rgba(k, 0.22), kSoft: rgba(k, 0.07), kM: rgba(k, 0.72), inkM: rgba(ink, 0.74), inkF: rgba(ink, 0.5),
  };
  const F = FONTS.find((f) => f.id === (design.font || T.font)) ?? FONTS[0];
  const raw: Record<string, unknown> = { ...DEFAULT_STYLE, ...T.s };
  const S: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    const v = raw[key];
    S[key] = typeof v === 'string' ? v.replace(/\{(\w+)\}/g, (m, n: string) => (n in R ? String(R[n as keyof typeof R]) : m)) : v;
  }
  const kDark = card ? false : dark;
  return { ...R, id: T.id, lay: T.lay, dark, card, kDark, errC: kDark ? '#FF948D' : '#C0261D', F, s: S as ResolvedStyle };
}

// ── Récompense ─────────────────────────────────────────────────────────────

export const REWARD_IDS = ['prio', 'drink', 'pre'] as const;
export type RewardPreset = (typeof REWARD_IDS)[number] | 'custom';
export const REWARD_ICONS = ['gift', 'ticket', 'bolt', 'users', 'clock'] as const;
export type RewardIcon = (typeof REWARD_ICONS)[number];
const PRESET_ICON: Record<(typeof REWARD_IDS)[number], RewardIcon> = { prio: 'ticket', drink: 'gift', pre: 'bolt' };

export interface SignupReward { on: boolean; preset: RewardPreset; label: string; how: string; icon: RewardIcon }

export function defaultReward(kind: SignupKind): SignupReward {
  return { on: kind === 'communaute', preset: 'drink', label: '', how: '', icon: 'gift' };
}

/**
 * Ce que la page montre de la récompense. `fan` est une CLÉ de texte pour une
 * récompense prédéfinie (`isKey`), le texte du pro pour la sienne.
 */
export function rewardOf(r: SignupReward | null | undefined): { fan: string; isKey: boolean; sub: string; icon: RewardIcon } {
  if (r?.preset === 'custom') return { fan: r.label, isKey: false, sub: r.how, icon: (REWARD_ICONS as readonly string[]).includes(r.icon) ? r.icon : 'gift' };
  const id = (REWARD_IDS as readonly string[]).includes(r?.preset ?? '') ? (r!.preset as (typeof REWARD_IDS)[number]) : 'drink';
  return { fan: `yc.sp.rw.${id}.fan`, isKey: true, sub: '', icon: PRESET_ICON[id] };
}

// ── Champs ─────────────────────────────────────────────────────────────────

export type ContactMode = 'both' | 'email' | 'phone' | 'all';
export const CONTACT_MODES: readonly ContactMode[] = ['both', 'email', 'phone', 'all'];
export const EXTRA_FIELDS = ['nom', 'naissance', 'insta', 'ville'] as const;
export type ExtraField = (typeof EXTRA_FIELDS)[number];
export const EXTRA_FIELD_INPUT: Record<ExtraField, { type: string; auto: string }> = {
  nom: { type: 'text', auto: 'family-name' },
  naissance: { type: 'date', auto: 'bday' },
  insta: { type: 'text', auto: 'off' },
  ville: { type: 'text', auto: 'address-level2' },
};

export interface SignupQuestion { label: string; options: string[]; multi: boolean; party?: boolean }
export interface SignupFields { contact: ContactMode; extra: Partial<Record<ExtraField, { on: boolean; req: boolean }>>; questions: SignupQuestion[] }

export function normalizeFields(f: Partial<SignupFields> | null | undefined): SignupFields {
  const contact = CONTACT_MODES.includes(f?.contact as ContactMode) ? (f!.contact as ContactMode) : 'both';
  const extra: SignupFields['extra'] = {};
  for (const id of EXTRA_FIELDS) {
    const v = f?.extra?.[id];
    if (v?.on) extra[id] = { on: true, req: !!v.req };
  }
  const questions = (Array.isArray(f?.questions) ? f!.questions : []).slice(0, 2).map((q) => ({
    label: String(q.label ?? ''), options: (Array.isArray(q.options) ? q.options : []).map(String).slice(0, 6), multi: !!q.multi, ...(q.party ? { party: true } : {}),
  }));
  return { contact, extra, questions };
}

/** Champs supplémentaires actifs, dans l'ordre d'affichage. */
export function activeExtras(f: SignupFields): { id: ExtraField; req: boolean }[] {
  return EXTRA_FIELDS.filter((id) => f.extra[id]?.on).map((id) => ({ id, req: !!f.extra[id]?.req }));
}

/** Réponses séparées par une virgule → liste (six au plus), comme l'assistant du design. */
export function parseOpts(raw: string): string[] {
  return String(raw || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 6);
}

/** Champs demandés sur la page (case d'accord exclue) : la jauge « 3 ou 4 champs suffisent ». */
export function fieldCount(f: SignupFields): number {
  return 1 + (f.contact === 'all' ? 2 : 1) + activeExtras(f).length + f.questions.length;
}

// ── Relance (messages après l'inscription) ─────────────────────────────────

export const RELANCE_STEPS = ['open', 'nudge', 'last'] as const;
export type RelanceStepId = (typeof RELANCE_STEPS)[number];
export const NUDGE_DELAYS = ['24h', '48h', '3d'] as const;
export const LAST_DELAYS = ['2d', '1d', '0d'] as const;

/**
 * Un message de relance. `msg` est le texte du pro (« {prénom} » = le prénom du
 * fan) ; `subject`, `head`, `btn` et `email` (blocs de l'Email Studio, rendus à
 * l'envoi) sont composés par la Console à l'enregistrement, dans la langue du pro.
 */
export interface RelanceStep {
  on: boolean; email: boolean; sms: boolean; delay?: string; msg: string;
  subject?: string; email_blocks?: unknown[]; email_theme?: unknown; cta_url?: string | null;
}
export type SignupRelance = Partial<Record<RelanceStepId, RelanceStep>>;

// ── Provenance ─────────────────────────────────────────────────────────────

/** Les endroits où placer la page (onglet Partager), dans l'ordre du design. `null` = lien général. */
export const PLACES = [
  { key: 'general', src: null, icon: 'link' },
  { key: 'story', src: 'story', icon: 'share' },
  { key: 'dm', src: 'dm', icon: 'send' },
  { key: 'flyer', src: 'flyer', icon: 'img' },
  { key: 'bar', src: 'bar', icon: 'qr' },
  { key: 'door', src: 'door', icon: 'pin' },
] as const satisfies readonly { key: string; src: string | null; icon: SpIcon }[];

export type SrcFamily = 'ig' | 'qr' | 'share' | 'direct';
/** Ordre des provenances dans « D'où viennent les inscrits ? » et leur famille. */
export const SRC_ORDER: readonly { src: string; fam: SrcFamily }[] = [
  { src: 'story', fam: 'ig' }, { src: 'dm', fam: 'ig' },
  { src: 'flyer', fam: 'qr' }, { src: 'bar', fam: 'qr' }, { src: 'door', fam: 'qr' },
  { src: 'share', fam: 'share' }, { src: 'direct', fam: 'direct' },
];
export function famOf(src: string | null | undefined): SrcFamily {
  return SRC_ORDER.find((x) => x.src === src)?.fam ?? 'direct';
}

// ── Utilitaires ────────────────────────────────────────────────────────────

/** « mar. 6 oct. · 18:00 » (fonction `dt` du design), dans la langue donnée. */
export function dt(iso: string | null | undefined, locale: string, tz?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', ...(tz ? { timeZone: tz } : {}) });
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false, ...(tz ? { timeZone: tz } : {}) });
  return `${day} · ${time}`;
}

/** `datetime-local` (heure de l'appareil) ⇄ ISO. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Initiales d'un nom (« Le Bunker » → « LB »). */
export const initials = (s: string) => s.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

/** Taille du titre selon sa longueur (le design réduit les titres longs). */
export function titleSize(hs: number, sc: number, len: number): number {
  const k = len > 24 ? 0.74 : len > 15 ? 0.88 : 1;
  return Math.round(hs * sc * k);
}

/** Compte à rebours jour / heure / minute / seconde (millisecondes restantes, jamais négatif). */
export function countdownParts(ms: number): [number, number, number, number] {
  const r = Math.max(0, ms);
  return [Math.floor(r / 864e5), Math.floor(r / 36e5) % 24, Math.floor(r / 6e4) % 60, Math.floor(r / 1e3) % 60];
}

/** « 4+ » → 4, « 2 » → 2, sinon null : la taille du groupe annoncée sur une confirmation de venue. */
export function partySize(answer: unknown): number | null {
  const m = String(answer ?? '').match(/^\s*(\d{1,2})/);
  return m ? Math.max(1, Math.min(20, Number(m[1]))) : null;
}

/** Remplace « {prénom} » (et ses variantes) par le prénom donné. */
export function withFirstName(msg: string, first: string): string {
  return String(msg || '').replace(/\{\s*(pr[ée]nom|first_?name|nombre)\s*\}/gi, first);
}

/** Le même texte pour l'Email Studio, dont la variable s'écrit {{prénom}}. */
export function toStudioVars(msg: string): string {
  return String(msg || '').replace(/\{\s*(pr[ée]nom|first_?name|nombre)\s*\}/gi, '{{prénom}}');
}

/**
 * Le complément du nom d'un club : « du Bunker », « de la Machine », « des
 * Nuits », « de l’Usine », « d’Amoris », « de Womber » (fr) ; « de Le Bunker »
 * n'existe pas. En espagnol « de {nom} » ; en anglais le nom seul.
 */
export function venueOf(name: string, lang: 'en' | 'fr' | 'es'): string {
  const n = name.trim();
  if (lang === 'en') return n;
  if (lang === 'es') return `de ${n}`;
  const m = /^(le|la|les)\s+(.+)$/i.exec(n);
  if (m) {
    const art = m[1].toLowerCase();
    return art === 'le' ? `du ${m[2]}` : art === 'les' ? `des ${m[2]}` : `de la ${m[2]}`;
  }
  const el = /^l['’]\s*(.+)$/i.exec(n);
  if (el) return `de l’${el[1]}`;
  return /^[aeiouyhàâäéèêëîïôöûü]/i.test(n) ? `d’${n}` : `de ${n}`;
}
