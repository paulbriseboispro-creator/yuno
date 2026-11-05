import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Check, Loader2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  clampCrop, drawRect, DEFAULT_CROP, GALLERY_ASPECT, GALLERY_OUT_H, GALLERY_OUT_W,
  GALLERY_ZOOM_MAX, GALLERY_ZOOM_MIN, type CropState,
} from '@/lib/galleryCrop';

interface Props {
  open: boolean;
  /** Fichier choisi (nouvelle photo) ou URL de l'image d'origine (reprise du cadre). */
  source: File | string | null;
  /** Cadre de départ (reprise d'une photo déjà cadrée). */
  initial?: CropState | null;
  /** Position dans la file d'ajout : « Photo 2 sur 4 ». */
  step?: { index: number; total: number } | null;
  /** L'envoi de la photo validée est en cours. */
  busy?: boolean;
  onConfirm: (file: File, crop: CropState) => void;
  /** Passer cette photo (file de plusieurs photos seulement). */
  onSkip?: () => void;
  onCancel: () => void;
}

/**
 * Cadrage d'une photo de galerie en 4:3 : l'image remplit toujours le cadre
 * (jamais de bande blanche), on la déplace au doigt ou à la souris, on zoome au
 * curseur, à la molette ou en pinçant. Le cadre rendu est indépendant de la
 * taille d'écran, ce qui permet de le rouvrir plus tard (src/lib/galleryCrop.ts).
 */
export function GalleryCropDialog({ open, source, initial, step, busy, onConfirm, onSkip, onCancel }: Props) {
  const { t } = useLanguage();
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [crop, setCrop] = useState<CropState>(DEFAULT_CROP);
  const [loadError, setLoadError] = useState(false);
  const [frameW, setFrameW] = useState(360);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const frameH = frameW / GALLERY_ASPECT;

  // Taille du cadre : la plus grande qui tienne dans la fenêtre (téléphone compris).
  useEffect(() => {
    if (!open) return;
    const fit = () => setFrameW(Math.max(240, Math.min(440, window.innerWidth - 72)));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [open]);

  // Charger l'image. Une URL passe par fetch → blob : le canvas ne serait pas
  // exportable avec une image d'une autre origine.
  useEffect(() => {
    setNat(null);
    setLoadError(false);
    setImgUrl(null);
    if (!open || !source) return;
    let revoke: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const blob = typeof source === 'string'
          ? await fetch(source, { mode: 'cors', cache: 'no-store' }).then((r) => {
            if (!r.ok) throw new Error(String(r.status));
            return r.blob();
          })
          : source;
        if (cancelled) return;
        revoke = URL.createObjectURL(blob);
        setImgUrl(revoke);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [open, source]);

  const onLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const el = e.currentTarget;
    imgRef.current = el;
    const n = { w: el.naturalWidth, h: el.naturalHeight };
    setNat(n);
    setCrop(clampCrop(initial ?? DEFAULT_CROP, n.w, n.h));
  };

  const update = useCallback((next: CropState) => {
    if (!nat) return;
    setCrop(clampCrop(next, nat.w, nat.h));
  }, [nat]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!nat) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: crop.zoom };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      update({ ...crop, zoom: pinch.current.zoom * (dist / pinch.current.dist) });
      return;
    }
    update({ ...crop, x: crop.x + (e.clientX - prev.x) / frameW, y: crop.y + (e.clientY - prev.y) / frameH });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!nat) return;
    update({ ...crop, zoom: crop.zoom * Math.exp(-e.deltaY * 0.0015) });
  };

  const confirm = () => {
    const img = imgRef.current;
    if (!img || !nat) return;
    const canvas = document.createElement('canvas');
    canvas.width = GALLERY_OUT_W;
    canvas.height = GALLERY_OUT_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingQuality = 'high';
    const r = drawRect(crop, nat.w, nat.h);
    ctx.drawImage(img, r.dx, r.dy, r.dw, r.dh);
    canvas.toBlob((blob) => {
      if (!blob) return;
      onConfirm(new File([blob], `gallery-${Date.now()}.jpg`, { type: 'image/jpeg' }), crop);
    }, 'image/jpeg', 0.88);
  };

  const preview = nat ? drawRect(crop, nat.w, nat.h, frameW, frameH) : null;
  const multi = !!step && step.total > 1;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onCancel(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('gallery.cropTitle')}</DialogTitle>
          <DialogDescription>
            {multi
              ? t('gallery.cropStep').replace('{n}', String(step!.index + 1)).replace('{total}', String(step!.total))
              : t('gallery.cropHelp')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          <div
            className="relative cursor-move touch-none select-none overflow-hidden rounded-lg bg-black"
            style={{ width: frameW, height: frameH }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          >
            {imgUrl && (
              <img
                src={imgUrl}
                alt=""
                draggable={false}
                onLoad={onLoad}
                onError={() => setLoadError(true)}
                className="pointer-events-none absolute"
                style={preview
                  ? { left: preview.dx, top: preview.dy, width: preview.dw, height: preview.dh, maxWidth: 'none' }
                  : { opacity: 0 }}
              />
            )}
            {!nat && !loadError && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-snow" />
              </div>
            )}
            {loadError && (
              <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-snow">
                {t('gallery.cropLoadError')}
              </div>
            )}
            {/* Repères des tiers, comme un viseur */}
            <div className="pointer-events-none absolute inset-0" style={{ boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.45)' }} />
            <div className="pointer-events-none absolute inset-y-0 left-1/3 w-px" style={{ background: 'rgba(255,255,255,0.18)' }} />
            <div className="pointer-events-none absolute inset-y-0 left-2/3 w-px" style={{ background: 'rgba(255,255,255,0.18)' }} />
            <div className="pointer-events-none absolute inset-x-0 top-1/3 h-px" style={{ background: 'rgba(255,255,255,0.18)' }} />
            <div className="pointer-events-none absolute inset-x-0 top-2/3 h-px" style={{ background: 'rgba(255,255,255,0.18)' }} />
          </div>

          {multi && <p className="-mt-1 text-xs text-muted-foreground">{t('gallery.cropHelp')}</p>}

          <div className="flex w-full items-center gap-3 px-2">
            <ZoomOut className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <Slider
              value={[crop.zoom]}
              onValueChange={([v]) => update({ ...crop, zoom: v })}
              min={GALLERY_ZOOM_MIN}
              max={GALLERY_ZOOM_MAX}
              step={0.01}
              disabled={!nat}
              className="flex-1"
              aria-label={t('gallery.cropZoom')}
            />
            <ZoomIn className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          </div>

          <Button variant="ghost" size="sm" className="text-xs" disabled={!nat} onClick={() => update(DEFAULT_CROP)}>
            <RotateCcw className="mr-1 h-3 w-3" />
            {t('gallery.cropReset')}
          </Button>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {multi && onSkip ? (
            <Button variant="outline" onClick={onSkip} disabled={busy}>{t('gallery.cropSkip')}</Button>
          ) : (
            <Button variant="outline" onClick={onCancel} disabled={busy}>{t('gallery.cropCancel')}</Button>
          )}
          <Button onClick={confirm} disabled={!nat || busy}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
            {multi && step!.index + 1 < step!.total ? t('gallery.cropConfirmNext') : t('gallery.cropConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
