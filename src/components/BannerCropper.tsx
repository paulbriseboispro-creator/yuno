import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Move, ZoomIn, ZoomOut, RotateCcw, X, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface BannerPosition {
  xPercent: number;
  yPercent: number;
  scale: number;
}

interface BannerCropperProps {
  imageUrl: string;
  initialPosition?: BannerPosition;
  onPositionChange?: (position: BannerPosition) => void;
  onRemove: () => void;
  className?: string;
}

export function BannerCropper({ 
  imageUrl, 
  initialPosition,
  onPositionChange,
  onRemove, 
  className 
}: BannerCropperProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  
  const [scale, setScale] = useState(initialPosition?.scale ?? 1);
  // Store internal position in pixels for smooth dragging
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [hasRestoredPosition, setHasRestoredPosition] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [hasInitialized, setHasInitialized] = useState(false);

  // Reset position and scale when image changes
  useEffect(() => {
    setScale(initialPosition?.scale ?? 1);
    setPosition({ x: 0, y: 0 });
    setImageLoaded(false);
    setHasInitialized(false);
    setHasRestoredPosition(false);
  }, [imageUrl]);

  // Notify parent of position changes - convert pixels to percentages
  useEffect(() => {
    if (hasInitialized && onPositionChange && containerRef.current) {
      const containerWidth = containerRef.current.offsetWidth || 1;
      const containerHeight = containerRef.current.offsetHeight || 1;
      onPositionChange({
        xPercent: (position.x / containerWidth) * 100,
        yPercent: (position.y / containerHeight) * 100,
        scale,
      });
    }
  }, [position.x, position.y, scale, hasInitialized, onPositionChange]);

  // Restore position from percentages when image loads
  useEffect(() => {
    if (imageLoaded && initialPosition && !hasRestoredPosition && containerRef.current) {
      const containerWidth = containerRef.current.offsetWidth || 1;
      const containerHeight = containerRef.current.offsetHeight || 1;
      setPosition({
        x: (initialPosition.xPercent * containerWidth) / 100,
        y: (initialPosition.yPercent * containerHeight) / 100,
      });
      setHasRestoredPosition(true);
      setHasInitialized(true);
    }
  }, [imageLoaded, initialPosition, hasRestoredPosition]);

  const handleImageLoad = useCallback(() => {
    if (imageRef.current) {
      setNaturalSize({
        width: imageRef.current.naturalWidth,
        height: imageRef.current.naturalHeight,
      });
      setImageLoaded(true);
      
      // Only auto-fit if no initial position was provided
      if (!initialPosition) {
        const containerAspect = 16 / 9; // Landscape banner
        const imageAspect = imageRef.current.naturalWidth / imageRef.current.naturalHeight;
        
        if (imageAspect < containerAspect) {
          // Image is taller - fit to width
          setScale(1);
        } else {
          // Image is wider - fit to height and scale up
          setScale(imageAspect / containerAspect);
        }
      }
      
      setHasInitialized(true);
    }
  }, [initialPosition]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      setIsDragging(true);
      setDragStart({ x: touch.clientX - position.x, y: touch.clientY - position.y });
    }
  };

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return;
    const touch = e.touches[0];
    setPosition({
      x: touch.clientX - dragStart.x,
      y: touch.clientY - dragStart.y,
    });
  }, [isDragging, dragStart]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove);
      window.addEventListener('touchend', handleTouchEnd);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDragging, handleMouseMove, handleMouseUp, handleTouchMove, handleTouchEnd]);

  const handleReset = () => {
    setPosition({ x: 0, y: 0 });
    if (imageRef.current) {
      const containerAspect = 16 / 9;
      const imageAspect = imageRef.current.naturalWidth / imageRef.current.naturalHeight;
      if (imageAspect >= containerAspect) {
        setScale(imageAspect / containerAspect);
      } else {
        setScale(1);
      }
    }
  };

  const handleScaleChange = (value: number) => {
    setScale(value);
  };

  return (
    <div className={cn("space-y-3", className)}>
      {/* Info banner */}
      <div className="flex items-start gap-2 p-2 rounded-lg bg-primary/10 border border-primary/20">
        <Info className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
        <div className="text-xs text-muted-foreground">
          <p className="font-medium text-foreground mb-0.5">Format Bannière Paysage (16:9)</p>
          <p>Taille recommandée : <span className="font-mono text-primary">1920 × 1080 px</span></p>
          <p className="mt-1">Glissez l'image pour la repositionner dans le cadre.</p>
        </div>
      </div>
      
      {/* Preview container with 16:9 aspect ratio */}
      <div className="flex flex-col sm:flex-row gap-4 items-start">
        <div 
          ref={containerRef}
          className="relative w-full sm:w-72 sm:max-w-xs aspect-[16/9] rounded-xl overflow-hidden border-2 border-dashed border-primary/50 bg-muted/50 cursor-move select-none shrink-0"
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
        >
          {/* Image with transform */}
          <img
            ref={imageRef}
            src={imageUrl}
            alt="Banner preview"
            onLoad={handleImageLoad}
            draggable={false}
            className="absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity"
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
              opacity: imageLoaded ? 1 : 0,
            }}
          />
          
          {/* Frame overlay */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute inset-0 ring-2 ring-primary/30 ring-inset rounded-xl" />
          </div>

          {/* Drag indicator */}
          {imageLoaded && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-background/80 backdrop-blur-sm rounded-full px-2 py-1 flex items-center gap-1 text-[10px] text-muted-foreground pointer-events-none">
              <Move className="h-3 w-3" />
              <span>Glisser</span>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex-1 space-y-3 min-w-0">
          {/* Zoom control */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <ZoomOut className="h-3 w-3" />
              </span>
              <span className="font-mono">{Math.round(scale * 100)}%</span>
              <span className="flex items-center gap-1">
                <ZoomIn className="h-3 w-3" />
              </span>
            </div>
            <Slider
              value={[scale]}
              onValueChange={([value]) => handleScaleChange(value)}
              min={0.5}
              max={3}
              step={0.05}
              className="w-full"
            />
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleReset}
              className="flex-1 text-xs"
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Réinitialiser
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onRemove}
              className="text-xs"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>

          {/* Image info */}
          {imageLoaded && naturalSize.width > 0 && (
            <div className="text-xs text-muted-foreground">
              <p>Image source : <span className="font-mono">{naturalSize.width} × {naturalSize.height} px</span></p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
