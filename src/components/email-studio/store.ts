import { createContext, useContext } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import type {
  AudienceExclusions, AudienceSel, BlockType, EmailBlock, EmailTheme,
  SocialLinks, StudioCampaign,
} from '@/lib/email';
import { duplicateBlock, makeBlock, themePreset, type MakeBlockCtx } from '@/lib/email';

// ─────────────────────────────────────────────────────────────────────────────
// Store du Studio — état + undo/redo (40 états) + suivi d'autosave, isolé de
// l'UI. Un store par campagne ouverte (créé dans StudioShell, distribué par
// contexte). L'autosave lui-même (Supabase) vit dans StudioShell : le store ne
// connaît pas le réseau.
// ─────────────────────────────────────────────────────────────────────────────

export type StudioStep = 'studio' | 'audience' | 'schedule' | 'review' | 'sending';

/** Ce que l'historique capture : le CONTENU, pas la sélection ni l'UI. */
interface ContentSnapshot {
  blocks: EmailBlock[];
  theme: EmailTheme;
  subject: string;
  subjectB: string;
  preheader: string;
}

const HISTORY_LIMIT = 40;

export interface StudioState {
  campaign: StudioCampaign;
  step: StudioStep;
  selectedId: string | null;
  /** Mode insertion : index cible après clic sur un « + » inter-blocs. */
  insertIndex: number | null;
  device: 'desktop' | 'mobile';
  preview: boolean;
  paletteTab: 'blocks' | 'structure';
  inspectorTab: 'block' | 'theme' | 'data';
  /** Tiroir bas du canvas : contrôles pré-envoi ou modèle JSON. */
  drawer: 'checks' | 'json' | null;
  past: ContentSnapshot[];
  future: ContentSnapshot[];
  /** Suivi autosave (rempli par StudioShell). */
  dirty: boolean;
  saving: boolean;
  savedAt: number | null;
  /** Compteur de sauvegardes abouties — déclenche les recomptes d'audience. */
  saveSeq: number;

  // UI
  setStep: (s: StudioStep) => void;
  select: (id: string | null) => void;
  setInsertIndex: (i: number | null) => void;
  setDevice: (d: 'desktop' | 'mobile') => void;
  setPreview: (v: boolean) => void;
  setPaletteTab: (t: 'blocks' | 'structure') => void;
  setInspectorTab: (t: 'block' | 'theme' | 'data') => void;
  setDrawer: (d: 'checks' | 'json' | null) => void;

  // Campagne (hors contenu — pas d'historique)
  patchCampaign: (patch: Partial<StudioCampaign>) => void;
  setAudiences: (audiences: AudienceSel[]) => void;
  setExclusions: (exclusions: AudienceExclusions) => void;
  setSocialLinks: (links: SocialLinks) => void;

  // Contenu (historisé)
  patchContent: (patch: Partial<Pick<StudioCampaign, 'subject' | 'subjectB' | 'preheader'>>) => void;
  addBlock: (type: BlockType, index?: number | null) => string;
  updateBlock: (id: string, patch: Partial<EmailBlock>) => void;
  moveBlock: (id: string, direction: -1 | 1) => void;
  reorderBlock: (fromIndex: number, toIndex: number) => void;
  duplicate: (id: string) => void;
  removeBlock: (id: string) => void;
  applyThemePreset: (name: string) => void;
  patchTheme: (patch: Partial<EmailTheme>) => void;
  setBlocks: (blocks: EmailBlock[]) => void;
  undo: () => void;
  redo: () => void;

  // Autosave (appelé par StudioShell)
  markSaving: () => void;
  markSaved: () => void;
  markSaveFailed: () => void;
}

function snapshot(c: StudioCampaign): ContentSnapshot {
  return {
    blocks: JSON.parse(JSON.stringify(c.blocks)) as EmailBlock[],
    theme: { ...c.theme },
    subject: c.subject,
    subjectB: c.subjectB,
    preheader: c.preheader,
  };
}

export function createStudioStore(initial: StudioCampaign, blockCtx: MakeBlockCtx): StoreApi<StudioState> {
  return createStore<StudioState>((set, get) => {
    /** Pousse l'état courant dans l'historique puis applique la mutation. */
    const withHistory = (mutate: (c: StudioCampaign) => StudioCampaign) => {
      const { campaign, past } = get();
      const nextPast = [...past, snapshot(campaign)].slice(-HISTORY_LIMIT);
      set({ campaign: mutate(campaign), past: nextPast, future: [], dirty: true });
    };

    return {
      campaign: initial,
      step: 'studio',
      selectedId: null,
      insertIndex: null,
      device: 'desktop',
      preview: false,
      paletteTab: 'blocks',
      inspectorTab: 'block',
      drawer: null,
      past: [],
      future: [],
      dirty: false,
      saving: false,
      savedAt: null,
      saveSeq: 0,

      setStep: (step) => set({ step }),
      select: (selectedId) => set((s) => ({
        selectedId,
        insertIndex: null,
        inspectorTab: selectedId ? 'block' : s.inspectorTab,
      })),
      setInsertIndex: (insertIndex) => set({ insertIndex }),
      setDevice: (device) => set({ device }),
      setPreview: (preview) => set({ preview, ...(preview ? { selectedId: null, insertIndex: null } : {}) }),
      setPaletteTab: (paletteTab) => set({ paletteTab }),
      setInspectorTab: (inspectorTab) => set({ inspectorTab }),
      setDrawer: (drawer) => set({ drawer }),

      patchCampaign: (patch) => set((s) => ({ campaign: { ...s.campaign, ...patch }, dirty: true })),
      setAudiences: (audiences) => set((s) => ({ campaign: { ...s.campaign, audiences }, dirty: true })),
      setExclusions: (exclusions) => set((s) => ({ campaign: { ...s.campaign, exclusions }, dirty: true })),
      setSocialLinks: (socialLinks) => set((s) => ({ campaign: { ...s.campaign, socialLinks }, dirty: true })),

      patchContent: (patch) => withHistory((c) => ({ ...c, ...patch })),

      addBlock: (type, index) => {
        const block = makeBlock(type, { ...blockCtx, eventId: get().campaign.eventId || blockCtx.eventId });
        withHistory((c) => {
          const blocks = [...c.blocks];
          const at = index == null ? blocks.length : Math.max(0, Math.min(index, blocks.length));
          blocks.splice(at, 0, block);
          return { ...c, blocks };
        });
        set({ selectedId: block.id, insertIndex: null, inspectorTab: 'block' });
        return block.id;
      },

      updateBlock: (id, patch) => withHistory((c) => ({
        ...c,
        blocks: c.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as EmailBlock) : b)),
      })),

      moveBlock: (id, direction) => withHistory((c) => {
        const i = c.blocks.findIndex((b) => b.id === id);
        const j = i + direction;
        if (i < 0 || j < 0 || j >= c.blocks.length) return c;
        const blocks = [...c.blocks];
        [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
        return { ...c, blocks };
      }),

      reorderBlock: (fromIndex, toIndex) => withHistory((c) => {
        if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= c.blocks.length) return c;
        const blocks = [...c.blocks];
        const [moved] = blocks.splice(fromIndex, 1);
        blocks.splice(Math.max(0, Math.min(toIndex, blocks.length)), 0, moved);
        return { ...c, blocks };
      }),

      duplicate: (id) => {
        let newId: string | null = null;
        withHistory((c) => {
          const i = c.blocks.findIndex((b) => b.id === id);
          if (i < 0) return c;
          const copy = duplicateBlock(c.blocks[i]);
          newId = copy.id;
          const blocks = [...c.blocks];
          blocks.splice(i + 1, 0, copy);
          return { ...c, blocks };
        });
        if (newId) set({ selectedId: newId });
      },

      removeBlock: (id) => {
        withHistory((c) => ({ ...c, blocks: c.blocks.filter((b) => b.id !== id) }));
        if (get().selectedId === id) set({ selectedId: null });
      },

      applyThemePreset: (name) => {
        const preset = themePreset(name);
        if (!preset) return;
        // Un preset change la PALETTE ; les choix de structure (réseaux au
        // pied de page) survivent au changement de couleurs.
        withHistory((c) => ({ ...c, theme: { ...preset, footerSocial: c.theme.footerSocial } }));
      },

      patchTheme: (patch) => withHistory((c) => ({ ...c, theme: { ...c.theme, ...patch } })),

      setBlocks: (blocks) => withHistory((c) => ({ ...c, blocks })),

      undo: () => {
        const { past, future, campaign } = get();
        if (past.length === 0) return;
        const prev = past[past.length - 1];
        set({
          campaign: { ...campaign, ...prev },
          past: past.slice(0, -1),
          future: [snapshot(campaign), ...future].slice(0, HISTORY_LIMIT),
          dirty: true,
        });
      },

      redo: () => {
        const { past, future, campaign } = get();
        if (future.length === 0) return;
        const next = future[0];
        set({
          campaign: { ...campaign, ...next },
          past: [...past, snapshot(campaign)].slice(-HISTORY_LIMIT),
          future: future.slice(1),
          dirty: true,
        });
      },

      markSaving: () => set({ saving: true }),
      markSaved: () => set((s) => ({
        saving: false, dirty: false, savedAt: Date.now(), saveSeq: s.saveSeq + 1,
      })),
      markSaveFailed: () => set({ saving: false }),
    };
  });
}

export const StudioStoreContext = createContext<StoreApi<StudioState> | null>(null);

export function useStudio<T>(selector: (s: StudioState) => T): T {
  const store = useContext(StudioStoreContext);
  if (!store) throw new Error('useStudio: StudioStoreContext manquant');
  return useStore(store, selector);
}

export function useStudioApi(): StoreApi<StudioState> {
  const store = useContext(StudioStoreContext);
  if (!store) throw new Error('useStudioApi: StudioStoreContext manquant');
  return store;
}
