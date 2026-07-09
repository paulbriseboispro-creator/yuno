import { motion, useReducedMotion } from "framer-motion";
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

// Barre pilule — reproduction fidèle du composant de référence, adaptée DA Yuno
// (design system public). Surface PLEINE #141414 (--yuno-card, pas de
// glassmorphism), rounded-full, bordure subtile, accent rouge #E8192C.
// L'onglet actif prend une pilule rouge translucide où l'icône est suivie de son
// LABEL qui s'OUVRE À DROITE (largeur en ressort). La BottomNav étant remontée à
// chaque page, cette ouverture rejoue à chaque navigation.
export function BottomNavBar({
  items,
  className,
}: {
  items: BottomNavBarItem[];
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <nav
      role="navigation"
      aria-label="Bottom Navigation"
      className={cn("flex items-center gap-1 rounded-full p-1.5", className)}
      style={{
        background: "#141414", // --yuno-card, plein (aucun backdrop-blur)
        border: "1px solid rgba(255,255,255,0.08)", // --border-subtle
        boxShadow: "0 -4px 24px rgba(0,0,0,0.55)",
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
            whileTap={reduceMotion ? undefined : { scale: 0.96 }}
            transition={{ type: "spring", stiffness: 400, damping: 24 }}
            className={cn(
              "relative flex h-10 items-center justify-center rounded-full border border-transparent px-3 outline-none transition-colors duration-200",
              active
                ? "text-primary"
                : "text-muted-foreground [@media(hover:hover)]:hover:bg-white/[0.05] [@media(hover:hover)]:hover:text-primary/80",
            )}
            style={
              active
                ? { background: "rgba(232,25,44,0.12)", borderColor: "rgba(232,25,44,0.28)" }
                : undefined
            }
          >
            <span className="relative flex shrink-0 items-center justify-center">
              <Icon size={22} strokeWidth={active ? 2.3 : 2} aria-hidden />
              {item.dot && (
                <span
                  aria-hidden
                  className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary"
                  style={{ boxShadow: "0 0 0 2px #141414" }}
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
                transition={
                  reduceMotion
                    ? { duration: 0.18 }
                    : {
                        width: { type: "spring", stiffness: 360, damping: 32 },
                        opacity: { duration: 0.2 },
                        marginLeft: { duration: 0.2 },
                      }
                }
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
