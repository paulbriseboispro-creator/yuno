import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Copy, Lock, ShieldCheck, SlidersHorizontal, History, Eye } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { Seo } from '@/components/Seo';
import { Wordmark } from '@/components/brand/Wordmark';
import { LanguageSelector } from '@/components/LanguageSelector';
import { proSignupUrl } from '@/lib/proSignup';
import { MCP_CLIENT_GUIDES, MCP_EXAMPLE_QUESTIONS, MCP_SERVER_URL, type McpClientId } from '@/lib/mcp';

/**
 * /ai — la page publique du connecteur Yuno pour les assistants IA (serveur
 * MCP). Trois publics : le pro qui veut brancher son IA (pas à pas), celui qui
 * hésite (ce qu'il peut demander, ce qui protège ses données), et les annuaires
 * de Claude et ChatGPT, qui exigent une page de documentation publique.
 *
 * DA publique (docs/DESIGN_SYSTEM_PUBLIC.md) : affiche, pas tableau de bord.
 * Noir, Space Grotesk capitales, mono tracké, rouge comme seul accent.
 */

const BLACK = '#0A0A0A';
const CARD = '#141414';
const RED = '#E8192C';
const WHITE = '#FFFFFF';
const GRAY_1 = '#E5E5E5';
const GRAY_2 = '#9A9A9A';
const BORDER = 'rgba(255,255,255,0.08)';
// Même adresse que le centre d'aide (HelpSupportCards) ; recopiée pour ne pas
// tirer un composant de la Console dans le chunk d'une page publique.
const SUPPORT_EMAIL = 'contact@yunoapp.eu';

function SectionTitle({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="mb-6">
      <p className="section-label-ruled mb-3">{kicker}</p>
      <h2 className="font-display uppercase" style={{ color: WHITE, fontSize: 'clamp(26px, 5vw, 40px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1 }}>
        {title}
      </h2>
    </div>
  );
}

export default function AiConnectorPage() {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const [client, setClient] = useState<McpClientId>('claude');
  const [copied, setCopied] = useState(false);
  const guide = MCP_CLIENT_GUIDES.find((g) => g.id === client) ?? MCP_CLIENT_GUIDES[0];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(MCP_SERVER_URL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // presse-papiers refusé : l'adresse reste lisible et sélectionnable
    }
  };

  const security = [
    { icon: Eye, title: 'aiPage.sec1Title', body: 'aiPage.sec1Body' },
    { icon: SlidersHorizontal, title: 'aiPage.sec2Title', body: 'aiPage.sec2Body' },
    { icon: History, title: 'aiPage.sec3Title', body: 'aiPage.sec3Body' },
    { icon: ShieldCheck, title: 'aiPage.sec4Title', body: 'aiPage.sec4Body' },
  ];
  const faq = [1, 2, 3, 4, 5, 6].map((n) => ({ q: `aiPage.faq${n}Q`, a: `aiPage.faq${n}A` }));

  return (
    <div className="min-h-[100dvh]" style={{ background: BLACK, color: WHITE }}>
      <Seo
        title={t('aiPage.seoTitle')}
        description={t('aiPage.seoDesc')}
        canonical="https://yunoapp.eu/ai"
      />

      <header className="max-w-5xl mx-auto px-5 flex items-center justify-between" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 20px)' }}>
        <Link to="/" aria-label="Yuno"><Wordmark height={22} /></Link>
        <LanguageSelector />
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-5 pt-16 pb-14 sm:pt-24">
        <p className="section-label-ruled mb-5 animate-hero-label">{t('aiPage.kicker')}</p>
        <h1 className="font-display uppercase" style={{ fontSize: 'clamp(40px, 9vw, 88px)', fontWeight: 700, letterSpacing: '-0.035em', lineHeight: 0.92, maxWidth: 900 }}>
          {t('aiPage.h1')}
        </h1>
        <p style={{ color: GRAY_1, fontSize: 'clamp(16px, 2.2vw, 19px)', lineHeight: 1.6, marginTop: 24, maxWidth: 640 }}>{t('aiPage.lead')}</p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3">
          {user ? (
            <Link to="/ai-assistants" className="btn btn--primary">{t('aiPage.ctaConsole')}<ArrowRight className="w-4 h-4" /></Link>
          ) : (
            <a href={proSignupUrl(language, { source: 'ai_page' })} className="btn btn--primary">{t('aiPage.ctaPro')}<ArrowRight className="w-4 h-4" /></a>
          )}
          <a href="#connect" className="btn btn--ghost">{t('aiPage.ctaHow')}</a>
        </div>
        <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2 font-mono uppercase" style={{ fontSize: 11, color: GRAY_2, letterSpacing: '0.14em' }}>
          {['Claude', 'ChatGPT', 'Gemini', 'Le Chat'].map((n) => <span key={n}>{n}</span>)}
        </div>
      </section>

      {/* Ce qu'on peut demander */}
      <section className="max-w-5xl mx-auto px-5 py-14" style={{ borderTop: `1px solid ${BORDER}` }}>
        <SectionTitle kicker={t('aiPage.askKicker')} title={t('aiPage.askTitle')} />
        <div className="grid sm:grid-cols-2 gap-3">
          {MCP_EXAMPLE_QUESTIONS.map((k) => (
            <div key={k} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 4, padding: '18px 18px' }}>
              <p style={{ color: WHITE, fontSize: 16, lineHeight: 1.45 }}>« {t(k)} »</p>
            </div>
          ))}
        </div>
        <p style={{ color: GRAY_2, fontSize: 14, lineHeight: 1.6, marginTop: 18, maxWidth: 680 }}>{t('aiPage.askBody')}</p>
      </section>

      {/* Brancher */}
      <section id="connect" className="max-w-5xl mx-auto px-5 py-14" style={{ borderTop: `1px solid ${BORDER}` }}>
        <SectionTitle kicker={t('aiPage.howKicker')} title={t('aiPage.howTitle')} />
        <p className="font-mono uppercase mb-2" style={{ fontSize: 10, color: GRAY_2, letterSpacing: '0.14em' }}>{t('aiMcp.serverUrl')}</p>
        <div className="flex items-center gap-2 mb-8" style={{ background: CARD, border: `1px solid rgba(232,25,44,0.35)`, borderRadius: 4, padding: '8px 8px 8px 16px', maxWidth: 560 }}>
          <code className="flex-1 min-w-0 truncate font-mono" style={{ fontSize: 15, color: WHITE }}>{MCP_SERVER_URL}</code>
          <button onClick={copy} className="btn btn--secondary" style={{ padding: '8px 14px' }}>
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied ? t('aiMcp.copied') : t('aiMcp.copy')}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 mb-6" role="tablist">
          {MCP_CLIENT_GUIDES.map((g) => (
            <button
              key={g.id}
              role="tab"
              aria-selected={client === g.id}
              onClick={() => setClient(g.id)}
              className="font-mono uppercase"
              style={{
                fontSize: 11, letterSpacing: '0.12em', padding: '9px 14px', borderRadius: 999,
                border: `1px solid ${client === g.id ? RED : BORDER}`,
                background: client === g.id ? 'rgba(232,25,44,0.12)' : 'transparent',
                color: client === g.id ? WHITE : GRAY_2,
              }}
            >
              {g.name}
            </button>
          ))}
        </div>
        <ol className="space-y-4" role="tabpanel" style={{ maxWidth: 680 }}>
          {guide.steps.map((k, i) => (
            <li key={k} className="flex items-start gap-4">
              <span className="font-display shrink-0" style={{ color: RED, fontSize: 22, fontWeight: 700, lineHeight: 1, width: 24 }}>{i + 1}</span>
              <span style={{ color: GRAY_1, fontSize: 16, lineHeight: 1.55 }}>{t(k)}</span>
            </li>
          ))}
        </ol>
        {guide.command && (
          <code className="block font-mono mt-5" style={{ fontSize: 13, color: GRAY_1, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 4, padding: '12px 14px', overflowX: 'auto', maxWidth: 680 }}>
            {guide.command}
          </code>
        )}
        {guide.note && <p style={{ color: GRAY_2, fontSize: 13, lineHeight: 1.55, marginTop: 16, maxWidth: 680 }}>{t(guide.note)}</p>}
      </section>

      {/* Sécurité */}
      <section className="max-w-5xl mx-auto px-5 py-14" style={{ borderTop: `1px solid ${BORDER}` }}>
        <SectionTitle kicker={t('aiPage.secKicker')} title={t('aiPage.secTitle')} />
        <div className="grid sm:grid-cols-2 gap-3">
          {security.map(({ icon: Icon, title, body }) => (
            <div key={title} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 4, padding: '20px 18px' }}>
              <Icon className="w-5 h-5 mb-4" style={{ color: RED }} aria-hidden="true" />
              <h3 className="font-display uppercase" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>{t(title)}</h3>
              <p style={{ color: GRAY_2, fontSize: 14, lineHeight: 1.6, marginTop: 8 }}>{t(body)}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 space-y-2" style={{ maxWidth: 680 }}>
          {['aiMcp.cant1', 'aiMcp.cant2', 'aiMcp.cant3'].map((k) => (
            <p key={k} className="flex items-start gap-2.5" style={{ fontSize: 14, color: GRAY_1, lineHeight: 1.5 }}>
              <Lock className="w-4 h-4 mt-0.5 shrink-0" style={{ color: RED }} aria-hidden="true" />{t(k)}
            </p>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-5xl mx-auto px-5 py-14" style={{ borderTop: `1px solid ${BORDER}` }}>
        <SectionTitle kicker="FAQ" title={t('aiPage.faqTitle')} />
        <div className="space-y-3" style={{ maxWidth: 760 }}>
          {faq.map(({ q, a }) => (
            <details key={q} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 4, padding: '16px 18px' }}>
              <summary className="cursor-pointer" style={{ color: WHITE, fontSize: 16, fontWeight: 600 }}>{t(q)}</summary>
              <p style={{ color: GRAY_2, fontSize: 14, lineHeight: 1.65, marginTop: 10 }}>{t(a)}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="max-w-5xl mx-auto px-5 py-12 flex flex-wrap gap-x-6 gap-y-2 font-mono uppercase" style={{ borderTop: `1px solid ${BORDER}`, fontSize: 10.5, color: GRAY_2, letterSpacing: '0.12em', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 48px)' }}>
        <Link to="/legal/privacy">{t('aiPage.privacy')}</Link>
        <Link to="/legal/cgu">{t('aiPage.terms')}</Link>
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </footer>
    </div>
  );
}
