import { Fragment } from 'react';
import type { CtaBlock, EmailTheme } from '@/lib/email';
import { blockPad, emailBtnStyle, splitVariables, varChipStyle } from './common';

export default function CtaView({ block, theme }: { block: CtaBlock; theme: EmailTheme }) {
  const pad = blockPad(block);
  const chip = varChipStyle(theme, 16);
  return (
    <div style={{ padding: `${pad.py}px ${pad.px}px`, textAlign: block.align || 'center' }}>
      <span style={emailBtnStyle(theme, { radius: block.radius, full: block.full })}>
        {splitVariables(block.label).map((part, pi) => (
          part.isVar ? <span key={pi} style={chip}>{part.token}</span> : <Fragment key={pi}>{part.token}</Fragment>
        ))}
      </span>
    </div>
  );
}
