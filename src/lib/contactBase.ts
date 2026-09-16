// La base de contacts vivante — vocabulaire partagé front.
//
// Le serveur (`get_contact_intelligence_overview`, `list_contact_base`,
// `export_contact_base`, `get_campaign_list_impact`) rend des statuts et des
// origines en clés stables ; c'est ici qu'on les traduit, qu'on les colore et
// qu'on met en forme un bilan de campagne. Rien ici n'est un calcul métier :
// les statuts sont posés par `refresh_contact_engagement`, les écarts par
// segment viennent des deux photos (baseline / current) de la campagne.

export type EngagementStatus = 'active' | 'passive' | 'silent' | 'new' | 'unreachable' | 'unsubscribed';
export type ContactOrigin = 'import' | 'yuno' | 'both';

export const ENGAGEMENT_STATUSES: EngagementStatus[] = ['active', 'passive', 'silent', 'new', 'unreachable', 'unsubscribed'];
export const CONTACT_ORIGINS: ContactOrigin[] = ['import', 'yuno', 'both'];

/** Couleur de chaque statut — identique partout (barre, pastille, légende). */
export const STATUS_COLOR: Record<EngagementStatus, string> = {
  active: '#34D399',
  passive: '#60A5FA',
  silent: '#A78BFA',
  new: 'rgba(255,255,255,0.28)',
  unreachable: '#FB923C',
  unsubscribed: '#FF5C63',
};

export const ORIGIN_COLOR: Record<ContactOrigin, string> = {
  import: 'rgba(255,255,255,0.45)',
  yuno: '#E8192C',
  both: '#F2B23C',
};

export interface EngagementCounts {
  active: number; passive: number; silent: number; new: number; unreachable: number; unsubscribed: number;
  sent_any?: number; total?: number;
}

export interface OriginCounts { import: number; yuno: number; both: number; with_account?: number }

export interface SegmentSnapshot { id: string; name: string; contacts: number; emails: number; phones: number }

/** Photo de la base (baseline à la fin de l'envoi, current recalculée). */
export interface BaseSnapshot {
  at?: string;
  contacts: number;
  reachable_emails?: number;
  status?: EngagementCounts;
  origin?: OriginCounts;
  segments?: SegmentSnapshot[];
  /** Photo courante seulement : où en sont les destinataires de la campagne. */
  recipients?: EngagementCounts;
  engaged?: number;
  newly_engaged?: number;
  reactivated?: number;
}

export interface SegmentDelta {
  id: string; name: string; before: number; after: number; delta: number;
  emails_before?: number; emails_after?: number;
}

/** Bilan d'une campagne sur la base, forme unique (RPC dédiée ou vue d'ensemble). */
export interface CampaignImpact {
  campaignId: string;
  name: string;
  subject: string | null;
  sentAt: string | null;
  recipients: number;
  opens: number;
  clickers: number;
  unsubscribes: number;
  bounced: number;
  complained: number;
  baseline: BaseSnapshot | null;
  baselineAt: string | null;
  current: BaseSnapshot | null;
  computedAt: string | null;
  deltas: SegmentDelta[];
}

/** Ligne de `get_contact_intelligence_overview().impacts`. */
interface OverviewImpactRow {
  campaign_id: string; name: string; subject: string | null; sent_at: string | null;
  recipients: number; opens: number; clickers: number; unsubscribes: number; bounced: number; complained: number;
  baseline: BaseSnapshot | null; baseline_at: string | null; current: BaseSnapshot | null; computed_at: string | null;
}

/** Résultat de `get_campaign_list_impact`. */
interface ImpactRpcRow {
  campaign: { id: string; name: string; subject: string | null; sent_at: string | null; recipients: number; opens: number; clickers: number; unsubscribes: number; bounced: number; complained: number };
  baseline: BaseSnapshot | null; baseline_at: string | null; current: BaseSnapshot | null; computed_at: string | null;
  deltas?: SegmentDelta[];
}

function isSnapshot(x: unknown): x is BaseSnapshot {
  return !!x && typeof x === 'object' && 'contacts' in (x as Record<string, unknown>);
}

/** Écarts par segment entre deux photos, triés par ampleur. */
export function segmentDeltas(baseline: BaseSnapshot | null, current: BaseSnapshot | null): SegmentDelta[] {
  if (!baseline?.segments || !current?.segments) return [];
  const before = new Map(baseline.segments.map((s) => [s.id, s]));
  const out: SegmentDelta[] = [];
  for (const cur of current.segments) {
    const b = before.get(cur.id);
    if (!b) continue;
    out.push({
      id: cur.id, name: cur.name, before: b.contacts, after: cur.contacts, delta: cur.contacts - b.contacts,
      emails_before: b.emails, emails_after: cur.emails,
    });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.name.localeCompare(b.name));
}

export function impactFromOverview(row: OverviewImpactRow): CampaignImpact {
  const baseline = isSnapshot(row.baseline) ? row.baseline : null;
  const current = isSnapshot(row.current) ? row.current : null;
  return {
    campaignId: row.campaign_id, name: row.name, subject: row.subject, sentAt: row.sent_at,
    recipients: Number(row.recipients || 0), opens: Number(row.opens || 0), clickers: Number(row.clickers || 0),
    unsubscribes: Number(row.unsubscribes || 0), bounced: Number(row.bounced || 0), complained: Number(row.complained || 0),
    baseline, baselineAt: row.baseline_at, current, computedAt: row.computed_at,
    deltas: segmentDeltas(baseline, current),
  };
}

export function impactFromRpc(row: ImpactRpcRow): CampaignImpact {
  const baseline = isSnapshot(row.baseline) ? row.baseline : null;
  const current = isSnapshot(row.current) ? row.current : null;
  return {
    campaignId: row.campaign.id, name: row.campaign.name, subject: row.campaign.subject, sentAt: row.campaign.sent_at,
    recipients: Number(row.campaign.recipients || 0), opens: Number(row.campaign.opens || 0), clickers: Number(row.campaign.clickers || 0),
    unsubscribes: Number(row.campaign.unsubscribes || 0), bounced: Number(row.campaign.bounced || 0), complained: Number(row.campaign.complained || 0),
    baseline, baselineAt: row.baseline_at, current, computedAt: row.computed_at,
    deltas: Array.isArray(row.deltas) && row.deltas.length > 0 ? row.deltas : segmentDeltas(baseline, current),
  };
}

/** Une ligne de `list_contact_base`. */
export interface ContactRow {
  id: string;
  email: string | null;
  phone_e164: string | null;
  first_name: string | null;
  last_name: string | null;
  origin: ContactOrigin;
  status: EngagementStatus;
  emails_sent: number;
  opens: number;
  clicks: number;
  last_opened_at: string | null;
  last_clicked_at: string | null;
  unsubscribed_at: string | null;
  bounced: boolean;
  total_spent: number | null;
  event_count: number | null;
  last_purchase_at: string | null;
  yuno_spent: number | null;
  yuno_events: number | null;
  imported_spent: number | null;
  imported_events: number | null;
  ticket_count: number;
  table_count: number;
  order_count: number;
  guest_list_count: number;
  last_seen_at: string | null;
  city: string | null;
  zone: string | null;
  country_code: string | null;
  age: number | null;
  gender: string | null;
  added_at: string | null;
  email_ok: boolean;
  phone_ok: boolean;
  has_account: boolean;
  list_import_id: string | null;
}

export type ContactSort = 'recent' | 'engaged' | 'spent' | 'events' | 'name';

export const localeOf = (language: string) => (language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR');

export function fmtN(n: number | null | undefined, language: string): string {
  return Number(n || 0).toLocaleString(localeOf(language));
}

export function fmtEuro(n: number | null | undefined, language: string): string {
  const v = Number(n || 0);
  return `${v.toLocaleString(localeOf(language), { maximumFractionDigits: v % 1 === 0 ? 0 : 2 })} €`;
}

export function fmtDate(iso: string | null | undefined, language: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(localeOf(language), { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function fmtDateTime(iso: string | null | undefined, language: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(localeOf(language), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Remplace `{k}` par sa valeur dans un libellé traduit. */
export function fill(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function displayName(r: Pick<ContactRow, 'first_name' | 'last_name' | 'email' | 'phone_e164'>): string {
  const n = [r.first_name, r.last_name].filter(Boolean).join(' ').trim();
  return n || r.email || r.phone_e164 || '—';
}
