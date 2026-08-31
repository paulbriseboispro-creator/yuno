import type { EmailTheme, HeaderBlock } from '@/lib/email';
import { LOGO_SIZES } from '@/lib/email';
import { EMAIL_FONT, type CanvasCtx } from './common';

export default function HeaderView({ block, theme, ctx }: { block: HeaderBlock; theme: EmailTheme; ctx: CanvasCtx }) {
  const size = LOGO_SIZES[block.logoSize] || LOGO_SIZES.md;
  const radius = block.logoShape === 'circle' ? '50%' : block.logoShape === 'rounded' ? 14 : 0;
  const name = block.venueName || ctx.venueName;
  const initial = String(name || 'Y').trim().charAt(0).toUpperCase();
  return (
    <div style={{ padding: '30px 24px', textAlign: 'center', background: theme.headerBg }}>
      {block.logoUrl ? (
        <img
          src={block.logoUrl} alt=""
          style={{
            width: size, height: size, objectFit: 'cover', display: 'block',
            margin: `0 auto ${block.showName ? 12 : 0}px`, borderRadius: radius,
          }}
        />
      ) : (
        <div style={{
          width: size, height: size, margin: `0 auto ${block.showName ? 12 : 0}px`, borderRadius: radius,
          background: theme.accent, color: theme.btnText,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: EMAIL_FONT, fontSize: 22, fontWeight: 800, letterSpacing: '-0.04em',
        }}>{initial}</div>
      )}
      {block.showName && (
        <div style={{
          fontFamily: EMAIL_FONT, fontSize: 22, fontWeight: 700,
          color: theme.headerText, letterSpacing: '0.06em',
        }}>{name}</div>
      )}
    </div>
  );
}
