import DOMPurify from 'dompurify';
import type { EmailTheme, TextBlock } from '@/lib/email';
import { escapeHtml, inlineMarkup, looksLikeHtml } from '@/lib/email';
import { EMAIL_FONT, blockPad, varChipStyle } from './common';

/**
 * Texte brut avec \n = paragraphe, mini-markup inline (**gras**, *italique*,
 * ~~barré~~, __souligné__, [c=…], [s=…], [url=…]) et variables {{…}}
 * surlignées. Les corps HTML migrés du v1 restent rendus tels quels.
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

  // Même moteur de markup que l'email final, puis surlignage des {{variables}}.
  const chipStyle = `background:${chip.background};color:${chip.color};padding:1px 6px;border-radius:5px;font-family:ui-monospace,Menlo,monospace;font-size:${size - 2}px;`;
  const lines = String(block.body || '').split('\n');
  const html = lines
    .map((line, li) => {
      const withMarkup = inlineMarkup(escapeHtml(line), { accent: theme.accent });
      const withChips = withMarkup.replace(
        /\{\{[^}]+\}\}/g,
        (m) => `<span style="${chipStyle}">${m}</span>`,
      );
      return `<p style="margin:${li === lines.length - 1 ? '0' : '0 0 10px'};font-size:${size}px;line-height:1.6;overflow-wrap:break-word;">${withChips}</p>`;
    })
    .join('');

  return (
    <div
      style={{
        padding: `${pad.py}px ${pad.px}px`, textAlign: block.align || 'left',
        fontFamily: EMAIL_FONT, color: theme.text,
      }}
      dangerouslySetInnerHTML={{
        __html: DOMPurify.sanitize(html, {
          ALLOWED_TAGS: ['p', 'strong', 'em', 'a', 'span'],
          ALLOWED_ATTR: ['href', 'target', 'rel', 'style'],
        }),
      }}
    />
  );
}
