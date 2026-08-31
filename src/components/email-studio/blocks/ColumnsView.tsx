import type { ColumnsBlock, EmailTheme } from '@/lib/email';
import { EMAIL_FONT, blockPad, stripesBg } from './common';

export default function ColumnsView({ block, theme, mobile }: { block: ColumnsBlock; theme: EmailTheme; mobile?: boolean }) {
  const pad = blockPad(block);
  const col = (c: { title: string; body: string }) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ height: 96, borderRadius: 8, marginBottom: 10, background: stripesBg(theme) }} />
      <div style={{ fontFamily: EMAIL_FONT, fontSize: 15, fontWeight: 600, color: theme.text, marginBottom: 3 }}>{c.title}</div>
      <div style={{ fontFamily: EMAIL_FONT, fontSize: 13, color: theme.muted }}>{c.body}</div>
    </div>
  );
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: 14,
      padding: `${pad.py}px ${pad.px}px`,
    }}>
      {col(block.left)}
      {col(block.right)}
    </div>
  );
}
