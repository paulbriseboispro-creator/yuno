import type { DividerBlock, EmailTheme } from '@/lib/email';
import { isHexColor } from '@/lib/email';
import { blockPad } from './common';

export default function DividerView({ block, theme }: { block: DividerBlock; theme: EmailTheme }) {
  const pad = blockPad(block);
  const color = isHexColor(block.color) ? block.color.trim() : theme.divider;
  return (
    <div style={{ padding: `${pad.py}px ${pad.px}px` }}>
      <div style={{ height: 1, background: color }} />
    </div>
  );
}
