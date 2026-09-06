import { useEffect, useRef, useState } from 'react';

/**
 * Dévoile un texte qui arrive en streaming, caractère par caractère.
 *
 * Le flux SSE arrive par paquets : sans ça, la réponse apparaît par blocs
 * saccadés. On tient donc un curseur de lecture qui avance à chaque frame, plus
 * vite quand il a du retard — le texte se pose au rythme d'une écriture, sans
 * jamais prendre du retard sur le modèle.
 *
 * Un jeton de carte (`[[event:<uuid>]]`) est franchi d'un bloc : ses ~40
 * caractères sont invisibles à l'écran, les dévoiler un par un ferait un temps
 * mort avant l'apparition de la carte.
 */

const TOKEN_AT = /^\[\[\s*event\s*:[^\]]*\]\]/i;

/** Avance de `steps` caractères VISIBLES, en sautant les jetons d'un bloc. */
function advance(text: string, from: number, steps: number): number {
  let i = from;
  let left = steps;
  while (left > 0 && i < text.length) {
    const token = TOKEN_AT.exec(text.slice(i));
    if (token) {
      i += token[0].length;
      left -= 1;
      continue;
    }
    i += 1;
    left -= 1;
  }
  return i;
}

/**
 * Position suivante du curseur, une image plus tard. Rattrapage proportionnel :
 * le retard se résorbe tout seul, donc la fin d'une longue réponse ne traîne
 * jamais derrière le flux.
 *
 * Exporté parce que c'est la règle de vitesse : elle se teste, elle ne se
 * réécrit pas dans un test.
 */
export const __advanceForTest = advance;

export function nextCursor(text: string, cursor: number): number {
  const remaining = text.length - cursor;
  if (remaining <= 0) return cursor;
  return advance(text, cursor, Math.max(1, Math.ceil(remaining / 22)));
}

export function useRevealedText(full: string, animate: boolean): { text: string; done: boolean } {
  const [count, setCount] = useState(animate ? 0 : full.length);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (!animate) {
      setCount(full.length);
      return;
    }
    // Le texte a été remplacé (nouvelle réponse) : on repart du début.
    setCount((c) => (c > full.length ? 0 : c));
  }, [full, animate]);

  useEffect(() => {
    if (!animate) return;
    if (count >= full.length) return;

    const tick = () => {
      setCount((c) => nextCursor(full, c));
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [full, count, animate]);

  return { text: animate ? full.slice(0, count) : full, done: count >= full.length };
}
