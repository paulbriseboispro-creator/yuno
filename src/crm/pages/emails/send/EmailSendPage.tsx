/**
 * E-mails › Envoi (maquette « Email Envoi ») : Audience, Planification,
 * Vérification, puis confirmation, envoi en direct et écran de fin.
 *
 * L'audience vise la base clients du CRM (audiences {kind:'crm'}, résolues à
 * l'envoi par _crm_campaign_audience) ; le nombre affiché vient de la même
 * règle (crm_email_audience_preview). Chaque réglage s'enregistre sur la
 * campagne (brouillon) ; rien ne part sans « Envoyer » confirmé.
 *
 * « Maintenant » appelle send-campaign (mise en file, débit des Yunits,
 * première tranche) puis suit la progression réelle. « Programmer » passe la
 * campagne en `scheduled` : le cron l'envoie à l'heure dite.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { isDemoEmail } from '@/lib/demoPlan';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Rich } from '@/crm/ui/Rich';
import { Modal } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { EASE, SPRING } from '@/crm/ui/motion';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps, useCrmScope } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { useCrmShell } from '@/crm/data/shell';
import { useNights } from '@/crm/data/nights';
import { useAudiencePreview, useEmailAnalysis, useInvalidateEmails, useSendOptions, type CrmAudience } from '@/crm/data/emails';
import { unscheduleCampaign } from '@/crm/data/emailActions';
import { bestSlots, effectiveSendAt, sendChecks, verdict, waveMinutesOf, waveThrottle } from '@/crm/lib/emailSend';
import { normalizeV2Blocks } from '@/lib/email/migrate';
import type { EmailBlock } from '@/lib/email/types';
import { AudienceStep } from './AudienceStep';
import { PlanStep, type PlanState } from './PlanStep';
import { CheckStep } from './CheckStep';
import { SendAside } from './SendAside';

type Step = 'aud' | 'plan' | 'check';
const STEPS: Step[] = ['aud', 'plan', 'check'];
const EDITABLE = ['draft', 'scheduled'];
const two = (v: number) => String(v).padStart(2, '0');

interface Row {
  id: string; name: string; status: string; subject: string | null; subject_b: string | null; ab_enabled: boolean | null;
  ab_split_pct: number | null; ab_window_minutes: number | null; preheader: string | null; blocks_json: unknown;
  event_id: string | null; audiences_json: unknown; exclusions_json: unknown; scheduled_at: string | null;
  throttle_per_hour: number | null; throttle_window_minutes: number | null; quiet_hours: boolean | null;
  venue_id: string | null; organizer_user_id: string | null; total_recipients: number | null;
}

interface Draft {
  id: string; name: string; status: string; subject: string; abOn: boolean; abPct: number; abHours: number;
  preheader: string; blocks: EmailBlock[]; eventId: string | null; audiences: CrmAudience[];
  recentDays: number; excludeBuyers: boolean; plan: PlanState;
}

/** Créneau proposé par défaut : demain 10 h (ou le prochain meilleur jour). */
function defaultSlot(bestDays: number[], bestHour: number | undefined): { date: string; time: string } {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  for (let i = 0; i < 7 && bestDays.length; i++) {
    if (bestDays.includes((d.getDay() + 6) % 7)) break;
    d.setDate(d.getDate() + 1);
  }
  return { date: `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`, time: `${two(bestHour ?? 10)}:00` };
}

function rowToDraft(r: Row): Draft {
  const excl = (r.exclusions_json && typeof r.exclusions_json === 'object' ? r.exclusions_json : {}) as { recentDays?: number; excludeEventBuyers?: boolean };
  const aud = (Array.isArray(r.audiences_json) ? r.audiences_json : []).filter((a): a is CrmAudience => !!a && (a as CrmAudience).kind === 'crm');
  const sched = r.scheduled_at ? new Date(r.scheduled_at) : null;
  const slot = sched ? { date: `${sched.getFullYear()}-${two(sched.getMonth() + 1)}-${two(sched.getDate())}`, time: `${two(sched.getHours())}:${two(Math.floor(sched.getMinutes() / 15) * 15)}` } : defaultSlot([], undefined);
  return {
    id: r.id, name: r.name, status: r.status, subject: r.subject === '—' ? '' : r.subject ?? '', abOn: !!r.ab_enabled && !!(r.subject_b ?? '').trim(),
    abPct: r.ab_split_pct ?? 20, abHours: Math.round((r.ab_window_minutes ?? 240) / 60), preheader: r.preheader ?? '',
    blocks: normalizeV2Blocks(r.blocks_json), eventId: r.event_id, audiences: aud,
    recentDays: typeof excl.recentDays === 'number' ? excl.recentDays : 0, excludeBuyers: !!excl.excludeEventBuyers,
    plan: {
      mode: sched ? 'later' : 'later', date: slot.date, time: slot.time,
      wave: r.throttle_per_hour != null,
      waveMin: waveMinutesOf(r.throttle_per_hour, r.throttle_window_minutes, r.total_recipients ?? 0),
      quiet: r.quiet_hours ?? true,
    },
  };
}

export default function EmailSendPage() {
  const { id } = useParams<{ id: string }>();
  const { t, tp, n, dLong, dShort, time } = useCrmT();
  const nav = useNavigate();
  const toast = useCrmToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { space, qk } = useCrmScope();
  const invalidate = useInvalidateEmails();
  const [params, setParams] = useSearchParams();
  const step: Step = STEPS.includes(params.get('step') as Step) ? (params.get('step') as Step) : 'aud';
  const [draft, setDraft] = useState<Draft | null>(null);
  const [missing, setMissing] = useState(false);
  const [phase, setPhase] = useState<'edit' | 'sending' | 'done'>('edit');
  const [doneMode, setDoneMode] = useState<'now' | 'later'>('now');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ sent: 0, total: 0 });
  const shell = useCrmShell();
  const nights = useNights();
  const options = useSendOptions();
  const analysis = useEmailAnalysis();
  const best = useMemo(() => bestSlots(analysis.data?.grid), [analysis.data]);
  const readOnly = !useCrmCaps().write;
  const demo = isDemoEmail(user?.email);

  const go = (s: Step) => { setParams((p) => { const x = new URLSearchParams(p); x.set('step', s); return x; }, { replace: false }); window.scrollTo(0, 0); };

  // ── Chargement ───────────────────────────────────────────────────────────
  const env = useRef({ space, nav, toast, t });
  env.current = { space, nav, toast, t };
  const seeded = useRef(false);
  useEffect(() => {
    let off = false;
    (async () => {
      const { space: sp, nav: go2, toast: say, t: tt } = env.current;
      const { data, error } = await supabase.from('email_campaigns').select('*').eq('id', id!).maybeSingle();
      if (off) return;
      const r = data as Row | null;
      if (error || !r || (r.venue_id ?? null) !== sp.venueId || (r.organizer_user_id ?? null) !== sp.organizerUserId) { setMissing(true); return; }
      if (!EDITABLE.includes(r.status)) { say(tt('yc.em.st.sentRedirect')); go2(CRM_ROUTES.emailResults(r.id), { replace: true }); return; }
      setDraft(rowToDraft(r));
    })();
    return () => { off = true; };
  }, [id]);

  // Créneau proposé : le meilleur jour et la meilleure heure, une fois connus.
  useEffect(() => {
    if (!draft || seeded.current || !analysis.data) return;
    seeded.current = true;
    if (draft.status === 'scheduled') return;
    const slot = defaultSlot(best.days, best.hours[0]);
    setDraft((d) => (d ? { ...d, plan: { ...d.plan, ...slot } } : d));
  }, [draft, analysis.data, best]);

  const eventTitle = draft?.eventId ? nights.data?.nights.find((x) => x.id === draft.eventId)?.title ?? null : null;
  const preview = useAudiencePreview(draft?.audiences ?? [], draft?.eventId ?? null, draft?.recentDays ?? 0, !!draft?.excludeBuyers && !!draft?.eventId, draft?.id ?? null);
  const net = preview.data?.net ?? 0;
  const balance = shell.data?.wallet.balance ?? 0;
  const low = shell.data?.wallet.low_balance ?? 2000;

  // ── Enregistrement (brouillon) ───────────────────────────────────────────
  const payload = useCallback((d: Draft, nNet: number) => {
    const w = waveThrottle(nNet, d.plan.waveMin);
    return {
      audiences_json: d.audiences,
      audience_type: d.audiences.length ? 'imported_list' : null,
      exclusions_json: { recentDays: d.recentDays || null, excludeEventBuyers: d.excludeBuyers },
      quiet_hours: d.plan.quiet,
      throttle_per_hour: d.plan.wave ? w.perWindow : null,
      throttle_window_minutes: d.plan.wave ? w.window : 60,
      throttle_plan: d.plan.wave ? { mode: 'hour', days: 2, custom: true } : null,
    };
  }, []);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<{ d: Draft; n: number } | null>(null);
  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const cur = latest.current;
    if (!cur || readOnly) return true;
    const { data, error } = await supabase.from('email_campaigns').update(payload(cur.d, cur.n) as never).eq('id', cur.d.id).in('status', EDITABLE).select('id');
    if (error || !data?.length) return false;
    return true;
  }, [payload, readOnly]);
  const update = (patch: Partial<Draft> | ((d: Draft) => Partial<Draft>)) => {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, ...(typeof patch === 'function' ? patch(d) : patch) };
      latest.current = { d: next, n: net };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { void flush(); }, 700);
      return next;
    });
  };
  useEffect(() => () => { void flush(); }, [flush]);

  // ── Textes de date ──────────────────────────────────────────────────────
  const whenText = useCallback((d: Date) => t('yc.em.sd.when', { day: dLong(d), time: time(d) }), [t, dLong, time]);
  const relText = useCallback((d: Date) => {
    const ms = d.getTime() - Date.now();
    if (ms < 0) return t('yc.em.sd.rel.past');
    const h = Math.round(ms / 36e5);
    if (h < 1) return t('yc.em.sd.rel.soon');
    if (h < 24) return tp('yc.em.sd.rel.h', h);
    return tp('yc.em.sd.rel.d', Math.round(ms / 864e5));
  }, [t, tp]);

  if (missing) {
    return (
      <div className="yc yc-page-bg" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, maxWidth: 380 }}>
          <YunitFace mood="inquiet" size={60} />
          <b style={{ fontFamily: 'var(--font-display)', fontSize: 22 }}>{t('yc.em.st.notFound')}</b>
          <Hv as={Link} to={CRM_ROUTES.emailCampaigns} style={{ height: 44, padding: '0 20px', borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none' }} hover={{ color: '#fff' }}>{t('yc.em.st.back')}</Hv>
        </div>
      </div>
    );
  }
  if (!draft) return <div className="yc yc-page-bg" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><YunitFace mood="content" size={56} /></div>;

  const mode = draft.plan.mode;
  const chosen = new Date(`${draft.plan.date}T${draft.plan.time}:00`);
  const eff = effectiveSendAt(mode === 'now' ? new Date() : chosen, draft.plan.quiet);
  const past = mode === 'later' && chosen.getTime() <= Date.now();
  const checks = sendChecks({ subject: draft.subject, preheader: draft.preheader, blocks: draft.blocks, eventId: draft.eventId, net, balance, past, demo, paused: shell.data?.subscription?.state === 'paused' });
  const v = verdict(checks);
  const canSend = v.bad === 0 && !readOnly;
  const whenShort = mode === 'now' ? t('yc.em.sd.r.onConfirm') : `${dShort(eff.at)} · ${time(eff.at)}`;
  const dateText = mode === 'now' ? t('yc.em.sd.ck.date.now') : t('yc.em.sd.ck.date.later', { when: whenText(eff.at) });
  const idx = STEPS.indexOf(step);
  const nextOff = (step === 'aud' && net === 0) || (step === 'check' && !canSend);

  const next = () => {
    if (step === 'aud') { if (net === 0) { toast(t('yc.em.sd.aud.none')); return; } go('plan'); return; }
    if (step === 'plan') { if (past) { toast(t('yc.em.sd.plan.past')); return; } go('check'); return; }
    if (!canSend) { toast(t('yc.em.sd.nav.fixFirst')); return; }
    setConfirm(true);
  };
  const back = () => { if (idx === 0) nav(CRM_ROUTES.emailStudio(draft.id)); else go(STEPS[idx - 1]); };

  const errorKey = async (err: unknown, data: unknown): Promise<string> => {
    let body: Record<string, unknown> | null = (data as Record<string, unknown> | null) ?? null;
    const ctx = (err as { context?: Response } | null)?.context;
    if (ctx && typeof ctx.json === 'function') { try { body = await ctx.clone().json(); } catch { /* corps illisible : message générique */ } }
    const txt = JSON.stringify(body ?? {}) + String((err as Error | null)?.message ?? '');
    if (txt.includes('demo_no_send')) return 'yc.em.sd.err.demo';
    if (txt.includes('yunits_insufficient')) return 'yc.em.sd.err.yunits';
    if (txt.includes('crm_paused')) return 'yc.em.sd.err.paused';
    if (txt.includes('crm_send_frozen')) return 'yc.em.sd.err.frozen';
    if (txt.includes('No recipients')) return 'yc.em.sd.err.none';
    return 'yc.em.sd.err.generic';
  };

  const send = async () => {
    if (busy) return;
    // Compte de démonstration : rien ne part, ni maintenant ni plus tard (le
    // serveur refuserait). On le dit tout de suite, sans toucher à la campagne.
    if (demo) { setConfirm(false); toast(t('yc.em.sd.err.demo')); return; }
    setBusy(true);
    latest.current = { d: draft, n: net };
    const ok = await flush();
    if (!ok) { setBusy(false); setConfirm(false); toast(t('yc.em.sd.err.gone')); return; }
    if (mode === 'later') {
      const { data, error } = await supabase.from('email_campaigns')
        .update({ status: 'scheduled', scheduled_at: chosen.toISOString() } as never)
        .eq('id', draft.id).in('status', EDITABLE).select('id');
      setBusy(false); setConfirm(false);
      if (error?.message?.includes('crm_send_frozen')) { toast(t('yc.em.sd.err.frozen')); return; }
      if (error || !data?.length) { toast(t('yc.em.sd.err.gone')); return; }
      invalidate(); setDoneMode('later'); setPhase('done'); window.scrollTo(0, 0);
      return;
    }
    const { data, error } = await supabase.functions.invoke('send-campaign', { body: { campaign_id: draft.id } });
    setBusy(false); setConfirm(false);
    if (error) { toast(t(await errorKey(error, data))); invalidate(); return; }
    setDoneMode('now'); setProgress({ sent: 0, total: net }); setPhase('sending'); window.scrollTo(0, 0);
    invalidate();
    void qc.invalidateQueries({ queryKey: ['crm', qk, 'shell'] });
  };

  return (
    <div className="yc yc-page-bg" style={{ minHeight: '100vh' }}>
      <SendHeader draft={draft} step={step} phase={phase} balance={balance} onStep={(s) => { if (phase === 'edit') go(s); }} />
      {phase === 'edit' && (
        <div style={{ maxWidth: 1220, margin: '0 auto', boxSizing: 'border-box', padding: 'clamp(24px,3vw,36px) clamp(16px,3vw,40px) 80px', display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'flex-start' }}>
          <main style={{ flex: '1 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
            {readOnly && <div style={{ padding: '12px 16px', borderRadius: 16, background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 14, fontWeight: 500 }}>{t('yc.em.st.readOnly')}</div>}
            {step === 'aud' && (
              <AudienceStep
                options={options.data}
                audiences={draft.audiences}
                onAudiences={(a) => update({ audiences: a })}
                preview={preview.data}
                eventTitle={eventTitle}
                excludeBuyers={draft.excludeBuyers}
                onExcludeBuyers={(x) => update({ excludeBuyers: x })}
                recentDays={draft.recentDays}
                onRecentDays={(x) => update({ recentDays: x })}
              />
            )}
            {step === 'plan' && (
              <PlanStep plan={draft.plan} onPlan={(p) => update((d) => ({ plan: { ...d.plan, ...p } }))} best={best} abOn={draft.abOn} abPct={draft.abPct} abHours={draft.abHours} whenText={whenText} relText={relText} />
            )}
            {step === 'check' && <CheckStep checks={checks} campaignId={draft.id} dateText={dateText} onGo={go} />}

            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 6 }}>
              <Hv as="button" type="button" onClick={back} style={{ height: 48, padding: '0 22px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 15, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }} hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }}>
                <Icon name="arrowLeft" size={16} stroke={2.3} />{idx === 0 ? t('yc.em.sd.backStudio') : t('yc.em.sd.back')}
              </Hv>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                {step === 'check' && (
                  <Hv as={Link} to={`${CRM_ROUTES.emailCampaigns}?s=draft`} onClick={() => void flush()} style={{ height: 48, padding: '0 22px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 15, fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', textDecoration: 'none' }} hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)', color: 'var(--ink)' }}>
                    {t('yc.em.sd.nav.draft')}
                  </Hv>
                )}
                <Hv
                  as="button"
                  type="button"
                  onClick={next}
                  aria-disabled={nextOff}
                  style={{ height: 50, padding: '0 6px 0 24px', borderRadius: 99, border: 0, background: nextOff ? 'var(--sand-200)' : 'var(--gradient-brand)', color: nextOff ? 'var(--sand-500)' : '#fff', fontSize: 16, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 14, boxShadow: nextOff ? 'none' : 'var(--shadow-cta)', cursor: nextOff ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', transition: `transform 200ms ${SPRING},filter 160ms` }}
                  hover={nextOff ? undefined : { filter: 'brightness(1.05)', transform: 'translateY(-1px)' }}
                  active={nextOff ? undefined : { transform: 'scale(.97)' }}
                >
                  {step === 'aud' ? t('yc.em.sd.nav.toPlan') : step === 'plan' ? t('yc.em.sd.nav.toCheck') : t(mode === 'now' ? 'yc.em.sd.nav.now' : 'yc.em.sd.nav.later')}
                  <span style={{ width: 38, height: 38, borderRadius: 99, background: '#fff', color: nextOff ? 'var(--sand-400)' : 'var(--red-500)', display: 'grid', placeItems: 'center' }}>
                    <Icon name={step === 'check' ? 'send' : 'arrowRight'} size={17} stroke={2.4} />
                  </span>
                </Hv>
              </div>
            </div>
          </main>
          <SendAside campaignId={draft.id} subject={draft.subject} fromName={space.name} replyTo={user?.email ?? null} net={net} whenShort={whenShort} balance={balance} low={low} />
        </div>
      )}

      {phase === 'sending' && <SendingView id={draft.id} total={progress.total} wave={draft.plan.wave} onDone={(sent) => { setProgress((p) => ({ ...p, sent })); setPhase('done'); }} />}
      {phase === 'done' && (
        <DoneView
          mode={doneMode}
          n={doneMode === 'now' ? Math.max(progress.sent, net) : net}
          balance={balance}
          whenText={whenText(eff.at)}
          id={draft.id}
          onUnschedule={async () => {
            try { await unscheduleCampaign(draft.id); invalidate(); toast(t('yc.em.sd.d.unscheduled')); setDraft({ ...draft, status: 'draft' }); setPhase('edit'); go('plan'); } catch { toast(t('yc.em.tp.err')); }
          }}
        />
      )}

      <Modal open={confirm} onClose={() => setConfirm(false)} width={480} label={t('yc.em.sd.c.label')}>
        <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em', lineHeight: 1.1 }}>{tp(mode === 'now' ? 'yc.em.sd.c.now' : 'yc.em.sd.c.later', net, { n: n(net) })}</h2>
            <div style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--sand-500)', marginTop: 6 }}>{t(mode === 'now' ? 'yc.em.sd.c.noteNow' : 'yc.em.sd.c.noteLater')}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 18px', borderRadius: 18, background: 'var(--paper)', boxShadow: 'inset 0 0 0 1px var(--sand-100)' }}>
            {[
              [t('yc.em.sd.r.subject'), (draft.subject || '').replace(/\{\{[^}]+\}\}/g, 'Camille') || t('yc.em.sd.r.noSubject')],
              [t('yc.em.sd.r.to'), t('yc.em.sd.c.contacts', { n: n(net) })],
              [t('yc.em.sd.r.when'), mode === 'now' ? t('yc.em.sd.r.onConfirm') : whenText(eff.at)],
              [t('yc.em.sd.r.cost'), t('yc.em.sd.r.costV', { n: n(net) })],
            ].map(([l, val]) => (
              <div key={l} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 14, fontSize: 14.5 }}><span style={{ color: 'var(--sand-600)' }}>{l}</span><b style={{ textAlign: 'right' }}>{val}</b></div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Hv as="button" type="button" onClick={() => setConfirm(false)} style={{ flex: 1, height: 50, borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 15, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }} hover={{ background: 'var(--paper)' }}>{t('yc.em.sd.c.notYet')}</Hv>
            <Hv as="button" type="button" onClick={() => void send()} disabled={busy} style={{ flex: 1.4, height: 50, border: 0, borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 15.5, fontWeight: 600, cursor: busy ? 'progress' : 'pointer', boxShadow: 'var(--shadow-cta)', transition: `transform 200ms ${SPRING},filter 160ms` }} hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }} active={{ transform: 'scale(.97)' }}>
              {busy ? '…' : t(mode === 'now' ? 'yc.em.sd.nav.now' : 'yc.em.sd.nav.later')}
            </Hv>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function SendHeader({ draft, step, phase, balance, onStep }: { draft: Draft; step: Step; phase: string; balance: number; onStep: (s: Step) => void }) {
  const { t, n } = useCrmT();
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => { const on = () => setW(window.innerWidth); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  const narrow = w < 1000;
  const items: { k: Step | null; l: string }[] = [
    { k: null, l: t('yc.em.st.step.content') }, { k: 'aud', l: t('yc.em.st.step.aud') }, { k: 'plan', l: t('yc.em.st.step.plan') }, { k: 'check', l: t('yc.em.st.step.check') },
  ];
  const cur = STEPS.indexOf(step) + 1;
  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 40, height: 64, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 16, padding: '0 clamp(12px,2vw,20px)', background: 'rgba(252,250,249,.9)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid var(--sand-100)' }}>
      <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Hv as={Link} to={CRM_ROUTES.emailStudio(draft.id)} aria-label={t('yc.em.sd.backStudio')} title={t('yc.em.sd.backStudio')} style={{ flex: 'none', width: 40, height: 40, borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', color: 'var(--ink)', display: 'grid', placeItems: 'center' }} hover={{ background: 'var(--sand-50)', color: 'var(--ink)' }}>
          <Icon name="arrowLeft" size={17} stroke={2.3} />
        </Hv>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{draft.name}</b>
          {!narrow && <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.em.sd.sub')}</span>}
        </div>
      </div>
      {phase === 'edit' && !narrow && (
        <nav aria-label={t('yc.em.st.steps')} style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
          {items.map((s, i) => {
            const isCur = i === cur;
            const done = i < cur;
            const inner = (
              <>
                <span style={{ width: 24, height: 24, borderRadius: 99, background: isCur ? 'var(--red-500)' : done ? 'var(--green-500)' : 'var(--sand-100)', color: isCur || done ? '#fff' : 'var(--sand-600)', display: 'grid', placeItems: 'center', fontSize: 12.5, fontWeight: 600 }}>
                  {done ? <Icon name="check" size={12} stroke={3.4} /> : i + 1}
                </span>
                {s.l}
              </>
            );
            const css = { height: 38, padding: '0 14px 0 8px', border: 0, borderRadius: 99, display: 'flex', alignItems: 'center', gap: 9, background: isCur ? 'var(--red-50)' : 'transparent', color: isCur ? 'var(--red-700)' : done ? 'var(--ink)' : 'var(--sand-500)', fontSize: 14, fontWeight: isCur ? 600 : 500, textDecoration: 'none', whiteSpace: 'nowrap', cursor: 'pointer', transition: 'background 160ms' } as const;
            return (
              <span key={s.l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {s.k === null
                  ? <Hv as={Link} to={CRM_ROUTES.emailStudio(draft.id)} style={css} hover={{ background: 'var(--sand-50)', color: 'var(--ink)' }}>{inner}</Hv>
                  : <Hv as="button" type="button" onClick={() => onStep(s.k as Step)} aria-current={isCur ? 'step' : undefined} style={css} hover={{ background: isCur ? 'var(--red-50)' : 'var(--sand-50)' }}>{inner}</Hv>}
                {i < items.length - 1 && <span style={{ width: 14, height: 1.5, background: 'var(--sand-200)', borderRadius: 2 }} />}
              </span>
            );
          })}
        </nav>
      )}
      <div style={{ flex: narrow ? 'none' : '1 1 0', minWidth: 0, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
        <Hv as={Link} to={CRM_ROUTES.yunits} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 12px 0 6px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: 'var(--ink)', textDecoration: 'none' }} hover={{ borderColor: 'var(--sand-300)', color: 'var(--ink)' }}>
          <YunitFace mood="content" size={24} />{n(balance)}<span style={{ fontWeight: 400, color: 'var(--sand-500)' }}>{t('yc.em.sd.yunits')}</span>
        </Hv>
      </div>
    </header>
  );
}

/** Envoi en cours : la progression réelle (destinataires partis / en file). */
function SendingView({ id, total, wave, onDone }: { id: string; total: number; wave: boolean; onDone: (sent: number) => void }) {
  const { t, n } = useCrmT();
  const [state, setState] = useState({ sent: 0, total, status: 'sending' });
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    let off = false;
    const tick = async () => {
      const { data } = await supabase.from('email_campaigns').select('status,total_recipients,recipients_count,failed_count').eq('id', id).maybeSingle();
      if (off || !data) return;
      const r = data as { status: string; total_recipients: number | null; recipients_count: number | null; failed_count: number | null };
      const tot = r.total_recipients || total;
      const sent = (r.recipients_count ?? 0) + (r.failed_count ?? 0);
      setState({ sent, total: tot, status: r.status });
      if (r.status === 'sent' || (tot > 0 && sent >= tot)) { window.setTimeout(() => doneRef.current(r.recipients_count ?? sent), 600); return; }
      window.setTimeout(() => { void tick(); }, 2000);
    };
    void tick();
    return () => { off = true; };
  }, [id, total]);
  const p = state.total > 0 ? Math.min(1, state.sent / state.total) : 0;
  const title = p < 0.12 ? t('yc.em.sd.s.prep') : p < 1 ? t('yc.em.sd.s.going') : t('yc.em.sd.s.almost');
  return (
    <div style={{ minHeight: 'calc(100vh - 64px)', display: 'grid', placeItems: 'center', padding: 24, boxSizing: 'border-box' }}>
      <div style={{ width: 'min(560px,100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22, textAlign: 'center', animation: `yc-rise 700ms ${EASE} both` }}>
        <div style={{ position: 'relative', width: 140, height: 140, borderRadius: '50%', background: `conic-gradient(var(--red-500) 0 ${p * 360}deg,var(--red-100) 0)`, transition: 'background 400ms' }}>
          <span style={{ position: 'absolute', inset: 10, borderRadius: '50%', background: '#fff', display: 'grid', placeItems: 'center' }}><YunitFace mood="surpris" size={76} /></span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,4vw,40px)', letterSpacing: '-.04em', lineHeight: 1.05 }}>{title}</h1>
          <span style={{ fontSize: 16, color: 'var(--sand-600)' }}>{t(wave ? 'yc.em.sd.s.wave' : 'yc.em.sd.s.once')}</span>
        </div>
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ height: 12, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}><div style={{ width: `${p * 100}%`, height: '100%', borderRadius: 99, background: 'var(--gradient-brand)', transition: `width 600ms ${EASE}` }} /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--sand-600)' }}>
            <span><Rich text={t('yc.em.sd.s.count', { sent: n(state.sent), n: n(state.total) })} /></span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(p * 100)} %</span>
          </div>
        </div>
        <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{t('yc.em.sd.s.bg')}</span>
      </div>
    </div>
  );
}

function DoneView({ mode, n: count, balance, whenText, id, onUnschedule }: { mode: 'now' | 'later'; n: number; balance: number; whenText: string; id: string; onUnschedule: () => void }) {
  const { t, n } = useCrmT();
  const stats = [
    { v: n(count), l: t('yc.em.sd.d.recipients') },
    { v: n(count), l: t(mode === 'now' ? 'yc.em.sd.d.used' : 'yc.em.sd.d.planned') },
    { v: n(Math.max(0, mode === 'now' ? balance : balance - count)), l: t('yc.em.sd.d.left') },
  ];
  const btn = { height: 50, padding: '0 22px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 15, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', textDecoration: 'none' } as const;
  return (
    <div style={{ minHeight: 'calc(100vh - 64px)', display: 'grid', placeItems: 'center', padding: 24, boxSizing: 'border-box' }}>
      <div style={{ width: 'min(620px,100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22, textAlign: 'center' }}>
        <div style={{ animation: `yc-pop 500ms ${SPRING} both` }}><YunitFace mood="ravi" size={104} /></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, animation: `yc-rise 700ms ${EASE} 150ms both` }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--green-700)' }}>{t(mode === 'now' ? 'yc.em.sd.d.tagNow' : 'yc.em.sd.d.tagLater')}</span>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(30px,4.4vw,44px)', letterSpacing: '-.04em', lineHeight: 1.05, textWrap: 'balance' }}>
            {mode === 'now' ? t('yc.em.sd.d.titleNow', { n: n(count) }) : t('yc.em.sd.d.titleLater', { when: whenText })}
          </h1>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t(mode === 'now' ? 'yc.em.sd.d.subNow' : 'yc.em.sd.d.subLater')}</p>
        </div>
        <div style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, animation: `yc-rise 700ms ${EASE} 260ms both` }}>
          {stats.map((s) => (
            <div key={s.l} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '16px 10px', borderRadius: 20, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
              <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{s.v}</b>
              <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{s.l}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10, animation: `yc-rise 700ms ${EASE} 340ms both` }}>
          <Hv as={Link} to={mode === 'now' ? CRM_ROUTES.emailResults(id) : `${CRM_ROUTES.emailCampaigns}?v=cal`} style={{ height: 50, padding: '0 6px 0 24px', borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 16, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 14, boxShadow: 'var(--shadow-cta)', textDecoration: 'none' }} hover={{ filter: 'brightness(1.05)', color: '#fff' }}>
            {t(mode === 'now' ? 'yc.em.sd.d.results' : 'yc.em.sd.d.calendar')}
            <span style={{ width: 38, height: 38, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><Icon name="arrowRight" size={17} stroke={2.4} /></span>
          </Hv>
          {mode === 'later' && <Hv as="button" type="button" onClick={onUnschedule} style={btn} hover={{ background: 'var(--paper)' }}>{t('yc.em.sd.d.unschedule')}</Hv>}
          <Hv as={Link} to={CRM_ROUTES.emailCampaigns} style={btn} hover={{ background: 'var(--paper)', color: 'var(--ink)' }}>{t('yc.em.sd.d.all')}</Hv>
        </div>
      </div>
    </div>
  );
}
