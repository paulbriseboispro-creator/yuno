// ─────────────────────────────────────────────────────────────────────────────
// Modèles d'email — le DESIGN d'une campagne, détaché de la soirée.
//
// Contrat central, celui qui rend un modèle rejouable : un modèle ne porte
// AUCUNE donnée de soirée. Les blocs Yuno (event / tickets / table / countdown)
// y sont stockés sans `eventId` — ils héritent alors de l'événement de la
// campagne au rendu (fetchStudioLiveData côté edge, liveFor côté canvas). Le
// même modèle « invitation » sert donc toutes les soirées à venir, avec les
// vrais tarifs et la vraie jauge à chaque envoi.
//
// Ce qu'un modèle NE contient pas, volontairement : audience, planification,
// A/B. Ces décisions se reprennent à chaque campagne.
// ─────────────────────────────────────────────────────────────────────────────

import { duplicateBlock } from './blocks';
import { normalizeTheme } from './themes';
import { normalizeV2Blocks } from './migrate';
import {
  YUNO_BLOCK_TYPES,
  type EmailBlock, type EmailTheme, type SocialLinks, type StudioCampaign,
} from './types';

/** Contenu réutilisable d'un modèle — le sous-ensemble « design » d'une campagne. */
export interface TemplateContent {
  type: StudioCampaign['type'];
  subject: string;
  preheader: string;
  blocks: EmailBlock[];
  theme: EmailTheme;
  socialLinks: SocialLinks;
  logoUrl: string | null;
}

export interface EmailTemplate extends TemplateContent {
  id: string;
  name: string;
  description: string;
  useCount: number;
  lastUsedAt: string | null;
  updatedAt: string | null;
}

/** Ligne brute de `email_campaign_templates` (la table n'est pas typée en v1 des types générés). */
export interface EmailTemplateRow {
  id: string;
  name: string;
  description: string | null;
  type: string | null;
  subject: string | null;
  preheader: string | null;
  blocks_json: unknown;
  theme_json: unknown;
  social_links_json: unknown;
  logo_url: string | null;
  use_count: number | null;
  last_used_at: string | null;
  updated_at: string | null;
}

export function rowToTemplate(row: EmailTemplateRow): EmailTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    type: row.type === 'informational' ? 'informational' : 'promotional',
    subject: row.subject || '',
    preheader: row.preheader || '',
    blocks: normalizeV2Blocks(row.blocks_json),
    theme: normalizeTheme(row.theme_json),
    socialLinks: (row.social_links_json && typeof row.social_links_json === 'object'
      ? row.social_links_json : {}) as SocialLinks,
    logoUrl: row.logo_url,
    useCount: row.use_count || 0,
    lastUsedAt: row.last_used_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Efface tout ce qui appartient à UNE soirée : l'`eventId` des blocs Yuno,
 * l'affiche et le lien figés d'une carte événement, la date cible d'un compte
 * à rebours. Sans ce nettoyage, un modèle rejoué en octobre afficherait
 * l'affiche de septembre dès que la nouvelle soirée n'a pas encore la sienne.
 */
export function stripEventBindings(blocks: EmailBlock[]): EmailBlock[] {
  return blocks.map((raw) => {
    const b = JSON.parse(JSON.stringify(raw)) as EmailBlock & Record<string, unknown>;
    if (!YUNO_BLOCK_TYPES.includes(b.type)) return b as EmailBlock;
    delete b.eventId;
    if (b.type === 'event') {
      delete b.coverUrl;
      delete b.ctaUrl;
    }
    if (b.type === 'countdown') delete b.targetAt;
    return b as EmailBlock;
  });
}

/** Blocs Yuno qui resteront muets sans soirée choisie (un countdown daté à la main se suffit). */
export function eventBoundBlocks(blocks: EmailBlock[]): EmailBlock[] {
  return blocks.filter((b) => {
    if (!YUNO_BLOCK_TYPES.includes(b.type)) return false;
    if ('eventId' in b && b.eventId) return false;
    if (b.type === 'countdown' && typeof b.targetAt === 'string' && b.targetAt) return false;
    return true;
  });
}

/** true si la campagne pose des blocs Yuno qu'aucune soirée n'alimente. */
export function needsEventBinding(blocks: EmailBlock[], campaignEventId?: string | null): boolean {
  return !campaignEventId && eventBoundBlocks(blocks).length > 0;
}

/** Campagne → contenu de modèle (le design, débarrassé de la soirée). */
export function campaignToTemplateContent(c: StudioCampaign): TemplateContent {
  return {
    type: c.type,
    subject: c.subject,
    preheader: c.preheader,
    blocks: stripEventBindings(c.blocks),
    theme: { ...c.theme },
    socialLinks: { ...c.socialLinks },
    logoUrl: c.logoUrl,
  };
}

/**
 * Modèle → contenu de campagne. Les identifiants de blocs sont regénérés :
 * deux campagnes issues du même modèle ne doivent jamais partager d'id, sinon
 * la sélection et l'historique du Studio se marchent dessus.
 */
export function templateToCampaignContent(tpl: TemplateContent): TemplateContent {
  return {
    type: tpl.type,
    subject: tpl.subject,
    preheader: tpl.preheader,
    blocks: stripEventBindings(tpl.blocks).map(duplicateBlock),
    theme: { ...tpl.theme },
    socialLinks: { ...tpl.socialLinks },
    logoUrl: tpl.logoUrl,
  };
}

/** Payload d'écriture — miroir des colonnes de `email_campaign_templates`. */
export function templateContentToRow(content: TemplateContent): Record<string, unknown> {
  return {
    type: content.type,
    subject: content.subject,
    preheader: content.preheader,
    blocks_json: content.blocks,
    blocks_version: 2,
    theme_json: content.theme,
    social_links_json: content.socialLinks,
    logo_url: content.logoUrl,
  };
}
