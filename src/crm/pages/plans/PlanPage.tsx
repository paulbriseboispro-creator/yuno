/**
 * Un plan de soirée (migration 20261122100000). En préparation : trois étapes
 * (les envois → le design → programmer). Le design se retouche dans le Studio
 * ou par l'IA du pro branchée sur Yuno (MCP : un brouillon ordinaire) ; dès que
 * chaque e-mail est retouché ou gardé tel quel, l'étape suivante s'ouvre seule.
 * Une fois programmé : le suivi (envois, protections, témoin, actions).
 * Tout chiffre vient de crm_night_plan_get.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Modal, MonoLabel, PillButton, Skel, Switch } from '@/crm/ui/kit';
import { Icon } from '@/crm/ui/Icon';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps, useCrmScope } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { AskMyAiButton } from '@/crm/components/AskMyAi';
import { SenderIdentityNotice } from '@/crm/components/SenderIdentityNotice';
import { EmailThumb } from '@/crm/pages/emails/EmailThumb';
import { useCrmShell } from '@/crm/data/shell';
import { createAutomationTemplate, useAutomations, useSaveAutomation } from '@/crm/data/automations';
import {
  useNightPlanState, usePlanCampaignEdit, useReviewPlanCampaign, useScheduleNightPlan, useSetNightPlanStatus,
  type NightPlanState, type PlanCampaign,
} from '@/crm/data/nightPlans';
import { groupProtected } from '@/crm/lib/nightPlan';
import { holdoutVerdict } from '@/crm/lib/holdout';

type T = ReturnType<typeof useCrmT>;
type Plan = NonNullable<NightPlanState['plan']>;

const card = { padding: 'clamp(18px,3vw,24px)', borderRadius: 24, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', display: 'flex', flexDirection: 'column', gap: 12 } as const;
const h2 = { margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em', lineHeight: 1.2 } as const;
const muted = { fontSize: 14, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' } as const;

export default function PlanPage() {
  const { id } = useParams();
  const T = useCrmT();
  const { t } = T;
  const q = useNightPlanState(id ?? null);
  const d = q.data;
  const plan = d?.plan ?? null;
  return (
    <main style={{ flex: 1, width: '100%', maxWidth: 1040, boxSizing: 'border-box', margin: '0 auto', padding: 'clamp(24px,3vw,36px) 16px 72px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Link to={CRM_ROUTES.plans} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14.5, fontWeight: 600, color: 'var(--ink)', textDecoration: 'none', alignSelf: 'flex-start' }}>
        <Icon name="arrowLeft" size={16} stroke={2.2} />{t('yc.np.d.back')}
      </Link>
      {q.isError ? <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />
        : !d ? <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}><Skel h={40} w={360} /><Skel h={160} r={24} /><Skel h={260} r={24} /></div>
          : !plan || !d.event ? <NoPlan eventId={id ?? ''} T={T} />
            : <>
              <Header d={d} plan={plan} T={T} />
              {plan.status === 'setup' ? <Setup d={d} plan={plan} T={T} /> : <Follow d={d} plan={plan} T={T} />}
            </>}
    </main>
  );
}

function NoPlan({ eventId, T }: { eventId: string; T: T }) {
  const { t } = T;
  return (
    <section style={card}>
      <span style={muted}>{t('yc.np.d.none')}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <PillButton tone="dark" to={`${CRM_ROUTES.nights}?e=${encodeURIComponent(eventId)}&v=target`}>{t('yc.np.d.goTarget')}</PillButton>
        <PillButton to={CRM_ROUTES.nightPlan(eventId)}>{t('yc.np.d.report')}</PillButton>
      </div>
    </section>
  );
}

function statusTone(s: Plan['status']) {
  return s === 'active' ? 'live' : s === 'setup' ? 'todo' : s === 'paused' ? 'warn' : 'done';
}

function Header({ d, plan, T }: { d: NightPlanState; plan: Plan; T: T }) {
  const { t, dLong, time } = T;
  const ev = d.event!;
  return (
    <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px 20px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        <MonoLabel>{t('yc.np.m.eyebrow')}</MonoLabel>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(26px,4vw,36px)', letterSpacing: '-.035em', lineHeight: 1.05, overflowWrap: 'anywhere' }}>{ev.title}</h1>
        <span style={muted}>{dLong(ev.start_at)} · {time(ev.start_at)}</span>
      </div>
      <Badge tone={statusTone(plan.status)}>{plan.status === 'setup' ? t('yc.np.s.setup') : t(`yc.np.st.${plan.status}`)}</Badge>
    </header>
  );
}

// ── Préparation ─────────────────────────────────────────────────────────────

function Setup({ d, plan, T }: { d: NightPlanState; plan: Plan; T: T }) {
  const { t, tp, n } = T;
  const left = plan.campaigns.filter((c) => !c.reviewed).length;
  const [back, setBack] = useState(false);
  const step = left === 0 && !back ? 3 : 2;
  // Dès que le dernier e-mail est relu, l'étape « Programmer » s'ouvre seule.
  useEffect(() => { if (left > 0) setBack(false); }, [left]);
  return (
    <>
      <Stepper step={step} T={T} />
      {step === 2 ? (
        <section style={card}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: '1 1 380px' }}>
              <h2 style={h2}>{t('yc.np.s.2t')}</h2>
              <span style={muted}>{t('yc.np.s.2s')}</span>
            </div>
            {plan.campaigns.length > 1 && (
              <AskMyAiButton need="drafts" text={t('yc.np.ai.all', {
                n: plan.campaigns.length, t: d.event?.title ?? '',
                list: plan.campaigns.map((c) => `« ${c.name} », id ${c.id}`).join(' ; '),
              })} />
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
            {plan.campaigns.map((c) => <DesignCard key={c.id} c={c} plan={plan} title={d.event?.title ?? ''} T={T} />)}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ ...muted, fontSize: 13.5 }}>{t('yc.np.s.watch')}</span>
            {left > 0
              ? <span style={{ fontSize: 14, fontWeight: 600 }}>{tp('yc.np.s.left', left, { n: n(left) })}</span>
              : <PillButton tone="dark" onClick={() => setBack(false)}>{t('yc.np.s.next')}</PillButton>}
          </div>
        </section>
      ) : (
        <ScheduleStep d={d} plan={plan} T={T} onBack={() => setBack(true)} />
      )}
      <CancelSetup plan={plan} T={T} />
    </>
  );
}

function Stepper({ step, T }: { step: number; T: T }) {
  const { t } = T;
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
      {[1, 2, 3].map((k) => {
        const done = k < step;
        const on = k === step;
        return (
          <li key={k} aria-current={on ? 'step' : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ height: 4, borderRadius: 99, background: done || on ? 'var(--ink)' : 'var(--sand-200)' }} />
            <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.np.s.step', { n: k })}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14.5, fontWeight: on ? 700 : 600, color: done || on ? 'var(--ink)' : 'var(--sand-500)' }}>
              {done && <Icon name="check" size={15} stroke={2.6} />}{t(`yc.np.s.${k}`)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function DesignCard({ c, plan, title, T }: { c: PlanCampaign; plan: Plan; title: string; T: T }) {
  const { t, dWeek, time } = T;
  const caps = useCrmCaps();
  const { qk } = useCrmScope();
  const qc = useQueryClient();
  const review = useReviewPlanCampaign();
  const kept = (plan.config.reviewed ?? []).includes(c.id);
  // Une retouche (Studio, IA) change updated_at : la vignette se redessine.
  useEffect(() => { qc.invalidateQueries({ queryKey: ['crm', qk, 'emails', 'html-row', c.id] }); }, [c.updated_at, c.id, qc, qk]);
  const state = c.edited_by === 'ai' ? t('yc.np.s.byAi', { who: c.ai_author || 'Claude' })
    : c.edited_by === 'hand' ? t('yc.np.s.byHand') : kept ? t('yc.np.s.kept') : t('yc.np.s.todo');
  return (
    <article style={{ display: 'flex', flexDirection: 'column', borderRadius: 20, overflow: 'hidden', boxShadow: `inset 0 0 0 ${c.reviewed ? 1 : 2}px ${c.reviewed ? 'var(--sand-200)' : 'var(--ink)'}`, background: '#fff' }}>
      <EmailThumb id={c.id} subject={c.subject} height={170} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 14 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{t(`yc.tgt.aud.${c.audience}.name`)}</span>
          <Badge tone={c.reviewed ? 'done' : 'todo'}>{state}</Badge>
        </span>
        <span style={{ fontSize: 13.5, color: 'var(--sand-700)', overflowWrap: 'anywhere' }}>{c.subject}</span>
        {c.scheduled_at && <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.np.s.planned', { d: `${dWeek(c.scheduled_at)} · ${time(c.scheduled_at)}` })}</span>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 4 }}>
          <PillButton size="sm" tone="dark" to={CRM_ROUTES.emailStudio(c.id)} disabled={!caps.write}>{t('yc.np.s.studio')}</PillButton>
          <AskMyAiButton size="sm" need="drafts" text={t('yc.np.ai.one', { name: c.name, id: c.id, t: title })} />
          {!c.edited_by && (
            <PillButton size="sm" tone="ghost" disabled={!caps.write || review.isPending}
              onClick={() => review.mutate({ planId: plan.id, campaignId: c.id, reviewed: !kept })}>
              {kept ? t('yc.np.s.undo') : t('yc.np.s.keep')}
            </PillButton>
          )}
        </div>
      </div>
    </article>
  );
}

function ScheduleStep({ d, plan, T, onBack }: { d: NightPlanState; plan: Plan; T: T; onBack: () => void }) {
  const { t, tp, n, dWeek, time } = T;
  const caps = useCrmCaps();
  const toast = useCrmToast();
  const { space } = useCrmScope();
  const shell = useCrmShell();
  const autos = useAutomations('30d');
  const saveAuto = useSaveAutomation();
  const schedule = useScheduleNightPlan();
  const recipe = autos.data?.recipes.find((r) => r.kind === 'click_no_buy');
  const [relance, setRelance] = useState(true);
  const balance = shell.data?.wallet.balance ?? 0;
  const cost = plan.config.cost ?? 0;
  const demo = !!plan.config.demo;
  const short = !demo && balance < cost;
  const sends = useMemo(() => [...plan.campaigns].sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? '')), [plan.campaigns]);

  const go = async () => {
    try {
      const r = await schedule.mutateAsync({ planId: plan.id });
      if (!r.ok) {
        const k = ['sender_identity', 'yunits_short', 'support_session', 'too_late', 'not_setup'].includes(r.error ?? '') ? r.error : 'other';
        toast(t(`yc.np.err.${k}`));
        return;
      }
      if (relance && recipe && !recipe.enabled && !demo) {
        try {
          const tpl = recipe.template_id ?? await createAutomationTemplate({
            kind: 'click_no_buy', venueId: space.venueId, organizerUserId: space.venueId ? null : space.organizerUserId,
            venueName: space.name, lang: T.lang, t,
          });
          await saveAuto.mutateAsync({ kind: 'click_no_buy', enabled: true, templateId: tpl });
        } catch { toast(t('yc.au.t.err')); }
      }
      toast(demo ? t('yc.np.s.doneDemo') : t('yc.np.s.done', { n: n(r.scheduled ?? 0) }));
    } catch { toast(t('yc.np.err.other')); }
  };

  const guards: string[] = [
    t('yc.np.m.g.holder'),
    tp('yc.np.m.g.cap', plan.cap, { n: n(plan.cap) }),
    t('yc.np.m.g.spacing'),
    t('yc.np.m.g.yuno'),
    ...((d.holdout_pct ?? 0) > 0 ? [t('yc.np.m.g.holdout', { n: n(d.holdout_pct ?? 0) })] : []),
    ...(plan.campaigns.some((c) => c.audience === 'last_minute') ? [t('yc.np.m.g.lastcall')] : []),
  ];

  return (
    <section style={card}>
      <h2 style={h2}>{t('yc.np.s.3t')}</h2>
      <SenderIdentityNotice />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {sends.map((c, i) => (
          <div key={c.id} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '2px 12px', padding: '10px 0', borderTop: i ? '1px solid var(--sand-100)' : 0 }}>
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>{t(`yc.tgt.aud.${c.audience}.name`)}</span>
            <span style={{ fontSize: 14, color: 'var(--sand-600)', fontVariantNumeric: 'tabular-nums' }}>
              {c.scheduled_at ? `${dWeek(c.scheduled_at)} · ${time(c.scheduled_at)}` : '—'}
            </span>
          </div>
        ))}
      </div>
      <span style={{ ...muted, fontSize: 13.5 }}>{t('yc.np.m.first')}</span>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 16px', borderRadius: 16, background: 'var(--sand-50)' }}>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{t('yc.np.m.guard')}</span>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-700)' }}>
          {guards.map((g) => <li key={g}>{g}</li>)}
        </ul>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>{t('yc.np.m.relance')}</span>
          <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.np.m.relanceS')}</span>
        </div>
        {recipe?.enabled
          ? <Badge tone="done">{t('yc.np.m.relanceOn')}</Badge>
          : <Switch on={relance} onChange={setRelance} label={t('yc.np.m.relance')} disabled={!caps.write} />}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 14.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{t('yc.np.m.cost', { n: n(cost), b: n(balance) })}</span>
        <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.np.m.costS')}</span>
        {short && <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--amber-700)' }}>{t('yc.np.m.short', { n: n(cost - balance) })}</span>}
        {demo && <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{t('yc.np.m.demo')}</span>}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
        <PillButton tone="ghost" onClick={onBack}>{t('yc.np.s.back')}</PillButton>
        <div style={{ display: 'flex', gap: 8 }}>
          {short && <PillButton to={CRM_ROUTES.yunits}>{t('yc.cli.msg.recharge')}</PillButton>}
          <PillButton tone="dark" onClick={go} disabled={!caps.write || schedule.isPending || short}>
            {schedule.isPending ? t('yc.np.s.scheduling') : t('yc.np.s.schedule')}
          </PillButton>
        </div>
      </div>
    </section>
  );
}

function CancelSetup({ plan, T }: { plan: Plan; T: T }) {
  const { t } = T;
  const caps = useCrmCaps();
  const set = useSetNightPlanStatus();
  const [ask, setAsk] = useState(false);
  if (!caps.write) return null;
  return (
    <>
      <button type="button" onClick={() => setAsk(true)} style={{ alignSelf: 'flex-start', background: 'none', border: 0, padding: 0, fontSize: 14, fontWeight: 600, color: 'var(--sand-600)', cursor: 'pointer' }}>
        {t('yc.np.s.cancel')}
      </button>
      <Confirm open={ask} text={t('yc.np.s.cancelQ')} yes={t('yc.np.s.cancel')} T={T}
        onClose={() => setAsk(false)} onYes={() => { set.mutate({ planId: plan.id, status: 'stopped' }); setAsk(false); }} />
    </>
  );
}

function Confirm({ open, text, yes, onYes, onClose, T }: { open: boolean; text: string; yes: string; onYes: () => void; onClose: () => void; T: T }) {
  return (
    <Modal open={open} onClose={onClose} width={440} label={yes}>
      <div style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <span style={{ fontSize: 15, lineHeight: 1.5 }}>{text}</span>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <PillButton tone="ghost" onClick={onClose}>{T.t('yc.common.cancel')}</PillButton>
          <PillButton tone="danger" onClick={onYes}>{yes}</PillButton>
        </div>
      </div>
    </Modal>
  );
}

// ── Suivi ───────────────────────────────────────────────────────────────────

function Follow({ d, plan, T }: { d: NightPlanState; plan: Plan; T: T }) {
  const { t, tp, n } = T;
  const caps = useCrmCaps();
  const set = useSetNightPlanStatus();
  const [ask, setAsk] = useState(false);
  const live = plan.status === 'active' || plan.status === 'paused';
  const sent = plan.campaigns.reduce((s0, c) => s0 + c.sent, 0);
  const pending = plan.campaigns.filter((c) => c.status === 'scheduled').length;
  const done = !!d.event && new Date(d.event.start_at).getTime() < Date.now();
  const v = holdoutVerdict({ done, contacted: plan.contacted, control: plan.control, z: plan.measure?.z ?? null });
  const group = (b: number, total: number, who: string) => tp('yc.hold.res.buyers', b, { b: n(b), n: n(total), who: t(who) });
  return (
    <>
      <section style={card}>
        <span style={{ fontSize: 16, lineHeight: 1.5, fontWeight: 500 }}>{t('yc.np.d.line', { s: n(sent), p: n(pending), b: n(plan.contacted.buyers) })}</span>
        {plan.stop_reason && <span style={muted}>{t(`yc.np.stop.${plan.stop_reason}`)}</span>}
        {live && caps.write && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {plan.status === 'active'
              ? <PillButton size="sm" onClick={() => set.mutate({ planId: plan.id, status: 'paused' })} disabled={set.isPending}>{t('yc.np.d.pause')}</PillButton>
              : <PillButton size="sm" tone="dark" onClick={() => set.mutate({ planId: plan.id, status: 'active' })} disabled={set.isPending}>{t('yc.np.d.resume')}</PillButton>}
            <PillButton size="sm" tone="ghost" onClick={() => setAsk(true)}>{t('yc.np.d.stop')}</PillButton>
            <PillButton size="sm" tone="ghost" to={CRM_ROUTES.nightPlan(d.event!.id)}>{t('yc.np.d.report')}</PillButton>
          </div>
        )}
        <Confirm open={ask} text={t('yc.np.d.stopQ')} yes={t('yc.np.d.stop')} T={T}
          onClose={() => setAsk(false)} onYes={() => { set.mutate({ planId: plan.id, status: 'stopped' }); setAsk(false); }} />
      </section>

      <section style={card}>
        <h2 style={h2}>{t('yc.np.d.sends')}</h2>
        {plan.config.demo && <span style={muted}>{t('yc.np.m.demo')}</span>}
        {plan.campaigns.map((c, i) => <SendRow key={c.id} c={c} first={i === 0} live={live && !plan.config.demo} T={T} />)}
      </section>

      {(plan.contacted.n > 0 || plan.control.n > 0) && (
        <section style={card}>
          <h2 style={h2}>{t('yc.np.m.t')}</h2>
          <span style={muted}>{t('yc.np.m.s')}</span>
          <span style={{ fontSize: 14.5, fontVariantNumeric: 'tabular-nums' }}>
            {group(plan.contacted.buyers, plan.contacted.n, 'yc.hold.res.contacted')} · {group(plan.control.buyers, plan.control.n, 'yc.hold.res.control')}
          </span>
          <span style={{ fontSize: 14.5, fontWeight: v === 'gain' || v === 'loss' ? 600 : 500, color: v === 'gain' ? 'var(--green-700)' : v === 'loss' ? 'var(--amber-700)' : 'var(--sand-600)' }}>
            {t(`yc.hold.res.v.${v}`, { x: n(Math.round(plan.measure?.extra ?? 0)) })}
          </span>
        </section>
      )}
    </>
  );
}

function SendRow({ c, first, live, T }: { c: PlanCampaign; first: boolean; live: boolean; T: T }) {
  const { t, n, dWeek, time } = T;
  const caps = useCrmCaps();
  const toast = useCrmToast();
  const edit = usePlanCampaignEdit();
  const [moving, setMoving] = useState(false);
  const [at, setAt] = useState(() => toLocalInput(c.scheduled_at));
  const st = c.status === 'scheduled' ? t('yc.np.c.st.scheduled', { d: c.scheduled_at ? `${dWeek(c.scheduled_at)} · ${time(c.scheduled_at)}` : '' })
    : c.status === 'sent' ? t('yc.np.c.st.sent', { d: c.sent_at ? `${dWeek(c.sent_at)} · ${time(c.sent_at)}` : '' })
      : t(`yc.np.c.st.${['sending', 'draft', 'paused', 'failed'].includes(c.status) ? c.status : 'draft'}`);
  const prot = groupProtected(c.protected);
  const protList = Object.entries(prot).filter(([, v]) => v > 0).map(([k, v]) => t(`yc.np.pr.${k}`, { n: n(v) })).join(', ');
  const run = (p: { at?: string; hold?: boolean }) => edit.mutate({ id: c.id, ...p }, {
    onSuccess: () => { toast(t('yc.np.saved')); setMoving(false); },
    onError: () => toast(t('yc.np.c.tooLate')),
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: first ? 0 : 12, borderTop: first ? 0 : '1px solid var(--sand-100)' }}>
      <span style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '2px 10px' }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{t(`yc.tgt.aud.${c.audience}.name`)}</span>
        <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{st}</span>
      </span>
      <span style={{ fontSize: 13.5, color: 'var(--sand-700)', overflowWrap: 'anywhere' }}>{c.subject}</span>
      {c.paused_reason === 'night_plan_late' && <span style={{ fontSize: 13.5, color: 'var(--amber-700)' }}>{t('yc.np.c.late')}</span>}
      {(c.sent > 0 || c.status === 'sending') && (
        <span style={{ fontSize: 13.5, fontVariantNumeric: 'tabular-nums' }}>{t('yc.np.c.stats', { s: n(c.sent), o: n(c.opened), c: n(c.clicked), b: n(c.buyers) })}</span>
      )}
      {c.holdout > 0 && <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.np.c.holdout', { n: n(c.holdout) })}</span>}
      {protList && <span style={{ fontSize: 13, color: 'var(--sand-500)', textWrap: 'pretty' }}>{t('yc.np.c.protected', { list: protList })}</span>}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingTop: 4 }}>
        {(c.status === 'scheduled' || c.status === 'draft') && live && caps.write && (
          <>
            <PillButton size="sm" to={CRM_ROUTES.emailStudio(c.id)}>{t('yc.np.c.edit')}</PillButton>
            <PillButton size="sm" tone="ghost" onClick={() => setMoving((m) => !m)}>{t('yc.np.c.move')}</PillButton>
            {c.status === 'scheduled'
              ? <PillButton size="sm" tone="ghost" onClick={() => run({ hold: true })} disabled={edit.isPending}>{t('yc.np.c.hold')}</PillButton>
              : c.scheduled_at && <PillButton size="sm" tone="ghost" onClick={() => run({ at: c.scheduled_at as string })} disabled={edit.isPending}>{t('yc.np.c.reschedule')}</PillButton>}
          </>
        )}
        {(c.status === 'sent' || c.status === 'sending') && <PillButton size="sm" tone="ghost" to={CRM_ROUTES.emailResults(c.id)}>{t('yc.np.c.results')}</PillButton>}
      </div>
      {moving && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)}
            style={{ height: 36, padding: '0 10px', borderRadius: 10, border: '1px solid var(--sand-200)', fontSize: 14 }} />
          <PillButton size="sm" tone="dark" disabled={!at || edit.isPending} onClick={() => run({ at: new Date(at).toISOString() })}>{t('yc.np.c.save')}</PillButton>
        </div>
      )}
    </div>
  );
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
