import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un id de soirée lisible dans l'URL, ou `null` (valeur absente ou mal formée). */
export function pickEventId(raw: string | null): string | null {
  return raw && UUID_RE.test(raw) ? raw.toLowerCase() : null;
}

/**
 * La soirée choisie dans une page d'analyse, adressable par l'URL (`?event=`).
 *
 * C'est la moitié « sélecteur de soirée » de la grammaire Shotgun : le choix
 * vit dans l'adresse, donc un lien depuis la liste des soirées ou le tableau
 * de bord ouvre directement la bonne soirée, un rechargement la garde, et le
 * paramètre suit l'utilisateur quand il change d'onglet. Écrire la soirée
 * remplace l'entrée d'historique : le bouton « retour » ne rejoue pas chaque
 * choix.
 */
export function useEventParam(): [string | null, (eventId: string | null) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const eventId = pickEventId(searchParams.get('event'));

  const setEventId = useCallback((next: string | null) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next) params.set('event', next);
      else params.delete('event');
      return params;
    }, { replace: true });
  }, [setSearchParams]);

  return [eventId, setEventId];
}
