/**
 * Données de Pros › Démo : les liens d'aperçu des deux produits réunis en une
 * liste. Mêmes lectures qu'avant la réécriture :
 *   - demo_preview_links (tous les liens, Billetterie et CRM), clubs et
 *     organisateurs vitrines, demandes d'activation (showcase_claim_requests),
 *     comptes à créer (admin_demo_link_signups) ;
 *   - crm_admin_demo_links : ce que Yuno CRM sait de SES accès (contact,
 *     mot de passe gardé, invitation liée, envois), clé = id du lien.
 * Un lien CRM est donc une ligne demo_preview_links enrichie de sa partie CRM.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { rpc } from '@/crm/lib/rpc';
import { DRINKS_PILLAR_LIVE } from '@/lib/drinksPillar';
import type { TargetAccount } from '@/lib/demoSession';
import type { DemoAccess, DemoData } from '@/crm/admin/inviteData';

export const DEMO_QK = 'admin-pros-demo';

export type SignupKind = 'club' | 'organizer' | 'association';
export type Pillar = 'tickets' | 'tables' | 'guest_list' | 'drinks';
/** Pilier boissons en pause : jamais proposé au prospect (src/lib/drinksPillar.ts). */
export const PILLARS: Pillar[] = ['tickets', 'tables', 'guest_list', ...(DRINKS_PILLAR_LIVE ? (['drinks'] as Pillar[]) : [])];

export interface PreviewLinkRow {
  id: string; token: string; label: string; target_accounts: TargetAccount[] | null; language: string | null;
  is_active: boolean; expires_at: string | null; used_count: number; last_used_at: string | null; revoked_at: string | null;
  created_at: string; venue_id: string | null; organizer_user_id: string | null; venues?: { name: string } | null;
}

/** Ligne rendue par admin_demo_link_signups() : le compte préparé pour le prospect. */
export interface LinkSignup {
  link_id: string; signup_id: string; kind: SignupKind; first_name: string | null; last_name: string | null;
  email: string | null; phone: string | null; org_name: string | null; city: string | null; pillars: string[] | null;
  offer_support: boolean; steps: Record<string, unknown> | null; user_id: string | null; account_created_at: string | null;
}

export interface ShowcaseVenue { id: string; name: string; showcase_shadow_owner_id: string | null; owner_email: string | null }
export interface ShowcaseOrg { user_id: string; display_name: string }
export interface ClaimRequest {
  id: string; venue_id: string | null; organizer_user_id: string | null; requested_email: string;
  created_at: string; updated_at: string | null; venues?: { name: string } | null;
}

/** État d'un lien, évalué dans cet ordre : coupé, compte créé, expiré, ouvert, prêt. */
export type DemoState = 'cut' | 'created' | 'expired' | 'opened' | 'ready';
export type SignupStage = 'ready' | 'opened' | 'started' | 'created';

export interface DemoRow {
  id: string; token: string; label: string; targets: TargetAccount[]; language: string;
  expires_at: string | null; used_count: number; last_used_at: string | null; created_at: string;
  venue_id: string | null; organizer_user_id: string | null; showcase: string | null;
  products: ('tickets' | 'crm')[];
  crm: DemoAccess | null;
  signup: LinkSignup | null;
  state: DemoState;
  url: string;
  /** Le mot de passe n'est relisible que pour un accès géré par Yuno CRM. */
  password: string | null;
}

const APP_BASE = (import.meta.env.VITE_APP_BASE_URL as string | undefined) ?? (typeof window !== 'undefined' ? window.location.origin : '');
export const previewUrl = (token: string) => `${APP_BASE}/preview?token=${token}`;

/** Où en est le prospect : préparé → démo ouverte → inscription commencée → compte créé. */
export function signupStage(s: LinkSignup): SignupStage {
  if (s.user_id) return 'created';
  const steps = s.steps ?? {};
  if ('account' in steps) return 'started';
  if ('demo_opened' in steps) return 'opened';
  return 'ready';
}

export function demoState(l: Pick<PreviewLinkRow, 'is_active' | 'revoked_at' | 'expires_at' | 'used_count'>, signup: LinkSignup | null, now = Date.now()): DemoState {
  if (!l.is_active || l.revoked_at) return 'cut';
  if (signup?.user_id) return 'created';
  if (l.expires_at && new Date(l.expires_at).getTime() < now) return 'expired';
  if (l.used_count > 0) return 'opened';
  return 'ready';
}

export function isLive(s: DemoState): boolean {
  return s === 'ready' || s === 'opened';
}

export interface DemoPayload {
  rows: DemoRow[];
  showcaseVenues: ShowcaseVenue[];
  showcaseOrgs: ShowcaseOrg[];
  claims: ClaimRequest[];
  crmInvites: DemoData['invites'];
}

async function load(): Promise<DemoPayload> {
  const [linksRes, venuesRes, orgsRes, claimsRes, signupsRes, crm] = await Promise.all([
    supabase.from('demo_preview_links').select('*, venues(name)').order('created_at', { ascending: false }),
    supabase.from('venues').select('id, name, showcase_shadow_owner_id').not('showcase_shadow_owner_id', 'is', null).order('name'),
    supabase.from('organizer_profiles').select('user_id, display_name').eq('is_showcase_shadow', true).order('display_name'),
    supabase.from('showcase_claim_requests').select('*, venues(name)').eq('status', 'pending').order('created_at', { ascending: false }),
    supabase.rpc('admin_demo_link_signups' as never),
    rpc<DemoData>('crm_admin_demo_links'),
  ]);
  if (linksRes.error) throw linksRes.error;
  const links = (linksRes.data ?? []) as unknown as PreviewLinkRow[];
  const venues = (venuesRes.data ?? []) as unknown as { id: string; name: string; showcase_shadow_owner_id: string | null }[];
  const orgs = (orgsRes.data ?? []) as unknown as ShowcaseOrg[];
  const signupRows = Array.isArray(signupsRes.data) ? (signupsRes.data as unknown as LinkSignup[]) : [];
  const signups = new Map(signupRows.map((s) => [s.link_id, s]));
  const crmById = new Map((crm.links ?? []).map((x) => [x.id, x]));
  const orgName = new Map(orgs.map((o) => [o.user_id, o.display_name]));

  // L'e-mail du compte fantôme d'un club vitrine sert à relancer son lien builder.
  const shadowIds = venues.map((v) => v.showcase_shadow_owner_id).filter((x): x is string => !!x);
  const emails = shadowIds.length
    ? ((await supabase.from('profiles').select('id, email').in('id', shadowIds)).data ?? []) as { id: string; email: string | null }[]
    : [];
  const emailOf = new Map(emails.map((e) => [e.id, e.email]));

  const rows: DemoRow[] = links.map((l) => {
    const targets = (l.target_accounts ?? []) as TargetAccount[];
    const c = crmById.get(l.id) ?? null;
    const signup = signups.get(l.id) ?? null;
    const products: DemoRow['products'] = [];
    if (l.venue_id || l.organizer_user_id || targets.some((a) => a !== 'crm')) products.push('tickets');
    if (targets.includes('crm')) products.push('crm');
    return {
      id: l.id, token: l.token, label: l.label, targets, language: (l.language ?? 'en').toLowerCase(),
      expires_at: l.expires_at, used_count: l.used_count ?? 0, last_used_at: l.last_used_at, created_at: l.created_at,
      venue_id: l.venue_id, organizer_user_id: l.organizer_user_id,
      showcase: l.venue_id ? (l.venues?.name ?? l.venue_id) : l.organizer_user_id ? (orgName.get(l.organizer_user_id) ?? null) : null,
      products, crm: c, signup, state: demoState(l, signup),
      url: c?.url ?? previewUrl(l.token), password: c?.password ?? null,
    };
  });

  return {
    rows,
    showcaseVenues: venues.map((v) => ({ ...v, owner_email: v.showcase_shadow_owner_id ? emailOf.get(v.showcase_shadow_owner_id) ?? null : null })),
    showcaseOrgs: orgs,
    claims: (claimsRes.data ?? []) as unknown as ClaimRequest[],
    crmInvites: crm.invites ?? [],
  };
}

export function useDemo() {
  return useQuery({ queryKey: [DEMO_QK], staleTime: 15_000, queryFn: load });
}

/** Après un geste : la page Démo et l'ex-Admin CRM (même RPC) se relisent. */
export function useDemoRefresh() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: [DEMO_QK] }), qc.invalidateQueries({ queryKey: ['crm-admin'] })]);
}

/** Erreur d'une fonction edge avec son message métier (le corps d'une réponse non 2xx). */
export async function invokeEdge<T = Record<string, unknown>>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    let msg = error.message;
    try { const b = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.(); if (b?.error) msg = b.error; } catch { /* corps non JSON */ }
    throw new Error(msg);
  }
  const d = data as (T & { error?: string }) | null;
  if (d?.error) throw new Error(d.error);
  return (d ?? {}) as T;
}
