import { useEffect, useState } from 'react';
import { LucideIcon } from 'lucide-react';

// ─── Yuno pro-dashboard design tokens ─────────────────────────────────────────
const RED = '#E8192C';
const T2 = 'rgba(255,255,255,0.58)';
const BORDER = 'rgba(255,255,255,0.085)';

export interface AnchorSection {
  /** id of the target element to scroll to (must exist in the DOM). */
  id: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Sticky spine for a long analytics scroll: a row of pills that jump to each
 * section and light up the one currently in view. Targets are matched by element
 * id (via getElementById), so callers just put `id` on their section anchors —
 * sections absent from the DOM are simply skipped.
 */
export function AnalyticsAnchorNav({ sections }: { sections: AnchorSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? '');

  useEffect(() => {
    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => !!el);
    if (els.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: [0, 0.25, 0.5, 1] },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [sections]);

  const go = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (sections.length <= 1) return null;

  return (
    <div
      className="sticky top-[60px] sm:top-[68px] z-20 flex gap-1.5 overflow-x-auto no-scrollbar px-1 py-2 rounded-2xl"
      style={{ background: 'rgba(10,10,12,0.72)', backdropFilter: 'blur(10px)' }}
    >
      {sections.map(({ id, label, icon: Icon }) => {
        const on = active === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => go(id)}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-full whitespace-nowrap cursor-pointer transition-colors duration-200 flex-none"
            style={{
              background: on ? 'rgba(232,25,44,0.12)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${on ? 'rgba(232,25,44,0.30)' : BORDER}`,
              color: on ? RED : T2,
              fontSize: 12.5,
              fontWeight: 600,
              backdropFilter: 'blur(8px)',
            }}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
