import { format, type Locale } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import type { FloorPlanTable, FloorPlanTableShape } from '@/types';


export interface VipZoneStoryData {
  name: string;
  totalTables: number;
  reservedTables: number;
  color?: string;
}

interface ZoneArea {
  id: string;
  zoneId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fillOpacity?: number;
  borderRadius?: number;
  showLabel?: boolean;
  labelOffsetX?: number;
  labelOffsetY?: number;
  labelFontSize?: number;
  labelRotation?: number;
}

export interface VIPTablesProps {
  venueName: string;
  eventTitle: string;
  eventDate: string;
  vipZones: VipZoneStoryData[];
  ctaText: string;
  language: string;
  floorPlan?: { tables: FloorPlanTable[]; width?: number; height?: number; zoneAreas?: ZoneArea[] } | null;
  reservedTableIds?: string[];
  floorPlanBackgroundUrl?: string | null;
  floorPlanBgScale?: number;
  floorPlanBgOffsetX?: number;
  floorPlanBgOffsetY?: number;
  bgColor1?: string;
  bgColor2?: string;
  textColor?: string;
}

const localeMap: Record<string, Locale> = { fr, en: enUS, es };

function renderMiniShape(table: FloorPlanTable, isReserved: boolean) {
  const x = table.x;
  const y = table.y;
  const w = table.width;
  const h = table.height;
  const tableColor = (table as any).color || (table as any).zoneColor || (isReserved ? '#dc2626' : '#3b82f6');
  const fill = isReserved ? '#dc2626' : tableColor;
  const opacity = isReserved ? 0.85 : ((table as any).fillOpacity ?? 0.55);
  const strokeColor = isReserved ? 'rgba(239,68,68,0.7)' : `${tableColor}88`;
  const strokeW = 1.5;
  const shape: FloorPlanTableShape = table.shape || 'rectangle';
  const cx = x + w / 2;
  const cy = y + h / 2;
  const borderRadius = (table as any).borderRadius ?? 6;
  const shortLabel = table.name.replace(/^table\s*/i, '').trim() || table.name;

  let shapeEl: React.ReactNode;
  switch (shape) {
    case 'circle':
      shapeEl = <ellipse cx={cx} cy={cy} rx={w / 2} ry={h / 2} fill={fill} fillOpacity={opacity} stroke={strokeColor} strokeWidth={strokeW} />;
      break;
    case 'diamond': {
      const pts = `${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`;
      shapeEl = <polygon points={pts} fill={fill} fillOpacity={opacity} stroke={strokeColor} strokeWidth={strokeW} />;
      break;
    }
    case 'star': {
      const outerR = Math.min(w, h) / 2;
      const innerR = outerR * 0.45;
      const starPts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (Math.PI / 5) * i - Math.PI / 2;
        starPts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
      }
      shapeEl = <polygon points={starPts.join(' ')} fill={fill} fillOpacity={opacity} stroke={strokeColor} strokeWidth={strokeW} />;
      break;
    }
    default:
      shapeEl = <rect x={x} y={y} width={w} height={h} rx={borderRadius} fill={fill} fillOpacity={opacity} stroke={strokeColor} strokeWidth={strokeW} />;
  }

  return (
    <g key={table.id}>
      {shapeEl}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill="#fff" style={{ fontSize: '8px', fontWeight: 700 }} opacity={0.9}>
        {shortLabel}
      </text>
    </g>
  );
}

export function VIPTablesTemplate({
  venueName,
  eventTitle,
  eventDate,
  vipZones,
  ctaText,
  language,
  floorPlan,
  reservedTableIds = [],
  floorPlanBackgroundUrl,
  floorPlanBgScale = 1,
  floorPlanBgOffsetX = 0,
  floorPlanBgOffsetY = 0,
}: VIPTablesProps) {
  const locale = localeMap[language] || enUS;
  const date = new Date(eventDate);
  const dayName = format(date, 'EEEE', { locale }).toUpperCase();
  const dayNum = format(date, 'd', { locale });
  const month = format(date, 'MMMM', { locale }).toUpperCase();
  const timeStart = format(date, 'HH:mm', { locale });

  const totalTables = vipZones.reduce((sum, z) => sum + z.totalTables, 0);
  const totalReserved = vipZones.reduce((sum, z) => sum + z.reservedTables, 0);
  const totalRemaining = totalTables - totalReserved;
  const globalPct = totalTables > 0 ? Math.round((totalReserved / totalTables) * 100) : 0;

  const reservedSet = new Set(reservedTableIds);
  // Use the original canvas dimensions (600x400) as viewBox
  const CANVAS_W = 600;
  const CANVAS_H = 400;
  const zoneAreas = (floorPlan?.zoneAreas || []) as ZoneArea[];

  // Build zone color map from tables
  const zoneColorMap = new Map<string, string>();
  (floorPlan?.tables || []).forEach((t: any) => {
    if (t.zoneId && t.zoneColor) {
      zoneColorMap.set(t.zoneId, t.zoneColor);
    }
  });

  return (
    <div style={{
      width: 1080, height: 1920, position: 'relative', overflow: 'hidden',
      fontFamily: "'Inter', 'Helvetica Neue', sans-serif", background: '#050505',
    }}>
      {/* BG */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, #150000 0%, #1c0505 18%, #200808 35%, #180303 50%, #0d0000 70%, #050505 90%, #080000 100%)' }} />
      <div style={{ position: 'absolute', top: -180, left: '50%', transform: 'translateX(-50%)', width: 1100, height: 700, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(180,20,20,0.2) 0%, transparent 75%)' }} />
      <div style={{ position: 'absolute', bottom: -80, left: '50%', transform: 'translateX(-50%)', width: 900, height: 400, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(180,20,20,0.1) 0%, transparent 70%)' }} />
      <div style={{ position: 'absolute', inset: 0, opacity: 0.04, backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`, backgroundSize: '200px 200px' }} />
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: 'linear-gradient(180deg, transparent 5%, rgba(220,38,38,0.35) 25%, rgba(220,38,38,0.2) 75%, transparent 95%)' }} />
      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 3, background: 'linear-gradient(180deg, transparent 5%, rgba(220,38,38,0.35) 25%, rgba(220,38,38,0.2) 75%, transparent 95%)' }} />

      {/* CONTENT */}
      <div style={{
        position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column',
        height: '100%', padding: '40px 36px 36px',
      }}>

        {/* Main card container */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          background: 'rgba(255,255,255,0.04)',
          border: '1.5px solid rgba(255,255,255,0.1)',
          borderRadius: 32, padding: '48px 44px 44px',
          backdropFilter: 'blur(8px)',
          boxShadow: '0 8px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}>

          {/* Venue */}
          <p style={{ fontSize: 32, fontWeight: 900, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: 10, textAlign: 'center', marginBottom: 14 }}>
            {venueName}
          </p>

          {/* Title */}
          <h1 style={{
            fontSize: 80, fontWeight: 900, color: '#fff', lineHeight: 0.95,
            textAlign: 'center', textTransform: 'uppercase', marginBottom: 14,
            textShadow: '0 0 60px rgba(220,38,38,0.3), 0 4px 20px rgba(0,0,0,0.8)',
          }}>
            {eventTitle}
          </h1>

          {/* Date */}
          <p style={{ fontSize: 26, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 4, marginBottom: 32 }}>
            {dayName} {dayNum} {month} · {timeStart}
          </p>

          {/* Decorative line */}
          <div style={{ width: 100, height: 2, margin: '0 auto 32px', background: 'linear-gradient(90deg, transparent, #dc2626, transparent)' }} />

          {/* VIP HERO — horizontal layout */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 28,
            background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)',
            borderRadius: 24, padding: '20px 36px',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <p style={{ fontSize: 22, fontWeight: 800, color: '#ef4444', textTransform: 'uppercase', letterSpacing: 6, marginBottom: 4 }}>
                VIP TABLES
              </p>
              <p style={{ fontSize: 20, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: 3 }}>
                DISPONIBLES · {globalPct}% RÉSERVÉ
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontSize: 80, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{totalRemaining}</span>
              <span style={{ fontSize: 30, fontWeight: 700, color: 'rgba(255,255,255,0.3)' }}>/ {totalTables}</span>
            </div>
          </div>

          {/* ZONES */}
          <div style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 22, fontWeight: 800, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 6, marginBottom: 18 }}>
              PAR ZONE
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {vipZones.map((zone, i) => {
                const pct = zone.totalTables > 0 ? Math.min((zone.reservedTables / zone.totalTables) * 100, 100) : 0;
                const soldOut = pct >= 100;
                const remaining = zone.totalTables - zone.reservedTables;
                return (
                  <div key={i} style={{
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 18, padding: '16px 24px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 18, height: 18, borderRadius: '50%', background: zone.color || '#ef4444', flexShrink: 0, boxShadow: `0 0 10px ${zone.color || '#ef4444'}80` }} />
                        <span style={{ fontSize: 32, fontWeight: 900, color: '#fff', textTransform: 'uppercase' }}>{zone.name}</span>
                      </div>
                      {soldOut ? (
                        <span style={{ fontSize: 20, fontWeight: 900, color: '#fff', background: '#dc2626', padding: '8px 24px', borderRadius: 24, letterSpacing: 2 }}>COMPLET</span>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                          <span style={{ fontSize: 38, fontWeight: 900, color: '#ef4444' }}>{remaining}</span>
                          <span style={{ fontSize: 22, fontWeight: 600, color: 'rgba(255,255,255,0.3)' }}>/ {zone.totalTables}</span>
                        </div>
                      )}
                    </div>
                    <div style={{ width: '100%', height: 14, borderRadius: 8, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                      <div style={{
                        width: `${pct}%`, height: '100%', borderRadius: 8,
                        background: soldOut ? '#dc2626' : 'linear-gradient(90deg, #dc2626, #ef4444)',
                        boxShadow: pct > 50 ? '0 0 12px rgba(220,38,38,0.4)' : 'none',
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* FLOOR PLAN */}
          {floorPlan && floorPlan.tables.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 22, fontWeight: 800, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 6, marginBottom: 14 }}>
                PLAN DE SALLE
              </p>
              <div style={{
                display: 'flex', justifyContent: 'center',
                border: '1px solid rgba(220,38,38,0.15)', borderRadius: 20, padding: '16px 12px',
                overflow: 'hidden', position: 'relative',
                background: floorPlanBackgroundUrl ? 'transparent' : 'linear-gradient(180deg, rgba(20,0,0,0.5) 0%, rgba(10,0,0,0.8) 100%)',
              }}>
                <div style={{ position: 'relative', width: '100%' }}>
                  <svg viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} style={{ display: 'block', width: '100%' }} preserveAspectRatio="xMidYMid meet">
                    <defs>
                      <clipPath id="fpClip"><rect width={CANVAS_W} height={CANVAS_H} rx={8} /></clipPath>
                    </defs>
                    {/* Background image */}
                    {floorPlanBackgroundUrl ? (
                      <>
                        <image
                          href={floorPlanBackgroundUrl}
                          x={0}
                          y={0}
                          width={CANVAS_W}
                          height={CANVAS_H}
                          preserveAspectRatio="xMidYMid slice"
                          clipPath="url(#fpClip)"
                        />
                        <rect width={CANVAS_W} height={CANVAS_H} fill="rgba(0,0,0,0.2)" />
                      </>
                    ) : (
                      <rect width={CANVAS_W} height={CANVAS_H} fill="rgba(10,0,0,0.6)" />
                    )}
                    {/* Zone areas */}
                    {zoneAreas.map((za) => {
                      const zColor = zoneColorMap.get(za.zoneId) || '#ef4444';
                      return (
                        <g key={`za-${za.id}`}>
                          <rect
                            x={za.x} y={za.y} width={za.width} height={za.height} rx={za.borderRadius ?? 8}
                            fill={zColor} fillOpacity={za.fillOpacity ?? 0.04}
                            stroke={zColor} strokeWidth={0.5} strokeOpacity={0.3} strokeDasharray="4 3"
                          />
                          {za.showLabel !== false && (
                            <text
                              x={za.x + za.width / 2 + (za.labelOffsetX ?? 0)}
                              y={za.y + za.height + 13 + (za.labelOffsetY ?? 0)}
                              textAnchor="middle" dominantBaseline="middle" fill={zColor}
                              opacity={0.6}
                              transform={`rotate(${za.labelRotation ?? 0}, ${za.x + za.width / 2 + (za.labelOffsetX ?? 0)}, ${za.y + za.height + 13 + (za.labelOffsetY ?? 0)})`}
                              style={{ fontSize: `${za.labelFontSize ?? 10}px`, fontWeight: 500, letterSpacing: '0.03em' }}
                            >
                              {(() => {
                                const info = vipZones.find(z => {
                                  const tableInZone = floorPlan.tables.find((t: any) => t.zoneId === za.zoneId);
                                  return tableInZone && (tableInZone as any).zoneName === z.name;
                                });
                                return info?.name || '';
                              })()}
                            </text>
                          )}
                        </g>
                      );
                    })}
                    {/* Tables */}
                    {floorPlan.tables.map((table) => renderMiniShape(table, reservedSet.has(table.id)))}
                  </svg>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, marginTop: 10, paddingRight: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 14, height: 14, borderRadius: 3, background: 'rgba(255,255,255,0.35)' }} />
                      <span style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.4)' }}>Disponible</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 14, height: 14, borderRadius: 3, background: '#dc2626', opacity: 0.85 }} />
                      <span style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.4)' }}>Réservé</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div style={{ flex: 1 }} />

          {/* CTA */}
          <div style={{ textAlign: 'center', marginBottom: 0 }}>
            <div style={{
              display: 'inline-block',
              background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 50%, #b91c1c 100%)',
              padding: '32px 100px', borderRadius: 50,
              boxShadow: '0 0 50px rgba(220,38,38,0.5), 0 12px 40px rgba(220,38,38,0.3)',
            }}>
              <span style={{ fontSize: 36, fontWeight: 900, color: '#fff', textTransform: 'uppercase', letterSpacing: 4 }}>{ctaText}</span>
            </div>
          </div>

        </div>{/* end card */}

        {/* YUNO — outside the card */}
        <div style={{ textAlign: 'center', paddingTop: 24, paddingBottom: 4 }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.2)', letterSpacing: 5, marginBottom: 8, textTransform: 'uppercase' }}>Powered by</p>
          <p style={{ fontSize: 56, fontWeight: 900, color: 'rgba(255,255,255,0.55)', letterSpacing: 16, marginBottom: 6, lineHeight: 1 }}>YUNO</p>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.2)', fontWeight: 700, letterSpacing: 4 }}>BUILT FOR NIGHTLIFE, MADE FOR YOUR NIGHT</p>
        </div>
      </div>
    </div>
  );
}
