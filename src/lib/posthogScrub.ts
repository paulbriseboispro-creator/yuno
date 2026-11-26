/**
 * La page publique `/t/<qr>` (laissez-passer d'un invité de table) porte un QR d'entrée dans son adresse :
 * il ne part jamais chez PostHog. On remplace le segment par `:qr` dans toute propriété d'URL, et aucun replay
 * n'est enregistré sur cette page. PUR, testé dans src/lib/__tests__/posthogScrub.test.ts.
 */
const GUEST_PASS_PATH = /^(https?:\/\/[^/?#]+)?\/t\/.*$/i;

export function isGuestPassPath(pathname: string | null | undefined): boolean {
  return !!pathname && /^\/t\/[^/?#]+/i.test(pathname);
}

export function scrubGuestPassUrl(value: string): string {
  return value.replace(GUEST_PASS_PATH, '$1/t/:qr');
}

const URL_KEY = /^\$(.*(url|pathname|referrer).*)$/i;

/** Copie des propriétés où toute URL `/t/<qr>` est devenue `/t/:qr`. */
export function scrubGuestPassProps<T extends Record<string, unknown>>(props: T | undefined): T | undefined {
  if (!props) return props;
  const out: Record<string, unknown> = { ...props };
  for (const key of Object.keys(out)) {
    const v = out[key];
    if (typeof v === 'string' && URL_KEY.test(key)) out[key] = scrubGuestPassUrl(v);
  }
  return out as T;
}
