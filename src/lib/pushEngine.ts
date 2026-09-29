/**
 * Centre de notifications de la Console (club et organisateur) — le moteur de
 * notifications Yuno vu par le pro. Tous les chiffres viennent de la RPC
 * `get_push_center` (migration 20260930100000) : ce module ne fait que typer
 * la réponse et décider de l'affichage (ordre des étapes, état, textes).
 * Design : docs/designs/NOTIFICATION_ENGINE_PLAN.md.
 */

export type EngineRuleKey =
  | 'new_event'
  | 'sales_open'
  | 'last_tickets'
  | 'last_call'
  | 'checkout_abandoned'
  | 'vip_upsell'
  | 'event_day_reminder'
  | 'doors_open'
  | 'after_thanks';

export type EnginePhase = 'announce' | 'sale' | 'day' | 'after';

/** Le cycle de vie d'une soirée, dans l'ordre où le client le vit. */
export const ENGINE_RULES: ReadonlyArray<{ key: EngineRuleKey; phase: EnginePhase; emoji: string }> = [
  { key: 'new_event', phase: 'announce', emoji: '📅' },
  { key: 'sales_open', phase: 'announce', emoji: '🎟️' },
  { key: 'last_tickets', phase: 'sale', emoji: '⚡' },
  { key: 'checkout_abandoned', phase: 'sale', emoji: '🛒' },
  { key: 'vip_upsell', phase: 'sale', emoji: '🥂' },
  { key: 'last_call', phase: 'day', emoji: '🔥' },
  { key: 'event_day_reminder', phase: 'day', emoji: '🎶' },
  { key: 'doors_open', phase: 'day', emoji: '🚪' },
  { key: 'after_thanks', phase: 'after', emoji: '❤️' },
];

export const ENGINE_RULE_KEYS: ReadonlySet<string> = new Set(ENGINE_RULES.map((r) => r.key));

/** Étapes toujours attendues pour une soirée à venir (les autres dépendent des ventes). */
const EXPECTED_UPCOMING: ReadonlySet<EngineRuleKey> = new Set(['new_event', 'event_day_reminder', 'after_thanks']);

export interface PushCenterStep {
  rule: string;
  sent: number;
  taps: number;
  buyers: number;
  entries: number;
  influenced: number;
  revenue: number | null;
  queued: number;
  nextAt: string | null;
  held: number;
  boughtBefore: number;
  lastAt: string | null;
}

export interface PushCenterEvent {
  id: string;
  title: string;
  startAt: string;
  image: string | null;
  publishedAt: string | null;
  visibility: string;
  upcoming: boolean;
  announceAt: string | null;
  announced: boolean;
  canSchedule: boolean;
  parties: number;
  steps: PushCenterStep[];
}

export interface PushCenterRule {
  key: string;
  enabled: boolean;
  params: Record<string, number>;
  sent: number;
  taps: number;
  buyers: number;
  revenue: number | null;
  held: number;
  queued: number;
}

export interface PushCenterData {
  ok: true;
  money: boolean;
  days: number;
  party: string;
  summary: {
    sent: number;
    people: number;
    taps: number;
    buyers: number;
    entries: number;
    influenced: number;
    revenue: number | null;
    held: number;
    boughtBefore: number;
    queued: number;
  };
  viaMe: { multiParty: boolean; sent: number; taps: number; buyers: number };
  rules: PushCenterRule[];
  discovery: { selections: number; people: number; opened: number };
  events: PushCenterEvent[];
}

export interface PushCredits {
  ok: true;
  scope: string;
  allowance: number;
  defaultAllowance: number;
  override: boolean;
  used: number;
  bonus: number;
  remaining: number;
  resetsAt: string;
  eventInfoPerEvent: number;
  marketingPer24h: number;
  requestedToday: boolean;
}

export type StepState = 'sent' | 'sending' | 'scheduled' | 'held' | 'upcoming';

/**
 * L'état d'une étape pour le pro : envoyée (même si d'autres personnes sont
 * encore en file), en cours, programmée (date future), retenue par les règles,
 * ou à venir (rien encore).
 */
export function stepState(step: PushCenterStep | undefined, now: Date = new Date()): StepState {
  if (!step) return 'upcoming';
  if (step.sent > 0) return 'sent';
  if (step.queued > 0) {
    return step.nextAt && new Date(step.nextAt).getTime() > now.getTime() ? 'scheduled' : 'sending';
  }
  if (step.held > 0) return 'held';
  return 'upcoming';
}

export interface TimelineItem {
  rule: EngineRuleKey;
  step?: PushCenterStep;
  state: StepState;
}

/**
 * La frise d'une soirée : les étapes qui ont eu lieu, plus, pour une soirée à
 * venir, celles qui arriveront à coup sûr (annonce si pas encore partie, rappel
 * du jour J, merci). Une règle éteinte par Yuno n'apparaît que si elle a déjà
 * envoyé quelque chose. Toujours dans l'ordre du cycle de vie.
 */
export function timelineFor(
  event: Pick<PushCenterEvent, 'upcoming' | 'announced' | 'steps' | 'visibility'>,
  enabled: (rule: EngineRuleKey) => boolean,
  now: Date = new Date(),
): TimelineItem[] {
  const byRule = new Map(event.steps.map((s) => [s.rule, s]));
  const out: TimelineItem[] = [];
  for (const { key } of ENGINE_RULES) {
    const step = byRule.get(key);
    const hasData = !!step && (step.sent > 0 || step.queued > 0 || step.held > 0 || step.boughtBefore > 0);
    const expected = event.upcoming && enabled(key) && EXPECTED_UPCOMING.has(key)
      && !(key === 'new_event' && (event.announced || event.visibility !== 'public'));
    if (hasData || expected) out.push({ rule: key, step, state: stepState(step, now) });
  }
  return out;
}

/** Part des envoyés qui ont touché la notification (0-100, arrondi) ; null sans envoi. */
export function tapRate(taps: number, sent: number): number | null {
  if (!sent || sent <= 0) return null;
  return Math.round((taps / sent) * 100);
}

/** Heure affichée d'un `datetime-local` (heure locale du navigateur), ou '' si vide. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Valeur d'un `datetime-local` → ISO, ou null si vide / invalide. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Bornes de l'heure d'annonce : pas dans le passé, au plus tard 3 h avant la
 * soirée (le serveur garde `min_before_hours` + 1), et dans les 30 jours.
 */
export function announceBounds(startAt: string, now: Date = new Date()): { min: string; max: string } {
  const start = new Date(startAt).getTime();
  const max = Math.min(start - 3 * 3600_000, now.getTime() + 30 * 86400_000);
  return { min: toLocalInput(new Date(now.getTime() + 5 * 60_000).toISOString()), max: toLocalInput(new Date(max).toISOString()) };
}

/** Une campagne marketing coûte un crédit ; un message aux détenteurs d'une soirée est gratuit. */
export function campaignCost(scope: string): 0 | 1 {
  return scope === 'event_tickets' || scope === 'checked_in' ? 0 : 1;
}

/** Réglages d'une règle lus pour les phrases « quand » (valeurs par défaut du moteur). */
export function ruleParam(rule: PushCenterRule | undefined, key: string, fallback: number): number {
  const v = rule?.params?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
