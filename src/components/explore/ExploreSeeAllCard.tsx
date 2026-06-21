import { ArrowRight } from 'lucide-react';

interface ExploreSeeAllCardProps {
  label: string;
  onClick: () => void;
  /** Match the neighbouring card width. */
  width: number;
  /** Match the neighbouring card height (the row stretches to the tallest sibling). */
  minHeight: number;
  /** Match the neighbouring card corner radius. */
  borderRadius: number;
}

/**
 * Trailing affordance shown at the END of an Explore carousel when the list is
 * capped (at its max number of items). Replaces the header "Tout voir" link so
 * the section title can render in full without being truncated.
 */
export function ExploreSeeAllCard({ label, onClick, width, minHeight, borderRadius }: ExploreSeeAllCardProps) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 flex flex-col items-center justify-center gap-2.5"
      style={{
        width,
        minHeight,
        alignSelf: 'stretch',
        borderRadius,
        background: '#141417',
        border: '1px dashed rgba(255,255,255,0.14)',
        cursor: 'pointer',
      }}
      aria-label={label}
    >
      <span
        className="flex items-center justify-center rounded-full"
        style={{
          width: 42,
          height: 42,
          background: 'rgba(232,25,44,0.12)',
          border: '1px solid rgba(232,25,44,0.4)',
        }}
      >
        <ArrowRight className="h-4 w-4" style={{ color: '#E8192C' }} />
      </span>
      <span
        className="font-mono font-semibold"
        style={{ fontSize: '11.5px', color: '#E8192C', letterSpacing: '0.02em' }}
      >
        {label}
      </span>
    </button>
  );
}
