import { isNative } from '@/lib/native';

/**
 * Retour haptique — natif via @capacitor/haptics, fallback navigator.vibrate
 * sur le web (Android/desktop ; iOS Safari ignore vibrate, c'est voulu).
 * Toutes les méthodes sont fire-and-forget et ne throwent JAMAIS : un haptic
 * raté ne doit jamais casser un checkout.
 *
 * Aligné sur le système motion (src/lib/motion.ts) :
 *  - selection() ≈ pressFeedback : micro-feedback de choix (ajout panier)
 *  - medium()    ≈ pop           : engagement d'une action (lancer un paiement)
 *  - success()   ≈ celebrate     : confirmation d'achat / QR émis
 *  - error()                     : échec de paiement / action refusée
 */

function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Certains navigateurs jettent sur vibrate() sans geste utilisateur.
  }
}

async function native(run: (h: typeof import('@capacitor/haptics')) => Promise<void>): Promise<void> {
  try {
    await run(await import('@capacitor/haptics'));
  } catch {
    // Device sans moteur haptique ou plugin indisponible : silencieux.
  }
}

export const haptics = {
  light(): void {
    if (isNative()) void native(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light }));
    else vibrate(10);
  },
  medium(): void {
    if (isNative()) void native(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Medium }));
    else vibrate(20);
  },
  success(): void {
    if (isNative()) void native(({ Haptics, NotificationType }) => Haptics.notification({ type: NotificationType.Success }));
    else vibrate([15, 60, 25]);
  },
  error(): void {
    if (isNative()) void native(({ Haptics, NotificationType }) => Haptics.notification({ type: NotificationType.Error }));
    else vibrate([40, 60, 40]);
  },
  selection(): void {
    if (isNative()) void native(({ Haptics }) => Haptics.selectionStart().then(() => Haptics.selectionEnd()));
    else vibrate(8);
  },
};
