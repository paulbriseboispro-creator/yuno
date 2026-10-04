/** Poser un bloc de la palette : à quelle place, et comment (cf. StudioLeft). */
import { useCallback } from 'react';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { useNights } from '@/crm/data/nights';
import { useStudioApi } from '@/components/email-studio/store';
import { lineupBlocks, type PaletteKey } from './catalog';

/** Pose un bloc de la palette à `at` (Line-up = deux blocs Texte, un seul pas d'historique). */
export function useInsertBlock() {
  const api = useStudioApi();
  const { t } = useCrmT();
  const { space } = useCrmScope();
  const nights = useNights();
  return useCallback((k: PaletteKey, at: number) => {
    const st = api.getState();
    if (k === 'lineup') {
      const night = nights.data?.nights.find((x) => x.id === st.campaign.eventId);
      const pair = lineupBlocks(t, space.name, night?.lineup);
      const blocks = [...st.campaign.blocks];
      const i = Math.max(0, Math.min(at, blocks.length));
      blocks.splice(i, 0, ...pair);
      st.setBlocks(blocks);
      st.select(pair[1].id);
      return;
    }
    st.addBlock(k, at);
  }, [api, t, space.name, nights.data]);
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

