import type { DividerBlock, EmailTheme } from '@/lib/email';
import { DEFAULT_PX } from '@/lib/email';

export default function DividerView({ block, theme }: { block: DividerBlock; theme: EmailTheme }) {
  return (
    <div style={{ padding: `10px ${block.px ?? DEFAULT_PX}px` }}>
      <div style={{ height: 1, background: theme.divider }} />
    </div>
  );
}
