/**
 * Pages d'inscription (Console › Clients) : liste, enregistrement, publication,
 * chiffres, export. Tout passe par les RPC crm_signup_* (portée vérifiée en
 * base ; publier = titulaire seul).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';
import type { FanPageData } from '@/crm/signup/FanView';

export interface SignupPageRow extends Omit<FanPageData, 'state' | 'count' | 'demo' | 'host' | 'event'> {
  id: string; status: 'draft' | 'live' | 'closed'; event_id: string | null; show_count: boolean; published_at: string | null;
  created_at: string; open: boolean; visits: number; entries: number; confirmed: number;
  event: { id: string; title: string; start_at: string; ticket_url: string | null } | null;
}
export interface SignupPagesList { at: string; can_publish: boolean; pages: SignupPageRow[] }
export interface SignupStats {
  visits: number; entries: number; confirmed: number;
  sources: { src: string; visits: number; entries: number; confirmed: number }[];
  days: { d: string; n: number }[];
  answers: Record<string, Record<string, number>>;
}

export function useSignupPages() {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'signup-pages'], staleTime: 15_000,
    // Le serveur compte les inscrits sous `n` ; la Console les lit sous `entries`.
    queryFn: async () => {
      const r = await rpc<Omit<SignupPagesList, 'pages'> & { pages: (SignupPageRow & { n?: number })[] }>('crm_signup_pages_list', args);
      return { ...r, pages: r.pages.map((x) => ({ ...x, entries: x.entries ?? x.n ?? 0 })) } as SignupPagesList;
    },
  });
}

export function useSignupStats(id: string | null) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({ queryKey: ['crm', qk, 'signup-stats', id], enabled: !!id, staleTime: 15_000, refetchInterval: 30_000,
    queryFn: () => rpc<SignupStats>('crm_signup_page_stats', { ...args, p_id: id }) });
}

export function useSignupMutations() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  const done = () => { void qc.invalidateQueries({ queryKey: ['crm', qk, 'signup-pages'] }); };
  return {
    save: useMutation({ mutationFn: (p: { id: string | null; patch: Record<string, unknown> }) => rpc<string>('crm_signup_page_save', { ...args, p_id: p.id, p_patch: p.patch }), onSuccess: done }),
    status: useMutation({ mutationFn: (p: { id: string; status: 'live' | 'closed' | 'draft' }) => rpc<string>('crm_signup_page_set_status', { ...args, p_id: p.id, p_status: p.status }), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => rpc('crm_signup_page_delete', { ...args, p_id: id }), onSuccess: done }),
    exportRows: (id: string) => rpc<{ first_name: string; email: string; phone: string | null; answers: Record<string, unknown>; src: string | null; created_at: string; confirmed_at: string }[]>('crm_signup_page_export', { ...args, p_id: id }),
  };
}

/** Les provenances proposées pour les liens et QR (le design : flyer, bar, porte, story, message privé). */
export const SIGNUP_SOURCES = ['flyer', 'bar', 'door', 'story', 'dm', 'bio'] as const;
export function signupUrl(slug: string, src?: string): string {
  const base = `${window.location.origin}/j/${slug}`;
  return src ? `${base}?src=${src}` : base;
}
