import { useState, useEffect } from 'react';
import { Outlet, useNavigate, Link, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  LayoutDashboard,
  Building2,
  BarChart3,
  Receipt,
  MessageSquareWarning,
  LogOut,
  Menu,
  Wine,
  ArrowLeft,
  Mail,
  Users,
  Bell,
  BookOpen,
  ShoppingBag,
  CreditCard,
  Sparkles,
  Link2,
  CalendarDays,
  ScrollText,
  KeyRound,
  type LucideIcon,
} from 'lucide-react';
import AdminSearchBar from '@/components/admin/AdminSearchBar';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED        = '#E8192C';
const T1         = 'rgba(255,255,255,0.96)';
const T3         = 'rgba(255,255,255,0.36)';
const BORDER     = 'rgba(255,255,255,0.085)';
const F_BORDER   = 'rgba(255,255,255,0.055)';
const SIDEBAR_BG = 'linear-gradient(180deg,rgba(255,255,255,.022) 0%,rgba(255,255,255,.004) 100%),#0a0a0c';

interface NavItem { title: string; path: string; icon: LucideIcon; }
interface NavGroup { label: string; items: NavItem[]; }

export default function AdminLayout() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navGroups: NavGroup[] = [
    {
      label: t('admin.navGroupOverview'),
      items: [
        { title: 'Dashboard', path: '/admin', icon: LayoutDashboard },
        { title: t('admin.dir.navTitle'), path: '/admin/directory', icon: BookOpen },
        { title: 'Analytics', path: '/admin/analytics', icon: BarChart3 },
      ],
    },
    {
      label: t('admin.navGroupActors'),
      items: [
        { title: 'Venues', path: '/admin/venues', icon: Building2 },
        { title: 'Événements', path: '/admin/events', icon: CalendarDays },
        { title: 'Organisateurs', path: '/admin/organizers', icon: Sparkles },
        { title: 'Affiliés', path: '/admin/affiliates', icon: Link2 },
        { title: 'Waitlist', path: '/admin/waitlist', icon: Users },
        { title: 'Accès démo', path: '/admin/demo-access', icon: KeyRound },
      ],
    },
    {
      label: t('admin.navGroupCommerce'),
      items: [
        { title: 'Commandes', path: '/admin/orders', icon: ShoppingBag },
        { title: 'Abonnements', path: '/admin/subscriptions', icon: CreditCard },
        { title: t('admin.navAccounting'), path: '/admin/accounting', icon: Receipt },
      ],
    },
    {
      label: t('admin.navGroupContent'),
      items: [
        { title: t('admin.navDrinkCatalog'), path: '/admin/drinks', icon: Wine },
        { title: 'Email Templates', path: '/admin/emails', icon: Mail },
        { title: t('admin.navPush'), path: '/admin/push', icon: Bell },
        { title: t('admin.navFeedback'), path: '/admin/feedback', icon: MessageSquareWarning },
        { title: 'Journal d\'audit', path: '/admin/audit', icon: ScrollText },
      ],
    },
  ];

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/auth', { state: { returnTo: '/admin' } }); return; }
      const { data: isSuperAdmin, error: rpcError } = await supabase.rpc('is_super_admin');
      if (rpcError || !isSuperAdmin) { navigate('/'); return; }
      setAuthorized(true);
    } catch (error) {
      console.error('Auth error:', error);
      navigate('/auth', { state: { returnTo: '/admin' } });
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center" style={{ background: '#000' }}>
        <div className="h-12 w-12 animate-spin rounded-full border-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
      </div>
    );
  }

  if (!authorized) return null;

  const isItemActive = (path: string) =>
    location.pathname === path || (path !== '/admin' && location.pathname.startsWith(path));

  const NavItemLink = ({ item }: { item: NavItem }) => {
    const active = isItemActive(item.path);
    return (
      <Link
        to={item.path}
        onClick={() => isMobile && setSidebarOpen(false)}
        className="group relative flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all duration-150"
        style={active
          ? { background: 'rgba(232,25,44,0.09)', border: '1px solid rgba(232,25,44,0.22)', boxShadow: '0 1px 0 rgba(255,255,255,.04) inset' }
          : { border: '1px solid transparent' }
        }
      >
        <item.icon className="h-[18px] w-[18px] flex-none" style={{ color: active ? RED : 'rgba(255,255,255,0.4)' }} />
        <span className="flex-1 text-[13.5px]" style={{ color: active ? T1 : 'rgba(255,255,255,0.55)', fontWeight: active ? 600 : 500 }}>
          {item.title}
        </span>
        {active && <span className="w-1 h-4 rounded-full flex-none" style={{ background: RED, opacity: 0.85 }} />}
      </Link>
    );
  };

  const NavContent = () => (
    <>
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
        {navGroups.map((group) => (
          <div key={group.label} className="space-y-0.5">
            <p className="px-3 mb-1.5" style={{ color: T3, fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {group.label}
            </p>
            {group.items.map((item) => <NavItemLink key={item.path} item={item} />)}
          </div>
        ))}
      </nav>
      <div className="p-3" style={{ borderTop: `1px solid ${F_BORDER}` }}>
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-2.5 px-3 py-2 rounded-xl transition-all duration-150 cursor-pointer"
          style={{ border: '1px solid transparent', color: T3 }}
        >
          <LogOut className="h-[18px] w-[18px]" />
          <span className="text-[13.5px] font-medium">{t('admin.signOut')}</span>
        </button>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <div className="min-h-[100dvh] flex flex-col" style={{ background: '#000' }}>
        {/* Mobile top bar */}
        <header
          className="sticky top-0 z-50 flex h-14 items-center gap-3 px-4"
          style={{ borderBottom: `1px solid ${BORDER}`, background: 'rgba(10,10,12,0.92)', backdropFilter: 'blur(12px)', paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <button onClick={() => navigate('/')} className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors" style={{ color: T3 }}>
            <ArrowLeft className="h-5 w-5" />
          </button>
          <span className="flex-1 text-lg font-bold tracking-tight" style={{ color: T1 }}>{t('admin.title')}</span>
          <button onClick={() => setSidebarOpen(true)} className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors" style={{ color: T1 }}>
            <Menu className="h-5 w-5" />
          </button>
        </header>

        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-72 p-0 flex flex-col border-0" style={{ background: SIDEBAR_BG, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
            <SheetHeader className="p-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
              <SheetTitle className="text-left text-lg font-bold tracking-tight" style={{ color: T1 }}>{t('admin.title')}</SheetTitle>
            </SheetHeader>
            <div className="px-3 pt-3">
              <AdminSearchBar />
            </div>
            <NavContent />
          </SheetContent>
        </Sheet>

        <main className="flex-1" style={{ background: '#000' }}>
          <Outlet />
        </main>
      </div>
    );
  }

  // Desktop layout
  return (
    <div className="min-h-[100dvh] flex" style={{ background: '#000' }}>
      <aside
        className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col"
        style={{ background: SIDEBAR_BG, borderRight: `1px solid ${BORDER}`, paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="flex h-16 items-center gap-2.5 px-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <button
            onClick={() => navigate('/')}
            title={t('admin.backToYuno')}
            className="flex h-8 w-8 items-center justify-center rounded-lg flex-none transition-colors"
            style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${F_BORDER}`, color: T3 }}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold tracking-tight leading-none" style={{ color: T1 }}>Yuno</div>
            <div className="text-[10px] font-semibold uppercase leading-none mt-1" style={{ color: RED, letterSpacing: '0.1em' }}>Super Admin</div>
          </div>
        </div>
        <div className="px-3 pt-3">
          <AdminSearchBar />
        </div>
        <NavContent />
      </aside>

      <main className="flex-1 ml-64" style={{ background: '#000', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <Outlet />
      </main>
    </div>
  );
}
