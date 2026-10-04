/**
 * L'état d'INTERFACE de l'éditeur qui n'a rien à faire dans l'historique :
 * glisser-déposer (partagé par la palette, la structure et l'e-mail), survol,
 * fenêtre de test, palette en fenêtre sur petit écran, et le dernier champ
 * actif (où une puce {{prénom}} s'insère).
 */
import { createContext, useContext } from 'react';
import type { MutableRefObject } from 'react';
import type { RichTextHandle } from '@/components/email-studio/RichTextField';
import type { PaletteKey } from './catalog';

export type Drag = { kind: 'new'; k: PaletteKey } | { kind: 'move'; id: string } | null;

/** Champ où s'insère une information du client. */
export type ActiveField = { kind: 'rich' } | { kind: 'input'; el: HTMLInputElement | HTMLTextAreaElement; apply: (v: string) => void } | null;

export interface StudioUi {
  drag: Drag;
  setDrag: (d: Drag) => void;
  dropAt: number | null;
  setDropAt: (n: number | null) => void;
  hoverId: string | null;
  setHoverId: (id: string | null) => void;
  testOpen: boolean;
  setTestOpen: (v: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  rich: MutableRefObject<RichTextHandle | null>;
  active: MutableRefObject<ActiveField>;
}

export const StudioUiContext = createContext<StudioUi | null>(null);

export function useStudioUi(): StudioUi {
  const v = useContext(StudioUiContext);
  if (!v) throw new Error('useStudioUi: StudioProvider manquant');
  return v;
}

/** Insère `{{clé}}` dans le dernier champ actif (texte riche ou champ simple). */
export function insertVariable(ui: StudioUi, key: string): boolean {
  const tok = `{{${key}}}`;
  const a = ui.active.current;
  if (a?.kind === 'rich' && ui.rich.current) { ui.rich.current.insertText(tok); return true; }
  if (a?.kind === 'input') {
    const el = a.el;
    const cur = el.value;
    const s = el.selectionStart ?? cur.length;
    const e = el.selectionEnd ?? cur.length;
    const next = cur.slice(0, s) + tok + cur.slice(e);
    a.apply(next);
    const pos = s + tok.length;
    window.setTimeout(() => { el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* champ sans sélection : le curseur reste en fin */ } }, 20);
    return true;
  }
  return false;
}
