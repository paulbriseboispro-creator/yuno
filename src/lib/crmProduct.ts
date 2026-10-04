/**
 * Yuno CRM — interrupteurs et produit du compte (plan : docs/designs/YUNO_CRM_PLAN.md).
 *
 * `CRM_CONNECTORS_LIVE` ouvre à tous les pros la carte « Billetterie
 * connectée » (Réglages → Intégrations). Tant qu'il est à `false`, seuls la
 * voient : le super admin, les comptes démo (`@womber.fr`) et les comptes bêta
 * ci-dessous — exactement le modèle de `metaIntegration.ts`. Une connexion
 * Shotgun alimente le CRM du compte (soirées miroir privées, billets, accord
 * newsletter versé au registre de consentement), qu'il soit en Suite ou en CRM.
 *
 * `useAccountProduct` dit quelle Console montrer : `crm` = barre latérale,
 * accueil, routes et centre d'aide du CRM (`components/crm/crmNav.tsx`).
 *
 * Aucun secret ici : l'interface seule s'ouvre, l'autorisation reste serveur
 * (`ticketing_scope_allowed` : propriétaire du club, organisateur lui-même,
 * super admin ; `crm_scope_allowed` pour les lectures de la Console CRM).
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { isDemoEmail } from '@/lib/demoPlan';
import { useVenueContext } from '@/hooks/useVenueContext';

export const CRM_CONNECTORS_LIVE = false;

/** Comptes pros bêta (emails en minuscules). */
export const CRM_BETA_EMAILS: string[] = [
  'paul.brisebois.pro@gmail.com',
  'amoris.society@gmail.com',
];

let superAdminCache: boolean | null = null;

export function useTicketingConnectorsLive(): boolean {
  const { user } = useAuth();
  const [superAdmin, setSuperAdmin] = useState<boolean>(superAdminCache === true);

  useEffect(() => {
    if (CRM_CONNECTORS_LIVE || !user || superAdminCache !== null) return;
    let cancelled = false;
    supabase.rpc('is_super_admin').then(({ data }) => {
      superAdminCache = data === true;
      if (!cancelled) setSuperAdmin(superAdminCache);
    });
    return () => { cancelled = true; };
  }, [user]);

  if (CRM_CONNECTORS_LIVE) return true;
  if (!user) return false;
  const email = (user.email ?? '').toLowerCase();
  return superAdmin || isDemoEmail(user.email) || CRM_BETA_EMAILS.includes(email);
}

/** Où trouver l'ID organisateur et le jeton (article officiel Shotgun). */
export const SHOTGUN_TOKEN_HELP_URL =
  'https://support-pro.shotgun.live/hc/fr/articles/33561354477970-Trouvez-votre-ID-organisateur-et-votre-jeton-API';

// ── Produit du compte (Yuno CRM ou la Suite) ────────────────────────────────
// venues.product / organizer_profiles.product (migration 20261002190000) :
// c'est LUI qui choisit la Console montrée — barre latérale, accueil, pages
// ouvertes. Écrit à l'inscription ou par le super admin, jamais par le client.

export type AccountProduct = 'suite' | 'crm';

export function useAccountProductFor(scope: { venueId?: string | null; organizerUserId?: string | null }): {
  product: AccountProduct; isCrm: boolean; hasCrm: boolean; hasSuite: boolean; loading: boolean;
} {
  const venueId = scope.venueId ?? null;
  const organizerUserId = venueId ? null : (scope.organizerUserId ?? null);
  const q = useQuery({
    queryKey: ['account-product', venueId, organizerUserId],
    enabled: !!(venueId || organizerUserId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AccountProduct[]> => {
      // Produit principal d'abord, puis les produits AJOUTÉS (Billetterie ⇄ CRM,
      // migration 20261006100000). Une colonne absente ne doit rien casser.
      const read = async (cols: string) => venueId
        ? supabase.from('venues').select(cols).eq('id', venueId).maybeSingle()
        : supabase.from('organizer_profiles').select(cols).eq('user_id', organizerUserId as string).maybeSingle();
      const first = await read('product, extra_products');
      const data = first.error ? (await read('product')).data : first.data;
      const row = (data ?? null) as unknown as { product?: string; extra_products?: string[] | null } | null;
      const primary: AccountProduct = row?.product === 'crm' ? 'crm' : 'suite';
      const extra = (row?.extra_products ?? []).filter((p): p is AccountProduct => p === 'crm' || p === 'suite');
      return [primary, ...extra.filter((p) => p !== primary)];
    },
  });
  const products = q.data ?? ['suite'];
  // La Console de la Suite ne se replie en mode CRM que pour un compte CRM PUR :
  // un compte CRM qui a ouvert la Billetterie retrouve toute la Suite ici.
  const product: AccountProduct = products[0] === 'crm' && !products.includes('suite') ? 'crm' : 'suite';
  return {
    product,
    isCrm: product === 'crm',
    hasCrm: products.includes('crm'),
    hasSuite: products.includes('suite'),
    loading: !!(venueId || organizerUserId) && q.isLoading,
  };
}

/** Racine de la Console courante (club ou organisateur). */
export function useConsoleBase(): '/owner' | '/organizer-app' {
  const { mode } = useVenueContext();
  return mode === 'organizer' ? '/organizer-app' : '/owner';
}

/** Produit de la portée courante de la Console. */
export function useAccountProduct(): { product: AccountProduct; isCrm: boolean; hasCrm: boolean; hasSuite: boolean; loading: boolean } {
  const { scope, venueId, organizerUserId, loading } = useVenueContext();
  const r = useAccountProductFor(scope === 'organizer' ? { organizerUserId } : { venueId });
  return { ...r, loading: loading || r.loading };
}

// ── Limites de l'offre Yuno CRM ─────────────────────────────────────────────
// get_crm_limits : la grille de l'offre en cours (crm_plan_limits) + `plan`,
// ou null pour un compte de la Suite. Affichage seulement : les refus sont
// serveur (triggers crm_guard_*), traduits par useCrmLimitToast.

export interface CrmLimits {
  plan: 'free' | 'essential' | 'pro' | 'business';
  emails_month: number;
  sms_month: number;
  sync_minutes: number;
  members: number | null;
  automations: number | null;
  ab_resend: boolean;
  meta: boolean;
  segment_export: boolean;
  yuno_badge: boolean;
}

export function useCrmLimits(scope: { venueId?: string | null; organizerUserId?: string | null }): CrmLimits | null {
  const venueId = scope.venueId ?? null;
  const organizerUserId = venueId ? null : (scope.organizerUserId ?? null);
  const q = useQuery({
    queryKey: ['crm-limits', venueId, organizerUserId],
    enabled: !!(venueId || organizerUserId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CrmLimits | null> => {
      const { data, error } = await supabase.rpc('get_crm_limits', { p_venue_id: venueId, p_organizer_user_id: organizerUserId });
      if (error) return null;
      return (data as unknown as CrmLimits | null) ?? null;
    },
  });
  return q.data ?? null;
}
