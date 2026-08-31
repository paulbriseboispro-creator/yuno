import type { ColumnsBlock, EmailTheme } from '@/lib/email';
import { EMAIL_FONT, canvasText } from './common';

export default function ColumnsView({ block, theme, mobile }: { block: ColumnsBlock; theme: EmailTheme; mobile?: boolean }) {
  const col = (c: { title: string; body: string }) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <p
        style={{ margin: '0 0 6px', fontFamily: EMAIL_FONT, fontSize: 14, fontWeight: 700, color: theme.text }}
        dangerouslySetInnerHTML={{ __html: canvasText(c.title, theme.accent) }}
      />
      <p
        style={{ margin: 0, fontFamily: EMAIL_FONT, fontSize: 13, lineHeight: 1.6, color: theme.muted }}
        dangerouslySetInnerHTML={{ __html: canvasText(c.body, theme.accent) }}
      />
    </div>
  );
  return (
    <div style={{ padding: '16px 24px', display: 'flex', gap: 20, flexDirection: mobile ? 'column' : 'row' }}>
      {col(block.left)}
      {col(block.right)}
    </div>
  );
}
