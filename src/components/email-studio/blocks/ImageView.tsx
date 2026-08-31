import { ImageIcon } from 'lucide-react';
import type { EmailTheme, ImageBlock } from '@/lib/email';
import { EMAIL_FONT } from './common';

export default function ImageView({ block, theme }: { block: ImageBlock; theme: EmailTheme }) {
  return (
    <div style={{ padding: '16px 24px' }}>
      {block.url ? (
        <img
          src={block.url} alt={block.label}
          style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 8 }}
        />
      ) : (
        <div style={{
          height: block.h, background: theme.tile, border: `1px dashed ${theme.divider}`,
          borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 6, color: theme.muted,
          fontFamily: EMAIL_FONT, fontSize: 12,
        }}>
          <ImageIcon size={16} strokeWidth={1.75} />
          {block.label || 'Image'}
        </div>
      )}
    </div>
  );
}
