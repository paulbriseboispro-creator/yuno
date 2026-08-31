import type { EmailTheme, TextBlock } from '@/lib/email';
import { EMAIL_FONT, canvasHtml } from './common';

export default function TextView({ block, theme }: { block: TextBlock; theme: EmailTheme }) {
  return (
    <div
      style={{
        padding: '20px 24px', fontFamily: EMAIL_FONT,
        fontSize: Math.max(11, Math.min(28, block.size || 16)), lineHeight: 1.6,
        color: theme.text, textAlign: block.align || 'left',
        overflowWrap: 'break-word',
      }}
      dangerouslySetInnerHTML={{ __html: canvasHtml(block.body, theme.accent) }}
    />
  );
}
