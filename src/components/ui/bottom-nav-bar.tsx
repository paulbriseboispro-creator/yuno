"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface BottomNavBarItem {
  key: string;
  label: string;
  icon: LucideIcon;
  isActive: boolean;
  onSelect: () => void;
  /** Petit point rouge posé sur l'icône (ex. mode Live). */
  dot?: boolean;
}

// Barre « pilule » façon Instagram / iOS : des icônes, et l'onglet actif ouvre
// son label en ressort (slide horizontal). Composant présentational contrôlé —
// l'état actif et la navigation viennent du parent (routing Yuno). Le label
// s'anime à l'ouverture ; comme la barre est remontée à chaque page, cette
// animation rejoue à chaque navigation (le nav n'est pas persistant côté Yuno).
export function BottomNavBar({
  items,
  className,
}: {
  items: BottomNavBarItem[];
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const openSpring = reduceMotion
    ? { duration: 0.18 }
    : { type: "spring" as const, stiffness: 360, damping: 30, mass: 0.7 };

  return (
    <nav
      role="navigation"
      aria-label="Bottom Navigation"
      className={cn(
        "flex items-center gap-1 rounded-full border p-1.5 shadow-xl",
        className,
      )}
      style={{
        background: "rgba(20,20,22,0.90)",
        backdropFilter: "blur(20px) saturate(1.6)",
        WebkitBackdropFilter: "blur(20px) saturate(1.6)",
        borderColor: "rgba(255,255,255,0.10)",
        boxShadow:
          "0 8px 30px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.07)",
      }}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.isActive;
        return (
          <motion.button
            key={item.key}
            type="button"
            onClick={item.onSelect}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            whileTap={reduceMotion ? undefined : { scale: 0.92 }}
            transition={{ type: "spring", stiffness: 400, damping: 22 }}
            className={cn(
              "relative flex h-10 min-w-[44px] items-center justify-center rounded-full px-3 outline-none transition-colors duration-200",
              active
                ? "text-primary"
                : "text-muted-foreground [@media(hover:hover)]:hover:bg-white/5 [@media(hover:hover)]:hover:text-primary/80",
            )}
            style={active ? { background: "rgba(232,25,44,0.14)" } : undefined}
          >
            <span className="relative flex shrink-0 items-center justify-center">
              <Icon size={22} strokeWidth={active ? 2.4 : 2} aria-hidden />
              {item.dot && (
                <span
                  aria-hidden
                  className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary"
                  style={{ boxShadow: "0 0 0 2px rgba(20,20,22,1)" }}
                />
              )}
            </span>

            {active && (
              <motion.span
                initial={
                  reduceMotion
                    ? { opacity: 0, marginLeft: 8 }
                    : { width: 0, opacity: 0, marginLeft: 0 }
                }
                animate={
                  reduceMotion
                    ? { opacity: 1, marginLeft: 8 }
                    : { width: "auto", opacity: 1, marginLeft: 8 }
                }
                transition={openSpring}
                className="overflow-hidden whitespace-nowrap font-mono font-bold uppercase"
                style={{ fontSize: "11px", letterSpacing: "0.06em", lineHeight: 1 }}
              >
                {item.label}
              </motion.span>
            )}
          </motion.button>
        );
      })}
    </nav>
  );
}

export default BottomNavBar;
