/**
 * Pages d'inscription (Console › Pages d'inscription) : liste, fiche,
 * enregistrement, publication, « Prévenir », adresses du groupe. Tout passe
 * par les RPC crm_signup_* (portée vérifiée en base ; publier = titulaire
 * seul). Règles : migration 20261007193500_crm_signup_pages_v2.sql.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';
import { CRM_ORIGIN } from '@/lib/productHost';
import type { CloseMode, SignupDesign, SignupFields, SignupKind, SignupRelance, SignupReward } from '@/crm/signup/model';

export type PageState = 'draft' | 'scheduled' | 'open' | 'closed';

export interface SignupEvent {
  id: string; title: string; start_at: string; end_at: string; tz: string;
  ticket_url: string | null; cover_url: string | null; venue: string | null; city: string | null; street: string | null;
  country: string | null; sold_out: boolean; night_date: string;
}

export interface SignupPageRow {
  id: string; slug: string; status: 'draft' | 'live' | 'closed'; state: PageState; kind: SignupKind;
  title: string; tagline: string; button_label: string; thanks_message: string; poster_url: string | null;
  design: SignupDesign; fields: SignupFields; show_count: boolean; reward: SignupReward | null;
  opens_at: string | null; sale_opens_at: string | null; closes_mode: CloseMode; closes_at: string | null; close_at: string | null;
  countdown: boolean; relance: SignupRelance; lang: 'en' | 'fr' | 'es'; notified_at: string | null;
  published_at: string | null; created_at: string; updated_at: string; event_id: string | null; event: SignupEvent | null;
  open: boolean; sale_open: boolean;
  visits: number; today_v: number; n: number; today_n: number; fresh: number; confirmed: number;
  email_n: number; sms_n: number; persons: number | null; buyers: number | null;
}

export interface SignupPagesList { at: string; can_publish: boolean; balance: number; pages: SignupPageRow[] }

export interface SignupPerson {
  first_name: string; last_name: string | null; email: string | null; phone: string | null;
  answers: Record<string, string | string[]>; party: number | null; src: string | null; at: string;
  confirmed: boolean; status: 'new' | 'client' | 'bought';
}

export interface SignupDetail {
  series: { d: string; n: number }[];
  sources: { src: string; v: number; n: number }[];
  ig_auto: number;
  people: SignupPerson[];
  reach: { all_email: number; all_sms: number; nobuy_email: number; nobuy_sms: number };
  sent: Partial<Record<'open' | 'nudge' | 'last', number>> | null;
  group_list_id: string | null;
}

export function useSignupPages() {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'signup-pages'], staleTime: 15_000, refetchInterval: 60_000,
    queryFn: () => rpc<SignupPagesList>('crm_signup_pages_list', args),
  });
}

export function useSignupDetail(id: string | null) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'signup-detail', id], enabled: !!id, staleTime: 15_000, refetchInterval: 30_000,
    queryFn: () => rpc<SignupDetail>('crm_signup_page_detail', { ...args, p_id: id }),
  });
}

export function useSignupMutations() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['crm', qk, 'signup-pages'] });
    void qc.invalidateQueries({ queryKey: ['crm', qk, 'signup-detail'] });
  };
  return {
    save: useMutation({ mutationFn: (p: { id: string | null; patch: Record<string, unknown> }) => rpc<string>('crm_signup_page_save', { ...args, p_id: p.id, p_patch: p.patch }), onSuccess: done }),
    status: useMutation({ mutationFn: (p: { id: string; status: 'live' | 'closed' | 'draft' | 'open' }) => rpc<string>('crm_signup_page_set_status', { ...args, p_id: p.id, p_status: p.status }), onSuccess: done }),
    notify: useMutation({ mutationFn: (id: string) => rpc<string>('crm_signup_page_notify_now', { ...args, p_id: id }), onSuccess: done }),
    emails: (id: string) => rpc<string[]>('crm_signup_page_emails', { ...args, p_id: id }),
  };
}

/** Le lien public d'une page, par endroit (`?src=`) : crm.yunoapp.eu (l'origine locale en développement). */
export function signupUrl(slug: string, src?: string | null): string {
  const local = typeof window !== 'undefined' && !/(^|\.)yunoapp\.eu$/.test(window.location.hostname);
  const base = `${local ? window.location.origin : CRM_ORIGIN}/j/${slug}`;
  return src ? `${base}?src=${src}` : base;
}

/** Le code d'erreur stable d'une RPC (`owner_only`, `incomplete`…) : le message levé par la fonction. */
export function rpcCode(e: unknown): string {
  return String((e as { message?: string })?.message ?? '').trim();
}
