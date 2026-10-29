/**
 * Les textes légaux à la DA de Yuno CRM : servis sur crm.yunoapp.eu
 * (`/legal/<doc>`, chemin commun aux deux produits) et pour les Conditions Yuno
 * CRM où qu'on les ouvre. Même source que la page de la Billetterie
 * (`legalContent`) : un texte n'existe qu'une fois, seul l'habillage change.
 * Les trois documents qu'un client du CRM accepte sont reliés entre eux.
 */
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import '@/crm/styles/crm.css';
import { useLanguage, useLocaleSection } from '@/contexts/LanguageContext';
import { legalContent, type LegalSection } from '@/data/legalContent';
import { Wordmark } from '@/components/brand/Wordmark';
import { useCrmT } from '@/crm/i18n';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';

const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap';
const PAPER = '#FCFAF9';
const DOCS: { section: LegalSection; key: string }[] = [
  { section: 'cgv-crm', key: 'yc.legal.doc.terms' },
  { section: 'dpa', key: 'yc.legal.doc.dpa' },
  { section: 'privacy', key: 'yc.legal.doc.privacy' },
];

function useLegalDocument(title: string) {
  useEffect(() => {
    if (!document.getElementById('yc-fonts')) {
      const l = document.createElement('link');
      l.id = 'yc-fonts'; l.rel = 'stylesheet'; l.href = FONTS_HREF;
      document.head.appendChild(l);
    }
    const html = document.documentElement;
    const prev = [html.style.background, document.body.style.background, document.title];
    html.style.background = PAPER;
    document.body.style.background = PAPER;
    if (title) document.title = `${title} · Yuno CRM`;
    return () => { html.style.background = prev[0]; document.body.style.background = prev[1]; document.title = prev[2]; };
  }, [title]);
}

export default function CrmLegalPage({ section }: { section: LegalSection }) {
  const { language } = useLanguage();
  const doc = legalContent[section][language];
  useLegalDocument(doc.title);
  const ready = useLocaleSection('crm');
  if (!ready) return <div className="yc" style={{ minHeight: '100vh', background: PAPER }} />;
  return <Inner section={section} title={doc.title} content={doc.content} />;
}

function Inner({ section, title, content }: { section: LegalSection; title: string; content: string }) {
  const { t } = useCrmT();
  const back = () => { if (window.history.length > 1) window.history.back(); else window.location.assign('/crm'); };
  return (
    <div className="yc" style={{ minHeight: '100vh', background: PAPER, color: 'var(--ink)' }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 20, background: 'rgba(252,250,249,.9)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', borderBottom: '1px solid var(--sand-200)' }}>
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '14px clamp(16px,3vw,28px)', display: 'flex', alignItems: 'center', gap: 14 }}>
          <Hv as="button" type="button" onClick={back} aria-label={t('yc.legal.back')}
            style={{ width: 40, height: 40, flex: 'none', borderRadius: 99, border: 0, background: 'var(--sand-100)', color: 'var(--ink)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
            hover={{ background: 'var(--sand-200)' }}>
            <Icon name="arrowLeft" size={16} stroke={2.4} />
          </Hv>
          <Wordmark height={20} tone="dark" alt="Yuno" />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>CRM</span>
        </div>
      </header>

      <main style={{ maxWidth: 880, margin: '0 auto', padding: 'clamp(24px,4vw,48px) clamp(16px,3vw,28px) 72px', boxSizing: 'border-box' }}>
        <nav aria-label={t('yc.legal.docs')} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 22 }}>
          {DOCS.map((d) => {
            const on = d.section === section;
            return (
              <Hv key={d.section} as={Link} to={`/legal/${d.section}`} aria-current={on ? 'page' : undefined}
                style={{ height: 36, padding: '0 14px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', fontSize: 13.5, fontWeight: 600, textDecoration: 'none',
                  background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink)', boxShadow: on ? 'none' : 'inset 0 0 0 1px var(--sand-200)' }}
                hover={on ? { color: '#fff' } : { boxShadow: 'inset 0 0 0 1.5px var(--sand-400)', color: 'var(--ink)' }}>
                {t(d.key)}
              </Hv>
            );
          })}
        </nav>
        <h1 style={{ margin: '0 0 18px', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(30px,4vw,44px)', lineHeight: 1.05, letterSpacing: '-.04em', textWrap: 'balance' }}>{title}</h1>
        <article style={{ padding: 'clamp(20px,3vw,36px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
          {renderLegal(content)}
        </article>
      </main>
    </div>
  );
}

const P: CSSProperties = { margin: '0 0 12px', fontSize: 15, lineHeight: 1.65, color: 'var(--sand-700)', overflowWrap: 'anywhere', textWrap: 'pretty' };

/** `**gras**`, retours à la ligne, puces « • ». Un bloc qui commence par une ligne en gras est un titre. */
function renderLegal(text: string): ReactNode[] {
  return text.split('\n\n').map((block, i) => {
    const lines = block.split('\n');
    const head = /^\*\*(.+)\*\*$/.exec(lines[0].trim());
    const body = head ? lines.slice(1) : lines;
    return (
      <section key={i} style={{ marginTop: head && i > 0 ? 26 : 0 }}>
        {head && <h2 style={{ margin: '0 0 10px', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em', color: 'var(--ink)' }}>{head[1]}</h2>}
        {body.filter((l) => l.trim()).map((l, k) => {
          const bullet = l.trimStart().startsWith('•');
          const txt = bullet ? l.trimStart().slice(1).trim() : l;
          return (
            <p key={k} style={bullet ? { ...P, margin: '0 0 8px', paddingLeft: 20, position: 'relative' } : P}>
              {bullet && <span aria-hidden style={{ position: 'absolute', left: 4, color: 'var(--red-500)' }}>•</span>}
              {inlineBold(txt)}
            </p>
          );
        })}
      </section>
    );
  });
}

function inlineBold(s: string): ReactNode[] {
  return s.split(/\*\*(.*?)\*\*/g).map((part, j) => (j % 2 === 1 ? <strong key={j} style={{ color: 'var(--ink)', fontWeight: 600 }}>{part}</strong> : <span key={j}>{part}</span>));
}
