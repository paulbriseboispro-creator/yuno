// Mode aperçu (preview) EN LECTURE SEULE — activé quand un prospect ouvre un lien
// de démo verrouillé par mot de passe (voir PreviewGate + demo_preview_links).
//
// Portée ONGLET (sessionStorage `yuno_preview_readonly`) — VOLONTAIREMENT pas de
// marqueur localStorage partagé navigateur. Raison : le même compte démo owner@womber.fr
// sert AUSSI à Paul (« womber ») pour tout modifier en live. La lecture seule ne doit
// donc JAMAIS déborder sur ses sessions à lui. Elle vit uniquement dans l'onglet où le
// prospect a ouvert son lien (survit au reload, meurt à la fermeture de l'onglet / au
// bouton « Quitter »). Les onglets de Paul, eux, ne posent jamais le flag → écriture pleine.
//
// L'état porte : le nom de la personne (label), la liste des rôles accessibles (roles),
// le rôle courant (current) et la langue par défaut (language).

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

const PREVIEW_FLAG = 'yuno_preview_readonly'; // sessionStorage (par onglet)
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
    return parse(sessionStorage.getItem(PREVIEW_FLAG));
  } catch {
    return null;
  }
}

/** Vrai si CET onglet est en aperçu lecture seule (jamais les sessions normales de Paul). */
export function isPreviewActive(): boolean {
  try {
    return !!sessionStorage.getItem(PREVIEW_FLAG);
  } catch {
    return false;
  }
}

/** Nom de la personne à qui le lien a été envoyé (pour la bannière). */
export function getPreviewLabel(): string {
  return readState()?.label ?? '';
}

/** Arme la lecture seule (appelé par PreviewGate après connexion au compte démo). */
export function enablePreviewMode(state: { label: string; roles: string[]; current?: string; language?: string }): void {
  const value = JSON.stringify({
    label: state.label ?? '',
    roles: state.roles ?? [],
    current: state.current ?? state.roles?.[0] ?? '',
    language: state.language ?? 'en',
  });
  try { sessionStorage.setItem(PREVIEW_FLAG, value); } catch { /* storage indispo : ignore */ }
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
  try { sessionStorage.removeItem(PREVIEW_FLAG); } catch { /* ignore */ }
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
    const sync = () => {
      const s = readState();
      setState({ isPreview: isPreviewActive(), ...(s ?? EMPTY) });
    };
    sync();
    window.addEventListener(PREVIEW_EVENT, sync);
    return () => window.removeEventListener(PREVIEW_EVENT, sync);
  }, []);

  return <PreviewModeContext.Provider value={state}>{children}</PreviewModeContext.Provider>;
}
