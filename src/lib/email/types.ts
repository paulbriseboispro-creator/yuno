// ─────────────────────────────────────────────────────────────────────────────
// Email Studio — modèle de blocs v2.
//
// Le modèle v1 (7 types, src/lib/emailCampaign.ts) reste en lecture seule pour
// les templates admin ; les campagnes migrent vers ce modèle-ci à l'ouverture
// dans le Studio (voir migrate.ts). Toute évolution de forme ici doit être
// répercutée dans le port Deno : supabase/functions/_shared/email-studio-html.ts.
// Source de vérité visuelle : prototype claude.design « Email Studio Yuno ».
// ─────────────────────────────────────────────────────────────────────────────

export type BlockType =
  | 'header' | 'image' | 'text' | 'cta' | 'columns'
  | 'event' | 'tickets' | 'table' | 'countdown' | 'social'
  | 'divider' | 'spacer' | 'html';

/** Règle de visibilité par destinataire, résolue À L'ENVOI (jamais figée). */
export type BlockCond = 'vip_table' | 'new_subscribers' | 'buyers';

export const BLOCK_CONDS: readonly BlockCond[] = ['vip_table', 'new_subscribers', 'buyers'];

/** Props communes à tous les blocs (prototype : marges + fond + règle). */
export interface BlockBase {
  id: string;
  /** Marge horizontale interne (px). Défaut : 24. */
  px?: number;
  /** Marge verticale interne (px). Défaut : 18. */
  py?: number;
  /** Fond du bloc : teinte du thème ou accent léger. Défaut : transparent. */
  bg?: 'tile' | 'accent';
  /** Fond personnalisé (hex #rrggbb) — prime sur `bg`. */
  bgc?: string;
  /** Visibilité conditionnelle — null/absent = toujours visible. */
  cond?: BlockCond | null;
}

export interface HeaderBlock extends BlockBase {
  type: 'header';
  venueName: string;
  showName: boolean;
  logoSize: 'sm' | 'md' | 'lg';
  logoShape: 'rounded' | 'circle' | 'square';
  logoUrl?: string;
}

export interface ImageBlock extends BlockBase {
  type: 'image';
  url?: string;
  /** Texte alternatif — obligatoire pour la checklist pré-envoi. */
  label: string;
  h: number;
  linkUrl?: string;
  /** Coins arrondis (px). Outlook l'ignore proprement. Défaut : 0. */
  radius?: number;
}

export interface TextBlock extends BlockBase {
  type: 'text';
  /**
   * Texte BRUT avec retours à la ligne (\n = nouveau paragraphe) et
   * variables {{…}}. Les brouillons v1 migrés peuvent encore contenir du
   * HTML : le rendu détecte et accepte les deux (voir render.ts).
   */
  body: string;
  size: number;
  align: 'left' | 'center' | 'right';
  /** Couleur de base du texte (hex). Absent = texte du thème. */
  color?: string;
}

export interface CtaBlock extends BlockBase {
  type: 'cta';
  label: string;
  url: string;
  align: 'left' | 'center' | 'right';
  /** 0 = carré, 8 = doux, 999 = pilule (options du prototype). */
  radius: number;
  full: boolean;
  /**
   * Couleur de fond de CE bouton (hex #rrggbb). Absent = accent du thème.
   * Le texte est auto-contrasté (contrastText) quand la couleur est custom.
   */
  color?: string;
}

export interface ColumnsBlock extends BlockBase {
  type: 'columns';
  left: { title: string; body: string };
  right: { title: string; body: string };
}

/** Bloc Yuno — carte événement à données live. */
export interface EventBlock extends BlockBase {
  type: 'event';
  eventId?: string;
  /** Couleur d'accent du bloc (bouton) — hex. Absent = accent du thème. */
  accent?: string;
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
export interface TicketsBlock extends BlockBase {
  type: 'tickets';
  eventId?: string;
  /** Couleur d'accent (prix + bouton) — hex. Absent = accent du thème. */
  accent?: string;
  /** true = les lignes sont rafraîchies depuis la base au moment de l'envoi. */
  live: boolean;
  rows: TicketRow[];
}

/** Bloc Yuno — upsell table VIP. */
export interface TableBlock extends BlockBase {
  type: 'table';
  eventId?: string;
  /** Couleur d'accent (kicker, compteur, bouton) — hex. Absent = thème. */
  accent?: string;
  /** Kicker affiché au-dessus du titre (ex. « Bottle service »). */
  kicker: string;
  title: string;
  sub: string;
  ctaLabel: string;
  ctaUrl?: string;
}

/** Bloc Yuno — compte à rebours, calculé au rendu (jamais figé). */
export interface CountdownBlock extends BlockBase {
  type: 'countdown';
  eventId?: string;
  label: string;
  /** Couleur d'accent (chiffres) — hex. Absent = accent du thème. */
  accent?: string;
  /**
   * Date cible manuelle (ISO UTC) — utilisée quand aucun événement n'est
   * relié (teaser, ouverture de billetterie…). L'événement live prime.
   */
  targetAt?: string;
}

export interface SocialBlock extends BlockBase {
  type: 'social';
  /** Couleur des icônes (hex). Absent = muted du thème. */
  color?: string;
}
export interface DividerBlock extends BlockBase {
  type: 'divider';
  /** Couleur du trait (hex). Absent = divider du thème. */
  color?: string;
}

export interface SpacerBlock extends BlockBase {
  type: 'spacer';
  size: 'sm' | 'md' | 'lg' | 'xl';
}

export interface HtmlBlock extends BlockBase { type: 'html'; code: string }

export type EmailBlock =
  | HeaderBlock | ImageBlock | TextBlock | CtaBlock | ColumnsBlock
  | EventBlock | TicketsBlock | TableBlock | CountdownBlock | SocialBlock
  | DividerBlock | SpacerBlock | HtmlBlock;

/** Les 4 blocs « Yuno · données live ». */
export const YUNO_BLOCK_TYPES: readonly BlockType[] = ['event', 'tickets', 'table', 'countdown'];

export const LOGO_SIZES: Record<HeaderBlock['logoSize'], number> = { sm: 42, md: 54, lg: 72 };
export const SPACER_SIZES: Record<SpacerBlock['size'], number> = { sm: 8, md: 16, lg: 32, xl: 56 };

/** Marges par défaut d'un bloc (prototype : 18px / 24px). */
export const DEFAULT_PY = 18;
export const DEFAULT_PX = 24;

/**
 * Marges par défaut PAR TYPE. Le rendu (front + edge), le canvas et
 * l'inspecteur lisent la même table : un bloc sans px/py explicites garde le
 * visuel du prototype, et poser 0 colle réellement les blocs entre eux.
 */
export const TYPE_PAD_DEFAULTS: Partial<Record<BlockType, { px: number; py: number }>> = {
  header: { px: 24, py: 30 },
  image: { px: 0, py: 0 },
  divider: { px: 24, py: 10 },
  social: { px: 24, py: 18 },
  cta: { px: 24, py: 24 },
  html: { px: 24, py: 0 },
};

export function blockPadDefaults(type: BlockType): { px: number; py: number } {
  return TYPE_PAD_DEFAULTS[type] || { px: DEFAULT_PX, py: DEFAULT_PY };
}

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
  /**
   * Réseaux sociaux dans le pied de page. Absent = affichés (comportement
   * historique). `false` = pied de page purement légal — c'est la porte de
   * sortie quand la campagne pose déjà un bloc « Réseaux » dans le corps,
   * sinon les pastilles apparaissent deux fois.
   */
  footerSocial?: boolean;
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
  /** Règles de visibilité satisfaites par CE destinataire (résolues à l'envoi). */
  conds?: ReadonlySet<BlockCond> | BlockCond[];
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
  /**
   * Logo du club / de l'organisateur, résolu par l'appelant (scope Studio en
   * aperçu, expéditeur en envoi). Sert de repli au bloc header : un header
   * sans logo choisi à la main affiche automatiquement la marque du compte.
   */
  logoUrl?: string | null;
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
  /**
   * true (aperçu Studio) = les blocs conditionnels sont TOUS rendus ;
   * false/absent (envoi réel) = un bloc avec `cond` non satisfaite s'efface.
   */
  ignoreConds?: boolean;
}

// ── Campagne côté Studio ─────────────────────────────────────────────────────

export type AudienceKind =
  | 'all_subscribers' | 'event_subscribers'
  | 'vip' | 'big_spenders' | 'regulars' | 'new_customers' | 'dormant'
  | 'segment' | 'import'
  | 'event_buyers' | 'event_table_buyers' | 'event_all_buyers';

export interface AudienceSel {
  kind: AudienceKind;
  segmentId?: string;
  /** kind 'import' : le lot d'import (email_list_imports.id) — un fichier = un segment. */
  importId?: string;
}

export interface AudienceExclusions {
  /** Exclut les contacts ayant déjà reçu une campagne dans les N derniers jours. */
  recentDays?: number | null;
  /** Exclut ceux qui ont déjà acheté un billet pour l'événement de la campagne. */
  excludeEventBuyers?: boolean;
}

export type ScheduleMode = 'now' | 'schedule';

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
