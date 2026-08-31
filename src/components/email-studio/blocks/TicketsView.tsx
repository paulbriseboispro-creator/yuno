import type { EmailTheme, TicketsBlock } from '@/lib/email';
import { EMAIL_FONT, emailBtnStyle, type CanvasCtx } from './common';

export default function TicketsView({ block, theme, ctx }: { block: TicketsBlock; theme: EmailTheme; ctx: CanvasCtx }) {
  const live = block.eventId ? ctx.live[block.eventId] : undefined;
  const rows = (block.live && live?.tickets && live.tickets.length > 0) ? live.tickets : block.rows;
  return (
    <div style={{ padding: '16px 24px' }}>
      <div style={{ border: `1px solid ${theme.divider}`, borderRadius: 12, background: theme.tile, overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            padding: '12px 16px', borderTop: i > 0 ? `1px solid ${theme.divider}` : 'none',
            fontFamily: EMAIL_FONT,
          }}>
            <div style={{ minWidth: 0 }}>
              <p style={{
                margin: 0, fontSize: 14, fontWeight: 700, color: theme.text,
                textDecoration: r.out ? 'line-through' : 'none', opacity: r.out ? 0.55 : 1,
              }}>{r.n}</p>
              {r.s && <p style={{ margin: '2px 0 0', fontSize: 12, color: theme.muted }}>{r.s}</p>}
            </div>
            {r.out ? (
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
                color: theme.muted, whiteSpace: 'nowrap',
              }}>Épuisé</span>
            ) : (
              <span style={{ fontSize: 14, fontWeight: 700, color: theme.text, whiteSpace: 'nowrap' }}>{r.p}</span>
            )}
          </div>
        ))}
        <div style={{ padding: '14px 16px 16px' }}>
          <span style={emailBtnStyle(theme, { small: true, full: true })}>Prendre mes billets</span>
        </div>
      </div>
    </div>
  );
}
