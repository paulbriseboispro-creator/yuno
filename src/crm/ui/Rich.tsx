/**
 * Texte traduit avec du gras : seules les balises `<b>…</b>` sont lues, tout
 * le reste reste du texte (aucun HTML injecté, même si un nom de soirée en
 * contient).
 */
import { Fragment } from 'react';

export function Rich({ text, boldWeight = 600 }: { text: string; boldWeight?: number }) {
  const parts = text.split(/(<b>.*?<\/b>)/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^<b>(.*)<\/b>$/.exec(p);
        return m
          ? <b key={i} style={{ fontWeight: boldWeight }}>{m[1]}</b>
          : <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}
