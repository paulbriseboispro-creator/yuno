/**
 * Tiroir d'une soirée à venir › « Qui cibler » (RPC crm_night_targets,
 * migration 20261011110000). Les audiences de personnes SANS place, chacune
 * avec sa taille, ses joignables, le statut de la famille d'hypothèses qui la
 * porte, le moment et l'angle conseillés. « Leur écrire » ouvre WriteModal sur
 * le filtre `ntgt` (même porte serveur que les chiffres), la soirée reliée.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, PillButton, Skel } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps, useCrmScope } from '@/crm/scope';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { WriteModal } from '@/crm/components/WriteModal';
import { HoldoutResults } from '@/crm/components/HoldoutResults';
import { StatusBadge } from '@/crm/components/analysis/HypBits';
import { familyKind } from '@/crm/lib/analysis';
import type { AnFamily } from '@/crm/lib/analysis';
import { useNightTargets } from '@/crm/data/analysis';
import type { NightTargetAudience, NightTargets as Targets } from '@/crm/data/analysis';
import { useSaveSegment } from '@/crm/data/clients';
import type { ClientFilterDef } from '@/crm/data/clients';
import { targetRuleText } from './targetText';
import { useLaunchNightPlan, useNightPlanState, launchContent } from '@/crm/data/nightPlans';
import { toTemplateNight, useTemplateDraft } from '@/crm/pages/emails/templateDraft';
import { buildCrmTemplate } from '@/crm/lib/emailTemplates';
import { templateFor } from '@/crm/lib/nightPlan';
import { useNightPlan } from '@/crm/data/plan';

type T = ReturnType<typeof useCrmT>;


export function NightTargets({ eventId }: { eventId: string }) {
  const T = useCrmT();
  const q = useNightTargets(eventId);
  const d = q.data;
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 20px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {q.isError ? <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />
        : !d ? <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}><Skel h={28} w={240} /><Skel h={120} r={16} /><Skel h={120} r={16} /></div>
          : !d.ok ? <Note text={T.t(d.error === 'not_upcoming' ? 'yc.tgt.notUpcoming' : 'yc.ni.dr.notFound')} />
            : <Body d={d} T={T} />}
    </div>
  );
}

function Note({ text }: { text: string }) {
  return <span style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{text}</span>;
}

function Body({ d, T }: { d: Targets; T: T }) {
  const { t, n } = T;
  const auds = (d.audiences ?? []).filter((a) => a.n > 0);
  const eventId = d.event?.id ?? null;
  const planQ = useNightPlanState(eventId);
  const livePlan = planQ.data?.plan && ['setup', 'active', 'paused'].includes(planQ.data.plan.status) ? planQ.data.plan : null;
  // Plans de soirée : les envois gardés (tous ceux qui ont quelqu'un à qui écrire, d'office).
  const writable = auds.filter((a) => a.email > 0);
  const [dropped, setDropped] = useState<Set<string>>(() => new Set());
  const kept = writable.filter((a) => !dropped.has(a.key));
  const toggleKeep = (key: string) => setDropped((s0) => { const s1 = new Set(s0); if (s1.has(key)) s1.delete(key); else s1.add(key); return s1; });
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(22px,3vw,28px)', lineHeight: 1.1, letterSpacing: '-.03em' }}>{t('yc.tgt.title')}</h2>
        <span style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.tgt.sub')}</span>
        {d.event?.id && d.computed && (
          <div style={{ paddingTop: 6 }}>
            <PillButton tone="dark" size="sm" icon="calendar" to={CRM_ROUTES.nightPlan(d.event.id)}>{t('yc.ag.plan.open')}</PillButton>
          </div>
        )}
      </div>
      {livePlan && eventId && <LivePlanBanner eventId={eventId} plan={livePlan} T={T} />}
      {!d.computed ? <Note text={t('yc.tgt.notComputed')} />
        : auds.length === 0 ? <Note text={t('yc.tgt.empty')} />
          : (
            <>
              {d.union && (
                <div style={{ padding: '14px 16px', borderRadius: 16, background: 'var(--sand-50)', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
                  <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{t('yc.tgt.union', { n: n(d.union.n), e: n(d.union.email), s: n(d.union.sms) })}</span>
                  {d.score?.status === 'ok' && d.score.expected !== undefined && (
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{t('yc.sc.expAll', { n: n(d.score.expected), p: n(d.score.people ?? 0) })}</span>
                  )}
                  {d.score?.projection && (
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {t('yc.sc.proj', { n: n(d.score.projection.total), lo: n(d.score.projection.low), hi: n(d.score.projection.high) })}
                    </span>
                  )}
                  {(d.score?.status === 'weak' || d.score?.status === 'insufficient') && (
                    <span style={{ color: 'var(--sand-600)' }}>{t(`yc.sc.st.${d.score.status}`)}</span>
                  )}
                  {(d.has_ticket ?? 0) > 0 && <span style={{ color: 'var(--sand-600)' }}>{t('yc.tgt.hasTicket', { n: n(d.has_ticket ?? 0) })}</span>}
                </div>
              )}
              {auds.length > 1 && auds.some((a) => a.order) && <Note text={t('yc.tgt.orderHint')} />}
              {auds.map((a) => (
                <AudienceCard key={a.key} a={a} d={d} T={T}
                  keep={livePlan || a.email === 0 ? undefined : { on: !dropped.has(a.key), toggle: () => toggleKeep(a.key) }} />
              ))}
              {!livePlan && !planQ.isLoading && writable.length > 0 && eventId && <PrepareBar eventId={eventId} kept={kept} T={T} />}
            </>
          )}
      {d.event?.id && <HoldoutResults eventId={d.event.id} />}
    </>
  );
}

/** Un plan existe pour la soirée : on y mène, on ne propose pas d'en refaire un. */
function LivePlanBanner({ eventId, plan, T }: { eventId: string; plan: NonNullable<NonNullable<ReturnType<typeof useNightPlanState>['data']>['plan']>; T: T }) {
  const { t, dWeek, time } = T;
  const next = plan.campaigns.filter((c) => c.status === 'scheduled' && c.scheduled_at).map((c) => c.scheduled_at as string).sort()[0];
  const line = plan.status === 'setup' ? t('yc.np.s.setup')
    : plan.status === 'paused' ? t('yc.np.live.paused')
      : next ? t('yc.np.live.next', { d: `${dWeek(next)} · ${time(next)}` }) : t('yc.np.live.none');
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '14px 16px', borderRadius: 16, background: 'var(--ink)', color: '#fff' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{t('yc.np.live.t')}</span>
        <span style={{ fontSize: 13.5, opacity: 0.78 }}>{line}</span>
      </div>
      <PillButton size="sm" to={CRM_ROUTES.plan(eventId)}>{t('yc.np.live.open')}</PillButton>
    </div>
  );
}

/** La barre du bas : ce que l'on garde, puis « Préparer ces envois » (étape 1 → 2). */
function PrepareBar({ eventId, kept, T }: { eventId: string; kept: NightTargetAudience[]; T: T }) {
  const { t, tp, n } = T;
  const caps = useCrmCaps();
  const toast = useCrmToast();
  const nav = useNavigate();
  const { space } = useCrmScope();
  const td = useTemplateDraft(eventId);
  const launch = useLaunchNightPlan();
  // Chaque personne une fois, dans sa meilleure audience (crm_night_plan.first_email).
  const plan = useNightPlan(eventId);
  const reach = useMemo(() => {
    const first = new Map<string, number>();
    for (const st of plan.data?.steps ?? []) for (const x of st.audiences) first.set(x.key, x.first_email);
    return kept.reduce((s0, a) => s0 + (first.get(a.key) ?? a.email), 0);
  }, [kept, plan.data]);
  const go = async () => {
    if (!kept.length || !td.ready) return;
    const contents: Record<string, unknown> = {};
    for (const a of kept) {
      const kind = templateFor(a.key);
      const label = t(`yc.tgt.aud.${a.key}.name`);
      const title = td.night?.title ?? '';
      // Tout modèle de la Console, ceux des recettes compris (« retour », « dernier appel »).
      const content = buildCrmTemplate(kind, {
        venueName: space.name, lang: T.lang, t, night: toTemplateNight(td.night), second: toTemplateNight(td.second), last: toTemplateNight(td.last),
      });
      contents[a.key] = launchContent(content, `${label}${title ? ` · ${title}` : ''}`.slice(0, 200), label, kind);
    }
    try {
      const r = await launch.mutateAsync({ eventId, audiences: kept.map((a) => a.key), contents });
      if (!r.ok) {
        if (r.error === 'plan_exists') { nav(CRM_ROUTES.plan(eventId)); return; }
        toast(t(`yc.np.err.${r.error && ['support_session', 'no_audience'].includes(r.error) ? r.error : 'other'}`));
        return;
      }
      nav(CRM_ROUTES.plan(eventId));
    } catch (e) {
      toast(t(String((e as Error)?.message ?? '').includes('too_late') ? 'yc.np.err.too_late' : 'yc.np.err.other'));
    }
  };
  return (
    <div style={{ position: 'sticky', bottom: 0, zIndex: 2, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px', borderRadius: 18, background: '#fff', boxShadow: 'var(--shadow-md), 0 0 0 1px var(--sand-200)' }}>
      <span style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {kept.length ? tp('yc.np.bar', kept.length, { n: n(kept.length), e: n(reach) }) : t('yc.np.bar.none')}
      </span>
      <PillButton tone="dark" onClick={go} disabled={!kept.length || !caps.write || launch.isPending || !td.ready}>
        {launch.isPending ? t('yc.np.m.launching') : t('yc.np.prepare')}
      </PillButton>
    </div>
  );
}

/** « 1er envoi », « 2e envoi »… (ordre conseillé, décision de Paul du 08/10). */
function orderLabel(k: number, T: T): string {
  return k <= 3 ? T.t(`yc.tgt.order.${k}`) : T.t('yc.tgt.order.n', { n: T.n(k) });
}

function AudienceCard({ a, d, T, keep }: { a: NightTargetAudience; d: Targets; T: T; keep?: { on: boolean; toggle: () => void } }) {
  const { t, tp, n, dShort, time } = T;
  const caps = useCrmCaps();
  const toast = useCrmToast();
  const save = useSaveSegment();
  const [writing, setWriting] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const eventId = d.event?.id ?? '';
  const def: ClientFilterDef = { seg: 'all', f: { ntgt: { e: eventId, a: a.key } } };
  const name = t(`yc.tgt.aud.${a.key}.name`);
  const when = a.moment === 'now' ? t('yc.tgt.when.now') : t(`yc.tgt.when.${a.moment}`, { d: `${dShort(a.send_at)} · ${time(a.send_at)}` });
  const fam = a.family as AnFamily | undefined;

  const saveSegment = () => {
    const series = d.event?.series ?? d.event?.title ?? '';
    save.mutate(
      { name: t('yc.tgt.segName', { s: series }), definition: def, template: `concept_no_ticket:${eventId}` },
      {
        onSuccess: (r) => { setSavedId(r.id); toast(t('yc.tgt.saved')); },
        onError: () => toast(t('yc.set.err.failed')),
      },
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 18, borderRadius: 20, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          {a.order !== undefined && <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--sand-500)' }}>{orderLabel(a.order, T)}</span>}
          <span style={{ fontSize: 16, fontWeight: 600 }}>{name}</span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em', lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>
            {tp('yc.tgt.people', a.n, { n: n(a.n) })}
            {(a.order ?? 1) > 1 && a.new_n !== undefined && a.new_n < a.n && (
              <span style={{ fontFamily: 'var(--font-body, inherit)', fontSize: 14, fontWeight: 500, letterSpacing: 0, color: 'var(--sand-600)' }}> {tp('yc.tgt.newOf', a.new_n, { n: n(a.new_n) })}</span>
            )}
          </span>
          {a.expected !== null && a.expected !== undefined && (
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--red-700)', fontVariantNumeric: 'tabular-nums' }}>{t('yc.sc.exp', { n: n(a.expected) })}</span>
          )}
          {a.overlap && (
            <span style={{ fontSize: 13.5, color: 'var(--sand-600)', fontVariantNumeric: 'tabular-nums' }}>
              {t('yc.tgt.overlap', { p: n(a.overlap.pct), a: t(`yc.tgt.aud.${a.overlap.key}.name`) })}
            </span>
          )}
        </div>
        {fam
          ? <StatusBadge f={{ status: a.status ?? null, availability: a.availability ?? null, kind: familyKind(fam) }} T={T} />
          : a.key === 'likely'
            ? <Badge tone="warn">{t('yc.sc.estimate')}</Badge>
            : <span style={{ fontSize: 12.5, color: 'var(--sand-500)', maxWidth: 220, textAlign: 'right' }}>{t('yc.tgt.noFamily')}</span>}
      </div>
      <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--sand-700)', textWrap: 'pretty' }}>{targetRuleText(a, T)}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 13.5, color: 'var(--sand-600)' }}>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{t('yc.tgt.reach', { e: n(a.email), s: n(a.sms) })}</span>
        <span>{when}</span>
        <span>{t(`yc.tgt.angle.${a.key}`)}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingTop: 4 }}>
        {keep && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginRight: 'auto', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            <input type="checkbox" checked={keep.on} onChange={keep.toggle} disabled={!caps.write} style={{ width: 18, height: 18, accentColor: 'var(--ink)' }} />
            {t('yc.np.keep')}
          </label>
        )}
        <PillButton tone={keep ? 'light' : 'dark'} onClick={() => setWriting(true)} disabled={!caps.write}>{t('yc.tgt.write')}</PillButton>
        {a.key === 'concept' && !savedId && caps.write && (
          <PillButton tone="ghost" onClick={saveSegment} disabled={save.isPending}>{t('yc.tgt.save')}</PillButton>
        )}
        {savedId && (
          <Link to={`${CRM_ROUTES.clients}?seg=${savedId}`} style={{ alignSelf: 'center', fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{t('yc.tgt.see')}</Link>
        )}
      </div>
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
