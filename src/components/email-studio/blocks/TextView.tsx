import DOMPurify from 'dompurify';
import type { EmailTheme, TextBlock } from '@/lib/email';
import { escapeHtml, inlineMarkup, looksLikeHtml, textLook } from '@/lib/email';
import { EMAIL_FONT, EMAIL_MONO, blockBgColor, blockPad, varChipStyle } from './common';

/**
 * Texte brut avec \n = paragraphe, mini-markup inline (**gras**, *italique*,
 * ~~barré~~, __souligné__, [c=…], [s=…], [url=…]) et variables {{…}}
 * surlignées. Les corps HTML migrés du v1 restent rendus tels quels.
 */
export default function TextView({ block, theme }: { block: TextBlock; theme: EmailTheme }) {
  // Miroir de renderText : même apparence par style (titre, sur-titre, corps),
  // et le fond du bloc décide de l'encre par défaut.
  const look = textLook(block, theme, blockBgColor(block, theme));
  const size = look.size;
  const pad = blockPad(block);
  const chip = varChipStyle(theme, size);
  const baseColor = look.color;
  const lookStyle = {
    fontFamily: look.mono ? EMAIL_MONO : EMAIL_FONT,
    fontWeight: look.weight ?? undefined,
    letterSpacing: look.letterSpacing ?? undefined,
    textTransform: look.uppercase ? ('uppercase' as const) : undefined,
  };

  if (looksLikeHtml(block.body)) {
    return (
      <div
        style={{
          padding: `${pad.py}px ${pad.px}px`, ...lookStyle, fontSize: size,
          lineHeight: look.lineHeight, color: baseColor, textAlign: block.align || 'left', overflowWrap: 'break-word',
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
      return `<p style="margin:${li === lines.length - 1 ? '0' : `0 0 ${look.gap}px`};font-size:${size}px;line-height:${look.lineHeight};overflow-wrap:break-word;">${withChips}</p>`;
    })
    .join('');

  return (
    <div
      style={{
        padding: `${pad.py}px ${pad.px}px`, textAlign: block.align || 'left',
        ...lookStyle, color: baseColor,
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
