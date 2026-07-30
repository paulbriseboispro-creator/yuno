import type { ReactNode } from 'react';

/* ============================================================
   Primitives de la timeline éditoriale (design system public).

   Nées sur les pages Agenda, adoptées par les linktrees : label de
   mois « ruled » rouge + rail de jour (jour de semaine, gros
   numéro, filet vertical). Les cartes restent propres à chaque
   page (logique de clic/tracking différente) — ici uniquement la
   structure visuelle.
   ============================================================ */

const MONO = "'JetBrains Mono', monospace";
const GROTESK = "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif";

/** Label de section « ruled » : tiret rouge, libellé mono, filet, compteur optionnel. */
export function MonthLabel({ children, count, countLabel }: { children: ReactNode; count?: number; countLabel?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '30px 4px 16px' }}>
      <span style={{ width: '22px', height: '2px', background: '#E8192C', flexShrink: 0 }} aria-hidden="true" />
      <h2
        style={{
          fontFamily: MONO, fontSize: '12px', fontWeight: 700, color: '#E5E5E5',
          letterSpacing: '0.22em', textTransform: 'uppercase' as const, margin: 0, whiteSpace: 'nowrap' as const,
        }}
      >
        {children}
      </h2>
      <span style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} aria-hidden="true" />
      {typeof count === 'number' && (
        <span style={{ fontFamily: MONO, fontSize: '10px', color: '#3A3A3E', letterSpacing: '0.14em', textTransform: 'uppercase' as const, whiteSpace: 'nowrap' as const }}>
          {count} {countLabel ?? ''}
        </span>
      )}
    </div>
  );
}

/** Rail de jour : jour de semaine mono + gros numéro + filet vertical, cartes à droite. */
export function DayRow({ weekday, day, children }: { weekday: string; day: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
      <div style={{ width: '46px', minWidth: '46px', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '8px' }}>
        <span style={{ fontFamily: MONO, fontSize: '10px', fontWeight: 600, color: '#5A5A5E', letterSpacing: '0.14em', textTransform: 'uppercase' as const }}>
          {weekday}
        </span>
        <span style={{ fontFamily: GROTESK, fontSize: '26px', fontWeight: 700, color: '#FFFFFF', lineHeight: 1.05, letterSpacing: '-0.02em' }}>
          {day}
        </span>
        <span style={{ width: '1px', flex: 1, background: 'rgba(255,255,255,0.08)', marginTop: '6px' }} aria-hidden="true" />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  );
}

/** Regroupe des groupes-jour (clé yyyy-MM-dd) en mois. Les groupes dont la clé
 *  n'est pas une date (genre, prix…) ne doivent pas passer par ici. */
export function groupDaysIntoMonths<G extends { date: string }>(
  dayGroups: G[],
  formatMonth: (dateKey: string) => string,
): Array<{ key: string; label: string; days: G[] }> {
  const months = new Map<string, { label: string; days: G[] }>();
  for (const g of dayGroups) {
    const key = g.date.slice(0, 7);
    if (!months.has(key)) months.set(key, { label: formatMonth(g.date), days: [] });
    months.get(key)!.days.push(g);
  }
  return [...months.entries()].map(([key, m]) => ({ key, label: m.label, days: m.days }));
}
