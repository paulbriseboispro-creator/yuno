/**
 * Admin CRM › Plateforme (« Admin Plateforme » du design) : les synchros de la
 * billetterie et le quota Shotgun partagé, l'envoi (quota, bounces, plaintes,
 * suppressions), les scénarios (en ligne, en route, reportés, à revoir, par
 * compte), les comptes gelés, les tâches planifiées. Tout est lu en base ;
 * la durée d'une synchro (p50 / p95) ne compte que les passes terminées ; la
 * liste des exceptions edge n'est pas enregistrée : elle n'apparaît pas.
 */
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCrmT } from '@/crm/i18n';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { Skel } from '@/crm/ui/kit';
import { ADMIN_ROUTES } from '../adminNav';
import { useAdminAccounts, useAdminPlatform, useAdminScenarios } from '../data';
import type { AdminPlatform, AdminScenarioAccount } from '../data';
import { EmptyNote, Kpi, PageHead, RowLine, Section, Tabs, kpiGrid, pageWrap, twoCols, useAgo } from '../ui';
import type { AdminAccount } from '@/crm/lib/admin';

type Tab = 'conn' | 'send' | 'scn' | 'abuse' | 'system';
/** Plafond du limiteur commun (consume_ticketing_rate) : requêtes par minute. */
const SHOTGUN_LIMIT = 45;
const SHOTGUN_QUOTA = 100;

/** 42 s, 3 min 05 s : une durée de passe lisible. */
function secs(v: number): string {
  const s = Math.round(v);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

export default function PlatformPage() {
  const { t, time } = useCrmT();
  const [sp, setSp] = useSearchParams();
  const q = useAdminPlatform();
  const acc = useAdminAccounts();
  const tab = (['send', 'scn', 'abuse', 'system'] as const).find((x) => x === sp.get('tab')) ?? 'conn';
  if (q.isError && !q.data) return <main style={{ padding: 32 }}><CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /></main>;
  const d = q.data;
  const rows = acc.data?.accounts ?? [];
  const badConn = rows.filter((r) => r.sync === 'error').length;
  const abuse = d ? d.frozen.length + d.bounce.filter((b) => b.sent >= 200 && (b.bounced / b.sent > 0.05 || b.complained / b.sent > 0.003)).length : 0;
  return (
    <main style={pageWrap}>
      <PageHead kicker={`${t('adm.crm.nav.platform')}${d ? ` · ${t('adm.crm.pf.at', { time: time(d.at) })}` : ''}`} title={t(tab === 'scn' ? 'adm.crm.pf.sc.title' : 'adm.crm.pf.title')} sub={t(tab === 'scn' ? 'adm.crm.pf.sc.sub' : 'adm.crm.pf.sub')} />
      <Tabs<Tab> value={tab} onChange={(v) => setSp(v === 'conn' ? {} : { tab: v }, { replace: true })}
        tabs={[{ id: 'conn', label: t('adm.crm.pf.t.conn'), badge: badConn }, { id: 'send', label: t('adm.crm.pf.t.send') }, { id: 'scn', label: t('adm.crm.pf.t.scn') }, { id: 'abuse', label: t('adm.crm.pf.t.abuse'), badge: abuse }, { id: 'system', label: t('adm.crm.pf.t.system') }]} />
      {tab === 'scn' ? <ScnTab /> : !d ? <><div style={kpiGrid}>{[0, 1, 2, 3].map((i) => <Skel key={i} h={118} r={24} />)}</div><Skel h={320} r={28} /></> : (
        tab === 'conn' ? <ConnTab d={d} rows={rows} /> : tab === 'send' ? <SendTab d={d} /> : tab === 'abuse' ? <AbuseTab d={d} /> : <SystemTab d={d} />
      )}
    </main>
  );
}

function ConnTab({ d, rows }: { d: AdminPlatform; rows: AdminAccount[] }) {
  const { t, n, pct, time, dShort } = useCrmT();
  const ago = useAgo();
  const s = d.shotgun;
  const peak = Math.max(1, ...s.hours.map((h) => h.req));
  const perMin = Math.round(peak / 60 * 10) / 10;
  const perAccountHour = s.conns ? s.req24 / 24 / s.conns : 0;
  const sat = perAccountHour > 0 ? Math.floor((SHOTGUN_LIMIT * 60) / perAccountHour) : null;
  const connected = rows.filter((r) => r.sync !== 'none');
  const bad = rows.filter((r) => r.sync === 'error');
  const okRate = s.runs24 ? ((s.runs24 - s.errors24) / s.runs24) * 100 : null;
  const imports = Object.entries(d.imports);
  return (
    <>
      <div style={kpiGrid}>
        <Kpi label={t('adm.crm.pf.k.conns')} value={n(connected.length)} dot="var(--green-500)" sub={t('adm.crm.pf.k.connsSub')} />
        <Kpi delay={60} label={t('adm.crm.pf.k.bad')} value={n(bad.length)} dot="var(--red-500)" sub={bad[0] ? t('adm.crm.pf.k.badSub', { name: bad[0].name }) : t('adm.crm.pf.k.badNone')} />
        <Kpi delay={120} label={t('adm.crm.pf.k.runs')} value={n(s.runs24)} dot="var(--amber-500)" sub={t('adm.crm.pf.k.runsSub', { n: s.errors24 })} />
        <Kpi delay={180} label={t('adm.crm.pf.k.rate')} value={okRate === null ? '—' : pct(okRate, 1)} dot="var(--green-500)" sub={t('adm.crm.pf.k.rateSub')} />
        <Kpi delay={240} label={t('adm.crm.pf.k.dur')} value={s.duration.p50 === null ? '—' : secs(s.duration.p50)}
          sub={s.duration.p50 === null ? t('adm.crm.pf.k.durNone') : `${t('adm.crm.pf.k.durSub', { p95: secs(s.duration.p95 ?? s.duration.p50) })}${s.duration.open ? ` · ${t('adm.crm.pf.k.durOpen', { n: s.duration.open })}` : ''}`} />
      </div>
      <Section title={t('adm.crm.pf.quota')} sub={t('adm.crm.pf.quotaSub', { quota: SHOTGUN_QUOTA, limit: SHOTGUN_LIMIT })}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 150 }}>
          {s.hours.map((h) => (
            <div key={h.h} title={`${time(h.h)} · ${h.req} req · ${h.runs}`} style={{ flex: 1, minWidth: 0, height: `${Math.max(2, (h.req / peak) * 100)}%`, borderRadius: '4px 4px 0 0', background: h.req / 60 >= SHOTGUN_LIMIT * 0.8 ? 'var(--red-400)' : 'var(--ink)' }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--sand-500)' }}>
          {[0, 6, 12, 18, 23].map((i) => <span key={i}>{s.hours[i] ? time(s.hours[i].h) : ''}</span>)}
        </div>
        <div style={{ height: 12, borderRadius: 99, background: 'linear-gradient(90deg,var(--sand-50),rgba(255,176,32,.25),rgba(227,20,27,.25))', position: 'relative' }}>
          <i style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.min(100, (perMin / SHOTGUN_LIMIT) * 100)}%`, borderRadius: 99, background: 'var(--ink)' }} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, fontSize: 13.5 }}>
          <span><b>{t('adm.crm.pf.peak', { n: perMin })}</b> {t('adm.crm.pf.peakSub', { n: s.conns })}</span>
          {sat !== null && <span style={{ color: 'var(--sand-600)' }}>{t('adm.crm.pf.sat', { n: sat })}</span>}
        </div>
        {s.window && <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('adm.crm.pf.window', { used: s.window.used, limit: SHOTGUN_LIMIT })}</span>}
      </Section>
      <div style={twoCols}>
        <Section title={t('adm.crm.pf.conns')} pad={24} gap={4}>
          {connected.length === 0 && <EmptyNote>{t('adm.crm.pf.connsNone')}</EmptyNote>}
          {connected.map((r, i) => (
            <RowLine key={r.id} first={i === 0}>
              <Link to={ADMIN_ROUTES.account(r.id)} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: 'var(--ink)', textDecoration: 'none' }}>
                <i style={{ width: 8, height: 8, borderRadius: 99, background: r.sync === 'ok' ? 'var(--green-500)' : 'var(--red-500)' }} />{r.name}
              </Link>
              <span style={{ fontWeight: 600, color: r.sync === 'ok' ? 'var(--ink)' : 'var(--red-600)' }}>{r.sync === 'ok' ? `OK · ${r.sync_at ? time(r.sync_at) : ''}` : r.sync_error ?? t('adm.crm.sync.error')}</span>
            </RowLine>
          ))}
          {s.errors.length > 0 && <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--sand-500)' }}>{t('adm.crm.pf.lastErr', { name: s.errors[0].name ?? '—', when: ago(s.errors[0].at) })}</p>}
        </Section>
        <Section title={t('adm.crm.pf.imports')} sub={t('adm.crm.pf.importsSub')} pad={24} gap={4}>
          {imports.length === 0 && <EmptyNote>{t('adm.crm.pf.importsNone')}</EmptyNote>}
          {imports.map(([st, c], i) => <RowLine key={st} first={i === 0}><span style={{ fontWeight: 600 }}>{t(`adm.crm.pf.imp.${st}`) === `adm.crm.pf.imp.${st}` ? st : t(`adm.crm.pf.imp.${st}`)}</span><b>{c}</b></RowLine>)}
        </Section>
      </div>
      <span style={{ display: 'none' }}>{dShort(d.at)}</span>
    </>
  );
}

function SendTab({ d }: { d: AdminPlatform }) {
  const { t, n, pct } = useCrmT();
  const q = d.quota;
  const supp = d.suppression;
  return (
    <>
      <div style={kpiGrid}>
        <Kpi label={t('adm.crm.pf.s.pool')} value={q ? n(q.pool_used) : '—'} sub={q ? t('adm.crm.pf.s.poolSub', { cap: n(q.pool_cap) }) : t('adm.crm.pf.s.none')} />
        <Kpi delay={60} label={t('adm.crm.pf.s.supp')} value={n(supp.total)} sub={t('adm.crm.pf.s.suppSub', { n: supp.last30 })} />
        <Kpi delay={120} label={t('adm.crm.pf.s.day')} value={q ? n(q.day_used) : '—'} sub={q ? t('adm.crm.pf.s.daySub', { cap: n(q.day_cap) }) : ''} />
      </div>
      <Section title={t('adm.crm.pf.s.bounce')} sub={t('adm.crm.pf.s.bounceSub')} pad={24} gap={4}>
        {d.bounce.length === 0 && <EmptyNote>{t('adm.crm.pf.s.bounceNone')}</EmptyNote>}
        {d.bounce.map((b, i) => {
          const bp = (b.bounced / b.sent) * 100;
          const cp = (b.complained / b.sent) * 100;
          const bad = b.sent >= 200 && (bp > 5 || cp > 0.3);
          return (
            <RowLine key={b.id} first={i === 0}>
              <Link to={ADMIN_ROUTES.account(b.id)} style={{ flex: 1, fontWeight: 700, color: 'var(--ink)', textDecoration: 'none' }}>{b.name}</Link>
              <span style={{ width: 90, textAlign: 'right' }}>{n(b.sent)}</span>
              <span style={{ width: 90, textAlign: 'right', color: bad && bp > 5 ? 'var(--red-600)' : 'var(--sand-600)' }}>{pct(bp, 1)}</span>
              <span style={{ width: 90, textAlign: 'right', color: bad && cp > 0.3 ? 'var(--red-600)' : 'var(--sand-600)' }}>{pct(cp, 2)}</span>
            </RowLine>
          );
        })}
        <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--sand-500)' }}>{t('adm.crm.pf.s.cut')}</p>
      </Section>
      <Section title={t('adm.crm.pf.s.list')} sub={t('adm.crm.pf.s.listSub')} pad={24} gap={4}>
        {Object.keys(supp.by_reason).length === 0 && <EmptyNote>{t('adm.crm.pf.s.none')}</EmptyNote>}
        {Object.entries(supp.by_reason).map(([r, c], i) => <RowLine key={r} first={i === 0}><span style={{ fontWeight: 600 }}>{r}</span><b>{n(c)}</b></RowLine>)}
      </Section>
    </>
  );
}

function AbuseTab({ d }: { d: AdminPlatform }) {
  const { t, dShort } = useCrmT();
  return (
    <Section title={t('adm.crm.pf.a.title')} sub={t('adm.crm.pf.a.sub')} pad={24} gap={4}>
      {d.frozen.length === 0 && <EmptyNote>{t('adm.crm.pf.a.none')}</EmptyNote>}
      {d.frozen.map((a, i) => (
        <RowLine key={a.id} first={i === 0}>
          <Link to={ADMIN_ROUTES.account(a.id)} style={{ flex: 1, fontWeight: 700, color: 'var(--ink)', textDecoration: 'none' }}>{a.name}</Link>
          <span style={{ flex: 2, color: 'var(--sand-600)', fontSize: 13.5 }}>{a.frozen_reason}</span>
          <span style={{ color: 'var(--sand-500)', fontSize: 13 }}>{a.frozen_at ? dShort(a.frozen_at) : ''}</span>
        </RowLine>
      ))}
    </Section>
  );
}

function SystemTab({ d }: { d: AdminPlatform }) {
  const { t } = useCrmT();
  return (
    <Section title={t('adm.crm.pf.y.title')} sub={t('adm.crm.pf.y.sub')} pad={24} gap={4}>
      {d.cron.length === 0 && <EmptyNote>{t('adm.crm.pf.y.none')}</EmptyNote>}
      {d.cron.map((c, i) => (
        <RowLine key={c.name} first={i === 0}>
          <span style={{ flex: 1, fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: 13.5 }}>{c.name}</span>
          <span style={{ color: 'var(--sand-600)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>{c.schedule}</span>
          <span style={{ width: 70, textAlign: 'right', fontWeight: 600, color: c.active ? 'var(--green-700)' : 'var(--red-600)' }}>{c.active ? t('adm.crm.pf.y.on') : t('adm.crm.pf.y.off')}</span>
        </RowLine>
      ))}
    </Section>
  );
}

const PILL = {
  red: { background: 'var(--red-50)', color: 'var(--red-700)' },
  amber: { background: 'var(--amber-50)', color: 'var(--amber-700)' },
  sand: { background: 'var(--sand-100)', color: 'var(--sand-700)' },
} as const;
function Pill({ tone, children }: { tone: keyof typeof PILL; children: ReactNode }) {
  return <span style={{ ...PILL[tone], height: 22, padding: '0 9px', borderRadius: 99, fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>{children}</span>;
}

/**
 * Scénarios : des agrégats par compte (jamais une personne). « À revoir » = un
 * scénario en ligne dont la version publiée ne passerait plus les contrôles de
 * contenu (modèle supprimé, soirée passée, identité SMS retirée) : le moteur
 * saute alors le message, le pro doit corriger et republier.
 */
function ScnTab() {
  const { t, n } = useCrmT();
  const ago = useAgo();
  const q = useAdminScenarios();
  if (q.isError && !q.data) return <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />;
  const d = q.data;
  if (!d) return <><div style={kpiGrid}>{[0, 1, 2, 3].map((i) => <Skel key={i} h={118} r={24} />)}</div><Skel h={320} r={28} /></>;
  const k = d.totals;
  const why = (r: string) => { const key = `yc.scn.why.${r}`; const v = t(key); return v === key ? t('yc.scn.why.other') : v; };
  const held = Object.entries(d.held).sort((a, b) => b[1] - a[1]);
  const pl = (v: number, one: string, many: string) => t(v === 1 ? one : many, { n: n(v) });
  const activeSub = [pl(k.accounts, 'adm.crm.pf.sc.k.accountsOne', 'adm.crm.pf.sc.k.accounts'), t('adm.crm.pf.sc.k.paused', { n: n(k.paused) }), pl(k.drafts, 'adm.crm.pf.sc.k.draftsOne', 'adm.crm.pf.sc.k.drafts')].join(' · ');
  return (
    <>
      <div style={kpiGrid}>
        <Kpi label={t('adm.crm.pf.sc.k.active')} value={n(k.active)} dot="var(--green-500)" sub={activeSub} />
        <Kpi delay={60} label={t('adm.crm.pf.sc.k.way')} value={n(k.on_their_way)} sub={pl(k.entered7, 'adm.crm.pf.sc.k.waySubOne', 'adm.crm.pf.sc.k.waySub')} />
        <Kpi delay={120} label={t('adm.crm.pf.sc.k.sent')} value={n(k.sent7)} sub={pl(k.expired7, 'adm.crm.pf.sc.k.sentSubOne', 'adm.crm.pf.sc.k.sentSub')} />
        <Kpi delay={180} label={t('adm.crm.pf.sc.k.held')} value={n(k.held_now)} dot="var(--amber-500)" sub={held[0] ? t('adm.crm.pf.sc.k.heldSub', { why: why(held[0][0]) }) : t('adm.crm.pf.sc.k.heldNone')} />
        <Kpi delay={240} label={t('adm.crm.pf.sc.k.broken')} value={n(k.broken)} dot="var(--red-500)" sub={k.broken ? t('adm.crm.pf.sc.k.brokenSub') : t('adm.crm.pf.sc.k.brokenNone')} />
      </div>
      <Section title={t('adm.crm.pf.sc.acc')} sub={t('adm.crm.pf.sc.accSub')} pad={24} gap={4}>
        {d.accounts.length === 0 && <EmptyNote>{t('adm.crm.pf.sc.none')}</EmptyNote>}
        {d.accounts.map((a, i) => <ScnAccountRow key={a.id} a={a} first={i === 0} why={why} ago={ago} />)}
      </Section>
      <Section title={t('adm.crm.pf.sc.held')} sub={t('adm.crm.pf.sc.heldSub')} pad={24} gap={4}>
        {held.length === 0 && <EmptyNote>{t('adm.crm.pf.sc.heldEmpty')}</EmptyNote>}
        {held.map(([r, c], i) => <RowLine key={r} first={i === 0}><span style={{ fontWeight: 600 }}>{why(r).charAt(0).toUpperCase() + why(r).slice(1)}</span><b>{n(c)}</b></RowLine>)}
        <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--sand-500)' }}>{t('adm.crm.pf.sc.privacy')}</p>
      </Section>
    </>
  );
}

function ScnAccountRow({ a, first, why, ago }: { a: AdminScenarioAccount; first: boolean; why: (r: string) => string; ago: (iso: string) => string }) {
  const { t, n } = useCrmT();
  const stat = (v: number, one: string, many = one) => (
    <span style={{ whiteSpace: 'nowrap' }}><b style={{ color: 'var(--ink)' }}>{n(v)}</b> {t(v === 1 ? one : many)}</span>
  );
  return (
    <div style={{ padding: '14px 0', borderTop: first ? 0 : '1px solid var(--sand-100)', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Link to={ADMIN_ROUTES.account(a.id)} style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--ink)', textDecoration: 'none' }}>{a.name}</Link>
        {a.city && <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{a.city}</span>}
        {a.state !== 'ok' && <Pill tone={a.state === 'frozen' ? 'red' : 'amber'}>{t(`adm.crm.pf.sc.state.${a.state}`)}</Pill>}
        {a.broken > 0 && <Pill tone="red">{t('adm.crm.pf.sc.brokenN', { n: a.broken })}</Pill>}
        {a.by_ai > 0 && <Pill tone="sand">{t(a.by_ai === 1 ? 'adm.crm.pf.sc.byAiOne' : 'adm.crm.pf.sc.byAi', { n: a.by_ai })}</Pill>}
        {a.last_change && <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--sand-500)', whiteSpace: 'nowrap' }}>{t('adm.crm.pf.sc.changed', { when: ago(a.last_change) })}</span>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 13.5, color: 'var(--sand-600)' }}>
        {stat(a.active, 'adm.crm.pf.sc.c.active')}
        {a.paused > 0 && stat(a.paused, 'adm.crm.pf.sc.c.paused')}
        {a.drafts > 0 && stat(a.drafts, 'adm.crm.pf.sc.c.draftsOne', 'adm.crm.pf.sc.c.drafts')}
        {stat(a.on_their_way, 'adm.crm.pf.sc.c.way')}
        {stat(a.sent7, 'adm.crm.pf.sc.c.sentOne', 'adm.crm.pf.sc.c.sent')}
        {a.would_send7 > 0 && stat(a.would_send7, 'adm.crm.pf.sc.c.wouldOne', 'adm.crm.pf.sc.c.would')}
        {a.expired7 > 0 && stat(a.expired7, 'adm.crm.pf.sc.c.expiredOne', 'adm.crm.pf.sc.c.expired')}
        {a.held_now > 0 && <span style={{ whiteSpace: 'nowrap', color: 'var(--amber-700)' }}><b>{n(a.held_now)}</b> {t(a.held_now === 1 ? 'adm.crm.pf.sc.c.heldOne' : 'adm.crm.pf.sc.c.held')}{a.held_reason ? ` · ${why(a.held_reason)}` : ''}</span>}
      </div>
    </div>
  );
}
