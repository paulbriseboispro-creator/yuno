import { Fragment } from 'react';
import DOMPurify from 'dompurify';
import type { EmailTheme, TextBlock } from '@/lib/email';
import { looksLikeHtml } from '@/lib/email';
import { EMAIL_FONT, blockPad, splitVariables, varChipStyle } from './common';

/**
 * Texte brut avec \n = paragraphe et variables {{…}} surlignées (textEl du
 * prototype). Les corps HTML migrés du v1 restent rendus tels quels.
 */
export default function TextView({ block, theme }: { block: TextBlock; theme: EmailTheme }) {
  const size = Math.max(11, Math.min(28, block.size || 16));
  const pad = blockPad(block);
  const chip = varChipStyle(theme, size);

  if (looksLikeHtml(block.body)) {
    return (
      <div
        style={{
          padding: `${pad.py}px ${pad.px}px`, fontFamily: EMAIL_FONT, fontSize: size,
          lineHeight: 1.6, color: theme.text, textAlign: block.align || 'left', overflowWrap: 'break-word',
        }}
        dangerouslySetInnerHTML={{
          __html: DOMPurify.sanitize(block.body || '', {
            ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'span', 'ul', 'ol', 'li'],
            ALLOWED_ATTR: ['href', 'target', 'rel', 'style'],
          }),
        }}
      />
    );
  }

  const lines = String(block.body || '').split('\n');
  return (
    <div style={{ padding: `${pad.py}px ${pad.px}px`, textAlign: block.align || 'left', fontFamily: EMAIL_FONT }}>
      {lines.map((line, li) => (
        <p key={li} style={{
          margin: li === lines.length - 1 ? 0 : '0 0 10px',
          fontSize: size, lineHeight: 1.6,
          color: li === 0 ? theme.text : (theme.dark ? '#cfcfcf' : theme.text),
          overflowWrap: 'break-word',
        }}>
          {splitVariables(line).map((part, pi) => (
            part.isVar
              ? <span key={pi} style={chip}>{part.token}</span>
              : <Fragment key={pi}>{part.token}</Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}
