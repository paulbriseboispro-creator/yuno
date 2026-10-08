/**
 * Le texte d'une notification CRM, composé à partir de son `kind` et de ses
 * `params` (les trois langues vivent dans le module i18n `notifications`).
 * La liste des kinds est le contrat avec get_crm_notifications : un kind
 * inconnu s'affiche avec un titre générique plutôt qu'une clé brute.
 */
import type { CrmNotif } from '@/crm/data/notifications';
import type { CrmFormatters } from '@/crm/i18n';
import type { IconName } from '@/crm/ui/Icon';
import { CRM_ROUTES } from './nav';

type T = (key: string, vars?: Record<string, string | number | null | undefined>) => string;

export const NOTIF_KINDS = [
  'send_soon', 'yunits_short', 'sync_broken', 'contacts_unreadable', 'trial_ending', 'account_paused',
  'send_done', 'send_report', 'send_blocked', 'import_done', 'sync_resolved', 'yunits_low', 'recharge_done',
  'team_joined', 'new_device', 'scenario_notify', 'night_plan_ready', 'weekly_review',
] as const;

export const NOTIF_ICON: Record<string, IconName> = {
  send_soon: 'clock', send_done: 'clock', yunits_short: 'coin', yunits_low: 'coin', recharge_done: 'coin',
  sync_broken: 'plug', sync_resolved: 'plug', contacts_unreadable: 'upload', import_done: 'upload',
  send_report: 'chart', send_blocked: 'alert', team_joined: 'users', new_device: 'shield',
  trial_ending: 'card', account_paused: 'lock', scenario_notify: 'zap', night_plan_ready: 'sparkles', weekly_review: 'chart',
};

export const NOTIF_TONE_COLORS: Record<string, [string, string]> = {
  todo: ['var(--red-50)', 'var(--red-600)'],
  warn: ['var(--amber-50)', 'var(--amber-700)'],
  ok: ['var(--green-50)', 'var(--green-700)'],
  info: ['var(--sand-100)', 'var(--sand-700)'],
};

/** Paramètres formatés (nombres groupés, dates courtes, heures). */
function fmtParams(p: CrmNotif['params'], f: CrmFormatters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p ?? {})) {
    if (v === null || v === undefined) { out[k] = ''; continue; }
    if (typeof v === 'number') { out[k] = f.n(v); continue; }
    if (/(^|_)at$/.test(k) && !Number.isNaN(Date.parse(String(v)))) {
      out[k] = f.time(String(v));
      out[`${k}_day`] = f.dShort(String(v));
      continue;
    }
    out[k] = String(v);
  }
  return out;
}

export function notifCopy(item: CrmNotif, t: T, f: CrmFormatters): { title: string; body: string; action: string | null; href: string | null } {
  const known = (NOTIF_KINDS as readonly string[]).includes(item.kind);
  const p = fmtParams(item.params, f);
  if (!known) return { title: t('yc.notif.generic.title'), body: '', action: null, href: item.href };
  // L'étape « Me prévenir » d'un scénario : le titre est le libellé choisi par le pro.
  const title = item.kind === 'scenario_notify' && p.label ? p.label : t(`yc.notif.${item.kind}.title`, p);
  // Les achats d'un bilan se calculent à part : tant qu'ils manquent, la phrase s'en passe.
  const body = item.kind === 'send_report' ? reportBody(item.params, t, f)
    : item.kind === 'scenario_notify' ? scenarioBody(item.params, t, f)
      : t(`yc.notif.${item.kind}.body`, p);
  const actionKey = `yc.notif.${item.kind}.action`;
  const action = t(actionKey);
  const href = item.href ?? defaultHref(item.kind, item.params);
  return { title, body, action: action === actionKey || !href ? null : action, href };
}

function defaultHref(kind: string, p: CrmNotif['params']): string | null {
  switch (kind) {
    case 'send_soon': return p.campaign_id ? CRM_ROUTES.emailSend(String(p.campaign_id)) : CRM_ROUTES.emailCampaigns;
    case 'yunits_short': case 'yunits_low': return CRM_ROUTES.yunits;
    case 'sync_broken': return CRM_ROUTES.connectors;
    case 'contacts_unreadable': return CRM_ROUTES.clients;
    case 'trial_ending': case 'account_paused': return CRM_ROUTES.accountSection('billing');
    case 'send_report': return p.campaign_id ? CRM_ROUTES.emailResults(String(p.campaign_id)) : CRM_ROUTES.emails;
    case 'team_joined': return CRM_ROUTES.accountSection('team');
    case 'new_device': return CRM_ROUTES.accountSection('profile');
    case 'import_done': return CRM_ROUTES.imports;
    case 'scenario_notify': return p.scenario_id ? CRM_ROUTES.scenario(String(p.scenario_id)) : `${CRM_ROUTES.automations}?tab=scenarios`;
    case 'night_plan_ready': return p.event_id ? CRM_ROUTES.nightPlan(String(p.event_id)) : CRM_ROUTES.nights;
    case 'weekly_review': return CRM_ROUTES.review;
    default: return null;
  }
}

/** Bilan d'un envoi : les clics, puis les achats s'ils sont déjà calculés, avec les bons pluriels. */
function reportBody(params: CrmNotif['params'], t: T, f: CrmFormatters): string {
  const clk = Number(params?.clickers ?? 0);
  const plural = (x: number) => (f.lang === 'fr' ? (Math.abs(x) < 2 ? 'one' : 'other') : x === 1 ? 'one' : 'other');
  const head = t(`yc.notif.sr.clk.${plural(clk)}`, { n: f.n(clk) });
  const b = params?.buyers;
  if (b === null || b === undefined) return head;
  const nb = Number(b);
  return head + t(`yc.notif.sr.buy.${nb === 0 ? 'none' : nb === 1 ? 'one' : 'other'}`, { n: f.n(nb) });
}

/** Étape « Me prévenir » : combien de personnes y sont passées, quel jour, dans quel scénario. */
function scenarioBody(params: CrmNotif['params'], t: T, f: CrmFormatters): string {
  const n = Number(params?.n ?? 0);
  const plural = f.lang === 'fr' ? (Math.abs(n) < 2 ? 'one' : 'other') : n === 1 ? 'one' : 'other';
  const day = params?.today ? t('yc.notif.scenario_notify.today') : t('yc.notif.scenario_notify.on', { d: params?.seen_at ? f.dShort(String(params.seen_at)) : '' });
  return t(`yc.notif.scenario_notify.body.${plural}`, { n: f.n(n), day, name: String(params?.name ?? '') });
}
