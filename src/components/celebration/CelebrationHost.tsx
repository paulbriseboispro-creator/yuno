// Hôte global des célébrations — monté UNE fois dans App (à côté de
// NativeBridge). Écoute CELEBRATE_EVENT (src/lib/celebrate.ts) et rend le
// bon visuel :
//   purchase → confettis seuls (la page de confirmation porte déjà son badge)
//   entry    → overlay takeover « Entrée validée » + confettis
//   tierUp   → overlay takeover avec le TierBadge existant + confettis
// Le haptic est déjà parti dans celebrate() — ici, uniquement le visuel.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { PartyPopper } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { CELEBRATE_EVENT, type CelebrationDetail } from '@/lib/celebrate';
import { ConfettiBurst } from './ConfettiBurst';
import { CelebrationOverlay } from './CelebrationOverlay';
import { TierBadge } from '@/components/loyalty/TierBadge';

/** Durée de vie du burst « achat » (sans overlay). */
const PURCHASE_BURST_MS = 1800;

export function CelebrationHost() {
  const { t } = useLanguage();
  const [active, setActive] = useState<CelebrationDetail | null>(null);
  // Clé remontée à chaque événement : re-déclenche le burst même si deux
  // célébrations identiques s'enchaînent.
  const [playId, setPlayId] = useState(0);
  const purchaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onCelebrate = (e: Event) => {
      const detail = (e as CustomEvent<CelebrationDetail>).detail;
      if (!detail) return;
      setActive(detail);
      setPlayId((n) => n + 1);
      if (purchaseTimer.current) clearTimeout(purchaseTimer.current);
      if (detail.kind === 'purchase') {
        purchaseTimer.current = setTimeout(() => setActive(null), PURCHASE_BURST_MS);
      }
    };
    window.addEventListener(CELEBRATE_EVENT, onCelebrate);
    return () => {
      window.removeEventListener(CELEBRATE_EVENT, onCelebrate);
      if (purchaseTimer.current) clearTimeout(purchaseTimer.current);
    };
  }, []);

  const dismiss = () => setActive(null);

  return (
    <AnimatePresence>
      {active?.kind === 'purchase' && <ConfettiBurst key={`p-${playId}`} />}

      {active?.kind === 'entry' && (
        <CelebrationOverlay
          key={`e-${playId}`}
          kicker={t('celebrate.entry.kicker')}
          title={t('celebrate.entry.title')}
          subtitle={active.subtitle}
          icon={<PartyPopper className="h-10 w-10" style={{ color: '#E8192C' }} />}
          onDone={dismiss}
        />
      )}

      {active?.kind === 'tierUp' && active.tier && (
        <CelebrationOverlay
          key={`t-${playId}`}
          kicker={t('celebrate.tier.kicker')}
          title={t('celebrate.tier.title').replace(
            '{tier}',
            active.tier.charAt(0).toUpperCase() + active.tier.slice(1)
          )}
          icon={<TierBadge tier={active.tier} size="lg" />}
          onDone={dismiss}
        />
      )}
    </AnimatePresence>
  );
}
