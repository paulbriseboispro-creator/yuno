import { useSyncExternalStore } from 'react';

/**
 * Registre de l'assistant IA disponible pour le centre d'aide.
 *
 * Chaque dashboard qui monte un assistant (club : OwnerAssistant, agence :
 * AgencyAssistant) s'enregistre ici au montage. Le centre d'aide demande
 * alors « y a-t-il un assistant ? » et, si oui, lui pousse une question
 * (barre de recherche sans résultat, carte « Demander à l'assistant »,
 * question posée depuis un article). Sans assistant enregistré — app
 * organisateur, mode manager — ces surfaces s'effacent au profit du support
 * humain : jamais un bouton qui ne mène nulle part.
 *
 * Zéro couplage React : un module, un callback, un `useSyncExternalStore`.
 */
export type HelpAssistantOpen = (prompt?: string) => void;

let current: HelpAssistantOpen | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Appelé par l'assistant au montage ; rend la fonction de désinscription. */
export function registerHelpAssistant(open: HelpAssistantOpen): () => void {
  current = open;
  emit();
  return () => {
    if (current === open) {
      current = null;
      emit();
    }
  };
}

/** Ouvre l'assistant (avec une question pré-envoyée). Rend false si aucun assistant n'écoute. */
export function askHelpAssistant(prompt?: string): boolean {
  if (!current) return false;
  current(prompt?.trim() || undefined);
  return true;
}

export function isHelpAssistantAvailable(): boolean {
  return current !== null;
}

/** Vrai quand un assistant IA est monté sur la page courante. */
export function useHelpAssistant(): boolean {
  return useSyncExternalStore(subscribe, isHelpAssistantAvailable, () => false);
}
