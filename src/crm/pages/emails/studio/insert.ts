/** Poser un bloc de la palette : à quelle place, et comment (cf. StudioLeft). */
import { useCallback } from 'react';
import { useStudioApi } from '@/components/email-studio/store';
import type { PaletteKey } from './catalog';

/** Pose un bloc de la palette à `at` (habillé par decorateBlock, cf. EmailStudioPage). */
export function useInsertBlock() {
  const api = useStudioApi();
  return useCallback((k: PaletteKey, at: number) => {
    api.getState().addBlock(k, at);
  }, [api]);
}

/** Où une tuile cliquée se pose : au « + » choisi, sinon sous le bloc sélectionné, sinon à la fin. */
export function useInsertTarget(): () => number {
  const api = useStudioApi();
  return useCallback(() => {
    const st = api.getState();
    if (st.insertIndex !== null) return st.insertIndex;
    const i = st.selectedId ? st.campaign.blocks.findIndex((b) => b.id === st.selectedId) : -1;
    return i >= 0 ? i + 1 : st.campaign.blocks.length;
  }, [api]);
}

