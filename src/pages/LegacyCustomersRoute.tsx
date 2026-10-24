/**
 * L'ancienne page Clients (`…/customers`) ne sert plus qu'aux trois listes
 * que la nouvelle (`…/clients`, copie du CRM) n'a pas : mineurs, clients
 * avertis, origines. Toute autre adresse de l'ancienne page (tous, top, sans
 * onglet) renvoie sur la nouvelle : un seul « Clients » dans la Console.
 */
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

const KEPT_TABS = new Set(['minors', 'warned', 'origins']);

export default function LegacyCustomersRoute({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  const tab = new URLSearchParams(search).get('tab');
  if (tab && KEPT_TABS.has(tab)) return <>{children}</>;
  return <Navigate to={pathname.replace(/\/customers\/?$/, '/clients')} replace />;
}
