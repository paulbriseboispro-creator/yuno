// Scanner de QR de l'app — TOUS les écrans qui lisent un QR l'importent d'ici.
//
// Écrit chez nous le 27/10, à la place de la boucle de `@yudiel/react-qr-scanner`,
// après le premier essai réel à la porte (Yuno Pro, iPhone) :
//  - la boucle de la bibliothèque redémarrait à CHAQUE rendu de l'écran qui
//    l'affiche (sa fonction `onScan` change à chaque rendu) et oubliait alors
//    les codes déjà lus : le billet encore sous la caméra se relisait et
//    bipait en fond pendant que la carte verte s'affichait ;
//  - elle ne signalait jamais deux fois de suite le même code, même sorti puis
//    remis devant : un QR re-présenté ne donnait rien (pas de « déjà scanné ») ;
//  - elle ne décodait qu'une image toutes les 0,5 s, en 1280 × 720 sur le fil
//    principal : lecture lente et caméra qui saccade.
//
// Ici : le flux caméra ne dépend que des contraintes (jamais d'un rendu), une
// seule lecture à la fois sur une image réduite (≤ 800 px), toutes les ~100 ms,
// et la règle de présence de `QrPresence` décide quand un code est signalé.
// `onScan` rend `false` quand l'écran ne peut pas prendre le code (un scan est
// déjà en cours) : rien n'est retenu, pas de bip, le code est reproposé.
//
// Le décodeur reste zxing (WebAssembly), son fichier `.wasm` livré AVEC l'app
// (`?url`) : la CSP de yunoapp.eu bloquait celui de jsdelivr (26/10), et Yuno Pro
// doit décoder sans réseau.

import { useEffect, useRef, type CSSProperties } from 'react';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { QrPresence } from '@/lib/scan/qrPresence';

prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) =>
      path.endsWith('.wasm') ? zxingReaderWasmUrl : prefix + path,
  },
});

/** Côté le plus long de l'image décodée : assez pour un QR tenu devant, léger à décoder. */
const MAX_DECODE_SIDE = 800;
/** Pause entre deux lectures (la lecture elle-même prend 10-40 ms sur un téléphone). */
const DECODE_INTERVAL_MS = 90;

export interface ScannedCode {
  rawValue: string;
}

export interface ScannerProps {
  /**
   * Un code vient d'apparaître devant la caméra. Rendre `false` = l'écran ne le
   * prend pas maintenant (il sera reproposé, sans bip). Toute autre valeur
   * (rien, une promesse…) = pris : plus signalé tant qu'il reste devant.
   */
  onScan: (codes: ScannedCode[]) => unknown;
  onError?: (error: unknown) => void;
  constraints?: MediaTrackConstraints;
  /** Bip à chaque code pris (défaut : oui). */
  sound?: boolean;
  /** Suspend la lecture sans couper la caméra. */
  paused?: boolean;
  styles?: { container?: CSSProperties; video?: CSSProperties };
  /** `torch` / `tracker` : options de l'ancienne bibliothèque, sans effet ici. */
  components?: { finder?: boolean; torch?: boolean; tracker?: unknown };
  /** Gardés pour la compatibilité des écrans : QR seulement, cadence fixe. */
  formats?: string[];
  scanDelay?: number;
  allowMultiple?: boolean;
}

// Bip court (880 Hz, 90 ms) en WAV fabriqué une fois : `media-src data:` est
// autorisé par la CSP, aucun fichier ni service tiers.
let beepUrl: string | null = null;
function beepDataUrl(): string {
  if (beepUrl) return beepUrl;
  const rate = 8000;
  const n = Math.round(rate * 0.09);
  const bytes = new Uint8Array(44 + n);
  const view = new DataView(bytes.buffer);
  const ascii = (o: number, s: string) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + n, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
  ascii(36, 'data'); view.setUint32(40, n, true);
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / 40, (n - i) / 40);
    bytes[44 + i] = 128 + Math.round(90 * fade * Math.sin((2 * Math.PI * 880 * i) / rate));
  }
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  beepUrl = `data:audio/wav;base64,${btoa(bin)}`;
  return beepUrl;
}

export function Scanner({
  onScan,
  onError,
  constraints,
  sound = true,
  paused = false,
  styles,
  components,
}: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  const onErrorRef = useRef(onError);
  const soundRef = useRef(sound);
  const pausedRef = useRef(paused);
  onScanRef.current = onScan;
  onErrorRef.current = onError;
  soundRef.current = sound;
  pausedRef.current = paused;

  // Le flux ne redémarre QUE si les contraintes changent vraiment.
  const constraintsKey = JSON.stringify({ facingMode: 'environment', ...(constraints ?? {}) });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const presence = new QrPresence();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const audio = typeof Audio !== 'undefined' ? new Audio(beepDataUrl()) : null;

    const schedule = () => {
      if (!cancelled) timer = setTimeout(tick, DECODE_INTERVAL_MS);
    };

    const tick = async () => {
      if (cancelled) return;
      if (pausedRef.current || document.hidden || !ctx || video.readyState < 2 || !video.videoWidth) {
        schedule();
        return;
      }
      try {
        const scale = Math.min(1, MAX_DECODE_SIDE / Math.max(video.videoWidth, video.videoHeight));
        const w = Math.max(1, Math.round(video.videoWidth * scale));
        const h = Math.max(1, Math.round(video.videoHeight * scale));
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        ctx.drawImage(video, 0, 0, w, h);
        const results = await readBarcodes(ctx.getImageData(0, 0, w, h), {
          formats: ['QRCode'],
          tryHarder: true,
          maxNumberOfSymbols: 4,
        });
        if (cancelled) return;
        const codes = results.filter((r) => r.isValid && r.text).map((r) => r.text);
        const now = performance.now();
        const fresh = presence.fresh(codes, now);
        if (fresh.length > 0 && !pausedRef.current) {
          const code = fresh[0];
          const taken = onScanRef.current([{ rawValue: code }]);
          if (taken !== false) {
            presence.accept(code, now);
            if (soundRef.current && audio) {
              audio.currentTime = 0;
              audio.play().catch(() => { /* son bloqué : la carte et la vibration suffisent */ });
            }
          }
        }
      } catch {
        // Une image illisible ou un décodeur pas encore chargé : on réessaie.
      }
      schedule();
    };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw Object.assign(new Error('no camera'), { name: 'NotFoundError' });
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: JSON.parse(constraintsKey) as MediaTrackConstraints,
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        video.srcObject = stream;
        await video.play().catch(() => { /* autoplay muet : l'image arrive quand même */ });
        schedule();
      } catch (error) {
        if (!cancelled) onErrorRef.current?.(error);
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
      video.srcObject = null;
    };
  }, [constraintsKey]);

  return (
    <div style={{ position: 'relative', overflow: 'hidden', width: '100%', ...styles?.container }}>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', ...styles?.video }}
      />
      {components?.finder && (
        <div
          aria-hidden
          style={{
            position: 'absolute', left: '20%', top: '20%', width: '60%', height: '60%',
            border: '2px solid rgba(255,255,255,0.85)', borderRadius: 16, pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
