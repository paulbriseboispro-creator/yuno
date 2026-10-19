/**
 * Porte des écrans SMS de la Console (bêta privée, 2026-10-19) : un compte dont
 * l'accès n'est pas ouvert voit la page de demande d'accès sur /crm/sms, et
 * toute autre adresse SMS l'y renvoie. Le serveur garde la même règle
 * (send-sms-campaign, `crm_sms_access_required`).
 */
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSmsAccess } from '@/crm/data/smsAccess';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { CRM_ROUTES } from '@/crm/shell/nav';
import SmsBetaPage from './SmsBetaPage';

export function SmsAccessGate({ children, redirect = false }: { children: ReactNode; redirect?: boolean }) {
  const access = useSmsAccess();
  if (access.error && !access.loaded) {
    return (
      <main style={{ flex: 1, width: '100%', maxWidth: 1280, margin: '0 auto', padding: 'clamp(24px,3vw,36px) clamp(16px,3vw,40px) 72px' }}>
        <CrmLoadError error={access.error} onRetry={() => void access.refetch()} />
      </main>
    );
  }
  if (!access.loaded) return null;
  if (access.open) return <>{children}</>;
  return redirect ? <Navigate to={CRM_ROUTES.sms} replace /> : <SmsBetaPage />;
}
