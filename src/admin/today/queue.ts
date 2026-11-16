/**
 * Règles pures de la rubrique « Aujourd'hui » (testées) : la file
 * `admin_today`, son tri par urgence, ses filtres, et le fil d'activité
 * unique qui réunit `admin_activity_feed` (Billetterie) et
 * `crm_admin_activity` (Yuno CRM).
 */

export const TODAY_FAMILIES = [
  'signup', 'lead', 'prospect', 'trial', 'sync', 'billing', 'frozen', 'silent', 'yunits', 'deletion',
  'moderation', 'feedback', 'transfer', 'alert', 'support', 'claim', 'incident',
] as const;
export type TodayFamily = (typeof TODAY_FAMILIES)[number];

/** 1 = maintenant, 2 = cette semaine, 3 = quand c'est possible. */
export type Urgency = 1 | 2 | 3;

export interface TodayMark {
  status: 'done' | 'snoozed';
  until: string | null;
  at: string;
  reason: string | null;
}

export interface TodayItem {
  family: TodayFamily;
  kind: string;
  key: string;
  name: string | null;
  subject_kind: string | null;
  subject_id: string | null;
  detail: string | null;
  at: string | null;
  due_at: string | null;
  urgency: Urgency;
  href: string;
  params: Record<string, unknown> | null;
  mark: TodayMark | null;
}

export interface TodayKpi { cur: number; prev: number }
export interface TodayPayload {
  generated_at: string;
  items: TodayItem[];
  open_urgent: number;
  kpis: { revenue: TodayKpi; mrr: TodayKpi; new_pros: TodayKpi; active: TodayKpi; buyers: TodayKpi } | null;
}

export type FamilyFilter = TodayFamily | 'all';

/** Les lignes à traiter (sans marque) ; `showMarked` y ajoute les traitées / reportées. */
export function visibleItems(items: TodayItem[], filter: FamilyFilter, showMarked: boolean): TodayItem[] {
  return items.filter((i) => (filter === 'all' || i.family === filter) && (showMarked || !i.mark));
}

export function groupByUrgency(items: TodayItem[]): { urgency: Urgency; items: TodayItem[] }[] {
  const out: { urgency: Urgency; items: TodayItem[] }[] = [];
  for (const u of [1, 2, 3] as Urgency[]) {
    const rows = items.filter((i) => i.urgency === u);
    if (rows.length) out.push({ urgency: u, items: rows });
  }
  return out;
}

/** Nombre de lignes ouvertes par famille (le filtre n'affiche que les familles présentes). */
export function familyCounts(items: TodayItem[]): { family: TodayFamily; n: number }[] {
  const c = new Map<TodayFamily, number>();
  for (const i of items) if (!i.mark) c.set(i.family, (c.get(i.family) ?? 0) + 1);
  return TODAY_FAMILIES.filter((f) => c.has(f)).map((f) => ({ family: f, n: c.get(f) ?? 0 }));
}

/** Jours entiers jusqu'à une date (négatif si dépassée), ou null. */
export function daysUntil(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - now) / 86_400_000);
}

// ── Fil d'activité unique ────────────────────────────────────────────────────

/** Ligne du fil de la Billetterie (`admin_activity_feed`). */
export interface SuiteFeedItem {
  at: string;
  kind: string;
  title: string | null;
  subtitle: string | null;
  actor: string | null;
  amount: number | null;
  ref_type: string | null;
  ref_id: string | null;
}

/** Ligne du fil de Yuno CRM (`crm_admin_activity.events`). */
export interface CrmFeedItem {
  at: string;
  k: 'signup' | 'account' | 'buy' | 'send' | 'fail' | 'admin';
  tag: string | null;
  who: string | null;
  id: string | null;
  meta: Record<string, unknown> | null;
}

export const FEED_FAMILIES = ['sales', 'pros', 'crm', 'people', 'system'] as const;
export type FeedFamily = (typeof FEED_FAMILIES)[number];

export interface FeedRow {
  id: string;
  at: string;
  family: FeedFamily;
  source: 'suite' | 'crm';
  /** Clé du libellé : `adm.today.feed.k.<kind>`. */
  kind: string;
  title: string | null;
  sub: string | null;
  amount: number | null;
  href: string | null;
  tone: 'neutral' | 'positive' | 'negative' | 'warning' | 'accent';
}

/** Pilier boissons en pause : ses lignes n'entrent pas dans le fil. */
const HIDDEN_SUITE_KINDS = new Set(['order']);

const SUITE_FAMILY: Record<string, FeedFamily> = {
  ticket: 'sales', table: 'sales', guestlist: 'sales',
  venue: 'pros', organizer: 'pros', agency: 'pros', lead: 'pros', event_created: 'pros', event_published: 'pros',
  signup: 'people', follow: 'people', unfollow: 'people', waitlist: 'people', install: 'people',
  ai_client: 'system', ai_owner: 'system', ai_agency: 'system', feedback: 'system', support: 'system', alert: 'system',
};

export function suiteFeedHref(item: Pick<SuiteFeedItem, 'ref_type' | 'ref_id' | 'title'>): string | null {
  const id = item.ref_id ? encodeURIComponent(item.ref_id) : null;
  switch (item.ref_type) {
    case 'user': return id ? `/admin/clients/${id}` : null;
    case 'organizer': return id ? `/admin/pros/org:${id}` : null;
    case 'event': return `/admin/clients/events?q=${encodeURIComponent(item.title ?? '')}`;
    case 'venue': return id ? `/admin/pros/venue:${id}` : null;
    case 'agency': return id ? `/admin/pros/agency:${id}` : '/admin/pros?type=agency';
    case 'ai': return '/admin/pilot/product?tab=ai';
    case 'lead': return '/admin/pros/prospects';
    case 'waitlist': return '/admin/comms/links';
    case 'feedback': return '/admin/today/feedback';
    case 'alert': return '/admin/today/alerts';
    case 'device': return '/admin/system';
    default: return null;
  }
}

/** Fiche unique d'un compte CRM (clé `venue:` | `org:`). */
export function crmAccountHref(key: string | null): string | null {
  if (!key) return null;
  const i = key.indexOf(':');
  return i > 0 ? `/admin/pros/${key.slice(0, i)}:${encodeURIComponent(key.slice(i + 1))}` : `/admin/pros?product=crm&open=${encodeURIComponent(key)}`;
}

export function fromSuite(item: SuiteFeedItem, i: number): FeedRow | null {
  if (HIDDEN_SUITE_KINDS.has(item.kind)) return null;
  const family = SUITE_FAMILY[item.kind] ?? 'system';
  const tone: FeedRow['tone'] = item.kind === 'alert' || item.kind === 'unfollow' ? 'negative'
    : item.kind === 'ticket' || item.kind === 'table' ? 'positive'
      : item.kind === 'feedback' ? 'warning' : 'neutral';
  return {
    id: `s:${item.at}:${item.kind}:${item.ref_id ?? i}`,
    at: item.at, family, source: 'suite', kind: item.kind,
    title: item.title, sub: item.subtitle, amount: item.amount ?? null,
    href: suiteFeedHref(item), tone,
  };
}

export function fromCrm(item: CrmFeedItem, i: number): FeedRow {
  const tone: FeedRow['tone'] = item.k === 'fail' ? 'negative' : item.k === 'buy' || item.k === 'account' ? 'positive' : item.k === 'send' ? 'accent' : 'neutral';
  const meta = item.meta ?? {};
  const sub = item.k === 'send' ? (typeof meta.name === 'string' ? meta.name : null)
    : item.k === 'fail' ? (typeof meta.error === 'string' ? meta.error : null)
      : item.k === 'admin' ? (typeof meta.reason === 'string' ? meta.reason : null) : null;
  return {
    id: `c:${item.at}:${item.k}:${item.id ?? i}`,
    at: item.at,
    family: item.k === 'signup' || item.k === 'account' ? 'pros' : 'crm',
    source: 'crm',
    kind: `crm_${item.k}${item.k === 'signup' && item.tag === 'dropped' ? '_dropped' : ''}`,
    title: item.who, sub, amount: item.k === 'buy' && typeof meta.eur === 'number' ? meta.eur : null,
    href: crmAccountHref(item.id),
    tone,
  };
}

/**
 * Le fil unique : les deux sources, du plus récent au plus ancien. Le fil de
 * la Billetterie est paginé (`suiteDone` = plus rien après la dernière page) ;
 * celui du CRM arrive d'un bloc : ses lignes plus anciennes que la dernière
 * ligne Billetterie chargée attendent la page suivante, pour que le fil ne
 * saute pas en arrière quand on charge plus.
 */
export function mergeFeed(suite: SuiteFeedItem[], crm: CrmFeedItem[], suiteDone: boolean, filter: FeedFamily | 'all' = 'all'): FeedRow[] {
  const s = suite.map(fromSuite).filter((r): r is FeedRow => r !== null);
  const oldest = suite.length ? suite[suite.length - 1].at : null;
  const c = crm.map(fromCrm).filter((r) => suiteDone || !oldest || r.at >= oldest);
  return [...s, ...c]
    .filter((r) => filter === 'all' || r.family === filter)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
