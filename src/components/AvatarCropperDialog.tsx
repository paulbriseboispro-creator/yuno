import { useState, useRef, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ZoomIn, ZoomOut, RotateCcw, Check } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface AvatarCropperDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageFile: File | null;
  onCrop: (croppedFile: File) => void;
}

export function AvatarCropperDialog({ open, onOpenChange, imageFile, onCrop }: AvatarCropperDialogProps) {
  const { t } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);

  const CIRCLE_SIZE = 280;
  const OUTPUT_SIZE = 512;

  // Load image from file
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

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    imgRef.current = img;

    // Auto-fit: scale so the smaller dimension fills the circle
    const scaleX = CIRCLE_SIZE / img.naturalWidth;
    const scaleY = CIRCLE_SIZE / img.naturalHeight;
    const fitScale = Math.max(scaleX, scaleY);
    setScale(fitScale);
    setPosition({ x: 0, y: 0 });
    setImageLoaded(true);
  }, []);

  // Drag handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handlePointerUp = () => {
    setIsDragging(false);
  };

  const handleReset = () => {
    if (imgRef.current) {
      const scaleX = CIRCLE_SIZE / imgRef.current.naturalWidth;
      const scaleY = CIRCLE_SIZE / imgRef.current.naturalHeight;
      setScale(Math.max(scaleX, scaleY));
    }
    setPosition({ x: 0, y: 0 });
  };

  const handleConfirm = () => {
    if (!imgRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = imgRef.current;

    // The image is drawn centered in the circle, then offset by position, then scaled
    // We need to reverse-map the circle area back to image coordinates
    const drawWidth = img.naturalWidth * scale;
    const drawHeight = img.naturalHeight * scale;

    // Image center in the container = CIRCLE_SIZE/2 + position
    const imgCenterX = CIRCLE_SIZE / 2 + position.x;
    const imgCenterY = CIRCLE_SIZE / 2 + position.y;

    // The circle crops from (0,0) to (CIRCLE_SIZE, CIRCLE_SIZE)
    // We need to draw such that the visible circle area maps to our output canvas

    // Source coordinates (in natural image pixels)
    const srcCenterX = (CIRCLE_SIZE / 2 - position.x) / scale + img.naturalWidth / 2 - img.naturalWidth / 2;
    
    // Simpler: just draw the image on canvas with the same transform
    ctx.beginPath();
    ctx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    const outputScale = OUTPUT_SIZE / CIRCLE_SIZE;
    const dx = (CIRCLE_SIZE / 2 - drawWidth / 2 + position.x) * outputScale;
    const dy = (CIRCLE_SIZE / 2 - drawHeight / 2 + position.y) * outputScale;

    ctx.drawImage(img, dx, dy, drawWidth * outputScale, drawHeight * outputScale);

    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], 'avatar-cropped.jpg', { type: 'image/jpeg' });
        onCrop(file);
        onOpenChange(false);
      }
    }, 'image/jpeg', 0.9);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Repositionner la photo</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          {/* Crop area with circular mask */}
          <div
            ref={containerRef}
            className="relative overflow-hidden cursor-move touch-none select-none bg-black/80 rounded-2xl"
            style={{ width: CIRCLE_SIZE, height: CIRCLE_SIZE }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {/* Image */}
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

            {/* Circular mask overlay */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                boxShadow: `0 0 0 ${CIRCLE_SIZE}px rgba(0, 0, 0, 0.6)`,
                borderRadius: '50%',
              }}
            />
            
            {/* Circle border */}
            <div
              className="absolute inset-2 rounded-full pointer-events-none"
              style={{
                border: '2px solid rgba(255,255,255,0.3)',
              }}
            />
          </div>

          {/* Zoom slider */}
          <div className="w-full flex items-center gap-3 px-4">
            <ZoomOut className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <Slider
              value={[scale]}
              onValueChange={([v]) => setScale(v)}
              min={0.1}
              max={4}
              step={0.02}
              className="flex-1"
            />
            <ZoomIn className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          </div>

          {/* Reset */}
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
