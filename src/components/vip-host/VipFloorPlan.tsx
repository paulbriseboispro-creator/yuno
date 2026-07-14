import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { VipReservation, VipConsumption, VenueFloorPlan, FloorPlanTable, FloorPlanTableShape } from '@/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ZoomIn, ZoomOut } from 'lucide-react';
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
  borderRadius?: number;
}

interface VipFloorPlanProps {
  floorPlan: VenueFloorPlan | null;
  reservations: VipReservation[];
  consumptions?: Map<string, VipConsumption[]>;
  selectedTableId?: string;
  onTableSelect: (tableId: string) => void;
  mode: 'view' | 'placement';
  pendingReservation?: VipReservation | null;
  showBackground?: boolean;
  /** IDs des réservations qui ont une pré-commande de bouteilles en attente (pastille dorée). */
  preorderReservationIds?: Set<string>;
}

type TableStatus = 'free' | 'waiting' | 'under-minimum' | 'on-track' | 'credit-empty' | 'success';

const CANVAS_W = 600;
const CANVAS_H = 400;

export function VipFloorPlan({ 
  floorPlan, 
  reservations,
  consumptions = new Map(),
  selectedTableId,
  onTableSelect,
  mode,
  pendingReservation,
  showBackground = true,
  preorderReservationIds,
}: VipFloorPlanProps) {
  const tables = (floorPlan?.layout?.tables || []) as (FloorPlanTable & { shape?: FloorPlanTableShape; color?: string; borderRadius?: number; fillOpacity?: number })[];
  const zoneAreas = ((floorPlan?.layout as any)?.zoneAreas || []) as ZoneArea[];
  const backgroundUrl = showBackground ? (floorPlan?.backgroundImageUrl || null) : null;
  const bgOffset = (floorPlan?.layout as any)?.bgOffset || { x: 0, y: 0 };
  const bgScale = (floorPlan?.layout as any)?.bgScale || 1;

  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const panStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [bgImageSize, setBgImageSize] = useState({ width: CANVAS_W, height: CANVAS_H });

  useEffect(() => {
    if (!backgroundUrl) {
      setBgImageSize({ width: CANVAS_W, height: CANVAS_H });
      return;
    }
    const image = new window.Image();
    image.onload = () => setBgImageSize({ width: image.naturalWidth || CANVAS_W, height: image.naturalHeight || CANVAS_H });
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
  }), [bgImageSize, bgScale, bgOffset.x, bgOffset.y]);

  // Build zone info from tables
  const zoneInfoMap = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    tables.forEach(t => {
      if (t.zoneId && t.zoneColor) {
        map.set(t.zoneId, { name: (t as any).zoneName || '', color: t.zoneColor });
      }
    });
    return map;
  }, [tables]);

  // Auto-fit viewBox
  const viewBox = useMemo(() => {
    const allItems = [
      ...(backgroundUrl ? [{ x: backgroundRect.x, y: backgroundRect.y, w: backgroundRect.width, h: backgroundRect.height }] : []),
      ...tables.map(t => ({ x: t.x, y: t.y, w: t.width, h: t.height })),
      ...zoneAreas.map(z => ({ x: z.x, y: z.y, w: z.width, h: z.height })),
    ];
    if (allItems.length === 0) return { x: 0, y: 0, w: 400, h: 300 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    allItems.forEach(r => {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h);
    });
    const pad = 30;
    const bottomExtra = zoneAreas.length > 0 ? 24 : 0;
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 + bottomExtra };
  }, [backgroundRect, backgroundUrl, tables, zoneAreas]);

  // Map reservations to tables
  const tableReservationMap = useMemo(() => {
    const map = new Map<string, VipReservation>();
    reservations.forEach(r => {
      if (r.assignedTableId && r.vipStatus !== 'finished') {
        map.set(r.assignedTableId, r);
      }
    });
    return map;
  }, [reservations]);

  const getTableStatus = (tableId: string): TableStatus => {
    const reservation = tableReservationMap.get(tableId);
    if (!reservation) return 'free';
    if (reservation.vipStatus === 'waiting') return 'waiting';
    const tableConsumptions = consumptions.get(reservation.id) || [];
    const totalConsumed = tableConsumptions.reduce((sum, c) => sum + c.totalPrice, 0);
    const hasMinimum = (reservation.minimumSpend || 0) > 0;
    const minimumReached = hasMinimum ? totalConsumed >= reservation.minimumSpend! : true;
    if (!minimumReached) return 'under-minimum';
    if (totalConsumed > 0) return 'success';
    return 'on-track';
  };

  const getStatusStyles = (status: TableStatus) => {
    switch (status) {
      case 'free':
        return { fill: 'hsl(var(--muted)/0.3)', stroke: 'hsl(var(--muted-foreground)/0.4)', textColor: 'hsl(var(--muted-foreground))' };
      case 'waiting':
        return { fill: 'hsl(var(--primary)/0.2)', stroke: 'hsl(var(--primary))', textColor: 'hsl(var(--primary))' };
      case 'under-minimum':
        return { fill: 'rgba(245, 158, 11, 0.2)', stroke: 'rgb(245, 158, 11)', textColor: 'rgb(245, 158, 11)' };
      case 'on-track':
        return { fill: 'rgba(59, 130, 246, 0.2)', stroke: 'rgb(59, 130, 246)', textColor: 'rgb(59, 130, 246)' };
      case 'credit-empty':
        return { fill: 'hsl(var(--destructive)/0.2)', stroke: 'hsl(var(--destructive))', textColor: 'hsl(var(--destructive))' };
      case 'success':
        return { fill: 'rgba(16, 185, 129, 0.2)', stroke: 'rgb(16, 185, 129)', textColor: 'rgb(16, 185, 129)' };
    }
  };

  // Touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      panStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, ox: panOffset.x, oy: panOffset.y };
    }
  }, [panOffset]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (panStart.current && e.touches.length === 1) {
      const dx = e.touches[0].clientX - panStart.current.x;
      const dy = e.touches[0].clientY - panStart.current.y;
      setPanOffset({ x: panStart.current.ox + dx, y: panStart.current.oy + dy });
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    panStart.current = null;
  }, []);

  if (tables.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 bg-muted/30 rounded-xl">
        <p className="text-muted-foreground text-sm">Aucun plan de salle configuré</p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-3">
      <div
        className="relative w-full bg-muted/10 rounded-xl overflow-hidden border border-border/30"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          style={{
            transform: `scale(${zoom}) translate(${panOffset.x / zoom}px, ${panOffset.y / zoom}px)`,
            transformOrigin: 'top left',
            transition: panStart.current ? 'none' : 'transform 0.2s',
          }}
        >
          <svg
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
            className="w-full"
            style={{ minHeight: 280, maxHeight: 500 }}
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Background image */}
            {backgroundUrl && (
              <image
                href={backgroundUrl}
                x={backgroundRect.x}
                y={backgroundRect.y}
                width={backgroundRect.width}
                height={backgroundRect.height}
                preserveAspectRatio="xMidYMid meet"
                opacity={1}
              />
            )}

            {/* Zone Areas */}
            {zoneAreas.map((zoneArea) => {
              const zoneInfo = zoneInfoMap.get(zoneArea.zoneId);
              if (!zoneInfo) return null;
              return (
                <g key={`zone-${zoneArea.id}`}>
                  <rect
                    x={zoneArea.x}
                    y={zoneArea.y}
                    width={zoneArea.width}
                    height={zoneArea.height}
                    rx={zoneArea.borderRadius ?? 8}
                    fill={zoneInfo.color}
                    fillOpacity={zoneArea.fillOpacity ?? 0.08}
                    stroke={zoneInfo.color}
                    strokeWidth={1.5}
                    strokeDasharray="6 3"
                    className="pointer-events-none"
                  />
                  {zoneArea.showLabel !== false && (
                    <text
                      x={zoneArea.x + zoneArea.width / 2 + (zoneArea.labelOffsetX ?? 0)}
                      y={zoneArea.y + zoneArea.height + 14 + (zoneArea.labelOffsetY ?? 0)}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={zoneInfo.color}
                      className="pointer-events-none select-none font-medium"
                      fontSize={zoneArea.labelFontSize ?? 11}
                      transform={zoneArea.labelRotation ? `rotate(${zoneArea.labelRotation}, ${zoneArea.x + zoneArea.width / 2 + (zoneArea.labelOffsetX ?? 0)}, ${zoneArea.y + zoneArea.height + 14 + (zoneArea.labelOffsetY ?? 0)})` : undefined}
                    >
                      {zoneInfo.name}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Tables */}
            {tables.map((table) => {
              const status = getTableStatus(table.id);
              const styles = getStatusStyles(status);
              const isSelected = selectedTableId === table.id;
              const reservation = tableReservationMap.get(table.id);
              const isClickable = mode === 'placement' ? status === 'free' : true;
              const tableColor = table.color || table.zoneColor || styles.stroke;

              let spendingDisplay = '';
              if (reservation) {
                const tableConsumptions = consumptions.get(reservation.id) || [];
                const totalConsumed = tableConsumptions.reduce((sum, c) => sum + c.totalPrice, 0);
                spendingDisplay = `${totalConsumed.toFixed(0)}€`;
              }

              const clientName = reservation?.fullName?.split(' ')[0] || '';
              const guestCount = reservation?.guestCount || 0;
              const hasInfo = !!reservation;
              const shortLabel = table.name.replace(/^table\s*/i, '').trim() || table.name;

              return (
                <g
                  key={table.id}
                  onClick={() => isClickable && onTableSelect(table.id)}
                  className={cn(
                    'cursor-pointer',
                    !isClickable && 'cursor-default opacity-50'
                  )}
                >
                  {isSelected && (
                    <rect
                      x={table.x - 3}
                      y={table.y - 3}
                      width={table.width + 6}
                      height={table.height + 6}
                      rx={table.shape === 'circle' ? 999 : (table.borderRadius ?? 6) + 2}
                      fill="none"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      opacity={0.6}
                    />
                  )}

                  {renderTableShape({
                    shape: table.shape || 'rectangle',
                    x: table.x,
                    y: table.y,
                    width: table.width,
                    height: table.height,
                    fill: hasInfo ? 'rgb(16, 185, 129)' : (tableColor || styles.fill),
                    stroke: hasInfo ? 'rgb(16, 185, 129)' : (tableColor || styles.stroke),
                    strokeWidth: isSelected ? 2 : 1.5,
                    fillOpacity: hasInfo ? 0.85 : (table.fillOpacity ?? 1),
                    borderRadius: table.borderRadius ?? 6,
                  })}

                  <text
                    x={table.x + table.width / 2}
                    y={table.y + table.height / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={hasInfo ? 'white' : styles.textColor}
                    fontSize={Math.min(table.width, table.height) * 0.35}
                    fontWeight={700}
                  >
                    {shortLabel}
                  </text>

                  {/* Pastille dorée : bouteilles pré-commandées à préparer/valider */}
                  {reservation && preorderReservationIds?.has(reservation.id) && (
                    <circle
                      cx={table.x + table.width - 3}
                      cy={table.y + 3}
                      r={4.5}
                      fill="#E7C15A"
                      stroke="#0a0a0c"
                      strokeWidth={1}
                    />
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        {/* Zoom controls */}
        <div className="absolute bottom-3 right-3 flex gap-1.5">
          <Button size="icon" variant="secondary" className="h-10 w-10 rounded-full shadow-md"
            onClick={() => setZoom(z => Math.min(z + 0.25, 2.5))}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="secondary" className="h-10 w-10 rounded-full shadow-md"
            onClick={() => setZoom(z => Math.max(z - 0.25, 0.5))}>
            <ZoomOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 px-1 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 shrink-0 rounded bg-muted/30 border border-muted-foreground/50" />
          <span className="text-muted-foreground">Libre</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 shrink-0 rounded bg-emerald-500/20 border border-emerald-500" />
          <span className="text-muted-foreground">OK</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 shrink-0 rounded bg-amber-500/20 border border-amber-500" />
          <span className="text-muted-foreground">Sous min</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 shrink-0 rounded bg-destructive/20 border border-destructive" />
          <span className="text-muted-foreground">Crédit épuisé</span>
        </div>
      </div>
    </div>
  );
}
