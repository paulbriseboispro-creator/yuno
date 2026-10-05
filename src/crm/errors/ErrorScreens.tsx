/**
 * Écrans plein page d'erreur de la Console (design « Pages d'erreur ») :
 * 404, 401, 403, 500, 503 et hors ligne. Chaque écran est autonome (en-tête
 * Yuno + « Service client »), sans menu : il peut s'afficher avant même que la
 * portée de l'espace soit connue. Textes : `yc.er.*`.
 */
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wordmark } from '@/components/brand/Wordmark';
import { useLanguage } from '@/contexts/LanguageContext';
import { PRO_SIGNUP_ORIGIN, proSignupUrl } from '@/lib/proSignup';
import { useCrmT } from '@/crm/i18n';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import type { IconName } from '@/crm/ui/Icon';
import { MonoLabel } from '@/crm/ui/kit';
import { YunitFace } from '@/crm/ui/YunitFace';
import type { YunitMood } from '@/crm/ui/YunitFace';
import { EASE, SPRING } from '@/crm/ui/motion';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { loginUrl, SUPPORT_EMAIL } from '@/crm/lib/errors';
import type { OpenCrmOffer } from '@/crm/lib/openCrmOffer';

const TOKEN = '/crm/yunit-token.webp';
const mailto = `mailto:${SUPPORT_EMAIL}`;
const GRAD_TEXT: CSSProperties = { paddingRight: '.06em', marginRight: '-.06em', background: 'var(--gradient-brand)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' };

/** Un titre dont un mot passe au dégradé Yuno : le modèle porte `{marqueur}`. */
function Headline({ tpl, vars, word, size = 46, style }: { tpl: string; vars?: Record<string, string>; word: string; size?: number; style?: CSSProperties }) {
  const [before, after = ''] = tpl.split('\u0001');
  void vars;
  return (
    <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: size, lineHeight: 1.05, letterSpacing: '-.045em', textWrap: 'balance', ...style }}>
      {before}<span style={GRAD_TEXT}>{word}</span>{after}
    </h1>
  );
}

/** Rend `t(key, {name: '\u0001'})` découpable autour du mot mis en avant. */
function useTitle() {
  const { t } = useCrmT();
  return (key: string, name: string) => t(key, { [name]: '\u0001' });
}

const pill = (h = 40): CSSProperties => ({
  height: h, padding: '0 18px', borderRadius: 99, border: '1.5px solid var(--sand-200)', background: '#fff', color: 'var(--ink)',
  fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none', cursor: 'pointer',
  whiteSpace: 'nowrap', transition: 'background 160ms, border-color 160ms',
});
const pillHover: CSSProperties = { color: 'var(--ink)', textDecoration: 'none', background: 'var(--sand-50)', borderColor: 'var(--sand-300)' };

function RedCta({ children, icon, onClick, href }: { children: ReactNode; icon?: IconName; onClick?: () => void; href?: string }) {
  const common = {
    style: {
      height: 52, padding: '0 26px 0 22px', borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 15.5, fontWeight: 600,
      boxShadow: 'var(--shadow-cta)', display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none', border: 0, cursor: 'pointer',
      transition: `transform 200ms ${SPRING}`, whiteSpace: 'nowrap',
    } as CSSProperties,
    hover: { color: '#fff', textDecoration: 'none', transform: 'translateY(-1px)' } as CSSProperties,
    active: { transform: 'scale(.97)' } as CSSProperties,
  };
  const body = <>{icon && <Icon name={icon} size={18} stroke={2.2} />}{children}</>;
  return href ? <Hv as="a" href={href} {...common}>{body}</Hv> : <Hv as="button" type="button" onClick={onClick} {...common}>{body}</Hv>;
}

function WhitePill({ children, onClick, href, icon }: { children: ReactNode; onClick?: () => void; href?: string; icon?: IconName }) {
  const style = { ...pill(52), padding: '0 26px', fontSize: 15.5 };
  const body = <>{icon && <Icon name={icon} size={17} stroke={2.2} />}{children}</>;
  return href ? <Hv as="a" href={href} style={style} hover={pillHover}>{body}</Hv> : <Hv as="button" type="button" onClick={onClick} style={style} hover={pillHover}>{body}</Hv>;
}

/** Page d'erreur : fond rosé, en-tête Yuno, contenu centré. */
function Frame({ children, right, dark = false, bg }: { children: ReactNode; right?: ReactNode; dark?: boolean; bg?: string }) {
  const { t } = useCrmT();
  return (
    <div
      className="yc"
      style={{
        position: 'relative', minHeight: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: bg ?? 'radial-gradient(50% 40% at 85% 0%,rgba(255,107,53,.14),transparent 70%),radial-gradient(40% 40% at 0% 0%,rgba(227,20,27,.07),transparent 70%),var(--paper)',
        color: dark ? '#fff' : 'var(--ink)',
      }}
    >
      <header style={{ height: 72, flex: 'none', padding: '0 clamp(16px,3vw,40px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 2 }}>
        <a href="/" aria-label={t('yc.er.logoAria')} style={{ display: 'inline-flex' }}><Wordmark height={26} tone={dark ? 'white' : 'dark'} alt="" /></a>
        {right ?? (
          <Hv as="a" href={mailto} style={dark ? { ...pill(), background: 'rgba(255,255,255,.08)', borderColor: 'rgba(255,255,255,.18)', color: '#fff' } : pill()} hover={dark ? { color: '#fff', background: 'rgba(255,255,255,.14)', textDecoration: 'none' } : pillHover}>
            {t('yc.er.support')}
          </Hv>
        )}
      </header>
      {children}
    </div>
  );
}

function Token({ style, size, delay, dur }: { style: CSSProperties; size: number; delay: number; dur: number }) {
  return <img src={TOKEN} alt="" aria-hidden style={{ position: 'absolute', width: size, mixBlendMode: 'multiply', animation: `yc-er-float ${dur}s ease-in-out ${delay}s infinite`, pointerEvents: 'none', ...style }} />;
}

const ERR_CSS = `
@keyframes yc-er-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}
@keyframes yc-er-wobble{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(7deg) translateY(-8px)}}
@keyframes yc-er-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
@keyframes yc-er-z{0%{opacity:0;transform:translate(0,8px)}30%{opacity:1}100%{opacity:0;transform:translate(14px,-22px)}}
@keyframes yc-er-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.yc-er *{animation-duration:.01ms!important;animation-iteration-count:1!important}}
@media (max-width:700px){.yc-er-deco{display:none}}
.yc-er-rise{animation:yc-er-rise 520ms ${EASE} both}
`;
function ErrStyles() { return <style>{ERR_CSS}</style>; }

/* ───────────────────────── 404 ───────────────────────── */
export function NotFoundScreen() {
  const { t } = useCrmT();
  const title = useTitle();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const go = (e: React.FormEvent) => { e.preventDefault(); const v = q.trim(); nav(v ? `${CRM_ROUTES.clients}?q=${encodeURIComponent(v)}` : CRM_ROUTES.clients); };
  const goBack = () => { if (window.history.length > 1) nav(-1); else nav(CRM_ROUTES.home); };
  const links: [string, string][] = [
    [t('yc.er.404.home'), CRM_ROUTES.home], [t('yc.er.404.clients'), CRM_ROUTES.clients], [t('yc.er.404.nights'), CRM_ROUTES.nights],
    [t('yc.er.404.analytics'), CRM_ROUTES.sales],
  ];
  return (
    <Frame>
      <ErrStyles />
      <div className="yc-er yc-er-deco" style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <Token style={{ left: '7%', top: '22%', rotate: '-14deg' }} size={112} delay={0} dur={6} />
        <Token style={{ right: '8%', top: '16%', rotate: '18deg' }} size={84} delay={-2} dur={7.5} />
        <Token style={{ left: '13%', bottom: '12%', rotate: '32deg' }} size={78} delay={-4} dur={8} />
        <Token style={{ right: '12%', bottom: '10%', rotate: '-24deg' }} size={124} delay={-1} dur={6.8} />
        <div style={{ position: 'absolute', left: '24%', top: '14%', animation: 'yc-er-float 5s ease-in-out -1s infinite' }}><YunitFace mood="surpris" size={46} /></div>
        <div style={{ position: 'absolute', right: '22%', bottom: '30%', animation: 'yc-er-float 6s ease-in-out -3s infinite' }}><YunitFace mood="inquiet" size={40} /></div>
      </div>
      <main className="yc-er yc-er-rise" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', position: 'relative', padding: '0 24px 40px' }}>
        <MonoLabel>{t('yc.er.404.kicker')}</MonoLabel>
        <div aria-label="404" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(110px,16vw,230px)', lineHeight: 1, letterSpacing: '-.07em', height: 'clamp(116px,16.4vw,236px)' }}>
          <span>4</span>
          <img src={TOKEN} alt="0" style={{ width: 'clamp(120px,17.4vw,250px)', margin: '0 -14px', mixBlendMode: 'multiply', animation: 'yc-er-wobble 5s ease-in-out infinite' }} />
          <span>4</span>
        </div>
        <Headline tpl={title('yc.er.404.title', 'party')} word={t('yc.er.404.party')} size={46} style={{ marginTop: 6, fontSize: 'clamp(30px,3.4vw,46px)' }} />
        <p style={{ margin: '12px 0 0', fontSize: 17, lineHeight: 1.5, color: 'var(--sand-600)', maxWidth: 520, textWrap: 'pretty' }}>{t('yc.er.404.body')}</p>
        <form onSubmit={go} style={{ marginTop: 26, width: 600, maxWidth: '100%', height: 56, boxSizing: 'border-box', borderRadius: 99, background: '#fff', border: '1.5px solid var(--sand-200)', boxShadow: 'var(--shadow-sm)', display: 'flex', alignItems: 'center', gap: 12, padding: '0 6px 0 20px' }}>
          <Icon name="search" size={20} color="var(--sand-500)" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('yc.er.404.ph')} aria-label={t('yc.er.404.search')} style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'none', fontSize: 15.5, color: 'var(--ink)', font: 'inherit' }} />
          <Hv as="button" type="submit" style={{ height: 44, padding: '0 22px', border: 0, borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', transition: 'background 160ms' }} hover={{ background: 'var(--sand-700)' }} active={{ transform: 'scale(.97)' }}>{t('yc.er.404.search')}</Hv>
        </form>
        <nav style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13.5, color: 'var(--sand-500)', paddingRight: 4 }}>{t('yc.er.404.goto')}</span>
          {links.map(([label, to]) => (
            <Hv key={to} as="a" href={to} onClick={(e: React.MouseEvent) => { e.preventDefault(); nav(to); }} style={{ ...pill(36), padding: '0 16px', fontSize: 13.5 }} hover={pillHover}>{label}</Hv>
          ))}
          <Hv as="a" href={CRM_ROUTES.accountSection('help')} onClick={(e: React.MouseEvent) => { e.preventDefault(); nav(CRM_ROUTES.accountSection('help')); }} style={{ ...pill(36), padding: '0 16px', fontSize: 13.5 }} hover={pillHover}>{t('yc.er.support')}</Hv>
        </nav>
        <div style={{ marginTop: 26, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
          <RedCta icon="arrowLeft" onClick={goBack}>{t('yc.er.404.back')}</RedCta>
          <WhitePill onClick={() => nav(CRM_ROUTES.home)}>{t('yc.er.404.toHome')}</WhitePill>
        </div>
      </main>
    </Frame>
  );
}

/* ───────────────────────── 401 ───────────────────────── */
export function SignedOutScreen({ path }: { path: string }) {
  const { t } = useCrmT();
  const title = useTitle();
  const { language } = useLanguage();
  return (
    <Frame right={<Hv as="a" href={mailto} style={{ fontSize: 14, fontWeight: 600, color: 'var(--red-600)', textDecoration: 'none' }} hover={{ color: 'var(--red-700)', textDecoration: 'underline' }}>{t('yc.er.help')}</Hv>}>
      <ErrStyles />
      <main className="yc-er yc-er-rise" style={{ flex: 1, display: 'grid', placeItems: 'center', padding: '0 20px 48px' }}>
        <div style={{ width: 440, maxWidth: '100%', boxSizing: 'border-box', background: '#fff', borderRadius: 28, padding: '36px 32px 28px', boxShadow: 'var(--shadow-lg)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <YunitFace mood="content" size={64} />
            <span style={{ position: 'absolute', right: -6, bottom: -4, width: 24, height: 24, borderRadius: 99, background: 'var(--ink)', color: '#fff', display: 'grid', placeItems: 'center', border: '2px solid #fff' }}><Icon name="lock" size={12} stroke={2.4} /></span>
          </div>
          <MonoLabel size={11}>{t('yc.er.401.kicker')}</MonoLabel>
          <Headline tpl={title('yc.er.401.title', 'go')} word={t('yc.er.401.go')} size={30} style={{ marginTop: 10 }} />
          <p style={{ margin: '12px 0 0', fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.er.401.body')}</p>
          <div style={{ marginTop: 18, width: '100%', boxSizing: 'border-box', height: 40, borderRadius: 12, background: 'var(--sand-50)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', fontSize: 12.5, color: 'var(--sand-500)' }}>
            <span>{t('yc.er.401.dest')}</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{path}</span>
          </div>
          <div style={{ marginTop: 18, width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Hv as="a" href={loginUrl(path)} style={{ height: 50, borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'grid', placeItems: 'center', boxShadow: 'var(--shadow-cta)', textDecoration: 'none', transition: `transform 200ms ${SPRING}` }} hover={{ color: '#fff', textDecoration: 'none', transform: 'translateY(-1px)' }} active={{ transform: 'scale(.98)' }}>{t('yc.er.401.signIn')}</Hv>
            <Hv as="a" href={proSignupUrl(language, { product: 'crm', source: 'crm_401' })} style={{ ...pill(50), justifyContent: 'center', fontSize: 15 }} hover={pillHover}>{t('yc.er.401.signUp')}</Hv>
          </div>
          <p style={{ margin: '18px 0 0', fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.er.401.trouble')} <a href={mailto} style={{ color: 'var(--red-600)' }}>{t('yc.er.401.contact')}</a></p>
        </div>
      </main>
    </Frame>
  );
}

/* ───────────────────────── 403 ───────────────────────── */

/**
 * Le titulaire d'un compte Yuno Billetterie sans CRM n'est pas « au mauvais
 * endroit » : on lui propose d'AJOUTER Yuno CRM à ce compte (/open/crm,
 * essai de 14 jours, la billetterie ne change pas). « Changer de compte » ne
 * fait que déconnecter : ce n'est plus le geste principal.
 */
function OpenCrmScreen({ email, offer, onSwitch }: { email: string; offer: OpenCrmOffer; onSwitch: () => void }) {
  const { t } = useCrmT();
  const title = useTitle();
  const rows: [string, string][] = [[t('yc.er.403.account'), email]];
  if (offer.name) rows.push([t('yc.er.403.ticketing'), offer.name]);
  rows.push([t('yc.er.403.crmRow'), t('yc.er.403.crmRowV')]);
  return (
    <Frame right={<span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{email}</span>}>
      <ErrStyles />
      <main className="yc-er yc-er-rise" style={{ flex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 48, padding: '0 clamp(20px,7vw,120px) 56px' }}>
        <div style={{ flex: '1 1 380px', maxWidth: 520 }}>
          <span style={{ width: 52, height: 52, borderRadius: 16, background: 'var(--gradient-brand)', color: '#fff', display: 'grid', placeItems: 'center', marginBottom: 28 }}><Icon name="sparkles" size={22} stroke={2} /></span>
          <MonoLabel>{t('yc.er.403.openKicker')}</MonoLabel>
          <Headline tpl={title('yc.er.403.openTitle', 'word')} word={t('yc.er.403.openWord')} size={56} style={{ marginTop: 14, fontSize: 'clamp(38px,4.6vw,60px)' }} />
          <p style={{ margin: '18px 0 0', fontSize: 16.5, lineHeight: 1.55, color: 'var(--sand-600)', textWrap: 'pretty' }}>
            {offer.name ? t('yc.er.403.openBody', { name: offer.name }) : t('yc.er.403.openBodyMany')}
          </p>
          <div style={{ marginTop: 26, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <RedCta href={offer.href} icon="plus">{t('yc.er.403.openCta')}</RedCta>
            <WhitePill href={mailto}>{t('yc.er.401.contact')}</WhitePill>
          </div>
          <p style={{ margin: '22px 0 0', fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.er.403.wrong')} <button type="button" onClick={onSwitch} style={{ color: 'var(--red-600)', background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }}>{t('yc.er.403.switch')}</button></p>
        </div>
        <div style={{ flex: '0 1 400px', background: '#fff', borderRadius: 24, padding: '24px 28px', boxShadow: 'var(--shadow-lg)', width: 400, maxWidth: '100%', boxSizing: 'border-box' }}>
          <MonoLabel size={11}>{t('yc.er.403.openWhy')}</MonoLabel>
          <div style={{ marginTop: 10 }}>
            {rows.map(([k, v], i) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '14px 0', borderTop: i ? '1px solid var(--sand-100)' : 0, fontSize: 13.5 }}>
                <span style={{ color: 'var(--sand-500)', flex: 'none' }}>{k}</span>
                <span style={{ fontWeight: 600, textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{v}</span>
              </div>
            ))}
          </div>
          <ul style={{ margin: '14px 0 0', padding: '14px 0 0', listStyle: 'none', borderTop: '1px solid var(--sand-100)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(['fact1', 'fact2', 'fact3'] as const).map((k) => (
              <li key={k} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13.5, lineHeight: 1.45, color: 'var(--ink)' }}>
                <span style={{ color: 'var(--red-600)', display: 'inline-flex', flex: 'none', marginTop: 2 }}><Icon name="check" size={16} stroke={2.4} /></span>
                {t(`yc.er.403.${k}`)}
              </li>
            ))}
          </ul>
        </div>
      </main>
    </Frame>
  );
}

export function ForbiddenScreen({ email, page, noSpace = false, openCrm, onSwitch }: { email: string; page?: string; noSpace?: boolean; openCrm?: OpenCrmOffer | null; onSwitch: () => void }) {
  const { t } = useCrmT();
  const title = useTitle();
  const nav = useNavigate();
  if (noSpace && openCrm) return <OpenCrmScreen email={email} offer={openCrm} onSwitch={onSwitch} />;
  const rows: [string, string, string?][] = [[t('yc.er.403.account'), email]];
  if (noSpace) rows.push([t('yc.er.403.page'), t('yc.er.403.noSpace')]);
  else { if (page) rows.push([t('yc.er.403.page'), page]); rows.push([t('yc.er.403.who'), t('yc.er.403.whoV')]); }
  return (
    <Frame right={<span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{email}</span>}>
      <ErrStyles />
      <main className="yc-er yc-er-rise" style={{ flex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 48, padding: '0 clamp(20px,7vw,120px) 56px' }}>
        <div style={{ flex: '1 1 380px', maxWidth: 520 }}>
          <span style={{ width: 52, height: 52, borderRadius: 16, background: 'var(--ink)', color: '#fff', display: 'grid', placeItems: 'center', marginBottom: 28 }}><Icon name="lock" size={22} stroke={2} /></span>
          <MonoLabel>{t('yc.er.403.kicker')}</MonoLabel>
          <Headline tpl={title('yc.er.403.title', 'word')} word={t('yc.er.403.word')} size={56} style={{ marginTop: 14, fontSize: 'clamp(38px,4.6vw,60px)' }} />
          <p style={{ margin: '18px 0 0', fontSize: 16.5, lineHeight: 1.55, color: 'var(--sand-600)', textWrap: 'pretty' }}>{noSpace ? t('yc.er.403.bodyNoSpace') : t('yc.er.403.body')}</p>
          <div style={{ marginTop: 26, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {!noSpace && <RedCta onClick={() => nav(CRM_ROUTES.home)}>{t('yc.er.404.toHome')}</RedCta>}
            {noSpace && <RedCta onClick={onSwitch}>{t('yc.er.403.switch')}</RedCta>}
            <WhitePill href={mailto}>{t('yc.er.401.contact')}</WhitePill>
          </div>
          {!noSpace && <p style={{ margin: '22px 0 0', fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.er.403.wrong')} <button type="button" onClick={onSwitch} style={{ color: 'var(--red-600)', background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }}>{t('yc.er.403.switch')}</button></p>}
        </div>
        <div style={{ flex: '0 1 400px', background: '#fff', borderRadius: 24, padding: '24px 28px', boxShadow: 'var(--shadow-lg)', width: 400, maxWidth: '100%', boxSizing: 'border-box' }}>
          <MonoLabel size={11}>{t('yc.er.403.why')}</MonoLabel>
          <div style={{ marginTop: 10 }}>
            {rows.map(([k, v], i) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '14px 0', borderTop: i ? '1px solid var(--sand-100)' : 0, fontSize: 13.5 }}>
                <span style={{ color: 'var(--sand-500)', flex: 'none' }}>{k}</span>
                <span style={{ fontWeight: 600, textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </Frame>
  );
}

/* ───────────────────────── 500 ───────────────────────── */
export function ServerErrorScreen({ code, onReload }: { code: string; onReload: () => void }) {
  const { t } = useCrmT();
  const title = useTitle();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => undefined);
  };
  return (
    <Frame>
      <ErrStyles />
      <main className="yc-er yc-er-rise" style={{ flex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 56, padding: '0 clamp(20px,7vw,120px) 56px' }}>
        <div aria-hidden style={{ position: 'relative', width: 'min(100%,360px)', height: 360, borderRadius: 32, background: 'linear-gradient(160deg,var(--sand-50),#fff)', boxShadow: 'inset 0 0 0 1px var(--sand-100)', overflow: 'hidden', flex: 'none' }}>
          <div style={{ position: 'absolute', left: '50%', top: '50%', width: 230, height: 230, marginLeft: -115, marginTop: -115, borderRadius: 99, background: 'rgba(227,20,27,.06)', display: 'grid', placeItems: 'center', animation: 'yc-er-breathe 5s ease-in-out infinite' }}><YunitFace mood="inquiet" size={120} /></div>
          <Token style={{ right: -8, top: 22, rotate: '24deg' }} size={72} delay={0} dur={6} />
          <Token style={{ left: -18, bottom: 28, rotate: '-20deg' }} size={92} delay={-2} dur={7} />
          <Token style={{ right: 36, bottom: 18, rotate: '12deg' }} size={64} delay={-4} dur={6.5} />
        </div>
        <div style={{ flex: '1 1 380px', maxWidth: 500 }}>
          <MonoLabel>{t('yc.er.500.kicker')}</MonoLabel>
          <Headline tpl={title('yc.er.500.title', 'y')} word="Yuno" size={52} style={{ marginTop: 14, fontSize: 'clamp(36px,4.2vw,54px)' }} />
          <p style={{ margin: '18px 0 0', fontSize: 16, lineHeight: 1.55, color: 'var(--ink)', fontWeight: 500, textWrap: 'pretty' }}>{t('yc.er.500.body')}</p>
          <div style={{ marginTop: 24, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <RedCta icon="refresh" onClick={onReload}>{t('yc.er.500.reload')}</RedCta>
            <WhitePill href={mailto}>{t('yc.er.401.contact')}</WhitePill>
          </div>
          <div style={{ marginTop: 22, display: 'inline-flex', alignItems: 'center', gap: 18, padding: '10px 12px 10px 18px', borderRadius: 16, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-100)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 11.5, color: 'var(--sand-500)' }}>{t('yc.er.500.ref')}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500 }}>{code}</span>
            </div>
            <Hv as="button" type="button" onClick={copy} style={{ ...pill(36), padding: '0 14px', fontSize: 13 }} hover={pillHover}><Icon name={copied ? 'check' : 'copy'} size={15} stroke={2.2} />{copied ? t('yc.er.500.copied') : t('yc.er.500.copy')}</Hv>
          </div>
          <p style={{ margin: '18px 0 0', fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.er.500.alt')} <a href={mailto} style={{ color: 'var(--red-600)' }}>{SUPPORT_EMAIL}</a></p>
        </div>
      </main>
    </Frame>
  );
}

/* ───────────────────────── 503 ───────────────────────── */
export function MaintenanceScreen({ message, onRetry }: { message?: string | null; onRetry: () => void }) {
  const { t } = useCrmT();
  const title = useTitle();
  const mood: YunitMood = 'endormi';
  return (
    <Frame dark bg="radial-gradient(60% 50% at 50% 30%,rgba(227,20,27,.42),transparent 70%),#1a1517">
      <ErrStyles />
      <main className="yc-er yc-er-rise" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 24px 64px' }}>
        <div style={{ position: 'relative', width: 188, height: 188, borderRadius: 99, display: 'grid', placeItems: 'center', background: 'radial-gradient(circle,rgba(227,20,27,.3),rgba(227,20,27,.04) 70%)', animation: 'yc-er-breathe 5s ease-in-out infinite' }}>
          <YunitFace mood={mood} size={104} />
          <span aria-hidden style={{ position: 'absolute', right: 6, top: 6, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'rgba(255,255,255,.5)', fontSize: 22, animation: 'yc-er-z 3s ease-in infinite' }}>z</span>
        </div>
        <MonoLabel color="rgba(255,255,255,.55)" style={{ marginTop: 30 }}>{t('yc.er.503.kicker')}</MonoLabel>
        <Headline tpl={title('yc.er.503.title', 'soon')} word={t('yc.er.503.soon')} size={54} style={{ marginTop: 14, fontSize: 'clamp(36px,4.4vw,56px)' }} />
        <p style={{ margin: '16px 0 0', fontSize: 16.5, lineHeight: 1.55, color: 'rgba(255,255,255,.7)', maxWidth: 480, textWrap: 'pretty' }}>{message?.trim() || t('yc.er.503.body')}</p>
        <div style={{ marginTop: 28, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
          <Hv as="button" type="button" onClick={onRetry} style={{ ...pill(46), background: 'rgba(255,255,255,.08)', borderColor: 'rgba(255,255,255,.18)', color: '#fff' }} hover={{ color: '#fff', background: 'rgba(255,255,255,.14)', textDecoration: 'none' }}><Icon name="refresh" size={16} stroke={2.2} />{t('yc.er.503.retry')}</Hv>
        </div>
      </main>
    </Frame>
  );
}

/* ───────────────────────── Hors ligne ───────────────────────── */
export function OfflineScreen({ seconds, onRetry }: { seconds: number; onRetry: () => void }) {
  const { t } = useCrmT();
  const title = useTitle();
  return (
    <Frame bg="radial-gradient(50% 40% at 50% 0%,rgba(255,176,32,.12),transparent 70%),var(--paper)" right={<span />}>
      <ErrStyles />
      <main className="yc-er yc-er-rise" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 24px 64px' }}>
        <div style={{ position: 'relative' }}>
          <YunitFace mood="endormi" size={92} />
          <span style={{ position: 'absolute', right: -6, bottom: -2, width: 30, height: 30, borderRadius: 99, background: '#fff', boxShadow: 'var(--shadow-sm)', display: 'grid', placeItems: 'center', color: '#B8860B' }}><Icon name="globe" size={16} stroke={2.2} /></span>
        </div>
        <Headline tpl={title('yc.er.off.title', 'off')} word={t('yc.er.off.off')} size={46} style={{ marginTop: 22, fontSize: 'clamp(32px,4vw,48px)' }} />
        <p style={{ margin: '14px 0 0', fontSize: 16, lineHeight: 1.5, color: 'var(--sand-600)', maxWidth: 440, textWrap: 'pretty' }}>{t('yc.er.off.body')}</p>
        <div style={{ marginTop: 22, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 12 }}>
          <span style={{ height: 36, padding: '0 14px', borderRadius: 99, background: 'rgba(255,176,32,.14)', color: '#8a5a00', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <i style={{ width: 7, height: 7, borderRadius: 99, background: '#E59A0B' }} />{t('yc.er.off.next', { s: seconds })}
          </span>
          <RedCta icon="refresh" onClick={onRetry}>{t('yc.er.off.now')}</RedCta>
        </div>
        <p style={{ margin: '26px 0 0', fontSize: 13, color: 'var(--sand-500)', maxWidth: 380 }}>{t('yc.er.off.note')}</p>
      </main>
    </Frame>
  );
}

/** Mesure du temps avant la prochaine tentative automatique. */
export function useCountdown(seconds: number, resetKey: unknown): number {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    setLeft(seconds);
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [seconds, resetKey]);
  return left;
}
