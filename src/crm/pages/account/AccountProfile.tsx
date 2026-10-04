/**
 * Compte › Mon profil : photo, identité (prénom, nom, e-mail vérifié,
 * téléphone, langue) avec la barre « Modifications non enregistrées », puis
 * la connexion (mot de passe, double authentification, appareils).
 */
import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { isDemoEmail } from '@/lib/demoPlan';
import { PhoneInputWithCountry } from '@/components/PhoneInputWithCountry';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Skel } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { useMyProfile, type MyProfile } from '@/crm/data/account';
import { Card, CardHead, Collapse, DirtyBar, Field, GhostToggle, InkSwitch, inputCss } from './accountUi';

interface Form { first: string; last: string; email: string; phone: string; lang: 'fr' | 'en' | 'es'; avatar: string | null }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LANGS: { v: Form['lang']; l: string }[] = [{ v: 'fr', l: 'Français' }, { v: 'en', l: 'English' }, { v: 'es', l: 'Español' }];

function toForm(p: MyProfile | null | undefined, email: string, lang: string): Form {
  const l = (p?.preferred_language ?? lang) as Form['lang'];
  return {
    first: p?.first_name ?? '', last: p?.last_name ?? '', email: p?.email ?? email, phone: p?.phone ?? '',
    lang: ['fr', 'en', 'es'].includes(l) ? l : 'fr', avatar: p?.avatar_url ?? null,
  };
}

/** Score de 1 à 4 : longueur, casse mêlée, chiffre ou symbole. */
function pwScore(s: string): number {
  if (!s) return 0;
  let n = 0;
  if (s.length >= 8) n++;
  if (s.length >= 12) n++;
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) n++;
  if (/\d/.test(s) || /[^A-Za-z0-9]/.test(s)) n++;
  return Math.max(1, n);
}

/** Photo carrée de 384 px en JPEG (recadrée au centre). */
async function squareJpeg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url; });
    const S = 384;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const m = Math.min(img.width, img.height);
    c.getContext('2d')!.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, S, S);
    return await new Promise<Blob>((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error('canvas'))), 'image/jpeg', 0.86));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function AccountProfile({ onDirty }: { onDirty: (v: boolean) => void }) {
  const { user, session } = useAuth();
  const { language } = useLanguage();
  const q = useMyProfile(user?.id);
  if (q.isLoading || !user) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Skel h={360} r={28} />
        <Skel h={260} r={28} />
      </div>
    );
  }
  return <ProfileForm profile={q.data ?? null} email={user.email ?? ''} lang={language} signedInAt={session?.user?.last_sign_in_at ?? null} onDirty={onDirty} />;
}

function ProfileForm({ profile, email, lang, signedInAt, onDirty }: { profile: MyProfile | null; email: string; lang: string; signedInAt: string | null; onDirty: (v: boolean) => void }) {
  const { t, dLong } = useCrmT();
  const { user, roles } = useAuth();
  const { setLanguage } = useLanguage();
  const { space } = useCrmScope();
  const toast = useCrmToast();
  const qc = useQueryClient();
  const demo = isDemoEmail(email);
  const [base, setBase] = useState<Form>(() => toForm(profile, email, lang));
  const [f, setF] = useState<Form>(base);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const dirty = useMemo(() => JSON.stringify(f) !== JSON.stringify(base), [f, base]);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const firstOk = f.first.trim().length > 0;
  const emailOk = EMAIL_RE.test(f.email.trim());
  const canSave = firstOk && emailOk && !uploading;
  const initials = ((f.first.trim()[0] ?? '') + (f.last.trim()[0] ?? '')).toUpperCase() || (email[0] ?? '?').toUpperCase();
  const roleLabel = t(`yc.acc.role.${space.role === 'manager' ? 'manager' : space.role}`);

  const onPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !user) return;
    setUploading(true);
    try {
      const blob = await squareJpeg(file);
      const path = `${user.id}/avatar-${Date.now()}.jpg`;
      const { error } = await supabase.storage.from('profile-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (error) throw error;
      set('avatar', supabase.storage.from('profile-photos').getPublicUrl(path).data.publicUrl);
    } catch {
      toast(t('yc.acc.p.photoErr'));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!canSave || saving || !user) return;
    const emailChanged = f.email.trim().toLowerCase() !== base.email.trim().toLowerCase();
    if (emailChanged && demo) { toast(t('yc.acc.p.demo')); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('profiles').update({
        first_name: f.first.trim(), last_name: f.last.trim() || null, phone: f.phone.trim() || null, avatar_url: f.avatar,
      } as never).eq('id', user.id);
      if (error) throw error;
      if (f.lang !== base.lang) setLanguage(f.lang);
      if (emailChanged) {
        const { error: e2 } = await supabase.auth.updateUser({ email: f.email.trim() });
        if (e2) throw e2;
      }
      const next = { ...f, email: emailChanged ? base.email : f.email };
      setBase(next); setF(next);
      void qc.invalidateQueries({ queryKey: ['crm', 'me', 'profile'] });
      void qc.invalidateQueries({ queryKey: ['crm'] });
      toast(t(emailChanged ? 'yc.acc.p.savedEmail' : 'yc.acc.p.saved'));
    } catch {
      toast(t('yc.acc.p.err'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Card gap={22}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '20px 24px' }}>
            <label title={t(f.avatar ? 'yc.acc.p.photoChange' : 'yc.acc.p.photoAdd')} style={{ position: 'relative', flex: 'none', width: 96, height: 96, borderRadius: 99, overflow: 'hidden', background: 'var(--sand-100)', color: 'var(--ink)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 34, letterSpacing: '-.02em', cursor: 'pointer', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
              <input type="file" accept="image/*" onChange={onPhoto} style={{ display: 'none' }} />
              {f.avatar ? <img src={f.avatar} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
              <Hv as="span" style={{ position: 'absolute', inset: 0, background: 'rgba(28,21,23,.55)', color: '#fff', display: 'grid', placeItems: 'center', opacity: uploading ? 1 : 0, transition: 'opacity 200ms' }} hover={{ opacity: 1 }}>
                {uploading ? <span style={{ width: 22, height: 22, borderRadius: 99, border: '2.6px solid rgba(255,255,255,.35)', borderTopColor: '#fff', animation: 'yc-spin 700ms linear infinite' }} /> : <Icon d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" size={24} stroke={2} />}
              </Hv>
            </label>
            <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em', lineHeight: 1.1 }}>{`${base.first} ${base.last}`.trim() || email}</span>
                <span style={{ fontSize: 14.5, color: 'var(--sand-500)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{base.email}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <Hv as="label" style={{ height: 38, padding: '0 14px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14, fontWeight: 600, color: 'var(--ink)', display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }} active={{ transform: 'scale(.97)' }}>
                  <input type="file" accept="image/*" onChange={onPhoto} style={{ display: 'none' }} />
                  <Icon name="upload" size={16} stroke={2.2} />{t(f.avatar ? 'yc.acc.p.photoChange' : 'yc.acc.p.photoAdd')}
                </Hv>
                {f.avatar && (
                  <Hv as="button" type="button" onClick={() => set('avatar', null)} style={{ height: 38, padding: '0 12px', border: 0, borderRadius: 99, background: 'none', fontSize: 14, fontWeight: 600, color: 'var(--sand-600)', cursor: 'pointer' }} hover={{ color: 'var(--red-600)', background: 'var(--red-50)' }}>{t('yc.acc.p.photoRemove')}</Hv>
                )}
                <span style={{ height: 28, padding: '0 12px', borderRadius: 99, background: 'var(--sand-50)', color: 'var(--sand-600)', fontSize: 13, fontWeight: 500, display: 'inline-flex', alignItems: 'center' }}>{t('yc.acc.p.role', { role: roleLabel, space: space.name })}</span>
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: '18px 16px' }}>
            <Field label={t('yc.acc.p.first')} error={!firstOk ? t('yc.acc.p.firstBad') : null}>
              <input value={f.first} onChange={(e) => set('first', e.target.value)} autoComplete="given-name" className="yc-field" style={{ ...inputCss, borderColor: !firstOk ? 'var(--red-400)' : 'var(--sand-200)' }} />
            </Field>
            <Field label={t('yc.acc.p.last')}>
              <input value={f.last} onChange={(e) => set('last', e.target.value)} autoComplete="family-name" className="yc-field" style={inputCss} />
            </Field>
            <Field
              label={t('yc.acc.p.email')}
              right={f.email === base.email && !emailOk ? null : f.email === base.email ? <span style={{ height: 22, padding: '0 9px', borderRadius: 99, background: 'var(--green-50)', color: 'var(--green-700)', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="check" size={11} stroke={3.2} />{t('yc.acc.p.verified')}</span> : null}
              hint={f.email !== base.email ? t('yc.acc.p.emailChange') : t('yc.acc.p.emailHint')}
              error={!emailOk ? t('yc.acc.p.emailBad') : null}
            >
              <input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" disabled={demo} className="yc-field" style={{ ...inputCss, borderColor: !emailOk ? 'var(--red-400)' : 'var(--sand-200)', background: demo ? 'var(--sand-50)' : '#fff' }} />
            </Field>
            <Field label={t('yc.acc.p.phone')} hint={t('yc.acc.p.phoneHint')}>
              <PhoneInputWithCountry tone="light" value={f.phone} onChange={(v) => set('phone', v)} inputStyle={{ height: 48, borderRadius: 14, fontSize: 15 }} triggerStyle={{ height: 48, borderRadius: 14 }} />
            </Field>
            <Field label={t('yc.acc.p.lang')}>
              <span style={{ position: 'relative', display: 'block' }}>
                <select value={f.lang} onChange={(e) => set('lang', e.target.value as Form['lang'])} className="yc-field" style={{ ...inputCss, appearance: 'none', WebkitAppearance: 'none', paddingRight: 40, cursor: 'pointer' }}>
                  {LANGS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
                <Icon name="chevronDown" size={16} stroke={2.2} style={{ position: 'absolute', right: 14, top: 16, pointerEvents: 'none', color: 'var(--sand-400)' }} />
              </span>
            </Field>
          </div>
        </Card>
        <SignIn email={base.email} demo={demo} signedInAt={signedInAt} mfa={!!profile?.mfa_enabled} owner={space.role === 'owner'} canMfa={roles.includes('owner') || roles.includes('affiliate')} dLong={dLong} />
      </div>
      {dirty && (
        <DirtyBar label={t('yc.acc.unsavedDot')} onCancel={() => setF(base)} onSave={save} saving={saving} disabled={!canSave} saveLabel={t(saving ? 'yc.acc.saving' : 'yc.acc.save')} cancelLabel={t('yc.acc.cancel')} />
      )}
    </>
  );
}

function deviceName(): { name: string; phone: boolean } {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const os = /iPhone|iPad/.test(ua) ? (/iPad/.test(ua) ? 'iPad' : 'iPhone') : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return { name: [os, br].filter(Boolean).join(' · ') || '—', phone: /iPhone|Android/.test(ua) };
}

function SignIn({ email, demo, signedInAt, mfa, owner, canMfa, dLong }: { email: string; demo: boolean; signedInAt: string | null; mfa: boolean; owner: boolean; canMfa: boolean; dLong: (d: Date | string) => string }) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const navigate = useNavigate();
  const [pwOpen, setPwOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [nw2, setNw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const [outBusy, setOutBusy] = useState(false);
  const score = pwScore(nw);
  const mismatch = nw2.length > 0 && nw !== nw2;
  const ok = cur.length > 0 && nw.length >= 8 && score >= 3 && nw === nw2 && !busy;
  const col = score <= 1 ? 'var(--red-400)' : score === 2 ? 'var(--amber-500)' : 'var(--green-500)';
  const dev = deviceName();

  const savePw = async () => {
    if (!ok) return;
    if (demo) { toast(t('yc.acc.p.demo')); return; }
    setBusy(true);
    try {
      const { error: e1 } = await supabase.auth.signInWithPassword({ email, password: cur });
      if (e1) { toast(t('yc.acc.p.pwWrong')); return; }
      const { error: e2 } = await supabase.auth.updateUser({ password: nw });
      if (e2) throw e2;
      setCur(''); setNw(''); setNw2(''); setPwOpen(false);
      toast(t('yc.acc.p.pwDone'));
    } catch {
      toast(t('yc.acc.p.pwErr'));
    } finally {
      setBusy(false);
    }
  };
  const signOutOthers = async () => {
    if (demo || outBusy) return;
    setOutBusy(true);
    const { error } = await supabase.auth.signOut({ scope: 'others' });
    setOutBusy(false);
    toast(t(error ? 'yc.acc.p.pwErr' : 'yc.acc.p.signedOutOthers'));
  };

  const row = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px', padding: '18px 0', borderTop: '1px solid var(--sand-100)' } as const;
  const ico = { flex: 'none', width: 40, height: 40, borderRadius: 12, background: 'var(--sand-50)', color: 'var(--sand-600)', display: 'grid', placeItems: 'center' } as const;
  const txt = { flex: '1 1 200px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 } as const;
  const pwInput = (v: string, on: (s: string) => void, ac: string, bad?: boolean) => (
    <input type="password" value={v} onChange={(e) => on(e.target.value)} autoComplete={ac} className="yc-field" style={{ ...inputCss, borderColor: bad ? 'var(--red-400)' : 'var(--sand-200)' }} />
  );

  return (
    <Card gap={0}>
      <div style={{ marginBottom: 8 }}><CardHead title={t('yc.acc.p.signin.t')} sub={t('yc.acc.p.signin.s')} /></div>
      <div style={row}>
        <span style={ico}><Icon name="lock" size={19} stroke={2} /></span>
        <div style={txt}><span style={{ fontSize: 15, fontWeight: 600 }}>{t('yc.acc.p.pw')}</span><span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{t(demo ? 'yc.acc.p.demo' : 'yc.acc.p.pwS')}</span></div>
        {!demo && <GhostToggle label={t(pwOpen ? 'yc.acc.p.close' : 'yc.acc.p.edit')} open={pwOpen} onClick={() => setPwOpen((x) => !x)} />}
        <Collapse open={pwOpen}>
          <div style={{ padding: '14px 4px 4px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: '14px 16px' }}>
              <Field label={t('yc.acc.p.pwCur')}>{pwInput(cur, setCur, 'current-password')}</Field>
              <Field label={t('yc.acc.p.pwNew')} hint={t('yc.acc.p.pwNewHint')}>{pwInput(nw, setNw, 'new-password')}</Field>
              <Field label={t('yc.acc.p.pwConf')} error={mismatch ? t('yc.acc.p.pwMismatch') : null}>{pwInput(nw2, setNw2, 'new-password', mismatch)}</Field>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 4 }}>
                {[1, 2, 3, 4].map((i) => <span key={i} style={{ height: 6, borderRadius: 99, background: score >= i ? col : 'var(--sand-100)', transition: 'background 300ms' }} />)}
              </div>
              <span style={{ flex: 'none', minWidth: 64, fontSize: 13, fontWeight: 600, color: score <= 1 ? 'var(--red-600)' : score === 2 ? 'var(--amber-700)' : 'var(--green-700)' }}>{score ? t(`yc.acc.p.pwScore${score}`) : ''}</span>
            </div>
            <div>
              <button type="button" onClick={savePw} disabled={!ok} style={{ height: 44, padding: '0 20px', borderRadius: 99, border: 0, background: ok ? 'var(--ink)' : 'var(--sand-100)', color: ok ? '#fff' : 'var(--sand-500)', fontSize: 14.5, fontWeight: 600, cursor: ok ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                {busy && <span style={{ width: 16, height: 16, borderRadius: 99, border: '2.4px solid rgba(255,255,255,.35)', borderTopColor: '#fff', animation: 'yc-spin 700ms linear infinite' }} />}
                {t(busy ? 'yc.acc.p.pwSaving' : 'yc.acc.p.pwSave')}
              </button>
            </div>
          </div>
        </Collapse>
      </div>
      {canMfa && (
        <div style={row}>
          <span style={ico}><Icon name="shield" size={19} stroke={2} /></span>
          <div style={txt}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{t('yc.acc.p.mfa')}</span>
            <span style={{ fontSize: 13.5, color: mfa ? 'var(--sand-500)' : 'var(--amber-700)' }}>{t(mfa ? 'yc.acc.p.mfaOn' : 'yc.acc.p.mfaOff')}{owner ? ` · ${t('yc.acc.p.mfaRequired')}` : ''}</span>
          </div>
          {!demo && (
            <InkSwitch on={mfa} onChange={() => (mfa ? toast(t('yc.acc.p.mfaKeep')) : navigate('/mfa-setup?redirect=/crm/account/profile'))} label={t('yc.acc.p.mfa')} />
          )}
        </div>
      )}
      <div style={{ ...row, paddingBottom: 0 }}>
        <span style={ico}><Icon name={dev.phone ? 'phone' : 'globe'} size={19} stroke={2} /></span>
        <div style={txt}><span style={{ fontSize: 15, fontWeight: 600 }}>{t('yc.acc.p.devices')}</span><span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{t('yc.acc.p.devicesS')}</span></div>
        <GhostToggle label={t(devOpen ? 'yc.acc.p.close' : 'yc.acc.p.see')} open={devOpen} onClick={() => setDevOpen((x) => !x)} />
        <Collapse open={devOpen}>
          <div style={{ padding: '10px 0 0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px' }}>
            <div style={{ flex: '1 1 220px', display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, background: 'var(--paper)' }}>
              <Icon name={dev.phone ? 'phone' : 'globe'} size={18} stroke={2} style={{ color: 'var(--sand-500)' }} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 14.5, fontWeight: 600 }}>{dev.name}</span>
                {signedInAt && <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.acc.p.since', { date: dLong(signedInAt) })}</span>}
              </div>
              <span style={{ height: 24, padding: '0 10px', borderRadius: 99, background: 'var(--green-50)', color: 'var(--green-700)', fontSize: 12.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--green-500)', animation: 'yc-pulse 1.8s ease-out infinite' }} />{t('yc.acc.p.thisDevice')}
              </span>
            </div>
            {!demo && (
              <Hv as="button" type="button" onClick={signOutOthers} disabled={outBusy} style={{ height: 40, padding: '0 16px', border: 0, borderRadius: 99, background: 'none', fontSize: 14, fontWeight: 600, color: 'var(--red-600)', cursor: 'pointer', opacity: outBusy ? 0.6 : 1 }} hover={{ background: 'var(--red-50)' }}>
                {t('yc.acc.p.signOutOthers')}
              </Hv>
            )}
          </div>
        </Collapse>
      </div>
    </Card>
  );
}
