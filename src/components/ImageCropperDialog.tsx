import { useState, useRef, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ZoomIn, ZoomOut, RotateCcw, Check } from 'lucide-react';

export type CropShape = 'circle' | 'rect';

interface ImageCropperDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageFile: File | null;
  onCrop: (croppedFile: File) => void;
  /** Output aspect ratio width/height. 1 = square. 3 for 3:1 banner. */
  aspectRatio?: number;
  /** Visual mask shape. Use 'circle' only when aspectRatio is 1. */
  shape?: CropShape;
  /** Output longest side in px. */
  outputSize?: number;
  title?: string;
  helperText?: string;
}

export function ImageCropperDialog({
  open,
  onOpenChange,
  imageFile,
  onCrop,
  aspectRatio = 1,
  shape = 'circle',
  outputSize = 1024,
  title = 'Repositionner la photo',
  helperText,
}: ImageCropperDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);

  // Compute crop frame dimensions, fitting within ~360px wide
  const FRAME_W = aspectRatio >= 1 ? 360 : 360 * aspectRatio;
  const FRAME_H = FRAME_W / aspectRatio;

  // Output dimensions
  const OUT_W = aspectRatio >= 1 ? outputSize : Math.round(outputSize * aspectRatio);
  const OUT_H = aspectRatio >= 1 ? Math.round(outputSize / aspectRatio) : outputSize;

  useEffect(() => {
    if (imageFile) {
      const url = URL.createObjectURL(imageFile);
      setImageSrc(url);
      setScale(1);
      setPosition({ x: 0, y: 0 });
      setImageLoaded(false);
      return () => URL.revokeObjectURL(url);
    }
  }, [imageFile]);

  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      imgRef.current = img;
      // Contain-fit: largest scale so the WHOLE image is visible inside the frame.
      // The user can then zoom in if they want to crop. This avoids cutting off
      // logo edges (e.g. round logos in a circular mask).
      const scaleX = FRAME_W / img.naturalWidth;
      const scaleY = FRAME_H / img.naturalHeight;
      const fitScale = Math.min(scaleX, scaleY);
      setScale(fitScale);
      setPosition({ x: 0, y: 0 });
      setImageLoaded(true);
    },
    [FRAME_W, FRAME_H]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handlePointerUp = () => setIsDragging(false);

  const handleReset = () => {
    if (imgRef.current) {
      const scaleX = FRAME_W / imgRef.current.naturalWidth;
      const scaleY = FRAME_H / imgRef.current.naturalHeight;
      setScale(Math.min(scaleX, scaleY));
    }
    setPosition({ x: 0, y: 0 });
  };

  const handleConfirm = () => {
    if (!imgRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = imgRef.current;

    // Fond blanc pour éviter les zones noires/transparentes quand l'image
    // ne couvre pas totalement le cadre (mode contain). Important pour les
    // logos qui seront ensuite affichés dans un cercle CSS.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, OUT_W, OUT_H);

    // NB: on n'applique PAS de clip circulaire ici, même si shape === 'circle'.
    // Le rendu rond est appliqué côté affichage via CSS (rounded-full), ce qui
    // évite de couper les bords du logo de manière irréversible dans le fichier.

    const drawWidth = img.naturalWidth * scale;
    const drawHeight = img.naturalHeight * scale;
    const outScaleX = OUT_W / FRAME_W;
    const outScaleY = OUT_H / FRAME_H;
    const dx = (FRAME_W / 2 - drawWidth / 2 + position.x) * outScaleX;
    const dy = (FRAME_H / 2 - drawHeight / 2 + position.y) * outScaleY;

    ctx.drawImage(img, dx, dy, drawWidth * outScaleX, drawHeight * outScaleY);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          const file = new File([blob], `cropped-${Date.now()}.jpg`, { type: 'image/jpeg' });
          onCrop(file);
          onOpenChange(false);
        }
      },
      'image/jpeg',
      0.92
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          <div
            ref={containerRef}
            className="relative overflow-hidden cursor-move touch-none select-none bg-black/80 rounded-lg"
            style={{ width: FRAME_W, height: FRAME_H }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {imageSrc && (
              <img
                src={imageSrc}
                alt="Crop preview"
                onLoad={handleImageLoad}
                draggable={false}
                className="absolute pointer-events-none"
                style={{
                  left: '50%',
                  top: '50%',
                  transform: `translate(-50%, -50%) translate(${position.x}px, ${position.y}px) scale(${scale})`,
                  transformOrigin: 'center center',
                  maxWidth: 'none',
                  opacity: imageLoaded ? 1 : 0,
                }}
              />
            )}

            {/* Mask overlay */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={
                shape === 'circle'
                  ? {
                      boxShadow: `0 0 0 ${Math.max(FRAME_W, FRAME_H)}px rgba(0,0,0,0.6)`,
                      borderRadius: '50%',
                    }
                  : {
                      boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.4)',
                    }
              }
            />
            {shape === 'circle' && (
              <div
                className="absolute inset-2 rounded-full pointer-events-none"
                style={{ border: '2px solid rgba(255,255,255,0.3)' }}
              />
            )}
          </div>

          {helperText && (
            <p className="text-xs text-muted-foreground -mt-1">{helperText}</p>
          )}

          <div className="w-full flex items-center gap-3 px-4">
            <ZoomOut className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <Slider
              value={[scale]}
              onValueChange={([v]) => setScale(v)}
              min={0.05}
              max={4}
              step={0.01}
              className="flex-1"
            />
            <ZoomIn className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          </div>

          <Button variant="ghost" size="sm" onClick={handleReset} className="text-xs">
            <RotateCcw className="h-3 w-3 mr-1" />
            Réinitialiser
          </Button>
        </div>

        <canvas ref={canvasRef} className="hidden" />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={handleConfirm} disabled={!imageLoaded}>
            <Check className="h-4 w-4 mr-1" />
            Confirmer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
