import type { DividerBlock, EmailTheme } from '@/lib/email';

export default function DividerView({ theme }: { block: DividerBlock; theme: EmailTheme }) {
  return (
    <div style={{ padding: '8px 24px' }}>
      <hr style={{ border: 'none', borderTop: `1px solid ${theme.divider}`, margin: 0 }} />
    </div>
  );
}
