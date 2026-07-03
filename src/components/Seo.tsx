import { Helmet } from 'react-helmet-async';

/**
 * Per-route SEO head tags for client-rendered pages.
 *
 * Detail pages under /event, /club, /dj, /o are enriched server-side for crawlers by
 * the Cloudflare Worker (worker/index.ts). This component covers the pages the Worker
 * does NOT touch — the public browse pages (/events, /clubs, /djs) and the pillar
 * landing pages — by declaring title / description / canonical / OG / JSON-LD that
 * Googlebot picks up when it renders the SPA.
 *
 * Meta is authored in English: yunoapp.eu indexes a single canonical language (EN)
 * for now (localStorage language switching keeps every language on one URL). See
 * CLAUDE.md — multilingual URL routing is a deferred, separate change.
 */

const SITE = 'https://yunoapp.eu';

function absolute(pathOrUrl?: string, fallback?: string): string | undefined {
  const v = pathOrUrl ?? fallback;
  if (!v) return undefined;
  return v.startsWith('http') ? v : `${SITE}${v.startsWith('/') ? '' : '/'}${v}`;
}

export interface SeoProps {
  title: string;
  description?: string;
  /** Path ("/events") or absolute URL. Sets <link rel=canonical> + og:url. */
  canonical?: string;
  /** Path or absolute URL. Defaults to the shared social card. */
  image?: string;
  /** og:type — "website" (default), "article", "profile"... */
  type?: string;
  noindex?: boolean;
  /** One or more schema.org objects rendered as <script type="application/ld+json">. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jsonLd?: Record<string, any> | Record<string, any>[];
}

export function Seo({ title, description, canonical, image, type = 'website', noindex, jsonLd }: SeoProps) {
  const url = absolute(canonical);
  const img = absolute(image, '/social-card.webp')!;
  const graphs = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];

  return (
    <Helmet>
      <html lang="en" />
      <title>{title}</title>
      {description && <meta name="description" content={description} />}
      <meta name="robots" content={noindex ? 'noindex, nofollow' : 'index, follow'} />
      {url && <link rel="canonical" href={url} />}

      <meta property="og:site_name" content="Yuno" />
      <meta property="og:type" content={type} />
      <meta property="og:title" content={title} />
      {description && <meta property="og:description" content={description} />}
      {url && <meta property="og:url" content={url} />}
      <meta property="og:image" content={img} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      {description && <meta name="twitter:description" content={description} />}
      <meta name="twitter:image" content={img} />

      {graphs.map((g, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(g)}
        </script>
      ))}
    </Helmet>
  );
}

export default Seo;
