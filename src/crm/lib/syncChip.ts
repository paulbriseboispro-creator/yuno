/**
 * État de la synchro billetterie montré en haut de chaque page de la Console.
 *
 * Audit du 18/10 (UI-01) : pendant le premier import, tous les chiffres sont
 * partiels, et la barre disait « synchronisé » en vert entre deux passes (une
 * passe partielle pose last_ok_at). Une connexion coupée ou en pause se lisait
 * aussi « synchronisé ». L'ordre compte : coupée, puis en pause, puis panne,
 * puis import en cours, puis passe en cours, puis à jour.
 */
import type { CrmShell } from '@/crm/data/shell';

export type SyncChip = 'none' | 'off' | 'paused' | 'broken' | 'importing' | 'running' | 'ok';

export function syncChip(conn: CrmShell['connection'] | null | undefined): SyncChip {
  if (!conn) return 'none';
  if (conn.status === 'disconnected') return 'off';
  if (conn.state === 'paused') return 'paused';
  if (conn.state === 'broken') return 'broken';
  if (!conn.initial_import_done_at) return 'importing';
  if (conn.state === 'running') return 'running';
  return 'ok';
}
