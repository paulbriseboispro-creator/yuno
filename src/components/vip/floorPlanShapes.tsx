import { FloorPlanTableShape } from '@/types';

/**
 * Renders an SVG shape for a floor plan table.
 * Supports rectangle, circle, diamond, and star.
 */
export function renderTableShape({
  shape = 'rectangle',
  x,
  y,
  width,
  height,
  fill,
  stroke,
  strokeWidth = 2,
  fillOpacity,
  borderRadius,
  className,
  onClick,
  onMouseDown,
  onTouchStart,
  onMouseEnter,
  onMouseLeave,
  style,
  strokeDasharray,
  children,
}: {
  shape?: FloorPlanTableShape;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth?: number;
  fillOpacity?: number;
  borderRadius?: number;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  onMouseDown?: (e: React.MouseEvent | React.TouchEvent) => void;
  onTouchStart?: (e: React.MouseEvent | React.TouchEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  style?: React.CSSProperties;
  strokeDasharray?: string;
  children?: React.ReactNode;
}) {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const rx = width / 2;
  const ry = height / 2;

  const commonProps = {
    fill,
    stroke,
    strokeWidth,
    fillOpacity,
    strokeDasharray,
    className,
    onClick,
    onMouseDown,
    onTouchStart,
    onMouseEnter,
    onMouseLeave,
    style,
  };

  switch (shape) {
    case 'circle':
      return (
        <g>
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} {...commonProps} />
          {children}
        </g>
      );

    case 'diamond': {
      const points = `${cx},${y} ${x + width},${cy} ${cx},${y + height} ${x},${cy}`;
      return (
        <g>
          <polygon points={points} {...commonProps} />
          {children}
        </g>
      );
    }

    case 'star': {
      const outerR = Math.min(rx, ry);
      const innerR = outerR * 0.45;
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (Math.PI / 5) * i - Math.PI / 2;
        pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
      }
      return (
        <g>
          <polygon points={pts.join(' ')} {...commonProps} />
          {children}
        </g>
      );
    }

    case 'rectangle':
    default:
      return (
        <g>
          <rect x={x} y={y} width={width} height={height} rx={borderRadius ?? 6} {...commonProps} />
          {children}
        </g>
      );
  }
}

/** Returns a small SVG icon preview of a shape */
export function ShapeIcon({ shape, size = 20, color = 'currentColor' }: { shape: FloorPlanTableShape; size?: number; color?: string }) {
  const half = size / 2;
  const p = 2;
  switch (shape) {
    case 'circle':
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <ellipse cx={half} cy={half} rx={half - p} ry={half - p} fill="none" stroke={color} strokeWidth={1.5} />
        </svg>
      );
    case 'diamond': {
      const pts = `${half},${p} ${size - p},${half} ${half},${size - p} ${p},${half}`;
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <polygon points={pts} fill="none" stroke={color} strokeWidth={1.5} />
        </svg>
      );
    }
    case 'star': {
      const outerR = half - p;
      const innerR = outerR * 0.45;
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (Math.PI / 5) * i - Math.PI / 2;
        pts.push(`${half + r * Math.cos(angle)},${half + r * Math.sin(angle)}`);
      }
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <polygon points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.5} />
        </svg>
      );
    }
    case 'rectangle':
    default:
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <rect x={p} y={p} width={size - p * 2} height={size - p * 2} rx={2} fill="none" stroke={color} strokeWidth={1.5} />
        </svg>
      );
  }
}
