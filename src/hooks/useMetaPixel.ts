import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useConsent } from '@/lib/consent';
import {
  ensureMetaPixels,
  metaPixelAllowedHere,
  trackMetaEvent,
  type MetaStandardEvent,
} from '@/lib/metaPixel';

/**
 * Pixels Meta d'une surface publique : ceux du club et de l'organisateur de la
 * soirée (RPC `get_public_meta_pixels`, identifiants seulement) + celui de
 * Yuno. Charge le script après consentement « publicité », se relance quand
 * le consentement bascule, et rend un `track` qui cible ces pixels-là.
 *
 * Portée = une soirée (eventId) OU un club (venueId) OU un organisateur.
 * Sans portée, seul le pixel plateforme est chargé.
 */
const cache = new Map<string, string[]>();

export interface UseMetaPixelScope {
  eventId?: string | null;
  venueId?: string | null;
  organizerUserId?: string | null;
  /** Ne rien charger tant que la donnée de page n'est pas prête. */
  enabled?: boolean;
}

export function useMetaPixel(scope: UseMetaPixelScope = {}) {
  const { marketing } = useConsent();
  const [pixelIds, setPixelIds] = useState<string[]>([]);
  const key = `${scope.eventId ?? ''}|${scope.venueId ?? ''}|${scope.organizerUserId ?? ''}`;
  const enabled = scope.enabled !== false;
  const latest = useRef<string[]>([]);

  useEffect(() => {
    if (!enabled || !metaPixelAllowedHere()) return;
    let cancelled = false;
    const cached = cache.get(key);
    const apply = (ids: string[]) => {
      if (cancelled) return;
      latest.current = ids;
      setPixelIds(ids);
      if (marketing) ensureMetaPixels(ids);
    };
    if (cached) {
      apply(cached);
      return () => { cancelled = true; };
    }
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await supabase.rpc('get_public_meta_pixels' as any, {
          p_event_id: scope.eventId ?? null,
          p_venue_id: scope.venueId ?? null,
          p_organizer_user_id: scope.organizerUserId ?? null,
        });
        const ids = [...new Set(((data as { pixel_id: string }[] | null) ?? []).map((r) => r.pixel_id))];
        cache.set(key, ids);
        apply(ids);
      } catch {
        apply([]);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, marketing]);

  const track = useCallback(
    (event: MetaStandardEvent, params: Record<string, unknown> = {}, eventID?: string) => {
      trackMetaEvent(latest.current, event, params, eventID);
    },
    [],
  );

  return { pixelIds, track, active: marketing && pixelIds.length > 0 };
}

export interface MetaPurchaseSummary {
  /** `ticket:<id>` | `table:<id>` | `order:<id>` — identique au serveur. */
  eventID: string;
  eventId: string | null;
  venueId?: string | null;
  valueCents: number | null;
  currency: string | null;
  contentIds?: string[] | null;
}

/**
 * Page de succès : `Purchase` navigateur, en doublon volontaire du `Purchase`
 * serveur (même eventID → Meta dédoublonne). Tiré une seule fois par commande,
 * et seulement si le serveur confirme que CET appel a validé le paiement
 * (jamais sur un rechargement de page).
 */
export function useMetaPurchasePixel() {
  const [pending, setPending] = useState<MetaPurchaseSummary | null>(null);
  const { track, active } = useMetaPixel({
    eventId: pending?.eventId ?? null,
    venueId: pending?.venueId ?? null,
    enabled: !!pending,
  });
  const fired = useRef<string | null>(null);
  useEffect(() => {
    if (!pending || !active || fired.current === pending.eventID) return;
    fired.current = pending.eventID;
    track('Purchase', {
      value: Math.round(pending.valueCents ?? 0) / 100,
      currency: (pending.currency ?? 'eur').toUpperCase(),
      content_ids: pending.contentIds ?? (pending.eventId ? [pending.eventId] : []),
      content_type: 'product',
    }, pending.eventID);
  }, [pending, active, track]);
  return { firePurchase: setPending };
}

/** Tunnel d'achat : `InitiateCheckout` une fois par montage, dès que les pixels sont prêts. */
export function useMetaCheckoutPixel(scope: UseMetaPixelScope) {
  const m = useMetaPixel(scope);
  const fired = useRef(false);
  useEffect(() => {
    if (!m.active || fired.current) return;
    fired.current = true;
    m.track('InitiateCheckout', {
      content_ids: scope.eventId ? [scope.eventId] : [],
      content_type: 'product',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.active]);
  return m;
}
