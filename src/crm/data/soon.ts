/** « Me prévenir à l'ouverture » des fonctions à venir (crm_feature_waitlist). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';

export type SoonFeature = 'instagram' | 'signup_pages';

export function useFeatureWaitlist() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['crm', qk, 'feature-waitlist'], queryFn: () => rpc<string[]>('crm_feature_waitlist_get', args), staleTime: 5 * 60_000 });
  const m = useMutation({
    mutationFn: (p: { feature: SoonFeature; on: boolean }) => rpc<boolean>('crm_feature_waitlist_set', { ...args, p_feature: p.feature, p_on: p.on }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm', qk, 'feature-waitlist'] }),
  });
  return { features: q.data ?? [], loaded: q.isSuccess, set: m.mutateAsync, pending: m.isPending };
}
