import DOMPurify from 'dompurify';
import type { EmailTheme, HtmlBlock } from '@/lib/email';

/**
 * Aperçu du bloc HTML brut. Purifié pour le CANVAS uniquement (pas de script
 * dans l'éditeur) — l'email final envoie le code tel quel, comme le v1.
 */
export default function HtmlView({ block }: { block: HtmlBlock; theme: EmailTheme }) {
  return (
    <div
      style={{ padding: '0 24px', overflowWrap: 'break-word' }}
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(block.code || '') }}
    />
  );
}
