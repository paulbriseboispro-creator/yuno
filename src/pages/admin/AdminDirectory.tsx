import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Building2, Music, Megaphone, Users, UserCheck, HeartHandshake } from 'lucide-react';
import DirectoryVenues from './directory/DirectoryVenues';
import DirectoryDJs from './directory/DirectoryDJs';
import DirectoryOrganizers from './directory/DirectoryOrganizers';
import DirectoryPromoters from './directory/DirectoryPromoters';
import DirectoryStaff from './directory/DirectoryStaff';
import DirectoryCustomers from './directory/DirectoryCustomers';

interface PlatformStats {
  venues: number;
  djs: number;
  organizers: number;
  promoters: number;
  staff: number;
  customers: number;
  newSignups7d: number;
}

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

  const statCards = [
    { label: t('admin.dir.venues'), value: stats.venues, icon: Building2 },
    { label: 'DJs', value: stats.djs, icon: Music },
    { label: t('admin.dir.organizers'), value: stats.organizers, icon: Megaphone },
    { label: t('admin.dir.promoters'), value: stats.promoters, icon: HeartHandshake },
    { label: 'Staff', value: stats.staff, icon: UserCheck },
    { label: 'Clients', value: stats.customers, icon: Users },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('admin.dir.title')}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t('admin.dir.subtitle')}</p>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        {statCards.map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-3 flex flex-col gap-1">
            <div className="flex items-center gap-2 text-muted-foreground">
              <s.icon className="h-4 w-4" />
              <span className="text-xs font-medium truncate">{s.label}</span>
            </div>
            <span className="text-xl font-bold text-foreground">{loading ? '—' : s.value}</span>
          </div>
        ))}
        <div className="rounded-xl border border-border bg-card p-3 flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t('admin.dir.new7d')}</span>
          <span className="text-xl font-bold text-primary">{loading ? '—' : `+${stats.newSignups7d}`}</span>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="venues" className="w-full">
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          <TabsList className="w-max md:w-full flex gap-1 h-auto">
            <TabsTrigger value="venues" className="min-w-[80px]">{t('admin.dir.venues')}</TabsTrigger>
            <TabsTrigger value="djs" className="min-w-[60px]">DJs</TabsTrigger>
            <TabsTrigger value="organizers" className="min-w-[80px]">{t('admin.dir.organizers')}</TabsTrigger>
            <TabsTrigger value="promoters" className="min-w-[80px]">{t('admin.dir.promoters')}</TabsTrigger>
            <TabsTrigger value="staff" className="min-w-[60px]">Staff</TabsTrigger>
            <TabsTrigger value="customers" className="min-w-[60px]">Clients</TabsTrigger>
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
  );
}
