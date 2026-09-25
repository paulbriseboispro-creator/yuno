import { useEffect, useRef } from 'react';
import { capturePosthog, type YunoEvent } from '@/lib/posthog';

/**
 * Tire un événement du plan de marquage UNE fois par valeur de `key` (ex. une
 * fois par soirée affichée), dès que la donnée de page est prête (`key` non
 * nul). Les propriétés sont lues au moment du tir.
 */
export function usePosthogEvent(
  event: YunoEvent,
  key: string | null | undefined,
  properties?: Record<string, unknown>,
) {
  const fired = useRef<string | null>(null);
  useEffect(() => {
    if (!key || fired.current === key) return;
    fired.current = key;
    capturePosthog(event, properties);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, key]);
}
