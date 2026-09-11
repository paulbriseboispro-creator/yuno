// Pré-chargement de la liste de porte, dès l'ouverture de Yuno Pro.
//
// Pourquoi ici et pas seulement dans l'écran du videur : à 1 h du matin, dans
// un sous-sol sans réseau, il est trop tard pour télécharger quoi que ce soit.
// La liste doit être DÉJÀ dans le téléphone quand on arrive. Elle ne l'était
// que si quelqu'un avait ouvert l'écran de scan avant de perdre le réseau —
// c'est-à-dire au pire moment.
//
// Aucun serveur ne peut remplir le cache d'un téléphone : seule l'app peut
// aller chercher. Alors on va chercher au premier écran de l'app, à chaque
// retour au premier plan, et à chaque heure passée en veille — n'importe
// quelle ouverture de la journée suffit à armer la porte.
//
// Silencieux par construction : un échec (pas de réseau, pas encore de soirée)
// ne montre rien. Ce qui compte est visible ailleurs — la bulle « QR chargés »
// de l'écran videur dit la vérité, et son bouton force un rechargement.

import { useCallback, useEffect, useRef } from 'react';
import { fetchManifest, purgeExpiredManifests } from '@/lib/offline/manifest';
import { resolveDoorEventIds } from '@/lib/scan/doorEvents';
import { isProApp } from '@/lib/native';
import type { DoorScope } from '@/lib/scan/types';

/** Fenêtre d'anticipation : la soirée du soir se charge dès le matin. */
const LOOKAHEAD_HOURS = 20;
/** Un pré-chargement au plus par heure — c'est un filet, pas un synchroniseur. */
const MIN_INTERVAL_MS = 60 * 60 * 1000;

export function useDoorManifestPreload(scope: DoorScope, isDoorStaff: boolean) {
  const lastRunRef = useRef(0);
  const enabled = isProApp() && isDoorStaff && (!!scope.venueId || !!scope.organizerUserId);

  const preload = useCallback(async (force = false) => {
    if (!enabled || !navigator.onLine) return;
    const now = Date.now();
    if (!force && now - lastRunRef.current < MIN_INTERVAL_MS) return;
    lastRunRef.current = now;
    try {
      purgeExpiredManifests();
      const eventIds = await resolveDoorEventIds(scope, { lookaheadHours: LOOKAHEAD_HOURS });
      // La soirée d'ancrage, la même que celle de l'écran videur.
      if (eventIds[0]) await fetchManifest(eventIds[0]);
    } catch {
      // Hors ligne, RPC refusée, aucune soirée : on retentera à la prochaine
      // ouverture. Rien à dire à qui que ce soit.
    }
  }, [enabled, scope]);

  useEffect(() => {
    if (!enabled) return;
    void preload(true);

    let resumeCleanup: (() => void) | undefined;
    import('@capacitor/app').then(({ App: CapApp }) => {
      const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) void preload();
      });
      resumeCleanup = () => { sub.then((s) => s.remove()); };
    }).catch(() => {});

    return () => { resumeCleanup?.(); };
  }, [enabled, preload]);
}
