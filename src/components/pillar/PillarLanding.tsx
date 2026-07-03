import { Link } from 'react-router-dom';
import { Seo } from '@/components/Seo';
import { BottomNav } from '@/components/BottomNav';

/**
 * Shared layout for the SEO pillar pages (/tickets, /vip-tables, /order-drinks).
 *
 * These are the public marketing landing pages that target Yuno's three core value
 * props. They exist to rank on Google for high-intent nightlife queries, so they carry
 * real, crawlable editorial content: a single H1, keyword-rich H2s, a step list, a
 * feature grid, a native <details> FAQ (crawlable without JS) emitting FAQPage schema,
 * and internal links to the other pillars + the browse pages.
 *
 * Copy is authored in English — yunoapp.eu indexes one canonical language for now.
 * Visual language mirrors the public browse pages (dark editorial, red accent).
 */

const ACCENT = '#E8192C';
const BG = '#0A0A0A';

export interface PillarStep {
  title: string;
  body: string;
}

export interface PillarFeature {
  title: string;
  body: string;
}

export interface PillarFaq {
  q: string;
  a: string;
}

export interface PillarCta {
  label: string;
  to: string;
}

export interface PillarConfig {
  path: string; // canonical path, e.g. "/tickets"
  kicker: string; // small uppercase eyebrow
  h1: string;
  lead: string; // hero sub-paragraph
  primaryCta: PillarCta;
  secondaryCta?: PillarCta;
  /** Editorial prose sections (each an H2 + paragraph). */
  sections: { h2: string; body: string }[];
  stepsTitle: string;
  steps: PillarStep[];
  featuresTitle: string;
  features: PillarFeature[];
  faqTitle: string;
  faqs: PillarFaq[];
  metaTitle: string;
  metaDescription: string;
}

const OTHER_PILLARS: { path: string; label: string }[] = [
  { path: '/tickets', label: 'Event tickets' },
  { path: '/vip-tables', label: 'VIP tables' },
  { path: '/order-drinks', label: 'Order drinks' },
];

export function PillarLanding({ config }: { config: PillarConfig }) {
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: config.metaTitle,
      description: config.metaDescription,
      url: `https://yunoapp.eu${config.path}`,
      isPartOf: { '@id': 'https://yunoapp.eu/#website' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Yuno', item: 'https://yunoapp.eu/' },
        { '@type': 'ListItem', position: 2, name: config.h1, item: `https://yunoapp.eu${config.path}` },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: config.faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ];

  return (
    <div style={{ minHeight: '100dvh', background: BG, color: '#fff', display: 'flex', flexDirection: 'column' }}>
      <Seo
        title={config.metaTitle}
        description={config.metaDescription}
        canonical={config.path}
        jsonLd={jsonLd}
      />

      <main style={{ flex: 1, width: '100%', maxWidth: 780, margin: '0 auto', padding: '56px 22px 120px' }}>
        {/* ── Hero ── */}
        <p style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: ACCENT, margin: 0 }}>
          {config.kicker}
        </p>
        <h1
          style={{
            fontFamily: '"Space Grotesk", system-ui, sans-serif',
            fontSize: 'clamp(34px, 8vw, 56px)',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            lineHeight: 1.02,
            margin: '14px 0 18px',
          }}
        >
          {config.h1}
        </h1>
        <p style={{ fontSize: 18, lineHeight: 1.55, color: 'rgba(255,255,255,0.72)', maxWidth: 620, margin: 0 }}>
          {config.lead}
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 28 }}>
          <Link
            to={config.primaryCta.to}
            style={{
              background: ACCENT,
              color: '#fff',
              fontWeight: 700,
              fontSize: 15,
              padding: '14px 26px',
              borderRadius: 999,
              textDecoration: 'none',
            }}
          >
            {config.primaryCta.label}
          </Link>
          {config.secondaryCta && (
            <Link
              to={config.secondaryCta.to}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.14)',
                color: '#fff',
                fontWeight: 600,
                fontSize: 15,
                padding: '14px 26px',
                borderRadius: 999,
                textDecoration: 'none',
              }}
            >
              {config.secondaryCta.label}
            </Link>
          )}
        </div>

        {/* ── Editorial sections ── */}
        {config.sections.map((s) => (
          <section key={s.h2} style={{ marginTop: 48 }}>
            <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em', margin: '0 0 12px' }}>{s.h2}</h2>
            <p style={{ fontSize: 16, lineHeight: 1.65, color: 'rgba(255,255,255,0.70)', margin: 0 }}>{s.body}</p>
          </section>
        ))}

        {/* ── How it works ── */}
        <section style={{ marginTop: 56 }}>
          <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em', margin: '0 0 20px' }}>{config.stepsTitle}</h2>
          <ol style={{ listStyle: 'none', counterReset: 'step', padding: 0, margin: 0, display: 'grid', gap: 14 }}>
            {config.steps.map((step, i) => (
              <li
                key={step.title}
                style={{
                  display: 'flex',
                  gap: 16,
                  padding: '16px 18px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 14,
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    background: ACCENT,
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 14,
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  {i + 1}
                </span>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: '4px 0 4px' }}>{step.title}</h3>
                  <p style={{ fontSize: 15, lineHeight: 1.5, color: 'rgba(255,255,255,0.62)', margin: 0 }}>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Features ── */}
        <section style={{ marginTop: 56 }}>
          <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em', margin: '0 0 20px' }}>{config.featuresTitle}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            {config.features.map((f) => (
              <div
                key={f.title}
                style={{
                  padding: '18px 18px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 14,
                }}
              >
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px' }}>{f.title}</h3>
                <p style={{ fontSize: 14.5, lineHeight: 1.5, color: 'rgba(255,255,255,0.62)', margin: 0 }}>{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── FAQ (native <details> = crawlable, no JS) ── */}
        <section style={{ marginTop: 56 }}>
          <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em', margin: '0 0 16px' }}>{config.faqTitle}</h2>
          <div style={{ display: 'grid', gap: 10 }}>
            {config.faqs.map((f) => (
              <details
                key={f.q}
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 12,
                  padding: '14px 16px',
                }}
              >
                <summary style={{ fontSize: 16, fontWeight: 600, cursor: 'pointer', listStyle: 'none' }}>{f.q}</summary>
                <p style={{ fontSize: 15, lineHeight: 1.6, color: 'rgba(255,255,255,0.66)', margin: '10px 0 0' }}>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ── Cross-links to the other pillars + browse ── */}
        <section style={{ marginTop: 56 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em', margin: '0 0 14px' }}>Everything in one app</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {OTHER_PILLARS.filter((p) => p.path !== config.path).map((p) => (
              <Link
                key={p.path}
                to={p.path}
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  padding: '10px 18px',
                  borderRadius: 999,
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: '#fff',
                  textDecoration: 'none',
                }}
              >
                {p.label}
              </Link>
            ))}
            <Link to="/events" style={{ fontSize: 14, fontWeight: 600, padding: '10px 18px', borderRadius: 999, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', textDecoration: 'none' }}>
              Browse events
            </Link>
            <Link to="/clubs" style={{ fontSize: 14, fontWeight: 600, padding: '10px 18px', borderRadius: 999, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', textDecoration: 'none' }}>
              Find clubs
            </Link>
          </div>
        </section>
      </main>

      <BottomNav />
    </div>
  );
}

export default PillarLanding;
