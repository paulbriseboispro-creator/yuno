import type { CtaBlock, EmailTheme } from '@/lib/email';
import { canvasText, emailBtnStyle } from './common';

export default function CtaView({ block, theme }: { block: CtaBlock; theme: EmailTheme }) {
  return (
    <div style={{ padding: '20px 24px', textAlign: block.align || 'center' }}>
      <span
        style={emailBtnStyle(theme, { radius: block.radius, full: block.full })}
        dangerouslySetInnerHTML={{ __html: canvasText(block.label, theme.btnText) }}
      />
    </div>
  );
}
