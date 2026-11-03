/**
 * L'abonnement vu par la coquille de la Console : bandeau, menu, écran de
 * pause, fenêtre de choix. Une lecture (get_crm_billing, déjà en cache pour la
 * page Abonnement), et les règles pures de `@/crm/lib/plan`.
 *
 * La fenêtre de choix s'ouvre par l'adresse (`?subscribe=1`, `?subscribe=year`) :
 * un bandeau, le menu, l'écran de pause, une notification ou un e-mail y mènent
 * tous de la même façon.
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { isDemoEmail } from '@/lib/demoPlan';
import { isPreviewActive } from '@/contexts/PreviewModeContext';
import { isSupportSessionActive } from '@/lib/supportSession';
import { useCrmBilling, type CrmBilling } from '@/crm/data/account';
import { useCrmShell } from '@/crm/data/shell';
import { useCrmScope } from '@/crm/scope';
import { useCrmT } from '@/crm/i18n';
import { rpc } from '@/crm/lib/rpc';
import { planBanner, type PlanBanner } from '@/crm/lib/plan';
import { planPreview, previewBilling, previewSummary } from './planPreview';

export interface PauseSummary {
  reason: 'trial' | 'ended' | 'grant' | 'none';
  since: string | null;
  contacts: number;
  nights: number;
  emails_sent: number;
  automations: number;
  yunits_balance: number;
  sync_provider: string | null;
  owner_first_name: string | null;
  nudged_at: string | null;
}

export interface PlanState {
  billing: CrmBilling | undefined;
  /** Première lecture en cours : la coquille attend avant de montrer une page qui pourrait être en pause. */
  loading: boolean;
  paused: boolean;
  /** Démo, aperçu, accès assisté, équipe Yuno : jamais bloqué, jamais sollicité. */
  exempt: boolean;
  /** Le titulaire (celui qui paie). */
  holder: boolean;
  banner: PlanBanner | null;
  /** Taux de TVA du vendeur (0 = TVA non applicable). */
  vat: number;
}

export function usePlan(): PlanState {
  const { user } = useAuth();
  const q = useCrmBilling();
  const shell = useCrmShell();
  const preview = planPreview();
  const b = preview ? previewBilling(q.data, preview) : q.data;
  const loading = q.isLoading;
  const exempt = !preview && (isPreviewActive() || isSupportSessionActive() || isDemoEmail(user?.email ?? '') || !!shell.data?.is_super_admin);
  return useMemo(() => {
    const sub = b?.subscription ?? null;
    return {
      billing: b,
      loading,
      paused: b?.effective_plan === 'paused',
      exempt,
      holder: !!b?.can_manage,
      banner: b && sub ? planBanner({ ...sub, offer: sub.offer ?? null }, b.effective_plan) : null,
      vat: b?.pricing.vat_rate ?? 20,
    };
  }, [b, exempt, loading]);
}

export function usePauseSummary(enabled: boolean) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'pause-summary'],
    queryFn: () => (planPreview() ? Promise.resolve(previewSummary()) : rpc<PauseSummary>('crm_pause_summary', args)),
    enabled,
    staleTime: 60_000,
  });
}

/** Ouvre (ou ferme) la fenêtre « Choisir mon abonnement » par l'adresse. */
export function useChooser(): { open: (interval?: 'month' | 'year') => void; close: () => void; value: string | null } {
  const [params, setParams] = useSearchParams();
  const value = params.get('subscribe');
  const open = useCallback((interval?: 'month' | 'year') => {
    const next = new URLSearchParams(params);
    next.set('subscribe', interval ?? '1');
    setParams(next, { replace: false });
  }, [params, setParams]);
  const close = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete('subscribe');
    setParams(next, { replace: true });
  }, [params, setParams]);
  return { open, close, value };
}

/** « 24 € HT / mois », ou « 24 € / mois » quand la TVA ne s'applique pas. */
export function usePriceLabel() {
  const { t, eur } = useCrmT();
  return useCallback((amount: number, per: 'month' | 'year', vat: number) =>
    `${eur(amount)}${vat > 0 ? ` ${t('yc.plan.c.ht')}` : ''} ${t(`yc.plan.c.per.${per}`)}`, [t, eur]);
}
