// Scanner de QR de l'app — TOUS les écrans qui lisent un QR l'importent d'ici,
// jamais directement de `@yudiel/react-qr-scanner`.
//
// Pourquoi : la bibliothèque décode avec zxing-wasm (barcode-detector la prend
// TOUJOURS, même quand le navigateur a un BarcodeDetector natif), et zxing-wasm
// va chercher son fichier `.wasm` (0,9 Mo) sur fastly.jsdelivr.net au premier
// scan. Deux pannes en découlaient (constatées le 26/10, avant la première
// soirée payante) :
//  - sur yunoapp.eu, la CSP (connect-src, et script-src sans 'wasm-unsafe-eval')
//    bloquait le fichier : la caméra s'allumait mais ne lisait AUCUN QR ;
//  - dans Yuno Pro, le décodeur dépendait d'un CDN tiers et du réseau : un
//    téléphone qui ouvre le scanner sans réseau ne décodait rien, mode hors
//    ligne compris.
// Le fichier est donc livré AVEC l'app (même version que le JS, résolue par
// Vite), servi depuis notre origine : web, PWA et bundle OTA natif.

import { setZXingModuleOverrides } from '@yudiel/react-qr-scanner';
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

setZXingModuleOverrides({
  locateFile: (path: string, prefix: string) =>
    path.endsWith('.wasm') ? zxingReaderWasmUrl : prefix + path,
});

export { Scanner } from '@yudiel/react-qr-scanner';
