// ─────────────────────────────────────────────────────────────────────────────
// Modèles Yuno prêts à l'emploi — le point de départ quand le pro n'a encore
// enregistré aucun modèle à lui. Ce sont des CONSTRUCTIONS, pas des lignes en
// base : rien à semer, rien à migrer, et la copie suit les 3 langues.
//
// Même contrat que les modèles utilisateur : aucun `eventId`. Les blocs Yuno
// se relient à la soirée choisie au moment de créer la campagne.
// ─────────────────────────────────────────────────────────────────────────────

import { makeBlock } from './blocks';
import { DEFAULT_STUDIO_THEME } from './themes';
import type { TemplateContent } from './templates';
import type { EmailBlock, EmailTheme } from './types';

export type StarterKey =
  | 'invitation' | 'last_call' | 'vip_tables' | 'announcement' | 'click_followup'
  // Modèles des RECETTES automatiques (page Automatisations) — jamais dans la
  // galerie « Nouvelle campagne », créés d'un clic depuis la recette.
  | 'auto_welcome' | 'auto_abandoned_checkout' | 'auto_last_call'
  | 'auto_post_event_thanks' | 'auto_post_event_missed' | 'auto_win_back'
  // v2 (2026-09-15) : passe en table, le tarif monte, nouvelle soirée.
  | 'auto_table_upsell' | 'auto_tier_closing' | 'auto_new_event'
  // 2026-10-02 : l'habitué décroche.
  | 'auto_regular_lapse';

export interface StarterMeta {
  key: StarterKey;
  nameKey: string;
  descKey: string;
}

export const STARTER_TEMPLATES: readonly StarterMeta[] = [
  { key: 'invitation', nameKey: 'studio.starter.invitation.name', descKey: 'studio.starter.invitation.desc' },
  { key: 'last_call', nameKey: 'studio.starter.last_call.name', descKey: 'studio.starter.last_call.desc' },
  { key: 'vip_tables', nameKey: 'studio.starter.vip_tables.name', descKey: 'studio.starter.vip_tables.desc' },
  { key: 'announcement', nameKey: 'studio.starter.announcement.name', descKey: 'studio.starter.announcement.desc' },
  { key: 'click_followup', nameKey: 'studio.starter.click_followup.name', descKey: 'studio.starter.click_followup.desc' },
];

/** Nom donné au modèle quand l'écran Planification le crée d'un clic. */
export const CLICK_FOLLOWUP_TEMPLATE_NAME_KEY = 'studio.starter.click_followup.name';

export interface StarterCtx {
  venueName: string;
  theme?: EmailTheme;
  t: (key: string) => string;
}

type Patch<T> = Partial<T> & Record<string, unknown>;

function block(type: Parameters<typeof makeBlock>[0], venueName: string, patch: Patch<EmailBlock> = {}): EmailBlock {
  return { ...makeBlock(type, { venueName }), ...patch } as EmailBlock;
}

/** Réglages libres d'une brique de recette (fusionnés au bloc par défaut). */
type Loose = Record<string, unknown>;

/** Noir du bandeau des recettes urgentes et VIP — celui de l'en-tête du thème par défaut. */
const INK = '#0A0A0A';
/** Texte secondaire sur le bandeau noir (12:1, lisible sans crier). */
const INK_SOFT = '#C9C9CF';
/** Or VIP sur noir — la couleur du pilier tables (pass Wallet, bloc Table). */
const VIP_GOLD_INK = '#F2B23C';

/** Marge latérale des textes des recettes : un peu plus d'air que les cartes. */
const TEXT_PX = 28;

/**
 * Briques de composition des recettes. Les marges sont posées une par une :
 * un sur-titre, un titre et une phrase qui se suivent doivent se lire comme
 * UN bloc, pas comme trois blocs espacés de 18 px chacun.
 */
function recipeKit(venueName: string) {
  const text = (body: string, patch: Loose) => block('text', venueName, { body, px: TEXT_PX, ...patch } as Patch<EmailBlock>);
  return {
    /** En-tête compact : le titre doit tenir dans le premier écran d'un téléphone. */
    header: () => block('header', venueName, { py: 20, logoSize: 'sm' }),
    spacer: (size: 'sm' | 'md' | 'lg', patch: Loose = {}) => block('spacer', venueName, { size, ...patch } as Patch<EmailBlock>),
    kicker: (body: string, patch: Loose = {}) =>
      text(body, { variant: 'kicker', size: 11, align: 'left', py: 0, ...patch }),
    headline: (body: string, patch: Loose = {}) =>
      text(body, { variant: 'headline', size: 30, align: 'left', py: 10, ...patch }),
    body: (body: string, patch: Loose = {}) =>
      text(body, { size: 16, align: 'left', py: 0, ...patch }),
    /** P.S. : séparé par un filet, en 14 px — la dernière ligne qu'on lit. */
    ps: (body: string) => [
      block('divider', venueName, { py: 6 }),
      text(body, { size: 14, align: 'left', py: 14 }),
    ],
    /** Bandeau noir qui prolonge l'en-tête : la famille URGENCE / VIP. */
    band: (inner: EmailBlock[]) => [
      block('spacer', venueName, { size: 'lg', bgc: INK }),
      ...inner,
      block('spacer', venueName, { size: 'lg', bgc: INK }),
      block('spacer', venueName, { size: 'sm' }),
    ],
  };
}

/**
 * Construit un modèle de départ. Aucun bloc « Réseaux » n'est posé : le pied
 * de page les porte déjà, et les doubler est justement ce que la checklist
 * pré-envoi signale.
 */
export function buildStarter(key: StarterKey, ctx: StarterCtx): TemplateContent {
  const { venueName, t } = ctx;
  const theme = ctx.theme || DEFAULT_STUDIO_THEME;
  const s = recipeKit(venueName);
  const k = (suffix: string) => t(`studio.starter.${key}.${suffix}`);
  const base = {
    type: 'promotional' as const,
    subject: k('subject'),
    preheader: k('preheader'),
    theme: { ...theme },
    socialLinks: {},
    logoUrl: null,
  };

  switch (key) {
    case 'invitation':
      return {
        ...base,
        blocks: [
          block('header', venueName),
          block('text', venueName, { body: k('t1') }),
          block('event', venueName, { title: k('eventTitle'), ctaLabel: k('eventCta'), price: true }),
          block('tickets', venueName, { live: true }),
          // Liste invités : son propre bloc, qui s'efface sans part publique.
          block('guestlist', venueName),
          block('divider', venueName),
          block('text', venueName, { body: k('t2'), size: 14 }),
        ],
      };

    case 'last_call':
      return {
        ...base,
        blocks: [
          block('header', venueName),
          block('text', venueName, { body: k('t1'), align: 'center' }),
          block('countdown', venueName, { label: k('countdownLabel') }),
          block('tickets', venueName, { live: true }),
          block('text', venueName, { body: k('t2'), size: 14, align: 'center' }),
        ],
      };

    case 'vip_tables':
      return {
        ...base,
        blocks: [
          block('header', venueName),
          block('text', venueName, { body: k('t1') }),
          // cond effacée : une campagne qui VEND des tables doit être vue par
          // tout le monde, pas seulement par ceux qui en ont déjà réservé une.
          block('table', venueName, {
            cond: null, kicker: k('tableKicker'), title: k('tableTitle'),
            sub: k('tableSub'), ctaLabel: k('tableCta'),
            perks: [k('tablePerk1'), k('tablePerk2'), k('tablePerk3')],
            note: k('tableNote'),
          }),
          block('divider', venueName),
          block('text', venueName, { body: k('t2'), size: 14 }),
        ],
      };

    // Relance après clic : le contact a regardé la soirée sans réserver. Le
    // modèle se COMPOSE à l'envoi selon l'inventaire réel : billets restants
    // (bloc Billetterie live, qui disparaît sans billetterie), tables VIP
    // (bloc Table live), compte à rebours sur la vraie date. Ton direct,
    // court : on ne re-présente pas la soirée, on lève la dernière hésitation.
    case 'click_followup':
      return {
        ...base,
        blocks: [
          block('header', venueName),
          block('text', venueName, { body: k('t1') }),
          block('event', venueName, { title: k('eventTitle'), ctaLabel: k('eventCta'), price: true }),
          block('countdown', venueName, { label: k('countdownLabel') }),
          block('tickets', venueName, { live: true }),
          block('guestlist', venueName),
          block('table', venueName, {
            cond: null, kicker: k('tableKicker'), title: k('tableTitle'),
            sub: k('tableSub'), ctaLabel: k('tableCta'), perks: [], note: '',
          }),
          block('divider', venueName),
          block('text', venueName, { body: k('t2'), size: 14 }),
        ],
      };

    // ── Recettes automatiques ─────────────────────────────────────────────
    // Refonte du 2026-10-02. Chaque recette a SA mise en page, pensée pour sa
    // situation — plus un squelette unique dont seuls les mots changeaient.
    // Grammaire commune, tirée des bonnes pratiques d'emailing :
    //   1. un sur-titre + un TITRE qui dit la situation en 5 à 8 mots, dans le
    //      premier écran (l'en-tête est compact pour lui laisser la place) ;
    //   2. une phrase, pas un paragraphe ;
    //   3. UNE action principale (la carte de la soirée ou de l'offre) ; au plus
    //      une seconde, en bandeau, visiblement subordonnée ;
    //   4. un P.S. — la ligne qu'on lit après le titre.
    // Trois familles visuelles : URGENCE (bandeau noir, compte à rebours :
    // panier, palier, dernier appel), VIP (noir et or : passe en table),
    // RELATION (éditorial clair, l'affiche en grand : bienvenue, merci, on t'a
    // manqué, reconquête, l'habitué qui décroche, nouvelle soirée).
    // Toutes reliées à une soirée AU MOMENT de l'envoi : les blocs Yuno se
    // remplissent avec le vrai inventaire, et le moteur les retire s'il n'y a
    // aucune date à relier.

    // Panier abandonné : un récapitulatif de commande, pas une affiche — le
    // client était sur la page il y a deux heures, il reconnaît le titre et la
    // date. Le bouton tient donc dans le premier écran, la réassurance juste
    // dessous, le compte à rebours ensuite.
    case 'auto_abandoned_checkout':
      return {
        ...base,
        blocks: [
          s.header(),
          s.spacer('lg'),
          s.kicker(k('kicker')),
          s.headline(k('headline')),
          s.body(k('body')),
          block('event', venueName, {
            kicker: k('eventKicker'), title: k('eventTitle'), ctaLabel: k('eventCta'), note: k('eventNote'),
            cover: false, venue: true, price: true, layout: 'showcase', metaDisplay: 'rows', full: true,
          }),
          block('countdown', venueName, { label: k('countdownLabel') }),
          ...s.ps(k('ps')),
        ],
      };

    // Le tarif monte : bandeau noir, le titre nomme la soirée, puis les
    // tranches EN LIGNES — la ligne épuisée barrée à côté de la ligne ouverte
    // et de la suivante, plus chère, est l'argument : on la voit avant de la
    // lire. Pas de bannière (elle masque les tranches).
    case 'auto_tier_closing':
      return {
        ...base,
        blocks: [
          s.header(),
          ...s.band([
            s.kicker(k('kicker'), { align: 'center', bgc: INK }),
            s.headline(k('headline'), { align: 'center', bgc: INK }),
            s.body(k('body'), { align: 'center', bgc: INK, color: INK_SOFT }),
          ]),
          block('tickets', venueName, {
            live: true, layout: 'showcase', priceDisplay: 'rows',
            kicker: k('ticketsKicker'), title: '', ctaLabel: k('ticketsCta'), note: k('ticketsNote'),
          }),
          block('countdown', venueName, { label: k('countdownLabel') }),
          ...s.ps(k('ps')),
        ],
      };

    // Dernier appel : bandeau noir, compte à rebours juste dessous (c'est lui
    // l'urgence, et il est réel), puis l'affiche et le bouton. La liste
    // invités en bandeau seulement : l'alternative gratuite, pas un second
    // email dans l'email.
    case 'auto_last_call':
      return {
        ...base,
        blocks: [
          s.header(),
          ...s.band([
            s.kicker(k('kicker'), { align: 'center', bgc: INK }),
            s.headline(k('headline'), { align: 'center', bgc: INK }),
            s.body(k('body'), { align: 'center', bgc: INK, color: INK_SOFT }),
          ]),
          block('countdown', venueName, { label: k('countdownLabel') }),
          block('event', venueName, {
            title: k('eventTitle'), ctaLabel: k('eventCta'), note: k('eventNote'),
            price: true, layout: 'showcase', metaDisplay: 'rows', full: true,
          }),
          block('guestlist', venueName, {
            layout: 'banner', title: k('glTitle'), sub: '', ctaLabel: k('glCta'), note: '',
          }),
          ...s.ps(k('ps')),
        ],
      };

    // Passe en table : noir et or, la couleur du pilier tables dans tout Yuno.
    // Ils ont déjà leur billet : pas de billetterie, la carte des tables en
    // vitrine avec ses arguments, puis comment ça se passe en deux colonnes.
    // La note ne parle jamais d'acompte : il dépend de chaque formule (une
    // table réglée au club n'en a pas).
    case 'auto_table_upsell':
      return {
        ...base,
        blocks: [
          s.header(),
          ...s.band([
            s.kicker(k('kicker'), { align: 'center', bgc: INK, color: VIP_GOLD_INK }),
            s.headline(k('headline'), { align: 'center', bgc: INK }),
            s.body(k('body'), { align: 'center', bgc: INK, color: INK_SOFT }),
          ]),
          block('table', venueName, {
            cond: null, layout: 'showcase', kicker: k('tableKicker'), title: k('tableTitle'),
            sub: k('tableSub'), ctaLabel: k('tableCta'),
            perks: [k('tablePerk1'), k('tablePerk2'), k('tablePerk3')],
            note: k('tableNote'),
          }),
          block('columns', venueName, {
            left: { title: k('col1Title'), body: k('col1Body') },
            right: { title: k('col2Title'), body: k('col2Body') },
          }),
          ...s.ps(k('ps')),
        ],
      };

    // Nouvelle soirée : l'affiche en héroïne. Titre centré, l'affiche et son
    // bouton, puis les tarifs en version compacte (les premiers paliers qui
    // partent, c'est ce qui fait réserver tôt), la liste invités en bandeau.
    case 'auto_new_event':
      return {
        ...base,
        blocks: [
          s.header(),
          s.spacer('lg'),
          s.kicker(k('kicker'), { align: 'center' }),
          s.headline(k('headline'), { align: 'center' }),
          s.body(k('body'), { align: 'center' }),
          block('event', venueName, {
            layout: 'showcase', kicker: '', title: k('eventTitle'), ctaLabel: k('eventCta'),
            price: true, metaDisplay: 'rows', full: true,
          }),
          block('tickets', venueName, {
            live: true, layout: 'minimal', priceDisplay: 'rows',
            kicker: k('ticketsKicker'), title: '', ctaLabel: k('ticketsCta'), full: false,
          }),
          block('guestlist', venueName, {
            layout: 'banner', title: k('glTitle'), sub: '', ctaLabel: k('glCta'), note: '',
          }),
          ...s.ps(k('ps')),
        ],
      };

    // Bienvenue : la promesse d'abord (ce qu'on va recevoir, en deux
    // colonnes), la prochaine date ensuite. Le P.S. demande l'ajout aux
    // contacts — le geste qui fait arriver les suivants en boîte principale.
    case 'auto_welcome':
      return {
        ...base,
        blocks: [
          s.header(),
          s.spacer('lg'),
          s.kicker(k('kicker')),
          s.headline(k('headline')),
          s.body(k('body')),
          s.spacer('md'),
          block('columns', venueName, {
            bg: 'tile',
            left: { title: k('col1Title'), body: k('col1Body') },
            right: { title: k('col2Title'), body: k('col2Body') },
          }),
          block('event', venueName, {
            layout: 'showcase', kicker: k('eventKicker'), title: k('eventTitle'), ctaLabel: k('eventCta'),
            price: true, metaDisplay: 'rows', full: true,
          }),
          ...s.ps(k('ps')),
        ],
      };

    // Merci d'avoir été là : chaleureux, court, la suite en affiche. Le P.S.
    // transforme le souvenir en contenu (stories partagées).
    case 'auto_post_event_thanks':
      return {
        ...base,
        blocks: [
          s.header(),
          s.spacer('lg'),
          s.kicker(k('kicker')),
          s.headline(k('headline')),
          s.body(k('body')),
          block('event', venueName, {
            layout: 'showcase', kicker: k('eventKicker'), title: k('eventTitle'), ctaLabel: k('eventCta'),
            price: true, metaDisplay: 'rows', full: true,
          }),
          ...s.ps(k('ps')),
        ],
      };

    // On t'a manqué : sans reproche, une seule prochaine date, en côte à côte
    // (l'affiche à gauche, le bouton dans le premier écran sur ordinateur).
    case 'auto_post_event_missed':
      return {
        ...base,
        blocks: [
          s.header(),
          s.spacer('lg'),
          s.kicker(k('kicker')),
          s.headline(k('headline')),
          s.body(k('body')),
          block('event', venueName, {
            layout: 'split', kicker: k('eventKicker'), title: k('eventTitle'), ctaLabel: k('eventCta'),
            price: true, metaDisplay: 'stack', full: true,
          }),
          ...s.ps(k('ps')),
        ],
      };

    // Reconquête : un mot humain, ce qui arrive, et une seconde porte en
    // bandeau or (revenir en grand, à plusieurs). Le P.S. offre la sortie :
    // un dormant qui se désabonne vaut mieux qu'un dormant qui se plaint.
    case 'auto_win_back':
      return {
        ...base,
        blocks: [
          s.header(),
          s.spacer('lg'),
          s.kicker(k('kicker')),
          s.headline(k('headline')),
          s.body(k('body')),
          block('event', venueName, {
            layout: 'showcase', kicker: k('eventKicker'), title: k('eventTitle'), ctaLabel: k('eventCta'),
            price: true, metaDisplay: 'rows', full: true,
          }),
          block('table', venueName, {
            cond: null, layout: 'banner', kicker: k('tableKicker'), title: k('tableTitle'),
            sub: '', ctaLabel: k('tableCta'), perks: [], note: '',
          }),
          ...s.ps(k('ps')),
        ],
      };

    // L'habitué décroche : la soirée de l'email est CHOISIE pour lui par le
    // moteur (série qu'il fréquentait, genres, jour de sortie) — le titre le
    // dit, et la carte est la seule action. Rien d'autre à vendre ici.
    case 'auto_regular_lapse':
      return {
        ...base,
        blocks: [
          s.header(),
          s.spacer('lg'),
          s.kicker(k('kicker')),
          s.headline(k('headline')),
          s.body(k('body')),
          block('event', venueName, {
            layout: 'showcase', kicker: '', title: k('eventTitle'), ctaLabel: k('eventCta'), note: k('eventNote'),
            price: true, metaDisplay: 'rows', full: true,
          }),
          ...s.ps(k('ps')),
        ],
      };

    case 'announcement':
    default:
      return {
        ...base,
        blocks: [
          block('header', venueName),
          block('image', venueName, { label: k('imgAlt'), h: 240 }),
          block('text', venueName, { body: k('t1') }),
          block('cta', venueName, { label: k('cta'), align: 'center' }),
        ],
      };
  }
}
