/**
 * Communication › Notifications automatiques : « Le moteur de notifications
 * de Yuno envoie-t-il aux bonnes personnes, au bon moment ? » En-tête,
 * chiffres comparés et courbe à une échelle, puis trois onglets : règles et
 * textes, politique anti-spam (file comprise), crédits de campagnes des pros.
 * Les formulaires de règles, de textes et de crédits sont ceux d'avant : seul
 * le registre des notifications unitaires a déménagé dans Système › Interrupteurs.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Sliders } from 'lucide-react';
import { Card, Chart, EmptyState, ErrorState, Grid, Kpi, KpiRow, KeyValue, Page, Section, Tabs, useAdminFilters, useAdminT, useTab } from '@/admin/ui';
import { fmtAxisDay, fmtNum, fmtPct, fmtRelative } from '@/lib/adminFormat';
import { tapRate } from '@/lib/pushEngine';
import { CreditsTab, POLICY_FIELDS, RulesTab, SettingsForm, holdLabel } from '@/pages/admin/AdminNotificationAutomations';
import { SuiteFrame } from '../shell/frames';
import { COMMS_KEY, useEngine } from './data';

export default function Engine() {
  const { t, lang } = useAdminT();
  const { range } = useAdminFilters();
  const qc = useQueryClient();
  const cur = useEngine(range.days);
  const both = useEngine(range.days * 2);
  const tabs = [
    { value: 'rules', label: t('adm.comms.en.tab.rules') },
    { value: 'policy', label: t('adm.comms.en.tab.policy') },
    { value: 'credits', label: t('adm.comms.en.tab.credits') },
  ];
  const [tab, setTab] = useTab(tabs);
  const refresh = () => { void qc.invalidateQueries({ queryKey: COMMS_KEY }); };

  const d = cur.data;
  // Période précédente = (2 × durée) moins la durée courante, même RPC : aucun calcul nouveau.
  const prev = d && both.data ? {
    sent: both.data.totals.sent - d.totals.sent, taps: both.data.totals.taps - d.totals.taps,
    buyers: both.data.totals.buyers - d.totals.buyers, held: both.data.totals.held - d.totals.held,
  } : null;
  const rate = d ? tapRate(d.totals.taps, d.totals.sent) : null;
  const series = (d?.series ?? []).map((s) => ({ day: s.day.slice(0, 10), sent: s.sent, taps: s.taps }));
  const holds = Object.entries(d?.queue.holds ?? {}).sort((a, b) => b[1] - a[1]);

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
      {tab === 'rules' && (d ? <SuiteFrame><RulesTab data={d} onSaved={refresh} /></SuiteFrame> : <div className="a-skel h-40" />)}
      {tab === 'policy' && (d ? (
        <div className="flex flex-col gap-6">
          <Grid cols={2}>
            <Card title={t('adm.comms.en.queue')}>
              <KeyValue items={[
                { label: t('adm.comms.en.pending'), value: fmtNum(d.queue.pending, lang) },
                { label: t('adm.comms.en.dueNow'), value: fmtNum(d.queue.dueNow, lang) },
                { label: t('adm.comms.en.claimed'), value: fmtNum(d.queue.claimed, lang) },
                { label: t('adm.comms.en.oldest'), value: d.queue.oldestDue ? fmtRelative(d.queue.oldestDue, lang) : '—' },
              ]} />
            </Card>
            <Card title={t('adm.comms.en.holds')}>
              {holds.length === 0 ? <EmptyState title={t('adm.comms.en.noHolds')} /> : (
                <KeyValue items={holds.map(([k, v]) => ({ label: holdLabel(t, k), value: fmtNum(v, lang) }))} />
              )}
            </Card>
          </Grid>
          <Section>
            <SuiteFrame><SettingsForm title={t('adm.comms.en.policy')} subtitle={t('adm.comms.en.policyHint')} icon={Sliders} fields={POLICY_FIELDS} settings={d.settings} onSaved={refresh} /></SuiteFrame>
          </Section>
        </div>
      ) : <div className="a-skel h-40" />)}
      {tab === 'credits' && (d ? <SuiteFrame><CreditsTab settings={d.settings} onSaved={refresh} /></SuiteFrame> : <div className="a-skel h-40" />)}
    </Page>
  );
}
