import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useManagerVenueContext } from '@/contexts/ManagerVenueContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { OwnerHeader } from '@/components/OwnerHeader';
import { LanguageSelector } from '@/components/LanguageSelector';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import {
  Calendar,
  UtensilsCrossed,
  Users,
  Ticket,
  LayoutGrid,
  BarChart3,
  ShoppingCart,
  Music,
  Megaphone,
  Wallet,
  Sparkles,
  Gift,
  TrendingUp,
  UserCheck,
  FileText,
  Building2,
  RotateCcw,
  Mail,
  Flame,
  Zap,
  Radio,
  Crown
} from 'lucide-react';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const C_FAINT  = 'rgba(255,255,255,0.06)';
const BORDER   = 'rgba(255,255,255,0.085)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface DashboardCard {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  path: string;
  permission: boolean;
  color: string;
}

export default function ManagerDashboard() {
  const { venue, permissions } = useManagerVenueContext();
  const { t } = useLanguage();
  const [quickStats, setQuickStats] = useState<Record<string, number>>({});

  // Fetch quick stats for dashboard cards
  useEffect(() => {
    if (!venue?.id) return;

    const fetchQuickStats = async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [ordersRes, ticketsRes, revenueRes] = await Promise.all([
        // Pending orders count
        supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('venue_id', venue.id)
          .eq('status', 'paid')
          .is('served_at', null),
        // Tickets sold today
        supabase
          .from('tickets')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'paid')
          .in('event_id', 
            (await supabase.from('events').select('id').eq('venue_id', venue.id)).data?.map(e => e.id) || []
          )
          .gte('created_at', today.toISOString()),
        // Revenue today (orders)
        supabase
          .from('orders')
          .select('total')
          .eq('venue_id', venue.id)
          .eq('status', 'paid')
          .gte('created_at', today.toISOString()),
      ]);

      const stats: Record<string, number> = {};
      if (ordersRes.count !== null) stats.orders = ordersRes.count;
      if (ticketsRes.count !== null) stats.tickets = ticketsRes.count;
      if (revenueRes.data) stats.revenue = revenueRes.data.reduce((sum, o) => sum + Number(o.total || 0), 0);
      
      setQuickStats(stats);
    };

    fetchQuickStats();
    const interval = setInterval(fetchQuickStats, 60_000);
    return () => clearInterval(interval);
  }, [venue?.id]);

  const dashboardCards: DashboardCard[] = [
    {
      id: 'orders',
      title: t('owner.ordersPage'),
      description: t('manager.manageOrders'),
      icon: <ShoppingCart className="h-6 w-6" />,
      path: '/manager/orders',
      permission: permissions.canViewOrders,
      color: 'from-blue-500/20 to-blue-600/10',
    },
    {
      id: 'events',
      title: t('owner.eventsPage'),
      description: t('manager.createManageEvents'),
      icon: <Calendar className="h-6 w-6" />,
      path: '/manager/events',
      permission: permissions.canManageEvents,
      color: 'from-purple-500/20 to-purple-600/10',
    },
    {
      id: 'menu',
      title: t('owner.menuPage'),
      description: t('manager.editMenu'),
      icon: <UtensilsCrossed className="h-6 w-6" />,
      path: '/manager/menu',
      permission: permissions.canManageMenu,
      color: 'from-orange-500/20 to-orange-600/10',
    },
    {
      id: 'staff',
      title: t('owner.staffPage'),
      description: t('manager.manageTeam'),
      icon: <Users className="h-6 w-6" />,
      path: '/manager/staff',
      permission: permissions.canManageStaff,
      color: 'from-green-500/20 to-green-600/10',
    },
    {
      id: 'tickets',
      title: t('tickets.ticketManagement'),
      description: t('manager.salesEntryControl'),
      icon: <Ticket className="h-6 w-6" />,
      path: '/manager/ticketing',
      permission: permissions.canManageTickets,
      color: 'from-pink-500/20 to-pink-600/10',
    },
    {
      id: 'tables',
      title: t('tables.vipTables'),
      description: t('manager.reservationsZones'),
      icon: <LayoutGrid className="h-6 w-6" />,
      path: '/manager/tables',
      permission: permissions.canManageTables,
      color: 'from-amber-500/20 to-amber-600/10',
    },
    {
      id: 'djs',
      title: 'DJs',
      description: t('manager.manageArtists'),
      icon: <Music className="h-6 w-6" />,
      path: '/manager/djs',
      permission: permissions.canManageDJs,
      color: 'from-cyan-500/20 to-cyan-600/10',
    },
    {
      id: 'promoters',
      title: t('manager.promoters'),
      description: t('manager.affiliatesCommissions'),
      icon: <Megaphone className="h-6 w-6" />,
      path: '/manager/promoters',
      permission: permissions.canManagePromoters,
      color: 'from-red-500/20 to-red-600/10',
    },
    {
      id: 'analytics',
      title: t('owner.analytics'),
      description: t('manager.statsPerformance'),
      icon: <BarChart3 className="h-6 w-6" />,
      path: '/manager/analytics',
      permission: permissions.canViewAnalytics,
      color: 'from-indigo-500/20 to-indigo-600/10',
    },
    {
      id: 'finance',
      title: t('manager.finance'),
      description: t('manager.revenuePayments'),
      icon: <Wallet className="h-6 w-6" />,
      path: '/manager/finance',
      permission: permissions.canViewFinance,
      color: 'from-emerald-500/20 to-emerald-600/10',
    },
    {
      id: 'loyalty',
      title: t('manager.loyalty'),
      description: t('manager.loyaltyProgram'),
      icon: <Gift className="h-6 w-6" />,
      path: '/manager/loyalty',
      permission: permissions.canManageLoyalty,
      color: 'from-rose-500/20 to-rose-600/10',
    },
    {
      id: 'upsell',
      title: 'Upsells',
      description: t('manager.offersPromotions'),
      icon: <TrendingUp className="h-6 w-6" />,
      path: '/manager/upsell',
      permission: permissions.canManageUpsell,
      color: 'from-yellow-500/20 to-yellow-600/10',
    },
    {
      id: 'guest-list',
      title: 'Guest List',
      description: t('manager.guestLists'),
      icon: <UserCheck className="h-6 w-6" />,
      path: '/manager/guest-list',
      permission: permissions.canManageGuestList,
      color: 'from-violet-500/20 to-violet-600/10',
    },
    {
      id: 'customers',
      title: t('owner.customers'),
      description: t('manager.customerBase'),
      icon: <Users className="h-6 w-6" />,
      path: '/manager/customers',
      permission: permissions.canViewCustomers,
      color: 'from-sky-500/20 to-sky-600/10',
    },
    {
      id: 'invoices',
      title: t('owner.invoices'),
      description: t('manager.invoiceManagement'),
      icon: <FileText className="h-6 w-6" />,
      path: '/manager/invoices',
      permission: permissions.canManageInvoices,
      color: 'from-stone-500/20 to-stone-600/10',
    },
    {
      id: 'venue',
      title: t('manager.venue'),
      description: t('manager.venueSettings'),
      icon: <Building2 className="h-6 w-6" />,
      path: '/manager/venue',
      permission: permissions.canManageVenue,
      color: 'from-neutral-500/20 to-neutral-600/10',
    },
    {
      id: 'refunds',
      title: t('manager.refunds'),
      description: t('manager.manageRefunds'),
      icon: <RotateCcw className="h-6 w-6" />,
      path: '/manager/refunds',
      permission: permissions.canManageRefunds,
      color: 'from-orange-500/20 to-orange-600/10',
    },
    {
      id: 'crm',
      title: 'CRM',
      description: t('manager.emailsCampaigns'),
      icon: <Mail className="h-6 w-6" />,
      path: '/manager/crm',
      permission: permissions.canManageCrm,
      color: 'from-teal-500/20 to-teal-600/10',
    },
    {
      id: 'hype',
      title: t('manager.hypeAnalysis'),
      description: t('manager.eventScoreAnalysis'),
      icon: <Flame className="h-6 w-6" />,
      path: '/manager/hype',
      permission: permissions.canViewHype,
      color: 'from-red-500/20 to-red-600/10',
    },
    {
      id: 'scarcity',
      title: t('scarcity.title'),
      description: t('manager.scarcityDesc') || 'Scarcity & urgency tools',
      icon: <Zap className="h-6 w-6" />,
      path: '/manager/scarcity',
      permission: permissions.canManageScarcity,
      color: 'from-fuchsia-500/20 to-fuchsia-600/10',
    },
    {
      id: 'organizations',
      title: t('owner.organizers'),
      description: t('manager.organizersDesc') || 'Manage organizers',
      icon: <Users className="h-6 w-6" />,
      path: '/manager/organizations',
      permission: permissions.canManageOrganizations,
      color: 'from-lime-500/20 to-lime-600/10',
    },
    {
      id: 'live',
      title: t('live.title'),
      description: t('manager.liveDesc') || 'Live night monitoring',
      icon: <Radio className="h-6 w-6" />,
      path: '/manager/live',
      permission: permissions.canViewLive,
      color: 'from-rose-500/20 to-rose-600/10',
    },
    {
      id: 'vip-service',
      title: t('owner.vipService'),
      description: t('manager.vipServiceDesc') || 'VIP service settings',
      icon: <Crown className="h-6 w-6" />,
      path: '/manager/vip-service',
      permission: permissions.canManageVipService,
      color: 'from-amber-500/20 to-amber-600/10',
    },
  ];

  const allowedCards = dashboardCards.filter(card => card.permission);

  return (
    <div className="min-h-screen pb-28" style={{ background: '#000' }}>
      {/* Vignette ambiante */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }}
      />

      <OwnerHeader
        title={t('manager.title')}
        showBackButton={true}
        backTo="/profile"
        rightContent={<LanguageSelector />}
      />

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 pt-2 space-y-4">
        {venue && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            style={{
              background: CARD_BG,
              border: `1px solid ${BORDER}`,
              borderRadius: 18,
              boxShadow: CARD_SHADOW,
              padding: 22,
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <div className="flex items-center gap-4">
              {venue.logoUrl ? (
                <div className="relative flex-none">
                  <div className="absolute inset-0 rounded-full blur-xl" style={{ background: 'rgba(232,25,44,0.18)' }} />
                  <img
                    src={venue.logoUrl}
                    alt={venue.name}
                    className="relative h-16 w-16 rounded-full object-cover"
                    style={{ border: '2px solid rgba(232,25,44,0.3)' }}
                  />
                </div>
              ) : (
                <div
                  className="h-16 w-16 rounded-full flex items-center justify-center flex-none"
                  style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}
                >
                  <Sparkles className="h-8 w-8" style={{ color: RED }} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h2 style={{ color: T1, fontSize: 22, fontWeight: 640, letterSpacing: '-0.02em', margin: 0 }} className="truncate">
                  {venue.name}
                </h2>
                <p style={{ color: T2, fontSize: 13, marginTop: 2 }}>{venue.city}</p>
                <p style={{ color: T3, fontSize: 11.5, marginTop: 4 }}>
                  {allowedCards.length} {t('manager.permissionsGranted')}
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {allowedCards.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center py-16"
          >
            <div
              className="w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center"
              style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}
            >
              <Users className="h-10 w-10" style={{ color: 'rgba(255,255,255,0.2)' }} />
            </div>
            <h3 style={{ color: T1, fontSize: 17, fontWeight: 600, marginBottom: 6 }}>
              {t('manager.noAccessConfigured')}
            </h3>
            <p style={{ color: T3, fontSize: 13 }} className="max-w-sm mx-auto">
              {t('manager.contactOwner')}
            </p>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {allowedCards.map((card, index) => (
              <motion.div
                key={card.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.04 }}
              >
                <Link to={card.path} className="group block h-full">
                  <div
                    className="h-full transition-all duration-150"
                    style={{
                      background: INNER_BG,
                      border: `1px solid ${BORDER}`,
                      borderRadius: 14,
                      overflow: 'hidden',
                      padding: '20px 22px',
                    }}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div
                        className="w-10 h-10 flex items-center justify-center rounded-xl flex-none"
                        style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}
                      >
                        {card.icon}
                      </div>
                      {card.id === 'orders' && quickStats.orders !== undefined && quickStats.orders > 0 && (
                        <div
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold tabular-nums"
                          style={{ border: '1px solid rgba(232,25,44,0.4)', background: 'rgba(232,25,44,0.1)', color: RED }}
                        >
                          {quickStats.orders}
                        </div>
                      )}
                      {card.id === 'tickets' && quickStats.tickets !== undefined && quickStats.tickets > 0 && (
                        <div
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold tabular-nums"
                          style={{ border: `1px solid ${BORDER}`, background: C_FAINT, color: T1 }}
                        >
                          {quickStats.tickets} {t('manager.today')}
                        </div>
                      )}
                    </div>
                    <h3
                      style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}
                    >
                      {card.title}
                    </h3>
                    <p style={{ color: T3, fontSize: 12.5, marginTop: 4 }}>
                      {card.description}
                    </p>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
