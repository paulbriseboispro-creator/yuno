import type { EmailTheme, ImageBlock } from '@/lib/email';
import { blockPad, placeholderLabelStyle, stripesBg } from './common';

export default function ImageView({ block, theme }: { block: ImageBlock; theme: EmailTheme }) {
  const pad = blockPad(block);
  const radius = typeof block.radius === 'number' && block.radius > 0 ? Math.min(40, block.radius) : 0;
  if (block.url) {
    return (
      <div style={{ padding: `${pad.py}px ${pad.px}px` }}>
        <img src={block.url} alt={block.label} style={{ width: '100%', height: 'auto', display: 'block', borderRadius: radius }} />
      </div>
    );
  }
  return (
    <div style={{ padding: `${pad.py}px ${pad.px}px` }}>
      <div style={{
        height: block.h || 210, background: stripesBg(theme),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={placeholderLabelStyle(theme)}>{block.label || 'image'}</span>
      </div>
    </div>
  );
}
