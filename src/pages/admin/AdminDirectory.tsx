import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Building2, Music, Megaphone, Users, UserCheck, HeartHandshake, type LucideIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import DirectoryVenues from './directory/DirectoryVenues';
import DirectoryDJs from './directory/DirectoryDJs';
import DirectoryOrganizers from './directory/DirectoryOrganizers';
import DirectoryPromoters from './directory/DirectoryPromoters';
import DirectoryStaff from './directory/DirectoryStaff';
import DirectoryCustomers from './directory/DirectoryCustomers';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED        = '#E8192C';
const POS        = '#34D399';
const T1         = 'rgba(255,255,255,0.96)';
const T3         = 'rgba(255,255,255,0.36)';
const C_FAINT    = 'rgba(255,255,255,0.06)';
const BORDER     = 'rgba(255,255,255,0.085)';
const F_BORDER   = 'rgba(255,255,255,0.055)';
const CARD_BG    = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface PlatformStats {
  venues: number;
  djs: number;
  organizers: number;
  promoters: number;
  staff: number;
  customers: number;
  newSignups7d: number;
}

const tabTriggerClass =
  'group relative inline-flex items-center gap-2 px-4 py-3 text-[13.5px] font-[560] cursor-pointer rounded-none border-0 bg-transparent shadow-none ' +
  'data-[state=active]:bg-transparent data-[state=active]:shadow-none transition-colors duration-150 ' +
  'text-[rgba(255,255,255,0.36)] data-[state=active]:text-[rgba(255,255,255,0.96)]';

export default function AdminDirectory() {
  const { t } = useLanguage();
  const [stats, setStats] = useState<PlatformStats>({ venues: 0, djs: 0, organizers: 0, promoters: 0, staff: 0, customers: 0, newSignups7d: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [venues, djs, organizers, promoters, staff, customers, newSignups] = await Promise.all([
      supabase.from('venues').select('id', { count: 'exact', head: true }),
      supabase.from('djs').select('id', { count: 'exact', head: true }),
      supabase.from('organizer_profiles').select('user_id', { count: 'exact', head: true }),
      supabase.from('promoters').select('id', { count: 'exact', head: true }),
      supabase.from('user_roles').select('id', { count: 'exact', head: true }).in('role', ['barman', 'bouncer', 'vip_host', 'cloakroom', 'manager']),
      supabase.from('user_roles').select('id', { count: 'exact', head: true }).eq('role', 'client'),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo),
    ]);
    setStats({
      venues: venues.count ?? 0,
      djs: djs.count ?? 0,
      organizers: organizers.count ?? 0,
      promoters: promoters.count ?? 0,
      staff: staff.count ?? 0,
      customers: customers.count ?? 0,
      newSignups7d: newSignups.count ?? 0,
    });
    setLoading(false);
  };

  const statCards: { label: string; value: number; icon: LucideIcon }[] = [
    { label: t('admin.dir.venues'), value: stats.venues, icon: Building2 },
    { label: 'DJs', value: stats.djs, icon: Music },
    { label: t('admin.dir.organizers'), value: stats.organizers, icon: Megaphone },
    { label: t('admin.dir.promoters'), value: stats.promoters, icon: HeartHandshake },
    { label: 'Staff', value: stats.staff, icon: UserCheck },
    { label: 'Clients', value: stats.customers, icon: Users },
  ];

  const tabs: { value: string; label: string; icon: LucideIcon }[] = [
    { value: 'venues', label: t('admin.dir.venues'), icon: Building2 },
    { value: 'djs', label: 'DJs', icon: Music },
    { value: 'organizers', label: t('admin.dir.organizers'), icon: Megaphone },
    { value: 'promoters', label: t('admin.dir.promoters'), icon: HeartHandshake },
    { value: 'staff', label: 'Staff', icon: UserCheck },
    { value: 'customers', label: 'Clients', icon: Users },
  ];

  return (
    <div className="min-h-screen pb-16" style={{ background: '#000' }}>
      {/* Ambient vignette */}
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">

        {/* Header */}
        <div>
          <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
            {t('admin.dir.title')}
          </h1>
          <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>{t('admin.dir.subtitle')}</p>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
          {statCards.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: CARD_SHADOW, padding: '14px 16px', height: '100%' }}
            >
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <span style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }} className="truncate">{s.label}</span>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg flex-none" style={{ background: C_FAINT, border: `1px solid ${F_BORDER}` }}>
                  <s.icon className="h-3.5 w-3.5" style={{ color: T3 }} />
                </div>
              </div>
              <span className="tabular-nums" style={{ color: T1, fontSize: 26, fontWeight: 640, letterSpacing: '-0.025em', lineHeight: 1 }}>{loading ? '—' : s.value}</span>
            </motion.div>
          ))}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: statCards.length * 0.04 }}
            style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: CARD_SHADOW, padding: '14px 16px', height: '100%' }}
          >
            <span style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }} className="block mb-2.5 truncate">{t('admin.dir.new7d')}</span>
            <span className="tabular-nums" style={{ color: POS, fontSize: 26, fontWeight: 640, letterSpacing: '-0.025em', lineHeight: 1 }}>{loading ? '—' : `+${stats.newSignups7d}`}</span>
          </motion.div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="venues" className="w-full">
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <TabsList
              className="w-max md:w-full flex gap-0.5 h-auto p-0 bg-transparent rounded-none justify-start"
              style={{ borderBottom: `1px solid ${BORDER}` }}
            >
              {tabs.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value} className={tabTriggerClass}>
                  <tab.icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                  <span
                    className="absolute left-3 right-3 rounded-full opacity-0 transition-opacity duration-150 group-data-[state=active]:opacity-100"
                    style={{ bottom: -1, height: 2, background: RED, boxShadow: '0 0 10px rgba(232,25,44,0.6)' }}
                  />
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <TabsContent value="venues"><DirectoryVenues /></TabsContent>
          <TabsContent value="djs"><DirectoryDJs /></TabsContent>
          <TabsContent value="organizers"><DirectoryOrganizers /></TabsContent>
          <TabsContent value="promoters"><DirectoryPromoters /></TabsContent>
          <TabsContent value="staff"><DirectoryStaff /></TabsContent>
          <TabsContent value="customers"><DirectoryCustomers /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
