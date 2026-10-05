/** Instagram : lecture (crm_instagram_overview) et réponses (crm_instagram_rule_*). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';
import type { IgDestination, IgFunnel, IgPostType } from '@/crm/lib/instagram';

export interface IgRule {
  id: string; name: string; trigger: 'next_post' | 'post'; post_ref: string | null; keyword: string; also_dm: boolean; also_story: boolean;
  dm_text: string; button_label: string; public_reply: boolean; reply_variants: string[]; destination: IgDestination;
  signup_page_id: string | null; event_id: string | null; enabled: boolean; created_at: string;
  post_types: IgPostType[];
  comments: number; dms: number; clicks: number; signups: number; buyers: number; page_title: string | null; event_title: string | null;
}
export interface IgOverview {
  at: string; days: number; open: boolean; rate: number;
  account: { status: string; username: string | null } | null;
  rules: IgRule[]; funnel: IgFunnel;
  recent: { at: string; kind: string; username: string | null; channel: string | null; keyword: string }[];
}

export function useInstagram(days: 30 | 90) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({ queryKey: ['crm', qk, 'instagram', days], staleTime: 30_000, queryFn: () => rpc<IgOverview>('crm_instagram_overview', { ...args, p_days: days }) });
}

export function useInstagramMutations() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  const done = () => { void qc.invalidateQueries({ queryKey: ['crm', qk, 'instagram'] }); };
  return {
    save: useMutation({ mutationFn: (p: { id: string | null; patch: Record<string, unknown> }) => rpc<string>('crm_instagram_rule_save', { ...args, p_id: p.id, p_patch: p.patch }), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => rpc('crm_instagram_rule_delete', { ...args, p_id: id }), onSuccess: done }),
  };
}
