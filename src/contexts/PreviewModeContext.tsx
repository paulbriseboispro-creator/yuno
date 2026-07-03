// Mode aperçu (preview) EN LECTURE SEULE — activé quand un prospect ouvre un lien
// de démo verrouillé par mot de passe (voir PreviewGate + demo_preview_links).
//
// Portée SESSION, pas compte : le même compte démo (@womber.fr) sert AUSSI à Paul
// pour démontrer la création en live. On ne peut donc pas rendre le compte lui-même
// lecture seule. On pose un état :
//   - sessionStorage `yuno_preview_readonly` : l'onglet du prospect, survit au reload,
//     meurt à la fermeture de l'onglet.
//   - localStorage `yuno_preview_owner_session` : marqueur compagnon pour ré-armer la
//     lecture seule si le prospect ouvre un NOUVEL onglet (la session Supabase, en
//     localStorage, est partagée entre onglets). Les onglets de Paul ne posent JAMAIS
//     ce marqueur (seul PreviewGate le pose), donc son usage normal reste en écriture.
//
// L'état porte : le nom de la personne (label), la liste des rôles accessibles (roles),
// le rôle courant (current) et la langue par défaut (language).

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

const PREVIEW_FLAG = 'yuno_preview_readonly';        // sessionStorage
const PREVIEW_MARKER = 'yuno_preview_owner_session'; // localStorage
export const PREVIEW_EVENT = 'yuno-preview-changed';

export interface PreviewState {
  label: string;
  roles: string[];
  current: string;
  language: string;
}

const EMPTY: PreviewState = { label: '', roles: [], current: '', language: 'en' };

function parse(raw: string | null): PreviewState | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o && typeof o === 'object' && Array.isArray(o.roles)) {
      return { label: o.label ?? '', roles: o.roles, current: o.current ?? o.roles[0] ?? '', language: o.language ?? 'en' };
    }
  } catch { /* ancien format (string label) : traité comme label seul */
    return { label: raw, roles: [], current: '', language: 'en' };
  }
  return null;
}

function readState(): PreviewState | null {
  try {
    return parse(sessionStorage.getItem(PREVIEW_FLAG)) ?? parse(localStorage.getItem(PREVIEW_MARKER));
  } catch {
    return null;
  }
}

/** Vrai si l'onglet (ou le navigateur du prospect) est en aperçu lecture seule. */
export function isPreviewActive(): boolean {
  try {
    return !!(sessionStorage.getItem(PREVIEW_FLAG) || localStorage.getItem(PREVIEW_MARKER));
  } catch {
    return false;
  }
}

/** Arme la lecture seule (appelé par PreviewGate après connexion au compte démo). */
export function enablePreviewMode(state: { label: string; roles: string[]; current?: string; language?: string }): void {
  const value = JSON.stringify({
    label: state.label ?? '',
    roles: state.roles ?? [],
    current: state.current ?? state.roles?.[0] ?? '',
    language: state.language ?? 'en',
  });
  try {
    sessionStorage.setItem(PREVIEW_FLAG, value);
    localStorage.setItem(PREVIEW_MARKER, value);
  } catch { /* storage indispo : ignore */ }
  try { window.dispatchEvent(new Event(PREVIEW_EVENT)); } catch { /* pas de window */ }
}

/** Met à jour le rôle courant (switch de rôles dans la bannière). */
export function setPreviewCurrentRole(role: string): void {
  const s = readState();
  if (!s) return;
  enablePreviewMode({ ...s, current: role });
}

/** Désarme la lecture seule (bouton « Quitter l'aperçu » / déconnexion). */
export function disablePreviewMode(): void {
  try {
    sessionStorage.removeItem(PREVIEW_FLAG);
    localStorage.removeItem(PREVIEW_MARKER);
  } catch { /* ignore */ }
  try { window.dispatchEvent(new Event(PREVIEW_EVENT)); } catch { /* ignore */ }
}

interface PreviewModeValue extends PreviewState {
  isPreview: boolean;
}

const PreviewModeContext = createContext<PreviewModeValue>({ isPreview: false, ...EMPTY });

export function usePreviewMode(): PreviewModeValue {
  return useContext(PreviewModeContext);
}

export function PreviewModeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PreviewModeValue>(() => {
    const s = readState();
    return { isPreview: isPreviewActive(), ...(s ?? EMPTY) };
  });

  useEffect(() => {
    // Nouvel onglet : ré-armer le flag session depuis le marqueur local persistant.
    try {
      if (!sessionStorage.getItem(PREVIEW_FLAG)) {
        const marker = localStorage.getItem(PREVIEW_MARKER);
        if (marker) sessionStorage.setItem(PREVIEW_FLAG, marker);
      }
    } catch { /* ignore */ }

    const sync = () => {
      const s = readState();
      setState({ isPreview: isPreviewActive(), ...(s ?? EMPTY) });
    };
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
