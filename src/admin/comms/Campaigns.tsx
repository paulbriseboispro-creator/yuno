/**
 * Communication › Campagnes de Yuno : « À qui Yuno écrit, et qu'est-ce que ça
 * donne ? » La base marketing de Yuno (joignables, désabonnés) et les campagnes
 * e-mail, SMS et push de Yuno dans une seule liste à onglets. Les éditeurs
 * (Email Studio, SMS, formulaire push) restent ceux d'avant, dans leur cadre.
 */
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useMemo, useState, type ReactNode } from 'react';
import { Block, BulletBar, CalendarHeat, DataTable, Hero, HeroChart, Page, useAdminFilters, useAdminT, type ColumnDef, EmptyLine, Fold, Ledger, LedgerRow, MiniBar, StackedShare, Status, type Tone } from '@/admin/ui';
import ContactImportDialog from '@/components/contacts/ContactImportDialog';
import { fmtAxisDay, fmtCompact, fmtDate, fmtNum, fmtPct } from '@/lib/adminFormat';
import { relativeDelta } from '../context/period';
import { rpc } from '../system/data';
import {
  COMMS_KEY, useEmailCampaigns, useMarketingOverview, usePushCampaigns, useSmsCampaigns,
  type MarketingOverview,
} from './data';

const STATUS_TONE: Record<string, Tone> = { draft: 'neutral', scheduled: 'neutral', sending: 'warning', sent: 'positive', paused: 'warning', failed: 'negative', cancelled: 'neutral' };
const DAY = 86_400_000;
const MIN_SENT = 30;

export default function Campaigns() {
  const { t, lang } = useAdminT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ov = useMarketingOverview();
  const emails = useEmailCampaigns();
  const sms = useSmsCampaigns();
  const push = usePushCampaigns();
  const [importOpen, setImportOpen] = useState(false);
  const { range } = useAdminFilters();

  const sync = useMutation({
    mutationFn: () => rpc<{ email_added: number; sms_added: number }>('sync_platform_marketing_contacts', { p_sources: ['clients', 'pros', 'waitlist', 'leads'] }),
    onSuccess: (r) => { toast.success(t('adm.comms.cp.synced', { email: r?.email_added ?? 0, sms: r?.sms_added ?? 0 })); void qc.invalidateQueries({ queryKey: COMMS_KEY }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const o = ov.data;
  const stLabel = (st: string) => (t(`adm.comms.cp.st.${st}`) === `adm.comms.cp.st.${st}` ? st : t(`adm.comms.cp.st.${st}`));

  // Un envoi = une ligne datée et chiffrée, tous canaux ; sert la courbe, le calendrier et la phrase.
  type Send = { at: number; n: number; channel: 'email' | 'sms' | 'push' };
  const sends = useMemo<Send[]>(() => {
    const out: Send[] = [];
    for (const r of emails.data ?? []) if (r.sent_at && r.recipients_count > 0) out.push({ at: new Date(r.sent_at).getTime(), n: r.recipients_count, channel: 'email' });
    for (const r of sms.data ?? []) if (r.sent_at && (r.sent_count ?? 0) > 0) out.push({ at: new Date(r.sent_at).getTime(), n: r.sent_count ?? 0, channel: 'sms' });
    for (const r of push.data ?? []) if ((r.status ?? 'sent') === 'sent' && r.sent_count > 0) out.push({ at: new Date(r.scheduled_at ?? r.created_at).getTime(), n: r.sent_count, channel: 'push' });
    return out;
  }, [emails.data, sms.data, push.data]);

  const key = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const points = useMemo(() => {
    const n = range.days;
    const start = range.from.getTime();
    const cur = new Array<number>(n).fill(0), prev = new Array<number>(n).fill(0);
    for (const s of sends) {
      const i = Math.floor((s.at - start) / DAY);
      if (i >= 0 && i < n) cur[i] += s.n;
      const j = Math.floor((s.at - (start - n * DAY)) / DAY);
      if (j >= 0 && j < n) prev[j] += s.n;
    }
    return cur.map((v, i) => ({ x: key(start + i * DAY), v, prev: prev[i] }));
  }, [sends, range.days, range.from]);
  const total = points.reduce((a, p) => a + (p.v ?? 0), 0);
  const prevTotal = points.reduce((a, p) => a + (p.prev ?? 0), 0);
  const inRange = sends.filter((s) => s.at >= range.from.getTime());
  const byChannel = (c: Send['channel']) => inRange.filter((s) => s.channel === c).reduce((a, s) => a + s.n, 0);
  const em = emails.data ?? [];
  const emRange = em.filter((r) => r.sent_at && new Date(r.sent_at).getTime() >= range.from.getTime() && r.recipients_count >= MIN_SENT);
  const emSent = emRange.reduce((a, r) => a + r.recipients_count, 0);
  const emClicks = emRange.reduce((a, r) => a + r.clicks_count, 0);
  const delta = relativeDelta(total, prevTotal);

  // Le rythme : six mois de jours, une case par jour (calendrier de chaleur).
  const heat = useMemo(() => {
    const end = Date.now();
    const days: Array<{ d: string; v: number }> = [];
    const byDay = new Map<string, number>();
    for (const s of sends) byDay.set(key(s.at), (byDay.get(key(s.at)) ?? 0) + s.n);
    for (let i = 181; i >= 0; i--) { const d = key(end - i * DAY); days.push({ d, v: byDay.get(d) ?? 0 }); }
    return days;
  }, [sends]);
  const loading = emails.isLoading || sms.isLoading || push.isLoading;
  const sentSentence = loading ? null : total === 0
    ? t('adm.comms.cp3.none', { n: range.days })
    : t('adm.comms.cp3.sentence', { n: range.days, email: fmtNum(byChannel('email'), lang), sms: fmtNum(byChannel('sms'), lang), push: fmtNum(byChannel('push'), lang),
      clicks: emSent >= MIN_SENT ? t('adm.comms.cp3.clicks', { c: fmtNum(emClicks, lang), p: fmtPct((emClicks * 100) / emSent, 1, lang) }) : t('adm.comms.cp3.fewForClicks', { n: MIN_SENT }) });

  const shareParts = (kind: 'email' | 'sms') => !o ? [] : kind === 'email' ? [
    { key: 'r', label: t('adm.comms.cp3.reach'), value: o.email.reachable, display: fmtNum(o.email.reachable, lang), tone: 'strong' as const },
    { key: 'o', label: t('adm.comms.cp3.out'), value: o.email.opted_out, display: fmtNum(o.email.opted_out, lang), tone: 'soft' as const },
    { key: 's', label: t('adm.comms.cp3.supp'), value: o.email.suppressed, display: fmtNum(o.email.suppressed, lang), tone: 'alert' as const },
  ] : [
    { key: 'r', label: t('adm.comms.cp3.reach'), value: o.sms.reachable, display: fmtNum(o.sms.reachable, lang), tone: 'strong' as const },
    { key: 'o', label: t('adm.comms.cp3.out'), value: o.sms.unsubscribed, display: fmtNum(o.sms.unsubscribed, lang), tone: 'soft' as const },
  ];

  const listCols: ColumnDef<MarketingOverview['imports'][number], unknown>[] = [
    { id: 'name', header: t('adm.comms.cp.c.list'), accessorFn: (r) => r.list_name || (r.filename || '').replace(/\.[a-z0-9]+$/i, '') || t('pm.importUnnamed'), cell: (x) => <span className="a-t1 font-medium">{x.getValue<string>()}</span> },
    { accessorKey: 'contacts', header: t('adm.comms.cp.c.contacts'), meta: { align: 'right' }, cell: (x) => fmtNum(x.getValue<number>(), lang) },
    { accessorKey: 'created_at', header: t('adm.comms.cp.c.imported'), cell: (x) => fmtDate(x.getValue<string>(), lang) },
  ];

  // Une liste par canal, dense : le résultat en mini-barres comparables d'une ligne à l'autre.
  const emMax = Math.max(0, ...em.filter((r) => r.recipients_count >= MIN_SENT).map((r) => (r.clicks_count * 100) / r.recipients_count));
  const sm = sms.data ?? [];
  const smMax = 100;
  const pu = push.data ?? [];
  const when = (iso: string | null | undefined) => (iso ? fmtDate(iso, lang) : '—');

  return (
    <Page title={t('adm.comms.cp.title')} subtitle={t('adm.comms.cp.sub')}
      period
      actions={(
        <>
          <button type="button" className="a-btn" onClick={() => navigate('/admin/comms/push?new=1')}>{t('adm.comms.cp.newPush')}</button>
          <button type="button" className="a-btn" onClick={() => navigate('/admin/comms/sms')}>{t('adm.comms.cp.newSms')}</button>
          <button type="button" className="a-btn a-btn--primary" onClick={() => navigate('/admin/comms/email/new')}>{t('adm.comms.cp.newEmail')}</button>
        </>
      )}>
      <Hero kicker={t('adm.comms.cp3.kicker', { n: range.days })} loading={loading} value={fmtNum(total, lang)} current={total} previous={prevTotal}
        sentence={sentSentence}
        chart={loading ? <div className="a-skel h-[200px] w-full" /> : total === 0 && prevTotal === 0 ? null : (
          <HeroChart data={points} height={200} formatX={(x) => fmtAxisDay(x, lang)} formatV={(v) => fmtNum(v, lang)} formatTick={(v) => fmtCompact(v, lang)}
            labels={{ cur: t('adm.comms.cp3.series'), prev: t('adm.comms.cp3.prev'), peak: t('adm.comms.cp3.peak') }} />
        )}
        note={delta == null && prevTotal === 0 ? t('adm.comms.cp3.noPrev') : undefined}
        aside={(
          <>
            <Block title={t('adm.comms.cp3.base')} meta={t('adm.comms.cp3.baseMeta')}>
              {ov.isLoading ? <div className="a-skel h-20 w-full" /> : (
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col gap-2"><span className="a-kicker">{t('adm.comms.cp.tab.email')}</span><StackedShare legend="inline" emptyText={t('adm.comms.cp3.baseEmpty')} parts={shareParts('email')} /></div>
                  <div className="flex flex-col gap-2"><span className="a-kicker">{t('adm.comms.cp.tab.sms')}</span><StackedShare legend="inline" emptyText={t('adm.comms.cp3.baseEmpty')} parts={shareParts('sms')} /></div>
                  <p className="a-t3 text-[12px]">{t('adm.comms.cp.k.emailHint')}</p>
                </div>
              )}
            </Block>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="a-btn a-btn--sm" onClick={() => sync.mutate()} disabled={sync.isPending}>{sync.isPending ? t('adm.ui.working') : t('adm.comms.cp.sync')}</button>
              <button type="button" className="a-btn a-btn--sm" onClick={() => setImportOpen(true)}>{t('adm.comms.cp.import')}</button>
              <button type="button" className="a-btn a-btn--sm" onClick={() => navigate('/admin/comms/automations')}>{t('adm.comms.cp.recipes')}</button>
            </div>
          </>
        )} />

      <Block title={t('adm.comms.cp3.rhythm')} meta={t('adm.comms.cp3.rhythmMeta')}>
        {loading ? <div className="a-skel h-24 w-full" /> : sends.length === 0 ? <EmptyLine>{t('adm.comms.cp3.rhythmNone')}</EmptyLine> : (
          <CalendarHeat days={heat} weekdays={['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((x) => x)} fmt={(d, v) => `${fmtDate(`${d}T12:00:00Z`, lang)} · ${fmtNum(v, lang)}`} />
        )}
      </Block>

      <ChannelBlock title={t('adm.comms.cp.tab.email')} count={em.length} loading={emails.isLoading} empty={t('adm.comms.cp.emptyEmail')} emptyBody={t('adm.comms.cp.emptyBody')}>
        {(limit) => em.slice(0, limit).map((r) => (
          <LedgerRow key={r.id} onClick={() => navigate(r.status === 'draft' ? `/admin/comms/email/${r.id}/edit` : `/admin/comms/email/${r.id}/report`)}
            className="grid-cols-1 md:grid-cols-[110px_minmax(0,1.5fr)_90px_minmax(0,1fr)_90px]">
            <Status strong tone={STATUS_TONE[r.status] ?? 'neutral'}>{stLabel(r.status)}</Status>
            <div className="flex min-w-0 flex-col"><span className="a-t1 truncate text-[13.5px] font-medium">{r.name}</span><span className="a-t3 truncate text-[12px]">{r.subject}</span></div>
            <span className="a-num a-t2 text-[12.5px]">{fmtNum(r.recipients_count, lang)}</span>
            <MiniBar value={r.recipients_count >= MIN_SENT ? (r.clicks_count * 100) / r.recipients_count : null} max={emMax} display={fmtPct((r.clicks_count * 100) / Math.max(1, r.recipients_count), 1, lang)} />
            <span className="a-mono a-t3 text-[11px]">{when(r.sent_at ?? r.scheduled_at ?? r.created_at)}</span>
          </LedgerRow>
        ))}
      </ChannelBlock>
      <ChannelBlock title={t('adm.comms.cp.tab.sms')} count={sm.length} loading={sms.isLoading} empty={t('adm.comms.cp.emptySms')} emptyBody={t('adm.comms.cp.emptyBody')}>
        {(limit) => sm.slice(0, limit).map((r) => (
          <LedgerRow key={r.id} onClick={() => navigate(`/admin/comms/sms/${r.id}`)} className="grid-cols-1 md:grid-cols-[110px_minmax(0,1.5fr)_90px_minmax(0,1fr)_90px]">
            <Status strong tone={STATUS_TONE[r.status] ?? 'neutral'}>{stLabel(r.status)}</Status>
            <span className="a-t1 truncate text-[13.5px] font-medium">{r.name || t('adm.comms.cp.c.untitled')}</span>
            <span className="a-num a-t2 text-[12.5px]">{fmtNum(r.sent_count ?? 0, lang)}</span>
            <MiniBar value={r.sent_count && r.sent_count >= MIN_SENT ? ((r.delivered_count ?? 0) * 100) / r.sent_count : null} max={smMax} tone={(r.failed_count ?? 0) > 0 ? 'warning' : 'neutral'}
              display={r.sent_count ? fmtPct(((r.delivered_count ?? 0) * 100) / r.sent_count, 0, lang) : '—'} />
            <span className="a-mono a-t3 text-[11px]">{when(r.sent_at ?? r.scheduled_at ?? r.created_at)}</span>
          </LedgerRow>
        ))}
      </ChannelBlock>
      <ChannelBlock title={t('adm.comms.cp.tab.push')} count={pu.length} loading={push.isLoading} empty={t('adm.comms.cp.emptyPush')} emptyBody={t('adm.comms.cp.emptyBody')}>
        {(limit) => pu.slice(0, limit).map((r) => (
          <LedgerRow key={r.id} onClick={() => navigate('/admin/comms/push')} className="grid-cols-1 md:grid-cols-[110px_minmax(0,1.5fr)_90px_minmax(0,1fr)_90px]">
            <Status strong tone={STATUS_TONE[r.status ?? 'sent'] ?? 'neutral'}>{stLabel(r.status ?? 'sent')}</Status>
            <div className="flex min-w-0 flex-col"><span className="a-t1 truncate text-[13.5px] font-medium">{r.title}</span><span className="a-t3 text-[12px]">{r.segment}</span></div>
            <span className="a-num a-t2 text-[12.5px]">{fmtNum(r.sent_count, lang)}</span>
            <MiniBar value={r.targeted_count ? (r.sent_count * 100) / r.targeted_count : null} max={100} display={r.targeted_count ? fmtPct((r.sent_count * 100) / r.targeted_count, 0, lang) : '—'} />
            <span className="a-mono a-t3 text-[11px]">{when(r.scheduled_at ?? r.created_at)}</span>
          </LedgerRow>
        ))}
      </ChannelBlock>

      <Fold title={t('adm.comms.cp.tab.lists')} hint={o ? fmtNum(o.imports.length, lang) : undefined}>
        <DataTable data={o?.imports} columns={listCols} loading={ov.isLoading} error={ov.error} onRetry={() => void ov.refetch()} getRowId={(r) => r.id}
          initialSort={[{ id: 'created_at', desc: true }]} empty={{ title: t('adm.comms.cp.emptyLists'), body: t('adm.comms.cp.emptyListsBody') }} />
      </Fold>
      {o?.quota && (
        <Fold title={t('adm.comms.cp.quota')}>
          <div className="grid grid-cols-1 gap-x-10 gap-y-5 md:grid-cols-3">
            {([
              ['quotaMonth', o.quota.used, o.quota.free],
              ['quotaDay', o.quota.day_used, o.quota.day_cap],
              ['quotaPool', o.quota.pool_used, o.quota.pool_cap],
            ] as const).map(([k, used, cap]) => (
              <BulletBar key={k} value={used} max={Math.max(1, cap)} zones={[cap * 0.7, cap * 0.9]} label={t(`pm.${k}`)} display={`${fmtNum(used, lang)} / ${fmtNum(cap, lang)}`} />
            ))}
          </div>
          <p className="a-t3 text-[12.5px]">{t('pm.quotaHint')}</p>
        </Fold>
      )}
      <ContactImportDialog open={importOpen} onClose={() => setImportOpen(false)} scope={{ kind: 'platform' }} onChanged={() => void qc.invalidateQueries({ queryKey: COMMS_KEY })} />
    </Page>
  );
}

/** Un canal : ses huit derniers envois en lignes denses, le reste derrière un bouton. */
function ChannelBlock({ title, count, loading, empty, emptyBody, children }: {
  title: string; count: number; loading: boolean; empty: string; emptyBody: string; children: (limit: number) => ReactNode;
}) {
  const { t } = useAdminT();
  const [all, setAll] = useState(false);
  const shown = all ? count : Math.min(8, count);
  return (
    <Block title={title} meta={String(count)}>
      {loading ? <div className="a-skel h-20 w-full" /> : count === 0 ? <EmptyLine>{empty} {emptyBody}</EmptyLine> : (
        <>
          <Ledger>{children(shown)}</Ledger>
          {count > 8 && <button type="button" className="a-btn a-btn--sm self-start" onClick={() => setAll((v) => !v)}>{all ? t('adm.comms.cp3.less') : t('adm.comms.cp3.more', { n: count - 8 })}</button>}
        </>
      )}
    </Block>
  );
}
