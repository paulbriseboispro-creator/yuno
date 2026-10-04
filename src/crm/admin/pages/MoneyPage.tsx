/**
 * Admin CRM › Argent (« Admin Argent » du design) : le revenu récurrent (MRR,
 * abonnements Stripe actifs), les achats de Yunits (jamais dans le MRR) et la
 * marge par compte (revenu moins coût réel des envois, coûts réglés dans
 * Réglages). Les résiliations sont datées par la dernière mise à jour de
 * l'abonnement : la page le dit.
 */
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCrmT } from '@/crm/i18n';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { Skel } from '@/crm/ui/kit';
import { ADMIN_ROUTES } from '../adminNav';
import { useAdminMoney } from '../data';
import type { AdminMoney } from '../data';
import { EmptyNote, Kpi, PageHead, RowLine, Section, Tabs, kpiGrid, pageWrap, twoCols } from '../ui';

type Tab = 'mrr' | 'buys' | 'margin';

export default function MoneyPage() {
  const { t } = useCrmT();
  const [sp, setSp] = useSearchParams();
  const q = useAdminMoney();
  const tab: Tab = sp.get('tab') === 'buys' ? 'buys' : sp.get('tab') === 'margin' ? 'margin' : 'mrr';
  if (q.isError && !q.data) return <main style={{ padding: 32 }}><CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /></main>;
  return (
    <main style={pageWrap}>
      <PageHead kicker={t('adm.crm.mo.kicker')} title={t('adm.crm.mo.title')} sub={t('adm.crm.mo.sub')} />
      <Tabs<Tab> value={tab} onChange={(v) => setSp(v === 'mrr' ? {} : { tab: v }, { replace: true })}
        tabs={[{ id: 'mrr', label: t('adm.crm.mo.t.mrr') }, { id: 'buys', label: t('adm.crm.mo.t.buys') }, { id: 'margin', label: t('adm.crm.mo.t.margin') }]} />
      {!q.data ? <><div style={kpiGrid}>{[0, 1, 2, 3, 4].map((i) => <Skel key={i} h={118} r={24} />)}</div><Skel h={380} r={28} /></> : (
        tab === 'mrr' ? <MrrTab d={q.data} /> : tab === 'buys' ? <BuysTab d={q.data} /> : <MarginTab d={q.data} />
      )}
    </main>
  );
}

function monthLabel(iso: string, lang: string) { return new Date(iso).toLocaleDateString(lang, { month: 'short' }); }

function MrrTab({ d }: { d: AdminMoney }) {
  const { t, eur, eur2, pct, n, dShort, locale } = useCrmT();
  const k = d.kpi;
  const arpa = k.paying ? k.mrr / k.paying : 0;
  const churn = k.active_start ? (k.lost90 / k.active_start / 3) * 100 : null;
  const last = d.months[d.months.length - 1];
  const prev = d.months[d.months.length - 2];
  const top = Math.max(1, ...d.months.map((m) => Math.max(m.new, m.lost, m.mrr)));
  const switchAt = d.cfg.price_switch_at;
  const left = Math.max(0, switchAt - k.paying);
  const eta = k.new_per_month > 0 && left > 0 ? new Date(Date.now() + (left / k.new_per_month) * 30 * 86_400_000) : null;
  return (
    <>
      <div style={kpiGrid}>
        <Kpi label="MRR" value={eur(k.mrr)} sub={last && prev ? <span style={{ color: 'var(--green-700)', fontWeight: 600 }}>▲ {eur(Math.max(0, last.mrr - prev.mrr))} {t('adm.crm.mo.thisMonth')}</span> : t('adm.crm.mo.k.mrrSub')} />
        <Kpi delay={60} label="ARR" value={eur(k.mrr * 12)} sub="MRR × 12" />
        <Kpi delay={120} label={t('adm.crm.mo.k.arpa')} value={k.paying ? eur2(arpa) : '—'} sub={t('adm.crm.mo.k.arpaSub')} />
        <Kpi delay={180} label={t('adm.crm.mo.k.churn')} value={churn === null ? '—' : pct(churn, 1)} sub={t('adm.crm.mo.k.churnSub', { n: k.lost90 })} />
        <Kpi delay={240} label={t('adm.crm.mo.k.late')} value={n(k.late)} dot="var(--red-500)" sub={t('adm.crm.mo.k.lateSub')} />
      </div>
      <Section title={t('adm.crm.mo.chart')} sub={t('adm.crm.mo.chartSub')}>
        <div style={{ position: 'relative', height: 260, marginLeft: 8 }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', borderTop: '1px solid var(--sand-200)' }} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', gap: 14 }}>
            {d.months.map((m) => (
              <div key={m.m} style={{ flex: 1, minWidth: 0, position: 'relative' }} title={`${t('adm.crm.mo.new')} +${eur(m.new)} · ${t('adm.crm.mo.lost')} −${eur(m.lost)} · MRR ${eur(m.mrr)}`}>
                <div style={{ position: 'absolute', left: '16%', right: '16%', bottom: '50%', height: `${(m.new / top) * 48}%`, borderRadius: '6px 6px 0 0', background: 'var(--gradient-brand)' }} />
                <div style={{ position: 'absolute', left: '16%', right: '16%', top: '50%', height: `${(m.lost / top) * 48}%`, borderRadius: '0 0 6px 6px', background: 'var(--sand-400)' }} />
                {m.new > 0 && <span style={{ position: 'absolute', left: 0, right: 0, bottom: `calc(50% + ${(m.new / top) * 48}% + 4px)`, textAlign: 'center', fontSize: 12, fontWeight: 600, color: 'var(--green-700)' }}>+{eur(m.new)}</span>}
              </div>
            ))}
          </div>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
            <polyline fill="none" stroke="var(--ink)" strokeWidth={2} vectorEffect="non-scaling-stroke"
              points={d.months.map((m, i) => `${((i + 0.5) / d.months.length) * 100},${50 - (m.mrr / top) * 48}`).join(' ')} />
          </svg>
        </div>
        <div style={{ display: 'flex', gap: 14, marginLeft: 8 }}>{d.months.map((m) => <span key={m.m} style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--sand-500)' }}>{monthLabel(m.m, locale)}</span>)}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, fontSize: 12.5, color: 'var(--sand-600)' }}>
          <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'var(--red-500)', marginRight: 6 }} />{t('adm.crm.mo.new')}</span>
          <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'var(--sand-400)', marginRight: 6 }} />{t('adm.crm.mo.lost')}</span>
          <span><i style={{ display: 'inline-block', width: 14, height: 2, background: 'var(--ink)', marginRight: 6, verticalAlign: 'middle' }} />{t('adm.crm.mo.mrrEnd')}</span>
        </div>
      </Section>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: 20, alignItems: 'start' }}>
        <Section title={t('adm.crm.mo.subs')} pad={24} gap={8}>
          {d.subs.length === 0 && <EmptyNote>{t('adm.crm.mo.subsNone')}</EmptyNote>}
          {d.subs.map((s, i) => (
            <RowLine key={s.id} first={i === 0}>
              <Link to={ADMIN_ROUTES.account(s.id)} style={{ flex: 1, minWidth: 0, fontWeight: 700, color: 'var(--ink)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                <i style={{ width: 8, height: 8, borderRadius: 99, background: s.late ? 'var(--red-500)' : 'var(--green-500)' }} />{s.name}
              </Link>
              <span style={{ width: 80, color: 'var(--sand-600)' }}>{t(`adm.crm.ac.plan.${s.interval}`)}</span>
              <span style={{ width: 90, color: 'var(--sand-600)' }}>{dShort(s.since)}</span>
              <span style={{ width: 110, color: s.late ? 'var(--red-600)' : 'var(--sand-600)', fontWeight: s.late ? 600 : 400 }}>{s.late ? t('adm.crm.mo.failed') : s.next ? dShort(s.next) : '—'}</span>
              <span style={{ width: 70, textAlign: 'right', fontWeight: 700 }}>{eur2(s.price)}</span>
            </RowLine>
          ))}
        </Section>
        <Section title={t('adm.crm.mo.switch', { price: d.cfg.price_month_next })} pad={24}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 48, letterSpacing: '-.04em', lineHeight: 1 }}>{k.paying}</span>
            <span style={{ color: 'var(--sand-500)' }}>{t('adm.crm.mo.switchOf', { n: switchAt })}</span>
          </div>
          <div style={{ display: 'flex', gap: 2, height: 22 }}>
            {Array.from({ length: Math.min(switchAt, 50) }, (_, i) => <i key={i} style={{ flex: 1, borderRadius: 2, background: i < Math.round((Math.min(k.paying, switchAt) / switchAt) * Math.min(switchAt, 50)) ? 'var(--red-500)' : 'var(--sand-100)' }} />)}
          </div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--sand-600)' }}>
            {left === 0 ? t('adm.crm.mo.switchReached') : eta ? t('adm.crm.mo.switchEta', { rate: k.new_per_month, date: eta.toLocaleDateString(locale, { month: 'long', year: 'numeric' }) }) : t('adm.crm.mo.switchNoRate')}{' '}
            {t('adm.crm.mo.switchKeep', { price: d.cfg.price_month })}
          </p>
        </Section>
      </div>
    </>
  );
}

function BuysTab({ d }: { d: AdminMoney }) {
  const { t, eur, n, dShort, time } = useCrmT();
  const total = d.buys.reduce((s, b) => s + b.eur, 0);
  const d30 = d.buys.filter((b) => Date.now() - new Date(b.at).getTime() < 30 * 86_400_000);
  const e30 = d30.reduce((s, b) => s + b.eur, 0);
  const topW = Math.max(1, ...d.weeks.map((w) => w.eur));
  const packTop = Math.max(1, ...d.packs.map((p) => p.n));
  return (
    <>
      <div style={kpiGrid}>
        <Kpi label={t('adm.crm.mo.b.sold30')} value={eur(e30)} dot="var(--tangerine-500)" sub={t('adm.crm.mo.b.soldSub')} />
        <Kpi delay={60} label={t('adm.crm.mo.b.n30')} value={n(d30.length)} sub={d30.length ? t('adm.crm.mo.b.avg', { avg: eur(e30 / d30.length) }) : t('adm.crm.mo.b.none')} />
        <Kpi delay={120} label={t('adm.crm.mo.b.buyers')} value={n(d.buyers.length)} sub={t('adm.crm.mo.b.buyersSub')} />
        <Kpi delay={180} label={t('adm.crm.mo.b.total')} value={eur(total)} sub={t('adm.crm.mo.b.totalSub')} />
      </div>
      <Section title={t('adm.crm.mo.b.weeks')} sub={t('adm.crm.mo.b.weeksSub')}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 180 }}>
          {d.weeks.map((w) => (
            <div key={w.w} title={`${dShort(w.w)} · ${eur(w.eur)} · ${w.n}`} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', height: '100%', gap: 4 }}>
              {w.eur > 0 && <span style={{ fontSize: 11.5, fontWeight: 600 }}>{eur(w.eur)}</span>}
              <div style={{ width: '100%', height: `${Math.max(w.eur ? 4 : 1, (w.eur / topW) * 80)}%`, borderRadius: '6px 6px 0 0', background: w.eur ? 'var(--gradient-brand)' : 'var(--sand-100)' }} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>{d.weeks.map((w) => <span key={w.w} style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--sand-500)' }}>{dShort(w.w)}</span>)}</div>
      </Section>
      <div style={twoCols}>
        <Section title={t('adm.crm.mo.b.packs')} pad={24} gap={10}>
          {d.packs.length === 0 && <EmptyNote>{t('adm.crm.mo.b.none')}</EmptyNote>}
          {d.packs.map((p) => (
            <div key={p.yunits} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 40px', alignItems: 'center', gap: 12, fontSize: 14 }}>
              <span style={{ fontWeight: 600 }}>{n(p.yunits)}</span>
              <span style={{ height: 16, borderRadius: 99, background: 'var(--sand-50)', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${(p.n / packTop) * 100}%`, background: 'var(--gradient-brand)', borderRadius: 99 }} /></span>
              <span style={{ textAlign: 'right', fontWeight: 700 }}>{p.n}</span>
            </div>
          ))}
        </Section>
        <Section title={t('adm.crm.mo.b.best')} pad={24} gap={4}>
          {d.buyers.length === 0 && <EmptyNote>{t('adm.crm.mo.b.none')}</EmptyNote>}
          {d.buyers.map((b, i) => (
            <RowLine key={b.id} first={i === 0}>
              <Link to={ADMIN_ROUTES.account(b.id)} style={{ flex: 1, fontWeight: 700, color: 'var(--ink)', textDecoration: 'none' }}>{b.name}</Link>
              <span style={{ color: 'var(--sand-500)' }}>{t('adm.crm.mo.b.times', { n: b.n })}</span>
              <span style={{ width: 80, textAlign: 'right', fontWeight: 700 }}>{eur(b.eur)}</span>
            </RowLine>
          ))}
        </Section>
      </div>
      <Section title={t('adm.crm.mo.b.all')} pad={24} gap={4}>
        {d.buys.length === 0 && <EmptyNote>{t('adm.crm.mo.b.none')}</EmptyNote>}
        {d.buys.map((b, i) => (
          <RowLine key={`${b.id}${b.at}`} first={i === 0}>
            <span style={{ width: 130, color: 'var(--sand-600)' }}>{dShort(b.at)} {time(b.at)}</span>
            <Link to={ADMIN_ROUTES.account(b.id)} style={{ flex: 1, fontWeight: 700, color: 'var(--ink)', textDecoration: 'none' }}>{b.name}</Link>
            <span style={{ width: 110, color: 'var(--sand-600)' }}>{n(b.yunits)} Yunits</span>
            <span style={{ width: 80, textAlign: 'right', fontWeight: 700 }}>{eur(b.eur)}</span>
          </RowLine>
        ))}
      </Section>
    </>
  );
}

function MarginTab({ d }: { d: AdminMoney }) {
  const { t, eur, eur2, pct } = useCrmT();
  const rows = useMemo(() => d.margin, [d.margin]);
  const rev = rows.reduce((s, r) => s + r.revenue, 0);
  const cost = rows.reduce((s, r) => s + r.cost, 0);
  return (
    <>
      <div style={kpiGrid}>
        <Kpi label={t('adm.crm.mo.m.revenue')} value={eur(rev)} sub={t('adm.crm.mo.m.revenueSub')} />
        <Kpi delay={60} label={t('adm.crm.mo.m.cost')} value={eur2(cost)} sub={t('adm.crm.mo.m.costSub')} />
        <Kpi delay={120} label={t('adm.crm.mo.m.margin')} value={rev ? pct(((rev - cost) / rev) * 100) : '—'} dot="var(--green-500)" sub={eur(rev - cost)} />
      </div>
      <Section title={t('adm.crm.mo.m.title')} sub={t('adm.crm.mo.m.sub')} pad={24} gap={4}>
        {rows.length === 0 && <EmptyNote>{t('adm.crm.mo.m.none')}</EmptyNote>}
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 640 }}>
            {rows.map((r, i) => (
              <RowLine key={r.id} first={i === 0}>
                <Link to={ADMIN_ROUTES.account(r.id)} style={{ flex: 1, fontWeight: 700, color: 'var(--ink)', textDecoration: 'none' }}>{r.name}</Link>
                <span style={{ width: 90, textAlign: 'right' }}>{eur2(r.revenue)}</span>
                <span style={{ width: 90, textAlign: 'right', color: 'var(--sand-600)' }}>{eur2(r.cost)}</span>
                <span style={{ width: 90, textAlign: 'right', fontWeight: 700, color: r.margin < 0 ? 'var(--red-600)' : 'var(--green-700)' }}>{eur2(r.margin)}</span>
              </RowLine>
            ))}
          </div>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--sand-500)', lineHeight: 1.5 }}>{t('adm.crm.mo.m.note')}</p>
      </Section>
    </>
  );
}
