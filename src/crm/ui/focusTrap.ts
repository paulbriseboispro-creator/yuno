/** Prochain élément de la boucle de Tab d'une fenêtre (Maj+Tab = en arrière), dans [0, n). */
export function nextTrapIndex(n: number, current: number, back: boolean): number {
  if (n <= 0) return -1;
  if (current < 0) return back ? n - 1 : 0;
  return back ? (current - 1 + n) % n : (current + 1) % n;
}
