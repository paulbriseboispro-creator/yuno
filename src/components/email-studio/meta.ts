import type { LucideIcon } from 'lucide-react';
import {
  PanelTop, Image, Type, MousePointer, Columns, Minus, MoveVertical,
  CalendarDays, Ticket, Wine, Timer, Share2, Code,
} from 'lucide-react';
import type { BlockType } from '@/lib/email';

export type BlockGroup = 'content' | 'yuno' | 'advanced';

export interface BlockMeta {
  type: BlockType;
  labelKey: string;
  icon: LucideIcon;
  group: BlockGroup;
}

/** Palette : 3 groupes — Contenu, Blocs Yuno (données live), Avancé. */
export const BLOCK_META: readonly BlockMeta[] = [
  { type: 'header', labelKey: 'studio.block.header', icon: PanelTop, group: 'content' },
  { type: 'text', labelKey: 'studio.block.text', icon: Type, group: 'content' },
  { type: 'image', labelKey: 'studio.block.image', icon: Image, group: 'content' },
  { type: 'cta', labelKey: 'studio.block.cta', icon: MousePointer, group: 'content' },
  { type: 'columns', labelKey: 'studio.block.columns', icon: Columns, group: 'content' },
  { type: 'divider', labelKey: 'studio.block.divider', icon: Minus, group: 'content' },
  { type: 'spacer', labelKey: 'studio.block.spacer', icon: MoveVertical, group: 'content' },
  { type: 'event', labelKey: 'studio.block.event', icon: CalendarDays, group: 'yuno' },
  { type: 'tickets', labelKey: 'studio.block.tickets', icon: Ticket, group: 'yuno' },
  { type: 'table', labelKey: 'studio.block.table', icon: Wine, group: 'yuno' },
  { type: 'countdown', labelKey: 'studio.block.countdown', icon: Timer, group: 'yuno' },
  { type: 'social', labelKey: 'studio.block.social', icon: Share2, group: 'advanced' },
  { type: 'html', labelKey: 'studio.block.html', icon: Code, group: 'advanced' },
];

export function blockMeta(type: BlockType): BlockMeta {
  return BLOCK_META.find((m) => m.type === type) || BLOCK_META[1];
}
