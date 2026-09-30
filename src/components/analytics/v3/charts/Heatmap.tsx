/**
 * Heatmap jour × heure des achats (spec §4.2) : une seule teinte séquentielle,
 * plus clair = plus haut en sombre. Tap = valeur.
 */
import { useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { A3 } from '../an3Tokens';

const DAYS = [1, 2, 3, 4, 5, 6, 7];

export function Heatmap({ cells, total }: { cells: { w: number; h: number; n: number }[]; total: number }) {
  const { t, language } = useLanguage();
  const [picked, setPicked] = useState<{ w: number; h: number; n: number } | null>(null);
  const grid = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cells) m.set(`${c.w}-${c.h}`, c.n);
    return m;
  }, [cells]);
  const max = Math.max(...cells.map((c) => c.n), 1);
  const dayNames = useMemo(() => {
    const f = new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB', { weekday: 'short' });
    // 2024-01-01 est un lundi.
    return DAYS.map((d) => f.format(new Date(Date.UTC(2024, 0, d, 12))).replace('.', ''));
  }, [language]);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="grid gap-[2px]" style={{ gridTemplateColumns: `28px repeat(24, minmax(0, 1fr))` }} role="img" aria-label={t('an3.heat.aria')}>
        <span />
        {hours.map((h) => (
          <span key={h} className="text-center tabular-nums" style={{ fontSize: 9, color: A3.t3, visibility: h % 3 === 0 ? 'visible' : 'hidden' }}>{h}h</span>
        ))}
        {DAYS.map((w, di) => (
          <DayRow key={w} w={w} name={dayNames[di]} hours={hours} grid={grid} max={max} picked={picked} onPick={setPicked} />
        ))}
      </div>
      <div className="flex items-center justify-between text-[11.5px]" style={{ color: A3.t3 }}>
        <span>{picked ? t('an3.heat.pick').replace('{day}', dayNames[picked.w - 1]).replace('{h}', String(picked.h)).replace('{n}', String(picked.n)) : t('an3.heat.tap')}</span>
        <span className="tabular-nums">{t('an3.heat.total').replace('{n}', new Intl.NumberFormat(language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB').format(total))}</span>
      </div>
    </div>
  );
}

function DayRow({ w, name, hours, grid, max, picked, onPick }: {
  w: number; name: string; hours: number[]; grid: Map<string, number>; max: number;
  picked: { w: number; h: number; n: number } | null; onPick: (c: { w: number; h: number; n: number }) => void;
}) {
  return (
    <>
      <span className="self-center" style={{ fontSize: 10.5, color: A3.t3 }}>{name}</span>
      {hours.map((h) => {
        const n = grid.get(`${w}-${h}`) ?? 0;
        const a = n === 0 ? 0.06 : 0.16 + 0.84 * Math.sqrt(n / max);
        const active = picked && picked.w === w && picked.h === h;
        return (
          <button key={h} type="button" onClick={() => onPick({ w, h, n })}
            className="aspect-square min-h-[14px] rounded-[3px]"
            aria-label={`${name} ${h}h: ${n}`}
            style={{ background: n === 0 ? A3.faint : `rgba(91,156,255,${a.toFixed(2)})`, outline: active ? `1px solid ${A3.t1}` : 'none' }} />
        );
      })}
    </>
  );
}
