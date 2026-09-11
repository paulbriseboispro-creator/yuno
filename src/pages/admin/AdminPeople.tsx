import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { Building2, HeartHandshake, Music, Sparkles, UserCheck, UserPlus, Users, Handshake } from 'lucide-react';
import { AdminPage, Stat, TabBar, Btn, Pill } from '@/components/admin/ui';
import { fmtNum, fmtPlural } from '@/lib/adminFormat';
import DirectoryDJs from './directory/DirectoryDJs';
import DirectoryPromoters from './directory/DirectoryPromoters';
import DirectoryStaff from './directory/DirectoryStaff';

interface Counts { venues: number; venues_demo: number; organizers: number; organizers_showcase: number; agencies: number; djs: number; promoters: number; staff: number; customers: number; accounts: number; signups_7d: number; pending_invitations: number }
type Tab = 'djs' | 'promoters' | 'staff';

export default function AdminPeople() {
  const { t, language } = useLanguage();
  const [params, setParams] = useSearchParams();
  const [counts, setCounts] = useState<Counts | null>(null);
  // Sans onglet dans l'URL, ouvrir le premier qui a quelqu'un dedans : arriver
  // sur « DJs — aucun résultat » quand le staff en a un est une fausse piste.
  const autoTab: Tab = counts ? (counts.djs > 0 ? 'djs' : counts.promoters > 0 ? 'promoters' : counts.staff > 0 ? 'staff' : 'djs') : 'djs';
  const tab = ((params.get('tab') as Tab) || autoTab);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_directory_counts' as never);
    if (!error && data) setCounts(data as unknown as Counts);
  }, []);
  useEffect(() => { load(); }, [load]);

  const n = (v?: number) => (counts ? fmtNum(v ?? 0, language) : '—');

  return (
    <AdminPage eyebrow={t('adm.people.eyebrow')} title={t('adm.people.title')} subtitle={t('adm.people.subtitle')}
      actions={counts && counts.pending_invitations > 0 ? <Pill tone="accent">{fmtPlural(counts.pending_invitations, language, t('adm.people.pendingInvOne'), t('adm.people.pendingInv'))}</Pill> : undefined}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat compact label={t('adm.people.accounts')} value={n(counts?.accounts)} icon={Users} highlight />
        <Stat compact label={t('adm.people.new7d')} value={counts ? `+${fmtNum(counts.signups_7d, language)}` : '—'} icon={UserPlus} tone="pos" />
        <Stat compact label={t('adm.people.customers')} value={n(counts?.customers)} icon={Users} to="/admin/customers" />
        <Stat compact label={t('adm.people.venues')} value={n(counts?.venues)} icon={Building2} sub={counts && counts.venues_demo > 0 ? t('adm.people.venuesDemo').replace('{n}', fmtNum(counts.venues_demo, language)) : undefined} to="/admin/venues" />
        <Stat compact label={t('adm.people.organizers')} value={n(counts?.organizers)} icon={Sparkles} to="/admin/organizers" />
        <Stat compact label={t('adm.people.agencies')} value={n(counts?.agencies)} icon={Handshake} to="/admin/agencies" />
        <Stat compact label={t('adm.people.djs')} value={n(counts?.djs)} icon={Music} />
        <Stat compact label={t('adm.people.promoters')} value={n(counts?.promoters)} icon={HeartHandshake} sub={counts ? `${t('adm.people.staff')}: ${fmtNum(counts.staff, language)}` : undefined} />
      </div>

      <TabBar<Tab> value={tab} onChange={(k) => setParams({ tab: k })} tabs={[
        { id: 'djs', label: t('adm.people.tab.djs'), icon: Music, count: counts?.djs },
        { id: 'promoters', label: t('adm.people.tab.promoters'), icon: HeartHandshake, count: counts?.promoters },
        { id: 'staff', label: t('adm.people.tab.staff'), icon: UserCheck, count: counts?.staff },
      ]} />
      {tab === 'djs' && <DirectoryDJs />}
      {tab === 'promoters' && <DirectoryPromoters />}
      {tab === 'staff' && <DirectoryStaff />}
      <div className="flex gap-2 flex-wrap">
        <Btn to="/admin/organizers" size="sm" variant="subtle" icon={Sparkles}>{t('adm.people.organizers')}</Btn>
        <Btn to="/admin/venues" size="sm" variant="subtle" icon={Building2}>{t('adm.people.venues')}</Btn>
        <Btn to="/admin/customers" size="sm" variant="subtle" icon={Users}>{t('adm.people.customers')}</Btn>
      </div>
    </AdminPage>
  );
}
