/**
 * SMS · Composer, étape 1 (maquette « SMS Composer.dc.html ») :
 * `/crm/sms/compose/:id` (`new`, `?t=<modèle>&event=<soirée>`).
 *
 * Le message, les variables (prénom, nom du club, soirée, lien Yuno), la
 * soirée vers laquelle mène le lien, ce que Yuno ajoute (expéditeur, mention
 * STOP), et à droite le téléphone tel que le client le recevra, avec la
 * longueur et le coût par contact. Le brouillon s'enregistre tout seul ; un
 * nouveau SMS ne naît qu'à la première modification.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Skel } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { EASE } from '@/crm/ui/motion';
import { useNarrow } from '@/crm/ui/useNarrow';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps, useCrmScope } from '@/crm/scope';
import { useCrmShell } from '@/crm/data/shell';
import { useNights } from '@/crm/data/nights';
import { smsErrorKey, useSmsActions, useSmsCampaigns, useSmsSettings } from '@/crm/data/sms';
import {
  countSms, CRM_SMS_SEND_OPEN, defaultSender, hasLink, isSmsTemplate, SAMPLE_LINK, simplifySms, SMS_TEMPLATES, smsFinalText, type SmsVar,
} from '@/crm/lib/sms';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { SmsPhone } from '../SmsPhone';
import { SmsSoonBanner } from '../SmsShell';
import { SmsFlowHeader, SmsStepTitle, type SmsStep } from '../flow/SmsFlowHeader';

const VARS: { k: SmsVar | 'lien'; token: string }[] = [
  { k: 'prénom', token: '{{prénom}}' }, { k: 'nom_club', token: '{{nom_club}}' }, { k: 'soirée', token: '{{soirée}}' }, { k: 'lien', token: '{{lien}}' },
];

export default function SmsComposePage() {
  const { id: rawId = 'new' } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const T = useCrmT();
  const { t, tp, n, dLong, lang } = T;
  const toast = useCrmToast();
  const caps = useCrmCaps();
  const narrow = useNarrow(980);
  const { space } = useCrmScope();
  const shell = useCrmShell();
  const settings = useSmsSettings();
  const nights = useNights();
  const camps = useSmsCampaigns();
  const act = useSmsActions();
  const smsRate = Number(shell.data?.wallet.rates?.sms ?? 35);
  const [testing, setTesting] = useState(false);

  const [id, setId] = useState<string | null>(rawId === 'new' ? null : rawId);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [eventId, setEventId] = useState<string | null>(null);
  const [tpl, setTpl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [raw, setRaw] = useState(false);
  const area = useRef<HTMLTextAreaElement | null>(null);

  const upcoming = useMemo(() => (nights.data?.nights ?? []).filter((x) => x.upcoming).sort((a, b) => a.start_at.localeCompare(b.start_at)), [nights.data]);
  const row = useMemo(() => (camps.data?.campaigns ?? []).find((c) => c.id === id) ?? null, [camps.data, id]);
  const locked = !caps.write || (!!row && row.status !== 'draft');

  // Premier état : le brouillon, sinon le modèle demandé, sinon une page blanche.
  useEffect(() => {
    if (ready) return;
    if (id) {
      if (!camps.data) return;
      if (!row) { setReady(true); return; }
      setName(row.name ?? ''); setBody(row.body ?? ''); setEventId(row.event_id); setTpl(row.tpl);
      setReady(true);
      return;
    }
    if (!nights.data) return;
    const tid = isSmsTemplate(sp.get('t')) ? sp.get('t')! : 'vide';
    const night = upcoming.find((x) => x.id === sp.get('event')) ?? upcoming[0] ?? null;
    setBody(t(`yc.sm.tpl.${tid}.body`));
    setTpl(tid);
    setEventId(night?.id ?? null);
    setName(tid === 'vide' ? t('yc.sm.co.newName') : night ? `${t(`yc.sm.tpl.${tid}.name`)} — ${night.title}` : t(`yc.sm.tpl.${tid}.name`));
    setReady(true);
  }, [ready, id, camps.data, row, nights.data, upcoming, sp, t]);

  const night = upcoming.find((x) => x.id === eventId) ?? (nights.data?.nights ?? []).find((x) => x.id === eventId) ?? null;
  const sender = settings.data?.sender_name || defaultSender(space.name);
  const sample = { 'prénom': t('yc.sm.sample.name'), nom_club: space.name, 'soirée': night?.title ?? t('yc.sm.sample.night'), lien: SAMPLE_LINK };
  const text = smsFinalText(body, { sender, lang, vals: sample });
  const k = countSms(text);
  const shown = raw ? body : text;

  // Enregistrement automatique (le premier crée le brouillon).
  const latest = useRef({ name, body, eventId, tpl, parts: k.parts });
  latest.current = { name, body, eventId, tpl, parts: k.parts };
  const save = async (): Promise<string | null> => {
    if (locked) return id;
    setSaving('saving');
    try {
      const l = latest.current;
      const nid = await act.save(id, { name: l.name || t('yc.sm.co.newName'), body: l.body, event_id: l.eventId, tpl: l.tpl, parts: l.parts, sender_name: settings.data?.sender_name || defaultSender(space.name) });
      if (!id) { setId(nid); nav(`${CRM_ROUTES.smsCompose(nid)}`, { replace: true }); }
      setDirty(false); setSaving('saved');
      return nid;
    } catch {
      setSaving('error'); toast(t('yc.sm.co.saveErr'));
      return null;
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!dirty || locked) return;
    const h = window.setTimeout(() => { void saveRef.current(); }, 900);
    return () => window.clearTimeout(h);
  }, [dirty, locked, name, body, eventId, tpl]);

  const edit = (fn: () => void) => { if (locked) return; fn(); setDirty(true); };
  const insert = (token: string) => edit(() => {
    const el = area.current;
    const s = el?.selectionStart ?? body.length, e = el?.selectionEnd ?? body.length;
    const before = body.slice(0, s), after = body.slice(e);
    const pad = before && !/\s$/.test(before) ? ' ' : '';
    const next = `${before}${pad}${token}${after}`;
    setBody(next);
    requestAnimationFrame(() => { if (el) { const p = (before + pad + token).length; el.focus(); el.setSelectionRange(p, p); } });
  });
  const applyTpl = (tid: string) => edit(() => {
    setBody(t(`yc.sm.tpl.${tid}.body`)); setTpl(tid);
    if (!name || name === t('yc.sm.co.newName')) setName(tid === 'vide' ? t('yc.sm.co.newName') : night ? `${t(`yc.sm.tpl.${tid}.name`)} — ${night.title}` : t(`yc.sm.tpl.${tid}.name`));
  });
  const go = async (s: SmsStep) => {
    if (s === 'msg') return;
    const nid = dirty || !id ? await save() : id;
    if (nid) nav(`${CRM_ROUTES.smsSend(nid)}${s === 'aud' ? '' : `?step=${s}`}`);
  };
  const keep = async () => { const nid = await save(); if (nid) { toast(t('yc.sm.co.kept')); nav(`${CRM_ROUTES.smsCampaigns}?s=draft`); } };

  const subLine = locked ? t('yc.sm.co.readonly')
    : saving === 'saving' ? t('yc.sm.co.saving') : saving === 'error' ? t('yc.sm.co.saveErr') : id ? t('yc.sm.co.saved') : t('yc.sm.co.notYet');

  if (!ready) return <div style={{ padding: 40 }}><Skel h={520} r={28} /></div>;
  if (id && !row && camps.data) {
    return (
      <div style={{ minHeight: '70vh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
          <b style={{ fontFamily: 'var(--font-display)', fontSize: 24 }}>{t('yc.sm.co.notFound')}</b>
          <Hv as={Link} to={CRM_ROUTES.smsCampaigns} style={{ height: 44, padding: '0 20px', borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none' }} hover={{ color: '#fff', textDecoration: 'none' }}>{t('yc.sm.co.toList')}</Hv>
        </div>
      </div>
    );
  }

  // Test gratuit : le SMS exact (variables remplies, « STOP au 30101 ») au
  // numéro de test des Réglages, sinon à celui du compte.
  const sendTest = async () => {
    if (testing || !caps.write) return;
    setTesting(true);
    try {
      const sid = await save();
      if (!sid) return;
      const r = await act.test(sid);
      toast(t('yc.sm.co.testSent', { phone: String(r.to ?? '') }));
    } catch (e) {
      toast(t(smsErrorKey(e)));
    } finally {
      setTesting(false);
    }
  };
  const testOff = !CRM_SMS_SEND_OPEN || !caps.write || testing || !body.trim();
  const testBtn = (
    <Hv
      as="button" type="button" disabled={testOff} title={CRM_SMS_SEND_OPEN ? t('yc.sm.co.testHint') : t('yc.sm.soon.badge')} onClick={() => void sendTest()}
      style={{ height: 42, padding: '0 16px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', color: testOff ? 'var(--sand-400)' : 'var(--ink)', fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: testOff ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', font: 'inherit' }}
      hover={{ background: testOff ? '#fff' : 'var(--paper)' }}
    >
      <Icon name="phone" size={16} stroke={2.2} />{testing ? '…' : t('yc.sm.co.test')}
      {!CRM_SMS_SEND_OPEN && <span style={{ height: 20, padding: '0 7px', borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center' }}>{t('yc.sm.soon.badge')}</span>}
    </Hv>
  );

  const titleNode = locked ? (name || t('yc.sm.untitled')) : (
    <input
      value={name} onChange={(e) => { const v = e.target.value; edit(() => setName(v)); }} aria-label={t('yc.sm.co.name')} maxLength={120}
      style={{ width: '100%', minWidth: 0, border: 0, outline: 0, background: 'transparent', padding: 0, font: 'inherit', color: 'var(--ink)', letterSpacing: 'inherit' }}
    />
  );

  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(70% 40% at 20% 0%,rgba(255,107,53,.06),transparent 70%),var(--paper)' }}>
      <SmsFlowHeader
        back={CRM_ROUTES.smsCampaigns} step="msg" onStep={(s) => void go(s)} right={testBtn}
        title={titleNode}
        sub={<>{!locked && saving !== 'error' && <Icon name="check" size={12} stroke={3} color="var(--green-700)" />}{subLine}</>}
      />
      <main style={{ maxWidth: 1180, margin: '0 auto', padding: 'clamp(24px,3vw,40px) clamp(16px,3vw,32px) 80px', display: 'grid', gridTemplateColumns: narrow ? 'minmax(0,1fr)' : 'minmax(0,1fr) 380px', gap: '28px 40px', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22, minWidth: 0, animation: `yc-rise 700ms ${EASE} both` }}>
          <SmsStepTitle kick={t('yc.sm.co.kick')} a={t('yc.sm.co.h.a')} b={t('yc.sm.co.h.b')} c={t('yc.sm.co.h.c')} sub={t('yc.sm.co.sub')} />
          <SmsSoonBanner compact />

          {!locked && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.sm.co.fromTpl')}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {SMS_TEMPLATES.map((x) => (
                  <Hv key={x.id} as="button" type="button" onClick={() => applyTpl(x.id)} aria-pressed={tpl === x.id}
                    style={{ height: 38, padding: '0 15px', borderRadius: 99, border: `1px solid ${tpl === x.id ? 'var(--red-300)' : 'var(--sand-200)'}`, background: tpl === x.id ? 'var(--red-50)' : '#fff', color: tpl === x.id ? 'var(--red-700)' : 'var(--ink)', fontSize: 14, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', font: 'inherit' }}
                    hover={{ background: tpl === x.id ? 'var(--red-50)' : 'var(--paper)' }}>
                    {t(`yc.sm.tpl.${x.id}.name`)}
                  </Hv>
                ))}
              </div>
            </div>
          )}

          {/* L'éditeur */}
          <section style={{ borderRadius: 24, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)', overflow: 'hidden' }}>
            {!locked && (
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '12px 18px', background: 'var(--sand-50)', borderBottom: '1px solid var(--sand-100)' }}>
                <span style={{ fontSize: 13.5, color: 'var(--sand-500)', marginRight: 4 }}>{t('yc.sm.co.insert')}</span>
                {VARS.map((v) => (
                  <Hv key={v.k} as="button" type="button" onClick={() => insert(v.token)}
                    style={{ height: 34, padding: '0 13px', borderRadius: 99, border: v.k === 'lien' ? 0 : '1px solid var(--sand-200)', background: v.k === 'lien' ? 'var(--ink)' : '#fff', color: v.k === 'lien' ? '#fff' : 'var(--ink)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', font: 'inherit' }}
                    hover={{ background: v.k === 'lien' ? 'var(--sand-700)' : 'var(--paper)' }}>
                    {v.k === 'lien' && <Icon name="link" size={14} stroke={2.2} />}{t(`yc.sm.co.var.${v.k}`)}
                  </Hv>
                ))}
              </div>
            )}
            <textarea
              ref={area} value={body} readOnly={locked} onChange={(e) => { const v = e.target.value; edit(() => setBody(v)); }}
              aria-label={t('yc.sm.co.body')} placeholder={t('yc.sm.co.ph')} rows={6}
              style={{ display: 'block', width: '100%', boxSizing: 'border-box', minHeight: 170, padding: '20px 22px', border: 0, outline: 0, resize: 'vertical', fontSize: 17, lineHeight: 1.5, fontFamily: 'inherit', color: 'var(--ink)', background: '#fff' }}
            />
            <div style={{ padding: '14px 22px 18px', borderTop: '1px solid var(--sand-100)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ height: 8, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, (k.length / (k.parts * (k.encoding === 'GSM-7' ? (k.parts === 1 ? 160 : 153) : (k.parts === 1 ? 70 : 67)))) * 100).toFixed(1)}%`, height: '100%', borderRadius: 99, background: k.parts > 2 ? 'var(--red-500)' : k.parts > 1 ? 'var(--amber-500)' : 'var(--green-500)', transition: `width 220ms ${EASE}` }} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: '6px 16px' }}>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 28, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{n(k.length)}</b>
                  <span style={{ fontSize: 14.5, color: 'var(--sand-600)' }}>{tp('yc.sm.co.chars', k.length)} · <b style={{ color: k.parts > 1 ? 'var(--amber-700)' : 'var(--green-700)' }}>{tp('yc.sm.tp.parts', k.parts, { n: k.parts })}</b></span>
                </span>
                <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{tp('yc.sm.co.left', k.left, { n: n(k.left), p: k.parts + 1 })}</span>
              </div>
              {k.bad.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 14, background: 'var(--amber-50)', fontSize: 13.5, color: 'var(--amber-700)' }}>
                  <span style={{ flex: '1 1 260px' }}>{t('yc.sm.co.bad', { c: k.bad.join(' ') })}</span>
                  {!locked && <Hv as="button" type="button" onClick={() => edit(() => setBody(simplifySms(body)))} style={{ height: 32, padding: '0 14px', borderRadius: 99, border: 0, background: '#fff', color: 'var(--ink)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', font: 'inherit' }} hover={{ background: 'var(--sand-50)' }}>{t('yc.sm.co.simplify')}</Hv>}
                </div>
              )}
            </div>
          </section>

          {/* Le lien */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 'clamp(18px,2.2vw,24px)', borderRadius: 24, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
            <div>
              <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em' }}>{t('yc.sm.co.link.t')}</h2>
              <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--sand-500)', marginTop: 2, maxWidth: 560 }}>{t('yc.sm.co.link.s')}</div>
            </div>
            {!hasLink(body) && (
              <span style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8, height: 30, padding: '0 12px', borderRadius: 99, background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 13, fontWeight: 600 }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor' }} />{t('yc.sm.co.link.none')}
                {!locked && <button type="button" onClick={() => insert('{{lien}}')} style={{ border: 0, background: 'none', padding: 0, color: 'var(--ink)', fontSize: 13, fontWeight: 600, textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>{t('yc.sm.co.link.add')}</button>}
              </span>
            )}
            {upcoming.length === 0 ? (
              <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{t('yc.sm.co.link.noNight')}</span>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,180px),1fr))', gap: 10 }}>
                {upcoming.slice(0, 6).map((x) => {
                  const on = x.id === eventId;
                  return (
                    <Hv key={x.id} as="button" type="button" onClick={() => edit(() => setEventId(x.id))} aria-pressed={on}
                      style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 16px', borderRadius: 16, border: `1.5px solid ${on ? 'var(--red-400)' : 'var(--sand-200)'}`, background: on ? 'var(--red-50)' : '#fff', textAlign: 'left', cursor: locked ? 'default' : 'pointer', color: 'var(--ink)', font: 'inherit' }}
                      hover={{ borderColor: on ? 'var(--red-400)' : 'var(--sand-300)' }}>
                      <b style={{ fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.title}</b>
                      <span style={{ fontSize: 13, color: on ? 'var(--red-700)' : 'var(--sand-500)', textTransform: 'capitalize' }}>{dLong(x.start_at)}</span>
                    </Hv>
                  );
                })}
              </div>
            )}
            {night && (
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px', padding: '12px 14px', borderRadius: 14, background: 'var(--sand-50)', fontSize: 13.5, color: 'var(--sand-600)' }}>
                <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--red-600)' }}>yunoapp.eu/l/…</code>
                <Icon name="arrowRight" size={13} stroke={2.2} color="var(--sand-400)" />
                <span>{t('yc.sm.co.link.to', { title: night.title })}</span>
              </div>
            )}
          </section>

          {/* Ce que Yuno ajoute */}
          <section style={{ display: 'flex', flexDirection: 'column', padding: 'clamp(18px,2.2vw,24px)', borderRadius: 24, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em' }}>{t('yc.sm.co.added.t')}</h2>
            <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2, marginBottom: 8 }}>{t('yc.sm.co.added.s')}</div>
            {[
              { ic: 'user' as const, title: t('yc.sm.co.added.from', { name: sender }), sub: t('yc.sm.co.added.fromS'), link: caps.write ? CRM_ROUTES.smsSettings : null },
              { ic: 'lock' as const, title: t('yc.sm.co.added.stop'), sub: t('yc.sm.co.added.stopS'), link: null },
            ].map((r) => (
              <div key={r.title} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 0', borderTop: '1px solid var(--sand-100)' }}>
                <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 10, background: 'var(--sand-100)', color: 'var(--sand-600)', display: 'grid', placeItems: 'center' }}><Icon name={r.ic} size={16} stroke={2.2} /></span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <b style={{ fontSize: 15 }}>{r.title}</b>
                  <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--sand-500)' }}>{r.sub}</span>
                </span>
                {r.link && <Hv as={Link} to={r.link} style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', textDecoration: 'none' }} hover={{ color: 'var(--red-600)', textDecoration: 'none' }}>{t('yc.sm.ca.a.edit')}</Hv>}
              </div>
            ))}
          </section>

          {!locked && (
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 }}>
              <Hv as="button" type="button" onClick={() => void keep()} style={{ height: 48, padding: '0 22px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', color: 'var(--ink)', font: 'inherit' }} hover={{ background: 'var(--paper)' }}>{t('yc.sm.co.keep')}</Hv>
              <Hv as="button" type="button" onClick={() => void go('aud')} disabled={!body.trim()}
                style={{ height: 48, padding: '0 6px 0 22px', borderRadius: 99, border: 0, background: body.trim() ? 'var(--gradient-brand)' : 'var(--sand-200)', color: '#fff', fontSize: 15.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 12, boxShadow: body.trim() ? 'var(--shadow-cta)' : 'none', cursor: body.trim() ? 'pointer' : 'not-allowed', font: 'inherit' }}
                hover={{ filter: body.trim() ? 'brightness(1.05)' : 'none' }}>
                {t('yc.sm.co.next')}
                <span style={{ width: 36, height: 36, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><Icon name="arrowRight" size={16} stroke={2.4} /></span>
              </Hv>
            </div>
          )}
        </div>

        {/* Le téléphone */}
        <aside style={{ position: narrow ? 'static' : 'sticky', top: 88, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, animation: `yc-rise 700ms ${EASE} 120ms both` }}>
          <div role="group" aria-label={t('yc.sm.co.view')} style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--sand-100)', borderRadius: 99 }}>
            {[false, true].map((v) => (
              <button key={String(v)} type="button" onClick={() => setRaw(v)} aria-pressed={raw === v} style={{ height: 34, padding: '0 16px', border: 0, borderRadius: 99, background: raw === v ? '#fff' : 'transparent', boxShadow: raw === v ? 'var(--shadow-xs)' : 'none', fontSize: 14, fontWeight: 600, color: raw === v ? 'var(--ink)' : 'var(--sand-600)', cursor: 'pointer', font: 'inherit' }}>{t(v ? 'yc.sm.co.raw' : 'yc.sm.co.named')}</button>
            ))}
          </div>
          <SmsPhone text={shown} raw={raw} sender={sender} time="10:30" size="lg" height={620} today={t('yc.sm.ph.today')} placeholder={t('yc.sm.ph.empty')} multi={k.parts > 1 ? t('yc.sm.ph.multi', { n: k.parts }) : undefined} />
          <div style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            {[[n(k.length), tp('yc.sm.co.chars', k.length)], [String(k.parts), t('yc.sm.ca.tl.parts')], [n(k.parts * smsRate), t('yc.sm.co.perContact')]].map(([v, l]) => (
              <div key={l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '12px 6px', borderRadius: 16, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', textAlign: 'center' }}>
                <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>{v}</b>
                <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{l}</span>
              </div>
            ))}
          </div>
          <div style={{ width: '100%', boxSizing: 'border-box', padding: '12px 16px', borderRadius: 16, background: 'var(--sand-50)', fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>{t('yc.sm.co.costNote', { y: n(k.parts * smsRate) })}</div>
        </aside>
      </main>
    </div>
  );
}
