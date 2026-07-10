import type { ActiveEventInfo } from '@/hooks/useLiveNightData';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED    = '#E8192C';
const T3     = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';

interface Props {
  events: ActiveEventInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Pills to pick which event to command when several run tonight. */
export function LiveEventSelector({ events, selectedId, onSelect }: Props) {
  if (events.length < 2) return null;
  const effectiveId = events.find(e => e.id === selectedId)?.id ?? events[0]?.id;

  return (
    <div className="flex items-center gap-0.5 p-1 rounded-xl overflow-x-auto"
      style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      {events.map(ev => (
        <button
          key={ev.id}
          onClick={() => onSelect(ev.id)}
          className="text-[12px] px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          style={effectiveId === ev.id
            ? { background: 'rgba(232,25,44,0.12)', color: RED, fontWeight: 600, border: '1px solid rgba(232,25,44,0.2)' }
            : { color: T3, border: '1px solid transparent' }}
        >
          {ev.title}
        </button>
      ))}
    </div>
  );
}
