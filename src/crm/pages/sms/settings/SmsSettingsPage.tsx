/**
 * SMS › Réglages d'envoi (`/crm/sms/settings`, maquette « SMS Reglages.dc.html »)
 * — « comment vos SMS partent-ils ? ». Nom d'expéditeur (3 à 11 lettres ou
 * chiffres), heures calmes et dimanche, plafond par semaine, numéro de test,
 * puis ce que Yuno gère seul (mention STOP, accord SMS, lien suivi). À droite,
 * le SMS tel que le verront les clients et le nombre de contacts joignables.
 * Une barre « Modifications non enregistrées » porte Annuler / Enregistrer
 * (`crm_sms_settings_set`).
 */
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { PhoneInputWithCountry } from '@/components/PhoneInputWithCountry';
import { composePhone, countryByCode, splitPhone } from '@/lib/countries';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Skel } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { EASE } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps, useCrmScope } from '@/crm/scope';
import { useSaveSmsSettings, useSmsCampaigns, useSmsSettings, type SmsSettings } from '@/crm/data/sms';
import { defaultSender, SAMPLE_LINK, smsFinalText, toE164, validSender } from '@/crm/lib/sms';
import { STOP_SUFFIX } from '@/lib/smsMarketing';
import { useNarrow } from '@/crm/ui/useNarrow';
import { Toggle48 } from '../../emails/send/sendUi';
import { SmsShell } from '../SmsShell';
import { SmsPhone } from '../SmsPhone';

interface Form { sender: string; from: number; to: number; noSunday: boolean; cap: number; phone: string }

const rise = (d: number): CSSProperties => ({ animation: `yc-rise 800ms ${EASE} ${d}ms both` });
const card: CSSProperties = { display: 'flex', flexDirection: 'column', padding: 'clamp(20px,2.4vw,28px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' };
const FROM_H = [18, 19, 20, 21, 22, 23];
const TO_H = [5, 6, 7, 8, 9, 10];
const two = (h: number) => String(h).padStart(2, '0');

/** « +33639989999 » (base) → « +33 6 39 98 99 99 » (champ téléphone). */
function shownPhone(e164: string | null): string {
  if (!e164) return '';
  const fr = countryByCode('FR');
  if (!fr) return e164;
  const { country, national } = splitPhone(e164, fr);
  return composePhone(national, country) || e164;
}

function toForm(s: SmsSettings): Form {
  return { sender: s.sender_name ?? '', from: s.quiet_from, to: s.quiet_to, noSunday: s.no_sunday, cap: s.weekly_cap, phone: shownPhone(s.test_phone) };
}

export default function SmsSettingsPage() {
  const { t } = useCrmT();
  const q = useSmsSettings();
  const camps = useSmsCampaigns();
  const drafts = (camps.data?.campaigns ?? []).filter((c) => c.status === 'draft').length;
  const title = <>{t('yc.sm.rg.h.a')}<span className="yc-accent-word">{t('yc.sm.rg.h.b')}</span>{t('yc.sm.rg.h.c')}</>;
  return (
    <SmsShell tab="settings" title={title} sub={t('yc.sm.rg.sub')} drafts={drafts} hideNew>
      {q.isLoading || !q.data ? (
        q.isError ? <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
            <div style={{ flex: '1 1 520px', display: 'flex', flexDirection: 'column', gap: 20 }}>{[240, 340, 220].map((h, i) => <Skel key={i} h={h} r={28} />)}</div>
            <div style={{ flex: '1 1 300px', maxWidth: 360 }}><Skel h={480} r={28} /></div>
          </div>
        )
      ) : <SettingsForm settings={q.data} />}
    </SmsShell>
  );
}

function SettingsForm({ settings }: { settings: SmsSettings }) {
  const T = useCrmT();
  const { t, lang } = T;
  const { space } = useCrmScope();
  const toast = useCrmToast();
  const save = useSaveSmsSettings();
  const canWrite = useCrmCaps().write;
  const narrow = useNarrow(980);
  const phone = useNarrow(560);
  const [base, setBase] = useState<Form>(() => toForm(settings));
  const [f, setF] = useState<Form>(base);
  useEffect(() => { const b = toForm(settings); setBase(b); setF(b); }, [settings]);
  const dirty = useMemo(() => JSON.stringify(f) !== JSON.stringify(base), [f, base]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const fallback = defaultSender(space.name);
  const senderBad = f.sender !== '' && !validSender(f.sender);
  const phoneE164 = f.phone.trim() ? toE164(f.phone) : null;
  const phoneBad = f.phone.trim() !== '' && !phoneE164;
  const shownSender = f.sender && !senderBad ? f.sender : fallback;
  const sample = smsFinalText(t('yc.sm.rg.sample'), { sender: shownSender, lang, vals: { 'prénom': t('yc.sm.sample.name'), nom_club: space.name, 'soirée': t('yc.sm.sample.night'), lien: SAMPLE_LINK } });

  const onSave = async () => {
    if (senderBad || phoneBad || save.isPending) return;
    try {
      await save.mutateAsync({ sender_name: f.sender || null, quiet_from: f.from, quiet_to: f.to, no_sunday: f.noSunday, weekly_cap: f.cap, test_phone: phoneE164 });
      toast(t('yc.em.rg.saved'));
    } catch {
      toast(t('yc.em.rg.err'));
    }
  };

  const aside = (
    <aside style={{ flex: '1 1 300px', maxWidth: narrow ? 'none' : 360, minWidth: 0, position: narrow ? 'static' : 'sticky', top: 88, display: 'flex', flexDirection: 'column', gap: 16, padding: 20, borderRadius: 28, background: 'var(--sand-100)', ...rise(420) }}>
      <span style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.sm.rg.preview')}</span>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <SmsPhone text={sample} sender={shownSender} time="18:00" size="sm" height={520} today={t('yc.sm.ph.today')} placeholder={t('yc.sm.ph.empty')} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '16px 18px', borderRadius: 20, background: '#fff' }}>
        <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{t('yc.sm.rg.reach')}</span>
        <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{T.n(settings.sms_ok)}</b>
        <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{T.tp('yc.sm.rg.reachOf', settings.people, { n: T.n(settings.people) })}</span>
      </div>
    </aside>
  );

  return (
    <>
      <div style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', alignItems: 'flex-start', gap: 24, paddingBottom: dirty ? 80 : 0 }}>
        <fieldset disabled={!canWrite} style={{ flex: '1 1 560px', width: narrow ? '100%' : undefined, minWidth: 0, border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {!canWrite && <div style={{ padding: '12px 16px', borderRadius: 16, background: 'var(--sand-50)', color: 'var(--sand-600)', fontSize: 14, lineHeight: 1.45 }}>{t('yc.common.readOnly')}</div>}

          <section style={{ ...card, gap: 18, ...rise(380) }}>
            <Head title={t('yc.sm.rg.who.t')} sub={t('yc.sm.rg.who.s')} />
            <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{t('yc.sm.rg.who.name')}</span>
              <input
                value={f.sender}
                onChange={(e) => set('sender', e.target.value.replace(/\s+/g, '').slice(0, 11))}
                placeholder={fallback}
                maxLength={11}
                autoCapitalize="characters"
                spellCheck={false}
                className="yc-field"
                style={{ height: 52, boxSizing: 'border-box', padding: '0 16px', borderRadius: 14, border: `1px solid ${senderBad ? 'var(--red-400)' : 'var(--sand-200)'}`, background: '#fff', fontFamily: 'var(--font-mono)', fontSize: 17, letterSpacing: '.06em', color: 'var(--ink)', outline: 'none', width: '100%' }}
              />
              <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, color: senderBad ? 'var(--red-600)' : 'var(--sand-500)' }}>
                <span>{senderBad ? t('yc.sm.rg.who.bad') : f.sender ? t('yc.sm.rg.who.rule') : t('yc.sm.rg.who.default', { name: fallback })}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', flex: 'none' }}>{(f.sender || fallback).length} / 11</span>
              </span>
            </label>
          </section>

          <section style={{ ...card, gap: 0, ...rise(440) }}>
            <Head title={t('yc.sm.rg.when.t')} sub={t('yc.sm.rg.when.s')} />
            <Row first l={t('yc.sm.rg.quiet')} d={t('yc.sm.rg.quietD')}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <HourSelect value={f.from} options={FROM_H} onChange={(v) => set('from', v)} label={t('yc.sm.rg.quietFrom')} />
                <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{t('yc.sm.rg.and')}</span>
                <HourSelect value={f.to} options={TO_H} onChange={(v) => set('to', v)} label={t('yc.sm.rg.quietTo')} />
                <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{t('yc.sm.rg.h')}</span>
              </span>
            </Row>
            <Row l={t('yc.sm.rg.sunday')} d={t('yc.sm.rg.sundayD')}>
              <Toggle48 on={f.noSunday} onChange={(v) => set('noSunday', v)} label={t('yc.sm.rg.sunday')} />
            </Row>
            <DayBar from={f.from} to={f.to} />
          </section>

          <section style={{ ...card, gap: 16, ...rise(500) }}>
            <Head title={t('yc.sm.rg.cap.t')} sub={t('yc.sm.rg.cap.s')} />
            <div role="radiogroup" aria-label={t('yc.sm.rg.cap.t')} style={{ alignSelf: phone ? 'stretch' : 'flex-start', display: 'grid', gridTemplateColumns: 'repeat(3,auto)', gap: 4, padding: 4, borderRadius: 99, background: 'var(--sand-100)' }}>
              {[1, 2, 3].map((c) => (
                <Hv key={c} as="button" type="button" role="radio" aria-checked={f.cap === c} onClick={() => set('cap', c)}
                  style={{ height: 42, padding: phone ? '0 8px' : '0 18px', border: 0, borderRadius: 99, background: f.cap === c ? '#fff' : 'transparent', boxShadow: f.cap === c ? 'var(--shadow-sm)' : 'none', color: f.cap === c ? 'var(--ink)' : 'var(--sand-600)', fontSize: phone ? 14 : 15, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer', transition: `background 200ms ${EASE}` }}
                  hover={{ color: 'var(--ink)' }}>
                  {t(phone ? 'yc.sm.rg.cap.nShort' : 'yc.sm.rg.cap.n', { n: c })}
                </Hv>
              ))}
            </div>
            <span style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-700)', textWrap: 'pretty' }}>{t(`yc.sm.rg.cap.d${f.cap}`)}</span>
          </section>

          <section style={{ ...card, gap: 16, ...rise(560) }}>
            <Head title={t('yc.sm.rg.test.t')} sub={t('yc.sm.rg.test.s')} />
            <label style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{t('yc.sm.rg.test.label')}</span>
              <PhoneInputWithCountry tone="light" value={f.phone} onChange={(v) => set('phone', v)} disabled={!canWrite} inputStyle={{ height: 48, borderRadius: 14, fontSize: 15 }} triggerStyle={{ height: 48, borderRadius: 14 }} />
              {phoneBad && <span style={{ fontSize: 13, color: 'var(--red-600)' }}>{t('yc.sm.rg.test.bad')}</span>}
            </label>
          </section>

          <section style={{ ...card, gap: 0, background: 'var(--paper)', ...rise(620) }}>
            <Head title={t('yc.sm.rg.managed.t')} sub={t('yc.sm.rg.managed.s')} />
            {([
              ['stop', { s: STOP_SUFFIX[lang].trim() }],
              ['consent', {}],
              ['link', { d: SAMPLE_LINK.split('/')[0] }],
            ] as const).map(([k, v], i) => (
              <div key={k} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '16px 0', borderTop: '1px solid var(--sand-200)', marginTop: i ? 0 : 16 }}>
                <Icon name="check" size={18} stroke={2.6} color="var(--green-700)" style={{ flex: 'none', marginTop: 2 }} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <b style={{ fontSize: 15, textWrap: 'balance' }}>{t(`yc.sm.rg.managed.${k}`, v)}</b>
                  <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t(`yc.sm.rg.managed.${k}D`, v)}</span>
                </span>
              </div>
            ))}
          </section>
        </fieldset>
        {aside}
      </div>
      {dirty && canWrite && (
        <div role="region" aria-label={t('yc.em.rg.dirty')} style={{ position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)', zIndex: 60, display: 'flex', alignItems: 'center', gap: 12, padding: '8px 8px 8px 20px', borderRadius: 99, background: 'var(--ink)', color: '#fff', boxShadow: 'var(--shadow-md)', maxWidth: 'calc(100vw - 24px)', boxSizing: 'border-box', animation: `yc-toast-in 260ms ${EASE} both` }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('yc.em.rg.dirty')}</span>
          <Hv as="button" type="button" onClick={() => setF(base)} style={{ flex: 'none', height: 38, padding: '0 16px', border: 0, borderRadius: 99, background: 'rgba(255,255,255,.12)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'rgba(255,255,255,.22)' }}>
            {t('yc.em.rg.reset')}
          </Hv>
          <Hv as="button" type="button" onClick={onSave} disabled={senderBad || phoneBad || save.isPending} style={{ flex: 'none', height: 38, padding: '0 20px', border: 0, borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: senderBad || phoneBad ? 'not-allowed' : 'pointer', opacity: senderBad || phoneBad || save.isPending ? 0.6 : 1 }} hover={{ filter: 'brightness(1.08)' }}>
            {t('yc.em.rg.save')}
          </Hv>
        </div>
      )}
    </>
  );
}

function Head({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{title}</h2>
      <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2, maxWidth: 560, textWrap: 'pretty' }}>{sub}</div>
    </div>
  );
}

function Row({ l, d, first, children }: { l: string; d: string; first?: boolean; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 16px', padding: '18px 0', borderTop: '1px solid var(--sand-100)', marginTop: first ? 18 : 0 }}>
      <span style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <b style={{ fontSize: 15 }}>{l}</b>
        <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--sand-500)', textWrap: 'pretty' }}>{d}</span>
      </span>
      {children}
    </div>
  );
}

function HourSelect({ value, options, onChange, label }: { value: number; options: number[]; onChange: (v: number) => void; label: string }) {
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} className="yc-field"
        style={{ height: 48, padding: '0 38px 0 16px', borderRadius: 14, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 18, fontWeight: 600, color: 'var(--ink)', appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer', fontVariantNumeric: 'tabular-nums' }}>
        {options.map((h) => <option key={h} value={h}>{two(h)}</option>)}
      </select>
      <Icon name="chevronDown" size={16} stroke={2.2} style={{ position: 'absolute', right: 12, top: 16, pointerEvents: 'none', color: 'var(--sand-500)' }} />
    </span>
  );
}

/** La journée sur 24 h : en vert les heures où un SMS peut partir. */
function DayBar({ from, to }: { from: number; to: number }) {
  const { t } = useCrmT();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 6 }}>
      <div style={{ position: 'relative', height: 22, borderRadius: 99, background: 'var(--sand-200)', overflow: 'hidden' }} aria-hidden>
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(to / 24) * 100}%`, width: `${(Math.max(0, from - to) / 24) * 100}%`, background: '#BFE6CE', transition: `left 360ms ${EASE},width 360ms ${EASE}` }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--sand-500)' }}>
        {[0, 6, 12, 18, 24].map((h) => <span key={h}>{t('yc.sm.rg.hour', { h })}</span>)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', fontSize: 13, color: 'var(--sand-600)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: '#9ED9B4' }} />{t('yc.sm.rg.allowed')}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--sand-300)' }} />{t('yc.sm.rg.calm')}</span>
      </div>
    </div>
  );
}
