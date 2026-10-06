/**
 * Les huit modèles d'e-mail de la Console CRM (écran Modèles, design « Email
 * Modèles »), écrits dans le modèle de blocs de l'Email Studio — celui que
 * l'envoi rend vraiment (renderEmailHtml, port Deno à l'identique).
 *
 * Deux écarts au prototype, voulus :
 * - le bloc « Liens du club » n'est pas posé : le pied de page porte déjà les
 *   réseaux, et les doubler est ce que la vérification avant envoi signale ;
 * - le bouton seul disparaît quand la carte Soirée est là : elle a le sien,
 *   qui part sur la billetterie avec le suivi de la campagne.
 *
 * Une image n'est posée que si elle a une vraie source (affiche de la soirée,
 * photo de la précédente) : un bloc Image vide ne s'affiche pas à l'envoi.
 * Le Line-up est un bloc Yuno : les artistes de la soirée et leur photo de
 * profil, relus chez la billetterie à l'envoi — jamais de noms d'exemple.
 */
import { makeBlock } from '@/lib/email/blocks';
import type { TemplateContent } from '@/lib/email/templates';
import type { EmailBlock, EmailTheme } from '@/lib/email/types';

export const CRM_TEMPLATE_KINDS = ['annonce', 'lineup', 'lastcall', 'bienvenue', 'manque', 'merci', 'mois', 'vide', 'relance'] as const;
export type CrmTemplateKind = (typeof CRM_TEMPLATE_KINDS)[number];

export type CrmTemplateGoal = 'announce' | 'remind' | 'welcome' | 'loyalty' | 'free';
export const CRM_TEMPLATE_GOALS: readonly Exclude<CrmTemplateGoal, 'free'>[] = ['announce', 'remind', 'welcome', 'loyalty'];

export type CrmThemeKey = 'clair' | 'nuit' | 'rouge' | 'epure';

/** Thèmes du prototype (objet THEMES de yuno-mail.js), en tokens EmailTheme. */
export const CRM_EMAIL_THEMES: Record<CrmThemeKey, EmailTheme> = {
  clair: { name: 'crm_clair', bg: '#F3EFED', card: '#FFFFFF', headerBg: '#FFFFFF', headerText: '#1C1517', text: '#1C1517', muted: '#857B7D', accent: '#E3141B', btnText: '#FFFFFF', divider: '#E6DFDD', tile: '#F7F4F3', footerBg: '#F3EFED', footerText: '#857B7D', dark: false },
  nuit: { name: 'crm_nuit', bg: '#0B0708', card: '#150E10', headerBg: '#150E10', headerText: '#F7F2F1', text: '#F7F2F1', muted: '#B9AEB0', accent: '#E3141B', btnText: '#FFFFFF', divider: '#2A2024', tile: '#1E1619', footerBg: '#0B0708', footerText: '#8F8486', dark: true },
  rouge: { name: 'crm_rouge', bg: '#FFF2F1', card: '#FFFFFF', headerBg: '#E3141B', headerText: '#FFFFFF', text: '#1C1517', muted: '#857B7D', accent: '#E3141B', btnText: '#FFFFFF', divider: '#FFE1DF', tile: '#FFF2F1', footerBg: '#FFF2F1', footerText: '#857B7D', dark: false },
  epure: { name: 'crm_epure', bg: '#FFFFFF', card: '#FFFFFF', headerBg: '#FFFFFF', headerText: '#1C1517', text: '#1C1517', muted: '#857B7D', accent: '#1C1517', btnText: '#FFFFFF', divider: '#E6DFDD', tile: '#F7F4F3', footerBg: '#FFFFFF', footerText: '#857B7D', dark: false },
};

/** Contenu affiché dans « Ce qu'il contient » : les briques du prototype. */
export type CrmPiece = 'header' | 'image' | 'text' | 'event' | 'lineup' | 'countdown' | 'columns' | 'divider' | 'cta';

export interface CrmTemplateMeta {
  kind: CrmTemplateKind;
  goal: CrmTemplateGoal;
  theme: CrmThemeKey;
  /** Le modèle parle d'UNE soirée : le brouillon est relié à la prochaine (ou à celle choisie). */
  night: boolean;
  pieces: CrmPiece[];
}

export const CRM_TEMPLATES: readonly CrmTemplateMeta[] = [
  { kind: 'annonce', goal: 'announce', theme: 'clair', night: true, pieces: ['header', 'image', 'text', 'event', 'cta'] },
  { kind: 'lineup', goal: 'announce', theme: 'nuit', night: true, pieces: ['header', 'image', 'text', 'lineup', 'event', 'cta'] },
  { kind: 'lastcall', goal: 'remind', theme: 'rouge', night: true, pieces: ['header', 'text', 'countdown', 'event', 'cta'] },
  { kind: 'bienvenue', goal: 'welcome', theme: 'clair', night: false, pieces: ['header', 'text', 'columns', 'cta'] },
  { kind: 'manque', goal: 'remind', theme: 'epure', night: true, pieces: ['header', 'text', 'event', 'cta'] },
  { kind: 'merci', goal: 'loyalty', theme: 'clair', night: false, pieces: ['header', 'image', 'text', 'cta'] },
  { kind: 'mois', goal: 'loyalty', theme: 'epure', night: false, pieces: ['header', 'text', 'divider', 'columns', 'cta'] },
  { kind: 'vide', goal: 'free', theme: 'clair', night: false, pieces: ['header', 'text', 'cta'] },
];

/**
 * Modèles qui ne servent qu'à une automatisation : ils ne s'affichent pas dans
 * la galerie de l'écran Modèles (un e-mail « vous avez regardé la soirée »
 * n'a de sens que déclenché par le clic).
 */
export const CRM_AUTO_TEMPLATES: readonly CrmTemplateMeta[] = [
  { kind: 'relance', goal: 'remind', theme: 'epure', night: true, pieces: ['header', 'text', 'event', 'cta'] },
];

export function crmTemplate(kind: string | null | undefined): CrmTemplateMeta | undefined {
  return CRM_TEMPLATES.find((x) => x.kind === kind) ?? CRM_AUTO_TEMPLATES.find((x) => x.kind === kind);
}

/**
 * Liens vers l'écran Modèles venus d'ailleurs (accueil, À faire) :
 * `?start=welcome|thanks|lastcall` → le modèle à ouvrir.
 */
export function templateFromStart(start: string | null): CrmTemplateKind | null {
  if (!start) return null;
  const map: Record<string, CrmTemplateKind> = { welcome: 'bienvenue', thanks: 'merci', lastcall: 'lastcall', lineup: 'lineup', announce: 'annonce', missed: 'manque', month: 'mois', blank: 'vide' };
  if (start in map) return map[start];
  return (CRM_TEMPLATE_KINDS as readonly string[]).includes(start) ? (start as CrmTemplateKind) : null;
}

/**
 * « au Bunker », « à la Machine », « aux Nuits », « à l'Usine », « chez Amoris ».
 * L'article du nom décide ; un nom sans article prend « chez ».
 */
export function venueAt(name: string, lang: 'en' | 'fr' | 'es'): string {
  const n = name.trim();
  if (lang === 'en') return `at ${n}`;
  if (lang === 'es') return `en ${n}`;
  const m = /^(le|la|les)\s+(.+)$/i.exec(n);
  if (m) {
    const art = m[1].toLowerCase();
    if (art === 'le') return `au ${m[2]}`;
    if (art === 'les') return `aux ${m[2]}`;
    return `à la ${m[2]}`;
  }
  const el = /^l['’]\s*(.+)$/i.exec(n);
  if (el) return `à l’${el[1]}`;
  return `chez ${n}`;
}

/** Une soirée telle que le modèle s'en sert (affiche, lien). */
export interface TemplateNight {
  id: string;
  title: string;
  coverUrl: string | null;
  url: string | null;
}

export interface BuildCtx {
  venueName: string;
  lang: 'en' | 'fr' | 'es';
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** La soirée annoncée (modèles « soirée ») ou la prochaine (les autres). */
  night?: TemplateNight | null;
  /** La soirée d'après, pour la lettre du mois. */
  second?: TemplateNight | null;
  /** La dernière soirée passée, pour « Merci pour hier soir ». */
  last?: TemplateNight | null;
}

type Loose = Record<string, unknown>;

function block(type: Parameters<typeof makeBlock>[0], venueName: string, patch: Loose = {}): EmailBlock {
  return { ...makeBlock(type, { venueName }), ...patch } as EmailBlock;
}

/**
 * Construit le contenu d'un modèle. Les textes viennent des clés
 * `yc.em.tp.<kind>.*` (FR en vouvoiement), les données de la soirée passée en
 * contexte ; sans soirée, les blocs Yuno gardent leurs lignes d'exemple et se
 * relieront à la soirée choisie dans l'éditeur.
 */
export function buildCrmTemplate(kind: CrmTemplateKind, ctx: BuildCtx): TemplateContent {
  const meta = crmTemplate(kind) ?? CRM_TEMPLATES[CRM_TEMPLATES.length - 1];
  const { venueName, t } = ctx;
  const at = venueAt(venueName, ctx.lang);
  const k = (s: string, v: Record<string, string | number> = {}) => t(`yc.em.tp.${kind}.${s}`, { at, venue: venueName, ...v });
  const b = (type: Parameters<typeof makeBlock>[0], patch: Loose = {}) => block(type, venueName, patch);

  const header = () => b('header', { logoSize: 'md', py: 24 });
  const headline = (body: string, patch: Loose = {}) => b('text', { body, variant: 'headline', size: 28, px: 32, py: 0, ...patch });
  const body = (text: string, patch: Loose = {}) => b('text', { body: text, size: 16, px: 32, py: 12, ...patch });
  const gap = (size: 'sm' | 'md' | 'lg') => b('spacer', { size });
  const poster = (n: TemplateNight | null | undefined, label: string) =>
    (n?.coverUrl ? [b('image', { url: n.coverUrl, label: n.title || label, h: 260 })] : []);
  const eventCard = (n: TemplateNight | null | undefined, patch: Loose = {}) => b('event', {
    eventId: n?.id,
    title: n?.title || k('eventTitle'),
    ctaLabel: k('cta'),
    // L'affiche est déjà en tête : la carte ne la répète pas.
    cover: !n?.coverUrl,
    layout: 'showcase',
    px: 32,
    py: 16,
    ...patch,
  });
  const button = (label: string, url: string | null | undefined, patch: Loose = {}) =>
    b('cta', { label, url: url || '', radius: 999, align: 'center', full: false, py: 20, ...patch });

  const theme = { ...CRM_EMAIL_THEMES[meta.theme] };
  const base = { type: 'promotional' as const, subject: k('subject'), preheader: k('pre'), theme, socialLinks: {}, logoUrl: null };
  const night = ctx.night ?? null;

  switch (kind) {
    case 'annonce':
      return { ...base, blocks: [header(), ...poster(night, k('eventTitle')), gap('md'), headline(k('title')), body(k('body')), eventCard(night), gap('sm')] };

    case 'lineup':
      return {
        ...base,
        blocks: [
          header(),
          ...poster(night, k('eventTitle')),
          gap('md'),
          headline(k('title')),
          body(k('body')),
          // Les artistes de la soirée et leur photo de profil (Shotgun),
          // relus à l'envoi ; la grille ne s'allume que si une photo existe.
          b('lineup', { eventId: night?.id, kicker: k('program'), photos: true, align: 'left', extra: [], px: 32, py: 12 }),
          eventCard(night),
          gap('sm'),
        ],
      };

    case 'lastcall':
      return {
        ...base,
        blocks: [
          header(),
          gap('md'),
          headline(k('title'), { align: 'center' }),
          body(k('body'), { align: 'center' }),
          b('countdown', { eventId: night?.id, label: k('countdown'), py: 12 }),
          eventCard(night, { cover: true }),
          gap('sm'),
        ],
      };

    case 'bienvenue':
      return {
        ...base,
        blocks: [
          header(),
          gap('md'),
          headline(k('title')),
          body(k('body')),
          b('columns', { left: { title: k('c1t'), body: k('c1b') }, right: { title: k('c2t'), body: k('c2b') }, px: 32 }),
          button(k('cta'), night?.url),
          gap('sm'),
        ],
      };

    case 'manque':
      return { ...base, blocks: [header(), gap('md'), headline(k('title')), body(k('body')), eventCard(night, { cover: true }), gap('sm')] };

    case 'relance':
      // « A cliqué sans acheter » : la soirée regardée, avec ses tarifs en
      // direct. Le texte n'affirme jamais « vous n'avez pas acheté » (une
      // place prise avec une autre adresse reste possible).
      return { ...base, blocks: [header(), gap('md'), headline(k('title')), body(k('body')), eventCard(night, { cover: true }), gap('sm')] };

    case 'merci': {
      const last = ctx.last ?? null;
      return {
        ...base,
        blocks: [
          header(),
          ...poster(last, k('photo')),
          gap('md'),
          headline(k('title')),
          body(k('body')),
          button(k('cta'), night?.url),
          gap('sm'),
        ],
      };
    }

    case 'mois': {
      const second = ctx.second ?? null;
      // Les deux prochaines dates, affiche à gauche du texte (la colonne
      // image + texte du prototype), chacune reliée à SA soirée.
      const split = (n: TemplateNight | null, i: 1 | 2) => b('event', {
        eventId: n?.id,
        title: n?.title || k(`n${i}t`),
        ctaLabel: k('nightCta'),
        cover: true,
        layout: 'split',
        full: false,
        px: 32,
        py: 12,
      });
      return {
        ...base,
        blocks: [
          header(),
          gap('md'),
          headline(k('title')),
          body(k('body')),
          b('divider', { px: 32, py: 12 }),
          split(night, 1),
          split(second, 2),
          button(k('cta'), night?.url),
          gap('sm'),
        ],
      };
    }

    case 'vide':
    default:
      return { ...base, subject: '', preheader: '', blocks: [header(), gap('md'), headline(k('title')), body(k('body')), button(k('cta'), night?.url), gap('sm')] };
  }
}

/** Nom du brouillon : le modèle, puis la soirée qu'il annonce. */
export function draftName(kind: CrmTemplateKind, t: (k: string) => string, night?: { title: string } | null): string {
  const meta = crmTemplate(kind);
  if (kind === 'vide') return t('yc.em.tp.newName');
  const name = t(`yc.em.tp.${kind}.name`);
  return meta?.night && night?.title ? `${name} · ${night.title}`.slice(0, 200) : name;
}
