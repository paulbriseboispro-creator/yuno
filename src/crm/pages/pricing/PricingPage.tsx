/**
 * Tarifs de Yuno CRM (/crm/tarifs, maquette « Tarifs.dc.html ») — page
 * PUBLIQUE : un abonnement, des Yunits, un simulateur du mois, les recharges,
 * l'annuel, l'essai et la FAQ.
 *
 * Tous les chiffres viennent de `crm_pricing_config` (la grille que lisent le
 * checkout et le serveur) et des règles de recharge partagées
 * (`@/lib/crmBilling`) : changer un prix en base change la page. Une fonction
 * pas encore ouverte (SMS, Meta, connecteur Shotgun, recharge automatique)
 * porte « Bientôt », lu sur les mêmes interrupteurs que la Console.
 *
 * Un visiteur est mené à l'inscription (landing, produit CRM) ; quelqu'un de
 * connecté retrouve sa Console, son abonnement et ses recharges.
 */
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Wordmark } from '@/components/brand/Wordmark';
import { PRO_SIGNUP_ORIGIN, proSignupUrl } from '@/lib/proSignup';
import { META_INTEGRATION_LIVE } from '@/lib/metaIntegration';
import { CRM_RECHARGE, crmRechargeQuote } from '@/lib/crmBilling';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { Skel } from '@/crm/ui/kit';
import { EASE, SPRING, prefersReducedMotion } from '@/crm/ui/motion';
import { useNarrow } from '@/crm/ui/useNarrow';
import { useCrmT } from '@/crm/i18n';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { CrmPublicShell } from '@/crm/shell/CrmLayout';
import { CRM_SMS_SEND_OPEN } from '@/crm/lib/sms';
import { usePricingConfig } from '@/crm/data/pricing';
import {
  EMAILS_MAX, estimateMonth, fromSlider, PRICING_PROFILES, rechargeExamples, SMS_MAX, snapEmails, snapSms, toSlider,
  type CrmPricingConfig, type PricingProfileId,
} from '@/crm/lib/pricing';
import yunoIcon from '@/crm/assets/yuno-app-icon.webp';
import { useSeen, useTween } from './pricingMotion';

const TOKEN = '/crm/yunit-token.webp';
/** Durée de chaque étape de la démo du solde (ms). */
const DEMO_WAITS = [900, 1500, 1500, 1300, 1300, 1900, 2800];
const wrap: CSSProperties = { maxWidth: 1200, margin: '0 auto', boxSizing: 'border-box', padding: '0 clamp(16px,4vw,40px)' };
const kick: CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--sand-500)' };
const h2: CSSProperties = { margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(34px,5vw,54px)', lineHeight: 1.04, letterSpacing: '-.045em', textWrap: 'balance' };
const lead: CSSProperties = { margin: 0, fontSize: 'clamp(16px,1.6vw,19px)', lineHeight: 1.55, color: 'var(--sand-600)', maxWidth: 720, textWrap: 'pretty' };

export default function PricingPage() {
  return (
    <CrmPublicShell>
      <PricingBody />
    </CrmPublicShell>
  );
}

function PricingBody() {
  const q = usePricingConfig();
  useEffect(() => {
    const prev = document.title;
    document.title = 'Yuno CRM · Tarifs';
    return () => { document.title = prev; };
  }, []);
  if (!q.data && q.isError) {
    return <div style={{ ...wrap, paddingTop: 120 }}><CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /></div>;
  }
  if (!q.data) {
    return (
      <div style={{ ...wrap, paddingTop: 140, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
        <Skel h={34} w={280} r={99} />
        <Skel h={150} w={640} r={24} />
        <Skel h={480} w={1000} r={32} />
      </div>
    );
  }
  return <Pricing cfg={q.data} />;
}

/** useCrmT, mais un nombre ne se coupe jamais en fin de ligne (« 30 000 », « 24 € »). */
function usePrT() {
  const T = useCrmT();
  return { ...T, n: (x: number | null | undefined) => T.n(x).replace(/ /g, '\u00a0') };
}

/** Une phrase avec un mot en dégradé. */
function Accent({ a, b, c }: { a: string; b: string; c: string }) {
  return <>{a}<span className="yc-accent-word">{b}</span>{c}</>;
}

/** Apparition au défilement (fondu + montée + flou), décalée par `i`. */
function Reveal({ i = 0, children, style }: { i?: number; children: ReactNode; style?: CSSProperties }) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const still = prefersReducedMotion();
  return (
    <div ref={ref} style={{ ...style, ...(still ? null : seen ? { animation: `yc-pr-in 800ms ${EASE} ${i * 80}ms both` } : { opacity: 0 }) }}>
      {children}
    </div>
  );
}

function Pricing({ cfg }: { cfg: CrmPricingConfig }) {
  const T = usePrT();
  const { t, n, lang } = T;
  const { user } = useAuth();
  const signedIn = !!user;
  const narrow = useNarrow(620);
  const [annual, setAnnual] = useState(false);

  const tryHref = proSignupUrl(lang, { product: 'crm', source: 'crm_pricing' });
  const productHref = `${PRO_SIGNUP_ORIGIN}${lang === 'fr' ? '/fr' : lang === 'es' ? '/es' : ''}/crm`;
  // Mois de prix que valent les Yunits offerts à l'annuel (au tarif de recharge).
  const freeMonths = Math.max(1, Math.round(cfg.annual_bonus_yunits / cfg.yunits_per_euro / cfg.price_month));
  // Le bouton d'essai d'un visiteur ouvre la Console de quelqu'un de connecté, libellé compris.
  const cta: Cta = (label, style, hover, decorate) => {
    const text = signedIn ? t('yc.pr.openConsole') : label;
    const body = decorate ? decorate(text) : text;
    return signedIn
      ? <Hv as={Link} to={CRM_ROUTES.home} style={style} hover={hover}>{body}</Hv>
      : <Hv as="a" href={tryHref} style={style} hover={hover}>{body}</Hv>;
  };

  const goAnnual = () => {
    setAnnual(true);
    document.getElementById('yc-pr-price')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
  };

  return (
    <div style={{ fontFamily: 'var(--font-body)', color: 'var(--ink)', background: '#fff', overflowX: 'clip' }}>
      <style>{'@keyframes yc-pr-in{from{opacity:0;transform:translateY(18px);filter:blur(8px)}to{opacity:1;transform:none;filter:blur(0)}}html{scroll-behavior:smooth}'}</style>

      {/* Navigation */}
      <div style={{ position: 'sticky', top: 0, zIndex: 30, padding: '12px clamp(12px,3vw,24px) 0', pointerEvents: 'none' }}>
        <nav aria-label={t('yc.pr.nav.aria')} style={{ pointerEvents: 'auto', maxWidth: 960, margin: '0 auto', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0 8px 0 14px', borderRadius: 999, background: 'rgba(255,255,255,.86)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', border: '1px solid var(--sand-100)', boxShadow: 'var(--shadow-sm)', boxSizing: 'border-box' }}>
          <Hv as="a" href={productHref} style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none' }} hover={{ textDecoration: 'none' }}>
            <img src={yunoIcon} alt="" style={{ width: 28, height: 28, borderRadius: 8, display: 'block' }} />
            <Wordmark height={18} tone="dark" />
          </Hv>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center', gap: 2, fontSize: 14, fontWeight: 500 }}>
            {!narrow && <NavLink href={productHref}>{t('yc.pr.nav.product')}</NavLink>}
            <span style={{ padding: '8px 12px', borderRadius: 999, color: 'var(--ink)', background: 'var(--sand-50)', whiteSpace: 'nowrap' }}>{t('yc.pr.nav.pricing')}</span>
            {!narrow && <NavLink href="#faq">{t('yc.pr.nav.faq')}</NavLink>}
          </div>
          {cta(t('yc.pr.try', { d: cfg.trial_days }),
            { flex: 'none', height: 40, padding: '0 18px', borderRadius: 999, background: 'var(--ink)', color: '#fff', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none', whiteSpace: 'nowrap', transition: `background 160ms,transform 200ms ${SPRING}` },
            { background: 'var(--sand-700)', color: '#fff', textDecoration: 'none', transform: 'translateY(-1px)' })}
        </nav>
      </div>

      {/* Héros + prix */}
      <section style={{ marginTop: -68, padding: '140px clamp(16px,4vw,40px) clamp(64px,8vw,112px)', background: 'radial-gradient(60% 50% at 50% 0%,rgba(227,20,27,.11),transparent 70%),#fff' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 22 }}>
          <Reveal i={0}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 34, padding: '0 14px 0 5px', borderRadius: 999, background: '#fff', border: '1px solid var(--sand-200)', fontSize: 14, fontWeight: 500 }}>
              <span style={{ height: 24, padding: '0 10px', borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center' }}>{t('yc.pr.hero.badge')}</span>
              {t('yc.pr.hero.badgeT')}
            </span>
          </Reveal>
          <Reveal i={1}>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(44px,7.4vw,80px)', lineHeight: 1, letterSpacing: '-.055em', textWrap: 'balance' }}>
              {t('yc.pr.hero.h1')}<br /><Accent a={t('yc.pr.hero.h2a')} b={t('yc.pr.hero.h2b')} c="." />
            </h1>
          </Reveal>
          <Reveal i={2}><p style={{ ...lead, maxWidth: 580 }}>{t('yc.pr.hero.sub')}</p></Reveal>
          <Reveal i={3} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, width: '100%' }}>
            <div role="radiogroup" aria-label={t('yc.pr.nav.pricing')} style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr', width: 'min(100%,340px)', padding: 5, borderRadius: 999, background: 'var(--sand-100)', boxSizing: 'border-box' }}>
              <span aria-hidden style={{ position: 'absolute', top: 5, bottom: 5, left: 5, width: 'calc(50% - 5px)', borderRadius: 999, background: '#fff', boxShadow: 'var(--shadow-sm)', transform: annual ? 'translateX(100%)' : 'none', transition: `transform 420ms ${SPRING}` }} />
              {[false, true].map((a) => (
                <button key={String(a)} type="button" role="radio" aria-checked={annual === a} onClick={() => setAnnual(a)} style={{ position: 'relative', height: 42, border: 0, background: 'none', borderRadius: 999, fontSize: 15, fontWeight: 600, color: annual === a ? 'var(--ink)' : 'var(--sand-600)', cursor: 'pointer', transition: 'color 200ms' }}>
                  {t(a ? 'yc.pr.yearly' : 'yc.pr.monthly')}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 14, color: 'var(--sand-600)' }}>
              {t('yc.pr.yearlyNote.a')}<b style={{ color: 'var(--ink)', fontWeight: 600 }}>{t('yc.pr.yearlyNote.b', { n: n(cfg.annual_bonus_yunits) })}</b>{t('yc.pr.yearlyNote.c', { m: freeMonths })}
            </span>
          </Reveal>
          <Reveal i={4} style={{ width: '100%', marginTop: 18 }}>
            <PriceCard cfg={cfg} annual={annual} cta={cta} />
          </Reveal>
          <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.pr.vat', { v: cfg.vat_rate })}</span>
        </div>
      </section>

      <YunitsSection cfg={cfg} />
      <Simulator cfg={cfg} cta={cta} />
      <Recharges cfg={cfg} />
      <Annual cfg={cfg} freeMonths={freeMonths} signedIn={signedIn} onChoose={goAnnual} />
      <Trial cfg={cfg} />
      <Faq cfg={cfg} />

      {/* Appel final */}
      <section style={{ padding: '24px clamp(12px,3vw,60px) 0' }}>
        <Reveal style={{ position: 'relative', overflow: 'hidden', isolation: 'isolate', maxWidth: 1320, margin: '0 auto', borderRadius: 40, padding: 'clamp(56px,8vw,104px) clamp(20px,4vw,48px)', background: 'radial-gradient(70% 90% at 0% 0%,rgba(255,255,255,.16),transparent 60%),var(--gradient-brand)', color: '#fff', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, boxSizing: 'border-box' }}>
          <h2 style={{ ...h2, color: '#fff', fontSize: 'clamp(36px,5.6vw,64px)' }}>{signedIn ? t('yc.pr.end.tIn') : t('yc.pr.end.t', { d: cfg.trial_days })}</h2>
          <p style={{ ...lead, color: 'rgba(255,255,255,.88)', maxWidth: 560 }}>{signedIn ? t('yc.pr.end.sIn') : t('yc.pr.end.s', { n: n(cfg.trial_yunits) })}</p>
          {cta(t('yc.pr.end.cta'),
            { marginTop: 8, height: 56, padding: '0 8px 0 26px', borderRadius: 99, background: '#fff', color: 'var(--ink)', fontSize: 16.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 16, textDecoration: 'none', boxShadow: '0 18px 40px -16px rgba(0,0,0,.45)', transition: `transform 220ms ${SPRING}` },
            { color: 'var(--ink)', textDecoration: 'none', transform: 'translateY(-2px)' },
            (text) => <>{text}<span style={{ width: 40, height: 40, borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="arrowRight" size={18} stroke={2.4} /></span></>)}
        </Reveal>
      </section>

      <footer style={{ ...wrap, maxWidth: 1200, padding: '40px clamp(16px,6vw,100px) 48px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 18 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <img src={yunoIcon} alt="" style={{ width: 24, height: 24, borderRadius: 7, display: 'block' }} />
          <Wordmark height={16} tone="dark" />
        </span>
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px', fontSize: 14 }}>
          <FootLink to="/legal/cgu">{t('yc.pr.foot.terms')}</FootLink>
          <FootLink to="/legal/privacy">{t('yc.pr.foot.privacy')}</FootLink>
          <FootLink to={CRM_ROUTES.yunits}>{t('yc.pr.foot.recharge')}</FootLink>
        </span>
        <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{t('yc.pr.foot.hosting')}</span>
      </footer>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Hv as="a" href={href} style={{ padding: '8px 12px', borderRadius: 999, color: 'var(--sand-600)', textDecoration: 'none', whiteSpace: 'nowrap' }} hover={{ background: 'var(--sand-50)', color: 'var(--ink)', textDecoration: 'none' }}>
      {children}
    </Hv>
  );
}

function FootLink({ to, children }: { to: string; children: ReactNode }) {
  return <Hv as={Link} to={to} style={{ color: 'var(--sand-600)', textDecoration: 'none' }} hover={{ color: 'var(--ink)', textDecoration: 'none' }}>{children}</Hv>;
}

type Cta = (label: string, style: CSSProperties, hover: CSSProperties, decorate?: (text: string) => ReactNode) => ReactNode;

// ── Carte prix ─────────────────────────────────────────────────────────────
function PriceCard({ cfg, annual, cta }: { cfg: CrmPricingConfig; annual: boolean; cta: Cta }) {
  const { t, n } = usePrT();
  const price = useTween(annual ? cfg.price_year : cfg.price_month, 800);
  const feats: { k: string; soon: boolean; dSoon?: boolean }[] = [
    // Le connecteur Shotgun est ouvert à tout compte Yuno CRM (CRM_CONNECTORS_LIVE ne garde que la carte de la Billetterie).
    { k: 'shotgun', soon: false },
    { k: 'base', soon: false },
    { k: 'segments', soon: false },
    { k: 'reports', soon: false },
    { k: 'campaigns', soon: false, dSoon: !CRM_SMS_SEND_OPEN },
    { k: 'auto', soon: false },
    { k: 'meta', soon: !META_INTEGRATION_LIVE },
    { k: 'ai', soon: false },
    { k: 'team', soon: false },
  ];
  return (
    <div id="yc-pr-price" style={{ display: 'flex', flexWrap: 'wrap', textAlign: 'left', borderRadius: 32, overflow: 'hidden', background: '#fff', boxShadow: '0 0 0 1px var(--sand-200),0 30px 60px -30px rgba(40,20,20,.28)' }}>
      <div style={{ flex: '1 1 380px', minWidth: 0, padding: 'clamp(24px,3.4vw,44px)', display: 'flex', flexDirection: 'column', gap: 20, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={kick}>{t('yc.pr.card.k')}</span>
          {cfg.tier !== 'public' && (
            <span style={{ height: 26, padding: '0 11px', borderRadius: 99, background: 'var(--red-50)', color: 'var(--red-700)', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--red-500)' }} />{t('yc.pr.card.launch')}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(84px,11vw,124px)', lineHeight: 0.9, letterSpacing: '-.06em', fontVariantNumeric: 'tabular-nums' }}>{n(price)}</span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 44, letterSpacing: '-.03em' }}>€</span>
          <span style={{ fontSize: 16, color: 'var(--sand-600)' }}>{t(annual ? 'yc.pr.card.per.year' : 'yc.pr.card.per.month')}</span>
        </div>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.55, color: 'var(--sand-700)', textWrap: 'pretty', minHeight: 50 }}>
          {annual ? t('yc.pr.card.subYear', { p: n(cfg.price_month) }) : cfg.tier === 'public' ? t('yc.pr.card.subMonthPublic') : t('yc.pr.card.subMonth', { p: n(cfg.price_month), next: n(cfg.price_month_next) })}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px', borderRadius: 18, background: 'var(--sand-50)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 15.5, fontWeight: 600 }}>
            <img src={TOKEN} alt="" style={{ width: 32, height: 32, flex: 'none' }} />{t('yc.pr.card.monthly', { n: n(cfg.monthly_yunits) })}
          </span>
          <div style={{ display: 'grid', gridTemplateRows: annual ? '1fr' : '0fr', transition: `grid-template-rows 420ms ${EASE}` }}>
            <span style={{ overflow: 'hidden', minHeight: 0, paddingLeft: 44, fontSize: 14.5, color: 'var(--sand-700)' }}>
              <b style={{ fontWeight: 600, color: 'var(--red-600)' }}>{t('yc.pr.card.bonus', { n: n(cfg.annual_bonus_yunits) })}</b> · {t('yc.pr.card.bonusEq', { e: n(cfg.annual_bonus_yunits / cfg.yunits_per_euro) })}
            </span>
          </div>
        </div>
        {cta(t('yc.pr.tryFree', { d: cfg.trial_days }),
          { height: 58, padding: '0 8px 0 26px', borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 17, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, textDecoration: 'none', boxShadow: '0 16px 32px -14px rgba(227,20,27,.65)', transition: `transform 220ms ${SPRING},box-shadow 220ms` },
          { color: '#fff', textDecoration: 'none', transform: 'translateY(-2px)', boxShadow: '0 20px 38px -14px rgba(227,20,27,.75)' },
          (text) => <>{text}<span style={{ flex: 'none', width: 42, height: 42, borderRadius: 99, background: '#fff', color: 'var(--red-600)', display: 'grid', placeItems: 'center' }}><Icon name="arrowRight" size={18} stroke={2.4} /></span></>)}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', fontSize: 14, color: 'var(--sand-600)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="check" size={15} stroke={2.6} color="var(--green-700)" />{t('yc.pr.card.noCard')}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="check" size={15} stroke={2.6} color="var(--green-700)" />{t('yc.pr.card.trialY', { n: n(cfg.trial_yunits) })}</span>
        </div>
      </div>
      <div style={{ flex: '1 1 380px', minWidth: 0, padding: 'clamp(24px,3.4vw,44px)', background: 'radial-gradient(80% 60% at 100% 0%,rgba(255,107,53,.12),transparent 70%),var(--sand-50)', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={kick}>{t('yc.pr.inc.k')}</span>
        <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(22px,2.4vw,28px)', letterSpacing: '-.03em', marginBottom: 12 }}>{t('yc.pr.inc.t')}</b>
        {feats.map((f) => (
          <div key={f.k} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 0', borderTop: '1px solid var(--sand-200)' }}>
            <span style={{ flex: 'none', width: 22, height: 22, borderRadius: 99, background: f.soon ? 'var(--sand-300)' : 'var(--green-500)', color: '#fff', display: 'grid', placeItems: 'center', marginTop: 1 }}><Icon name="check" size={13} stroke={3} /></span>
            <span style={{ fontSize: 15.5, lineHeight: 1.4, color: 'var(--sand-700)' }}>
              <b style={{ fontWeight: 600, color: f.soon ? 'var(--sand-600)' : 'var(--ink)' }}>{t(`yc.pr.f.${f.k}.t`)}</b> · {t(f.dSoon ? `yc.pr.f.${f.k}.dSoon` : `yc.pr.f.${f.k}.d`)}
              {f.soon && <SoonTag />}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SoonTag() {
  const { t } = usePrT();
  return <span style={{ marginLeft: 8, height: 20, padding: '0 8px', borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', fontSize: 11.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', verticalAlign: '2px' }}>{t('yc.pr.soon')}</span>;
}

// ── Yunits ────────────────────────────────────────────────────────────────
function YunitsSection({ cfg }: { cfg: CrmPricingConfig }) {
  const { t, n } = usePrT();
  const rate = (k: string) => Number(cfg.rates[k] ?? 0);
  const rows = (['email', 'sms', 'instagram', 'whatsapp'] as const).map((k) => ({
    k, cost: rate(k), soon: !cfg.channels_live[k] || (k === 'sms' && !CRM_SMS_SEND_OPEN),
  }));
  return (
    <section style={{ ...wrap, padding: 'clamp(72px,10vw,140px) clamp(16px,4vw,40px)' }}>
      <Reveal><span style={kick}>{t('yc.pr.y.k')}</span></Reveal>
      <Reveal i={1} style={{ marginTop: 14 }}><h2 style={h2}><Accent a={t('yc.pr.y.h.a')} b={t('yc.pr.y.h.b')} c={t('yc.pr.y.h.c')} /></h2></Reveal>
      <Reveal i={2} style={{ marginTop: 18 }}><p style={lead}>{t('yc.pr.y.sub', { n: n(cfg.monthly_yunits) })}</p></Reveal>
      <div style={{ marginTop: 48, display: 'flex', flexWrap: 'wrap', gap: 'clamp(28px,4vw,40px)', alignItems: 'flex-start' }}>
        <Reveal i={3} style={{ flex: '1 1 420px', minWidth: 0 }}>
          <div style={{ borderTop: '1px solid var(--sand-200)' }}>
            {rows.map((r) => (
              <div key={r.k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '20px 0', borderBottom: '1px solid var(--sand-200)', opacity: r.soon ? 0.55 : 1 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(24px,2.6vw,30px)', letterSpacing: '-.03em', whiteSpace: 'nowrap' }}>{t(`yc.pr.ch.${r.k}`)}</b>
                  {r.soon && <span style={{ height: 22, padding: '0 9px', borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{t('yc.pr.soon')}</span>}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,38px)', letterSpacing: '-.04em', fontVariantNumeric: 'tabular-nums' }}>{n(r.cost)}</b>
                  <img src={TOKEN} alt="Yunits" style={{ width: 28, height: 28 }} />
                </span>
              </div>
            ))}
          </div>
          <b style={{ display: 'block', marginTop: 26, fontSize: 15 }}>{t('yc.pr.y.free')}</b>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {['free1', 'free2', 'free3'].map((k) => (
              <span key={k} style={{ minHeight: 34, padding: '6px 14px', boxSizing: 'border-box', borderRadius: 99, background: 'var(--green-50)', color: 'var(--green-700)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{t(`yc.pr.y.${k}`)}</span>
            ))}
          </div>
          <p style={{ margin: '16px 0 0', fontSize: 15, color: 'var(--sand-600)' }}>
            {t('yc.pr.y.eq', { n: n(cfg.monthly_yunits), e: n(cfg.monthly_yunits / Math.max(1, rate('email'))), s: n(Math.floor(cfg.monthly_yunits / Math.max(1, rate('sms')))) })}
          </p>
        </Reveal>
        <Reveal i={4} style={{ flex: '1 1 420px', minWidth: 0 }}>
          <BalanceDemo cfg={cfg} />
        </Reveal>
      </div>
    </section>
  );
}

/** Le solde qui vit : envois, gratuits, solde bas, recharge — en boucle. */
function BalanceDemo({ cfg }: { cfg: CrmPricingConfig }) {
  const { t, n } = usePrT();
  const e = Number(cfg.rates.email ?? 1), s = Number(cfg.rates.sms ?? 35);
  const top = crmRechargeQuote(CRM_RECHARGE.min);
  const rows: { t: string; s: string; d: number; k: 'minus' | 'free' | 'plus' }[] = [
    { t: t('yc.pr.d.r1.t'), s: t('yc.pr.d.r1.s', { n: n(2200) }), d: -2200 * e, k: 'minus' },
    { t: t('yc.pr.d.r2.t'), s: t('yc.pr.d.r2.s', { n: 60 }), d: -60 * s, k: 'minus' },
    { t: t('yc.pr.d.r3.t'), s: t('yc.pr.d.r3.s'), d: 0, k: 'free' },
    { t: t('yc.pr.d.r4.t'), s: t('yc.pr.d.r4.s', { n: 12 }), d: 0, k: 'free' },
    { t: t('yc.pr.d.r5.t'), s: t('yc.pr.d.r1.s', { n: n(5000) }), d: -5000 * e, k: 'minus' },
    { t: t('yc.pr.d.r6.t', { p: n(top ? top.amountCents / 100 : CRM_RECHARGE.min / CRM_RECHARGE.perEuro) }), s: t('yc.pr.d.r6.s'), d: top?.received ?? CRM_RECHARGE.min, k: 'plus' },
  ];
  const balances = rows.reduce<number[]>((acc, r) => [...acc, Math.max(0, acc[acc.length - 1] + r.d)], [cfg.monthly_yunits]);
  const [ref, seen] = useSeen<HTMLDivElement>();
  const still = prefersReducedMotion();
  const [stage, setStage] = useState(still ? rows.length : 0);
  useEffect(() => {
    if (still || !seen) return;
    const id = window.setTimeout(() => setStage((x) => (x + 1) % (rows.length + 1)), DEMO_WAITS[stage] ?? 1500);
    return () => window.clearTimeout(id);
  }, [stage, seen, still, rows.length]);
  const bal = useTween(balances[stage], 900);
  const low = stage === rows.length - 1, topped = stage === rows.length;
  const chip = low ? [t('yc.pr.d.low'), 'var(--amber-50)', 'var(--amber-700)'] : topped ? [t('yc.pr.d.topped'), 'var(--green-50)', 'var(--green-700)'] : [t('yc.pr.d.chip'), 'var(--sand-50)', 'var(--sand-600)'];
  return (
    <div ref={ref} style={{ padding: 'clamp(20px,4vw,60px)', borderRadius: 32, background: 'radial-gradient(70% 60% at 100% 0%,rgba(255,107,53,.12),transparent 70%),var(--sand-50)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '22px 20px', borderRadius: 26, background: '#fff', boxShadow: 'var(--shadow-md)', minHeight: 360, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={kick}>{t('yc.pr.d.k')}</span>
          <span style={{ height: 26, padding: '0 10px', borderRadius: 99, background: chip[1], color: chip[2], fontSize: 12.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', transition: 'background 300ms,color 300ms' }}>{chip[0]}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(44px,5vw,56px)', letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums', color: low ? 'var(--amber-700)' : 'var(--ink)', transition: 'color 300ms' }}>{n(bal)}</b>
          <span style={{ fontSize: 16, color: 'var(--sand-600)' }}>Yunits</span>
        </div>
        <div style={{ height: 10, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(100, (bal / Math.max(1, cfg.monthly_yunits)) * 100)}%`, borderRadius: 99, background: low ? 'var(--amber-500)' : 'var(--gradient-brand)', transition: 'background 300ms' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((r, i) => {
            const on = stage > i, last = stage === i + 1;
            const [bg, fg] = r.k !== 'minus' ? ['var(--green-50)', 'var(--green-700)'] : last ? ['var(--red-50)', 'var(--red-700)'] : ['var(--sand-50)', 'var(--sand-700)'];
            return (
              <div key={i} style={{ display: on ? 'flex' : 'none', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 0', borderTop: '1px solid var(--sand-100)', animation: on && !still ? `yc-pr-row 420ms ${EASE} both` : undefined }}>
                <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <b style={{ fontSize: 14.5, fontWeight: 600 }}>{r.t}</b>
                  <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{r.s}</span>
                </span>
                <span style={{ flex: 'none', height: 26, padding: '0 10px', borderRadius: 99, background: bg, color: fg, fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', fontVariantNumeric: 'tabular-nums' }}>
                  {r.k === 'free' ? t('yc.pr.d.free') : `${r.d > 0 ? '+' : '−'} ${n(Math.abs(r.d))}`}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <style>{'@keyframes yc-pr-row{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}'}</style>
    </div>
  );
}

// ── Simulateur ─────────────────────────────────────────────────────────────
function Simulator({ cfg, cta }: { cfg: CrmPricingConfig; cta: Cta }) {
  const { t, n } = usePrT();
  const [emails, setEmails] = useState<number>(PRICING_PROFILES[1].emails);
  const [sms, setSms] = useState<number>(PRICING_PROFILES[1].sms);
  const [profile, setProfile] = useState<PricingProfileId | 'custom'>('orga');
  const est = estimateMonth(emails, sms, cfg);
  const total = useTween(est.total, 600);
  const smsRate = Number(cfg.rates.sms ?? 35);
  const pick = (id: PricingProfileId) => {
    const p = PRICING_PROFILES.find((x) => x.id === id);
    if (!p) return;
    setEmails(p.emails); setSms(p.sms); setProfile(id);
  };
  return (
    <section style={{ padding: 'clamp(72px,10vw,130px) 0', background: 'radial-gradient(60% 40% at 0% 0%,rgba(227,20,27,.07),transparent 70%),var(--sand-50)' }}>
      <div style={wrap}>
        <Reveal><span style={kick}>{t('yc.pr.s.k')}</span></Reveal>
        <Reveal i={1} style={{ marginTop: 14, maxWidth: 640 }}><h2 style={h2}><Accent a={t('yc.pr.s.h.a')} b={t('yc.pr.s.h.b')} c={t('yc.pr.s.h.c')} /></h2></Reveal>
        <Reveal i={2} style={{ marginTop: 18 }}><p style={lead}>{t('yc.pr.s.sub')}</p></Reveal>
        <Reveal i={3} style={{ marginTop: 36, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {PRICING_PROFILES.map((p) => {
            const on = profile === p.id;
            return (
              <Hv key={p.id} as="button" type="button" aria-pressed={on} onClick={() => pick(p.id)}
                style={{ textAlign: 'left', padding: '14px 18px', borderRadius: 18, border: `1px solid ${on ? 'var(--ink)' : 'var(--sand-200)'}`, background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4, transition: 'background 200ms,border-color 200ms' }}
                hover={on ? {} : { borderColor: 'var(--sand-400)' }}>
                <b style={{ fontSize: 15, fontWeight: 600 }}>{t(`yc.pr.p.${p.id}`)}</b>
                <span style={{ fontSize: 13, color: on ? 'var(--sand-300)' : 'var(--sand-600)' }}>
                  {p.sms ? t('yc.pr.p.emailsSms', { e: n(p.emails), s: n(p.sms) }) : t('yc.pr.p.emails', { n: n(p.emails) })}
                </span>
              </Hv>
            );
          })}
        </Reveal>
        <div style={{ marginTop: 24, display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
          <Reveal i={4} style={{ flex: '1 1 420px', minWidth: 0, display: 'flex' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 40, padding: 'clamp(24px,3vw,40px)', borderRadius: 32, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)' }}>
              <SimSlider label={t('yc.pr.s.emails')} aria={t('yc.pr.s.emailsAria')} value={emails} max={EMAILS_MAX} eq={t('yc.pr.s.emailsEq', { n: n(emails * Number(cfg.rates.email ?? 1)) })}
                onChange={(pos) => { setEmails(snapEmails(fromSlider(pos, EMAILS_MAX))); setProfile('custom'); }} />
              <SimSlider label={t('yc.pr.s.sms')} aria={t('yc.pr.s.smsAria')} value={sms} max={SMS_MAX} eq={t('yc.pr.s.smsEq', { s: n(sms), r: smsRate, n: n(sms * smsRate) })}
                onChange={(pos) => { setSms(snapSms(fromSlider(pos, SMS_MAX))); setProfile('custom'); }} />
            </div>
          </Reveal>
          <Reveal i={5} style={{ flex: '1 1 420px', minWidth: 0, display: 'flex' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18, padding: 'clamp(24px,3vw,40px)', borderRadius: 32, color: '#fff', background: 'radial-gradient(70% 60% at 100% 0%,rgba(255,107,53,.18),transparent 70%),radial-gradient(60% 50% at 50% 110%,rgba(227,20,27,.35),transparent 70%),var(--night)', boxShadow: '0 40px 80px -40px rgba(227,20,27,.55)' }}>
              <span style={{ ...kick, color: 'var(--text-on-night-2)' }}>{t('yc.pr.s.est')}</span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(72px,9vw,96px)', lineHeight: 0.9, letterSpacing: '-.06em', fontVariantNumeric: 'tabular-nums' }}>{n(total)}</b>
                <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 36 }}>€</b>
                <span style={{ fontSize: 15, color: 'var(--text-on-night-2)' }}>{t('yc.pr.s.ht')}</span>
              </div>
              <div>
                <div style={{ display: 'flex', gap: 4, height: 12 }}>
                  <div style={{ width: `${est.used ? (est.included / est.used) * 100 : 100}%`, minWidth: est.included ? 12 : 0, borderRadius: 99, background: '#fff', transition: `width 500ms ${EASE}` }} />
                  {est.need > 0 && <div style={{ flex: 1, borderRadius: 99, background: 'var(--gradient-brand)' }} />}
                </div>
                <div style={{ display: 'flex', gap: 18, marginTop: 10, fontSize: 13, color: 'var(--text-on-night-2)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><i style={{ width: 8, height: 8, borderRadius: 2, background: '#fff' }} />{t('yc.pr.s.free')}</span>
                  {est.need > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><i style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--tangerine-500)' }} />{t('yc.pr.s.bought')}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <EstRow l={t('yc.pr.s.sub1')} v={`${n(cfg.price_month)} €`} />
                <EstRow l={t('yc.pr.s.sends')} v={t('yc.pr.s.yunits', { n: n(est.used) })} />
                <EstRow l={t('yc.pr.s.included')} v={`− ${n(est.included)}`} />
                <EstRow l={t('yc.pr.s.recharges')} v={`${n(est.rechargeEur)} €`} />
              </div>
              {est.recharge ? (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <span style={{ height: 30, padding: '0 12px', borderRadius: 99, background: 'rgba(255,255,255,.1)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.14)', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{t('yc.pr.s.one', { p: n(est.rechargeEur) })}</span>
                    {est.recharge.bonusPct > 0 && <span style={{ height: 30, padding: '0 12px', borderRadius: 99, background: 'var(--gradient-brand)', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{t('yc.pr.s.bonus', { p: est.recharge.bonusPct })}</span>}
                  </div>
                  <span style={{ fontSize: 13.5, color: 'var(--text-on-night-2)' }}>{est.left > 0 ? t('yc.pr.s.left', { n: n(est.left) }) : t('yc.pr.s.exact')}</span>
                </>
              ) : <span style={{ fontSize: 13.5, color: 'var(--text-on-night-2)' }}>{t('yc.pr.s.enough')}</span>}
              <div style={{ marginTop: 'auto' }}>
                {cta(t('yc.pr.tryFree', { d: cfg.trial_days }),
                  { height: 54, borderRadius: 99, background: '#fff', color: 'var(--ink)', fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', transition: `transform 220ms ${SPRING}` },
                  { color: 'var(--ink)', textDecoration: 'none', transform: 'translateY(-2px)' })}
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function EstRow({ l, v }: { l: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '13px 0', borderTop: '1px solid rgba(255,255,255,.1)', fontSize: 15 }}>
      <span style={{ color: 'var(--text-on-night-2)' }}>{l}</span>
      <b style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v}</b>
    </div>
  );
}

/** Curseur : un vrai <input type=range> invisible par-dessus le dessin (clavier et lecteurs d'écran compris). */
function SimSlider({ label, aria, value, max, eq, onChange }: { label: string; aria: string; value: number; max: number; eq: string; onChange: (pos: number) => void }) {
  const { n } = usePrT();
  const pos = toSlider(value, max);
  const pct = pos / 10;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <b style={{ fontSize: 16, fontWeight: 600 }}>{label}</b>
        <span style={{ fontSize: 13, color: 'var(--sand-500)', textAlign: 'right' }}>{eq}</span>
      </div>
      <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(40px,4.4vw,52px)', letterSpacing: '-.04em', fontVariantNumeric: 'tabular-nums' }}>{n(value)}</b>
      <div style={{ position: 'relative', height: 30, display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 99, background: 'var(--sand-100)' }} />
        <div style={{ position: 'absolute', left: 0, width: `${pct}%`, height: 4, borderRadius: 99, background: 'var(--gradient-brand)' }} />
        <div aria-hidden style={{ position: 'absolute', left: `calc(${pct}% - 14px)`, width: 28, height: 28, borderRadius: 99, background: '#fff', boxShadow: '0 0 0 2.5px var(--red-500),0 4px 10px rgba(0,0,0,.12)', pointerEvents: 'none' }} />
        <input type="range" min={0} max={1000} step={1} value={pos} onChange={(e) => onChange(Number(e.target.value))} aria-label={aria} aria-valuetext={n(value)}
          style={{ position: 'absolute', inset: 0, width: '100%', margin: 0, opacity: 0, cursor: 'pointer' }} />
      </div>
    </div>
  );
}

// ── Recharges ──────────────────────────────────────────────────────────────
function Recharges({ cfg }: { cfg: CrmPricingConfig }) {
  const { t, n, n2 } = usePrT();
  const narrow = useNarrow(620);
  const list = rechargeExamples();
  const maxY = Math.max(...list.map((q) => q.received));
  const [ref, seen] = useSeen<HTMLDivElement>();
  const smsRate = Math.max(1, Number(cfg.rates.sms ?? 35));
  const emailRate = Math.max(1, Number(cfg.rates.email ?? 1));
  return (
    <section style={{ ...wrap, padding: 'clamp(72px,10vw,130px) clamp(16px,4vw,40px) 0' }}>
      <Reveal><span style={kick}>{t('yc.pr.r.k')}</span></Reveal>
      <Reveal i={1} style={{ marginTop: 14, maxWidth: 640 }}><h2 style={h2}><Accent a={t('yc.pr.r.h.a')} b={t('yc.pr.r.h.b')} c={t('yc.pr.r.h.c')} /></h2></Reveal>
      <Reveal i={2} style={{ marginTop: 18 }}>
        <p style={lead}>{t('yc.pr.r.sub', { min: n(cfg.recharge_min / cfg.yunits_per_euro), max: n(cfg.recharge_max / cfg.yunits_per_euro), step: n(CRM_RECHARGE.step / cfg.yunits_per_euro), m: cfg.purchase_validity_months })}</p>
      </Reveal>
      <div ref={ref} style={{ marginTop: 44, display: 'grid', gridTemplateColumns: `repeat(auto-fit,minmax(min(100%,${narrow ? 150 : 230}px),1fr))`, gap: narrow ? 10 : 16 }}>
        {list.map((q, i) => {
          const hi = i === list.length - 1;
          const eur = q.amountCents / 100;
          return (
            <Reveal key={q.base} i={i} style={{ display: 'flex' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: narrow ? 12 : 16, padding: narrow ? 16 : 24, borderRadius: narrow ? 20 : 26, background: hi ? 'var(--night)' : '#fff', color: hi ? '#fff' : 'var(--ink)', boxShadow: hi ? 'var(--shadow-md)' : 'inset 0 0 0 1px var(--sand-200)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 26 }}>
                  <span style={{ ...kick, color: hi ? 'var(--text-on-night-2)' : 'var(--sand-500)' }}>{t('yc.pr.r.card')}</span>
                  {q.bonusPct > 0 && <span style={{ height: 26, padding: '0 10px', borderRadius: 99, background: hi ? 'var(--gradient-brand)' : 'var(--red-50)', color: hi ? '#fff' : 'var(--red-700)', fontSize: 12.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{t('yc.pr.r.bonus', { p: q.bonusPct })}</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: narrow ? 40 : 52, lineHeight: 1, letterSpacing: '-.05em' }}>{n(eur)}</b>
                  <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24 }}>€</b>
                  <span style={{ fontSize: 13, color: hi ? 'var(--text-on-night-2)' : 'var(--sand-500)' }}>{t('yc.pr.s.ht')}</span>
                </div>
                <div style={{ marginTop: 'auto', height: narrow ? 84 : 124, display: 'flex', alignItems: 'flex-end' }}>
                  <div style={{ width: '100%', height: seen ? Math.max(34, Math.round((q.received / maxY) * (narrow ? 80 : 120))) : 0, borderRadius: 14, background: hi ? 'var(--gradient-brand)' : 'var(--sand-100)', color: hi ? '#fff' : 'var(--sand-700)', display: 'flex', alignItems: hi ? 'flex-start' : 'flex-end', padding: '9px 12px', boxSizing: 'border-box', fontSize: 14, fontWeight: 600, overflow: 'hidden', transition: `height 900ms ${EASE} ${i * 120}ms` }}>
                    {t('yc.pr.s.yunits', { n: n(q.received) })}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 13.5, color: hi ? 'var(--text-on-night-2)' : 'var(--sand-600)' }}>
                  <span>{t('yc.pr.r.eq', { e: n(q.received / emailRate), s: n(Math.floor(q.received / smsRate)) })}</span>
                  <b style={{ fontWeight: 600, color: hi ? '#fff' : 'var(--ink)' }}>{t('yc.pr.r.per', { p: n2((eur / (q.received / emailRate)) * 1000) })}</b>
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>
      <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: 12 }}>
        <InfoCard icon="clock" t={t('yc.pr.r.valid.t', { m: cfg.purchase_validity_months })} d={t('yc.pr.r.valid.d')} />
        <InfoCard icon="refresh" t={t('yc.pr.r.auto.t')} d={t('yc.pr.r.auto.d')} soon />
      </div>
    </section>
  );
}

function InfoCard({ icon, t: title, d, soon }: { icon: 'clock' | 'refresh'; t: string; d: string; soon?: boolean }) {
  return (
    <Reveal style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '18px 20px', borderRadius: 20, background: 'var(--sand-50)' }}>
      <span style={{ flex: 'none', width: 36, height: 36, borderRadius: 11, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', display: 'grid', placeItems: 'center' }}><Icon name={icon} size={17} stroke={2.2} /></span>
      <span style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-600)' }}>
        <b style={{ fontWeight: 600, color: 'var(--ink)' }}>{title}</b> {d}
        {soon && <SoonTag />}
      </span>
    </Reveal>
  );
}

// ── Annuel ─────────────────────────────────────────────────────────────────
function Annual({ cfg, freeMonths, signedIn, onChoose }: { cfg: CrmPricingConfig; freeMonths: number; signedIn: boolean; onChoose: () => void }) {
  const { t, n } = usePrT();
  const [ref, seen] = useSeen<HTMLDivElement>();
  const unit = 56;
  const bars = [cfg.annual_bonus_yunits, ...Array.from({ length: 12 }, () => cfg.monthly_yunits)];
  const btn: CSSProperties = { alignSelf: 'flex-start', height: 50, padding: '0 24px', border: 0, borderRadius: 99, background: '#fff', color: 'var(--ink)', fontSize: 15.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', textDecoration: 'none', cursor: 'pointer', transition: `transform 220ms ${SPRING}` };
  return (
    <section style={{ padding: 'clamp(72px,10vw,130px) clamp(12px,3vw,60px) 0' }}>
      <Reveal style={{ position: 'relative', overflow: 'hidden', isolation: 'isolate', maxWidth: 1320, margin: '0 auto', borderRadius: 40, padding: 'clamp(32px,5vw,64px)', background: 'radial-gradient(60% 60% at 100% 0%,rgba(255,107,53,.16),transparent 70%),radial-gradient(60% 60% at 30% 120%,rgba(227,20,27,.3),transparent 70%),var(--night)', color: 'var(--text-on-night)', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'clamp(32px,5vw,64px)' }}>
          <div style={{ flex: '1 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <span style={{ alignSelf: 'flex-start', height: 30, padding: '0 13px', borderRadius: 99, background: 'rgba(255,255,255,.08)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.14)', fontSize: 13.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{t('yc.pr.a.chip', { p: n(cfg.price_year) })}</span>
            <h2 style={{ ...h2, color: '#fff' }}><Accent a={t('yc.pr.a.h.a', { m: freeMonths })} b={t('yc.pr.a.h.b')} c={t('yc.pr.a.h.c')} /></h2>
            <p style={{ ...lead, color: 'var(--text-on-night-2)' }}>{t('yc.pr.a.sub', { n: n(cfg.annual_bonus_yunits) })}</p>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '14px 0', borderTop: '1px solid rgba(255,255,255,.1)', fontSize: 15.5 }}>
                <span style={{ color: 'var(--text-on-night-2)' }}>{t('yc.pr.a.m', { n: n(cfg.monthly_yunits) })}</span>
                <b style={{ flex: 'none', fontWeight: 600, whiteSpace: 'nowrap' }}>{t('yc.pr.s.yunits', { n: n(12 * cfg.monthly_yunits) })}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '14px 0', borderTop: '1px solid rgba(255,255,255,.1)', borderBottom: '1px solid rgba(255,255,255,.1)', fontSize: 15.5 }}>
                <span>{t('yc.pr.a.y', { b: n(cfg.annual_bonus_yunits), n: n(cfg.monthly_yunits) })}</span>
                <b style={{ flex: 'none', fontWeight: 600, color: 'var(--tangerine-400)', whiteSpace: 'nowrap' }}>{t('yc.pr.s.yunits', { n: n(cfg.annual_bonus_yunits + 12 * cfg.monthly_yunits) })}</b>
              </div>
            </div>
            {signedIn
              ? <Hv as={Link} to={CRM_ROUTES.accountSection('billing')} style={btn} hover={{ color: 'var(--ink)', textDecoration: 'none', transform: 'translateY(-2px)' }}>{t('yc.pr.mySubscription')}</Hv>
              : <Hv as="button" type="button" onClick={onChoose} style={btn} hover={{ transform: 'translateY(-2px)' }}>{t('yc.pr.a.choose')}</Hv>}
          </div>
          <div ref={ref} style={{ flex: '1 1 380px', minWidth: 0 }}>
            <div style={{ height: 220, display: 'flex', alignItems: 'flex-end', gap: 'clamp(4px,.8vw,9px)' }}>
              {bars.map((v, i) => (
                <div key={i} style={{ flex: i === 0 ? 2.4 : 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  {i === 0 && <span style={{ fontSize: 13, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', opacity: seen ? 1 : 0, transition: 'opacity 400ms 700ms' }}>{n(v)}</span>}
                  <div style={{ width: '100%', height: seen ? Math.min(180, unit * (v / Math.max(1, cfg.monthly_yunits))) : 0, borderRadius: 10, background: i === 0 ? 'var(--gradient-brand)' : 'rgba(255,255,255,.22)', transition: `height 800ms ${EASE} ${i * 70}ms` }} />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-on-night-2)' }}>
              <span>{t('yc.pr.a.day1')}</span><span>{t('yc.pr.a.m12')}</span>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

// ── Essai ──────────────────────────────────────────────────────────────────
function Trial({ cfg }: { cfg: CrmPricingConfig }) {
  const { t, n } = usePrT();
  const [ref, seen] = useSeen<HTMLDivElement>();
  const steps = [
    { day: t('yc.pr.t.s1.day'), t: t('yc.pr.t.s1.t'), d: t('yc.pr.t.s1.d', { n: n(cfg.trial_yunits) }) },
    { day: t('yc.pr.t.s2.day', { d: cfg.trial_days }), t: t('yc.pr.t.s2.t'), d: t('yc.pr.t.s2.d') },
    { day: t('yc.pr.t.s3.day', { d: cfg.trial_days + 1 }), t: t('yc.pr.t.s3.t'), d: t('yc.pr.t.s3.d', { p: n(cfg.price_month) }) },
  ];
  const pause: [string, boolean][] = [[t('yc.pr.t.p1'), true], [t('yc.pr.t.p2'), false], [t('yc.pr.t.p3'), false]];
  return (
    <section style={{ ...wrap, padding: 'clamp(72px,10vw,130px) clamp(16px,4vw,40px)' }}>
      <Reveal><span style={kick}>{t('yc.pr.t.k')}</span></Reveal>
      <Reveal i={1} style={{ marginTop: 14 }}><h2 style={h2}><Accent a={t('yc.pr.t.h.a')} b={t('yc.pr.t.h.b')} c={t('yc.pr.t.h.c')} /></h2></Reveal>
      <Reveal i={2} style={{ marginTop: 18 }}><p style={lead}>{t('yc.pr.t.sub', { d: cfg.trial_days, n: n(cfg.trial_yunits) })}</p></Reveal>
      <div ref={ref} style={{ marginTop: 52 }}>
        <div style={{ position: 'relative', height: 22, margin: '0 11px' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 9, height: 4, borderRadius: 99, background: 'var(--sand-100)' }} />
          <div style={{ position: 'absolute', left: 0, top: 9, height: 4, borderRadius: 99, width: seen ? '100%' : '0%', background: 'linear-gradient(90deg,var(--red-500),var(--tangerine-500) 60%,var(--ink))', transition: `width 2600ms ${EASE}` }} />
          {[0, 50, 100].map((l, i) => {
            const on = seen;
            const c = i === 2 ? 'var(--ink)' : 'var(--red-500)';
            return <span key={l} style={{ position: 'absolute', left: `${l}%`, top: 0, width: 22, height: 22, marginLeft: -11, borderRadius: 99, boxSizing: 'border-box', background: on ? c : '#fff', border: `3px solid ${on ? c : 'var(--sand-300)'}`, boxShadow: on ? '0 0 0 4px #fff' : 'none', transition: `background 300ms ${i * 1200}ms,border-color 300ms ${i * 1200}ms` }} />;
          })}
        </div>
        <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))', gap: 28 }}>
          {steps.map((s, i) => (
            <Reveal key={i} i={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={kick}>{s.day}</span>
              <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 23, letterSpacing: '-.03em' }}>{s.t}</b>
              <span style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{s.d}</span>
            </Reveal>
          ))}
        </div>
      </div>
      <Reveal style={{ marginTop: 44, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px 32px', padding: '26px 32px', borderRadius: 26, background: 'var(--sand-50)' }}>
        <b style={{ flex: '1 1 240px', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, lineHeight: 1.2, letterSpacing: '-.025em' }}>{t('yc.pr.t.pause')}</b>
        {pause.map(([l, ok]) => (
          <span key={l} style={{ flex: '1 1 200px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 500 }}>
            <span style={{ flex: 'none', width: 24, height: 24, borderRadius: 99, background: ok ? 'var(--green-500)' : 'var(--sand-200)', color: ok ? '#fff' : 'var(--sand-600)', display: 'grid', placeItems: 'center' }}><Icon name={ok ? 'check' : 'x'} size={13} stroke={3} /></span>
            {l}
          </span>
        ))}
      </Reveal>
    </section>
  );
}

// ── FAQ ────────────────────────────────────────────────────────────────────
function Faq({ cfg }: { cfg: CrmPricingConfig }) {
  const { t, n } = usePrT();
  const [open, setOpen] = useState(0);
  const vars: Record<number, Record<string, string | number>> = {
    3: { m: cfg.purchase_validity_months },
    4: { p: n(cfg.price_month), next: n(cfg.price_month_next) },
    6: { v: cfg.vat_rate },
  };
  return (
    <section id="faq" style={{ scrollMarginTop: 90, padding: 'clamp(72px,10vw,120px) 0', background: 'var(--sand-50)' }}>
      <div style={{ ...wrap, maxWidth: 1080, display: 'flex', flexWrap: 'wrap', gap: 'clamp(32px,6vw,90px)', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Reveal><span style={kick}>{t('yc.pr.q.k')}</span></Reveal>
          <Reveal i={1}><h2 style={{ ...h2, fontSize: 'clamp(34px,4.4vw,48px)' }}><Accent a={t('yc.pr.q.h.a')} b={t('yc.pr.q.h.b')} c={t('yc.pr.q.h.c')} /></h2></Reveal>
          <Reveal i={2}>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.55, color: 'var(--sand-600)' }}>
              {t('yc.pr.q.sub')}<a href="mailto:contact@yunoapp.eu" style={{ color: 'var(--red-600)', textDecoration: 'none', fontWeight: 500 }}>contact@yunoapp.eu</a>
            </p>
          </Reveal>
        </div>
        <Reveal i={2} style={{ flex: '1.3 1 440px', minWidth: 0, borderTop: '1px solid var(--sand-200)' }}>
          {[1, 2, 3, 4, 5, 6, 7].filter((k) => k !== 4 || cfg.tier !== 'public').map((k, i) => {
            const on = open === i;
            const v = vars[k] ?? {};
            return (
              <div key={k} style={{ borderBottom: '1px solid var(--sand-200)' }}>
                <button type="button" aria-expanded={on} onClick={() => setOpen(on ? -1 : i)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '20px 0', border: 0, background: 'none', textAlign: 'left', fontSize: 16.5, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }}>
                  {t(`yc.pr.q${k}.q`, v)}
                  <span style={{ flex: 'none', width: 30, height: 30, borderRadius: 99, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', display: 'grid', placeItems: 'center', transform: on ? 'rotate(45deg)' : 'none', transition: `transform 300ms ${SPRING}` }}><Icon name="plus" size={14} stroke={2.4} /></span>
                </button>
                <div style={{ display: 'grid', gridTemplateRows: on ? '1fr' : '0fr', transition: `grid-template-rows 360ms ${EASE}` }}>
                  <div style={{ overflow: 'hidden', minHeight: 0 }}>
                    <p style={{ margin: 0, padding: '0 46px 22px 0', fontSize: 15.5, lineHeight: 1.6, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t(`yc.pr.q${k}.a`, v)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </Reveal>
      </div>
    </section>
  );
}
