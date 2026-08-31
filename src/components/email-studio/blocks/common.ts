import DOMPurify from 'dompurify';
import type { CSSProperties } from 'react';
import type { EmailTheme, LiveData, SocialLinks } from '@/lib/email';

/** Contexte de rendu du canvas (aperçu d'édition, PAS l'email final). */
export interface CanvasCtx {
  venueName: string;
  socialLinks: SocialLinks;
  live: LiveData;
  baseUrl: string;
}

export const EMAIL_FONT = "Arial,'Helvetica Neue',Helvetica,sans-serif";

/**
 * HTML de bloc texte, purifié + variables {{…}} surlignées en monospace.
 * Le canvas montre la variable telle quelle (l'interpolation n'existe qu'à
 * l'envoi) — le surlignage la rend repérable d'un coup d'œil.
 */
export function canvasHtml(raw: string, accent: string): string {
  const clean = DOMPurify.sanitize(raw || '', {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'span', 'ul', 'ol', 'li'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'style'],
  });
  return clean.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_m, key: string) =>
    `<code style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85em;background:${accent}1f;color:${accent};border-radius:4px;padding:0 4px;">{{${key}}}</code>`);
}

/** Texte brut avec variables surlignées (titres, sous-titres). */
export function canvasText(raw: string, accent: string): string {
  const esc = String(raw || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_m, key: string) =>
    `<code style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85em;background:${accent}1f;color:${accent};border-radius:4px;padding:0 4px;">{{${key}}}</code>`);
}

export function emailBtnStyle(theme: EmailTheme, opts: { radius?: number; full?: boolean; small?: boolean } = {}): CSSProperties {
  return {
    display: opts.full ? 'block' : 'inline-block',
    background: theme.accent,
    color: theme.btnText,
    fontFamily: EMAIL_FONT,
    fontWeight: 700,
    fontSize: opts.small ? 14 : 15,
    lineHeight: `${opts.small ? 40 : 46}px`,
    padding: `0 ${opts.small ? 20 : 32}px`,
    borderRadius: opts.radius ?? 8,
    textAlign: 'center',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };
}
