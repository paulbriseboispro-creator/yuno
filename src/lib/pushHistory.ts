/**
 * Historique des push de la Console (club et organisateur). Tous les chiffres
 * viennent de la RPC `get_push_campaigns` (migration 20260924180000) : ce
 * module type la réponse et la met en forme. Il n'agrège jamais une vente.
 */

export type PushFilter = 'all' | 'manual' | 'auto' | 'scheduled';

export interface PushCampaignRow {
  id: string;
  title: string | null;
  body: string | null;
  templateKey: string | null;
  source: 'manual' | 'auto' | string;
  status: 'sent' | 'sending' | 'scheduled' | 'failed' | string;
  createdAt: string;
  scheduledAt: string | null;
  eventId: string | null;
  eventTitle: string | null;
  /** Abonnés ciblés au moment de l'envoi. */
  targeted: number;
  /** Acceptés par Apple (APNs) — pas une preuve de réception. */
  sent: number;
  failed: number;
  /** Personnes qui ont touché la notification (1 par personne). */
  taps: number;
  buyers: number;
  orders: number;
  entries: number;
  revenue: number | null;
}

export interface PushCampaignsPage {
  ok: true;
  money: boolean;
  total: number;
  limit: number;
  offset: number;
  summary: { campaigns: number; sent: number; taps: number; buyers: number; revenue: number | null };
  followers: { total: number; reachable: number; new30d: number };
  campaigns: PushCampaignRow[];
}

/** Part des envois qui ont été ouverts, en % arrondi ; `null` sans envoi. */
export function openRate(taps: number, sent: number): number | null {
  if (!sent || sent <= 0) return null;
  return Math.round((taps / sent) * 100);
}

/**
 * Le nom qu'un pro reconnaît. L'annonce automatique d'une soirée publiée
 * porte en base le texte envoyé (« 📅 Nouveau chez … ») ; dans l'historique
 * elle s'appelle « Publication – <soirée> », comme chez Shotgun.
 */
export function campaignLabel(row: PushCampaignRow, t: (k: string) => string): string {
  if (row.source === 'auto' && row.templateKey === 'new_event' && row.eventTitle) {
    return t('ph.publication').replace('{title}', row.eventTitle);
  }
  return row.title?.trim() || t('ph.untitled');
}

/** Part des abonnés joignables par push (app installée, notifications acceptées). */
export function reachableShare(f: PushCampaignsPage['followers']): number | null {
  if (!f.total) return null;
  return Math.round((f.reachable / f.total) * 100);
}
