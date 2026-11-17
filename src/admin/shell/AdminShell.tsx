/**
 * La coquille unique de l'admin : barre latérale (huit rubriques), en-tête
 * (fil d'Ariane, ⌘K, cloche, démo, thème), et la zone de page. Elle porte
 * `[data-admin]` (les variables du kit) et le conteneur des portails.
 */
import { Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LogOut, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useProTheme } from '@/lib/proTheme';
import { AdminPortalContext } from '../ui/portal';
import { useAdminT } from '../ui/i18n';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { CommandPalette } from './CommandPalette';
import { PageBoundary } from './frames';
import { ShortcutsHelp, useGlobalShortcuts } from './Shortcuts';

const RAIL_KEY = 'yuno:admin:rail';
function readRail(): boolean { try { return localStorage.getItem(RAIL_KEY) === '1'; } catch { return false; } }

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

function SidebarBody({ onNavigate, rail, onRail }: { onNavigate?: () => void; rail?: boolean; onRail?: () => void }) {
  const { t } = useAdminT();
  const signOut = async () => {
    await supabase.auth.signOut({ scope: 'local' });
    window.location.assign('/admin/login');
  };
  return (
    <div className="flex h-full flex-col">
      <div className={`flex h-12 flex-none items-center gap-2 border-b ${rail ? 'justify-center px-2' : 'px-4'}`}>
        <Link to="/" className="grid h-6 w-6 flex-none place-items-center rounded-md text-[12px] font-bold no-underline" title={t('adm.shell.backToYuno')}
          style={{ background: 'var(--a-text)', color: 'var(--a-bg)' }}>Y</Link>
        {!rail && <span className="a-t1 flex-1 text-[13.5px] font-semibold">{t('adm.shell.title')}</span>}
        {onNavigate && <button type="button" className="a-btn a-btn--ghost a-btn--icon" onClick={onNavigate} aria-label={t('adm.ui.close')}><X className="h-4 w-4" /></button>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto"><Sidebar onNavigate={onNavigate} rail={rail} /></div>
      <div className={`flex flex-none gap-1 border-t p-2 ${rail ? 'flex-col items-center' : 'items-center'}`}>
        <button type="button" onClick={() => void signOut()} className={`a-btn a-btn--ghost ${rail ? 'a-btn--icon' : 'flex-1 justify-start'}`} title={t('adm.shell.signOut')} aria-label={t('adm.shell.signOut')}>
          <LogOut className="h-4 w-4" />{!rail && t('adm.shell.signOut')}
        </button>
        {onRail && (
          <button type="button" onClick={onRail} className="a-btn a-btn--ghost a-btn--icon" title={`${t(rail ? 'adm.shell.railOpen' : 'adm.shell.railClose')} ( [ )`} aria-label={t(rail ? 'adm.shell.railOpen' : 'adm.shell.railClose')}>
            {rail ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [rail, setRail] = useState(readRail);
  const toggleRail = useCallback(() => setRail((v) => {
    try { localStorage.setItem(RAIL_KEY, v ? '0' : '1'); } catch { /* stockage refusé */ }
    return !v;
  }), []);
  const openHelp = useCallback(() => setHelp(true), []);
  useGlobalShortcuts({ onHelp: openHelp, onRail: toggleRail });

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
      <aside className={`fixed inset-y-0 left-0 z-30 hidden border-r transition-[width] duration-150 lg:block ${rail ? 'w-[56px]' : 'w-[240px]'}`} style={{ background: 'var(--a-panel)', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <SidebarBody rail={rail} onRail={toggleRail} />
      </aside>
      {menu && (
        <div className="fixed inset-0 z-[80] lg:hidden">
          <div className="absolute inset-0" style={{ background: 'var(--a-overlay)' }} onClick={() => setMenu(false)} />
          <aside className="absolute inset-y-0 left-0 w-[280px] border-r" style={{ background: 'var(--a-panel)', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            <SidebarBody onNavigate={() => setMenu(false)} />
          </aside>
        </div>
      )}
      <div className={`flex min-w-0 flex-1 flex-col transition-[padding] duration-150 ${rail ? 'lg:pl-[56px]' : 'lg:pl-[240px]'}`}>
        <Topbar onMenu={() => setMenu(true)} onSearch={() => setPalette(true)} />
        <main className="min-w-0 flex-1">
          <PageBoundary resetKey={pathname}>
            <Suspense fallback={<PageLoading />}>{children}</Suspense>
          </PageBoundary>
        </main>
      </div>
      <CommandPalette open={palette} onOpenChange={setPalette} />
      <ShortcutsHelp open={help} onOpenChange={setHelp} />
    </div>
  );
}
