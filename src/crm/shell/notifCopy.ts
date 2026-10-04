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
  'team_joined', 'new_device',
] as const;

export const NOTIF_ICON: Record<string, IconName> = {
  send_soon: 'clock', send_done: 'clock', yunits_short: 'coin', yunits_low: 'coin', recharge_done: 'coin',
  sync_broken: 'plug', sync_resolved: 'plug', contacts_unreadable: 'upload', import_done: 'upload',
  send_report: 'chart', send_blocked: 'alert', team_joined: 'users', new_device: 'shield',
  trial_ending: 'card', account_paused: 'lock',
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
    if (/_at$/.test(k) && !Number.isNaN(Date.parse(String(v)))) {
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
  const title = t(`yc.notif.${item.kind}.title`, p);
  const body = t(`yc.notif.${item.kind}.body`, p);
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
    default: return null;
  }
}
