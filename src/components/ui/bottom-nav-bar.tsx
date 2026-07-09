import { useLayoutEffect, useRef } from "react";
import { animate, motion, useMotionValue, useReducedMotion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface BottomNavBarItem {
  key: string;
  label: string;
  icon: LucideIcon;
  isActive: boolean;
  onSelect: () => void;
  /** Point rouge posé sur l'icône (ex. mode Live). */
  dot?: boolean;
}

// Mémoire d'onglet actif HORS React. La BottomNav est remontée à chaque page
// (montée par page côté Yuno, pas persistante). En gardant l'onglet actif
// précédent ici, l'indicateur peut PARTIR de l'onglet précédent et GLISSER
// vers le nouvel onglet à chaque navigation → vrai slider inter-onglet.
let lastActiveKey: string | null = null;

// Ressort signature Yuno (cf. src/lib/motion.ts / DESIGN_SYSTEM_PUBLIC).
const SLIDE_SPRING = { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.8 };

// Barre de navigation basse — design system public (éditorial nightlife) :
// surface pleine #141414 (PAS de glassmorphism / backdrop-blur), bordure subtile,
// labels mono uppercase, accent rouge #E8192C. Un indicateur rouge plein glisse
// d'un onglet à l'autre.
export function BottomNavBar({
  items,
  className,
}: {
  items: BottomNavBarItem[];
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const left = useMotionValue(0);
  const width = useMotionValue(0);
  const opacity = useMotionValue(0);

  const activeIndex = items.findIndex((it) => it.isActive);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const rectOf = (idx: number) => {
      const el = idx >= 0 ? tabRefs.current[idx] : null;
      if (!el) return null;
      return { l: el.offsetLeft, w: el.offsetWidth };
    };

    const cur = rectOf(activeIndex);
    if (!cur) {
      // Aucun onglet actif sur cette page → indicateur masqué (on garde la
      // mémoire pour pouvoir glisser depuis le dernier onglet réel ensuite).
      opacity.set(0);
      return;
    }

    opacity.set(1);

    const prevIndex = lastActiveKey ? items.findIndex((it) => it.key === lastActiveKey) : -1;
    const prev = prevIndex >= 0 && prevIndex !== activeIndex ? rectOf(prevIndex) : null;

    let a1: { stop: () => void } | undefined;
    let a2: { stop: () => void } | undefined;
    if (prev && !reduceMotion) {
      left.set(prev.l);
      width.set(prev.w);
      a1 = animate(left, cur.l, SLIDE_SPRING);
      a2 = animate(width, cur.w, SLIDE_SPRING);
    } else {
      left.set(cur.l);
      width.set(cur.w);
    }
    lastActiveKey = items[activeIndex].key;

    const onResize = () => {
      const r = rectOf(activeIndex);
      if (r) {
        left.set(r.l);
        width.set(r.w);
      }
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      a1?.stop();
      a2?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, reduceMotion, items.length]);

  return (
    <div
      ref={containerRef}
      role="navigation"
      aria-label="Bottom Navigation"
      className={cn("relative flex items-stretch justify-around", className)}
      style={{
        background: "#141414", // --yuno-card, surface pleine (pas de glass)
        border: "1px solid rgba(255,255,255,0.08)", // --border-subtle
        borderRadius: 14, // --radius-xl
        boxShadow: "0 -4px 24px rgba(0,0,0,0.55)",
        padding: "6px 8px",
      }}
    >
      {/* Indicateur rouge plein qui glisse d'un onglet à l'autre */}
      {activeIndex >= 0 && (
        <motion.span
          aria-hidden
          className="absolute top-1.5 bottom-1.5 pointer-events-none"
          style={{
            left,
            width,
            opacity,
            background: "rgba(232,25,44,0.14)", // ~ --yuno-red-dim/soft
            border: "1px solid rgba(232,25,44,0.30)",
            borderRadius: 10, // --radius-lg
          }}
        />
      )}

      {items.map((item, idx) => {
        const Icon = item.icon;
        const active = item.isActive;
        return (
          <motion.button
            key={item.key}
            ref={(el) => {
              tabRefs.current[idx] = el;
            }}
            type="button"
            onClick={item.onSelect}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            whileTap={reduceMotion ? undefined : { scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 22 }}
            className="relative z-10 flex min-w-[52px] flex-col items-center justify-center gap-0.5 rounded-[10px] px-2 py-1.5 outline-none"
          >
            <span className="relative flex items-center justify-center">
              <Icon
                size={22}
                strokeWidth={active ? 2.4 : 1.8}
                aria-hidden
                className={cn(
                  "transition-colors duration-200",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              />
              {item.dot && (
                <span
                  aria-hidden
                  className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary"
                  style={{ boxShadow: "0 0 0 2px #141414" }}
                />
              )}
            </span>
            <span
              className={cn(
                "font-mono uppercase leading-tight transition-colors duration-200",
                active ? "text-primary font-bold" : "text-muted-foreground font-medium",
              )}
              style={{ fontSize: "9px", letterSpacing: "0.08em" }}
            >
              {item.label}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

export default BottomNavBar;
