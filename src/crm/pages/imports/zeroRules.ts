/** Les quatre règles « Zéro doublon » et le fond nuit de leurs panneaux. */
import { useCrmT } from '@/crm/i18n';

export function useZeroRules() {
  const { t } = useCrmT();
  return [1, 2, 3, 4].map((i) => ({ b: t(`yc.imp.r${i}b`), t: t(`yc.imp.r${i}t`) }));
}

export const NIGHT_BG = 'radial-gradient(90% 70% at 100% 110%,rgba(227,20,27,.38),transparent 65%),radial-gradient(60% 45% at 0% 0%,rgba(255,107,53,.14),transparent 70%),var(--noise-night),var(--night)';
