/**
 * Le SMS de Yuno CRM est en bêta privée, ouvert compte par compte par
 * l'équipe Yuno (migration 20261029100000, `crm_sms_access`). La Console lit
 * l'état de SON compte ici ; le serveur refuse de son côté tout test ou envoi
 * d'un compte non ouvert (send-sms-campaign, `crm_sms_access_required`).
 *
 * Tant que la lecture n'est pas revenue, le SMS est traité comme fermé : un
 * écran ne s'ouvre jamais « par défaut ».
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';
import type { SmsAccess, SmsAccessRequest, SmsAccessStatus } from '@/crm/lib/smsAccess';

export { SMS_USE_CASES, SMS_VOLUMES, smsAccessSteps } from '@/crm/lib/smsAccess';
export type { SmsAccess, SmsAccessRequest, SmsAccessStatus, SmsAccessStep, SmsStepState, SmsUseCase, SmsVolume } from '@/crm/lib/smsAccess';

export function useSmsAccess() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  const key = ['crm', qk, 'sms-access'];
  const q = useQuery({
    queryKey: key,
    queryFn: () => rpc<SmsAccess>('crm_sms_access_get', args),
    staleTime: 60_000,
  });
  const m = useMutation({
    mutationFn: (r: SmsAccessRequest) => rpc<SmsAccess>('crm_sms_access_request', {
      ...args,
      p_use_cases: r.useCases,
      p_volume: r.volume,
      p_sender_wish: r.senderWish.trim() || null,
      p_note: r.note.trim() || null,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const status: SmsAccessStatus = q.data?.status ?? 'none';
  return {
    data: q.data,
    status,
    /** Écrans SMS ouverts pour ce compte. */
    open: status === 'granted',
    loaded: q.isSuccess,
    error: q.error,
    refetch: q.refetch,
    request: m.mutateAsync,
    pending: m.isPending,
  };
}
