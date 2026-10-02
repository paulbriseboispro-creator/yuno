// Yuno CRM — les refus de l'offre, dits au pro. Le serveur décide (triggers
// crm_guard_* de la migration 20261002200000) et lève un code stable ; ce hook
// le reconnaît dans le message d'erreur, affiche la phrase de l'offre et
// propose d'ouvrir la page Abonnement. Il rend `false` pour toute autre
// erreur : l'appelant garde alors son message habituel.

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDashboardMode } from '@/contexts/DashboardModeContext';

const CODES = ['crm_automation_limit', 'crm_member_limit', 'crm_plan_ab_resend'] as const;
export type CrmLimitCode = (typeof CODES)[number];

export function crmLimitCode(error: unknown): CrmLimitCode | null {
  const message = typeof error === 'string' ? error : (error as { message?: unknown } | null)?.message;
  if (typeof message !== 'string') return null;
  return CODES.find((c) => message.includes(c)) ?? null;
}

const MESSAGE_KEY: Record<CrmLimitCode, string> = {
  crm_automation_limit: 'crm.limit.automation',
  crm_member_limit: 'crm.limit.member',
  crm_plan_ab_resend: 'crm.limit.abResend',
};

export function useCrmLimitToast(): (error: unknown) => boolean {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { basePath } = useDashboardMode();
  const billing = basePath === '/organizer-app' ? '/organizer-app/crm/billing' : '/owner/crm/billing';
  return useCallback((error: unknown) => {
    const code = crmLimitCode(error);
    if (!code) return false;
    toast.error(t(MESSAGE_KEY[code]), {
      action: { label: t('crm.limit.seePlans'), onClick: () => navigate(billing) },
    });
    return true;
  }, [t, navigate, billing]);
}
