/**
 * Bilan de la semaine (agents, lot A3 ; crm_weekly_review, migration
 * 20261016175000). Calculé par Yuno à l'ouverture, sans IA : l'activité de la
 * semaine écoulée, ce qui a marché MESURÉ contre les personnes mises de côté,
 * ce qui dérive, puis 1 à 3 actions avec l'écran qui les prépare. Annoncé le
 * lundi dans les notifications. « Préparer avec mon IA » ouvre l'IA du pro, qui
 * lit le même bilan par le MCP et prépare les brouillons.
 */
import { Link } from 'react-router-dom';
import { MonoLabel, PillButton, Skel } from '@/crm/ui/kit';
import { useCrmT } from '@/crm/i18n';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { AskMyAiButton } from '@/crm/components/AskMyAi';
import { useWeeklyReview, type WeeklyAction, type WeeklyDrift, type WeeklyMeasured, type WeeklyReview } from '@/crm/data/plan';

type T = ReturnType<typeof useCrmT>;

const card = { padding: 'clamp(18px,3vw,24px)', borderRadius: 24, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', display: 'flex', flexDirection: 'column', gap: 10 } as const;
const h2 = { margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em', lineHeight: 1.2 } as const;
const muted = { fontSize: 14, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' } as const;
const row = (first: boolean) => ({ display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 0', borderTop: first ? 0 : '1px solid var(--sand-100)' } as const);

export default function WeeklyReviewPage() {
  const T = useCrmT();
  const { t } = T;
  const q = useWeeklyReview();
  const d = q.data;
  return (
    <main style={{ flex: 1, width: '100%', maxWidth: 1000, boxSizing: 'border-box', margin: '0 auto', padding: 'clamp(24px,3vw,36px) 16px 72px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px 20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <MonoLabel>{t('yc.ag.rev.kicker')}</MonoLabel>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,4vw,36px)', letterSpacing: '-.035em', lineHeight: 1.05 }}>
            {d ? t('yc.ag.rev.title', { a: T.dShort(d.from), b: T.dShort(d.to) }) : t('yc.ag.rev.kicker')}
          </h1>
          <span style={muted}>{t('yc.ag.rev.sub')}</span>
        </div>
        {d && !d.quiet && <AskMyAiButton text={t('yc.ag.ai.q.review')} need="drafts" />}
      </header>
      {q.isError ? <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />
        : !d ? <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}><Skel h={110} r={24} /><Skel h={220} r={24} /></div>
          : <Body d={d} T={T} />}
    </main>
  );
}

function Body({ d, T }: { d: WeeklyReview; T: T }) {
  const { t, n } = T;
  const a = d.activity;
  const gains = d.measured.filter((m) => m.verdict === 'gain');
  const losses = d.measured.filter((m) => m.verdict === 'loss');
  const flat = d.measured.filter((m) => m.verdict === 'none');
  const tiles: [string, number][] = [
    ['yc.ag.rev.act.emails', a.emails], ['yc.ag.rev.act.sms', a.sms], ['yc.ag.rev.act.scenarios', a.scenario_messages],
    ['yc.ag.rev.act.recipes', a.recipe_messages], ['yc.ag.rev.act.protected', a.protected],
  ];
  return (
    <>
      {d.quiet && <section style={card}><span style={muted}>{t('yc.ag.rev.quiet')}</span></section>}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {tiles.map(([k, v]) => (
          <div key={k} style={{ ...card, gap: 4, padding: 18 }}>
            <span style={{ fontSize: 13, color: 'var(--sand-600)' }}>{t(k)}</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{n(v)}</span>
          </div>
        ))}
      </section>

      {d.actions.length > 0 && (
        <section style={card}>
          <h2 style={h2}>{t('yc.ag.rev.actions.title')}</h2>
          {d.actions.map((x, i) => <ActionRow key={`${x.kind}:${i}`} x={x} T={T} first={i === 0} />)}
        </section>
      )}

      <section style={card}>
        <h2 style={h2}>{t('yc.ag.rev.worked.title')}</h2>
        <span style={muted}>{t('yc.ag.rev.worked.sub', { p: n(d.holdout_pct ?? 0) })}</span>
        {gains.length === 0 && d.scenarios.filter((s) => s.verdict === 'gain').length === 0
          ? <span style={muted}>{t('yc.ag.rev.worked.none')}</span>
          : (
            <>
              {gains.map((m, i) => <MeasuredRow key={`${m.channel}:${m.id}`} m={m} T={T} first={i === 0} />)}
              {d.scenarios.filter((s) => s.verdict === 'gain').map((s, i) => (
                <div key={s.id} style={row(i === 0 && gains.length === 0)}>
                  <Link to={CRM_ROUTES.scenario(s.id)} style={{ fontWeight: 600, color: 'var(--ink)' }}>{s.name}</Link>
                  <span style={{ fontSize: 14, color: 'var(--green-700)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{t('yc.ag.rev.extra', { n: n(s.measure.extra ?? 0) })}</span>
                </div>
              ))}
            </>
          )}
      </section>

      {(losses.length > 0 || d.scenarios.some((s) => s.verdict === 'loss')) && (
        <section style={card}>
          <h2 style={h2}>{t('yc.ag.rev.loss.title')}</h2>
          {losses.map((m, i) => <MeasuredRow key={`${m.channel}:${m.id}`} m={m} T={T} first={i === 0} />)}
          {d.scenarios.filter((s) => s.verdict === 'loss').map((s, i) => (
            <div key={s.id} style={row(i === 0 && losses.length === 0)}>
              <Link to={CRM_ROUTES.scenario(s.id)} style={{ fontWeight: 600, color: 'var(--ink)' }}>{s.name}</Link>
              <span style={{ fontSize: 14, color: 'var(--amber-700)' }}>{t('yc.ag.rev.lossLine')}</span>
            </div>
          ))}
        </section>
      )}

      {flat.length > 0 && (
        <section style={card}>
          <h2 style={h2}>{t('yc.ag.rev.flat.title')}</h2>
          {flat.map((m, i) => <MeasuredRow key={`${m.channel}:${m.id}`} m={m} T={T} first={i === 0} />)}
        </section>
      )}

      <section style={card}>
        <h2 style={h2}>{t('yc.ag.rev.drift.title')}</h2>
        {d.drift.length === 0
          ? <span style={muted}>{t('yc.ag.rev.drift.none')}</span>
          : d.drift.map((x, i) => <DriftRow key={x.kind} x={x} T={T} first={i === 0} />)}
      </section>

      <p style={{ ...muted, fontSize: 12.5, margin: 0 }}>{t('yc.ag.rev.foot')}</p>
    </>
  );
}

function measuredLabel(m: WeeklyMeasured, T: T): string {
  if (m.channel === 'recipe') {
    const k = `yc.au.r.${m.id}.name`;
    const v = T.t(k);
    return v === k ? T.t('yc.ag.rev.recipe') : v;
  }
  return m.label || T.t('yc.ag.plan.planned.noName');
}

function MeasuredRow({ m, T, first }: { m: WeeklyMeasured; T: T; first: boolean }) {
  const { t, n } = T;
  return (
    <div style={row(first)}>
      <span style={{ fontWeight: 600 }}>{measuredLabel(m, T)}{m.event ? <span style={{ fontWeight: 500, color: 'var(--sand-600)' }}> · {m.event}</span> : null}</span>
      {m.verdict === 'gain' && <span style={{ fontSize: 14, color: 'var(--green-700)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{t('yc.ag.rev.extra', { n: n(m.extra ?? 0) })}</span>}
      {m.verdict === 'loss' && <span style={{ fontSize: 14, color: 'var(--amber-700)' }}>{t('yc.ag.rev.lossLine')}</span>}
      <span style={{ fontSize: 13, color: 'var(--sand-600)', fontVariantNumeric: 'tabular-nums' }}>
        {t('yc.ag.rev.compare', { cb: n(m.contacted.buyers), cn: n(m.contacted.n), hb: n(m.control.buyers), hn: n(m.control.n) })}
      </span>
    </div>
  );
}

function DriftRow({ x, T, first }: { x: WeeklyDrift; T: T; first: boolean }) {
  const { t, n } = T;
  const text = x.kind === 'pace' ? t('yc.ag.rev.drift.pace', { t: x.title, s: n(x.sold), p: x.prev_title, ps: n(x.prev_sold) })
    : x.kind === 'deliverability' ? t('yc.ag.rev.drift.deliverability', { b: n(x.bounced), c: n(x.complained), s: n(x.sent) })
      : x.kind === 'protected' ? t('yc.ag.rev.drift.protected', { p: n(x.protected), r: n(x.reached) })
        : t('yc.ag.rev.drift.journal', { t: x.title, pr: n(x.predicted), a: n(x.actual), e: n(x.err_pct) });
  return <div style={row(first)}><span style={{ fontSize: 14.5, lineHeight: 1.5 }}>{text}</span></div>;
}

function ActionRow({ x, T, first }: { x: WeeklyAction; T: T; first: boolean }) {
  const { t } = T;
  const [label, to, cta] =
    x.kind === 'targets' ? [t('yc.ag.rev.do.targets', { t: x.title }), `${CRM_ROUTES.nights}?e=${encodeURIComponent(x.event_id)}&v=target`, t('yc.ag.rev.go.targets')]
      : x.kind === 'plan' ? [t('yc.ag.rev.do.plan', { t: x.title, d: T.dShort(x.start_at) }), CRM_ROUTES.nightPlan(x.event_id), t('yc.ag.plan.open')]
        : x.kind === 'scenario' ? [t('yc.ag.rev.do.scenario', { t: x.name }), CRM_ROUTES.scenario(x.id), t('yc.ag.rev.go.scenario')]
          : x.kind === 'base' ? [t('yc.ag.rev.do.base'), CRM_ROUTES.clients, t('yc.ag.rev.go.base')]
            : [t('yc.ag.rev.do.automate'), CRM_ROUTES.automations, t('yc.ag.rev.go.automate')];
  return (
    <div style={{ ...row(first), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 15, fontWeight: 600, flex: '1 1 260px', minWidth: 0 }}>{label}</span>
      <PillButton tone="light" size="sm" to={to}>{cta}</PillButton>
    </div>
  );
}
