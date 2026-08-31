import type { EmailTheme, TableBlock } from '@/lib/email';
import { EMAIL_FONT, canvasText, emailBtnStyle, type CanvasCtx } from './common';

export default function TableView({ block, theme, ctx }: { block: TableBlock; theme: EmailTheme; ctx: CanvasCtx }) {
  const live = block.eventId ? ctx.live[block.eventId] : undefined;
  const left = live?.tablesLeft;
  return (
    <div style={{ padding: '16px 24px' }}>
      <div style={{ border: `1px solid ${theme.divider}`, borderRadius: 12, background: theme.tile, padding: '18px 20px' }}>
        <p style={{
          margin: '0 0 4px', fontFamily: EMAIL_FONT, fontSize: 10, fontWeight: 700,
          letterSpacing: '.08em', textTransform: 'uppercase', color: theme.muted,
        }}>{block.cond || 'VIP · Table'}</p>
        <h2
          style={{ margin: '0 0 6px', fontFamily: EMAIL_FONT, fontSize: 18, lineHeight: '23px', color: theme.text }}
          dangerouslySetInnerHTML={{ __html: canvasText(block.title, theme.accent) }}
        />
        <p
          style={{ margin: '0 0 12px', fontFamily: EMAIL_FONT, fontSize: 13, lineHeight: 1.5, color: theme.muted }}
          dangerouslySetInnerHTML={{ __html: canvasText(block.sub, theme.accent) }}
        />
        {typeof left === 'number' && (
          <p style={{ margin: '0 0 12px', fontFamily: EMAIL_FONT, fontSize: 12, fontWeight: 700, color: theme.accent }}>
            {left <= 0 ? 'Complet ce soir' : `${left} table${left > 1 ? 's' : ''} encore libre${left > 1 ? 's' : ''}`}
          </p>
        )}
        <span style={emailBtnStyle(theme, { small: true })}>{block.ctaLabel}</span>
      </div>
    </div>
  );
}
