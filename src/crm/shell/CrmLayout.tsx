/**
 * Coquille de la Console Yuno CRM (/crm) : garde d'accès, portée de l'espace,
 * polices et dictionnaire du CRM, menu latéral + barre du haut, portail des
 * fenêtres et toast. Les éditeurs plein écran (Studio, envoi, composeur SMS)
 * prennent `CrmBareLayout` : même portée, sans menu.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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
import { useNarrow } from '@/crm/ui/useNarrow';
import type { YunitMood } from '@/crm/ui/YunitFace';
import { CrmErrorBoundary } from '@/crm/errors/CrmErrorBoundary';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { ForbiddenScreen, OfflineScreen, SignedOutScreen, useCountdown } from '@/crm/errors/ErrorScreens';
import { OfflineBar } from '@/crm/errors/OfflineBar';
import { useOnline } from '@/crm/errors/useOnline';
import { classifyLoadError, retryDelaySeconds } from '@/crm/lib/errors';
import { openCrmOffer, type ProductAccountRow } from '@/crm/lib/openCrmOffer';
import { rpc } from '@/crm/lib/rpc';
import { CrmLegalGate } from './CrmLegalGate';
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

/** Spaces impossibles à lire : hors ligne (réessai automatique) ou erreur en ligne. */
function SpacesFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const online = useOnline();
  const [tries, setTries] = useState(0);
  const left = useCountdown(retryDelaySeconds(tries), tries);
  const offline = classifyLoadError(error, online) === 'offline';
  const retry = () => { setTries((n) => n + 1); onRetry(); };
  useEffect(() => { if (offline && left === 0) retry(); }, [offline, left]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (online) onRetry(); }, [online]); // eslint-disable-line react-hooks/exhaustive-deps
  if (offline) return <OfflineScreen seconds={left} onRetry={retry} />;
  return (
    <div className="yc yc-page-bg" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <CrmLoadError error={error} onRetry={retry} />
    </div>
  );
}

/**
 * Aucun espace CRM. Le titulaire d'un compte Yuno Billetterie se voit proposer
 * d'y AJOUTER le CRM (/open/crm, essai de 14 jours) ; « Changer de compte » ne
 * fait que déconnecter. Une lecture en échec retombe sur l'écran 403 simple.
 */
function NoSpace() {
  const { user, signOut } = useAuth();
  const accounts = useQuery({
    queryKey: ['crm-open-offer', user?.id ?? null],
    enabled: !!user,
    staleTime: 60_000,
    retry: false,
    queryFn: () => rpc<ProductAccountRow[] | null>('get_my_product_accounts'),
  });
  if (accounts.isLoading) return <Splash />;
  return (
    <ForbiddenScreen
      noSpace
      email={user?.email ?? ''}
      openCrm={accounts.isError ? null : openCrmOffer(accounts.data)}
      onSwitch={() => { void signOut().finally(() => window.location.assign('/auth')); }}
    />
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
  if (!ready) return <Splash />;
  if (!user) return <SignedOutScreen path={`${location.pathname}${location.search}`} />;
  if (spaces.isLoading) return <Splash />;
  if (spaces.isError) return <SpacesFailure error={spaces.error} onRetry={() => { void spaces.refetch(); }} />;
  if (!spaces.data?.length) return <NoSpace />;
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
      <CrmToastProvider>
        {children}
        {/* Conditions Yuno CRM + accord de sous-traitance : le titulaire seul, une fois par version. */}
        <CrmLegalGate />
      </CrmToastProvider>
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

function moodFor(balance: number | null, low: number): YunitMood {
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
      {/* La colonne blanche descend jusqu'au bas de la page ; la barre, elle, reste collée en haut. */}
      {!narrow && (
        <div style={{ flex: 'none', background: '#fff', boxShadow: 'inset -1px 0 0 var(--sand-100)', zIndex: 30 }}>
          <div style={{ position: 'sticky', top: 0, height: '100vh' }}>{sidebar}</div>
        </div>
      )}
      {narrow && mobileOpen && (
        <>
          <div onClick={() => setMobileOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(28,21,23,.32)', animation: 'yc-fade 200ms both' }} />
          <div style={{ position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 81, boxShadow: 'var(--shadow-md)', animation: 'yc-slide-in 260ms var(--ease-out) both' }}>{sidebar}</div>
        </>
      )}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 40 }}>
          <TopBar shell={shell.data} showMenuButton={narrow} onOpenMenu={() => setMobileOpen(true)} />
          <OfflineBar />
        </div>
        <CrmErrorBoundary resetKey={pathname}><Outlet /></CrmErrorBoundary>
      </div>
      <div id="yc-portal" className="yc" />
    </div>
  );
}

/** Éditeurs plein écran : sans menu, retour vers les campagnes. */
export function CrmBareLayout() {
  const { pathname } = useLocation();
  return (
    <div className="yc yc-page-bg" style={{ minHeight: '100vh' }}>
      <OfflineBar />
      <CrmErrorBoundary resetKey={pathname}><Outlet /></CrmErrorBoundary>
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
