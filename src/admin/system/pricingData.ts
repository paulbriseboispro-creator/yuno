/**
 * Lectures de Système › Offre et tarifs (hors la grille des prix, lue par
 * `useAdminPricing`) : seuil des 50 payants, e-mails du cycle de vie, analyse
 * client, « Vos clients ». Mêmes RPC que l'ex-Admin CRM, aucun calcul nouveau.
 */
import { useQuery } from '@tanstack/react-query';
import type { LifecycleCopy, LifecycleKey, LifecycleLang } from '@/crm/lib/lifecycleEmail';
import { rpc } from './data';

export interface PriceTier { tier: 'launch' | 'public'; paying: number; switch_at: number; public_active: boolean; checked_at: string | null }
export interface StripePrices { prices: Array<{ lookup_key: string; found: boolean; active: boolean; amount: number | null }>; public_active: boolean }

export function usePriceTier() {
  return useQuery({ queryKey: ['admin', 'system', 'price-tier'], staleTime: 30_000, queryFn: () => rpc<PriceTier>('crm_admin_price_tier') });
}

export interface LcEmail {
  key: LifecycleKey; family: 'onboarding' | 'billing'; enabled: boolean; enabled_at: string | null;
  copy: Record<LifecycleLang, LifecycleCopy>; sent30: number; sent: number; skipped30: number; failed30: number; last_at: string | null;
}
export interface Lifecycle {
  at: string; emails: LcEmail[];
  log: Array<{ at: string; key: LifecycleKey; scope: string; status: string; reason: string | null; name: string | null }>;
}

export function useLifecycle() {
  return useQuery({ queryKey: ['admin', 'system', 'lifecycle'], staleTime: 15_000, queryFn: () => rpc<Lifecycle>('crm_admin_lifecycle') });
}

export interface LearningOverview {
  settings: { enabled: boolean; updated_at: string; reason: string | null } | null;
  contributors: number;
  priors: Array<{ rules_version: number; family: string; variant: string; accounts: number; n: number; gain: number | null; z: number | null; status: string; published_at: string }>;
  rules: Array<{
    version: number; active: boolean; origin: 'seed' | 'proposal'; config: Record<string, unknown>;
    evidence: Record<string, { current: number; proposed: number; votes: number; accounts: number; held_out_z: number | null }> | null;
    approved_at: string | null; approved_reason: string | null; created_at: string;
  }>;
}

export function useLearning() {
  return useQuery({ queryKey: ['admin', 'system', 'learning'], staleTime: 30_000, queryFn: () => rpc<LearningOverview>('crm_admin_learning_overview') });
}
