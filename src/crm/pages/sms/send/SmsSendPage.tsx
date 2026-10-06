/**
 * SMS › Envoi (maquette « SMS Envoi.dc.html ») : `/crm/sms/send/:id`,
 * `?step=aud|plan|check`.
 *
 * Audience (même règle que crm_sms_audience_preview), planification (heures
 * calmes du compte), vérification. Chaque réglage s'enregistre sur le
 * brouillon (crm_sms_save), la date choisie comprise. Rien ne part sans
 * confirmation : « Maintenant » appelle send-sms-campaign (mise en file,
 * Yunits, première tranche) ; « Programmer » passe le SMS en `scheduled`
 * (crm_sms_schedule), le cron l'envoie à l'heure dite.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Modal } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { SPRING } from '@/crm/ui/motion';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps, useCrmScope } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { useCrmShell } from '@/crm/data/shell';
import { useNights } from '@/crm/data/nights';
import type { CrmAudience } from '@/crm/data/emails';
import { smsErrorKey, useSmsActions, useSmsAnalysis, useSmsAudiencePreview, useSmsCampaigns, useSmsReadiness, useSmsSendOptions, useSmsSettings } from '@/crm/data/sms';
import {
  countSms, CRM_SMS_SEND_OPEN, defaultSender, SAMPLE_LINK, smsBestSlots, smsChecks, smsCheckLevel, smsCostSplit, smsEffectiveAt, smsFinalText,
} from '@/crm/lib/sms';
import { SmsFlowHeader, type SmsStep } from '../flow/SmsFlowHeader';
import { SmsAudienceStep } from './SmsAudienceStep';
import { SmsPlanStep, type SmsPlan } from './SmsPlanStep';
import { SmsCheckStep } from './SmsCheckStep';
import { SmsSendAside } from './SmsSendAside';

type Step = 'aud' | 'plan' | 'check';
const STEPS: Step[] = ['aud', 'plan', 'check'];
const two = (v: number) => String(v).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;

interface Draft { audiences: CrmAudience[]; excludeBuyers: boolean; recentDays: number; plan: SmsPlan }

export default function SmsSendPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { t, tp, n, dLong, dShort, time, lang } = useCrmT();
  const nav = useNavigate();
  const toast = useCrmToast();
  const readOnly = !useCrmCaps().write;
  const { space } = useCrmScope();
  const [params, setParams] = useSearchParams();
  const step: Step = STEPS.includes(params.get('step') as Step) ? (params.get('step') as Step) : 'aud';
  const camps = useSmsCampaigns();
  const settings = useSmsSettings();
  const options = useSmsSendOptions();
  const analysis = useSmsAnalysis();
  const nights = useNights();
  const shell = useCrmShell();
  const act = useSmsActions();
  const readiness = useSmsReadiness();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const row = useMemo(() => (camps.data?.campaigns ?? []).find((c) => c.id === id) ?? null, [camps.data, id]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const best = useMemo(() => smsBestSlots(analysis.data?.campaigns ?? []), [analysis.data]);
  const s = settings.data;
  const quiet = { from: s?.quiet_from ?? 20, to: s?.quiet_to ?? 8, noSunday: s?.no_sunday ?? true };
  const cap = s?.weekly_cap ?? 1;
  const rateSms = Number(shell.data?.wallet.rates?.sms ?? 35);
  const rateIntl = Number(shell.data?.wallet.rates?.sms_intl ?? 70);
  const balance = Number(shell.data?.wallet.balance ?? 0);

  // Premier état : celui du brouillon ; un créneau proposé s'il n'a pas de date.
  useEffect(() => {
    if (draft || !row || !settings.data) return;
    if (row.status === 'sent' || row.status === 'sending' || row.status === 'paused') { toast(t('yc.sm.sd.sentRedirect')); nav(CRM_ROUTES.smsResults(row.id), { replace: true }); return; }
    let date: string; let tm: string;
    if (row.scheduled_at) { const d = new Date(row.scheduled_at); date = isoDay(d); tm = `${two(d.getHours())}:${two(Math.floor(d.getMinutes() / 15) * 15)}`; }
    else {
      const d = new Date(); d.setDate(d.getDate() + 1);
      if (settings.data.no_sunday && d.getDay() === 0) d.setDate(d.getDate() + 1);
      date = isoDay(d); tm = `${two(best.hours[0] ?? 18)}:00`;
    }
    setDraft({
      audiences: row.audiences ?? [], excludeBuyers: row.exclude_buyers, recentDays: row.recent_days ?? 0,
      plan: { mode: 'later', date, time: tm, wave: row.waves, quiet: row.quiet_hours },
    });
  }, [draft, row, settings.data, best, nav, t, toast]);

  const eventTitle = row?.event_title ?? null;
  const preview = useSmsAudiencePreview({
    audiences: draft?.audiences ?? [], eventId: row?.event_id ?? null, recentDays: draft?.recentDays || null,
    excludeBuyers: !!draft?.excludeBuyers && !!row?.event_id, campaignId: row?.id ?? null,
  });
  const net = preview.data?.net ?? 0;
  const sender = row?.sender_name || s?.sender_name || defaultSender(space.name);
  const night = (nights.data?.nights ?? []).find((x) => x.id === row?.event_id) ?? null;
  const text = smsFinalText(row?.body ?? '', { sender, lang, vals: { 'prénom': t('yc.sm.sample.name'), nom_club: space.name, 'soirée': night?.title ?? eventTitle ?? t('yc.sm.sample.night'), lien: SAMPLE_LINK } });
  const k = countSms(text);
  // Deux tarifs : France (+33) et étranger, comptés numéro par numéro (crm_sms_audience_preview).
  const netIntl = Math.min(net, preview.data?.net_intl ?? 0);
  const cost = smsCostSplit(net, netIntl, k.parts, rateSms, rateIntl);

  // Enregistrement (brouillon) : chaque réglage, la taille et le coût estimés.
  const latest = useRef<{ d: Draft; net: number; parts: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const cur = latest.current;
    if (!cur || readOnly || !row || row.status !== 'draft') return;
    const at = new Date(`${cur.d.plan.date}T${cur.d.plan.time}:00`);
    try {
      await act.save(row.id, {
        audiences: cur.d.audiences, exclude_buyers: cur.d.excludeBuyers, recent_days: cur.d.recentDays || null,
        waves: cur.d.plan.wave, quiet_hours: cur.d.plan.quiet, scheduled_at: cur.d.plan.mode === 'later' ? at.toISOString() : null,
        estimated: cur.net, parts: cur.parts,
      });
    } catch { toast(t('yc.sm.co.saveErr')); }
  }, [act, readOnly, row, t, toast]);
  const update = (p: Partial<Draft> | ((d: Draft) => Partial<Draft>)) => {
    if (readOnly) return;
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, ...(typeof p === 'function' ? p(d) : p) };
      latest.current = { d: next, net, parts: k.parts };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { void flush(); }, 700);
      return next;
    });
  };
  // La taille d'audience suit le brouillon : on la garde dès qu'elle bouge.
  useEffect(() => {
    if (!draft || readOnly || !preview.data || !row || row.status !== 'draft') return;
    if (row.estimated === net && row.parts === k.parts) return;
    latest.current = { d: draft, net, parts: k.parts };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 900);
  }, [net, k.parts, draft, preview.data, readOnly, row, flush]);
  useEffect(() => () => { void flush(); }, [flush]);

  const whenText = useCallback((d: Date) => t('yc.em.sd.when', { day: dLong(d), time: time(d) }), [t, dLong, time]);
  const relText = useCallback((d: Date) => {
    const ms = d.getTime() - Date.now();
    if (ms < 0) return t('yc.em.sd.rel.past');
    const h = Math.round(ms / 36e5);
    if (h < 1) return t('yc.em.sd.rel.soon');
    if (h < 24) return tp('yc.em.sd.rel.h', h);
    return tp('yc.em.sd.rel.d', Math.round(ms / 864e5));
  }, [t, tp]);

  if (camps.data && !row) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, maxWidth: 380 }}>
          <YunitFace mood="inquiet" size={60} />
          <b style={{ fontFamily: 'var(--font-display)', fontSize: 22 }}>{t('yc.sm.co.notFound')}</b>
          <Hv as={Link} to={CRM_ROUTES.smsCampaigns} style={{ height: 44, padding: '0 20px', borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none' }} hover={{ color: '#fff' }}>{t('yc.sm.co.toList')}</Hv>
        </div>
      </div>
    );
  }
  if (!draft || !row) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><YunitFace mood="content" size={56} /></div>;

  const go = (st: SmsStep) => {
    if (st === 'msg') { void flush(); nav(CRM_ROUTES.smsCompose(row.id)); return; }
    setParams((p) => { const x = new URLSearchParams(p); x.set('step', st); return x; });
    window.scrollTo(0, 0);
  };
  const mode = draft.plan.mode;
  const chosen = new Date(`${draft.plan.date}T${draft.plan.time}:00`);
  const eff = smsEffectiveAt(mode === 'now' ? new Date() : chosen, { on: draft.plan.quiet, ...quiet });
  const past = mode === 'later' && chosen.getTime() <= Date.now();
  const checks = smsChecks({ body: row.body ?? '', count: k, net, cost, balance, at: mode === 'later' ? chosen : null, now: new Date(), identityOk: readiness.data ? readiness.data.identity_ok : true });
  const bad = checks.filter((c) => smsCheckLevel(c) === 'bad').length;
  const canSend = bad === 0 && !readOnly;
  const idx = STEPS.indexOf(step);
  const scheduled = row.status === 'scheduled';
  const nextOff = scheduled || (step === 'aud' && net === 0) || (step === 'check' && (!canSend || !CRM_SMS_SEND_OPEN));
  const whenShort = mode === 'now' ? t('yc.em.sd.r.onConfirm') : `${dShort(eff.at)} · ${time(eff.at)}`;
  const dateText = mode === 'now' ? t('yc.sm.sd.date.now') : t('yc.sm.sd.date.later', { when: whenText(eff.at) });

  const next = () => {
    if (step === 'aud') { if (net === 0) { toast(t('yc.sm.sd.aud.none')); return; } go('plan'); return; }
    if (step === 'plan') { if (past) { toast(t('yc.em.sd.plan.past')); return; } go('check'); return; }
    if (!CRM_SMS_SEND_OPEN) { toast(t('yc.sm.sd.soonToast')); return; }
    if (!canSend) { toast(t('yc.em.sd.nav.fixFirst')); return; }
    setConfirm(true);
  };
  // Envoi confirmé : maintenant (send-sms-campaign) ou à l'heure dite (crm_sms_schedule).
  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await flush();
      if (mode === 'later') {
        await act.schedule(row.id, eff.at);
        setConfirm(false);
        toast(t('yc.sm.sd.done.later', { when: whenText(eff.at) }));
        nav(`${CRM_ROUTES.smsCampaigns}?s=sched`);
      } else {
        await act.sendNow(row.id);
        setConfirm(false);
        toast(t('yc.sm.sd.done.now'));
        nav(CRM_ROUTES.smsResults(row.id));
      }
    } catch (e) {
      setConfirm(false);
      toast(t(smsErrorKey(e)));
    } finally {
      setBusy(false);
    }
  };
  const unschedule = async () => {
    try { await act.unschedule(row.id); toast(t('yc.sm.sd.unscheduled')); } catch (e) { toast(t(smsErrorKey(e))); }
  };
  const back = () => { if (idx === 0) go('msg'); else go(STEPS[idx - 1]); };

  return (
    <div className="yc yc-page-bg" style={{ minHeight: '100vh' }}>
      <SmsFlowHeader
        back={CRM_ROUTES.smsCampaigns} step={step} onStep={go}
        title={row.name || t('yc.sm.untitled')} sub={t('yc.sm.sd.sub')}
        right={(
          <Hv as={Link} to={CRM_ROUTES.yunits} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 12px 0 6px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: 'var(--ink)', textDecoration: 'none' }} hover={{ borderColor: 'var(--sand-300)', color: 'var(--ink)' }}>
            <YunitFace mood="content" size={24} />{n(balance)}<span style={{ fontWeight: 400, color: 'var(--sand-500)' }}>{t('yc.em.sd.yunits')}</span>
          </Hv>
        )}
      />
      <div style={{ maxWidth: 1220, margin: '0 auto', boxSizing: 'border-box', padding: 'clamp(24px,3vw,36px) clamp(16px,3vw,40px) 80px', display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'flex-start' }}>
        <main style={{ flex: '1 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
          {readOnly && <div style={{ padding: '12px 16px', borderRadius: 16, background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 14, fontWeight: 500 }}>{t('yc.em.st.readOnly')}</div>}
          {scheduled && row.scheduled_at && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px', borderRadius: 18, background: 'var(--green-50)', boxShadow: 'inset 0 0 0 1px #BFE6CE' }}>
              <span style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--green-700)' }}>{t('yc.sm.sd.schedBanner', { when: whenText(new Date(row.scheduled_at)) })}</span>
              {!readOnly && (
                <Hv as="button" type="button" onClick={() => void unschedule()} style={{ height: 38, padding: '0 16px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer', font: 'inherit' }} hover={{ background: 'var(--paper)' }}>
                  {t('yc.sm.sd.unschedule')}
                </Hv>
              )}
            </div>
          )}
          {step === 'aud' && (
            <SmsAudienceStep
              options={options.data} audiences={draft.audiences} onAudiences={(a) => update({ audiences: a })} preview={preview.data} cost={cost}
              eventTitle={eventTitle} excludeBuyers={draft.excludeBuyers} onExcludeBuyers={(x) => update({ excludeBuyers: x })}
              recentDays={draft.recentDays} onRecentDays={(x) => update({ recentDays: x })} cap={cap} readOnly={readOnly}
            />
          )}
          {step === 'plan' && <SmsPlanStep plan={draft.plan} onPlan={(p) => update((d) => ({ plan: { ...d.plan, ...p } }))} best={best} quiet={quiet} whenText={whenText} relText={relText} readOnly={readOnly} />}
          {step === 'check' && (
            <SmsCheckStep checks={checks} campaignId={row.id} count={k} net={net} cost={cost} left={balance - cost} sender={sender} dateText={dateText} onGo={go} />
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 6 }}>
            <Hv as="button" type="button" onClick={back} style={{ height: 48, padding: '0 22px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 15, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, font: 'inherit' }} hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }}>
              <Icon name="arrowLeft" size={16} stroke={2.3} />{idx === 0 ? t('yc.sm.sd.backMsg') : t('yc.em.sd.back')}
            </Hv>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              {step === 'check' && !readOnly && (
                <Hv as={Link} to={`${CRM_ROUTES.smsCampaigns}?s=draft`} onClick={() => void flush()} style={{ height: 48, padding: '0 22px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 15, fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', textDecoration: 'none' }} hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)', color: 'var(--ink)' }}>
                  {t('yc.sm.co.keep')}
                </Hv>
              )}
              <Hv
                as="button" type="button" onClick={next} aria-disabled={nextOff}
                style={{ height: 50, padding: '0 6px 0 24px', borderRadius: 99, border: 0, background: nextOff ? 'var(--sand-200)' : 'var(--gradient-brand)', color: nextOff ? 'var(--sand-500)' : '#fff', fontSize: 16, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 14, boxShadow: nextOff ? 'none' : 'var(--shadow-cta)', cursor: nextOff ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', transition: `transform 200ms ${SPRING},filter 160ms`, font: 'inherit' }}
                hover={nextOff ? undefined : { filter: 'brightness(1.05)', transform: 'translateY(-1px)' }}
                active={nextOff ? undefined : { transform: 'scale(.97)' }}
              >
                {step === 'aud' ? t('yc.sm.sd.nav.toPlan') : step === 'plan' ? t('yc.sm.sd.nav.toCheck') : t(mode === 'now' ? 'yc.sm.sd.nav.now' : 'yc.sm.sd.nav.later')}
                {step === 'check' && !CRM_SMS_SEND_OPEN && <span style={{ height: 22, padding: '0 8px', borderRadius: 99, background: '#fff', color: 'var(--sand-600)', fontSize: 11.5, fontWeight: 600, display: 'flex', alignItems: 'center' }}>{t('yc.sm.soon.badge')}</span>}
                <span style={{ width: 38, height: 38, borderRadius: 99, background: '#fff', color: nextOff ? 'var(--sand-400)' : 'var(--red-500)', display: 'grid', placeItems: 'center' }}>
                  <Icon name={step === 'check' ? 'send' : 'arrowRight'} size={17} stroke={2.4} />
                </span>
              </Hv>
            </div>
          </div>
        </main>
        <SmsSendAside campaignId={row.id} text={text} sender={sender} time={mode === 'now' ? time(new Date()) : time(eff.at)} day={mode === 'now' || eff.at.toDateString() === new Date().toDateString() ? t('yc.sm.ph.today') : dShort(eff.at)} parts={k.parts} net={net} whenShort={whenShort} cost={cost} rate={rateSms} intl={{ n: netIntl, rate: rateIntl }} balance={balance} readOnly={readOnly} />
      </div>

      <Modal open={confirm} onClose={() => setConfirm(false)} width={480} label={t('yc.sm.sd.c.label')}>
        <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em', lineHeight: 1.1 }}>{tp(mode === 'now' ? 'yc.sm.sd.c.now' : 'yc.sm.sd.c.later', net, { n: n(net) })}</h2>
            <div style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--sand-500)', marginTop: 6 }}>{t(mode === 'now' ? 'yc.sm.sd.c.noteNow' : 'yc.sm.sd.c.noteLater')}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 18px', borderRadius: 18, background: 'var(--paper)', boxShadow: 'inset 0 0 0 1px var(--sand-100)' }}>
            {[
              [t('yc.sm.sd.c.from'), sender],
              [t('yc.sm.sd.c.to'), tp('yc.sm.ck.aud.ok', net, { n: n(net) }).replace(/[.]$/, '')],
              [t('yc.sm.sd.c.when'), mode === 'now' ? t('yc.em.sd.r.onConfirm') : whenText(eff.at)],
              [t('yc.sm.sd.c.cost'), t('yc.sm.sd.c.costV', { n: n(cost), p: k.parts })],
              ...(netIntl > 0 ? [[t('yc.sm.sd.c.intlL'), t('yc.sm.sd.c.intlV', { n: n(netIntl), r: rateIntl })]] : []),
            ].map(([l, val]) => (
              <div key={l} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 14, fontSize: 14.5 }}><span style={{ color: 'var(--sand-600)' }}>{l}</span><b style={{ textAlign: 'right' }}>{val}</b></div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Hv as="button" type="button" onClick={() => setConfirm(false)} style={{ flex: 1, height: 50, borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 15, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer', font: 'inherit' }} hover={{ background: 'var(--paper)' }}>{t('yc.em.sd.c.notYet')}</Hv>
            <Hv as="button" type="button" onClick={() => void send()} disabled={busy} style={{ flex: 1.4, height: 50, border: 0, borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 15.5, fontWeight: 600, cursor: busy ? 'progress' : 'pointer', boxShadow: 'var(--shadow-cta)', transition: `transform 200ms ${SPRING},filter 160ms`, font: 'inherit' }} hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }} active={{ transform: 'scale(.97)' }}>
              {busy ? '…' : t(mode === 'now' ? 'yc.sm.sd.nav.now' : 'yc.sm.sd.nav.later')}
            </Hv>
          </div>
        </div>
      </Modal>
    </div>
  );
}
