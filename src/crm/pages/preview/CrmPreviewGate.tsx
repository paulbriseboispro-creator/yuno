/**
 * Entrée de la démo Yuno CRM — crm.yunoapp.eu/crm/preview?token=…
 * (migration 20261019420000, Admin CRM › Démo).
 *
 * Même mécanique que PreviewGate (src/pages/PreviewGate.tsx), dans la DA du
 * CRM : le prospect saisit le mot de passe de SON lien, le serveur le vérifie
 * et ouvre une session du compte démo crm@womber.fr enregistrée comme APERÇU
 * (lecture seule imposée par la base, l'edge et le Storage), puis la Console
 * s'ouvre. Le bouton « Créer mon compte » de la démo mène où le serveur l'a
 * dit (`cta` : l'invitation liée, sinon l'inscription Yuno CRM).
 *
 * Une session déjà ouverte dans ce navigateur (un vrai compte) serait
 * remplacée : la page le dit avant d'entrer.
 */
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import '@/crm/styles/crm.css';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage, useLocaleSection, type Language } from '@/contexts/LanguageContext';
import { enablePreviewMode, isPreviewActive } from '@/contexts/PreviewModeContext';
import { Seo } from '@/components/Seo';
import { Wordmark } from '@/components/brand/Wordmark';
import { applyDemoBypass } from '@/lib/demoSession';
import { recordLegalAcceptance } from '@/lib/legal';
import { legalContent } from '@/data/legalContent';
import { useCrmT } from '@/crm/i18n';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE, SPRING } from '@/crm/ui/motion';
import { SUPPORT_EMAIL } from '@/crm/lib/errors';

const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap';
const PAPER = '#FCFAF9';

interface LinkInfo {
  label: string;
  target_accounts: string[];
  language: string;
  venue_id: string | null;
  organizer_user_id: string | null;
  is_valid: boolean;
  invalid_reason: string | null;
}

interface Redeem {
  success?: boolean; code?: string; error?: string; target_accounts?: string[]; language?: string;
  access_token?: string; refresh_token?: string; cta?: unknown;
}

function usePaperDocument() {
  useEffect(() => {
    if (!document.getElementById('yc-fonts')) {
      const l = document.createElement('link');
      l.id = 'yc-fonts'; l.rel = 'stylesheet'; l.href = FONTS_HREF;
      document.head.appendChild(l);
    }
    const html = document.documentElement;
    const prev = [html.style.background, document.body.style.background];
    html.style.background = PAPER;
    document.body.style.background = PAPER;
    return () => { html.style.background = prev[0]; document.body.style.background = prev[1]; };
  }, []);
}

export default function CrmPreviewGate() {
  usePaperDocument();
  const ready = useLocaleSection('crm');
  if (!ready) return <div className="yc" style={{ minHeight: '100vh', background: PAPER }} />;
  return <Gate />;
}

const input: CSSProperties = {
  height: 52, width: '100%', boxSizing: 'border-box', borderRadius: 12, border: '1.5px solid var(--sand-200)', background: '#fff',
  padding: '0 16px 0 44px', fontSize: 16, color: 'var(--ink)', outline: 'none', transition: 'border-color 160ms, box-shadow 160ms',
};

function Gate() {
  const { t } = useCrmT();
  const { setLanguage } = useLanguage();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    (async () => {
      if (!token) { setLoading(false); return; }
      const [{ data }, { data: sess }] = await Promise.all([
        supabase.rpc('get_demo_preview_link_public', { p_token: token }),
        supabase.auth.getSession(),
      ]);
      if (!on) return;
      const row = (Array.isArray(data) ? data[0] : data) as LinkInfo | null;
      setInfo(row ?? null);
      // Un vrai compte connecté dans ce navigateur : la démo le remplacerait.
      if (sess.session?.user?.email && !isPreviewActive()) setSignedInAs(sess.session.user.email);
      if (row?.language && ['en', 'fr', 'es'].includes(row.language)) setLanguage(row.language as Language);
      setLoading(false);
    })();
    return () => { on = false; };
  }, [token, setLanguage]);

  const crmLink = !!info && info.target_accounts.includes('crm') && !info.venue_id && !info.organizer_user_id;

  const submit = async () => {
    if (!password || !accepted || busy) return;
    setBusy(true); setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('accept-staff-invitation', {
        body: { action: 'redeem_demo_preview_link', token, password },
      });
      const res = data as Redeem | null;
      const code = res?.code ?? res?.error;
      if (invokeError || !res?.success || !res.access_token || !res.refresh_token) {
        setError(t(`yc.pv.err.${['wrong_password', 'locked', 'expired', 'revoked'].includes(code ?? '') ? code : 'x'}`));
        setBusy(false);
        return;
      }
      // Clickwrap tracé AVANT la session (encore anonyme) et avant la lecture seule.
      await recordLegalAcceptance({
        docType: 'demo_confidentiality',
        docContent: legalContent['confidentialite'][info?.language === 'fr' || info?.language === 'es' ? info.language : 'en'].content,
        context: { surface: 'crm_preview_gate', label: info?.label ?? '', roles: info?.target_accounts ?? [] },
      });
      const { data: s, error: e2 } = await supabase.auth.setSession({ access_token: res.access_token, refresh_token: res.refresh_token });
      if (e2) throw e2;
      await applyDemoBypass('crm', s.user?.id);
      const language = String(res.language ?? info?.language ?? 'fr');
      enablePreviewMode({ label: info?.label ?? '', roles: ['crm'], current: 'crm', language, cta: res.cta ?? null });
      // Pleine page : les gardes de la Console relisent la session à neuf.
      window.location.replace('/crm');
    } catch {
      setError(t('yc.pv.err.x'));
      setBusy(false);
    }
  };

  const ok = !!password && accepted && !busy;
  const card = (children: React.ReactNode) => (
    <div className="yc-lg" style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 24, animation: `yc-lg-rise 600ms ${EASE} both` }}>{children}</div>
  );

  return (
    <div className="yc" style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column', color: 'var(--ink)',
      background: 'radial-gradient(50% 40% at 85% 0%,rgba(255,107,53,.14),transparent 70%),radial-gradient(40% 40% at 0% 0%,rgba(227,20,27,.07),transparent 70%),var(--paper)',
    }}>
      <Seo title={t('yc.pv.docTitle')} noindex />
      <style>{`@keyframes yc-lg-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}@media (prefers-reduced-motion:reduce){.yc-lg{animation:none!important}}`}</style>
      <header style={{ height: 72, flex: 'none', padding: '0 clamp(16px,3vw,40px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <a href="/" aria-label="Yuno CRM" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <Wordmark height={26} tone="dark" alt="Yuno" />
          <span style={{ height: 26, padding: '0 10px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', fontSize: 12.5, fontWeight: 600, color: 'var(--sand-600)', display: 'inline-flex', alignItems: 'center' }}>{t('yc.pv.badge')}</span>
        </a>
        <Hv as="a" href={`mailto:${SUPPORT_EMAIL}`} style={{ height: 40, padding: '0 18px', borderRadius: 99, border: '1.5px solid var(--sand-200)', background: '#fff', color: 'var(--ink)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }} hover={{ color: 'var(--ink)', background: 'var(--sand-50)' }}>
          {t('yc.er.support')}
        </Hv>
      </header>
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px 56px' }}>
        {loading ? card(<div style={{ display: 'grid', placeItems: 'center', padding: 40 }}><span style={{ width: 28, height: 28, borderRadius: 99, border: '3px solid var(--sand-200)', borderTopColor: 'var(--red-500)', animation: 'yc-spin 700ms linear infinite' }} /></div>)
          : !token || !info || !info.is_valid || !crmLink ? card(
            <>
              <span style={{ width: 52, height: 52, borderRadius: 16, background: 'var(--red-50)', color: 'var(--red-600)', display: 'grid', placeItems: 'center' }}><Icon name="alert" size={24} stroke={2.2} /></span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 32, lineHeight: 1.08, letterSpacing: '-.035em' }}>{t('yc.pv.unavailable')}</h1>
                <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: 'var(--sand-600)' }}>
                  {t(`yc.pv.invalid.${info && !crmLink && info.is_valid ? 'other' : ['revoked', 'expired', 'locked'].includes(info?.invalid_reason ?? '') ? info?.invalid_reason : 'not_found'}`)}
                </p>
              </div>
              <a href="/" style={{ fontWeight: 600, fontSize: 15 }}>{t('yc.pv.discover')}</a>
            </>,
          ) : card(
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--red-600)' }}>{t('yc.pv.kicker')}</span>
                <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(32px,4.2vw,42px)', lineHeight: 1.04, letterSpacing: '-.04em', textWrap: 'balance' }}>
                  {t('yc.pv.hi', { name: info.label })}
                </h1>
                <p style={{ margin: 0, fontSize: 16.5, lineHeight: 1.5, color: 'var(--sand-600)' }}>{t('yc.pv.lead')}</p>
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(['1', '2', '3'] as const).map((k) => (
                  <li key={k} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14.5, lineHeight: 1.45, color: 'var(--sand-700)' }}>
                    <span style={{ flex: 'none', marginTop: 1, width: 20, height: 20, borderRadius: 99, background: 'var(--red-50)', color: 'var(--red-600)', display: 'grid', placeItems: 'center' }}><Icon name="check" size={12} stroke={3} /></span>
                    {t(`yc.pv.fact${k}`)}
                  </li>
                ))}
              </ul>
              {signedInAs && (
                <p role="status" style={{ margin: 0, padding: '12px 14px', borderRadius: 14, background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 13.5, lineHeight: 1.5 }}>
                  {t('yc.pv.signedIn', { email: signedInAs })}
                </p>
              )}
              <form onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14, fontWeight: 600 }}>{t('yc.pv.password')}
                  <span style={{ position: 'relative', display: 'block' }}>
                    <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--sand-400)', display: 'grid' }}><Icon name="lock" size={17} stroke={2.2} /></span>
                    <input value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} type="password" autoFocus autoComplete="off" style={{ ...input, borderColor: error ? 'var(--red-500)' : 'var(--sand-200)' }} />
                  </span>
                </label>
                <button type="button" onClick={() => setAccepted((v) => !v)} aria-pressed={accepted} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 0, border: 0, background: 'none', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>
                  <span style={{ flex: 'none', marginTop: 1, width: 20, height: 20, borderRadius: 6, border: `1.5px solid ${accepted ? 'var(--ink)' : 'var(--sand-300)'}`, background: accepted ? 'var(--ink)' : '#fff', color: '#fff', display: 'grid', placeItems: 'center' }}>{accepted && <Icon name="check" size={12} stroke={3} />}</span>
                  <span style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--sand-600)' }}>
                    {t('yc.pv.consent')} <a href="/legal/confidentialite" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontWeight: 600 }}>{t('yc.pv.consentLink')}</a>
                  </span>
                </button>
                {error && <span role="alert" style={{ fontSize: 14, color: 'var(--red-600)' }}>{error}</span>}
                <Hv as="button" type="submit" disabled={!ok}
                  style={{ height: 54, width: '100%', borderRadius: 99, border: 0, background: 'var(--gradient-brand)', color: '#fff', fontSize: 16, fontWeight: 600, cursor: ok ? 'pointer' : 'not-allowed', boxShadow: 'var(--shadow-cta)', transition: `transform 200ms ${SPRING}`, opacity: ok ? 1 : 0.5 }}
                  hover={ok ? { transform: 'translateY(-1px)' } : undefined} active={ok ? { transform: 'scale(.98)' } : undefined}>
                  {busy ? t('yc.pv.busy') : t('yc.pv.enter')}
                </Hv>
              </form>
              <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--sand-500)' }}>{t('yc.pv.footer')}</span>
            </>,
          )}
      </main>
    </div>
  );
}
