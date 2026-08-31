import type { DividerBlock, EmailTheme } from '@/lib/email';
import { blockPad } from './common';

export default function DividerView({ block, theme }: { block: DividerBlock; theme: EmailTheme }) {
  const pad = blockPad(block);
  return (
    <div style={{ padding: `${pad.py}px ${pad.px}px` }}>
      <div style={{ height: 1, background: theme.divider }} />
    </div>
  );
}
