/**
 * SMS · Résultats (maquette « SMS Resultats.dc.html ») : `/crm/sms/results/:id`.
 *
 * Combien il a fait vendre (achats dans les 7 jours après le SMS par ceux qui
 * l'ont reçu), ce que les clients ont reçu, quatre chiffres comparés à votre
 * moyenne, quand ils ont cliqué, ce qu'ils sont devenus, les STOP, et la
 * relance de ceux qui n'ont pas acheté. Chiffres : crm_sms_result.
 */
import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Skel } from '@/crm/ui/kit';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { useCrmToast } from '@/crm/ui/toast';
import { EASE, useProgress } from '@/crm/ui/motion';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps, useCrmScope } from '@/crm/scope';
import { useCrmShell } from '@/crm/data/shell';
import { useSmsActions, useSmsResult, useSmsSettings } from '@/crm/data/sms';
import { audienceLabel, rate, shortName } from '@/crm/lib/emails';
import { countSms, defaultSender, SAMPLE_LINK, smsCost, smsFinalText } from '@/crm/lib/sms';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { SmsPhone } from '../SmsPhone';

const enter = (d: number) => ({ animation: `yc-rise 800ms ${EASE} ${d}ms both` });
const BUCKETS = ['0–5 min', '5–15 min', '15–30 min', '30–60 min', '1–3 h', '3–24 h', '1–7'];
/** Seuil d'alerte des STOP (part des envois). */
const STOP_ALERT = 0.01;

export default function SmsResultPage() {
  const { id = '' } = useParams<{ id: string }>();
  const T = useCrmT();
  const { t, tp, n, eur, eur2, pct, dLong, dShort, time, lang } = T;
  const nav = useNavigate();
  const toast = useCrmToast();
  const caps = useCrmCaps();
  const { space } = useCrmScope();
  const shell = useCrmShell();
  const settings = useSmsSettings();
  const act = useSmsActions();
  const q = useSmsResult(id);
  const r = q.data;
  const g = useProgress(1200, 500, r?.id ?? 'wait', !!r);
  const smsRate = Number(shell.data?.wallet.rates?.sms ?? 40);

  const s = r?.stats ?? null;
  const avg = r?.avg;
  const tl = useMemo(() => {
    const total = (r?.timeline ?? []).reduce((a, x) => a + x.clicks, 0);
    return { total, rows: (r?.timeline ?? []).map((x) => ({ ...x, p: total ? x.clicks / total : 0 })) };
  }, [r]);

  if (q.isLoading || !r) {
    return <main style={{ maxWidth: 1280, margin: '0 auto', padding: 'clamp(24px,3vw,36px) clamp(16px,3vw,40px)' }}>{q.isError && !r ? <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /> : <Skel h={520} r={28} />}</main>;
  }
  if (r.error === 'not_found' || !s) {
    return (
      <main style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <YunitFace mood="inquiet" size={56} />
          <b style={{ fontFamily: 'var(--font-display)', fontSize: 22 }}>{t(r.error ? 'yc.sm.co.notFound' : 'yc.sm.rs.notSent')}</b>
          <Hv as={Link} to={CRM_ROUTES.smsCampaigns} style={{ height: 44, padding: '0 20px', borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none' }} hover={{ color: '#fff', textDecoration: 'none' }}>{t('yc.sm.co.toList')}</Hv>
        </div>
      </main>
    );
  }

  const at = new Date(r.sent_at ?? r.created_at);
  const aud = audienceLabel(r.audiences, t) ?? t('yc.em.aud.none');
  const sender = r.sender_name || settings.data?.sender_name || defaultSender(space.name);
  const text = smsFinalText(r.body ?? '', { sender, lang, vals: { 'prénom': t('yc.sm.sample.name'), nom_club: space.name, 'soirée': r.event_title ?? '', lien: SAMPLE_LINK } });
  const k = countSms(text);
  const money = caps.money && s.revenue !== null;
  const perSms = money && s.n ? Number(s.revenue) / s.n : null;
  const avgPer = money && avg && avg.n && avg.revenue !== null ? Number(avg.revenue) / avg.n : null;
  const dr = rate(s.delivered, s.n) ?? 0, cr = rate(s.clicked, s.delivered) ?? 0;
  const drA = avg && avg.campaigns ? rate(avg.delivered, avg.n) : null, crA = avg && avg.campaigns ? rate(avg.clicked, avg.delivered) : null;
  const stopR = s.n ? s.stop / s.n : 0;
  const relaunch = s.non_buyers;
  const line = (d: { v: number; up: boolean } | null, unit: 'pt' | 'eur') => {
    if (!d) return { text: t('yc.sm.rs.noAvg'), fg: 'var(--sand-500)' };
    const v = unit === 'pt' ? t('yc.em.pt', { v: Math.abs(d.v).toFixed(1).replace('.', ',') }) : eur2(Math.abs(d.v / 100));
    return { text: t(d.up ? 'yc.sm.rs.vsAvgUp' : 'yc.sm.rs.vsAvgDown', { v }), fg: d.up ? 'var(--green-700)' : 'var(--red-600)' };
  };
  const perLine = line(perSms !== null && avgPer !== null ? { v: (perSms - avgPer) * 100, up: perSms >= avgPer } : null, 'eur');
  const first15 = tl.rows.slice(0, 2).reduce((a, x) => a + x.p, 0), firstH = tl.rows.slice(0, 4).reduce((a, x) => a + x.p, 0);

  const prepare = async () => {
    try {
      const nid = await act.duplicate(r.id, `${r.name ?? t('yc.sm.untitled')} — ${t('yc.sm.rs.relaunchName')}`);
      await act.save(nid, { exclude_buyers: true });
      nav(CRM_ROUTES.smsCompose(nid));
    } catch { toast(t('yc.em.ca.t.err')); }
  };

  return (
    <main style={{ flex: 1, width: '100%', maxWidth: 1280, boxSizing: 'border-box', margin: '0 auto', padding: 'clamp(24px,3vw,36px) clamp(16px,3vw,40px) 72px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Hv as={Link} to={CRM_ROUTES.smsCampaigns} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14.5, fontWeight: 600, color: 'var(--ink)', textDecoration: 'none', ...enter(60) }} hover={{ color: 'var(--red-600)', textDecoration: 'none' }}>
          <Icon name="arrowLeft" size={15} stroke={2.4} />{t('yc.sm.rs.all')}
        </Hv>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px 20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)', ...enter(100) }}>{t('yc.sm.rs.kick', { day: dLong(at), time: time(at) })}</span>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3.4vw,40px)', lineHeight: 1.05, letterSpacing: '-.035em', ...enter(160) }}>{r.name || t('yc.sm.untitled')}</h1>
            <span style={{ fontSize: 16, color: 'var(--sand-600)', ...enter(220) }}>{tp('yc.sm.rs.sub', k.parts, { n: n(s.n), aud, p: k.parts })}</span>
          </div>
          {caps.write && (
            <Hv as="button" type="button" onClick={async () => { try { const nid = await act.duplicate(r.id, `${r.name ?? ''} ${t('yc.em.ca.copy')}`); nav(CRM_ROUTES.smsSend(nid)); } catch { toast(t('yc.em.ca.t.err')); } }}
              style={{ height: 44, padding: '0 18px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--ink)', font: 'inherit', ...enter(260) }} hover={{ background: 'var(--paper)' }}>
              <Icon name="copy" size={16} stroke={2.2} />{t('yc.sm.ca.a.resend')}
            </Hv>
          )}
        </div>
        {r.others.length > 1 && (
          <div className="yc-noscroll" style={{ display: 'flex', gap: 8, overflowX: 'auto', ...enter(300) }}>
            {r.others.map((o) => {
              const on = o.id === r.id;
              return (
                <Hv key={o.id} as={Link} to={CRM_ROUTES.smsResults(o.id)} aria-current={on ? 'page' : undefined}
                  style={{ flex: 'none', height: 38, padding: '0 16px', borderRadius: 99, border: on ? 0 : '1px solid var(--sand-200)', background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink)', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', textDecoration: 'none' }}
                  hover={{ background: on ? 'var(--ink)' : 'var(--paper)', color: on ? '#fff' : 'var(--ink)', textDecoration: 'none' }}>
                  {dShort(o.sent_at)} · {shortName(o.name, 28)}
                </Hv>
              );
            })}
          </div>
        )}
      </div>

      {/* Ventes + téléphone */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
        <section style={{ flex: '1.6 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18, padding: 'clamp(20px,2.4vw,30px)', borderRadius: 28, background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)', ...enter(360) }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.sm.rs.sales.t')}</h2>
            <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2, maxWidth: 520 }}>{t('yc.sm.rs.sales.s')}</div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 22px' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(56px,7vw,96px)', lineHeight: 0.92, letterSpacing: '-.055em', fontVariantNumeric: 'tabular-nums' }}>
              {money ? eur(Number(s.revenue) * g) : n(s.purchases * g)}
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 8 }}>
              <b style={{ fontSize: 17 }}>{money ? tp('yc.sm.purchasesN', s.purchases, { n: n(s.purchases) }) : tp('yc.sm.rs.purchasesWord', s.purchases)}</b>
              <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{tp('yc.sm.rs.buyers', s.buyers, { n: n(s.buyers) })}</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,200px),1fr))', gap: 12, marginTop: 'auto' }}>
            {money && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '14px 16px', borderRadius: 18, background: 'var(--red-50)' }}>
                <span style={{ fontSize: 13, color: 'var(--sand-600)' }}>{t('yc.sm.rs.perSms')}</span>
                <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.02em' }}>{perSms !== null ? eur2(perSms) : '—'}</b>
                <span style={{ fontSize: 13, fontWeight: 600, color: perLine.fg }}>{perLine.text}</span>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '14px 16px', borderRadius: 18, background: 'var(--sand-50)' }}>
              <span style={{ fontSize: 13, color: 'var(--sand-600)' }}>{t('yc.sm.rs.yunits')}</span>
              <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.02em' }}>{n(smsCost(s.n, s.parts, smsRate))}</b>
              <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.sm.rs.yunitsCalc', { n: n(s.n), p: s.parts, r: smsRate })}</span>
            </div>
          </div>
        </section>
        <section style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '22px 18px 0', borderRadius: 28, background: 'linear-gradient(180deg,var(--sand-100),var(--sand-50))', boxShadow: 'inset 0 0 0 1px var(--sand-200)', overflow: 'hidden', ...enter(420) }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.sm.rs.received')}</span>
          <SmsPhone text={text} sender={sender} time={time(at)} size="sm" height={560} today={dShort(at)} placeholder={t('yc.sm.ph.empty')} multi={k.parts > 1 ? t('yc.sm.ph.multi', { n: k.parts }) : undefined} />
        </section>
      </div>

      {/* Quatre chiffres */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: 16 }}>
        {[
          { l: t('yc.sm.k.sent'), v: n(s.n * g), sub: aud, def: t('yc.sm.rs.k.sentDef') },
          { l: t('yc.sm.k.delivered'), v: pct(dr * 100 * g), ring: dr, d: line(drA !== null ? { v: (dr - drA) * 100, up: dr >= drA } : null, 'pt'), def: t('yc.sm.rs.k.deliveredDef', { n: n(s.delivered) }) },
          { l: t('yc.sm.k.clicked'), v: pct(cr * 100 * g, 1), ring: Math.min(1, cr * 2), d: line(crA !== null ? { v: (cr - crA) * 100, up: cr >= crA } : null, 'pt'), def: tp('yc.sm.rs.k.clickedDef', s.clicked, { n: n(s.clicked) }) },
          { l: t('yc.sm.k.bought'), v: n(s.purchases * g), sub: t('yc.sm.rs.k.boughtSub', { p: pct((rate(s.buyers, s.delivered) ?? 0) * 100, 1) }), def: t('yc.sm.k.boughtDef') },
        ].map((x, i) => (
          <Hv key={x.l} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '20px 22px', borderRadius: 20, background: '#fff', border: '1px solid var(--sand-200)', minWidth: 0, animation: `yc-rise 800ms ${EASE} ${480 + i * 70}ms both`, transition: `translate 240ms ${EASE},box-shadow 240ms` }} hover={{ translate: '0 -4px', boxShadow: 'var(--shadow-md)' }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--sand-600)' }}>{x.l}</span>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 44, lineHeight: 1.05, letterSpacing: '-.035em', fontVariantNumeric: 'tabular-nums' }}>{x.v}</span>
              {x.ring !== undefined && (
                <div style={{ position: 'relative', flex: 'none', width: 56, height: 56, borderRadius: '50%', background: `conic-gradient(var(--red-500) 0 ${(x.ring * 360 * g).toFixed(1)}deg,var(--red-100) 0)` }}>
                  <span style={{ position: 'absolute', inset: 9, borderRadius: '50%', background: '#fff' }} />
                </div>
              )}
            </div>
            {x.d ? <span style={{ fontSize: 13, fontWeight: 600, color: x.d.fg }}>{x.d.text}</span> : <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--sand-600)' }}>{x.sub}</span>}
            <span style={{ fontSize: 13, lineHeight: '18px', color: 'var(--sand-500)', marginTop: 4 }}>{x.def}</span>
          </Hv>
        ))}
      </div>

      {/* Quand ont-ils cliqué ? */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: 'clamp(20px,2.4vw,28px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', ...enter(620) }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.sm.rs.when.t')}</h2>
          <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.sm.rs.when.s')}</div>
        </div>
        {tl.total === 0 ? (
          <div style={{ height: 120, display: 'grid', placeItems: 'center', fontSize: 14, color: 'var(--sand-500)', borderRadius: 18, background: 'var(--sand-50)' }}>{t('yc.sm.rs.when.none')}</div>
        ) : (
          <>
            <div style={{ height: 200, display: 'flex', alignItems: 'flex-end', gap: 10 }}>
              {tl.rows.map((x, i) => {
                const top = Math.max(...tl.rows.map((y) => y.p), 0.01);
                return (
                  <div key={x.b} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'stretch', gap: 6 }}>
                    <b style={{ textAlign: 'center', fontSize: 14.5, fontVariantNumeric: 'tabular-nums' }}>{pct(x.p * 100)}</b>
                    <div style={{ height: `${(x.p / top) * 80 * Math.max(0, Math.min(1, g * 1.5 - i * 0.1))}%`, minHeight: 3, borderRadius: '6px 6px 0 0', background: i < 3 ? 'linear-gradient(180deg,var(--tangerine-500),var(--red-500))' : 'var(--red-100)' }} />
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {BUCKETS.map((b, i) => <span key={b} style={{ flex: 1, textAlign: 'center', fontSize: 12.5, color: 'var(--sand-500)' }}>{i === 6 ? t('yc.sm.rs.days17') : b}</span>)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 16, background: 'var(--red-50)' }}>
              <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 99, background: 'var(--red-500)' }} />
              <span style={{ fontSize: 15, lineHeight: 1.45, fontWeight: 500 }}>{t('yc.sm.rs.when.insight', { a: pct(first15 * 100), b: pct(firstH * 100) })}</span>
            </div>
          </>
        )}
      </section>

      {/* Parcours + STOP */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
        <section style={{ flex: '1.4 1 460px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: 'clamp(20px,2.4vw,28px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', ...enter(680) }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.sm.rs.f.t')}</h2>
            <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.sm.rs.f.s')}</div>
          </div>
          {([['sent', s.n], ['delivered', s.delivered], ['clicked', s.clicked], ['bought', s.purchases]] as [string, number][]).map(([key, v], i, arr) => {
            const prev = i ? arr[i - 1][1] : 0;
            const w = s.n > 0 ? Math.max(3, Math.sqrt(v / s.n) * 100 * Math.max(0, Math.min(1, g * 1.5 - i * 0.12))) : 3;
            return (
              <div key={key} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px,170px) 1fr', alignItems: 'center', gap: '6px 18px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{t(`yc.sm.f.${key}`)}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{i ? t('yc.em.f.conv', { p: pct(prev ? (v / prev) * 100 : 0) }) : t('yc.em.f.start')}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <div style={{ height: 26, width: `${w.toFixed(1)}%`, minWidth: 8, borderRadius: 99, background: i === arr.length - 1 ? 'var(--gradient-brand)' : i === 0 ? 'var(--sand-200)' : `color-mix(in srgb,var(--red-500) ${24 + i * 18}%,#fff)` }} />
                  <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, fontVariantNumeric: 'tabular-nums' }}>{n(v)}</b>
                </div>
              </div>
            );
          })}
        </section>
        <section style={{ flex: '1 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: 'clamp(20px,2.4vw,28px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', ...enter(740) }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.sm.rs.stop.t')}</h2>
            <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.sm.rs.stop.s')}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 48, letterSpacing: '-.04em', lineHeight: 1 }}>{t('yc.sm.ca.tl.stopN', { n: n(s.stop) })}</b>
            <span style={{ fontSize: 15, color: 'var(--sand-500)' }}>{t('yc.sm.ca.tl.stopP', { p: pct(stopR * 100, 1) })}</span>
          </div>
          <div style={{ position: 'relative', height: 10, borderRadius: 99, background: 'var(--sand-100)' }}>
            <div style={{ width: `${Math.min(100, (stopR / (STOP_ALERT * 2)) * 100 * g)}%`, height: '100%', borderRadius: 99, background: stopR > STOP_ALERT ? 'var(--red-500)' : 'var(--green-500)' }} />
            <span style={{ position: 'absolute', left: '50%', top: -6, width: 2, height: 22, background: 'var(--sand-400)' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--sand-500)' }}>
            <span>{pct(0)}</span><span>{t('yc.sm.rs.stop.alert', { p: pct(STOP_ALERT * 100) })}</span><span>{pct(STOP_ALERT * 200)}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, fontSize: 14, lineHeight: 1.45, color: 'var(--sand-700)' }}>
            <Icon name={stopR > STOP_ALERT ? 'alert' : 'check'} size={18} stroke={2.4} color={stopR > STOP_ALERT ? 'var(--red-600)' : 'var(--green-700)'} style={{ marginTop: 1, flex: 'none' }} />
            <span>{t(stopR > STOP_ALERT ? 'yc.sm.rs.stop.over' : 'yc.sm.rs.stop.under')}</span>
          </div>
        </section>
      </div>

      {/* Et maintenant ? */}
      {caps.write && relaunch > 0 && (
        <section style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px 24px', padding: 'clamp(22px,2.6vw,30px)', borderRadius: 28, color: 'var(--text-on-night)', background: 'radial-gradient(70% 90% at 100% 120%,rgba(227,20,27,.45),transparent 65%),var(--noise-night),var(--night)', ...enter(800) }}>
          <YunitFace mood="content" size={52} />
          <div style={{ flex: '1 1 360px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-on-night-2)' }}>{t('yc.sm.rs.next.k')}</span>
            <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(22px,2.4vw,28px)', letterSpacing: '-.03em', lineHeight: 1.15 }}>{tp('yc.sm.rs.next.t', relaunch, { n: n(relaunch) })}</b>
            <span style={{ fontSize: 14.5, color: 'var(--text-on-night-2)' }}>{t('yc.sm.rs.next.s', { y: n(smsCost(relaunch, s.parts, smsRate)) })}</span>
          </div>
          <Hv as="button" type="button" onClick={() => void prepare()} style={{ height: 46, padding: '0 22px', borderRadius: 99, border: 0, background: '#fff', color: 'var(--ink)', fontSize: 15, fontWeight: 600, cursor: 'pointer', font: 'inherit' }} hover={{ background: 'var(--sand-100)' }}>{t('yc.sm.rs.next.cta')}</Hv>
        </section>
      )}
    </main>
  );
}
