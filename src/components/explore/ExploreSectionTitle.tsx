import { ChevronRight } from 'lucide-react';

interface ExploreSectionTitleProps {
  kicker?: string;
  title: string;
  action?: string;
  onAction?: () => void;
  /** Keep the title on a single line (no wrap). */
  titleNoWrap?: boolean;
}

export function ExploreSectionTitle({ kicker, title, action, onAction, titleNoWrap }: ExploreSectionTitleProps) {
  return (
    <div className="flex items-end justify-between mb-3.5" style={{ paddingLeft: 20, paddingRight: 20 }}>
      <div style={titleNoWrap ? { minWidth: 0 } : undefined}>
        {kicker && (
          <p
            className="font-mono mb-1.5"
            style={{ fontSize: '10.5px', letterSpacing: '0.14em', color: '#65656F' }}
          >
            {kicker}
          </p>
        )}
        <h2
          className="font-display font-bold"
          style={{
            fontSize: '21px',
            color: '#fff',
            letterSpacing: '-0.01em',
            lineHeight: 1.1,
            margin: 0,
            ...(titleNoWrap ? { whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' } : null),
          }}
        >
          {title}
        </h2>
      </div>
      {action && onAction && (
        <button
          onClick={onAction}
          className="flex items-center gap-0.5 font-mono font-semibold shrink-0"
          style={{ fontSize: '11.5px', color: '#E8192C', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          {action}
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
