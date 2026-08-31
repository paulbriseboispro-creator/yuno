import type { EmailTheme, EventBlock } from '@/lib/email';
import { EMAIL_FONT, emailBtnStyle, type CanvasCtx } from './common';

export default function EventView({ block, theme, ctx }: { block: EventBlock; theme: EmailTheme; ctx: CanvasCtx }) {
  const live = block.eventId ? ctx.live[block.eventId] : undefined;
  const title = live?.title || block.title;
  const dateLabel = live?.dateLabel || block.dateLabel;
  const venueLabel = live?.venueLabel || block.venueLabel;
  const coverUrl = live?.coverUrl || block.coverUrl;
  return (
    <div style={{ padding: '16px 24px' }}>
      <div style={{ border: `1px solid ${theme.divider}`, borderRadius: 12, background: theme.tile, overflow: 'hidden' }}>
        {block.cover && (coverUrl ? (
          <img src={coverUrl} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
        ) : (
          <div style={{
            height: 120, background: `linear-gradient(135deg, ${theme.accent}22, transparent)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: theme.muted, fontFamily: EMAIL_FONT, fontSize: 12,
          }}>Visuel de la soirée</div>
        ))}
        <div style={{ padding: '18px 20px' }}>
          <h2 style={{ margin: '0 0 6px', fontFamily: EMAIL_FONT, fontSize: 19, lineHeight: '24px', color: theme.text }}>{title}</h2>
          <p style={{ margin: '0 0 4px', fontFamily: EMAIL_FONT, fontSize: 13, color: theme.muted }}>{dateLabel}</p>
          {block.venue && (
            <p style={{ margin: '0 0 4px', fontFamily: EMAIL_FONT, fontSize: 13, color: theme.muted }}>{venueLabel}</p>
          )}
          {block.price && live?.priceFromLabel && (
            <p style={{ margin: '0 0 14px', fontFamily: EMAIL_FONT, fontSize: 13, fontWeight: 700, color: theme.accent }}>{live.priceFromLabel}</p>
          )}
          <div style={{ height: 10 }} />
          <span style={emailBtnStyle(theme, { small: true })}>{block.ctaLabel}</span>
        </div>
      </div>
    </div>
  );
}
