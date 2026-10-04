/** Dessin commun des cartes de l'écran Analyse (carte 28 px, titre, sous-titre). */
import type { CSSProperties } from 'react';

export const box: CSSProperties = {
  display: 'flex', flexDirection: 'column', minWidth: 0, padding: 'clamp(20px,2.4vw,28px)', borderRadius: 28,
  background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)',
};
export const h2: CSSProperties = { margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' };
export const subCss: CSSProperties = { fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2, textWrap: 'pretty' } as CSSProperties;
