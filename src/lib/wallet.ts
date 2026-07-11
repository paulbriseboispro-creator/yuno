// Apple Wallet côté client — émission d'un pass (billet / table VIP) via le
// routeur /wallet de send-ticket-confirmation, puis présentation :
//  - natif iOS : SafariVC (@capacitor/browser) sur l'URL du pass — le WKWebView
//    n'ouvre PAS les .pkpass ; SFSafariViewController présente la sheet d'ajout.
//    (Phase 3 : le plugin capacitor-pass-to-wallet consommera `base64` pour
//    une présentation in-app sans quitter l'app.)
//  - web (Safari iOS/macOS) : navigation directe — le navigateur gère le MIME
//    application/vnd.apple.pkpass.
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { isNative } from '@/lib/native';

export interface WalletIssueResult {
  base64: string;
  downloadUrl: string;
  serial: string;
}

/**
 * Émet (idempotent) puis ouvre le pass Wallet de l'entité.
 * Throw en cas d'échec — l'appelant gère son toast.
 */
export async function addToWallet(type: 'ticket' | 'table', id: string): Promise<void> {
  const { data, error } = await invokeEdgeFunction('send-ticket-confirmation/wallet/issue', {
    body: { type, id },
  });
  if (error) throw error;
  const result = data as WalletIssueResult | null;
  if (!result?.downloadUrl) throw new Error('no pass url');

  if (isNative()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url: result.downloadUrl });
  } else {
    window.location.assign(result.downloadUrl);
  }
}
