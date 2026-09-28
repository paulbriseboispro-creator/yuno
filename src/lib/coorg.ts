import { supabase } from '@/integrations/supabase/client';

/**
 * Co-organisation — N parties sur une soirée (migration 20260928100000).
 *
 * Deux étages, et la frontière est volontaire :
 *  - le COLLAB contractuel (club + organisateur, partage Stripe automatique au
 *    moment de la vente) reste à DEUX parties : un paiement Stripe n'a que deux
 *    jambes chez Yuno ;
 *  - la CO-ORGANISATION ouvre la soirée à autant de co-hôtes qu'il faut
 *    (organisateurs, clubs) : dashboards connectés, CRM partagé par
 *    consentement nommé, annonce aux bases de chacun. L'argent entre N parties
 *    ne passe JAMAIS par Stripe : un décompte validé par tous, puis des
 *    virements déclarés par le payeur et confirmés par le bénéficiaire.
 *
 * Une partie est une clé texte : `venue:<id>` ou `org:<uuid>`.
 */

export type PartyKind = 'venue' | 'org';
export type PartyRole = 'lead' | 'partner' | 'cohost';
export type CohostAccess = 'editor' | 'viewer';

export interface CoorgParty {
  key: string;
  kind: PartyKind;
  role: PartyRole;
  access: 'owner' | CohostAccess;
  share_crm: boolean;
  cohost_id: string | null;
  name: string;
  slug: string | null;
  avatar_url: string | null;
  city: string | null;
}

export interface CoorgInvitation {
  id: string;
  status: 'pending' | 'declined';
  access: CohostAccess;
  share_crm: boolean;
  invited_at: string;
  message: string | null;
  party: string;
  name: string | null;
  avatar_url: string | null;
  mine: boolean;
}

export interface CoorgDeal {
  event_id: string;
  shares: Record<string, number>;
  formal: boolean;
  clauses: string | null;
  terms_version: string;
  version: number;
  signatures: Record<string, { at: string; by: string; ip?: string | null; ua?: string; version: number }>;
  status: 'pending' | 'active' | 'cancelled';
  activated_at: string | null;
  /** Délai de paiement convenu après l'arrêté du décompte (7, 15 ou 30 jours). */
  payment_terms_days?: PaymentTermsDays;
}

export const PAYMENT_TERMS_DAYS = [7, 15, 30] as const;
export type PaymentTermsDays = (typeof PAYMENT_TERMS_DAYS)[number];

export interface CoorgLedgerLine {
  id: string;
  kind: 'revenue' | 'expense';
  party: string;
  category: string;
  label: string;
  amount: number;
  note: string | null;
  created_at: string;
  mine: boolean;
}

export interface CoorgFigureParty {
  party: string;
  name: string;
  kind: PartyKind;
  role: PartyRole;
  pct: number;
  yuno: number;
  yuno_tickets: number;
  yuno_tables: number;
  yuno_drinks: number;
  declared_revenue: number;
  expenses: number;
  held: number;
  entitled: number;
  balance: number;
}

export interface CoorgFigures {
  ok: boolean;
  reason?: string;
  deal_version?: number;
  deal_status?: string;
  merchant?: string;
  revenue?: number;
  expenses?: number;
  pot?: number;
  parties?: CoorgFigureParty[];
  transfers?: { from: string; to: string; amount: number }[];
}

export interface CoorgTransfer {
  id: string;
  from: string;
  to: string;
  amount: number;
  reference: string;
  status: 'pending' | 'sent' | 'received' | 'disputed' | 'cancelled';
  payee_iban: string | null;
  sent_at: string | null;
  sent_reference: string | null;
  received_at: string | null;
  disputed_at: string | null;
  dispute_reason: string | null;
  i_pay: boolean;
  i_receive: boolean;
  /** À payer avant (posé à l'arrêté du décompte). */
  due_at?: string | null;
  /** Le bénéficiaire confirme avant (7 j après l'annonce), sinon litige automatique. */
  confirm_due_at?: string | null;
  reminder_count?: number;
  escalated_at?: string | null;
  last_nudged_at?: string | null;
  resolved_by_admin?: boolean;
  admin_note?: string | null;
}

/** Jours de retard d'un virement encore à faire (0 = échéance aujourd'hui), null s'il n'est pas en retard. */
export function transferDaysLate(t: Pick<CoorgTransfer, 'status' | 'due_at'>, now: Date = new Date()): number | null {
  if (t.status !== 'pending' || !t.due_at) return null;
  const ms = now.getTime() - new Date(t.due_at).getTime();
  if (ms < 0) return null;
  return Math.floor(ms / 86_400_000);
}

/** Le bénéficiaire peut relancer une fois par 24 h un virement pas encore annoncé. */
export function canNudgeTransfer(t: Pick<CoorgTransfer, 'status' | 'i_receive' | 'last_nudged_at'>, now: Date = new Date()): boolean {
  if (!t.i_receive || (t.status !== 'pending' && t.status !== 'disputed')) return false;
  if (!t.last_nudged_at) return true;
  return now.getTime() - new Date(t.last_nudged_at).getTime() >= 86_400_000;
}

export interface CoorgState {
  ok: boolean;
  reason?: string;
  event: { id: string; title: string; start_at: string; end_at: string; ended: boolean; has_stripe_collab: boolean };
  me: { party: string; role: PartyRole; access: string; level: number } | null;
  my_parties: string[];
  can_invite: boolean;
  can_deal: boolean;
  parties: CoorgParty[];
  invitations: CoorgInvitation[];
  deal: CoorgDeal | null;
  ledger: CoorgLedgerLine[] | null;
  settlement: {
    status: 'open' | 'approved' | 'settled';
    version: number;
    approvals: Record<string, { at: string; by: string; version: number; fp?: string }>;
    approved_at: string | null;
    settled_at: string | null;
    figures: CoorgFigures;
    /** Empreinte des chiffres affichés (décompte ouvert) : on valide ce qu'on a lu. */
    fingerprint?: string | null;
  } | null;
  transfers: CoorgTransfer[] | null;
}

export interface CoorgPartnerCandidate {
  kind: PartyKind;
  id: string;
  name: string;
  slug: string | null;
  avatar_url: string | null;
  city: string | null;
  followers: number;
}

export interface CohostInvite {
  id: string;
  event_id: string;
  access: CohostAccess;
  share_crm: boolean;
  message: string | null;
  invited_at: string;
  event_title: string;
  start_at: string;
  end_at: string;
  poster_url: string | null;
  location: string | null;
  city: string | null;
  invited_by_name: string | null;
  parties: { name: string; kind: PartyKind; role: PartyRole }[] | null;
}

export interface CoorgEventRow {
  event_id: string;
  title: string;
  start_at: string;
  end_at: string;
  poster_url: string | null;
  my_role: PartyRole | null;
  parties: { key: string; name: string; kind: PartyKind; role: PartyRole; avatar_url: string | null }[];
  pending_invites: number;
  deal_status: 'pending' | 'active' | 'cancelled' | null;
  settlement_status: 'open' | 'approved' | 'settled' | null;
}

export interface CoorgPartnerRow {
  key: string;
  kind: PartyKind;
  name: string;
  slug: string | null;
  avatar_url: string | null;
  city: string | null;
  venue_id: string | null;
  organizer_user_id: string | null;
  events: number;
  tickets: number;
  last_at: string;
}

/** Portée d'une Console : un club, ou un organisateur. */
export type CoorgScope = { venueId: string; organizerUserId?: null } | { venueId?: null; organizerUserId: string };

const scopeArgs = (scope: CoorgScope) => ({
  p_venue_id: scope.venueId ?? null,
  p_organizer_user_id: scope.organizerUserId ?? null,
});

export const partyKeyOf = (scope: CoorgScope) =>
  scope.venueId ? `venue:${scope.venueId}` : `org:${scope.organizerUserId}`;

// ── Filtres PostgREST : la portée + ses soirées co-hébergées ────────────────
// `cohost_org_ids` / `cohost_venue_ids` sont des champs CALCULÉS (fonctions SQL
// sur la ligne events), filtrables dans un `or=` comme une colonne.

/** Soirées d'un organisateur : menées, partenaire, ou co-hébergées. */
export const orgEventsOr = (organizerUserId: string) =>
  `organizer_user_id.eq.${organizerUserId},partner_organizer_id.eq.${organizerUserId},cohost_org_ids.cs.{${organizerUserId}}`;

/** Soirées qu'un organisateur MÈNE ou dont il est partenaire (pas co-hôte). */
export const orgOwnEventsOr = (organizerUserId: string) =>
  `organizer_user_id.eq.${organizerUserId},partner_organizer_id.eq.${organizerUserId}`;

/** Soirées qu'un club MÈNE ou dont il est partenaire (pas co-hôte). */
export const venueOwnEventsOr = (venueId: string) =>
  `venue_id.eq.${venueId},partner_venue_id.eq.${venueId}`;

/** Soirées d'un club : menées, partenaire, ou co-hébergées. */
export const venueEventsOr = (venueId: string) =>
  `venue_id.eq.${venueId},partner_venue_id.eq.${venueId},cohost_venue_ids.cs.{${venueId}}`;

// ── RPC ───────────────────────────────────────────────────────────────────────
// Les nouvelles RPC ne sont pas encore dans les types générés.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args);

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const getEventCoorg = (eventId: string) => call<CoorgState>('get_event_coorg', { p_event_id: eventId });

export const searchCoorgPartners = (query: string) =>
  call<CoorgPartnerCandidate[]>('search_coorg_partners', { p_query: query, p_limit: 12 });

export const inviteEventCohost = (p: {
  eventId: string; organizerUserId?: string | null; venueId?: string | null;
  access: CohostAccess; shareCrm: boolean; message?: string;
}) => call<string>('invite_event_cohost', {
  p_event_id: p.eventId,
  p_organizer_user_id: p.organizerUserId ?? null,
  p_venue_id: p.venueId ?? null,
  p_access: p.access,
  p_share_crm: p.shareCrm,
  p_message: p.message ?? null,
});

export const respondCohostInvitation = (cohostId: string, accept: boolean) =>
  call<string>('respond_event_cohost_invitation', { p_cohost_id: cohostId, p_accept: accept });

export const updateEventCohost = (cohostId: string, access?: CohostAccess, shareCrm?: boolean) =>
  call<void>('update_event_cohost', { p_cohost_id: cohostId, p_access: access ?? null, p_share_crm: shareCrm ?? null });

export const endEventCohost = (cohostId: string) => call<string>('end_event_cohost', { p_cohost_id: cohostId });

export const getMyCohostInvitations = (scope: CoorgScope) =>
  call<CohostInvite[]>('get_my_cohost_invitations', scopeArgs(scope));

export const getMyCoorgEvents = (scope: CoorgScope) => call<CoorgEventRow[]>('get_my_coorg_events', scopeArgs(scope));

export const getMyCoorgPartners = (scope: CoorgScope) => call<CoorgPartnerRow[]>('get_my_coorg_partners', scopeArgs(scope));

export const saveCoorgDeal = (
  eventId: string, shares: Record<string, number>, formal: boolean, clauses?: string, paymentTermsDays: PaymentTermsDays = 15,
) =>
  call<CoorgDeal>('save_coorg_deal', {
    p_event_id: eventId, p_shares: shares, p_formal: formal, p_clauses: clauses ?? null,
    p_payment_terms_days: paymentTermsDays,
  });

/** On signe la version LUE : une proposition arrivée entre-temps lève `stale_version`. */
export const signCoorgDeal = (eventId: string, party: string, version?: number) =>
  call<CoorgDeal>('sign_coorg_deal', {
    p_event_id: eventId, p_party: party, p_ip: null,
    p_ua: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    p_version: version ?? null,
  });

export const cancelCoorgDeal = (eventId: string) => call<void>('cancel_coorg_deal', { p_event_id: eventId });

export const addCoorgLedgerLine = (p: {
  eventId: string; party: string; kind: 'revenue' | 'expense'; label: string; amount: number; category?: string; note?: string;
}) => call<string>('add_coorg_ledger_line', {
  p_event_id: p.eventId, p_party: p.party, p_kind: p.kind, p_label: p.label, p_amount: p.amount,
  p_category: p.category ?? 'other', p_note: p.note ?? null,
});

export const voidCoorgLedgerLine = (lineId: string) => call<void>('void_coorg_ledger_line', { p_line_id: lineId });

/** On valide les chiffres LUS (empreinte) : s'ils ont bougé, `figures_changed`. */
export const approveCoorgSettlement = (eventId: string, party: string, version: number, fingerprint?: string | null) =>
  call<{ status: string }>('approve_coorg_settlement', {
    p_event_id: eventId, p_party: party, p_version: version, p_fingerprint: fingerprint ?? null,
  });

export const setCoorgTransferIban = (transferId: string, iban: string) =>
  call<void>('set_coorg_transfer_iban', { p_transfer_id: transferId, p_iban: iban });

export const declareCoorgTransferSent = (transferId: string, reference?: string) =>
  call<void>('declare_coorg_transfer_sent', { p_transfer_id: transferId, p_reference: reference ?? null });

export const nudgeCoorgTransfer = (transferId: string) =>
  call<void>('nudge_coorg_transfer', { p_transfer_id: transferId });

// ── Super admin : virements en retard ou contestés ─────────────────────────

export interface CoorgTransferIssue {
  id: string;
  event_id: string;
  event_title: string | null;
  event_date: string | null;
  from: string;
  to: string;
  from_name: string | null;
  to_name: string | null;
  amount: number;
  reference: string;
  status: 'pending' | 'disputed';
  due_at: string | null;
  sent_at: string | null;
  sent_reference: string | null;
  disputed_at: string | null;
  dispute_reason: string | null;
  reminder_count: number;
  days_late: number | null;
}

export const adminCoorgTransferIssues = () => call<CoorgTransferIssue[]>('admin_coorg_transfer_issues', {});

export const adminResolveCoorgTransfer = (transferId: string, outcome: 'received' | 'cancelled', note: string) =>
  call<void>('admin_resolve_coorg_transfer', { p_transfer_id: transferId, p_outcome: outcome, p_note: note });

export const confirmCoorgTransfer = (transferId: string, received: boolean, reason?: string) =>
  call<void>('confirm_coorg_transfer', { p_transfer_id: transferId, p_received: received, p_reason: reason ?? null });

// ── Public : page soirée et checkout ─────────────────────────────────────────

export interface EventPresenter {
  kind: PartyKind;
  name: string;
  slug: string | null;
  avatar_url: string | null;
  venue_id: string | null;
  organizer_user_id: string | null;
  role: PartyRole;
}

export const getEventPresenters = (eventId: string) =>
  call<EventPresenter[]>('get_event_presenters', { p_event_id: eventId });

export const followEventHosts = (eventId: string) => call<number>('follow_event_hosts', { p_event_id: eventId });

export const followsAllEventHosts = (eventId: string) =>
  call<boolean>('follows_all_event_hosts', { p_event_id: eventId });

export interface MarketingHost {
  key: string;
  kind: PartyKind;
  venue_id: string | null;
  organizer_user_id: string | null;
  name: string;
  role: PartyRole;
}

export const getEventMarketingHosts = (eventId: string) =>
  call<MarketingHost[]>('get_event_marketing_hosts', { p_event_id: eventId });

/**
 * Nom du destinataire du consentement : TOUS les hôtes qui partagent le CRM,
 * joints à la façon de la langue (« A, B et C »). La case nomme chacun —
 * un consentement qui ne nomme pas son destinataire ne couvre personne.
 */
export function joinHostNames(names: string[], language: string): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] ?? '';
  try {
    // Intl.ListFormat (ES2021) n'est pas dans la lib TS du projet.
    const LF = (Intl as unknown as { ListFormat: new (l: string, o: object) => { format: (x: string[]) => string } }).ListFormat;
    return new LF(language || 'en', { style: 'long', type: 'conjunction' }).format(clean);
  } catch {
    return clean.join(', ');
  }
}

/**
 * Verse le consentement coché au checkout dans le registre de chaque co-hôte
 * nommé. À appeler APRÈS la création de la vente / de l'inscription : le
 * serveur n'agit que si une ligne récente de cette adresse sur cette soirée
 * porte la case cochée. Best-effort : ne bloque jamais un achat.
 */
/**
 * Verse l'accord coché aux co-hôtes NOMMÉS. `proof` = ce que le checkout vient
 * de rendre à CE navigateur (session Stripe `cs_…`, id ou QR de la vente) : le
 * serveur ne verse rien sans elle. Une session pas encore payée laisse une
 * intention, consommée au paiement.
 */
export async function shareCheckoutConsent(p: {
  eventId: string; email: string; wording: string; locale: string; source: string; hostKeys: string[];
  proof: string | null | undefined;
}): Promise<void> {
  if (!p.proof || p.hostKeys.length === 0) return;
  try {
    await rpc('share_event_marketing_consent', {
      p_event_id: p.eventId,
      p_email: p.email,
      p_wording: p.wording,
      p_locale: p.locale,
      p_source: p.source,
      p_host_keys: p.hostKeys,
      p_proof: p.proof,
    });
  } catch (err) {
    console.error('[coorg] consentement co-hôtes non versé', err);
  }
}

/** Code d'erreur serveur lisible (message brut d'un RAISE EXCEPTION). */
export function coorgErrorCode(err: unknown): string {
  const msg = (err as { message?: string })?.message ?? String(err ?? '');
  return msg.split(' ')[0].trim();
}

export const eur = (n: number | null | undefined, language = 'fr') =>
  new Intl.NumberFormat(language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR', {
    style: 'currency', currency: 'EUR',
  }).format(Number(n ?? 0));
