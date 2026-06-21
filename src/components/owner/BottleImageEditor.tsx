import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import { X, ZoomIn, ZoomOut, RotateCcw, Move } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  BOTTLE_FRAME,
  DEFAULT_BOTTLE_TRANSFORM,
  containFit,
  type BottleTransform,
} from '@/lib/bottleImage';

const MIN_SCALE = 0.6;
const MAX_SCALE = 4;

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

interface BottleImageEditorProps {
  src: string;
  transform: BottleTransform;
  onChange: (t: BottleTransform) => void;
  onClear: () => void;
}

export function BottleImageEditor({ src, transform, onChange, onClear }: BottleImageEditorProps) {
  const { t } = useLanguage();
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  // Recompute fit whenever a different image is loaded.
  useEffect(() => {
    setNat(null);
  }, [src]);

  const base = nat ? containFit(nat.w, nat.h, BOTTLE_FRAME.w, BOTTLE_FRAME.h) : null;

  const handlePointerDown = (e: React.PointerEvent) => {
    // Don't hijack clicks on the clear button inside the frame.
    if ((e.target as Element).closest('button')) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { px: e.clientX, py: e.clientY, ox: transform.x, oy: transform.y };
    setDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.px;
    const dy = e.clientY - dragRef.current.py;
    onChange({ ...transform, x: dragRef.current.ox + dx, y: dragRef.current.oy + dy });
  };

  const endDrag = (e: React.PointerEvent) => {
    dragRef.current = null;
    setDragging(false);
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
  };

  // The bottle is centered when its own offset is at the frame's middle.
  const isCentered = Math.abs(transform.x) < 2 && Math.abs(transform.y) < 2;

  const setScale = (s: number) => onChange({ ...transform, scale: clampScale(s) });

  const imgStyle: CSSProperties = base
    ? {
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: base.w,
        height: base.h,
        transformOrigin: 'center',
        transform: `translate(-50%, -50%) translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
        filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.5))',
      }
    : { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' };

  return (
    <div className="flex gap-4 items-start">
      {/* WYSIWYG frame — identical styling to the customer bottle card */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative shrink-0 overflow-hidden rounded-xl bg-gradient-to-b from-white/[0.06] to-black/30 ring-1 ring-white/5 cursor-grab active:cursor-grabbing touch-none select-none"
        style={{ width: BOTTLE_FRAME.w, height: BOTTLE_FRAME.h }}
      >
        <img
          src={src}
          alt="preview"
          draggable={false}
          onLoad={e =>
            setNat({
              w: e.currentTarget.naturalWidth || 1,
              h: e.currentTarget.naturalHeight || 1,
            })
          }
          className="pointer-events-none"
          style={imgStyle}
        />

        {/* Center guides — red crosshair to align the bottle in the middle.
            Faint at rest, brighten while dragging, solid when perfectly centered. */}
        <div className="pointer-events-none absolute inset-0">
          <div className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 border-l border-dashed border-red-500 transition-opacity ${dragging ? (isCentered ? 'opacity-100' : 'opacity-70') : 'opacity-25'}`} />
          <div className={`absolute left-0 right-0 top-1/2 -translate-y-1/2 border-t border-dashed border-red-500 transition-opacity ${dragging ? (isCentered ? 'opacity-100' : 'opacity-70') : 'opacity-25'}`} />
        </div>

        <div className="pointer-events-none absolute bottom-1.5 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white/80 backdrop-blur-sm">
          <Move className="h-3 w-3" />
          {t('vipMenu.dragToPlace')}
        </div>

        <Button
          type="button"
          size="icon"
          variant="destructive"
          className="absolute top-2 right-2 h-7 w-7"
          onClick={onClear}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Controls */}
      <div className="flex-1 min-w-0 space-y-3 pt-1">
        <div>
          <p className="text-sm font-medium">{t('vipMenu.adjustPlacement')}</p>
          <p className="text-xs text-muted-foreground leading-snug mt-0.5">
            {t('vipMenu.framePreviewHint')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-8 w-8 shrink-0"
            onClick={() => setScale(transform.scale - 0.15)}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <input
            type="range"
            min={MIN_SCALE}
            max={MAX_SCALE}
            step={0.02}
            value={transform.scale}
            onChange={e => setScale(parseFloat(e.target.value))}
            className="w-full accent-primary cursor-pointer"
            aria-label={t('vipMenu.zoom')}
          />
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-8 w-8 shrink-0"
            onClick={() => setScale(transform.scale + 0.15)}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-xs text-muted-foreground"
          onClick={() => onChange(DEFAULT_BOTTLE_TRANSFORM)}
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
          {t('vipMenu.reset')}
        </Button>
      </div>
    </div>
  );
}
