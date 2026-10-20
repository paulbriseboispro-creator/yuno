/**
 * « Avec qui fais-tu cette soirée ? » — la règle unique des invitations sur une
 * soirée (plan `docs/designs/COLLAB_OPEN_INVITE_PLAN.md`).
 *
 * Un seul verbe : INVITER. N'importe quel club ou organisation, sur Yuno ou
 * par email, sans partenariat préalable : l'acceptation vaut accord. Chaque
 * invité a UN rôle :
 *
 *  • `principal` — le LIEU (un club, quand une organisation mène) ou
 *    l'ORGANISATEUR (une organisation, quand un club mène). Un seul par
 *    soirée, soirée publique seulement. À l'acceptation il devient la partie
 *    principale (`partner_venue_id` / `partner_organizer_id`) avec le mode et
 *    l'accord d'argent choisis ici (`_collab_promote_principal`, SQL).
 *  • `editor` — « Co-gestion » : gère aussi la vente et l'habillage.
 *  • `viewer` — « Partenaire » (défaut) : suit la soirée, ses ventes, ses liens.
 *  • `guest` — invité PAR EMAIL (club ou organisation sans compte) : reçoit
 *    l'espace invité de la soirée (`event_guest_passes`, /h/<jeton>) — ventes,
 *    sa part de guest list, ses liens, la porte, sa part de l'argent — jamais
 *    un espace pro ni un droit de gestion. Nom visible à nommer (`guestSpace.*`).
 *    Un club ne le prend que sur une soirée d'organisation sans club Yuno pour
 *    lieu (`hostOpen`).
 *
 * Pur et testé (`__tests__/collabInvite.test.ts`) : le composant ne fait que
 * dessiner ce que ces fonctions décident.
 */
import type { PrincipalTerms } from '@/lib/coorg';
import type { ExternalCollector } from '@/lib/splitRules';

export type PartyKindLite = 'org' | 'venue';
export type InviteRole = 'principal' | 'editor' | 'viewer' | 'guest';
export type CollabModeDb = PrincipalTerms['mode'];

export type PartnerDraft =
  | { source: 'yuno'; kind: PartyKindLite; id: string; name: string; avatar_url: string | null; city: string | null; role: InviteRole }
  | {
    source: 'email'; kind: PartyKindLite; email: string; name: string; role: InviteRole;
    /** Espace invité : langue, montants montrés (défaut oui), places de guest list données. */
    guestLang?: 'en' | 'fr' | 'es'; guestRevenue?: boolean; guestPlaces?: number;
  };

/** Un invité avant qu'on lui donne un rôle (l'Omit distribué sur l'union). */
export type PartnerDraftInput = PartnerDraft extends infer D ? (D extends PartnerDraft ? Omit<D, 'role'> : never) : never;

export const partnerDraftKey = (d: PartnerDraft | PartnerDraftInput) =>
  d.source === 'email' ? `email:${d.email.toLowerCase()}` : `${d.kind}:${d.id}`;

/** Le type de partie qui peut être « principal » quand `lead` mène la soirée. */
export const principalKindFor = (lead: 'organizer' | 'venue'): PartyKindLite =>
  lead === 'organizer' ? 'venue' : 'org';

export interface InviteContext {
  lead: 'organizer' | 'venue';
  /** Faux sur une soirée privée ou quand le lieu / l'organisateur est déjà là. */
  principalOpen: boolean;
  /**
   * Vrai quand une organisation mène et qu'aucun club Yuno n'est le lieu :
   * un club invité par email peut alors recevoir l'ESPACE INVITÉ de la soirée
   * (sans compte), au lieu de devenir le lieu.
   */
  hostOpen?: boolean;
}

/**
 * Les rôles qu'un invité peut prendre. Un club invité par email n'a pas encore
 * de club sur Yuno : il ne peut arriver que comme LIEU (son club se crée à
 * l'acceptation) — jamais en simple partenaire, où il n'aurait rien pour accepter.
 */
export function allowedRoles(d: Pick<PartnerDraft, 'source' | 'kind'>, ctx: InviteContext, others: PartnerDraft[] = []): InviteRole[] {
  const principalTaken = others.some((o) => o.role === 'principal');
  const canBePrincipal = ctx.principalOpen && !principalTaken && d.kind === principalKindFor(ctx.lead);
  if (d.source === 'email' && d.kind === 'venue') {
    const guest = ctx.lead === 'organizer' && !!ctx.hostOpen ? (['guest'] as InviteRole[]) : [];
    return canBePrincipal ? ['principal', ...guest] : guest;
  }
  // Une organisation par email : son espace invité (sans compte) d'abord.
  if (d.source === 'email') return canBePrincipal ? ['guest', 'principal', 'editor', 'viewer'] : ['guest', 'editor', 'viewer'];
  return canBePrincipal ? ['principal', 'editor', 'viewer'] : ['editor', 'viewer'];
}

/**
 * Le rôle proposé à l'ajout : toujours « Partenaire » (lecture) quand il est permis.
 * Donner la main sur la soirée (lieu / organisateur, co-gestion) se choisit, ne se subit pas.
 */
export function defaultRole(d: Pick<PartnerDraft, 'source' | 'kind'>, ctx: InviteContext, others: PartnerDraft[]): InviteRole | null {
  const roles = allowedRoles(d, ctx, others);
  if (roles.length === 0) return null;
  // Par email : l'espace invité d'abord (aucun compte à créer) ; devenir le
  // lieu, l'organisateur ou co-gérer se choisit.
  if (roles.includes('guest')) return 'guest';
  if (roles.includes('viewer')) return 'viewer';
  return roles[0];
}

export interface YunoSplit {
  /** Part de l'ORGANISATION sur les billets et les tables, en %. Le bar reste au club. */
  ticketsOrgPct: number;
  tablesOrgPct: number;
}

export const DEFAULT_YUNO_SPLIT: YunoSplit = { ticketsOrgPct: 50, tablesOrgPct: 0 };

const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)));

/**
 * Règles d'un contrat Yuno proposé à l'invitation. Toujours réglé par
 * VIREMENT (Stripe n'autorise que les charges directes) : c'est le lead qui
 * encaisse, puis reverse sa part au partenaire après la soirée.
 */
export function yunoContractRules(split: YunoSplit, lead: 'organizer' | 'venue') {
  const t = clampPct(split.ticketsOrgPct);
  const tb = clampPct(split.tablesOrgPct);
  return {
    tickets: { organizer_pct: t, venue_pct: 100 - t },
    tables: { organizer_pct: tb, venue_pct: 100 - tb },
    drinks: { organizer_pct: 0, venue_pct: 100 },
    settlement: { mode: 'transfer', collector: lead, payment_terms_days: 15 },
  };
}

/** Les termes qui partent avec une invitation principale. */
export function principalTerms(p: {
  mode: CollabModeDb;
  agreement: 'external' | 'yuno';
  collectors: { tickets: ExternalCollector; tables: ExternalCollector };
  split: YunoSplit;
  lead: 'organizer' | 'venue';
}): PrincipalTerms {
  return p.agreement === 'external'
    ? { mode: p.mode, agreement: 'external', tickets: p.collectors.tickets, tables: p.collectors.tables }
    : { mode: p.mode, agreement: 'yuno', rules: yunoContractRules(p.split, p.lead) };
}

/**
 * Les conditions d'une invitation par EMAIL d'un club comme lieu
 * (`invite-club-collab`) : le même accord, sous la forme `default_split_rules`
 * que lit l'acceptation (`event_mode` voyage avec, puis est retiré).
 */
export function clubEmailInviteRules(terms: PrincipalTerms): Record<string, unknown> {
  if (terms.agreement === 'external') {
    const tk = terms.tickets ?? 'organizer';
    const tb = terms.tables ?? (terms.mode === 'org_hosted' ? 'organizer' : 'venue');
    return {
      agreement: 'external',
      event_mode: terms.mode,
      tickets: { organizer_pct: tk === 'organizer' ? 100 : 0, venue_pct: tk === 'organizer' ? 0 : 100 },
      tables: { organizer_pct: tb === 'organizer' ? 100 : 0, venue_pct: tb === 'organizer' ? 0 : 100 },
      drinks: { organizer_pct: 0, venue_pct: 100 },
    };
  }
  return { ...(terms.rules ?? {}), event_mode: terms.mode };
}
