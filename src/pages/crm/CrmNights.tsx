// Les soirées de la billetterie connectée (Yuno CRM) : à venir, passées, toutes.
// Lecture : get_crm_nights (chiffres par soirée, nouveaux acheteurs). Le filtre
// vit dans l'URL (`?when=upcoming|past|all`).

import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plug } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useConsoleBase } from '@/lib/crmProduct';
import { CrmPageShell } from '@/components/crm/CrmPageShell';
import { ChoicePills, EmptyAnswer, AnalyticsLoading } from '@/components/analytics/kit';
import { KIT } from '@/components/analytics/kitFormat';
import { ReportCard } from '@/components/event-report/ui';
import { CrmNightRow, type CrmNightRowData } from '@/components/crm/CrmNightRow';

type When = 'upcoming' | 'past' | 'all';

interface NightsPayload {
  total: number;
  nights: (CrmNightRowData & { upcoming: boolean })[];
}

export default function CrmNights() {
  const { t } = useLanguage();
  const base = useConsoleBase();
  const { scope, venueId, organizerUserId } = useVenueContext();
  const [params, setParams] = useSearchParams();
  const when = (['upcoming', 'past', 'all'] as When[]).includes(params.get('when') as When) ? (params.get('when') as When) : 'all';
  const args = scope === 'organizer'
    ? { p_venue_id: null, p_organizer_user_id: organizerUserId }
    : { p_venue_id: venueId, p_organizer_user_id: null };

  const q = useQuery({
    queryKey: ['crm-nights', args.p_venue_id, args.p_organizer_user_id],
    enabled: !!(args.p_venue_id || args.p_organizer_user_id),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_crm_nights', { ...args, p_limit: 200, p_offset: 0 });
      if (error) throw error;
      return data as unknown as NightsPayload;
    },
  });

  const all = q.data?.nights ?? [];
  const upcoming = all.filter((x) => x.upcoming).sort((a, b) => a.start_at.localeCompare(b.start_at));
  const past = all.filter((x) => !x.upcoming);
  const shown = when === 'upcoming' ? upcoming : when === 'past' ? past : [...upcoming, ...past];

  return (
    <CrmPageShell title={t('crm.nights.title')} subtitle={t('crm.nights.subtitle')}>
      {q.isLoading && <AnalyticsLoading rows={4} />}
      {q.isError && <EmptyAnswer title={t('crm.common.loadError')} />}
      {q.data && all.length === 0 && (
        <EmptyAnswer title={t('crm.nights.emptyTitle')} body={t('crm.nights.emptyBody')} actions={
          <Link to={`${base}/integrations`} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold" style={{ background: KIT.RED, color: '#fff' }}>
            <Plug className="h-4 w-4" /> {t('crm.home.connectCta')}
          </Link>
        } />
      )}
      {q.data && all.length > 0 && (
        <>
          <ChoicePills<When>
            value={when}
            label={t('crm.nights.title')}
            options={[
              { value: 'all', label: t('crm.nights.all').replace('{n}', String(all.length)) },
              { value: 'upcoming', label: t('crm.nights.upcoming').replace('{n}', String(upcoming.length)) },
              { value: 'past', label: t('crm.nights.past').replace('{n}', String(past.length)) },
            ]}
            onChange={(v) => setParams((p) => { const n = new URLSearchParams(p); n.set('when', v); return n; }, { replace: true })}
          />
          <ReportCard padding={16}>
            {shown.length === 0
              ? <p style={{ color: KIT.T3, fontSize: 13 }}>{t('crm.nights.none')}</p>
              : <div className="flex flex-col">{shown.map((x) => <CrmNightRow key={x.event_id} night={x} upcoming={x.upcoming} />)}</div>}
          </ReportCard>
        </>
      )}
    </CrmPageShell>
  );
}
