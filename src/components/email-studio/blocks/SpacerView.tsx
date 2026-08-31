import type { EmailTheme, SpacerBlock } from '@/lib/email';
import { SPACER_SIZES } from '@/lib/email';

export default function SpacerView({ block }: { block: SpacerBlock; theme: EmailTheme }) {
  return <div style={{ height: SPACER_SIZES[block.size] || SPACER_SIZES.md }} />;
}
