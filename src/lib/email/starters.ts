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
  | 'auto_table_upsell' | 'auto_tier_closing' | 'auto_new_event';

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

/**
 * Construit un modèle de départ. Aucun bloc « Réseaux » n'est posé : le pied
 * de page les porte déjà, et les doubler est justement ce que la checklist
 * pré-envoi signale.
 */
export function buildStarter(key: StarterKey, ctx: StarterCtx): TemplateContent {
  const { venueName, t } = ctx;
  const theme = ctx.theme || DEFAULT_STUDIO_THEME;
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
    // Toutes reliées à une soirée AU MOMENT de l'envoi (la soirée déclencheuse
    // ou la prochaine date) : les blocs Yuno se remplissent avec le vrai
    // inventaire, et le moteur les retire s'il n'y a aucune date à relier.

    // Bienvenue : la première impression, avec la prochaine soirée en carte.
    case 'auto_welcome':
      return {
        ...base,
        blocks: [
          block('header', venueName),
          block('text', venueName, { body: k('t1') }),
          block('event', venueName, { kicker: k('eventKicker'), title: k('eventTitle'), ctaLabel: k('eventCta'), price: true }),
          block('tickets', venueName, { live: true }),
          block('guestlist', venueName),
          block('divider', venueName),
          block('text', venueName, { body: k('t2'), size: 14 }),
        ],
      };

    // Panier abandonné : la place est encore là, le compte à rebours dit
    // pour combien de temps.
    case 'auto_abandoned_checkout':
      return {
        ...base,
        blocks: [
          block('header', venueName),
          block('text', venueName, { body: k('t1') }),
          block('event', venueName, { title: k('eventTitle'), ctaLabel: k('eventCta'), price: true, layout: 'banner' }),
          block('countdown', venueName, { label: k('countdownLabel') }),
          block('tickets', venueName, { live: true }),
          block('table', venueName, {
            cond: null, kicker: k('tableKicker'), title: k('tableTitle'),
            sub: k('tableSub'), ctaLabel: k('tableCta'), perks: [], note: '',
          }),
          block('divider', venueName),
          block('text', venueName, { body: k('t2'), size: 14 }),
        ],
      };

    // Dernier appel : à toute la base qui n'a pas encore sa place.
    case 'auto_last_call':
      return {
        ...base,
        blocks: [
          block('header', venueName),
          block('text', venueName, { body: k('t1'), align: 'center' }),
          block('event', venueName, { title: k('eventTitle'), ctaLabel: k('eventCta'), price: true }),
          block('countdown', venueName, { label: k('countdownLabel') }),
          block('tickets', venueName, { live: true }),
          block('guestlist', venueName),
          block('table', venueName, {
            cond: null, kicker: k('tableKicker'), title: k('tableTitle'),
            sub: k('tableSub'), ctaLabel: k('tableCta'), perks: [], note: '',
          }),
          block('text', venueName, { body: k('t2'), size: 14, align: 'center' }),
        ],
      };

    // Merci d'être venu : aux SCANNÉS, avec la prochaine date.
    case 'auto_post_event_thanks':
      return {
        ...base,
        blocks: [
          block('header', venueName),
          block('text', venueName, { body: k('t1') }),
          block('event', venueName, { kicker: k('eventKicker'), title: k('eventTitle'), ctaLabel: k('eventCta'), price: true }),
          block('tickets', venueName, { live: true }),
          block('guestlist', venueName),
          block('divider', venueName),
          block('text', venueName, { body: k('t2'), size: 14 }),
        ],
      };

    // On t'a manqué : à ceux qui avaient une place et ne sont pas venus.
    case 'auto_post_event_missed':
      return {
        ...base,
        blocks: [
          block('header', venueName),
          block('text', venueName, { body: k('t1') }),
          block('event', venueName, { kicker: k('eventKicker'), title: k('eventTitle'), ctaLabel: k('eventCta'), price: true }),
          block('tickets', venueName, { live: true }),
          block('guestlist', venueName),
          block('divider', venueName),
          block('text', venueName, { body: k('t2'), size: 14 }),
        ],
      };

    // Reconquête : le dormant relancé avec ce qui arrive.
    case 'auto_win_back':
      return {
        ...base,
        blocks: [
          block('header', venueName),
          block('text', venueName, { body: k('t1') }),
          block('event', venueName, { kicker: k('eventKicker'), title: k('eventTitle'), ctaLabel: k('eventCta'), price: true }),
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

    // Passe en table : ils ont leur billet, voilà la même soirée en mieux. Pas
    // de bloc Billetterie (ils l'ont déjà), le bloc Table VIP en vitrine avec
    // les arguments REMPLIS : c'est la copie qui vend, pas la structure.
    case 'auto_table_upsell':
      return {
        ...base,
        blocks: [
          block('header', venueName),
          block('text', venueName, { body: k('t1') }),
          block('table', venueName, {
            cond: null, layout: 'showcase', kicker: k('tableKicker'), title: k('tableTitle'),
            sub: k('tableSub'), ctaLabel: k('tableCta'),
            perks: [k('tablePerk1'), k('tablePerk2'), k('tablePerk3')],
            note: k('tableNote'),
          }),
          block('divider', venueName),
          block('text', venueName, { body: k('t2'), size: 14 }),
        ],
      };

    // Le tarif monte : une relance courte. Les tranches en lignes montrent
    // que la prévente monte, le compte à rebours dit pour combien de temps.
    // Mise en page « minimal » (compacte) et non « banner » : la bannière
    // n'affiche jamais les tranches, or c'est la ligne épuisée à côté de la
    // ligne ouverte qui fait comprendre que le prix monte.
    case 'auto_tier_closing':
      return {
        ...base,
        blocks: [
          block('header', venueName),
          block('text', venueName, { body: k('t1') }),
          block('tickets', venueName, {
            live: true, layout: 'minimal', priceDisplay: 'rows',
            kicker: k('ticketsKicker'), title: k('ticketsTitle'), ctaLabel: k('ticketsCta'),
          }),
          block('countdown', venueName, { label: k('countdownLabel') }),
          block('text', venueName, { body: k('t2'), size: 14 }),
        ],
      };

    // Nouvelle soirée : l'email d'annonce (même grammaire que l'invitation) —
    // l'affiche en grand, la billetterie et la liste invités en direct.
    case 'auto_new_event':
      return {
        ...base,
        blocks: [
          block('header', venueName),
          block('text', venueName, { body: k('t1') }),
          block('event', venueName, { layout: 'showcase', kicker: k('eventKicker'), title: k('eventTitle'), ctaLabel: k('eventCta'), price: true }),
          block('tickets', venueName, { live: true }),
          block('guestlist', venueName),
          block('divider', venueName),
          block('text', venueName, { body: k('t2'), size: 14 }),
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
