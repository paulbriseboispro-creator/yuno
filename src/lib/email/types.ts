// ─────────────────────────────────────────────────────────────────────────────
// Email Studio — modèle de blocs v2.
//
// Le modèle v1 (7 types, src/lib/emailCampaign.ts) reste en lecture seule pour
// les templates admin ; les campagnes migrent vers ce modèle-ci à l'ouverture
// dans le Studio (voir migrate.ts). Toute évolution de forme ici doit être
// répercutée dans le port Deno : supabase/functions/_shared/email-studio-html.ts.
// ─────────────────────────────────────────────────────────────────────────────

export type BlockType =
  | 'header' | 'image' | 'text' | 'cta' | 'columns'
  | 'event' | 'tickets' | 'table' | 'countdown' | 'social'
  | 'divider' | 'spacer' | 'html';

export interface HeaderBlock {
  id: string; type: 'header';
  venueName: string;
  showName: boolean;
  logoSize: 'sm' | 'md' | 'lg';
  logoShape: 'rounded' | 'circle' | 'square';
  logoUrl?: string;
}

export interface ImageBlock {
  id: string; type: 'image';
  url?: string;
  /** Texte alternatif — obligatoire pour la checklist pré-envoi. */
  label: string;
  h: number;
  linkUrl?: string;
}

export interface TextBlock {
  id: string; type: 'text';
  /** HTML restreint (p, br, strong, em, a) produit par RichTextField. */
  body: string;
  size: number;
  align: 'left' | 'center' | 'right';
}

export interface CtaBlock {
  id: string; type: 'cta';
  label: string;
  url: string;
  align: 'left' | 'center' | 'right';
  radius: number;
  full: boolean;
}

export interface ColumnsBlock {
  id: string; type: 'columns';
  left: { title: string; body: string };
  right: { title: string; body: string };
}

/** Bloc Yuno — carte événement à données live. */
export interface EventBlock {
  id: string; type: 'event';
  eventId?: string;
  title: string;
  dateLabel: string;
  venueLabel: string;
  ctaLabel: string;
  ctaUrl?: string;
  coverUrl?: string;
  cover: boolean;
  venue: boolean;
  price: boolean;
}

export interface TicketRow { n: string; s: string; p: string; out: boolean }

/** Bloc Yuno — billetterie live (jauge, prix courant, épuisé). */
export interface TicketsBlock {
  id: string; type: 'tickets';
  eventId?: string;
  /** true = les lignes sont rafraîchies depuis la base au moment de l'envoi. */
  live: boolean;
  rows: TicketRow[];
}

/** Bloc Yuno — upsell table VIP. */
export interface TableBlock {
  id: string; type: 'table';
  eventId?: string;
  title: string;
  sub: string;
  ctaLabel: string;
  ctaUrl?: string;
  /** Segment requis, affiché comme condition (ex. 'VIP · Table'). */
  cond: string;
}

/** Bloc Yuno — compte à rebours, calculé au rendu (jamais figé). */
export interface CountdownBlock {
  id: string; type: 'countdown';
  eventId?: string;
  label: string;
}

export interface SocialBlock { id: string; type: 'social' }
export interface DividerBlock { id: string; type: 'divider' }

export interface SpacerBlock {
  id: string; type: 'spacer';
  size: 'sm' | 'md' | 'lg' | 'xl';
}

export interface HtmlBlock { id: string; type: 'html'; code: string }

export type EmailBlock =
  | HeaderBlock | ImageBlock | TextBlock | CtaBlock | ColumnsBlock
  | EventBlock | TicketsBlock | TableBlock | CountdownBlock | SocialBlock
  | DividerBlock | SpacerBlock | HtmlBlock;

/** Les 4 blocs « Yuno · données live ». */
export const YUNO_BLOCK_TYPES: readonly BlockType[] = ['event', 'tickets', 'table', 'countdown'];

export const LOGO_SIZES: Record<HeaderBlock['logoSize'], number> = { sm: 42, md: 54, lg: 72 };
export const SPACER_SIZES: Record<SpacerBlock['size'], number> = { sm: 8, md: 16, lg: 32, xl: 56 };

// ── Thème email (tokens du MAIL, distincts des tokens UI du Studio) ─────────

export interface EmailTheme {
  name: string;
  bg: string;
  card: string;
  headerBg: string;
  headerText: string;
  text: string;
  muted: string;
  accent: string;
  btnText: string;
  divider: string;
  tile: string;
  footerBg: string;
  footerText: string;
  dark: boolean;
}

export interface SocialLinks {
  instagram?: string;
  tiktok?: string;
  facebook?: string;
  x?: string;
  website?: string;
}

// ── Contexte de rendu ────────────────────────────────────────────────────────

export interface RenderRecipient {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  city?: string | null;
  lastEventTitle?: string | null;
  loyaltyPoints?: number | null;
}

/** Données live d'un événement, résolues AU RENDU (jamais à la composition). */
export interface LiveEventData {
  title: string;
  startAt: string;
  dateLabel: string;
  venueLabel: string;
  coverUrl?: string | null;
  url: string;
  priceFromLabel?: string | null;
  tickets?: TicketRow[];
  tablesLeft?: number | null;
}

export type LiveData = Record<string, LiveEventData>;

export interface RenderCtx {
  venueName: string;
  city?: string | null;
  emailType: 'promotional' | 'informational';
  subject: string;
  preheader?: string;
  recipient: RenderRecipient;
  unsubscribeUrl?: string;
  socialLinks?: SocialLinks;
  hideBranding?: boolean;
  baseUrl: string;
  campaignId?: string;
  live?: LiveData;
  /** Horloge injectable — countdown déterministe en test. */
  now?: Date;
}

// ── Campagne côté Studio ─────────────────────────────────────────────────────

export type AudienceKind =
  | 'all_subscribers' | 'event_subscribers'
  | 'vip' | 'big_spenders' | 'regulars' | 'new_customers' | 'dormant'
  | 'segment'
  | 'event_buyers' | 'event_table_buyers' | 'event_all_buyers';

export interface AudienceSel {
  kind: AudienceKind;
  segmentId?: string;
}

export interface AudienceExclusions {
  /** Exclut les contacts ayant déjà reçu une campagne dans les N derniers jours. */
  recentDays?: number | null;
  /** Exclut ceux qui ont déjà acheté un billet pour l'événement de la campagne. */
  excludeEventBuyers?: boolean;
}

export interface StudioCampaign {
  id: string;
  name: string;
  type: 'promotional' | 'informational';
  status: string;
  subject: string;
  subjectB: string;
  abOn: boolean;
  preheader: string;
  blocks: EmailBlock[];
  theme: EmailTheme;
  socialLinks: SocialLinks;
  logoUrl: string | null;
  eventId: string | null;
  audiences: AudienceSel[];
  exclusions: AudienceExclusions;
  scheduledAt: string | null;
  throttlePerHour: number | null;
  quietHours: boolean;
}
