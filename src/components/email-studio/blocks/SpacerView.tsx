import type { EmailTheme, SpacerBlock } from '@/lib/email';
import { SPACER_SIZES } from '@/lib/email';

/** Hauteur réelle + libellé mono « espace md » (prototype). */
export default function SpacerView({ block, theme }: { block: SpacerBlock; theme: EmailTheme }) {
  const h = SPACER_SIZES[block.size] || SPACER_SIZES.md;
  return (
    <div style={{ height: h + 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{
        fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 10,
        color: theme.dark ? '#4a4a4a' : '#c4c4c4', letterSpacing: '0.06em',
      }}>espace {block.size}</span>
    </div>
  );
}
