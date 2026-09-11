import { useEffect, useState, type ReactNode } from 'react';
import { Outlet, useNavigate, Link, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { isPreviewActive } from '@/contexts/PreviewModeContext';
import { useLanguage, useLocaleSection } from '@/contexts/LanguageContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Gauge, TrendingUp, Coins, Compass, Bot, Users, AtSign,
  Building2, Sparkles, Handshake, CalendarDays, BookUser, ShoppingBag, KeyRound, LifeBuoy,
  Megaphone, Bell, BellRing, MessageSquareWarning,
  Activity, Siren, ScrollText, Wine,
  LogOut, Menu, ArrowLeft, FlaskConical, type LucideIcon,
} from 'lucide-react';
import AdminSearchBar, { type AdminSearchPage } from '@/components/admin/AdminSearchBar';
import { NotificationsBell } from '@/components/NotificationsBell';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ADMIN_FEED_CONFIG } from '@/lib/notifications';
import { Wordmark } from '@/components/brand/Wordmark';
import { AdminScopeProvider, useAdminScope } from '@/components/admin/AdminScope';
import { RED, T1, T2, T3, BORDER, F_BORDER, Spinner, Toggle } from '@/components/admin/ui';

// ─── Coque du super admin ─────────────────────────────────────────────────────
// Rail gauche en quatre groupes (pilotage / acteurs / communication / système),
// recherche globale, cloche des alertes, et l'interrupteur « démo incluse »
// qui vaut pour toutes les pages (AdminScope). Le dictionnaire admin est un
// chunk à part, chargé ici et jamais par un client.

const SIDEBAR_BG = 'linear-gradient(180deg,rgba(255,255,255,.022) 0%,rgba(255,255,255,.004) 100%),#0a0a0c';

interface NavItem { title: string; path: string; icon: LucideIcon; keywords?: string; end?: boolean }
interface NavGroup { label: string; items: NavItem[] }

function useNavGroups(): NavGroup[] {
  const { t } = useLanguage();
  const item = (key: string, path: string, icon: LucideIcon, end = false): NavItem =>
    ({ title: t(`adm.nav.${key}`), path, icon, keywords: t(`adm.nav.kw.${key}`), end });
  return [
    {
      label: t('adm.nav.group.pilot'),
      items: [
        item('cockpit', '/admin', Gauge, true),
        item('growth', '/admin/growth', TrendingUp),
        item('revenue', '/admin/revenue', Coins),
        item('product', '/admin/product', Compass),
        item('ai', '/admin/ai', Bot),
        item('customers', '/admin/customers', Users),
        item('links', '/admin/links', AtSign),
      ],
    },
    {
      label: t('adm.nav.group.actors'),
      items: [
        item('venues', '/admin/venues', Building2),
        item('organizers', '/admin/organizers', Sparkles),
        item('agencies', '/admin/agencies', Handshake),
        item('events', '/admin/events', CalendarDays),
        item('people', '/admin/people', BookUser),
        item('orders', '/admin/orders', ShoppingBag),
        item('demo', '/admin/demo-access', KeyRound),
        item('support', '/admin/support', LifeBuoy),
      ],
    },
    {
      label: t('adm.nav.group.comms'),
      items: [
        item('marketing', '/admin/marketing', Megaphone),
        item('push', '/admin/push', Bell),
        item('automations', '/admin/notifications', BellRing),
        item('feedback', '/admin/feedback', MessageSquareWarning),
      ],
    },
    {
      label: t('adm.nav.group.system'),
      items: [
        item('system', '/admin/system', Activity),
        item('alerts', '/admin/alerts', Siren),
        item('audit', '/admin/audit', ScrollText),
        item('drinks', '/admin/drinks', Wine),
      ],
    },
  ];
}

function DemoScopeSwitch({ compact }: { compact?: boolean }) {
  const { t } = useLanguage();
  const { includeDemo, setIncludeDemo } = useAdminScope();
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl"
      style={{ background: includeDemo ? 'rgba(252,211,77,0.06)' : 'rgba(255,255,255,0.025)', border: `1px solid ${includeDemo ? 'rgba(252,211,77,0.3)' : BORDER}` }}
      title={t('adm.common.demoHint')}>
      <div className="flex items-center gap-2 min-w-0">
        <FlaskConical className="w-3.5 h-3.5 flex-none" style={{ color: includeDemo ? '#FCD34D' : T3 }} />
        {!compact && <span className="text-[12px] truncate" style={{ color: includeDemo ? T1 : T2 }}>{includeDemo ? t('adm.common.withDemo') : t('adm.common.realOnly')}</span>}
      </div>
      <Toggle checked={includeDemo} onChange={setIncludeDemo} />
    </div>
  );
}

function NavItemLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const location = useLocation();
  const active = item.end ? location.pathname === item.path : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
  return (
    <Link to={item.path} onClick={onNavigate}
      className="group relative flex items-center gap-2.5 px-3 py-[7px] rounded-xl transition-all duration-150"
      style={active
        ? { background: 'rgba(232,25,44,0.09)', border: '1px solid rgba(232,25,44,0.22)', boxShadow: '0 1px 0 rgba(255,255,255,.04) inset' }
        : { border: '1px solid transparent' }}>
      <item.icon className="h-[17px] w-[17px] flex-none" style={{ color: active ? RED : 'rgba(255,255,255,0.4)' }} />
      <span className="flex-1 text-[13px] truncate" style={{ color: active ? T1 : 'rgba(255,255,255,0.55)', fontWeight: active ? 600 : 500 }}>{item.title}</span>
      {active && <span className="w-1 h-4 rounded-full flex-none" style={{ background: RED, opacity: 0.85 }} />}
    </Link>
  );
}

function NavContent({ groups, onNavigate, onSignOut }: { groups: NavGroup[]; onNavigate?: () => void; onSignOut: () => void }) {
  const { t } = useLanguage();
  return (
    <>
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
        {groups.map((group) => (
          <div key={group.label} className="space-y-0.5">
            <p className="px-3 mb-1.5" style={{ color: T3, fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{group.label}</p>
            {group.items.map((item) => <NavItemLink key={item.path} item={item} onNavigate={onNavigate} />)}
          </div>
        ))}
      </nav>
      <div className="p-3 space-y-2" style={{ borderTop: `1px solid ${F_BORDER}` }}>
        <DemoScopeSwitch />
        <button onClick={onSignOut} className="flex w-full items-center gap-2.5 px-3 py-2 rounded-xl transition-all duration-150 cursor-pointer" style={{ border: '1px solid transparent', color: T3 }}>
          <LogOut className="h-[17px] w-[17px]" />
          <span className="text-[13px] font-medium">{t('adm.nav.signOut')}</span>
        </button>
      </div>
    </>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const groups = useNavGroups();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const searchPages: AdminSearchPage[] = groups.flatMap((g) => g.items);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  if (isMobile) {
    return (
      <div className="min-h-[100dvh] flex flex-col" style={{ background: '#000' }}>
        <header className="sticky top-0 z-50 flex h-14 items-center gap-3 px-4"
          style={{ borderBottom: `1px solid ${BORDER}`, background: 'rgba(10,10,12,0.92)', backdropFilter: 'blur(12px)', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
          <button onClick={() => navigate('/')} className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ color: T3 }} title={t('adm.nav.backToYuno')}>
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <Wordmark height={13} />
            <div className="text-[9.5px] font-semibold uppercase leading-none mt-1" style={{ color: RED, letterSpacing: '0.12em' }}>{t('adm.nav.title')}</div>
          </div>
          <TooltipProvider delayDuration={300}><NotificationsBell config={ADMIN_FEED_CONFIG} /></TooltipProvider>
          <button onClick={() => setSidebarOpen(true)} className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ color: T1 }}>
            <Menu className="h-5 w-5" />
          </button>
        </header>
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-72 p-0 flex flex-col border-0" style={{ background: SIDEBAR_BG, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
            <SheetHeader className="p-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
              <SheetTitle className="text-left text-base font-bold tracking-tight" style={{ color: T1 }}>{t('adm.nav.title')}</SheetTitle>
            </SheetHeader>
            <div className="px-3 pt-3"><AdminSearchBar pages={searchPages} /></div>
            <NavContent groups={groups} onNavigate={() => setSidebarOpen(false)} onSignOut={handleSignOut} />
          </SheetContent>
        </Sheet>
        <main className="flex-1" style={{ background: '#000' }}>{children}</main>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex" style={{ background: '#000' }}>
      <aside className="fixed inset-y-0 left-0 z-50 flex w-[236px] flex-col" style={{ background: SIDEBAR_BG, borderRight: `1px solid ${BORDER}`, paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="flex h-16 items-center gap-2.5 px-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <button onClick={() => navigate('/')} title={t('adm.nav.backToYuno')}
            className="flex h-8 w-8 items-center justify-center rounded-lg flex-none transition-colors cursor-pointer"
            style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${F_BORDER}`, color: T3 }}>
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <Wordmark height={14} />
            <div className="text-[9.5px] font-semibold uppercase leading-none mt-1 truncate" style={{ color: RED, letterSpacing: '0.12em' }}>{t('adm.nav.title')}</div>
          </div>
          <TooltipProvider delayDuration={300}><NotificationsBell config={ADMIN_FEED_CONFIG} /></TooltipProvider>
        </div>
        <div className="px-3 pt-3"><AdminSearchBar pages={searchPages} /></div>
        <NavContent groups={groups} onSignOut={handleSignOut} />
      </aside>
      <main className="flex-1 ml-[236px] min-w-0" style={{ background: '#000', paddingTop: 'env(safe-area-inset-top, 0px)' }}>{children}</main>
    </div>
  );
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  // Le dictionnaire admin (chunk à part) doit être là avant le premier rendu,
  // sinon la coque afficherait des clés brutes le temps du téléchargement.
  const dictReady = useLocaleSection('admin');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // L'aperçu démo (preview) ne voit jamais /admin, quel que soit le rôle
        // que porte le compte prêté.
        if (isPreviewActive()) { navigate('/', { replace: true }); return; }
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { navigate('/auth', { state: { returnTo: '/admin' } }); return; }
        const { data: isSuperAdmin, error } = await supabase.rpc('is_super_admin');
        if (error || !isSuperAdmin) { navigate('/'); return; }
        if (!cancelled) setAuthorized(true);
      } catch (e) {
        console.error('Admin auth error:', e);
        navigate('/auth', { state: { returnTo: '/admin' } });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  if (loading || !dictReady) return <Spinner full />;
  if (!authorized) return null;

  return (
    <AdminScopeProvider>
      <Shell><Outlet /></Shell>
    </AdminScopeProvider>
  );
}
