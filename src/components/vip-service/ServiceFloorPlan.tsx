import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { VenueFloorPlan, FloorPlanTable } from '@/types';
import { cn } from '@/lib/utils';
import { renderTableShape } from '@/components/vip/floorPlanShapes';
import { getFittedBackgroundRect } from '@/lib/floorPlanBackground';
import { useLanguage } from '@/contexts/LanguageContext';
import { ZoomIn, ZoomOut } from 'lucide-react';
import {
  ServiceReservation, TableServiceInfo, TABLE_STATE_COLORS, tableVisualState, fmtEuro,
} from './serviceTypes';

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

interface ServiceFloorPlanProps {
  floorPlan: VenueFloorPlan | null;
  reservations: ServiceReservation[];
  serviceInfo: Map<string, TableServiceInfo>;
  mode: 'live' | 'pick';
  /** pick : table actuellement choisie. */
  selectedTableId?: string | null;
  /** pick : table demandée par le client au checkout (anneau rouge pulsé). */
  highlightTableId?: string | null;
  showBackground?: boolean;
  /** Aperçu : aucune interaction (pas de tap), légende simplifiée sans consommation.
   *  Sert à montrer qui est placé à une partie qui ne fait pas le service. */
  readOnly?: boolean;
  onTableTap: (tableId: string, reservation?: ServiceReservation) => void;
}

const CANVAS_W = 600;
const CANVAS_H = 400;

/**
 * Plan de salle en mode service : chaque table raconte son état d'un coup
 * d'œil (libre / demandée / sous minimum / en bonne voie / au-delà du crédit),
 * avec les alertes commandes (badge rouge) et pré-commandes (pastille or).
 * Pan 1 doigt, pinch 2 doigts, boutons zoom.
 */
export function ServiceFloorPlan({
  floorPlan,
  reservations,
  serviceInfo,
  mode,
  selectedTableId,
  highlightTableId,
  showBackground = true,
  readOnly = false,
  onTableTap,
}: ServiceFloorPlanProps) {
  const { t, language } = useLanguage();
  const tables = (floorPlan?.layout?.tables || []) as FloorPlanTable[];
  const zoneAreas = (floorPlan?.layout?.zoneAreas || []) as ZoneArea[];
  const backgroundUrl = showBackground ? floorPlan?.backgroundImageUrl || null : null;
  const bgOffset = floorPlan?.layout?.bgOffset || { x: 0, y: 0 };
  const bgScale = floorPlan?.layout?.bgScale || 1;

  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const gesture = useRef<
    | { kind: 'pan'; x: number; y: number; ox: number; oy: number }
    | { kind: 'pinch'; dist: number; zoom: number }
    | null
  >(null);
  const [bgImageSize, setBgImageSize] = useState({ width: CANVAS_W, height: CANVAS_H });

  useEffect(() => {
    if (!backgroundUrl) {
      setBgImageSize({ width: CANVAS_W, height: CANVAS_H });
      return;
    }
    const image = new window.Image();
    image.onload = () =>
      setBgImageSize({ width: image.naturalWidth || CANVAS_W, height: image.naturalHeight || CANVAS_H });
    image.src = backgroundUrl;
  }, [backgroundUrl]);

  const backgroundRect = useMemo(
    () =>
      getFittedBackgroundRect({
        canvasWidth: CANVAS_W,
        canvasHeight: CANVAS_H,
        imageWidth: bgImageSize.width,
        imageHeight: bgImageSize.height,
        scale: bgScale,
        offsetX: bgOffset.x,
        offsetY: bgOffset.y,
      }),
    [bgImageSize, bgScale, bgOffset.x, bgOffset.y]
  );

  const zoneInfoMap = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    tables.forEach(tb => {
      if (tb.zoneId && tb.zoneColor) {
        map.set(tb.zoneId, { name: (tb as FloorPlanTable & { zoneName?: string }).zoneName || '', color: tb.zoneColor });
      }
    });
    return map;
  }, [tables]);

  const viewBox = useMemo(() => {
    const allItems = [
      ...(backgroundUrl
        ? [{ x: backgroundRect.x, y: backgroundRect.y, w: backgroundRect.width, h: backgroundRect.height }]
        : []),
      ...tables.map(tb => ({ x: tb.x, y: tb.y, w: tb.width, h: tb.height })),
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

  // Une table ↔ la résa installée dessus ; et les tables demandées par des
  // clients pas encore installés.
  const seatedByTable = useMemo(() => {
    const map = new Map<string, ServiceReservation>();
    reservations.forEach(r => {
      if (r.assignedTableId && (r.vipStatus === 'placed' || r.vipStatus === 'active')) {
        map.set(r.assignedTableId, r);
      }
    });
    return map;
  }, [reservations]);

  const requestedByTable = useMemo(() => {
    const map = new Map<string, ServiceReservation>();
    reservations.forEach(r => {
      if (
        r.requestedTableId &&
        !r.assignedTableId &&
        r.vipStatus === 'waiting' &&
        r.placementStatus === 'requested'
      ) {
        map.set(r.requestedTableId, r);
      }
    });
    return map;
  }, [reservations]);

  // ─── Gestes tactiles : pan 1 doigt, pinch 2 doigts ─────────────────────────

  const touchDist = (e: React.TouchEvent) => {
    const [a, b] = [e.touches[0], e.touches[1]];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        gesture.current = { kind: 'pinch', dist: touchDist(e), zoom };
      } else if (e.touches.length === 1) {
        gesture.current = {
          kind: 'pan',
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          ox: panOffset.x,
          oy: panOffset.y,
        };
      }
    },
    [panOffset, zoom]
  );

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch' && e.touches.length === 2) {
      const ratio = touchDist(e) / g.dist;
      setZoom(Math.min(3, Math.max(0.5, g.zoom * ratio)));
    } else if (g.kind === 'pan' && e.touches.length === 1) {
      const dx = e.touches[0].clientX - g.x;
      const dy = e.touches[0].clientY - g.y;
      setPanOffset({ x: g.ox + dx, y: g.oy + dy });
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    gesture.current = null;
  }, []);

  if (tables.length === 0) {
    return (
      <div
        className="flex h-56 items-center justify-center rounded-2xl"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.085)' }}
      >
        <p style={{ color: 'rgba(255,255,255,0.36)', fontSize: 13 }}>{t('vipHost.noFloorPlan')}</p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-2">
      <div
        className="relative w-full touch-none overflow-hidden rounded-2xl"
        style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.085)' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          style={{
            transform: `scale(${zoom}) translate(${panOffset.x / zoom}px, ${panOffset.y / zoom}px)`,
            transformOrigin: 'top left',
            transition: gesture.current ? 'none' : 'transform 0.2s',
          }}
        >
          <svg
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
            className="w-full"
            style={{ minHeight: 300, maxHeight: mode === 'live' ? 560 : 440 }}
            preserveAspectRatio="xMidYMid meet"
          >
            {backgroundUrl && (
              <image
                href={backgroundUrl}
                x={backgroundRect.x}
                y={backgroundRect.y}
                width={backgroundRect.width}
                height={backgroundRect.height}
                preserveAspectRatio="xMidYMid meet"
                opacity={0.9}
              />
            )}

            {zoneAreas.map(zoneArea => {
              const zoneInfo = zoneInfoMap.get(zoneArea.zoneId);
              if (!zoneInfo) return null;
              const labelX = zoneArea.x + zoneArea.width / 2 + (zoneArea.labelOffsetX ?? 0);
              const labelY = zoneArea.y + zoneArea.height + 14 + (zoneArea.labelOffsetY ?? 0);
              return (
                <g key={`zone-${zoneArea.id}`}>
                  <rect
                    x={zoneArea.x}
                    y={zoneArea.y}
                    width={zoneArea.width}
                    height={zoneArea.height}
                    rx={zoneArea.borderRadius ?? 8}
                    fill={zoneInfo.color}
                    fillOpacity={zoneArea.fillOpacity ?? 0.07}
                    stroke={zoneInfo.color}
                    strokeOpacity={0.6}
                    strokeWidth={1.25}
                    strokeDasharray="6 3"
                    className="pointer-events-none"
                  />
                  {zoneArea.showLabel !== false && (
                    <text
                      x={labelX}
                      y={labelY}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={zoneInfo.color}
                      className="pointer-events-none select-none font-medium"
                      fontSize={zoneArea.labelFontSize ?? 11}
                      transform={
                        zoneArea.labelRotation
                          ? `rotate(${zoneArea.labelRotation}, ${labelX}, ${labelY})`
                          : undefined
                      }
                    >
                      {zoneInfo.name}
                    </text>
                  )}
                </g>
              );
            })}

            {tables.map(table => {
              const seated = seatedByTable.get(table.id);
              const requestedBy = requestedByTable.get(table.id);
              const info = seated ? serviceInfo.get(seated.id) : undefined;
              const state = tableVisualState(seated, info, requestedBy);
              const colors = TABLE_STATE_COLORS[state];
              const isSelected = selectedTableId === table.id;
              const isHighlight = highlightTableId === table.id;
              const isClickable = readOnly ? false : (mode === 'pick' ? !seated : true);

              const shortLabel = table.name.replace(/^table\s*/i, '').trim() || table.name;
              const compact = Math.min(table.width, table.height) < 26;
              const cx = table.x + table.width / 2;
              const spend = info ? fmtEuro(info.consumed) : '';
              const firstName = seated?.fullName?.split(' ')[0] || '';
              const alertCount = info ? info.pendingOrders : 0;
              const hasPreorder = !!info && info.preorders > 0;

              return (
                <g
                  key={table.id}
                  onClick={() => isClickable && onTableTap(table.id, seated)}
                  className={cn('cursor-pointer', !isClickable && (readOnly ? 'cursor-default' : 'cursor-default opacity-45'))}
                >
                  {(isSelected || isHighlight) && (
                    <rect
                      x={table.x - 3.5}
                      y={table.y - 3.5}
                      width={table.width + 7}
                      height={table.height + 7}
                      rx={table.shape === 'circle' ? 999 : (table.borderRadius ?? 6) + 2}
                      fill="none"
                      stroke="#E8192C"
                      strokeWidth={2}
                      opacity={0.85}
                    >
                      {isHighlight && !isSelected && (
                        <animate attributeName="opacity" values="0.85;0.25;0.85" dur="1.6s" repeatCount="indefinite" />
                      )}
                    </rect>
                  )}

                  {renderTableShape({
                    shape: table.shape || 'rectangle',
                    x: table.x,
                    y: table.y,
                    width: table.width,
                    height: table.height,
                    fill: state === 'free' ? table.color || table.zoneColor || colors.fill : colors.fill,
                    stroke: state === 'free' ? table.color || table.zoneColor || colors.stroke : colors.stroke,
                    strokeWidth: seated ? 1.75 : 1.25,
                    fillOpacity: state === 'free' ? Math.min(table.fillOpacity ?? 0.35, 0.35) : 1,
                    borderRadius: table.borderRadius ?? 6,
                    strokeDasharray: state === 'requested' ? '4 3' : undefined,
                  })}

                  {seated && !compact ? (
                    <>
                      <text x={cx} y={table.y + table.height * 0.28} textAnchor="middle" dominantBaseline="middle"
                        fill={colors.text} fontSize={Math.min(table.width, table.height) * 0.22} fontWeight={600} opacity={0.75}>
                        {shortLabel}
                      </text>
                      <text x={cx} y={table.y + table.height * 0.52} textAnchor="middle" dominantBaseline="middle"
                        fill={colors.text} fontSize={Math.min(table.width, table.height) * 0.26} fontWeight={700}>
                        {firstName}
                      </text>
                      <text x={cx} y={table.y + table.height * 0.78} textAnchor="middle" dominantBaseline="middle"
                        fill={colors.text} fontSize={Math.min(table.width, table.height) * 0.24} fontWeight={600} opacity={0.9}>
                        {spend}
                      </text>
                    </>
                  ) : (
                    <text x={cx} y={table.y + table.height / 2} textAnchor="middle" dominantBaseline="middle"
                      fill={colors.text} fontSize={Math.min(table.width, table.height) * 0.35} fontWeight={700}>
                      {shortLabel}
                    </text>
                  )}

                  {/* Pastille or : pré-commande à valider */}
                  {hasPreorder && (
                    <circle cx={table.x + table.width - 3} cy={table.y + 3} r={4.5}
                      fill="#E7C15A" stroke="#0a0a0c" strokeWidth={1} />
                  )}

                  {/* Badge rouge : commandes client en attente */}
                  {alertCount > 0 && (
                    <g>
                      <circle cx={table.x + 2} cy={table.y + 2} r={6.5} fill="#E8192C" stroke="#0a0a0c" strokeWidth={1}>
                        <animate attributeName="r" values="6.5;7.5;6.5" dur="1.2s" repeatCount="indefinite" />
                      </circle>
                      <text x={table.x + 2} y={table.y + 2.5} textAnchor="middle" dominantBaseline="middle"
                        fill="#fff" fontSize={8} fontWeight={800}>
                        {alertCount}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        <div className="absolute bottom-3 right-3 flex gap-1.5">
          <button
            type="button"
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full backdrop-blur"
            style={{ background: 'rgba(20,20,24,0.85)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.8)' }}
            onClick={() => setZoom(z => Math.min(z + 0.3, 3))}
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full backdrop-blur"
            style={{ background: 'rgba(20,20,24,0.85)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.8)' }}
            onClick={() => {
              setZoom(1);
              setPanOffset({ x: 0, y: 0 });
            }}
          >
            <ZoomOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Légende — service complet, ou version simplifiée en aperçu lecture seule
          (pas de consommation à montrer à qui ne fait pas le service). */}
      {readOnly ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-1" style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)' }}>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.3)' }} />
            {language === 'fr' ? 'Libre' : language === 'es' ? 'Libre' : 'Free'}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded" style={{ background: 'rgba(232,25,44,0.16)', border: '1px dashed #E8192C' }} />
            {language === 'fr' ? 'Table demandée' : language === 'es' ? 'Mesa solicitada' : 'Requested'}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded" style={{ background: 'rgba(16,185,129,0.35)', border: '1px solid rgb(16,185,129)' }} />
            {language === 'fr' ? 'Placé' : language === 'es' ? 'Sentado' : 'Seated'}
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-1" style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)' }}>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.3)' }} />
            {t('vipHost.legendFree')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded" style={{ background: 'rgba(245,158,11,0.3)', border: '1px solid rgb(245,158,11)' }} />
            {t('vipHost.legendUnderMin')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded" style={{ background: 'rgba(16,185,129,0.35)', border: '1px solid rgb(16,185,129)' }} />
            {t('vipnight.legendOk')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded" style={{ background: 'rgba(231,193,90,0.35)', border: '1px solid #E7C15A' }} />
            {t('vipnight.legendExtra')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded" style={{ background: 'rgba(232,25,44,0.16)', border: '1px dashed #E8192C' }} />
            {t('vipnight.legendRequested')}
          </span>
        </div>
      )}
    </div>
  );
}
