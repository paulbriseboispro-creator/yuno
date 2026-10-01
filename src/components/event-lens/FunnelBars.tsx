/**
 * Le tunnel d'achat en barres : une ligne par étape (largeur = part de la
 * première étape), ce qu'on perd entre deux étapes juste dessous, et la plus
 * grosse fuite cerclée d'ambre. Pas d'entonnoir décoratif : une barre se
 * compare à sa voisine, un trapèze non.
 */
import { AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { KIT, pctFmt, useNumberFormat } from '@/components/analytics/kitFormat';
import type { FunnelStage, Leak, TrafficPillar } from '@/lib/eventTraffic';

const AMBER = 'var(--acc-f59e0b)';

export function FunnelBars({ stages, leak, pillar }: { stages: FunnelStage[]; leak: Leak | null; pillar?: TrafficPillar | null }) {
  const { t } = useLanguage();
  const { n, locale } = useNumberFormat();
  const label = (key: FunnelStage['key']) => t(key === 'purchased' && pillar === 'guest_list' ? 'evl.stage.joined' : `evl.stage.${key}`);

  return (
    <ol className="space-y-3">
      {stages.map((s, i) => {
        const isLeak = leak?.at === s.key;
        const width = Math.max(s.count > 0 ? 1.5 : 0, s.ofTop ?? 0);
        // La dégradation de l'opacité suit le rang : plus on avance, plus la barre s'allume.
        const opacity = 0.42 + (0.58 * i) / Math.max(1, stages.length - 1);
        return (
          <li key={s.key}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3" style={{ fontSize: 13 }}>
              <span style={{ color: KIT.T2 }}>{label(s.key)}</span>
              <span className="whitespace-nowrap tabular-nums" style={{ color: KIT.T1 }}>
                <strong style={{ fontWeight: 650 }}>{n(s.count)}</strong>
                {s.ofTop !== null && i > 0 && <span style={{ color: KIT.T3 }}> · {pctFmt(s.ofTop, locale, 1)}</span>}
              </span>
            </div>
            <div
              className="relative h-7 overflow-hidden rounded-lg"
              style={{ background: KIT.TRACK, outline: isLeak ? `1.5px solid ${AMBER}` : undefined, outlineOffset: 1 }}
              aria-hidden
            >
              <div className="h-full rounded-lg transition-[width] duration-500" style={{ width: `${width}%`, background: KIT.RED, opacity }} />
            </div>
            {i > 0 && s.lost > 0 && (
              <p className="mt-1 flex items-center gap-1.5 tabular-nums" style={{ color: isLeak ? AMBER : KIT.T3, fontSize: 11.5, fontWeight: isLeak ? 600 : 400 }}>
                {isLeak && <AlertTriangle className="h-3 w-3 flex-none" aria-hidden />}
                {t('evl.funnel.lost').replace('{n}', n(s.lost)).replace('{pct}', pctFmt(100 - (s.ofPrev ?? 0), locale, 1))}
                {isLeak && <span> · {t('evl.funnel.biggestLeak')}</span>}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
