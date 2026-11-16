/**
 * La coquille unique de l'admin : barre latérale (huit rubriques), en-tête
 * (fil d'Ariane, ⌘K, cloche, démo, thème), et la zone de page. Elle porte
 * `[data-admin]` (les variables du kit) et le conteneur des portails.
 */
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LogOut, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useProTheme } from '@/lib/proTheme';
import { AdminPortalContext } from '../ui/portal';
import { useAdminT } from '../ui/i18n';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { CommandPalette } from './CommandPalette';
import { PageBoundary } from './frames';

/** Racine `[data-admin]` : thème calé sur la préférence des dashboards pro. */
export function AdminRoot({ children }: { children: ReactNode }) {
  const { pref } = useProTheme();
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  return (
    <div data-admin="" data-admin-theme={pref === 'light' ? 'light' : 'dark'} className="min-h-[100dvh]">
      <AdminPortalContext.Provider value={portal}>{children}</AdminPortalContext.Provider>
      <div ref={setPortal} data-admin-portal="" />
    </div>
  );
}

export function PageLoading() {
  return (
    <div className="mx-auto flex max-w-[1360px] flex-col gap-4 px-5 py-8 md:px-8" aria-busy>
      <div className="a-skel h-7 w-72" />
      <div className="a-skel h-4 w-96" />
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="a-skel h-24" />)}</div>
      <div className="a-skel mt-2 h-72" />
    </div>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useAdminT();
  const signOut = async () => {
    await supabase.auth.signOut({ scope: 'local' });
    window.location.assign('/admin/login');
  };
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 flex-none items-center gap-2 border-b px-4">
        <Link to="/" className="grid h-6 w-6 place-items-center rounded-md text-[12px] font-bold no-underline" title={t('adm.shell.backToYuno')}
          style={{ background: 'var(--a-text)', color: 'var(--a-bg)' }}>Y</Link>
        <span className="a-t1 flex-1 text-[13.5px] font-semibold">{t('adm.shell.title')}</span>
        {onNavigate && <button type="button" className="a-btn a-btn--ghost a-btn--icon" onClick={onNavigate} aria-label={t('adm.ui.close')}><X className="h-4 w-4" /></button>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto"><Sidebar onNavigate={onNavigate} /></div>
      <div className="flex-none border-t p-2">
        <button type="button" onClick={() => void signOut()} className="a-btn a-btn--ghost w-full justify-start">
          <LogOut className="h-4 w-4" />{t('adm.shell.signOut')}
        </button>
      </div>
    </div>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);

  useEffect(() => { setMenu(false); }, [pathname]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((v) => !v); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  return (
    <div className="flex min-h-[100dvh]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[240px] border-r lg:block" style={{ background: 'var(--a-panel)', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <SidebarBody />
      </aside>
      {menu && (
        <div className="fixed inset-0 z-[80] lg:hidden">
          <div className="absolute inset-0" style={{ background: 'var(--a-overlay)' }} onClick={() => setMenu(false)} />
          <aside className="absolute inset-y-0 left-0 w-[280px] border-r" style={{ background: 'var(--a-panel)', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            <SidebarBody onNavigate={() => setMenu(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-[240px]">
        <Topbar onMenu={() => setMenu(true)} onSearch={() => setPalette(true)} />
        <main className="min-w-0 flex-1">
          <PageBoundary resetKey={pathname}>
            <Suspense fallback={<PageLoading />}>{children}</Suspense>
          </PageBoundary>
        </main>
      </div>
      <CommandPalette open={palette} onOpenChange={setPalette} />
    </div>
  );
}
