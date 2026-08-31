import type { EmailTheme, TicketsBlock } from '@/lib/email';
import { EMAIL_FONT, blockPad, type CanvasCtx } from './common';

/** Lignes de tarifs (rowsEl du prototype) : prix accent, épuisé barré. */
export default function TicketsView({ block, theme, ctx }: { block: TicketsBlock; theme: EmailTheme; ctx: CanvasCtx }) {
  const pad = blockPad(block);
  const live = block.eventId ? ctx.live[block.eventId] : undefined;
  const rows = (block.live && live?.tickets && live.tickets.length > 0) ? live.tickets : block.rows;
  return (
    <div style={{ padding: `${pad.py}px ${pad.px}px` }}>
      <div style={{ border: `1px solid ${theme.divider}`, borderRadius: 12, overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            padding: '13px 16px',
            borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${theme.divider}`,
            fontFamily: EMAIL_FONT,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: r.out ? theme.muted : theme.text }}>{r.n}</div>
              {r.s && <div style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}>{r.s}</div>}
            </div>
            <div style={{
              fontSize: 14.5, fontWeight: 700, whiteSpace: 'nowrap',
              color: r.out ? theme.muted : theme.accent,
              textDecoration: r.out ? 'line-through' : 'none',
            }}>{r.p}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
