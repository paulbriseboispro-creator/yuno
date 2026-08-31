import type { EmailTheme, HeaderBlock } from '@/lib/email';
import { LOGO_SIZES } from '@/lib/email';
import { EMAIL_FONT, type CanvasCtx } from './common';

export default function HeaderView({ block, theme, ctx }: { block: HeaderBlock; theme: EmailTheme; ctx: CanvasCtx }) {
  const size = LOGO_SIZES[block.logoSize] || LOGO_SIZES.md;
  const radius = block.logoShape === 'circle' ? '50%' : block.logoShape === 'rounded' ? 12 : 0;
  return (
    <div style={{ padding: '30px 24px', textAlign: 'center', background: theme.headerBg }}>
      {block.logoUrl && (
        <img
          src={block.logoUrl} alt=""
          style={{
            width: size, height: size, objectFit: 'cover', display: 'block',
            margin: `0 auto ${block.showName ? 12 : 0}px`, borderRadius: radius,
          }}
        />
      )}
      {block.showName && (
        <h1 style={{
          margin: 0, fontFamily: EMAIL_FONT, fontSize: 22, lineHeight: '28px',
          fontWeight: 700, color: theme.headerText, letterSpacing: 1,
        }}>{block.venueName || ctx.venueName}</h1>
      )}
    </div>
  );
}
