/**
 * Pilotage › Rétention des pros (v3) : « Les pros qui vendent continuent-ils ? »
 *   1. Héros : la grille de cohortes EST la réponse (mois de première vente ×
 *      mois suivants, teinte selon la part encore active), lue par une phrase
 *      (« Sur les 5 pros arrivés en septembre, 4 vendent encore ») ; une ligne
 *      « toutes cohortes » sert de repère ; nombres bruts sous 10 comptes ;
 *   2. les pros à risque, en lignes actionnables (fiche, téléphone) ;
 *   3. Yuno CRM : l'état des comptes en barre à 100 %, les départs en frise
 *      sur 12 mois.
 * Sources : admin_pro_retention ; pros à risque : admin_accounts (statut
 * `at_risk`, même définition que la liste des Pros). Aucun calcul changé.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Phone } from 'lucide-react';
import {
  Block, ErrorState, Hero, Page, Segmented, StackedShare, tintOf, useAdminFilters, useAdminT,
} from '@/admin/ui';
import { fmtEur, fmtNum, fmtPct, fmtRelative } from '@/lib/adminFormat';
import { MIN_SAMPLE } from '@/lib/metrics';
import { cohortCell, fmtMonth, proHref, type CohortMode } from './format';
import { useRetention, type Retention } from './data';
import { useAccounts } from '../pros/data';
import { cohortStory } from './rules';
import { TextLink } from './links';

const KS = [0, 1, 2, 3, 4, 5, 6];
const CRM_STATES = ['paid', 'trial', 'late', 'paused', 'churned'];

export default function RetentionPage() {
  const { t, lang } = useAdminT();
  const { includeDemo } = useAdminFilters();
  const q = useRetention(includeDemo);
  const acc = useAccounts();
  const d = q.data;
  const [mode, setMode] = useState<CohortMode>('accounts');
  const n = (v: number | null | undefined) => fmtNum(v ?? 0, lang);

  const story = useMemo(() => (d ? cohortStory(d.cohorts) : null), [d]);
  const atRisk = useMemo(() => (acc.data?.accounts ?? []).filter((r) => r.status === 'at_risk')
    .sort((a, b) => (b.revenue_total ?? 0) - (a.revenue_total ?? 0)), [acc.data]);

  if (q.error && !d) return <Page title={t('adm.pil.ret.title')}><ErrorState onRetry={() => void q.refetch()} /></Page>;

  const sentence = !d ? null : !story ? t('adm.pil.ret.none') : story.still == null ? (
    <>{t('adm.pil.v3r.tooSoon', { m: fmtMonth(story.m, lang), n: n(story.size) })}</>
  ) : (
    <>
      {t(story.size === 1 ? 'adm.pil.v3r.storyOne' : 'adm.pil.v3r.story', { n: n(story.size), m: fmtMonth(story.m, lang) })}{' '}
      <b>{n(story.still)}</b> {t(story.still === 1 ? 'adm.pil.v3r.stillOne' : 'adm.pil.v3r.still', { k: story.after })}
      {d.pros_ever > 0 ? <> {t('adm.pil.v3r.ever', { n: n(d.pros_ever) })}</> : null}
    </>
  );

  const states = d ? CRM_STATES.map((s) => ({ key: s, label: t(`adm.pil.v3r.crm.${s}`), value: d.crm_states[s] ?? 0, display: n(d.crm_states[s] ?? 0) })) : [];

  return (
    <Page title={t('adm.pil.ret.title')}>
      <Hero
        kicker={t('adm.pil.v3r.kicker')}
        loading={!d}
        value={story?.still != null ? t('adm.pil.v3r.value', { a: n(story.still), b: n(story.size) }) : n(d?.pros_ever)}
        sentence={sentence}
        actions={(
          <Segmented<CohortMode> value={mode} onChange={setMode} label={t('adm.pil.ret.cohorts')}
            options={[{ value: 'accounts', label: t('adm.pil.ret.byAccounts') }, { value: 'sales', label: t('adm.pil.ret.bySales') }]} />
        )}
        chart={!d ? <div className="a-skel h-48 w-full" /> : d.cohorts.length === 0 ? null : <Cohorts cohorts={d.cohorts} mode={mode} />}
        note={d && d.cohorts.every((c) => c.size < MIN_SAMPLE) ? t('adm.pil.v3r.rawNote') : t('adm.pil.v3r.note')}
      />

      <Block title={t('adm.pil.v3r.riskTitle')} meta={acc.data ? t(atRisk.length === 1 ? 'adm.pil.v3r.riskMetaOne' : 'adm.pil.v3r.riskMeta', { n: n(atRisk.length) }) : undefined}>
        {acc.isLoading ? <div className="a-skel h-24 w-full" /> : acc.error && !acc.data ? <ErrorState onRetry={() => void acc.refetch()} /> : atRisk.length === 0 ? (
          <p className="a-t2 text-[13px]">{t('adm.pil.v3r.noRisk')}</p>
        ) : (
          <ul className="flex flex-col">
            {atRisk.slice(0, 12).map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b py-2.5">
                <div className="flex min-w-0 flex-1 flex-col">
                  <TextLink to={proHref(r.key)} className="text-[13.5px] font-medium">{r.name}</TextLink>
                  <span className="a-t3 truncate text-[12px]">
                    {[r.city, t(`adm.pil.v3r.type.${r.type}`), r.owner_name].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <span className="a-mono a-t2 w-32 text-right text-[11.5px]">{r.last_sale_at ? t('adm.pil.v3r.lastSale', { when: fmtRelative(r.last_sale_at, lang) }) : t('adm.pil.v3r.noSale')}</span>
                <span className="a-num a-t1 w-24 text-right text-[13px]">{r.revenue_total != null ? fmtEur(r.revenue_total, lang, { cents: false }) : '—'}</span>
                <span className="flex gap-1.5">
                  {r.owner_phone && <a href={`tel:${r.owner_phone}`} className="a-btn a-btn--sm a-btn--ghost" aria-label={t('adm.pil.v3r.call')}><Phone className="h-3.5 w-3.5" /></a>}
                  <Link to={proHref(r.key)} className="a-btn a-btn--sm">{t('adm.pil.v3r.open')}<ArrowUpRight className="h-3.5 w-3.5" /></Link>
                </span>
              </li>
            ))}
          </ul>
        )}
        {atRisk.length > 12 && <Link to="/admin/pros?status=at_risk" className="a-t2 text-[12.5px] underline">{t('adm.pil.ret.toAtRisk')}</Link>}
      </Block>

      <div className="grid grid-cols-1 gap-10 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Block title={t('adm.pil.v3r.crmStates')}>
          {!d ? <div className="a-skel h-24 w-full" /> : <StackedShare parts={states} emptyText={t('adm.pil.v3r.noCrm')} fmtShare={(s) => (states.reduce((a, x) => a + x.value, 0) >= MIN_SAMPLE ? fmtPct(s * 100, 0, lang) : '')} />}
          {d && states.reduce((s, x) => s + x.value, 0) > 0 && states.reduce((s, x) => s + x.value, 0) < MIN_SAMPLE && <p className="a-t3 text-[12px]">{t('adm.pil.smallSample')}</p>}
        </Block>
        <Block title={t('adm.pil.ret.departures')} meta={d ? t(d.crm_departures.length === 1 ? 'adm.pil.v3r.depMetaOne' : 'adm.pil.v3r.depMeta', { n: n(d.crm_departures.length), eur: fmtEur(d.crm_departures.reduce((s, x) => s + x.price, 0), lang, { cents: false }) }) : undefined}>
          {!d ? <div className="a-skel h-24 w-full" /> : <Departures rows={d.crm_departures} paused={d.crm_paused} />}
        </Block>
      </div>
    </Page>
  );
}

/** La grille : comptes (ou ventes) encore actifs, teinte = part de la cohorte, repère « toutes cohortes ». */
function Cohorts({ cohorts, mode }: { cohorts: Retention['cohorts']; mode: CohortMode }) {
  const { t, lang } = useAdminT();
  const rows = [...cohorts].sort((a, b) => b.m.localeCompare(a.m));
  // Seuls les mois qu'au moins une cohorte a atteints : pas de colonnes de points.
  const reached = Math.max(0, ...cohorts.map((c) => c.months_elapsed));
  const ks = KS.filter((k) => k <= reached);
  // Repère : toutes cohortes confondues, seulement celles qui ont atteint le mois k.
  const pooled = ks.map((k) => {
    const eligible = cohorts.filter((c) => c.months_elapsed >= k && c.size > 0);
    const base = eligible.reduce((s, c) => s + (mode === 'accounts' ? c.size : c.amount[0] ?? 0), 0);
    const raw = eligible.reduce((s, c) => s + (mode === 'accounts' ? c.active[k] ?? 0 : c.amount[k] ?? 0), 0);
    return eligible.length === 0 ? null : { raw, share: base > 0 ? raw / base : null, base };
  });
  const totalSize = cohorts.reduce((s, c) => s + c.size, 0);
  const fmtRaw = (v: number) => (mode === 'sales' ? fmtEur(v, lang, { cents: false }) : fmtNum(v, lang));
  return (
    <div className="overflow-x-auto">
      <table className="a-cohort w-full border-collapse text-[12.5px]">
        <thead>
          <tr>
            <th className="a-kicker pb-2 text-left font-normal">{t('adm.pil.ret.cohort')}</th>
            <th className="a-kicker pb-2 pr-3 text-right font-normal">{t('adm.pil.ret.size')}</th>
            {ks.map((k) => <th key={k} className="a-kicker pb-2 text-center font-normal">{k === 0 ? 'M0' : `M+${k}`}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.m}>
              <td className="a-t2 whitespace-nowrap py-[3px] pr-3">{fmtMonth(c.m, lang)}</td>
              <td className="a-mono a-t3 pr-3 text-right">{fmtNum(c.size, lang)}</td>
              {ks.map((k) => {
                const v = cohortCell(c, k, mode);
                if (!v) return <td key={k} className="a-t3 text-center">·</td>;
                const share = c.size > 0 ? (mode === 'accounts' ? (c.active[k] ?? 0) / c.size : (c.amount[0] ?? 0) > 0 ? (c.amount[k] ?? 0) / (c.amount[0] ?? 1) : 0) : 0;
                return (
                  <td key={k} className="a-num h-8 min-w-[52px] text-center" title={v.pct != null ? fmtPct(v.pct * 100, 0, lang) : undefined}
                    style={{ background: tintOf(Math.min(1, share)), color: 'var(--a-text)' }}>
                    {v.pct != null && k > 0 ? fmtPct(v.pct * 100, 0, lang) : fmtRaw(v.raw)}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr className="border-t">
            <td className="a-t1 py-2 pr-3 font-medium">{t('adm.pil.v3r.pooled')}</td>
            <td className="a-mono a-t3 pr-3 text-right">{fmtNum(totalSize, lang)}</td>
            {pooled.map((p, k) => (
              <td key={k} className="a-mono a-t2 text-center text-[11.5px]">
                {p == null ? '·' : mode === 'accounts' && p.base >= MIN_SAMPLE && p.share != null ? fmtPct(p.share * 100, 0, lang) : mode === 'accounts' ? `${fmtNum(p.raw, lang)}/${fmtNum(p.base, lang)}` : fmtRaw(p.raw)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Départs du CRM en frise : 12 colonnes de mois, un nom par départ, le MRR perdu. */
function Departures({ rows, paused }: { rows: Retention['crm_departures']; paused: Retention['crm_paused'] }) {
  const { t, lang } = useAdminT();
  const months = useMemo(() => {
    const out: string[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      out.push(d.toISOString().slice(0, 7));
    }
    return out;
  }, []);
  const byMonth = new Map<string, Retention['crm_departures']>();
  rows.forEach((r) => { const m = r.at.slice(0, 7); byMonth.set(m, [...(byMonth.get(m) ?? []), r]); });
  const older = rows.filter((r) => r.at.slice(0, 7) < months[0]).length;
  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 ? <p className="a-t2 text-[13px]">{t('adm.pil.ret.noDepartures')}</p> : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[640px] grid-cols-12 border-t">
            {months.map((m) => {
              const list = byMonth.get(m) ?? [];
              return (
                <div key={m} className="flex min-h-[76px] min-w-0 flex-col gap-1 border-l px-1.5 pt-2 first:border-l-0">
                  <span className="a-mono a-t3 text-[10.5px]">{fmtMonth(m, lang)}</span>
                  {list.map((r) => (
                    <Link key={r.key + r.at} to={proHref(r.key)} className="a-focus flex min-w-0 flex-col rounded-[4px] px-1 py-0.5 no-underline hover:bg-[var(--a-hover)]" title={`${r.name ?? r.key} · ${fmtEur(r.price, lang)}`}>
                      <span className="a-t1 truncate text-[11.5px]">{r.name ?? r.key}</span>
                      <span className="a-mono a-t3 text-[10.5px]">−{fmtEur(r.price, lang, { cents: false })}</span>
                    </Link>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {older > 0 && <p className="a-t3 text-[12px]">{t('adm.pil.v3r.older', { n: fmtNum(older, lang) })}</p>}
      {paused.length > 0 && (
        <p className="a-t2 text-[12.5px]">
          <span className="a-kicker mr-2">{t('adm.pil.ret.pausedList')}</span>
          {paused.map((p, i) => <span key={p.key}>{i > 0 ? ', ' : ''}<TextLink to={proHref(p.key)}>{p.name ?? p.key}</TextLink><span className="a-t3"> ({t(`adm.pil.ret.state.${p.state}`)})</span></span>)}
        </p>
      )}
    </div>
  );
}
