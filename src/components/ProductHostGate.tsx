import { useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { productHostDecision } from '@/lib/productHost';
import { goToProduct } from '@/lib/productHandoff';
import { isPreviewActive } from '@/contexts/PreviewModeContext';
import { isSupportSessionActive } from '@/lib/supportSession';

/**
 * Yuno Billetterie sur yunoapp.eu, Yuno CRM sur crm.yunoapp.eu
 * (src/lib/productHost.ts). Rejoue la décision à chaque navigation — un lien
 * de la Console CRM vers la Billetterie, un vieux lien yunoapp.eu/crm/… dans
 * un email — et n'affiche rien de la page tant qu'elle doit partir ailleurs.
 */
export function ProductHostGate({ children }: { children: ReactNode }) {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();

  const decision = useMemo(() => {
    const { hostname, port, protocol } = window.location;
    return productHostDecision(
      { hostname, port, protocol, pathname, search, hash },
      { exempt: isPreviewActive() || isSupportSessionActive() },
    );
  }, [pathname, search, hash]);

  useEffect(() => {
    if (decision.kind === 'local') navigate(decision.to, { replace: true });
    else if (decision.kind === 'cross') void goToProduct(decision.origin, decision.path);
  }, [decision, navigate]);

  if (decision.kind !== 'stay') {
    return <div aria-busy="true" style={{ minHeight: '100vh' }} />;
  }
  return <>{children}</>;
}
