/**
 * Coquille de la Console Yuno CRM (/crm) : garde d'accès, portée de l'espace,
 * polices et dictionnaire du CRM, menu latéral + barre du haut, portail des
 * fenêtres et toast. Les éditeurs plein écran (Studio, envoi, composeur SMS)
 * prennent `CrmBareLayout` : même portée, sans menu.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import '@/crm/styles/crm.css';
import { useAuth } from '@/hooks/useAuth';
import { useLocaleSection } from '@/contexts/LanguageContext';
import { DashboardModeProvider } from '@/contexts/DashboardModeContext';
import { RequireMFA } from '@/components/RequireMFA';
import { CrmScopeProvider, useCrmSpaces } from '@/crm/scope';
import type { CrmSpace } from '@/crm/scope';
import { useCrmScope } from '@/crm/scope';
import { CrmToastProvider } from '@/crm/ui/kit';
import { useCrmShell } from '@/crm/data/shell';
import { useCrmT } from '@/crm/i18n';
import { YunitFace } from '@/crm/ui/YunitFace';
import type { YunitMood } from '@/crm/ui/YunitFace';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { screenFor } from './nav';

const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap';

function useCrmDocument() {
  useEffect(() => {
    if (!document.getElementById('yc-fonts')) {
      const pre = document.createElement('link');
      pre.rel = 'preconnect'; pre.href = 'https://fonts.gstatic.com'; pre.crossOrigin = 'anonymous';
      document.head.appendChild(pre);
      const l = document.createElement('link');
      l.id = 'yc-fonts'; l.rel = 'stylesheet'; l.href = FONTS_HREF;
      document.head.appendChild(l);
    }
    const html = document.documentElement;
    const prevBg = html.style.background;
    const prevBodyBg = document.body.style.background;
    html.style.background = '#FCFAF9';
    document.body.style.background = '#FCFAF9';
    return () => { html.style.background = prevBg; document.body.style.background = prevBodyBg; };
  }, []);
}

function Splash() {
  return (
    <div className="yc yc-page-bg" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <YunitFace mood="content" size={56} />
    </div>
  );
}

function NoSpace() {
  const { t } = useCrmT();
  return (
    <div className="yc yc-page-bg" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center', maxWidth: 380 }}>
        <YunitFace mood="inquiet" size={64} />
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em' }}>{t('yc.common.noAccess')}</span>
        <a href="/" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>yunoapp.eu</a>
      </div>
    </div>
  );
}

/** Garde + portée : qui entre, et dans quel espace. */
export function CrmGate({ children }: { children: ReactNode }) {
  useCrmDocument();
  const location = useLocation();
  const { user, loading } = useAuth();
  const ready = useLocaleSection('crm');
  const spaces = useCrmSpaces();

  if (loading) return <Splash />;
  if (!user) return <Navigate to="/auth" replace state={{ from: location }} />;
  if (!ready || spaces.isLoading) return <Splash />;
  if (spaces.isError || !spaces.data?.length) return <NoSpace />;
  return (
    <CrmScopeProvider spaces={spaces.data}>
      <SpaceGuards>{children}</SpaceGuards>
    </CrmScopeProvider>
  );
}

function SpaceGuards({ children }: { children: ReactNode }) {
  const { space } = useCrmScope();
  const inner = (
    <DashboardModeProvider mode={space.kind === 'org' ? 'organizer' : 'owner'}>
      <CrmToastProvider>{children}</CrmToastProvider>
    </DashboardModeProvider>
  );
  // Le titulaire d'un club protège ses données par la double authentification,
  // comme dans la Suite (report de 7 jours compris).
  if (space.kind === 'venue' && space.role === 'owner') return <RequireMFA requiredRole="owner">{inner}</RequireMFA>;
  return inner;
}

function useCompact(): [boolean, () => void] {
  const [compact, setCompact] = useState<boolean>(() => {
    try { return localStorage.getItem('yuno.sidebar') === '1'; } catch { return false; }
  });
  const toggle = () => setCompact((c) => {
    const n = !c;
    try { localStorage.setItem('yuno.sidebar', n ? '1' : '0'); } catch { /* préférence perdue : sans gravité */ }
    return n;
  });
  return [compact, toggle];
}

function useNarrow(px = 900) {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < px);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < px);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [px]);
  return narrow;
}

export function moodFor(balance: number | null, low: number): YunitMood {
  if (balance === null) return 'content';
  if (balance <= 0) return 'endormi';
  if (balance < low) return 'inquiet';
  return 'content';
}

/** La Console avec menu (28 écrans du design). */
export function CrmLayout() {
  const { pathname } = useLocation();
  const shell = useCrmShell();
  const [compact, toggleCompact] = useCompact();
  const narrow = useNarrow();
  const [mobileOpen, setMobileOpen] = useState(false);
  const current = screenFor(pathname);
  const balance = shell.data?.wallet.balance ?? null;
  const mood = moodFor(balance, shell.data?.wallet.low_balance ?? 2000);
  const badges = shell.data?.badges ?? { campaigns: 0, clients: 0 };

  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  const sidebar = (
    <Sidebar
      current={current}
      compact={narrow ? false : compact}
      onToggleCompact={narrow ? () => setMobileOpen(false) : toggleCompact}
      badges={badges}
      yunits={balance}
      mood={mood}
      onNavigate={() => setMobileOpen(false)}
    />
  );

  return (
    <div className="yc yc-page-bg" style={{ display: 'flex', minHeight: '100vh' }}>
      {!narrow && <div style={{ position: 'sticky', top: 0, height: '100vh', zIndex: 30 }}>{sidebar}</div>}
      {narrow && mobileOpen && (
        <>
          <div onClick={() => setMobileOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(28,21,23,.32)', animation: 'yc-fade 200ms both' }} />
          <div style={{ position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 81, boxShadow: 'var(--shadow-md)', animation: 'yc-slide-in 260ms var(--ease-out) both' }}>{sidebar}</div>
        </>
      )}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 40 }}>
          <TopBar shell={shell.data} showMenuButton={narrow} onOpenMenu={() => setMobileOpen(true)} />
        </div>
        <Outlet />
      </div>
      <div id="yc-portal" className="yc" />
    </div>
  );
}

/** Éditeurs plein écran : sans menu, retour vers les campagnes. */
export function CrmBareLayout() {
  return (
    <div className="yc yc-page-bg" style={{ minHeight: '100vh' }}>
      <Outlet />
      <div id="yc-portal" className="yc" />
    </div>
  );
}

/** Coquille publique (Tarifs) : polices et dictionnaire du CRM, sans compte. */
export function CrmPublicShell({ children }: { children: ReactNode }) {
  useCrmDocument();
  const ready = useLocaleSection('crm');
  if (!ready) return <Splash />;
  return (
    <div className="yc" style={{ minHeight: '100vh', background: 'var(--paper)' }}>
      <CrmToastProvider>{children}</CrmToastProvider>
      <div id="yc-portal" className="yc" />
    </div>
  );
}

export type { CrmSpace };
