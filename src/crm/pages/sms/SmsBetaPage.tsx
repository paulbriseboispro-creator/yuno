/**
 * Campagnes · SMS — BÊTA PRIVÉE (2026-10-19, décision de Paul). Le SMS
 * s'ouvre compte par compte : chaque expéditeur est mis en route avec l'équipe
 * Yuno avant son premier envoi (nom affiché, identité de l'annonceur, ligne
 * d'envoi chez l'opérateur). Tant que l'accès du compte n'est pas ouvert
 * (`useSmsAccess`), toutes les adresses /crm/sms/* rendent cette page : la
 * demande (usages, volume, nom d'expéditeur souhaité) part en alerte au super
 * admin, qui ouvre l'accès depuis l'Admin CRM. Le téléphone alterne le SMS reçu
 * et le texte écrit (variables en pastille) jusqu'au premier clic.
 */
import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion, EASE, SPRING } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps, useCrmScope } from '@/crm/scope';
import { defaultSender, SAMPLE_LINK, senderIdError, smsFinalText } from '@/crm/lib/sms';
import { SMS_USE_CASES, SMS_VOLUMES, smsAccessSteps, useSmsAccess } from '@/crm/data/smsAccess';
import type { SmsAccessStep, SmsUseCase, SmsVolume } from '@/crm/data/smsAccess';
import { SmsPhone } from '@/crm/pages/sms/SmsPhone';
import { ComingSoon } from '@/crm/pages/soon/ComingSoon';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Modal } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';

const P = {
  aud: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  msg: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  from: 'M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01',
  plan: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
};
const STEPS: SmsAccessStep[] = ['request', 'check', 'line', 'first'];

export default function SmsBetaPage() {
  const { t, lang } = useCrmT();
  const { space } = useCrmScope();
  const access = useSmsAccess();
  const [tab, setTab] = useState<'received' | 'written'>('received');
  const [asking, setAsking] = useState(false);
  const manual = useRef(false);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const h = setInterval(() => { if (!manual.current) setTab((x) => (x === 'received' ? 'written' : 'received')); }, 4200);
    return () => clearInterval(h);
  }, []);

  const sender = defaultSender(space.name);
  const body = t('yc.smsSoon.sample');
  const text = tab === 'received'
    ? smsFinalText(body, { sender, lang, vals: { 'prénom': t('yc.smsSoon.sampleName'), nom_club: space.name, 'soirée': null, lien: SAMPLE_LINK } })
    : body;
  const steps = smsAccessSteps(access.status);

  return (
    <>
      <ComingSoon
        feature="sms"
        badge={{ label: t('yc.smsBeta.badge'), tone: 'beta' }}
        heroLabel={t('yc.smsBeta.heroLabel')}
        eyebrow={t('yc.smsSoon.eyebrow')}
        title={[t('yc.smsSoon.title1'), t('yc.smsSoon.titleAccent'), t('yc.smsSoon.title2')]}
        sub={t('yc.smsBeta.sub')}
        hero={t('yc.smsSoon.hero')}
        heroSub={t('yc.smsBeta.heroSub')}
        steps={[1, 2, 3].map((i) => ({ b: t(`yc.smsSoon.s${i}b`), t: t(`yc.smsSoon.s${i}t`) }))}
        cta={<AccessCta access={access} onAsk={() => setAsking(true)} />}
        tabs={[{ k: 'received', l: t('yc.smsSoon.tabReceived') }, { k: 'written', l: t('yc.smsSoon.tabWritten') }]}
        tab={tab}
        onTab={(k) => { manual.current = true; setTab(k as 'received' | 'written'); }}
        phone={<SmsPhone text={text} sender={sender} raw={tab === 'written'} height={610} today={t('yc.sm.ph.today')} placeholder={t('yc.sm.ph.empty')} />}
        setupTitle={t('yc.smsBeta.setup')}
        setup={[
          { t: t('yc.smsSoon.setup1'), s: t('yc.smsSoon.setup1s'), d: P.aud },
          { t: t('yc.smsSoon.setup2'), s: t('yc.smsSoon.setup2s'), d: P.msg },
          { t: t('yc.smsSoon.setup3'), s: t('yc.smsSoon.setup3s'), d: P.from },
          { t: t('yc.smsSoon.setup4'), s: t('yc.smsSoon.setup4s'), d: P.plan },
        ]}
        setupSub={t('yc.smsSoon.setupSub')}
        measureSub={t('yc.smsBeta.measureSub')}
        measures={[['1', '100%'], ['2', '92%'], ['3', '34%'], ['4', '14%']].map(([i, h]) => ({ l: t(`yc.smsSoon.m${i}`), d: t(`yc.smsSoon.m${i}s`), h }))}
        insight={t('yc.smsSoon.insight')}
        trackTitle={t('yc.smsBeta.track')}
        trackItems={STEPS.map((k) => ({ l: t(`yc.smsBeta.st.${k}`), s: t(`yc.smsBeta.st.${k}s`), st: steps[k] }))}
      />
      {asking && <RequestModal sender={sender} access={access} onClose={() => setAsking(false)} />}
    </>
  );
}

type Access = ReturnType<typeof useSmsAccess>;

/** Le bouton du bloc nuit : demander, demande en cours, ou refus à reformuler. */
function AccessCta({ access, onAsk }: { access: Access; onAsk: () => void }) {
  const { t, dShort } = useCrmT();
  const caps = useCrmCaps();
  const requested = access.status === 'requested';

  if (requested) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 18px', borderRadius: 20, background: 'rgba(255,255,255,.07)', boxShadow: 'inset 0 0 0 1px var(--border-night)', maxWidth: 520, animation: `yc-pop 300ms ${EASE} both` }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15.5, fontWeight: 600, color: '#fff' }}>
          <span style={{ flex: 'none', width: 24, height: 24, borderRadius: 99, background: 'var(--green-500)', display: 'grid', placeItems: 'center' }}><Icon name="check" size={13} stroke={3} /></span>
          {access.data?.requested_at ? t('yc.smsBeta.sentOn', { date: dShort(access.data.requested_at) }) : t('yc.smsBeta.sent')}
        </span>
        <span style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--text-on-night-2)', textWrap: 'pretty' }}>{t('yc.smsBeta.sentBody')}</span>
        {caps.write && (
          <Hv as="button" type="button" onClick={onAsk} style={{ alignSelf: 'flex-start', height: 34, padding: '0 2px', border: 0, background: 'none', fontSize: 14, fontWeight: 600, color: 'var(--text-on-night-2)', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }} hover={{ color: '#fff' }}>
            {t('yc.smsBeta.edit')}
          </Hv>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 18px' }}>
      {caps.write ? (
        <Hv
          as="button"
          type="button"
          onClick={onAsk}
          disabled={!access.loaded}
          style={{ height: 50, padding: '0 6px 0 24px', border: 0, borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 16, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 12, boxShadow: 'var(--shadow-cta)', cursor: 'pointer', whiteSpace: 'nowrap', transition: `transform 200ms ${SPRING},filter 160ms`, opacity: access.loaded ? 1 : 0.6 }}
          hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }}
          active={{ transform: 'scale(.97)' }}
        >
          {t(access.status === 'declined' ? 'yc.smsBeta.askAgain' : 'yc.smsBeta.ask')}
          <span style={{ width: 38, height: 38, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><Icon name="lock" size={16} stroke={2.2} /></span>
        </Hv>
      ) : (
        <span style={{ fontSize: 14.5, color: 'var(--text-on-night-2)' }}>{t('yc.smsBeta.readOnly')}</span>
      )}
      <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--text-on-night-2)', maxWidth: 300, textWrap: 'pretty' }}>
        {t(access.status === 'declined' ? 'yc.smsBeta.declinedHow' : 'yc.smsBeta.how')}
      </span>
    </div>
  );
}

const chip = (on: boolean) => ({
  height: 38, padding: '0 14px', borderRadius: 99, border: 0, cursor: 'pointer', fontSize: 14, fontWeight: 600,
  display: 'inline-flex', alignItems: 'center', gap: 7,
  background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink)',
  boxShadow: on ? 'none' : 'inset 0 0 0 1.5px var(--sand-200)',
  transition: 'background 140ms,color 140ms',
}) as const;
const label = { fontSize: 14, fontWeight: 600 } as const;

/** La demande : deux minutes, ce qu'il faut pour préparer la ligne d'envoi. */
function RequestModal({ sender, access, onClose }: { sender: string; access: Access; onClose: () => void }) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const prev = access.data;
  const [uses, setUses] = useState<SmsUseCase[]>(() => (prev?.use_cases ?? []).filter((u): u is SmsUseCase => (SMS_USE_CASES as readonly string[]).includes(u)));
  const [volume, setVolume] = useState<SmsVolume | null>(prev?.volume ?? null);
  const [wish, setWish] = useState(prev?.sender_wish || sender);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const wishErr = wish ? senderIdError(wish) : null;
  const ready = uses.length > 0 && volume !== null && !wishErr && !access.pending;

  const toggle = (u: SmsUseCase) => setUses((x) => (x.includes(u) ? x.filter((y) => y !== u) : [...x, u]));
  const submit = async () => {
    if (!ready || !volume) return;
    setErr(null);
    try {
      await access.request({ useCases: uses, volume, senderWish: wish, note });
      toast(t('yc.smsBeta.toast'));
      onClose();
    } catch {
      setErr(t('yc.smsBeta.failed'));
    }
  };

  return (
    <Modal open onClose={onClose} width={600} label={t('yc.smsBeta.mTitle')}>
      <div style={{ padding: 'clamp(20px,3vw,30px)', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ alignSelf: 'flex-start', height: 22, padding: '0 9px', borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 11.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{t('yc.smsBeta.badge')}</span>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.035em' }}>{t('yc.smsBeta.mTitle')}</h2>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.smsBeta.mSub')}</p>
          </div>
          <Hv as="button" type="button" aria-label={t('yc.common.close')} onClick={onClose} style={{ flex: 'none', width: 36, height: 36, borderRadius: 99, border: 0, background: 'var(--sand-100)', display: 'grid', placeItems: 'center', cursor: 'pointer' }} hover={{ background: 'var(--sand-200)' }}>
            <Icon name="x" size={16} stroke={2.2} />
          </Hv>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={label}>{t('yc.smsBeta.q.uses')}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SMS_USE_CASES.map((u) => {
              const on = uses.includes(u);
              return (
                <button key={u} type="button" aria-pressed={on} onClick={() => toggle(u)} style={chip(on)}>
                  {on && <Icon name="check" size={13} stroke={3} />}{t(`yc.smsBeta.use.${u}`)}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={label}>{t('yc.smsBeta.q.volume')}</span>
          <div role="radiogroup" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SMS_VOLUMES.map((v) => (
              <button key={v} type="button" role="radio" aria-checked={volume === v} onClick={() => setVolume(v)} style={chip(volume === v)}>{t(`yc.smsBeta.vol.${v}`)}</button>
            ))}
          </div>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={label}>{t('yc.smsBeta.q.sender')}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
            <input
              value={wish}
              onChange={(e) => setWish(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 11))}
              maxLength={11}
              spellCheck={false}
              aria-invalid={!!wishErr}
              style={{ flex: '1 1 200px', height: 46, borderRadius: 14, border: 0, boxShadow: `inset 0 0 0 1.5px ${wishErr ? 'var(--red-400)' : 'var(--sand-200)'}`, padding: '0 14px', font: 'inherit', fontSize: 16, fontWeight: 600, letterSpacing: '.02em', outline: 'none', boxSizing: 'border-box' }}
            />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 46, padding: '0 14px', borderRadius: 14, background: 'var(--sand-50)', fontSize: 13.5, color: 'var(--sand-600)' }}>
              <Icon name="message" size={15} stroke={2} />{t('yc.smsBeta.from', { name: wish || '…' })}
            </span>
          </div>
          <span style={{ fontSize: 13, lineHeight: 1.45, color: wishErr ? 'var(--red-600)' : 'var(--sand-500)' }}>
            {wishErr ? t(wishErr === 'generic' ? 'yc.sm.rg.who.generic' : 'yc.sm.rg.who.bad') : t('yc.smsBeta.senderHint')}
          </span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={label}>{t('yc.smsBeta.q.note')}</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder={t('yc.smsBeta.notePh')}
            style={{ borderRadius: 14, border: 0, boxShadow: 'inset 0 0 0 1.5px var(--sand-200)', padding: 12, font: 'inherit', fontSize: 15, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
        </label>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', borderRadius: 16, background: 'var(--sand-50)' }}>
          <span style={{ flex: 'none', width: 30, height: 30, borderRadius: 10, background: '#fff', color: 'var(--sand-700)', display: 'grid', placeItems: 'center', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}><Icon name="shield" size={15} stroke={2} /></span>
          <span style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}><b style={{ color: 'var(--ink)', fontWeight: 600 }}>{t('yc.smsBeta.whyT')}</b> {t('yc.smsBeta.why')}</span>
        </div>

        {err && <span role="alert" style={{ fontSize: 13.5, color: 'var(--red-600)' }}>{err}</span>}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 }}>
          <Hv as="button" type="button" onClick={onClose} style={{ height: 46, padding: '0 20px', borderRadius: 99, border: 0, background: 'var(--sand-100)', fontWeight: 600, fontSize: 15, cursor: 'pointer' }} hover={{ background: 'var(--sand-200)' }}>{t('yc.common.cancel')}</Hv>
          <Hv as="button" type="button" onClick={() => void submit()} disabled={!ready}
            style={{ height: 46, padding: '0 24px', borderRadius: 99, border: 0, background: 'var(--gradient-brand)', color: '#fff', fontWeight: 600, fontSize: 15, cursor: ready ? 'pointer' : 'default', opacity: ready ? 1 : 0.45, boxShadow: ready ? 'var(--shadow-cta)' : 'none' }}
            hover={ready ? { filter: 'brightness(1.05)' } : undefined}>
            {access.pending ? t('yc.smsBeta.sending') : t('yc.smsBeta.submit')}
          </Hv>
        </div>
      </div>
    </Modal>
  );
}
