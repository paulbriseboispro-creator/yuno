import { useState, useEffect } from 'react';
import { Outlet, useNavigate, Link, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
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
} from 'lucide-react';
import AdminSearchBar from '@/components/admin/AdminSearchBar';
import { cn } from '@/lib/utils';

export default function AdminLayout() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems = [
    { title: 'Dashboard', path: '/admin', icon: LayoutDashboard },
    { title: t('admin.dir.navTitle'), path: '/admin/directory', icon: BookOpen },
    { title: 'Venues', path: '/admin/venues', icon: Building2 },
    { title: 'Organisateurs', path: '/admin/organizers', icon: Sparkles },
    { title: 'Affiliés', path: '/admin/affiliates', icon: Link2 },
    { title: 'Commandes', path: '/admin/orders', icon: ShoppingBag },
    { title: 'Abonnements', path: '/admin/subscriptions', icon: CreditCard },
    { title: 'Waitlist', path: '/admin/waitlist', icon: Users },
    { title: t('admin.navDrinkCatalog'), path: '/admin/drinks', icon: Wine },
    { title: 'Email Templates', path: '/admin/emails', icon: Mail },
    { title: 'Analytics', path: '/admin/analytics', icon: BarChart3 },
    { title: t('admin.navAccounting'), path: '/admin/accounting', icon: Receipt },
    { title: t('admin.navFeedback'), path: '/admin/feedback', icon: MessageSquareWarning },
    
    { title: t('admin.navPush'), path: '/admin/push', icon: Bell },
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
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!authorized) return null;

  const NavContent = () => (
    <>
      <nav className="flex-1 py-4 px-2 space-y-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path || 
            (item.path !== '/admin' && location.pathname.startsWith(item.path));
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => isMobile && setSidebarOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors",
                isActive 
                  ? "bg-primary text-primary-foreground" 
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="h-5 w-5 flex-shrink-0" />
              <span className="font-medium">{item.title}</span>
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-border">
        <Button
          variant="ghost"
          className="w-full justify-start text-muted-foreground hover:text-foreground"
          onClick={handleSignOut}
        >
          <LogOut className="h-5 w-5" />
          <span className="ml-3">{t('admin.signOut')}</span>
        </Button>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-background">
        {/* Mobile top bar */}
        <header
          className="sticky top-0 z-50 flex h-14 items-center gap-3 border-b border-border bg-surface px-4"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <span className="text-lg font-bold text-primary flex-1">{t('admin.title')}</span>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
        </header>

        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-72 p-0 flex flex-col" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
            <SheetHeader className="p-4 border-b border-border">
              <SheetTitle className="text-primary text-left">{t('admin.title')}</SheetTitle>
            </SheetHeader>
            <NavContent />
          </SheetContent>
        </Sheet>

        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    );
  }

  // Desktop layout
  return (
    <div className="min-h-[100dvh] flex bg-background">
      <aside className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-surface border-r border-border" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="flex h-16 items-center gap-2 px-4 border-b border-border">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')} className="h-8 w-8" title={t('admin.backToYuno')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="text-xl font-bold text-primary flex-1">{t('admin.title')}</span>
        </div>
        <div className="px-3 pt-3">
          <AdminSearchBar />
        </div>
        <NavContent />
      </aside>

      <main className="flex-1 ml-64" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <Outlet />
      </main>
    </div>
  );
}
