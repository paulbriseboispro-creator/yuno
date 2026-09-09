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

/**
 * Une ligne d'entrée : tranche de billetterie ou part de liste invités.
 * `id` n'existe que sur les lignes LIVE (id de `ticket_rounds`, ou la
 * sentinelle de la guest list) — il sert à décrocher une ligne précise sans
 * dépendre de son nom, qui peut changer.
 */
export interface TicketRow { id?: string; n: string; s: string; p: string; out: boolean }

/** Sentinelle d'id de la ligne « Liste invités » (elle n'est pas un round). */
export const GUEST_LIST_ROW_ID = 'guest-list';

/**
 * Détail des tarifs de la billetterie : chaque tranche, ou le seul prix
 * d'appel. « À partir de 18 € » suffit dans une relance ; le détail des
 * tranches sert quand on veut montrer que la prévente monte.
 */
export type TicketPriceDisplay = 'rows' | 'from';

export const TICKET_PRICE_DISPLAYS: readonly TicketPriceDisplay[] = ['rows', 'from'];

/**
 * Bloc Yuno — billetterie live (jauge, prix courant, épuisé).
 *
 * Mêmes réglages de présentation que le bloc Table VIP : les deux vendent une
 * entrée sous deux formes, et un pro qui a appris à régler l'un doit savoir
 * régler l'autre. Le squelette de rendu est d'ailleurs partagé (offerCard).
 */
export interface TicketsBlock extends BlockBase {
  type: 'tickets';
  eventId?: string;
  /** Couleur d'accent (prix + bouton) — hex. Absent = accent du thème. */
  accent?: string;
  /** true = les lignes sont rafraîchies depuis la base au moment de l'envoi. */
  live: boolean;
  rows: TicketRow[];
  /** Mise en page. Absent = 'showcase'. */
  layout?: TableLayout;
  /** Alignement du kicker, du titre, du sous-titre, des arguments, du bouton. */
  align?: 'left' | 'center' | 'right';
  /** Sur-titre. Absent = « Billetterie » (ou « Entrée » en liste invités seule). */
  kicker?: string;
  title?: string;
  sub?: string;
  /** Arguments de vente, un par ligne, précédés d'une coche accent. */
  perks?: string[];
  /** Détail des tarifs : les tranches, ou le seul prix d'appel. */
  priceDisplay?: TicketPriceDisplay;
  /** Tranches LIVE que ce bloc ne montre pas (ids de `ticket_rounds`). */
  hiddenRows?: string[];
  /** Libellé du bouton. Absent = déduit de l'offre (billets / liste invités). */
  ctaLabel?: string;
  /** Bouton pleine largeur. Absent = pleine largeur sauf en 'minimal'. */
  full?: boolean;
  /** Visuel — mêmes règles que le bloc Table VIP. */
  coverUrl?: string;
  coverPos?: 'top' | 'bottom';
  /** Rassurance sous le bouton. */
  note?: string;
}

/**
 * Une formule de table telle qu'elle se LIT dans l'email : le nom de la
 * formule, la ligne qui dit ce qu'on y trouve (couverts, bouteilles) et le
 * prix. Miroir volontaire de TicketRow — les deux piliers se vendent avec la
 * même grammaire, nom à gauche, prix à droite.
 */
export interface TablePackRow {
  /** Id de `table_packs` — présent sur les lignes LIVE seulement (les
   *  formules écrites à la main n'en ont pas). Sert à masquer une formule
   *  précise sans dépendre de son nom, qui peut changer. */
  id?: string;
  /** Nom de la formule (« Carré Prestige »). */
  n: string;
  /** Ce que la formule contient (« 6 à 8 pers. · 2 bouteilles »). */
  s: string;
  /** Prix affiché (« 450 € ») ou nature de l'offre (« Sur place »). */
  p: string;
}

/** Mise en page du bloc Table VIP. */
export type TableLayout = 'showcase' | 'banner' | 'minimal';

export const TABLE_LAYOUTS: readonly TableLayout[] = ['showcase', 'banner', 'minimal'];

/**
 * Ce que la carte détaille : chaque FORMULE, ou seulement les ZONES avec leur
 * prix d'appel. Un club qui vend huit formules dans trois carrés gagne à
 * montrer les trois carrés — le détail se lit sur la page de réservation, pas
 * dans un email qu'on parcourt au pouce.
 */
export type TablePackDisplay = 'packs' | 'zones';

export const TABLE_PACK_DISPLAYS: readonly TablePackDisplay[] = ['packs', 'zones'];

/**
 * Bloc Yuno — vente de tables VIP (bottle service).
 *
 * Le bloc ne se contente pas d'annoncer que des tables existent : il porte
 * l'offre entière (arguments de vente, formules avec leurs prix, rareté,
 * rassurance). C'est ce qui sépare une ligne de rappel d'une page de vente,
 * et le pilier table est celui dont le panier moyen est le plus élevé.
 */
export interface TableBlock extends BlockBase {
  type: 'table';
  eventId?: string;
  /** Couleur d'accent (kicker, coches, prix, bouton) — hex. Absent = thème. */
  accent?: string;
  /** Kicker affiché au-dessus du titre (ex. « Bottle service »). */
  kicker: string;
  title: string;
  sub: string;
  ctaLabel: string;
  ctaUrl?: string;
  /** Mise en page. Absent = 'showcase'. */
  layout?: TableLayout;
  /**
   * Alignement du kicker, du titre, du sous-titre, des arguments, de la note
   * et du bouton. Absent = 'left'. Les FORMULES gardent toujours leur propre
   * lecture (nom à gauche, prix à droite) : un tarif centré ne se compare pas.
   */
  align?: 'left' | 'center' | 'right';
  /** Arguments de vente, un par ligne, précédés d'une coche accent. */
  perks?: string[];
  /** Formules figées — servent quand aucune soirée n'est reliée. */
  packs?: TablePackRow[];
  /** true = les formules sont relues dans `table_packs` au moment de l'envoi. */
  livePacks?: boolean;
  /**
   * Formules LIVE que ce bloc ne montre pas (ids de `table_packs`). Vide ou
   * absent = toute la carte du club part dans l'email : c'est le défaut, un
   * client qui ne voit que trois formules sur huit croit que c'est tout ce
   * qui existe. Le pro décroche celles qu'il ne veut pas pousser ce soir-là.
   */
  hiddenPacks?: string[];
  /**
   * Visuel du carré VIP. Pas de hauteur réglable : les clients mail ignorent
   * object-fit, une hauteur imposée déformerait la photo. L'image garde son
   * ratio, comme le bloc Image. Disponible sur les TROIS mises en page.
   */
  coverUrl?: string;
  /**
   * Où poser le visuel : en tête de carte ('top', défaut) ou après les
   * formules, juste avant le bouton ('bottom'). Un plan de salle se lit mieux
   * APRÈS les tarifs — on sait alors ce qu'on cherche dessus.
   */
  coverPos?: 'top' | 'bottom';
  /** Détail des tarifs : chaque formule, ou les zones et leur prix d'appel. */
  packDisplay?: TablePackDisplay;
  /** Rassurance sous le bouton (acompte, heure d'arrivée…). */
  note?: string;
  /** Bouton pleine largeur. Absent = pleine largeur sauf en 'minimal'. */
  full?: boolean;
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
  /**
   * Offre d'entrée de la soirée : les tranches de billetterie ET la liste
   * invités publique, qui est une façon d'entrer comme une autre. Tableau vide
   * = rien à vendre ni à offrir (le bloc s'efface) ; `undefined` = événement
   * non résolu (le bloc retombe sur ses lignes figées).
   */
  tickets?: TicketRow[];
  /**
   * true quand la seule entrée publique est une liste invités gratuite. Le
   * bloc Billetterie change alors son bouton : on ne dit pas « Prendre mes
   * billets » pour une inscription gratuite.
   */
  guestListOnly?: boolean;
  /**
   * Tables encore libres. `null` = la soirée n'ouvre aucune table (le bloc
   * s'efface plutôt que de vendre du vide) ; 0 = complet, la carte le dit et
   * retire son bouton — un bouton qui mène à une page pleine coûte plus de
   * confiance qu'il ne rapporte de clics.
   */
  tablesLeft?: number | null;
  /**
   * Formules de table de la soirée, relues dans `table_packs` au rendu.
   * `undefined` = non résolu (le bloc retombe sur ses formules figées),
   * tableau vide = aucune formule ouverte.
   */
  tablePacks?: TablePackRow[];
  /**
   * Zones de tables (carrés) avec leur prix d'appel — la vue épurée du même
   * inventaire que `tablePacks`. Mêmes règles de résolution.
   */
  tableZones?: TablePackRow[];
  /**
   * Liens suivis `/l/<code>` du canal de la campagne (« newsletter » par
   * défaut). `trackedUrl` mène à la page de la soirée avec `?tl=`,
   * `entryTrackedUrl` directement au formulaire de la part de guest list
   * publique — c'est lui qui fait remonter l'inscription sur le canal.
   *
   * Résolus par l'edge À L'ENVOI seulement. Le canvas ne les remplit JAMAIS :
   * un aperçu cliqué gonflerait les compteurs du pro avec ses propres clics.
   */
  trackedUrl?: string | null;
  entryTrackedUrl?: string | null;
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
  | 'segment' | 'import' | 'contact_segment'
  | 'event_buyers' | 'event_table_buyers' | 'event_all_buyers'
  // Portée plateforme (marketing Yuno) — résolus sur le registre plateforme,
  // voir resolve_campaign_audience §« Portée plateforme ».
  | 'clients' | 'pros' | 'waitlist' | 'leads' | 'app_users' | 'no_account' | 'buyers';

export interface AudienceSel {
  kind: AudienceKind;
  /** kind 'segment' : venue_segments.id · kind 'contact_segment' : contact_segments.id (base importée, club ET organisateur). */
  segmentId?: string;
  /** kind 'import' : le lot d'import (email_list_imports.id) — un fichier = un segment. */
  importId?: string;
}

export interface AudienceExclusions {
  /** Exclut les contacts ayant déjà reçu une campagne dans les N derniers jours. */
  recentDays?: number | null;
  /** Exclut ceux qui ont déjà acheté un billet pour l'événement de la campagne. */
  excludeEventBuyers?: boolean;
  /**
   * Combinaison des audiences cochées : 'any' (réunir, défaut) = dans au moins
   * une ; 'all' (croiser) = dans TOUTES (« Paris » ET « Actifs < 90 j »).
   * Résolu par resolve_campaign_audience ; valeur inconnue ⇒ réunir.
   */
  audienceMatch?: 'any' | 'all';
}

export type ScheduleMode = 'now' | 'schedule';

/** Cadre du lissage : une heure (4 vagues), la journée (jusqu'à 23 h), N jours. */
export type ThrottleMode = 'hour' | 'day' | 'days';

export interface ThrottlePlan {
  mode: ThrottleMode;
  /** Mode `days` : 2 à 7. Conservé dans les autres modes pour rebasculer sans perdre le choix. */
  days: number;
  /** Le pro a remplacé la proposition de Yuno par son propre plafond par vague. */
  custom?: boolean;
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
  /** Plafond d'envois par fenêtre glissante (`throttleWindowMinutes`). null = pas de lissage. */
  throttlePerHour: number | null;
  /** 15 (« sur une heure ») ou 60 (journée, plusieurs jours). */
  throttleWindowMinutes: number;
  /** Cadre choisi à l'écran — donnée d'affichage, jamais lue par le worker. */
  throttlePlan: ThrottlePlan | null;
  quietHours: boolean;
}
