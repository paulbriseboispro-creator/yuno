/**
 * Communication › Notifications automatiques : « Le moteur de notifications
 * de Yuno envoie-t-il aux bonnes personnes, au bon moment ? » En-tête,
 * chiffres comparés et courbe à une échelle, puis trois onglets : règles et
 * textes (tableau + tiroir), politique anti-spam (file comprise), crédits de
 * campagnes des pros. Le registre des notifications unitaires est dans
 * Système › Interrupteurs.
 */
import { Card, Chart, ErrorState, Kpi, KpiRow, Page, Tabs, useAdminFilters, useAdminT, useTab } from '@/admin/ui';
import { fmtAxisDay, fmtNum, fmtPct } from '@/lib/adminFormat';
import { tapRate } from '@/lib/pushEngine';
import { useEngine } from './data';
import EngineRules from './EngineRules';
import EnginePolicy from './EnginePolicy';
import EngineCredits from './EngineCredits';

export default function Engine() {
  const { t, lang } = useAdminT();
  const { range } = useAdminFilters();
  const cur = useEngine(range.days);
  const both = useEngine(range.days * 2);
  const tabs = [
    { value: 'rules', label: t('adm.comms.en.tab.rules') },
    { value: 'policy', label: t('adm.comms.en.tab.policy') },
    { value: 'credits', label: t('adm.comms.en.tab.credits') },
  ];
  const [tab, setTab] = useTab(tabs);

  const d = cur.data;
  // Période précédente = (2 × durée) moins la durée courante, même RPC : aucun calcul nouveau.
  const prev = d && both.data ? {
    sent: both.data.totals.sent - d.totals.sent, taps: both.data.totals.taps - d.totals.taps,
    buyers: both.data.totals.buyers - d.totals.buyers, held: both.data.totals.held - d.totals.held,
  } : null;
  const rate = d ? tapRate(d.totals.taps, d.totals.sent) : null;
  const series = (d?.series ?? []).map((s) => ({ day: s.day.slice(0, 10), sent: s.sent, taps: s.taps }));

  return (
    <Page title={t('adm.comms.en.title')} subtitle={t('adm.comms.en.sub')} period>
      {cur.isError && !d ? <Card><ErrorState onRetry={() => void cur.refetch()} /></Card> : (
        <>
          <KpiRow>
            <Kpi label={t('adm.comms.en.k.sent')} value={fmtNum(d?.totals.sent ?? 0, lang)} current={d?.totals.sent} previous={prev?.sent} loading={cur.isLoading} />
            <Kpi label={t('adm.comms.en.k.opened')} value={fmtNum(d?.totals.taps ?? 0, lang)} current={d?.totals.taps} previous={prev?.taps}
              hint={rate == null ? undefined : t('adm.comms.en.k.rate', { pct: fmtPct(rate) })} loading={cur.isLoading} />
            <Kpi label={t('adm.comms.en.k.buyers')} value={fmtNum(d?.totals.buyers ?? 0, lang)} current={d?.totals.buyers} previous={prev?.buyers} hint={t('adm.comms.en.k.buyersHint')} loading={cur.isLoading} />
            <Kpi label={t('adm.comms.en.k.held')} value={fmtNum(d?.totals.held ?? 0, lang)} current={d?.totals.held} previous={prev?.held} hint={t('adm.comms.en.k.heldHint')} loading={cur.isLoading} />
          </KpiRow>
          <Card title={t('adm.comms.en.chart')}>
            <Chart kind="line" data={series} x="day" formatX={(v) => fmtAxisDay(v, lang)} unit="count" height={240}
              series={[{ key: 'sent', label: t('adm.comms.en.k.sent') }, { key: 'taps', label: t('adm.comms.en.k.opened') }]}
              loading={cur.isLoading} empty={t('adm.comms.en.noSends')} />
          </Card>
        </>
      )}
      <Tabs items={tabs} value={tab} onChange={setTab} />
      {tab === 'rules' && (d ? <EngineRules data={d} /> : <div className="a-skel h-40" />)}
      {tab === 'policy' && (d ? <EnginePolicy data={d} /> : <div className="a-skel h-40" />)}
      {tab === 'credits' && (d ? <EngineCredits data={d} /> : <div className="a-skel h-40" />)}
    </Page>
  );
}
