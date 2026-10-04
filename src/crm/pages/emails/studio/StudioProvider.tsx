/** Fournit l'état d'interface du Studio (cf. studioUi.ts). */
import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { RichTextHandle } from '@/components/email-studio/RichTextField';
import { StudioUiContext, type ActiveField, type Drag } from './studioUi';

export function StudioProvider({ children }: { children: ReactNode }) {
  const [drag, setDrag] = useState<Drag>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const rich = useRef<RichTextHandle | null>(null);
  const active = useRef<ActiveField>(null);
  const value = useMemo(
    () => ({ drag, setDrag, dropAt, setDropAt, hoverId, setHoverId, testOpen, setTestOpen, paletteOpen, setPaletteOpen, rich, active }),
    [drag, dropAt, hoverId, testOpen, paletteOpen],
  );
  return <StudioUiContext.Provider value={value}>{children}</StudioUiContext.Provider>;
}

