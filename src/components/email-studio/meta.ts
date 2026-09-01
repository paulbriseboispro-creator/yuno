import type { LucideIcon } from 'lucide-react';
import {
  PanelTop, Image, Type, MousePointerClick, Columns, Minus, MoveVertical,
  CalendarDays, Ticket, Martini, Timer, Share2, Code2,
} from 'lucide-react';
import type { BlockType } from '@/lib/email';

export type BlockGroup = 'content' | 'yuno' | 'advanced';

export interface BlockMeta {
  type: BlockType;
  labelKey: string;
  icon: LucideIcon;
  group: BlockGroup;
}

/**
 * Palette : 3 groupes — Contenu, Blocs Yuno (données live), Avancé.
 * Ordre et icônes du prototype (META + palContent/palYuno/palAdv).
 */
export const BLOCK_META: readonly BlockMeta[] = [
  { type: 'text', labelKey: 'studio.block.text', icon: Type, group: 'content' },
  { type: 'image', labelKey: 'studio.block.image', icon: Image, group: 'content' },
  { type: 'cta', labelKey: 'studio.block.cta', icon: MousePointerClick, group: 'content' },
  { type: 'columns', labelKey: 'studio.block.columns', icon: Columns, group: 'content' },
  { type: 'divider', labelKey: 'studio.block.divider', icon: Minus, group: 'content' },
  { type: 'spacer', labelKey: 'studio.block.spacer', icon: MoveVertical, group: 'content' },
  { type: 'header', labelKey: 'studio.block.header', icon: PanelTop, group: 'content' },
  { type: 'social', labelKey: 'studio.block.social', icon: Share2, group: 'content' },
  { type: 'event', labelKey: 'studio.block.event', icon: CalendarDays, group: 'yuno' },
  { type: 'tickets', labelKey: 'studio.block.tickets', icon: Ticket, group: 'yuno' },
  { type: 'table', labelKey: 'studio.block.table', icon: Martini, group: 'yuno' },
  { type: 'countdown', labelKey: 'studio.block.countdown', icon: Timer, group: 'yuno' },
  { type: 'html', labelKey: 'studio.block.html', icon: Code2, group: 'advanced' },
];

/**
 * Sélection du PIED DE PAGE dans le canvas. Ce n'est pas un bloc : il n'est ni
 * déplaçable, ni supprimable, ni dupliquable — l'email doit toujours porter
 * l'identité de l'expéditeur et le lien de désinscription. L'id sert seulement
 * à router l'inspecteur vers les réglages du footer.
 */
export const FOOTER_SELECTION_ID = '__footer';

export function blockMeta(type: BlockType): BlockMeta {
  return BLOCK_META.find((m) => m.type === type) || BLOCK_META[0];
}
