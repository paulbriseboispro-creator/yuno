/**
 * Communication › Notifications automatiques (v3) : « Le moteur de
 * notifications de Yuno envoie-t-il aux bonnes personnes, au bon moment ? »
 *   héros : ce que le moteur a envoyé, ouvert, fait acheter (phrase + courbe) ;
 *   les chiffres comparés en bande ; les règles en tableau de bord (barres
 *   comparables d'une ligne à l'autre) ; la politique anti-spam en crans ;
 *   les crédits des pros repliés. Le registre des notifications unitaires est
 *   dans Système › Interrupteurs.
 */
import { Block, ErrorState, Hero, HeroChart, Page, StatStrip, useAdminFilters, useAdminT, type Stat, EmptyLine, Fold } from '@/admin/ui';
import { fmtAxisDay, fmtCompact, fmtNum, fmtPct } from '@/lib/adminFormat';
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
  const d = cur.data;
  // Période précédente = (2 × durée) moins la durée courante, même RPC : aucun calcul nouveau.
  const prev = d && both.data ? {
    sent: both.data.totals.sent - d.totals.sent, taps: both.data.totals.taps - d.totals.taps,
    buyers: both.data.totals.buyers - d.totals.buyers, held: both.data.totals.held - d.totals.held,
  } : null;
  const rate = d ? tapRate(d.totals.taps, d.totals.sent) : null;
  const points = (d?.series ?? []).map((s) => ({ x: s.day.slice(0, 10), v: s.sent }));
  // Rien d'ouvert, d'acheté ni de retenu : la phrase le dit, pas trois tuiles à zéro.
  const quiet = !!d && d.totals.taps === 0 && d.totals.buyers === 0 && d.totals.held === 0;
  const stats: Stat[] = d ? [
    { key: 'taps', label: t('adm.comms.en.k.opened'), value: fmtNum(d.totals.taps, lang), current: d.totals.taps, previous: prev?.taps, hint: rate == null ? undefined : t('adm.comms.en.k.rate', { pct: fmtPct(rate) }) },
    { key: 'buyers', label: t('adm.comms.en.k.buyers'), value: fmtNum(d.totals.buyers, lang), current: d.totals.buyers, previous: prev?.buyers, hint: t('adm.comms.en.k.buyersHint') },
    { key: 'held', label: t('adm.comms.en.k.held'), value: fmtNum(d.totals.held, lang), current: d.totals.held, previous: prev?.held, hint: t('adm.comms.en.k.heldHint') },
  ] : [];

  if (cur.isError && !d) return <Page title={t('adm.comms.en.title')} period><ErrorState onRetry={() => void cur.refetch()} /></Page>;

  return (
    <Page title={t('adm.comms.en.title')} subtitle={t('adm.comms.en.sub')} period>
      <Hero kicker={t('adm.comms.en3.kicker', { n: range.days })} loading={!d} value={fmtNum(d?.totals.sent ?? 0, lang)} current={d?.totals.sent} previous={prev?.sent}
        sentence={d ? (d.totals.sent === 0 ? t('adm.comms.en3.none', { n: range.days }) : quiet ? t('adm.comms.en3.nothingYet', { n: range.days }) : t('adm.comms.en3.sentence', {
          n: range.days, taps: fmtNum(d.totals.taps, lang), rate: rate == null ? '—' : fmtPct(rate), buyers: fmtNum(d.totals.buyers, lang), held: fmtNum(d.totals.held, lang) })) : null}
        chart={!d ? <div className="a-skel h-[200px] w-full" /> : d.totals.sent === 0 ? null : (
          <HeroChart data={points} height={200} formatX={(x) => fmtAxisDay(x, lang)} formatV={(v) => fmtNum(v, lang)} formatTick={(v) => fmtCompact(v, lang)}
            labels={{ cur: t('adm.comms.en.k.sent'), peak: t('adm.comms.cp3.peak') }} />
        )}
        note={<>{t('adm.comms.en3.protected')}</>} />
      {d && !quiet && <StatStrip items={stats} />}
      {d ? <EngineRules data={d} /> : <Block title={t('adm.comms.en3.rules')}><div className="a-skel h-40 w-full" /></Block>}
      {d ? <EnginePolicy data={d} /> : <EmptyLine>{t('adm.comms.en3.loading')}</EmptyLine>}
      <Fold title={t('adm.comms.en.tab.credits')} hint={t('adm.comms.en3.creditsHint')}>{d ? <EngineCredits data={d} /> : <div className="a-skel h-24 w-full" />}</Fold>
    </Page>
  );
}
