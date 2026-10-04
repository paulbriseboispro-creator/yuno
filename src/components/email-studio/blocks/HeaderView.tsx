import type { EmailTheme, HeaderBlock } from '@/lib/email';
import { LOGO_SIZES, contrastText, isHexColor } from '@/lib/email';
import { EMAIL_FONT, blockBgColor, blockPad, type CanvasCtx } from './common';

export default function HeaderView({ block, theme, ctx }: { block: HeaderBlock; theme: EmailTheme; ctx: CanvasCtx }) {
  const pad = blockPad(block);
  const size = LOGO_SIZES[block.logoSize] || LOGO_SIZES.md;
  const radius = block.logoShape === 'circle' ? '50%' : block.logoShape === 'rounded' ? 14 : 0;
  const name = block.venueName || ctx.venueName;
  // Repli automatique sur le logo du compte (miroir de render.ts).
  const logoSrc = block.logoUrl || ctx.logoUrl || '';
  // Le header suit theme.headerBg tant que le bloc ne choisit rien ; un fond
  // posé sur le bloc gagne, et le nom se re-contraste (miroir de render.ts).
  const canvasBg = blockBgColor(block, theme);
  const headerBg = canvasBg === 'transparent' ? theme.headerBg : canvasBg;
  const nameColor = isHexColor(block.bgc) ? contrastText(block.bgc.trim()) : theme.headerText;
  return (
    <div style={{ padding: `${pad.py}px ${pad.px}px`, textAlign: 'center', background: headerBg }}>
      {logoSrc ? (
        <img
          src={logoSrc} alt=""
          style={{
            width: size, height: size, objectFit: 'cover', display: 'block',
            margin: `0 auto ${block.showName ? 12 : 0}px`, borderRadius: radius,
          }}
        />
      ) : null /* Sans logo, l'e-mail envoyé n'en montre aucun (renderHeader) : le canvas non plus. */}
      {block.showName && (
        <div style={{
          fontFamily: EMAIL_FONT, fontSize: 22, fontWeight: 700,
          color: nameColor, letterSpacing: '0.06em',
        }}>{name}</div>
      )}
    </div>
  );
}
