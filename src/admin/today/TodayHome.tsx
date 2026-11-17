/**
 * Aujourd'hui (v3) : une vraie boîte de traitement.
 *   1. Le brief du jour : combien de décisions, dont combien d'urgentes,
 *      ce qu'a donné hier, et si tout tourne (une phrase calculée, brief.ts) ;
 *   2. la file à gauche, le contexte de la ligne choisie à droite (SplitView),
 *      traitable au clavier (j / k / entrée / e / l) ;
 *   3. la semaine en six small multiples sur le même axe, survol synchronisé ;
 *   4. le fil d'activité, en frise compacte.
 * Lectures : admin_today (file), admin_platform_analytics 7 j (ventes, revenu,
 * commandes, remboursements par jour), admin_pro_acquisition 7 j (inscriptions
 * et comptes créés par jour), admin_cockpit (feux). La santé vit aussi dans la
 * barre de pouls de l'en-tête.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { fmtAxisDay, fmtDate, fmtEur, fmtNum } from '@/lib/adminFormat';
import { Block, HoverSync, Page, SmallMultiples, SplitView, useAdminFilters, useAdminT, type Multiple } from '@/admin/ui';
import { TODAY_KEY, useCockpit, useToday } from './data';
import { QueueContext, QueueList, useQueueKeys } from './TodayQueue';
import { brief, openItems, yesterdayKey } from './brief';
import { lightsOf } from './health';
import { ActivityFeed } from './ActivityFeed';
import { usePlatformAnalytics } from '../money/data';
import { useAcquisition } from '../pilotage/data';
import { periodRange } from '../context/period';

/** Les phrases qui se suivent sans espace (elles portent leur ponctuation). */
const GLUED = new Set(['adm.today.b.u0', 'adm.today.b.u1', 'adm.today.b.uN', 'adm.today.b.acc0', 'adm.today.b.acc1', 'adm.today.b.accN']);

/** Met les nombres d'une phrase en encre forte. */
function emphasize(text: string) {
  return text.split(/(\d[\d   ,.]*(?:\s?€)?)/).map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p));
}

export default function TodayHome() {
  const { t, lang } = useAdminT();
  const { includeDemo } = useAdminFilters();
  const qc = useQueryClient();
  const today = useToday(includeDemo);
  const cockpit = useCockpit(includeDemo);
  const week = useMemo(() => periodRange('7d'), []);
  const money = usePlatformAnalytics(week);
  const acq = useAcquisition(week, includeDemo);

  const items = useMemo(() => today.data?.items ?? [], [today.data]);
  const [showMarked, setShowMarked] = useState(false);
  const shown = useMemo(() => (showMarked ? items : openItems(items)), [items, showMarked]);
  const order = useMemo(() => [...shown].sort((a, b) => a.urgency - b.urgency), [shown]);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!order.length) { setSelected(null); return; }
    if (!selected || !order.some((i) => i.key === selected)) setSelected(order[0].key);
  }, [order, selected]);
  useQueueKeys(order, selected, setSelected);
  const current = order.find((i) => i.key === selected) ?? null;
  const marked = items.length - openItems(items).length;

  // La semaine, jour par jour (même axe pour les six).
  const days = useMemo(() => {
    const out: string[] = [];
    for (let i = 6; i >= 0; i--) out.push(new Date(Date.now() - i * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }));
    return out;
  }, []);
  const byDay = money.data?.cur.by_day;
  const acqDay = acq.data?.by_day;
  const pick = <T,>(rows: T[] | undefined, d: string, f: (r: T) => number, key: (r: T) => string) => {
    const r = rows?.find((x) => key(x).slice(0, 10) === d);
    return r ? f(r) : 0;
  };
  const series = (f: (r: NonNullable<typeof byDay>[number]) => number) => days.map((d) => pick(byDay, d, f, (r) => r.d));
  const sales = series((r) => r.tickets + r.tables);
  const yuno = series((r) => r.yuno);
  const orders = series((r) => r.ticket_n + r.table_n);
  const refunds = series((r) => r.refunds);
  const started = days.map((d) => pick(acqDay, d, (r) => r.started, (r) => r.d));
  const created = days.map((d) => pick(acqDay, d, (r) => r.created, (r) => r.d));
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const prevTotals = money.data?.prev.totals;
  const curTotals = money.data?.cur.totals;
  const eur = (v: number) => fmtEur(v, lang, { cents: false });

  const multiples: Multiple[] = [
    { key: 'sales', label: t('adm.today.w.sales'), total: eur(curTotals?.gmv ?? sum(sales)), series: sales, format: eur, current: curTotals?.gmv ?? sum(sales), previous: prevTotals ? prevTotals.gmv : undefined, to: '/admin/money?p=7d', emptyText: t('adm.today.w.salesEmpty') },
    { key: 'yuno', label: t('adm.today.w.yuno'), total: fmtEur(curTotals?.yuno_revenue ?? sum(yuno), lang), series: yuno, format: (v) => fmtEur(v, lang), current: curTotals?.yuno_revenue ?? sum(yuno), previous: prevTotals ? prevTotals.yuno_revenue : undefined, to: '/admin/money?p=7d', emptyText: t('adm.today.w.zero') },
    { key: 'orders', label: t('adm.today.w.orders'), total: fmtNum(curTotals?.tx_count ?? sum(orders), lang), series: orders, format: (v) => fmtNum(v, lang), kind: 'bar', current: curTotals?.tx_count ?? sum(orders), previous: prevTotals ? prevTotals.tx_count : undefined, to: '/admin/money/orders', emptyText: t('adm.today.w.zero') },
    { key: 'refunds', label: t('adm.today.w.refunds'), total: eur(curTotals?.refunds_total ?? sum(refunds)), series: refunds, format: eur, kind: 'bar', invert: true, current: curTotals?.refunds_total, previous: prevTotals ? prevTotals.refunds_total : undefined, to: '/admin/money/orders?status=refunded', emptyText: t('adm.today.w.noRefund') },
    { key: 'started', label: t('adm.today.w.started'), total: fmtNum(sum(started), lang), series: started, format: (v) => fmtNum(v, lang), kind: 'bar', to: '/admin/pros/prospects?src=signup', emptyText: t('adm.today.w.zero') },
    { key: 'created', label: t('adm.today.w.created'), total: fmtNum(sum(created), lang), series: created, format: (v) => fmtNum(v, lang), kind: 'bar', to: '/admin/pilot/acquisition?p=7d', emptyText: t('adm.today.w.zero') },
  ];

  const yKey = yesterdayKey();
  const phrases = brief({
    items,
    yesterdaySales: byDay ? pick(byDay, yKey, (r) => r.tickets + r.tables, (r) => r.d) : null,
    yesterdayAccounts: acqDay ? pick(acqDay, yKey, (r) => r.created, (r) => r.d) : null,
    lights: cockpit.data?.health ? lightsOf(cockpit.data.health, t, lang) : null,
    fmtEur: eur,
  });
  const sentence = phrases.map((p, i) => `${i > 0 && !GLUED.has(p.key) ? ' ' : ''}${t(p.key, p.vars)}`).join('');
  const open = openItems(items);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: TODAY_KEY });
    void cockpit.refetch(); void money.refetch(); void acq.refetch();
  };

  return (
    <Page title={t('adm.today.title')}
      actions={(
        <>
          {marked > 0 && (
            <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => setShowMarked((v) => !v)}>
              {showMarked ? t('adm.today.queue.hideMarked') : t('adm.today.queue.showMarked', { n: marked })}
            </button>
          )}
          <button type="button" className="a-btn a-btn--sm" onClick={refresh} disabled={today.isFetching}>
            <RefreshCw className="h-3.5 w-3.5" />{t('adm.today.refresh')}
          </button>
        </>
      )}>
      {/* Le brief : un grand chiffre (les décisions du jour) et sa phrase. */}
      <section className="flex flex-col gap-3">
        <span className="a-kicker">{t('adm.today.b.kicker', { date: fmtDate(new Date().toISOString(), lang, 'long') })}</span>
        {today.isLoading ? (
          <div className="flex flex-col gap-3"><div className="a-skel h-14 w-24" /><div className="a-skel h-4 w-[32rem] max-w-full" /></div>
        ) : (
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <span className="a-hero-value">{fmtNum(open.length, lang)}</span>
            <p className="a-hero-sentence max-w-[64ch] pb-1">{emphasize(sentence)}</p>
          </div>
        )}
      </section>

      {today.error && !today.data ? (
        <p className="a-t2 text-[13px]">{t('adm.ui.error.title')} <button type="button" className="a-btn a-btn--sm ml-2" onClick={() => void today.refetch()}>{t('adm.ui.error.retry')}</button></p>
      ) : !today.isLoading && order.length === 0 ? (
        <div className="flex items-center gap-3 border-y py-6">
          <span className="grid h-8 w-8 place-items-center rounded-full" style={{ background: 'var(--a-pos-soft)', color: 'var(--a-pos)' }}><Check className="h-4 w-4" /></span>
          <div><p className="a-t1 text-[15px] font-semibold">{t('adm.today.queue.empty')}</p><p className="a-t3 text-[13px]">{t('adm.today.queue.emptyBody')}</p></div>
        </div>
      ) : (
        <SplitView
          list={today.isLoading
            ? <div className="flex flex-col gap-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="a-skel h-9" />)}</div>
            : <QueueList items={order} selected={selected} onSelect={setSelected} />}
          panel={<QueueContext item={current} />} />
      )}

      <Block title={t('adm.today.w.title')} meta={t('adm.today.w.meta')}>
        <HoverSync>
          <SmallMultiples items={multiples} xLabels={days.map((d) => fmtAxisDay(d, lang))} columns={6} />
        </HoverSync>
      </Block>

      <ActivityFeed includeDemo={includeDemo} />
    </Page>
  );
}
