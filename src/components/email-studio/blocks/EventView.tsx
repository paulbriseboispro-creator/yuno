import type { EmailTheme, EventBlock } from '@/lib/email';
import { EMAIL_FONT, blockPad, emailBtnStyle, liveFor, placeholderLabelStyle, stripesBg, type CanvasCtx } from './common';

export default function EventView({ block, theme, ctx }: { block: EventBlock; theme: EmailTheme; ctx: CanvasCtx }) {
  const pad = blockPad(block);
  const live = liveFor(block, ctx);
  const title = live?.title || block.title;
  const dateLabel = live?.dateLabel || block.dateLabel;
  const venueLabel = live?.venueLabel || block.venueLabel;
  const coverUrl = live?.coverUrl || block.coverUrl;
  return (
    <div style={{ padding: `${pad.py}px ${pad.px}px` }}>
      <div style={{
        border: `1px solid ${theme.divider}`, borderRadius: 12, overflow: 'hidden',
        background: theme.dark ? theme.tile : '#fff',
      }}>
        {block.cover && (coverUrl ? (
          <img src={coverUrl} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
        ) : (
          <div style={{
            height: 150, background: stripesBg(theme, true),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={placeholderLabelStyle(theme)}>
              {block.eventId ? `cover auto — ${title}` : 'cover auto — relie un événement'}
            </span>
          </div>
        ))}
        <div style={{ padding: 20 }}>
          <div style={{
            display: 'inline-block', padding: '3px 8px', borderRadius: 999,
            background: theme.dark ? 'rgba(212,175,55,0.14)' : 'rgba(232,25,44,0.09)',
            color: theme.accent, fontFamily: EMAIL_FONT, fontSize: 10.5, fontWeight: 700,
            letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10,
          }}>Dynamique</div>
          <div style={{ fontFamily: EMAIL_FONT, fontSize: 20, fontWeight: 700, color: theme.text, marginBottom: 8 }}>{title}</div>
          <div style={{ fontFamily: EMAIL_FONT, fontSize: 14, color: theme.muted, marginBottom: 4 }}>{dateLabel}</div>
          {block.venue && (
            <div style={{ fontFamily: EMAIL_FONT, fontSize: 14, color: theme.muted, marginBottom: 4 }}>{venueLabel}</div>
          )}
          {/* Prix : la base fait foi — un événement sans billetterie n'affiche
              rien (l'email fait pareil), le placeholder n'existe que sans événement. */}
          {block.price && (live ? !!live.priceFromLabel : true) && (
            <div style={{ fontFamily: EMAIL_FONT, fontSize: 14, color: theme.muted, marginBottom: 4 }}>
              {live?.priceFromLabel || 'À partir de 18 €'}
            </div>
          )}
          <span style={{ ...emailBtnStyle(theme, { small: true }), marginTop: 14 }}>{block.ctaLabel}</span>
        </div>
      </div>
    </div>
  );
}
