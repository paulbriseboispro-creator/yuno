/** Les cinq tons du kit : le sens d'une couleur, jamais une couleur choisie à la main. */
export type Tone = 'neutral' | 'accent' | 'positive' | 'negative' | 'warning';

export const TONE: Record<Tone, { bg: string; fg: string; dot: string }> = {
  neutral: { bg: 'var(--a-subtle)', fg: 'var(--a-text-2)', dot: 'var(--a-text-3)' },
  accent: { bg: 'var(--a-accent-soft)', fg: 'var(--a-accent-text)', dot: 'var(--a-accent)' },
  positive: { bg: 'var(--a-pos-soft)', fg: 'var(--a-pos)', dot: 'var(--a-pos)' },
  negative: { bg: 'var(--a-neg-soft)', fg: 'var(--a-neg)', dot: 'var(--a-neg)' },
  warning: { bg: 'var(--a-warn-soft)', fg: 'var(--a-warn)', dot: 'var(--a-warn)' },
};

export function toneColor(tone: Tone): string {
  return TONE[tone].dot;
}
