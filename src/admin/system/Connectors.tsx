/**
 * Système › Connecteurs : « Les billetteries connectées répondent-elles ? »
 * Shotgun (connexions, passes, quota partagé par minute, imports) et les
 * scénarios des comptes CRM. Le plan d'un prospect (`plan/:scope/:event`)
 * garde son écran, lu seul par le super admin avant l'appel.
 */
import { useMemo } from 'react';
import { Block, BulletBar, ErrorState, Page, RankBars, Spark, StatStrip, Tabs, useAdminFilters, useAdminT, useTab, type Stat, EmptyLine, Ledger, LedgerRow, MiniBar, Status, Verdict, type Tone } from '@/admin/ui';
import { fmtDate, fmtMs, fmtNum, fmtPct, fmtRelative } from '@/lib/adminFormat';
import { useAdminAccounts, useAdminScenarios, type AdminScenarioAccount } from '@/crm/admin/data';
import { ADMIN_ROUTES } from '@/crm/admin/adminNav';
import type { AdminAccount } from '@/crm/lib/admin';
import { usePlatformSync } from './data';

/** Plafond du limiteur commun (consume_ticketing_rate) : requêtes par minute. */
const SHOTGUN_LIMIT = 45;

export default function Connectors() {
  const { t } = useAdminT();
  const tabs = [{ value: 'shotgun', label: 'Shotgun' }, { value: 'scenarios', label: t('adm.sys.cn.tab.scenarios') }];
  const [tab, setTab] = useTab(tabs);
  return (
    <Page title={t('adm.sys.cn.title')} subtitle={t('adm.sys.cn.sub')}>
      <Tabs items={tabs} value={tab} onChange={setTab} />
      {tab === 'shotgun' ? <ShotgunTab /> : <ScenariosTab />}
    </Page>
  );
}

function ShotgunTab() {
  const { t, lang } = useAdminT();
  const { includeDemo } = useAdminFilters();
  const p = usePlatformSync(includeDemo);
  const acc = useAdminAccounts();
  const s = p.data?.shotgun;
  const connected = useMemo(() => (acc.data?.accounts ?? []).filter((a) => a.sync !== 'none').sort((a, b) => Number(b.sync === 'error') - Number(a.sync === 'error')), [acc.data]);
  const bad = connected.filter((a) => a.sync === 'error');
  const okRate = s && s.runs24 ? ((s.runs24 - s.errors24) / s.runs24) * 100 : null;
  const peak = s ? Math.max(0, ...s.hours.map((h) => h.req)) / 60 : 0;
  const imports = Object.entries(p.data?.imports ?? {}).map(([status, n]) => ({ status, n })).sort((a, b) => b.n - a.n);
  const tone: Tone = !s ? 'neutral' : bad.length > 0 || s.errors24 > 0 ? 'warning' : 'positive';

  return (
    <div className="flex flex-col gap-8">
      {p.isLoading || acc.isLoading ? <div className="a-skel h-10 w-[28rem] max-w-full" /> : (
        <Verdict tone={tone} kicker={t('adm.sys3.cn.kicker')}
          headline={connected.length === 0 ? t('adm.sys3.cn.headNone') : bad.length > 0 ? t('adm.sys3.cn.headBad', { n: bad.length, total: connected.length }) : t('adm.sys3.cn.headOk', { n: connected.length })}
          sub={s ? t('adm.sys3.cn.sub', { r: fmtNum(s.runs24, lang), e: fmtNum(s.errors24, lang), rate: okRate == null ? '—' : fmtPct(okRate, 1, lang), p50: s.duration.p50 == null ? '—' : fmtMs(s.duration.p50 * 1000, lang) }) : undefined} />
      )}

      <Block title={t('adm.sys.cn.quota')} meta={t('adm.sys3.cn.quotaMeta')}>
        {p.isLoading ? <div className="a-skel h-24 w-full" /> : !s || s.hours.length === 0 ? <EmptyLine>{t('adm.sys3.cn.noHours')}</EmptyLine> : (
          <div className="flex flex-col gap-4">
            <BulletBar value={peak} max={Math.max(SHOTGUN_LIMIT * 1.2, peak)} zones={[SHOTGUN_LIMIT * 0.6, SHOTGUN_LIMIT * 0.85]} target={SHOTGUN_LIMIT} targetLabel={t('adm.sys3.cn.limit', { n: SHOTGUN_LIMIT })}
              label={t('adm.sys3.cn.peak')} display={`${Math.round(peak * 10) / 10} / ${SHOTGUN_LIMIT} ${t('adm.sys3.cn.perMin')}`} />
            <div><Spark data={s.hours.map((h) => h.req)} kind="bar" height={56} />
              <div className="a-mono a-t3 flex justify-between text-[11px]"><span>{fmtDate(s.hours[0].h, lang, 'time')}</span><span>{t('adm.sys.cn.requests')}</span><span>{fmtDate(s.hours[s.hours.length - 1].h, lang, 'time')}</span></div></div>
            <p className="a-t3 text-[12.5px]">{t('adm.sys.cn.quotaNote', { peak: Math.round(peak * 10) / 10, limit: SHOTGUN_LIMIT })}</p>
          </div>
        )}
      </Block>

      <div className="grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Block title={t('adm.sys.cn.connections')} meta={fmtNum(connected.length, lang)}>
          {acc.isError && !acc.data ? <ErrorState onRetry={() => void acc.refetch()} /> : acc.isLoading ? <div className="a-skel h-20 w-full" /> : connected.length === 0 ? <EmptyLine>{t('adm.sys.cn.noConns')}</EmptyLine> : (
            <Ledger>
              {connected.map((a: AdminAccount) => (
                <LedgerRow key={a.id} to={ADMIN_ROUTES.account(a.id)} className="grid-cols-1 md:grid-cols-[minmax(0,1.1fr)_110px_minmax(0,1.2fr)]">
                  <span className="a-t1 truncate text-[13.5px] font-medium">{a.name}</span>
                  <Status strong tone={a.sync === 'ok' ? 'positive' : 'negative'}>{a.sync === 'ok' ? t('adm.sys.cn.ok') : t('adm.sys.cn.error')}</Status>
                  <span className="a-t3 truncate text-[12px]">{a.sync === 'error' ? a.sync_error ?? '' : a.sync_at ? fmtRelative(a.sync_at, lang) : '—'}</span>
                </LedgerRow>
              ))}
            </Ledger>
          )}
        </Block>
        <Block title={t('adm.sys.cn.imports')}>
          <RankBars emptyText={t('adm.sys.cn.noImports')} items={imports.map((r) => ({ key: r.status, label: r.status, value: r.n, display: fmtNum(r.n, lang) }))} />
        </Block>
      </div>
    </div>
  );
}

function ScenariosTab() {
  const { t, lang } = useAdminT();
  const q = useAdminScenarios();
  const d = q.data;
  const k = d?.totals;
  const held = Object.entries(d?.held ?? {}).map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n);
  const accounts = useMemo(() => [...(d?.accounts ?? [])].sort((a, b) => b.broken - a.broken || b.held_now - a.held_now), [d]);
  const stats: Stat[] = k ? [
    { key: 'active', label: t('adm.sys.cn.sc.active'), value: fmtNum(k.active, lang), hint: t('adm.sys.cn.sc.activeHint', { p: fmtNum(k.paused ?? 0, lang), d: fmtNum(k.drafts ?? 0, lang) }) },
    { key: 'way', label: t('adm.sys.cn.sc.way'), value: fmtNum(k.on_their_way, lang) },
    { key: 'sent', label: t('adm.sys.cn.sc.sent'), value: fmtNum(k.sent7, lang), hint: t('adm.sys.cn.sc.sentHint') },
    { key: 'held', label: t('adm.sys.cn.sc.held'), value: fmtNum(k.held_now, lang) },
    { key: 'broken', label: t('adm.sys.cn.sc.broken'), value: fmtNum(k.broken, lang), hint: t('adm.sys.cn.sc.brokenHint') },
  ] : [];
  const maxSent = Math.max(0, ...accounts.map((a) => a.sent7));
  return (
    <div className="flex flex-col gap-8">
      {q.isError && !d ? <ErrorState onRetry={() => void q.refetch()} /> : !k ? <div className="a-skel h-12 w-full" /> : (
        <>
          <Verdict tone={k.broken > 0 ? 'negative' : k.held_now > 0 ? 'warning' : 'positive'} kicker={t('adm.sys3.cn.scKicker')}
            headline={k.broken > 0 ? t('adm.sys3.cn.scBroken', { n: fmtNum(k.broken, lang) }) : k.active === 0 ? t('adm.sys3.cn.scNone') : t('adm.sys3.cn.scOk', { n: fmtNum(k.active, lang) })}
            sub={t('adm.sys.cn.sc.privacy')} />
          <StatStrip items={stats} />
        </>
      )}
      <Block title={t('adm.sys.cn.sc.accounts')} meta={d ? fmtNum(accounts.length, lang) : undefined}>
        {q.isLoading ? <div className="a-skel h-20 w-full" /> : accounts.length === 0 ? <EmptyLine>{t('adm.sys.cn.sc.none')}</EmptyLine> : (
          <Ledger>
            {accounts.map((a) => (
              <LedgerRow key={a.id} to={ADMIN_ROUTES.account(a.id)} className="grid-cols-1 md:grid-cols-[minmax(0,1.2fr)_110px_90px_150px_90px_90px]">
                <span className="a-t1 truncate text-[13.5px] font-medium">{a.name}</span>
                <Status strong tone={a.state === 'ok' ? 'positive' : a.state === 'frozen' ? 'negative' : 'warning'}>{t(`adm.sys.cn.sc.${a.state}`)}</Status>
                <span className="a-t2 text-[12px]">{t('adm.sys.cn.sc.active')} {a.active}</span>
                <MiniBar value={a.sent7} max={maxSent} display={String(a.sent7)} />
                <span className="a-t2 text-[12px]">{t('adm.sys.cn.sc.held')} {a.held_now}</span>
                <span className="text-[12px]" style={a.broken > 0 ? { color: 'var(--a-neg)', fontWeight: 600 } : undefined}>{t('adm.sys.cn.sc.broken')} {a.broken}</span>
              </LedgerRow>
            ))}
          </Ledger>
        )}
      </Block>
      <Block title={t('adm.sys.cn.sc.heldBy')}>
        <RankBars emptyText={t('adm.sys.cn.sc.heldNone')} items={held.map((r) => ({ key: r.reason, label: r.reason, value: r.n, display: fmtNum(r.n, lang) }))} />
      </Block>
    </div>
  );
}
