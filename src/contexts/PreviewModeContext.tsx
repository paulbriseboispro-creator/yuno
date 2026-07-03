// Mode aperçu (preview) EN LECTURE SEULE — activé quand un prospect ouvre un lien
// de démo verrouillé par mot de passe (voir PreviewGate + demo_preview_links).
//
// Portée SESSION, pas compte : le même compte démo (@womber.fr) sert AUSSI à Paul
// pour démontrer la création en live. On ne peut donc pas rendre le compte lui-même
// lecture seule. On pose un flag :
//   - sessionStorage `yuno_preview_readonly` : l'onglet du prospect, survit au reload,
//     meurt à la fermeture de l'onglet.
//   - localStorage `yuno_preview_owner_session` : marqueur compagnon pour ré-armer la
//     lecture seule si le prospect ouvre un NOUVEL onglet (la session Supabase, en
//     localStorage, est partagée entre onglets). Les onglets de Paul ne posent JAMAIS
//     ce marqueur (seul PreviewGate le pose), donc son usage normal reste en écriture.

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

const PREVIEW_FLAG = 'yuno_preview_readonly';        // sessionStorage
const PREVIEW_MARKER = 'yuno_preview_owner_session'; // localStorage
export const PREVIEW_EVENT = 'yuno-preview-changed';

/** Vrai si l'onglet (ou le navigateur du prospect) est en aperçu lecture seule. */
export function isPreviewActive(): boolean {
  try {
    return !!(sessionStorage.getItem(PREVIEW_FLAG) || localStorage.getItem(PREVIEW_MARKER));
  } catch {
    return false;
  }
}

/** Nom de la personne à qui le lien a été envoyé (pour la bannière). */
export function getPreviewLabel(): string {
  try {
    return sessionStorage.getItem(PREVIEW_FLAG) || localStorage.getItem(PREVIEW_MARKER) || '';
  } catch {
    return '';
  }
}

/** Arme la lecture seule (appelé par PreviewGate après connexion au compte démo). */
export function enablePreviewMode(label: string): void {
  const value = label || '1';
  try {
    sessionStorage.setItem(PREVIEW_FLAG, value);
    localStorage.setItem(PREVIEW_MARKER, value);
  } catch { /* storage indispo : ignore */ }
  try { window.dispatchEvent(new Event(PREVIEW_EVENT)); } catch { /* pas de window */ }
}

/** Désarme la lecture seule (bouton « Quitter l'aperçu » / déconnexion). */
export function disablePreviewMode(): void {
  try {
    sessionStorage.removeItem(PREVIEW_FLAG);
    localStorage.removeItem(PREVIEW_MARKER);
  } catch { /* ignore */ }
  try { window.dispatchEvent(new Event(PREVIEW_EVENT)); } catch { /* ignore */ }
}

interface PreviewModeValue {
  isPreview: boolean;
  label: string;
}

const PreviewModeContext = createContext<PreviewModeValue>({ isPreview: false, label: '' });

export function usePreviewMode(): PreviewModeValue {
  return useContext(PreviewModeContext);
}

export function PreviewModeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PreviewModeValue>(() => ({
    isPreview: isPreviewActive(),
    label: getPreviewLabel(),
  }));

  useEffect(() => {
    // Nouvel onglet : ré-armer le flag session depuis le marqueur local persistant.
    try {
      if (!sessionStorage.getItem(PREVIEW_FLAG)) {
        const marker = localStorage.getItem(PREVIEW_MARKER);
        if (marker) sessionStorage.setItem(PREVIEW_FLAG, marker);
      }
    } catch { /* ignore */ }

    const sync = () => setState({ isPreview: isPreviewActive(), label: getPreviewLabel() });
    sync();
    window.addEventListener(PREVIEW_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(PREVIEW_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return <PreviewModeContext.Provider value={state}>{children}</PreviewModeContext.Provider>;
}
