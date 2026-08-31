import type { EmailTheme, HtmlBlock } from '@/lib/email';
import { blockPad } from './common';

/**
 * Le code est montré TEL QUEL dans un cadre mono (htmlBox du prototype) —
 * l'exécution n'existe que dans l'email envoyé et l'aperçu iframe.
 */
export default function HtmlView({ block, theme }: { block: HtmlBlock; theme: EmailTheme }) {
  const pad = blockPad(block);
  return (
    <div style={{ padding: `${pad.py}px ${pad.px}px` }}>
      <div style={{
        fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 12, color: theme.muted,
        background: theme.tile, border: `1px dashed ${theme.divider}`, borderRadius: 10,
        padding: 14, whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
      }}>{block.code}</div>
    </div>
  );
}
