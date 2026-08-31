import type { CountdownBlock, EmailTheme } from '@/lib/email';
import { formatCountdown } from '@/lib/email';
import { EMAIL_FONT, type CanvasCtx } from './common';

export default function CountdownView({ block, theme, ctx }: { block: CountdownBlock; theme: EmailTheme; ctx: CanvasCtx }) {
  const live = block.eventId ? ctx.live[block.eventId] : undefined;
  const value = live?.startAt ? formatCountdown(live.startAt, new Date()) : null;
  return (
    <div style={{ padding: '22px 24px', textAlign: 'center' }}>
      <p style={{
        margin: '0 0 6px', fontFamily: EMAIL_FONT, fontSize: 11, fontWeight: 700,
        letterSpacing: '.08em', textTransform: 'uppercase', color: theme.muted,
      }}>{block.label}</p>
      <p style={{
        margin: 0, fontFamily: EMAIL_FONT, fontSize: 34, lineHeight: '40px',
        fontWeight: 800, color: theme.accent,
      }}>{value || 'J-?'}</p>
      {!value && (
        <p style={{ margin: '6px 0 0', fontFamily: EMAIL_FONT, fontSize: 11, color: theme.muted }}>
          Relie un événement pour calculer le compte à rebours à l’envoi
        </p>
      )}
    </div>
  );
}
