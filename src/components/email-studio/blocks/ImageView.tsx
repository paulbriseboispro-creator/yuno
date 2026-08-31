import type { EmailTheme, ImageBlock } from '@/lib/email';
import { placeholderLabelStyle, stripesBg } from './common';

export default function ImageView({ block, theme }: { block: ImageBlock; theme: EmailTheme }) {
  if (block.url) {
    return <img src={block.url} alt={block.label} style={{ width: '100%', height: 'auto', display: 'block' }} />;
  }
  return (
    <div style={{
      height: block.h || 210, background: stripesBg(theme),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <span style={placeholderLabelStyle(theme)}>{block.label || 'image'}</span>
    </div>
  );
}
