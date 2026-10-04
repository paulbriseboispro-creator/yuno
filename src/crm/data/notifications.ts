/**
 * Centre de notifications de la Console CRM : ce qu'il faut faire (calculé en
 * direct : envoi dans l'heure, Yunits qui manquent, synchro coupée…) et
 * l'historique (envois partis, bilans, imports, équipe, sécurité), avec l'état
 * de lecture propre à chaque personne. Textes composés côté front à partir de
 * `kind` + `params` (les trois langues).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';

export type NotifCat = 'envois' | 'donnees' | 'compte';
export type NotifTone = 'todo' | 'warn' | 'ok' | 'info';

export interface CrmNotif {
  id: string;
  kind: string;
  cat: NotifCat;
  tone: NotifTone;
  icon: string;
  need: boolean;
  lock: boolean;
  at: string;
  due_at: string | null;
  resolved: boolean;
  params: Record<string, string | number | null>;
  href: string | null;
  read: boolean;
  archived: boolean;
  snoozed_until: string | null;
}

export function useCrmNotifications(enabled = true) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'notifications'],
    queryFn: () => rpc<CrmNotif[]>('get_crm_notifications', args),
    enabled,
    staleTime: 30_000,
    refetchInterval: enabled ? 60_000 : false,
    retry: false,
  });
}

export function useCrmNotifAction() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { ids: string[]; action: 'read' | 'unread' | 'archive' | 'unarchive' | 'snooze' | 'keep'; until?: string | null }) =>
      rpc<boolean>('crm_notifications_mark', { ...args, p_ids: p.ids, p_action: p.action, p_until: p.until ?? null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm', qk, 'notifications'] });
      qc.invalidateQueries({ queryKey: ['crm', qk, 'shell'] });
    },
  });
}
