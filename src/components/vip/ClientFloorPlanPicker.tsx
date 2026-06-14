import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import { FloorPlanTable, VenueFloorPlan, FloorPlanTableShape } from '@/types';
import { MapPin, ZoomIn, ZoomOut, SkipForward, Check, X, Maximize2, Minimize2, RotateCcw, Move } from 'lucide-react';
import { toast } from 'sonner';
import { renderTableShape } from '@/components/vip/floorPlanShapes';
import { getFittedBackgroundRect } from '@/lib/floorPlanBackground';

interface ZoneArea {
  id: string;
  zoneId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fillOpacity?: number;
  showLabel?: boolean;
  labelOffsetX?: number;
  labelOffsetY?: number;
  labelFontSize?: number;
  labelRotation?: number;
}

interface ClientFloorPlanPickerProps {
  floorPlan: VenueFloorPlan;
  unavailableTableIds: Set<string>;
  selectedTableId: string | null;
  onSelectTable: (tableId: string | null) => void;
  onSkip: () => void;
  zoneId?: string;
  /** Read-only mode: no interactions, just visualization */
  readOnly?: boolean;
  /** Zone to visually highlight (glow effect) */
  highlightZoneId?: string;
  /** Primary zone (client's zone) — other zones are dimmed but clickable for upsell */
  primaryZoneId?: string;
  /** Callback when user clicks a table outside their primary zone */
  onUpsellTable?: (table: FloorPlanTable & { zoneName?: string; zoneColor?: string }) => void;
  /** Number of guests — tables with insufficient capacity are grayed out */
  guestCount?: number;
}

const CANVAS_W = 600;
const CANVAS_H = 400;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;

export function ClientFloorPlanPicker({
  floorPlan,
  unavailableTableIds,
  selectedTableId,
  onSelectTable,
  onSkip,
  zoneId,
  readOnly = false,
  highlightZoneId,
  primaryZoneId,
  onUpsellTable,
  guestCount,
}: ClientFloorPlanPickerProps) {
  const { t } = useLanguage();
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [bgImageSize, setBgImageSize] = useState({ width: CANVAS_W, height: CANVAS_H });

  // Refs per surface (normal + fullscreen) so each one tracks its own gestures correctly
  const normalSurfaceRef = useRef<HTMLDivElement>(null);
  const fullscreenSurfaceRef = useRef<HTMLDivElement>(null);

  // Gesture state
  const gestureRef = useRef<{
    mode: 'none' | 'pan' | 'pinch';
    // Pan
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanY: number;
    moved: boolean;
    // Pinch
    startDist: number;
    startMidX: number; // in surface-local coords
    startMidY: number;
    startZoom: number;
    // Anchor in CONTENT coords (the SVG point under the gesture)
    anchorContentX: number;
    anchorContentY: number;
  }>({
    mode: 'none',
    startClientX: 0,
    startClientY: 0,
    startPanX: 0,
    startPanY: 0,
    moved: false,
    startDist: 0,
    startMidX: 0,
    startMidY: 0,
    startZoom: 1,
    anchorContentX: 0,
    anchorContentY: 0,
  });

  // Suppresses click immediately after a gesture
  const suppressClickRef = useRef(false);

  const tables = (floorPlan.layout?.tables || []) as (FloorPlanTable & { zoneName?: string; shape?: FloorPlanTableShape; color?: string; borderRadius?: number; fillOpacity?: number })[];
  const zoneAreas = ((floorPlan.layout as any)?.zoneAreas || []) as ZoneArea[];
  const backgroundUrl = (floorPlan as any).backgroundImageUrl || null;
  const bgOffset = (floorPlan.layout as any)?.bgOffset || { x: 0, y: 0 };
  const bgScale = (floorPlan.layout as any)?.bgScale || 1;

  useEffect(() => {
    if (!backgroundUrl) {
      setBgImageSize({ width: CANVAS_W, height: CANVAS_H });
      return;
    }

    const image = new window.Image();
    image.onload = () => {
      setBgImageSize({
        width: image.naturalWidth || CANVAS_W,
        height: image.naturalHeight || CANVAS_H,
      });
    };
    image.src = backgroundUrl;
  }, [backgroundUrl]);

  const backgroundRect = useMemo(() => getFittedBackgroundRect({
    canvasWidth: CANVAS_W,
    canvasHeight: CANVAS_H,
    imageWidth: bgImageSize.width,
    imageHeight: bgImageSize.height,
    scale: bgScale,
    offsetX: bgOffset.x,
    offsetY: bgOffset.y,
  }), [bgImageSize.height, bgImageSize.width, bgOffset.x, bgOffset.y, bgScale]);

  // Build zone info map
  const zoneInfoMap = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    tables.forEach(t => {
      if (t.zoneId && t.zoneColor) {
        map.set(t.zoneId, { name: (t as any).zoneName || '', color: t.zoneColor });
      }
    });
    return map;
  }, [tables]);

  // In readOnly mode or when no zoneId filter, show all tables
  // When primaryZoneId is set (step 2), show ALL tables (no filter)
  const filteredTables = primaryZoneId
    ? tables
    : zoneId && !readOnly
      ? tables.filter(t => t.zoneId === zoneId)
      : tables;

  // Auto-fit viewBox
  const viewBox = useMemo(() => {
    const allItems = [
      ...(backgroundUrl ? [{ x: backgroundRect.x, y: backgroundRect.y, w: backgroundRect.width, h: backgroundRect.height }] : []),
      ...filteredTables.map(t => ({ x: t.x, y: t.y, w: t.width, h: t.height })),
      ...zoneAreas.map(z => ({ x: z.x, y: z.y, w: z.width, h: z.height })),
    ];
    if (allItems.length === 0) return { x: 0, y: 0, w: 600, h: 400 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    allItems.forEach(r => {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h);
    });
    const pad = 40;
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  }, [backgroundRect.height, backgroundRect.width, backgroundRect.x, backgroundRect.y, backgroundUrl, filteredTables, zoneAreas]);

  const isTableTooSmall = (table: typeof filteredTables[0]) => {
    if (!guestCount) return false;
    const tableMax = (table.capacity || 99) + ((table as any).maxExtraPersons || 0);
    return guestCount > tableMax;
  };

  const handleTableClick = (table: typeof filteredTables[0]) => {
    if (readOnly) return;
    if (suppressClickRef.current) return;
    if (unavailableTableIds.has(table.id)) return;
    if (isTableTooSmall(table)) {
      const tableMax = (table.capacity || 0) + ((table as any).maxExtraPersons || 0);
      toast.info(t('vipCheckout.tooSmallMessage').replace('{name}', table.name).replace('{max}', tableMax.toString()));
      return;
    }

    // If primaryZoneId set and table is in a different zone → upsell
    if (primaryZoneId && table.zoneId && table.zoneId !== primaryZoneId && onUpsellTable) {
      onUpsellTable(table as FloorPlanTable & { zoneName?: string; zoneColor?: string });
      return;
    }

    onSelectTable(selectedTableId === table.id ? null : table.id);
  };

  const selectedTable = filteredTables.find(t => t.id === selectedTableId);

  const getTouchDistance = (touches: React.TouchList | TouchList) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const getTouchMid = (touches: React.TouchList | TouchList) => ({
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  });

  /**
   * Convert a point given in SURFACE-LOCAL coordinates (px from top-left of the
   * gesture surface) to the equivalent point in CONTENT coordinates (the un-
   * transformed coordinate space of the inner div). This is the foundation of
   * "zoom toward the gesture point" — once we know which content point is under
   * the user's fingers, we keep that point pinned while we change the zoom.
   *
   * Forward transform applied to content:
   *   surface = content * zoom + pan
   * Inverse:
   *   content = (surface - pan) / zoom
   */
  const surfaceToContent = (sx: number, sy: number, currentZoom: number, currentPan: { x: number; y: number }) => ({
    x: (sx - currentPan.x) / currentZoom,
    y: (sy - currentPan.y) / currentZoom,
  });

  /**
   * Apply a new zoom while keeping the given content point pinned under the
   * given surface point. Returns the new pan offset.
   *
   *   surface = content * zoom + pan
   *   ⇒ pan = surface - content * zoom
   */
  const zoomAroundPoint = (
    newZoom: number,
    surfaceX: number,
    surfaceY: number,
    contentX: number,
    contentY: number,
  ) => {
    const clamped = Math.min(Math.max(newZoom, MIN_ZOOM), MAX_ZOOM);
    const newPan = {
      x: surfaceX - contentX * clamped,
      y: surfaceY - contentY * clamped,
    };
    setZoom(clamped);
    setPanOffset(newPan);
  };

  const getSurfaceRect = (fullscreen: boolean) => {
    const el = fullscreen ? fullscreenSurfaceRef.current : normalSurfaceRef.current;
    return el?.getBoundingClientRect() ?? null;
  };

  // ===== Touch handlers =====
  const handleTouchStart = useCallback((e: React.TouchEvent, fullscreen: boolean) => {
    const rect = getSurfaceRect(fullscreen);
    if (!rect) return;

    if (e.touches.length === 2) {
      // Pinch start — anchor on midpoint between fingers
      const mid = getTouchMid(e.touches);
      const sx = mid.x - rect.left;
      const sy = mid.y - rect.top;
      const anchor = surfaceToContent(sx, sy, zoom, panOffset);
      gestureRef.current = {
        ...gestureRef.current,
        mode: 'pinch',
        startDist: getTouchDistance(e.touches),
        startMidX: sx,
        startMidY: sy,
        startZoom: zoom,
        anchorContentX: anchor.x,
        anchorContentY: anchor.y,
        moved: true,
      };
    } else if (e.touches.length === 1) {
      gestureRef.current = {
        ...gestureRef.current,
        mode: 'pan',
        startClientX: e.touches[0].clientX,
        startClientY: e.touches[0].clientY,
        startPanX: panOffset.x,
        startPanY: panOffset.y,
        moved: false,
      };
    }
  }, [panOffset, zoom]);

  const handleTouchMove = useCallback((e: React.TouchEvent, fullscreen: boolean) => {
    const g = gestureRef.current;
    const rect = getSurfaceRect(fullscreen);
    if (!rect) return;

    if (e.touches.length === 2 && g.mode === 'pinch') {
      e.preventDefault();
      const newDist = getTouchDistance(e.touches);
      const scale = newDist / Math.max(g.startDist, 1);
      const targetZoom = g.startZoom * scale;

      // Use the CURRENT midpoint so you can simultaneously pinch + drag with two fingers
      const mid = getTouchMid(e.touches);
      const sx = mid.x - rect.left;
      const sy = mid.y - rect.top;

      // Two-finger pan offset relative to where the pinch started (lets the user
      // re-aim with the same gesture instead of having to lift fingers and drag)
      const panDx = sx - g.startMidX;
      const panDy = sy - g.startMidY;

      const clampedZoom = Math.min(Math.max(targetZoom, MIN_ZOOM), MAX_ZOOM);
      // Pin anchor point to original midpoint, then add the live midpoint drift
      setZoom(clampedZoom);
      setPanOffset({
        x: g.startMidX - g.anchorContentX * clampedZoom + panDx,
        y: g.startMidY - g.anchorContentY * clampedZoom + panDy,
      });
    } else if (e.touches.length === 1 && g.mode === 'pan') {
      const dx = e.touches[0].clientX - g.startClientX;
      const dy = e.touches[0].clientY - g.startClientY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) g.moved = true;
      setPanOffset({ x: g.startPanX + dx, y: g.startPanY + dy });
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    const wasMoved = gestureRef.current.moved;
    gestureRef.current.mode = 'none';
    if (wasMoved) {
      suppressClickRef.current = true;
      setTimeout(() => { suppressClickRef.current = false; }, 120);
    }
  }, []);

  // ===== Mouse / wheel handlers =====
  const handleWheel = useCallback((e: React.WheelEvent, fullscreen: boolean) => {
    e.preventDefault();
    const rect = getSurfaceRect(fullscreen);
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const anchor = surfaceToContent(sx, sy, zoom, panOffset);
    // Smoother step than the previous flat 0.15
    const factor = e.deltaY > 0 ? 0.88 : 1.13;
    zoomAroundPoint(zoom * factor, sx, sy, anchor.x, anchor.y);
  }, [zoom, panOffset]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only left mouse button
    if (e.button !== 0) return;
    gestureRef.current = {
      ...gestureRef.current,
      mode: 'pan',
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPanX: panOffset.x,
      startPanY: panOffset.y,
      moved: false,
    };
  }, [panOffset]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const g = gestureRef.current;
    if (g.mode !== 'pan') return;
    const dx = e.clientX - g.startClientX;
    const dy = e.clientY - g.startClientY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) g.moved = true;
    setPanOffset({ x: g.startPanX + dx, y: g.startPanY + dy });
  }, []);

  const handleMouseUpOrLeave = useCallback(() => {
    const wasMoved = gestureRef.current.moved;
    if (gestureRef.current.mode === 'pan') gestureRef.current.mode = 'none';
    if (wasMoved) {
      suppressClickRef.current = true;
      setTimeout(() => { suppressClickRef.current = false; }, 120);
    }
  }, []);

  // ===== Button-driven zoom (anchors on viewport center) =====
  const zoomByButton = (delta: number, fullscreen: boolean) => {
    const rect = getSurfaceRect(fullscreen);
    if (!rect) {
      setZoom(z => Math.min(Math.max(z + delta, MIN_ZOOM), MAX_ZOOM));
      return;
    }
    const sx = rect.width / 2;
    const sy = rect.height / 2;
    const anchor = surfaceToContent(sx, sy, zoom, panOffset);
    zoomAroundPoint(zoom + delta, sx, sy, anchor.x, anchor.y);
  };

  const handleResetView = useCallback(() => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  // Reset view when toggling fullscreen so the plan re-fits the new surface
  useEffect(() => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  }, [isFullscreen]);

  // Determine if a zone should be highlighted
  const isZoneHighlighted = (zId: string) => highlightZoneId === zId || primaryZoneId === zId;

  const renderSvg = () => (
    <svg
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
      className="w-full h-full block"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <pattern id="unavailable-stripes" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="hsl(var(--muted-foreground))" strokeWidth="1" strokeOpacity="0.12" />
        </pattern>
        <filter id="client-glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="selected-pulse">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="zone-glow">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Background image */}
      {backgroundUrl && (
        <image
          href={backgroundUrl}
          x={backgroundRect.x}
          y={backgroundRect.y}
          width={backgroundRect.width}
          height={backgroundRect.height}
          preserveAspectRatio="xMidYMid meet"
          opacity={0.75}
        />
      )}

      {/* Zone Areas */}
      {zoneAreas.map((zoneArea) => {
        const zoneInfo = zoneInfoMap.get(zoneArea.zoneId);
        if (!zoneInfo) return null;
        const highlighted = isZoneHighlighted(zoneArea.zoneId);
        return (
          <g key={`zone-${zoneArea.id}`}>
            {highlighted && (
              <rect
                x={zoneArea.x - 3} y={zoneArea.y - 3}
                width={zoneArea.width + 6} height={zoneArea.height + 6}
                rx={10}
                fill="none"
                stroke={zoneInfo.color} strokeWidth={2} strokeOpacity={0.5}
                filter="url(#zone-glow)"
                className="pointer-events-none"
              >
                <animate attributeName="stroke-opacity" values="0.3;0.6;0.3" dur="3s" repeatCount="indefinite" />
              </rect>
            )}
            <rect
              x={zoneArea.x} y={zoneArea.y}
              width={zoneArea.width} height={zoneArea.height}
              rx={8}
              fill={zoneInfo.color}
              fillOpacity={highlighted ? Math.max(zoneArea.fillOpacity ?? 0.04, 0.08) : (zoneArea.fillOpacity ?? 0.04)}
              stroke={zoneInfo.color}
              strokeWidth={highlighted ? 1.5 : 0.5}
              strokeOpacity={highlighted ? 0.6 : 0.3}
              strokeDasharray={highlighted ? undefined : "4 3"}
              className="pointer-events-none"
            />
            {zoneArea.showLabel !== false && (
              <text
                x={zoneArea.x + zoneArea.width / 2 + (zoneArea.labelOffsetX ?? 0)}
                y={zoneArea.y + zoneArea.height + 13 + (zoneArea.labelOffsetY ?? 0)}
                textAnchor="middle" dominantBaseline="middle" fill={zoneInfo.color}
                opacity={highlighted ? 0.8 : 0.5}
                transform={`rotate(${zoneArea.labelRotation ?? 0}, ${zoneArea.x + zoneArea.width / 2 + (zoneArea.labelOffsetX ?? 0)}, ${zoneArea.y + zoneArea.height + 13 + (zoneArea.labelOffsetY ?? 0)})`}
                className="pointer-events-none select-none" style={{ fontSize: (zoneArea.labelFontSize ?? 10) + 'px', fontWeight: highlighted ? 600 : 500, letterSpacing: '0.03em' }}
              >{zoneInfo.name}</text>
            )}
          </g>
        );
      })}

      {/* Tables */}
      {filteredTables.map((table) => {
        const isUnavailable = unavailableTableIds.has(table.id);
        const tooSmall = isTableTooSmall(table);
        const isSelected = selectedTableId === table.id;
        const tableColor = table.color || table.zoneColor || 'hsl(var(--primary))';
        const cx = table.x + table.width / 2;
        const cy = table.y + table.height / 2;
        const shortLabel = table.name.replace(/^table\s*/i, '').trim() || table.name;
        const tableMax = (table.capacity || 0) + ((table as any).maxExtraPersons || 0);
        const isOutsidePrimaryZone = primaryZoneId && table.zoneId && table.zoneId !== primaryZoneId;
        const dimmed = (isOutsidePrimaryZone && !isSelected);

        return (
          <g
            key={table.id}
            onClick={() => handleTableClick(table)}
            className={readOnly ? 'pointer-events-none' : (isUnavailable ? 'cursor-not-allowed' : 'cursor-pointer')}
            style={{ transition: 'opacity 0.3s ease, filter 0.3s ease' }}
            opacity={isUnavailable ? 0.3 : tooSmall ? 0.55 : dimmed ? 0.45 : 1}
            filter={isSelected ? 'url(#selected-pulse)' : undefined}
          >
            {isSelected && (
              <rect x={table.x - 3} y={table.y - 3} width={table.width + 6} height={table.height + 6}
                rx={table.shape === 'circle' ? 999 : (table.borderRadius ?? 6) + 2} fill="none" stroke={tableColor} strokeWidth={1} opacity={0.4}>
                <animate attributeName="opacity" values="0.2;0.5;0.2" dur="2.5s" repeatCount="indefinite" />
              </rect>
            )}

            {renderTableShape({
              shape: table.shape || 'rectangle',
              x: table.x, y: table.y, width: table.width, height: table.height,
              fill: isUnavailable ? 'url(#unavailable-stripes)' : tooSmall ? 'transparent' : tableColor,
              stroke: isUnavailable ? 'hsl(var(--muted-foreground))' : tooSmall ? '#f59e0b' : isSelected ? 'white' : dimmed ? 'hsl(var(--muted-foreground))' : tableColor,
              strokeWidth: isSelected ? 2 : tooSmall ? 1.5 : dimmed ? 0.5 : 1,
              fillOpacity: isUnavailable ? 1 : tooSmall ? 0 : isSelected ? Math.min((table.fillOpacity ?? 0.55) + 0.15, 1) : dimmed ? 0.25 : (table.fillOpacity ?? 0.55),
              borderRadius: table.borderRadius ?? 6,
              strokeDasharray: tooSmall ? '4 3' : undefined,
            })}

            <text x={cx} y={tooSmall ? cy - 3 : cy}
              textAnchor="middle" dominantBaseline="central"
              fill={isUnavailable ? 'hsl(var(--muted-foreground))' : tooSmall ? '#f59e0b' : dimmed ? 'hsl(var(--muted-foreground))' : 'white'}
              opacity={isSelected ? 1 : tooSmall ? 0.8 : dimmed ? 0.6 : 0.9}
              fontSize={Math.min(table.width, table.height) * 0.4} fontWeight={700}
              className="pointer-events-none select-none">
              {shortLabel}
            </text>

            {tooSmall && (
              <text x={cx} y={cy + Math.min(table.width, table.height) * 0.25}
                textAnchor="middle" dominantBaseline="central"
                fill="#f59e0b" opacity={0.7}
                fontSize={Math.min(table.width, table.height) * 0.22} fontWeight={500}
                className="pointer-events-none select-none">
                max {tableMax}
              </text>
            )}

            {isUnavailable && (
              <line x1={table.x + 4} y1={table.y + 4} x2={table.x + table.width - 4} y2={table.y + table.height - 4}
                stroke="hsl(var(--destructive))" strokeWidth={1} opacity={0.4} className="pointer-events-none" />
            )}

            {isSelected && (
              <g transform={`translate(${table.x + table.width - 8}, ${table.y + 1})`}>
                <circle cx={5} cy={5} r={5.5} fill={tableColor} opacity={0.9} />
                <path d="M2.5 5 L4.5 7 L7.5 3.5" stroke="white" strokeWidth={1.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );

  const mapContent = (fullscreen: boolean) => {
    const surfaceRef = fullscreen ? fullscreenSurfaceRef : normalSurfaceRef;
    const isPanning = gestureRef.current.mode === 'pan';

    return (
      <div
        ref={surfaceRef}
        className={`relative w-full bg-white/[0.02] overflow-hidden border border-white/[0.08] select-none ${
          fullscreen ? 'h-full rounded-none border-0' : 'rounded-[10px]'
        }`}
        style={{
          ...(fullscreen
            ? { height: '100%' }
            : { height: readOnly ? 'min(40vh, 320px)' : 'min(70vh, 520px)', minHeight: readOnly ? 200 : 360 }),
          touchAction: 'none',
          cursor: readOnly ? 'default' : (isPanning ? 'grabbing' : 'grab'),
        }}
        onTouchStart={(e) => handleTouchStart(e, fullscreen)}
        onTouchMove={(e) => handleTouchMove(e, fullscreen)}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onWheel={(e) => handleWheel(e, fullscreen)}
        onMouseDown={readOnly ? undefined : handleMouseDown}
        onMouseMove={readOnly ? undefined : handleMouseMove}
        onMouseUp={readOnly ? undefined : handleMouseUpOrLeave}
        onMouseLeave={readOnly ? undefined : handleMouseUpOrLeave}
      >
        <div
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            transition: gestureRef.current.mode === 'none' ? 'transform 0.15s ease-out' : 'none',
            width: '100%',
            height: '100%',
            willChange: 'transform',
          }}
        >
          {renderSvg()}
        </div>

        {/* Zoom controls */}
        <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
          <Button size="icon" variant="secondary" className="h-9 w-9 rounded-full shadow-md backdrop-blur-sm bg-background/80"
            onClick={() => zoomByButton(0.3, fullscreen)} aria-label="Zoom in">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="secondary" className="h-9 w-9 rounded-full shadow-md backdrop-blur-sm bg-background/80"
            onClick={() => zoomByButton(-0.3, fullscreen)} aria-label="Zoom out">
            <ZoomOut className="h-4 w-4" />
          </Button>
          {(zoom !== 1 || panOffset.x !== 0 || panOffset.y !== 0) && (
            <Button size="icon" variant="secondary" className="h-9 w-9 rounded-full shadow-md backdrop-blur-sm bg-background/80"
              onClick={handleResetView} aria-label="Reset view">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* Fullscreen toggle */}
        {!readOnly && (
          <Button
            size="icon"
            variant="secondary"
            className="absolute top-3 right-3 h-9 w-9 rounded-full shadow-md backdrop-blur-sm bg-background/80"
            onClick={() => setIsFullscreen(f => !f)}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Open fullscreen'}
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        )}

        {/* Hint badge */}
        {!readOnly && !fullscreen && zoom === 1 && panOffset.x === 0 && panOffset.y === 0 && (
          <div className="absolute top-3 left-3 pointer-events-none">
            <Badge variant="secondary" className="text-[10px] backdrop-blur-sm bg-background/70 gap-1">
              <Move className="h-2.5 w-2.5" />
              {t('vipCheckout.pinchToZoom') || 'Pincez ou glissez pour zoomer'}
            </Badge>
          </div>
        )}

        {/* Read-only label */}
        {readOnly && highlightZoneId && (
          <div className="absolute top-3 left-3">
            <Badge className="bg-primary/20 text-primary border-primary/30 text-xs backdrop-blur-sm">
              <MapPin className="h-3 w-3 mr-1" />
              {t('vipCheckout.yourZone')}
            </Badge>
          </div>
        )}

        {/* Zoom level indicator */}
        {!readOnly && zoom !== 1 && (
          <div className="absolute bottom-3 left-3 pointer-events-none">
            <Badge variant="secondary" className="text-[10px] backdrop-blur-sm bg-background/70 font-mono">
              {Math.round(zoom * 100)}%
            </Badge>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Selected table info */}
      {!readOnly && selectedTable && (
        <div className="flex items-center justify-between px-3 py-2 bg-primary/10 border border-primary/30 rounded-lg animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
              <Check className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="text-sm font-medium">{selectedTable.name}</span>
            {selectedTable.capacity && (
              <Badge variant="outline" className="text-xs">{selectedTable.capacity} pers.</Badge>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={() => onSelectTable(null)} className="text-xs h-7">
            {t('common.change')}
          </Button>
        </div>
      )}

      {/* Floor plan (normal) */}
      {mapContent(false)}

      {/* Fullscreen overlay — true large-screen viewer */}
      {isFullscreen && (
        <div
          className="fixed inset-0 z-[60] bg-background flex flex-col"
          style={{
            paddingTop: 'env(safe-area-inset-top, 0px)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          }}
        >
          {/* Top bar */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] bg-[#0A0A0A]/95 backdrop-blur">
            <div className="flex items-center gap-2 min-w-0">
              <MapPin className="h-4 w-4 text-primary flex-shrink-0" />
              <span className="font-display font-bold uppercase truncate text-white" style={{ fontSize: '13px', letterSpacing: '-0.005em' }}>{t('vipCheckout.floorPlan') || 'Plan de salle'}</span>
              {selectedTable && (
                <span className="font-mono uppercase text-[9px] tracking-[0.08em] ml-2 hidden sm:inline-flex text-[#9A9A9A] border border-white/[0.10] px-1.5 py-0.5 rounded-full">
                  {selectedTable.name}
                </span>
              )}
            </div>
            <button className="h-9 w-9 rounded-full flex items-center justify-center bg-white/[0.06] hover:bg-white/[0.10] transition-colors" onClick={() => setIsFullscreen(false)} aria-label="Close">
              <X className="h-4 w-4 text-white" />
            </button>
          </div>

          {/* Map fills available height */}
          <div className="flex-1 min-h-0 relative">
            {mapContent(true)}
          </div>

          {/* Bottom action bar */}
          <div className="px-4 py-3 border-t border-white/[0.08] bg-[#0A0A0A]/95 backdrop-blur flex items-center justify-between gap-3">
            {selectedTable ? (
              <>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <Check className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-display font-bold uppercase truncate text-white" style={{ fontSize: '13px' }}>{selectedTable.name}</div>
                    {selectedTable.capacity && (
                      <div className="font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.06em', color: '#9A9A9A' }}>
                        {selectedTable.capacity} pers.{(selectedTable as any).maxExtraPersons ? ` · +${(selectedTable as any).maxExtraPersons} max` : ''}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setIsFullscreen(false)}
                  className="flex-shrink-0 h-10 px-5 rounded-full font-mono uppercase text-[10px] font-bold tracking-[0.10em] text-white transition-all active:scale-[0.97]"
                  style={{ background: '#E8192C', boxShadow: '0 6px 24px rgba(232,25,44,0.35)' }}
                >
                  {t('common.confirm') || 'Confirmer'}
                </button>
              </>
            ) : (
              <div className="flex-1 text-center font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.08em', color: '#9A9A9A' }}>
                {t('vipCheckout.tapTableToSelect') || 'Touchez une table pour la sélectionner'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      {!readOnly && (
        <div className="flex flex-wrap gap-x-3 gap-y-2 px-1 font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.06em' }}>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded border-2" style={{ borderColor: 'hsl(var(--primary))', backgroundColor: 'hsl(var(--primary)/0.12)' }} />
            <span className="text-[#9A9A9A]">{t('vipCheckout.available')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-white/[0.08] border border-white/[0.14]" />
            <span className="text-[#9A9A9A]">{t('vipCheckout.unavailable')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded border-2 border-primary bg-primary/35" />
            <span className="text-[#9A9A9A]">{t('vipCheckout.selected')}</span>
          </div>
          {primaryZoneId && (
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded border border-white/[0.14] bg-white/[0.05]" />
              <span className="text-[#9A9A9A]">{t('vipCheckout.otherZone')}</span>
            </div>
          )}
          {guestCount && (
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded border-2 border-dashed" style={{ borderColor: '#f59e0b', backgroundColor: 'transparent' }} />
              <span className="text-[#9A9A9A]">{t('vipCheckout.tooSmall') || 'Capacité insuffisante'}</span>
            </div>
          )}
        </div>
      )}

      {/* Skip button — only in interactive mode */}
      {!readOnly && (
        <button
          onClick={onSkip}
          className="w-full h-11 rounded-full flex items-center justify-center font-mono uppercase text-[10px] font-bold tracking-[0.10em] text-[#9A9A9A] bg-white/[0.06] hover:bg-white/[0.10] transition-colors active:scale-[0.98]"
        >
          <SkipForward className="h-4 w-4 mr-2" />
          {t('vipCheckout.skipPlacement')}
        </button>
      )}
    </div>
  );
}
