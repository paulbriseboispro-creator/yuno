import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Check, Loader2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { makeDjT } from '@/i18n/djTranslate';
import {
  clampCrop, drawRect, DEFAULT_CROP, GALLERY_ZOOM_MAX, GALLERY_ZOOM_MIN, type CropState,
} from '@/lib/galleryCrop';

/** Une photo d'artiste est carrée et s'affiche toujours dans un rond. */
export const GUEST_ARTIST_PHOTO_PX = 640;

interface Props {
  open: boolean;
  /** Fichier qui vient d'être choisi, ou URL de la photo déjà enregistrée. */
  source: File | string | null;
  /** L'envoi de la photo recadrée est en cours. */
  busy?: boolean;
  /** Le navigateur n'a pas su lire l'image (HEIC dans Chrome, fichier abîmé). */
  onUnreadable?: () => void;
  onConfirm: (file: File) => void;
  onCancel: () => void;
}

/**
 * Cadrage de la photo d'un artiste invité : on déplace l'image dans le rond au
 * doigt ou à la souris, on zoome au curseur, à la molette ou en pinçant.
 * L'image remplit toujours le cadre (jamais de bande vide) ; le fichier produit
 * est un carré de 640 px, ce qui évite d'envoyer une photo de 12 Mo pour une
 * pastille de 108 pt. Les règles de cadrage sont celles de `galleryCrop.ts`
 * (rapport 1:1).
 */
export function GuestArtistPhotoCropDialog({ open, source, busy, onUnreadable, onConfirm, onCancel }: Props) {
  const { language } = useLanguage();
  const tt = makeDjT(language);

  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [crop, setCrop] = useState<CropState>(DEFAULT_CROP);
  const [loadError, setLoadError] = useState(false);
  const [frame, setFrame] = useState(320);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  // Le plus grand carré qui tienne dans la fenêtre, téléphone compris.
  useEffect(() => {
    if (!open) return;
    const fit = () => setFrame(Math.max(220, Math.min(340, window.innerWidth - 96)));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [open]);

  // Une URL passe par fetch → blob : un canvas ne s'exporte pas avec une image
  // d'une autre origine, et le stockage répond en CORS ouvert.
  useEffect(() => {
    setNat(null);
    setLoadError(false);
    setImgUrl(null);
    setCrop(DEFAULT_CROP);
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
    setCrop(clampCrop(DEFAULT_CROP, n.w, n.h, 1));
  };

  const onError = () => {
    setLoadError(true);
    onUnreadable?.();
  };

  const update = useCallback((next: CropState) => {
    if (!nat) return;
    setCrop(clampCrop(next, nat.w, nat.h, 1));
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
    update({ ...crop, x: crop.x + (e.clientX - prev.x) / frame, y: crop.y + (e.clientY - prev.y) / frame });
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
    canvas.width = GUEST_ARTIST_PHOTO_PX;
    canvas.height = GUEST_ARTIST_PHOTO_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Fond uni : un PNG à fond transparent donnerait un trou noir en JPEG.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, GUEST_ARTIST_PHOTO_PX, GUEST_ARTIST_PHOTO_PX);
    ctx.imageSmoothingQuality = 'high';
    const r = drawRect(crop, nat.w, nat.h, GUEST_ARTIST_PHOTO_PX, GUEST_ARTIST_PHOTO_PX);
    ctx.drawImage(img, r.dx, r.dy, r.dw, r.dh);
    canvas.toBlob((blob) => {
      if (!blob) return;
      onConfirm(new File([blob], `guest-artist-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.88);
  };

  const preview = nat ? drawRect(crop, nat.w, nat.h, frame, frame) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{tt('Cadrer la photo', 'Frame the photo', 'Encuadrar la foto')}</DialogTitle>
          <DialogDescription>
            {tt(
              'Glisse l’image pour la placer, zoome avec le curseur. Seul le rond sera visible sur l’affiche.',
              'Drag the image to place it and zoom with the slider. Only the circle shows on the line-up.',
              'Arrastra la imagen para colocarla y haz zoom con el control. Solo el círculo se verá en el cartel.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          <div
            className="relative cursor-move touch-none select-none overflow-hidden rounded-lg bg-black"
            style={{ width: frame, height: frame }}
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
                onError={onError}
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
                {tt('Impossible de lire cette image.', 'This image cannot be read.', 'No se puede leer esta imagen.')}
              </div>
            )}
            {/* Le rond : ce qui reste visible une fois la photo posée. */}
            {nat && (
              <>
                <div
                  className="pointer-events-none absolute inset-0 rounded-full"
                  style={{ boxShadow: `0 0 0 ${frame}px rgba(0,0,0,0.6)` }}
                />
                <div
                  className="pointer-events-none absolute inset-0 rounded-full"
                  style={{ boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.55)' }}
                />
              </>
            )}
          </div>

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
              aria-label={tt('Zoom', 'Zoom', 'Zoom')}
            />
            <ZoomIn className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs"
            disabled={!nat}
            onClick={() => update(DEFAULT_CROP)}
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            {tt('Réinitialiser', 'Reset', 'Restablecer')}
          </Button>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            {tt('Annuler', 'Cancel', 'Cancelar')}
          </Button>
          <Button type="button" onClick={confirm} disabled={!nat || busy}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
            {tt('Valider', 'Confirm', 'Validar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
