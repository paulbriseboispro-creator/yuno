/**
 * Page de référence (suite) : les formes remontées au kit le 17/11 depuis les
 * rubriques (barres, lignes, états, délais, listes, filtres). Données d'exemple.
 */
import { useState } from 'react';
import {
  Block, CapacityBar, Chips, Columns, Complete, Countdown, DeadlineBar, EmptyLine, Grid, Ledger, LedgerRow, Level, LinesChart,
  MiniBar, Note, PairBars, SegmentBar, Spine, Status, Steps, TinyBars, Verdict, useAdminT,
} from '@/admin/ui';
import { fmtAxisDay, fmtNum } from '@/lib/adminFormat';

const DAY = 86400e3;

export function UiReferenceKit() {
  const { t, lang } = useAdminT();
  const [seg, setSeg] = useState<string | null>(null);
  const [chip, setChip] = useState<'all' | 'open' | 'late'>('all');
  const xs = Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(2026, 10, 3) + i * DAY).toISOString().slice(0, 10));
  const n = (v: number) => fmtNum(v, lang);
  return (
    <>
      <Verdict tone="warning" kicker={t('adm.sys.ui.k3.verdictK')} headline={t('adm.sys.ui.k3.verdict')} sub={t('adm.sys.ui.k3.verdictSub')} />
      <Grid cols={2}>
        <Block title={t('adm.sys.ui.k3.lines')}>
          <LinesChart xs={xs} formatX={(x) => fmtAxisDay(x, lang)} formatV={n} height={180} series={[
            { key: 'a', label: t('adm.sys.ui.k3.web'), role: 'main', values: xs.map((_, i) => 20 + ((i * 7) % 15)) },
            { key: 'b', label: t('adm.sys.ui.k3.app'), role: 'ink', values: xs.map((_, i) => 8 + ((i * 5) % 9)) },
            { key: 'c', label: t('adm.sys.ui.k3.prev'), role: 'ref', values: xs.map((_, i) => 16 + ((i * 3) % 11)) },
          ]} />
        </Block>
        <Block title={t('adm.sys.ui.k3.columns')}>
          <Columns label={t('adm.sys.ui.k3.web')} highlight="max" emptyText="—" items={['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((x, i) => ({ key: String(i), x, value: [3, 4, 2, 9, 22, 31, 6][i], display: n([3, 4, 2, 9, 22, 31, 6][i]) }))} />
        </Block>
      </Grid>
      <Block title={t('adm.sys.ui.k3.segment')}>
        <SegmentBar ariaLabel={t('adm.sys.ui.k3.segment')} fmt={n} selected={seg} onSelect={setSeg} segments={[
          { key: 'a', label: t('adm.sys.ui.k3.s.selling'), value: 12, color: 'color-mix(in srgb, var(--a-text) 30%, transparent)' },
          { key: 'b', label: t('adm.sys.ui.k3.s.ready'), value: 7, color: 'color-mix(in srgb, var(--a-text) 20%, transparent)' },
          { key: 'c', label: t('adm.sys.ui.k3.s.signed'), value: 4, color: 'color-mix(in srgb, var(--a-text) 12%, transparent)' },
          { key: 'd', label: t('adm.sys.ui.k3.s.closed'), value: 0, color: 'var(--a-grid)' },
        ]} />
      </Block>
      <Grid cols={3}>
        <Block title={t('adm.sys.ui.k3.deadline')}>
          <DeadlineBar share={0.72} tone="warning" label={t('adm.sys.ui.k3.deadlineL')} right="J-8" mark={0.5} />
          <Countdown hours={41.2} total={72} tone="warning" label={t('adm.sys.ui.k3.countdown')} />
        </Block>
        <Block title={t('adm.sys.ui.k3.small')}>
          <div className="flex flex-col gap-3 text-[13px]">
            <span className="flex items-center gap-3"><MiniBar value={64} max={100} display="64" label={t('adm.sys.ui.k3.small')} /><MiniBar value={22} max={100} tone="warning" display="22" /></span>
            <span className="flex items-center gap-3"><Level level={3} /><Complete done={3} total={5} /><PairBars prev={12} cur={18} title="12 / 18" /></span>
            <TinyBars data={[0, 2, 1, 0, 4, 3, 0, 1]} label={t('adm.sys.ui.k3.small')} />
            <CapacityBar used={7600} cap={10000} label="7 600 / 10 000" />
          </div>
        </Block>
        <Block title={t('adm.sys.ui.k3.steps')}>
          <Steps items={[
            { key: 'a', label: t('adm.sys.ui.k3.st.a'), when: '12/11', done: true },
            { key: 'b', label: t('adm.sys.ui.k3.st.b'), when: '14/11', done: true },
            { key: 'c', label: t('adm.sys.ui.k3.st.c'), done: false, current: true },
          ]} />
        </Block>
      </Grid>
      <Grid cols={2}>
        <Block title={t('adm.sys.ui.k3.ledger')} actions={<Chips label={t('adm.sys.ui.k3.ledger')} value={chip} onChange={setChip} options={[
          { value: 'all', label: t('adm.sys.ui.k3.c.all'), count: 3 }, { value: 'open', label: t('adm.sys.ui.k3.c.open'), count: 2 }, { value: 'late', label: t('adm.sys.ui.k3.c.late'), count: 1 }]} />}>
          <Ledger>
            <LedgerRow className="grid-cols-[minmax(0,1fr)_auto]"><span className="a-t1 text-[13px]">Le Sonore</span><Status strong tone="positive">{t('adm.sys.ui.k3.c.ok')}</Status></LedgerRow>
            <LedgerRow className="grid-cols-[minmax(0,1fr)_auto]"><span className="a-t1 text-[13px]">Amoris</span><Status strong tone="warning">{t('adm.sys.ui.k3.c.open')}</Status></LedgerRow>
            <LedgerRow className="grid-cols-[minmax(0,1fr)_auto]"><span className="a-t1 text-[13px]">3 AM</span><Status strong tone="negative">{t('adm.sys.ui.k3.c.late')}</Status></LedgerRow>
          </Ledger>
          <Note>{t('adm.sys.ui.k3.note')}</Note>
        </Block>
        <Block title={t('adm.sys.ui.k3.spine')}>
          <Spine familyLabel={(f) => f} empty={<EmptyLine>—</EmptyLine>} items={[
            { id: '1', at: new Date(Date.now() - 2 * DAY).toISOString(), family: 'vente', title: t('adm.sys.ui.k3.sp.a'), value: '412 €', strong: true },
            { id: '2', at: new Date(Date.now() - 9 * DAY).toISOString(), family: 'e-mail', title: t('adm.sys.ui.k3.sp.b') },
            { id: '3', at: new Date(Date.now() - 40 * DAY).toISOString(), family: 'compte', title: t('adm.sys.ui.k3.sp.c') },
          ]} />
        </Block>
      </Grid>
      <EmptyLine>{t('adm.sys.ui.k3.empty')}</EmptyLine>
    </>
  );
}
