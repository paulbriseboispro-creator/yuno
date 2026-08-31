import { Fragment } from 'react';
import type { EmailTheme, TableBlock } from '@/lib/email';
import { EMAIL_FONT, blockPad, emailBtnStyle, splitVariables, varChipStyle, type CanvasCtx } from './common';

export default function TableView({ block, theme, ctx }: { block: TableBlock; theme: EmailTheme; ctx: CanvasCtx }) {
  const pad = blockPad(block);
  const live = block.eventId ? ctx.live[block.eventId] : undefined;
  const left = live?.tablesLeft;
  const chip = varChipStyle(theme, 14);
  const withVars = (text: string) => splitVariables(text).map((part, pi) => (
    part.isVar ? <span key={pi} style={chip}>{part.token}</span> : <Fragment key={pi}>{part.token}</Fragment>
  ));
  return (
    <div style={{ padding: `${pad.py}px ${pad.px}px` }}>
      <div style={{
        border: `1px solid ${theme.dark ? 'rgba(212,175,55,0.28)' : theme.divider}`,
        borderRadius: 12, padding: 18,
        background: theme.dark ? 'linear-gradient(135deg,rgba(212,175,55,0.10),rgba(212,175,55,0.02))' : theme.tile,
      }}>
        <div style={{
          fontFamily: EMAIL_FONT, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase',
          color: theme.accent, marginBottom: 8,
        }}>{block.kicker || 'Bottle service'}</div>
        <div style={{ fontFamily: EMAIL_FONT, fontSize: 17, fontWeight: 600, color: theme.text, marginBottom: 6 }}>
          {withVars(block.title)}
        </div>
        <div style={{ fontFamily: EMAIL_FONT, fontSize: 13.5, color: theme.muted, lineHeight: 1.6 }}>
          {withVars(block.sub)}
        </div>
        {typeof left === 'number' && (
          <div style={{ fontFamily: EMAIL_FONT, fontSize: 12.5, fontWeight: 700, color: theme.accent, marginTop: 10 }}>
            {left <= 0 ? 'Complet ce soir' : `${left} table${left > 1 ? 's' : ''} encore libre${left > 1 ? 's' : ''}`}
          </div>
        )}
        <div style={{ marginTop: 14 }}>
          <span style={emailBtnStyle(theme, { small: true })}>{block.ctaLabel}</span>
        </div>
      </div>
    </div>
  );
}
