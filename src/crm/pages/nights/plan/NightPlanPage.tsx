/**
 * Plan de soirée (agents, lot A1 ; crm_night_plan, migration 20261016155000).
 * Un rapport plein écran, imprimable, fait d'agrégats seulement : où en est la
 * soirée, le plan daté (« Qui cibler », chaque personne comptée une fois),
 * son coût en Yunits, ce qui est déjà prévu, ce qui fait venir chez le pro, le
 * témoin. Tout chiffre vient du serveur. « Préparer avec mon IA » ouvre l'IA
 * branchée par le pro (MCP), qui lit ce même plan et dépose les brouillons.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, MonoLabel, PillButton, Skel } from '@/crm/ui/kit';
import { Icon } from '@/crm/ui/Icon';
import { useNarrow } from '@/crm/ui/useNarrow';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { WriteModal } from '@/crm/components/WriteModal';
import { AskMyAiButton } from '@/crm/components/AskMyAi';
import { StatusBadge } from '@/crm/components/analysis/HypBits';
import { familyKind, type AnFamily } from '@/crm/lib/analysis';
import { useNightPlan, type NightPlan, type NightPlanAudience, type NightPlanStep } from '@/crm/data/plan';
import type { ClientFilterDef } from '@/crm/data/clients';
import { targetRuleText } from '../targetText';

type T = ReturnType<typeof useCrmT>;

const card = { padding: 'clamp(18px,3vw,24px)', borderRadius: 24, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', display: 'flex', flexDirection: 'column', gap: 12, breakInside: 'avoid' } as const;
const h2 = { margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em', lineHeight: 1.2 } as const;
const muted = { fontSize: 14, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' } as const;

export default function NightPlanPage() {
  const { id } = useParams();
  const T = useCrmT();
  const { t } = T;
  const q = useNightPlan(id ?? null);
  const narrow = useNarrow();
  const d = q.data;
  const back = `${CRM_ROUTES.nights}?e=${encodeURIComponent(id ?? '')}&v=target`;
  const ask = d?.ok && d.event
    ? t('yc.ag.ai.q.plan', { t: d.event.title, d: T.dLong(d.event.start_at) })
    : null;
  return (
    <div style={{ minHeight: '100vh' }}>
      <style>{'@media print { [data-noprint] { display: none !important; } .yc-page-bg { background: #fff !important; } }'}</style>
      <div data-noprint style={{ position: 'sticky', top: 0, zIndex: 20, background: 'rgba(255,255,255,.92)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', boxShadow: 'inset 0 -1px 0 var(--sand-100)' }}>
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Link to={back} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14.5, fontWeight: 600, color: 'var(--ink)', textDecoration: 'none', marginRight: 'auto' }}>
            <Icon name="arrowLeft" size={16} stroke={2.2} />{t('yc.ag.plan.back')}
          </Link>
          {ask && <AskMyAiButton text={ask} need="drafts" size="sm" />}
          {d?.ok && !narrow && <PillButton tone="ghost" size="sm" icon="file" onClick={() => window.print()}>{t('yc.ag.plan.print')}</PillButton>}
        </div>
      </div>
      <main style={{ maxWidth: 880, margin: '0 auto', padding: 'clamp(20px,4vw,36px) 16px 64px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {q.isError ? <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />
          : !d ? <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}><Skel h={36} w={320} /><Skel h={140} r={24} /><Skel h={260} r={24} /></div>
            : !d.ok ? <p style={muted}>{t(d.error === 'not_upcoming' || d.error === 'no_upcoming' ? `yc.ag.plan.err.${d.error}` : 'yc.ni.dr.notFound')}</p>
              : <Report d={d} T={T} at={q.dataUpdatedAt} />}
      </main>
    </div>
  );
}

function whenLabel(days: number, start: string, T: T): string {
  const date = `${T.dLong(start)} · ${T.time(start)}`;
  if (days <= 0) return T.t('yc.ag.plan.when.today', { d: date });
  if (days === 1) return T.t('yc.ag.plan.when.one', { d: date });
  return T.t('yc.ag.plan.when.other', { d: date, n: T.n(days) });
}

function Report({ d, T, at }: { d: NightPlan; T: T; at: number }) {
  const { t, tp, n } = T;
  const ev = d.event!;
  const steps = d.steps ?? [];
  return (
    <>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <MonoLabel>{t('yc.ag.plan.kicker')}</MonoLabel>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,5vw,40px)', letterSpacing: '-.035em', lineHeight: 1.05 }}>{ev.title}</h1>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--sand-700)' }}>{whenLabel(d.days_left ?? 0, ev.start_at, T)}</span>
        <span style={muted}>{t('yc.ag.plan.sub')}</span>
      </header>

      <section style={card}>
        <h2 style={h2}>{t('yc.ag.plan.where.title')}</h2>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 28, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>
          {tp('yc.ag.plan.sold', d.pace?.sold ?? 0, { n: n(d.pace?.sold ?? 0) })}
        </span>
        {d.pace?.prev
          ? <span style={{ ...muted, fontVariantNumeric: 'tabular-nums' }}>
              {t('yc.ag.plan.prev', { n: n(d.pace.prev.sold_same), t: d.pace.prev.title, total: n(d.pace.prev.total) })}
              {d.pace.prev.same_series ? ` ${t('yc.ag.plan.prevSeries')}` : ''}
            </span>
          : <span style={muted}>{t('yc.ag.plan.prevNone')}</span>}
        {d.score?.status === 'ok' && (d.score.projection || d.score.expected !== undefined) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
              {d.score.projection
                ? t('yc.sc.proj', { n: n(d.score.projection.total), lo: n(d.score.projection.low), hi: n(d.score.projection.high) })
                : t('yc.sc.expAll', { n: n(d.score.expected ?? 0), p: n(d.score.people ?? 0) })}
            </span>
          </div>
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={h2}>{t('yc.ag.plan.steps.title')}</h2>
        {!d.computed ? <p style={muted}>{t('yc.tgt.notComputed')}</p>
          : steps.length === 0 ? <p style={muted}>{t('yc.tgt.empty')}</p>
            : steps.map((s) => <StepCard key={s.moment} s={s} d={d} T={T} />)}
      </section>

      {d.totals && steps.length > 0 && (
        <section style={card}>
          <h2 style={h2}>{t('yc.ag.plan.total.title')}</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px', fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>
            <b>{tp('yc.ag.plan.total.people', d.totals.people, { n: n(d.totals.people) })}</b>
            <b>{t('yc.ag.plan.total.cost', { c: n(d.totals.cost) })}</b>
            <span style={{ color: 'var(--sand-600)' }}>{t('yc.ag.plan.total.balance', { b: n(d.totals.balance) })}</span>
          </div>
          {!d.totals.enough && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 14, color: 'var(--amber-700)' }}>
              <span>{t('yc.ag.plan.total.short')}</span>
              <Link data-noprint to={CRM_ROUTES.yunits} style={{ fontWeight: 600, color: 'var(--ink)' }}>{t('yc.ag.plan.total.topUp')}</Link>
            </div>
          )}
          <span style={{ ...muted, fontSize: 13 }}>{t('yc.ag.plan.total.note')}</span>
        </section>
      )}

      <section style={card}>
        <h2 style={h2}>{t('yc.ag.plan.planned.title')}</h2>
        {[...(d.planned?.emails ?? []).map((m) => ({ ...m, ch: 'email' as const })), ...(d.planned?.sms ?? []).map((m) => ({ ...m, ch: 'sms' as const }))].length === 0
          ? <span style={muted}>{t('yc.ag.plan.planned.empty')}</span>
          : [...(d.planned?.emails ?? []).map((m) => ({ ...m, ch: 'email' as const })), ...(d.planned?.sms ?? []).map((m) => ({ ...m, ch: 'sms' as const }))].map((m, i) => (
            <div key={`${m.ch}:${m.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 0', borderTop: i ? '1px solid var(--sand-100)' : 0, fontSize: 14.5 }}>
              <Badge tone="wait" dot={false}>{t(`yc.ag.plan.planned.${m.ch}`)}</Badge>
              <span style={{ flex: 1, minWidth: 160, fontWeight: 600 }}>{m.name || t('yc.ag.plan.planned.noName')}</span>
              <span style={{ color: 'var(--sand-600)' }}>{t(`yc.ag.plan.st.${m.status}`)}{m.at ? ` · ${T.dShort(m.at)}` : ''}</span>
            </div>
          ))}
      </section>

      <section style={card}>
        <h2 style={h2}>{t('yc.ag.plan.fam.title')}</h2>
        {(d.families ?? []).length === 0
          ? <span style={muted}>{t('yc.ag.plan.fam.empty')}</span>
          : (
            <>
              <span style={muted}>{t('yc.ag.plan.fam.sub')}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(d.families ?? []).map((f) => <Badge key={f} tone="done">{t(`yc.why.fam.${f}`)}</Badge>)}
              </div>
            </>
          )}
      </section>

      <section style={card}>
        <h2 style={h2}>{t('yc.ag.plan.holdout.title')}</h2>
        <span style={muted}>{(d.holdout_pct ?? 0) > 0 ? t('yc.ag.plan.holdout.body', { p: n(d.holdout_pct ?? 0) }) : t('yc.ag.plan.holdout.zero')}</span>
        <Link data-noprint to={CRM_ROUTES.settings} style={{ alignSelf: 'flex-start', fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{t('yc.ag.plan.holdout.set')}</Link>
      </section>

      <p style={{ ...muted, fontSize: 12.5, margin: 0 }}>{t('yc.ag.plan.foot', { d: T.dShort(new Date(at || Date.now())), h: T.time(new Date(at || Date.now())) })}</p>
    </>
  );
}

function stepTitle(s: NightPlanStep, T: T): string {
  if (s.moment === 'now') return T.t('yc.ag.plan.step.now');
  return T.t(`yc.ag.plan.step.${s.moment}`, { d: `${T.dWeek(s.send_at)} · ${T.time(s.send_at)}` });
}

function StepCard({ s, d, T }: { s: NightPlanStep; d: NightPlan; T: T }) {
  const { t, tp, n } = T;
  const sms = s.channel === 'sms';
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{stepTitle(s, T)}</span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>
            {tp('yc.ag.plan.step.people', s.people, { n: n(s.people) })}
          </span>
          <span style={{ ...muted, fontVariantNumeric: 'tabular-nums' }}>{t('yc.ag.plan.step.reach', { e: n(s.email), s: n(s.sms) })}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, fontVariantNumeric: 'tabular-nums' }}>
          <Badge tone={sms ? 'todo' : 'wait'} dot={false}>{t(sms ? 'yc.ag.plan.channel.sms' : 'yc.ag.plan.channel.email', { c: n(sms ? s.cost_sms : s.cost_email) })}</Badge>
          {sms && <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.ag.plan.channel.alt', { c: n(s.cost_email) })}</span>}
          {s.moment === 'eve' && !d.sms_ready && <span style={{ fontSize: 12.5, color: 'var(--sand-500)', maxWidth: 240, textAlign: 'right' }}>{t('yc.ag.plan.channel.smsOff')}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {s.audiences.map((a, i) => <AudienceRow key={a.key} a={a} d={d} T={T} first={i === 0} />)}
      </div>
    </div>
  );
}

function AudienceRow({ a, d, T, first }: { a: NightPlanAudience; d: NightPlan; T: T; first: boolean }) {
  const { t, tp, n } = T;
  const caps = useCrmCaps();
  const [writing, setWriting] = useState(false);
  const eventId = d.event?.id ?? '';
  const def: ClientFilterDef = { seg: 'all', f: { ntgt: { e: eventId, a: a.key } } };
  const name = t(`yc.tgt.aud.${a.key}.name`);
  const fam = a.family as AnFamily | undefined;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0', borderTop: first ? 0 : '1px solid var(--sand-100)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{name}</span>
          <span style={{ fontSize: 14, color: 'var(--sand-700)', fontVariantNumeric: 'tabular-nums' }}>
            {tp('yc.tgt.people', a.n, { n: n(a.n) })}
            {a.first_n < a.n && <span style={{ color: 'var(--sand-600)' }}> · {tp('yc.ag.plan.aud.first', a.first_n, { n: n(a.first_n) })}</span>}
          </span>
          {a.expected !== null && a.expected !== undefined && (
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--red-700)', fontVariantNumeric: 'tabular-nums' }}>{t('yc.sc.exp', { n: n(a.expected) })}</span>
          )}
        </div>
        {fam
          ? <StatusBadge f={{ status: a.status ?? null, availability: a.availability ?? null, kind: familyKind(fam) }} T={T} />
          : a.key === 'likely' ? <Badge tone="warn">{t('yc.sc.estimate')}</Badge> : null}
      </div>
      <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--sand-700)', textWrap: 'pretty' }}>{targetRuleText(a, T)}</span>
      <span style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--sand-600)' }}>{t(`yc.tgt.angle.${a.key}`)}</span>
      {caps.write && (
        <div data-noprint style={{ paddingTop: 2 }}>
          <PillButton tone="light" size="sm" onClick={() => setWriting(true)}>{t('yc.tgt.write')}</PillButton>
        </div>
      )}
      <WriteModal
        open={writing}
        onClose={() => setWriting(false)}
        scope="filtered"
        who={name}
        def={def}
        eventId={eventId}
        eyebrow={t('yc.tgt.eyebrow', { t: d.event?.title ?? '' })}
      />
    </div>
  );
}
