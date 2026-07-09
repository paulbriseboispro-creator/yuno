// ════════════════════════════════════════════════════════════════════
// Yuno — signal « app prête »
// ────────────────────────────────────────────────────────────────────
// Point de synchronisation entre l'écran de lancement animé (SplashScreen)
// et la première surface utile de l'app. La page d'accueil (Explore, en
// général) appelle markAppReady() dès que son contenu est monté ; le splash
// écoute onAppReady() pour lancer sa sortie (soulèvement) une fois l'intro
// jouée. Idempotent : seul le premier appel compte.
// ════════════════════════════════════════════════════════════════════

let ready = false;
const listeners = new Set<() => void>();

/** Émet « app prête ». Idempotent — les appels suivants sont ignorés. */
export function markAppReady(): void {
  if (ready) return;
  ready = true;
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // un écouteur qui jette ne doit pas bloquer les autres
    }
  }
  listeners.clear();
}

/**
 * S'abonne au signal « app prête ». Si déjà prêt, `cb` est appelé
 * de façon synchrone. Renvoie une fonction de désabonnement.
 */
export function onAppReady(cb: () => void): () => void {
  if (ready) {
    cb();
    return () => {};
  }
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** État courant du signal (utile pour un rendu conditionnel ponctuel). */
export function isAppReady(): boolean {
  return ready;
}
