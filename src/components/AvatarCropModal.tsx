import { useEffect, useRef, useState, useCallback } from 'react';
import { X, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

const CROP_SIZE = 280;
const OUTPUT_SIZE = 400;

interface Props {
  file: File;
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
}

export default function AvatarCropModal({ file, onConfirm, onCancel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [ready, setReady] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const minZoomRef = useRef(1);
  const lastTouchDist = useRef<number | null>(null);
  const zoomRef = useRef(zoom);
  const offsetRef = useRef(offset);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { offsetRef.current = offset; }, [offset]);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const minZ = Math.max(CROP_SIZE / img.naturalWidth, CROP_SIZE / img.naturalHeight);
      minZoomRef.current = minZ;
      setZoom(minZ);
      setOffset({ x: 0, y: 0 });
      setReady(true);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const draw = useCallback((z: number, o: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d')!;
    const R = CROP_SIZE / 2;

    ctx.clearRect(0, 0, CROP_SIZE, CROP_SIZE);

    // Image
    const w = img.naturalWidth * z;
    const h = img.naturalHeight * z;
    ctx.drawImage(img, R + o.x - w / 2, R + o.y - h / 2, w, h);

    // Dark vignette outside circle
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, CROP_SIZE, CROP_SIZE);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(R, R, R - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Circle border
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(R, R, R - 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }, []);

  useEffect(() => {
    if (ready) draw(zoom, offset);
  }, [ready, zoom, offset, draw]);

  const clamp = (ox: number, oy: number, z: number) => {
    const img = imgRef.current!;
    const R = CROP_SIZE / 2;
    const maxX = Math.max(0, (img.naturalWidth * z) / 2 - R);
    const maxY = Math.max(0, (img.naturalHeight * z) / 2 - R);
    return {
      x: Math.max(-maxX, Math.min(maxX, ox)),
      y: Math.max(-maxY, Math.min(maxY, oy)),
    };
  };

  const applyZoom = (newZ: number) => {
    const minZ = minZoomRef.current;
    const clamped = Math.max(minZ, Math.min(minZ * 4, newZ));
    const clamped2 = clamp(offsetRef.current.x, offsetRef.current.y, clamped);
    setZoom(clamped);
    setOffset(clamped2);
  };

  // Mouse
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offsetRef.current.x, oy: offsetRef.current.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setOffset(clamp(
      dragStart.current.ox + e.clientX - dragStart.current.x,
      dragStart.current.oy + e.clientY - dragStart.current.y,
      zoomRef.current,
    ));
  };
  const onMouseUp = () => setIsDragging(false);

  // Touch
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      setIsDragging(true);
      dragStart.current = { x: t.clientX, y: t.clientY, ox: offsetRef.current.x, oy: offsetRef.current.y };
    }
    if (e.touches.length === 2) {
      lastTouchDist.current = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY,
      );
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1 && isDragging) {
      const t = e.touches[0];
      setOffset(clamp(
        dragStart.current.ox + t.clientX - dragStart.current.x,
        dragStart.current.oy + t.clientY - dragStart.current.y,
        zoomRef.current,
      ));
    }
    if (e.touches.length === 2 && lastTouchDist.current !== null) {
      const d = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY,
      );
      applyZoom(zoomRef.current * (d / lastTouchDist.current));
      lastTouchDist.current = d;
    }
  };
  const onTouchEnd = () => {
    setIsDragging(false);
    lastTouchDist.current = null;
  };

  // Wheel zoom
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    applyZoom(zoomRef.current * (e.deltaY < 0 ? 1.08 : 0.92));
  };

  const handleConfirm = () => {
    const img = imgRef.current!;
    const R = CROP_SIZE / 2;
    const out = document.createElement('canvas');
    out.width = OUTPUT_SIZE;
    out.height = OUTPUT_SIZE;
    const ctx = out.getContext('2d')!;

    ctx.beginPath();
    ctx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();

    const scale = OUTPUT_SIZE / CROP_SIZE;
    const w = img.naturalWidth * zoom * scale;
    const h = img.naturalHeight * zoom * scale;
    ctx.drawImage(img, (R + offset.x - img.naturalWidth * zoom / 2) * scale, (R + offset.y - img.naturalHeight * zoom / 2) * scale, w, h);

    out.toBlob(blob => { if (blob) onConfirm(blob); }, 'image/jpeg', 0.92);
  };

  const minZ = minZoomRef.current;
  const maxZ = minZ * 4;
  const zoomPct = maxZ > minZ ? ((zoom - minZ) / (maxZ - minZ)) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div
        className="rounded-2xl p-6 flex flex-col gap-5 w-[340px]"
        style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.1)' }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-white font-semibold text-sm">Ajuster la photo</h2>
          <button onClick={onCancel} className="text-zinc-500 hover:text-white transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex justify-center">
          <canvas
            ref={canvasRef}
            width={CROP_SIZE}
            height={CROP_SIZE}
            className="rounded-full"
            style={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onWheel={onWheel}
          />
        </div>

        <p className="text-zinc-600 text-xs text-center -mt-2">Glissez pour repositionner · Molette pour zoomer</p>

        <div className="flex items-center gap-3">
          <button
            onClick={() => applyZoom(zoom - (maxZ - minZ) * 0.06)}
            className="text-zinc-400 hover:text-white transition-colors shrink-0"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <input
            type="range"
            min={0}
            max={100}
            step={0.5}
            value={zoomPct}
            onChange={e => applyZoom(minZ + (parseFloat(e.target.value) / 100) * (maxZ - minZ))}
            className="flex-1 h-1 accent-red-500"
          />
          <button
            onClick={() => applyZoom(zoom + (maxZ - minZ) * 0.06)}
            className="text-zinc-400 hover:text-white transition-colors shrink-0"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={onCancel}
            className="flex-1 border-zinc-700 text-zinc-300 hover:text-white bg-transparent"
          >
            Annuler
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!ready}
            className="flex-1 bg-red-600 hover:bg-red-700"
          >
            Confirmer
          </Button>
        </div>
      </div>
    </div>
  );
}
