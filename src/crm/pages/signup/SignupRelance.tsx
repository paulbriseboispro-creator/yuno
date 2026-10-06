/**
 * Fiche d'une page › Relance — design « Pages inscription », onglet
 * « Relance », à l'identique : « Que reçoivent les inscrits ensuite ? », les
 * messages qui partent tout seuls (une à trois étapes selon le type), leurs
 * canaux, délais, texte, combien de personnes et combien de Yunits, le total
 * face au solde, et à droite ce que reçoit l'inscrit (e-mail ou SMS).
 *
 * Chaque changement s'enregistre seul (`relance` de la page, avec l'e-mail
 * recomposé) ; le collecteur `crm_signup_relance_collect` envoie au moment dû.
 * Liste d'attente : « Prévenir les inscrits maintenant » (une fois).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { Hv } from '@/crm/ui/Hv';
import { useCrmToast } from '@/crm/ui/toast';
import { CRM_SMS_SIGNUP_LIVE } from '@/crm/lib/sms';
import { useCrmShell } from '@/crm/data/shell';
import { rpcCode, signupUrl, useSignupMutations } from '@/crm/data/signupPages';
import type { SignupDetail, SignupPageRow } from '@/crm/data/signupPages';
import InscriptionPhone from '@/crm/signup/InscriptionPhone';
import { KIND_META, LAST_DELAYS, NUDGE_DELAYS, SP_ICON, dt } from '@/crm/signup/model';
import type { RelanceStep, RelanceStepId, SignupRelance } from '@/crm/signup/model';
import { useNights } from '@/crm/data/nights';
import { Seg, SpSvg, monoLabel, pageCfg, rewardOfPage } from './signupUi';
import { defaultRelance, dtAt, pageAccent, relanceCta, relanceForSave, rewardFanText } from './signupLogic';

export default function SignupRelanceTab({ d, x, balance, host, logo }: { d: SignupPageRow; x: SignupDetail; balance: number; host: string; logo: string | null }) {
  const T = useCrmT();
  const { t, tp, n, lang, locale } = T;
  const caps = useCrmCaps();
  const toast = useCrmToast();
  const m = useSignupMutations();
  const nights = useNights();
  const shell = useCrmShell();
  const smsRate = Number(shell.data?.wallet.rates?.sms ?? 35) || 35;
  const steps = KIND_META[d.kind].relance;
  const rewardTxt = rewardFanText(rewardOfPage(d), t);
  const defs = useMemo(() => defaultRelance({ kind: d.kind, title: d.title, host, lang, t, reward: rewardTxt }, { on: true, email: true, sms: false }), [d.kind, d.title, host, lang, t, rewardTxt]);
  const [rel, setRel] = useState<SignupRelance>(() => {
    const out: SignupRelance = {};
    steps.forEach((k) => { out[k] = { ...(defs[k] as RelanceStep), ...(d.relance?.[k] ?? {}) }; if (!out[k]!.msg) out[k]!.msg = defs[k]?.msg ?? ''; });
    return out;
  });
  const [sel, setSel] = useState<RelanceStepId>('open');
  const [ch, setCh] = useState<'email' | 'sms'>('email');
  const dirty = useRef(false);
  const none = !d.n;

  // Enregistrement automatique, une seconde après le dernier changement.
  const persist = useRef<(r: SignupRelance) => void>(() => {});
  useEffect(() => {
    persist.current = (r) => {
      const nextNight = (nights.data?.nights ?? []).find((nn) => nn.upcoming)?.url ?? null;
      const relance = relanceForSave({ ...(d.relance ?? {}), ...r }, {
        kind: d.kind, title: d.title, host, lang, t, reward: rewardTxt, accent: pageAccent(d.design), logo,
        ctaUrl: relanceCta(d.kind, d.event, nextNight, signupUrl(d.slug)),
      });
      m.save.mutate({ id: d.id, patch: { relance } }, { onError: () => toast(t('yc.sp.err')) });
    };
  });
  useEffect(() => {
    if (!dirty.current) return;
    const id = setTimeout(() => persist.current(rel), 900);
    return () => clearTimeout(id);
  }, [rel]);

  const up = (k: RelanceStepId, patch: Partial<RelanceStep>) => { dirty.current = true; setRel((s) => ({ ...s, [k]: { ...(s[k] as RelanceStep), ...patch } })); };

  const notify = () => {
    if (!window.confirm(d.closes_mode === 'manual' ? t('yc.sp.rl.notifyConfirm') : t('yc.sp.rl.notifyConfirmOpen'))) return;
    m.notify.mutate(d.id, {
      onSuccess: () => toast(t('yc.sp.rl.notifyDone')),
      onError: (e) => { const c = rpcCode(e); toast(['not_attente', 'already_notified', 'incomplete'].includes(c) ? t(`yc.sp.e.${c === 'incomplete' ? 'incomplete' : c}`) : t('yc.sp.err')); },
    });
  };

  const meta = (k: RelanceStepId): [string, string] => {
    if (k === 'open') {
      const w = d.kind === 'prevente' ? t('yc.sp.rl.prevente.openW', { d: dt(d.sale_opens_at, locale).replace(' · ', lang === 'en' ? ' at ' : lang === 'es' ? ' a las ' : ' à ') || '…' }) : t(`yc.sp.rl.${d.kind}.openW`);
      return [t(`yc.sp.rl.${d.kind}.open`), w];
    }
    if (k === 'nudge') return [t('yc.sp.rl.nudge'), d.kind === 'attente' ? t('yc.sp.rl.nudgeWAtt') : t('yc.sp.rl.nudgeW')];
    return [t('yc.sp.rl.last'), t('yc.sp.rl.lastW')];
  };
  const DL: Partial<Record<RelanceStepId, readonly string[]>> = { nudge: NUDGE_DELAYS, last: LAST_DELAYS };
  let tot = 0;
  const cards = steps.map((k, i) => {
    const r = rel[k] as RelanceStep;
    const on = !!r.on;
    const eN = k === 'open' ? x.reach.all_email : x.reach.nobuy_email;
    const sN = k === 'open' ? x.reach.all_sms : x.reach.nobuy_sms;
    const rec = k === 'open' ? d.n : Math.max(0, d.n - (d.buyers ?? 0));
    const cost = (r.email ? eN : 0) + (r.sms ? sN * smsRate : 0);
    if (on) tot += cost;
    return { k, i, r, on, eN, sN, rec, cost };
  });
  const over = tot > balance;
  const sentTot = (x.sent?.[sel] ?? 0);
  const rs = (rel[sel] ?? rel.open) as RelanceStep;
  const cfg = pageCfg(d, host, t, locale);
  const h2: CSSProperties = { margin: 0, fontFamily: "'Bricolage Grotesque'", fontWeight: 600, fontSize: 24, letterSpacing: '-.03em' };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
      <div style={{ flex: '1.5 1 480px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <h2 style={h2}>{t('yc.sp.f.relT')}</h2>
          <div style={{ fontSize: 14, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.sp.f.relS1')}<Link to={CRM_ROUTES.automations} style={{ fontWeight: 600 }}>{t('yc.sp.f.relS2')}</Link>{t('yc.sp.f.relS3')}</div>
        </div>
        {cards.map(({ k, i, r, on, eN, sN, rec, cost }) => {
          const [title, when] = meta(k);
          const selected = sel === k;
          const select = () => setSel(k);
          return (
            <article key={k} style={{ borderRadius: 24, background: '#fff', borderWidth: 1.5, borderStyle: 'solid', borderColor: selected && on ? 'var(--sand-400)' : 'var(--sand-200)', boxShadow: selected && on ? 'var(--shadow-md)' : 'none', overflow: 'hidden', transition: 'border-color 240ms,box-shadow 240ms' }}>
              <Hv as="div" role="button" tabIndex={0} onClick={select} onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); select(); } }}
                style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 22px', cursor: 'pointer' }} hover={{ background: 'var(--sand-50)' }}>
                <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 99, background: on ? 'var(--ink)' : 'var(--sand-200)', color: on ? '#fff' : 'var(--sand-600)', display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 600 }}>{i + 1}</span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <b style={{ fontSize: 16, letterSpacing: '-.01em' }}>{title}</b>
                  <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--sand-600)' }}>{when}</span>
                </span>
                <button type="button" role="switch" aria-checked={on} aria-label={t(on ? 'yc.sp.rl.off' : 'yc.sp.rl.on', { t: title })} disabled={!caps.write}
                  onClick={(e) => { e.stopPropagation(); up(k, { on: !on }); setSel(k); }}
                  style={{ flex: 'none', width: 48, height: 28, padding: 3, boxSizing: 'border-box', border: 0, borderRadius: 99, background: on ? 'var(--green-500)' : 'var(--sand-300)', cursor: caps.write ? 'pointer' : 'default', transition: 'background 220ms' }}>
                  <span style={{ display: 'block', width: 22, height: 22, borderRadius: 99, background: '#fff', boxShadow: 'var(--shadow-xs)', transform: `translateX(${on ? 20 : 0}px)`, transition: 'transform 260ms cubic-bezier(.34,1.56,.64,1)' }} />
                </button>
              </Hv>
              {on && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 22px 22px', borderTop: '1px solid var(--sand-100)', background: 'var(--sand-50)' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 18px' }}>
                    <span style={{ display: 'flex', gap: 6 }}>
                      {([['email', 'E-mail', SP_ICON.mail], ['sms', 'SMS', SP_ICON.sms]] as const).map(([c, l, dd]) => {
                        const con = !!r[c];
                        return (
                          <button key={c} type="button" onClick={() => up(k, { [c]: !con })} aria-pressed={con} disabled={!caps.write}
                            style={{ height: 36, padding: '0 14px 0 10px', borderRadius: 99, borderWidth: 1.5, borderStyle: 'solid', borderColor: con ? 'var(--red-400)' : 'var(--sand-200)', background: con ? 'var(--red-50)' : '#fff', fontSize: 14, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                            <SpSvg d={dd} size={15} sw={2.2} />{l}
                          </button>
                        );
                      })}
                    </span>
                    {DL[k] && (
                      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{t('yc.sp.rl.send')}</span>
                        {DL[k]!.map((dl) => {
                          const don = (r.delay || (k === 'nudge' ? '48h' : '2d')) === dl;
                          return (
                            <button key={dl} type="button" onClick={() => up(k, { delay: dl })} aria-pressed={don} disabled={!caps.write}
                              style={{ height: 32, padding: '0 12px', borderRadius: 99, borderWidth: 1, borderStyle: 'solid', borderColor: don ? 'var(--ink)' : 'var(--sand-200)', background: don ? 'var(--ink)' : '#fff', fontSize: 13, fontWeight: 600, color: don ? '#fff' : 'var(--sand-700)', cursor: 'pointer' }}>{t(`yc.sp.rl.d.${dl}`)}</button>
                          );
                        })}
                      </span>
                    )}
                  </div>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t('yc.sp.rl.msg')}</span>
                    <textarea value={r.msg} onChange={(e) => up(k, { msg: e.target.value })} rows={3} maxLength={480} readOnly={!caps.write} onFocus={() => setSel(k)}
                      style={{ boxSizing: 'border-box', width: '100%', padding: '12px 14px', borderRadius: 12, borderWidth: 1.5, borderStyle: 'solid', borderColor: 'var(--sand-200)', background: '#fff', fontSize: 15, lineHeight: 1.45, color: 'var(--ink)', outline: 0, resize: 'vertical' }} />
                    <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.sp.rl.msgHint')}</span>
                  </label>
                  {r.sms && !CRM_SMS_SIGNUP_LIVE && <span style={{ fontSize: 12.5, color: 'var(--amber-700)' }}>{t('yc.sp.w.smsSoon')}</span>}
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '6px 14px', padding: '10px 14px', borderRadius: 12, background: '#fff', fontSize: 13.5, color: 'var(--sand-600)' }}>
                    <span>{none ? t('yc.sp.rl.reachNone') : tp(k === 'open' ? 'yc.sp.rl.reach' : 'yc.sp.rl.reachNoBuy', rec, { n: n(rec), e: n(eN), s: n(sN) })}</span>
                    <b style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{none ? t('yc.sp.rl.costNone') : cost ? t('yc.sp.rl.cost', { n: n(cost) }) : t('yc.sp.rl.noChannel')}</b>
                  </div>
                  {k === 'open' && d.kind === 'attente' && caps.write && d.state !== 'draft' && (
                    d.notified_at
                      ? <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--green-700)' }}>{t('yc.sp.rl.notified', { d: dtAt(d.notified_at, locale, lang) })}{x.sent?.open ? ` · ${tp('yc.sp.rl.sent', x.sent.open)}` : ''}</span>
                      : (
                        <Hv as="button" type="button" onClick={notify} disabled={m.notify.isPending}
                          style={{ alignSelf: 'flex-start', height: 42, padding: '0 18px', borderRadius: 99, border: 0, background: 'var(--ink)', color: '#fff', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}
                          hover={{ background: 'var(--sand-700)' }} active={{ transform: 'scale(.97)' }}>
                          <SpSvg d={SP_ICON.send} size={15} sw={2.2} />{t('yc.sp.rl.notify')}
                        </Hv>
                      )
                  )}
                  {k !== 'open' || d.kind !== 'attente' ? (x.sent?.[k] ? <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{tp('yc.sp.rl.sent', x.sent[k] ?? 0)}</span> : null) : null}
                </div>
              )}
            </article>
          );
        })}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px 16px', padding: '14px 18px', borderRadius: 16, background: over ? 'var(--amber-50)' : 'var(--sand-50)', fontSize: 14, color: over ? 'var(--amber-700)' : 'var(--sand-600)' }}>
          <span>{none ? t('yc.sp.rl.totNone') : over ? t('yc.sp.rl.totOver', { t: n(tot), b: n(balance) }) : t('yc.sp.rl.tot', { t: n(tot), b: n(balance) })}</span>
          <Link to={CRM_ROUTES.yunits} style={{ fontWeight: 600 }}>{t('yc.sp.rl.topup')}</Link>
        </div>
      </div>
      <aside style={{ flex: '1 1 340px', minWidth: 0, position: 'sticky', top: 88, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '22px 16px 20px', borderRadius: 28, background: 'radial-gradient(90% 60% at 50% 0%,rgba(255,107,53,.1),transparent 70%),var(--sand-50)', boxShadow: 'inset 0 0 0 1px var(--sand-200)', boxSizing: 'border-box' }}>
        <span style={{ ...monoLabel, alignSelf: 'flex-start', paddingLeft: 4 }}>{t('yc.sp.rl.aside')}</span>
        <Seg aria={t('yc.sp.w.channel')} value={ch} onChange={setCh} h={32} fs={13.5} padX={16} items={[{ v: 'email', l: t('yc.sp.w.chEmail') }, { v: 'sms', l: t('yc.sp.w.chSms') }]} />
        <InscriptionPhone cfg={cfg} scene={ch} scale={0.82} msgText={rs.msg} onToast={toast} />
        {sentTot > 0 && <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{tp('yc.sp.rl.sent', sentTot)}</span>}
      </aside>
    </div>
  );
}
