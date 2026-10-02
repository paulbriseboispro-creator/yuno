// Accueil de la Console en mode Yuno CRM (club ou organisateur).
// Une seule lecture : get_crm_overview (connexion, base, ventes 90 j, prochaines
// et dernières soirées de la billetterie connectée). Rien n'est recalculé ici.

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { AlertTriangle, ArrowRight, Loader2, Mail, Plug, Users, Zap, FileUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useConsoleBase } from '@/lib/crmProduct';
import { CrmPageShell } from '@/components/crm/CrmPageShell';
import { KpiRow, KpiTile, EmptyAnswer, AnalyticsLoading } from '@/components/analytics/kit';
import { KIT, useNumberFormat } from '@/components/analytics/kitFormat';
import { ReportCard, CardTitle } from '@/components/event-report/ui';
import { CrmNightRow, type CrmNightRowData } from '@/components/crm/CrmNightRow';

interface Overview {
  connection: null | {
    provider: string; status: 'active' | 'token_invalid' | 'error' | 'disconnected';
    external_org_name: string | null; last_ok_at: string | null; initial_import_done_at: string | null;
    running: boolean; stats: { tickets?: number; buyers?: number } | null;
  };
  base: { contacts: number; reachable: number; reachable_from_ticketing: number; buyers: number };
  sales_90d: { tickets: number; revenue: number; buyers: number; nights: number };
  upcoming: CrmNightRowData[];
  recent: CrmNightRowData[];
}

export default function CrmHome() {
  const { t, language } = useLanguage();
  const base = useConsoleBase();
  const { scope, venueId, organizerUserId } = useVenueContext();
  const { n, eur } = useNumberFormat();
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const args = scope === 'organizer'
    ? { p_venue_id: null, p_organizer_user_id: organizerUserId }
    : { p_venue_id: venueId, p_organizer_user_id: null };

  const q = useQuery({
    queryKey: ['crm-overview', args.p_venue_id, args.p_organizer_user_id],
    enabled: !!(args.p_venue_id || args.p_organizer_user_id),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_crm_overview', args);
      if (error) throw error;
      return data as unknown as Overview;
    },
  });

  const o = q.data;
  const conn = o?.connection ?? null;

  return (
    <CrmPageShell title={t('crm.home.title')} subtitle={t('crm.home.subtitle')}>
      {q.isLoading && <AnalyticsLoading rows={3} />}
      {q.isError && (
        <EmptyAnswer title={t('crm.common.loadError')} actions={
          <button type="button" onClick={() => q.refetch()} className="text-[13px] font-semibold underline" style={{ color: KIT.T1 }}>{t('crm.common.retry')}</button>
        } />
      )}

      {o && (
        <>
          {/* La billetterie connectée : d'où vient tout le reste. */}
          {!conn || conn.status === 'disconnected' ? (
            <ReportCard>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <p style={{ color: KIT.T1, fontSize: 16, fontWeight: 650 }}>{t('crm.home.connectTitle')}</p>
                  <p style={{ color: KIT.T3, fontSize: 13, marginTop: 4, maxWidth: '62ch' }}>{t('crm.home.connectBody')}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link to={`${base}/integrations`} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-semibold" style={{ background: KIT.RED, color: '#fff' }}>
                    <Plug className="h-4 w-4" /> {t('crm.home.connectCta')}
                  </Link>
                  <Link to={`${base}/campaigns/contacts`} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold" style={{ color: KIT.T1, border: `1px solid ${KIT.BORDER}` }}>
                    <FileUp className="h-4 w-4" /> {t('crm.home.importCta')}
                  </Link>
                </div>
              </div>
            </ReportCard>
          ) : conn.status === 'token_invalid' || conn.status === 'error' ? (
            <Link to={`${base}/integrations`} className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: 'rgb(232 25 44/0.08)', border: '1px solid rgb(232 25 44/0.25)' }}>
              <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: KIT.RED }} />
              <span style={{ color: KIT.T1, fontSize: 13 }}>{t(conn.status === 'token_invalid' ? 'crm.home.tokenInvalid' : 'crm.home.syncError')}</span>
              <ArrowRight className="ml-auto h-4 w-4" style={{ color: KIT.T3 }} />
            </Link>
          ) : !conn.initial_import_done_at ? (
            <div className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: 'rgb(var(--ink)/0.032)', border: `1px solid ${KIT.BORDER}` }}>
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" style={{ color: 'var(--acc-fbbf24)' }} />
              <span style={{ color: KIT.T1, fontSize: 13 }}>
                {t('crm.home.importing').replace('{n}', n(conn.stats?.tickets ?? 0))}
              </span>
            </div>
          ) : (
            <p style={{ color: KIT.T3, fontSize: 12.5 }}>
              {t('crm.home.syncedAgo')
                .replace('{org}', conn.external_org_name ?? 'Shotgun')
                .replace('{ago}', conn.last_ok_at ? formatDistanceToNow(new Date(conn.last_ok_at), { addSuffix: true, locale }) : '—')}
            </p>
          )}

          <KpiRow>
            <KpiTile label={t('crm.kpi.contacts')} hint={t('crm.kpi.contactsHint')} value={n(o.base.contacts)} />
            <KpiTile label={t('crm.kpi.reachable')} hint={t('crm.kpi.reachableHint')} value={n(o.base.reachable)}
              sub={o.base.reachable_from_ticketing > 0 ? <span>{t('crm.kpi.fromTicketing').replace('{n}', n(o.base.reachable_from_ticketing))}</span> : undefined} />
            <KpiTile label={t('crm.kpi.buyers')} hint={t('crm.kpi.buyersHint')} value={n(o.base.buyers)} />
            <KpiTile label={t('crm.kpi.tickets90')} hint={t('crm.kpi.tickets90Hint')} value={n(o.sales_90d.tickets)}
              sub={<span>{eur(o.sales_90d.revenue)}</span>} />
          </KpiRow>

          <div className="grid gap-5 xl:grid-cols-2">
            <ReportCard>
              <CardTitle title={t('crm.home.upcoming')} right={
                <Link to={`${base}/crm/nights`} className="text-[12.5px] font-semibold" style={{ color: KIT.T2 }}>{t('crm.common.seeAll')}</Link>
              } />
              {o.upcoming.length === 0
                ? <p style={{ color: KIT.T3, fontSize: 13 }}>{t('crm.home.noUpcoming')}</p>
                : <div className="flex flex-col">{o.upcoming.map((e) => <CrmNightRow key={e.event_id} night={e} upcoming />)}</div>}
            </ReportCard>
            <ReportCard>
              <CardTitle title={t('crm.home.recent')} right={
                <Link to={`${base}/crm/nights?when=past`} className="text-[12.5px] font-semibold" style={{ color: KIT.T2 }}>{t('crm.common.seeAll')}</Link>
              } />
              {o.recent.length === 0
                ? <p style={{ color: KIT.T3, fontSize: 13 }}>{t('crm.home.noRecent')}</p>
                : <div className="flex flex-col">{o.recent.map((e) => <CrmNightRow key={e.event_id} night={e} />)}</div>}
            </ReportCard>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {[
              { to: `${base}/campaigns/automations`, icon: Zap, title: t('crm.home.next.auto'), body: t('crm.home.next.autoBody') },
              { to: `${base}/campaigns/new`, icon: Mail, title: t('crm.home.next.campaign'), body: t('crm.home.next.campaignBody') },
              { to: `${base}/campaigns/contacts`, icon: Users, title: t('crm.home.next.base'), body: t('crm.home.next.baseBody') },
            ].map((a) => (
              <Link key={a.to} to={a.to} className="group flex items-start gap-3 rounded-2xl p-4 transition-colors"
                style={{ background: 'rgb(var(--ink)/0.032)', border: `1px solid ${KIT.BORDER}` }}>
                <a.icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: KIT.T2 }} />
                <span className="min-w-0">
                  <span className="block" style={{ color: KIT.T1, fontSize: 13.5, fontWeight: 600 }}>{a.title}</span>
                  <span className="block" style={{ color: KIT.T3, fontSize: 12.5, marginTop: 2 }}>{a.body}</span>
                </span>
                <ArrowRight className="ml-auto mt-0.5 h-4 w-4 shrink-0 opacity-50 group-hover:opacity-100" style={{ color: KIT.T2 }} />
              </Link>
            ))}
          </div>
        </>
      )}
    </CrmPageShell>
  );
}
