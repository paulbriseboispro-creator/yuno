/** Les quatre règles « Zéro doublon » et le fond nuit de leurs panneaux. */
import { useTixT } from '@/tickets/analytics/i18n';

export function useZeroRules() {
  const { t } = useTixT();
  return [1, 2, 3, 4].map((i) => ({ b: t(`ya.imp.r${i}b`), t: t(`ya.imp.r${i}t`) }));
}

export const NIGHT_BG = 'radial-gradient(90% 70% at 100% 110%,rgba(227,20,27,.38),transparent 65%),radial-gradient(60% 45% at 0% 0%,rgba(255,107,53,.14),transparent 70%),var(--ya-noise-night),var(--ya-night)';
