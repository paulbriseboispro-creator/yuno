// Apple Wallet côté client — émission d'un pass (billet / table VIP) via le
// routeur /wallet de send-ticket-confirmation, puis présentation :
//  - natif iOS : sheet d'ajout IN-APP (PKAddPassesViewController via le plugin
//    Swift MAISON « WalletSheet » — le projet est 100 % SPM, les plugins
//    wallet communautaires n'existent qu'en CocoaPods). Sur un build qui ne
//    l'embarque pas encore, l'appel échoue → repli SafariVC sur l'URL du
//    pass — le WKWebView, lui, n'ouvre PAS les .pkpass.
//  - web (Safari iOS/macOS) : navigation directe — le navigateur gère le MIME
//    application/vnd.apple.pkpass.
import { registerPlugin } from '@capacitor/core';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { isNative } from '@/lib/native';

interface WalletSheetPlugin {
  addPass(options: { base64: string }): Promise<void>;
}
const WalletSheet = registerPlugin<WalletSheetPlugin>('WalletSheet');

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
    if (result.base64) {
      try {
        await WalletSheet.addPass({ base64: result.base64 });
        return;
      } catch {
        // Plugin absent du build (pré-Phase 3) ou refus : repli SafariVC.
      }
    }
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url: result.downloadUrl });
  } else {
    window.location.assign(result.downloadUrl);
  }
}
