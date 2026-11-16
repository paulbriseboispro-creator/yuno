/**
 * Cadres des écrans HÉRITÉS, montés tels quels dans la coquille unique en
 * attendant leur réécriture (lots 1 à 6) :
 *   - SuiteFrame : les pages de l'ancien admin de la Suite (src/pages/admin),
 *     dessinées avec les variables du thème pro (`--ink`, `--sf-…`) ;
 *   - CrmFrame : les pages de l'ex-Admin CRM (src/crm/admin/pages), dessinées
 *     avec leurs propres variables (crm.css, clair seulement) : le cadre pose
 *     la classe `yc`, le portail `#yc-portal`, le toast et la section de langue.
 * Un écran réécrit avec src/admin/ui n'a besoin d'aucun cadre.
 */
import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import '@/crm/styles/crm.css';
import { useLocaleSection } from '@/contexts/LanguageContext';
import { CrmToastProvider } from '@/crm/ui/kit';
import { CrmErrorBoundary } from '@/crm/errors/CrmErrorBoundary';
import { useAdminT } from '../ui/i18n';
import { ErrorState } from '../ui/EmptyState';

export function SuiteFrame({ children }: { children: ReactNode }) {
  return <div className="min-h-full" style={{ background: 'var(--sf-000000)', color: 'rgb(var(--ink))' }}>{children}</div>;
}

const CRM_FONTS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap';

export function CrmFrame({ children }: { children: ReactNode }) {
  const ready = useLocaleSection('crm');
  const { pathname } = useLocation();
  useEffect(() => {
    if (document.getElementById('yc-fonts')) return;
    const l = document.createElement('link');
    l.id = 'yc-fonts'; l.rel = 'stylesheet'; l.href = CRM_FONTS;
    document.head.appendChild(l);
  }, []);
  if (!ready) return <div className="a-skel m-8 h-40" />;
  return (
    <div className="yc yc-page-bg min-h-full" style={{ colorScheme: 'light' }}>
      <CrmToastProvider>
        <CrmErrorBoundary resetKey={pathname}>{children}</CrmErrorBoundary>
      </CrmToastProvider>
      <div id="yc-portal" className="yc" />
    </div>
  );
}

/** Une page qui plante n'emporte pas la coquille : message + « Réessayer ». */
export class PageBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('admin page crashed', error, info.componentStack); }
  componentDidUpdate(prev: { resetKey: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (this.state.error) return <CrashMessage onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}

function CrashMessage({ onRetry }: { onRetry: () => void }) {
  const { t } = useAdminT();
  return <div className="p-8"><div className="a-card"><ErrorState body={t('adm.shell.crash')} onRetry={onRetry} /></div></div>;
}
