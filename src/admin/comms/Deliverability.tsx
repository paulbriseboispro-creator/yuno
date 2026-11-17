/**
 * Communication › Délivrabilité (v3) : « Est-ce que les e-mails de Yuno et de
 * ses clients arrivent ? »
 *   1. le verdict en héros (« L'envoi est sain » / « Gmail met une partie de
 *      nos e-mails en spam ») ;
 *   2. les seuils en bullets : valeur, seuil d'alerte, zones ;
 *   3. le plafond du mois en bullets, et les envois par jour sur un même axe ;
 *   4. les comptes expéditeurs en lignes, leur niveau de confiance sur cinq crans ;
 *   5. la surveillance en cours en frise ;
 *   6. repliés : Gmail (reprise, Postmaster), sous-domaines, liste de suppression.
 * Les RPC sont celles de data.ts, inchangées. Les seuils d'alerte reprennent la
 * politique d'envoi (CLAUDE.md : disjoncteur à 0,1 % de plaintes et 3 % de
 * rebonds ; Google : `google_spam_watch` / `google_spam_limit`).
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Block, BulletBar, ErrorState, HoverSync, Page, RankBars, SmallMultiples, Spark, useAdminFilters, useAdminT, type Multiple, type Rank, EmptyLine, Fold, Ledger, LedgerRow, MiniBar, Level, Status, Verdict, type Tone } from '@/admin/ui';
import { fmtAxisDay, fmtDate, fmtNum, fmtPct, fmtRelative } from '@/lib/adminFormat';
import { rpc, usePlatformSync, useReleaseHealth } from '../system/data';
import { COMMS_KEY, useDeliverability, usePostmaster, useSenders, useSendingDomains, useWatch, type Sender, type SendingDomain } from './data';
import { useReasonAction } from './reason';

/** Sous 30 envois un taux ne dit rien. */
const MIN_SENT = 30;
/** Seuils d'alerte de la politique d'envoi (disjoncteur) ; la zone ambre commence à moitié. */
const ALERT = { complaints: 0.1, bounces: 3 } as const;
const isFrozen = (s: Sender) => !!s.cold_frozen_until && new Date(s.cold_frozen_until).getTime() > Date.now();
type Ask = ReturnType<typeof useReasonAction>['ask'];

/** Un seuil : la valeur contre son repère et ses zones (Few). Sans assez d'envois, une phrase, pas une barre à zéro. */
function Signal({ label, hint, value, alert, display, alertDisplay, noData }: {
  label: string; hint: string; value: number | null; alert: number; display: string; alertDisplay: string; noData: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {value == null ? (
        <>
          <div className="flex items-baseline gap-2 text-[13px]"><span className="a-t2 flex-1">{label}</span><span className="a-t3 a-num">—</span></div>
          <p className="a-t3 text-[12px]">{noData}</p>
        </>
      ) : (
        <>
          <BulletBar value={value} max={Math.max(alert * 2, value * 1.1)} zones={[alert / 2, alert]} target={alert} targetLabel={alertDisplay} label={label} display={display} />
          <div className="a-mono a-t3 flex justify-between text-[11px]"><span>{hint}</span><span>{alertDisplay}</span></div>
        </>
      )}
    </div>
  );
}

export default function Deliverability() {
  const { t, lang } = useAdminT();
  const { range, includeDemo } = useAdminFilters();
  const health = useReleaseHealth();
  const senders = useSenders();
  const deliv = useDeliverability();
  const pm = usePostmaster();
  const platform = usePlatformSync(includeDemo);
  const { ask, dialog } = useReasonAction(COMMS_KEY);

  const q = health.data?.email.quota ?? null;
  const rows = useMemo(() => senders.data ?? [], [senders.data]);
  const sent30 = rows.reduce((a, s) => a + s.sent, 0);
  const bounced30 = rows.reduce((a, s) => a + s.bounced, 0);
  const complained30 = rows.reduce((a, s) => a + s.complained, 0);
  const frozen = rows.filter(isFrozen);
  const enough = sent30 >= MIN_SENT;
  const complaints = enough ? (complained30 * 100) / sent30 : null;
  const bounces = enough ? (bounced30 * 100) / sent30 : null;

  // Dernier jour connu de Google Postmaster : le pire des domaines suivis.
  const lastSpam = useMemo(() => {
    let best: { day: string; spam: number } | null = null;
    for (const d of pm.data?.domains ?? []) {
      const last = [...d.days].reverse().find((y) => y.spam != null);
      if (last && (!best || last.day > best.day || (last.day === best.day && (last.spam ?? 0) > best.spam))) best = { day: last.day, spam: last.spam ?? 0 };
    }
    return best;
  }, [pm.data]);
  const spamWatch = (pm.data?.watch ?? 0.001) * 100;
  const spamLimit = (pm.data?.limit ?? 0.003) * 100;
  const spamPct = lastSpam ? lastSpam.spam * 100 : null;

  // Le verdict : un seul signal en tête, le plus grave (Gmail, plaintes, rebonds, comptes gelés).
  const verdict = useMemo((): { tone: Tone; key: string } => {
    if (spamPct != null && spamPct >= spamWatch) return { tone: spamPct >= spamLimit ? 'negative' : 'warning', key: 'gmail' };
    if (complaints != null && complaints >= ALERT.complaints) return { tone: 'negative', key: 'complaints' };
    if (bounces != null && bounces >= ALERT.bounces) return { tone: 'negative', key: 'bounces' };
    if (frozen.length > 0) return { tone: 'warning', key: 'frozen' };
    if ((complaints != null && complaints >= ALERT.complaints / 2) || (bounces != null && bounces >= ALERT.bounces / 2)) return { tone: 'warning', key: 'near' };
    if (!enough && spamPct == null) return { tone: 'neutral', key: 'few' };
    return { tone: 'positive', key: 'positive' };
  }, [spamPct, spamWatch, spamLimit, complaints, bounces, frozen.length, enough]);

  const days = useMemo(() => (deliv.data?.days ?? []).slice(-range.days), [deliv.data, range.days]);
  const xLabels = days.map((d) => fmtAxisDay(d.day.slice(0, 10), lang));
  const sumOf = (f: (d: (typeof days)[number]) => number) => days.reduce((a, d) => a + f(d), 0);
  const openRate = (o: number, s: number) => (s >= MIN_SENT ? Math.round((o * 1000) / s) / 10 : 0);
  const multiples: Multiple[] = [
    { key: 'g', label: t('adm.comms.dl3.m.gmailSent'), total: fmtNum(sumOf((d) => d.gmail_sent), lang), series: days.map((d) => d.gmail_sent), format: (v) => fmtNum(v, lang), kind: 'bar', emptyText: t('adm.comms.dl3.m.none') },
    { key: 'o', label: t('adm.comms.dl3.m.otherSent'), total: fmtNum(sumOf((d) => d.other_sent), lang), series: days.map((d) => d.other_sent), format: (v) => fmtNum(v, lang), kind: 'bar', emptyText: t('adm.comms.dl3.m.none') },
    { key: 'go', label: t('adm.comms.dl3.m.gmailOpen'), total: fmtPct(openRate(sumOf((d) => d.gmail_opened), sumOf((d) => d.gmail_sent)), 1, lang), series: days.map((d) => openRate(d.gmail_opened, d.gmail_sent)), format: (v) => fmtPct(v, 1, lang), emptyText: t('adm.comms.dl3.m.none') },
    { key: 'oo', label: t('adm.comms.dl3.m.otherOpen'), total: fmtPct(openRate(sumOf((d) => d.other_opened), sumOf((d) => d.other_sent)), 1, lang), series: days.map((d) => openRate(d.other_opened, d.other_sent)), format: (v) => fmtPct(v, 1, lang), emptyText: t('adm.comms.dl3.m.none') },
  ];

  const loadingTop = senders.isLoading && !senders.data;
  if (senders.isError && !senders.data) return <Page title={t('adm.comms.dl.title')} period><ErrorState onRetry={() => void senders.refetch()} /></Page>;

  return (
    <Page title={t('adm.comms.dl.title')} subtitle={t('adm.comms.dl.sub')} period>
      {loadingTop ? (
        <div className="flex flex-col gap-3"><div className="a-skel h-10 w-[30rem] max-w-full" /><div className="a-skel h-4 w-96 max-w-full" /></div>
      ) : (
        <Verdict tone={verdict.tone} kicker={t('adm.comms.dl3.kicker')}
          headline={t(`adm.comms.dl3.head.${verdict.key}${verdict.key === 'frozen' && frozen.length === 1 ? 'One' : ''}`, { n: fmtNum(frozen.length, lang), sent: fmtNum(sent30, lang) })}
          sub={t(`${enough ? 'adm.comms.dl3.sub' : 'adm.comms.dl3.subFew'}${rows.length === 1 ? 'One' : ''}`, { sent: fmtNum(sent30, lang), k: rows.length, c: complaints == null ? '—' : fmtPct(complaints, 2, lang), b: bounces == null ? '—' : fmtPct(bounces, 1, lang) })} />
      )}

      <Block title={t('adm.comms.dl3.thresholds')} meta={t('adm.comms.dl3.thresholdsMeta')}>
        <div className="grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-3">
          <Signal label={t('adm.comms.dl.k.complaints')} hint={t('adm.comms.dl3.last30')} value={complaints} alert={ALERT.complaints}
            display={complaints == null ? '—' : fmtPct(complaints, 2, lang)} alertDisplay={t('adm.comms.dl3.alertAt', { v: fmtPct(ALERT.complaints, 1, lang) })} noData={t('adm.comms.dl3.fewSends', { n: MIN_SENT })} />
          <Signal label={t('adm.comms.dl.k.bounces')} hint={t('adm.comms.dl3.last30')} value={bounces} alert={ALERT.bounces}
            display={bounces == null ? '—' : fmtPct(bounces, 1, lang)} alertDisplay={t('adm.comms.dl3.alertAt', { v: fmtPct(ALERT.bounces, 0, lang) })} noData={t('adm.comms.dl3.fewSends', { n: MIN_SENT })} />
          <Signal label={t('adm.comms.dl.k.spam')} hint={lastSpam ? fmtDate(`${lastSpam.day}T12:00:00Z`, lang) : ''} value={spamPct} alert={spamLimit}
            display={spamPct == null ? '—' : fmtPct(spamPct, 2, lang)} alertDisplay={t('adm.comms.dl3.watchAt', { w: fmtPct(spamWatch, 1, lang), l: fmtPct(spamLimit, 1, lang) })} noData={pm.data && !pm.data.connected ? t('adm.comms.dl.pm.notConnected') : t('adm.comms.dl.k.spamNone')} />
        </div>
      </Block>

        <Block title={t('adm.comms.dl.capacity')} meta={q ? t('adm.comms.dl.resets', { d: fmtDate(q.resets_on, lang) }) : undefined}>
          {!q ? <EmptyLine>{t('adm.comms.dl.capEmpty')}</EmptyLine> : (
            <div className="grid grid-cols-1 gap-x-10 gap-y-5 md:grid-cols-2">
              {[
                { l: t('adm.comms.dl.cap.pool'), u: q.pool_used, c: q.pool_cap, h: t('adm.comms.dl.cap.poolHint') },
                { l: t('adm.comms.dl.cap.day'), u: q.day_used, c: q.day_cap },
                { l: t('adm.comms.dl.cap.free'), u: q.used, c: q.free + q.credits, h: q.credits > 0 ? t('adm.comms.dl.cap.freeHint', { n: fmtNum(q.credits, lang) }) : t('adm.comms.dl.cap.freeOnly') },
                ...(q.platform_ceiling ? [{ l: t('adm.comms.dl.cap.ceiling'), u: q.platform_sent ?? 0, c: q.platform_ceiling, h: t('adm.comms.dl.cap.ceilingHint') }] : []),
              ].map((r) => (
                <div key={r.l} className="flex flex-col gap-1">
                  <BulletBar value={r.u} max={Math.max(1, r.c)} zones={[r.c * 0.7, r.c * 0.9]} label={r.l} display={`${fmtNum(r.u, lang)} / ${fmtNum(r.c, lang)}`} />
                  {r.h && <span className="a-t3 text-[12px]">{r.h}</span>}
                </div>
              ))}
              <p className="a-t3 self-end text-[12px]">{t('adm.comms.dl.cap.transactional')} : <b className="a-t2 font-medium">{fmtNum(health.data?.email.transactional_month ?? 0, lang)}</b></p>
            </div>
          )}
        </Block>

      <SendersBlock rows={rows} loading={senders.isLoading} ask={ask} />
      <Fold title={t('adm.comms.dl.curve')} hint={days.length ? t('adm.comms.dl3.curveHint', { n: fmtNum(sent30, lang) }) : undefined}>
        <EmptyLine>{t('adm.comms.dl3.curveNote')}</EmptyLine>
        {deliv.isLoading ? <div className="a-skel h-40 w-full" /> : days.length === 0 ? <EmptyLine>{t('adm.comms.dl.curveEmpty')}</EmptyLine> : (
          <HoverSync><SmallMultiples items={multiples} xLabels={xLabels} columns={2} height={52} /></HoverSync>
        )}
      </Fold>
      <WatchBlock />

      <Fold title={t('adm.comms.dl.tab.gmail')} hint={t('adm.comms.dl3.gmailHint')}><GmailPart ask={ask} /></Fold>
      <Fold title={t('adm.comms.dl.tab.domains')} hint={t('adm.comms.dl3.domainsHint')}><DomainsPart ask={ask} /></Fold>
      <Fold title={t('adm.comms.dl.supp.title')} hint={platform.data ? fmtNum(platform.data.suppression.total, lang) : undefined}>
        <EmptyLine>{t('adm.comms.dl.supp.sub')}</EmptyLine>
        {platform.isError && !platform.data ? <ErrorState onRetry={() => void platform.refetch()} /> : (
          <RankBars emptyText={t('adm.comms.dl.supp.none')}
            items={Object.entries(platform.data?.suppression.by_reason ?? {}).map(([reason, n]): Rank => ({ key: reason, label: reason, value: n, display: fmtNum(n, lang) })).sort((a, b) => b.value - a.value)} />
        )}
        <p className="a-t3 text-[12.5px]">{t('adm.comms.dl.supp.total', { total: fmtNum(platform.data?.suppression.total ?? 0, lang), last: fmtNum(platform.data?.suppression.last30 ?? 0, lang) })}</p>
      </Fold>
      {dialog}
    </Page>
  );
}

function SendersBlock({ rows, loading, ask }: { rows: Sender[]; loading: boolean; ask: Ask }) {
  const [sp] = useSearchParams();
  const { t, lang } = useAdminT();
  const [filter, setFilter] = useState(sp.get('q') ?? '');
  const setBurst = (s: Sender, allowed: boolean) => ask({
    title: t(allowed ? 'adm.comms.dl.s.burstOnTitle' : 'adm.comms.dl.s.burstOffTitle', { name: s.name }),
    description: t('adm.comms.dl.s.burstDesc'),
    tone: allowed ? 'danger' : 'primary',
    run: (reason) => rpc('admin_set_sender_burst', { p_scope_key: s.scope_key, p_allowed: allowed, p_reason: reason }),
  });
  const lift = (s: Sender) => ask({
    title: t('adm.comms.dl.s.liftTitle', { name: s.name }), description: t('adm.comms.dl.s.liftDesc'),
    run: (reason) => rpc('admin_lift_sender_freeze', { p_scope_key: s.scope_key, p_reason: reason }),
  });
  const list = useMemo(() => rows.filter((s) => !filter || s.name.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => b.sent - a.sent), [rows, filter]);
  const max = Math.max(0, ...rows.map((s) => s.sent));
  const frozenN = rows.filter(isFrozen).length;
  const pc = (a: number, b: number, d = 1) => (b >= MIN_SENT ? fmtPct((a * 100) / b, d, lang) : '—');
  return (
    <Fold title={t('adm.comms.dl.s.title')} defaultOpen={!!sp.get('q') || frozenN > 0}
      hint={rows.length ? t(frozenN > 0 ? 'adm.comms.dl3.sendersHintFrozen' : 'adm.comms.dl3.sendersHint', { n: fmtNum(rows.length, lang), f: fmtNum(frozenN, lang) }) : undefined}>
      <EmptyLine>{t('adm.comms.dl.s.sub')} {t('adm.comms.dl3.sendersOrder')}</EmptyLine>
      {rows.length > 8 && <input className="a-input max-w-[280px]" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('adm.comms.dl3.filter')} aria-label={t('adm.comms.dl3.filter')} />}
      {loading ? <div className="a-skel h-24 w-full" /> : list.length === 0 ? <EmptyLine>{t('adm.comms.dl.s.none')}</EmptyLine> : (
        <Ledger>
          {list.map((s) => (
            <LedgerRow key={s.scope_key} className="grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_150px_150px_minmax(0,1.1fr)_auto]">
              <div className="flex min-w-0 flex-col">
                <span className="a-t1 truncate text-[13.5px] font-medium">{s.name}</span>
                <span className="a-t3 text-[12px]">{s.rights ? (s.rights.burst ? t('adm.comms.dl.s.burstOn') : t('adm.comms.dl.s.rights', { d: fmtNum(s.rights.daily_cap, lang), h: fmtNum(s.rights.per_hour, lang) })) : '—'}</span>
              </div>
              <div className="flex flex-col gap-1">
                {s.level == null ? <span className="a-t3">—</span> : <><Level level={s.level} label={t('adm.comms.dl.s.levelN', { n: s.level })} /><span className="a-mono a-t3 text-[11px]">{t('adm.comms.dl.s.levelN', { n: s.level })}</span></>}
              </div>
              <MiniBar value={s.sent} max={max} display={fmtNum(s.sent, lang)} />
              <div className="flex flex-col gap-0.5">
                <span className="a-t2 text-[12px]">{t('adm.comms.dl.s.bounce')} <b className="a-t1 font-medium">{pc(s.bounced, s.sent)}</b> · {t('adm.comms.dl.s.complaint')} <b className="a-t1 font-medium">{pc(s.complained, s.sent, 2)}</b></span>
                <span className="a-t3 text-[11.5px]">{t('adm.comms.dl.s.opens')} {pc(s.gmail_opened, s.gmail_sent)} / {pc(s.opened - s.gmail_opened, s.sent - s.gmail_sent)}</span>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {isFrozen(s) ? <Status strong tone="negative">{s.reason === 'recidive' ? t('adm.comms.dl.s.recidive') : t('adm.comms.dl.s.frozen', { d: fmtDate(s.cold_frozen_until, lang) })}</Status> : <Status strong tone="positive">{t('adm.comms.dl.s.ok')}</Status>}
                {isFrozen(s) && <button type="button" className="a-btn a-btn--sm" onClick={() => lift(s)}>{t('adm.comms.dl.s.lift')}</button>}
                <button type="button" className="a-btn a-btn--sm" onClick={() => setBurst(s, !s.burst_allowed)}>{t(s.burst_allowed ? 'adm.comms.dl.s.burstRemove' : 'adm.comms.dl.s.burstAllow')}</button>
              </div>
            </LedgerRow>
          ))}
        </Ledger>
      )}
    </Fold>
  );
}

/** La surveillance en cours : comptes sous garde et vagues d'envoi, du plus récent au plus ancien. */
function WatchBlock() {
  const { t, lang, label } = useAdminT();
  const w = useWatch();
  const live = (w.data?.senders ?? []).filter((x) => new Date(x.until).getTime() > Date.now());
  const waves = (w.data?.waves ?? []).slice(0, 6);
  return (
    <Fold title={t('adm.comms.dl.g.watch')} defaultOpen={live.length > 0} hint={w.data ? t('adm.comms.dl3.watchMeta', { n: live.length, w: waves.length }) : undefined}>
      {w.isLoading ? <div className="a-skel h-12 w-full" /> : live.length === 0 && waves.length === 0 ? <EmptyLine>{t('adm.comms.dl.g.watchNone')}</EmptyLine> : (
        <Ledger>
          {live.map((x) => (
            <LedgerRow key={x.scope_key} className="grid-cols-[110px_minmax(0,1fr)_auto]">
              <Status strong tone="negative">{t('adm.comms.dl3.guarded')}</Status>
              <span className="a-t1 truncate text-[13px]">{x.name} <span className="a-t3">· {label(x.reason)}</span></span>
              <span className="a-mono a-t3 text-[11px]">{t('adm.comms.dl.g.until', { d: fmtDate(x.until, lang) })}</span>
            </LedgerRow>
          ))}
          {waves.map((x) => (
            <LedgerRow key={x.id} className="grid-cols-[110px_minmax(0,1fr)]">
              <Status strong tone={x.state === 'halted' ? 'negative' : x.state === 'done' ? 'positive' : 'neutral'}>{t('adm.comms.dl3.wave')}</Status>
              <span className="a-t1 truncate text-[13px]">{x.name} <span className="a-t3">· {t(`adm.comms.dl.g.wave.${x.state}`, { r: x.released ?? 0, t: x.total ?? 0 })}</span></span>
            </LedgerRow>
          ))}
        </Ledger>
      )}
    </Fold>
  );
}

function GmailPart({ ask }: { ask: Ask }) {
  const { t, lang } = useAdminT();
  const d = useDeliverability();
  const pm = usePostmaster();
  const toggle = (on: boolean) => d.data && ask({
    title: t(on ? 'adm.comms.dl.g.onTitle' : 'adm.comms.dl.g.offTitle'), description: t('adm.comms.dl.g.desc'),
    run: (reason) => rpc('admin_set_email_deliverability', { p_gmail_recovery: on, p_gmail_engaged_days: d.data!.gmail_engaged_days, p_reason: reason }),
  });
  return (
    <div className="flex flex-col gap-6">
      <EmptyLine>{t('adm.comms.dl.g.sub')}</EmptyLine>
      {d.data && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
          <Status strong tone={d.data.gmail_recovery ? 'warning' : 'neutral'}>{t('adm.comms.dl.g.recovery')} · {t(d.data.gmail_recovery ? 'adm.comms.dl.g.on' : 'adm.comms.dl.g.off')}</Status>
          <span className="a-t2">{t('adm.comms.dl.g.pool')} <b className="a-t1 font-medium">{fmtNum(d.data.gmail_engaged_pool, lang)}</b></span>
          <span className="a-t2">{t('adm.comms.dl.g.held')} <b className="a-t1 font-medium">{fmtNum(d.data.gmail_held_30d, lang)}</b></span>
          <span className="a-t3">{t('adm.comms.dl.g.window', { n: d.data.gmail_engaged_days })} · {d.data.gmail_recovery ? t('adm.comms.dl.g.since', { t: fmtRelative(d.data.started_at, lang) }) : '—'}</span>
          <button type="button" className="a-btn a-btn--sm ml-auto" onClick={() => toggle(!d.data!.gmail_recovery)}>{t(d.data.gmail_recovery ? 'adm.comms.dl.g.turnOff' : 'adm.comms.dl.g.turnOn')}</button>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <span className="a-kicker">{t('adm.comms.dl.pm.title')}</span>
        <EmptyLine>{t('adm.comms.dl.pm.sub')}</EmptyLine>
      </div>
      {pm.data && !pm.data.connected && <EmptyLine>{t('adm.comms.dl.pm.notConnected')}</EmptyLine>}
      {(pm.data?.domains ?? []).map((dom) => {
        const req = dom.compliance?.complianceData?.rowData ?? [];
        const series = dom.days.slice(-30).map((y) => (y.spam ?? 0) * 100);
        return (
          <div key={dom.domain} className="flex flex-col gap-2 border-t pt-3">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="a-t1 text-[14px] font-medium">{dom.domain}</span>
              <span className="a-mono a-t3 text-[11px]" style={dom.last_error ? { color: 'var(--a-neg)' } : undefined}>{dom.last_error ?? t('adm.comms.dl.pm.fetched', { t: fmtRelative(dom.fetched_at, lang) })}</span>
            </div>
            {req.length > 0 && <div className="flex flex-wrap gap-x-4 gap-y-1">{req.map((r) => <Status strong key={r.requirement} tone={r.status?.status === 'COMPLIANT' ? 'positive' : 'negative'}>{r.requirement}</Status>)}</div>}
            {series.some((v) => v > 0) ? <Spark data={series} height={44} /> : <EmptyLine>{t('adm.comms.dl.pm.noData')}</EmptyLine>}
          </div>
        );
      })}
      <p className="a-t3 text-[12.5px]">{t('adm.comms.dl.pm.read')}</p>
    </div>
  );
}

const DOMAIN_TONE: Record<SendingDomain['status'], Tone> = { pending: 'warning', verified: 'neutral', active: 'positive', paused: 'neutral' };

function DomainsPart({ ask }: { ask: Ask }) {
  const { t, lang } = useAdminT();
  const q = useSendingDomains();
  const set = (d: SendingDomain, status: 'active' | 'paused') => ask({
    title: t(status === 'active' ? 'adm.comms.dl.d.activateTitle' : 'adm.comms.dl.d.pauseTitle', { name: d.name }),
    description: t(status === 'active' ? 'adm.comms.dl.d.activateDesc' : 'adm.comms.dl.d.pauseDesc'),
    tone: status === 'active' ? 'primary' : 'danger',
    run: (reason) => rpc('admin_set_email_sending_domain', { p_scope_key: d.scope_key, p_status: status, p_reason: reason }),
  });
  return (
    <div className="flex flex-col gap-3">
      <EmptyLine>{t('adm.comms.dl.d.sub')}</EmptyLine>
      {q.isLoading ? <div className="a-skel h-12 w-full" /> : (q.data ?? []).length === 0 ? <EmptyLine>{t('adm.comms.dl.d.none')} {t('adm.comms.dl.d.noneBody')}</EmptyLine> : (
        <Ledger>
          {(q.data ?? []).map((d) => (
            <LedgerRow key={d.scope_key} className="grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_120px_auto]">
              <span className="a-t1 truncate text-[13.5px] font-medium">{d.name}</span>
              <span className="a-mono a-t2 truncate text-[12px]">{d.address}</span>
              <Status strong tone={DOMAIN_TONE[d.status]}>{t(`adm.comms.dl.d.st.${d.status}`)}</Status>
              <div className="flex items-center justify-end gap-2">
                <span className="a-mono a-t3 text-[11px]">{d.activated_at ? fmtDate(d.activated_at, lang) : d.verified_at ? fmtDate(d.verified_at, lang) : ''}</span>
                {d.status === 'active' ? <button type="button" className="a-btn a-btn--sm" onClick={() => set(d, 'paused')}>{t('adm.comms.dl.d.pause')}</button>
                  : d.status === 'pending' ? <span className="a-t3 text-[12px]">{t('adm.comms.dl.d.waitVerify')}</span>
                    : <button type="button" className="a-btn a-btn--sm a-btn--primary" onClick={() => set(d, 'active')}>{t('adm.comms.dl.d.activate')}</button>}
              </div>
            </LedgerRow>
          ))}
        </Ledger>
      )}
      <p className="a-t3 text-[12.5px]">{t('adm.comms.dl.d.how')}</p>
    </div>
  );
}
