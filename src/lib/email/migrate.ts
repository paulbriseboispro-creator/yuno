import type {
  AudienceSel, EmailBlock, EmailTheme, SocialLinks, SpacerBlock,
} from './types';
import { DEFAULT_STUDIO_THEME, THEME_PRESETS } from './themes';
import { makeBlock } from './blocks';

// ─────────────────────────────────────────────────────────────────────────────
// Migration des campagnes v1 (modèle src/lib/emailCampaign.ts) vers le modèle
// Studio v2. Appelée à l'ouverture d'un brouillon v1 dans le Studio ; le
// premier autosave persiste le résultat avec blocks_version = 2. Les campagnes
// déjà envoyées ne sont JAMAIS réécrites (leur html_body est figé).
// ─────────────────────────────────────────────────────────────────────────────

interface V1Block {
  id?: string;
  type: string;
  [key: string]: unknown;
}

interface V1Theme {
  bg?: string; card_bg?: string; header_bg?: string; header_text?: string;
  body_text?: string; accent?: string; button_text?: string; link_color?: string;
  divider_color?: string; footer_bg?: string; footer_text?: string;
  footer_link?: string; social_bg?: string; social_icon?: string;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

/**
 * HTML v1 (RichTextField) → texte brut du Studio (\n = paragraphe).
 * Le gras/italique est perdu, le contenu jamais — le Studio édite du texte
 * brut avec variables, comme le prototype.
 */
export function htmlToPlain(html: string): string {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Filet de normalisation des lignes déjà en v2 : anciens brouillons Studio
 * (avant l'alignement prototype) où `cond` portait un libellé affiché et où
 * le bloc table n'avait pas de kicker.
 */
export function normalizeV2Blocks(raw: unknown): EmailBlock[] {
  const blocks = Array.isArray(raw) ? (raw as (EmailBlock & { cond?: unknown })[]) : [];
  const condMap: Record<string, EmailBlock['cond']> = {
    'vip_table': 'vip_table', 'new_subscribers': 'new_subscribers', 'buyers': 'buyers',
    'VIP · Table': 'vip_table', 'Nouveaux abonnés': 'new_subscribers', 'A déjà acheté': 'buyers',
  };
  return blocks.map((b) => {
    const next = { ...b } as EmailBlock & { cond?: unknown };
    if (typeof next.cond === 'string') next.cond = condMap[next.cond] ?? null;
    else if (next.cond != null) next.cond = null;
    if (next.type === 'table' && !('kicker' in next && typeof next.kicker === 'string' && next.kicker)) {
      (next as { kicker?: string }).kicker = 'Bottle service';
    }
    return next as EmailBlock;
  });
}

export function migrateV1Blocks(raw: unknown, venueName: string): EmailBlock[] {
  const v1 = Array.isArray(raw) ? (raw as V1Block[]) : [];
  const out: EmailBlock[] = [];
  for (const b of v1) {
    switch (b.type) {
      case 'header': {
        const block = makeBlock('header', { venueName: str(b.venue_name, venueName) });
        if (block.type === 'header') {
          block.showName = b.show_name !== false;
          block.logoSize = (['sm', 'md', 'lg'] as const).includes(b.logo_size as 'sm') ? (b.logo_size as 'sm' | 'md' | 'lg') : 'md';
          block.logoShape = b.logo_shape === 'circle' ? 'circle' : b.logo_shape === 'rounded' ? 'rounded' : 'square';
          if (str(b.logo_url)) block.logoUrl = str(b.logo_url);
        }
        out.push(block);
        break;
      }
      case 'text': {
        const block = makeBlock('text');
        if (block.type === 'text') block.body = htmlToPlain(str(b.html)) || block.body;
        out.push(block);
        break;
      }
      case 'image': {
        const block = makeBlock('image');
        if (block.type === 'image') {
          if (str(b.url)) block.url = str(b.url);
          block.label = str(b.alt);
          if (str(b.link_url)) block.linkUrl = str(b.link_url);
        }
        out.push(block);
        break;
      }
      case 'cta': {
        const block = makeBlock('cta');
        if (block.type === 'cta') {
          block.label = str(b.label, block.label);
          block.url = str(b.url, block.url);
          block.align = (['left', 'center', 'right'] as const).includes(b.align as 'left') ? (b.align as 'left' | 'center' | 'right') : 'center';
        }
        out.push(block);
        break;
      }
      case 'event': {
        const block = makeBlock('event', { eventId: str(b.event_id) || undefined });
        if (block.type === 'event') {
          block.title = str(b.title, block.title);
          block.dateLabel = str(b.date_label, block.dateLabel);
          block.venueLabel = str(b.venue_label, venueName);
          block.ctaLabel = str(b.cta_label, block.ctaLabel);
          if (str(b.cta_url)) block.ctaUrl = str(b.cta_url);
          if (str(b.cover_url)) block.coverUrl = str(b.cover_url);
        }
        out.push(block);
        break;
      }
      case 'divider':
        out.push(makeBlock('divider'));
        break;
      case 'spacer': {
        const block = makeBlock('spacer');
        if (block.type === 'spacer') {
          block.size = (['sm', 'md', 'lg', 'xl'] as const).includes(b.size as SpacerBlock['size'])
            ? (b.size as SpacerBlock['size']) : 'md';
        }
        out.push(block);
        break;
      }
      default:
        // Type inconnu : on le laisse tomber plutôt que de casser le rendu.
        break;
    }
  }
  return out;
}

/** Rapproche le thème v1 du preset v2 le plus proche, puis applique les surcharges. */
export function migrateV1Theme(raw: unknown): EmailTheme {
  const v1 = (raw && typeof raw === 'object' ? raw : {}) as V1Theme;
  const nearest = THEME_PRESETS.find(
    (p) => p.accent.toLowerCase() === (v1.accent || '').toLowerCase()
        && p.bg.toLowerCase() === (v1.bg || '').toLowerCase(),
  ) || THEME_PRESETS.find(
    (p) => p.headerBg.toLowerCase() === (v1.header_bg || '').toLowerCase(),
  ) || DEFAULT_STUDIO_THEME;

  return {
    ...nearest,
    bg: v1.bg || nearest.bg,
    card: v1.card_bg || nearest.card,
    headerBg: v1.header_bg || nearest.headerBg,
    headerText: v1.header_text || nearest.headerText,
    text: v1.body_text || nearest.text,
    accent: v1.accent || nearest.accent,
    btnText: v1.button_text || nearest.btnText,
    divider: v1.divider_color || nearest.divider,
    footerBg: v1.footer_bg || nearest.footerBg,
    footerText: v1.footer_text || nearest.footerText,
  };
}

export function migrateV1SocialLinks(raw: unknown): SocialLinks {
  const v1 = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const links: SocialLinks = {};
  for (const key of ['instagram', 'tiktok', 'facebook', 'x', 'website'] as const) {
    const value = str(v1[key]);
    if (value) links[key] = value;
  }
  return links;
}

/** audience_type v1 (colonne) → sélection multi-audiences v2. */
export function migrateV1Audience(audienceType: string | null, segmentId: string | null): AudienceSel[] {
  if (!audienceType) return [];
  if (audienceType === 'custom_segment') {
    return segmentId ? [{ kind: 'segment', segmentId }] : [];
  }
  const known: AudienceSel['kind'][] = [
    'all_subscribers', 'event_subscribers', 'vip', 'big_spenders', 'regulars',
    'new_customers', 'dormant', 'event_buyers', 'event_table_buyers', 'event_all_buyers',
  ];
  return known.includes(audienceType as AudienceSel['kind'])
    ? [{ kind: audienceType as AudienceSel['kind'] }]
    : [];
}
